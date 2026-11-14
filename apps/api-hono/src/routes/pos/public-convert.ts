/**
 * POST /api/v1/public/pos-qr/:qrToken/convert-b2b (CTR-API-17) : route PUBLIQUE, montée AVANT le pipeline authentifié (aucun JWT).
 * Garde dans l'ordre : limitation de débit + Turnstile (`guardRequest`, comme public/verify), jeton de forme valide, Idempotency-Key,
 * corps strict, limite de débit par jeton, résolution du dossier par le port `PublicPosTicketLookup` (aucun tenantId fourni par l'appelant),
 * puis `convertPosTicketToB2b` (logique du paquet). Jeton inconnu, mal formé ou hors fenêtre : 404 uniforme. UNIQUE(pos_ticket_id) et
 * conversion monotone : second scan = 409. Réponse minimale ; aucun ICE, raison sociale ni jeton dans les erreurs ni les journaux.
 */
import { guardRequest, type EdgeGuardDeps } from '@fisca/auth-rbac';
import type { TenantSqlDriver } from '@fisca/shared-types';
import { convertPosTicketToB2b, createSqlPosConversionStore, sha256HexUtf8, type PosB2bInvoicePort, type PosCertificationStarter, type PosReversalPort } from '@fisca/ubl-xades/pos';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_TTL_MS, IDEMPOTENT_REPLAY_HEADER } from '../../core/idempotency.ts';
import { newTraceId, problemForError, problemResponse, ProblemError, traceIdFromRequest, type ProblemInput, type TraceVariables } from '../../core/problem-details.ts';
import { parseWithSchema, readJsonBody } from '../../core/request-validation.ts';
import { createSqlIdempotencyStore } from '../../core/sql-idempotency-store.ts';
import { PUBLIC_VERIFY_HEADERS } from '../invoices/public-verify.ts';
import { ConvertB2bRequestSchema, ConvertB2bResponseSchema, QrTokenParamSchema } from './pos-route-schemas.ts';
import { translatedPos } from './problems.ts';

/** Dossier d'un jeton QR, résolu côté serveur (index public : SEAM_REQUEST db-schema). */
export interface ResolvedPosTenant {
  readonly companyId: string;
  readonly db: TenantSqlDriver;
}

export interface PublicPosTicketLookup {
  /** `null` : jeton inconnu. N'ouvre aucune base à partir d'un identifiant fourni par l'appelant. */
  resolveByQrToken(qrToken: string): Promise<ResolvedPosTenant | null>;
}

/** Ports de conversion d'UN dossier : fabriques d'instructions (facture B2B, extourne) et démarrage optionnel de la certification. */
export interface PosConversionExternalPorts {
  readonly invoices: PosB2bInvoicePort;
  readonly reversal: PosReversalPort;
  readonly certification?: PosCertificationStarter;
}

export interface PublicPosConvertDeps extends EdgeGuardDeps {
  readonly lookup: PublicPosTicketLookup;
  readonly conversionPortsFor: (tenant: ResolvedPosTenant) => PosConversionExternalPorts | Promise<PosConversionExternalPorts>;
  /** Fenêtre de conversion après Z (jours) : paramètre de déploiement. */
  readonly conversionWindowDays: number;
  readonly clock: { nowMs(): number; nowIso(): string };
  readonly ids: { newId(): string };
}

export const PUBLIC_POS_CONVERT_PATH = '/api/v1/public/pos-qr/:qrToken/convert-b2b' as const;
const ROUTE_KEY = 'pos-qr-convert';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_TYPE = 'application/json';
const PUBLIC_ACTOR = 'public-pos-qr';

