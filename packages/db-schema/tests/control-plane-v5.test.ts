import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CONTROL_PLANE_INDEX_NAMES,
  CONTROL_PLANE_MIGRATIONS,
  CONTROL_PLANE_TABLE_NAMES,
  CPA_MANDATE_DELEGABLE_ROLES,
  CPA_MANDATE_STATUSES,
  controlPlaneMigrationPostgresStatements,
  type ControlPlaneMigration,
} from '../src/control-plane.ts';
import { CHECK_VIOLATION, DualEngines, type Engine } from './dual-engine.ts';
import { all, NOW, openControlPlane } from './support.ts';

/**
 * Plan de contrôle v5 (T-S1B-11, H2 tranché par le propriétaire) : table `company_cpa_mandates` (mandat d'un cabinet sur le dossier
 * d'un client). Chaque règle est exécutée RÉELLEMENT sur SQLite (node:sqlite) et sur PostgreSQL 16 (schéma temporaire supprimé).
 */
const PG_URL = process.env['FISCA_TEST_PG_URL'] ?? 'postgres://fisca@127.0.0.1:54329/postgres';
const SCHEMA = `fisca_cp5_${randomBytes(6).toString('hex')}`;

const V1_SHA256 = '46dd28bf38c55458ce6f096e876da1d8b49dca273a99aa86982764a7f12439ae';
const V2_SHA256 = 'c85a6b9bcb464634089d19024884c4ae039534e9ad99fdfa895cfa6e9525e125';
const V3_SHA256 = '36eac2e7d810d74eabf7f7670a57dbf129fd660823a9540baf30593b3a327cfe';
const V5_SHA256 = '44d771b3bb4f7d40a2867d55cd9cf4641f4d62c4c906ce4cd0b6326dfdbd7ded';
const V4_SHA256 = 'd379a18aae7c501e94e7cf419d4a40239439b743f749447a7ad8446db9517ec8';

function migrationV5(): ControlPlaneMigration {
  const migration = CONTROL_PLANE_MIGRATIONS[4];
  if (migration === undefined) {
    throw new Error('la migration v5 du plan de contrôle est absente');
  }
  return migration;
}

let client: Client;
let dual: DualEngines;

beforeAll(async () => {
  client = new Client({ connectionString: PG_URL });
  await client.connect();
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  for (const migration of CONTROL_PLANE_MIGRATIONS) {
    for (const statement of controlPlaneMigrationPostgresStatements(migration)) {
      await client.query(statement);
    }
  }
  dual = new DualEngines(client, openControlPlane);
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  const remaining = await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [SCHEMA]);
  await client.end();
  expect(remaining.rowCount).toBe(0);
});

async function seed(engine: Engine): Promise<void> {
  await engine.run(`INSERT INTO organizations (id, name, org_kind, ui_locale_policy, created_at) VALUES ('org-client', 'Client', 'DIRECT_BUSINESS', 'SIX_LOCALES_PME', ?)`, [NOW]);
  await engine.run(`INSERT INTO organizations (id, name, org_kind, ui_locale_policy, created_at) VALUES ('org-cabinet', 'Cabinet', 'FIDUCIAIRE_OEC', 'THREE_LOCALES_INSTITUTIONAL', ?)`, [NOW]);
  await engine.run(`INSERT INTO organizations (id, name, org_kind, ui_locale_policy, created_at) VALUES ('org-cabinet-2', 'Cabinet 2', 'FIDUCIAIRE_OEC', 'THREE_LOCALES_INSTITUTIONAL', ?)`, [NOW]);
  await engine.run(`INSERT INTO users (id, email_normalized, full_name, created_at) VALUES ('u-owner', 'owner@x.ma', 'Owner', ?)`, [NOW]);
  for (const [company, ice] of [['co-1', '001234567000089'], ['co-2', '001234567000090']] as const) {
    await engine.run(
      `INSERT INTO tenant_databases (company_id, organization_id, ice, identifiant_fiscal, raison_sociale_fr, legal_form, vat_regime, vat_cadence,
         d1_database_uuid, ingest_email_alias, created_at) VALUES (?, 'org-client', ?, '12345678', 'Atlas', 'SARL', 'ENCAISSEMENT', 'MENSUELLE', ?, ?, ?)`,
      [company, ice, `d1-${company}`, `${company}@ingest.fisca.ma`, NOW],
    );
  }
}

