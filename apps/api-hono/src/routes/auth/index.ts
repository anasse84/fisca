/**
 * Colle des routes d'authentification (ERRATA B-02) : aucune logique, aucune dépendance tierce.
 * Les routes GET /api/v1/auth/google/start (CTR-API-04) et GET /api/v1/auth/google/callback (CTR-API-05)
 * sont construites par @fisca/auth-rbac ; ce module les expose au manifeste de routes.
 *
 * La référence `lib="dom"` donne au typage les API Web standard (crypto, Request, Response) que le paquet
 * @fisca/auth-rbac utilise ; elle évite de toucher à apps/api-hono/tsconfig.json, hors périmètre.
 */
/// <reference lib="dom" />
import { createGoogleOAuthRouter } from '@fisca/auth-rbac';
import type { GoogleOAuthRouterDeps } from '@fisca/auth-rbac';

export function createAuthRoutes(deps: GoogleOAuthRouterDeps) {
  return createGoogleOAuthRouter(deps);
}
