/**
 * Colle des routes d'authentification (ERRATA B-02) : aucune logique, aucune dépendance tierce.
 * Routes construites par @fisca/auth-rbac et exposées au manifeste de routes :
 * - GET /api/v1/auth/google/start (CTR-API-04) et GET /api/v1/auth/google/callback (CTR-API-05) ;
 * - POST /api/v1/auth/login (CTR-API-03) ;
 * - POST /api/v1/auth/2fa/totp/setup (CTR-API-07), POST /api/v1/auth/2fa/totp/enable (CTR-API-08)
 *   et POST /api/v1/auth/2fa/verify (CTR-API-09).
 *
 * La référence `lib="dom"` donne au typage les API Web standard (crypto, Request, Response) que le paquet
 * @fisca/auth-rbac utilise ; elle évite de toucher à apps/api-hono/tsconfig.json, hors périmètre.
 */
/// <reference lib="dom" />
import { createAuthRouter, createGoogleOAuthRouter, createLoginRouter, createMfaRouter } from '@fisca/auth-rbac';
import type { GoogleOAuthRouterDeps, LoginRouterDeps, MfaRouterDeps } from '@fisca/auth-rbac';

/**
 * Monte les routes Google ; avec `mfa`, monte aussi les trois routes 2FA ; avec `login` (et `mfa`), la connexion
 * par mot de passe. Pour que le callback Google émette un défi MFA ou une session, `deps.login` doit être fourni.
 */
export function createAuthRoutes(deps: GoogleOAuthRouterDeps, mfa?: MfaRouterDeps, login?: LoginRouterDeps) {
  return mfa === undefined ? createGoogleOAuthRouter(deps) : createAuthRouter(deps, mfa, login);
}

export function createLoginRoutes(deps: LoginRouterDeps) {
  return createLoginRouter(deps);
}

export function createMfaRoutes(deps: MfaRouterDeps) {
  return createMfaRouter(deps);
}
