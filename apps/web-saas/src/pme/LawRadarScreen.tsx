import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement, ReactNode } from 'react';
import { directionOf } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { FiscalAmount, MercuryGrid } from '@fisca/ui-mercury';
import type { GridDensity, MercuryGridColumn } from '@fisca/ui-mercury';
import { DensityToggle, IsoTime, OpsBadge, ProblemAlert, usePortLoad } from './ops-shared.tsx';
import { commonText, fillTemplate, pmeText } from './labels.tsx';
import { formatBytes, sha256Hex, validateEvidenceFile, validateEvidenceSelection } from './evidence.ts';
import type { EvidenceFileError } from './evidence.ts';
import type { DisputeEvidencePort, DisputeStatus, EvidenceFile, EvidencePolicy, LateInvoice, LateInvoiceRadarSource } from './ports-ops.ts';
import './pme.css';
import './pme-ops.css';

export interface LawRadarScreenProps {
  readonly locale: FiscaLocale;
  readonly source: LateInvoiceRadarSource;
  readonly evidence: DisputeEvidencePort;
  readonly defaultDensity?: GridDensity;
  readonly onDensityChange?: (density: GridDensity) => void;
  readonly viewportHeight?: number;
}

const DEFAULT_VIEWPORT_PX = 440;

interface Override {
  readonly disputeStatus: DisputeStatus;
  readonly penaltyFrozen: boolean;
}

