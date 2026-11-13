// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../src/CommandPalette.tsx';
import type { CommandPaletteProps } from '../src/CommandPalette.tsx';
import { lintLogicalCss } from '../src/logical-css-lint.ts';

afterEach(cleanup);

const labels = {
  dialog: 'Palette de commande',
  input: 'Rechercher une commande',
  placeholder: 'Rechercher…',
  empty: 'Aucun résultat',
  results: (count: number) => `${count} résultats`,
  close: 'Fermer',
};

const commands = [
  { id: 'new-invoice', label: 'Créer une facture', group: 'Actions' },
  { id: 'export', label: 'Exporter un ZIP SIMPL-TVA', group: 'Actions' },
  { id: 'atlas', label: 'Société Atlas', group: 'Dossiers' },
];

function setup(props: Partial<CommandPaletteProps> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <div>
      <button type="button">Déclencheur</button>
      <CommandPalette commands={commands} labels={labels} onSelect={onSelect} {...props} />
    </div>,
  );
  return { onSelect, ...utils };
}

const openWithShortcut = (init: KeyboardEventInit = { key: 'k', ctrlKey: true }) => {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
};

describe('CommandPalette : ouverture', () => {
  it('est fermée par défaut', () => {
    setup();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('s’ouvre avec Ctrl+K et avec Cmd+K, et empêche l’action par défaut du navigateur', () => {
    setup();
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Palette de commande' })).toBeTruthy();
    cleanup();
    setup();
    openWithShortcut({ key: 'K', metaKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('ignore K seul et Ctrl+Maj+K', () => {
    setup();
    openWithShortcut({ key: 'k' });
    openWithShortcut({ key: 'k', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dialog modal accessible, champ combobox focalisé', () => {
    setup();
    openWithShortcut();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const input = screen.getByRole('combobox', { name: 'Rechercher une commande' });
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('mode contrôlé : open et onOpenChange', () => {
    const onOpenChange = vi.fn();
    setup({ open: false, onOpenChange });
    openWithShortcut();
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('CommandPalette : focus', () => {
  it('restitue le focus à l’élément déclencheur à la fermeture par Échap', () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Déclencheur' });
    trigger.focus();
    openWithShortcut();
    expect(document.activeElement).not.toBe(trigger);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('piège le focus : Tab et Maj+Tab bouclent dans le dialog', () => {
    setup();
    openWithShortcut();
    const input = screen.getByRole('combobox');
    const close = screen.getByRole('button', { name: 'Fermer' });
    input.focus();
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);
  });

  it('ramène dans le dialog un focus qui s’échappe', () => {
    setup();
    openWithShortcut();
    const trigger = screen.getByRole('button', { name: 'Déclencheur' });
    act(() => {
      trigger.focus();
    });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('le bouton Fermer et le clic sur le fond ferment', () => {
    setup();
    openWithShortcut();
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    openWithShortcut();
    fireEvent.mouseDown(screen.getByTestId('command-palette-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Échap appelle preventDefault pour ne pas fermer un tiroir situé dessous', () => {
    setup();
    openWithShortcut();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      screen.getByRole('combobox').dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('CommandPalette : recherche et navigation', () => {
  it('affiche les groupes et toutes les commandes pour une requête vide', () => {
    setup();
    openWithShortcut();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label') ?? g.getAttribute('aria-labelledby') !== null)).toHaveLength(2);
    expect(screen.getByText('Actions')).toBeTruthy();
    expect(screen.getByText('Dossiers')).toBeTruthy();
  });

  it('filtre de façon floue en tapant et annonce le décompte', () => {
    setup();
    openWithShortcut();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'atls' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Société Atlas']);
    expect(screen.getByRole('status').textContent).toBe('1 résultats');
  });

  it('affiche le message vide sans option', () => {
    setup();
    openWithShortcut();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzzqq' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Aucun résultat')).toBeTruthy();
  });

  it('flèches déplacent l’option active (aria-activedescendant) avec bouclage, Entrée sélectionne et ferme', () => {
    const { onSelect } = setup();
    openWithShortcut();
    const input = screen.getByRole('combobox');
    const options = () => screen.getAllByRole('option');
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(options()[1]?.getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[1]?.id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(options()[2]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: 'atlas' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Entrée sans résultat ne sélectionne rien', () => {
    const { onSelect } = setup();
    openWithShortcut();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'zzzzqq' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Entrée pendant une composition IME ne sélectionne pas', () => {
    const { onSelect } = setup();
    openWithShortcut();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', isComposing: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('clic sur une option la sélectionne', () => {
    const { onSelect } = setup();
    openWithShortcut();
    fireEvent.click(screen.getByRole('option', { name: /Exporter/ }));
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: 'export' });
  });

  it('réinitialise requête et sélection à la réouverture', () => {
    setup();
    openWithShortcut();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'atlas' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    openWithShortcut();
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('affiche le raccourci d’une commande en dir=ltr', () => {
    setup({ commands: [{ id: 'a', label: 'Aller au grand livre', shortcut: 'G L' }] });
    openWithShortcut();
    expect(screen.getByText('G L').getAttribute('dir')).toBe('ltr');
  });
});

describe('CommandPalette : RTL et performance', () => {
  it('applique dir sur le dialog et son CSS passe lintLogicalCss', () => {
    setup({ dir: 'rtl' });
    openWithShortcut();
    expect(screen.getByRole('dialog').getAttribute('dir')).toBe('rtl');
    const css = readFileSync(join(import.meta.dirname, '../src/command-palette.css'), 'utf8');
    expect(lintLogicalCss(css)).toEqual([]);
    expect(css).toMatch(/inset-inline-start|inline-size/);
  });

  it('5 000 commandes : le premier résultat s’affiche en moins de 150 ms après la frappe', () => {
    const big = Array.from({ length: 5000 }, (_, i) => ({ id: `c${i}`, label: `Dossier client ${i} SARL`, group: i % 2 === 0 ? 'Dossiers' : 'Actions' }));
    setup({ commands: big });
    openWithShortcut();
    const input = screen.getByRole('combobox');
    const t0 = performance.now();
    fireEvent.change(input, { target: { value: 'dcl 4999' } });
    const first = screen.getAllByRole('option')[0];
    const elapsed = performance.now() - t0;
    expect(first?.textContent).toContain('4999');
    expect(elapsed).toBeLessThan(150);
  });
});
