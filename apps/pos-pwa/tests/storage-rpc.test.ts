import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../src/storage/memory-storage.ts';
import { createRpcClient, serveStorage } from '../src/storage/rpc.ts';

describe('pont RPC Worker ↔ thread principal', () => {
  it('proxifie run, all, batch et close sur un MessageChannel', async () => {
    const backend = await createMemoryStorage();
    const { port1, port2 } = new MessageChannel();
    serveStorage(backend, port2);
    const client = createRpcClient(port1);
    await client.run('CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER)');
    await client.batch([
      { sql: 'INSERT INTO t (n) VALUES (?)', params: [1] },
      { sql: 'INSERT INTO t (n) VALUES (?)', params: [2] },
    ]);
    expect(await client.all('SELECT n FROM t ORDER BY n')).toEqual([{ n: 1 }, { n: 2 }]);
    await expect(client.run('INSERT INTO inconnue VALUES (1)')).rejects.toThrow(/inconnue/);
    await client.close();
    port1.close();
    port2.close();
  });

  it('plusieurs appels concurrents reçoivent chacun leur réponse', async () => {
    const backend = await createMemoryStorage();
    const { port1, port2 } = new MessageChannel();
    serveStorage(backend, port2);
    const client = createRpcClient(port1);
    await client.run('CREATE TABLE t (n INTEGER)');
    await Promise.all([1, 2, 3, 4, 5].map((n) => client.run('INSERT INTO t (n) VALUES (?)', [n])));
    const rows = await Promise.all([client.all('SELECT COUNT(*) AS c FROM t'), client.all('SELECT SUM(n) AS s FROM t')]);
    expect(rows).toEqual([[{ c: 5 }], [{ s: 15 }]]);
    await client.close();
    port1.close();
    port2.close();
  });
});

describe('connexion au Worker OPFS', () => {
  it('attend le message de disponibilité puis rend un stockage fonctionnel', async () => {
    const { connectOpfsWorker } = await import('../src/storage/opfs-client.ts');
    const backend = await createMemoryStorage();
    const { port1, port2 } = new MessageChannel();
    const connecting = connectOpfsWorker(port1);
    serveStorage(backend, port2);
    port2.postMessage({ type: 'fisca-pos-storage-ready' });
    const client = await connecting;
    await client.run('CREATE TABLE t (n INTEGER)');
    expect(await client.all('SELECT COUNT(*) AS c FROM t')).toEqual([{ c: 0 }]);
    port1.close();
    port2.close();
  });

  it('propage l’échec d’initialisation du Worker', async () => {
    const { connectOpfsWorker } = await import('../src/storage/opfs-client.ts');
    const { port1, port2 } = new MessageChannel();
    const connecting = connectOpfsWorker(port1);
    port2.postMessage({ type: 'fisca-pos-storage-failed', message: 'OPFS indisponible' });
    await expect(connecting).rejects.toThrow(/OPFS indisponible/);
    port1.close();
    port2.close();
  });
});
