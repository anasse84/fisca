/**
 * Politique de route du socle REST v1 (ticket T-S1B-12) : alimente le TenantRouter et l'EntitlementGuard.
 *
 * - `GET /api/v1/directory/ice/:ice` : « Tout connecté » (Doc_07 § 02), annuaire du plan de contrôle : aucun dossier, aucune base.
 * - toute autre route : dossier obligatoire (échec fermé par défaut).
 * Aucune `feature_key` n'est codée : Doc_03 ne désigne pas de clé pour le grand livre ni le lettrage (voir le rapport).
 */
import type { RoutePolicy, RoutePolicyResolver } from './tenant-router.ts';

const ICE_PATH = /^\/api\/v1\/directory\/ice\/[^/]+\/?$/;

const COMPANY_POLICY: RoutePolicy = { audience: 'HUMAN_API', tenantScope: 'COMPANY', featureKey: null, legalExport: false };
const CONTROL_PLANE_POLICY: RoutePolicy = { audience: 'HUMAN_API', tenantScope: 'NONE', featureKey: null, legalExport: false };

export const resolveV1RoutePolicy: RoutePolicyResolver = (request) =>
  request.method.toUpperCase() === 'GET' && ICE_PATH.test(request.path) ? CONTROL_PLANE_POLICY : COMPANY_POLICY;
