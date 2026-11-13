/**
 * Routeur Hono du courtier Google OAuth (CTR-API-04 et CTR-API-05).
 *
 * Hono et toute la logique vivent ici, dans le paquet (ERRATA B-02) ; apps/api-hono/src/routes/auth ne
 * contient que la colle qui appelle `createGoogleOAuthRouter`.
 *
 * Protection des deux routes : limitation de débit, puis Turnstile.
 * - /start vérifie le jeton Turnstile (paramètre de requête `cf-turnstile-response`, nom standard du widget) ;
 *   le state émis n'existe qu'après cette preuve.
 * - /callback est atteint par une redirection de Google, qui ne peut pas porter de jeton Turnstile : sa preuve
 *   est le state à usage unique, émis uniquement après Turnstile (champ `turnstileVerified` de la transaction).
 */

import { Hono } from 'hono';
import type { ProblemDetails } from '@fisca/shared-types';
import {
  GoogleOAuthError,
  beginGoogleAuthorization,
  completeGoogleAuthorization,
} from './oauth-google.ts';
import type { GoogleOAuthDeps, GoogleOAuthErrorCode } from './oauth-google.ts';

export const GOOGLE_START_PATH = '/api/v1/auth/google/start' as const;
export const GOOGLE_CALLBACK_PATH = '/api/v1/auth/google/callback' as const;
export const TURNSTILE_QUERY_PARAM = 'cf-turnstile-response' as const;
const CLIENT_IP_HEADER = 'CF-Connecting-IP';
const UNKNOWN_CLIENT = 'inconnu';

export interface TurnstileVerifier {
  verify(input: { readonly token: string | null; readonly remoteIp: string | null }): Promise<boolean>;
}

export interface RateLimiter {
  /** Vrai si la requête est autorisée pour cette clé, faux si le quota est dépassé. */
  allow(key: string): Promise<boolean>;
}

export interface GoogleOAuthRouterDeps {
  readonly oauth: GoogleOAuthDeps;
  readonly turnstile: TurnstileVerifier;
  readonly rateLimiter: RateLimiter;
}

type ProblemStatus = 400 | 401 | 403 | 429 | 502;

interface ProblemSpec {
  readonly status: ProblemStatus;
  readonly title: string;
  readonly detail: string;
}

const PROBLEMS: Readonly<Record<GoogleOAuthErrorCode, ProblemSpec>> = {
  PKCE_VERIFIER_INVALID: { status: 400, title: 'Requête OAuth invalide', detail: 'Le paramètre PKCE est invalide.' },
  TURNSTILE_REQUIRED: { status: 403, title: 'Vérification anti-bot requise', detail: 'La vérification Turnstile est requise.' },
  STATE_INVALID: { status: 400, title: 'Session OAuth invalide', detail: 'Le state est inconnu ou déjà utilisé.' },
  STATE_EXPIRED: { status: 400, title: 'Session OAuth expirée', detail: 'Le state a expiré, recommencez la connexion.' },
  CODE_MISSING: { status: 400, title: 'Requête OAuth invalide', detail: "Le code d'autorisation est absent." },
  PROVIDER_ERROR: { status: 400, title: 'Autorisation refusée', detail: 'Google a refusé ou interrompu la connexion.' },
  TOKEN_EXCHANGE_FAILED: { status: 502, title: 'Échange Google impossible', detail: "L'échange du code avec Google a échoué." },
  ID_TOKEN_MALFORMED: { status: 401, title: 'Identité Google invalide', detail: "Le jeton d'identité est mal formé." },
  ID_TOKEN_SIGNATURE_INVALID: { status: 401, title: 'Identité Google invalide', detail: 'La signature du jeton est invalide.' },
  ID_TOKEN_ISSUER_INVALID: { status: 401, title: 'Identité Google invalide', detail: "L'émetteur du jeton est invalide." },
  ID_TOKEN_AUDIENCE_INVALID: { status: 401, title: 'Identité Google invalide', detail: "L'audience du jeton est invalide." },
  ID_TOKEN_EXPIRED: { status: 401, title: 'Identité Google invalide', detail: 'Le jeton a expiré.' },
  ID_TOKEN_NONCE_INVALID: { status: 401, title: 'Identité Google invalide', detail: 'Le nonce du jeton est invalide.' },
  EMAIL_NOT_VERIFIED: { status: 403, title: 'E-mail Google non vérifié', detail: "L'e-mail du compte Google n'est pas vérifié." },
  LINK_PENDING_NOT_FOUND: { status: 400, title: 'Liaison introuvable', detail: 'La liaison est inconnue ou déjà utilisée.' },
  LINK_PENDING_EXPIRED: { status: 400, title: 'Liaison expirée', detail: 'La liaison a expiré, recommencez.' },
  LINK_PROOF_INVALID: { status: 403, title: 'Preuve invalide', detail: 'La preuve de propriété du compte est invalide.' },
  SUB_ALREADY_LINKED: { status: 403, title: 'Identité déjà liée', detail: 'Cette identité Google est déjà liée à un compte.' },
};

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

