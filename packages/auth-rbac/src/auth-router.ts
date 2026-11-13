/**
 * Routeur d'authentification composé : routes Google (CTR-API-04, CTR-API-05) et routes 2FA
 * (CTR-API-07, CTR-API-08, CTR-API-09). La colle d'apps/api-hono/src/routes/auth l'expose sans logique (ERRATA B-02).
 */

import { Hono } from 'hono';
import { createMfaRouter } from './mfa-routes.ts';
import type { MfaRouterDeps } from './mfa-routes.ts';
import { createGoogleOAuthRouter } from './oauth-google-routes.ts';
import type { GoogleOAuthRouterDeps } from './oauth-google-routes.ts';

export function createAuthRouter(google: GoogleOAuthRouterDeps, mfa: MfaRouterDeps): Hono {
  const app = new Hono();
  app.route('/', createGoogleOAuthRouter(google));
  app.route('/', createMfaRouter(mfa));
  return app;
}