/** Radar Loi 69-21 : retard, jours et pénalité viennent du port (calcul serveur) ; aucune règle de pénalité ni de gel ici. */
export function LawRadarScreen({ locale, source, evidence, defaultDensity = 'comfortable', onDensityChange, viewportHeight = DEFAULT_VIEWPORT_PX }: LawRadarScreenProps): ReactElement {
  const t = (key: string): string => pmeText(locale, key);
  const { state, retry } = usePortLoad((signal) => source.loadRadar(signal), [source]);
  const [density, setDensity] = useState<GridDensity>(defaultDensity);
  const [overrides, setOverrides] = useState<Readonly<Record<string, Override>>>({});
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);

  const baseInvoices = state.kind === 'ready' ? state.data.invoices : null;
  const rows = useMemo<readonly (LateInvoice & { readonly id: string })[]>(
    () => (baseInvoices ?? []).map((inv) => ({ ...inv, ...(overrides[inv.invoiceId] ?? {}), id: inv.invoiceId })),
    [baseInvoices, overrides],
  );

  const columns = useMemo<readonly MercuryGridColumn<LateInvoice & { readonly id: string }>[]>(() => {
    const head = (key: string, end = false) => (): ReactNode => <span className={end ? 'fisca-grid__head-cell--end' : undefined}>{pmeText(locale, key)}</span>;
    type Row = LateInvoice & { readonly id: string };
    const col = (id: string, key: string, size: number, render: (row: Row) => ReactNode, end = false): MercuryGridColumn<Row> => ({
      id,
      header: head(key, end),
      size,
      cell: (context): ReactNode => render(context.row.original),
    });
    return [
      col('number', 'radar.col.invoice', 110, (r) => <span className="fisca-pme-ops__acct fisca-pme-ops__ellipsis">{r.number}</span>),
      col('customer', 'radar.col.customer', 170, (r) => <span className="fisca-pme-ops__acct fisca-pme-ops__ellipsis">{r.customerName}</span>),
      col('due', 'radar.col.due', 112, (r) => <IsoTime value={r.dueDate} />),
      col('late', 'radar.col.daysLate', 130, (r) => <span dir="ltr" className="fisca-tabular-num fisca-pme-ops__acct">{String(r.daysLate)}</span>, true),
      col('amount', 'radar.col.amountDue', 160, (r) => <FiscalAmount amountCents={r.amountDueCents} />, true),
      col('penalty', 'radar.col.penalty', 150, (r) => <FiscalAmount amountCents={r.penaltyCents} />, true),
      col('penaltyState', 'radar.col.penaltyState', 220, (r) =>
        r.penaltyFrozen ? (
          <OpsBadge kind="frozen" tone="cleared" dataAttr="data-frozen" dataValue="true" label={pmeText(locale, 'radar.penalty.frozen')} />
        ) : (
          <OpsBadge kind="active" tone="warning" label={pmeText(locale, 'radar.penalty.active')} />
        ),
      ),
      col('dispute', 'radar.col.dispute', 190, (r) => <OpsBadge kind={r.disputeStatus === 'documented' ? 'documented' : 'queued'} label={pmeText(locale, `radar.dispute.${r.disputeStatus}`)} />),
      col('action', 'radar.col.action', 210, (r) => (
        <button
          type="button"
          className="fisca-pme-ops__row-button"
          aria-label={fillTemplate(pmeText(locale, 'radar.evidence.openLabel'), { number: r.number })}
          onClick={() => setEvidenceFor(r.invoiceId)}
        >
          {pmeText(locale, 'radar.evidence.open')}
        </button>
      )),
    ] as readonly MercuryGridColumn<Row>[];
  }, [locale]);

  const gridLabels = useMemo(
    () => ({ ariaLabel: pmeText(locale, 'radar.gridLabel'), newRows: (count: number) => String(count), loadingRow: commonText(locale, 'states.loading') }),
    [locale],
  );

  const changeDensity = (next: GridDensity): void => {
    setDensity(next);
    onDensityChange?.(next);
  };

  const target = rows.find((r) => r.invoiceId === evidenceFor);

  return (
    <div className="fisca-pme fisca-pme-ops-wide" dir={directionOf(locale)} lang={locale}>
      <h1 className="fisca-pme__h1">{t('radar.title')}</h1>
      {state.kind === 'loading' ? (
        <p role="status" className="fisca-pme__state">
          {commonText(locale, 'states.loading')}
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <div role="alert" className="fisca-pme__state fisca-pme__state--error">
          <p>{commonText(locale, 'states.error')}</p>
          <button type="button" className="fisca-pme__button" onClick={retry}>
            {commonText(locale, 'actions.retry')}
          </button>
        </div>
      ) : null}
      {state.kind === 'ready' ? (
        <>
          <div className="fisca-pme-ops__toolbar">
            <p className="fisca-pme__meta">
              {fillTemplate(t('radar.asOf'), { date: state.data.asOfDate })}
            </p>
            <DensityToggle locale={locale} section="radar" density={density} onChange={changeDensity} />
          </div>
          <p className="fisca-pme__hint">{t('radar.note.serverComputed')}</p>
          {rows.length === 0 ? (
            <p className="fisca-pme__state">{commonText(locale, 'states.empty')}</p>
          ) : (
            <MercuryGrid columns={columns} rows={rows} density={density} labels={gridLabels} initialViewportHeight={viewportHeight} onRowActivate={(row) => setEvidenceFor(row.invoiceId)} />
          )}
          {target === undefined ? null : (
            <EvidencePanel
              key={target.invoiceId}
              locale={locale}
              invoice={target}
              port={evidence}
              onClose={() => setEvidenceFor(null)}
              onOutcome={(override) => setOverrides((prev) => ({ ...prev, [target.invoiceId]: override }))}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

interface Accepted {
  readonly key: string;
  readonly file: File;
  readonly sha256Hex: string | null;
}

interface Rejected {
  readonly key: string;
  readonly name: string;
  readonly reason: EvidenceFileError | 'tooMany' | 'hash';
}

interface PanelProps {
  readonly locale: FiscaLocale;
  readonly invoice: LateInvoice;
  readonly port: DisputeEvidencePort;
  readonly onClose: () => void;
  readonly onOutcome: (override: Override) => void;
}

function EvidencePanel({ locale, invoice, port, onClose, onOutcome }: PanelProps): ReactElement {
  const t = (key: string): string => pmeText(locale, key);
  const { state: policyState, retry: retryPolicy } = usePortLoad<EvidencePolicy>((signal) => port.loadPolicy(signal), [port]);
  const [accepted, setAccepted] = useState<readonly Accepted[]>([]);
  const [rejected, setRejected] = useState<readonly Rejected[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const counter = useRef(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const policy = policyState.kind === 'ready' ? policyState.data : null;

  const size = useCallback(
    (bytes: number): string => {
      const { value, unit } = formatBytes(bytes);
      return `${value} ${pmeText(locale, `radar.evidence.unit.${unit}`)}`;
    },
    [locale],
  );

  const onPick = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.target;
    const files = Array.from(input.files ?? []);
    if (policy === null || files.length === 0) return;
    setSent(false);
    setFailure(null);
    const newRejected: Rejected[] = [];
    const toHash: Accepted[] = [];
    const { tooMany } = validateEvidenceSelection(files, policy, accepted.length);
    for (const file of files) {
      counter.current += 1;
      const key = `f${counter.current}`;
      const error = tooMany ? 'tooMany' : validateEvidenceFile(file, policy);
      if (error !== null) newRejected.push({ key, name: file.name, reason: error });
      else toHash.push({ key, file, sha256Hex: null });
    }
    setRejected(newRejected);
    if (toHash.length > 0) {
      setAccepted((prev) => [...prev, ...toHash]);
      for (const item of toHash) {
        sha256Hex(item.file).then(
          (hash) => setAccepted((prev) => prev.map((a) => (a.key === item.key ? { ...a, sha256Hex: hash } : a))),
          () => {
            setAccepted((prev) => prev.filter((a) => a.key !== item.key));
            setRejected((prev) => [...prev, { key: item.key, name: item.file.name, reason: 'hash' }]);
          },
        );
      }
    }
    input.value = '';
  };

  const ready: readonly EvidenceFile[] = accepted.flatMap((a) => (a.sha256Hex === null ? [] : [{ file: a.file, sha256Hex: a.sha256Hex }]));
  const hashing = accepted.some((a) => a.sha256Hex === null);
  const canSubmit = ready.length > 0 && !hashing && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setFailure(null);
    const outcome = await port.submitEvidence(invoice.invoiceId, ready);
    setSubmitting(false);
    if (!outcome.ok) {
      setFailure(outcome.errorCode);
      return;
    }
    setAccepted([]);
    setRejected([]);
    setSent(true);
    onOutcome({ disputeStatus: outcome.disputeStatus, penaltyFrozen: outcome.penaltyFrozen });
  };

  const titleId = `evidence-title-${invoice.invoiceId}`;
  return (
    <section role="region" aria-labelledby={titleId} className="fisca-pme-ops__evidence">
      <div className="fisca-pme-ops__evidence-head">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="fisca-pme__h2">
          {fillTemplate(t('radar.evidence.title'), { number: invoice.number })}
        </h2>
        <button type="button" className="fisca-pme__button" onClick={onClose}>
          {commonText(locale, 'actions.close')}
        </button>
      </div>
      <p className="fisca-pme__notice">{t('radar.evidence.frozenNotice')}</p>
      {policyState.kind === 'loading' ? <p role="status" className="fisca-pme__state">{commonText(locale, 'states.loading')}</p> : null}
      {policyState.kind === 'error' ? (
        <div role="alert" className="fisca-pme__state fisca-pme__state--error">
          <p>{commonText(locale, 'states.error')}</p>
          <button type="button" className="fisca-pme__button" onClick={retryPolicy}>
            {commonText(locale, 'actions.retry')}
          </button>
        </div>
      ) : null}
      {policy === null ? null : (
        <>
          <p className="fisca-pme__meta">
            {fillTemplate(t('radar.evidence.policy'), { maxSize: size(policy.maxFileBytes), types: policy.allowedMimeTypes.join(', '), maxFiles: String(policy.maxFiles) })}
          </p>
          <div className="fisca-pme__field">
            <div className="fisca-pme-ops__picker">
              <input id={`evidence-input-${invoice.invoiceId}`} type="file" multiple accept={policy.allowedMimeTypes.join(',')} className="fisca-pme-ops__picker-input" onChange={onPick} />
              <label className="fisca-pme__button fisca-pme-ops__picker-face" htmlFor={`evidence-input-${invoice.invoiceId}`}>
                {t('radar.evidence.pick')}
              </label>
            </div>
          </div>
          {rejected.map((r) => (
            <p key={r.key} role="alert" className="fisca-pme__error">
              {fillTemplate(t(`radar.evidence.errors.${r.reason}`), { name: r.name })}
            </p>
          ))}
          {accepted.length === 0 ? null : (
            <ul className="fisca-pme-ops__list">
              {accepted.map((a) => (
                <li key={a.key} className="fisca-pme-ops__item fisca-pme-ops__file-item">
                  <span className="fisca-pme-ops__acct fisca-pme-ops__ellipsis">
                    {a.file.name} · {size(a.file.size)}
                  </span>
                  <span className="fisca-pme__meta">{t('radar.evidence.hash')}</span>
                  {a.sha256Hex === null ? (
                    <span role="status" className="fisca-pme__meta">{t('radar.evidence.hashing')}</span>
                  ) : (
                    <code dir="ltr" className="fisca-tabular-num fisca-pme-ops__hash">{a.sha256Hex}</code>
                  )}
                  <button type="button" className="fisca-pme__button fisca-pme__button--quiet" aria-label={fillTemplate(t('radar.evidence.removeLabel'), { name: a.file.name })} onClick={() => setAccepted((prev) => prev.filter((x) => x.key !== a.key))}>
                    {t('radar.evidence.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {failure === null ? null : <ProblemAlert locale={locale} section="radar" errorCode={failure} />}
          {sent ? (
            <p role="status" className="fisca-pme__notice">
              {t('radar.evidence.sent')}
            </p>
          ) : null}
          <div className="fisca-pme-ops__actions">
            <button type="button" className="fisca-pme__button fisca-pme__button--primary" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? t('radar.evidence.submitting') : t('radar.evidence.submit')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
