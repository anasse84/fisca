/**
 * Routeur d'authentification composé : routes Google (CTR-API-04, CTR-API-05), routes 2FA
 * (CTR-API-07, CTR-API-08, CTR-API-09) et, si fournie, la connexion par mot de passe (CTR-API-03). La colle d'apps/api-hono/src/routes/auth l'expose sans logique (ERRATA B-02).
 */

import { Hono } from 'hono';
import { createLoginRouter } from './login-routes.ts';
import type { LoginRouterDeps } from './login-routes.ts';
import { createMfaRouter } from './mfa-routes.ts';
import type { MfaRouterDeps } from './mfa-routes.ts';
import { createGoogleOAuthRouter } from './oauth-google-routes.ts';
import type { GoogleOAuthRouterDeps } from './oauth-google-routes.ts';

export function createAuthRouter(google: GoogleOAuthRouterDeps, mfa: MfaRouterDeps, login?: LoginRouterDeps): Hono {
  const app = new Hono();
  if (login !== undefined) {
    app.route('/', createLoginRouter(login));
  }
  app.route('/', createGoogleOAuthRouter(google));
  app.route('/', createMfaRouter(mfa));
  return app;
}
