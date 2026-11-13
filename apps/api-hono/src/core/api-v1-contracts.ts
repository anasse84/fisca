/**
 * Contrats des routes REST v1 du socle (ticket T-S1B-12) : source unique de la colle des routes ET du document OpenAPI.
 * Les noms de route sont EXACTEMENT ceux de `fisca_contracts_registry` (CTR-API-10 à 13, puis 45 à 47 : lignes à inscrire par le propriétaire) ; aucune autre route n'est créée.
 */
import type { z } from 'zod';
import {
  CreateDraftRequestSchema,
  CreateDraftResponseSchema,
  HealthDeepResponseSchema,
  IceLookupResponseSchema,
  IceParamSchema,
  LedgerEntryParamSchema,
  PostEntryRequestSchema,
  PostEntryResponseSchema,
  ReconcileRequestSchema,
  ReconcileResponseSchema,
  SubmitEntryRequestSchema,
  SubmitEntryResponseSchema,
  VerifyChainQuerySchema,
  VerifyChainResponseSchema,
} from './api-v1-schemas.ts';

export type ApiMethod = 'get' | 'post';

export interface ApiResponseContract {
  readonly status: number;
  readonly description: string;
  readonly schema: z.ZodType;
}

export interface ApiRouteContract {
  readonly registryId: 'CTR-API-10' | 'CTR-API-11' | 'CTR-API-12' | 'CTR-API-13' | 'CTR-API-45' | 'CTR-API-46' | 'CTR-API-47';
  readonly method: ApiMethod;
  /** Syntaxe Hono (`:param`). */
  readonly path: string;
  readonly summary: string;
  readonly tag: string;
  /** `BEARER` : JWT de session ; `NONE` : route publique (sondes externes). */
  readonly auth: 'BEARER' | 'NONE';
  /** Exige `X-Fisca-Company-Id` ([A-Za-z0-9_-]{1,64} : décision du propriétaire, écart avec Doc_07 § 01 UUIDv7) ; false pour l'annuaire du plan de contrôle et la santé. */
  readonly companyHeader: boolean;
  /** Exige `Idempotency-Key` (UUIDv7, 72 h) : toute écriture. */
  readonly idempotencyKey: boolean;
  readonly params?: z.ZodType;
  /** Paramètres de requête (`?a=b`), objet strict. */
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  readonly success: readonly ApiResponseContract[];
  /** Statuts d'erreur possibles, tous en `application/problem+json`. */
  readonly errorStatuses: readonly number[];
}

export const API_V1_ROUTE_CONTRACTS: readonly ApiRouteContract[] = [
  {
    registryId: 'CTR-API-10',
    method: 'get',
    path: '/api/v1/directory/ice/:ice',
    summary: 'Enrichissement ICE : IF, RC, ADC450 (annuaire national).',
    tag: 'Identité & ICE',
    auth: 'BEARER',
    companyHeader: false,
    idempotencyKey: false,
    params: IceParamSchema,
    success: [{ status: 200, description: "Fiche de l'ICE.", schema: IceLookupResponseSchema }],
    errorStatuses: [400, 401, 404, 500],
  },
  {
    registryId: 'CTR-API-11',
    method: 'post',
    path: '/api/v1/ledger/entries/:id/post',
    summary: "Scellement SHA-256 immuable d'une pièce visée, ou contre-passation d'une pièce comptabilisée.",
    tag: 'Grand Livre',
    auth: 'BEARER',
    companyHeader: true,
    idempotencyKey: true,
    params: LedgerEntryParamSchema,
    body: PostEntryRequestSchema,
    success: [
      { status: 200, description: 'Pièce scellée (POSTED).', schema: PostEntryResponseSchema },
      { status: 201, description: 'Brouillon de contre-passation créé.', schema: PostEntryResponseSchema },
    ],
    errorStatuses: [400, 401, 403, 404, 409, 422, 503],
  },
  {
    registryId: 'CTR-API-12',
    method: 'post',
    path: '/api/v1/banking/reconcile',
    summary: 'Lettrage bancaire, suspens 3497/4497 et brouillon VAT_CLEARING.',
    tag: 'Achats & Banque',
    auth: 'BEARER',
    companyHeader: true,
    idempotencyKey: true,
    body: ReconcileRequestSchema,
    success: [
      { status: 200, description: 'Suspens ambigu (aucun lettrage automatique) ou aucun rapprochement.', schema: ReconcileResponseSchema },
      { status: 201, description: 'Lettrage effectué, brouillon VAT_CLEARING créé.', schema: ReconcileResponseSchema },
    ],
    errorStatuses: [400, 401, 403, 404, 409, 422, 503],
  },
  {
    registryId: 'CTR-API-13',
    method: 'get',
    path: '/api/v1/health/deep',
    summary: 'Santé profonde : lecture du plan de contrôle et accès au coffre légal (sondes externes).',
    tag: 'Observabilité',
    auth: 'NONE',
    companyHeader: false,
    idempotencyKey: false,
    success: [
      { status: 200, description: 'Toutes les dépendances répondent.', schema: HealthDeepResponseSchema },
      { status: 503, description: 'Au moins une dépendance est en panne.', schema: HealthDeepResponseSchema },
    ],
    errorStatuses: [],
  },
  {
    registryId: 'CTR-API-45',
    method: 'post',
    path: '/api/v1/ledger/entries',
    summary: "Création d'un brouillon d'écriture (DRAFT ou IA_PROPOSITION), lignes en centimes entiers.",
    tag: 'Grand Livre',
    auth: 'BEARER',
    companyHeader: true,
    idempotencyKey: true,
    body: CreateDraftRequestSchema,
    success: [{ status: 201, description: 'Brouillon créé.', schema: CreateDraftResponseSchema }],
    errorStatuses: [400, 401, 403, 404, 409, 422, 503],
  },
  {
    registryId: 'CTR-API-46',
    method: 'post',
    path: '/api/v1/ledger/entries/:id/submit',
    summary: "Vérification d'une proposition IA par l'aide-comptable (IA_PROPOSITION → DRAFT).",
    tag: 'Grand Livre',
    auth: 'BEARER',
    companyHeader: true,
    idempotencyKey: true,
    params: LedgerEntryParamSchema,
    body: SubmitEntryRequestSchema,
    success: [{ status: 200, description: 'Pièce passée en DRAFT.', schema: SubmitEntryResponseSchema }],
    errorStatuses: [400, 401, 403, 404, 409, 422, 503],
  },
  {
    registryId: 'CTR-API-47',
    method: 'get',
    path: '/api/v1/ledger/verify-chain',
    summary: "Vérification de la chaîne de hachage d'un journal (lecture ; une chaîne altérée est un résultat, pas une erreur).",
    tag: 'Grand Livre',
    auth: 'BEARER',
    companyHeader: true,
    idempotencyKey: false,
    query: VerifyChainQuerySchema,
    success: [{ status: 200, description: 'Verdict de la chaîne.', schema: VerifyChainResponseSchema }],
    errorStatuses: [400, 401, 403, 404, 503],
  },
];

export function contractOf(registryId: ApiRouteContract['registryId']): ApiRouteContract {
  const contract = API_V1_ROUTE_CONTRACTS.find((candidate) => candidate.registryId === registryId);
  if (contract === undefined) {
    throw new Error(`contrat inconnu : ${registryId}`);
  }
  return contract;
}
