/**
 * Orchestration de POST /api/v1/invoices/:id/cdv-response : émission d'un statut CDV (APPROUVEE, EN_LITIGE_SUSPENDUE, ENCAISSEE)
 * vers xHub, puis transition locale par `applyCdvStatus` (FSM CDV, T-P2A-08).
 *
 * Ordre : (1) lecture de la facture ; (2) transition validée À SEC par le FSM avant toute émission (transition invalide : aucune
 * émission) ; (3) émission par la ClearanceGateway (clé `cdv:{invoiceId}:{status}`, idempotente côté pilote) ; (4) écriture locale.
 * Une panne entre (3) et (4) se rejoue sans doublon : la clé d'émission est stable. Acteur FSM : DETERMINISTIC_SYSTEM (le FSM CDV
 * interdit HUMAN_USER, test existant) ; l'utilisateur est tracé dans `actorId` (HYPOTHÈSE à valider).
 */
import { applyTransition } from '@fisca/shared-types';
import type { TenantSqlDriver } from '@fisca/shared-types';
import { applyCdvStatus, type ClearancePorts } from '../clearance/engine.ts';
import { CDV_LIFECYCLE_FSM, deriveCdvStatus, type CdvStatus } from '../clearance/fsm.ts';
import { ClearanceGatewayError, type CdvEmittableStatus, type ClearanceGateway } from '../clearance/gateway.ts';
import { loadInvoiceForClearance, loadInvoiceFsmState } from '../clearance/repository.ts';
import { CertifyError } from './errors.ts';

export const CDV_REASON_MAX_LENGTH = 500;

export interface EmitCdvInput {
  readonly invoiceId: string;
  readonly status: CdvEmittableStatus;
  readonly reason?: string | undefined;
  readonly actorId: string;
  /** `Idempotency-Key` HTTP : identifie le message CDV local (rejeu = no-op). */
  readonly idempotencyKey: string;
}

export interface EmitCdvResult {
  readonly invoiceId: string;
  readonly from: CdvStatus;
  readonly to: CdvStatus;
  /** false : transition déjà appliquée par un appel précédent portant la même clé. */
  readonly applied: boolean;
  readonly displayState: 'Validation simulée';
}

export interface EmitCdvPorts extends Pick<ClearancePorts, 'db' | 'clock' | 'ids'> {
  readonly db: TenantSqlDriver;
  readonly gateway: ClearanceGateway;
}

export async function emitCdvResponse(ports: EmitCdvPorts, input: EmitCdvInput): Promise<EmitCdvResult> {
  const invoice = await loadInvoiceForClearance(ports.db, input.invoiceId);
  if (invoice === null) throw new CertifyError('CDV_INVOICE_NOT_FOUND');
  const current = deriveCdvStatus(invoice.clearanceState, invoice.cdvLifecycleStatus);
  if (current === null || invoice.xhubUuid === null || invoice.sequentialNumber === null) throw new CertifyError('CDV_NOT_CLEARED');
  const responseId = `HTTP-${input.idempotencyKey}`;

  const state = await loadInvoiceFsmState<CdvStatus>(ports.db, input.invoiceId, current);
  const replayed = state.appliedIdempotencyKeys.includes(`cdv:${input.invoiceId}:${responseId}`);
  if (!replayed) {
    try {
      applyTransition(
        CDV_LIFECYCLE_FSM,
        state,
        { entityTable: 'invoices', entityId: input.invoiceId, expectedFromState: current, targetState: input.status, actorKind: 'DETERMINISTIC_SYSTEM', actorId: input.actorId, idempotencyKey: `dry-run:${responseId}`, reasonOrProofRef: `CDV:${input.status}` },
        [],
        { nowIso: ports.clock.nowIso(), auditId: 'dry-run' },
      );
    } catch {
      throw new CertifyError('CDV_TRANSITION_INVALID');
    }
    try {
      await ports.gateway.emitCdv({
        invoiceId: input.invoiceId,
        xhubUuid: invoice.xhubUuid,
        status: input.status,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        idempotencyKey: `cdv:${input.invoiceId}:${input.status}`,
      });
    } catch (error) {
      throw new CertifyError(error instanceof ClearanceGatewayError && error.kind === 'permanent' ? 'CDV_GATEWAY_REJECTED' : 'CDV_GATEWAY_UNAVAILABLE');
    }
  }
  const applied = await applyCdvStatus(ports, {
    invoiceId: input.invoiceId,
    responseId,
    status: input.status,
    invoiceReference: invoice.sequentialNumber,
    actorKind: 'DETERMINISTIC_SYSTEM',
    actorId: input.actorId,
  });
  return { invoiceId: input.invoiceId, from: applied.from, to: applied.to, applied: applied.applied, displayState: 'Validation simulée' };
}
