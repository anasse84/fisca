import { columnSizingFeature, tableFeatures, useTable } from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode } from 'react';
import { FiscalAmount } from './FiscalPrimitives.tsx';
import {
  ROW_HEIGHT_PX,
  computeWindow,
  createFeed,
  newRowCount,
  nextActiveIndex,
  noteScroll,
  receiveRows,
  revealNewRows,
  scrollTopToReveal,
  windowIndexes,
} from './grid-core.ts';
import type { FeedState, GridDensity } from './grid-core.ts';
import './grid.css';

const gridFeatures = tableFeatures({ columnSizingFeature });

export interface GridRowBase {
  /** Identifiant stable de ligne (clé de rendu, ancrage, dédoublonnage SSE). */
  readonly id: string;
}

export type MercuryGridColumn<TRow extends GridRowBase> = ColumnDef<typeof gridFeatures, TRow>;

export interface MercuryGridLabels {
  readonly ariaLabel: string;
  /** Libellé de l'indicateur de lignes arrivées en flux (ex. « 5 nouvelles lignes »). */
  readonly newRows: (count: number) => string;
  /** Libellé accessible d'une ligne squelette en cours de chargement. */
  readonly loadingRow: string;
}

export type RowListener<TRow extends GridRowBase> = (rows: readonly TRow[]) => void;

export interface MercuryGridProps<TRow extends GridRowBase> {
  readonly columns: readonly MercuryGridColumn<TRow>[];
  /** Lignes initiales, plus récentes en tête. Un nouveau tableau réinitialise la grille. */
  readonly rows: readonly TRow[];
  readonly density: GridDensity;
  readonly labels: MercuryGridLabels;
  /** Abonnement au flux SSE ; retourne la fonction de désabonnement. Les lots arrivent plus récent en tête. */
  readonly subscribe?: (listener: RowListener<TRow>) => () => void;
  /** Total attendu : réserve la hauteur et comble par des squelettes de largeur fixe. */
  readonly expectedRowCount?: number;
  readonly overscan?: number;
  /** Hauteur de viewport connue avant mesure (rendu serveur, tests). */
  readonly initialViewportHeight?: number;
  readonly onRowActivate?: (row: TRow) => void;
}

interface TextColumnOptions<TRow extends GridRowBase> {
  readonly id: string;
  readonly header: string;
  readonly getText: (row: TRow) => string;
  readonly size: number;
}

export function textColumn<TRow extends GridRowBase>(options: TextColumnOptions<TRow>): MercuryGridColumn<TRow> {
  return {
    id: options.id,
    header: options.header,
    size: options.size,
    accessorFn: (row: TRow) => options.getText(row),
    cell: (context): ReactNode => options.getText(context.row.original),
  };
}

interface AmountColumnOptions<TRow extends GridRowBase> {
  readonly id: string;
  readonly header: string;
  /** Centimes entiers (nombre sûr ou bigint) : jamais de flottant. */
  readonly getCents: (row: TRow) => number | bigint;
  readonly size: number;
}

/** Colonne montant : la cellule est un `FiscalAmount` (dir=ltr, chiffres tabulaires, centimes entiers). */
export function amountCentsColumn<TRow extends GridRowBase>(options: AmountColumnOptions<TRow>): MercuryGridColumn<TRow> {
  return {
    id: options.id,
    header: (): ReactNode => <span className="fisca-grid__head-cell--end">{options.header}</span>,
    size: options.size,
    accessorFn: (row: TRow) => String(options.getCents(row)),
    cell: (context): ReactNode => <FiscalAmount amountCents={options.getCents(context.row.original)} />,
  };
}

const SKELETON_COLUMN_FALLBACK_PX = 120;

