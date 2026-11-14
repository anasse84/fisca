import { describe, expect, it } from 'vitest';
import { createPurchaseInboxStore, parsePurchaseEvent } from './purchase-model.ts';
import type { PurchaseRow } from './purchase-model.ts';

const PROPOSAL = {
  journalId: 'JRN-ACH',
  fiscalYearId: 'FY-1',
  entryDate: '2027-02-03',
  reviewCycle: 'ACHATS',
  sourceDocumentType: 'INVOICE',
  confidenceBps: 9100,
  lines: [
    { accountNumber: '6111', debitCents: 10000, creditCents: 0, description: 'Achat' },
    { accountNumber: '4411', debitCents: 0, creditCents: 10000, description: 'Fournisseur' },
  ],
};

/** Valeurs non entières construites à l'exécution (le garde ADR-03 interdit les littéraux décimaux accolés aux centimes). */
const NOT_INTEGER = Number('12.5');

describe('analyse des événements SSE typés', () => {
  it('ingestion.queued → identifiant de ligne fixe et libellé de pièce', () => {
    expect(parsePurchaseEvent('ingestion.queued', JSON.stringify({ rowId: 'r1', sourceLabel: 'facture.pdf' }))).toEqual({ type: 'ingestion.queued', rowId: 'r1', sourceLabel: 'facture.pdf' });
  });
  it('ocr.fields_extracted : montant illisible = null conservé, jamais deviné', () => {
    const ev = parsePurchaseEvent('ocr.fields_extracted', JSON.stringify({ rowId: 'r1', supplierName: 'Atlas', documentDate: '2027-02-01', totalTtcCents: null, confidenceBps: 4000 }));
    expect(ev).toMatchObject({ type: 'ocr.fields_extracted', totalTtcCents: null });
  });
  it('refuse un montant non entier ou une confiance hors 0..10000', () => {
    expect(parsePurchaseEvent('ocr.fields_extracted', JSON.stringify({ rowId: 'r1', supplierName: null, documentDate: null, totalTtcCents: NOT_INTEGER, confidenceBps: 10 }))).toBeNull();
    expect(parsePurchaseEvent('ocr.fields_extracted', JSON.stringify({ rowId: 'r1', supplierName: null, documentDate: null, totalTtcCents: 1, confidenceBps: 10001 }))).toBeNull();
  });
  it('refuse un événement sans identifiant de ligne, un type inconnu ou une proposition non entière', () => {
    expect(parsePurchaseEvent('ingestion.queued', JSON.stringify({ sourceLabel: 'x' }))).toBeNull();
    expect(parsePurchaseEvent('autre.type', '{}')).toBeNull();
    expect(parsePurchaseEvent('pcge.account_proposed', JSON.stringify({ rowId: 'r', proposal: { ...PROPOSAL, lines: [{ accountNumber: '6111', debitCents: NOT_INTEGER, creditCents: 0, description: '' }] } }))).toBeNull();
  });
  it('pcge.account_proposed accepte une proposition complète, entryId optionnel', () => {
    expect(parsePurchaseEvent('pcge.account_proposed', JSON.stringify({ rowId: 'r1', proposal: PROPOSAL }))).toMatchObject({ type: 'pcge.account_proposed', rowId: 'r1' });
    expect(parsePurchaseEvent('pcge.account_proposed', JSON.stringify({ rowId: 'r1', proposal: { ...PROPOSAL, entryId: '0190f0f0-0000-7000-8000-000000000001' } }))).toMatchObject({ proposal: { entryId: '0190f0f0-0000-7000-8000-000000000001' } });
  });
  it('cgi.cash_split_alert porte le code de règle fourni par le serveur', () => {
    expect(parsePurchaseEvent('cgi.cash_split_alert', JSON.stringify({ rowId: 'r1', ruleCode: 'CASH_CEILING' }))).toEqual({ type: 'cgi.cash_split_alert', rowId: 'r1', ruleCode: 'CASH_CEILING' });
  });
});

describe('boîte d’achats : état par ligne, ligne à identifiant fixe', () => {
  it('une ligne naît en file d’attente puis se remplit sans changer d’identifiant', () => {
    const store = createPurchaseInboxStore([]);
    const created: PurchaseRow[][] = [];
    store.subscribeCreated((rows) => created.push([...rows]));
    store.apply({ type: 'ingestion.queued', rowId: 'r1', sourceLabel: 'a.pdf' });
    expect(created).toHaveLength(1);
    expect(store.getRow('r1')?.status).toBe('queued');
    store.apply({ type: 'ocr.fields_extracted', rowId: 'r1', supplierName: 'Atlas', documentDate: '2027-02-01', totalTtcCents: 12000, confidenceBps: 9000 });
    expect(store.getRow('r1')).toMatchObject({ status: 'extracted', supplierName: 'Atlas', totalTtcCents: 12000 });
    store.apply({ type: 'pcge.account_proposed', rowId: 'r1', proposal: PROPOSAL });
    expect(store.getRow('r1')?.status).toBe('proposed');
    expect(created).toHaveLength(1);
  });
  it('notifie uniquement les abonnés de la ligne modifiée', () => {
    const store = createPurchaseInboxStore([]);
    store.apply({ type: 'ingestion.queued', rowId: 'r1', sourceLabel: 'a.pdf' });
    store.apply({ type: 'ingestion.queued', rowId: 'r2', sourceLabel: 'b.pdf' });
    let a = 0;
    let b = 0;
    store.subscribeRow('r1', () => (a += 1));
    store.subscribeRow('r2', () => (b += 1));
    store.apply({ type: 'cgi.cash_split_alert', rowId: 'r1', ruleCode: 'X' });
    expect([a, b]).toEqual([1, 0]);
    expect(store.getRow('r1')?.cashSplitAlert).toBe(true);
  });
  it('ingestion.queued rejoué = sans effet ; il ne régresse jamais une ligne déjà extraite', () => {
    const store = createPurchaseInboxStore([]);
    let created = 0;
    store.subscribeCreated(() => (created += 1));
    store.apply({ type: 'ingestion.queued', rowId: 'r1', sourceLabel: 'a.pdf' });
    store.apply({ type: 'ocr.fields_extracted', rowId: 'r1', supplierName: 'A', documentDate: null, totalTtcCents: null, confidenceBps: 1 });
    store.apply({ type: 'ingestion.queued', rowId: 'r1', sourceLabel: 'a.pdf' });
    expect(created).toBe(1);
    expect(store.getRow('r1')?.status).toBe('extracted');
    expect(store.getRow('r1')?.totalTtcCents).toBeNull();
  });
  it('un événement de mise à jour pour une ligne inconnue (flux repris) crée la ligne', () => {
    const store = createPurchaseInboxStore([]);
    let created = 0;
    store.subscribeCreated(() => (created += 1));
    store.apply({ type: 'cgi.cash_split_alert', rowId: 'late', ruleCode: 'X' });
    expect(created).toBe(1);
    expect(store.getRow('late')?.cashSplitAlert).toBe(true);
  });
  it('montant illisible : indicateur explicite, centimes null', () => {
    const store = createPurchaseInboxStore([]);
    store.apply({ type: 'ocr.fields_extracted', rowId: 'r', supplierName: null, documentDate: null, totalTtcCents: null, confidenceBps: 100 });
    expect(store.getRow('r')).toMatchObject({ amountIllegible: true, totalTtcCents: null });
  });
});