const RATE_LIMITED: ProblemSpec = {
  status: 429,
  title: 'Trop de requêtes',
  detail: 'Limite de débit dépassée, réessayez plus tard.',
};

const TURNSTILE_FAILED: ProblemSpec = PROBLEMS.TURNSTILE_REQUIRED;

function clientIp(headers: Headers): string | null {
  const value = headers.get(CLIENT_IP_HEADER);
  return value === null || value.length === 0 ? null : value;
}

export function createGoogleOAuthRouter(deps: GoogleOAuthRouterDeps): Hono {
  const app = new Hono();

  app.get(GOOGLE_START_PATH, async (c) => {
    const ip = clientIp(c.req.raw.headers);
    if (!(await deps.rateLimiter.allow(`auth:google:start:${ip ?? UNKNOWN_CLIENT}`))) {
      return problemResponse('RATE_LIMITED', RATE_LIMITED);
    }
    const token = c.req.query(TURNSTILE_QUERY_PARAM) ?? null;
    const turnstileVerified = await deps.turnstile.verify({ token, remoteIp: ip });
    if (!turnstileVerified) {
      return problemResponse('TURNSTILE_REQUIRED', TURNSTILE_FAILED);
    }
    try {
      const { authorizationUrl } = await beginGoogleAuthorization(deps.oauth, { turnstileVerified });
      c.header('Cache-Control', 'no-store');
      return c.redirect(authorizationUrl, 302);
    } catch (error) {
      if (error instanceof GoogleOAuthError) {
        return problemResponse(error.code, PROBLEMS[error.code]);
      }
      throw error;
    }
  });

  app.get(GOOGLE_CALLBACK_PATH, async (c) => {
    const ip = clientIp(c.req.raw.headers);
    if (!(await deps.rateLimiter.allow(`auth:google:callback:${ip ?? UNKNOWN_CLIENT}`))) {
      return problemResponse('RATE_LIMITED', RATE_LIMITED);
    }
    try {
      const outcome = await completeGoogleAuthorization(
        {
          code: c.req.query('code') ?? null,
          state: c.req.query('state') ?? null,
          providerError: c.req.query('error') ?? null,
        },
        deps.oauth,
      );
      c.header('Cache-Control', 'no-store');
      if (outcome.kind === 'LINK_PROOF_REQUIRED') {
        return c.json(
          { status: 'LINK_PROOF_REQUIRED', pendingLinkId: outcome.pendingLinkId, methods: outcome.methods },
          409,
        );
      }
      return c.json({ status: 'AUTHENTICATED', userId: outcome.userId, isNewUser: outcome.kind === 'SIGNED_UP' }, 200);
    } catch (error) {
      if (error instanceof GoogleOAuthError) {
        return problemResponse(error.code, PROBLEMS[error.code]);
      }
      throw error;
    }
  });

  return app;
}