beforeEach(async () => {
  await client.query('TRUNCATE users, organizations, tenant_databases CASCADE');
  dual.resetSqlite();
  for (const engine of dual.engines()) {
    await seed(engine);
  }
});

const INSERT = `INSERT INTO company_cpa_mandates (mandate_id, company_id, fiduciary_org_id, status, max_delegated_role, can_access_payroll_pii, scoped_user_ids_json,
  granted_by_user_id, granted_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

type Cell = string | number | null;
type MandateOverrides = Partial<Record<'id' | 'company' | 'org' | 'status' | 'role' | 'pii' | 'scoped' | 'by' | 'grantedAt' | 'revokedAt', Cell>>;

function mandate(overrides: MandateOverrides = {}): readonly Cell[] {
  const v = { id: 'm-1', company: 'co-1', org: 'org-cabinet', status: 'ACTIVE', role: 'CHEF_MISSION', pii: 0, scoped: null, by: 'u-owner', grantedAt: NOW, revokedAt: null, ...overrides };
  return [v.id, v.company, v.org, v.status, v.role, v.pii, v.scoped, v.by, v.grantedAt, v.revokedAt];
}

async function expectRejected(params: readonly Cell[]): Promise<void> {
  const [lite, pg] = await dual.onBoth((e) => e.fail(INSERT, params));
  expect(lite.message).toMatch(/CHECK constraint failed/);
  expect(pg.code).toBe(CHECK_VIOLATION);
  const [liteRows, pgRows] = await dual.onBoth((e) => e.rows('SELECT COUNT(*) AS n FROM company_cpa_mandates'));
  expect(liteRows).toEqual([{ n: 0 }]);
  expect(pgRows).toEqual(liteRows);
}

describe('migration v5 du plan de contrôle : forme et immuabilité de v1 à v4', () => {
  it('est la cinquième migration ; les empreintes de v1 à v4 sont inchangées (recalculées)', () => {
    expect(CONTROL_PLANE_MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5]);
    expect(migrationV5().name).toBe('control_plane_v5_company_cpa_mandates');
    for (const [index, expected] of [V1_SHA256, V2_SHA256, V3_SHA256, V4_SHA256].entries()) {
      const migration = CONTROL_PLANE_MIGRATIONS[index];
      expect(migration?.expectedSha256Hex).toBe(expected);
      expect(createHash('sha256').update(migration?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex'), `v${index + 1}`).toBe(expected);
    }
    expect(migrationV5().expectedSha256Hex).toBe(V5_SHA256);
    expect(createHash('sha256').update(migrationV5().upSqlStatements.join('\n'), 'utf8').digest('hex')).toBe(V5_SHA256);
  });

  it('déclare sa table et son index, sans colonne ajoutée ni trigger', () => {
    expect(migrationV5().tableNames).toEqual(['company_cpa_mandates']);
    expect(migrationV5().indexNames).toEqual(['idx_cpa_mandates_lookup']);
    expect(migrationV5().addedColumns).toBeUndefined();
    expect(migrationV5().triggerNames).toBeUndefined();
    expect(CONTROL_PLANE_TABLE_NAMES.at(-1)).toBe('company_cpa_mandates');
    expect(CONTROL_PLANE_INDEX_NAMES).toContain('idx_cpa_mandates_lookup');
    expect(CPA_MANDATE_STATUSES).toEqual(['ACTIVE', 'REVOKED']);
    expect(CPA_MANDATE_DELEGABLE_ROLES).toEqual(['EXPERT_COMPTABLE_OEC', 'CHEF_MISSION', 'AIDE_COMPTABLE', 'AUDITEUR_CAC_DGI']);
  });

  it('une base v4 contenant des données se met à niveau en v5 sans perte', () => {
    const upgraded = new DatabaseSync(':memory:');
    upgraded.exec('PRAGMA foreign_keys = ON');
    for (const migration of CONTROL_PLANE_MIGRATIONS.filter((m) => m.version <= 4)) {
      for (const statement of migration.upSqlStatements) {
        upgraded.exec(statement);
      }
    }
    upgraded.prepare(`INSERT INTO users (id, email_normalized, full_name, created_at) VALUES ('u1', 'a@b.ma', 'A', ?)`).run(NOW);
    for (const statement of migrationV5().upSqlStatements) {
      upgraded.exec(statement);
    }
    expect(all(upgraded, 'SELECT id FROM users')).toEqual([{ id: 'u1' }]);
    expect(all(upgraded, 'SELECT COUNT(*) AS n FROM company_cpa_mandates')).toEqual([{ n: 0 }]);
  });

  it('la migration est rejouable (CREATE ... IF NOT EXISTS) sur les deux moteurs', async () => {
    const lite = openControlPlane();
    for (const statement of migrationV5().upSqlStatements) {
      lite.exec(statement);
    }
    for (const statement of controlPlaneMigrationPostgresStatements(migrationV5())) {
      await client.query(statement);
    }
  });

  it('la traduction PostgreSQL remplace INTEGER par BIGINT et json_valid/json_type par IS JSON ARRAY (PostgreSQL 16)', () => {
    const pgSql = controlPlaneMigrationPostgresStatements(migrationV5()).join('\n');
    expect(pgSql).toContain('can_access_payroll_pii BIGINT NOT NULL DEFAULT 0');
    expect(pgSql).toContain('IS JSON ARRAY');
    expect(pgSql).not.toMatch(/json_valid|json_type|\bINTEGER\b/);
    expect(migrationV5().upSqlStatements.join('\n')).toMatch(/json_valid\(scoped_user_ids_json\)/);
  });
});

describe('schéma exact du propriétaire sur SQLite et PostgreSQL 16', () => {
  const EXPECTED = [
    ['mandate_id', 1, 'text'],
    ['company_id', 1, 'text'],
    ['fiduciary_org_id', 1, 'text'],
    ['status', 1, 'text'],
    ['max_delegated_role', 1, 'text'],
    ['can_access_payroll_pii', 1, 'bigint'],
    ['scoped_user_ids_json', 0, 'text'],
    ['granted_by_user_id', 1, 'text'],
    ['granted_at', 1, 'text'],
    ['revoked_at', 0, 'text'],
  ] as const;

  it('mêmes colonnes, ordre et nullité (TEXT, INTEGER devenant BIGINT sous PostgreSQL)', async () => {
    const lite = all(openControlPlane(), `SELECT name, ("notnull" OR pk > 0) AS not_null, type, dflt_value FROM pragma_table_info('company_cpa_mandates') ORDER BY cid`);
    expect(lite.map((r) => [r['name'], r['not_null'], String(r['type']).toLowerCase() === 'integer' ? 'bigint' : String(r['type']).toLowerCase()])).toEqual(
      EXPECTED.map((e) => [...e]),
    );
    expect(lite.find((r) => r['name'] === 'can_access_payroll_pii')?.['dflt_value']).toBe('0');
    const pg = await client.query(
      `SELECT column_name, is_nullable, data_type, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'company_cpa_mandates' ORDER BY ordinal_position`,
      [SCHEMA],
    );
    expect(pg.rows.map((r: { column_name: string; is_nullable: string; data_type: string }) => [r.column_name, r.is_nullable === 'NO' ? 1 : 0, r.data_type])).toEqual(EXPECTED.map((e) => [...e]));
    expect(pg.rows.find((r: { column_name: string }) => r.column_name === 'can_access_payroll_pii')?.column_default).toBe('0');
  });

  it("l'index idx_cpa_mandates_lookup porte (fiduciary_org_id, company_id, status) sur les deux moteurs", async () => {
    const lite = all(openControlPlane(), `SELECT name FROM pragma_index_info('idx_cpa_mandates_lookup') ORDER BY seqno`).map((r) => r['name']);
    expect(lite).toEqual(['fiduciary_org_id', 'company_id', 'status']);
    const pg = await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = 'idx_cpa_mandates_lookup'`, [SCHEMA]);
    expect(pg.rows).toHaveLength(1);
    expect(pg.rows[0].indexdef).toMatch(/\(fiduciary_org_id, company_id, status\)/);
  });

  it('clés étrangères vers tenant_databases, organizations et users (DDL v1) ; PRAGMA et pg_constraint concordent', async () => {
    const lite = all(openControlPlane(), `SELECT "from" AS local, "table" AS parent, "to" AS target FROM pragma_foreign_key_list('company_cpa_mandates')`)
      .map((r) => `${String(r['local'])}->${String(r['parent'])}(${String(r['target'])})`)
      .sort();
    expect(lite).toEqual(['company_id->tenant_databases(company_id)', 'fiduciary_org_id->organizations(id)', 'granted_by_user_id->users(id)']);
    const pg = await client.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = ($1 || '.company_cpa_mandates')::regclass AND contype = 'f'`,
      [SCHEMA],
    );
    expect(pg.rows.map((r: { def: string }) => r.def).sort()).toEqual([
      'FOREIGN KEY (company_id) REFERENCES tenant_databases(company_id)',
      'FOREIGN KEY (fiduciary_org_id) REFERENCES organizations(id)',
      'FOREIGN KEY (granted_by_user_id) REFERENCES users(id)',
    ]);
  });
});

describe('contraintes (CHECK, UNIQUE, FK) exécutées sur les deux moteurs', () => {
  it('un mandat actif et un mandat révoqué cohérents sont acceptés ; défaut can_access_payroll_pii = 0', async () => {
    for (const engine of dual.engines()) {
      await engine.run(INSERT, mandate());
      await engine.run(INSERT, mandate({ id: 'm-2', org: 'org-cabinet-2', status: 'REVOKED', revokedAt: '2026-11-14T08:00:00Z', role: 'AUDITEUR_CAC_DGI', scoped: '["u-a","u-b"]', pii: 1 }));
      await engine.run(
        `INSERT INTO company_cpa_mandates (mandate_id, company_id, fiduciary_org_id, status, max_delegated_role, granted_by_user_id, granted_at) VALUES ('m-3', 'co-2', 'org-cabinet', 'ACTIVE', 'AIDE_COMPTABLE', 'u-owner', ?)`,
        [NOW],
      );
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows('SELECT mandate_id, status, can_access_payroll_pii AS pii_flag, scoped_user_ids_json, revoked_at FROM company_cpa_mandates ORDER BY mandate_id'));
    expect(lite).toEqual([
      { mandate_id: 'm-1', status: 'ACTIVE', pii_flag: 0, scoped_user_ids_json: null, revoked_at: null },
      { mandate_id: 'm-2', status: 'REVOKED', pii_flag: 1, scoped_user_ids_json: '["u-a","u-b"]', revoked_at: '2026-11-14T08:00:00Z' },
      { mandate_id: 'm-3', status: 'ACTIVE', pii_flag: 0, scoped_user_ids_json: null, revoked_at: null },
    ]);
    expect(pg).toEqual(lite);
  });

  it('UNIQUE (company_id, fiduciary_org_id) : un second mandat du même cabinet sur le même dossier est refusé, même révoqué', async () => {
    for (const engine of dual.engines()) {
      await engine.run(INSERT, mandate());
    }
    const [lite, pg] = await dual.onBoth((e) => e.fail(INSERT, mandate({ id: 'm-dup' })));
    expect(lite.message).toMatch(/UNIQUE constraint failed: company_cpa_mandates\.company_id, company_cpa_mandates\.fiduciary_org_id/);
    expect(pg.code).toBe('23505');
    const [liteRevoked, pgRevoked] = await dual.onBoth((e) => e.fail(INSERT, mandate({ id: 'm-dup2', status: 'REVOKED', revokedAt: NOW })));
    expect(liteRevoked.message).toMatch(/UNIQUE constraint failed/);
    expect(pgRevoked.code).toBe('23505');
    for (const engine of dual.engines()) {
      await engine.run(INSERT, mandate({ id: 'm-ok1', org: 'org-cabinet-2' }));
      await engine.run(INSERT, mandate({ id: 'm-ok2', company: 'co-2' }));
    }
  });

  it('PRIMARY KEY mandate_id : doublon refusé', async () => {
    for (const engine of dual.engines()) {
      await engine.run(INSERT, mandate());
    }
    const [lite, pg] = await dual.onBoth((e) => e.fail(INSERT, mandate({ company: 'co-2' })));
    expect(lite.message).toMatch(/UNIQUE constraint failed: company_cpa_mandates\.mandate_id/);
    expect(pg.code).toBe('23505');
  });

  it('CHECK status : seules ACTIVE et REVOKED', async () => {
    for (const status of ['PENDING', 'active', '']) {
      await expectRejected(mandate({ status }));
    }
  });

  it('CHECK max_delegated_role : seuls les 4 rôles délégables ; OWNER_GERANT, DAF_TRESORIER, rôles techniques refusés', async () => {
    for (const role of ['OWNER_GERANT', 'DAF_TRESORIER', 'AI_MCP_ACTOR', 'ERP_CONNECTOR_AGENT', 'chef_mission']) {
      await expectRejected(mandate({ role }));
    }
    for (const [index, role] of CPA_MANDATE_DELEGABLE_ROLES.entries()) {
      for (const engine of dual.engines()) {
        await engine.run(INSERT, mandate({ id: `m-r${index}`, company: index % 2 === 0 ? 'co-1' : 'co-2', org: index < 2 ? 'org-cabinet' : 'org-cabinet-2', role }));
      }
    }
  });

  it('CHECK can_access_payroll_pii IN (0, 1)', async () => {
    for (const pii of [2, -1]) {
      await expectRejected(mandate({ pii }));
    }
  });

  it("CHECK de cohérence : status = 'REVOKED' si et seulement si revoked_at est renseigné", async () => {
    await expectRejected(mandate({ status: 'REVOKED', revokedAt: null }));
    await expectRejected(mandate({ status: 'ACTIVE', revokedAt: '2026-11-14T08:00:00Z' }));
  });

  it('CHECK horodatages UTC YYYY-MM-DDTHH:MM:SSZ (granted_at, revoked_at) et revoked_at >= granted_at', async () => {
    await expectRejected(mandate({ grantedAt: '2026-11-13 10:00:00' }));
    await expectRejected(mandate({ grantedAt: '1763028000' }));
    await expectRejected(mandate({ grantedAt: '2026-11-13T10:00:00.000Z' }));
    await expectRejected(mandate({ status: 'REVOKED', revokedAt: '2026-11-14 08:00:00' }));
    await expectRejected(mandate({ status: 'REVOKED', revokedAt: '2026-11-12T10:00:00Z' }));
    for (const engine of dual.engines()) {
      await engine.run(INSERT, mandate({ status: 'REVOKED', revokedAt: NOW }));
    }
  });

  it('CHECK scoped_user_ids_json : NULL ou tableau JSON valide ; objet, scalaire et JSON malformé refusés', async () => {
    for (const scoped of ['{"a":1}', '"u-1"', '12', 'null', '[u-1]', '', '["u-1"']) {
      await expectRejected(mandate({ scoped }));
    }
    for (const [index, scoped] of [null, '[]', '["u-1"]', '["u-1","u-2"]'].entries()) {
      for (const engine of dual.engines()) {
        await engine.run('DELETE FROM company_cpa_mandates');
        await engine.run(INSERT, mandate({ id: `m-s${index}`, scoped }));
      }
    }
  });

  it('clés étrangères : dossier, cabinet et mandant inconnus refusés (23503 / FOREIGN KEY)', async () => {
    for (const overrides of [{ company: 'co-inconnu' }, { org: 'org-inconnue' }, { by: 'u-inconnu' }]) {
      const [lite, pg] = await dual.onBoth((e) => e.fail(INSERT, mandate(overrides)));
      expect(lite.message).toMatch(/FOREIGN KEY constraint failed/);
      expect(pg.code).toBe('23503');
    }
  });

  it('recherche de la voie B : le plan SQLite utilise un index (idx_cpa_mandates_lookup ou UNIQUE)', () => {
    const plan = all(
      openControlPlane(),
      `EXPLAIN QUERY PLAN SELECT mandate_id FROM company_cpa_mandates WHERE fiduciary_org_id = 'a' AND company_id = 'b' AND status = 'ACTIVE'`,
    )
      .map((r) => String(r['detail']))
      .join(' | ');
    expect(plan).toMatch(/USING (COVERING )?INDEX (idx_cpa_mandates_lookup|sqlite_autoindex_company_cpa_mandates_\d)/);
  });
});
