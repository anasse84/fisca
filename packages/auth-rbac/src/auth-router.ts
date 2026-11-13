/**
 * Routeur d'authentification composé : routes Google (CTR-API-04, CTR-API-05), routes 2FA
 * (CTR-API-07, CTR-API-08, CTR-API-09) et, si fournie, la connexion par mot de passe (CTR-API-03). Avec `extra`,
 * il monte aussi refresh et logout (CTR-API-35, CTR-API-36) et les quatre routes passkeys (CTR-API-37 à 40).
 * Avec `lifecycle`, il monte aussi register, verify-email et password/forgot (CTR-API-01, 02, 06).
 * Avec `recovery`, il monte aussi password/reset (CTR-API-41) et google/link/confirm (CTR-API-42), chacun s'il est fourni.
 * La colle d'apps/api-hono/src/routes/auth l'expose sans logique (ERRATA B-02).
 */

import { Hono } from 'hono';
import { createAccountLifecycleRouter } from './account-lifecycle-routes.ts';
import type { AccountLifecycleRouterDeps } from './account-lifecycle-routes.ts';
import { createGoogleLinkRouter } from './google-link-routes.ts';
import type { GoogleLinkRouterDeps } from './google-link-routes.ts';
import { createLoginRouter } from './login-routes.ts';
import type { LoginRouterDeps } from './login-routes.ts';
import { createMfaRouter } from './mfa-routes.ts';
import type { MfaRouterDeps } from './mfa-routes.ts';
import { createGoogleOAuthRouter } from './oauth-google-routes.ts';
import type { GoogleOAuthRouterDeps } from './oauth-google-routes.ts';
import { createPasskeyRouter } from './passkey-routes.ts';
import type { PasskeyRouterDeps } from './passkey-routes.ts';
import { createPasswordResetRouter } from './password-reset-routes.ts';
import type { PasswordResetRouterDeps } from './password-reset-routes.ts';
import { createSessionRouter } from './session-routes.ts';
import type { SessionRouterDeps } from './session-routes.ts';

export interface SessionAndPasskeyRouterDeps {
  readonly session: SessionRouterDeps;
  readonly passkeys: PasskeyRouterDeps;
}

export interface RecoveryRouterDeps {
  readonly passwordReset?: PasswordResetRouterDeps;
  readonly googleLink?: GoogleLinkRouterDeps;
}

export function createAuthRouter(
  google: GoogleOAuthRouterDeps,
  mfa: MfaRouterDeps,
  login?: LoginRouterDeps,
  extra?: SessionAndPasskeyRouterDeps,
  lifecycle?: AccountLifecycleRouterDeps,
  recovery?: RecoveryRouterDeps,
): Hono {
  const app = new Hono();
  if (login !== undefined) {
    app.route('/', createLoginRouter(login));
  }
  app.route('/', createGoogleOAuthRouter(google));
  app.route('/', createMfaRouter(mfa));
  if (extra !== undefined) {
    app.route('/', createSessionRouter(extra.session));
    app.route('/', createPasskeyRouter(extra.passkeys));
  }
  if (lifecycle !== undefined) {
    app.route('/', createAccountLifecycleRouter(lifecycle));
  }
  if (recovery?.passwordReset !== undefined) {
    app.route('/', createPasswordResetRouter(recovery.passwordReset));
  }
  if (recovery?.googleLink !== undefined) {
    app.route('/', createGoogleLinkRouter(recovery.googleLink));
  }
  return app;
}
