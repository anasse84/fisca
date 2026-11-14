import { describe, expect, it } from 'vitest';
import { FISCA_LOCALES, flattenKeys, getDictionary } from '../src/index.ts';
import type { FiscaLocale } from '../src/index.ts';

/** Clés `ui.pme.purchases.*`, `ui.pme.bank.*` et `ui.pme.radar.*` (T-P2B-08) : 6 langues, chacune dans son propre dictionnaire. */
const OPS_KEYS = [
  'ui.pme.bank.actions.suspend',
  'ui.pme.bank.actions.validate',
  'ui.pme.bank.candidate',
  'ui.pme.bank.decisionTitle',
  'ui.pme.bank.dueDate',
  'ui.pme.bank.entriesTitle',
  'ui.pme.bank.errors.alreadyReconciled',
  'ui.pme.bank.errors.conflict',
  'ui.pme.bank.errors.forbidden',
  'ui.pme.bank.errors.generic',
  'ui.pme.bank.errors.idempotency',
  'ui.pme.bank.errors.invalid',
  'ui.pme.bank.errors.network',
  'ui.pme.bank.errors.notFound',
  'ui.pme.bank.errors.session',
  'ui.pme.bank.errors.unavailable',
  'ui.pme.bank.method.card',
  'ui.pme.bank.method.cash',
  'ui.pme.bank.method.cheque',
  'ui.pme.bank.method.label',
  'ui.pme.bank.method.lcn',
  'ui.pme.bank.method.offset',
  'ui.pme.bank.method.placeholder',
  'ui.pme.bank.method.transfer',
  'ui.pme.bank.notice.humanValidation',
  'ui.pme.bank.outcome.matched',
  'ui.pme.bank.outcome.noMatch',
  'ui.pme.bank.outcome.partial',
  'ui.pme.bank.outcome.suspense',
  'ui.pme.bank.score',
  'ui.pme.bank.selectPrompt',
  'ui.pme.bank.state.matched',
  'ui.pme.bank.state.noMatch',
  'ui.pme.bank.state.partial',
  'ui.pme.bank.state.suspense',
  'ui.pme.bank.state.unmatched',
  'ui.pme.bank.statementTitle',
  'ui.pme.bank.suggestion.ambiguous',
  'ui.pme.bank.suggestion.none',
  'ui.pme.bank.suggestion.unique',
  'ui.pme.bank.suspenseNotice',
  'ui.pme.bank.title',
  'ui.pme.purchases.alert.cashSplit',
  'ui.pme.purchases.col.alert',
  'ui.pme.purchases.col.date',
  'ui.pme.purchases.col.open',
  'ui.pme.purchases.col.source',
  'ui.pme.purchases.col.status',
  'ui.pme.purchases.col.supplier',
  'ui.pme.purchases.col.total',
  'ui.pme.purchases.connection.closed',
  'ui.pme.purchases.connection.connecting',
  'ui.pme.purchases.connection.open',
  'ui.pme.purchases.connection.reconnecting',
  'ui.pme.purchases.density.comfortable',
  'ui.pme.purchases.density.compact',
  'ui.pme.purchases.drawer.account',
  'ui.pme.purchases.drawer.credit',
  'ui.pme.purchases.drawer.debit',
  'ui.pme.purchases.drawer.description',
  'ui.pme.purchases.drawer.entryTitle',
  'ui.pme.purchases.drawer.noProposal',
  'ui.pme.purchases.drawer.title',
  'ui.pme.purchases.drawer.totals',
  'ui.pme.purchases.empty',
  'ui.pme.purchases.errors.conflict',
  'ui.pme.purchases.errors.forbidden',
  'ui.pme.purchases.errors.generic',
  'ui.pme.purchases.errors.idempotency',
  'ui.pme.purchases.errors.invalid',
  'ui.pme.purchases.errors.network',
  'ui.pme.purchases.errors.notFound',
  'ui.pme.purchases.errors.session',
  'ui.pme.purchases.errors.unavailable',
  'ui.pme.purchases.gridLabel',
  'ui.pme.purchases.illegible',
  'ui.pme.purchases.keyboardHint',
  'ui.pme.purchases.newRows',
  'ui.pme.purchases.open',
  'ui.pme.purchases.openLabel',
  'ui.pme.purchases.stage.running',
  'ui.pme.purchases.stage.submitted',
  'ui.pme.purchases.stage.visaed',
  'ui.pme.purchases.status.extracted',
  'ui.pme.purchases.status.proposed',
  'ui.pme.purchases.status.queued',
  'ui.pme.purchases.title',
  'ui.pme.purchases.visa.action',
  'ui.pme.purchases.visa.notice',
  'ui.pme.radar.asOf',
  'ui.pme.radar.col.action',
  'ui.pme.radar.col.amountDue',
  'ui.pme.radar.col.customer',
  'ui.pme.radar.col.daysLate',
  'ui.pme.radar.col.dispute',
  'ui.pme.radar.col.due',
  'ui.pme.radar.col.invoice',
  'ui.pme.radar.col.penalty',
  'ui.pme.radar.col.penaltyState',
  'ui.pme.radar.density.comfortable',
  'ui.pme.radar.density.compact',
  'ui.pme.radar.dispute.documented',
  'ui.pme.radar.dispute.none',
  'ui.pme.radar.errors.conflict',
  'ui.pme.radar.errors.forbidden',
  'ui.pme.radar.errors.generic',
  'ui.pme.radar.errors.idempotency',
  'ui.pme.radar.errors.invalid',
  'ui.pme.radar.errors.network',
  'ui.pme.radar.errors.notFound',
  'ui.pme.radar.errors.session',
  'ui.pme.radar.errors.unavailable',
  'ui.pme.radar.evidence.errors.empty',
  'ui.pme.radar.evidence.errors.hash',
  'ui.pme.radar.evidence.errors.tooLarge',
  'ui.pme.radar.evidence.errors.tooMany',
  'ui.pme.radar.evidence.errors.type',
  'ui.pme.radar.evidence.frozenNotice',
  'ui.pme.radar.evidence.hash',
  'ui.pme.radar.evidence.hashing',
  'ui.pme.radar.evidence.open',
  'ui.pme.radar.evidence.openLabel',
  'ui.pme.radar.evidence.pick',
  'ui.pme.radar.evidence.policy',
  'ui.pme.radar.evidence.remove',
  'ui.pme.radar.evidence.removeLabel',
  'ui.pme.radar.evidence.sent',
  'ui.pme.radar.evidence.submit',
  'ui.pme.radar.evidence.submitting',
  'ui.pme.radar.evidence.title',
  'ui.pme.radar.evidence.unit.byte',
  'ui.pme.radar.evidence.unit.kb',
  'ui.pme.radar.evidence.unit.mb',
  'ui.pme.radar.gridLabel',
  'ui.pme.radar.note.serverComputed',
  'ui.pme.radar.penalty.active',
  'ui.pme.radar.penalty.frozen',
  'ui.pme.radar.title',
] as const;

