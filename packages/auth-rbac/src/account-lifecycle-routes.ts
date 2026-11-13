/**
 * Routeur Hono du cycle de vie du compte : POST /api/v1/auth/register (CTR-API-01), POST /api/v1/auth/verify-email
 * (CTR-API-02) et POST /api/v1/auth/password/forgot (CTR-API-06). Logique et Hono vivent ici (ERRATA B-02) ;
 * apps/api-hono/src/routes/auth ne contient que la colle.
 * Ordre : limitation de débit, Turnstile (jeton `cf-turnstile-response` en paramètre de requête), corps ({email, password, full_name}), moteur.
 * register et password/forgot répondent 202 avec un corps identique quel que soit l'état du compte.
 * Le jeton de réinitialisation est consommé par password-reset-routes.ts (CTR-API-41, DRAFT).
 */

import { Hono } from 'hono';
import { AccountLifecycleError, hashEmailForRateKey, registerAccount, requestPasswordReset, verifyEmailToken } from './account-lifecycle.ts';
import type { AccountLifecycleDeps, AccountLifecycleErrorCode } from './account-lifecycle.ts';
import { problemResponse } from './first-factor-response.ts';
import type { ProblemSpec } from './first-factor-response.ts';
import { normalizeEmail } from './oauth-google.ts';
import { REQUEST_INVALID, guardRequest, internalErrorResponse, readJsonObject } from './route-guard.ts';
import type { EdgeGuardDeps } from './route-guard.ts';

export const REGISTER_PATH = '/api/v1/auth/register' as const;
export const VERIFY_EMAIL_PATH = '/api/v1/auth/verify-email' as const;
export const PASSWORD_FORGOT_PATH = '/api/v1/auth/password/forgot' as const;

export interface AccountLifecycleRouterDeps extends AccountLifecycleDeps, EdgeGuardDeps {}

const PROBLEMS: Readonly<Record<AccountLifecycleErrorCode, ProblemSpec>> = {
  REGISTRATION_INPUT_INVALID: {
    status: 400,
    title: 'Inscription invalide',
    detail: 'Adresse e-mail invalide, mot de passe hors politique (12 à 128 caractères) ou nom complet (full_name) absent ou invalide.',
  },
  VERIFICATION_TOKEN_INVALID: { status: 400, title: 'Jeton invalide', detail: 'Le jeton de vérification est invalide ou déjà utilisé.' },
  VERIFICATION_TOKEN_EXPIRED: { status: 400, title: 'Jeton expiré', detail: 'Le jeton de vérification a expiré : demandez-en un nouveau.' },
};

export function createAccountLifecycleRouter(deps: AccountLifecycleRouterDeps): Hono {
  const app = new Hono();
  app.onError(() => internalErrorResponse());

  app.post(REGISTER_PATH, async (c) => {
    const blocked = await guardRequest(deps, c, 'register');
    if (blocked !== null) {
      return blocked;
    }
    const body = await readJsonObject(c);
    const email = body?.['email'];
    const password = body?.['password'];
    const fullName = body?.['full_name'];
    if (typeof email !== 'string' || typeof password !== 'string') {
      return problemResponse('REQUEST_INVALID', REQUEST_INVALID);
    }
    if (typeof fullName !== 'string') {
      return problemResponse('REGISTRATION_INPUT_INVALID', PROBLEMS.REGISTRATION_INPUT_INVALID);
    }
    try {
      await registerAccount(deps, { email, password, fullName });
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        return problemResponse(error.code, PROBLEMS[error.code]);
      }
      throw error;
    }
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'VERIFICATION_PENDING' }, 202);
  });

  app.post(VERIFY_EMAIL_PATH, async (c) => {
    const blocked = await guardRequest(deps, c, 'verify-email');
    if (blocked !== null) {
      return blocked;
    }
    const body = await readJsonObject(c);
    const token = body?.['token'];
    if (typeof token !== 'string') {
      return problemResponse('REQUEST_INVALID', REQUEST_INVALID);
    }
    try {
      await verifyEmailToken(deps, token);
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        return problemResponse(error.code, PROBLEMS[error.code]);
      }
      throw error;
    }
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'EMAIL_VERIFIED' }, 200);
  });

  app.post(PASSWORD_FORGOT_PATH, async (c) => {
    const blocked = await guardRequest(deps, c, 'password-forgot');
    if (blocked !== null) {
      return blocked;
    }
    const body = await readJsonObject(c);
    const email = body?.['email'];
    if (typeof email !== 'string') {
      return problemResponse('REQUEST_INVALID', REQUEST_INVALID);
    }
    const allowed = await deps.rateLimiter.allow(`auth:password-forgot-email:${await hashEmailForRateKey(normalizeEmail(email))}`);
    await requestPasswordReset(deps, { email, throttled: !allowed });
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'RESET_REQUESTED' }, 202);
  });

  return app;
}
