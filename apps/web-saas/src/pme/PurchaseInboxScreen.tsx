import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { directionOf } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { AiCrafterAmountField, FiscalAmount, MercuryGrid } from '@fisca/ui-mercury';
import type { GridDensity, MercuryGridColumn, RowListener } from '@fisca/ui-mercury';
import { FiscaReviewDrawer, resolveAiCrafterCardLabels } from '../shared/command-review.tsx';
import { OpsBadge, DensityToggle, IsoTime, ProblemAlert } from './ops-shared.tsx';
import type { IconKind } from './ops-shared.tsx';
import { commonText, fillTemplate, pmeText } from './labels.tsx';
import { createPurchaseInboxStore, parsePurchaseEvent } from './purchase-model.ts';
import type { ExtractionStatus, PurchaseInboxStore, PurchaseProposal, PurchaseRow } from './purchase-model.ts';
import { connectPurchaseStream } from './purchase-stream.ts';
import type { EventSourceFactory, PurchaseStreamStatus } from './purchase-stream.ts';
import { newIdempotencyKey } from './uuid-v7.ts';
import type { PmeApi, PmeProblem } from './pme-api.ts';
import './pme.css';
import './pme-ops.css';

export interface PurchaseInboxScreenProps {
  readonly locale: FiscaLocale;
  readonly api: PmeApi;
  /** CTR-API-22 : GET /api/v1/purchases/stream. */
  readonly streamUrl: string;
  /** Fabrique d'EventSource (voir `createFetchEventSource` : en-têtes d'authentification et Last-Event-ID). */
  readonly eventSourceFactory: EventSourceFactory;
  readonly initialRows?: readonly PurchaseRow[];
  readonly defaultDensity?: GridDensity;
  readonly onDensityChange?: (density: GridDensity) => void;
  /** Hauteur de la fenêtre de grille (px) avant mesure. */
  readonly viewportHeight?: number;
  readonly newKey?: () => string;
}

const STATUS_ICON: Readonly<Record<ExtractionStatus, IconKind>> = { queued: 'queued', extracted: 'extracted', proposed: 'proposed' };
const DEFAULT_VIEWPORT_PX = 440;
const INITIAL_STATUS: ExtractionStatus = 'queued';

function useLiveRow(store: PurchaseInboxStore, id: string): PurchaseRow | undefined {
  const subscribe = useCallback((listener: () => void) => store.subscribeRow(id, listener), [store, id]);
  return useSyncExternalStore(subscribe, () => store.getRow(id));
}

function Skeleton(): ReactElement {
  return <span className="fisca-pme-ops__skeleton" aria-hidden="true" />;
}

interface CellProps {
  readonly store: PurchaseInboxStore;
  readonly id: string;
  readonly locale: FiscaLocale;
}

function SourceCell({ store, id }: CellProps): ReactElement {
  const row = useLiveRow(store, id);
  return <span className="fisca-pme-ops__ellipsis fisca-pme-ops__acct">{row?.sourceLabel ?? ''}</span>;
}

function SupplierCell({ store, id }: CellProps): ReactElement {
  const row = useLiveRow(store, id);
  return row === undefined || row.supplierName === null ? <Skeleton /> : <span className="fisca-pme-ops__ellipsis fisca-pme-ops__acct">{row.supplierName}</span>;
}

function DateCell({ store, id }: CellProps): ReactElement {
  const row = useLiveRow(store, id);
  return row === undefined || row.documentDate === null ? <Skeleton /> : <IsoTime value={row.documentDate} />;
}

function TotalCell({ store, id, locale }: CellProps): ReactElement {
  const row = useLiveRow(store, id);
  if (row === undefined || row.status === 'queued') return <Skeleton />;
  if (row.totalTtcCents === null) return <OpsBadge kind="illegible" tone="warning" label={pmeText(locale, 'purchases.illegible')} />;
  return <FiscalAmount amountCents={row.totalTtcCents} />;
}

