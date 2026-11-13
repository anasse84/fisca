/**
 * Adaptateur SQL du port `IdempotencyStore` (ticket T-S1B-11 ; arbitrage du propriétaire : l'Idempotency-Key 72 h vit dans la
 * table `idempotency_records` de TENANT_DB, migration v10 de `@fisca/db-schema` ; `idempotency_keys` de la v7 est retirée), au-dessus
 * de `TenantSqlDriver` : D1, PostgreSQL ou tout pilote conforme (loi 11 : aucun accès direct à une base).
 *
 * Pourquoi la base du dossier : la clé et l'écriture comptable doivent être validées dans le MÊME lot atomique. `idempotencyCompleteStatement`
 * rend l'instruction `UPDATE` de `complete` pour qu'une route l'ajoute à son propre `executeBatchAtomically`.
 *
 * `reserve` : UN lot atomique (transaction) `DELETE` de la ligne expirée de cette clé puis `INSERT … ON CONFLICT DO NOTHING`
 * (statut IN_FLIGHT). Dans un lot sérialisé, l'insertion réussit si et seulement si la clé est absente ou expirée :
 * `totalChanges > 0` ⇔ RESERVED (la suppression d'un expiré est toujours suivie de l'insertion). Sinon la ligne gagnante est relue :
 * posée par un autre acteur ⇒ ACTOR_MISMATCH (jamais de rejeu d'une réponse d'un autre) ; IN_FLIGHT ⇒ IN_PROGRESS (409 côté
 * middleware) ; COMPLETED ⇒ réponse mémorisée. De deux `reserve` concurrents, un seul obtient RESERVED.
 *
 * `complete` : IN_FLIGHT → COMPLETED avec la réponse (une seule fois : `WHERE status = 'IN_FLIGHT'`). `release` : supprime une
 * réservation IN_FLIGHT, jamais une réponse COMPLETED. `purgeExpired(nowMs)` : supprime les lignes échues.
 *
 * Aucune horloge globale : le temps arrive en `nowMs` et `expiresAtMs`. `expires_at` est stocké en ISO 8601 UTC à largeur fixe
 * (`AAAA-MM-JJThh:mm:ss.mmmZ`, imposé par un CHECK). La ligne ne porte jamais la clé client, ni en-têtes, ni corps de requête :
 * seulement la clé de stockage (SHA-256), l'acteur, l'empreinte de la requête et la réponse rendue.
 */
import type { SqlParam, SqlStatementParams, TenantSqlDriver } from '@fisca/shared-types';
import type { IdempotencyReservation, IdempotencyStore, StoredIdempotentResponse } from './idempotency.ts';

const MAX_RESERVE_ATTEMPTS = 3;

export const IDEMPOTENCY_SQL = {
  deleteExpiredOfKey: 'DELETE FROM idempotency_records WHERE idempotency_key = ? AND expires_at <= ?',
  insertReservation: `INSERT INTO idempotency_records (idempotency_key, actor_id, request_sha256, status, response_status, response_body_json, content_type, expires_at)
    VALUES (?, ?, ?, 'IN_FLIGHT', NULL, NULL, NULL, ?) ON CONFLICT (idempotency_key) DO NOTHING`,
  selectByKey: `SELECT actor_id, request_sha256, status, response_status, response_body_json, content_type, expires_at
    FROM idempotency_records WHERE idempotency_key = ?`,
  complete: `UPDATE idempotency_records SET status = 'COMPLETED', response_status = ?, response_body_json = ?, content_type = ?
    WHERE idempotency_key = ? AND request_sha256 = ? AND status = 'IN_FLIGHT'`,
  release: "DELETE FROM idempotency_records WHERE idempotency_key = ? AND request_sha256 = ? AND status = 'IN_FLIGHT'",
  purgeExpired: 'DELETE FROM idempotency_records WHERE expires_at <= ?',
} as const;

interface StoredRow {
  readonly actor_id: string;
  readonly request_sha256: string;
  readonly status: string;
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
  throw new Error('idempotency_records : response_body_json illisible.');
}

function toReservation(row: StoredRow, actorId: string): IdempotencyReservation {
  if (row.actor_id !== actorId) {
    return { outcome: 'ACTOR_MISMATCH' };
  }
  if (row.status !== 'COMPLETED' || row.response_status === null || row.response_body_json === null) {
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
    reserve: async ({ storeKey, actorId, fingerprint, nowMs, expiresAtMs }) => {
      if (!(expiresAtMs > nowMs)) {
        throw new Error("idempotency_records : l'échéance doit être postérieure à la réservation.");
      }
      const nowIso = isoOf(nowMs);
      const batch: readonly SqlStatementParams[] = [
        { sql: IDEMPOTENCY_SQL.deleteExpiredOfKey, params: [storeKey, nowIso] },
        { sql: IDEMPOTENCY_SQL.insertReservation, params: [storeKey, actorId, fingerprint, isoOf(expiresAtMs)] },
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
          return toReservation(row, actorId);
        }
      }
      throw new Error('idempotency_records : réservation impossible après plusieurs tentatives.');
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
