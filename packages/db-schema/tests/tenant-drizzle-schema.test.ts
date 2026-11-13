import { getTableName, is } from 'drizzle-orm';
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as drizzleSchema from '../src/tenant-drizzle.ts';
import { TENANT_INDEX_NAMES, TENANT_TABLE_NAMES } from '../src/tenant.ts';
import { all } from './support.ts';
import { openTenant } from './tenant-support.ts';

function drizzleTables(): SQLiteTable[] {
  const tables: SQLiteTable[] = [];
  for (const value of Object.values(drizzleSchema)) {
    if (is(value, SQLiteTable)) {
      tables.push(value);
    }
  }
  return tables;
}

describe('schéma Drizzle tenant = DDL SQLite (le DDL fait foi)', () => {
  it('expose exactement les mêmes tables que le DDL', () => {
    expect(drizzleTables().map((table) => getTableName(table)).sort()).toEqual([...TENANT_TABLE_NAMES].sort());
  });

  it('mêmes colonnes, mêmes nullités que PRAGMA table_info', () => {
    const db = openTenant();
    for (const table of drizzleTables()) {
      const name = getTableName(table);
      const config = getTableConfig(table);
      const actual = all(db, `SELECT name, "notnull" AS not_null, pk FROM pragma_table_info(?) ORDER BY cid`, name);
      expect(actual.map((row) => String(row['name'])).sort(), name).toEqual(config.columns.map((column) => column.name).sort());
      for (const row of actual) {
        const column = config.columns.find((candidate) => candidate.name === String(row['name']));
        if (Number(row['pk']) === 0) {
          expect(column?.notNull ?? null, `${name}.${String(row['name'])} notNull`).toBe(Number(row['not_null']) === 1);
        }
      }
    }
  });

  it("mêmes clés primaires, dans le même ordre, y compris composites", () => {
    const db = openTenant();
    for (const table of drizzleTables()) {
      const name = getTableName(table);
      const config = getTableConfig(table);
      const declared = [
        ...config.columns.filter((column) => column.primary).map((column) => column.name),
        ...config.primaryKeys.flatMap((key) => key.columns.map((column) => column.name)),
      ].sort();
      const actual = all(db, `SELECT name FROM pragma_table_info(?) WHERE pk > 0`, name)
        .map((row) => String(row['name']))
        .sort();
      expect(declared, name).toEqual(actual);
    }
  });

  it('mêmes clés étrangères (colonnes locale et référencée)', () => {
    const db = openTenant();
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

  it('mêmes contraintes UNIQUE (colonnes, dans l\'ordre) que les index automatiques de SQLite', () => {
    const db = openTenant();
    for (const table of drizzleTables()) {
      const name = getTableName(table);
      const config = getTableConfig(table);
      const declared = [
        ...config.columns.filter((column) => column.isUnique).map((column) => column.name),
        ...config.uniqueConstraints.map((unique) => unique.columns.map((column) => column.name).join(',')),
      ].sort();
      const actual = all(db, `SELECT name FROM pragma_index_list(?) WHERE "unique" = 1 AND origin = 'u'`, name)
        .map((row) =>
          all(db, `SELECT name FROM pragma_index_info(?) ORDER BY seqno`, String(row['name']))
            .map((column) => String(column['name']))
            .join(','),
        )
        .sort();
      expect(declared, name).toEqual(actual);
    }
  });

  it('les index nommés du DDL sont déclarés dans Drizzle', () => {
    const declared = drizzleTables()
      .flatMap((table) => getTableConfig(table).indexes.map((index) => index.config.name))
      .sort();
    expect(declared).toEqual([...TENANT_INDEX_NAMES].sort());
    const actual = all(openTenant(), `SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name`).map((row) =>
      String(row['name']),
    );
    expect(declared).toEqual(actual);
  });
});
