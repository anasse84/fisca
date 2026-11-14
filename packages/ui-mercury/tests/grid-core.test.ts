import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DENSITY_TOKENS } from '../src/tokens.ts';
import {
  ROW_HEIGHT_PX,
  computeWindow,
  createFeed,
  measureLayoutShift,
  newRowCount,
  nextActiveIndex,
  noteScroll,
  receiveRows,
  revealNewRows,
  scrollTopToReveal,
  visibleRowRects,
  windowIndexes,
} from '../src/grid-core.ts';

interface Row {
  readonly id: string;
}
const makeRows = (from: number, to: number): Row[] => Array.from({ length: to - from }, (_, i) => ({ id: `r${from + i}` }));

describe('hauteurs de ligne par densité', () => {
  it('44px dirigeant (comfortable) et 28px comptable (compact), alignées sur les tokens et tokens.css', () => {
    expect(ROW_HEIGHT_PX.comfortable).toBe(44);
    expect(ROW_HEIGHT_PX.compact).toBe(28);
    expect(`${ROW_HEIGHT_PX.comfortable}px`).toBe(DENSITY_TOKENS.comfortable);
    expect(`${ROW_HEIGHT_PX.compact}px`).toBe(DENSITY_TOKENS.compact);
    const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');
    expect(css).toMatch(/--table-row-height:\s*44px/);
    expect(css).toMatch(/\[data-density="compact"\]\s*\{\s*--table-row-height:\s*28px/);
  });
});

describe('computeWindow', () => {
  it('calcule la fenêtre visible, la surcouche et la hauteur totale réservée', () => {
    const win = computeWindow({ scrollTop: 440, viewportHeight: 220, rowHeight: 44, rowCount: 1000, overscan: 2 });
    expect(win.firstVisible).toBe(10);
    expect(win.lastVisible).toBe(14);
    expect(win.startIndex).toBe(8);
    expect(win.endIndex).toBe(16);
    expect(win.totalHeight).toBe(44000);
  });

  it('borne la fenêtre aux lignes existantes et gère zéro ligne', () => {
    const win = computeWindow({ scrollTop: 0, viewportHeight: 220, rowHeight: 28, rowCount: 3, overscan: 5 });
    expect(win.startIndex).toBe(0);
    expect(win.endIndex).toBe(2);
    expect(win.totalHeight).toBe(84);
    const empty = computeWindow({ scrollTop: 0, viewportHeight: 220, rowHeight: 28, rowCount: 0, overscan: 5 });
    expect(empty.endIndex).toBe(-1);
    expect(empty.totalHeight).toBe(0);
  });

  it('windowIndexes force la ligne active dans la fenêtre rendue (le focus ne se perd pas)', () => {
    const indexes = windowIndexes({ startIndex: 10, endIndex: 12, overscan: 1, count: 100 }, 50);
    expect(indexes).toEqual([9, 10, 11, 12, 13, 50]);
    expect(windowIndexes({ startIndex: 10, endIndex: 12, overscan: 1, count: 100 }, null)).toEqual([9, 10, 11, 12, 13]);
  });
});

describe('flux SSE : CLS = 0', () => {
  const rowHeight = ROW_HEIGHT_PX.comfortable;
  const viewportHeight = 440;

  const rectsOf = (rows: readonly Row[], scrollTop: number, height: number) =>
    visibleRowRects(rows, { scrollTop, viewportHeight, rowHeight: height });

  it('lecteur défilé : 5 lignes insérées au-dessus ne déplacent aucun rectangle visible (déplacement = 0)', () => {
    const feed = createFeed(makeRows(100, 400));
    const scrollTop = 20 * rowHeight + 10;
    const before = rectsOf(feed.rows, scrollTop, rowHeight);
    const arrival = receiveRows(feed, makeRows(0, 5), scrollTop, rowHeight);
    const after = rectsOf(arrival.state.rows, arrival.scrollTop, rowHeight);
    expect(arrival.state.rows).toHaveLength(305);
    expect(arrival.scrollTop).toBe(scrollTop + 5 * rowHeight);
    expect(before.size).toBeGreaterThan(5);
    expect(measureLayoutShift(before, after)).toBe(0);
    expect(newRowCount(arrival.state)).toBe(5);
  });

  it('même preuve en densité compacte (28px) et avec plusieurs arrivées successives', () => {
    const compact = ROW_HEIGHT_PX.compact;
    let state = createFeed(makeRows(1000, 1200));
    let scrollTop = 33 * compact;
    const before = rectsOf(state.rows, scrollTop, compact);
    for (const batch of [makeRows(0, 3), makeRows(3, 4), makeRows(4, 12)]) {
      const arrival = receiveRows(state, batch, scrollTop, compact);
      state = arrival.state;
      scrollTop = arrival.scrollTop;
    }
    expect(measureLayoutShift(before, rectsOf(state.rows, scrollTop, compact))).toBe(0);
    expect(newRowCount(state)).toBe(12);
  });

  it('lecteur en haut (scrollTop 0) : les lignes sont retenues, indicateur « n nouvelles lignes », aucun saut', () => {
    const feed = createFeed(makeRows(100, 300));
    const before = rectsOf(feed.rows, 0, rowHeight);
    const arrival = receiveRows(feed, makeRows(0, 7), 0, rowHeight);
    expect(arrival.state.rows).toBe(feed.rows);
    expect(arrival.state.pending).toHaveLength(7);
    expect(newRowCount(arrival.state)).toBe(7);
    expect(arrival.scrollTop).toBe(0);
    expect(measureLayoutShift(before, rectsOf(arrival.state.rows, arrival.scrollTop, rowHeight))).toBe(0);
  });

  it('révéler les lignes retenues (action explicite) les insère en tête et remet l’indicateur à zéro', () => {
    const feed = createFeed(makeRows(100, 300));
    const held = receiveRows(feed, makeRows(0, 7), 0, rowHeight).state;
    const revealed = revealNewRows(held);
    expect(revealed.scrollTop).toBe(0);
    expect(revealed.state.rows.slice(0, 7).map((r) => r.id)).toEqual(makeRows(0, 7).map((r) => r.id));
    expect(revealed.state.rows).toHaveLength(207);
    expect(newRowCount(revealed.state)).toBe(0);
  });

  it('retour manuel en haut : l’indicateur des lignes déjà insérées se résorbe', () => {
    const feed = createFeed(makeRows(100, 300));
    const arrival = receiveRows(feed, makeRows(0, 4), 500, rowHeight);
    expect(newRowCount(arrival.state)).toBe(4);
    expect(newRowCount(noteScroll(arrival.state, 120))).toBe(4);
    expect(newRowCount(noteScroll(arrival.state, 0))).toBe(0);
  });

  it('ignore les doublons (rejeu SSE après reconnexion) et les ids répétés dans un lot', () => {
    const feed = createFeed(makeRows(0, 10));
    const arrival = receiveRows(feed, [{ id: 'r3' }, { id: 'n1' }, { id: 'n1' }, { id: 'n2' }], 200, rowHeight);
    expect(arrival.state.rows.map((r) => r.id).slice(0, 2)).toEqual(['n1', 'n2']);
    expect(arrival.state.rows).toHaveLength(12);
    expect(newRowCount(arrival.state)).toBe(2);
    const replay = receiveRows(arrival.state, [{ id: 'n1' }], arrival.scrollTop, rowHeight);
    expect(replay.state).toBe(arrival.state);
    expect(replay.scrollTop).toBe(arrival.scrollTop);
  });

  it('un lot vide ne change rien', () => {
    const feed = createFeed(makeRows(0, 3));
    const arrival = receiveRows(feed, [], 100, rowHeight);
    expect(arrival.state).toBe(feed);
    expect(arrival.scrollTop).toBe(100);
  });

  it('measureLayoutShift détecte un décalage réel (le test de mesure n’est pas tautologique)', () => {
    const feed = createFeed(makeRows(100, 400));
    const before = rectsOf(feed.rows, 880, rowHeight);
    const naive = [...makeRows(0, 5), ...feed.rows];
    expect(measureLayoutShift(before, rectsOf(naive, 880, rowHeight))).toBeGreaterThan(0);
  });
});

describe('navigation clavier (logique pure)', () => {
  it('flèches, J/K, Home/End, PageUp/PageDown bornés', () => {
    const args = { rowCount: 100, pageRows: 10 };
    expect(nextActiveIndex('ArrowDown', 5, args)).toBe(6);
    expect(nextActiveIndex('j', 5, args)).toBe(6);
    expect(nextActiveIndex('ArrowUp', 5, args)).toBe(4);
    expect(nextActiveIndex('k', 5, args)).toBe(4);
    expect(nextActiveIndex('ArrowUp', 0, args)).toBe(0);
    expect(nextActiveIndex('ArrowDown', 99, args)).toBe(99);
    expect(nextActiveIndex('Home', 50, args)).toBe(0);
    expect(nextActiveIndex('End', 50, args)).toBe(99);
    expect(nextActiveIndex('PageDown', 95, args)).toBe(99);
    expect(nextActiveIndex('PageUp', 3, args)).toBe(0);
    expect(nextActiveIndex('PageDown', 20, args)).toBe(30);
  });

  it('retourne null pour une touche non gérée ou une grille vide', () => {
    expect(nextActiveIndex('a', 1, { rowCount: 10, pageRows: 5 })).toBeNull();
    expect(nextActiveIndex('ArrowDown', 0, { rowCount: 0, pageRows: 5 })).toBeNull();
  });

  it('scrollTopToReveal ne défile que si la ligne sort de la zone visible', () => {
    expect(scrollTopToReveal({ index: 5, scrollTop: 0, viewportHeight: 440, rowHeight: 44 })).toBe(0);
    expect(scrollTopToReveal({ index: 12, scrollTop: 0, viewportHeight: 440, rowHeight: 44 })).toBe(132);
    expect(scrollTopToReveal({ index: 2, scrollTop: 440, viewportHeight: 440, rowHeight: 44 })).toBe(88);
  });
});
