import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemDetailsSchema, type TenantSqlDriver } from '@fisca/shared-types';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_TTL_MS,
  IDEMPOTENCY_TTL_SECONDS,
  IDEMPOTENT_REPLAY_HEADER,
  createIdempotencyMiddleware,
  createInMemoryIdempotencyStore,
  type IdempotencyStore,
  type StoredIdempotentResponse,
} from './idempotency.ts';
import { PostgresHarness, openSqliteBackend, type LedgerBackend } from './ledger-test-harness.ts';
import { createSqlIdempotencyStore } from './sql-idempotency-store.ts';
import { createProblemErrorHandler } from './problem-details.ts';
import type { PipelineEnv, RoutePolicy } from './tenant-router.ts';
import { COMPANY_A, COMPANY_B, ORG_1, USER_1, USER_2, createFakeDriver, createTestClock } from './pipeline-test-support.ts';

const KEY_1 = '018f3b5e-7c2a-7d3e-8a1b-0123456789ab';
const KEY_2 = '018f3b5e-7c2a-7d3e-8a1b-0123456789ac';
const SECOND_MS = 1000;

type Kind = 'memory' | 'sqlite' | 'postgres';
const KINDS: readonly Kind[] = ['memory', 'sqlite', 'postgres'];

type Handler = (body: string) => Promise<Response> | Response;

interface SnapshotEntry {
  readonly key: string;
  readonly fingerprint: string;
  readonly response?: StoredIdempotentResponse;
}

interface SqlRow {
  readonly idempotency_key: string;
  readonly request_sha256: string;
  readonly response_status: number | string | null;
  readonly response_body_json: string | null;
  readonly content_type: string | null;
}

/**
 * La même suite de comportements du port s'exécute contre le pilote mémoire, l'adaptateur SQL sur SQLite (faux D1 fondé sur
 * node:sqlite) et l'adaptateur SQL sur PostgreSQL 16 réel : mêmes assertions, aucune adaptée à un moteur.
 */
