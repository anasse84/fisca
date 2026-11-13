// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@fisca/i18n';
import { FISCA_LOCALES } from '@fisca/i18n';
import { FiscaAiCrafterCard, FiscaCommandPalette, FiscaReviewDrawer, resolveAiCrafterCardLabels, resolveCommandReviewLabels, translateStrict } from './command-review.tsx';
import type { TranslateStrict } from './command-review.tsx';

afterEach(cleanup);

const commands = [{ id: 'new', label: 'Créer une facture', group: 'Actions' }];

const openPalette = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
  });

describe('resolveCommandReviewLabels', () => {
  it('reprend les libellés existants de @fisca/i18n', () => {
    const fr = resolveCommandReviewLabels('fr');
    expect(fr.palette.close).toBe(translate('fr', 'common', 'actions.close'));
    expect(fr.palette.input).toBe(translate('fr', 'common', 'actions.search'));
    expect(fr.palette.placeholder).toBe(translate('fr', 'common', 'ui.palette.placeholder'));
    expect(fr.palette.empty).toBe(translate('fr', 'common', 'states.empty'));
    expect(fr.drawer.close).toBe(translate('fr', 'common', 'actions.close'));
    const ar = resolveCommandReviewLabels('ar');
    expect(ar.palette.close).toBe(translate('ar', 'common', 'actions.close'));
    expect(ar.palette.close).not.toBe(fr.palette.close);
  });

  it('aucun libellé vide, aucune clé brute affichée, décompte substitué', () => {
    for (const locale of ['fr', 'ar', 'en'] as const) {
      const { palette, drawer } = resolveCommandReviewLabels(locale);
      for (const text of [...Object.values(drawer), palette.dialog, palette.input, palette.placeholder, palette.empty, palette.close, palette.results(3)]) {
        expect(text.trim()).not.toBe('');
        expect(text).not.toMatch(/^[a-zA-Z_]+(\.[a-zA-Z_]+)+$/);
      }
      expect(palette.results(3)).toContain('3');
    }
  });

  it('jamais « conforme », « homologué » ni « certifié » dans les libellés', () => {
    const all = (['fr', 'ar', 'en'] as const).flatMap((locale) => {
      const { palette, drawer } = resolveCommandReviewLabels(locale);
      return [...Object.values(drawer), palette.dialog, palette.placeholder, palette.empty, palette.results(2)];
    });
    expect(all.join(' ')).not.toMatch(/conforme|homologu|certifi|compliant|certified|approved by/i);
  });
});

describe('clés manquantes : aucun repli en français', () => {
  const missingEverything: TranslateStrict = (locale, _namespace, key) => {
    throw new Error(`I18N_KEY_MISSING: ${locale}/${key}`);
  };
  const missingOne = (absent: string): TranslateStrict => (locale, namespace, key) => {
    if (key === absent) {
      throw new Error(`I18N_KEY_MISSING: ${locale}/${namespace}/${key}`);
    }
    return `${locale}:${key}`;
  };

  it('une clé absente fait échouer la résolution (palette et tiroir)', () => {
    expect(() => resolveCommandReviewLabels('ar', missingEverything)).toThrow(/I18N_KEY_MISSING/);
    for (const key of ['ui.palette.title', 'ui.palette.placeholder', 'ui.palette.results', 'ui.review.approve', 'ui.review.illegibleAmountNotice', 'ui.ai.confidence', 'actions.close']) {
      expect(() => resolveCommandReviewLabels('zgh-Tfng', missingOne(key)), key).toThrow(/I18N_KEY_MISSING/);
    }
  });

  it('une clé absente fait échouer la résolution des cartes IA', () => {
    for (const key of ['ui.review.aiBadge', 'ui.review.reviewBadge', 'ui.review.approve', 'ui.review.reject', 'ui.ai.validatedByHuman', 'ui.ai.rejectedByHuman', 'ui.ai.illegibleAmountGroup', 'ui.ai.illegibleAmountText', 'ui.ai.confidence']) {
      expect(() => resolveAiCrafterCardLabels('en', missingOne(key)), key).toThrow(/I18N_KEY_MISSING/);
    }
  });

  it('translateStrict : clé inconnue = erreur, jamais la clé brute ni un repli', () => {
    expect(() => translateStrict('fr', 'common', 'ui.palette.inconnue')).toThrow(/I18N_KEY_MISSING/);
    expect(() => translateStrict('ary', 'common', 'ui.inconnue')).toThrow(/I18N_KEY_MISSING/);
    expect(translateStrict('fr', 'common', 'ui.review.reject')).toBe('Rejeter');
    expect(translateStrict('ar', 'common', 'ui.review.reject')).toBe(translate('ar', 'common', 'ui.review.reject'));
  });

  it('les 6 langues résolvent tous les libellés avec la résolution réelle, sans chaîne vide', () => {
    for (const locale of FISCA_LOCALES) {
      const { palette, drawer } = resolveCommandReviewLabels(locale);
      const card = resolveAiCrafterCardLabels(locale);
      for (const text of [...Object.values(drawer), ...Object.values(card.amount), palette.dialog, palette.input, palette.placeholder, palette.empty, palette.close, palette.results(4), card.aiBadge, card.reviewBadge, card.validate, card.reject, card.validatedByHuman, card.rejectedByHuman, card.confidence.meter]) {
        expect(text.trim(), locale).not.toBe('');
        expect(text, locale).not.toMatch(/^[a-zA-Z_]+(\.[a-zA-Z_]+)+$/);
      }
      expect(palette.results(4)).toContain('4');
      expect(palette.results(4)).not.toContain('{count}');
    }
    expect(resolveCommandReviewLabels('zgh-Tfng').drawer.approve).toMatch(/\p{Script=Tfng}/u);
    expect(resolveCommandReviewLabels('ary').drawer.approve).not.toBe(resolveCommandReviewLabels('fr').drawer.approve);
  });
});

