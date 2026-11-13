import { getTableName, is } from 'drizzle-orm';
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { CONTROL_PLANE_TABLE_NAMES } from '../src/control-plane.ts';
import * as drizzleSchema from '../src/control-plane-drizzle.ts';
import { all, openControlPlane } from './support.ts';

function drizzleTables(): SQLiteTable[] {
  const tables: SQLiteTable[] = [];
  for (const value of Object.values(drizzleSchema)) {
    if (is(value, SQLiteTable)) {
      tables.push(value);
    }
  }
  return tables;
}

describe('schéma Drizzle = DDL SQLite (une seule source de vérité comportementale : le DDL)', () => {
  it('expose exactement les mêmes tables que le DDL', () => {
    expect(drizzleTables().map((table) => getTableName(table)).sort()).toEqual([...CONTROL_PLANE_TABLE_NAMES].sort());
  });

  it('mêmes colonnes, mêmes noms, mêmes nullités, mêmes clés primaires que PRAGMA table_info', () => {
    const db = openControlPlane();
    for (const table of drizzleTables()) {
      const name = getTableName(table);
      const config = getTableConfig(table);
      const actual = all(db, `SELECT name, "notnull" AS not_null, pk FROM pragma_table_info(?) ORDER BY cid`, name);
      const expectedNames = config.columns.map((column) => column.name);
      expect(actual.map((row) => String(row['name'])).sort(), name).toEqual([...expectedNames].sort());
      for (const row of actual) {
        const column = config.columns.find((candidate) => candidate.name === String(row['name']));
        const isPrimary = Number(row['pk']) > 0;
        if (!isPrimary) {
          expect(column?.notNull ?? null, `${name}.${String(row['name'])} notNull`).toBe(Number(row['not_null']) === 1);
        }
      }
    }
  });

  it('mêmes clés étrangères (colonnes locale et référencée)', () => {
    const db = openControlPlane();
    for (const table of drizzleTables()) {
      const name = getTableName(table);
      const declared = getTableConfig(table)
        .foreignKeys.map((fk) => {
          const reference = fk.reference();
          return `${reference.columns.map((c) => c.name).join(',')}->${getTableName(reference.foreignTable)}(${reference.foreignColumns.map((c) => c.name).join(',')})`;
        })
        .sort();
      const actual = all(db, `SELECT "from" AS local, "table" AS parent, "to" AS target FROM pragma_foreign_key_list(?)`, name)
        .map((row) => `${String(row['local'])}->${String(row['parent'])}(${String(row['target'])})`)
        .sort();
      expect(declared, name).toEqual(actual);
    }
  });

  it('les index nommés du DDL sont déclarés dans Drizzle', () => {
    const declared = drizzleTables()
      .flatMap((table) => getTableConfig(table).indexes.map((index) => index.config.name))
      .sort();
    const db = openControlPlane();
    const actual = all(db, `SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name`).map((row) => String(row['name']));
    expect(declared).toEqual(actual);
  });
});
