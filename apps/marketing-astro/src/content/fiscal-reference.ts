/**
 * Barèmes et paramètres fiscaux : AUCUNE valeur ici (ADR-04, AGENTS.md loi 2).
 * Chaque entrée nomme un paramètre dont la valeur est une règle datée des tables D1 / du Wiki.
 */
export interface DatedFiscalParameterSlot {
  readonly key: string;
  readonly label: string;
  readonly source: 'D1 dynamic_fiscal_rules';
  readonly status: 'valeur datée, à saisir depuis les tables';
}

const SOURCE = 'D1 dynamic_fiscal_rules' as const;
const STATUS = 'valeur datée, à saisir depuis les tables' as const;

export const DATED_FISCAL_PARAMETER_SLOTS: readonly DatedFiscalParameterSlot[] = [
  { key: 'vat_rate_bps', label: 'Taux de TVA', source: SOURCE, status: STATUS },
  { key: 'cash_cap', label: 'Plafond de règlement en espèces', source: SOURCE, status: STATUS },
  { key: 'late_payment_rate', label: 'Pénalités de retard de paiement (loi 69-21)', source: SOURCE, status: STATUS },
  { key: 'vat_withholding', label: 'Retenue à la source de TVA', source: SOURCE, status: STATUS },
  { key: 'ae_client_threshold', label: 'Seuil par client des auto-entrepreneurs', source: SOURCE, status: STATUS },
];
