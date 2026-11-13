/**
 * Composition du pipeline de requêtes (S1B point 3) : assemble les `RequestPipelineDeps` (sans la politique de route, fixée par la
 * colle des routes) à partir des ports d'infrastructure, et y branche les adaptateurs SQL qui dépendent du plan de contrôle.
 *
 * `cpaMandatePresence` = `createSqlCpaMandatePresence(controlPlane)` : sans lui, le TenantRouter ignorerait si le dossier est sous
 * mandat cabinet et le visa implicite du mode direct (Doc_09 § 06B) ne s'ouvrirait jamais. Une panne du plan de contrôle fait
 * répondre 503 `TENANT_UNAVAILABLE` (échec fermé).
 *
 * Aucun point d'entrée de production (`src/index.ts`, Worker) n'appelle encore cette fabrique : à câbler par le propriétaire.
 */
import type { TenantSqlDriver } from '@fisca/shared-types';
import { createSqlCpaMandatePresence } from './mandate-resolver.ts';
import type { RequestPipelineDeps } from './request-pipeline.ts';

/** Tout ce que demande le pipeline, plus le pilote SQL du plan de contrôle d'où vient la présence d'un mandat cabinet. */
export interface PipelineCompositionPorts extends Omit<RequestPipelineDeps, 'routePolicy' | 'cpaMandatePresence'> {
  readonly controlPlane: TenantSqlDriver;
}

export function createPipelineDeps(ports: PipelineCompositionPorts): Omit<RequestPipelineDeps, 'routePolicy'> {
  const { controlPlane, ...deps } = ports;
  return { ...deps, cpaMandatePresence: createSqlCpaMandatePresence(controlPlane) };
}
