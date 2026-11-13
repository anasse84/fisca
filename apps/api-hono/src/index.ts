/**
 * Point d'entrée de @fisca/api-hono (fichier de jonction, ERRATA B-02).
 *
 * Contenu : (1) les classes Durable Object déclarées dans wrangler.toml, exportées sous leur `class_name` EXACT (bindings
 * INVOICE_SEQUENCER -> InvoiceSequencerDO, AGENT_HINDSIGHT_MEMORY -> AgentHindsightMemoryDO) ; (2) l'API publique de composition
 * du pipeline ; (3) le manifeste de routes généré (`pnpm gen:routes`, ignoré par Git).
 *
 * POINT OUVERT : aucun gestionnaire `fetch` par défaut n'est exporté ici. Il exigerait d'ouvrir la base D1 d'une société à partir
 * de son identifiant (`SqlBackendOpeners`), opération non définie : elle dépend du provisionnement P4-C (bindings et identifiants
 * D1 réels). Tant que ce contrat n'existe pas, le Worker de production ne peut pas servir de requêtes ; ne pas le simuler.
 * Les Workflows et classes Container déclarés dans wrangler.toml sont livrés par leurs sessions productrices.
 */
export { routeManifest } from './routes.generated.ts';
export type { RouteManifestEntry } from './routes.generated.ts';

export { InvoiceSequencerDO } from './core/invoice-sequencer-do.ts';
export { AgentHindsightMemoryDO } from './core/agent-hindsight-memory-do.ts';

export { createPipelineDeps } from './core/pipeline-composition.ts';
export type { PipelineCompositionPorts } from './core/pipeline-composition.ts';
export { createSqlCpaMandatePresence } from './core/mandate-resolver.ts';

export const PACKAGE_NAME = '@fisca/api-hono' as const;
