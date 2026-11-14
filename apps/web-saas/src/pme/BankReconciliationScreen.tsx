import { useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { directionOf } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { AiCrafterConfidence, FiscalAmount } from '@fisca/ui-mercury';
import { IsoTime, OpsBadge, ProblemAlert, usePortLoad } from './ops-shared.tsx';
import type { IconKind } from './ops-shared.tsx';
import { commonText, pmeText } from './labels.tsx';
import { buildReconcileRequest, classifySuggestion, outcomeKind } from './bank-model.ts';
import type { OutcomeKind } from './bank-model.ts';
import { newIdempotencyKey } from './uuid-v7.ts';
import type { PmeApi, UblPaymentCode } from './pme-api.ts';
import type { BankEntryCandidate, BankReconciliationSource, BankStatementLine, BankWorkspace, ReconcileSuggestion } from './ports-ops.ts';
import './pme.css';
import './pme-ops.css';

export interface BankReconciliationScreenProps {
  readonly locale: FiscaLocale;
  readonly source: BankReconciliationSource;
  readonly api: PmeApi;
  readonly newKey?: () => string;
}

type Action = 'validate' | 'suspend';
type LineState = OutcomeKind | 'unmatched';

const STATE_ICON: Readonly<Record<LineState, IconKind>> = { unmatched: 'queued', matched: 'matched', partial: 'partial', suspense: 'suspense', noMatch: 'noMatch' };
const METHOD_KEY: Readonly<Record<UblPaymentCode, string>> = {
  '10_ESPECES': 'cash',
  '20_CHEQUE': 'cheque',
  '30_VIREMENT': 'transfer',
  '42_EFFET_LCN': 'lcn',
  '48_CARTE': 'card',
  '97_COMPENSATION': 'offset',
};
const UNMATCHED: LineState = 'unmatched';
const NO_SUGGESTION: Omit<ReconcileSuggestion, 'bankTransactionId'> = { candidateEntryIds: [], scoreBps: 0 };

/** Écran « Rapprochement bancaire » : relevé à gauche, écritures ouvertes à droite, suggestions du port, validation humaine. */
export function BankReconciliationScreen({ locale, source, api, newKey = newIdempotencyKey }: BankReconciliationScreenProps): ReactElement {
  const t = (key: string): string => pmeText(locale, key);
  const { state, retry } = usePortLoad((signal) => source.loadWorkspace(signal), [source]);
  return (
    <div className="fisca-pme" dir={directionOf(locale)} lang={locale}>
      <h1 className="fisca-pme__h1">{t('bank.title')}</h1>
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
      {state.kind === 'ready' ? <Workspace locale={locale} workspace={state.data} api={api} newKey={newKey} /> : null}
    </div>
  );
}

interface WorkspaceProps {
  readonly locale: FiscaLocale;
  readonly workspace: BankWorkspace;
  readonly api: PmeApi;
  readonly newKey: () => string;
}

function Workspace({ locale, workspace, api, newKey }: WorkspaceProps): ReactElement {
  const t = (key: string): string => pmeText(locale, key);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<Readonly<Record<string, OutcomeKind>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [methods, setMethods] = useState<Readonly<Record<string, UblPaymentCode>>>({});
  const [pending, setPending] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());

  const entriesById = useMemo(() => new Map(workspace.entries.map((e) => [e.invoiceEntryId, e])), [workspace.entries]);
  const suggestionOf = (line: BankStatementLine): ReconcileSuggestion =>
    workspace.suggestions.find((s) => s.bankTransactionId === line.id) ?? { bankTransactionId: line.id, ...NO_SUGGESTION };
  const selected = workspace.lines.find((l) => l.id === selectedId);
  const suggestion = selected === undefined ? undefined : suggestionOf(selected);
  const candidateIds = new Set(suggestion?.candidateEntryIds ?? []);

  const decide = async (line: BankStatementLine, action: Action): Promise<void> => {
    if (pending !== null) return;
    const sug = suggestionOf(line);
    const candidates = sug.candidateEntryIds.map((id) => entriesById.get(id)).filter((e): e is BankEntryCandidate => e !== undefined);
    const method = methods[line.id];
    const built = buildReconcileRequest(workspace.context, line, candidates, method === undefined ? {} : { paymentMethodCode: method });
    if (!built.ok) {
      setErrors((prev) => ({ ...prev, [line.id]: 'REQUEST_VALIDATION_FAILED' }));
      return;
    }
    const slot = `${line.id}:${action}`;
    const key = keys.current.get(slot) ?? newKey();
    keys.current.set(slot, key);
    setPending(line.id);
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== line.id)));
    const response = await api.reconcile(built.body, key);
    setPending(null);
    if (!response.ok) {
      setErrors((prev) => ({ ...prev, [line.id]: response.problem.errorCode }));
      return;
    }
    keys.current.delete(slot);
    setResults((prev) => ({ ...prev, [line.id]: outcomeKind(response.data.outcome) }));
  };

  const lineState = (line: BankStatementLine): LineState => results[line.id] ?? UNMATCHED;
  const settled = (line: BankStatementLine): boolean => {
    const s = lineState(line);
    return s === 'matched' || s === 'partial' || s === 'suspense';
  };

  const kind = suggestion === undefined ? 'none' : classifySuggestion(suggestion);
  const method = selected === undefined ? '' : (methods[selected.id] ?? selected.paymentMethodCode ?? '');
  const selectedError = selected === undefined ? undefined : errors[selected.id];

  return (
    <>
      <p className="fisca-pme__notice">{t('bank.notice.humanValidation')}</p>
      <div className="fisca-pme-ops__cols">
        <section aria-labelledby="bank-statement-title" className="fisca-pme-ops__col">
          <h2 id="bank-statement-title" className="fisca-pme__h2">{t('bank.statementTitle')}</h2>
          <ul className="fisca-pme-ops__list">
            {workspace.lines.map((line) => {
              const state = lineState(line);
              return (
                <li key={line.id} data-testid={`bank-line-${line.id}`} className="fisca-pme-ops__item" data-selected={line.id === selectedId}>
                  <button type="button" className="fisca-pme-ops__line" aria-pressed={line.id === selectedId} onClick={() => setSelectedId(line.id)}>
                    <span className="fisca-pme-ops__line-main">
                      <span className="fisca-pme-ops__acct fisca-pme-ops__ellipsis">{line.label}</span>
                      <IsoTime value={line.valueDate} />
                    </span>
                    <span className="fisca-pme-ops__line-side">
                      <FiscalAmount amountCents={line.amountCents} emphasizeSign />
                      <OpsBadge kind={STATE_ICON[state]} dataAttr="data-state" dataValue={state} label={t(`bank.state.${state}`)} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-labelledby="bank-entries-title" className="fisca-pme-ops__col">
          <h2 id="bank-entries-title" className="fisca-pme__h2">{t('bank.entriesTitle')}</h2>
          <ul className="fisca-pme-ops__list">
            {workspace.entries.map((entry) => {
              const isCandidate = candidateIds.has(entry.invoiceEntryId);
              return (
                <li key={entry.invoiceEntryId} className="fisca-pme-ops__item fisca-pme-ops__entry-item" data-candidate={isCandidate}>
                  <span className="fisca-pme-ops__line-main">
                    <span className="fisca-pme-ops__acct fisca-pme-ops__ellipsis">
                      {entry.reference} · {entry.partnerLabel}
                    </span>
                    <span className="fisca-pme-ops__acct">
                      {t('bank.dueDate')} <IsoTime value={entry.dueDate} />
                    </span>
                  </span>
                  <span className="fisca-pme-ops__line-side">
                    <FiscalAmount amountCents={entry.openCents} />
                    {isCandidate ? <OpsBadge kind="proposed" label={t('bank.candidate')} /> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      {selected === undefined || suggestion === undefined ? (
        <p className="fisca-pme__hint">{t('bank.selectPrompt')}</p>
      ) : (
        <section aria-labelledby="bank-decision-title" className="fisca-pme-ops__decision" aria-live="polite">
          <h2 id="bank-decision-title" className="fisca-pme__h2">{t('bank.decisionTitle')}</h2>
          {kind === 'none' ? <p className="fisca-pme__state">{t('bank.suggestion.none')}</p> : null}
          {kind === 'unique' ? <p className="fisca-pme__meta">{t('bank.suggestion.unique')}</p> : null}
          {kind === 'ambiguous' ? <p className="fisca-pme__state fisca-pme-ops__ambiguous" data-ambiguous="true">{t('bank.suggestion.ambiguous')}</p> : null}
          {kind !== 'none' ? (
            <div className="fisca-pme-ops__score">
              <span className="fisca-pme__meta">{t('bank.score')}</span>
              <AiCrafterConfidence confidenceBps={suggestion.scoreBps} labels={{ meter: t('bank.score') }} />
            </div>
          ) : null}
          {kind !== 'none' && !settled(selected) ? (
            <div className="fisca-pme__field">
              <label className="fisca-pme__label" htmlFor="bank-method">{t('bank.method.label')}</label>
              <select
                id="bank-method"
                className="fisca-pme__input"
                value={method}
                onChange={(event) => {
                  const value = event.target.value;
                  const code = workspace.context.paymentMethods.find((m) => m === value);
                  if (code !== undefined) setMethods((prev) => ({ ...prev, [selected.id]: code }));
                }}
              >
                <option value="" disabled>
                  {t('bank.method.placeholder')}
                </option>
                {workspace.context.paymentMethods.map((code) => (
                  <option key={code} value={code}>
                    {t(`bank.method.${METHOD_KEY[code]}`)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {lineState(selected) === 'unmatched' ? null : (
            <p role="status" className="fisca-pme__notice">
              {t(`bank.outcome.${lineState(selected)}`)}
            </p>
          )}
          {selectedError === undefined ? null : <ProblemAlert locale={locale} section="bank" errorCode={selectedError} />}
          {!settled(selected) && kind === 'unique' ? (
            <div className="fisca-pme-ops__actions">
              <button type="button" className="fisca-pme__button fisca-pme__button--primary" disabled={method === '' || pending !== null} onClick={() => void decide(selected, 'validate')}>
                {t('bank.actions.validate')}
              </button>
            </div>
          ) : null}
          {!settled(selected) && kind === 'ambiguous' ? (
            <div className="fisca-pme-ops__actions">
              <p className="fisca-pme__notice">{t('bank.suspenseNotice')}</p>
              <button type="button" className="fisca-pme__button fisca-pme__button--primary" disabled={method === '' || pending !== null} onClick={() => void decide(selected, 'suspend')}>
                {t('bank.actions.suspend')}
              </button>
            </div>
          ) : null}
        </section>
      )}
    </>
  );
}
