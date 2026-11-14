import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import type { FiscaLocale } from '@fisca/i18n';
import { FiscalAmount } from '@fisca/ui-mercury';
import type { AuthApi, IceDossier } from './api-client.ts';
import { AuthShell, Button, TextField } from './auth-ui.tsx';
import { ICE_LENGTH } from './ice.ts';
import { ICE_ONBOARDING_STEPS, elapsedMs, iceOnboardingReducer, initialIceOnboarding, visibleStepNumber } from './ice-onboarding-machine.ts';
import { fillTemplate, resolveAuthLabels } from './labels.ts';

export interface IceOnboardingProps {
  readonly locale: FiscaLocale;
  readonly api: AuthApi;
  /** Reçoit le dossier de l'annuaire confirmé par l'utilisateur ; aucune route de création n'est appelée ici. */
  readonly onConfirmed: (dossier: IceDossier) => void;
  readonly now?: () => number;
}

function Row({ label, children }: { readonly label: string; readonly children: ReactElement | string }): ReactElement {
  return (
    <div className="fisca-auth__dossier-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const LTR_VALUE = (value: string): ReactElement => (
  <span dir="ltr" className="fisca-auth__ltr fisca-tabular-num tabular-nums">
    {value}
  </span>
);

export function IceOnboarding({ locale, api, onConfirmed, now = Date.now }: IceOnboardingProps): ReactElement {
  const labels = useMemo(() => resolveAuthLabels(locale), [locale]);
  const [state, dispatch] = useReducer(iceOnboardingReducer, undefined, () => initialIceOnboarding(now()));
  const [errorSeq, setErrorSeq] = useState(0);
  const [, tick] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const nowMs = now();
  const locked = state.lockedUntilMs !== null && nowMs < state.lockedUntilMs;
  const lockSec = locked && state.lockedUntilMs !== null ? Math.ceil((state.lockedUntilMs - nowMs) / 1000) : 0;

  useEffect(() => {
    if (state.step === 'done') {
      return undefined;
    }
    const timer = setInterval(() => {
      dispatch({ type: 'TICK', nowMs: now() });
      tick((n) => n + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [state.step, now]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const at = now();
    const current = stateRef.current;
    dispatch({ type: 'SEARCH', nowMs: at });
    if (current.step !== 'ice' || locked || !/^\d{15}$/.test(current.ice)) {
      setErrorSeq((n) => n + 1);
      return;
    }
    void api.lookupIce(current.ice).then((result) => {
      if (result.ok) {
        dispatch({ type: 'FOUND', dossier: result.data });
      } else {
        setErrorSeq((n) => n + 1);
        dispatch({ type: 'FAILED', problem: result.problem, nowMs: now() });
      }
    });
  };

  const confirm = () => {
    const dossier = state.dossier;
    dispatch({ type: 'CONFIRM', nowMs: now() });
    if (dossier !== null) {
      onConfirmed(dossier);
    }
  };

  const errorText = state.errorKey === null ? null : labels[state.errorKey];
  const statusText = state.step === 'searching' ? labels['status.busy'] : locked ? fillTemplate(labels['status.locked'], { seconds: lockSec }) : null;
  const title = state.step === 'review' ? labels['title.iceReview'] : state.step === 'done' ? labels['title.iceDone'] : labels['title.ice'];
  const seconds = Math.floor(elapsedMs(state, nowMs) / 1000);
  const dossier = state.dossier;

  return (
    <AuthShell locale={locale} title={title} subtitle={state.step === 'ice' || state.step === 'searching' ? labels['subtitle.ice'] : undefined} stepKey={state.step === 'searching' ? 'ice' : state.step} errorText={errorText} errorSeq={errorSeq} statusText={statusText}>
      {state.step === 'done' ? (
        <p className="fisca-auth__subtitle">{labels['ice.done.body']}</p>
      ) : (
        <div className="fisca-auth__progress">
          <span>{fillTemplate(labels['ice.progress'], { current: visibleStepNumber(state.step), total: ICE_ONBOARDING_STEPS.length })}</span>
          <span data-testid="ice-elapsed" aria-hidden="true">
            {fillTemplate(labels['ice.elapsed'], { seconds })}
          </span>
        </div>
      )}
      {state.step === 'ice' || state.step === 'searching' ? (
        <form className="fisca-auth__form" onSubmit={search} noValidate>
          <TextField
            name="ice"
            label={labels['field.ice']}
            value={state.ice}
            onChange={(value) => dispatch({ type: 'ICE_CHANGED', value })}
            inputMode="numeric"
            dir="ltr"
            maxLength={ICE_LENGTH + 9}
            code
            required
            hint={labels['ice.shapeNote']}
            error={state.fieldError && errorText !== null ? errorText : null}
          />
          <p className="fisca-auth__hint">{fillTemplate(labels['ice.counter'], { count: state.ice.length })}</p>
          <Button type="submit" variant="primary" disabled={state.step === 'searching' || locked}>
            {labels['action.lookup']}
          </Button>
        </form>
      ) : null}
      {state.step === 'review' && dossier !== null ? (
        <>
          <dl className="fisca-auth__dossier">
            <Row label={labels['field.ice']}>{LTR_VALUE(dossier.ice)}</Row>
            <Row label={labels['ice.review.legalName']}>
              <span dir="auto">{dossier.raisonSocialeFr}</span>
            </Row>
            {dossier.raisonSocialeAr === null ? null : (
              <Row label={labels['ice.review.legalNameAr']}>
                <span lang="ar" dir="rtl">
                  {dossier.raisonSocialeAr}
                </span>
              </Row>
            )}
            <Row label={labels['ice.review.if']}>{LTR_VALUE(dossier.identifiantFiscal)}</Row>
            {dossier.rcNumber === null ? null : <Row label={labels['ice.review.rc']}>{LTR_VALUE(dossier.rcTribunal === null ? dossier.rcNumber : `${dossier.rcNumber} · ${dossier.rcTribunal}`)}</Row>}
            {dossier.legalForm === null ? null : <Row label={labels['ice.review.legalForm']}><span dir="auto">{dossier.legalForm}</span></Row>}
            {dossier.shareCapitalCents === null ? null : (
              <Row label={labels['ice.review.capital']}>
                <FiscalAmount amountCents={dossier.shareCapitalCents} />
              </Row>
            )}
            <Row label={labels['ice.review.address']}>
              <span dir="auto">{dossier.addressAdc450}</span>
            </Row>
          </dl>
          <p className="fisca-auth__note">{labels['ice.review.notice']}</p>
          <div className="fisca-auth__actions">
            <Button variant="primary" onClick={confirm}>
              {labels['action.confirmDossier']}
            </Button>
            <Button onClick={() => dispatch({ type: 'BACK' })}>{labels['action.editIce']}</Button>
          </div>
        </>
      ) : null}
    </AuthShell>
  );
}
