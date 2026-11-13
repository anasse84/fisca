/**
 * Routeur Hono de la connexion par mot de passe (CTR-API-03, Doc_07 § 02 : Turnstile + anti-bruteforce).
 * Logique et Hono vivent ici (ERRATA B-02) ; apps/api-hono/src/routes/auth ne contient que la colle.
 * Ordre : limitation de débit, Turnstile (jeton en paramètre de requête, comme les autres routes d'auth), corps,
 * puis loginWithPassword (verrouillage par compte).
 */

import { Hono } from 'hono';
import { firstFactorResponse, problemResponse } from './first-factor-response.ts';
import type { ProblemSpec } from './first-factor-response.ts';
import { LoginError, loginWithPassword } from './login.ts';
import type { LoginDeps } from './login.ts';
import { TURNSTILE_QUERY_PARAM } from './oauth-google-routes.ts';
import type { RateLimiter, TurnstileVerifier } from './oauth-google-routes.ts';

export const LOGIN_PATH = '/api/v1/auth/login' as const;
const CLIENT_IP_HEADER = 'CF-Connecting-IP';
const UNKNOWN_CLIENT = 'inconnu';

export interface LoginRouterDeps extends LoginDeps {
  readonly turnstile: TurnstileVerifier;
  readonly rateLimiter: RateLimiter;
}

const RATE_LIMITED: ProblemSpec = { status: 429, title: 'Trop de requêtes', detail: 'Limite de débit dépassée, réessayez plus tard.' };
const TURNSTILE_REQUIRED: ProblemSpec = { status: 403, title: 'Vérification anti-bot requise', detail: 'La vérification Turnstile est requise.' };
const REQUEST_INVALID: ProblemSpec = { status: 400, title: 'Requête invalide', detail: 'Le corps de la requête est invalide.' };
const INVALID_CREDENTIALS: ProblemSpec = { status: 401, title: 'Identifiants invalides', detail: 'E-mail ou mot de passe incorrect.' };
const ACCOUNT_LOCKED: ProblemSpec = {
  status: 429,
  title: 'Compte temporairement verrouillé',
  detail: 'Trop d’échecs consécutifs : réessayez plus tard.',
};

function clientIp(headers: Headers): string | null {
  const value = headers.get(CLIENT_IP_HEADER);
  return value === null || value.length === 0 ? null : value;
}

export function createLoginRouter(deps: LoginRouterDeps): Hono {
  const app = new Hono();

  app.post(LOGIN_PATH, async (c) => {
    const ip = clientIp(c.req.raw.headers);
    if (!(await deps.rateLimiter.allow(`auth:login:${ip ?? UNKNOWN_CLIENT}`))) {
      return problemResponse('RATE_LIMITED', RATE_LIMITED);
    }
    if (!(await deps.turnstile.verify({ token: c.req.query(TURNSTILE_QUERY_PARAM) ?? null, remoteIp: ip }))) {
      return problemResponse('TURNSTILE_REQUIRED', TURNSTILE_REQUIRED);
    }
    let parsed: unknown;
    try {
      parsed = await c.req.json();
    } catch {
      return problemResponse('REQUEST_INVALID', REQUEST_INVALID);
    }
    const body = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed)) : null;
    const emailValue = body?.['email'];
    const passwordValue = body?.['password'];
    if (typeof emailValue !== 'string' || emailValue.length === 0 || typeof passwordValue !== 'string' || passwordValue.length === 0) {
      return problemResponse('REQUEST_INVALID', REQUEST_INVALID);
    }
    try {
      const outcome = await loginWithPassword(deps, { email: emailValue, password: passwordValue });
      return firstFactorResponse(c, outcome);
    } catch (error) {
      if (error instanceof LoginError) {
        return error.code === 'LOGIN_ACCOUNT_LOCKED'
          ? problemResponse(error.code, ACCOUNT_LOCKED, { 'Retry-After': String(error.retryAfterSec) })
          : problemResponse(error.code, INVALID_CREDENTIALS);
      }
      throw error;
    }
  });

  return app;
}
