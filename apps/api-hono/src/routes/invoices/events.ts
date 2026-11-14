/**
 * Contrat des événements du Workflow DGI_CLEARANCE_WORKFLOW (CTR-BND-08, classe `DgiClearanceWorkflow`, instance par facture).
 * `companyId` est résolu CÔTÉ SERVEUR par l'appelant (T-P2A-09) à partir de la session et du mandat (ERRATA D-16) : il n'est
 * jamais lu d'un corps de requête ni d'un argument d'outil IA ou MCP (AGENTS.md loi 4). Recommandation d'identifiant
 * d'instance : `invoiceId` (une seule instance de clearance par facture).
 */
import { z } from 'zod';

export const DGI_CLEARANCE_WORKFLOW_NAME = 'dgi-clearance-workflow';
export const DGI_CLEARANCE_WORKFLOW_BINDING = 'DGI_CLEARANCE_WORKFLOW';
export const DGI_CLEARANCE_WORKFLOW_CLASS = 'DgiClearanceWorkflow';

const IDENTIFIER = /^[A-Za-z0-9._-]{1,128}$/;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export const DgiClearanceWorkflowPayloadSchema = z.strictObject({
  /** Identifiant de la facture (`invoices.id`). */
  invoiceId: z.string().regex(IDENTIFIER),
  /** Identifiant de société résolu côté serveur (clé de la base du dossier, D-16). */
  companyId: z.string().regex(IDENTIFIER),
  /** SHA-256 hexadécimal minuscule du XML signé à soumettre (clé d'idempotence avec invoiceId). */
  xmlSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Instant ISO 8601 UTC de la demande, fourni par l'appelant. */
  requestedAtIso: z.string().regex(CANONICAL_UTC),
});
export type DgiClearanceWorkflowPayload = z.infer<typeof DgiClearanceWorkflowPayloadSchema>;

/** Valeur de retour de `run` (sérialisable) : visible par l'API d'état des instances. */
export const DgiClearanceWorkflowResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('DEPOSEE_CERTIFIEE_DGI'), xhubUuid: z.string(), displayState: z.string() }),
  z.strictObject({ status: z.literal('REJETEE_XHUB'), code: z.string(), displayState: z.string() }),
  z.strictObject({ status: z.literal('CLEARANCE_EXHAUSTED'), displayState: z.string() }),
  z.strictObject({ status: z.literal('ABORTED'), code: z.string() }),
]);
export type DgiClearanceWorkflowResult = z.infer<typeof DgiClearanceWorkflowResultSchema>;
