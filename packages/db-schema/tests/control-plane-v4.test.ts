import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CONTROL_PLANE_MIGRATIONS,
  CONTROL_PLANE_SQL,
  CONTROL_PLANE_TABLE_NAMES,
  CONTROL_PLANE_TRIGGER_NAMES,
  OAUTH_TRANSACTION_MAX_TTL_SEC,
  controlPlaneMigrationPostgresStatements,
} from '../src/control-plane.ts';
import { CHECK_VIOLATION, DualEngines, RAISED, type Failure } from './dual-engine.ts';
import { all, NOW, openControlPlane } from './support.ts';
import { NON_INTEGER } from './tenant-support.ts';

/**
 * Plan de contrôle v4 (corrections du pilote, tickets T-S1B-01) : colonnes WhatsApp de `users` (Doc_17 § 02, ERRATA D-19),
 * garde-fou de durée de vie de `oauth_transactions` et mapping PostgreSQL 16 (INTEGER vers BIGINT). Chaque règle est exécutée
 * RÉELLEMENT sur SQLite (node:sqlite) et sur PostgreSQL 16 dans un schéma temporaire supprimé en fin de test.
 */
const PG_URL = process.env['FISCA_TEST_PG_URL'] ?? 'postgres://fisca@127.0.0.1:54329/postgres';
const SCHEMA = `fisca_cp_${randomBytes(6).toString('hex')}`;

const V1_SHA256 = '46dd28bf38c55458ce6f096e876da1d8b49dca273a99aa86982764a7f12439ae';
const V2_SHA256 = 'c85a6b9bcb464634089d19024884c4ae039534e9ad99fdfa895cfa6e9525e125';
const V3_SHA256 = '36eac2e7d810d74eabf7f7670a57dbf129fd660823a9540baf30593b3a327cfe';

const MSG_TTL = 'OAUTH_TRANSACTION_TTL: expires_at dépasse 10 minutes après la création.';

