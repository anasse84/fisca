import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InfrastructureError,
  type BatchResult,
  type SqlStatementParams,
  type TenantSqlDriver,
} from '@fisca/shared-types';
import {
  CONTROL_PLANE_MIGRATIONS,
  CONTROL_PLANE_TABLE_NAMES,
  TENANT_MIGRATIONS,
  TENANT_POSTGRES_TRIGGER_NAMES,
  TENANT_TABLE_NAMES,
  TENANT_TRIGGER_NAMES,
  controlPlaneMigrationPostgresStatements,
  createD1TenantDriver,
  ensureTenantSchemaUpToDate,
  tenantMigrationPostgresStatements,
  SchemaMigrationError,
  type MigrationDefinition,
  type TenantMigration,
} from '../src/index.ts';
import { FakeD1Database } from './fake-d1.ts';
import { PgSandbox } from './pg-sandbox.ts';

const MIGRATIONS_TABLE = '_fisca_schema_migrations';
const ALTERED = (version: number, name: string): string => `SCHEMA_CHECKSUM_MISMATCH: Migration v${version} (${name}) altérée.`;

function sha(statements: readonly string[]): string {
  return createHash('sha256').update(statements.join('\n'), 'utf8').digest('hex');
}

function migration(version: number, name: string, upSqlStatements: readonly string[]): MigrationDefinition {
  return { version, name, upSqlStatements, expectedSha256Hex: sha(upSqlStatements) };
}

/** Compte les appels : prouve « avant toute exécution » et « no-op ». */
class CountingDriver implements TenantSqlDriver {
  batches = 0;
  queries = 0;
  constructor(private readonly inner: TenantSqlDriver) {}
  get tenantId(): string {
    return this.inner.tenantId;
  }
  get calls(): number {
    return this.batches + this.queries;
  }
  query<TRow>(stmt: SqlStatementParams): Promise<readonly TRow[]> {
    this.queries += 1;
    return this.inner.query<TRow>(stmt);
  }
  executeBatchAtomically(statements: readonly SqlStatementParams[]): Promise<BatchResult> {
    this.batches += 1;
    return this.inner.executeBatchAtomically(statements);
  }
}

interface Backend {
  readonly name: 'sqlite' | 'postgres';
  fresh(): Promise<TenantSqlDriver>;
  tenantStatements(m: (typeof TENANT_MIGRATIONS)[number]): readonly string[];
  controlStatements(m: (typeof CONTROL_PLANE_MIGRATIONS)[number]): readonly string[];
  tables(driver: TenantSqlDriver): Promise<string[]>;
  triggers(driver: TenantSqlDriver): Promise<string[]>;
  expectedTriggers: readonly string[];
}

const pgSandbox = new PgSandbox();

beforeAll(async () => {
  await pgSandbox.open();
});

afterAll(async () => {
  await pgSandbox.close();
});

async function names(driver: TenantSqlDriver, sql: string): Promise<string[]> {
  return (await driver.query<{ name: string }>({ sql, params: [] })).map((row) => row.name);
}

const BACKENDS: readonly Backend[] = [
  {
    name: 'sqlite',
    fresh: async () => createD1TenantDriver('soc-test', new FakeD1Database()),
    tenantStatements: (m) => m.upSqlStatements,
    controlStatements: (m) => m.upSqlStatements,
    tables: (d) => names(d, `SELECT name FROM sqlite_master WHERE type = 'table'`),
    triggers: (d) => names(d, `SELECT name FROM sqlite_master WHERE type = 'trigger'`),
    expectedTriggers: TENANT_TRIGGER_NAMES,
  },
  {
    name: 'postgres',
    fresh: async () => {
      await pgSandbox.reset();
      return pgSandbox.driver('soc-test');
    },
    tenantStatements: tenantMigrationPostgresStatements,
    controlStatements: controlPlaneMigrationPostgresStatements,
    tables: (d) => names(d, `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()`),
    triggers: (d) =>
      names(
        d,
        `SELECT t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND NOT t.tgisinternal`,
      ),
    expectedTriggers: TENANT_POSTGRES_TRIGGER_NAMES,
  },
];

