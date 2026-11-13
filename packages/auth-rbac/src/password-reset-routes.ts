/**
 * Routeur Hono de POST /api/v1/auth/password/reset (CTR-API-41, DRAFT : à confirmer à G1). Logique et Hono vivent ici
 * (ERRATA B-02) ; apps/api-hono/src/routes/auth ne contient que la colle.
 * Ordre : limitation de débit, Turnstile (paramètre de requête `cf-turnstile-response`), corps, moteur.
 * Réponse 200 { status: 'PASSWORD_RESET' } sans cookie ni jeton : aucune session. Tout jeton invalide, quelle qu'en
 * soit la cause, donne la même réponse 400 (anti-oracle).
 */

import { Hono } from 'hono';
import { PasswordResetError, resetPassword } from './password-reset.ts';
import type { PasswordResetDeps, PasswordResetErrorCode } from './password-reset.ts';
import { problemResponse } from './first-factor-response.ts';
import type { ProblemSpec } from './first-factor-response.ts';
import { REQUEST_INVALID, guardRequest, internalErrorResponse, readJsonObject } from './route-guard.ts';
import type { EdgeGuardDeps } from './route-guard.ts';

export const PASSWORD_RESET_PATH = '/api/v1/auth/password/reset' as const;

export interface PasswordResetRouterDeps extends PasswordResetDeps, EdgeGuardDeps {}

const PROBLEMS: Readonly<Record<PasswordResetErrorCode, ProblemSpec>> = {
  PASSWORD_RESET_INPUT_INVALID: {
    status: 400,
    title: 'Mot de passe invalide',
    detail: 'Le mot de passe doit contenir entre 12 et 128 caractères.',
  },
  PASSWORD_RESET_TOKEN_INVALID: {
    status: 400,
    title: 'Lien invalide',
    detail: 'Le lien de réinitialisation est invalide, expiré ou déjà utilisé : demandez-en un nouveau.',
  },
};

export function createPasswordResetRouter(deps: PasswordResetRouterDeps): Hono {
  const app = new Hono();
  app.onError(() => internalErrorResponse());

  app.post(PASSWORD_RESET_PATH, async (c) => {
    const blocked = await guardRequest(deps, c, 'password-reset');
    if (blocked !== null) {
      return blocked;
    }
    const body = await readJsonObject(c);
    const token = body?.['token'];
    const newPassword = body?.['newPassword'];
    if (typeof token !== 'string' || typeof newPassword !== 'string') {
      return problemResponse('REQUEST_INVALID', REQUEST_INVALID);
    }
    try {
      await resetPassword(deps, { token, newPassword });
    } catch (error) {
      if (error instanceof PasswordResetError) {
        return problemResponse(error.code, PROBLEMS[error.code]);
      }
      throw error;
    }
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'PASSWORD_RESET' }, 200);
  });

  return app;
}
