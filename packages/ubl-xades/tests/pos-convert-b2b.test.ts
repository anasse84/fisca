import { isValidIceChecksum, type SqlStatementParams } from '@fisca/shared-types';
import { describe, expect, it } from 'vitest';
import { convertPosTicketToB2b, type PosConversionPorts, type PosConversionStore, type PosTicketForConversion } from '../src/pos/index.ts';

const ICE = '001197530853397';
const TOKEN = 'qr-token-0000000000000001';
const NOW = '2026-11-14T08:00:00.000Z';
const CONFIG = { conversionWindowDays: 30 };

const baseTicket: PosTicketForConversion = {
  ticketId: 'tkt-1', ticketKind: 'SALE_B2C', sessionId: 'sess-1', terminalId: 'POS-M01-C01', issuedAtIso: '2026-11-13T10:15:00.000Z',
  ht20Cents: 100000, vat20Cents: 20000, ht10Cents: 0, vat10Cents: 0, ht0Cents: 0, stampDutyCents: 0, totalTtcCents: 120000,
  conversionState: 'NONE', convertedInvoiceId: null, closure: null,
};
const sealed = { closureId: 'z-1', businessDate: '2026-11-13', glJournalEntryId: 'je-1' } as const;

/** Magasin mémoire transactionnel : `execute` applique le lot en tout ou rien ; `failAt` provoque l'échec de la n-ième instruction. */
function fakeStore(ticket: PosTicketForConversion | null) {
  const state = { ticket, invoices: [] as string[], reversals: [] as string[], executed: 0, failAt: null as number | null };
  const store: PosConversionStore = {
    findByQrToken: (token) => Promise.resolve(token === TOKEN ? state.ticket : null),
    execute: (statements) => {
      state.executed += 1;
      const draft = { invoices: [...state.invoices], reversals: [...state.reversals], ticket: state.ticket };
      try {
        statements.forEach((statement, index) => {
          if (state.failAt === index + 1) throw new Error('panne au statement');
          if (statement.sql.startsWith('INSERT INTO invoices')) draft.invoices.push(String(statement.params[0]));
          if (statement.sql.startsWith('INSERT INTO reversal')) draft.reversals.push(String(statement.params[0]));
          if (statement.sql.startsWith('UPDATE pos_tickets') && draft.ticket !== null) {
            draft.ticket = { ...draft.ticket, conversionState: statement.params[0] as PosTicketForConversion['conversionState'], convertedInvoiceId: String(statement.params[1]) };
          }
        });
      } catch (error) {
        return Promise.reject(error);
      }
      state.invoices = draft.invoices;
      state.reversals = draft.reversals;
      state.ticket = draft.ticket;
      return Promise.resolve();
    },
  };
  return { state, store };
}

function portsFor(store: PosConversionStore, spy: { amounts: unknown[] } = { amounts: [] }, certification?: PosConversionPorts['certification']): PosConversionPorts {
  let counter = 0;
  const invoiceStatement = (id: string): SqlStatementParams => ({ sql: 'INSERT INTO invoices (id) VALUES (?)', params: [id] });
  return {
    store,
    clock: { nowIso: () => NOW },
    ids: { newId: () => `inv-${(counter += 1)}` },
    invoices: {
      buildDraftStatements: (input) => {
        spy.amounts.push({ kind: 'invoice', vat: input.ticket.vat20Cents + input.ticket.vat10Cents, ht: input.ticket.ht20Cents + input.ticket.ht10Cents + input.ticket.ht0Cents });
        return Promise.resolve([invoiceStatement(input.invoiceId)]);
      },
    },
    reversal: {
      buildReversalStatements: (input) => {
        spy.amounts.push({ kind: 'reversal', vat: input.ticket.vat20Cents + input.ticket.vat10Cents, ht: input.ticket.ht20Cents + input.ticket.ht10Cents + input.ticket.ht0Cents, link: input.glJournalEntryId });
        return Promise.resolve([{ sql: 'INSERT INTO reversal (id) VALUES (?)', params: [`rev-of-${input.glJournalEntryId}`] }]);
      },
    },
    ...(certification === undefined ? {} : { certification }),
  };
}

