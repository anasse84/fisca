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

export interface AiCrafterConfidenceProps {
  /** Confiance de l'IA en points de base entiers, 0..10000. */
  readonly confidenceBps: number;
}

export function AiCrafterConfidence({ confidenceBps }: AiCrafterConfidenceProps): ReactElement {
  const percent = confidencePercent(confidenceBps);
  return (
    <span className="inline-flex items-center gap-2">
      <span
        role="meter"
        aria-label="Confiance de l’IA"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent} %`}
        className="inline-block h-2 w-24 rounded bg-[var(--bg-subtle)]"
      >
        <span className="block h-2 rounded bg-[var(--brand-indigo)]" style={{ inlineSize: `${percent}%` }} />
      </span>
      <span dir="ltr" className="fisca-tabular-num tabular-nums text-xs text-[var(--text-secondary)]">{`${percent} %`}</span>
    </span>
  );
}

export interface AiCrafterAmountFieldProps {
  /** `null` : montant illisible sur le scan. Il reste vide, jamais deviné (règle d'arrêt Section 05). */
  readonly amountCents: number | bigint | null;
  readonly currency?: string;
}

export function AiCrafterAmountField({ amountCents, currency = 'MAD' }: AiCrafterAmountFieldProps): ReactElement {
  if (amountCents === null) {
    return (
      <div
        role="group"
        aria-label="Montant illisible"
        className="fisca-ai-illegible rounded border-2 border-[var(--status-warning-text)] bg-[var(--status-warning-bg)] px-2 py-1 text-[var(--status-warning-text)]"
      >
        Montant illisible — à saisir par un humain
      </div>
    );
  }
  return <FiscalAmount amountCents={amountCents} currency={currency} />;
}

export type AiCrafterDecision = 'pending' | 'validated' | 'rejected';

export interface AiCrafterCardProps {
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
        <span className="rounded bg-[var(--brand-indigo)] px-2 py-0.5 text-xs font-semibold text-white">IA</span>
        <span className="rounded bg-[var(--status-warning-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--status-warning-text)]">
          Point à examiner
        </span>
        <h3 id={headingId} className="text-base font-semibold">
          {title}
        </h3>
      </header>
      <p className="text-sm text-[var(--text-secondary)]">{summary}</p>
      <AiCrafterAmountField amountCents={amountCents} currency={currency} />
      <AiCrafterConfidence confidenceBps={confidenceBps} />
      {decision === 'pending' ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={illegible}
            onClick={() => onValidate(id)}
            className="rounded bg-[var(--brand-emerald)] px-3 py-1 text-sm font-semibold text-white disabled:opacity-50"
          >
            Valider (approbation humaine)
          </button>
          <button
            type="button"
            onClick={() => onReject(id)}
            className="rounded border border-[var(--line-border)] px-3 py-1 text-sm font-semibold"
          >
            Rejeter
          </button>
        </div>
      ) : (
        <p role="status" className="text-sm font-semibold">
          {decision === 'validated' ? 'Validé par un humain' : 'Rejeté par un humain'}
        </p>
      )}
    </article>
  );
}
