/**
 * Logique pure de la grille Mercury (Doc_08 Sections 04 et 10) : fenêtre de virtualisation, ancrage de défilement,
 * file de lignes SSE et navigation clavier. Aucune dépendance React ni DOM : tout est testable en isolation.
 * Toutes les grandeurs sont des pixels ou des indices entiers ; les montants ne transitent jamais ici.
 */

export type GridDensity = 'comfortable' | 'compact';

/** 44px « dirigeant » (comfortable) et 28px « comptable » (compact), alignés sur `--table-row-height` de tokens.css. */
export const ROW_HEIGHT_PX: Readonly<Record<GridDensity, number>> = { comfortable: 44, compact: 28 };

export interface WindowInput {
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly rowHeight: number;
  readonly rowCount: number;
  readonly overscan: number;
}

export interface GridWindow {
  readonly firstVisible: number;
  readonly lastVisible: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly totalHeight: number;
}

/** Fenêtre de lignes pour des lignes de hauteur fixe. `endIndex` vaut -1 quand il n'y a aucune ligne. */
export function computeWindow(input: WindowInput): GridWindow {
  const { scrollTop, viewportHeight, rowHeight, rowCount, overscan } = input;
  const totalHeight = rowCount * rowHeight;
  if (rowCount <= 0) {
    return { firstVisible: 0, lastVisible: -1, startIndex: 0, endIndex: -1, totalHeight: 0 };
  }
  const lastIndex = rowCount - 1;
  const firstVisible = Math.min(lastIndex, Math.max(0, Math.floor(scrollTop / rowHeight)));
  const lastVisible = Math.min(lastIndex, Math.max(firstVisible, Math.ceil((scrollTop + viewportHeight) / rowHeight) - 1));
  return {
    firstVisible,
    lastVisible,
    startIndex: Math.max(0, firstVisible - overscan),
    endIndex: Math.min(lastIndex, lastVisible + overscan),
    totalHeight,
  };
}

export interface RangeInput {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly overscan: number;
  readonly count: number;
}

/** Indices à rendre : fenêtre + surcouche, plus la ligne active (épinglée) pour ne jamais perdre le focus clavier. */
export function windowIndexes(range: RangeInput, pinnedIndex: number | null): number[] {
  const start = Math.max(0, range.startIndex - range.overscan);
  const end = Math.min(range.count - 1, range.endIndex + range.overscan);
  const indexes: number[] = [];
  for (let i = start; i <= end; i += 1) indexes.push(i);
  if (pinnedIndex !== null && pinnedIndex >= 0 && pinnedIndex < range.count && (pinnedIndex < start || pinnedIndex > end)) {
    if (pinnedIndex < start) indexes.unshift(pinnedIndex);
    else indexes.push(pinnedIndex);
  }
  return indexes;
}

export interface RowRect {
  readonly top: number;
  readonly height: number;
}

export interface RectInput {
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly rowHeight: number;
}

/** Rectangles verticaux (repère viewport) des lignes réellement visibles, indexés par identifiant stable de ligne. */
export function visibleRowRects(rows: readonly { readonly id: string }[], input: RectInput): Map<string, RowRect> {
  const win = computeWindow({ ...input, rowCount: rows.length, overscan: 0 });
  const rects = new Map<string, RowRect>();
  for (let i = win.firstVisible; i <= win.lastVisible; i += 1) {
    const row = rows[i];
    if (row !== undefined) rects.set(row.id, { top: i * input.rowHeight - input.scrollTop, height: input.rowHeight });
  }
  return rects;
}

/** Déplacement cumulé (px) des rectangles communs avant/après ; 0 prouve l'absence de décalage de mise en page. */
export function measureLayoutShift(before: ReadonlyMap<string, RowRect>, after: ReadonlyMap<string, RowRect>): number {
  let shift = 0;
  for (const [id, rect] of before) {
    const next = after.get(id);
    if (next !== undefined) shift += Math.abs(next.top - rect.top) + Math.abs(next.height - rect.height);
  }
  return shift;
}

export interface FeedState<T extends { readonly id: string }> {
  /** Lignes affichées, plus récentes en tête. */
  readonly rows: readonly T[];
  /** Lignes arrivées pendant que le lecteur est en haut : retenues derrière l'indicateur. */
  readonly pending: readonly T[];
  /** Lignes insérées au-dessus de la zone lue (défilement compensé), pas encore vues. */
  readonly unseenAbove: number;
}

