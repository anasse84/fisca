/**
 * Routeur Hono du 2FA (CTR-API-07, CTR-API-08, CTR-API-09 ; Doc_09 § 02, Doc_07 § 02).
 *
 * Hono et toute la logique vivent ici, dans le paquet (ERRATA B-02) ; apps/api-hono/src/routes/auth ne contient
 * que la colle. Registre : « Turnstile + limitation de débit » sur les trois routes, auquel s'ajoute l'authentification
 * propre à chacune (Doc_07 § 02) : session JWT active (setup, enable) ou mfa_challenge_token (verify).
 * Ordre : limitation de débit, Turnstile (jeton en paramètre de requête, comme le courtier Google), authentification,
 * lecture du corps.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ProblemDetails } from '@fisca/shared-types';
import { MfaError } from './auth-2fa.ts';
import type { MfaErrorCode } from './auth-2fa.ts';
import { SECOND_FACTOR_METHODS, completeMfaChallenge, enableTotp, setupTotp } from './mfa-engine.ts';
import type { AuthenticatedUser, MfaEngineDeps, MfaSessionAuthenticator, SecondFactorMethod } from './mfa-engine.ts';
import { TURNSTILE_QUERY_PARAM } from './oauth-google-routes.ts';
import type { RateLimiter, TurnstileVerifier } from './oauth-google-routes.ts';

export const TOTP_SETUP_PATH = '/api/v1/auth/2fa/totp/setup' as const;
export const TOTP_ENABLE_PATH = '/api/v1/auth/2fa/totp/enable' as const;
export const MFA_VERIFY_PATH = '/api/v1/auth/2fa/verify' as const;
const CLIENT_IP_HEADER = 'CF-Connecting-IP';
const UNKNOWN_CLIENT = 'inconnu';

export interface MfaRouterDeps extends MfaEngineDeps {
  readonly authenticator: MfaSessionAuthenticator;
  readonly turnstile: TurnstileVerifier;
  readonly rateLimiter: RateLimiter;
}

type ProblemStatus = 400 | 401 | 403 | 409 | 429;

interface ProblemSpec {
  readonly status: ProblemStatus;
  readonly title: string;
  readonly detail: string;
}

const MFA_PROBLEMS: Readonly<Record<MfaErrorCode, ProblemSpec>> = {
  TOTP_INVALID_BASE32_SECRET: { status: 409, title: 'Secret TOTP invalide', detail: 'Le secret TOTP enregistré est invalide, relancez le setup.' },
  TOTP_SETUP_REQUIRED: { status: 409, title: 'Setup TOTP requis', detail: 'Appelez d’abord le setup du TOTP.' },
  TOTP_ALREADY_ENABLED: { status: 409, title: '2FA déjà actif', detail: 'Le 2FA TOTP est déjà actif pour ce compte.' },
  TOTP_CODE_INVALID: { status: 401, title: 'Code invalide', detail: 'Le code TOTP est invalide.' },
  MFA_SIGNING_KEY_INVALID: { status: 401, title: 'Défi MFA invalide', detail: 'Le défi MFA ne peut pas être vérifié.' },
  MFA_CHALLENGE_MALFORMED: { status: 401, title: 'Défi MFA invalide', detail: 'Le jeton de défi MFA est invalide.' },
  MFA_CHALLENGE_SIGNATURE_INVALID: { status: 401, title: 'Défi MFA invalide', detail: 'Le jeton de défi MFA est invalide.' },
  MFA_CHALLENGE_EXPIRED: { status: 401, title: 'Défi MFA expiré', detail: 'Le défi MFA a expiré, recommencez la connexion.' },
  MFA_CHALLENGE_USER_MISMATCH: { status: 403, title: 'Défi MFA refusé', detail: 'Le défi MFA n’appartient pas à cet utilisateur.' },
  MFA_CHALLENGE_REPLAYED: { status: 401, title: 'Défi MFA déjà utilisé', detail: 'Le défi MFA a déjà été utilisé, recommencez la connexion.' },
  MFA_CHALLENGE_ATTEMPTS_EXHAUSTED: { status: 429, title: 'Trop d’essais', detail: 'Trop d’essais : recommencez la connexion.' },
  MFA_FACTOR_NOT_ENROLLED: { status: 409, title: 'Second facteur absent', detail: 'Aucun second facteur actif pour ce compte.' },
  MFA_METHOD_UNAVAILABLE: { status: 400, title: 'Méthode indisponible', detail: 'Cette méthode de second facteur n’est pas disponible.' },
  MFA_CODE_INVALID: { status: 401, title: 'Code invalide', detail: 'Le code de second facteur est invalide.' },
};

const RATE_LIMITED: ProblemSpec = { status: 429, title: 'Trop de requêtes', detail: 'Limite de débit dépassée, réessayez plus tard.' };
const TURNSTILE_REQUIRED: ProblemSpec = { status: 403, title: 'Vérification anti-bot requise', detail: 'La vérification Turnstile est requise.' };
const AUTH_REQUIRED: ProblemSpec = { status: 401, title: 'Authentification requise', detail: 'Une session active est requise.' };
const REQUEST_INVALID: ProblemSpec = { status: 400, title: 'Requête invalide', detail: 'Le corps de la requête est invalide.' };

function problemResponse(errorCode: string, spec: ProblemSpec): Response {
  const body: ProblemDetails = {
    type: 'about:blank',
    title: spec.title,
    status: spec.status,
    errorCode,
    traceId: crypto.randomUUID(),
    detail: spec.detail,
  };
  return new Response(JSON.stringify(body), {
    status: spec.status,
    headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' },
  });
}

function clientIp(headers: Headers): string | null {
  const value = headers.get(CLIENT_IP_HEADER);
  return value === null || value.length === 0 ? null : value;
}

/** Limitation de débit puis Turnstile ; renvoie une réponse d'échec ou null si la requête peut continuer. */
async function guard(deps: MfaRouterDeps, c: Context, routeKey: string): Promise<Response | null> {
  const ip = clientIp(c.req.raw.headers);
  if (!(await deps.rateLimiter.allow(`auth:2fa:${routeKey}:${ip ?? UNKNOWN_CLIENT}`))) {
    return problemResponse('RATE_LIMITED', RATE_LIMITED);
  }
  const verified = await deps.turnstile.verify({ token: c.req.query(TURNSTILE_QUERY_PARAM) ?? null, remoteIp: ip });
  return verified ? null : problemResponse('TURNSTILE_REQUIRED', TURNSTILE_REQUIRED);
}

