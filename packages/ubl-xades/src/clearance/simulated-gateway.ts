/**
 * Pilote `simulated` de ClearanceGateway : déterministe, scripté par l'appelant, seul pilote livré (ERRATA B-13 révisé).
 * Pilote de test ET pilote documenté `simulated` : l'état affiché est « Validation simulée », jamais « certifiée DGI ».
 *
 * Le script est consommé dans l'ordre, une entrée par appel NON rejoué ; une fois épuisé, les soumissions réussissent.
 * Une soumission rejouée avec la même `idempotencyKey` après succès renvoie le même accusé sans consommer le script
 * ni créer de seconde soumission (hypothèse de simulation, non contractuelle pour xHub).
 */
import {
  CLEARANCE_ERROR_CODE_PATTERN,
  ClearanceGatewayError,
  type ClearanceGateway,
  type ClearanceReceipt,
  type ClearanceRemoteStatus,
  type ClearanceSubmitMetadata,
} from './gateway.ts';

export type SimulatedStep =
  | { readonly kind: 'success' }
  | { readonly kind: 'reject'; readonly code: string }
  | { readonly kind: 'transient'; readonly code?: string };

export interface SimulatedClearanceGatewayOptions {
  readonly script?: readonly SimulatedStep[];
  /** Instant de réception injecté (aucune horloge globale). */
  readonly nowIso: () => string;
}

export interface SimulatedClearanceGateway extends ClearanceGateway {
  /** Nombre d'appels `submit` reçus (rejoués compris). */
  readonly callCount: number;
  /** Nombre de soumissions distinctes acceptées. */
  readonly acceptedCount: number;
}

/** Fabrique le pilote `simulated`. */
export function createSimulatedClearanceGateway(options: SimulatedClearanceGatewayOptions): SimulatedClearanceGateway {
  const script = options.script ?? [];
  for (const step of script) {
    const code = step.kind === 'reject' ? step.code : step.kind === 'transient' ? step.code : undefined;
    if (code !== undefined && !CLEARANCE_ERROR_CODE_PATTERN.test(code)) {
      throw new RangeError('SIMULATED_GATEWAY_SCRIPT_INVALID: code hors motif [A-Za-z0-9._-]{1,64}.');
    }
  }
  let cursor = 0;
  let calls = 0;
  const accepted = new Map<string, ClearanceReceipt>();
  const statuses = new Map<string, ClearanceRemoteStatus>();

  const gateway: SimulatedClearanceGateway = {
    mode: 'simulated',
    get callCount(): number {
      return calls;
    },
    get acceptedCount(): number {
      return accepted.size;
    },
    submit(_invoiceXmlSigned: string, metadata: ClearanceSubmitMetadata): Promise<ClearanceReceipt> {
      calls += 1;
      const replay = accepted.get(metadata.idempotencyKey);
      if (replay !== undefined) {
        return Promise.resolve(replay);
      }
      const step: SimulatedStep = script[cursor] ?? { kind: 'success' };
      cursor += 1;
      if (step.kind === 'transient') {
        return Promise.reject(new ClearanceGatewayError('transient', step.code ?? 'SIMULATED_TRANSIENT'));
      }
      if (step.kind === 'reject') {
        return Promise.reject(new ClearanceGatewayError('permanent', step.code));
      }
      const receipt: ClearanceReceipt = {
        xhubUuid: `00000000-0000-4000-8000-${(accepted.size + 1).toString(16).padStart(12, '0')}`,
        receivedAt: options.nowIso(),
      };
      accepted.set(metadata.idempotencyKey, receipt);
      statuses.set(receipt.xhubUuid, { state: 'RECEIVED', xhubUuid: receipt.xhubUuid });
      return Promise.resolve(receipt);
    },
    getStatus(xhubUuid: string): Promise<ClearanceRemoteStatus> {
      return Promise.resolve(statuses.get(xhubUuid) ?? { state: 'UNKNOWN' });
    },
  };
  return gateway;
}

/** Nom explicite du pilote livré (B-13). */
export const simulated = { mode: 'simulated', create: createSimulatedClearanceGateway } as const;
