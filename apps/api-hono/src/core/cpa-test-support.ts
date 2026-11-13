/// <reference types="node" />
/**
 * Doubles et graines des tests des mandats de cabinet (code de test uniquement, jamais importé par le code de production) :
 * plan de contrôle RÉEL (SQLite `node:sqlite` ou PostgreSQL 16 temporaire), migré par `CONTROL_PLANE_MIGRATIONS`, et graine
 * d'organisations, d'utilisateurs, d'appartenances, de dossiers et de mandats.
 */
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import {
  CONTROL_PLANE_MIGRATIONS,
  controlPlaneMigrationPostgresStatements,
  createPostgresTenantDriver,
  ensureTenantSchemaUpToDate,
} from '@fisca/db-schema';
import type { SqlStatementParams, TenantSqlDriver } from '@fisca/shared-types';
import { PG_URL, openBareSqliteDriver } from './ledger-test-harness.ts';

export const CPA_NOW = '2026-11-13T10:00:00Z';
export const OWNER_ORG = 'org-client';
export const CABINET = 'org-cab';
export const CABINET_2 = 'org-cab2';
export const CO_CLOUD = 'co-cloud';
export const CO_E2EE = 'co-e2ee';
export const U_OEC = 'u-oec';
export const U_CHEF = 'u-chef';
export const U_AIDE = 'u-aide';
export const U_AUDITOR = 'u-aud';
export const U_CAB_OWNER = 'u-cabowner';
export const U_STRANGER = 'u-stranger';
export const U_GRANTER = 'u-granter';

export interface ControlPlaneBackend {
  readonly name: 'sqlite' | 'postgres';
  readonly driver: TenantSqlDriver;
  close(): Promise<void>;
}

