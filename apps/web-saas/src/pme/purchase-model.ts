/**
 * Modèle de la boîte d'achats : événements SSE typés (Doc_07 § 03), état par ligne à identifiant fixe.
 * Aucun code serveur n'existe pour CTR-API-21/22 (DRAFT) : la forme des charges utiles est un CONTRAT CLIENT PROVISOIRE,
 * validé strictement ici ; tout événement mal formé est ignoré (jamais deviné). Montants : centimes entiers ou `null` (illisible).
 */
import type { PurchaseEventType } from './purchase-stream.ts';

export type ExtractionStatus = 'queued' | 'extracted' | 'proposed';

export interface PurchaseProposalLine {
  readonly accountNumber: string;
  readonly debitCents: number;
  readonly creditCents: number;
  readonly description: string;
}

/** Proposition d'écriture de l'IA (jamais validée sans geste humain). `entryId` présent si le serveur a déjà créé l'IA_PROPOSITION. */
export interface PurchaseProposal {
  readonly journalId: string;
  readonly fiscalYearId: string;
  readonly entryDate: string;
  readonly reviewCycle: string;
  readonly sourceDocumentType: string;
  readonly confidenceBps: number;
  readonly lines: readonly PurchaseProposalLine[];
  readonly entryId?: string | undefined;
}

export interface PurchaseRow {
  readonly id: string;
  readonly sourceLabel: string;
  readonly status: ExtractionStatus;
  readonly supplierName: string | null;
  readonly documentDate: string | null;
  readonly totalTtcCents: number | null;
  readonly amountIllegible: boolean;
  readonly confidenceBps: number | null;
  readonly cashSplitAlert: boolean;
  readonly proposal: PurchaseProposal | null;
}

export type PurchaseStreamEvent =
  | { readonly type: 'ingestion.queued'; readonly rowId: string; readonly sourceLabel: string }
  | {
      readonly type: 'ocr.fields_extracted';
      readonly rowId: string;
      readonly supplierName: string | null;
      readonly documentDate: string | null;
      readonly totalTtcCents: number | null;
      readonly confidenceBps: number;
    }
  | { readonly type: 'cgi.cash_split_alert'; readonly rowId: string; readonly ruleCode: string }
  | { readonly type: 'pcge.account_proposed'; readonly rowId: string; readonly proposal: PurchaseProposal };

const MAX_BPS = 10000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNullableText = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isBps = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_BPS;

function parseProposal(value: unknown): PurchaseProposal | null {
  if (!isRecord(value)) return null;
  const { journalId, fiscalYearId, entryDate, reviewCycle, sourceDocumentType, confidenceBps, lines, entryId } = value;
  if (!isText(journalId) || !isText(fiscalYearId) || typeof entryDate !== 'string' || !ISO_DATE.test(entryDate)) return null;
  if (!isText(reviewCycle) || !isText(sourceDocumentType) || !isBps(confidenceBps) || !Array.isArray(lines) || lines.length === 0) return null;
  const parsed: PurchaseProposalLine[] = [];
  for (const line of lines) {
    if (!isRecord(line)) return null;
    const { accountNumber, debitCents, creditCents, description } = line;
    if (!isText(accountNumber) || !isCents(debitCents) || !isCents(creditCents) || typeof description !== 'string') return null;
    parsed.push({ accountNumber, debitCents, creditCents, description });
  }
  if (entryId !== undefined && !isText(entryId)) return null;
  return { journalId, fiscalYearId, entryDate, reviewCycle, sourceDocumentType, confidenceBps, lines: parsed, ...(entryId === undefined ? {} : { entryId }) };
}

