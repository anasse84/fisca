import type { ReactElement } from 'react';
import { formatCentimesMad } from '@fisca/ui-mercury';
import type { VarianceReveal as VarianceRevealData } from '../closing/blind-count.ts';

export interface VarianceRevealLabels {
  readonly title: string;
  readonly counted: string;
  readonly expected: string;
  readonly difference: string;
  readonly shortage: string;
  readonly overage: string;
  readonly balanced: string;
}

export interface VarianceRevealProps {
  readonly labels: VarianceRevealLabels;
  readonly reveal: VarianceRevealData;
}

const ICON = { SHORTAGE: '⚠', OVERAGE: '⚠', BALANCED: '✓' } as const;

/** Panneau SUPERVISEUR : monté seulement pour un acteur autorisé, après verrouillage du comptage. Jamais rendu pour le caissier. */
export function VarianceReveal({ labels, reveal }: VarianceRevealProps): ReactElement {
  const kindLabel = reveal.kind === 'SHORTAGE' ? labels.shortage : reveal.kind === 'OVERAGE' ? labels.overage : labels.balanced;
  return (
    <section className="pos-panel pos-variance" aria-labelledby="pos-variance-title" data-testid="variance-panel" data-kind={reveal.kind}>
      <h2 className="pos-panel__title" id="pos-variance-title">
        {labels.title}
      </h2>
      <dl className="pos-pay__summary">
        <div className="pos-pay__row">
          <dt>{labels.counted}</dt>
          <dd dir="ltr" data-testid="variance-counted">{formatCentimesMad(reveal.countedCents)}</dd>
        </div>
        <div className="pos-pay__row">
          <dt>{labels.expected}</dt>
          <dd dir="ltr" data-testid="variance-expected">{formatCentimesMad(reveal.expectedCents)}</dd>
        </div>
        <div className="pos-pay__row pos-pay__row--change">
          <dt>{labels.difference}</dt>
          <dd dir="ltr" data-testid="variance-amount">{formatCentimesMad(reveal.varianceCents)}</dd>
        </div>
      </dl>
      <p className="pos-variance__kind">
        <span aria-hidden="true">{ICON[reveal.kind]} </span>
        <span data-testid="variance-kind">{kindLabel}</span>
      </p>
    </section>
  );
}