interface StoredRow {
  version: number;
  name: string;
  sha256: string;
  applied_at: string;
}

async function stored(driver: TenantSqlDriver): Promise<StoredRow[]> {
  return [
    ...(await driver.query<StoredRow>({
      sql: `SELECT version, name, sha256, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY version`,
      params: [],
    })),
  ];
}

async function rejection(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('Une erreur était attendue.');
}

describe.each(BACKENDS)('ensureTenantSchemaUpToDate sur $name', (backend) => {
  const tenantOptions = { statementsFor: backend.tenantStatements };

  it('applique de zéro les 5 migrations tenant (triggers BEGIN…END compris) et enregistre l\'empreinte du DDL SQLite', async () => {
    const driver = await backend.fresh();
    const result = await ensureTenantSchemaUpToDate(null, driver, 'soc-test', TENANT_MIGRATIONS, tenantOptions);
    expect(result).toEqual({ currentVersion: 5, appliedCount: 5 });
    const rows = await stored(driver);
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.name)).toEqual(TENANT_MIGRATIONS.map((m) => m.name));
    expect(rows.map((r) => r.sha256)).toEqual(TENANT_MIGRATIONS.map((m) => m.expectedSha256Hex));
    expect(rows.every((r) => !Number.isNaN(Date.parse(r.applied_at)))).toBe(true);
    const tables = await backend.tables(driver);
    for (const table of TENANT_TABLE_NAMES) {
      expect(tables, table).toContain(table);
    }
    const triggers = await backend.triggers(driver);
    expect(backend.expectedTriggers.length).toBeGreaterThan(0);
    for (const trigger of backend.expectedTriggers) {
      expect(triggers, trigger).toContain(trigger);
    }
  });

  it('deux appels successifs : le second est un no-op (une seule lecture, aucune migration)', async () => {
    const driver = new CountingDriver(await backend.fresh());
    await ensureTenantSchemaUpToDate(null, driver, 'soc-test', TENANT_MIGRATIONS, tenantOptions);
    const before = await stored(driver);
    driver.batches = 0;
    const second = await ensureTenantSchemaUpToDate(null, driver, 'soc-test', TENANT_MIGRATIONS, tenantOptions);
    expect(second).toEqual({ currentVersion: 5, appliedCount: 0 });
    expect(driver.batches).toBe(1); // CREATE TABLE IF NOT EXISTS seulement
    expect(await stored(driver)).toEqual(before);
  });

  it('reprise après arrêt à mi-chemin : versions 1-3 déjà appliquées, puis seulement 4-5', async () => {
    const driver = await backend.fresh();
    const first = await ensureTenantSchemaUpToDate(null, driver, 'soc-test', TENANT_MIGRATIONS.slice(0, 3), tenantOptions);
    expect(first).toEqual({ currentVersion: 3, appliedCount: 3 });
    const early = await stored(driver);
    const resumed = await ensureTenantSchemaUpToDate(null, driver, 'soc-test', TENANT_MIGRATIONS, tenantOptions);
    expect(resumed).toEqual({ currentVersion: 5, appliedCount: 2 });
    const rows = await stored(driver);
    expect(rows.slice(0, 3)).toEqual(early);
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5]);
  });

  it('empreinte stockée altérée : refus avec le message exact de l\'ERRATA C, sans ré-application', async () => {
    const driver = await backend.fresh();
    await ensureTenantSchemaUpToDate(null, driver, 'soc-test', TENANT_MIGRATIONS, tenantOptions);
    const before = await stored(driver);
    await driver.executeBatchAtomically([
      { sql: `UPDATE ${MIGRATIONS_TABLE} SET sha256 = ? WHERE version = ?`, params: ['0'.repeat(64), 2] },
    ]);
    const error = await rejection(() => ensureTenantSchemaUpToDate(null, driver, 'soc-test', TENANT_MIGRATIONS, tenantOptions));
    expect(error).toBeInstanceOf(SchemaMigrationError);
    expect((error as SchemaMigrationError).code).toBe('SCHEMA_CHECKSUM_MISMATCH');
    expect((error as SchemaMigrationError).message).toBe(ALTERED(2, TENANT_MIGRATIONS[1]?.name ?? ''));
    const after = await stored(driver);
    expect(after.map((r) => r.applied_at)).toEqual(before.map((r) => r.applied_at));
    expect(after.filter((r) => r.version !== 2)).toEqual(before.filter((r) => r.version !== 2));
  });

  it('migration appliquée puis modifiée dans le code (nouvelle empreinte attendue) : refus, jamais de ré-application', async () => {
    const driver = await backend.fresh();
    const original = migration(1, 'creer_a', ['CREATE TABLE alpha (id INTEGER PRIMARY KEY)']);
    await ensureTenantSchemaUpToDate(null, driver, 'soc-test', [original]);
    const edited = migration(1, 'creer_a', ['CREATE TABLE alpha (id INTEGER PRIMARY KEY, extra TEXT)']);
    const error = await rejection(() => ensureTenantSchemaUpToDate(null, driver, 'soc-test', [edited]));
    expect((error as SchemaMigrationError).message).toBe(ALTERED(1, 'creer_a'));
    expect(await backend.tables(driver)).toContain('alpha');
    expect((await stored(driver))[0]?.sha256).toBe(original.expectedSha256Hex);
  });

  it('expectedSha256Hex fautif : refusé avant toute exécution (aucun appel au pilote)', async () => {
    const driver = new CountingDriver(await backend.fresh());
    const faulty: TenantMigration[] = TENANT_MIGRATIONS.map((m, index) =>
      index === 2 ? { ...m, expectedSha256Hex: 'f'.repeat(64) } : m,
    );
    const error = await rejection(() => ensureTenantSchemaUpToDate(null, driver, 'soc-test', faulty, tenantOptions));
    expect(error).toBeInstanceOf(SchemaMigrationError);
    expect((error as SchemaMigrationError).code).toBe('SCHEMA_CHECKSUM_MISMATCH');
    expect((error as SchemaMigrationError).message).toBe(ALTERED(3, TENANT_MIGRATIONS[2]?.name ?? ''));
    expect(driver.calls).toBe(0);
    expect(await backend.tables(driver)).not.toContain(MIGRATIONS_TABLE);
  });

  it.each([
    ['version manquante (1, 3)', [migration(1, 'a', ['CREATE TABLE t1 (id INTEGER)']), migration(3, 'c', ['CREATE TABLE t3 (id INTEGER)'])]],
    ['version dupliquée (1, 1)', [migration(1, 'a', ['CREATE TABLE t1 (id INTEGER)']), migration(1, 'b', ['CREATE TABLE t2 (id INTEGER)'])]],
    ['versions qui reculent (2, 1)', [migration(2, 'b', ['CREATE TABLE t2 (id INTEGER)']), migration(1, 'a', ['CREATE TABLE t1 (id INTEGER)'])]],
    ['liste qui ne commence pas à 1', [migration(2, 'b', ['CREATE TABLE t2 (id INTEGER)'])]],
    ['version non entière', [migration(1.5, 'a', ['CREATE TABLE t1 (id INTEGER)'])]],
    ['migration sans instruction', [migration(1, 'a', [])]],
    ['migration sans nom', [migration(1, ' ', ['CREATE TABLE t1 (id INTEGER)'])]],
  ])('liste invalide, refusée de façon typée avant toute exécution : %s', async (_label, list) => {
    const driver = new CountingDriver(await backend.fresh());
    const error = await rejection(() => ensureTenantSchemaUpToDate(null, driver, 'soc-test', list));
    expect(error).toBeInstanceOf(SchemaMigrationError);
    expect((error as SchemaMigrationError).code).toBe('SCHEMA_MIGRATION_LIST_INVALID');
    expect(driver.calls).toBe(0);
  });

  it('statementsFor qui change le nombre d\'instructions : refusé avant toute exécution', async () => {
    const driver = new CountingDriver(await backend.fresh());
    const error = await rejection(() =>
      ensureTenantSchemaUpToDate(null, driver, 'soc-test', TENANT_MIGRATIONS, { statementsFor: (m) => m.upSqlStatements.slice(1) }),
    );
    expect((error as SchemaMigrationError).code).toBe('SCHEMA_MIGRATION_LIST_INVALID');
    expect(driver.calls).toBe(0);
  });

  it('migration appliquée mais absente de la liste : refus typé', async () => {
    const driver = await backend.fresh();
    await ensureTenantSchemaUpToDate(null, driver, 'soc-test', TENANT_MIGRATIONS.slice(0, 3), tenantOptions);
    const error = await rejection(() =>
      ensureTenantSchemaUpToDate(null, driver, 'soc-test', TENANT_MIGRATIONS.slice(0, 2), tenantOptions),
    );
    expect(error).toBeInstanceOf(SchemaMigrationError);
    expect((error as SchemaMigrationError).code).toBe('SCHEMA_APPLIED_UNKNOWN');
    expect((error as SchemaMigrationError).message).toContain('v3');
  });

  it('versions appliquées non contiguës en base : refus typé', async () => {
    const driver = await backend.fresh();
    await ensureTenantSchemaUpToDate(null, driver, 'soc-test', TENANT_MIGRATIONS.slice(0, 1), tenantOptions);
    await driver.executeBatchAtomically([
      {
        sql: `INSERT INTO ${MIGRATIONS_TABLE} (version, name, sha256, applied_at) VALUES (?, ?, ?, ?)`,
        params: [4, TENANT_MIGRATIONS[3]?.name ?? '', TENANT_MIGRATIONS[3]?.expectedSha256Hex ?? '', '2026-11-13T10:00:00.000Z'],
      },
    ]);
    const error = await rejection(() => ensureTenantSchemaUpToDate(null, driver, 'soc-test', TENANT_MIGRATIONS, tenantOptions));
    expect((error as SchemaMigrationError).code).toBe('SCHEMA_APPLIED_NOT_CONTIGUOUS');
  });

  it('nom stocké différent du nom attendu : refus typé', async () => {
    const driver = await backend.fresh();
    await ensureTenantSchemaUpToDate(null, driver, 'soc-test', [migration(1, 'creer_a', ['CREATE TABLE alpha (id INTEGER PRIMARY KEY)'])]);
    const error = await rejection(() =>
      ensureTenantSchemaUpToDate(null, driver, 'soc-test', [migration(1, 'autre_nom', ['CREATE TABLE alpha (id INTEGER PRIMARY KEY)'])]),
    );
    expect((error as SchemaMigrationError).code).toBe('SCHEMA_APPLIED_NAME_MISMATCH');
  });

  it('atomicité : une migration dont la 3e instruction échoue n\'enregistre rien et ne laisse aucune table', async () => {
    const driver = await backend.fresh();
    const broken = migration(1, 'cassee', [
      'CREATE TABLE gamma_a (id INTEGER PRIMARY KEY)',
      'CREATE TABLE gamma_b (id INTEGER PRIMARY KEY)',
      'INSERT INTO table_inexistante (id) VALUES (1)',
    ]);
    const error = await rejection(() => ensureTenantSchemaUpToDate(null, driver, 'soc-test', [broken]));
    expect(error).toBeInstanceOf(InfrastructureError);
    expect((error as InfrastructureError).code).toBe('INFRA_BATCH_ROLLED_BACK');
    expect(await stored(driver)).toEqual([]);
    const tables = await backend.tables(driver);
    expect(tables).not.toContain('gamma_a');
    expect(tables).not.toContain('gamma_b');
    // la migration corrigée (même version) s'applique ensuite normalement
    const fixed = migration(1, 'cassee', ['CREATE TABLE gamma_a (id INTEGER PRIMARY KEY)', 'CREATE TABLE gamma_b (id INTEGER PRIMARY KEY)']);
    expect(await ensureTenantSchemaUpToDate(null, driver, 'soc-test', [fixed])).toEqual({ currentVersion: 1, appliedCount: 1 });
  });

  it('plan de contrôle v1→v4 : tables créées, no-op au second appel', async () => {
    const driver = await backend.fresh();
    const options = { statementsFor: backend.controlStatements };
    const first = await ensureTenantSchemaUpToDate(null, driver, 'control-plane', CONTROL_PLANE_MIGRATIONS, options);
    expect(first).toEqual({ currentVersion: 4, appliedCount: 4 });
    expect((await stored(driver)).map((r) => r.sha256)).toEqual(CONTROL_PLANE_MIGRATIONS.map((m) => m.expectedSha256Hex));
    const tables = await backend.tables(driver);
    for (const table of CONTROL_PLANE_TABLE_NAMES) {
      expect(tables, table).toContain(table);
    }
    expect(await ensureTenantSchemaUpToDate(null, driver, 'control-plane', CONTROL_PLANE_MIGRATIONS, options)).toEqual({
      currentVersion: 4,
      appliedCount: 0,
    });
  });

  it('plan de contrôle : une v4 (trigger compris) dont la dernière instruction échoue est annulée en bloc', async () => {
    const driver = await backend.fresh();
    const bad = 'INSERT INTO table_inexistante (id) VALUES (1)';
    const [m1, m2, m3, m4] = CONTROL_PLANE_MIGRATIONS;
    if (!m1 || !m2 || !m3 || !m4) {
      throw new Error('4 migrations du plan de contrôle attendues');
    }
    const broken: MigrationDefinition = migration(4, m4.name, [...m4.upSqlStatements, bad]);
    const error = await rejection(() =>
      ensureTenantSchemaUpToDate(null, driver, 'control-plane', [m1, m2, m3, broken], {
        statementsFor: (m) => (m.version === 4 ? [...backend.controlStatements(m4), bad] : backend.controlStatements(CONTROL_PLANE_MIGRATIONS[m.version - 1] ?? m4)),
      }),
    );
    expect((error as InfrastructureError).code).toBe('INFRA_BATCH_ROLLED_BACK');
    expect((await stored(driver)).map((r) => r.version)).toEqual([1, 2, 3]);
    for (const trigger of m4.triggerNames ?? []) {
      expect(await backend.triggers(driver), trigger).not.toContain(trigger);
    }
  });

  it('met à jour tenant_databases.schema_version seulement quand une migration a été appliquée', async () => {
    const control = await backend.fresh();
    await control.executeBatchAtomically([
      { sql: 'CREATE TABLE tenant_databases (company_id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL)', params: [] },
      { sql: 'INSERT INTO tenant_databases (company_id, schema_version) VALUES (?, ?)', params: ['soc-1', 1] },
    ]);
    const tenant = createD1TenantDriver('soc-1', new FakeD1Database());
    // la base société est un SQLite de test ; seul le plan de contrôle (control) change de moteur
    await ensureTenantSchemaUpToDate(control, tenant, 'soc-1', TENANT_MIGRATIONS.slice(0, 2));
    const version = async (): Promise<number> =>
      Number((await control.query<{ schema_version: number | string }>({ sql: 'SELECT schema_version FROM tenant_databases WHERE company_id = ?', params: ['soc-1'] }))[0]?.schema_version);
    expect(await version()).toBe(2);
    await control.executeBatchAtomically([{ sql: 'UPDATE tenant_databases SET schema_version = ? WHERE company_id = ?', params: [99, 'soc-1'] }]);
    await ensureTenantSchemaUpToDate(control, tenant, 'soc-1', TENANT_MIGRATIONS.slice(0, 2));
    expect(await version()).toBe(99);
    await ensureTenantSchemaUpToDate(control, tenant, 'soc-1', TENANT_MIGRATIONS.slice(0, 3));
    expect(await version()).toBe(3);
  });
});

describe('ensureTenantSchemaUpToDate : concurrence', () => {
  it('deux migrateurs simultanés sur la même base convergent sans erreur ni double application', async () => {
    const db = new FakeD1Database();
    const a = createD1TenantDriver('soc-test', db);
    const b = createD1TenantDriver('soc-test', db);
    const [ra, rb] = await Promise.all([
      ensureTenantSchemaUpToDate(null, a, 'soc-test', TENANT_MIGRATIONS),
      ensureTenantSchemaUpToDate(null, b, 'soc-test', TENANT_MIGRATIONS),
    ]);
    expect(ra.currentVersion).toBe(5);
    expect(rb.currentVersion).toBe(5);
    expect(ra.appliedCount + rb.appliedCount).toBe(5);
    expect((await stored(a)).map((r) => r.version)).toEqual([1, 2, 3, 4, 5]);
  });
});
