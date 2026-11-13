/**
 * Colle des routes d'authentification (ERRATA B-02) : aucune logique, aucune dépendance tierce.
 * Routes construites par @fisca/auth-rbac et exposées au manifeste de routes :
 * - GET /api/v1/auth/google/start (CTR-API-04) et GET /api/v1/auth/google/callback (CTR-API-05) ;
 * - POST /api/v1/auth/login (CTR-API-03) ;
 * - POST /api/v1/auth/2fa/totp/setup (CTR-API-07), POST /api/v1/auth/2fa/totp/enable (CTR-API-08)
 *   et POST /api/v1/auth/2fa/verify (CTR-API-09) ;
 * - POST /api/v1/auth/refresh (CTR-API-35) et POST /api/v1/auth/logout (CTR-API-36) ;
 * - POST /api/v1/auth/passkeys/register/options (CTR-API-37), /register/verify (CTR-API-38),
 *   /authenticate/options (CTR-API-39) et /authenticate/verify (CTR-API-40).
 *
 * La référence `lib="dom"` donne au typage les API Web standard (crypto, Request, Response) que le paquet
 * @fisca/auth-rbac utilise ; elle évite de toucher à apps/api-hono/tsconfig.json, hors périmètre.
 */
/// <reference lib="dom" />
import {
  createAuthRouter,
  createGoogleOAuthRouter,
  createLoginRouter,
  createMfaRouter,
  createPasskeyRouter,
  createSessionRouter,
} from '@fisca/auth-rbac';
import type {
  GoogleOAuthRouterDeps,
  LoginRouterDeps,
  MfaRouterDeps,
  PasskeyRouterDeps,
  SessionAndPasskeyRouterDeps,
  SessionRouterDeps,
} from '@fisca/auth-rbac';

/**
 * Monte les routes Google ; avec `mfa`, monte aussi les trois routes 2FA ; avec `login` (et `mfa`), la connexion
 * par mot de passe ; avec `extra` (et `mfa`), refresh, logout et les quatre routes passkeys.
 * Pour que le callback Google émette un défi MFA ou une session, `deps.login` doit être fourni.
 */
export function createAuthRoutes(deps: GoogleOAuthRouterDeps): ReturnType<typeof createGoogleOAuthRouter>;
export function createAuthRoutes(
  deps: GoogleOAuthRouterDeps,
  mfa: MfaRouterDeps,
  login?: LoginRouterDeps,
  extra?: SessionAndPasskeyRouterDeps,
): ReturnType<typeof createAuthRouter>;
export function createAuthRoutes(
  deps: GoogleOAuthRouterDeps,
  mfa?: MfaRouterDeps,
  login?: LoginRouterDeps,
  extra?: SessionAndPasskeyRouterDeps,
) {
  return mfa === undefined ? createGoogleOAuthRouter(deps) : createAuthRouter(deps, mfa, login, extra);
}

export function createSessionRoutes(deps: SessionRouterDeps) {
  return createSessionRouter(deps);
}

export function createPasskeyRoutes(deps: PasskeyRouterDeps) {
  return createPasskeyRouter(deps);
}

export function createLoginRoutes(deps: LoginRouterDeps) {
  return createLoginRouter(deps);
}

export function createMfaRoutes(deps: MfaRouterDeps) {
  return createMfaRouter(deps);
}
