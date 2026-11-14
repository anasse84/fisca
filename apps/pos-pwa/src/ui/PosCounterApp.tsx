import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { FISCA_LOCALES, directionOf } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { buildConversionUrl, resolveConversionView } from '../b2b/qr-conversion.ts';
import type { ConversionTracker, ConversionView } from '../b2b/qr-conversion.ts';
import { readTicketConversion } from '../b2b/ticket-conversion-reader.ts';
import { buildOfflineIndicatorModel } from '../offline/offline-indicator.ts';
import { OFFLINE_WINDOW_HOURS, evaluateOfflineWindow } from '../offline/offline-window.ts';
import type { ClosingPorts } from '../closing/closing-ports.ts';
import { buildZDocument, renderZEscPos } from '../closing/z-print.ts';
import type { ZTicketData } from '../closing/z-layout.ts';
import type { SyncStateSource } from '../sync/sync-types.ts';
import { EscPosBuilder, columnsForWidth } from '../printing/escpos.ts';
import type { PaperWidthMm, PrinterProfile } from '../printing/escpos.ts';
import { PrintError } from '../printing/print-queue.ts';
import type { PrintQueue } from '../printing/print-queue.ts';
import { layoutReceipt, renderReceiptEscPos } from '../printing/receipt-layout.ts';
import type { ReceiptData } from '../printing/receipt-layout.ts';
import { addItem, cartTotals, changeQuantity, lineTotalTtcCents, removeItem } from '../sale/cart.ts';
import type { Cart, CatalogItem, CatalogPort } from '../sale/cart.ts';
import { checkoutCart } from '../sale/checkout.ts';
import { appendDigit, computeSettlement, deleteLastDigit } from '../sale/settlement.ts';
import type { Settlement } from '../sale/settlement.ts';
import { TicketIssuanceError } from '../ticketing/ticket-issuer.ts';
import type { TicketIssuerDeps } from '../ticketing/ticket-issuer.ts';
import type { CashStampRulePort } from '../ticketing/cash-stamp.ts';
import { B2bQrPanel } from './B2bQrPanel.tsx';
import { CartPanel } from './CartPanel.tsx';
import { CatalogGrid } from './CatalogGrid.tsx';
import { ClosingFlow } from './ClosingFlow.tsx';
import { SyncIndicator } from './SyncIndicator.tsx';
import { OfflineBanner } from './OfflineBanner.tsx';
import { PaymentPad } from './PaymentPad.tsx';
import type { PaymentMethod } from './PaymentPad.tsx';
import { ReceiptPreview } from './ReceiptPreview.tsx';
import { receiptLabelSetOf, resolvePosLabels, translateStrict, zLabelSetOf } from './labels.ts';
import './pos.css';

export interface SyncSnapshotProp {
  readonly lastSyncAtMs: number | null;
  readonly online: boolean;
  readonly pendingTickets: number;
}

export interface ReceiptConfig {
  readonly profile: PrinterProfile;
  readonly headerLines: readonly string[];
  /** Base injectée de l'URL de conversion B2B (le QR encode `base/jeton`). */
  readonly conversionBaseUrl: string;
}

export interface PosCounterAppProps {
  readonly locale: FiscaLocale;
  readonly onLocaleChange: (locale: FiscaLocale) => void;
  readonly theme?: 'light' | 'dark';
  readonly onThemeChange?: (theme: 'light' | 'dark') => void;
  readonly catalog: CatalogPort;
  readonly ticketDeps: TicketIssuerDeps;
  readonly sessionId: string;
  readonly sync: SyncSnapshotProp;
  readonly nowMs: () => number;
  readonly stampRules: CashStampRulePort;
  readonly receipt: ReceiptConfig;
  readonly printQueue?: PrintQueue;
  readonly conversion: ConversionTracker;
  /** Ports de fin de poste (comptage aveugle, Ticket Z) : absents, pas de bouton de clôture. */
  readonly closing?: ClosingPorts;
  /** État du synchroniseur (moteur ou équivalent) : absent, pas d'indicateur de synchro. */
  readonly syncSource?: SyncStateSource;
}

type View = 'sale' | 'pay' | 'receipt' | 'closing';

interface PaymentState {
  readonly method: PaymentMethod;
  readonly cardCents: number;
  readonly deliveryCents: number;
  readonly tenderedCents: number;
}

const INITIAL_PAYMENT: PaymentState = { method: 'cash', cardCents: 0, deliveryCents: 0, tenderedCents: 0 };
const CLOCK_TICK_MS = 30_000;

