/**
 * Calculs purs du grand livre : centimes entiers, BigInt, division par `divRoundHalfUpBigInt` seulement (loi 1, ERRATA D-09).
 * Aucun accès base, aucune horloge. Aucune règle fiscale chiffrée : les montants viennent des lignes déjà comptabilisées.
 */
import { divRoundHalfUpBigInt, ensureSafeInteger } from '@fisca/shared-types';
import { LedgerError } from './ledger-errors.ts';

export type EntrySide = 'DEBIT' | 'CREDIT';

export interface AmountLine {
  readonly debitCents: number;
  readonly creditCents: number;
}

function safeAmount(value: unknown, label: string): number {
  try {
    return ensureSafeInteger(value, label);
  } catch (error) {
    throw new LedgerError('LEDGER_INVALID_AMOUNT', `${label} : ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function totalsOfLines(lines: readonly AmountLine[]): { readonly debit: bigint; readonly credit: bigint } {
  let debit = 0n;
  let credit = 0n;
  for (const line of lines) {
    debit += BigInt(safeAmount(line.debitCents, 'debitCents'));
    credit += BigInt(safeAmount(line.creditCents, 'creditCents'));
  }
  return { debit, credit };
}

/** Lignes valides (un seul côté, positif, entiers sûrs) et équilibrées ; total strictement positif. */
export function assertBalancedLines(lines: readonly AmountLine[]): { readonly debit: bigint; readonly credit: bigint } {
  if (lines.length === 0) {
    throw new LedgerError('LEDGER_INVALID_LINE', "une écriture comporte au moins une ligne.");
  }
  for (const [index, line] of lines.entries()) {
    const debit = safeAmount(line.debitCents, `lignes[${index + 1}].debitCents`);
    const credit = safeAmount(line.creditCents, `lignes[${index + 1}].creditCents`);
    if (debit < 0 || credit < 0) {
      throw new LedgerError('LEDGER_INVALID_AMOUNT', `ligne ${index + 1} : montant négatif.`);
    }
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw new LedgerError('LEDGER_INVALID_LINE', `ligne ${index + 1} : exactement un côté, débit ou crédit, strictement positif.`);
    }
  }
  const totals = totalsOfLines(lines);
  if (totals.debit !== totals.credit) {
    throw new LedgerError('LEDGER_UNBALANCED', `débit ${totals.debit} différent du crédit ${totals.credit}.`);
  }
  return totals;
}

/** Contre-passation : débit et crédit échangés, tous les autres champs conservés. */
export function invertLines<T extends AmountLine>(lines: readonly T[]): T[] {
  return lines.map((line) => ({ ...line, debitCents: line.creditCents, creditCents: line.debitCents }));
}

// ---------------------------------------------------------------------------------------------------------------------
// VAT_CLEARING (Doc_02 § 05, skill fisca-cgnc-immutable-ledger § 3)
// ---------------------------------------------------------------------------------------------------------------------

export type VatPendingRole = 'VAT_COLLECTED_PENDING' | 'VAT_RECOVERABLE_PENDING';

export interface VatPendingLine {
  readonly lineNumber: number;
  readonly accountNumber: string;
  readonly role: VatPendingRole;
  /** Côté sur lequel la pièce d'origine a porté la TVA d'attente. */
  readonly side: EntrySide;
  readonly amountCents: number;
}

export interface VatClearingInput {
  readonly pendingLines: readonly VatPendingLine[];
  /** Base du règlement : total de la pièce d'origine. */
  readonly invoiceTtcCents: number;
  readonly settledBeforeCents: number;
  readonly settledNowCents: number;
  /** Compte cible par rôle d'attente (résolu par le moteur depuis `cgnc_accounts.vat_regime_role`). */
  readonly targetByPendingRole: Readonly<Partial<Record<VatPendingRole, string>>>;
}

export interface VatClearingMovement {
  readonly sourceLineNumber: number;
  readonly pendingAccountNumber: string;
  readonly targetAccountNumber: string;
  /** Côté du compte d'attente dans l'écriture de liquidation : l'inverse de la pièce d'origine. */
  readonly pendingSide: EntrySide;
  readonly amountCents: number;
}

function cumulativeShare(amountCents: number, settledCents: number, ttcCents: number): bigint {
  return divRoundHalfUpBigInt(BigInt(amountCents) * BigInt(settledCents), BigInt(ttcCents));
}

/**
 * Liquidation proportionnelle au règlement. Pour chaque ligne d'attente, la part cumulée exigible vaut
 * `arrondi_demi_haut(montant × réglé cumulé / TTC)` ; l'écriture porte la différence entre la part cumulée après et avant ce
 * règlement. La somme des écritures successives retombe donc exactement sur le montant d'attente quand le TTC est réglé, sans
 * dérive d'arrondi, et la ventilation reste au centime par ligne (donc par ligne d'une facture à plusieurs lignes de TVA).
 */
export function computeVatClearingMovements(input: VatClearingInput): VatClearingMovement[] {
  const ttc = safeAmount(input.invoiceTtcCents, 'invoiceTtcCents');
  const before = safeAmount(input.settledBeforeCents, 'settledBeforeCents');
  const now = safeAmount(input.settledNowCents, 'settledNowCents');
  if (ttc <= 0) {
    throw new LedgerError('LEDGER_INVALID_AMOUNT', 'le total de la pièce d\'origine doit être strictement positif.');
  }
  if (before < 0 || now <= 0) {
    throw new LedgerError('LEDGER_INVALID_AMOUNT', 'le règlement doit être strictement positif et le cumul antérieur positif ou nul.');
  }
  if (BigInt(before) + BigInt(now) > BigInt(ttc)) {
    throw new LedgerError('LEDGER_VAT_CLEARING_EXCEEDS_INVOICE', `règlements cumulés ${before} + ${now} supérieurs au total ${ttc}.`);
  }
  const after = before + now;
  const movements: VatClearingMovement[] = [];
  for (const line of [...input.pendingLines].sort((a, b) => a.lineNumber - b.lineNumber)) {
    const amount = safeAmount(line.amountCents, `ligne ${line.lineNumber}`);
    const target = input.targetByPendingRole[line.role];
    if (target === undefined) {
      throw new LedgerError('LEDGER_VAT_TARGET_REQUIRED', `aucun compte cible pour le rôle ${line.role}.`);
    }
    const cleared = cumulativeShare(amount, after, ttc) - cumulativeShare(amount, before, ttc);
    if (cleared > 0n) {
      movements.push({
        sourceLineNumber: line.lineNumber,
        pendingAccountNumber: line.accountNumber,
        targetAccountNumber: target,
        pendingSide: line.side === 'CREDIT' ? 'DEBIT' : 'CREDIT',
        amountCents: Number(cleared),
      });
    }
  }
  if (movements.length === 0) {
    throw new LedgerError('LEDGER_NOTHING_TO_CLEAR', 'le règlement ne libère aucun centime de TVA d\'attente.');
  }
  return movements;
}

// ---------------------------------------------------------------------------------------------------------------------
// Journal d'à-nouveaux (Doc_02 § 04 : « écritures d'à-nouveaux reprenant les soldes de bilan »)
// ---------------------------------------------------------------------------------------------------------------------

export interface AccountNetBalance {
  readonly accountNumber: string;
  readonly cgncClass: number;
  /** Débit moins crédit, toutes pièces POSTED de l'exercice clos. */
  readonly netCents: number;
}

export interface OpeningLine {
  readonly lineNumber: number;
  readonly accountNumber: string;
  readonly debitCents: number;
  readonly creditCents: number;
}

/**
 * Reprend les soldes des comptes de bilan (classes 1 à 5). Les classes 6 à 8 ne se reportent pas : leur solde net doit avoir
 * été affecté par une écriture de clôture, sinon la reprise ne boucle pas et le moteur refuse au lieu de choisir un compte de
 * résultat (la règle d'affectation n'est pas fixée par les spécifications).
 */
export function computeOpeningBalanceLines(balances: readonly AccountNetBalance[]): OpeningLine[] {
  const balanceSheet = balances.filter((b) => b.cgncClass >= 1 && b.cgncClass <= 5);
  let net = 0n;
  for (const balance of balanceSheet) {
    net += BigInt(safeAmount(balance.netCents, `solde ${balance.accountNumber}`));
  }
  if (net !== 0n) {
    throw new LedgerError(
      'LEDGER_RESULT_NOT_AFFECTED',
      `les soldes de bilan ne bouclent pas (écart ${net} centimes) : le résultat de l'exercice n'est pas affecté.`,
    );
  }
  const carried = balanceSheet.filter((b) => b.netCents !== 0).sort((a, b) => (a.accountNumber < b.accountNumber ? -1 : a.accountNumber > b.accountNumber ? 1 : 0));
  if (carried.length === 0) {
    throw new LedgerError('LEDGER_NOTHING_TO_CARRY_FORWARD', 'aucun solde de bilan à reprendre.');
  }
  return carried.map((balance, index) => ({
    lineNumber: index + 1,
    accountNumber: balance.accountNumber,
    debitCents: balance.netCents > 0 ? balance.netCents : 0,
    creditCents: balance.netCents < 0 ? -balance.netCents : 0,
  }));
}
