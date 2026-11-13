import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapOo1Database } from './oo1-storage.ts';
import type { PosStorage } from './ports.ts';

/**
 * Implémentation en mémoire (vrai SQLite WASM, base `:memory:`) : tests sous Node et mode dégradé explicite.
 * Chaque appel crée une base indépendante.
 */
export async function createMemoryStorage(): Promise<PosStorage> {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  db.exec('PRAGMA foreign_keys = ON');
  return wrapOo1Database(db);
}