interface IssuedReceipt {
  readonly ticketId: string;
  readonly data: Omit<ReceiptData, 'qrPayload'>;
  readonly qrToken: string;
}

/** Écran de comptoir : vente → règlement → ticket. Tous les libellés viennent de @fisca/i18n par `resolvePosLabels`. */
export function PosCounterApp(props: PosCounterAppProps): ReactElement {
  const { locale } = props;
  const labels = useMemo(() => resolvePosLabels(locale), [locale]);
  const dir = directionOf(locale);

  const [items, setItems] = useState<readonly CatalogItem[]>([]);
  const [cart, setCart] = useState<Cart>([]);
  const [view, setView] = useState<View>('sale');
  const [payment, setPayment] = useState<PaymentState>(INITIAL_PAYMENT);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<'sessionNotOpen' | 'terminalNotPaired' | 'stampRuleMissing' | 'generic' | null>(null);
  const [issued, setIssued] = useState<IssuedReceipt | null>(null);
  const [widthMm, setWidthMm] = useState<PaperWidthMm>(props.receipt.profile.paperWidthMm);
  const [printedNotice, setPrintedNotice] = useState(false);
  const [printError, setPrintError] = useState<PrintError | null>(null);
  const [sessionClosed, setSessionClosed] = useState(props.closing?.sealedClosure !== undefined && props.closing.sealedClosure !== null);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const noSource = useMemo<SyncStateSource | null>(() => null, []);
  const syncSource = props.syncSource ?? noSource;
  const syncState = useSyncExternalStore(
    useCallback((listener: () => void) => (syncSource === null ? () => undefined : syncSource.subscribe(listener)), [syncSource]),
    () => (syncSource === null ? null : syncSource.getState()),
  );
  const catalogRef = useRef(props.catalog);
  catalogRef.current = props.catalog;

  useEffect(() => {
    let active = true;
    void catalogRef.current.listItems().then((list) => {
      if (active) setItems(list);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(bump, CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => props.conversion.subscribe(bump), [props.conversion]);
  useEffect(() => props.printQueue?.subscribe(bump), [props.printQueue]);

  const totals = useMemo(() => cartTotals(cart), [cart]);
  const windowState = evaluateOfflineWindow({ lastSyncAtMs: props.sync.lastSyncAtMs, nowMs: props.nowMs(), online: props.sync.online });
  const indicator = buildOfflineIndicatorModel(
    { window: windowState, pendingTickets: props.sync.pendingTickets },
    {
      online: labels.net.online,
      offlineWithin: labels.net.offlineWithin,
      offlineExpired: labels.net.offlineExpired,
      neverSynced: labels.net.neverSynced,
      clockAnomaly: labels.net.clockAnomaly,
      pending: labels.net.pending,
      remaining: labels.net.remaining,
    },
  );

  const atIso = props.ticketDeps.now();
  const { method, cardCents, deliveryCents, tenderedCents } = payment;
  useEffect(() => {
    if (view !== 'pay') return;
    let active = true;
    void computeSettlement({ goodsTtcCents: totals.totalTtcCents, cardCents, deliveryCents, cashTenderedCents: tenderedCents }, props.stampRules, atIso).then((next) => {
      if (active) setSettlement(next);
    });
    return () => {
      active = false;
    };
  }, [view, totals.totalTtcCents, cardCents, deliveryCents, tenderedCents, props.stampRules, atIso]);

  const onAdd = useCallback((item: CatalogItem) => setCart((current) => addItem(current, item)), []);
  const onChangeQuantity = useCallback((id: string, delta: number) => setCart((current) => changeQuantity(current, id, delta)), []);
  const onRemove = useCallback((id: string) => setCart((current) => removeItem(current, id)), []);

  const startPayment = (): void => {
    setPayment(INITIAL_PAYMENT);
    setSettlement(null);
    setErrorCode(null);
    setView('pay');
  };

  const editAmount = (edit: (value: number) => number): void => {
    setPayment((p) => {
      if (p.method === 'cash') return { ...p, tenderedCents: edit(p.tenderedCents) };
      if (p.method === 'card') return { ...p, cardCents: edit(p.cardCents) };
      return { ...p, deliveryCents: edit(p.deliveryCents) };
    });
  };

  const fillRemaining = (): void => {
    setPayment((p) => {
      if (p.method === 'cash') return { ...p, tenderedCents: settlement?.cashDueCents ?? 0 };
      const others = p.method === 'card' ? p.deliveryCents : p.cardCents;
      const rest = Math.max(0, totals.totalTtcCents - others);
      return p.method === 'card' ? { ...p, cardCents: rest } : { ...p, deliveryCents: rest };
    });
  };

  const validate = async (): Promise<void> => {
    if (settlement === null) return;
    setSubmitting(true);
    setErrorCode(null);
    try {
      const result = await checkoutCart({ deps: props.ticketDeps, window: windowState, sessionId: props.sessionId, cart, settlement });
      const conversion = await readTicketConversion(props.ticketDeps.storage, result.ticket.id);
      props.conversion.register(result.ticket.id, conversion.state);
      setIssued({
        ticketId: result.ticket.id,
        qrToken: conversion.qrConversionToken,
        data: {
          ticketNumber: result.ticket.ticketNumber,
          issuedAtIso: props.ticketDeps.now(),
          lines: cart.map((line) => ({ name: line.item.name, quantityMilli: line.quantityMilli, lineTotalTtcCents: lineTotalTtcCents(line) })),
          vat: totals.byRate,
          stampDutyCents: result.ticket.stampDutyCents,
          totalTtcCents: result.ticket.totalTtcCents,
          paidCashCents: settlement.cashShareCents + result.ticket.stampDutyCents,
          paidCardTpeCents: settlement.cardCents,
          paidDeliveryAppCents: settlement.deliveryCents,
          changeCents: result.changeCents,
          ticketSha256: result.ticket.ticketSha256,
          headerLines: props.receipt.headerLines,
        },
      });
      setCart([]);
      setPrintedNotice(false);
      setPrintError(null);
      setView('receipt');
    } catch (error) {
      if (error instanceof TicketIssuanceError) {
        setErrorCode(error.code === 'STAMP_RULE_MISSING' ? 'stampRuleMissing' : error.code === 'SESSION_NOT_OPEN' ? 'sessionNotOpen' : error.code === 'TERMINAL_NOT_PAIRED' ? 'terminalNotPaired' : 'generic');
      } else {
        setErrorCode('generic');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const conversionView: ConversionView = issued === null ? resolveConversionView('NONE') : props.conversion.view(issued.ticketId);
  const conversionUrl = issued === null ? '' : buildConversionUrl(props.receipt.conversionBaseUrl, issued.qrToken);
  const profile: PrinterProfile = { ...props.receipt.profile, paperWidthMm: widthMm };
  const bilingual = profile.encoding !== 'CP858';

  const receiptDoc = useMemo(() => {
    if (issued === null) return [];
    return layoutReceipt(
      { ...issued.data, qrPayload: conversionView.canShowQr ? conversionUrl : null },
      {
        columns: columnsForWidth(widthMm),
        labels: receiptLabelSetOf('fr'),
        ...(bilingual ? { secondaryLabels: receiptLabelSetOf('ar') } : {}),
        conversionCaption: true,
      },
    );
  }, [issued, conversionView.canShowQr, conversionUrl, widthMm, bilingual]);

  const print = async (bytes: Uint8Array): Promise<void> => {
    if (props.printQueue === undefined) return;
    setPrintError(null);
    setPrintedNotice(false);
    try {
      await props.printQueue.enqueue(bytes);
      setPrintedNotice(true);
    } catch (error) {
      setPrintError(error instanceof PrintError ? error : new PrintError('TRANSPORT_FAILED', String(error)));
    }
  };

  const onPrint = (): void => {
    if (issued === null) return;
    void print(renderReceiptEscPos(receiptDoc, profile, { openDrawer: issued.data.paidCashCents > 0 }));
  };
  const onDrawer = (): void => {
    void print(new EscPosBuilder(profile).init().openDrawer().build());
  };
  const onRetry = (): void => {
    if (props.printQueue === undefined) return;
    setPrintError(null);
    void props.printQueue.retry().then(() => setPrintedNotice(true), (error: unknown) => setPrintError(error instanceof PrintError ? error : new PrintError('TRANSPORT_FAILED', String(error))));
  };

  const printZ = async (data: ZTicketData): Promise<void> => {
    if (props.printQueue === undefined) return;
    await props.printQueue.enqueue(renderZEscPos(buildZDocument(data, profile, zLabelSetOf('fr'), zLabelSetOf('ar')), profile));
  };

  const retryLabel = translateStrict(locale, 'common', 'actions.retry');
  const errorText = errorCode === null ? null : labels.err[errorCode];
  const emptySettlement: Settlement = { status: 'EMPTY', goodsTtcCents: totals.totalTtcCents, cardCents: 0, deliveryCents: 0, cashShareCents: 0, stampCents: 0, cashDueCents: 0, cashTenderedCents: 0, changeCents: 0, shortfallCents: 0, remainingCents: 0 };

  return (
    <div className="pos-root" data-testid="pos-root" dir={dir} lang={locale} aria-label={labels.region}>
      <header className="pos-header">
        <h1 className="pos-title">{labels.title}</h1>
        <OfflineBanner model={indicator} regionLabel={labels.net.status} />
        {syncState === null || syncSource === null ? null : (
          <SyncIndicator labels={labels.sync} state={syncState} blocked={!windowState.canSell} nowMs={props.nowMs()} hours={OFFLINE_WINDOW_HOURS} onRetry={() => void syncSource.syncNow()} />
        )}
        {props.closing === undefined || view === 'closing' || view === 'pay' ? null : (
          <button type="button" className="pos-action" data-testid="closing-open" onClick={() => setView('closing')}>
            {labels.closing.open}
          </button>
        )}
        <div className="pos-group" role="group" aria-label={labels.language.label}>
          {FISCA_LOCALES.map((l) => (
            <button key={l} type="button" className="pos-lang-btn" lang={l} aria-pressed={l === locale} data-testid={`lang-${l}`} onClick={() => props.onLocaleChange(l)}>
              {labels.language.names[l]}
            </button>
          ))}
        </div>
        {props.onThemeChange === undefined ? null : (
          <div className="pos-group" role="group" aria-label={labels.theme.label}>
            <button type="button" aria-pressed={props.theme === 'light'} data-testid="theme-light" onClick={() => props.onThemeChange?.('light')}>
              {labels.theme.light}
            </button>
            <button type="button" aria-pressed={props.theme === 'dark'} data-testid="theme-dark" onClick={() => props.onThemeChange?.('dark')}>
              {labels.theme.dark}
            </button>
          </div>
        )}
      </header>
      <main className="pos-main">
        {view === 'sale' ? (
          <>
            <CatalogGrid title={labels.sale.catalog} emptyLabel={labels.sale.catalogEmpty} items={items} addLabel={labels.sale.addItem} onAdd={onAdd} />
            <CartPanel
              labels={{ ...labels.sale, blocked: sessionClosed ? labels.z.noSale : labels.sale.blocked }}
              cart={cart}
              totals={totals}
              salesBlocked={indicator.salesBlocked || sessionClosed}
              onChangeQuantity={onChangeQuantity}
              onRemove={onRemove}
              onClear={() => setCart([])}
              onPay={startPayment}
            />
          </>
        ) : null}
        {view === 'closing' && props.closing !== undefined ? (
          <>
            <ClosingFlow
              locale={locale}
              profile={profile}
              {...props.closing}
              onSealed={() => setSessionClosed(true)}
              {...(props.printQueue === undefined ? {} : { printZ: printZ })}
            />
            <div className="pos-actions pos-main__full">
              <button type="button" className="pos-action" data-testid="closing-back" onClick={() => setView('sale')}>
                {labels.closing.back}
              </button>
            </div>
          </>
        ) : null}
        {view === 'pay' ? (
          <PaymentPad
            labels={{ ...labels.pay, method: { cash: labels.pay.cash, card: labels.pay.card, delivery: labels.pay.delivery }, stampRuleMissing: labels.err.stampRuleMissing }}
            settlement={settlement ?? emptySettlement}
            method={method}
            submitting={submitting}
            errorText={errorText}
            onMethod={(m) => setPayment((p) => ({ ...p, method: m }))}
            onDigit={(d) => editAmount((v) => appendDigit(v, d))}
            onBackspace={() => editAmount(deleteLastDigit)}
            onClear={() => editAmount(() => 0)}
            onFillRemaining={fillRemaining}
            onValidate={() => void validate()}
            onBack={() => setView('sale')}
          />
        ) : null}
        {view === 'receipt' && issued !== null ? (
          <>
            <ReceiptPreview
              labels={{
                ...labels.print,
                qrAlt: labels.b2b.qrAlt,
                errorText: printError === null ? null : labels.print.error[printError.code],
                retry: retryLabel,
              }}
              document={receiptDoc}
              columns={columnsForWidth(widthMm)}
              widthMm={widthMm}
              pendingJobs={props.printQueue?.pendingCount() ?? 0}
              printedNotice={printedNotice}
              canPrint={props.printQueue !== undefined}
              onWidth={setWidthMm}
              onPrint={onPrint}
              onDrawer={onDrawer}
              onRetry={onRetry}
            />
            <B2bQrPanel labels={labels.b2b} view={conversionView} url={conversionUrl} />
            <div className="pos-actions pos-main__full">
              <button type="button" className="pos-action pos-action--primary" data-testid="new-sale" onClick={() => { setIssued(null); setView('sale'); }}>
                {labels.sale.newSale}
              </button>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