const fixed = (status: number, errorCode: string, title: string, detail: string): ProblemInput => ({ status, errorCode, title, detail });
const NOT_FOUND = fixed(404, 'POS_QR_NOT_FOUND', 'Ticket introuvable', 'Aucun ticket convertible ne correspond à ce code.');
const KEY_REQUIRED = fixed(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key requise', 'Cet appel exige un en-tête Idempotency-Key.');
const KEY_INVALID = fixed(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key invalide', "L'Idempotency-Key doit être un UUID v7.");
const KEY_CONFLICT = fixed(409, 'IDEMPOTENCY_KEY_CONFLICT', "Conflit d'idempotence", 'Cette clé est déjà utilisée pour une autre demande ou est en cours de traitement.');
const TOKEN_RATE_LIMITED = fixed(429, 'RATE_LIMITED', 'Trop de requêtes', 'Limite de débit dépassée, réessayez plus tard.');

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}
const encodeBase64 = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

export function createPublicPosConvertRoute(deps: PublicPosConvertDeps): Hono<{ Variables: TraceVariables }> {
  const app = new Hono<{ Variables: TraceVariables }>();
  // `instance` reprend le GABARIT de la route : le jeton QR (secret porteur) n'est jamais renvoyé ni journalisé.
  app.onError((error, c) => problemResponse(problemForError(error), c.get('traceId') ?? newTraceId(), PUBLIC_POS_CONVERT_PATH));
  app.use(
    PUBLIC_POS_CONVERT_PATH,
    createMiddleware<{ Variables: TraceVariables }>(async (c, next) => {
      c.set('traceId', traceIdFromRequest(c.req.header('traceparent'), newTraceId));
      await next();
      for (const [name, value] of Object.entries(PUBLIC_VERIFY_HEADERS)) c.res.headers.set(name, value);
    }),
  );
  app.post(PUBLIC_POS_CONVERT_PATH, async (c) => {
    const refused = await guardRequest(deps, c, ROUTE_KEY);
    if (refused !== null) return refused;
    const token = QrTokenParamSchema.safeParse(c.req.param());
    if (!token.success) throw new ProblemError(NOT_FOUND);
    const { qrToken } = token.data;
    const clientKey = c.req.header(IDEMPOTENCY_KEY_HEADER);
    if (clientKey === undefined) throw new ProblemError(KEY_REQUIRED);
    if (!UUID_V7.test(clientKey)) throw new ProblemError(KEY_INVALID);
    const body = parseWithSchema(ConvertB2bRequestSchema, await readJsonBody(() => c.req.text()));
    if (!(await deps.rateLimiter.allow(`pos-qr:token:${qrToken}`))) throw new ProblemError(TOKEN_RATE_LIMITED);

    const tenant = await deps.lookup.resolveByQrToken(qrToken);
    if (tenant === null) throw new ProblemError(NOT_FOUND);

    const store = createSqlIdempotencyStore(tenant.db);
    const storeKey = `pos-qr:${qrToken}:${clientKey.toLowerCase()}`;
    const fingerprint = await sha256HexUtf8(JSON.stringify([body.clientIce, body.clientLegalName ?? null]));
    const nowMs = deps.clock.nowMs();
    const reservation = await store.reserve({ storeKey, actorId: PUBLIC_ACTOR, fingerprint, nowMs, expiresAtMs: nowMs + IDEMPOTENCY_TTL_MS });
    if (reservation.outcome === 'COMPLETED' && reservation.fingerprint === fingerprint) {
      return new Response(decodeBase64(reservation.response.bodyBase64), { status: reservation.response.status, headers: { 'Content-Type': JSON_TYPE, [IDEMPOTENT_REPLAY_HEADER]: 'true', 'Cache-Control': 'no-store' } });
    }
    if (reservation.outcome !== 'RESERVED') throw new ProblemError(KEY_CONFLICT);

    try {
      const external = await deps.conversionPortsFor(tenant);
      const result = await translatedPos(() =>
        convertPosTicketToB2b(
          { store: createSqlPosConversionStore(tenant.db), invoices: external.invoices, reversal: external.reversal, clock: deps.clock, ids: deps.ids, ...(external.certification === undefined ? {} : { certification: external.certification }) },
          { conversionWindowDays: deps.conversionWindowDays },
          { qrToken, clientIce: body.clientIce, clientLegalName: body.clientLegalName ?? null },
        ),
      );
      const payload = JSON.stringify(ConvertB2bResponseSchema.parse({ conversionState: result.state, invoiceRef: result.invoiceId, certificationPending: result.certificationPending }));
      await store.complete({ storeKey, fingerprint, response: { status: 200, contentType: JSON_TYPE, bodyBase64: encodeBase64(payload) } });
      return new Response(payload, { status: 200, headers: { 'Content-Type': JSON_TYPE } });
    } catch (error) {
      await store.release({ storeKey, fingerprint }).catch(() => undefined);
      throw error;
    }
  });
  return app;
}
