import type { PosStorage } from '../storage/ports.ts';
import { lockBlindCount, revealVariance } from './blind-count.ts';
import type { ExpectedCashAuthorizationPort, VarianceReveal } from './blind-count.ts';
import { validateGrid } from './denominations.ts';
import type { CountMap, Denomination, DenominationGridPort } from './denominations.ts';
import { previewZClosure, sealZClosure, toZTicketData } from './z-closure.ts';
import type { ZTicketData } from './z-layout.ts';

/**
 * Câblage de l'écran de clôture. Le port CAISSIER ne contient AUCUNE capacité de révélation : la clé `supervisor` n'existe que
 * pour un acteur autorisé (`POS_VIEW_EXPECTED_CASH`), et `revealVariance` revérifie l'autorisation à chaque appel (défense en profondeur).
 */

export interface SupervisorPort {
  revealVariance(): Promise<VarianceReveal>;
}

export interface ClosingPorts {
  readonly denominations: readonly Denomination[];
  /** `null` : comptage pas encore verrouillé ; sinon le compté (son propre montant, jamais l'attendu). */
  readonly lockedCountedCents: number | null;
  /** Clôture déjà scellée (reprise après rechargement). */
  readonly sealedClosure: ZTicketData | null;
  lockCount(counts: CountMap): Promise<{ readonly countedCents: number }>;
  previewZ(): Promise<ZTicketData>;
  sealZ(): Promise<ZTicketData>;
  readonly supervisor?: SupervisorPort;
}

export interface CreateClosingPortsInput {
  readonly storage: PosStorage;
  readonly grid: DenominationGridPort;
  readonly keyPair: CryptoKeyPair;
  readonly now: () => string;
  readonly newId: () => string;
  readonly authorization: ExpectedCashAuthorizationPort;
  readonly actorUserId: string;
  readonly sessionId: string;
}

export async function createClosingPorts(input: CreateClosingPortsInput): Promise<ClosingPorts> {
  const { storage, sessionId } = input;
  const denominations = await input.grid.listDenominations();
  validateGrid(denominations);
  const sessions = await storage.all('SELECT status, blind_counted_cash_cents FROM pos_sessions WHERE id = ?', [sessionId]);
  const status = sessions[0]?.['status'];
  const counted = sessions[0]?.['blind_counted_cash_cents'];
  const lockedCountedCents = status !== 'SESSION_OUVERTE_ACTIVE' && counted !== null && counted !== undefined ? Number(counted) : null;
  const existing = status === 'CLOTURE_TICKET_Z_SCELLEE'
    ? toZTicketData(await sealZClosure({ storage, keyPair: input.keyPair, now: input.now, newId: input.newId }, { sessionId }))
    : null;
  const authorized = await input.authorization.canViewExpectedCash(input.actorUserId);
  const base: ClosingPorts = {
    denominations,
    lockedCountedCents,
    sealedClosure: existing,
    lockCount: async (counts) => {
      const locked = await lockBlindCount({ storage, grid: input.grid, now: input.now }, { sessionId, counts });
      return { countedCents: locked.countedCents };
    },
    previewZ: () => previewZClosure(storage, sessionId, input.now().slice(0, 10)),
    sealZ: async () => toZTicketData(await sealZClosure({ storage, keyPair: input.keyPair, now: input.now, newId: input.newId }, { sessionId })),
  };
  if (!authorized) return base;
  return { ...base, supervisor: { revealVariance: () => revealVariance({ storage, authorization: input.authorization }, { sessionId, actorUserId: input.actorUserId }) } };
}
