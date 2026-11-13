import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { DEFAULT_RESULT_LIMIT, groupHits, prepareCommands, searchCommands } from './command-search.ts';
import type { PaletteCommand } from './command-search.ts';
import './command-palette.css';

export interface CommandPaletteLabels {
  /** Nom accessible du dialog. */
  readonly dialog: string;
  /** Nom accessible du champ de recherche. */
  readonly input: string;
  readonly placeholder: string;
  readonly empty: string;
  /** Annonce vocale du nombre de résultats. */
  readonly results: (count: number) => string;
  readonly close: string;
}

export interface CommandPaletteProps {
  readonly commands: readonly PaletteCommand[];
  readonly labels: CommandPaletteLabels;
  readonly onSelect: (command: PaletteCommand) => void;
  /** Mode contrôlé ; absent : la palette gère son ouverture. */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly dir?: 'ltr' | 'rtl';
  readonly resultLimit?: number;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isPaletteShortcut(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
}

/**
 * Palette de commande universelle (Cmd/Ctrl+K). Recherche floue locale sur les commandes reçues en props,
 * dialog modal avec focus piégé puis restitué, motif ARIA combobox + listbox.
 */
export function CommandPalette({
  commands,
  labels,
  onSelect,
  open,
  onOpenChange,
  dir,
  resultLimit = DEFAULT_RESULT_LIMIT,
}: CommandPaletteProps): ReactElement | null {
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = open ?? innerOpen;
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const uid = useId();
  const listId = `${uid}-list`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) {
        setInnerOpen(next);
      }
      onOpenChange?.(next);
    },
    [open, onOpenChange],
  );

  const index = useMemo(() => prepareCommands(commands), [commands]);
  const groups = useMemo(() => groupHits(searchCommands(index, query, resultLimit)), [index, query, resultLimit]);
  const flat = useMemo(() => groups.flatMap((group) => group.hits), [groups]);
  const active = flat.length === 0 ? -1 : Math.min(activeIndex, flat.length - 1);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isPaletteShortcut(event)) {
        event.preventDefault();
        setOpen(!isOpenRef.current);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const previous = document.activeElement;
    returnFocusRef.current = previous instanceof HTMLElement ? previous : null;
    setQuery('');
    setActiveIndex(0);
    inputRef.current?.focus();
    return () => {
      const target = returnFocusRef.current;
      if (target !== null && target.isConnected) {
        target.focus();
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const onFocusIn = (event: FocusEvent): void => {
      const dialog = dialogRef.current;
      if (dialog !== null && event.target instanceof Node && !dialog.contains(event.target)) {
        inputRef.current?.focus();
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [isOpen]);

  const activeId = active === -1 ? undefined : `${uid}-opt-${active}`;
  useEffect(() => {
    if (activeId === undefined) {
      return;
    }
    const element = document.getElementById(activeId);
    if (element !== null && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest' });
    }
  }, [activeId]);

  if (!isOpen) {
    return null;
  }

  const choose = (command: PaletteCommand): void => {
    setOpen(false);
    onSelect(command);
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length > 0) {
        const step = event.key === 'ArrowDown' ? 1 : flat.length - 1;
        setActiveIndex((active + step) % flat.length);
      }
    } else if (event.key === 'Enter') {
      if (event.nativeEvent.isComposing) {
        return;
      }
      event.preventDefault();
      const hit = flat[active];
      if (hit !== undefined) {
        choose(hit.command);
      }
    }
  };

  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      const focusables = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  let position = -1;
  const renderOption = (hit: (typeof flat)[number]): ReactElement => {
    position += 1;
    const current = position;
    return (
      <div
        key={hit.command.id}
        id={`${uid}-opt-${current}`}
        role="option"
        aria-selected={current === active}
        className="fisca-palette__option"
        onClick={() => choose(hit.command)}
        onMouseMove={() => {
          if (current !== active) {
            setActiveIndex(current);
          }
        }}
      >
        <span>{hit.command.label}</span>
        {hit.command.shortcut === undefined ? null : (
          <span dir="ltr" className="fisca-palette__shortcut">
            {hit.command.shortcut}
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      data-testid="command-palette-backdrop"
      className="fisca-palette__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setOpen(false);
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={labels.dialog}
        dir={dir}
        className="fisca-palette"
        onKeyDown={onDialogKeyDown}
      >
        <div className="fisca-palette__bar">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={labels.input}
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder={labels.placeholder}
            value={query}
            className="fisca-palette__input"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
          />
          <button type="button" className="fisca-palette__close" onClick={() => setOpen(false)}>
            {labels.close}
          </button>
        </div>
        <div id={listId} role="listbox" aria-label={labels.dialog} className="fisca-palette__list">
          {groups.map((group, groupIndex) =>
            group.group === '' ? (
              group.hits.map(renderOption)
            ) : (
              <div key={group.group} role="group" aria-labelledby={`${uid}-grp-${groupIndex}`}>
                <div id={`${uid}-grp-${groupIndex}`} className="fisca-palette__heading">
                  {group.group}
                </div>
                {group.hits.map(renderOption)}
              </div>
            ),
          )}
        </div>
        {flat.length === 0 ? <div className="fisca-palette__empty">{labels.empty}</div> : null}
        <div role="status" className="fisca-palette__status">
          {labels.results(flat.length)}
        </div>
      </div>
    </div>
  );
}