export async function openControlPlaneBackend(name: 'sqlite' | 'postgres'): Promise<ControlPlaneBackend> {
  if (name === 'sqlite') {
    const driver = openBareSqliteDriver('control-plane');
    await ensureTenantSchemaUpToDate(null, driver, 'control-plane', CONTROL_PLANE_MIGRATIONS);
    return { name, driver, close: async () => undefined };
  }
  const schema = `fisca_cpa_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: PG_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: PG_URL, max: 2, options: `-c search_path=${schema}` });
  const driver = createPostgresTenantDriver('control-plane', pool);
  await ensureTenantSchemaUpToDate(null, driver, 'control-plane', CONTROL_PLANE_MIGRATIONS, { statementsFor: controlPlaneMigrationPostgresStatements });
  return {
    name,
    driver,
    close: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    },
  };
}

export async function exec(driver: TenantSqlDriver, sql: string, params: SqlStatementParams['params'] = []): Promise<void> {
  await driver.executeBatchAtomically([{ sql, params }]);
}

async function seedOrg(driver: TenantSqlDriver, id: string, kind: 'DIRECT_BUSINESS' | 'FIDUCIAIRE_OEC'): Promise<void> {
  await exec(driver, `INSERT INTO organizations (id, name, org_kind, ui_locale_policy, created_at) VALUES (?, ?, ?, 'SIX_LOCALES_PME', ?)`, [id, `Org ${id}`, kind, CPA_NOW]);
}

async function seedUser(driver: TenantSqlDriver, id: string): Promise<void> {
  await exec(driver, `INSERT INTO users (id, email_normalized, full_name, created_at) VALUES (?, ?, ?, ?)`, [id, `${id}@x.ma`, `User ${id}`, CPA_NOW]);
}

export async function seedMembership(driver: TenantSqlDriver, orgId: string, userId: string, role: string): Promise<void> {
  await exec(driver, `INSERT INTO organization_memberships (id, organization_id, user_id, role_code, created_at) VALUES (?, ?, ?, ?, ?)`, [`mb-${orgId}-${userId}`, orgId, userId, role, CPA_NOW]);
}

/** Monde minimal : dossier client (organisation propriétaire + abonnement), deux cabinets, utilisateurs de rôles variés. */
export async function seedCpaWorld(driver: TenantSqlDriver): Promise<void> {
  await seedOrg(driver, OWNER_ORG, 'DIRECT_BUSINESS');
  await seedOrg(driver, CABINET, 'FIDUCIAIRE_OEC');
  await seedOrg(driver, CABINET_2, 'FIDUCIAIRE_OEC');
  for (const user of [U_OEC, U_CHEF, U_AIDE, U_AUDITOR, U_CAB_OWNER, U_STRANGER, U_GRANTER]) {
    await seedUser(driver, user);
  }
  await seedMembership(driver, CABINET, U_OEC, 'EXPERT_COMPTABLE_OEC');
  await seedMembership(driver, CABINET, U_CHEF, 'CHEF_MISSION');
  await seedMembership(driver, CABINET, U_AIDE, 'AIDE_COMPTABLE');
  await seedMembership(driver, CABINET, U_AUDITOR, 'AUDITEUR_CAC_DGI');
  await seedMembership(driver, CABINET, U_CAB_OWNER, 'OWNER_GERANT');
  await seedMembership(driver, OWNER_ORG, U_GRANTER, 'OWNER_GERANT');
  await exec(driver, `INSERT INTO pricing_catalog (plan_code, segment, billing_cadence, unit_price_ht_cents, updated_at) VALUES ('PLAN_TEST', 'DIRECT_PME', 'MONTHLY', 10000, ?)`, [CPA_NOW]);
  await exec(
    driver,
    `INSERT INTO subscriptions (id, organization_id, plan_code, cadence, status, locked_base_price_ht_cents, current_period_start, current_period_end, created_at)
     VALUES ('sub-1', ?, 'PLAN_TEST', 'MONTHLY', 'ACTIVE_PAID', 10000, ?, ?, ?)`,
    [OWNER_ORG, CPA_NOW, '2026-12-13T10:00:00Z', CPA_NOW],
  );
  for (const [company, ice, mode] of [[CO_CLOUD, '001234567000089', 'CLOUD_ASSISTED'], [CO_E2EE, '001234567000090', 'ZERO_KNOWLEDGE_E2EE']] as const) {
    await exec(
      driver,
      `INSERT INTO tenant_databases (company_id, organization_id, ice, identifiant_fiscal, raison_sociale_fr, legal_form, vat_regime, vat_cadence, crypto_mode,
         d1_database_uuid, ingest_email_alias, created_at) VALUES (?, ?, ?, '12345678', 'Atlas', 'SARL', 'ENCAISSEMENT', 'MENSUELLE', ?, ?, ?, ?)`,
      [company, OWNER_ORG, ice, mode, `d1-${company}`, `${company}@ingest.fisca.ma`, CPA_NOW],
    );
  }
}

export interface MandateSeed {
  readonly mandateId?: string;
  readonly companyId?: string;
  readonly orgId?: string;
  readonly status?: 'ACTIVE' | 'REVOKED';
  readonly maxRole?: string;
  readonly payrollPii?: 0 | 1;
  readonly scopedJson?: string | null;
  readonly revokedAt?: string | null;
}

export async function seedMandate(driver: TenantSqlDriver, seed: MandateSeed = {}): Promise<string> {
  const mandateId = seed.mandateId ?? 'mandate-1';
  const status = seed.status ?? 'ACTIVE';
  const revokedAt = seed.revokedAt === undefined ? (status === 'REVOKED' ? '2026-11-14T08:00:00Z' : null) : seed.revokedAt;
  await exec(
    driver,
    `INSERT INTO company_cpa_mandates (mandate_id, company_id, fiduciary_org_id, status, max_delegated_role, can_access_payroll_pii, scoped_user_ids_json, granted_by_user_id, granted_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [mandateId, seed.companyId ?? CO_CLOUD, seed.orgId ?? CABINET, status, seed.maxRole ?? 'EXPERT_COMPTABLE_OEC', seed.payrollPii ?? 0, seed.scopedJson ?? null, U_GRANTER, CPA_NOW, revokedAt],
  );
  return mandateId;
}

/** Enveloppe `tenant_key_grants` (base du dossier) pour un destinataire EXTERNAL_CPA. */
export async function seedKeyGrant(tenantDb: TenantSqlDriver, actorId: string, options: { readonly revokedAt?: string | null; readonly dekVersion?: number; readonly grantId?: string } = {}): Promise<void> {
  const version = options.dekVersion ?? 1;
  await exec(
    tenantDb,
    `INSERT INTO tenant_key_grants (grant_id, grantee_role, grantee_actor_id, grantee_public_key_spki_b64, grantee_public_key_fingerprint_hex, dek_version,
       wrapped_dek_b64, wrapped_bidx_key_b64, created_at, revoked_at) VALUES (?, 'EXTERNAL_CPA', ?, 'spki', ?, ?, ?, ?, ?, ?)`,
    [options.grantId ?? `grant-${actorId}-${version}`, actorId, 'a'.repeat(64), version, `v1:${version}:AAAA`, `v1:${version}:BBBB`, CPA_NOW, options.revokedAt ?? null],
  );
}