const convert = (ports: PosConversionPorts, overrides: Partial<{ qrToken: string; clientIce: string }> = {}) =>
  convertPosTicketToB2b(ports, CONFIG, { qrToken: TOKEN, clientIce: ICE, clientLegalName: null, ...overrides });

describe('convertPosTicketToB2b', () => {
  it('l’ICE de test est valide (clé de contrôle)', () => {
    expect(isValidIceChecksum(ICE)).toBe(true);
  });
  it('avant Z : CONVERTI_B2B_AVANT_Z, brouillon de facture et marquage, aucune extourne', async () => {
    const { state, store } = fakeStore(baseTicket);
    const result = await convert(portsFor(store));
    expect(result).toEqual({ invoiceId: 'inv-1', state: 'CONVERTI_B2B_AVANT_Z', reversalApplied: false, certificationPending: false });
    expect(state.reversals).toEqual([]);
    expect(state.ticket).toMatchObject({ conversionState: 'CONVERTI_B2B_AVANT_Z', convertedInvoiceId: 'inv-1' });
  });
  it('après Z : CONVERTI_B2B_POST_Z_NEUTRALISE, extourne liée à l’écriture du Ticket Z, UNE transaction', async () => {
    const { state, store } = fakeStore({ ...baseTicket, closure: sealed });
    const result = await convert(portsFor(store));
    expect(result).toMatchObject({ state: 'CONVERTI_B2B_POST_Z_NEUTRALISE', reversalApplied: true });
    expect(state.executed).toBe(1);
    expect(state.reversals).toEqual(['rev-of-je-1']);
    expect(state.invoices).toEqual(['inv-1']);
  });
  it('pas de double imposition : TVA de l’extourne = TVA de la facture = TVA du ticket (somme conservée)', async () => {
    const spy = { amounts: [] as { kind: string; vat: number; ht: number }[] };
    const { store } = fakeStore({ ...baseTicket, closure: sealed });
    await convert(portsFor(store, spy));
    const invoice = spy.amounts.find((a) => a.kind === 'invoice');
    const reversal = spy.amounts.find((a) => a.kind === 'reversal');
    expect(invoice).toMatchObject({ vat: 20000, ht: 100000 });
    expect(reversal).toMatchObject({ vat: 20000, ht: 100000 });
    const zVat = 20000;
    expect(zVat - (reversal?.vat ?? 0) + (invoice?.vat ?? 0)).toBe(20000);
  });
  it('déjà convertie : POS_TICKET_ALREADY_CONVERTED, aucune écriture', async () => {
    const { state, store } = fakeStore({ ...baseTicket, conversionState: 'CONVERTI_B2B_AVANT_Z', convertedInvoiceId: 'inv-0' });
    await expect(convert(portsFor(store))).rejects.toMatchObject({ code: 'POS_TICKET_ALREADY_CONVERTED' });
    expect(state.executed).toBe(0);
  });
  it('second scan après une conversion réussie : 409', async () => {
    const { store } = fakeStore({ ...baseTicket, closure: sealed });
    const ports = portsFor(store);
    await convert(ports);
    await expect(convert(ports)).rejects.toMatchObject({ code: 'POS_TICKET_ALREADY_CONVERTED' });
  });
  it('atomicité : échec au 2e statement, rien d’écrit (ni facture, ni extourne, ni marquage)', async () => {
    const { state, store } = fakeStore({ ...baseTicket, closure: sealed });
    state.failAt = 2;
    await expect(convert(portsFor(store))).rejects.toMatchObject({ code: 'POS_CONVERSION_FAILED' });
    expect(state.invoices).toEqual([]);
    expect(state.reversals).toEqual([]);
    expect(state.ticket).toMatchObject({ conversionState: 'NONE', convertedInvoiceId: null });
    state.failAt = null;
    await expect(convert(portsFor(store))).resolves.toMatchObject({ state: 'CONVERTI_B2B_POST_Z_NEUTRALISE' });
  });
  it('course perdue (UNIQUE) : l’échec est rapporté comme déjà converti si le ticket l’est désormais', async () => {
    const { state, store } = fakeStore({ ...baseTicket });
    const racing: PosConversionStore = {
      findByQrToken: store.findByQrToken,
      execute: () => {
        state.ticket = { ...baseTicket, conversionState: 'CONVERTI_B2B_AVANT_Z', convertedInvoiceId: 'inv-autre' };
        return Promise.reject(new Error('UNIQUE constraint failed'));
      },
    };
    await expect(convert(portsFor(racing))).rejects.toMatchObject({ code: 'POS_TICKET_ALREADY_CONVERTED' });
  });
  it('jeton inconnu et jeton hors fenêtre (31 jours après Z) : même erreur POS_TOKEN_UNKNOWN', async () => {
    const { store } = fakeStore({ ...baseTicket, closure: { ...sealed, businessDate: '2026-10-14' } });
    await expect(convert(portsFor(store), {})).rejects.toMatchObject({ code: 'POS_TOKEN_UNKNOWN' });
    await expect(convert(portsFor(fakeStore(baseTicket).store), { qrToken: 'inconnu' })).rejects.toMatchObject({ code: 'POS_TOKEN_UNKNOWN' });
    const inWindow = fakeStore({ ...baseTicket, closure: { ...sealed, businessDate: '2026-10-15' } });
    await expect(convert(portsFor(inWindow.store))).resolves.toMatchObject({ reversalApplied: true });
  });
  it('Z scellé mais écriture comptable absente : POS_Z_ENTRY_PENDING, rien d’écrit', async () => {
    const { state, store } = fakeStore({ ...baseTicket, closure: { ...sealed, glJournalEntryId: null } });
    await expect(convert(portsFor(store))).rejects.toMatchObject({ code: 'POS_Z_ENTRY_PENDING' });
    expect(state.executed).toBe(0);
  });
  it('ICE invalide (longueur, lettres, clé de contrôle) et ticket de remboursement refusés', async () => {
    const { store } = fakeStore(baseTicket);
    for (const bad of ['123', '00119753085339X', '001197530853398', '']) {
      await expect(convert(portsFor(store), { clientIce: bad }), bad).rejects.toMatchObject({ code: 'POS_CLIENT_ICE_INVALID' });
    }
    const refund = fakeStore({ ...baseTicket, ticketKind: 'RETURN_REFUND' });
    await expect(convert(portsFor(refund.store))).rejects.toMatchObject({ code: 'POS_TICKET_NOT_CONVERTIBLE' });
  });
  it('certification : démarrée après validation ; son échec n’annule pas la conversion (certificationPending)', async () => {
    const started: string[] = [];
    const ok = fakeStore(baseTicket);
    expect(await convert(portsFor(ok.store, undefined, { start: (id) => (started.push(id), Promise.resolve()) }))).toMatchObject({ certificationPending: false });
    expect(started).toEqual(['inv-1']);
    const ko = fakeStore(baseTicket);
    expect(await convert(portsFor(ko.store, undefined, { start: () => Promise.reject(new Error('HSM')) }))).toMatchObject({ certificationPending: true });
    expect(ko.state.ticket?.conversionState).toBe('CONVERTI_B2B_AVANT_Z');
  });
  it('les erreurs ne contiennent ni ICE ni jeton', async () => {
    const { store } = fakeStore({ ...baseTicket, conversionState: 'CONVERTI_B2B_AVANT_Z', convertedInvoiceId: 'x' });
    const error = await convert(portsFor(store)).catch((e: Error) => e);
    expect(String(error)).not.toContain(ICE);
    expect(String(error)).not.toContain(TOKEN);
  });
});
