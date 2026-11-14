import type { Database } from '@sqlite.org/sqlite-wasm';
import type { PosStorage, SqlRow, SqlStatement, SqlValue } from './ports.ts';

/** Adapte une base `oo1` de SQLite WASM (mémoire ou OPFS) au port `PosStorage`. Partagé par les deux implémentations. */
export function wrapOo1Database(db: Database): PosStorage {
  let closed = false;
  const ensureOpen = (): void => {
    if (closed) throw new Error('Stockage local fermé.');
  };
  const bindOf = (params: readonly SqlValue[] | undefined): SqlValue[] => (params === undefined ? [] : [...params]);

  return {
    async run(sql: string, params?: readonly SqlValue[]): Promise<void> {
      ensureOpen();
      db.exec({ sql, bind: bindOf(params) });
    },

    async all(sql: string, params?: readonly SqlValue[]): Promise<readonly SqlRow[]> {
      ensureOpen();
      const rows = db.selectObjects(sql, bindOf(params));
      return rows.map((row): SqlRow => {
        const out: Record<string, SqlValue> = {};
        for (const [key, value] of Object.entries(row)) {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value === null) {
            out[key] = value;
          } else {
            throw new Error(`Type SQL non pris en charge pour la colonne ${key}.`);
          }
        }
        return out;
      });
    },

    async batch(statements: readonly SqlStatement[]): Promise<void> {
      ensureOpen();
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of statements) {
          db.exec({ sql: statement.sql, bind: bindOf(statement.params) });
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