function StatusCell({ store, id, locale }: CellProps): ReactElement {
  const row = useLiveRow(store, id);
  const status = row?.status ?? INITIAL_STATUS;
  return <OpsBadge kind={STATUS_ICON[status]} dataAttr="data-state" dataValue={status} label={pmeText(locale, `purchases.status.${status}`)} />;
}

function AlertCell({ store, id, locale }: CellProps): ReactElement {
  const row = useLiveRow(store, id);
  return row?.cashSplitAlert === true ? <OpsBadge kind="alert" tone="warning" dataAttr="data-alert" dataValue="cash-split" label={pmeText(locale, 'purchases.alert.cashSplit')} /> : <span />;
}

type Step = 'create' | 'submit' | 'visa';
type Stage = 'idle' | 'running' | 'submitted' | 'visaed' | 'error';

interface Progress {
  readonly stage: Stage;
  readonly entryId: string | null;
  readonly failedStep: Step | null;
  readonly errorCode: string | null;
}

const IDLE: Progress = { stage: 'idle', entryId: null, failedStep: null, errorCode: null };

function lineTotals(proposal: PurchaseProposal): { readonly debitCents: number; readonly creditCents: number } {
  let debitCents = 0;
  let creditCents = 0;
  for (const line of proposal.lines) {
    debitCents += line.debitCents;
    creditCents += line.creditCents;
  }
  return { debitCents, creditCents };
}

