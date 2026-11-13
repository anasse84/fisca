/**
 * Routeur Hono du cycle de vie de session : POST /api/v1/auth/refresh (CTR-API-35) et POST /api/v1/auth/logout
 * (CTR-API-36). Doc_09 § 02 : cookie __Host-fisca_refresh rotatif, HttpOnly, Secure, SameSite=Strict.
 *
 * - refresh : lit le cookie, fait tourner le jeton (SessionService.refresh) et pose le nouveau cookie. Tout échec
 *   répond 401 et efface le cookie ; le rejeu d'un jeton déjà tourné révoque la famille (moteur refresh-session).
 * - logout : révoque la famille et efface le cookie. Idempotent : sans cookie valide, il n'y a rien à révoquer et
 *   le cookie est quand même effacé (réponse 200, aucune information sur l'existence d'un jeton).
 * Ordre : limitation de débit, Turnstile, puis moteur. Aucune session JWT n'est exigée : le cookie fait foi.
 */

import { Hono } from 'hono';
import { problemResponse } from './first-factor-response.ts';
import type { ProblemSpec } from './first-factor-response.ts';
import { RefreshError, buildClearRefreshCookie } from './refresh-session.ts';
import type { RefreshErrorCode } from './refresh-session.ts';
import { guardRequest, internalErrorResponse } from './route-guard.ts';
import type { EdgeGuardDeps } from './route-guard.ts';
import type { SessionService } from './session-service.ts';

export const REFRESH_PATH = '/api/v1/auth/refresh' as const;
export const LOGOUT_PATH = '/api/v1/auth/logout' as const;

export interface SessionRouterDeps extends EdgeGuardDeps {
  readonly sessions: Pick<SessionService, 'refresh' | 'revoke'>;
}

const REFRESH_PROBLEMS: Readonly<Record<RefreshErrorCode, ProblemSpec>> = {
  REFRESH_TOKEN_MISSING: { status: 401, title: 'Session absente', detail: 'Aucun cookie de session : reconnectez-vous.' },
  REFRESH_TOKEN_INVALID: { status: 401, title: 'Session invalide', detail: 'Le cookie de session est invalide : reconnectez-vous.' },
  REFRESH_TOKEN_EXPIRED: { status: 401, title: 'Session expirée', detail: 'La session a expiré : reconnectez-vous.' },
  REFRESH_TOKEN_REVOKED: { status: 401, title: 'Session révoquée', detail: 'La session a été révoquée : reconnectez-vous.' },
  REFRESH_TOKEN_REUSED: { status: 401, title: 'Session révoquée', detail: 'Réutilisation détectée : la session a été révoquée, reconnectez-vous.' },
};

export function createSessionRouter(deps: SessionRouterDeps): Hono {
  const app = new Hono();
  app.onError(() => internalErrorResponse());

  app.post(REFRESH_PATH, async (c) => {
    const blocked = await guardRequest(deps, c, 'refresh');
    if (blocked !== null) {
      return blocked;
    }
    try {
      const session = await deps.sessions.refresh({ cookie: c.req.header('Cookie') ?? null });
      c.header('Cache-Control', 'no-store');
      if (session.setCookie !== null) {
        c.header('Set-Cookie', session.setCookie);
      }
      return c.json({ status: 'AUTHENTICATED', accessToken: session.accessToken, expiresInSec: session.expiresInSec }, 200);
    } catch (error) {
      if (error instanceof RefreshError) {
        return problemResponse(error.code, REFRESH_PROBLEMS[error.code], { 'Set-Cookie': buildClearRefreshCookie() });
      }
      throw error;
    }
  });

  app.post(LOGOUT_PATH, async (c) => {
    const blocked = await guardRequest(deps, c, 'logout');
    if (blocked !== null) {
      return blocked;
    }
    try {
      await deps.sessions.revoke({ cookie: c.req.header('Cookie') ?? null });
    } catch (error) {
      if (!(error instanceof RefreshError)) {
        throw error;
      }
    }
    c.header('Cache-Control', 'no-store');
    c.header('Set-Cookie', buildClearRefreshCookie());
    return c.json({ status: 'LOGGED_OUT' }, 200);
  });

  return app;
}
