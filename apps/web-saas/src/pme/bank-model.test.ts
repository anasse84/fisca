import { describe, expect, it } from 'vitest';
import { buildReconcileRequest, classifySuggestion, outcomeKind } from './bank-model.ts';
import type { BankContext, BankEntryCandidate, BankStatementLine, ReconcileSuggestion } from './ports-ops.ts';

const E1 = '0190f0f0-0000-7000-8000-000000000001';
const E2 = '0190f0f0-0000-7000-8000-000000000002';
const E3 = '0190f0f0-0000-7000-8000-000000000003';
const LINE: BankStatementLine = { id: 'b1', valueDate: '2027-02-05', label: 'VIR', amountCents: -12000, paymentMethodCode: '30_VIREMENT' };
const entry = (id: string, openCents: number, settledBeforeCents = 0): BankEntryCandidate => ({ invoiceEntryId: id, reference: `R-${id.slice(-1)}`, partnerLabel: 'P', openCents, settledBeforeCents, dueDate: '2027-02-01' });
const CTX: BankContext = { journalId: 'JRN-BQ', fiscalYearId: 'FY-1', paymentMethods: ['30_VIREMENT', '20_CHEQUE'] };
const suggestion = (ids: string[], scoreBps = 9000): ReconcileSuggestion => ({ bankTransactionId: 'b1', candidateEntryIds: ids, scoreBps });

describe('classification d’une suggestion (Doc_02 § 05 : 0 ou ≥2 candidates → suspens)', () => {
  it('une candidate → unique', () => expect(classifySuggestion(suggestion([E1]))).toBe('unique'));
  it('deux candidates ou plus → ambiguë : aucune validation automatique', () => {
    expect(classifySuggestion(suggestion([E1, E2]))).toBe('ambiguous');
    expect(classifySuggestion(suggestion([E1, E2, E3]))).toBe('ambiguous');
  });
  it('aucune candidate → none', () => expect(classifySuggestion(suggestion([]))).toBe('none'));
  it('doublons d’identifiant comptés une fois', () => expect(classifySuggestion(suggestion([E1, E1]))).toBe('unique'));
});

describe('corps exact de CTR-API-12', () => {
  it('construit le corps strict depuis le contexte hôte, la ligne et les candidates ; montants entiers', () => {
    const r = buildReconcileRequest(CTX, LINE, [entry(E1, 12000, 500)]);
    expect(r).toEqual({
      ok: true,
      body: {
        bankTransactionId: 'b1',
        journalId: 'JRN-BQ',
        fiscalYearId: 'FY-1',
        entryDate: '2027-02-05',
        paymentMethodCode: '30_VIREMENT',
        candidates: [{ invoiceEntryId: E1, settledBeforeCents: 500 }],
      },
    });
  });
  it('mise en suspens : toutes les candidates ambiguës sont envoyées (le serveur impose 3497/4497)', () => {
    const r = buildReconcileRequest(CTX, LINE, [entry(E1, 12000), entry(E2, 12000)]);
    expect(r.ok && r.body.candidates).toHaveLength(2);
  });
  it('mode de règlement choisi par l’utilisateur prioritaire ; absent partout = refus local', () => {
    const noMethod: BankStatementLine = { id: 'b1', valueDate: '2027-02-05', label: 'VIR', amountCents: -1 };
    expect(buildReconcileRequest(CTX, noMethod, [entry(E1, 1)])).toEqual({ ok: false, reason: 'paymentMethod' });
    const chosen = buildReconcileRequest(CTX, noMethod, [entry(E1, 1)], { paymentMethodCode: '20_CHEQUE' });
    expect(chosen.ok && chosen.body.paymentMethodCode).toBe('20_CHEQUE');
  });
  it('mode hors liste du port refusé', () => {
    expect(buildReconcileRequest(CTX, LINE, [entry(E1, 1)], { paymentMethodCode: '10_ESPECES' })).toEqual({ ok: false, reason: 'paymentMethod' });
  });
  it('0 candidate ou plus de 20 : refus local (le schéma serveur impose 1 à 20)', () => {
    expect(buildReconcileRequest(CTX, LINE, [])).toEqual({ ok: false, reason: 'candidates' });
    const many = Array.from({ length: 21 }, (_, i) => entry(`0190f0f0-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`, 1));
    expect(buildReconcileRequest(CTX, LINE, many)).toEqual({ ok: false, reason: 'candidates' });
  });
  it('option LCN et cible de TVA récupérable passent telles quelles quand la ligne les porte', () => {
    const line: BankStatementLine = { ...LINE, paymentMethodCode: '42_EFFET_LCN', lcnBankCollectionDate: '2027-03-01', recoverableTarget: 'VAT_RECOVERABLE_CHARGES' };
    const r = buildReconcileRequest({ ...CTX, paymentMethods: ['42_EFFET_LCN'] }, line, [entry(E1, 1)]);
    expect(r.ok && r.body).toMatchObject({ lcnBankCollectionDate: '2027-03-01', recoverableTarget: 'VAT_RECOVERABLE_CHARGES' });
  });
  it('montant non entier refusé', () => {
    expect(buildReconcileRequest(CTX, LINE, [entry(E1, 1, 0.5)])).toEqual({ ok: false, reason: 'amount' });
  });
});

describe('issue de CTR-API-12', () => {
  it('traduit les quatre issues du schéma de réponse', () => {
    expect(outcomeKind('MATCHED_FULL')).toBe('matched');
    expect(outcomeKind('MATCHED_PARTIAL')).toBe('partial');
    expect(outcomeKind('SUSPENS_AMBIGU_3497_4497')).toBe('suspense');
    expect(outcomeKind('NO_MATCH')).toBe('noMatch');
  });
});