export function PurchaseInboxScreen({
  locale,
  api,
  streamUrl,
  eventSourceFactory,
  initialRows = [],
  defaultDensity = 'comfortable',
  onDensityChange,
  viewportHeight = DEFAULT_VIEWPORT_PX,
  newKey = newIdempotencyKey,
}: PurchaseInboxScreenProps): ReactElement {
  const t = (key: string): string => pmeText(locale, key);
  const store = useMemo(() => createPurchaseInboxStore(initialRows), []);
  const [gridRows, setGridRows] = useState<readonly PurchaseRow[]>(initialRows);
  const gridCount = useRef(initialRows.length);
  const listenerRef = useRef<RowListener<PurchaseRow> | null>(null);
  const [status, setStatus] = useState<PurchaseStreamStatus>('connecting');
  const [density, setDensity] = useState<GridDensity>(defaultDensity);
  const [openId, setOpenId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Readonly<Record<string, Progress>>>({});
  const keys = useRef(new Map<string, string>());
  const busy = useRef(new Set<string>());

  const subscribe = useCallback((listener: RowListener<PurchaseRow>) => {
    listenerRef.current = listener;
    return () => {
      if (listenerRef.current === listener) listenerRef.current = null;
    };
  }, []);

  useEffect(
    () =>
      store.subscribeCreated((rows) => {
        if (gridCount.current === 0) {
          gridCount.current = rows.length;
          setGridRows(rows);
          return;
        }
        gridCount.current += rows.length;
        listenerRef.current?.(rows);
      }),
    [store],
  );

  useEffect(() => {
    const handle = connectPurchaseStream({
      url: streamUrl,
      factory: eventSourceFactory,
      onStatus: setStatus,
      onEvent: (type, data) => {
        const event = parsePurchaseEvent(type, data);
        if (event !== null) store.apply(event);
      },
    });
    return () => handle.close();
  }, [store, streamUrl, eventSourceFactory]);

  const changeDensity = (next: GridDensity): void => {
    setDensity(next);
    onDensityChange?.(next);
  };

  const columns = useMemo<readonly MercuryGridColumn<PurchaseRow>[]>(() => {
    const cell = (Component: (props: CellProps) => ReactElement) => (context: { readonly row: { readonly original: PurchaseRow } }): ReactNode => (
      <Component store={store} id={context.row.original.id} locale={locale} />
    );
    const head = (key: string, end = false) => (): ReactNode => <span className={end ? 'fisca-grid__head-cell--end' : undefined}>{pmeText(locale, key)}</span>;
    return [
      { id: 'source', header: head('purchases.col.source'), size: 180, cell: cell(SourceCell) },
      { id: 'supplier', header: head('purchases.col.supplier'), size: 190, cell: cell(SupplierCell) },
      { id: 'date', header: head('purchases.col.date'), size: 120, cell: cell(DateCell) },
      { id: 'total', header: head('purchases.col.total', true), size: 170, cell: cell(TotalCell) },
      { id: 'status', header: head('purchases.col.status'), size: 200, cell: cell(StatusCell) },
      { id: 'alert', header: head('purchases.col.alert'), size: 300, cell: cell(AlertCell) },
      {
        id: 'open',
        header: head('purchases.col.open'),
        size: 120,
        cell: (context): ReactNode => (
          <button
            type="button"
            className="fisca-pme-ops__row-button"
            aria-label={fillTemplate(pmeText(locale, 'purchases.openLabel'), { name: context.row.original.sourceLabel })}
            onClick={() => setOpenId(context.row.original.id)}
          >
            {pmeText(locale, 'purchases.open')}
          </button>
        ),
      },
    ] as readonly MercuryGridColumn<PurchaseRow>[];
  }, [locale, store]);

  const gridLabels = useMemo(() => {
    const template = pmeText(locale, 'purchases.newRows');
    return {
      ariaLabel: pmeText(locale, 'purchases.gridLabel'),
      newRows: (count: number) => template.replace('{count}', String(count)),
      loadingRow: commonText(locale, 'states.loading'),
    };
  }, [locale]);

  // ---------------------------------------------------------------- revue et validation humaine

  const open = openId === null ? undefined : store.getRow(openId);
  // La ligne ouverte peut évoluer pendant que le tiroir est affiché (flux) : on la relit à chaque rendu via un abonnement.
  const openRow = useOpenRow(store, openId) ?? open;
  const current: Progress = (openId === null ? undefined : progress[openId]) ?? IDLE;

  const setStage = (id: string, next: Progress): void => setProgress((prev) => ({ ...prev, [id]: next }));

  const keyFor = (id: string, step: Step): string => {
    const slot = `${id}:${step}`;
    const existing = keys.current.get(slot);
    if (existing !== undefined) return existing;
    const fresh = newKey();
    keys.current.set(slot, fresh);
    return fresh;
  };

  const fail = (id: string, entryId: string | null, step: Step, problem: PmeProblem): void => {
    setStage(id, { stage: 'error', entryId, failedStep: step, errorCode: problem.errorCode });
  };

  /** Geste humain n° 1 : créer l'IA_PROPOSITION si le serveur ne l'a pas déjà créée (CTR-API-45), puis la soumettre (CTR-API-46). */
  const submitProposal = async (row: PurchaseRow): Promise<void> => {
    const proposal = row.proposal;
    if (proposal === null || row.amountIllegible || busy.current.has(row.id)) return;
    busy.current.add(row.id);
    try {
      const before = progress[row.id] ?? IDLE;
      let entryId = before.entryId ?? proposal.entryId ?? null;
      setStage(row.id, { stage: 'running', entryId, failedStep: null, errorCode: null });
      if (entryId === null) {
        const created = await api.createEntry(
          {
            journalId: proposal.journalId,
            fiscalYearId: proposal.fiscalYearId,
            entryDate: proposal.entryDate,
            reviewCycle: proposal.reviewCycle,
            sourceDocumentType: proposal.sourceDocumentType,
            initialState: 'IA_PROPOSITION',
            lines: proposal.lines.map((l) => ({ accountNumber: l.accountNumber, debitCents: l.debitCents, creditCents: l.creditCents, description: l.description })),
          },
          keyFor(row.id, 'create'),
        );
        if (!created.ok) {
          fail(row.id, null, 'create', created.problem);
          return;
        }
        entryId = created.data.entryId;
        keys.current.delete(`${row.id}:create`);
      }
      const submitted = await api.submitEntry(entryId, keyFor(row.id, 'submit'));
      if (!submitted.ok) {
        fail(row.id, entryId, 'submit', submitted.problem);
        return;
      }
      keys.current.delete(`${row.id}:submit`);
      setStage(row.id, { stage: 'submitted', entryId, failedStep: null, errorCode: null });
    } finally {
      busy.current.delete(row.id);
    }
  };

  /** Geste humain n° 2, distinct : le visa du cycle (CTR-API-48, droit LEDGER_VISA_CYCLE vérifié par le serveur). */
  const visaEntry = async (row: PurchaseRow): Promise<void> => {
    const entryId = progress[row.id]?.entryId ?? null;
    if (entryId === null || busy.current.has(row.id)) return;
    busy.current.add(row.id);
    try {
      setStage(row.id, { stage: 'running', entryId, failedStep: null, errorCode: null });
      const visaed = await api.visaEntry(entryId, keyFor(row.id, 'visa'));
      if (!visaed.ok) {
        fail(row.id, entryId, 'visa', visaed.problem);
        return;
      }
      keys.current.delete(`${row.id}:visa`);
      setStage(row.id, { stage: 'visaed', entryId, failedStep: null, errorCode: null });
    } finally {
      busy.current.delete(row.id);
    }
  };

  const retry = (row: PurchaseRow): void => {
    void (current.failedStep === 'visa' ? visaEntry(row) : submitProposal(row));
  };

  const closeDrawer = (): void => setOpenId(null);

  const drawer = openRow === undefined ? null : renderDrawer(openRow);

  function renderDrawer(row: PurchaseRow): ReactElement {
    const proposal = row.proposal;
    const stageDone = current.stage === 'submitted' || current.stage === 'visaed';
    const totals = proposal === null ? null : lineTotals(proposal);
    const cardLabels = resolveAiCrafterCardLabels(locale);
    return (
      <FiscaReviewDrawer
        locale={locale}
        open
        onClose={closeDrawer}
        title={fillTemplate(t('purchases.drawer.title'), { name: row.sourceLabel })}
        {...(proposal === null || stageDone ? {} : { aiProposal: { id: row.id, confidenceBps: proposal.confidenceBps, hasIllegibleAmount: row.amountIllegible } })}
        onApprove={() => void submitProposal(row)}
        onReject={closeDrawer}
        source={
          <dl className="fisca-pme-ops__dl">
            <dt>{t('purchases.col.source')}</dt>
            <dd className="fisca-pme-ops__acct">{row.sourceLabel}</dd>
            <dt>{t('purchases.col.supplier')}</dt>
            <dd className="fisca-pme-ops__acct">{row.supplierName ?? ''}</dd>
            <dt>{t('purchases.col.date')}</dt>
            <dd>{row.documentDate === null ? null : <IsoTime value={row.documentDate} />}</dd>
            <dt>{t('purchases.col.total')}</dt>
            <dd>
              <AiCrafterAmountField amountCents={row.totalTtcCents} labels={cardLabels.amount} />
            </dd>
            {row.cashSplitAlert ? (
              <>
                <dt>{t('purchases.col.alert')}</dt>
                <dd>
                  <OpsBadge kind="alert" tone="warning" label={t('purchases.alert.cashSplit')} />
                </dd>
              </>
            ) : null}
          </dl>
        }
        entry={
          <div
            className="fisca-pme-ops__entry"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && current.stage === 'submitted') {
                event.preventDefault();
                void visaEntry(row);
              }
            }}
          >
            {proposal === null || totals === null ? (
              <p className="fisca-pme__state">{t('purchases.drawer.noProposal')}</p>
            ) : (
              <table className="fisca-pme-ops__table fisca-pme-ops__table--stack">
                <caption className="fisca-pme-ops__caption">{t('purchases.drawer.entryTitle')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="fisca-pme-ops__th">{t('purchases.drawer.account')}</th>
                    <th scope="col" className="fisca-pme-ops__th">{t('purchases.drawer.description')}</th>
                    <th scope="col" className="fisca-pme-ops__th fisca-pme-ops__th--end">{t('purchases.drawer.debit')}</th>
                    <th scope="col" className="fisca-pme-ops__th fisca-pme-ops__th--end">{t('purchases.drawer.credit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.lines.map((line, index) => (
                    <tr key={`${line.accountNumber}-${index}`}>
                      <th scope="row" dir="ltr" className="fisca-tabular-num fisca-pme-ops__td fisca-pme-ops__acct">{line.accountNumber}</th>
                      <td className="fisca-pme-ops__td" data-label={t('purchases.drawer.description')}>{line.description}</td>
                      <td className="fisca-pme-ops__td fisca-pme-ops__td--end" data-label={t('purchases.drawer.debit')} data-empty={line.debitCents === 0}>{line.debitCents === 0 ? null : <FiscalAmount amountCents={line.debitCents} />}</td>
                      <td className="fisca-pme-ops__td fisca-pme-ops__td--end" data-label={t('purchases.drawer.credit')} data-empty={line.creditCents === 0}>{line.creditCents === 0 ? null : <FiscalAmount amountCents={line.creditCents} />}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2} className="fisca-pme-ops__td fisca-pme-ops__total">{t('purchases.drawer.totals')}</th>
                    <td className="fisca-pme-ops__td fisca-pme-ops__td--end fisca-pme-ops__total" data-label={t('purchases.drawer.debit')}><FiscalAmount amountCents={totals.debitCents} /></td>
                    <td className="fisca-pme-ops__td fisca-pme-ops__td--end fisca-pme-ops__total" data-label={t('purchases.drawer.credit')}><FiscalAmount amountCents={totals.creditCents} /></td>
                  </tr>
                </tfoot>
              </table>
            )}
            <div className="fisca-pme-ops__pipeline" aria-live="polite">
              {current.stage === 'running' ? <p role="status" className="fisca-pme__meta">{t('purchases.stage.running')}</p> : null}
              {current.stage === 'submitted' ? (
                <>
                  <p role="status" className="fisca-pme__meta">{t('purchases.stage.submitted')}</p>
                  <p className="fisca-pme__notice">{t('purchases.visa.notice')}</p>
                  <button type="button" className="fisca-pme__button fisca-pme__button--primary" onClick={() => void visaEntry(row)}>
                    {t('purchases.visa.action')}
                  </button>
                </>
              ) : null}
              {current.stage === 'visaed' ? <p role="status" className="fisca-pme__meta">{t('purchases.stage.visaed')}</p> : null}
              {current.stage === 'error' && current.errorCode !== null ? <ProblemAlert locale={locale} section="purchases" errorCode={current.errorCode} onRetry={() => retry(row)} /> : null}
            </div>
          </div>
        }
      />
    );
  }

  return (
    <div className="fisca-pme fisca-pme-ops-wide" dir={directionOf(locale)} lang={locale}>
      <h1 className="fisca-pme__h1">{t('purchases.title')}</h1>
      <div className="fisca-pme-ops__toolbar">
        <p role="status" className="fisca-pme__meta fisca-pme-ops__connection" data-connection={status}>
          {t(`purchases.connection.${status}`)}
        </p>
        <DensityToggle locale={locale} section="purchases" density={density} onChange={changeDensity} />
      </div>
      <p className="fisca-pme__hint">{t('purchases.keyboardHint')}</p>
      <MercuryGrid<PurchaseRow>
        columns={columns}
        rows={gridRows}
        density={density}
        labels={gridLabels}
        subscribe={subscribe}
        initialViewportHeight={viewportHeight}
        onRowActivate={(row) => setOpenId(row.id)}
      />
      {gridRows.length === 0 ? <p className="fisca-pme__state">{t('purchases.empty')}</p> : null}
      {drawer}
    </div>
  );
}

function useOpenRow(store: PurchaseInboxStore, id: string | null): PurchaseRow | undefined {
  const subscribe = useCallback((listener: () => void) => (id === null ? () => undefined : store.subscribeRow(id, listener)), [store, id]);
  return useSyncExternalStore(subscribe, () => (id === null ? undefined : store.getRow(id)));
}
