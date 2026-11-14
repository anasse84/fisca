import { describe, expect, it } from 'vitest';
import { FISCA_LOCALES, flattenKeys, getDictionary } from '../src/index.ts';
import type { FiscaLocale } from '../src/index.ts';

/** Clés `ui.pme.*` de l'espace PME (T-P2B-07) : 6 langues, chacune dans son propre dictionnaire. */
const PME_KEYS = [
  'ui.pme.dashboard.title',
  'ui.pme.chart.title',
  'ui.pme.chart.summary',
  'ui.pme.chart.settledLegend',
  'ui.pme.chart.forecastLegend',
  'ui.pme.chart.vatLegend',
  'ui.pme.chart.cursorLabel',
  'ui.pme.chart.cursorReadout',
  'ui.pme.chart.noValue',
  'ui.pme.chart.asOf',
  'ui.pme.chart.table.summary',
  'ui.pme.chart.table.caption',
  'ui.pme.chart.table.date',
  'ui.pme.chart.table.settled',
  'ui.pme.chart.table.forecast',
  'ui.pme.chart.table.vat',
  'ui.pme.vatDue.title',
  'ui.pme.severity.info',
  'ui.pme.severity.warning',
  'ui.pme.severity.danger',
  'ui.pme.banner.region',
  'ui.pme.banner.rule',
  'ui.pme.banner.effective',
  'ui.pme.banner.reference',
  'ui.pme.rule.cashCeiling',
  'ui.pme.rule.rasTvaExpired',
  'ui.pme.rule.autoEntrepreneurThreshold',
  'ui.pme.rule.cashLowBalance',
  'ui.pme.invoice.title',
  'ui.pme.invoice.invoiceDate',
  'ui.pme.invoice.customerSection',
  'ui.pme.invoice.customerNameFr',
  'ui.pme.invoice.customerNameAr',
  'ui.pme.invoice.customerIce',
  'ui.pme.invoice.linesSection',
  'ui.pme.invoice.line.title',
  'ui.pme.invoice.line.designationFr',
  'ui.pme.invoice.line.designationAr',
  'ui.pme.invoice.line.quantity',
  'ui.pme.invoice.line.unitPrice',
  'ui.pme.invoice.line.vatRate',
  'ui.pme.invoice.line.total',
  'ui.pme.invoice.ratePlaceholder',
  'ui.pme.invoice.ratesUnavailable',
  'ui.pme.invoice.addLine',
  'ui.pme.invoice.removeLine',
  'ui.pme.invoice.totals.title',
  'ui.pme.invoice.totals.totalHt',
  'ui.pme.invoice.totals.totalVat',
  'ui.pme.invoice.totals.totalTtc',
  'ui.pme.invoice.totals.byRate',
  'ui.pme.invoice.totals.baseHt',
  'ui.pme.invoice.saveDraft',
  'ui.pme.invoice.saved',
  'ui.pme.invoice.saveFailed',
  'ui.pme.invoice.errors.designation',
  'ui.pme.invoice.errors.quantity',
  'ui.pme.invoice.errors.unitPrice',
  'ui.pme.invoice.errors.rate',
  'ui.pme.invoice.errors.ice',
  'ui.pme.invoice.errors.noLines',
  'ui.pme.preview.title',
  'ui.pme.preview.invoice',
  'ui.pme.preview.number',
  'ui.pme.preview.numberPending',
  'ui.pme.preview.date',
  'ui.pme.preview.seller',
  'ui.pme.preview.customer',
  'ui.pme.preview.name',
  'ui.pme.preview.legalForm',
  'ui.pme.preview.capital',
  'ui.pme.preview.address',
  'ui.pme.preview.ice',
  'ui.pme.preview.if',
  'ui.pme.preview.rc',
  'ui.pme.preview.designation',
  'ui.pme.preview.quantity',
  'ui.pme.preview.unitPrice',
  'ui.pme.preview.vatRate',
  'ui.pme.preview.lineTotal',
  'ui.pme.preview.baseHt',
  'ui.pme.preview.vat',
  'ui.pme.preview.totalHt',
  'ui.pme.preview.totalVat',
  'ui.pme.preview.totalTtc',
  'ui.pme.preview.legalReason',
  'ui.pme.preview.arrete',
] as const;

