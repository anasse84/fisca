/**
 * Pilote PostgreSQL de `TenantSqlDriver` (mode SOVEREIGN_MOROCCO_VPS, ou Hyperdrive pour l'offre ENT_SOUVERAIN).
 *
 * Interfaces STRUCTURELLES : `pg.Pool` satisfait `PgConnectionSource`, `pg.PoolClient` satisfait `PgPoolClientLike`.
 * Le pilote n'importe donc jamais `pg` à l'exécution (le paquet reste léger pour le bundle Workers ; `pg` n'est qu'une
 * dépendance de test ici, et c'est l'application qui injecte son pool).
 *
 * Les instructions de référence utilisent `?` (SQLite) ; elles sont converties en `$n` sans toucher aux littéraux.
 */
import {
  InfrastructureError,
  type BatchResult,
  type SqlStatementParams,
  type TenantSqlDriver,
} from '@fisca/shared-types';
import { assertSqlParams, describeEngineError, isInfrastructureError } from './sql-driver-support.ts';

export interface PgQueryResultLike {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number | null;
  readonly command?: string;
  readonly fields?: readonly { readonly name: string; readonly dataTypeID: number }[];
}

export interface PgClientLike {
  query(text: string, values?: unknown[]): Promise<PgQueryResultLike>;
}

export interface PgPoolClientLike extends PgClientLike {
  /** Un argument non vide détruit la connexion au lieu de la rendre au pool (convention de `pg`). */
  release(error?: Error | boolean): void;
}

export interface PgConnectionSource {
  connect(): Promise<PgPoolClientLike>;
}

const PG_INT8_OID = 20;
const DML_COMMANDS = new Set(['INSERT', 'UPDATE', 'DELETE']);

function rejected(detail: string): InfrastructureError {
  return new InfrastructureError('INFRA_SQL_REJECTED', detail);
}

function isIdentifierStart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_]/.test(ch);
}

function isDollarTagChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/**
 * Convertit chaque `?` hors littéral en `$1`, `$2`… Ignorés : chaînes `'…'` (apostrophe doublée), identifiants `"…"`,
 * commentaires de ligne et de bloc, chaînes à dollars `$tag$ … $tag$`. Le nombre de `?` doit égaler `paramCount`.
 * (Les chaînes `E'…\'…'` à échappement par barre oblique inverse ne sont pas gérées : aucune instruction du dépôt n'en emploie.)
 */
export function convertQuestionPlaceholders(sql: string, paramCount: number): string {
  let out = '';
  let index = 0;
  let found = 0;
  const n = sql.length;
  while (index < n) {
    const ch = sql[index];
    const next = sql[index + 1];
    if (ch === "'" || ch === '"') {
      let end = index + 1;
      while (end < n) {
        if (sql[end] === ch) {
          if (sql[end + 1] === ch) {
            end += 2;
            continue;
          }
          break;
        }
        end += 1;
      }
      out += sql.slice(index, end + 1);
      index = end + 1;
    } else if (ch === '-' && next === '-') {
      const eol = sql.indexOf('\n', index);
      const end = eol === -1 ? n : eol;
      out += sql.slice(index, end);
      index = end;
    } else if (ch === '/' && next === '*') {
      const close = sql.indexOf('*/', index + 2);
      const end = close === -1 ? n : close + 2;
      out += sql.slice(index, end);
      index = end;
    } else if (ch === '$' && (next === '$' || isIdentifierStart(next))) {
      let tagEnd = index + 1;
      while (tagEnd < n && isDollarTagChar(sql[tagEnd])) {
        tagEnd += 1;
      }
      if (sql[tagEnd] === '$') {
        const tag = sql.slice(index, tagEnd + 1);
        const close = sql.indexOf(tag, tagEnd + 1);
        const end = close === -1 ? n : close + tag.length;
        out += sql.slice(index, end);
        index = end;
      } else {
        out += ch;
        index += 1;
      }
    } else if (ch === '?') {
      found += 1;
      out += `$${found}`;
      index += 1;
    } else {
      out += ch;
      index += 1;
    }
  }
  if (found !== paramCount) {
    throw rejected(`${found} marqueur(s) « ? » pour ${paramCount} paramètre(s).`);
  }
  return out;
}

/** Une instruction sans paramètre part telle quelle (corps PL/pgSQL, DDL) ; sinon `?` devient `$n`. */
function toPostgresText(statement: SqlStatementParams): string {
  return statement.params.length === 0 ? statement.sql : convertQuestionPlaceholders(statement.sql, statement.params.length);
}

function valuesOf(statement: SqlStatementParams): unknown[] | undefined {
  return statement.params.length === 0 ? undefined : [...statement.params];
}

/** BIGINT (int8) arrive en chaîne sous `pg` : converti en nombre s'il est sûr, refusé sinon (aucune perte silencieuse). */
function normalizeRows<TRow>(result: PgQueryResultLike): readonly TRow[] {
  const bigintColumns = (result.fields ?? []).filter((field) => field.dataTypeID === PG_INT8_OID).map((field) => field.name);
  if (bigintColumns.length === 0) {
    return result.rows as readonly TRow[];
  }
  return result.rows.map((row) => {
    const copy: Record<string, unknown> = { ...row };
    for (const column of bigintColumns) {
      const value = copy[column];
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed)) {
          throw rejected(`BIGINT hors plage sûre de nombre (colonne ${column}) : ${value}`);
        }
        copy[column] = parsed;
      }
    }
    return copy as TRow;
  }) as readonly TRow[];
}

/** Une connexion unique (client `pg.Client`) vue comme une source : les acquisitions sont sérialisées, jamais entrelacées. */
export function singleConnectionSource(client: PgClientLike): PgConnectionSource {
  let tail: Promise<void> = Promise.resolve();
  return {
    async connect(): Promise<PgPoolClientLike> {
      const previous = tail;
      let release: () => void = () => undefined;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      return { query: (text, values) => client.query(text, values), release: () => release() };
    },
  };
}

export function createPostgresTenantDriver(tenantId: string, source: PgConnectionSource): TenantSqlDriver {
  return {
    tenantId,
    async query<TRow>(statement: SqlStatementParams): Promise<readonly TRow[]> {
      assertSqlParams(statement);
      const text = toPostgresText(statement);
      const client = await source.connect();
      try {
        return normalizeRows<TRow>(await client.query(text, valuesOf(statement)));
      } catch (error) {
        if (isInfrastructureError(error)) {
          throw error;
        }
        throw rejected(describeEngineError(error));
      } finally {
        client.release();
      }
    },

    async executeBatchAtomically(statements: readonly SqlStatementParams[]): Promise<BatchResult> {
      for (const statement of statements) {
        assertSqlParams(statement);
      }
      const texts = statements.map(toPostgresText);
      if (statements.length === 0) {
        return { totalChanges: 0 };
      }
      const client = await source.connect();
      let broken: Error | undefined;
      try {
        await client.query('BEGIN');
        let totalChanges = 0;
        for (const [position, statement] of statements.entries()) {
          const result = await client.query(texts[position] ?? statement.sql, valuesOf(statement));
          if (result.command !== undefined && DML_COMMANDS.has(result.command)) {
            totalChanges += result.rowCount ?? 0;
          }
        }
        await client.query('COMMIT');
        return { totalChanges };
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        }
        if (isInfrastructureError(error)) {
          throw error;
        }
        throw new InfrastructureError('INFRA_BATCH_ROLLED_BACK', describeEngineError(error));
      } finally {
        client.release(broken);
      }
    },
  };
}
