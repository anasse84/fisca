// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SplitScreenReviewDrawer } from '../src/SplitScreenReviewDrawer.tsx';
import type { SplitScreenReviewDrawerProps } from '../src/SplitScreenReviewDrawer.tsx';
import { lintLogicalCss } from '../src/logical-css-lint.ts';

afterEach(cleanup);

const labels = {
  drawer: 'Révision de la pièce',
  sourcePane: 'Document source',
  entryPane: 'Saisie',
  close: 'Fermer',
  aiBadge: 'IA',
  reviewBadge: 'Point à examiner',
  approve: 'Valider (approbation humaine)',
  reject: 'Rejeter',
  humanApprovalNotice: 'Aucune écriture n’est comptabilisée sans votre validation.',
  illegibleAmountNotice: 'Montant illisible : saisie humaine requise.',
  confidence: 'Confiance de l’IA',
};

function Harness(props: Partial<SplitScreenReviewDrawerProps> & { readonly initiallyOpen?: boolean }) {
  const { initiallyOpen = false, ...rest } = props;
  return (
    <div>
      <button type="button" data-testid="row" onClick={() => undefined}>
        Ligne 1
      </button>
      <SplitScreenReviewDrawer
        open={initiallyOpen}
        onClose={() => undefined}
        title="Facture F-2026-001"
        labels={labels}
        source={<img alt="Scan de la facture" src="data:," />}
        entry={<input aria-label="Compte PCGE" />}
        {...rest}
      />
    </div>
  );
}

