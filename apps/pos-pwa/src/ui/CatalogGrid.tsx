import type { ReactElement } from 'react';
import { FiscalAmount } from '@fisca/ui-mercury';
import type { CatalogItem } from '../sale/cart.ts';

export interface CatalogGridProps {
  readonly title: string;
  readonly emptyLabel: string;
  readonly items: readonly CatalogItem[];
  readonly addLabel: (name: string) => string;
  readonly onAdd: (item: CatalogItem) => void;
}

/** Grille d'articles du port de catalogue : un bouton tactile par article, aucun menu déroulant ni survol. */
export function CatalogGrid({ title, emptyLabel, items, addLabel, onAdd }: CatalogGridProps): ReactElement {
  return (
    <section className="pos-panel" aria-labelledby="pos-catalog-title">
      <h2 className="pos-panel__title" id="pos-catalog-title">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="pos-empty">{emptyLabel}</p>
      ) : (
        <div className="pos-catalog">
          {items.map((item) => (
            <button key={item.id} type="button" className="pos-tile" data-testid={`catalog-item-${item.id}`} aria-label={addLabel(item.name)} onClick={() => onAdd(item)}>
              <span className="pos-tile__name">{item.name}</span>
              <span className="pos-tile__price">
                <FiscalAmount amountCents={item.unitPriceTtcCents} />
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
