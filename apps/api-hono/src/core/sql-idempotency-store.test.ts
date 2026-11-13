import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantSqlDriver } from '@fisca/shared-types';
import { IDEMPOTENCY_TTL_MS, IDEMPOTENCY_TTL_SECONDS, type StoredIdempotentResponse } from './idempotency.ts';
import { PostgresHarness, openSqliteBackend, type LedgerBackend } from './ledger-test-harness.ts';
import { IDEMPOTENCY_SQL, createSqlIdempotencyStore, idempotencyCompleteStatement } from './sql-idempotency-store.ts';

const T0_MS = Date.parse('2026-11-13T10:00:00.000Z');
const SECOND_MS = 1000;
const KEY = 'a'.repeat(64);
const ACTOR = 'user-1';
const OTHER_ACTOR = 'user-2';
const OTHER_KEY = 'b'.repeat(64);
const FP_1 = '1'.repeat(64);
const FP_2 = '2'.repeat(64);
const CONCURRENCY = 8;
const RESPONSE: StoredIdempotentResponse = { status: 201, contentType: 'application/json', bodyBase64: 'eyJvayI6dHJ1ZX0=' };

interface RawRow {
  readonly idempotency_key: string;
  readonly actor_id: string;
  readonly request_sha256: string;
  readonly status: string;
  readonly response_status: number | string | null;
  readonly response_body_json: string | null;
  readonly content_type: string | null;
  readonly expires_at: string;
}

async function rawRows(driver: TenantSqlDriver): Promise<readonly RawRow[]> {
  return driver.query<RawRow>({ sql: 'SELECT * FROM idempotency_records ORDER BY idempotency_key', params: [] });
}

function reserveRequest(storeKey: string, fingerprint: string, nowMs: number) {
  return { storeKey, actorId: ACTOR, fingerprint, nowMs, expiresAtMs: nowMs + IDEMPOTENCY_TTL_MS };
}

let harness: PostgresHarness | null = null;
let pgBackend: LedgerBackend | null = null;

beforeAll(async () => {
  harness = new PostgresHarness();
  pgBackend = await harness.fresh();
});

afterAll(async () => {
  await harness?.close();
});

async function freshDriver(engine: 'sqlite' | 'postgres'): Promise<TenantSqlDriver> {
  if (engine === 'sqlite') {
    return (await openSqliteBackend()).driver;
  }
  if (pgBackend === null) {
    throw new Error('PostgreSQL non initialisé.');
  }
  await pgBackend.driver.executeBatchAtomically([{ sql: 'TRUNCATE idempotency_records', params: [] }]);
  return pgBackend.driver;
}