export function MercuryGrid<TRow extends GridRowBase>(props: MercuryGridProps<TRow>): ReactElement {
  const { columns, rows, density, labels, subscribe, expectedRowCount, onRowActivate } = props;
  const overscan = props.overscan ?? 6;
  const initialViewportHeight = props.initialViewportHeight ?? 0;
  const rowHeight = ROW_HEIGHT_PX[density];
  const headerHeight = rowHeight;

  const [feed, setFeed] = useState<FeedState<TRow>>(() => createFeed(rows));
  const [activeId, setActiveId] = useState<string | null>(null);
  const feedRef = useRef(feed);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRef = useRef<number | null>(null);
  const focusActiveRef = useRef(false);
  const rowHeightRef = useRef(rowHeight);
  const activeIndexRef = useRef<number | null>(null);
  const lastRowsRef = useRef(rows);
  rowHeightRef.current = rowHeight;

  const commit = useCallback((next: FeedState<TRow>, scrollTop: number | null) => {
    feedRef.current = next;
    if (scrollTop !== null) pendingScrollRef.current = scrollTop;
    setFeed(next);
  }, []);

  useEffect(() => {
    if (lastRowsRef.current === rows) return;
    lastRowsRef.current = rows;
    commit(createFeed(rows), null);
  }, [rows, commit]);

  useEffect(() => {
    if (subscribe === undefined) return undefined;
    return subscribe((incoming) => {
      const scroller = scrollerRef.current;
      const scrollTop = pendingScrollRef.current ?? scroller?.scrollTop ?? 0;
      const update = receiveRows(feedRef.current, incoming, scrollTop, rowHeightRef.current);
      if (update.state === feedRef.current) return;
      commit(update.state, update.scrollTop !== scrollTop ? update.scrollTop : null);
    });
  }, [subscribe, commit]);

  const data = feed.rows;
  const rowCount = Math.max(data.length, expectedRowCount ?? 0);

  const idToIndex = useMemo(() => {
    const map = new Map<string, number>();
    data.forEach((row, index) => map.set(row.id, index));
    return map;
  }, [data]);
  const activeIndex = data.length === 0 ? null : (activeId !== null ? idToIndex.get(activeId) : undefined) ?? 0;
  activeIndexRef.current = activeIndex;

  const table = useTable({
    features: gridFeatures,
    columns: columns as MercuryGridColumn<TRow>[],
    data: data as TRow[],
    getRowId: (row: TRow) => row.id,
  });
  const tableRows = table.getRowModel().rows;

  const getItemKey = useCallback((index: number) => feedRef.current.rows[index]?.id ?? `skeleton-${index}`, []);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => rowHeight,
    overscan,
    scrollMargin: headerHeight,
    getItemKey,
    initialRect: { width: 0, height: initialViewportHeight },
    rangeExtractor: (range) => windowIndexes(range, activeIndexRef.current),
  });

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const target = pendingScrollRef.current;
    if (scroller === null || target === null) return;
    pendingScrollRef.current = null;
    scroller.scrollTop = target;
    scroller.dispatchEvent(new Event('scroll'));
  }, [feed]);

  useLayoutEffect(() => {
    if (!focusActiveRef.current || activeId === null) return;
    focusActiveRef.current = false;
    for (const element of scrollerRef.current?.querySelectorAll<HTMLElement>('[data-row-id]') ?? []) {
      if (element.dataset['rowId'] === activeId) {
        element.focus({ preventScroll: true });
        return;
      }
    }
  });

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const next = noteScroll(feedRef.current, scroller.scrollTop);
    if (next !== feedRef.current) commit(next, null);
  }, [commit]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const scroller = scrollerRef.current;
    if (scroller === null || data.length === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const current = activeIndex ?? 0;
    if (event.key === 'Enter') {
      const row = data[current];
      if (row !== undefined && onRowActivate !== undefined) {
        event.preventDefault();
        onRowActivate(row);
      }
      return;
    }
    const viewportHeight = Math.max(rowHeight, (scroller.clientHeight > 0 ? scroller.clientHeight : initialViewportHeight) - headerHeight);
    const pageRows = computeWindow({ scrollTop: 0, viewportHeight, rowHeight, rowCount: data.length, overscan: 0 }).lastVisible + 1;
    const next = nextActiveIndex(event.key, current, { rowCount: data.length, pageRows });
    if (next === null) return;
    event.preventDefault();
    const row = data[next];
    if (row === undefined) return;
    const target = scrollTopToReveal({ index: next, scrollTop: scroller.scrollTop, viewportHeight, rowHeight });
    if (target !== scroller.scrollTop) {
      scroller.scrollTop = target;
      scroller.dispatchEvent(new Event('scroll'));
    }
    focusActiveRef.current = true;
    setActiveId(row.id);
  };

  const sizes = table.getAllLeafColumns().map((column) => column.getSize());
  const columnTemplate = sizes.map((size) => `${size}px`).join(' ');
  const totalWidth = sizes.reduce((sum, size) => sum + size, 0);
  const rootStyle = {
    '--table-row-height': `${rowHeight}px`,
    '--fisca-grid-columns': columnTemplate,
    '--fisca-grid-width': `${totalWidth}px`,
  } as CSSProperties;
  const rowStyle = (start: number): CSSProperties => ({
    blockSize: `${rowHeight}px`,
    transform: `translateY(${start - headerHeight}px)`,
  });
  const pendingCount = newRowCount(feed);

  const onReveal = (): void => {
    const update = revealNewRows(feedRef.current);
    commit(update.state, update.scrollTop);
  };

  return (
    <div
      role="grid"
      className="fisca-grid"
      data-density={density}
      aria-label={labels.ariaLabel}
      aria-rowcount={rowCount + 1}
      aria-colcount={sizes.length}
      style={rootStyle}
    >
      <div className="fisca-grid__status" aria-live="polite">
        {pendingCount > 0 ? (
          <button type="button" className="fisca-grid__new-rows" onClick={onReveal}>
            {labels.newRows(pendingCount)}
          </button>
        ) : null}
      </div>
      <div
        ref={scrollerRef}
        className="fisca-grid__scroller"
        data-grid-scroller=""
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        style={{ blockSize: `${initialViewportHeight > 0 ? initialViewportHeight : 480}px` }}
      >
        {table.getHeaderGroups().map((group) => (
          <div key={group.id} role="row" aria-rowindex={1} className="fisca-grid__header" style={{ blockSize: `${headerHeight}px` }}>
            {group.headers.map((header, columnIndex) => (
              <div key={header.id} role="columnheader" aria-colindex={columnIndex + 1} className="fisca-grid__head-cell">
                {header.isPlaceholder ? null : <table.FlexRender header={header} />}
              </div>
            ))}
          </div>
        ))}
        <div role="rowgroup" className="fisca-grid__body" data-grid-body="" style={{ blockSize: `${rowCount * rowHeight}px` }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = tableRows[item.index];
            if (row === undefined) {
              return (
                <div
                  key={item.key}
                  role="row"
                  aria-rowindex={item.index + 2}
                  aria-busy="true"
                  aria-label={labels.loadingRow}
                  data-row-skeleton=""
                  className="fisca-grid__row"
                  style={rowStyle(item.start)}
                >
                  {sizes.map((size, columnIndex) => (
                    <div key={columnIndex} role="gridcell" aria-colindex={columnIndex + 1} aria-hidden="true" className="fisca-grid__cell">
                      <span className="fisca-grid__skeleton" style={{ inlineSize: `${Math.min(size, SKELETON_COLUMN_FALLBACK_PX)}px` }} />
                    </div>
                  ))}
                </div>
              );
            }
            const isActive = item.index === activeIndex;
            return (
              <div
                key={item.key}
                role="row"
                id={`${row.id}`}
                data-row-id={row.id}
                aria-rowindex={item.index + 2}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className="fisca-grid__row"
                style={rowStyle(item.start)}
                onFocus={() => setActiveId(row.id)}
                onClick={() => setActiveId(row.id)}
              >
                {row.getAllCells().map((cell, columnIndex) => (
                  <div key={cell.id} role="gridcell" aria-colindex={columnIndex + 1} className="fisca-grid__cell">
                    <table.FlexRender cell={cell} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
