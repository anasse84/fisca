import { DatabaseSync } from 'node:sqlite';
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from '../src/drivers/d1-driver.ts';

type D1Value = string | number | null;

const READ_KEYWORDS = new Set(['SELECT', 'WITH', 'PRAGMA', 'VALUES']);
const DML_KEYWORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE']);

function keywordOf(sql: string): string {
  return (/^\s*([A-Za-z]+)/.exec(sql)?.[1] ?? '').toUpperCase();
}

function toD1Error(error: unknown): Error {
  return new Error(`D1_ERROR: ${error instanceof Error ? error.message : String(error)}`);
}

function toValues(values: readonly unknown[]): D1Value[] {
  return values.map((value) => {
    if (value === null || typeof value === 'string' || typeof value === 'number') {
      return value;
    }
    throw new Error(`D1_TYPE_ERROR: type non supporté pour bind() : ${typeof value}`);
  });
}

function execute(sqlite: DatabaseSync, sql: string, values: readonly D1Value[]): D1ResultLike<Record<string, unknown>> {
  const keyword = keywordOf(sql);
  const statement = sqlite.prepare(sql);
  if (READ_KEYWORDS.has(keyword)) {
    const rows = statement.all(...values).map((row) => ({ ...row }));
    return { success: true, results: rows, meta: { changes: 0 } };
  }
  const outcome = statement.run(...values);
  // sqlite3_changes() ne bouge pas pour un DDL : seul un DML compte, comme dans meta.changes de D1.
  return { success: true, results: [], meta: { changes: DML_KEYWORDS.has(keyword) ? Number(outcome.changes) : 0 } };
}

class FakeD1PreparedStatement implements D1PreparedStatementLike {
  constructor(
    readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly values: readonly D1Value[],
  ) {}

  bind(...values: unknown[]): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this.sqlite, this.sql, toValues(values));
  }

  async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    try {
      return execute(this.sqlite, this.sql, this.values) as D1ResultLike<T>;
    } catch (error) {
      throw toD1Error(error);
    }
  }

  async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return this.all<T>();
  }
}

/**
 * Faux D1Database au-dessus de node:sqlite. Sémantique de batch() documentée par Cloudflare : les instructions s'exécutent
 * dans l'ordre, comme UNE transaction ; si l'une échoue, toute la séquence est annulée et l'erreur est levée.
 */
export class FakeD1Database implements D1DatabaseLike {
  readonly batchSizes: number[] = [];

  constructor(readonly sqlite: DatabaseSync = new DatabaseSync(':memory:')) {
    sqlite.exec('PRAGMA foreign_keys = ON');
  }

  prepare(query: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this.sqlite, query, []);
  }

  async batch(statements: readonly D1PreparedStatementLike[]): Promise<readonly D1ResultLike<unknown>[]> {
    this.batchSizes.push(statements.length);
    const results: D1ResultLike<unknown>[] = [];
    this.sqlite.exec('BEGIN');
    try {
      for (const statement of statements) {
        if (!(statement instanceof FakeD1PreparedStatement)) {
          throw new Error('D1_ERROR: instruction étrangère à cette base');
        }
        results.push(execute(this.sqlite, statement.sql, statement.values));
      }
      this.sqlite.exec('COMMIT');
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw toD1Error(error);
    }
    return results;
  }
}
