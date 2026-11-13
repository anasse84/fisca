/**
 * Adaptateur SQL du port `IdempotencyStore` (ticket T-S1B-11, complément ; décision du pilote : l'Idempotency-Key 72 h vit dans
 * la table `idempotency_keys` de TENANT_DB, migration v7 de `@fisca/db-schema`), au-dessus de `TenantSqlDriver` : D1, PostgreSQL
 * ou tout pilote conforme (loi 11 : aucun accès direct à une base).
 *
 * Pourquoi la base du dossier : la clé et l'écriture comptable doivent être validées dans le MÊME lot atomique. `completeStatement`
 * rend l'instruction `UPDATE` de `complete` pour qu'une route l'ajoute à son propre `executeBatchAtomically`.
 *
 * `reserve` : UN lot atomique `DELETE` de la ligne expirée de cette clé puis `INSERT … ON CONFLICT DO NOTHING`. Dans un lot
 * sérialisé, l'insertion réussit si et seulement si la clé est absente ou expirée : `totalChanges > 0` ⇔ RESERVED (la
 * suppression d'un expiré est toujours suivie de l'insertion, donc le total ne peut pas être positif sans insertion). Sinon la
 * ligne gagnante est relue. De deux `reserve` concurrents, un seul obtient RESERVED.
 *
 * Aucune horloge globale : le temps arrive en `nowMs` et `expiresAtMs`. Les instants sont stockés en ISO 8601 UTC à largeur fixe.
 * La ligne ne porte jamais la clé client, ni en-têtes, ni corps de requête : seulement la clé de stockage (SHA-256), l'empreinte
 * de la requête et la réponse rendue.
 */
import type { SqlParam, SqlStatementParams, TenantSqlDriver } from '@fisca/shared-types';
import type { IdempotencyReservation, IdempotencyStore, StoredIdempotentResponse } from './idempotency.ts';

const MAX_RESERVE_ATTEMPTS = 3;

export const IDEMPOTENCY_SQL = {
  deleteExpiredOfKey: 'DELETE FROM idempotency_keys WHERE idempotency_key = ? AND expires_at <= ?',
  insertReservation: `INSERT INTO idempotency_keys (idempotency_key, request_sha256, response_status, response_body_json, content_type, created_at, expires_at)
    VALUES (?, ?, NULL, NULL, NULL, ?, ?) ON CONFLICT (idempotency_key) DO NOTHING`,
  selectByKey: `SELECT request_sha256, response_status, response_body_json, content_type, expires_at
    FROM idempotency_keys WHERE idempotency_key = ?`,
  complete: `UPDATE idempotency_keys SET response_status = ?, response_body_json = ?, content_type = ?
    WHERE idempotency_key = ? AND request_sha256 = ?`,
  release: 'DELETE FROM idempotency_keys WHERE idempotency_key = ? AND request_sha256 = ? AND response_status IS NULL',
  purgeExpired: 'DELETE FROM idempotency_keys WHERE expires_at <= ?',
} as const;

interface StoredRow {
  readonly request_sha256: string;
  readonly response_status: number | string | null;
  readonly response_body_json: string | null;
  readonly content_type: string | null;
  readonly expires_at: string;
}

export interface SqlIdempotencyStore extends IdempotencyStore {
  /** Supprime les entrées dont `expires_at` est atteint à `nowMs` ; rend le nombre de lignes supprimées. */
  purgeExpired(nowMs: number): Promise<number>;
}

function isoOf(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Instruction de `complete`, à joindre au lot atomique de l'écriture comptable. */
export function idempotencyCompleteStatement(request: {
  readonly storeKey: string;
  readonly fingerprint: string;
  readonly response: StoredIdempotentResponse;
}): SqlStatementParams {
  return {
    sql: IDEMPOTENCY_SQL.complete,
    params: [
      request.response.status,
      JSON.stringify({ bodyBase64: request.response.bodyBase64 }),
      request.response.contentType,
      request.storeKey,
      request.fingerprint,
    ],
  };
}

function parseBodyBase64(json: string): string {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed === 'object' && parsed !== null && 'bodyBase64' in parsed && typeof parsed.bodyBase64 === 'string') {
    return parsed.bodyBase64;
  }
  throw new Error('idempotency_keys : response_body_json illisible.');
}

function toReservation(row: StoredRow): IdempotencyReservation {
  if (row.response_status === null || row.response_body_json === null) {
    return { outcome: 'IN_PROGRESS', fingerprint: row.request_sha256 };
  }
  return {
    outcome: 'COMPLETED',
    fingerprint: row.request_sha256,
    response: {
      status: Number(row.response_status),
      contentType: row.content_type,
      bodyBase64: parseBodyBase64(row.response_body_json),
    },
  };
}

export function createSqlIdempotencyStore(driver: TenantSqlDriver): SqlIdempotencyStore {
  return {
    reserve: async ({ storeKey, fingerprint, nowMs, expiresAtMs }) => {
      const nowIso = isoOf(nowMs);
      const batch: readonly SqlStatementParams[] = [
        { sql: IDEMPOTENCY_SQL.deleteExpiredOfKey, params: [storeKey, nowIso] },
        { sql: IDEMPOTENCY_SQL.insertReservation, params: [storeKey, fingerprint, nowIso, isoOf(expiresAtMs)] },
      ];
      for (let attempt = 0; attempt < MAX_RESERVE_ATTEMPTS; attempt += 1) {
        const { totalChanges } = await driver.executeBatchAtomically(batch);
        if (totalChanges > 0) {
          return { outcome: 'RESERVED' };
        }
        const rows = await driver.query<StoredRow>({ sql: IDEMPOTENCY_SQL.selectByKey, params: [storeKey] });
        const row = rows[0];
        // Absente (libérée ou purgée entre-temps) ou expirée : on retente le lot.
        if (row !== undefined && row.expires_at > nowIso) {
          return toReservation(row);
        }
      }
      throw new Error("idempotency_keys : réservation impossible après plusieurs tentatives.");
    },
    complete: async (request) => {
      await driver.executeBatchAtomically([idempotencyCompleteStatement(request)]);
    },
    release: async ({ storeKey, fingerprint }) => {
      const params: readonly SqlParam[] = [storeKey, fingerprint];
      await driver.executeBatchAtomically([{ sql: IDEMPOTENCY_SQL.release, params }]);
    },
    purgeExpired: async (nowMs) => {
      const { totalChanges } = await driver.executeBatchAtomically([{ sql: IDEMPOTENCY_SQL.purgeExpired, params: [isoOf(nowMs)] }]);
      return totalChanges;
    },
  };
}
