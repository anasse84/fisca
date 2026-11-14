/// <reference types="node" />
/**
 * Fixtures de la base du plan de contrôle pour les scénarios du coffre (ancrage, LTA) : `memory` (pilote SQL en mémoire, base des tests
 * historiques) et `postgres` (PostgreSQL 16 réel, schéma temporaire, DDL réel de `archival_merkle_batches` issu des migrations du
 * plan de contrôle traduites par `controlPlaneMigrationPostgresStatements`). Les deux partagent le coffre WORM en mémoire.
 * `ensure-postgres.sh` est lancé ici : vault-merkle n'a pas de globalSetup, et aucun test n'est ignoré si le serveur est injoignable.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONTROL_PLANE_MIGRATIONS, controlPlaneMigrationPostgresStatements, ensureTenantSchemaUpToDate } from '@fisca/db-schema';
import { InMemoryInfrastructureAdapter, type TenantSqlDriver } from '@fisca/shared-types';
import { PgSandbox } from '../../../db-schema/tests/pg-sandbox.ts';
import { createTestTimestampProvider } from '../../../ubl-xades/tests/support/test-pki.ts';
import { createAnchorFixture, createClock, type AnchorFixture } from './fixture.ts';

export type SqlBackendKind = 'memory' | 'postgres';

export interface BackendFixture extends AnchorFixture {
  readonly kind: SqlBackendKind;
  readonly controlDb: TenantSqlDriver;
  close(): Promise<void>;
}

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export function ensurePostgresRunning(): void {
  execFileSync('bash', ['scripts/ensure-postgres.sh'], { cwd: REPO_ROOT, stdio: 'pipe' });
}

/** Adaptateur dont le plan de contrôle est la base PostgreSQL ; coffre et horloge restent ceux du pilote en mémoire. */
class PostgresControlPlaneAdapter extends InMemoryInfrastructureAdapter {
  constructor(private readonly controlDb: TenantSqlDriver, nowIso: () => string) {
    super({ acknowledgeTestOnly: 'NOT_FOR_PRODUCTION', providerMode: 'CLOUDFLARE_EDGE', nowIso });
  }

  override getControlPlaneDb(): TenantSqlDriver {
    return this.controlDb;
  }
}

export async function createBackendFixture(kind: SqlBackendKind, startIso: string): Promise<BackendFixture> {
  if (kind === 'memory') {
    const fixture = await createAnchorFixture(startIso);
    return { ...fixture, kind, controlDb: fixture.adapter.getControlPlaneDb(), close: () => Promise.resolve() };
  }
  ensurePostgresRunning();
  const sandbox = new PgSandbox();
  await sandbox.open();
  const controlDb = sandbox.driver('control-plane');
  await ensureTenantSchemaUpToDate(null, controlDb, 'control-plane', CONTROL_PLANE_MIGRATIONS, { statementsFor: controlPlaneMigrationPostgresStatements });
  const clock = createClock(startIso);
  const adapter = new PostgresControlPlaneAdapter(controlDb, clock.nowIso);
  const tsa = await createTestTimestampProvider({ now: clock.now });
  return { kind, adapter, clock, tsa, controlDb, close: () => sandbox.close() };
}
