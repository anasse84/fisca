/**
 * Garde commun des routes de session et de passkeys (CTR-API-35 à 40) : limitation de débit, puis Turnstile
 * (jeton en paramètre de requête `cf-turnstile-response`, comme les routes voisines), lecture JSON et gestion
 * d'erreurs problem+json. Aucune dépendance au-delà de Hono (ERRATA B-02).
 */

import type { Context } from 'hono';
import { problemResponse } from './first-factor-response.ts';
import type { ProblemSpec } from './first-factor-response.ts';
import { TURNSTILE_QUERY_PARAM } from './oauth-google-routes.ts';
import type { RateLimiter, TurnstileVerifier } from './oauth-google-routes.ts';

const CLIENT_IP_HEADER = 'CF-Connecting-IP';
const UNKNOWN_CLIENT = 'inconnu';

export interface EdgeGuardDeps {
  readonly turnstile: TurnstileVerifier;
  readonly rateLimiter: RateLimiter;
}

export const RATE_LIMITED: ProblemSpec = { status: 429, title: 'Trop de requêtes', detail: 'Limite de débit dépassée, réessayez plus tard.' };
export const TURNSTILE_REQUIRED: ProblemSpec = { status: 403, title: 'Vérification anti-bot requise', detail: 'La vérification Turnstile est requise.' };
export const AUTH_REQUIRED: ProblemSpec = { status: 401, title: 'Authentification requise', detail: 'Une session active est requise.' };
export const REQUEST_INVALID: ProblemSpec = { status: 400, title: 'Requête invalide', detail: 'Le corps de la requête est invalide.' };
export const INTERNAL_ERROR: ProblemSpec = { status: 500, title: 'Erreur interne', detail: 'Une erreur interne est survenue.' };

/** Réponse problem+json 500 sans détail interne : à brancher sur `app.onError` (Hono 4 : `(err, c) => Response`). */
export function internalErrorResponse(): Response {
  return problemResponse('INTERNAL_ERROR', INTERNAL_ERROR);
}

function clientIp(headers: Headers): string | null {
  const value = headers.get(CLIENT_IP_HEADER);
  return value === null || value.length === 0 ? null : value;
}

/** Limitation de débit puis Turnstile ; renvoie une réponse d'échec ou null si la requête peut continuer. */
export async function guardRequest(deps: EdgeGuardDeps, c: Context, routeKey: string): Promise<Response | null> {
  const ip = clientIp(c.req.raw.headers);
  if (!(await deps.rateLimiter.allow(`auth:${routeKey}:${ip ?? UNKNOWN_CLIENT}`))) {
    return problemResponse('RATE_LIMITED', RATE_LIMITED);
  }
  const verified = await deps.turnstile.verify({ token: c.req.query(TURNSTILE_QUERY_PARAM) ?? null, remoteIp: ip });
  return verified ? null : problemResponse('TURNSTILE_REQUIRED', TURNSTILE_REQUIRED);
}

/**
 * Limitation de débit seule, sans Turnstile : pour une route appelée en arrière-plan qui ne peut pas présenter de
 * défi (refresh silencieux). Renvoie une réponse 429 ou null.
 */
export async function guardRateOnly(deps: Pick<EdgeGuardDeps, 'rateLimiter'>, c: Context, routeKey: string): Promise<Response | null> {
  const ip = clientIp(c.req.raw.headers);
  return (await deps.rateLimiter.allow(`auth:${routeKey}:${ip ?? UNKNOWN_CLIENT}`)) ? null : problemResponse('RATE_LIMITED', RATE_LIMITED);
}

/** Corps JSON sous forme d'objet ; null si le corps est absent, illisible ou n'est pas un objet. */
export async function readJsonObject(c: Context): Promise<Record<string, unknown> | null> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return Object.fromEntries(Object.entries(parsed));
}
