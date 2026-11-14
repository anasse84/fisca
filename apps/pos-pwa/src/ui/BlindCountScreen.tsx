import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { formatCentimesMad } from '@fisca/ui-mercury';
import { totalCountedCents } from '../closing/denominations.ts';
import type { CountMap, Denomination } from '../closing/denominations.ts';

export interface BlindCountLabels {
  readonly title: string;
  readonly instruction: string;
  readonly blindNotice: string;
  readonly banknotes: string;
  readonly coins: string;
  readonly increase: (value: string) => string;
  readonly decrease: (value: string) => string;
  readonly quantity: (value: string) => string;
  readonly counted: string;
  readonly lock: string;
  readonly locking: string;
  readonly locked: string;
  readonly lockedWait: string;
  readonly emptyGrid: string;
}

export interface BlindCountScreenProps {
  readonly labels: BlindCountLabels;
  readonly denominations: readonly Denomination[];
  /** Le compté VERROUILLÉ du caissier lui-même (jamais une autre valeur) ; `null` tant que le comptage est ouvert. */
  readonly lockedCountedCents: number | null;
  readonly busy: boolean;
  readonly errorText: string | null;
  readonly onLock: (counts: CountMap) => void;
}

const MAX_QUANTITY = 99_999;

function Amount({ cents }: { readonly cents: number }): ReactElement {
  return (
    <span dir="ltr" className="pos-amount">
      {formatCentimesMad(cents)}
    </span>
  );
}

/**
 * Écran de comptage du CAISSIER. Il ne reçoit, ne calcule et n'affiche aucune autre valeur que ce que le caissier saisit :
 * aucune propriété ne porte de montant théorique, et rien n'en est déduit côté composant.
 */
export function BlindCountScreen({ labels, denominations, lockedCountedCents, busy, errorText, onLock }: BlindCountScreenProps): ReactElement {
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});
  const total = useMemo(() => totalCountedCents(denominations, counts), [denominations, counts]);
  const locked = lockedCountedCents !== null;
  const setQuantity = (id: string, quantity: number): void => setCounts((c) => ({ ...c, [id]: Math.min(MAX_QUANTITY, Math.max(0, quantity)) }));

  if (locked) {
    return (
      <section className="pos-panel pos-count" aria-labelledby="pos-count-title" data-testid="count-locked">
        <h2 className="pos-panel__title" id="pos-count-title">
          {labels.title}
        </h2>
        <p className="pos-status" role="status">
          <span aria-hidden="true">✓ </span>
          {labels.locked}
        </p>
        <p className="pos-count__total">
          <span>{labels.counted}</span> <Amount cents={lockedCountedCents} />
        </p>
        <p className="pos-empty">{labels.lockedWait}</p>
      </section>
    );
  }

  const groups: readonly { readonly title: string; readonly items: readonly Denomination[] }[] = [
    { title: labels.banknotes, items: denominations.filter((d) => d.kind === 'banknote') },
    { title: labels.coins, items: denominations.filter((d) => d.kind === 'coin') },
  ];
  return (
    <section className="pos-panel pos-count" aria-labelledby="pos-count-title" data-testid="count-screen">
      <h2 className="pos-panel__title" id="pos-count-title">
        {labels.title}
      </h2>
      <p className="pos-empty">{labels.instruction}</p>
      <p className="pos-status">{labels.blindNotice}</p>
      {denominations.length === 0 ? <p className="pos-alert">{labels.emptyGrid}</p> : null}
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <fieldset key={group.title} className="pos-count__group">
            <legend className="pos-count__legend">{group.title}</legend>
            {group.items.map((d) => {
              const value = formatCentimesMad(d.valueCents);
              const quantity = counts[d.id] ?? 0;
              return (
                <div key={d.id} className="pos-count__row" data-testid={`count-row-${d.id}`}>
                  <span className="pos-count__value" dir="ltr">
                    {value}
                  </span>
                  <button type="button" className="pos-icon-btn" data-testid={`count-decrease-${d.id}`} aria-label={labels.decrease(value)} disabled={quantity === 0 || busy} onClick={() => setQuantity(d.id, quantity - 1)}>
                    <span aria-hidden="true">−</span>
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    dir="ltr"
                    className="pos-count__input"
                    data-testid={`count-input-${d.id}`}
                    aria-label={labels.quantity(value)}
                    value={String(quantity)}
                    disabled={busy}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/gu, '');
                      setQuantity(d.id, digits === '' ? 0 : Number(digits));
                    }}
                  />
                  <button type="button" className="pos-icon-btn" data-testid={`count-increase-${d.id}`} aria-label={labels.increase(value)} disabled={busy} onClick={() => setQuantity(d.id, quantity + 1)}>
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
              );
            })}
          </fieldset>
        ),
      )}
      <p className="pos-count__total">
        <span>{labels.counted}</span>{' '}
        <span data-testid="count-total">
          <Amount cents={total} />
        </span>
      </p>
      {errorText === null ? null : (
        <p className="pos-alert" role="alert" data-testid="count-error">
          {errorText}
        </p>
      )}
      <div className="pos-actions pos-actions--spaced">
        <button type="button" className="pos-action pos-action--primary" data-testid="count-lock" disabled={busy || denominations.length === 0} onClick={() => onLock(counts)}>
          {busy ? labels.locking : labels.lock}
        </button>
      </div>
    </section>
  );
}
