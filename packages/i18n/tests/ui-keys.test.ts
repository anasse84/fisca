import { describe, expect, it } from 'vitest';
import { FISCA_LOCALES, flattenKeys, getDictionary } from '../src/index.ts';
import type { FiscaLocale } from '../src/index.ts';

/** Clés consommées par la palette Cmd+K, le tiroir Split-Screen et les cartes AI Crafters (Doc_08 Section 05). */
const UI_KEYS = [
  'ui.palette.title',
  'ui.palette.placeholder',
  'ui.palette.results',
  'ui.review.title',
  'ui.review.sourcePane',
  'ui.review.entryPane',
  'ui.review.aiBadge',
  'ui.review.reviewBadge',
  'ui.review.approve',
  'ui.review.reject',
  'ui.review.humanApprovalNotice',
  'ui.review.illegibleAmountNotice',
  'ui.ai.confidence',
  'ui.ai.illegibleAmountGroup',
  'ui.ai.illegibleAmountText',
  'ui.ai.validatedByHuman',
  'ui.ai.rejectedByHuman',
] as const;

function own(locale: FiscaLocale): Map<string, string> {
  return new Map(flattenKeys(getDictionary(locale, 'common')));
}

describe('clés ui.* de l’espace common', () => {
  for (const locale of FISCA_LOCALES) {
    it(`${locale} définit chaque clé dans son propre dictionnaire (pas par repli)`, () => {
      const entries = own(locale);
      for (const key of UI_KEYS) {
        expect(entries.get(key)?.trim().length ?? 0, `${locale}/${key}`).toBeGreaterThan(0);
      }
    });

    it(`${locale} : ui.palette.results porte {count}`, () => {
      expect(own(locale).get('ui.palette.results')).toContain('{count}');
    });
  }

  it('les traductions sont réelles : le texte des langues non françaises diffère du français', () => {
    const fr = own('fr');
    for (const locale of FISCA_LOCALES.filter((l) => l !== 'fr')) {
      const entries = own(locale);
      for (const key of UI_KEYS) {
        expect(entries.get(key), `${locale}/${key}`).not.toBe(fr.get(key));
      }
    }
  });

  it('arabe et darija en script arabe, tifinagh en Tifinagh sans lettre latine', () => {
    for (const locale of ['ar', 'ary'] as const) {
      for (const key of UI_KEYS) {
        expect(own(locale).get(key), `${locale}/${key}`).toMatch(/\p{Script=Arabic}/u);
      }
    }
    for (const key of UI_KEYS) {
      const value = own('zgh-Tfng').get(key) ?? '';
      expect(value, key).toMatch(/\p{Script=Tfng}/u);
      expect(value.replace('{count}', ''), key).not.toMatch(/\p{Script=Latin}/u);
    }
  });

  it('jamais d’affirmation de conformité, d’homologation ni de certification', () => {
    const banned = /conforme|conformité|homologu|certifi|معتمد|مصادق|مطابق|certified|approved by|compliant|homologated/iu;
    for (const locale of FISCA_LOCALES) {
      for (const key of UI_KEYS) {
        expect(own(locale).get(key) ?? '', `${locale}/${key}`).not.toMatch(banned);
      }
    }
  });

  it('le bouton de validation rappelle l’approbation humaine et « Point à examiner » reste le badge IA', () => {
    expect(own('fr').get('ui.review.approve')).toBe('Valider (approbation humaine)');
    expect(own('fr').get('ui.review.reviewBadge')).toBe('Point à examiner');
    expect(own('fr').get('ui.review.aiBadge')).toBe('IA');
  });
});
