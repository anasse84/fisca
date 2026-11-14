/**
 * Colle du dossier pos (ERRATA B-02) : `createPosRoutes(deps)` (sync-batch CTR-API-16, convert-b2b CTR-API-17) et
 * `createPosPublicRoutes(deps)` (la seule route publique, à monter AVANT tout pipeline authentifié). Le manifeste généré exige
 * seulement un `index.ts` par dossier. Logique : `@fisca/ubl-xades/pos`.
 */
export { createPosPublicRoutes, createPosRoutes } from './pos-routes.ts';
export type { PosRoutesDeps, PosSyncExternalPorts } from './pos-routes.ts';
export { createPublicPosConvertRoute, PUBLIC_POS_CONVERT_PATH } from './public-convert.ts';
export type { PosConversionExternalPorts, PublicPosConvertDeps, PublicPosTicketLookup, ResolvedPosTenant } from './public-convert.ts';
export {
  ConvertB2bRequestSchema,
  ConvertB2bResponseSchema,
  createSyncBatchRequestSchema,
  posRouteContracts,
  PosSyncTicketSchema,
  SyncBatchResponseSchema,
} from './pos-route-schemas.ts';
export type { PosRouteContract } from './pos-route-schemas.ts';
