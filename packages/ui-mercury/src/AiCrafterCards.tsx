import type { ReactElement } from 'react';
import { FiscalAmount } from './FiscalPrimitives.tsx';

const MAX_CONFIDENCE_BPS = 10000;

/** Pourcentage entier affichable (troncature) d'une confiance en points de base ; affichage seul, arithmétique BigInt. */
function confidencePercent(confidence: number): number {
  if (!Number.isSafeInteger(confidence) || confidence < 0 || confidence > MAX_CONFIDENCE_BPS) {
    throw new Error(`UI_CONFIDENCE_INVALID: confiance hors 0..${MAX_CONFIDENCE_BPS} ou non entière (${confidence}).`);
  }
  return Number(BigInt(confidence) / 100n);
}

export interface AiCrafterConfidenceLabels {
  /** Nom accessible de la jauge de confiance. */
  readonly meter: string;
}

export interface AiCrafterConfidenceProps {
  /** Confiance de l'IA en points de base entiers, 0..10000. */
  readonly confidenceBps: number;
  readonly labels: AiCrafterConfidenceLabels;
}

export function AiCrafterConfidence({ confidenceBps, labels }: AiCrafterConfidenceProps): ReactElement {
  const percent = confidencePercent(confidenceBps);
  return (
    <span className="inline-flex items-center gap-2">
      <span
        role="meter"
        aria-label={labels.meter}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent} %`}
        className="inline-block h-2 w-24 rounded bg-[var(--bg-subtle)]"
      >
        <span className="block h-2 rounded bg-[var(--brand-indigo)]" aria-hidden="true" style={{ inlineSize: `${percent}%` }} />
      </span>
      <span dir="ltr" className="fisca-tabular-num tabular-nums text-xs text-[var(--text-secondary)]">{`${percent} %`}</span>
    </span>
  );
}

export interface AiCrafterAmountLabels {
  /** Nom accessible du champ de montant illisible. */
  readonly illegibleGroup: string;
  /** Texte visible : le montant reste vide, à saisir par un humain. */
  readonly illegibleText: string;
}

export interface AiCrafterAmountFieldProps {
  readonly labels: AiCrafterAmountLabels;
  /** `null` : montant illisible sur le scan. Il reste vide, jamais deviné (règle d'arrêt Section 05). */
  readonly amountCents: number | bigint | null;
  readonly currency?: string;
}

export function AiCrafterAmountField({ amountCents, currency = 'MAD', labels }: AiCrafterAmountFieldProps): ReactElement {
  if (amountCents === null) {
    return (
      <div
        role="group"
        aria-label={labels.illegibleGroup}
        className="fisca-ai-illegible rounded border-2 border-[var(--status-warning-text)] bg-[var(--status-warning-bg)] px-2 py-1 text-[var(--status-warning-text)]"
      >
        {labels.illegibleText}
      </div>
    );
  }
  return <FiscalAmount amountCents={amountCents} currency={currency} />;
}

export type AiCrafterDecision = 'pending' | 'validated' | 'rejected';

export interface AiCrafterCardLabels {
  readonly aiBadge: string;
  /** « Point à examiner » : jamais « Anomalie confirmée » avant visa humain. */
  readonly reviewBadge: string;
  /** Bouton final : rappelle l'approbation humaine. */
  readonly validate: string;
  readonly reject: string;
  readonly validatedByHuman: string;
  readonly rejectedByHuman: string;
  readonly confidence: AiCrafterConfidenceLabels;
  readonly amount: AiCrafterAmountLabels;
}

export interface AiCrafterCardProps {
  readonly labels: AiCrafterCardLabels;
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly amountCents: number | bigint | null;
  readonly confidenceBps: number;
  readonly currency?: string;
  /** Décision humaine déjà enregistrée ; la carte n'en prend jamais d'elle-même. */
  readonly decision?: AiCrafterDecision;
  readonly onValidate: (id: string) => void;
  readonly onReject: (id: string) => void;
}

/**
 * Carte de détection IA : badge IA + « Point à examiner » (jamais « Anomalie confirmée » avant visa humain),
 * confiance, montant illisible laissé vide, validation uniquement par clic humain explicite.
 */
export function AiCrafterCard({
  id,
  title,
  summary,
  amountCents,
  confidenceBps,
  currency = 'MAD',
  decision = 'pending',
  labels,
  onValidate,
  onReject,
}: AiCrafterCardProps): ReactElement {
  confidencePercent(confidenceBps);
  const headingId = `ai-crafter-${id}-title`;
  const illegible = amountCents === null;
  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded border border-[var(--line-border)] bg-[var(--bg-surface)] p-4 text-[var(--text-primary)]"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="rounded border-2 border-[var(--brand-indigo)] bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-semibold text-[var(--text-primary)]">
          {labels.aiBadge}
        </span>
        <span className="rounded bg-[var(--status-warning-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--status-warning-text)]">
          {labels.reviewBadge}
        </span>
        <h3 id={headingId} className="text-base font-semibold">
          {title}
        </h3>
      </header>
      <p className="text-sm text-[var(--text-secondary)]">{summary}</p>
      <AiCrafterAmountField amountCents={amountCents} currency={currency} labels={labels.amount} />
      <AiCrafterConfidence confidenceBps={confidenceBps} labels={labels.confidence} />
      {decision === 'pending' ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={illegible}
            onClick={() => onValidate(id)}
            className="rounded bg-[var(--brand-emerald)] px-3 py-1 text-sm font-semibold text-[var(--bg-canvas)] disabled:opacity-50"
          >
            {labels.validate}
          </button>
          <button
            type="button"
            onClick={() => onReject(id)}
            className="rounded border border-[var(--line-border)] px-3 py-1 text-sm font-semibold"
          >
            {labels.reject}
          </button>
        </div>
      ) : (
        <p role="status" className="text-sm font-semibold">
          {decision === 'validated' ? labels.validatedByHuman : labels.rejectedByHuman}
        </p>
      )}
    </article>
  );
}
