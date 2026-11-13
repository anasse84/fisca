import type { ReactElement } from 'react';
import { formatCentimesMad } from './format-centimes.ts';

export type FiscaLocale = 'fr' | 'ar' | 'ary' | 'zgh-Latn' | 'zgh-Tfng' | 'en';

export interface FiscalAmountProps {
  /** Centimes entiers : nombre sûr ou bigint (jamais de flottant). */
  readonly amountCents: number | bigint;
  readonly currency?: string;
  readonly emphasizeSign?: boolean;
}

/** Montant isolé en bidi (`dir="ltr"`), chiffres tabulaires occidentaux. */
export function FiscalAmount({ amountCents, currency = 'MAD', emphasizeSign = false }: FiscalAmountProps): ReactElement {
  const formatted = formatCentimesMad(amountCents, currency);
  const toneClass = emphasizeSign && amountCents < 0 ? 'text-[var(--status-danger-text)]' : 'text-[var(--text-primary)]';
  return (
    <span dir="ltr" className={`fisca-tabular-num tabular-nums inline-block text-end ${toneClass}`}>
      {formatted}
    </span>
  );
}

export interface FiscalTermProps {
  readonly locale: FiscaLocale;
  readonly label: string;
  readonly acronym?: string;
  readonly officialAr: string;
  readonly officialFr: string;
}

/** Terme comptable : sigle latin préservé, infobulle fr — ar obligatoire en Tifinagh IRCAM (Section 03/07). */
export function FiscalTerm({ locale, label, acronym, officialAr, officialFr }: FiscalTermProps): ReactElement {
  const hasTooltip = locale === 'zgh-Tfng';
  const tooltipText = `${officialFr} — ${officialAr}`;
  return (
    <span
      {...(hasTooltip ? { title: tooltipText, tabIndex: 0 } : {})}
      className="inline-flex items-baseline gap-1 border-b border-dotted border-[var(--line-border)] cursor-help"
    >
      <span>{label}</span>
      {acronym !== undefined ? (
        <abbr dir="ltr" className="fisca-tabular-num tabular-nums text-xs font-semibold no-underline">
          ({acronym})
        </abbr>
      ) : null}
    </span>
  );
}

export type FiscalStatus = 'cleared';

export interface FiscalStatusBadgeProps {
  readonly status: FiscalStatus;
  /** Libellé obligatoire, résolu par l'appelant dans la langue active (clé i18n `states.cleared`) : aucun repli en dur. */
  readonly label: string;
}

/** Tant que seul le pilote `simulated` existe, le libellé de `states.cleared` (pilote simulé, B-13) vient du dictionnaire. */
export function FiscalStatusBadge({ status, label }: FiscalStatusBadgeProps): ReactElement {
  return (
    <span
      role="status"
      data-status={status}
      className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold bg-[var(--status-cleared-bg)] text-[var(--status-cleared-text)]"
    >
      {label}
    </span>
  );
}
