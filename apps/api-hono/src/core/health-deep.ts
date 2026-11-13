/**
 * GET /api/v1/health/deep (CTR-API-13 ; Doc_12 § PRA, Doc_16 : sondes tri-régionales toutes les 15 s).
 *
 * Vérifie une lecture réelle sur CONTROL_PLANE_DB et l'accès au coffre R2_LEGAL_VAULT. Route PUBLIQUE (les sondes externes
 * n'ont pas de jeton, Doc_16) : elle ne rend que l'état UP/DOWN par dépendance et une latence entière ; jamais de message
 * d'erreur, de nom de ressource, d'identifiant ni de version. Une sonde qui dépasse `timeoutMs` est DOWN.
 */
import { Hono } from 'hono';
import type { TenantSqlDriver, WormVaultDriver } from '@fisca/shared-types';
import { HealthDeepResponseSchema, type HEALTH_DEPENDENCY_NAMES, type HealthDeepResponse } from './api-v1-schemas.ts';

export type HealthDependencyName = (typeof HEALTH_DEPENDENCY_NAMES)[number];

export interface HealthCheck {
  /** Résout si la dépendance répond ; rejette sinon (le message n'est jamais exposé). */
  check(): Promise<void>;
}

export interface HealthProbe extends HealthCheck {
  readonly name: HealthDependencyName;
}

export interface HealthDeepDeps {
  readonly probes: readonly HealthProbe[];
  readonly nowMs: () => number;
  readonly timeoutMs: number;
}

export const HEALTH_DEEP_PATH = '/api/v1/health/deep' as const;

/** Assemble les sondes dans l'ordre contractuel : plan de contrôle puis coffre légal. */
export function createHealthDeepProbeSet(checks: { readonly controlPlane: HealthCheck; readonly legalVault: HealthCheck }): readonly HealthProbe[] {
  return [
    { name: 'control_plane_db', check: () => checks.controlPlane.check() },
    { name: 'legal_vault', check: () => checks.legalVault.check() },
  ];
}

/** Lecture réelle du plan de contrôle (`organizations` existe dès la migration 1). */
export function createControlPlaneCheck(controlPlane: TenantSqlDriver): HealthCheck {
  return {
    check: async () => {
      await controlPlane.query({ sql: 'SELECT id FROM organizations LIMIT 1', params: [] });
    },
  };
}

/** Accès au coffre : une lecture de `probeKey` (absent = coffre joignable) ; seule une erreur d'accès est une panne. */
export function createLegalVaultCheck(vault: WormVaultDriver, probeKey: string): HealthCheck {
  return {
    check: async () => {
      await vault.getObjectBytes(probeKey);
    },
  };
}

async function runProbe(probe: HealthProbe, timeoutMs: number, nowMs: () => number): Promise<HealthDeepResponse['dependencies'][number]> {
  const started = nowMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'TIMEOUT'>((resolve) => {
    timer = setTimeout(() => resolve('TIMEOUT'), timeoutMs);
  });
  let status: 'UP' | 'DOWN';
  try {
    const outcome = await Promise.race([probe.check().then(() => 'OK' as const), timeout]);
    status = outcome === 'OK' ? 'UP' : 'DOWN';
  } catch {
    status = 'DOWN';
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
  return { name: probe.name, status, latencyMs: Math.max(0, nowMs() - started) };
}

export function createHealthDeepRoute(deps: HealthDeepDeps): Hono {
  const app = new Hono();
  app.get(HEALTH_DEEP_PATH, async (c) => {
    const dependencies = await Promise.all(deps.probes.map((probe) => runProbe(probe, deps.timeoutMs, deps.nowMs)));
    const status = dependencies.every((dependency) => dependency.status === 'UP') ? 'UP' : 'DOWN';
    const body = HealthDeepResponseSchema.parse({ status, checkedAt: new Date(deps.nowMs()).toISOString(), dependencies });
    return c.json(body, status === 'UP' ? 200 : 503, { 'Cache-Control': 'no-store' });
  });
  return app;
}
