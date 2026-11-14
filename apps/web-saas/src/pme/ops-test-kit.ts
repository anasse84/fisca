import type { EventSourceFactoryRequest, EventSourceLike } from './purchase-stream.ts';
import type { PmeFetch } from './pme-api.ts';
import type { PurchaseRow } from './purchase-model.ts';
import type { BankReconciliationSource, BankWorkspace, DisputeEvidencePort, LateInvoiceRadar, LateInvoiceRadarSource } from './ports-ops.ts';

/** Données de test seulement (non importées par le code de production). */
export const E1 = '0190f0f0-0000-7000-8000-000000000001';
export const E2 = '0190f0f0-0000-7000-8000-000000000002';
export const E3 = '0190f0f0-0000-7000-8000-000000000003';

export class FakeEventSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  readonly listeners = new Map<string, ((e: { data: string; lastEventId: string }) => void)[]>();
  constructor(readonly request: EventSourceFactoryRequest) {}
  addEventListener(type: string, listener: (e: { data: string; lastEventId: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data: unknown, id: string): void {
    for (const l of this.listeners.get(type) ?? []) l({ data: JSON.stringify(data), lastEventId: id });
  }
  open(): void {
    this.readyState = 1;
    for (const l of this.listeners.get('open') ?? []) l({ data: '', lastEventId: '' });
  }
}

export function fakeEventSourceFactory(): { readonly sources: FakeEventSource[]; readonly factory: (r: EventSourceFactoryRequest) => EventSourceLike } {
  const sources: FakeEventSource[] = [];
  return {
    sources,
    factory: (request) => {
      const s = new FakeEventSource(request);
      sources.push(s);
      return s;
    },
  };
}

export const PROPOSAL = {
  journalId: 'JRN-ACH',
  fiscalYearId: 'FY-1',
  entryDate: '2027-02-03',
  reviewCycle: 'ACHATS',
  sourceDocumentType: 'INVOICE',
  confidenceBps: 9100,
  lines: [
    { accountNumber: '6111', debitCents: 10000, creditCents: 0, description: 'Achat de marchandises' },
    { accountNumber: '3455', debitCents: 2000, creditCents: 0, description: 'TVA récupérable' },
    { accountNumber: '4411', debitCents: 0, creditCents: 12000, description: 'Fournisseur' },
  ],
} as const;

export const row = (id: string, over: Partial<PurchaseRow> = {}): PurchaseRow => ({
  id,
  sourceLabel: `piece-${id}.pdf`,
  status: 'proposed',
  supplierName: `Fournisseur ${id}`,
  documentDate: '2027-02-01',
  totalTtcCents: 12000,
  amountIllegible: false,
  confidenceBps: 9100,
  cashSplitAlert: false,
  proposal: { ...PROPOSAL, lines: [...PROPOSAL.lines] },
  ...over,
});

export interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

export function recordingFetch(respond: (call: Call) => Response): { readonly fetch: PmeFetch; readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      };
      calls.push(call);
      return respond(call);
    },
  };
}

export const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' } });

export const BANK_WORKSPACE: BankWorkspace = {
  context: { journalId: 'JRN-BQ', fiscalYearId: 'FY-1', paymentMethods: ['30_VIREMENT', '20_CHEQUE'] },
  lines: [
    { id: 'b-unique', valueDate: '2027-02-05', label: 'VIR ATLAS', amountCents: 12000, paymentMethodCode: '30_VIREMENT' },
    { id: 'b-ambig', valueDate: '2027-02-06', label: 'VIR DIVERS', amountCents: 5000, paymentMethodCode: '30_VIREMENT' },
    { id: 'b-none', valueDate: '2027-02-07', label: 'FRAIS BANCAIRES', amountCents: -250, paymentMethodCode: '30_VIREMENT' },
  ],
  entries: [
    { invoiceEntryId: E1, reference: 'FAC-001', partnerLabel: 'Atlas Services', openCents: 12000, settledBeforeCents: 0, dueDate: '2027-02-01' },
    { invoiceEntryId: E2, reference: 'FAC-002', partnerLabel: 'Client Alpha', openCents: 5000, settledBeforeCents: 0, dueDate: '2027-02-02' },
    { invoiceEntryId: E3, reference: 'FAC-003', partnerLabel: 'Client Beta', openCents: 5000, settledBeforeCents: 0, dueDate: '2027-02-03' },
  ],
  suggestions: [
    { bankTransactionId: 'b-unique', candidateEntryIds: [E1], scoreBps: 9400 },
    { bankTransactionId: 'b-ambig', candidateEntryIds: [E2, E3], scoreBps: 5200 },
    { bankTransactionId: 'b-none', candidateEntryIds: [], scoreBps: 0 },
  ],
};

export const bankSource = (ws: BankWorkspace = BANK_WORKSPACE): BankReconciliationSource => ({ loadWorkspace: async () => ws });

export const RADAR: LateInvoiceRadar = {
  asOfDate: '2027-04-10',
  invoices: [
    { invoiceId: 'inv-1', number: 'FAC-101', customerName: 'Client Retard SARL', dueDate: '2027-02-23', amountDueCents: 1200000, daysLate: 46, penaltyCents: 44500, penaltyFrozen: false, disputeStatus: 'none' },
    { invoiceId: 'inv-2', number: 'FAC-102', customerName: 'Client Litige SA', dueDate: '2027-01-15', amountDueCents: 800000, daysLate: 85, penaltyCents: 31000, penaltyFrozen: true, disputeStatus: 'documented' },
  ],
};

export const radarSource = (data: LateInvoiceRadar = RADAR): LateInvoiceRadarSource => ({ loadRadar: async () => data });

export function evidencePort(overrides: Partial<DisputeEvidencePort> = {}): DisputeEvidencePort & { readonly submissions: { invoiceId: string; names: string[]; hashes: string[] }[] } {
  const submissions: { invoiceId: string; names: string[]; hashes: string[] }[] = [];
  return {
    submissions,
    loadPolicy: async () => ({ maxFileBytes: 2_000_000, maxFiles: 3, allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'] }),
    submitEvidence: async (invoiceId, files) => {
      submissions.push({ invoiceId, names: files.map((f) => f.file.name), hashes: files.map((f) => f.sha256Hex) });
      return { ok: true, disputeStatus: 'documented', penaltyFrozen: true };
    },
    ...overrides,
  };
}
