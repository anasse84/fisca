/**
 * Colle des routes d'authentification (ERRATA B-02) : aucune logique, aucune dépendance tierce.
 * Routes construites par @fisca/auth-rbac et exposées au manifeste de routes :
 * - GET /api/v1/auth/google/start (CTR-API-04) et GET /api/v1/auth/google/callback (CTR-API-05) ;
 * - POST /api/v1/auth/login (CTR-API-03) ;
 * - POST /api/v1/auth/2fa/totp/setup (CTR-API-07), POST /api/v1/auth/2fa/totp/enable (CTR-API-08)
 *   et POST /api/v1/auth/2fa/verify (CTR-API-09) ;
 * - POST /api/v1/auth/register (CTR-API-01), POST /api/v1/auth/verify-email (CTR-API-02) et
 *   POST /api/v1/auth/password/forgot (CTR-API-06) ;
 * - POST /api/v1/auth/password/reset (CTR-API-41, DRAFT) et POST /api/v1/auth/google/link/confirm (CTR-API-42,
 *   DRAFT), à confirmer à G1 ; la seconde passe par completeFirstFactor : jamais de session avant le second facteur ;
 * - POST /api/v1/auth/refresh (CTR-API-35) et POST /api/v1/auth/logout (CTR-API-36). refresh n'exige PAS Turnstile
 *   (un refresh silencieux ne peut pas présenter de défi) : limitation de débit seule ; logout garde Turnstile + débit ;
 * - POST /api/v1/auth/passkeys/register/options (CTR-API-37), /register/verify (CTR-API-38),
 *   /authenticate/options (CTR-API-39) et /authenticate/verify (CTR-API-40).
 *
 * Les API Web standard (crypto, Request, Response) sont typées par la lib DOM du tsconfig de apps/api-hono.
 */
import {
  createAccountLifecycleRouter,
  createAuthRouter,
  createGoogleLinkRouter,
  createGoogleOAuthRouter,
  createLoginRouter,
  createMfaRouter,
  createPasskeyRouter,
  createPasswordResetRouter,
  createSessionRouter,
} from '@fisca/auth-rbac';
import type {
  AccountLifecycleRouterDeps,
  GoogleLinkRouterDeps,
  GoogleOAuthRouterDeps,
  LoginRouterDeps,
  MfaRouterDeps,
  PasskeyRouterDeps,
  PasswordResetRouterDeps,
  RecoveryRouterDeps,
  SessionAndPasskeyRouterDeps,
  SessionRouterDeps,
} from '@fisca/auth-rbac';

/**
 * Monte les routes Google ; avec `mfa`, monte aussi les trois routes 2FA ; avec `login` (et `mfa`), la connexion
 * par mot de passe ; avec `extra` (et `mfa`), refresh, logout et les quatre routes passkeys ; avec `lifecycle`
 * (et `mfa`), register, verify-email et password/forgot ; avec `recovery`, password/reset et google/link/confirm.
 * Pour que le callback Google émette un défi MFA ou une session, `deps.login` doit être fourni.
 */
export function createAuthRoutes(deps: GoogleOAuthRouterDeps): ReturnType<typeof createGoogleOAuthRouter>;
export function createAuthRoutes(
  deps: GoogleOAuthRouterDeps,
  mfa: MfaRouterDeps,
  login?: LoginRouterDeps,
  extra?: SessionAndPasskeyRouterDeps,
  lifecycle?: AccountLifecycleRouterDeps,
  recovery?: RecoveryRouterDeps,
): ReturnType<typeof createAuthRouter>;
export function createAuthRoutes(
  deps: GoogleOAuthRouterDeps,
  mfa?: MfaRouterDeps,
  login?: LoginRouterDeps,
  extra?: SessionAndPasskeyRouterDeps,
  lifecycle?: AccountLifecycleRouterDeps,
  recovery?: RecoveryRouterDeps,
) {
  return mfa === undefined ? createGoogleOAuthRouter(deps) : createAuthRouter(deps, mfa, login, extra, lifecycle, recovery);
}

export function createAccountLifecycleRoutes(deps: AccountLifecycleRouterDeps) {
  return createAccountLifecycleRouter(deps);
}

export function createPasswordResetRoutes(deps: PasswordResetRouterDeps) {
  return createPasswordResetRouter(deps);
}

export function createGoogleLinkRoutes(deps: GoogleLinkRouterDeps) {
  return createGoogleLinkRouter(deps);
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
