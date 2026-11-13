import { describe, expect, it } from 'vitest';
import {
  FISCA_DEAD_LETTER_QUEUE_NAMES,
  FISCA_QUEUE_NAMES,
  InMemoryInfrastructureAdapter,
  InfrastructureError,
  assertValidCompanyId,
  assertValidObjectKey,
  isKnownQueueName,
  runInfrastructureAdapterContract,
  sha256Hex,
  type InfrastructureContractFixture,
  type InfrastructureProviderMode,
} from '../src/index.ts';

const FIXED_NOW = '2026-11-14T10:00:00.000Z';

function fixtureFor(providerMode: InfrastructureProviderMode): () => Promise<InfrastructureContractFixture> {
  return async () => {
    const adapter = new InMemoryInfrastructureAdapter({
      acknowledgeTestOnly: 'NOT_FOR_PRODUCTION',
      providerMode,
      nowIso: () => FIXED_NOW,
    });
    return {
      adapter,
      provisionCompany: async (companyId) => {
        adapter.provisionTenant(companyId);
      },
      queueDepth: async (queueName) => adapter.queueDepth(queueName),
    };
  };
}

// Le même jeu de contrat rejoue sur les deux modes : mode actif cloudflare et standby VPS.
runInfrastructureAdapterContract({ describe, it }, 'InMemory CLOUDFLARE_EDGE', fixtureFor('CLOUDFLARE_EDGE'));
runInfrastructureAdapterContract({ describe, it }, 'InMemory SOVEREIGN_MOROCCO_VPS', fixtureFor('SOVEREIGN_MOROCCO_VPS'));

describe('InMemoryInfrastructureAdapter : garde-fous de non-production', () => {
  it('refuse d\'être construit sans l\'acquittement explicite', () => {
    const build = (): unknown =>
      new InMemoryInfrastructureAdapter({
        acknowledgeTestOnly: 'oui' as unknown as 'NOT_FOR_PRODUCTION',
        providerMode: 'CLOUDFLARE_EDGE',
        nowIso: () => FIXED_NOW,
      });
    expect(build).toThrow(InfrastructureError);
    expect(build).toThrow(/INFRA_ADAPTER_NOT_FOR_PRODUCTION/);
  });
});

