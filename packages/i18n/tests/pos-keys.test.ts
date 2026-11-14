import { describe, expect, it } from 'vitest';
import { FISCA_LOCALES, flattenKeys, getDictionary } from '../src/index.ts';
import type { FiscaLocale } from '../src/index.ts';

/** Clés ui.pos.* de la caisse tactile (T-P2B-11) : parité exacte des 6 langues, vraies traductions, placeholders alignés. */
function pos(locale: FiscaLocale): Map<string, string> {
  const entries = flattenKeys(getDictionary(locale, 'common')).filter(([key]) => key.startsWith('ui.pos.'));
  return new Map(entries);
}

const ACRONYMS = /\b(?:QR|B2B|B2C|TVA|HT|TTC|ICE|TPE|MAD|Z|mm|h|min)\b/gu;
const TOKEN_RE = /\{[A-Za-z]+\}/gu;
const placeholdersOf = (text: string): readonly string[] => [...text.matchAll(TOKEN_RE)].map((m) => m[0]).sort();
const ENDONYM = /^ui\.pos\.language\./u;

describe('ui.pos.* : parité des 6 langues', () => {
  const reference = pos('fr');

  it('le français définit au moins 90 clés, dont les groupes sale, pay, net, receipt, print, b2b', () => {
    expect(reference.size).toBeGreaterThanOrEqual(90);
    for (const group of ['sale', 'pay', 'net', 'receipt', 'print', 'b2b', 'err', 'language']) {
      expect([...reference.keys()].some((k) => k.startsWith(`ui.pos.${group}.`)), group).toBe(true);
    }
  });

  for (const locale of FISCA_LOCALES) {
    it(`${locale} : mêmes clés que fr, aucune vide, mêmes placeholders`, () => {
      const entries = pos(locale);
      expect([...entries.keys()].sort()).toEqual([...reference.keys()].sort());
      for (const [key, value] of entries) {
        expect(value.trim().length, `${locale}/${key}`).toBeGreaterThan(0);
        expect(placeholdersOf(value), `${locale}/${key}`).toEqual(placeholdersOf(reference.get(key) ?? ''));
      }
    });
  }

  it('traductions réelles : hors noms de langue, sigles et libellés techniques, le texte diffère du français', () => {
    const technical = new Set(['ui.pos.receipt.date', 'ui.pos.print.width58', 'ui.pos.print.width80', 'ui.pos.sale.vatRate', 'ui.pos.receipt.vat']);
    for (const locale of FISCA_LOCALES.filter((l) => l !== 'fr')) {
      for (const [key, value] of pos(locale)) {
        if (ENDONYM.test(key) || technical.has(key)) continue;
        expect(value, `${locale}/${key}`).not.toBe(reference.get(key));
      }
    }
  });

  it('arabe et darija en script arabe ; tifinagh en Tifinagh (sigles latins admis, infobulles Doc_08 § 07)', () => {
    for (const locale of ['ar', 'ary'] as const) {
      for (const [key, value] of pos(locale)) {
        if (ENDONYM.test(key) || key.startsWith('ui.pos.print.width')) continue;
        expect(value, `${locale}/${key}`).toMatch(/\p{Script=Arabic}/u);
      }
    }
    for (const [key, value] of pos('zgh-Tfng')) {
      if (ENDONYM.test(key) || key.startsWith('ui.pos.print.width') || key.endsWith('.vatRate') || key.endsWith('.vat')) continue;
      expect(value, key).toMatch(/\p{Script=Tfng}/u);
      expect(value.replace(TOKEN_RE, '').replace(ACRONYMS, '').replace(/QR-/gu, ''), key).not.toMatch(/\p{Script=Latin}/u);
    }
  });

  it('zgh-Latn n’est pas une copie du français ni de l’anglais', () => {
    const latn = pos('zgh-Latn');
    const same = [...latn].filter(([key, value]) => !ENDONYM.test(key) && (value === reference.get(key) || value === pos('en').get(key)));
    expect(same.map(([key]) => key).filter((k) => !k.startsWith('ui.pos.print.width') && !k.endsWith('.vatRate') && !k.endsWith('.vat'))).toEqual([]);
  });

  it('jamais d’affirmation de conformité, d’homologation ni de certification', () => {
    const banned = /conforme|conformité|homologu|certifi|معتمد|مصادق|مطابق|certified|approved by|compliant|homologated/iu;
    for (const locale of FISCA_LOCALES) {
      for (const [key, value] of pos(locale)) expect(value, `${locale}/${key}`).not.toMatch(banned);
    }
  });

  it('aucun montant ni taux écrit en dur dans un libellé (placeholders seulement)', () => {
    for (const locale of FISCA_LOCALES) {
      for (const [key, value] of pos(locale)) {
        if (key === 'ui.pos.sale.blocked' || key === 'ui.pos.net.offlineExpired') continue;
        expect(value.replace(TOKEN_RE, '').replace(/B2[BC]|\b(?:58|80)\b/gu, ''), `${locale}/${key}`).not.toMatch(/\d/u);
      }
    }
  });
});