/** Sigles latins conservés en Tifinagh (Doc_08 § 03/07) ; les accolades de paramètres sont retirées avant le test. */
const SIGLES = /ICE|IF|RC|TVA|HT|TTC|MAD|ADC|DGI|CGI|RAS/g;
/** Clés réduites à un sigle (identiques dans toutes les langues) ; « Date » est identique en français et en anglais. */
const SIGLE_ONLY = new Set(['ui.pme.preview.if', 'ui.pme.preview.ice', 'ui.pme.preview.rc']);
const SAME_IN_EN = new Set(['ui.pme.chart.table.date', 'ui.pme.preview.date']);

function own(locale: FiscaLocale): Map<string, string> {
  return new Map(flattenKeys(getDictionary(locale, 'common')));
}

describe('clés ui.pme.* : parité des 6 langues', () => {
  for (const locale of FISCA_LOCALES) {
    it(`${locale} définit chaque clé dans son propre dictionnaire`, () => {
      const entries = own(locale);
      for (const key of PME_KEYS) {
        expect(entries.get(key)?.trim().length ?? 0, `${locale}/${key}`).toBeGreaterThan(0);
      }
    });
    it(`${locale} : aucune clé ui.pme.* en trop ni en moins`, () => {
      const keys = [...own(locale).keys()].filter((k) => k.startsWith('ui.pme.') && !/^ui\.pme\.(purchases|bank|radar)\./.test(k)).sort();
      expect(keys).toEqual([...PME_KEYS].sort());
    });
    it(`${locale} : mêmes paramètres {…} que le français`, () => {
      const params = (v: string | undefined): string[] => [...(v ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
      for (const key of PME_KEYS) {
        expect(params(own(locale).get(key)), `${locale}/${key}`).toEqual(params(own('fr').get(key)));
      }
    });
  }

  it('traductions réelles : hors sigles et valeurs invariantes, le texte diffère du français', () => {
    const fr = own('fr');
    for (const locale of FISCA_LOCALES.filter((l) => l !== 'fr')) {
      for (const key of PME_KEYS) {
        if (SIGLE_ONLY.has(key) || (locale === 'en' && SAME_IN_EN.has(key))) continue;
        expect(own(locale).get(key), `${locale}/${key}`).not.toBe(fr.get(key));
      }
    }
  });

  it('arabe et darija en script arabe ; tifinagh en Tifinagh hors sigles et paramètres', () => {
    for (const locale of ['ar', 'ary'] as const) {
      for (const key of PME_KEYS) {
        expect(own(locale).get(key), `${locale}/${key}`).toMatch(/\p{Script=Arabic}|^(ICE|IF|RC)$/u);
      }
    }
    for (const key of PME_KEYS) {
      const raw = own('zgh-Tfng').get(key) ?? '';
      const stripped = raw.replace(/\{\w+\}/g, '').replace(SIGLES, '');
      if (SIGLE_ONLY.has(key)) continue;
      expect(raw, key).toMatch(/\p{Script=Tfng}/u);
      expect(stripped, key).not.toMatch(/\p{Script=Latin}/u);
    }
  });

  it('jamais d’affirmation de conformité, d’homologation ni de certification', () => {
    const banned = /conforme|conformité|homologu|certifi|معتمد|مصادق|مطابق|certified|approved by|compliant|homologated/iu;
    for (const locale of FISCA_LOCALES) {
      for (const key of PME_KEYS) {
        expect(own(locale).get(key) ?? '', `${locale}/${key}`).not.toMatch(banned);
      }
    }
  });

  it('aucun seuil ni date écrits dans les gabarits de règle (ils viennent des paramètres du port)', () => {
    for (const locale of FISCA_LOCALES) {
      for (const key of PME_KEYS.filter((k) => k.startsWith('ui.pme.rule.'))) {
        const withoutParams = (own(locale).get(key) ?? '').replace(/\{\w+\}/g, '');
        expect(withoutParams, `${locale}/${key}`).not.toMatch(/[0-9٠-٩]/u);
      }
    }
  });
});
