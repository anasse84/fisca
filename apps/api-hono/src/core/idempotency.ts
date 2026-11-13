/**
 * Idempotency-Key 72 h (ticket T-S1B-11 ; Doc_07 § 01, Doc_02 : « conservé 72 heures »).
 *
 * POINT DE SPEC NON TRANCHÉ : aucune spécification ne désigne où ce stockage vit (KV FISCA_FAST_KV, table du plan de contrôle,
 * Durable Object). Aucun nom de ressource n'est donc inventé : le stockage est le PORT `IdempotencyStore` (réservation et
 * résultat atomiques) ; `createInMemoryIdempotencyStore` est un pilote de test, non durable, à ne jamais câbler en production.
 *
 * Déroulé : en-tête obligatoire sur POST/PUT/PATCH/DELETE (UUIDv7) ; la clé de stockage est l'empreinte SHA-256 de
 * (société, utilisateur, méthode, chemin, clé client) ; la première requête réserve atomiquement ; un rejeu au corps identique
 * (SHA-256 du corps et de la requête) renvoie la réponse mémorisée avec `Idempotent-Replayed: true` ; un corps différent donne
 * 422 ; une requête concurrente donne 409. Seules les réponses 2xx sont mémorisées, et seulement (statut, type de contenu,
 * corps) tels que la route les a rendus ; tout autre résultat libère la clé.
 */
import { createMiddleware } from 'hono/factory';
import { respondProblem, type ProblemInput } from './problem-details.ts';
import type { PipelineEnv } from './tenant-router.ts';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key' as const;
/** Nom d'en-tête de rejeu (convention usuelle ; la spécification n'en désigne pas) : voir le rapport du ticket. */
export const IDEMPOTENT_REPLAY_HEADER = 'Idempotent-Replayed' as const;
export const IDEMPOTENCY_TTL_MS = 72 * 60 * 60 * 1000;
/** Doc_07 § 01 : « UUIDv7 unique ». */
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const NO_COMPANY_SCOPE = '~';
const BASE64_CHUNK = 0x8000;

export interface StoredIdempotentResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly bodyBase64: string;
}

export type IdempotencyReservation =
  | { readonly outcome: 'RESERVED' }
  | { readonly outcome: 'IN_PROGRESS'; readonly fingerprint: string }
  | { readonly outcome: 'COMPLETED'; readonly fingerprint: string; readonly response: StoredIdempotentResponse };

/**
 * Port de stockage. `reserve` DOIT être atomique (test-and-set) : de deux appels simultanés sur la même `storeKey`, un seul
 * obtient RESERVED. Une entrée dont `expiresAtMs` est atteint est considérée absente.
 */
export interface IdempotencyStore {
  reserve(request: { readonly storeKey: string; readonly fingerprint: string; readonly nowMs: number; readonly expiresAtMs: number }): Promise<IdempotencyReservation>;
  complete(request: { readonly storeKey: string; readonly fingerprint: string; readonly response: StoredIdempotentResponse }): Promise<void>;
  release(request: { readonly storeKey: string; readonly fingerprint: string }): Promise<void>;
}

export interface InMemoryIdempotencyEntry {
  readonly key: string;
  readonly fingerprint: string;
  readonly state: 'IN_PROGRESS' | 'COMPLETED';
  readonly expiresAtMs: number;
  readonly response?: StoredIdempotentResponse;
}

export interface InMemoryIdempotencyStore extends IdempotencyStore {
  snapshot(): readonly InMemoryIdempotencyEntry[];
}

/** Pilote mémoire de TEST : atomique parce que `reserve` ne contient aucun `await` entre lecture et écriture. */
export function createInMemoryIdempotencyStore(): InMemoryIdempotencyStore {
  const entries = new Map<string, InMemoryIdempotencyEntry>();
  return {
    reserve: async ({ storeKey, fingerprint, nowMs, expiresAtMs }) => {
      const existing = entries.get(storeKey);
      if (existing !== undefined && nowMs < existing.expiresAtMs) {
        return existing.state === 'COMPLETED' && existing.response !== undefined
          ? { outcome: 'COMPLETED', fingerprint: existing.fingerprint, response: existing.response }
          : { outcome: 'IN_PROGRESS', fingerprint: existing.fingerprint };
      }
      entries.set(storeKey, { key: storeKey, fingerprint, state: 'IN_PROGRESS', expiresAtMs });
      return { outcome: 'RESERVED' };
    },
    complete: async ({ storeKey, fingerprint, response }) => {
      const existing = entries.get(storeKey);
      if (existing !== undefined && existing.fingerprint === fingerprint) {
        entries.set(storeKey, { ...existing, state: 'COMPLETED', response });
      }
    },
    release: async ({ storeKey, fingerprint }) => {
      const existing = entries.get(storeKey);
      if (existing !== undefined && existing.fingerprint === fingerprint && existing.state === 'IN_PROGRESS') {
        entries.delete(storeKey);
      }
    },
    snapshot: () => Array.from(entries.values()),
  };
}

