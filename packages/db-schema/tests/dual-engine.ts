import type { DatabaseSync } from 'node:sqlite';
import type { Client } from 'pg';
import { all, type Param } from './support.ts';

/** SQLSTATE d'un RAISE EXCEPTION sans code explicite (PostgreSQL). */
export const RAISED = 'P0001';
/** SQLSTATE d'une violation de CHECK (PostgreSQL). */
export const CHECK_VIOLATION = '23514';

export interface Failure {
  readonly message: string;
  readonly code: string | null;
}

/** Un moteur exécute les mêmes ordres : SQLite (paramètres `?`) ou PostgreSQL (paramètres `$n`, convertis ici). */
export interface Engine {
  readonly name: 'sqlite' | 'postgres';
  run(sql: string, params?: readonly Param[]): Promise<void>;
  fail(sql: string, params?: readonly Param[]): Promise<Failure>;
  rows(sql: string): Promise<Record<string, string | number | null>[]>;
}

export function toPg(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${(index += 1)}`);
}

function normalize(rows: readonly Record<string, unknown>[]): Record<string, string | number | null>[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]): [string, string | number | null] => {
        if (value === null) {
          return [key, null];
        }
        if (/(_cents|_bps|_milli|_micro)$|^cgnc_class$|^n$|_flag$/.test(key)) {
          return [key, Number(value)];
        }
        return [key, String(value)];
      }),
    ),
  );
}

/** Les deux moteurs réels : la base SQLite est remplacée par `resetSqlite`, PostgreSQL garde son schéma temporaire. */
export class DualEngines {
  private sqlite: DatabaseSync;

  constructor(
    private readonly client: Client,
    private readonly openSqlite: () => DatabaseSync,
  ) {
    this.sqlite = openSqlite();
  }

  resetSqlite(): void {
    this.sqlite = this.openSqlite();
  }

  get lite(): Engine {
    const db = this.sqlite;
    return {
      name: 'sqlite',
      run: async (sql, params = []) => {
        db.prepare(sql).run(...params);
      },
      fail: async (sql, params = []) => {
        try {
          db.prepare(sql).run(...params);
        } catch (error) {
          return { message: error instanceof Error ? error.message : String(error), code: null };
        }
        throw new Error(`SQLite n'a levé aucune erreur pour : ${sql}`);
      },
      rows: async (sql) => normalize(all(db, sql).map((row) => ({ ...row }))),
    };
  }

  get pg(): Engine {
    const client = this.client;
    return {
      name: 'postgres',
      run: async (sql, params = []) => {
        await client.query(toPg(sql), [...params]);
      },
      fail: async (sql, params = []) => {
        try {
          await client.query(toPg(sql), [...params]);
        } catch (error) {
          if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
            return { message: error.message, code: error.code };
          }
          throw error;
        }
        throw new Error(`PostgreSQL n'a levé aucune erreur pour : ${sql}`);
      },
      rows: async (sql) => normalize((await client.query(toPg(sql))).rows),
    };
  }

  engines(): readonly Engine[] {
    return [this.lite, this.pg];
  }

  /** Exécute le même scénario sur les deux moteurs et rend les deux résultats, SQLite en premier. */
  async onBoth<T>(scenario: (engine: Engine) => Promise<T>): Promise<readonly [T, T]> {
    return [await scenario(this.lite), await scenario(this.pg)];
  }
}