describe.each(KINDS)('port IdempotencyStore : %s', (kind) => {
  let harness: PostgresHarness | null = null;
  let pgBackend: LedgerBackend | null = null;

  beforeAll(async () => {
    if (kind === 'postgres') {
      harness = new PostgresHarness();
      pgBackend = await harness.fresh();
    }
  });

  afterAll(async () => {
    await harness?.close();
  });

  async function sqlBacking(driver: TenantSqlDriver): Promise<{ store: IdempotencyStore; entries: () => Promise<readonly SnapshotEntry[]> }> {
    return {
      store: createSqlIdempotencyStore(driver),
      entries: async () => {
        const rows = await driver.query<SqlRow>({
          sql: 'SELECT idempotency_key, request_sha256, response_status, response_body_json, content_type FROM idempotency_records',
          params: [],
        });
        return rows.map((row): SnapshotEntry => {
          const base = { key: row.idempotency_key, fingerprint: row.request_sha256 };
          if (row.response_status === null || row.response_body_json === null) {
            return base;
          }
          const parsed = JSON.parse(row.response_body_json) as { readonly bodyBase64: string };
          return { ...base, response: { status: Number(row.response_status), contentType: row.content_type, bodyBase64: parsed.bodyBase64 } };
        });
      },
    };
  }

  async function createBacking(): Promise<{ store: IdempotencyStore; entries: () => Promise<readonly SnapshotEntry[]> }> {
    if (kind === 'memory') {
      const memory = createInMemoryIdempotencyStore();
      return { store: memory, entries: async () => memory.snapshot() };
    }
    if (kind === 'sqlite') {
      return sqlBacking((await openSqliteBackend()).driver);
    }
    if (pgBackend === null) {
      throw new Error('PostgreSQL non initialisé.');
    }
    await pgBackend.driver.executeBatchAtomically([{ sql: 'TRUNCATE idempotency_records', params: [] }]);
    return sqlBacking(pgBackend.driver);
  }

  async function setup(handler?: Handler, tenantScope: RoutePolicy['tenantScope'] = 'COMPANY') {
    const clock = createTestClock();
    const { store, entries } = await createBacking();
    const executions: string[] = [];
    const app = new Hono<PipelineEnv>();
    app.onError(createProblemErrorHandler());
    app.use('*', async (c, next) => {
      c.set('tenant', Object.freeze({
        userId: c.req.header('x-test-user') ?? USER_1,
        role: 'OWNER_GERANT',
        companyId: c.req.header('x-test-company') ?? COMPANY_A,
        organizationId: ORG_1,
        accessKind: 'MEMBERSHIP',
        plan: 'PLAN_TEST',
        canAccessPayrollPii: true,
        tenantDb: createFakeDriver(COMPANY_A),
      }));
      c.set('auth', { userId: c.req.header('x-test-user') ?? USER_1, sessionId: null, boundCompanyId: null });
      c.set('routePolicy', { audience: 'HUMAN_API', tenantScope, featureKey: null, legalExport: false });
      await next();
    });
    app.use('*', createIdempotencyMiddleware({ store, nowMs: clock.nowMs }));
    app.all('/api/v1/items', async (c) => {
      const body = await c.req.text();
      executions.push(body);
      if (handler !== undefined) {
        return handler(body);
      }
      c.header('Set-Cookie', 'session=secret');
      return c.json({ created: executions.length, echo: body.length }, 201);
    });
    app.all('/api/v1/other', (c) => c.json({ other: true }));
    return { app, clock, entries, executions };
  }

  function write(app: Hono<PipelineEnv>, init: { key?: string | null; body?: string; method?: string; path?: string; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers ?? {}) };
    if (init.key !== null) {
      headers[IDEMPOTENCY_KEY_HEADER] = init.key ?? KEY_1;
    }
    return app.request(init.path ?? '/api/v1/items', { method: init.method ?? 'POST', headers, body: init.body ?? '{"amount":100}' });
  }

  describe('Idempotency-Key : en-tête obligatoire et borné', () => {
    it("exige l'en-tête sur POST, PUT, PATCH, DELETE (400 IDEMPOTENCY_KEY_REQUIRED)", async () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const { app, executions } = await setup();
        const response = await write(app, { key: null, method });
        expect(response.status, method).toBe(400);
        expect(ProblemDetailsSchema.parse(await response.json())).toMatchObject({ errorCode: 'IDEMPOTENCY_KEY_REQUIRED' });
        expect(executions).toHaveLength(0);
      }
    });

    it('refuse un format hors UUIDv7 ou trop long (400 IDEMPOTENCY_KEY_INVALID)', async () => {
      const { app, executions } = await setup();
      for (const key of ['abc', '018f3b5e-7c2a-4d3e-8a1b-0123456789ab', `${KEY_1}${KEY_1}`, `${KEY_1} `.replace(' ', '\u00e9'), 'x'.repeat(500)]) {
        const response = await write(app, { key });
        expect(response.status, key).toBe(400);
        expect(await response.json()).toMatchObject({ errorCode: 'IDEMPOTENCY_KEY_INVALID' });
      }
      expect(executions).toHaveLength(0);
    });

    it("laisse passer les lectures sans clé et sans toucher au stockage", async () => {
      const { app, entries } = await setup();
      const response = await app.request('/api/v1/other');
      expect(response.status).toBe(200);
      expect(await entries()).toHaveLength(0);
    });
  });

  describe('Idempotency-Key : rejeu, conflit, concurrence', () => {
    it('rejeu identique : réponse mémorisée, en-tête de rejeu, une seule exécution', async () => {
      const { app, executions } = await setup();
      const first = await write(app);
      const replay = await write(app);
      expect(first.status).toBe(201);
      expect(first.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBeNull();
      expect(replay.status).toBe(201);
      expect(replay.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBe('true');
      expect(replay.headers.get('content-type')).toContain('application/json');
      expect(await replay.json()).toEqual(await first.json());
      expect(executions).toHaveLength(1);
    });

    it('même clé avec un corps différent : 422 problem+json, aucune exécution', async () => {
      const { app, executions } = await setup();
      await write(app);
      const response = await write(app, { body: '{"amount":101}' });
      expect(response.status).toBe(422);
      expect(response.headers.get('content-type')).toBe('application/problem+json');
      expect(ProblemDetailsSchema.parse(await response.json())).toMatchObject({ errorCode: 'IDEMPOTENCY_KEY_REUSED' });
      expect(executions).toHaveLength(1);
    });

    it('même clé avec une requête (query string) différente : 422', async () => {
      const { app } = await setup();
      await write(app, { path: '/api/v1/items?a=1' });
      expect((await write(app, { path: '/api/v1/items?a=2' })).status).toBe(422);
    });

    it('deux requêtes simultanées avec la même clé : une exécute, l’autre reçoit 409', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered: () => void = () => undefined;
      const handlerEntered = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const { app, executions } = await setup(async () => {
        entered();
        await gate;
        return new Response(JSON.stringify({ done: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      });
      const first = write(app);
      // Avec un stockage asynchrone, l'ordre d'arrivée des deux réservations n'est pas garanti : on attend que la première
      // requête soit entrée dans la route (réservation obtenue) avant d'envoyer la seconde, encore en cours.
      await handlerEntered;
      const second = write(app);
      const concurrent = await second;
      expect(concurrent.status).toBe(409);
      expect(ProblemDetailsSchema.parse(await concurrent.json())).toMatchObject({ errorCode: 'IDEMPOTENCY_REQUEST_IN_PROGRESS' });
      release();
      expect((await first).status).toBe(201);
      expect(executions).toHaveLength(1);
      const after = await write(app);
      expect(after.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBe('true');
      expect(executions).toHaveLength(1);
    });

    it('même clé, corps différent, première requête encore en cours : 422 (pas 409)', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered: () => void = () => undefined;
      const handlerEntered = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const { app } = await setup(async () => {
        entered();
        await gate;
        return new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } });
      });
      const first = write(app);
      await handlerEntered;
      expect((await write(app, { body: '{"autre":1}' })).status).toBe(422);
      release();
      await first;
    });
  });

  describe('Idempotency-Key : TTL de 72 h (horloge injectée)', () => {
    it('72 h − 1 s : rejeu mémorisé', async () => {
      const { app, clock, executions } = await setup();
      await write(app);
      clock.advanceMs(IDEMPOTENCY_TTL_MS - SECOND_MS);
      const replay = await write(app);
      expect(replay.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBe('true');
      expect(executions).toHaveLength(1);
    });

    it('72 h + 1 s : la clé est expirée, la requête s’exécute à nouveau', async () => {
      const { app, clock, executions } = await setup();
      await write(app);
      clock.advanceMs(IDEMPOTENCY_TTL_MS + SECOND_MS);
      const again = await write(app, { body: '{"amount":999}' });
      expect(again.status).toBe(201);
      expect(again.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBeNull();
      expect(executions).toHaveLength(2);
    });

    it('le TTL vaut exactement 72 heures', () => {
      expect(IDEMPOTENCY_TTL_MS).toBe(72 * 60 * 60 * 1000);
    });

    it('le TTL en secondes vaut 259 200 et égale le TTL en millisecondes', () => {
      expect(IDEMPOTENCY_TTL_SECONDS).toBe(259_200);
      expect(IDEMPOTENCY_TTL_SECONDS * 1000).toBe(IDEMPOTENCY_TTL_MS);
    });
  });

  describe('Idempotency-Key : portée (société, utilisateur, méthode + chemin)', () => {
    it('la même clé sous une autre société, un autre utilisateur, une autre méthode ou un autre chemin est indépendante', async () => {
      const { app, executions } = await setup();
      await write(app);
      await write(app, { headers: { 'x-test-company': COMPANY_B } });
      await write(app, { headers: { 'x-test-user': USER_2 } });
      await write(app, { method: 'PUT' });
      const other = await write(app, { path: '/api/v1/other' });
      expect(other.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBeNull();
      expect(executions).toHaveLength(4);
      expect((await write(app)).headers.get(IDEMPOTENT_REPLAY_HEADER)).toBe('true');
      expect((await write(app, { headers: { 'x-test-company': COMPANY_B } })).headers.get(IDEMPOTENT_REPLAY_HEADER)).toBe('true');
      expect((await write(app, { method: 'PUT' })).headers.get(IDEMPOTENT_REPLAY_HEADER)).toBe('true');
      expect((await write(app, { path: '/api/v1/other' })).headers.get(IDEMPOTENT_REPLAY_HEADER)).toBe('true');
      expect(executions).toHaveLength(4);
    });

    it('une route hors périmètre dossier se scope par utilisateur', async () => {
      const { app, executions } = await setup(undefined, 'NONE');
      await write(app);
      await write(app, { headers: { 'x-test-user': USER_2 } });
      expect(executions).toHaveLength(2);
    });

    it("port : une clé de stockage réutilisée par un AUTRE acteur ne rejoue jamais la réponse d'un autre (ACTOR_MISMATCH)", async () => {
      const { store } = await createBacking();
      const base = { storeKey: 'c'.repeat(64), fingerprint: 'd'.repeat(64), nowMs: 0, expiresAtMs: IDEMPOTENCY_TTL_MS };
      expect(await store.reserve({ ...base, actorId: USER_1 })).toEqual({ outcome: 'RESERVED' });
      expect(await store.reserve({ ...base, actorId: USER_2 })).toEqual({ outcome: 'ACTOR_MISMATCH' });
      await store.complete({ storeKey: base.storeKey, fingerprint: base.fingerprint, response: { status: 201, contentType: null, bodyBase64: 'e30=' } });
      expect(await store.reserve({ ...base, actorId: USER_2 })).toEqual({ outcome: 'ACTOR_MISMATCH' });
      expect(await store.reserve({ ...base, actorId: USER_1 })).toMatchObject({ outcome: 'COMPLETED' });
    });

    it('un autre utilisateur avec la même clé client exécute sa propre requête, sans rejeu de la réponse du premier', async () => {
      const { app, executions } = await setup();
      const first = await write(app);
      const other = await write(app, { headers: { 'x-test-user': USER_2 } });
      expect(other.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBeNull();
      expect(first.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBeNull();
      expect(executions).toHaveLength(2);
    });

    it('une clé distincte donne une exécution distincte', async () => {
      const { app, executions } = await setup();
      await write(app);
      await write(app, { key: KEY_2 });
      expect(executions).toHaveLength(2);
    });
  });

  describe('Idempotency-Key : garde indisponible', () => {
    it("échec fermé : si le stockage de réservation est en panne, l'écriture ne s'exécute pas (503)", async () => {
      let ran = 0;
      const broken = new Hono<PipelineEnv>();
      broken.onError(createProblemErrorHandler());
      broken.use('*', async (c, next) => {
        c.set('auth', { userId: USER_1, sessionId: null, boundCompanyId: null });
        await next();
      });
      broken.use('*', createIdempotencyMiddleware({
        store: {
          reserve: async () => {
            throw new Error('KV down secret-detail');
          },
          complete: async () => undefined,
          release: async () => undefined,
        },
        nowMs: () => 0,
      }));
      broken.post('/x', (c) => {
        ran += 1;
        return c.json({ ran: true });
      });
      const response = await broken.request('/x', { method: 'POST', headers: { [IDEMPOTENCY_KEY_HEADER]: KEY_1 }, body: '{}' });
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(text).not.toContain('secret-detail');
      expect(JSON.parse(text)).toMatchObject({ errorCode: 'IDEMPOTENCY_UNAVAILABLE' });
      expect(ran).toBe(0);
    });
  });

  describe('Idempotency-Key : contenu mémorisé et libération', () => {
    it('ne mémorise que statut, type de contenu et corps rendus par la route', async () => {
      const { app, entries } = await setup();
      await write(app, { headers: { Authorization: 'Bearer secret-token' }, body: '{"iban":"MA64DONNEE-SENSIBLE"}' });
      const dump = JSON.stringify(await entries());
      expect(dump).not.toContain('secret-token');
      expect(dump).not.toContain('DONNEE-SENSIBLE');
      expect(dump).not.toContain('session=secret');
      expect(dump).not.toContain(KEY_1);
      const [entry] = await entries();
      expect(Object.keys(entry?.response ?? {}).sort()).toEqual(['bodyBase64', 'contentType', 'status']);
    });

    it('restitue fidèlement un corps binaire', async () => {
      const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
      const { app } = await setup(() => new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }));
      const first = new Uint8Array(await (await write(app)).arrayBuffer());
      const replay = await write(app);
      expect(replay.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBe('true');
      expect(Array.from(new Uint8Array(await replay.arrayBuffer()))).toEqual(Array.from(first));
    });

    it('libère la clé après une erreur 5xx ou une exception : un nouvel essai s’exécute', async () => {
      let calls = 0;
      const { app, entries } = await setup(() => {
        calls += 1;
        if (calls === 1) {
          throw new Error('panne interne');
        }
        if (calls === 2) {
          return new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{"ok":true}', { status: 201, headers: { 'Content-Type': 'application/json' } });
      });
      expect((await write(app)).status).toBe(500);
      expect((await write(app)).status).toBe(503);
      const ok = await write(app);
      expect(ok.status).toBe(201);
      expect(calls).toBe(3);
      expect(await entries()).toHaveLength(1);
    });

    it('ne mémorise pas un refus 4xx de la route (la requête corrigée pourra être rejouée)', async () => {
      let calls = 0;
      const { app } = await setup(() => {
        calls += 1;
        return calls === 1
          ? new Response('{"e":1}', { status: 422, headers: { 'Content-Type': 'application/json' } })
          : new Response('{"ok":1}', { status: 201, headers: { 'Content-Type': 'application/json' } });
      });
      expect((await write(app)).status).toBe(422);
      expect((await write(app)).status).toBe(201);
    });
  });

});