describe('moteur SQL mémoire : sous-ensemble portable SQLite/PostgreSQL', () => {
  async function tenant() {
    const adapter = new InMemoryInfrastructureAdapter({
      acknowledgeTestOnly: 'NOT_FOR_PRODUCTION',
      providerMode: 'CLOUDFLARE_EDGE',
      nowIso: () => FIXED_NOW,
    });
    adapter.provisionTenant('soc-1');
    return adapter.getTenantDb('soc-1');
  }

  it('crée, insère, lit avec WHERE, met à jour et supprime', async () => {
    const db = await tenant();
    await db.executeBatchAtomically([
      { sql: 'CREATE TABLE invoices (id TEXT PRIMARY KEY, total_cents INTEGER NOT NULL, status TEXT)', params: [] },
      { sql: 'INSERT INTO invoices (id, total_cents, status) VALUES (?, ?, ?)', params: ['a', 12050, 'DRAFT'] },
      { sql: 'INSERT INTO invoices (id, total_cents, status) VALUES (?, ?, ?)', params: ['b', 99, null] },
    ]);
    expect(await db.query({ sql: 'SELECT id, total_cents FROM invoices WHERE id = ?', params: ['a'] })).toEqual([
      { id: 'a', total_cents: 12050 },
    ]);
    expect((await db.query({ sql: 'SELECT * FROM invoices', params: [] })).length).toBe(2);
    const upd = await db.executeBatchAtomically([
      { sql: 'UPDATE invoices SET status = ? WHERE id = ? AND status = ?', params: ['SENT', 'a', 'DRAFT'] },
    ]);
    expect(upd.totalChanges).toBe(1);
    const noop = await db.executeBatchAtomically([
      { sql: 'UPDATE invoices SET status = ? WHERE id = ? AND status = ?', params: ['CLEARED', 'a', 'DRAFT'] },
    ]);
    expect(noop.totalChanges).toBe(0);
    const del = await db.executeBatchAtomically([{ sql: 'DELETE FROM invoices WHERE id = ?', params: ['b'] }]);
    expect(del.totalChanges).toBe(1);
  });

  it('refuse un SQL hors sous-ensemble ou propriétaire, et un nombre de paramètres incorrect', async () => {
    const db = await tenant();
    await expect(db.query({ sql: 'PRAGMA table_info(x)', params: [] })).rejects.toMatchObject({ code: 'INFRA_SQL_UNSUPPORTED' });
    await expect(db.query({ sql: 'SELECT json_extract(a, 1) FROM t', params: [] })).rejects.toMatchObject({
      code: 'INFRA_SQL_UNSUPPORTED',
    });
    await db.executeBatchAtomically([{ sql: 'CREATE TABLE t (a TEXT)', params: [] }]);
    await expect(db.query({ sql: 'SELECT a FROM t WHERE a = ?', params: [] })).rejects.toMatchObject({ code: 'INFRA_SQL_REJECTED' });
  });

  it('rejette un flottant en paramètre (ADR-03)', async () => {
    const db = await tenant();
    await db.executeBatchAtomically([{ sql: 'CREATE TABLE t (a INTEGER)', params: [] }]);
    await expect(
      db.executeBatchAtomically([{ sql: 'INSERT INTO t (a) VALUES (?)', params: [1.5] }]),
    ).rejects.toMatchObject({ code: 'INFRA_BATCH_ROLLED_BACK' });
  });

  it('rejette une violation NOT NULL', async () => {
    const db = await tenant();
    await db.executeBatchAtomically([{ sql: 'CREATE TABLE t (a TEXT NOT NULL)', params: [] }]);
    await expect(
      db.executeBatchAtomically([{ sql: 'INSERT INTO t (a) VALUES (?)', params: [null] }]),
    ).rejects.toMatchObject({ code: 'INFRA_BATCH_ROLLED_BACK' });
  });
});

describe('utilitaires', () => {
  it('valide les identifiants de société et les clés d\'objet', () => {
    expect(() => assertValidCompanyId('soc-1_A')).not.toThrow();
    for (const bad of ['', 'a b', '../x', 'x'.repeat(65), 'société']) {
      expect(() => assertValidCompanyId(bad)).toThrow(/INFRA_INVALID_COMPANY_ID/);
    }
    expect(() => assertValidObjectKey('soc-1/aip/2026/f.bin')).not.toThrow();
    for (const bad of ['', '/abs', 'a/../b', 'a//b', 'a/']) {
      expect(() => assertValidObjectKey(bad)).toThrow(/INFRA_INVALID_OBJECT_KEY/);
    }
  });

  it('expose les files D-08 et leurs files d\'erreurs', () => {
    expect(FISCA_QUEUE_NAMES).toEqual([
      'fisca-invoice-ingestion',
      'fisca-xhub-clearance',
      'fisca-erp-sync-outbound',
      'fisca-sovereign-mirror',
      'fisca-notifications',
    ]);
    expect(FISCA_DEAD_LETTER_QUEUE_NAMES).toContain('dlq-fisca-xhub-clearance');
    expect(isKnownQueueName('fisca-notifications')).toBe(true);
    expect(isKnownQueueName('dlq-fisca-notifications')).toBe(true);
    expect(isKnownQueueName('fisca-ocr')).toBe(false);
    expect(isKnownQueueName('dlq-dlq-fisca-notifications')).toBe(false);
  });

  it('calcule le SHA-256 (vecteur « abc »)', async () => {
    expect(await sha256Hex(Uint8Array.from('abc', (c) => c.charCodeAt(0)))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
