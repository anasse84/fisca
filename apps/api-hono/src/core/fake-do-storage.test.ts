import { describe, expect, it } from 'vitest';
import { createFakeDoDatabase, createFakeDoState } from './fake-do-storage.ts';

function newStorage() {
  const state = createFakeDoState(createFakeDoDatabase(), 'company_x');
  state.storage.sql.exec('CREATE TABLE t (k TEXT PRIMARY KEY, v INTEGER NOT NULL)');
  return state;
}

describe('faux ctx.storage de Durable Object (sémantique de l’API réelle)', () => {
  it('exec lie les paramètres positionnels et renvoie un curseur toArray / one', () => {
    const { storage } = newStorage();
    storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', 'a', 1);
    storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', 'b', 2);
    expect(storage.sql.exec<{ k: string; v: number }>('SELECT k, v FROM t ORDER BY k').toArray()).toEqual([
      { k: 'a', v: 1 },
      { k: 'b', v: 2 },
    ]);
    expect(storage.sql.exec<{ v: number }>('SELECT v FROM t WHERE k = ?', 'b').one()).toEqual({ v: 2 });
    expect(() => storage.sql.exec('SELECT v FROM t').one()).toThrow('Expected exactly one result');
    expect(() => storage.sql.exec('SELECT v FROM t WHERE k = ?', 'zzz').one()).toThrow('Expected exactly one result');
  });

  it('refuse BEGIN / SAVEPOINT dans exec, comme la production', () => {
    const { storage } = newStorage();
    expect(() => storage.sql.exec('BEGIN TRANSACTION')).toThrow('transactionSync');
    expect(() => storage.sql.exec('SAVEPOINT s')).toThrow('transactionSync');
  });

  it('transactionSync valide si le rappel réussit, annule tout si le rappel lève', () => {
    const { storage } = newStorage();
    const returned = storage.transactionSync(() => {
      storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', 'a', 1);
      return 'ok';
    });
    expect(returned).toBe('ok');
    expect(() =>
      storage.transactionSync(() => {
        storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', 'b', 2);
        throw new Error('échec');
      }),
    ).toThrow('échec');
    expect(storage.sql.exec<{ k: string }>('SELECT k FROM t').toArray()).toEqual([{ k: 'a' }]);
  });

  it('transactionSync refuse un rappel asynchrone', () => {
    const { storage } = newStorage();
    expect(() => storage.transactionSync(() => Promise.resolve(1))).toThrow('synchronous');
  });

  it('blockConcurrencyWhile exécute le rappel et rend son résultat ; id.name est absent sans nom', async () => {
    const named = newStorage();
    expect(await named.blockConcurrencyWhile(async () => 42)).toBe(42);
    expect(named.id.name).toBe('company_x');
    expect(createFakeDoState(createFakeDoDatabase(), undefined).id.name).toBeUndefined();
  });
});