export interface FeedUpdate<T extends { readonly id: string }> {
  readonly state: FeedState<T>;
  readonly scrollTop: number;
}

export function createFeed<T extends { readonly id: string }>(rows: readonly T[]): FeedState<T> {
  return { rows, pending: [], unseenAbove: 0 };
}

/** Nombre affiché par l'indicateur « n nouvelles lignes ». */
export function newRowCount<T extends { readonly id: string }>(state: FeedState<T>): number {
  return state.pending.length + state.unseenAbove;
}

/**
 * Intègre un lot SSE (le plus récent en tête). Doublons ignorés (rejeu après reconnexion).
 * - lecteur tout en haut (scrollTop <= 0) : lignes retenues, rien ne bouge ;
 * - lecteur défilé : lignes insérées en tête et scrollTop augmenté de n × hauteur de ligne, de sorte que
 *   chaque ligne visible garde exactement son rectangle (ancrage).
 */
export function receiveRows<T extends { readonly id: string }>(
  state: FeedState<T>,
  incoming: readonly T[],
  scrollTop: number,
  rowHeight: number,
): FeedUpdate<T> {
  const known = new Set<string>();
  for (const row of state.rows) known.add(row.id);
  for (const row of state.pending) known.add(row.id);
  const fresh: T[] = [];
  for (const row of incoming) {
    if (!known.has(row.id)) {
      known.add(row.id);
      fresh.push(row);
    }
  }
  if (fresh.length === 0) return { state, scrollTop };
  if (scrollTop <= 0) {
    return { state: { ...state, pending: [...fresh, ...state.pending] }, scrollTop };
  }
  const inserted = [...fresh, ...state.pending];
  return {
    state: { rows: [...inserted, ...state.rows], pending: [], unseenAbove: state.unseenAbove + inserted.length },
    scrollTop: scrollTop + inserted.length * rowHeight,
  };
}

/** Action explicite du lecteur : insère les lignes retenues en tête et revient en haut. */
export function revealNewRows<T extends { readonly id: string }>(state: FeedState<T>): FeedUpdate<T> {
  return { state: { rows: [...state.pending, ...state.rows], pending: [], unseenAbove: 0 }, scrollTop: 0 };
}

/** Retour manuel tout en haut : les lignes déjà insérées sont vues, l'indicateur se résorbe. */
export function noteScroll<T extends { readonly id: string }>(state: FeedState<T>, scrollTop: number): FeedState<T> {
  if (scrollTop <= 0 && state.unseenAbove > 0) return { ...state, unseenAbove: 0 };
  return state;
}

export interface NavigationInput {
  readonly rowCount: number;
  readonly pageRows: number;
}

/** Touches de navigation de grille (Doc_08 Section 10) : flèches ou J/K, Home/End, PageUp/PageDown. */
export function nextActiveIndex(key: string, active: number, input: NavigationInput): number | null {
  const { rowCount, pageRows } = input;
  if (rowCount <= 0) return null;
  const last = rowCount - 1;
  const clamp = (value: number): number => Math.min(last, Math.max(0, value));
  switch (key) {
    case 'ArrowDown':
    case 'j':
    case 'J':
      return clamp(active + 1);
    case 'ArrowUp':
    case 'k':
    case 'K':
      return clamp(active - 1);
    case 'Home':
      return 0;
    case 'End':
      return last;
    case 'PageDown':
      return clamp(active + Math.max(1, pageRows));
    case 'PageUp':
      return clamp(active - Math.max(1, pageRows));
    default:
      return null;
  }
}

export interface RevealInput {
  readonly index: number;
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly rowHeight: number;
}

/** Plus petit défilement qui rend la ligne entièrement visible ; inchangé si elle l'est déjà. */
export function scrollTopToReveal(input: RevealInput): number {
  const top = input.index * input.rowHeight;
  const bottom = top + input.rowHeight;
  if (top < input.scrollTop) return top;
  if (bottom > input.scrollTop + input.viewportHeight) return bottom - input.viewportHeight;
  return input.scrollTop;
}