describe('FiscaAiCrafterCard', () => {
  it('prend ses libellés de @fisca/i18n : arabe en arabe, validation humaine explicite', () => {
    const onValidate = vi.fn();
    render(<FiscaAiCrafterCard locale="ar" id="d1" title="ف" summary="s" amountCents={1000} confidenceBps={8000} onValidate={onValidate} onReject={() => undefined} />);
    const labels = resolveAiCrafterCardLabels('ar');
    expect(screen.getByText(labels.reviewBadge)).toBeTruthy();
    expect(onValidate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: labels.validate }));
    expect(onValidate).toHaveBeenCalledExactlyOnceWith('d1');
    expect(document.body.textContent ?? '').not.toMatch(/Point à examiner|Valider/);
  });

  it('montant illisible : champ vide et libellé traduit', () => {
    render(<FiscaAiCrafterCard locale="en" id="d2" title="t" summary="s" amountCents={null} confidenceBps={1000} onValidate={() => undefined} onReject={() => undefined} />);
    expect(screen.getByRole('group', { name: resolveAiCrafterCardLabels('en').amount.illegibleGroup }).textContent).toBe(resolveAiCrafterCardLabels('en').amount.illegibleText);
  });
});

describe('FiscaCommandPalette', () => {
  it('s’ouvre en Ctrl+K avec les libellés de la langue, dir=rtl pour l’arabe', () => {
    render(<FiscaCommandPalette locale="ar" commands={commands} onSelect={() => undefined} />);
    openPalette();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('dir')).toBe('rtl');
    expect(dialog.getAttribute('aria-label')).toBe(resolveCommandReviewLabels('ar').palette.dialog);
    expect(screen.getByRole('button', { name: translate('ar', 'common', 'actions.close') })).toBeTruthy();
  });

  it('dir=ltr en français et sélection d’une commande', () => {
    const onSelect = vi.fn();
    render(<FiscaCommandPalette locale="fr" commands={commands} onSelect={onSelect} />);
    openPalette();
    expect(screen.getByRole('dialog').getAttribute('dir')).toBe('ltr');
    fireEvent.click(screen.getByRole('option', { name: /Créer une facture/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('FiscaReviewDrawer', () => {
  it('compose le tiroir avec les libellés i18n, validation humaine explicite seulement', () => {
    const onApprove = vi.fn();
    render(
      <FiscaReviewDrawer
        locale="fr"
        open
        onClose={() => undefined}
        title="Facture F-1"
        source={<p>scan</p>}
        entry={<p>écriture</p>}
        aiProposal={{ id: 'p1', confidenceBps: 9000 }}
        onApprove={onApprove}
      />,
    );
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByText(resolveCommandReviewLabels('fr').drawer.reviewBadge)).toBeTruthy();
    expect(screen.getByText('Point à examiner')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: resolveCommandReviewLabels('fr').drawer.approve }));
    expect(onApprove).toHaveBeenCalledExactlyOnceWith('p1');
  });

  it('dir=rtl en arabe', () => {
    render(
      <FiscaReviewDrawer locale="ar" open onClose={() => undefined} title="ف-1" source={<p>a</p>} entry={<p>b</p>} />,
    );
    expect(screen.getByRole('dialog').getAttribute('dir')).toBe('rtl');
  });
});
