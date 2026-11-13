import { DatabaseSync } from 'node:sqlite';
import { CONTROL_PLANE_MIGRATIONS } from '../src/control-plane.ts';

export type Row = Record<string, string | number | bigint | null | Uint8Array>;
export type Param = string | number | null;

export const NOW = '2026-11-13T10:00:00Z';
export const LATER = '2026-11-13T10:15:00Z';

/** Base mémoire avec clés étrangères actives et toutes les migrations du plan de contrôle appliquées dans l'ordre. */
export function openControlPlane(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const migration of CONTROL_PLANE_MIGRATIONS) {
    for (const statement of migration.upSqlStatements) {
      db.exec(statement);
    }
  }
  return db;
}

export function run(db: DatabaseSync, sql: string, ...params: Param[]): void {
  db.prepare(sql).run(...params);
}

export function all(db: DatabaseSync, sql: string, ...params: Param[]): Row[] {
  return db.prepare(sql).all(...params);
}

export function expectSqlError(db: DatabaseSync, sql: string, params: readonly Param[], pattern: RegExp): void {
  let message: string | null = null;
  try {
    db.prepare(sql).run(...params);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (message === null) {
    throw new Error(`Aucune erreur levée pour : ${sql}`);
  }
  if (!pattern.test(message)) {
    throw new Error(`Erreur inattendue « ${message} » (attendu ${String(pattern)}) pour : ${sql}`);
  }
}

export function seedOrganization(db: DatabaseSync, id: string): void {
  run(
    db,
    `INSERT INTO organizations (id, name, org_kind, ui_locale_policy, created_at) VALUES (?, ?, 'DIRECT_BUSINESS', 'SIX_LOCALES_PME', ?)`,
    id,
    `Org ${id}`,
    NOW,
  );
}

export function seedUser(db: DatabaseSync, id: string, email: string): void {
  run(db, `INSERT INTO users (id, email_normalized, full_name, created_at) VALUES (?, ?, ?, ?)`, id, email, `User ${id}`, NOW);
}