describe.each(['sqlite', 'postgres'] as const)('adaptateur SQL de IdempotencyStore : %s', (engine) => {
  it('première réservation RESERVED, puis IN_PROGRESS avec la même empreinte', async () => {
    const driver = await freshDriver(engine);
    const store = createSqlIdempotencyStore(driver);
    expect(await store.reserve(reserveRequest(KEY, FP_1, T0_MS))).toEqual({ outcome: 'RESERVED' });
    expect(await store.reserve(reserveRequest(KEY, FP_1, T0_MS + SECOND_MS))).toEqual({ outcome: 'IN_PROGRESS', fingerprint: FP_1 });
    const [row] = await rawRows(driver);
    expect(row).toMatchObject({
      idempotency_key: KEY,
      actor_id: ACTOR,
      request_sha256: FP_1,
      status: 'IN_FLIGHT',
      response_status: null,
      response_body_json: null,
      content_type: null,
      expires_at: '2026-11-16T10:00:00.000Z',
    });
  });

  it("plusieurs reserve concurrents sur la même clé : un seul RESERVED, les autres voient l'entrée en cours", async () => {
    const driver = await freshDriver(engine);
    const store = createSqlIdempotencyStore(driver);
    const outcomes = await Promise.all(Array.from({ length: CONCURRENCY }, () => store.reserve(reserveRequest(KEY, FP_1, T0_MS))));
    expect(outcomes.filter((outcome) => outcome.outcome === 'RESERVED')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.outcome === 'IN_PROGRESS')).toHaveLength(CONCURRENCY - 1);
    expect(await rawRows(driver)).toHaveLength(1);
  });

  it('reserve concurrents sur une clé EXPIRÉE : un seul RESERVED (le DELETE de l’expiré ne double pas la réservation)', async () => {
    const driver = await freshDriver(engine);
    const store = createSqlIdempotencyStore(driver);
    await store.reserve(reserveRequest(KEY, FP_1, T0_MS));
    const later = T0_MS + IDEMPOTENCY_TTL_MS + SECOND_MS;
    const outcomes = await Promise.all(Array.from({ length: CONCURRENCY }, () => store.reserve(reserveRequest(KEY, FP_2, later))));
    expect(outcomes.filter((outcome) => outcome.outcome === 'RESERVED')).toHaveLength(1);
    expect((await rawRows(driver)).map((row) => row.request_sha256)).toEqual([FP_2]);
  });

  it('clés différentes : indépendantes, même instant', async () => {
    const store = createSqlIdempotencyStore(await freshDriver(engine));
    const outcomes = await Promise.all([store.reserve(reserveRequest(KEY, FP_1, T0_MS)), store.reserve(reserveRequest(OTHER_KEY, FP_1, T0_MS))]);
    expect(outcomes).toEqual([{ outcome: 'RESERVED' }, { outcome: 'RESERVED' }]);
  });

  it('complete mémorise la réponse ; le rejeu la restitue (même empreinte) ; une autre empreinte est signalée', async () => {
    const driver = await freshDriver(engine);
    const store = createSqlIdempotencyStore(driver);
    await store.reserve(reserveRequest(KEY, FP_1, T0_MS));
    await store.complete({ storeKey: KEY, fingerprint: FP_1, response: RESPONSE });
    expect(await store.reserve(reserveRequest(KEY, FP_1, T0_MS + SECOND_MS))).toEqual({ outcome: 'COMPLETED', fingerprint: FP_1, response: RESPONSE });
    expect(await store.reserve(reserveRequest(KEY, FP_2, T0_MS + SECOND_MS))).toEqual({ outcome: 'COMPLETED', fingerprint: FP_1, response: RESPONSE });
    const [row] = await rawRows(driver);
    expect(row?.status).toBe('COMPLETED');
    expect(Number(row?.response_status)).toBe(201);
    expect(row?.content_type).toBe('application/json');
    expect(JSON.parse(row?.response_body_json ?? 'null')).toEqual({ bodyBase64: RESPONSE.bodyBase64 });
  });

  it('une réponse sans type de contenu est restituée avec contentType null', async () => {
    const store = createSqlIdempotencyStore(await freshDriver(engine));
    await store.reserve(reserveRequest(KEY, FP_1, T0_MS));
    const empty: StoredIdempotentResponse = { status: 204, contentType: null, bodyBase64: '' };
    await store.complete({ storeKey: KEY, fingerprint: FP_1, response: empty });
    expect(await store.reserve(reserveRequest(KEY, FP_1, T0_MS))).toEqual({ outcome: 'COMPLETED', fingerprint: FP_1, response: empty });
  });

  it("complete avec une autre empreinte ou sur une clé inconnue ne change rien", async () => {
    const driver = await freshDriver(engine);
    const store = createSqlIdempotencyStore(driver);
    await store.reserve(reserveRequest(KEY, FP_1, T0_MS));
    await store.complete({ storeKey: KEY, fingerprint: FP_2, response: RESPONSE });
    await store.complete({ storeKey: OTHER_KEY, fingerprint: FP_1, response: RESPONSE });
    expect(await rawRows(driver)).toMatchObject([{ idempotency_key: KEY, status: 'IN_FLIGHT', response_status: null }]);
  });

  it('release libère une réservation en cours : la clé redevient réservable, y compris avec une autre empreinte', async () => {
    const driver = await freshDriver(engine);
    const store = createSqlIdempotencyStore(driver);
    await store.reserve(reserveRequest(KEY, FP_1, T0_MS));
    await store.release({ storeKey: KEY, fingerprint: FP_2 });
    expect(await rawRows(driver)).toHaveLength(1);
    await store.release({ storeKey: KEY, fingerprint: FP_1 });
    expect(await rawRows(driver)).toHaveLength(0);
    expect(await store.reserve(reserveRequest(KEY, FP_2, T0_MS))).toEqual({ outcome: 'RESERVED' });
  });

  it('release ne supprime jamais une réponse terminée', async () => {
    const driver = await freshDriver(engine);
    const store = createSqlIdempotencyStore(driver);
    await store.reserve(reserveRequest(KEY, FP_1, T0_MS));
    await store.complete({ storeKey: KEY, fingerprint: FP_1, response: RESPONSE });
    await store.release({ storeKey: KEY, fingerprint: FP_1 });
    expect(await store.reserve(reserveRequest(KEY, FP_1, T0_MS))).toMatchObject({ outcome: 'COMPLETED' });
  });

  it('expiration à 72 h : 72 h − 1 s toujours mémorisé, 72 h + 1 s expiré, échéance exacte = absente', async () => {
    const driver = await freshDriver(engine);
    const store = createSqlIdempotencyStore(driver);
    await store.reserve(reserveRequest(KEY, FP_1, T0_MS));
    await store.complete({ storeKey: KEY, fingerprint: FP_1, response: RESPONSE });
    expect(await store.reserve(reserveRequest(KEY, FP_2, T0_MS + IDEMPOTENCY_TTL_MS - SECOND_MS))).toMatchObject({ outcome: 'COMPLETED', fingerprint: FP_1 });
    expect(await store.reserve(reserveRequest(KEY, FP_2, T0_MS + IDEMPOTENCY_TTL_MS + SECOND_MS))).toEqual({ outcome: 'RESERVED' });
    expect((await rawRows(driver)).map((row) => [row.request_sha256, row.response_status])).toEqual([[FP_2, null]]);
    // la réservation en cours posée à T0 + 72 h + 1 s expire aussi, et exactement à son échéance (nowMs = expiresAtMs : absente).
    const secondExpiry = T0_MS + IDEMPOTENCY_TTL_MS + SECOND_MS + IDEMPOTENCY_TTL_MS;
    expect(await store.reserve(reserveRequest(KEY, FP_1, secondExpiry - SECOND_MS))).toMatchObject({ outcome: 'IN_PROGRESS', fingerprint: FP_2 });
    expect(await store.reserve(reserveRequest(KEY, FP_1, secondExpiry))).toEqual({ outcome: 'RESERVED' });
  });

  it("refuse (échec fermé) une échéance qui n'est pas postérieure à la création", async () => {
    const store = createSqlIdempotencyStore(await freshDriver(engine));
    await expect(store.reserve({ storeKey: KEY, actorId: ACTOR, fingerprint: FP_1, nowMs: T0_MS, expiresAtMs: T0_MS })).rejects.toThrow();
  });

  it('le TTL en secondes vaut 259 200 (72 h) et la ligne expire exactement 259 200 s après la réservation', async () => {
    expect(IDEMPOTENCY_TTL_SECONDS).toBe(259_200);
    expect(IDEMPOTENCY_TTL_MS).toBe(IDEMPOTENCY_TTL_SECONDS * 1000);
    const driver = await freshDriver(engine);
    const store = createSqlIdempotencyStore(driver);
    await store.reserve(reserveRequest(KEY, FP_1, T0_MS));
    expect(Date.parse((await rawRows(driver))[0]?.expires_at ?? '') - T0_MS).toBe(259_200 * SECOND_MS);
  });

  it("une clé réutilisée par un AUTRE acteur ne rejoue jamais la réponse de l'acteur d'origine (en cours, puis terminée)", async () => {
    const driver = await freshDriver(engine);
    const store = createSqlIdempotencyStore(driver);
    const foreign = { ...reserveRequest(KEY, FP_1, T0_MS + SECOND_MS), actorId: OTHER_ACTOR };
    await store.reserve(reserveRequest(KEY, FP_1, T0_MS));
    expect(await store.reserve(foreign)).toEqual({ outcome: 'ACTOR_MISMATCH' });
    await store.complete({ storeKey: KEY, fingerprint: FP_1, response: RESPONSE });
    expect(await store.reserve(foreign)).toEqual({ outcome: 'ACTOR_MISMATCH' });
    expect(await store.reserve({ ...foreign, fingerprint: FP_2 })).toEqual({ outcome: 'ACTOR_MISMATCH' });
    expect(await store.reserve(reserveRequest(KEY, FP_1, T0_MS + SECOND_MS))).toMatchObject({ outcome: 'COMPLETED' });
    expect((await rawRows(driver)).map((row) => row.actor_id)).toEqual([ACTOR]);
  });

  it('complete ne passe qu’une fois : un second complete ne réécrit pas la réponse mémorisée', async () => {
    const driver = await freshDriver(engine);
    const store = createSqlIdempotencyStore(driver);
    await store.reserve(reserveRequest(KEY, FP_1, T0_MS));
    await store.complete({ storeKey: KEY, fingerprint: FP_1, response: RESPONSE });
    await store.complete({ storeKey: KEY, fingerprint: FP_1, response: { status: 200, contentType: null, bodyBase64: '' } });
    expect(await store.reserve(reserveRequest(KEY, FP_1, T0_MS))).toEqual({ outcome: 'COMPLETED', fingerprint: FP_1, response: RESPONSE });
  });

  it('purgeExpired supprime exactement les entrées échues et rend leur nombre', async () => {
    const driver = await freshDriver(engine);
    const store = createSqlIdempotencyStore(driver);
    await store.reserve(reserveRequest(KEY, FP_1, T0_MS));
    await store.reserve(reserveRequest(OTHER_KEY, FP_1, T0_MS + 2 * SECOND_MS));
    expect(await store.purgeExpired(T0_MS + IDEMPOTENCY_TTL_MS - SECOND_MS)).toBe(0);
    expect(await store.purgeExpired(T0_MS + IDEMPOTENCY_TTL_MS)).toBe(1);
    expect((await rawRows(driver)).map((row) => row.idempotency_key)).toEqual([OTHER_KEY]);
    expect(await store.purgeExpired(T0_MS + IDEMPOTENCY_TTL_MS + 3 * SECOND_MS)).toBe(1);
    expect(await rawRows(driver)).toHaveLength(0);
    expect(await store.purgeExpired(T0_MS + 100 * IDEMPOTENCY_TTL_MS)).toBe(0);
  });

  it("la requête de purge est soumise aux paramètres liés (aucune valeur dans le texte SQL)", () => {
    expect(IDEMPOTENCY_SQL.purgeExpired).not.toMatch(/\d/);
  });

  it("complete rejoint le lot atomique d'une écriture : si l'écriture échoue, la clé reste EN COURS", async () => {
    const driver = await freshDriver(engine);
    const store = createSqlIdempotencyStore(driver);
    await store.reserve(reserveRequest(KEY, FP_1, T0_MS));
    const complete = idempotencyCompleteStatement({ storeKey: KEY, fingerprint: FP_1, response: RESPONSE });
    await expect(
      driver.executeBatchAtomically([complete, { sql: 'INSERT INTO table_inexistante (x) VALUES (?)', params: [1] }]),
    ).rejects.toThrow();
    expect(await rawRows(driver)).toMatchObject([{ status: 'IN_FLIGHT', response_status: null }]);
    const { totalChanges } = await driver.executeBatchAtomically([complete]);
    expect(totalChanges).toBe(1);
    expect(await store.reserve(reserveRequest(KEY, FP_1, T0_MS))).toMatchObject({ outcome: 'COMPLETED' });
  });
});