// ---------------------------------------------------------------- empreintes

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(parts: readonly Uint8Array[]): Promise<string> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', joined)));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK));
  }
  return btoa(binary);
}

function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// ---------------------------------------------------------------- problèmes

const KEY_REQUIRED: ProblemInput = {
  status: 400,
  errorCode: 'IDEMPOTENCY_KEY_REQUIRED',
  title: "Clé d'idempotence requise",
  detail: `L'en-tête ${IDEMPOTENCY_KEY_HEADER} (UUIDv7) est requis sur les écritures.`,
};
const KEY_INVALID: ProblemInput = {
  status: 400,
  errorCode: 'IDEMPOTENCY_KEY_INVALID',
  title: "Clé d'idempotence invalide",
  detail: `L'en-tête ${IDEMPOTENCY_KEY_HEADER} doit être un UUIDv7.`,
};
const KEY_REUSED: ProblemInput = {
  status: 422,
  errorCode: 'IDEMPOTENCY_KEY_REUSED',
  title: "Clé d'idempotence réutilisée",
  detail: 'Cette clé a déjà servi pour une requête différente.',
};
const IN_PROGRESS: ProblemInput = {
  status: 409,
  errorCode: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
  title: 'Requête en cours',
  detail: 'Une requête avec cette clé est déjà en cours de traitement.',
};
const STORE_UNAVAILABLE: ProblemInput = {
  status: 503,
  errorCode: 'IDEMPOTENCY_UNAVAILABLE',
  title: "Garde d'idempotence indisponible",
  detail: "Une écriture ne s'exécute pas sans garde d'idempotence : réessayez plus tard.",
};

export interface IdempotencyDeps {
  readonly store: IdempotencyStore;
  /** Horloge injectée (millisecondes epoch). */
  readonly nowMs: () => number;
}

function replayResponse(stored: StoredIdempotentResponse): Response {
  const bytes = decodeBase64(stored.bodyBase64);
  const headers: Record<string, string> = { [IDEMPOTENT_REPLAY_HEADER]: 'true', 'Cache-Control': 'no-store' };
  if (stored.contentType !== null) {
    headers['Content-Type'] = stored.contentType;
  }
  return new Response(bytes.length === 0 ? null : bytes, { status: stored.status, headers });
}

async function safeRelease(store: IdempotencyStore, storeKey: string, fingerprint: string): Promise<void> {
  try {
    await store.release({ storeKey, fingerprint });
  } catch {
    // la réservation expirera avec son TTL.
  }
}

export function createIdempotencyMiddleware(deps: IdempotencyDeps) {
  return createMiddleware<PipelineEnv>(async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (!WRITE_METHODS.has(method)) {
      await next();
      return undefined;
    }
    const clientKey = c.req.header(IDEMPOTENCY_KEY_HEADER);
    if (clientKey === undefined) {
      return respondProblem(c, KEY_REQUIRED);
    }
    if (!UUID_V7_PATTERN.test(clientKey)) {
      return respondProblem(c, KEY_INVALID);
    }
    const tenant = c.get('tenant');
    const userId = tenant?.userId ?? c.get('auth')?.userId;
    if (userId === undefined) {
      throw new Error('Idempotency : utilisateur absent, l’authentification doit précéder.');
    }

    const body = new Uint8Array(await c.req.arrayBuffer());
    const search = new URL(c.req.url).search;
    const fingerprint = await sha256Hex([encoder.encode(search), Uint8Array.of(0), body]);
    const storeKey = await sha256Hex([
      encoder.encode(JSON.stringify(['v1', tenant?.companyId ?? NO_COMPANY_SCOPE, userId, method, c.req.path, clientKey.toLowerCase()])),
    ]);

    const nowMs = deps.nowMs();
    let reservation: IdempotencyReservation;
    try {
      reservation = await deps.store.reserve({ storeKey, fingerprint, nowMs, expiresAtMs: nowMs + IDEMPOTENCY_TTL_MS });
    } catch {
      return respondProblem(c, STORE_UNAVAILABLE);
    }
    if (reservation.outcome !== 'RESERVED') {
      if (reservation.fingerprint !== fingerprint) {
        return respondProblem(c, KEY_REUSED);
      }
      return reservation.outcome === 'COMPLETED' ? replayResponse(reservation.response) : respondProblem(c, IN_PROGRESS);
    }

    try {
      await next();
    } catch (error) {
      await safeRelease(deps.store, storeKey, fingerprint);
      throw error;
    }
    const response = c.res;
    if (response.status < 200 || response.status > 299) {
      await safeRelease(deps.store, storeKey, fingerprint);
      return undefined;
    }
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    try {
      await deps.store.complete({
        storeKey,
        fingerprint,
        response: { status: response.status, contentType: response.headers.get('Content-Type'), bodyBase64: encodeBase64(bytes) },
      });
    } catch {
      // la route a déjà agi : on garde la réservation (409 plutôt qu'un doublon comptable) jusqu'à l'expiration.
    }
    return undefined;
  });
}
