/**
 * Socle commun des Durable Objects SQLite de Fisca (Doc_04 § 06, Doc_06 § 07).
 *
 * Aucune dépendance à `cloudflare:workers` ni à `@cloudflare/workers-types` : les classes s'écrivent contre les interfaces
 * structurelles minimales ci-dessous (`DurableObjectStateLike`, `SqlStorageLike`). Leur forme est celle des signatures publiées
 * de `ctx.storage.sql.exec`, `ctx.storage.transactionSync`, `ctx.blockConcurrencyWhile` et `ctx.id.name`
 * (voir `durable-object-types.test.ts`, qui prouve qu'une forme réelle y est assignable).
 *
 * Règles reprises de la documentation Cloudflare :
 * - un curseur se consomme entièrement et de façon synchrone (`toArray()`), jamais à travers un `await` ;
 * - `sql.exec` refuse BEGIN / SAVEPOINT : toute atomicité passe par `transactionSync`, dont le rappel est synchrone ;
 * - `ctx.id.name` n'existe que pour un objet obtenu par nom (`idFromName` / `getByName`).
 */
import { assertValidCompanyId, sha256Hex } from '@fisca/shared-types';

export type SqlStorageValueLike = ArrayBuffer | string | number | null;

export interface SqlStorageCursorLike<T extends Record<string, SqlStorageValueLike>> {
  toArray(): T[];
  one(): T;
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

export interface SqlStorageLike {
  exec<T extends Record<string, SqlStorageValueLike>>(query: string, ...bindings: unknown[]): SqlStorageCursorLike<T>;
}

export interface DurableObjectStorageLike {
  readonly sql: SqlStorageLike;
  transactionSync<T>(closure: () => T): T;
}

export interface DurableObjectStateLike {
  readonly id: { readonly name?: string };
  readonly storage: DurableObjectStorageLike;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

/** Version de schéma d'un Durable Object : instructions ordonnées et empreinte SHA-256 épinglée. */
export interface DurableObjectSchemaVersion {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
  readonly expectedSha256Hex: string;
}

export const DO_SCHEMA_TRACKING_TABLE = '_fisca_do_schema_migrations';

/** Empreinte d'une version de schéma : SHA-256 des instructions jointes par un saut de ligne (convention du migrateur D1). */
export async function schemaVersionSha256(statements: readonly string[]): Promise<string> {
  return sha256Hex(new TextEncoder().encode(statements.join('\n')));
}

export type DoSchemaErrorCode = 'DO_SCHEMA_DDL_ALTERED' | 'DO_SCHEMA_STORAGE_ALTERED';

export class DoSchemaError extends Error {
  readonly code: DoSchemaErrorCode;

  constructor(code: DoSchemaErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'DoSchemaError';
    this.code = code;
  }
}

/**
 * Applique les versions de schéma une seule fois, dans une transaction, et refuse toute dérive d'empreinte :
 * - le DDL du code ne correspond plus à l'empreinte épinglée (`DO_SCHEMA_DDL_ALTERED`) ;
 * - la version déjà appliquée dans le stockage porte une autre empreinte (`DO_SCHEMA_STORAGE_ALTERED`).
 * Idempotent : une nouvelle instance sur le même stockage (reprise après crash) ne rejoue rien.
 */
export async function applyDurableObjectSchema(
  storage: DurableObjectStorageLike,
  versions: readonly DurableObjectSchemaVersion[],
): Promise<void> {
  const computed: string[] = [];
  for (const version of versions) {
    const actual = await schemaVersionSha256(version.statements);
    if (actual !== version.expectedSha256Hex) {
      throw new DoSchemaError(
        'DO_SCHEMA_DDL_ALTERED',
        `version ${version.version} (${version.name}) : empreinte ${actual} différente de l'empreinte épinglée ${version.expectedSha256Hex}.`,
      );
    }
    computed.push(actual);
  }
  storage.transactionSync(() => {
    storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS ${DO_SCHEMA_TRACKING_TABLE} (version INTEGER PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL)`,
    );
    versions.forEach((version, index) => {
      const sha256 = computed[index] ?? '';
      const stored = storage.sql
        .exec<{ name: string; sha256: string }>(
          `SELECT name, sha256 FROM ${DO_SCHEMA_TRACKING_TABLE} WHERE version = ?`,
          version.version,
        )
        .toArray();
      const row = stored[0];
      if (row !== undefined) {
        if (row.sha256 !== sha256) {
          throw new DoSchemaError(
            'DO_SCHEMA_STORAGE_ALTERED',
            `version ${version.version} (${version.name}) déjà appliquée avec l'empreinte ${row.sha256}, attendue ${sha256}.`,
          );
        }
        return;
      }
      for (const statement of version.statements) {
        storage.sql.exec(statement);
      }
      storage.sql.exec(
        `INSERT INTO ${DO_SCHEMA_TRACKING_TABLE} (version, name, sha256) VALUES (?, ?, ?)`,
        version.version,
        version.name,
        sha256,
      );
    });
  });
}

/** Société de l'instance : `ctx.id.name` (objet obtenu par nom). Échoue fermé si le nom manque ou est invalide. */
export function companyIdOfState(state: DurableObjectStateLike): string | null {
  const name = state.id.name;
  if (name === undefined) {
    return null;
  }
  try {
    assertValidCompanyId(name);
  } catch {
    return null;
  }
  return name;
}

// ---------------------------------------------------------------------------------------------------------------------
// Validation d'entrées (charges utiles RPC et fetch) : aucune bibliothèque, erreurs portées par l'appelant.
// ---------------------------------------------------------------------------------------------------------------------

export const ISO_UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const SHA256_LOWER_HEX = /^[0-9a-f]{64}$/;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** Horodatage canonique `YYYY-MM-DDTHH:MM:SSZ` (Doc_06 § 01), calendrier valide. */
export function isCanonicalUtcTimestamp(value: string): boolean {
  if (!ISO_UTC_SECONDS.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === `${value.slice(0, -1)}.000Z`;
}

/** Octets UTF-8 d'une chaîne (plafonds de taille). */
export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

/** Lit un corps JSON ; `undefined` si le corps n'est pas du JSON valide. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    return undefined;
  }
}
