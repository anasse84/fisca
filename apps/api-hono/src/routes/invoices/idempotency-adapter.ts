/** Colle : adapte `IdempotencyStore` (SqlIdempotencyStore sur la base du dossier) au port de soumission du moteur de clearance. */
import { CLEARANCE_ACTOR_ID, type StoredSubmission, type SubmissionIdempotencyPort } from '@fisca/ubl-xades/clearance';
import { z } from 'zod';
import type { IdempotencyStore } from '../../core/idempotency.ts';

/** Durée de conservation de la clé : 72 h (même durée que l'Idempotency-Key HTTP du socle). */
const KEY_TTL_MS = 72 * 3_600_000;
const JSON_TYPE = 'application/json';

const StoredSubmissionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('CLEARED'), xhubUuid: z.string(), receivedAt: z.string() }),
  z.strictObject({ kind: z.literal('REJECTED'), code: z.string() }),
]);

function encode(stored: StoredSubmission): string {
  return btoa(JSON.stringify(stored));
}

function decode(bodyBase64: string): StoredSubmission | null {
  try {
    const parsed = StoredSubmissionSchema.safeParse(JSON.parse(atob(bodyBase64)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createSubmissionIdempotencyPort(store: IdempotencyStore): SubmissionIdempotencyPort {
  return {
    async reserve(key, fingerprint, nowMs) {
      const reservation = await store.reserve({ storeKey: key, actorId: CLEARANCE_ACTOR_ID, fingerprint, nowMs, expiresAtMs: nowMs + KEY_TTL_MS });
      if (reservation.outcome === 'RESERVED') return { outcome: 'RESERVED' };
      if (reservation.outcome === 'ACTOR_MISMATCH') return { outcome: 'CONFLICT' };
      if (reservation.fingerprint !== fingerprint) return { outcome: 'CONFLICT' };
      if (reservation.outcome === 'IN_PROGRESS') return { outcome: 'IN_PROGRESS' };
      const stored = decode(reservation.response.bodyBase64);
      return stored === null ? { outcome: 'CONFLICT' } : { outcome: 'COMPLETED', stored };
    },
    complete: (key, fingerprint, stored) =>
      store.complete({ storeKey: key, fingerprint, response: { status: stored.kind === 'CLEARED' ? 200 : 422, contentType: JSON_TYPE, bodyBase64: encode(stored) } }),
    release: (key, fingerprint) => store.release({ storeKey: key, fingerprint }),
  };
}
