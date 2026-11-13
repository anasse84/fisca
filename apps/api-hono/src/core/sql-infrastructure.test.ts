import { describe, expect, it } from 'vitest';
import { TENANT_MIGRATIONS } from '@fisca/db-schema';
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike, PgConnectionSource, PgPoolClientLike, PgQueryResultLike } from '@fisca/db-schema';
import { InfrastructureError, type InfrastructureProviderMode, type TenantSqlDriver } from '@fisca/shared-types';
import { SqlInfrastructure, type TenantDatabaseRoute, type TenantStorageDriver } from './sql-infrastructure.ts';

/** Instruction D1 de test : porte son SQL et ses valeurs liées, que batch() relit. */
class ScriptedStatement implements D1PreparedStatementLike {
  constructor(
    private readonly db: ScriptedD1,
    readonly sql: string,
    readonly values: readonly unknown[],
  ) {}

  bind(...values: unknown[]): ScriptedStatement {
    return new ScriptedStatement(this.db, this.sql, values);
  }

  async all<T>(): Promise<D1ResultLike<T>> {
    this.db.prepared.push({ sql: this.sql, values: this.values });
    return { success: true, results: this.db.respond(this.sql, this.values) as readonly T[], meta: { changes: 0 } };
  }

  async run<T>(): Promise<D1ResultLike<T>> {
    return { success: true, results: [], meta: { changes: 0 } };
  }
}

/** D1 de test scripté : renvoie des lignes selon le SQL, enregistre ce qui est exécuté. */
class ScriptedD1 implements D1DatabaseLike {
  readonly prepared: { sql: string; values: readonly unknown[] }[] = [];
  readonly batches: { sql: string; values: readonly unknown[] }[][] = [];
  constructor(readonly respond: (sql: string, values: readonly unknown[]) => readonly Record<string, unknown>[] = () => []) {}

  prepare(query: string): ScriptedStatement {
    return new ScriptedStatement(this, query, []);
  }

  async batch(statements: D1PreparedStatementLike[]): Promise<readonly D1ResultLike<unknown>[]> {
    this.batches.push(
      statements.map((statement) => {
        if (!(statement instanceof ScriptedStatement)) {
          throw new Error('instruction étrangère');
        }
        return { sql: statement.sql, values: statement.values };
      }),
    );
    return statements.map(() => ({ success: true, results: [], meta: { changes: 0 } }));
  }
}

class RecordingPg implements PgPoolClientLike {
  readonly texts: string[] = [];
  readonly values: (unknown[] | undefined)[] = [];
  async query(text: string, values?: unknown[]): Promise<PgQueryResultLike> {
    this.texts.push(text);
    this.values.push(values);
    return { rows: [], rowCount: 0, command: 'SELECT' };
  }
  release(): void {}
}

function controlPlaneWith(routes: readonly { company_id: string; d1_database_uuid: string; storage_driver: string }[]): {
  d1: ScriptedD1;
  driver: TenantSqlDriver;
} {
  const d1 = new ScriptedD1((sql, values) => (sql.includes('FROM tenant_databases') ? routes.filter((r) => r.company_id === values[0]) : []));
  return { d1, driver: { tenantId: 'control-plane', query: async <T>(stmt: { sql: string; params: readonly (string | number | null)[] }) => (await d1.prepare(stmt.sql).bind(...stmt.params).all<T>()).results ?? [], executeBatchAtomically: async () => ({ totalChanges: 0 }) } };
}

function build(mode: InfrastructureProviderMode, storage: TenantStorageDriver = 'CLOUDFLARE_D1_EU') {
  const control = controlPlaneWith([{ company_id: 'soc-a', d1_database_uuid: 'uuid-a', storage_driver: storage }]);
  const d1 = new ScriptedD1();
  const pg = new RecordingPg();
  const opened: { kind: string; route: TenantDatabaseRoute }[] = [];
  const infra = new SqlInfrastructure({
    providerMode: mode,
    controlPlane: { driver: control.driver, engine: 'sqlite' },
    openers: {
      openD1: (route) => {
        opened.push({ kind: 'd1', route });
        return d1;
      },
      openPostgres: (route): PgConnectionSource => {
        opened.push({ kind: 'pg', route });
        return { connect: async () => pg };
      },
    },
    nowIso: () => '2026-11-13T10:00:00.000Z',
  });
  return { infra, control, d1, pg, opened };
}

async function failure(action: () => Promise<unknown>): Promise<InfrastructureError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof InfrastructureError) {
      return error;
    }
    throw error;
  }
  throw new Error('InfrastructureError attendue');
}

