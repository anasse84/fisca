/**
 * Rolling Schema Migrator (Doc_06 § 10, CTR-COD-10) : applique de façon idempotente les migrations d'une base (société OU plan de
 * contrôle) et vérifie leur empreinte SHA-256 avant toute requête métier.
 *
 * Corrections appliquées au code de référence de Doc_06 § 10 :
 * - le migrateur ne dépend que de `TenantSqlDriver` (shared-types), jamais de `D1Database` ni d'un moteur ;
 * - la colonne s'appelle `sha256` (contrat du ticket T-S1B-06) et non `checksum_sha256` ;
 * - le message d'altération est celui de l'ERRATA section C : `Migration v${version} (${name}) altérée.` ;
 * - TOUTE la liste est validée avant la moindre exécution (versions 1…N contiguës, empreintes attendues exactes) ;
 * - une migration déjà appliquée dont l'empreinte stockée diffère de l'attendue est refusée, jamais ré-appliquée ;
 * - une migration appliquée mais absente de la liste, ou des versions appliquées non contiguës, sont refusées ;
 * - la course entre deux migrateurs (file de lots et JIT du middleware) est absorbée : la perdante, annulée atomiquement
 *   (clé primaire), relit l'état et constate que la version est déjà posée avec la même empreinte.
 *
 * Traduction PostgreSQL : choix = `options.statementsFor(migration)`. Le migrateur exécute les instructions que cette fonction
 * rend (par défaut le DDL SQLite de référence ; pour PostgreSQL `tenantMigrationPostgresStatements` ou
 * `controlPlaneMigrationPostgresStatements`), mais l'empreinte calculée, vérifiée et STOCKÉE est toujours celle de
 * `upSqlStatements` (DDL SQLite), donc identique sur les deux moteurs (ERRATA D-11). Le pilote reste ainsi agnostique.
 */
import { sha256Hex, type SqlStatementParams, type TenantSqlDriver } from '@fisca/shared-types';

export interface MigrationDefinition {
  readonly version: number;
  readonly name: string;
  readonly upSqlStatements: readonly string[];
  /** SHA-256 hexadécimal de `upSqlStatements.join("\n")`. */
  readonly expectedSha256Hex: string;
}

export type SchemaMigrationErrorCode =
  | 'SCHEMA_CHECKSUM_MISMATCH'
  | 'SCHEMA_MIGRATION_LIST_INVALID'
  | 'SCHEMA_APPLIED_UNKNOWN'
  | 'SCHEMA_APPLIED_NOT_CONTIGUOUS'
  | 'SCHEMA_APPLIED_NAME_MISMATCH';

/** Erreur typée du migrateur : le message commence par le code. */
export class SchemaMigrationError extends Error {
  readonly code: SchemaMigrationErrorCode;

  constructor(code: SchemaMigrationErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'SchemaMigrationError';
    this.code = code;
  }
}

export interface EnsureSchemaOptions<M extends MigrationDefinition = MigrationDefinition> {
  /** Instructions réellement exécutées (traduction PostgreSQL) ; même nombre d'instructions que `upSqlStatements`. */
  readonly statementsFor?: (migration: M) => readonly string[];
  /** Horloge injectée (ISO 8601 UTC) pour `applied_at`. */
  readonly nowIso?: () => string;
}

export const SCHEMA_MIGRATIONS_TABLE = '_fisca_schema_migrations' as const;

const CREATE_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

interface AppliedRow {
  readonly version: number;
  readonly name: string;
  readonly sha256: string;
}

function altered(migration: MigrationDefinition): SchemaMigrationError {
  return new SchemaMigrationError('SCHEMA_CHECKSUM_MISMATCH', `Migration v${migration.version} (${migration.name}) altérée.`);
}

function invalidList(detail: string): SchemaMigrationError {
  return new SchemaMigrationError('SCHEMA_MIGRATION_LIST_INVALID', detail);
}

async function sha256OfStatements(statements: readonly string[]): Promise<string> {
  return sha256Hex(new TextEncoder().encode(statements.join('\n')));
}

/** Validation statique, sans aucun accès au moteur. */
async function validateList<M extends MigrationDefinition>(
  migrations: readonly M[],
  statementsFor: (migration: M) => readonly string[],
): Promise<void> {
  for (const [position, migration] of migrations.entries()) {
    const expectedVersion = position + 1;
    if (!Number.isSafeInteger(migration.version) || migration.version !== expectedVersion) {
      throw invalidList(
        `versions attendues 1…N contiguës, croissantes, sans doublon : rang ${expectedVersion}, version reçue ${String(migration.version)}.`,
      );
    }
    if (migration.name.trim().length === 0) {
      throw invalidList(`la migration v${migration.version} n'a pas de nom.`);
    }
    if (migration.upSqlStatements.length === 0 || migration.upSqlStatements.some((sql) => sql.trim().length === 0)) {
      throw invalidList(`la migration v${migration.version} (${migration.name}) n'a aucune instruction ou une instruction vide.`);
    }
    if (statementsFor(migration).length !== migration.upSqlStatements.length) {
      throw invalidList(
        `statementsFor de v${migration.version} (${migration.name}) doit rendre autant d'instructions que upSqlStatements.`,
      );
    }
    if ((await sha256OfStatements(migration.upSqlStatements)) !== migration.expectedSha256Hex) {
      throw altered(migration);
    }
  }
}

