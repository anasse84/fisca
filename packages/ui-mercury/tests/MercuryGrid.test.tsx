// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MercuryGrid, amountCentsColumn, textColumn } from '../src/MercuryGrid.tsx';
import type { MercuryGridProps } from '../src/MercuryGrid.tsx';
import { lintLogicalCss } from '../src/logical-css-lint.ts';

interface Entry {
  readonly id: string;
  readonly label: string;
  readonly totalCents: number | bigint;
}

const VIEWPORT = 440;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => VIEWPORT });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

const entries = (from: number, to: number): Entry[] =>
  Array.from({ length: to - from }, (_, i) => ({ id: `e${from + i}`, label: `Écriture ${from + i}`, totalCents: (from + i) * 100 + 5 }));

const columns = [
  textColumn<Entry>({ id: 'label', header: 'Libellé', getText: (row) => row.label, size: 240 }),
  amountCentsColumn<Entry>({ id: 'total', header: 'Montant', getCents: (row) => row.totalCents, size: 160 }),
];

const labels = {
  ariaLabel: 'Grand livre',
  newRows: (count: number) => `${count} nouvelles lignes`,
  loadingRow: 'Chargement',
};

type Listener = (rows: readonly Entry[]) => void;

function setup(overrides: Partial<MercuryGridProps<Entry>> = {}) {
  let listener: Listener | null = null;
  const subscribe = (next: Listener) => {
    listener = next;
    return () => {
      listener = null;
    };
  };
  const utils = render(
    <MercuryGrid<Entry>
      columns={columns}
      rows={entries(100, 400)}
      density="comfortable"
      labels={labels}
      subscribe={subscribe}
      initialViewportHeight={VIEWPORT}
      {...overrides}
    />,
  );
  const grid = screen.getByRole('grid');
  const scroller = grid.querySelector<HTMLElement>('[data-grid-scroller]');
  if (scroller === null) throw new Error('scroller manquant');
  return {
    ...utils,
    grid,
    scroller,
    push: (rows: readonly Entry[]) => {
      act(() => {
        listener?.(rows);
      });
    },
  };
}

function scrollTo(scroller: HTMLElement, top: number) {
  act(() => {
    scroller.scrollTop = top;
    fireEvent.scroll(scroller);
  });
}

/** Rectangles verticaux des lignes rendues, en repère viewport (top = translateY - scrollTop). */
function rowRects(scroller: HTMLElement): Map<string, { top: number; height: number }> {
  const out = new Map<string, { top: number; height: number }>();
  for (const row of scroller.querySelectorAll<HTMLElement>('[data-row-id]')) {
    const match = /translateY\((-?\d+)px\)/.exec(row.style.transform);
    const top = Number(match?.[1] ?? Number.NaN);
    out.set(row.dataset['rowId'] ?? '', { top: top - scroller.scrollTop, height: Number.parseInt(row.style.blockSize, 10) });
  }
  return out;
}

