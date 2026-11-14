import { describe, expect, it } from 'vitest';
import {
  FISCA_LOCALES,
  FISCA_NAMESPACES,
  PACKAGE_NAME,
  directionOf,
  flattenKeys,
  getAllowedLocalesForSurface,
  getDictionary,
  resolveSafeLocaleForSurface,
  translate,
  type FiscaAppSurface,
  type FiscaLocale,
} from '../src/index.ts';

const PME_SURFACES: readonly FiscaAppSurface[] = ['MARKETING_ASTRO', 'PME_SAAS', 'POS_TACTILE'];
const B2B_SURFACES: readonly FiscaAppSurface[] = ['FIDUCIAIRE_OEC', 'ENTERPRISE_CORPORATE'];

describe('@fisca/i18n — paquet', () => {
  it('exporte son nom de paquet', () => {
    expect(PACKAGE_NAME).toBe('@fisca/i18n');
  });
});

describe('dictionnaires — parité', () => {
  it('déclare exactement les 6 langues et les 6 espaces de noms de la Section 07', () => {
    expect([...FISCA_LOCALES].sort()).toEqual(['ar', 'ary', 'en', 'fr', 'zgh-Latn', 'zgh-Tfng']);
    expect([...FISCA_NAMESPACES]).toEqual([
      'common',
      'marketing',
      'invoicing_pos',
      'accounting_cgnc',
      'tax_simpl',
      'enterprise',
    ]);
  });

  for (const ns of FISCA_NAMESPACES) {
    it(`l'espace ${ns} a les mêmes clés dans les 6 langues, sans texte vide`, () => {
      const reference = flattenKeys(getDictionary('fr', ns)).map(([k]) => k).sort();
      expect(reference.length).toBeGreaterThan(5);
      for (const loc of FISCA_LOCALES) {
        const entries = flattenKeys(getDictionary(loc, ns));
        expect(entries.map(([k]) => k).sort(), `${loc}/${ns}`).toEqual(reference);
        for (const [key, value] of entries) {
          expect(value.trim().length, `${loc}/${ns}/${key}`).toBeGreaterThan(0);
        }
      }
    });
  }

  it('écrit les langues arabes en script arabe et le tifinagh en Tifinagh', () => {
    expect(translate('ar', 'common', 'actions.save')).toMatch(/\p{Script=Arabic}/u);
    expect(translate('ary', 'common', 'actions.save')).toMatch(/\p{Script=Arabic}/u);
    expect(translate('zgh-Tfng', 'common', 'actions.save')).toMatch(/\p{Script=Tfng}/u);
    expect(translate('zgh-Latn', 'common', 'actions.save')).not.toMatch(/\p{Script=Tfng}/u);
  });

  it('affiche « Validation simulée » pour l\'état cleared, sans promesse de conformité DGI', () => {
    expect(translate('fr', 'common', 'states.cleared')).toBe('Validation simulée');
    expect(translate('fr', 'tax_simpl', 'invoice.clearance')).toBe('Validation simulée');
    const banned = /conforme|conformité|homologu|certifi|معتمد|مصادق|مطابق|certified|approved by|compliant|homologated/iu;
    for (const loc of FISCA_LOCALES) {
      for (const ns of FISCA_NAMESPACES) {
        for (const [key, value] of flattenKeys(getDictionary(loc, ns))) {
          expect(value, `${loc}/${ns}/${key}`).not.toMatch(banned);
        }
      }
    }
  });

  it('ne code aucun taux de TVA en dur dans les libellés', () => {
    for (const loc of FISCA_LOCALES) {
      for (const [key, value] of flattenKeys(getDictionary(loc, 'tax_simpl'))) {
        expect(value, `${loc}/${key}`).not.toMatch(/\d+\s?%/u);
      }
    }
  });
});

describe('routeur de langues — 6 contre 3', () => {
  it('autorise les 6 langues sur Astro, PME et POS', () => {
    for (const surface of PME_SURFACES) {
      expect([...getAllowedLocalesForSurface(surface)].sort()).toEqual([...FISCA_LOCALES].sort());
    }
  });

  it('autorise seulement fr, ar, en sur Fiduciaire et Corporate', () => {
    for (const surface of B2B_SURFACES) {
      expect([...getAllowedLocalesForSurface(surface)]).toEqual(['fr', 'ar', 'en']);
    }
  });

  it('conserve toute langue autorisée sur la surface', () => {
    for (const surface of PME_SURFACES) {
      for (const loc of FISCA_LOCALES) {
        expect(resolveSafeLocaleForSurface(loc, surface).locale).toBe(loc);
      }
    }
    for (const surface of B2B_SURFACES) {
      for (const loc of ['fr', 'ar', 'en'] as const) {
        expect(resolveSafeLocaleForSurface(loc, surface).locale).toBe(loc);
      }
    }
  });

  it('replie ary vers ar et zgh-Latn / zgh-Tfng vers fr sur les surfaces B2B', () => {
    for (const surface of B2B_SURFACES) {
      expect(resolveSafeLocaleForSurface('ary', surface).locale).toBe('ar');
      expect(resolveSafeLocaleForSurface('zgh-Latn', surface).locale).toBe('fr');
      expect(resolveSafeLocaleForSurface('zgh-Tfng', surface).locale).toBe('fr');
    }
  });

  it('fournit la chaîne de repli terminologique', () => {
    expect(resolveSafeLocaleForSurface('ary', 'PME_SAAS').fallbackChain).toEqual(['ary', 'ar', 'fr']);
    expect(resolveSafeLocaleForSurface('zgh-Tfng', 'POS_TACTILE').fallbackChain).toEqual(['zgh-Tfng', 'fr']);
    expect(resolveSafeLocaleForSurface('zgh-Latn', 'PME_SAAS').fallbackChain).toEqual(['zgh-Latn', 'fr']);
    expect(resolveSafeLocaleForSurface('en', 'FIDUCIAIRE_OEC').fallbackChain).toEqual(['en', 'fr']);
    expect(resolveSafeLocaleForSurface('fr', 'ENTERPRISE_CORPORATE').fallbackChain).toEqual(['fr']);
  });

  it('replie une valeur inconnue sur fr (langue par défaut)', () => {
    expect(resolveSafeLocaleForSurface('de' as FiscaLocale, 'PME_SAAS').locale).toBe('fr');
  });
});

describe('direction RTL / LTR', () => {
  it('ar et ary sont RTL ; les autres sont LTR', () => {
    const expected: Record<FiscaLocale, 'ltr' | 'rtl'> = {
      fr: 'ltr',
      en: 'ltr',
      ar: 'rtl',
      ary: 'rtl',
      'zgh-Latn': 'ltr',
      'zgh-Tfng': 'ltr',
    };
    for (const loc of FISCA_LOCALES) {
      expect(directionOf(loc)).toBe(expected[loc]);
    }
  });

  it('le routeur renvoie la direction de la langue effective', () => {
    expect(resolveSafeLocaleForSurface('ary', 'PME_SAAS').dir).toBe('rtl');
    expect(resolveSafeLocaleForSurface('ary', 'FIDUCIAIRE_OEC').dir).toBe('rtl');
    expect(resolveSafeLocaleForSurface('zgh-Tfng', 'FIDUCIAIRE_OEC').dir).toBe('ltr');
    expect(resolveSafeLocaleForSurface('ar', 'ENTERPRISE_CORPORATE').dir).toBe('rtl');
  });
});

describe('translate', () => {
  it('renvoie la clé elle-même si elle est introuvable dans toute la chaîne', () => {
    expect(translate('fr', 'common', 'inconnue.cle')).toBe('inconnue.cle');
  });
});