/** Sigles et jetons techniques conservés tels quels en Tifinagh (Doc_08 § 03/07) ; les paramètres {…} sont retirés avant le test. */
const SIGLES = /ICE|IF|RC|TVA|HT|TTC|MAD|DGI|CGI|RAS|LCN|SHA-256|Mod\+Enter|Enter|J \/ K|px/g;
/** Valeurs identiques au français admises en anglais (mots communs aux deux langues). */
const SAME_IN_EN = new Set(['ui.pme.purchases.col.date', 'ui.pme.bank.candidate']);
const OPS = /^ui\.pme\.(purchases|bank|radar)\./;

function own(locale: FiscaLocale): Map<string, string> {
  return new Map(flattenKeys(getDictionary(locale, 'common')));
}

describe('clés ui.pme.purchases / bank / radar : parité des 6 langues', () => {
  it('la liste de référence ne contient aucun doublon', () => {
    expect(new Set(OPS_KEYS).size).toBe(OPS_KEYS.length);
  });
  for (const locale of FISCA_LOCALES) {
    it(`${locale} définit chaque clé dans son propre dictionnaire`, () => {
      const entries = own(locale);
      for (const key of OPS_KEYS) {
        expect(entries.get(key)?.trim().length ?? 0, `${locale}/${key}`).toBeGreaterThan(0);
      }
    });
    it(`${locale} : aucune clé de ces trois espaces en trop ni en moins`, () => {
      const keys = [...own(locale).keys()].filter((k) => OPS.test(k)).sort();
      expect(keys).toEqual([...OPS_KEYS].sort());
    });
    it(`${locale} : mêmes paramètres {…} que le français`, () => {
      const params = (v: string | undefined): string[] => [...(v ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
      for (const key of OPS_KEYS) {
        expect(params(own(locale).get(key)), `${locale}/${key}`).toEqual(params(own('fr').get(key)));
      }
    });
  }

  it('traductions réelles : hors valeurs communes, le texte diffère du français', () => {
    const fr = own('fr');
    for (const locale of FISCA_LOCALES.filter((l) => l !== 'fr')) {
      for (const key of OPS_KEYS) {
        if (locale === 'en' && SAME_IN_EN.has(key)) continue;
        expect(own(locale).get(key), `${locale}/${key}`).not.toBe(fr.get(key));
      }
    }
  });

  it('arabe et darija en script arabe ; tifinagh en Tifinagh hors sigles et paramètres', () => {
    for (const locale of ['ar', 'ary'] as const) {
      for (const key of OPS_KEYS) {
        expect(own(locale).get(key), `${locale}/${key}`).toMatch(/\p{Script=Arabic}/u);
      }
    }
    for (const key of OPS_KEYS) {
      const raw = own('zgh-Tfng').get(key) ?? '';
      const stripped = raw.replace(/\{\w+\}/g, '').replace(SIGLES, '');
      expect(raw, key).toMatch(/\p{Script=Tfng}/u);
      expect(stripped, key).not.toMatch(/\p{Script=Latin}/u);
    }
  });

  it('le Tifinagh dérive du latin amazighe : mêmes gabarits, mêmes chiffres', () => {
    for (const key of OPS_KEYS) {
      const digits = (v: string | undefined): string => (v ?? '').replace(/\D/g, '');
      expect(digits(own('zgh-Tfng').get(key)), key).toBe(digits(own('zgh-Latn').get(key)));
    }
  });

  it('jamais d’affirmation de conformité, d’homologation ni de certification', () => {
    const banned = /conforme|conformité|homologu|certifi|معتمد|مصادق|مطابق|certified|approved by|compliant|homologated/iu;
    for (const locale of FISCA_LOCALES) {
      for (const key of OPS_KEYS) {
        expect(own(locale).get(key) ?? '', `${locale}/${key}`).not.toMatch(banned);
      }
    }
  });

  it('la mise en suspens cite les comptes 3497 et 4497 dans les 6 langues', () => {
    for (const locale of FISCA_LOCALES) {
      const text = own(locale).get('ui.pme.bank.actions.suspend') ?? '';
      expect(text, locale).toContain('3497');
      expect(text, locale).toContain('4497');
    }
  });

  it('chaque catégorie d’erreur est définie pour chaque section (pilote par errorCode, jamais le texte serveur)', () => {
    const categories = ['network', 'session', 'forbidden', 'invalid', 'conflict', 'notFound', 'idempotency', 'unavailable', 'generic'];
    for (const section of ['purchases', 'bank', 'radar']) {
      for (const c of categories) expect(OPS_KEYS).toContain(`ui.pme.${section}.errors.${c}`);
    }
    expect(OPS_KEYS).toContain('ui.pme.bank.errors.alreadyReconciled');
  });
});