describe('MercuryGrid : structure et accessibilité', () => {
  it('expose role=grid, aria-rowcount (en-tête inclus), aria-colcount et aria-rowindex 1-basé', () => {
    const { grid } = setup();
    expect(grid.getAttribute('aria-label')).toBe('Grand livre');
    expect(grid.getAttribute('aria-rowcount')).toBe('301');
    expect(grid.getAttribute('aria-colcount')).toBe('2');
    const header = screen.getAllByRole('row')[0];
    expect(header?.getAttribute('aria-rowindex')).toBe('1');
    const first = grid.querySelector('[data-row-id="e100"]');
    expect(first?.getAttribute('aria-rowindex')).toBe('2');
    expect(first?.querySelectorAll('[role="gridcell"]')).toHaveLength(2);
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
  });

  it('ne rend que la fenêtre visible (virtualisation) sur 10 000 lignes', () => {
    const { grid } = setup({ rows: entries(0, 10000) });
    const rendered = grid.querySelectorAll('[data-row-id]').length;
    expect(rendered).toBeGreaterThan(8);
    expect(rendered).toBeLessThan(40);
    expect(grid.getAttribute('aria-rowcount')).toBe('10001');
  });

  it('densité dirigeant : lignes de 44px, data-density=comfortable ; comptable : 28px, data-density=compact', () => {
    const { grid, rerender } = setup();
    expect(grid.getAttribute('data-density')).toBe('comfortable');
    expect(grid.querySelector<HTMLElement>('[data-row-id="e100"]')?.style.blockSize).toBe('44px');
    rerender(
      <MercuryGrid<Entry> columns={columns} rows={entries(100, 400)} density="compact" labels={labels} initialViewportHeight={VIEWPORT} />,
    );
    const grid2 = screen.getByRole('grid');
    expect(grid2.getAttribute('data-density')).toBe('compact');
    expect(grid2.querySelector<HTMLElement>('[data-row-id="e100"]')?.style.blockSize).toBe('28px');
  });

  it('cellule montant : FiscalAmount (centimes entiers, dir=ltr, tabular-nums), bigint accepté', () => {
    setup({ rows: [{ id: 'a', label: 'Facture', totalCents: 123456 }, { id: 'b', label: 'Avoir', totalCents: -900719925474099312345n }] });
    const amount = screen.getByText('1 234,56 MAD');
    expect(amount.getAttribute('dir')).toBe('ltr');
    expect(amount.classList.contains('tabular-nums')).toBe(true);
    expect(screen.getByText('-9 007 199 254 740 993 123,45 MAD')).toBeTruthy();
  });

  it('refuse un montant non entier (aucun flottant monétaire)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fractionalAmount = 25 / 2; // non entier volontaire : le composant doit le refuser
    expect(() => setup({ rows: [{ id: 'x', label: 'Faux', totalCents: fractionalAmount }] })).toThrow(/UI_FLOAT_FORBIDDEN/);
    spy.mockRestore();
  });

  it('hauteur totale réservée : le squelette comble expectedRowCount sans changer la hauteur à l’arrivée des lignes', () => {
    const { grid, scroller } = setup({ rows: entries(0, 20), expectedRowCount: 200 });
    const body = grid.querySelector<HTMLElement>('[data-grid-body]');
    expect(body?.style.blockSize).toBe(`${200 * 44}px`);
    expect(grid.getAttribute('aria-rowcount')).toBe('201');
    scrollTo(scroller, 30 * 44);
    expect(grid.querySelector('[data-row-skeleton]')?.getAttribute('aria-busy')).toBe('true');
    expect(grid.querySelector('[data-row-skeleton]')?.getAttribute('aria-label')).toBe('Chargement');
  });
});

