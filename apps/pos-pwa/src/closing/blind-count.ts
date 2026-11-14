import type { PosStorage } from '../storage/ports.ts';
import { DenominationError, totalCountedCents, validateGrid } from './denominations.ts';
import type { CountMap, DenominationGridPort } from './denominations.ts';

/**
 * Comptage aveugle (SoD-04, FSM 10) : le caissier saisit des quantités de coupures ; le montant attendu n'est jamais renvoyé
 * par `lockBlindCount`. L'écart se calcule au verrouillage (colonnes `expected_closing_cash_cents` et `cash_variance_cents`)
 * mais ne se LIT que par `revealVariance`, qui exige l'autorisation `POS_VIEW_EXPECTED_CASH` (port) avant toute lecture.
 * Montants en centimes entiers ; sommes en bigint.
 */

export type BlindCountErrorCode = 'SESSION_NOT_FOUND' | 'SESSION_NOT_ACTIVE' | 'COUNT_INVALID' | 'COUNT_NOT_LOCKED';

export class BlindCountError extends Error {
  readonly code: BlindCountErrorCode;
  constructor(code: BlindCountErrorCode, message: string) {
    super(message);
    this.name = 'BlindCountError';
    this.code = code;
  }
}

export class ExpectedCashForbiddenError extends Error {
  constructor() {
    super('Accès refusé : le montant attendu et l’écart sont réservés au rôle autorisé (POS_VIEW_EXPECTED_CASH).');
    this.name = 'ExpectedCashForbiddenError';
  }
}

/** Port d'autorisation : vrai seulement pour un rôle qui détient `POS_VIEW_EXPECTED_CASH` (jamais le caissier). */
export interface ExpectedCashAuthorizationPort {
  canViewExpectedCash(userId: string): Promise<boolean>;
}

export interface LockBlindCountDeps {
  readonly storage: PosStorage;
  readonly grid: DenominationGridPort;
  readonly now: () => string;
}

export interface LockedCount {
  readonly sessionId: string;
  readonly countedCents: number;
  readonly lockedAt: string;
}


/** Espèces théoriques en tiroir : fond de caisse + espèces encaissées (timbre compris) − espèces rendues sur retours liés. Réservé à ce module. */
async function expectedCashCents(storage: PosStorage, sessionId: string, openingFloatCents: number): Promise<bigint> {
  const rows = await storage.all('SELECT ticket_kind, paid_cash_cents FROM pos_tickets WHERE session_id = ?', [sessionId]);
  let cash = BigInt(openingFloatCents);
  for (const row of rows) {
    const amount = BigInt(Number(row['paid_cash_cents']));
    cash += row['ticket_kind'] === 'RETURN_REFUND' ? -amount : amount;
  }
  return cash;
}

export async function lockBlindCount(deps: LockBlindCountDeps, input: { readonly sessionId: string; readonly counts: CountMap }): Promise<LockedCount> {
  const { storage } = deps;
  const sessions = await storage.all('SELECT status, opening_float_cents FROM pos_sessions WHERE id = ?', [input.sessionId]);
  const session = sessions[0];
  if (session === undefined) throw new BlindCountError('SESSION_NOT_FOUND', 'Session de caisse inconnue.');
  if (session['status'] !== 'SESSION_OUVERTE_ACTIVE') throw new BlindCountError('SESSION_NOT_ACTIVE', 'Le comptage est déjà verrouillé ou la session est clôturée.');
  let countedCents: number;
  try {
    const grid = await deps.grid.listDenominations();
    validateGrid(grid);
    countedCents = totalCountedCents(grid, input.counts);
  } catch (error) {
    if (error instanceof DenominationError) throw new BlindCountError('COUNT_INVALID', error.message);
    throw error;
  }
  const expected = await expectedCashCents(storage, input.sessionId, Number(session['opening_float_cents']));
  const variance = BigInt(countedCents) - expected;
  if (expected > BigInt(Number.MAX_SAFE_INTEGER) || expected < 0n) throw new BlindCountError('COUNT_INVALID', 'Espèces théoriques hors plage : comptage refusé.');
  await storage.run(
    `UPDATE pos_sessions SET blind_counted_cash_cents = ?, expected_closing_cash_cents = ?, cash_variance_cents = ?, status = 'COMPTAGE_AVEUGLE_PRE_Z'
     WHERE id = ? AND status = 'SESSION_OUVERTE_ACTIVE'`,
    [countedCents, Number(expected), Number(variance), input.sessionId],
  );
  return { sessionId: input.sessionId, countedCents, lockedAt: deps.now() };
}

export type VarianceKind = 'SHORTAGE' | 'OVERAGE' | 'BALANCED';

export interface VarianceReveal {
  readonly countedCents: number;
  readonly expectedCents: number;
  /** compté − attendu : négatif = manquant, positif = excédent. */
  readonly varianceCents: number;
  readonly kind: VarianceKind;
}

export interface RevealVarianceDeps {
  readonly storage: PosStorage;
  readonly authorization: ExpectedCashAuthorizationPort;
}

/** Révèle l'écart. L'autorisation est vérifiée AVANT toute lecture ; refus avant verrouillage du comptage. */
export async function revealVariance(deps: RevealVarianceDeps, input: { readonly sessionId: string; readonly actorUserId: string }): Promise<VarianceReveal> {
  if (!(await deps.authorization.canViewExpectedCash(input.actorUserId))) throw new ExpectedCashForbiddenError();
  const rows = await deps.storage.all('SELECT status, blind_counted_cash_cents, expected_closing_cash_cents, cash_variance_cents FROM pos_sessions WHERE id = ?', [input.sessionId]);
  const row = rows[0];
  if (row === undefined) throw new BlindCountError('SESSION_NOT_FOUND', 'Session de caisse inconnue.');
  if (row['status'] === 'SESSION_OUVERTE_ACTIVE' || row['blind_counted_cash_cents'] === null || row['cash_variance_cents'] === null) {
    throw new BlindCountError('COUNT_NOT_LOCKED', 'Le comptage n’est pas verrouillé : aucun écart à révéler.');
  }
  const varianceCents = Number(row['cash_variance_cents']);
  return {
    countedCents: Number(row['blind_counted_cash_cents']),
    expectedCents: Number(row['expected_closing_cash_cents']),
    varianceCents,
    kind: varianceCents < 0 ? 'SHORTAGE' : varianceCents > 0 ? 'OVERAGE' : 'BALANCED',
  };
}