async function authenticate(deps: MfaRouterDeps, c: Context): Promise<AuthenticatedUser | null> {
  return deps.authenticator.authenticate({
    authorization: c.req.header('Authorization') ?? null,
    cookie: c.req.header('Cookie') ?? null,
  });
}

async function readJsonObject(c: Context): Promise<Record<string, unknown> | null> {
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

function isSecondFactorMethod(value: unknown): value is SecondFactorMethod {
  return SECOND_FACTOR_METHODS.some((method) => method === value);
}

function mfaProblem(error: MfaError): Response {
  return problemResponse(error.code, MFA_PROBLEMS[error.code]);
}

export function createMfaRouter(deps: MfaRouterDeps): Hono {
  const app = new Hono();

  app.post(TOTP_SETUP_PATH, async (c) => {
    const blocked = await guard(deps, c, 'totp-setup');
    if (blocked !== null) {
      return blocked;
    }
    const user = await authenticate(deps, c);
    if (user === null) {
      return problemResponse('AUTH_REQUIRED', AUTH_REQUIRED);
    }
    try {
      const result = await setupTotp(deps, { userId: user.userId, accountLabel: user.accountLabel });
      c.header('Cache-Control', 'no-store');
      return c.json({ secret: result.secret, otpauthUri: result.otpauthUri }, 200);
    } catch (error) {
      if (error instanceof MfaError) {
        return mfaProblem(error);
      }
      throw error;
    }
  });

  app.post(TOTP_ENABLE_PATH, async (c) => {
    const blocked = await guard(deps, c, 'totp-enable');
    if (blocked !== null) {
      return blocked;
    }
    const user = await authenticate(deps, c);
    if (user === null) {
      return problemResponse('AUTH_REQUIRED', AUTH_REQUIRED);
    }
    const body = await readJsonObject(c);
    const code = body?.['code'];
    if (typeof code !== 'string') {
      return problemResponse('REQUEST_INVALID', REQUEST_INVALID);
    }
    try {
      const result = await enableTotp(deps, { userId: user.userId, code });
      c.header('Cache-Control', 'no-store');
      return c.json({ status: 'ENABLED', recoveryCodes: result.recoveryCodes }, 200);
    } catch (error) {
      if (error instanceof MfaError) {
        return mfaProblem(error);
      }
      throw error;
    }
  });

  app.post(MFA_VERIFY_PATH, async (c) => {
    const blocked = await guard(deps, c, 'verify');
    if (blocked !== null) {
      return blocked;
    }
    const body = await readJsonObject(c);
    const token = body?.['mfa_challenge_token'];
    const method = body?.['method'];
    const code = body?.['code'];
    if (typeof token !== 'string' || token.length === 0 || !isSecondFactorMethod(method) || typeof code !== 'string') {
      return problemResponse('REQUEST_INVALID', REQUEST_INVALID);
    }
    try {
      const result = await completeMfaChallenge(deps, { token, method, code });
      c.header('Cache-Control', 'no-store');
      if (result.session.setCookie !== null) {
        c.header('Set-Cookie', result.session.setCookie);
      }
      return c.json(
        { status: 'AUTHENTICATED', accessToken: result.session.accessToken, expiresInSec: result.session.expiresInSec },
        200,
      );
    } catch (error) {
      if (error instanceof MfaError) {
        return mfaProblem(error);
      }
      throw error;
    }
  });

  return app;
}