async function readApplied(db: TenantSqlDriver): Promise<AppliedRow[]> {
  const rows = await db.query<{ version: number | string; name: string; sha256: string }>({
    sql: `SELECT version, name, sha256 FROM ${SCHEMA_MIGRATIONS_TABLE} ORDER BY version`,
    params: [],
  });
  return rows.map((row) => ({ version: Number(row.version), name: row.name, sha256: row.sha256 }));
}

/** Les versions appliquées forment 1…k, existent toutes dans la liste, avec le même nom et la même empreinte. */
function verifyApplied(applied: readonly AppliedRow[], migrations: readonly MigrationDefinition[]): number {
  for (const [position, row] of applied.entries()) {
    if (row.version !== position + 1) {
      throw new SchemaMigrationError(
        'SCHEMA_APPLIED_NOT_CONTIGUOUS',
        `versions appliquées non contiguës : v${position + 1} attendue, v${row.version} trouvée.`,
      );
    }
  }
  for (const row of applied) {
    const migration = migrations.find((candidate) => candidate.version === row.version);
    if (!migration) {
      throw new SchemaMigrationError(
        'SCHEMA_APPLIED_UNKNOWN',
        `la migration v${row.version} (${row.name}) est appliquée mais absente de la liste fournie.`,
      );
    }
    if (migration.name !== row.name) {
      throw new SchemaMigrationError(
        'SCHEMA_APPLIED_NAME_MISMATCH',
        `la migration v${row.version} est enregistrée sous le nom « ${row.name} » et attendue sous « ${migration.name} ».`,
      );
    }
    if (row.sha256 !== migration.expectedSha256Hex) {
      throw altered(migration);
    }
  }
  return applied.length;
}

/**
 * @param controlDb plan de contrôle dont `tenant_databases.schema_version` est mis à jour quand au moins une migration a été
 *   appliquée ; `null` pour migrer le plan de contrôle lui-même (ou une base sans routage). Une société absente de
 *   `tenant_databases` n'est pas une erreur du migrateur (son schéma est correct) : le routage relève du provisionnement.
 * @param tenantDb base à migrer.
 * @param companyId société (clé de `tenant_databases`) ; ignoré si `controlDb` est `null`.
 */
export async function ensureTenantSchemaUpToDate<M extends MigrationDefinition>(
  controlDb: TenantSqlDriver | null,
  tenantDb: TenantSqlDriver,
  companyId: string,
  migrations: readonly M[],
  options: EnsureSchemaOptions<M> = {},
): Promise<{ readonly currentVersion: number; readonly appliedCount: number }> {
  const statementsFor = options.statementsFor ?? ((migration: M): readonly string[] => migration.upSqlStatements);
  const nowIso = options.nowIso ?? ((): string => new Date().toISOString());

  await validateList(migrations, statementsFor);
  await tenantDb.executeBatchAtomically([{ sql: CREATE_MIGRATIONS_TABLE, params: [] }]);

  let currentVersion = verifyApplied(await readApplied(tenantDb), migrations);
  let appliedCount = 0;

  for (const migration of migrations.filter((candidate) => candidate.version > currentVersion)) {
    const batch: SqlStatementParams[] = [
      ...statementsFor(migration).map((sql): SqlStatementParams => ({ sql, params: [] })),
      {
        sql: `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (version, name, sha256, applied_at) VALUES (?, ?, ?, ?)`,
        params: [migration.version, migration.name, migration.expectedSha256Hex, nowIso()],
      },
    ];
    try {
      await tenantDb.executeBatchAtomically(batch);
      appliedCount += 1;
    } catch (error) {
      // Course : un autre migrateur a posé cette version entre notre lecture et notre lot (annulé atomiquement).
      const applied = await readApplied(tenantDb);
      const winner = applied.find((row) => row.version === migration.version);
      if (!winner) {
        throw error;
      }
      verifyApplied(applied, migrations);
    }
    currentVersion = migration.version;
  }

  if (appliedCount > 0 && controlDb !== null) {
    await controlDb.executeBatchAtomically([
      { sql: 'UPDATE tenant_databases SET schema_version = ? WHERE company_id = ?', params: [currentVersion, companyId] },
    ]);
  }
  return { currentVersion, appliedCount };
}