function isoIn(seconds: number): string {
  return `${new Date(Date.now() + seconds * 1000).toISOString().slice(0, 19)}Z`;
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

beforeEach(async () => {
  await client.query('TRUNCATE users, organizations, oauth_transactions, tenant_databases CASCADE');
  dual.resetSqlite();
});

describe('migration v4 du plan de contrôle : forme et immuabilité de v1, v2 et v3', () => {
  const v4 = CONTROL_PLANE_MIGRATIONS[3];

  it('est la quatrième migration ; les empreintes de v1, v2 et v3 sont inchangées (recalculées)', () => {
    expect(CONTROL_PLANE_MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4]);
    expect(v4?.name).toBe('control_plane_v4_whatsapp_optin_oauth_ttl');
    for (const [index, expected] of [V1_SHA256, V2_SHA256, V3_SHA256].entries()) {
      const migration = CONTROL_PLANE_MIGRATIONS[index];
      expect(migration?.expectedSha256Hex).toBe(expected);
      expect(createHash('sha256').update(migration?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex'), `v${index + 1}`).toBe(expected);
    }
    expect(createHash('sha256').update(v4?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex')).toBe(v4?.expectedSha256Hex);
  });

  it('déclare ses deux colonnes ajoutées et son unique trigger, sans table ni index', () => {
    expect(v4?.addedColumns).toEqual(['users.whatsapp_optin_at', 'users.unsubscribed_at']);
    expect(v4?.triggerNames).toEqual(['enforce_oauth_transaction_max_ttl']);
    expect([...CONTROL_PLANE_TRIGGER_NAMES]).toEqual(['enforce_oauth_transaction_max_ttl']);
    const names: readonly string[] = CONTROL_PLANE_TABLE_NAMES;
    expect(names).toHaveLength(26);
    expect(all(openControlPlane(), `SELECT name FROM sqlite_master WHERE type = 'trigger'`)).toEqual([{ name: 'enforce_oauth_transaction_max_ttl' }]);
  });

  it('une base v3 contenant des utilisateurs et des transactions se met à niveau sans perte ; les nouvelles colonnes valent NULL', () => {
    const upgraded = new DatabaseSync(':memory:');
    upgraded.exec('PRAGMA foreign_keys = ON');
    for (const migration of CONTROL_PLANE_MIGRATIONS.filter((m) => m.version <= 3)) {
      for (const statement of migration.upSqlStatements) {
        upgraded.exec(statement);
      }
    }
    upgraded.prepare(`INSERT INTO users (id, email_normalized, full_name, created_at) VALUES ('u1', 'a@b.ma', 'A', ?)`).run(NOW);
    for (const statement of v4?.upSqlStatements ?? []) {
      upgraded.exec(statement);
    }
    expect(all(upgraded, 'SELECT id, whatsapp_optin_at, unsubscribed_at FROM users')).toEqual([{ id: 'u1', whatsapp_optin_at: null, unsubscribed_at: null }]);
  });
});

describe('3. users.whatsapp_optin_at et users.unsubscribed_at (Doc_17 § 02, canal WABA : OTP et relances groupées)', () => {
  const insertUser = (id: string, optin: string | null, unsub: string | null): [string, readonly (string | null)[]] => [
    `INSERT INTO users (id, email_normalized, full_name, created_at, whatsapp_optin_at, unsubscribed_at) VALUES (?, ?, 'N', ?, ?, ?)`,
    [id, `${id}@x.ma`, NOW, optin, unsub],
  ];

  it('colonnes TEXT nullables sur les deux moteurs, NULL par défaut', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`INSERT INTO users (id, email_normalized, full_name, created_at) VALUES ('u0', 'u0@x.ma', 'N', ?)`, [NOW]);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT whatsapp_optin_at, unsubscribed_at FROM users WHERE id = 'u0'`));
    expect(lite).toEqual([{ whatsapp_optin_at: null, unsubscribed_at: null }]);
    expect(pg).toEqual(lite);
    const columns = await client.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'users' AND column_name IN ('whatsapp_optin_at', 'unsubscribed_at') ORDER BY column_name`,
      [SCHEMA],
    );
    expect(columns.rows).toEqual([
      { column_name: 'unsubscribed_at', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'whatsapp_optin_at', data_type: 'text', is_nullable: 'YES' },
    ]);
    const liteColumns = all(openControlPlane(), `SELECT name, type, "notnull" AS not_null FROM pragma_table_info('users') WHERE name IN ('whatsapp_optin_at', 'unsubscribed_at') ORDER BY name`);
    expect(liteColumns).toEqual([
      { name: 'unsubscribed_at', type: 'TEXT', not_null: 0 },
      { name: 'whatsapp_optin_at', type: 'TEXT', not_null: 0 },
    ]);
  });

  it('horodatages UTC acceptés ; un format qui n\'est pas YYYY-MM-DDTHH:MM:SSZ refusé par CHECK sur les deux moteurs', async () => {
    const [sql, params] = insertUser('u1', NOW, '2026-11-14T08:00:00Z');
    for (const engine of dual.engines()) {
      await engine.run(sql, params);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT whatsapp_optin_at, unsubscribed_at FROM users WHERE id = 'u1'`));
    expect(lite).toEqual([{ whatsapp_optin_at: NOW, unsubscribed_at: '2026-11-14T08:00:00Z' }]);
    expect(pg).toEqual(lite);
    for (const [optin, unsub] of [['2026-11-13 10:00:00', null], [null, '1763028000']] as const) {
      const [badSql, badParams] = insertUser('u2', optin, unsub);
      const [liteFail, pgFail] = await dual.onBoth((e) => e.fail(badSql, badParams));
      expect(liteFail.message).toMatch(/CHECK constraint failed/);
      expect(pgFail.code).toBe(CHECK_VIOLATION);
    }
  });

  it('la colonne est modifiable (désinscription posée après l\'opt-in)', async () => {
    const [sql, params] = insertUser('u1', NOW, null);
    for (const engine of dual.engines()) {
      await engine.run(sql, params);
      await engine.run(`UPDATE users SET unsubscribed_at = '2026-12-01T00:00:00Z' WHERE id = 'u1'`);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT unsubscribed_at FROM users WHERE id = 'u1'`));
    expect(lite).toEqual([{ unsubscribed_at: '2026-12-01T00:00:00Z' }]);
    expect(pg).toEqual(lite);
  });
});