describe('SplitScreenReviewDrawer : structure', () => {
  it('ne rend rien tant qu’il est fermé', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('rend un dialog non modal avec deux volets nommés : document source puis saisie', () => {
    render(<Harness initiallyOpen />);
    const drawer = screen.getByRole('dialog', { name: 'Révision de la pièce' });
    expect(drawer.getAttribute('aria-modal')).toBe('false');
    const regions = screen.getAllByRole('region');
    expect(regions.map((r) => r.getAttribute('aria-label'))).toEqual(['Document source', 'Saisie']);
    expect(regions[0]?.querySelector('img')).not.toBeNull();
    expect(regions[1]?.querySelector('input')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Facture F-2026-001' })).toBeTruthy();
  });

  it('ne bloque pas la liste : pas de fond, pas d’aria-hidden ni inert sur le reste, la liste reste cliquable', () => {
    const onRow = vi.fn();
    const { container } = render(
      <div>
        <button type="button" onClick={onRow}>
          Ligne 2
        </button>
        <SplitScreenReviewDrawer open onClose={() => undefined} title="T" labels={labels} source={<p>s</p>} entry={<p>e</p>} />
      </div>,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(container.querySelector('[inert]')).toBeNull();
    expect(screen.queryByTestId('command-palette-backdrop')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ligne 2' }));
    expect(onRow).toHaveBeenCalledTimes(1);
  });
});

describe('SplitScreenReviewDrawer : focus et fermeture', () => {
  it('prend le focus à l’ouverture et le restitue à l’élément précédent à la fermeture', () => {
    const { rerender } = render(<Harness />);
    const row = screen.getByTestId('row');
    row.focus();
    rerender(<Harness initiallyOpen />);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    rerender(<Harness />);
    expect(document.activeElement).toBe(row);
  });

  it('Échap ferme (onClose) ; le bouton Fermer aussi', () => {
    const onClose = vi.fn();
    render(<Harness initiallyOpen onClose={onClose} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Échap déjà consommé (palette au-dessus) ne ferme pas le tiroir', () => {
    const onClose = vi.fn();
    render(<Harness initiallyOpen onClose={onClose} />);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('SplitScreenReviewDrawer : garde-fous IA (Doc_08 Section 05)', () => {
  const proposal = { id: 'p1', confidenceBps: 8700 };

  it('sans proposition IA : aucun bouton d’approbation', () => {
    render(<Harness initiallyOpen />);
    expect(screen.queryByRole('button', { name: /Valider/ })).toBeNull();
  });

  it('proposition IA : badges IA et « Point à examiner », jamais « Anomalie confirmée », confiance affichée, rappel d’approbation humaine', () => {
    render(<Harness initiallyOpen aiProposal={proposal} onApprove={() => undefined} onReject={() => undefined} />);
    expect(screen.getByText('IA')).toBeTruthy();
    expect(screen.getByText('Point à examiner')).toBeTruthy();
    expect(screen.queryByText(/Anomalie confirmée/)).toBeNull();
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('87');
    expect(screen.getByRole('meter').getAttribute('aria-label')).toBe(labels.confidence);
    expect(screen.getByText(labels.humanApprovalNotice)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Valider (approbation humaine)' })).toBeTruthy();
  });

  it('aucun auto-posting : onApprove n’est jamais appelé au rendu, à l’ouverture, ni à la fermeture', () => {
    const onApprove = vi.fn();
    const { rerender } = render(<Harness aiProposal={proposal} onApprove={onApprove} />);
    rerender(<Harness initiallyOpen aiProposal={proposal} onApprove={onApprove} />);
    rerender(<Harness initiallyOpen aiProposal={{ id: 'p1', confidenceBps: 10000 }} onApprove={onApprove} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    rerender(<Harness aiProposal={proposal} onApprove={onApprove} />);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('seul un clic explicite valide, avec l’identifiant de la proposition ; Rejeter appelle onReject', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<Harness initiallyOpen aiProposal={proposal} onApprove={onApprove} onReject={onReject} />);
    fireEvent.click(screen.getByRole('button', { name: 'Valider (approbation humaine)' }));
    expect(onApprove).toHaveBeenCalledExactlyOnceWith('p1');
    fireEvent.click(screen.getByRole('button', { name: 'Rejeter' }));
    expect(onReject).toHaveBeenCalledExactlyOnceWith('p1');
  });

  it('Mod+Entrée (geste humain, Section 10) valide ; Entrée seule ne valide jamais', () => {
    const onApprove = vi.fn();
    render(<Harness initiallyOpen aiProposal={proposal} onApprove={onApprove} />);
    const drawer = screen.getByRole('dialog');
    fireEvent.keyDown(drawer, { key: 'Enter' });
    expect(onApprove).not.toHaveBeenCalled();
    fireEvent.keyDown(drawer, { key: 'Enter', ctrlKey: true });
    expect(onApprove).toHaveBeenCalledExactlyOnceWith('p1');
  });

  it('montant illisible : validation désactivée (bouton et raccourci), message affiché', () => {
    const onApprove = vi.fn();
    render(<Harness initiallyOpen aiProposal={{ ...proposal, hasIllegibleAmount: true }} onApprove={onApprove} />);
    const button = screen.getByRole('button', { name: 'Valider (approbation humaine)' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', metaKey: true });
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByText(labels.illegibleAmountNotice)).toBeTruthy();
  });

  it('refuse une confiance invalide (hors 0..10000) comme les cartes IA existantes', () => {
    expect(() => render(<Harness initiallyOpen aiProposal={{ id: 'x', confidenceBps: -1 }} />)).toThrow(/UI_CONFIDENCE_INVALID/);
  });
});

describe('SplitScreenReviewDrawer : CSS logique et responsive', () => {
  const css = readFileSync(join(import.meta.dirname, '../src/review-drawer.css'), 'utf8');

  it('passe lintLogicalCss, côté inline-end', () => {
    expect(lintLogicalCss(css)).toEqual([]);
    expect(css).toMatch(/inset-inline-end:\s*0/);
  });

  it('mobile 375 px : l’en-tête passe à la ligne et le titre peut rétrécir (aucun débordement horizontal)', () => {
    const header = /\.fisca-drawer__header\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(header).toMatch(/flex-wrap:\s*wrap/);
    const title = /\.fisca-drawer__title\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(title).toMatch(/min-inline-size:\s*0/);
    expect(title).toMatch(/overflow-wrap:\s*anywhere/);
    const close = /\.fisca-drawer__close\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(close).toMatch(/flex-shrink:\s*0/);
  });

  it('55 % dès 1280 px, deux volets dès 768 px, plein écran en mobile', () => {
    expect(css).toMatch(/@media \(min-width: 1280px\)[\s\S]*55%/);
    expect(css).toMatch(/@media \(min-width: 768px\)[\s\S]*grid-template-columns/);
  });
});