/** Analyse stricte d'un événement ; `null` si le type, l'identifiant de ligne ou un champ est invalide. */
export function parsePurchaseEvent(type: string, raw: string | unknown): PurchaseStreamEvent | null {
  let body: unknown = raw;
  if (typeof raw === 'string') {
    try {
      body = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(body) || !isText(body['rowId'])) return null;
  const rowId = body['rowId'];
  switch (type as PurchaseEventType) {
    case 'ingestion.queued':
      return isText(body['sourceLabel']) ? { type: 'ingestion.queued', rowId, sourceLabel: body['sourceLabel'] } : null;
    case 'ocr.fields_extracted': {
      const { supplierName, documentDate, totalTtcCents, confidenceBps } = body;
      if (!isNullableText(supplierName) || !isNullableText(documentDate) || !(totalTtcCents === null || isCents(totalTtcCents)) || !isBps(confidenceBps)) return null;
      return { type: 'ocr.fields_extracted', rowId, supplierName, documentDate, totalTtcCents, confidenceBps };
    }
    case 'cgi.cash_split_alert':
      return isText(body['ruleCode']) ? { type: 'cgi.cash_split_alert', rowId, ruleCode: body['ruleCode'] } : null;
    case 'pcge.account_proposed': {
      const proposal = parseProposal(body['proposal']);
      return proposal === null ? null : { type: 'pcge.account_proposed', rowId, proposal };
    }
    default:
      return null;
  }
}

const EMPTY_ROW = (id: string): PurchaseRow => ({
  id,
  sourceLabel: id,
  status: 'queued',
  supplierName: null,
  documentDate: null,
  totalTtcCents: null,
  amountIllegible: false,
  confidenceBps: null,
  cashSplitAlert: false,
  proposal: null,
});

const RANK: Record<ExtractionStatus, number> = { queued: 0, extracted: 1, proposed: 2 };
const maxStatus = (a: ExtractionStatus, b: ExtractionStatus): ExtractionStatus => (RANK[a] >= RANK[b] ? a : b);

/** Applique un événement à une ligne (pure, idempotente) ; un statut ne régresse jamais. */
export function applyPurchaseEvent(current: PurchaseRow | undefined, event: PurchaseStreamEvent): PurchaseRow {
  const row = current ?? EMPTY_ROW(event.rowId);
  switch (event.type) {
    case 'ingestion.queued':
      return current === undefined ? { ...row, sourceLabel: event.sourceLabel } : row;
    case 'ocr.fields_extracted':
      return {
        ...row,
        status: maxStatus(row.status, 'extracted'),
        supplierName: event.supplierName,
        documentDate: event.documentDate,
        totalTtcCents: event.totalTtcCents,
        amountIllegible: event.totalTtcCents === null,
        confidenceBps: event.confidenceBps,
      };
    case 'cgi.cash_split_alert':
      return { ...row, cashSplitAlert: true };
    case 'pcge.account_proposed':
      return { ...row, status: maxStatus(row.status, 'proposed'), proposal: event.proposal };
  }
}

export interface PurchaseInboxStore {
  getRow(id: string): PurchaseRow | undefined;
  /** Abonnement aux modifications d'UNE ligne (cellules vivantes sans changer la ligne de la grille). */
  subscribeRow(id: string, listener: () => void): () => void;
  /** Abonnement aux lignes nouvellement créées (lot, plus récent en tête). */
  subscribeCreated(listener: (rows: readonly PurchaseRow[]) => void): () => void;
  apply(event: PurchaseStreamEvent): void;
}

export function createPurchaseInboxStore(initial: readonly PurchaseRow[]): PurchaseInboxStore {
  const rows = new Map<string, PurchaseRow>(initial.map((r) => [r.id, r]));
  const rowListeners = new Map<string, Set<() => void>>();
  const createdListeners = new Set<(rows: readonly PurchaseRow[]) => void>();
  return {
    getRow: (id) => rows.get(id),
    subscribeRow(id, listener) {
      const set = rowListeners.get(id) ?? new Set<() => void>();
      set.add(listener);
      rowListeners.set(id, set);
      return () => {
        set.delete(listener);
      };
    },
    subscribeCreated(listener) {
      createdListeners.add(listener);
      return () => {
        createdListeners.delete(listener);
      };
    },
    apply(event) {
      const before = rows.get(event.rowId);
      const after = applyPurchaseEvent(before, event);
      if (before !== undefined && after === before) return;
      rows.set(event.rowId, after);
      if (before === undefined) {
        for (const listener of createdListeners) listener([after]);
        return;
      }
      for (const listener of rowListeners.get(event.rowId) ?? []) listener();
    },
  };
}