describe('MercuryGrid : flux SSE sans décalage (CLS = 0)', () => {
  it('lecteur défilé : lignes insérées au-dessus, rectangles des lignes visibles inchangés, indicateur affiché', () => {
    const { scroller, push } = setup();
    scrollTo(scroller, 20 * 44 + 10);
    const before = rowRects(scroller);
    expect(before.size).toBeGreaterThan(8);
    push(entries(0, 5));
    expect(scroller.scrollTop).toBe(20 * 44 + 10 + 5 * 44);
    const after = rowRects(scroller);
    let shift = 0;
    let compared = 0;
    for (const [id, rect] of before) {
      const next = after.get(id);
      if (next === undefined) continue;
      compared += 1;
      shift += Math.abs(next.top - rect.top) + Math.abs(next.height - rect.height);
    }
    expect(compared).toBeGreaterThan(8);
    expect(shift).toBe(0);
    expect(screen.getByRole('button', { name: '5 nouvelles lignes' })).toBeTruthy();
    expect(screen.getByRole('grid').getAttribute('aria-rowcount')).toBe('306');
  });

  it('lecteur en haut : lignes retenues, aucun rectangle ne bouge ; clic sur l’indicateur les révèle', () => {
    const { scroller, grid, push } = setup();
    const before = rowRects(scroller);
    push(entries(0, 3));
    expect(rowRects(scroller)).toEqual(before);
    expect(grid.querySelector('[data-row-id="e0"]')).toBeNull();
    expect(grid.getAttribute('aria-rowcount')).toBe('301');
    fireEvent.click(screen.getByRole('button', { name: '3 nouvelles lignes' }));
    expect(grid.getAttribute('aria-rowcount')).toBe('304');
    expect(scroller.scrollTop).toBe(0);
    expect(grid.querySelector('[data-row-id="e0"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /nouvelles lignes/ })).toBeNull();
  });

  it('l’indicateur est une région polie (aria-live=polite), jamais assertive', () => {
    const { push } = setup();
    push(entries(0, 2));
    const button = screen.getByRole('button', { name: '2 nouvelles lignes' });
    expect(button.closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('se désabonne au démontage', () => {
    const unsubscribe = vi.fn();
    const { unmount } = render(
      <MercuryGrid<Entry>
        columns={columns}
        rows={entries(0, 5)}
        density="comfortable"
        labels={labels}
        subscribe={() => unsubscribe}
        initialViewportHeight={VIEWPORT}
      />,
    );
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('MercuryGrid : navigation clavier', () => {
  it('une seule ligne tabbable ; flèches, Home, End déplacent le focus et aria-selected', () => {
    const { grid } = setup({ rows: entries(0, 100) });
    const tabbable = grid.querySelectorAll('[role="row"][tabindex="0"]');
    expect(tabbable).toHaveLength(1);
    const first = grid.querySelector<HTMLElement>('[data-row-id="e0"]');
    act(() => first?.focus());
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('e1');
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('e99');
    expect(document.activeElement?.getAttribute('aria-rowindex')).toBe('101');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('e0');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('e0');
  });

  it('J/K parcourent les lignes, Entrée active la ligne', () => {
    const onRowActivate = vi.fn();
    const { grid } = setup({ rows: entries(0, 50), onRowActivate });
    const first = grid.querySelector<HTMLElement>('[data-row-id="e0"]');
    act(() => first?.focus());
    fireEvent.keyDown(first as HTMLElement, { key: 'j' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'j' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'k' });
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('e1');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    expect(onRowActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
  });

  it('la ligne active reste la même ligne quand des lignes arrivent au-dessus', () => {
    const { grid, scroller, push } = setup({ rows: entries(100, 400) });
    scrollTo(scroller, 20 * 44);
    const target = grid.querySelector<HTMLElement>('[data-row-id="e121"]');
    act(() => target?.focus());
    fireEvent.keyDown(target as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('e122');
    push(entries(0, 4));
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('e122');
    expect(document.activeElement?.getAttribute('aria-rowindex')).toBe(String(4 + 22 + 2));
  });
});

describe('MercuryGrid : RTL et CSS logique', () => {
  it('le CSS de la grille passe lintLogicalCss sans violation', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/grid.css'), 'utf8');
    expect(lintLogicalCss(css)).toEqual([]);
    expect(css).toMatch(/overflow-anchor:\s*none/);
  });

  it('CLS nul : l’indicateur « nouvelles lignes » a une boîte de taille fixe (le décompte qui grandit ne déplace rien)', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/grid.css'), 'utf8');
    const rule = /\.fisca-grid__new-rows\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/inline-size:\s*(?!auto|fit-content|max-content|min-content)[^;]+;/);
    expect(rule).toMatch(/box-sizing:\s*border-box/);
    expect(rule).toMatch(/mercury-allow-physical: [^*]+\*\/\s*text-align:\s*left/);
    expect(lintLogicalCss(css)).toEqual([]);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).toMatch(/white-space:\s*nowrap/);
  });

  it('aucune propriété physique en style en ligne ; direction héritée du document (dir=rtl)', () => {
    const { container } = render(
      <div dir="rtl">
        <MercuryGrid<Entry> columns={columns} rows={entries(0, 5)} density="comfortable" labels={labels} initialViewportHeight={VIEWPORT} />
      </div>,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/(?:^|[;"\s])(?:left|right|margin-left|margin-right|padding-left|padding-right):/);
    expect(container.querySelector('[dir="rtl"] [role="grid"]')).not.toBeNull();
  });
});
