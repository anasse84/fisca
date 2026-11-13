/**
 * Routeur Hono de POST /api/v1/auth/google/link/confirm (CTR-API-42, DRAFT : à confirmer à G1). Termine la liaison
 * d'une identité Google à un compte existant (confirmPendingLink : preuve par mot de passe ou lien e-mail), puis passe
 * par completeFirstFactor : si le compte a un second facteur (ou s'il est imposé), la réponse est un
 * mfa_challenge_token (ou 409 MFA_ENROLLMENT_REQUIRED), jamais une session ni un cookie.
 * Ordre : limitation de débit, Turnstile (paramètre de requête), corps, moteur. Hono vit ici (ERRATA B-02).
 */

import { Hono } from 'hono';
import { completeFirstFactor } from './first-factor.ts';
import type { FirstFactorDeps } from './first-factor.ts';
import { firstFactorResponse, problemResponse } from './first-factor-response.ts';
import type { ProblemSpec } from './first-factor-response.ts';
import { GoogleOAuthError, confirmPendingLink } from './oauth-google.ts';
import type { ConfirmPendingLinkDeps, GoogleOAuthErrorCode, LinkProof } from './oauth-google.ts';
import { REQUEST_INVALID, guardRequest, internalErrorResponse, readJsonObject } from './route-guard.ts';
import type { EdgeGuardDeps } from './route-guard.ts';

export const GOOGLE_LINK_CONFIRM_PATH = '/api/v1/auth/google/link/confirm' as const;

export interface GoogleLinkRouterDeps extends ConfirmPendingLinkDeps, EdgeGuardDeps {
  /** Raccordement MFA : obligatoire, la liaison ne peut jamais ouvrir une session sans lui. */
  readonly login: FirstFactorDeps;
}

type LinkErrorCode = Extract<GoogleOAuthErrorCode, 'LINK_PENDING_NOT_FOUND' | 'LINK_PENDING_EXPIRED' | 'LINK_PROOF_INVALID' | 'SUB_ALREADY_LINKED'>;

const PROBLEMS: Readonly<Record<LinkErrorCode, ProblemSpec>> = {
  LINK_PENDING_NOT_FOUND: { status: 400, title: 'Liaison introuvable', detail: 'La liaison est inconnue ou déjà utilisée.' },
  LINK_PENDING_EXPIRED: { status: 400, title: 'Liaison expirée', detail: 'La liaison a expiré, recommencez.' },
  LINK_PROOF_INVALID: { status: 403, title: 'Preuve invalide', detail: 'La preuve de propriété du compte est invalide.' },
  SUB_ALREADY_LINKED: { status: 403, title: 'Identité déjà liée', detail: 'Cette identité Google est déjà liée à un compte.' },
};

function isLinkErrorCode(code: GoogleOAuthErrorCode): code is LinkErrorCode {
  return code in PROBLEMS;
}

function readProof(value: unknown): LinkProof | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const proof = Object.fromEntries(Object.entries(value));
  const method = proof['method'];
  const password = proof['password'];
  const token = proof['token'];
  if (method === 'PASSWORD' && typeof password === 'string' && password.length > 0) {
    return { method, password };
  }
  if (method === 'EMAIL_LINK' && typeof token === 'string' && token.length > 0) {
    return { method, token };
  }
  return null;
}

export function createGoogleLinkRouter(deps: GoogleLinkRouterDeps): Hono {
  const app = new Hono();
  app.onError(() => internalErrorResponse());

  app.post(GOOGLE_LINK_CONFIRM_PATH, async (c) => {
    const blocked = await guardRequest(deps, c, 'google-link-confirm');
    if (blocked !== null) {
      return blocked;
    }
    const body = await readJsonObject(c);
    const pendingLinkId = body?.['pendingLinkId'];
    const proof = readProof(body?.['proof']);
    if (typeof pendingLinkId !== 'string' || pendingLinkId.length === 0 || proof === null) {
      return problemResponse('REQUEST_INVALID', REQUEST_INVALID);
    }
    try {
      const linked = await confirmPendingLink({ pendingLinkId, proof }, deps);
      const next = await completeFirstFactor(deps.login, { userId: linked.userId, firstFactor: 'GOOGLE_OAUTH' });
      return firstFactorResponse(c, next, { userId: linked.userId });
    } catch (error) {
      if (error instanceof GoogleOAuthError && isLinkErrorCode(error.code)) {
        return problemResponse(error.code, PROBLEMS[error.code]);
      }
      throw error;
    }
  });

  return app;
}
