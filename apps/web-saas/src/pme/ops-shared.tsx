import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { FiscaLocale } from '@fisca/i18n';
import type { GridDensity } from '@fisca/ui-mercury';
import { commonText, pmeText } from './labels.tsx';
import { problemCategory } from './problem-labels.ts';
import type { ProblemCategory } from './problem-labels.ts';
import './pme.css';
import './pme-ops.css';

export type OpsSection = 'purchases' | 'bank' | 'radar';

export type IconKind =
  | 'queued'
  | 'extracted'
  | 'proposed'
  | 'alert'
  | 'frozen'
  | 'active'
  | 'matched'
  | 'partial'
  | 'suspense'
  | 'noMatch'
  | 'documented'
  | 'illegible';

/** Icônes distinctes : aucun statut n'est porté par la couleur seule (Doc_08 Section 10). */
export function StatusIcon({ kind }: { readonly kind: IconKind }): ReactElement {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false, className: 'fisca-pme-ops__icon' } as const;
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  switch (kind) {
    case 'queued':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" {...stroke} />
          <path d="M12 7v5l3 2" {...stroke} />
        </svg>
      );
    case 'extracted':
      return (
        <svg {...common}>
          <path d="M6 3h8l4 4v14H6z" {...stroke} />
          <path d="M9 13l2 2 4-4" {...stroke} />
        </svg>
      );
    case 'proposed':
      return (
        <svg {...common}>
          <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" {...stroke} />
        </svg>
      );
    case 'alert':
    case 'illegible':
      return (
        <svg {...common}>
          <path d="M12 3 2 21h20z" {...stroke} />
          <path d="M12 10v5M12 18v.5" {...stroke} />
        </svg>
      );
    case 'frozen':
      return (
        <svg {...common}>
          <path d="M12 2v20M4 7l16 10M20 7 4 17" {...stroke} />
        </svg>
      );
    case 'active':
      return (
        <svg {...common}>
          <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" {...stroke} />
        </svg>
      );
    case 'matched':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" {...stroke} />
          <path d="M8 12.5l3 3 5-6" {...stroke} />
        </svg>
      );
    case 'partial':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" {...stroke} />
          <path d="M12 3v18a9 9 0 0 1 0-18z" fill="currentColor" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case 'suspense':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" {...stroke} />
          <path d="M10 8v8M14 8v8" {...stroke} />
        </svg>
      );
    case 'noMatch':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" {...stroke} />
          <path d="M6 6l12 12" {...stroke} />
        </svg>
      );
    case 'documented':
      return (
        <svg {...common}>
          <path d="M6 3h9l3 3v15H6z" {...stroke} />
          <path d="M9 11h6M9 15h6" {...stroke} />
        </svg>
      );
  }
}

export interface OpsBadgeProps {
  readonly kind: IconKind;
  readonly label: string;
  readonly tone?: 'neutral' | 'warning' | 'danger' | 'cleared';
  readonly dataAttr?: 'data-alert' | 'data-frozen' | 'data-state';
  readonly dataValue?: string;
}

/** Pastille de statut : icône distincte + bordure + libellé explicite. */
export function OpsBadge({ kind, label, tone = 'neutral', dataAttr, dataValue = '' }: OpsBadgeProps): ReactElement {
  const attrs = dataAttr === undefined ? {} : { [dataAttr]: dataValue };
  return (
    <span className="fisca-pme-ops__badge" data-tone={tone} {...attrs}>
      <StatusIcon kind={kind} />
      <span className="fisca-pme-ops__badge-label" title={label}>
        {label}
      </span>
    </span>
  );
}

export interface DensityToggleProps {
  readonly locale: FiscaLocale;
  readonly section: OpsSection;
  readonly density: GridDensity;
  readonly onChange: (density: GridDensity) => void;
}

/** Commutateur persistant de densité (44 px / 28 px) en tête de grille ; l'hôte persiste via `onChange`. */
export function DensityToggle({ locale, section, density, onChange }: DensityToggleProps): ReactElement {
  const compact = density === 'compact';
  return (
    <button type="button" className="fisca-pme__button fisca-pme-ops__density" aria-pressed={compact} onClick={() => onChange(compact ? 'comfortable' : 'compact')}>
      {pmeText(locale, `${section}.density.${compact ? 'compact' : 'comfortable'}`)}
    </button>
  );
}

export interface ProblemAlertProps {
  readonly locale: FiscaLocale;
  readonly section: OpsSection;
  readonly errorCode: string;
  readonly onRetry?: (() => void) | undefined;
}

/** Libellé choisi par errorCode (RFC 9457) : jamais le title/detail du serveur. */
export function ProblemAlert({ locale, section, errorCode, onRetry }: ProblemAlertProps): ReactElement {
  const raw: ProblemCategory = problemCategory(errorCode);
  const category: ProblemCategory = raw === 'alreadyReconciled' && section !== 'bank' ? 'conflict' : raw;
  return (
    <div role="alert" className="fisca-pme__state fisca-pme__state--error fisca-pme-ops__problem">
      <p>{pmeText(locale, `${section}.errors.${category}`)}</p>
      {onRetry === undefined ? null : (
        <button type="button" className="fisca-pme__button" onClick={onRetry}>
          {commonText(locale, 'actions.retry')}
        </button>
      )}
    </div>
  );
}

export type LoadState<T> = { readonly kind: 'loading' } | { readonly kind: 'error' } | { readonly kind: 'ready'; readonly data: T };

/** Charge une donnée par port, annulable, avec nouvel essai. */
export function usePortLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): { readonly state: LoadState<T>; readonly retry: () => void } {
  const [state, setState] = useState<LoadState<T>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ kind: 'ready', data });
      },
      () => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      },
    );
    return () => controller.abort();
  }, [...deps, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

/** Date calendaire isolée en LTR. */
export function IsoTime({ value }: { readonly value: string }): ReactElement {
  return (
    <time dir="ltr" dateTime={value} className="fisca-tabular-num fisca-pme-ops__acct">
      {value}
    </time>
  );
}
