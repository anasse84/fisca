import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { TENANT_MIGRATIONS, createPostgresTenantDriver, singleConnectionSource, tenantMigrationPostgresStatements } from '@fisca/db-schema';
import { createSqlIdempotencyStore } from '../core/sql-idempotency-store.ts';

/** Tests adverses de l'auditeur, G1 tour 2 : réservation d'Idempotency-Key concurrente sous PostgreSQL 16 réel. */
const URL_PG = 'postgres://fisca@127.0.0.1:54329/postgres';
const SCHEMA = `fisca_adv_${randomBytes(5).toString('hex')}`;
const clients: Client[] = [];
async function connect(): Promise<Client> {
  const c = new Client({ connectionString: URL_PG }); await c.connect(); await c.query(`SET search_path TO ${SCHEMA}`); clients.push(c); return c;
}
beforeAll(async () => {
  const admin = new Client({ connectionString: URL_PG }); await admin.connect(); clients.push(admin);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`); await admin.query(`SET search_path TO ${SCHEMA}`);
  for (const m of TENANT_MIGRATIONS) for (const s of tenantMigrationPostgresStatements(m)) await admin.query(s);
});
afterAll(async () => {
  const admin = new Client({ connectionString: URL_PG }); await admin.connect(); await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); await admin.end();
  for (const c of clients) await c.end().catch(() => undefined);
});

describe('G1 adverse — Idempotency-Key 72 h (PostgreSQL, deux connexions)', () => {
  it('vingt réservations simultanées de la même clé : une seule RESERVED', async () => {
    const stores = await Promise.all(Array.from({ length: 10 }, async (_, i) => createSqlIdempotencyStore(createPostgresTenantDriver(`t${i}`, singleConnectionSource(await connect())))));
    const now = 1_800_000_000_000;
    const outcomes = await Promise.all(Array.from({ length: 20 }, (_, i) => stores[i % stores.length]!.reserve({ storeKey: 'k-1', actorId: 'u1', fingerprint: 'f'.repeat(64), nowMs: now, expiresAtMs: now + 259_200_000 }).then((r) => r.outcome, (e: unknown) => `ERR ${String(e).slice(0, 60)}`)));
    expect(outcomes.filter((o) => o === 'RESERVED')).toHaveLength(1);
    expect(outcomes.filter((o) => o.startsWith('ERR'))).toEqual([]);
  });
  it('autre acteur, même clé : ACTOR_MISMATCH ; clé expirée : nouvelle réservation', async () => {
    const store = createSqlIdempotencyStore(createPostgresTenantDriver('t', singleConnectionSource(await connect())));
    const now = 1_800_000_000_000;
    await store.reserve({ storeKey: 'k-2', actorId: 'u1', fingerprint: 'a'.repeat(64), nowMs: now, expiresAtMs: now + 1000 });
    expect((await store.reserve({ storeKey: 'k-2', actorId: 'u2', fingerprint: 'a'.repeat(64), nowMs: now + 1, expiresAtMs: now + 2000 })).outcome).toBe('ACTOR_MISMATCH');
    expect((await store.reserve({ storeKey: 'k-2', actorId: 'u2', fingerprint: 'b'.repeat(64), nowMs: now + 5000, expiresAtMs: now + 9000 })).outcome).toBe('RESERVED');
  });
});