describe('SqlInfrastructure (composition SQL, D-16)', () => {
  it('CLOUDFLARE_EDGE + CLOUDFLARE_D1_EU : base D1 résolue côté serveur, companyId lié en paramètre', async () => {
    const { infra, control, opened } = build('CLOUDFLARE_EDGE');
    const driver = await infra.getTenantDb('soc-a');
    expect(driver.tenantId).toBe('soc-a');
    expect(opened).toEqual([{ kind: 'd1', route: { companyId: 'soc-a', d1DatabaseUuid: 'uuid-a', storageDriver: 'CLOUDFLARE_D1_EU' } }]);
    expect(control.d1.prepared[0]?.sql).toContain('WHERE company_id = ?');
    expect(control.d1.prepared[0]?.values).toEqual(['soc-a']);
    expect(infra.getControlPlaneDb().tenantId).toBe('control-plane');
  });

  it('CLOUDFLARE_EDGE + HYPERDRIVE_MAROC_PG : pilote PostgreSQL', async () => {
    const { infra, opened } = build('CLOUDFLARE_EDGE', 'HYPERDRIVE_MAROC_PG');
    await infra.getTenantDb('soc-a');
    expect(opened.map((o) => o.kind)).toEqual(['pg']);
  });

  it('SOVEREIGN_MOROCCO_VPS : toujours PostgreSQL, D1 jamais ouvert, même pour une route D1', async () => {
    const { infra, opened } = build('SOVEREIGN_MOROCCO_VPS', 'CLOUDFLARE_D1_EU');
    await infra.getTenantDb('soc-a');
    expect(opened.map((o) => o.kind)).toEqual(['pg']);
  });

  it('société inconnue : INFRA_TENANT_NOT_FOUND ; identifiant invalide ou control-plane : INFRA_INVALID_COMPANY_ID, sans lecture', async () => {
    const { infra, control } = build('CLOUDFLARE_EDGE');
    expect((await failure(() => infra.getTenantDb('soc-inconnue'))).code).toBe('INFRA_TENANT_NOT_FOUND');
    const reads = control.d1.prepared.length;
    for (const bad of ['', '../x', 'a b', 'control-plane', "x' OR '1'='1"]) {
      expect((await failure(() => infra.getTenantDb(bad))).code).toBe('INFRA_INVALID_COMPANY_ID');
    }
    expect(control.d1.prepared.length).toBe(reads);
  });

  it('route avec storage_driver inconnu : refusée', async () => {
    const control = controlPlaneWith([{ company_id: 'soc-b', d1_database_uuid: 'u', storage_driver: 'MONGO' }]);
    const infra = new SqlInfrastructure({
      providerMode: 'CLOUDFLARE_EDGE',
      controlPlane: { driver: control.driver, engine: 'sqlite' },
      openers: { openD1: () => new ScriptedD1(), openPostgres: () => ({ connect: async () => new RecordingPg() }) },
    });
    expect((await failure(() => infra.getTenantDb('soc-b'))).code).toBe('INFRA_TENANT_NOT_FOUND');
  });

  it('getTenantDbUpToDate sur D1 : applique toutes les migrations du catalogue en DDL SQLite avec l\'empreinte de référence', async () => {
    const { infra, d1 } = build('CLOUDFLARE_EDGE');
    await infra.getTenantDbUpToDate('soc-a');
    // 1 lot de création de la table de suivi + une transaction par migration du catalogue
    expect(d1.batches).toHaveLength(TENANT_MIGRATIONS.length + 1);
    const lastOfEach = d1.batches.slice(1).map((batch) => batch[batch.length - 1]);
    expect(lastOfEach.map((s) => s?.values[2])).toEqual(TENANT_MIGRATIONS.map((m) => m.expectedSha256Hex));
    expect(d1.batches[1]?.map((s) => s.sql).slice(0, -1)).toEqual(TENANT_MIGRATIONS[0]?.upSqlStatements);
  });

  it('getTenantDbUpToDate sur PostgreSQL : DDL traduit (BIGINT), empreinte toujours celle du DDL SQLite', async () => {
    const { infra, pg } = build('SOVEREIGN_MOROCCO_VPS');
    await infra.getTenantDbUpToDate('soc-a');
    expect(pg.texts.some((t) => /\bBIGINT\b/.test(t))).toBe(true);
    const inserts = pg.texts.map((t, i) => ({ t, v: pg.values[i] })).filter((e) => e.t.startsWith('INSERT INTO _fisca_schema_migrations'));
    expect(inserts.map((e) => e.v?.[2])).toEqual(TENANT_MIGRATIONS.map((m) => m.expectedSha256Hex));
    expect(pg.texts.filter((t) => t === 'BEGIN')).toHaveLength(TENANT_MIGRATIONS.length + 1);
    expect(pg.texts.filter((t) => t === 'COMMIT')).toHaveLength(TENANT_MIGRATIONS.length + 1);
  });
});