describe('7. mapping PostgreSQL 16 du plan de contrôle : INTEGER vers BIGINT, CHECK d\'entier strict retiré', () => {
  it('traduction déterministe : une instruction par instruction SQLite, sans INTEGER ni CAST', () => {
    for (const migration of CONTROL_PLANE_MIGRATIONS) {
      const statements = controlPlaneMigrationPostgresStatements(migration);
      expect(statements).toEqual(controlPlaneMigrationPostgresStatements(migration));
      expect(statements).toHaveLength(migration.upSqlStatements.length);
      expect(statements.join('\n')).not.toMatch(/\bINTEGER\b/);
      expect(statements.join('\n')).not.toMatch(/CAST\(/);
    }
  });

  it('les mêmes tables et les mêmes colonnes (ordre, nullité) existent dans le schéma temporaire PostgreSQL', async () => {
    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`, [SCHEMA]);
    expect(tables.rows.map((row: { table_name: string }) => row.table_name)).toEqual([...CONTROL_PLANE_TABLE_NAMES].sort());
    const sqlite = openControlPlane();
    for (const table of CONTROL_PLANE_TABLE_NAMES) {
      const pg = await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position', [SCHEMA, table]);
      const lite = all(sqlite, `SELECT name FROM pragma_table_info(?) ORDER BY cid`, table).map((row) => String(row['name']));
      expect(pg.rows.map((row: { column_name: string }) => row.column_name), table).toEqual(lite);
    }
  });

  it('aucune colonne numeric, real ou double precision ; seulement text et bigint ; toute colonne _cents est BIGINT', async () => {
    const types = await client.query('SELECT DISTINCT data_type FROM information_schema.columns WHERE table_schema = $1 ORDER BY data_type', [SCHEMA]);
    expect(types.rows.map((row: { data_type: string }) => row.data_type)).toEqual(['bigint', 'text']);
    const cents = await client.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND column_name ~ '_(cents|milli|micro)$'`,
      [SCHEMA],
    );
    expect(cents.rows.length).toBeGreaterThanOrEqual(8);
    for (const row of cents.rows as { table_name: string; column_name: string; data_type: string }[]) {
      expect(row.data_type, `${row.table_name}.${row.column_name}`).toBe('bigint');
    }
  });

  it('un capital social de plus de 2^31 centimes est accepté sur les deux moteurs (share_capital_cents)', async () => {
    const big = 5000000000;
    for (const engine of dual.engines()) {
      await engine.run(`INSERT INTO organizations (id, name, org_kind, ui_locale_policy, created_at) VALUES ('org-1', 'Org', 'DIRECT_BUSINESS', 'SIX_LOCALES_PME', ?)`, [NOW]);
      await engine.run(
        `INSERT INTO tenant_databases (company_id, organization_id, ice, identifiant_fiscal, raison_sociale_fr, legal_form, share_capital_cents, vat_regime, vat_cadence,
           d1_database_uuid, ingest_email_alias, created_at) VALUES ('co-1', 'org-1', '001234567000089', '12345678', 'Atlas', 'SA', ?, 'ENCAISSEMENT', 'MENSUELLE', 'd1-co-1', 'co-1@ingest.fisca.ma', ?)`,
        [big, NOW],
      );
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT share_capital_cents FROM tenant_databases`));
    expect(lite).toEqual([{ share_capital_cents: big }]);
    expect(pg).toEqual(lite);
  });

  it('un capital non entier (10.5 lié) est refusé : CHECK sous SQLite, type BIGINT (22P02) sous PostgreSQL', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`INSERT INTO organizations (id, name, org_kind, ui_locale_policy, created_at) VALUES ('org-1', 'Org', 'DIRECT_BUSINESS', 'SIX_LOCALES_PME', ?)`, [NOW]);
    }
    const sql = `INSERT INTO tenant_databases (company_id, organization_id, ice, identifiant_fiscal, raison_sociale_fr, legal_form, share_capital_cents, vat_regime, vat_cadence,
           d1_database_uuid, ingest_email_alias, created_at) VALUES ('co-1', 'org-1', '001234567000089', '12345678', 'Atlas', 'SA', ?, 'ENCAISSEMENT', 'MENSUELLE', 'd1-co-1', 'co-1@ingest.fisca.ma', ?)`;
    const [lite, pg] = await dual.onBoth((e) => e.fail(sql, [NON_INTEGER, NOW]));
    expect(lite.message).toMatch(/CHECK constraint failed/);
    expect(pg.code).toBe('22P02');
  });
});

describe('8. oauth_transactions.code_verifier en clair : durée de vie de 10 minutes au plus, purge des expirés', () => {
  const save = (state: string, expiresAt: string): [string, readonly (string | number)[]] => [CONTROL_PLANE_SQL.oauthTransactionSave, [state, 'nonce', 'verifier', 1, expiresAt]];

  function expectTtl(results: readonly [Failure, Failure]): void {
    expect(results[0].message).toBe(MSG_TTL);
    expect(results[1].message).toBe(MSG_TTL);
    expect(results[0].code).toBeNull();
    expect(results[1].code).toBe(RAISED);
  }

  it('la constante vaut 600 secondes', () => {
    expect(OAUTH_TRANSACTION_MAX_TTL_SEC).toBe(600);
  });

  it('expires_at à 590 s, à l\'instant, ou déjà passé : accepté sur les deux moteurs', async () => {
    for (const [index, expiresAt] of [isoIn(590), isoIn(0), '2020-01-01T00:00:00Z'].entries()) {
      const [sql, params] = save(`st-${index}`, expiresAt);
      for (const engine of dual.engines()) {
        await engine.run(sql, params);
      }
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows('SELECT COUNT(*) AS n FROM oauth_transactions'));
    expect(lite).toEqual([{ n: 3 }]);
    expect(pg).toEqual(lite);
  });

  it('expires_at à plus de 10 minutes de l\'insertion refusé, même texte ; aucune ligne écrite', async () => {
    for (const seconds of [700, 900, 86400]) {
      const [sql, params] = save('st-long', isoIn(seconds));
      expectTtl(await dual.onBoth((e) => e.fail(sql, params)));
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows('SELECT COUNT(*) AS n FROM oauth_transactions'));
    expect(lite).toEqual([{ n: 0 }]);
    expect(pg).toEqual(lite);
  });

  it('un horodatage mal formé reste refusé par le CHECK de forme, sur les deux moteurs (le trigger ne le masque pas)', async () => {
    for (const bad of ['2026-11-13 10:00:00', '1763028000']) {
      const [sql, params] = save('st-bad', bad);
      const [lite, pg] = await dual.onBoth((e) => e.fail(sql, params));
      expect(lite.message).toMatch(/CHECK constraint failed/);
      expect(pg.code).toBe(CHECK_VIOLATION);
    }
  });

  it('lecture-suppression atomique et purge des expirés fonctionnent sur les deux moteurs', async () => {
    for (const [state, expiresAt] of [['old', '2026-11-13T09:00:00Z'], ['new', isoIn(300)]] as const) {
      const [sql, params] = save(state, expiresAt);
      for (const engine of dual.engines()) {
        await engine.run(sql, params);
      }
    }
    for (const engine of dual.engines()) {
      await engine.run(CONTROL_PLANE_SQL.oauthTransactionPurgeExpired, [isoIn(0)]);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows('SELECT state FROM oauth_transactions'));
    expect(lite).toEqual([{ state: 'new' }]);
    expect(pg).toEqual(lite);
    const [liteTaken, pgTaken] = await dual.onBoth((e) => e.rows(CONTROL_PLANE_SQL.oauthTransactionConsume.replace('?', `'new'`)));
    expect(liteTaken).toHaveLength(1);
    expect(pgTaken).toHaveLength(1);
    const [liteAgain, pgAgain] = await dual.onBoth((e) => e.rows(CONTROL_PLANE_SQL.oauthTransactionConsume.replace('?', `'new'`)));
    expect(liteAgain).toEqual([]);
    expect(pgAgain).toEqual([]);
  });
});
