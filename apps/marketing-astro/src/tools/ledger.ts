/**
 * Écriture comptable d'un outil public : lignes en centimes entiers, équilibre débit = crédit vérifié.
 * Comptes : seuls ceux CITÉS par les spécifications du dépôt sont préremplis (4411 fournisseurs, 5161 caisse, 34552 TVA
 * récupérable : Doc_06 S06, AGENTS loi 3, Doc_01 S03). Tout autre compte (charge, retenue due à l'État, banque) n'est cité
 * par aucune spécification : il reste « à renseigner » ou est saisi par l'utilisateur, jamais deviné.
 */
export type AccountRole = 'EXPENSE_DEDUCTIBLE' | 'EXPENSE_NON_DEDUCTIBLE' | 'VAT_RECOVERABLE' | 'VAT_NON_RECOVERABLE' | 'CASH' | 'SUPPLIER' | 'PAYMENT' | 'VAT_WITHHELD_DUE';

/** Comptes cités par les spécifications du dépôt, avec leur référence. */
export const CITED_ACCOUNTS: Readonly<Partial<Record<AccountRole, { readonly account: string; readonly specRef: string }>>> = {
  CASH: { account: '5161', specRef: 'AGENTS.md loi 3 (caisse 5161)' },
  SUPPLIER: { account: '4411', specRef: 'Doc_06 S06 (auxiliaire fournisseur 44110001)' },
  VAT_RECOVERABLE: { account: '34552', specRef: 'Doc_01 S03 et Doc_14 S04 (TVA récupérable 34552)' },
};

export interface LedgerLine {
  readonly role: AccountRole;
  /** Numéro de compte ; null = compte à renseigner (non cité par les spécifications). */
  readonly account: string | null;
  readonly debitCents: number;
  readonly creditCents: number;
}

export interface LedgerEntry {
  readonly lines: readonly LedgerLine[];
  readonly totalDebitCents: number;
  readonly totalCreditCents: number;
}

export function buildEntry(lines: readonly LedgerLine[]): LedgerEntry {
  const kept = lines.filter((l) => l.debitCents !== 0 || l.creditCents !== 0);
  for (const l of kept) {
    if (!Number.isSafeInteger(l.debitCents) || !Number.isSafeInteger(l.creditCents) || l.debitCents < 0 || l.creditCents < 0) {
      throw new RangeError('Ligne d’écriture invalide');
    }
    if (l.debitCents !== 0 && l.creditCents !== 0) throw new RangeError('Une ligne est au débit ou au crédit, pas les deux');
  }
  const totalDebitCents = kept.reduce((sum, l) => sum + l.debitCents, 0);
  const totalCreditCents = kept.reduce((sum, l) => sum + l.creditCents, 0);
  if (totalDebitCents !== totalCreditCents) {
    throw new RangeError(`Écriture déséquilibrée : débit ${String(totalDebitCents)} contre crédit ${String(totalCreditCents)}`);
  }
  return { lines: kept, totalDebitCents, totalCreditCents };
}

/** Compte saisi par l'utilisateur : 3 à 8 chiffres, sinon null (reste « à renseigner »). */
export function cleanAccountInput(text: string): string | null {
  const compact = text.replace(/\s/g, '');
  return /^\d{3,8}$/.test(compact) ? compact : null;
}
