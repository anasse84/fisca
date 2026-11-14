import { describe, expect, it } from 'vitest';
import { FISCA_LOCALES, directionOf, flattenKeys, getDictionary } from '@fisca/i18n';
import { POS_LABEL_KEYS, resolvePosLabels, resolveReceiptLabels, translateStrict } from '../src/ui/labels.ts';

describe('libellés ui.pos.* : résolveur strict, 6 langues', () => {
  it('chaque clé consommée existe dans le dictionnaire propre de chaque langue (aucun repli)', () => {
    for (const locale of FISCA_LOCALES) {
      const own = new Map(flattenKeys(getDictionary(locale, 'common')));
      for (const key of POS_LABEL_KEYS) expect(own.get(`ui.pos.${key}`)?.trim().length ?? 0, `${locale}/${key}`).toBeGreaterThan(0);
    }
  });

  it('toutes les clés ui.pos.* du dictionnaire sont consommées par l’interface (aucune clé orpheline)', () => {
    const own = [...new Map(flattenKeys(getDictionary('fr', 'common'))).keys()].filter((k) => k.startsWith('ui.pos.')).map((k) => k.slice('ui.pos.'.length));
    expect([...own].sort()).toEqual([...POS_LABEL_KEYS].sort());
  });

  it('translateStrict lève I18N_KEY_MISSING au lieu de renvoyer la clé', () => {
    expect(() => translateStrict('fr', 'common', 'ui.pos.nexiste.pas')).toThrowError(/I18N_KEY_MISSING/);
  });

  it('resolvePosLabels : les gabarits à placeholders sont des fonctions', () => {
    for (const locale of FISCA_LOCALES) {
      const labels = resolvePosLabels(locale);
      expect(labels.sale.addItem('Pain')).toContain('Pain');
      expect(labels.net.pending(3)).toContain('3');
      expect(labels.net.remaining(71, 5)).toContain('71');
      expect(labels.net.remaining(71, 5)).toContain('5');
      expect(labels.sale.itemCount(2)).toContain('2');
      expect(labels.sale.vatRate('20')).toContain('20');
    }
  });

  it('direction : RTL pour ar et ary seulement', () => {
    expect(FISCA_LOCALES.filter((l) => directionOf(l) === 'rtl')).toEqual(['ar', 'ary']);
  });

  it('le libellé de l’état cleared reste « Validation simulée » (fr), jamais « conforme » ni « certifié »', () => {
    expect(translateStrict('fr', 'common', 'states.cleared')).toBe('Validation simulée');
  });

  it('ticket imprimé : jeu français et jeu arabe', () => {
    const { primary, secondary } = resolveReceiptLabels();
    expect(primary.title).toBe(translateStrict('fr', 'common', 'ui.pos.receipt.title'));
    expect(secondary.title).toBe(translateStrict('ar', 'common', 'ui.pos.receipt.title'));
    expect(primary.vat('20')).toContain('20');
  });
});
