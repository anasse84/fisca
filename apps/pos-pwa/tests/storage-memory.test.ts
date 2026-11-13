import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../src/storage/memory-storage.ts';
import type { PosStorage } from '../src/storage/ports.ts';

let storage: PosStorage | undefined;
afterEach(async () => {
  await storage?.close();
  storage = undefined;
});

describe('stockage SQLite WASM en mémoire', () => {
  it('exécute, interroge et renvoie des lignes typées', async () => {
    storage = await createMemoryStorage();
    await storage.run('CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT, amount_cents INTEGER)');
    await storage.run('INSERT INTO t (label, amount_cents) VALUES (?, ?)', ['café', 1250]);
    const rows = await storage.all('SELECT label, amount_cents FROM t');
    expect(rows).toEqual([{ label: 'café', amount_cents: 1250 }]);
  });

  it('batch : tout ou rien (annulation sur erreur)', async () => {
    storage = await createMemoryStorage();
    await storage.run('CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
    await expect(
      storage.batch([
        { sql: 'INSERT INTO t (label) VALUES (?)', params: ['a'] },
        { sql: 'INSERT INTO t (label) VALUES (?)', params: [null] },
      ]),
    ).rejects.toThrow();
    expect(await storage.all('SELECT * FROM t')).toEqual([]);
    await storage.batch([{ sql: 'INSERT INTO t (label) VALUES (?)', params: ['b'] }]);
    expect(await storage.all('SELECT label FROM t')).toEqual([{ label: 'b' }]);
  });

  it('refuse l’usage après fermeture', async () => {
    storage = await createMemoryStorage();
    await storage.close();
    await expect(storage.all('SELECT 1')).rejects.toThrow(/fermé/);
    storage = undefined;
  });

  it('deux bases mémoire sont indépendantes', async () => {
    const a = await createMemoryStorage();
    const b = await createMemoryStorage();
    await a.run('CREATE TABLE t (x INTEGER)');
    await expect(b.all('SELECT * FROM t')).rejects.toThrow();
    await a.close();
    await b.close();
  });
});
