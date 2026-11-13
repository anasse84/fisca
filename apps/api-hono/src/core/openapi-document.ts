/**
 * Génération maison du document OpenAPI 3.1 (ticket T-S1B-12 ; ERRATA D-18) à partir des schémas Zod 4 de
 * `api-v1-contracts.ts` (`z.toJSONSchema`). Décision : pas de `@hono/zod-openapi` (voir le rapport) ; le document est un
 * artefact GÉNÉRÉ, jamais commité (`pnpm --filter @fisca/api-hono openapi:gen`).
 */
import { z } from 'zod';
import { API_V1_ROUTE_CONTRACTS, type ApiRouteContract } from './api-v1-contracts.ts';
import { ProblemBodySchema } from './api-v1-schemas.ts';
import { COMPANY_ID_HEADER } from './tenant-router.ts';
import { IDEMPOTENCY_KEY_HEADER } from './idempotency.ts';

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
type JsonObject = { readonly [key: string]: Json };

const PROBLEM_REF = { $ref: '#/components/schemas/Problem' } as const;
const PROBLEM_MEDIA = 'application/problem+json';
const ERROR_DESCRIPTIONS: Readonly<Record<number, string>> = {
  400: 'Requête invalide (corps, paramètre ou en-tête).',
  401: 'Authentification requise.',
  403: 'Accès refusé (dossier, rôle, Step-Up ou lecture seule).',
  404: 'Ressource introuvable.',
  409: "Conflit d'état ou de concurrence.",
  422: "Clé d'idempotence réutilisée pour une autre requête.",
  500: 'Erreur interne.',
  503: 'Dépendance momentanément indisponible.',
};

export function openApiPathOf(honoPath: string): string {
  return honoPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function schemaOf(schema: z.ZodType): JsonObject {
  const generated = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as JsonObject;
  return Object.fromEntries(Object.entries(generated).filter(([key]) => key !== '$schema'));
}

function pathParameters(contract: ApiRouteContract): readonly JsonObject[] {
  if (contract.params === undefined) {
    return [];
  }
  const generated = schemaOf(contract.params);
  const properties = generated['properties'];
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return [];
  }
  return Object.entries(properties).map(([name, schema]) => ({ name, in: 'path', required: true, schema }));
}

function headerParameters(contract: ApiRouteContract): readonly JsonObject[] {
  const headers: JsonObject[] = [];
  if (contract.companyHeader) {
    headers.push({
      name: COMPANY_ID_HEADER,
      in: 'header',
      required: true,
      description: 'UUIDv7 du dossier, vérifié côté serveur contre les appartenances et les mandats (ERRATA D-16).',
      schema: { type: 'string', format: 'uuid' },
    });
  }
  if (contract.idempotencyKey) {
    headers.push({
      name: IDEMPOTENCY_KEY_HEADER,
      in: 'header',
      required: true,
      description: 'UUIDv7 unique, conservé 72 heures : un rejeu identique renvoie la réponse mémorisée.',
      schema: { type: 'string', format: 'uuid' },
    });
  }
  return headers;
}

function operationOf(contract: ApiRouteContract): JsonObject {
  const responses: Record<string, Json> = {};
  for (const success of contract.success) {
    responses[String(success.status)] = {
      description: success.description,
      content: { 'application/json': { schema: schemaOf(success.schema) } },
    };
  }
  for (const status of contract.errorStatuses) {
    responses[String(status)] = { description: ERROR_DESCRIPTIONS[status] ?? 'Erreur.', content: { [PROBLEM_MEDIA]: { schema: PROBLEM_REF } } };
  }
  return {
    operationId: contract.registryId,
    summary: contract.summary,
    tags: [contract.tag],
    ...(contract.auth === 'BEARER' ? { security: [{ bearerAuth: [] }] } : { security: [] }),
    parameters: [...pathParameters(contract), ...headerParameters(contract)],
    ...(contract.body === undefined ? {} : { requestBody: { required: true, content: { 'application/json': { schema: schemaOf(contract.body) } } } }),
    responses,
  };
}

export function buildOpenApiDocument(contracts: readonly ApiRouteContract[] = API_V1_ROUTE_CONTRACTS): JsonObject {
  const paths: Record<string, Record<string, Json>> = {};
  for (const contract of contracts) {
    const key = openApiPathOf(contract.path);
    paths[key] = { ...(paths[key] ?? {}), [contract.method]: operationOf(contract) };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Fisca API v1 : socle comptable',
      version: '1.0.0',
      description: 'Document généré à partir des schémas Zod (ERRATA D-18) : artefact non commité.',
    },
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: { Problem: schemaOf(ProblemBodySchema) },
    },
  };
}
