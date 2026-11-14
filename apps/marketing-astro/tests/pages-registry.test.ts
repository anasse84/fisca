import { describe, expect, it } from 'vitest';
import {
  EDITORIAL_PAGES,
  PRICING_SLUG,
  PRIVACY_SLUG,
  findEditorialPage,
  findEditorialPageByMirrorPath,
  findEditorialPageByPath,
  mirrorPathOf,
} from '../src/content/pages.ts';
import { PRICING_CATALOG_OFFERS, PRICING_PLANS } from '../src/content/pricing.ts';
import { buildPricingView, cellToPlainText } from '../src/content/pricing-view.ts';
import { buildPrivacyView } from '../src/content/privacy-view.ts';
import { CONTROLLER_PROCESSINGS } from '../src/content/cndp.ts';
import { cndpRegistrationNotice } from '../src/i18n/cndp-notice.ts';
import { copyLocaleOf } from '../src/i18n/copy-locale.ts';
import { LOCALE_URL_PREFIX, MARKETING_LOCALES } from '../src/i18n/locales.ts';
import { buildFiscaJsonLdObject } from '../src/seo/jsonld.ts';
import type { JsonLdNode } from '../src/seo/jsonld.ts';
import { buildLlmsFullTxt, buildLlmsTxt } from '../src/seo/llms.ts';
import { handleMirrorRequest, handleLlmsFullTxt, handleLlmsTxt } from '../src/seo/handlers.ts';
import { renderPageMarkdown } from '../src/seo/mirror.ts';
import { formatCentsMad } from '../src/lib/money.ts';

/** AGENTS.md § 4 : « conforme », « homologué » ou « certifié » par la DGI ou xHub est interdit, même nié. */
const FORBIDDEN_WORDS = /conforme|homologu|certifi/i;
const FORBIDDEN_CLAIM = /(conforme|homologu|certifi)\w*\s+(par\s+)?(la\s+)?(DGI|xHub)/i;
/** Fenêtre large, dans les deux sens, y compris en négation : « ... DGI ... certifié ». */
const FORBIDDEN_NEAR_PLATFORM = /(conforme|homologu|certifi)[^.\n]{0,60}(DGI|xHub)|(DGI|xHub)[^.\n]{0,60}(conforme|homologu|certifi)/i;
/** B-13 : aucune date ni aucun seuil de la réforme de facturation électronique. */
const YEAR = /\b20(2[5-9]|3\d)\b/;
const REFORM_THRESHOLD = /(seuil|threshold|عتبة)[^.\n]{0,60}(factur|e-?invoic|فوترة)/i;
const SLUGS = [PRICING_SLUG, PRIVACY_SLUG] as const;

function pageOrThrow(locale: (typeof MARKETING_LOCALES)[number], slug: string) {
  const page = findEditorialPage(locale, slug);
  if (page === undefined) throw new Error(`page absente : ${locale}/${slug}`);
  return page;
}

describe('pages enregistrées dans les 6 langues', () => {
  it('slugs tarifs et confidentialite', () => {
    expect(PRICING_SLUG).toBe('tarifs');
    expect(PRIVACY_SLUG).toBe('confidentialite');
  });

  it('accueil, tarifs et confidentialité existent pour chaque langue', () => {
    for (const locale of MARKETING_LOCALES) {
      for (const slug of ['', ...SLUGS]) {
        expect(findEditorialPage(locale, slug), `${locale}/${slug}`).toBeDefined();
      }
    }
    expect(EDITORIAL_PAGES).toHaveLength(18);
  });

  it('chemins HTML et miroirs .md', () => {
    expect(mirrorPathOf(pageOrThrow('fr', 'tarifs'))).toBe('/fr/tarifs.md');
    expect(mirrorPathOf(pageOrThrow('zgh-Tfng', 'confidentialite'))).toBe('/zgh-tfng/confidentialite.md');
    expect(findEditorialPageByPath('/ary/tarifs')?.slug).toBe('tarifs');
    expect(findEditorialPageByPath('/zgh/confidentialite/')?.locale).toBe('zgh-Latn');
    expect(findEditorialPageByMirrorPath('/en/tarifs.md')?.locale).toBe('en');
  });

  it('les miroirs Markdown répondent pour les 18 pages, sans HTML', async () => {
    for (const locale of MARKETING_LOCALES) {
      for (const slug of ['', ...SLUGS]) {
        const path = slug === '' ? `/${LOCALE_URL_PREFIX[locale]}/index.md` : `/${LOCALE_URL_PREFIX[locale]}/${slug}.md`;
        const res = handleMirrorRequest(new Request(`https://fisca.ma${path}`));
        expect(res?.status, path).toBe(200);
        const body = (await res?.text()) ?? '';
        expect(body, path).toMatch(/^# /);
        expect(body, path).not.toMatch(/<[a-z!/][^>]*>/i);
        expect(res?.headers.get('set-cookie')).toBeNull();
      }
    }
  });

  it('le repli français des langues amazighes est déclaré (contentLanguage fr), jamais silencieux', () => {
    for (const slug of ['', ...SLUGS]) {
      expect(pageOrThrow('zgh-Latn', slug).contentLanguage).toBe('fr');
      expect(pageOrThrow('zgh-Tfng', slug).contentLanguage).toBe('fr');
      expect(pageOrThrow('ar', slug).contentLanguage).toBe('ar');
      expect(pageOrThrow('ary', slug).contentLanguage).toBe('ary');
      expect(pageOrThrow('en', slug).contentLanguage).toBe('en');
    }
  });
});

describe('textes interdits absents', () => {
  const markdowns = EDITORIAL_PAGES.map((p) => ({ key: `${p.locale}/${p.slug}`, md: renderPageMarkdown(p) }));

  it('aucun « conforme / homologué / certifié » associé à la DGI ou xHub dans les 18 pages et leurs miroirs', () => {
    for (const { key, md } of markdowns) {
      expect(md, key).not.toMatch(FORBIDDEN_NEAR_PLATFORM);
      expect(md, key).not.toMatch(FORBIDDEN_CLAIM);
    }
    for (const { key, md } of markdowns.filter((m) => m.key.endsWith('/'))) {
      expect(md, key).not.toMatch(FORBIDDEN_WORDS);
    }
    for (const p of EDITORIAL_PAGES) {
      expect(`${p.title} ${p.description} ${p.heading} ${p.lead}`, `${p.locale}/${p.slug}`).not.toMatch(FORBIDDEN_CLAIM);
    }
  });

  it('aucune date ni aucun seuil de la réforme', () => {
    for (const { key, md } of markdowns) {
      expect(md, key).not.toMatch(YEAR);
      expect(md, key).not.toMatch(REFORM_THRESHOLD);
    }
  });

  it('l’accueil explique la « Validation simulée » dans chaque langue', () => {
    const expected: Record<string, RegExp> = {
      fr: /Validation simulée/,
      en: /Simulated validation/,
      ar: /تحقق محاكى/,
      ary: /تحقق بالمحاكاة/,
      'zgh-Latn': /Validation simulée/,
      'zgh-Tfng': /Validation simulée/,
    };
    for (const locale of MARKETING_LOCALES) {
      const md = renderPageMarkdown(pageOrThrow(locale, ''));
      expect(md, locale).toMatch(expected[locale] ?? /^$/);
    }
  });
});

describe('miroir de la page tarifs : mêmes montants que la grille', () => {
  it('contient chaque montant du catalogue, formaté par formatCentsMad', () => {
    const md = renderPageMarkdown(pageOrThrow('fr', 'tarifs'));
    for (const offer of PRICING_CATALOG_OFFERS) {
      for (const cents of [offer.monthly_ht_cents, offer.annual_ht_cents, offer.one_off_ht_cents]) {
        if (cents !== null && cents > 0) expect(md, offer.code).toContain(formatCentsMad(cents));
      }
    }
    expect(md).toContain('58 000,00 MAD');
    expect(md).toContain('140 000,00 MAD');
    expect(md).toContain('45 000,00 MAD');
    expect(md).toContain('58,65 MAD');
  });

  it('exprime la remise de volume par 15 % (1 500 bps) dès 100 dossiers', () => {
    const view = buildPricingView('fr');
    const oec = view.tables.find((t) => t.id === 'oec');
    expect(oec?.columns[2]).toContain('15 %');
    expect(oec?.columns[2]).toContain('100');
    const row = oec?.rows[1];
    expect(row?.cells.map(cellToPlainText)).toEqual(['69,00 MAD', '58,65 MAD']);
  });

  it('quatre tableaux avec en-têtes de colonnes et de lignes', () => {
    for (const locale of MARKETING_LOCALES) {
      const view = buildPricingView(locale);
      expect(view.tables.map((t) => t.id)).toEqual(['pme', 'pos', 'oec', 'enterprise']);
      for (const table of view.tables) {
        expect(table.columns.length).toBeGreaterThan(2);
        for (const row of table.rows) {
          expect(row.cells.length + 1, `${locale}/${table.id}/${row.header}`).toBe(table.columns.length);
        }
      }
    }
  });

  it('chaque langue produit les 4 familles', () => {
    for (const locale of MARKETING_LOCALES) {
      expect(buildPricingView(locale).families.map((f) => f.id)).toEqual(['PME', 'POS', 'OEC', 'CORPORATE_SOUVERAIN']);
    }
  });
});

describe('llms.txt et JSON-LD reflètent la grille', () => {
  it('llms.txt (servi) liste toutes les familles et les pages tarifs / confidentialité', async () => {
    const txt = await handleLlmsTxt().text();
    for (const offer of PRICING_CATALOG_OFFERS) expect(txt, offer.code).toContain(offer.name);
    expect(txt).toContain('https://fisca.ma/fr/tarifs.md');
    expect(txt).toContain('https://fisca.ma/zgh-tfng/confidentialite.md');
    expect(txt).toContain('1500 bps');
    expect(txt).not.toMatch(FORBIDDEN_WORDS);
    expect(txt).not.toMatch(YEAR);
    expect(txt).not.toMatch(/\d\s?%/);
  });

  it('llms-full.txt (servi) détaille les autres familles', async () => {
    const full = await handleLlmsFullTxt().text();
    expect(full).toContain('Autres familles');
    expect(full).toContain('140 000,00 MAD');
    expect(full).not.toMatch(FORBIDDEN_WORDS);
    expect(full).not.toMatch(YEAR);
  });

  it('appels à 2 arguments inchangés (API de T-P2C-02)', () => {
    const txt = buildLlmsTxt(PRICING_PLANS, EDITORIAL_PAGES);
    expect(txt).not.toContain('[CORPORATE_SOUVERAIN]');
    expect(buildLlmsFullTxt(PRICING_PLANS, EDITORIAL_PAGES)).not.toContain('Autres familles');
  });

  it('JSON-LD : sans catalogue = 4 offres ; avec catalogue = toutes les offres, HT, entières', () => {
    const base = { pageUrl: 'https://fisca.ma/fr/tarifs', locale: 'fr', title: 't', description: 'd' } as const;
    const find = (doc: ReturnType<typeof buildFiscaJsonLdObject>): JsonLdNode[] => {
      const sw = doc['@graph'].find((n) => n['@type'] === 'SoftwareApplication');
      return (sw?.['offers'] as JsonLdNode[] | undefined) ?? [];
    };
    expect(find(buildFiscaJsonLdObject(base))).toHaveLength(4);
    const offers = find(buildFiscaJsonLdObject({ ...base, catalogOffers: PRICING_CATALOG_OFFERS }));
    expect(offers).toHaveLength(PRICING_CATALOG_OFFERS.length);
    const byCode = new Map(offers.map((o) => [o['sku'], o]));
    expect(byCode.get('ENT_SOUVERAIN')?.['price']).toBe('140000.00');
    expect(byCode.get('PACK_MOWAKABA_CABINET')?.['price']).toBe('45000.00');
    expect(byCode.get('POS_TACTILE_FLEET')?.['price']).toBe('99.00');
    expect(JSON.stringify(offers)).not.toContain('"valueAddedTaxIncluded":true');
  });

  it('JSON-LD : FAQ de la page tarifs', () => {
    const page = pageOrThrow('fr', 'tarifs');
    expect(page.faqs?.length).toBeGreaterThanOrEqual(5);
    const doc = buildFiscaJsonLdObject({
      pageUrl: 'https://fisca.ma/fr/tarifs',
      locale: 'fr',
      title: page.title,
      description: page.description,
      ...(page.faqs === undefined ? {} : { faqs: page.faqs }),
    });
    const faq = doc['@graph'].find((n) => n['@type'] === 'FAQPage');
    expect((faq?.['mainEntity'] as unknown[]).length).toBe(page.faqs?.length);
  });
});

describe('mentions Loi 09-08 (contenu)', () => {
  it('chaque langue nomme le responsable, Rabat, les droits et dpo@fisca.ma', () => {
    for (const locale of MARKETING_LOCALES) {
      const md = renderPageMarkdown(pageOrThrow(locale, 'confidentialite'));
      expect(md, locale).toContain('SYNAPTIC SYSTEMS SARL AU');
      expect(md, locale).toContain('dpo@fisca.ma');
      expect(md, locale).toMatch(/09-08/);
      expect(md, locale).toMatch(/Rabat|الرباط/);
    }
    const fr = renderPageMarkdown(pageOrThrow('fr', 'confidentialite'));
    for (const word of ['Accès', 'Rectification', 'Opposition', 'Finalités', 'Durées de conservation', 'Cloudflare', 'Payzone']) {
      expect(fr).toContain(word);
    }
  });

  it('aucun numéro CNDP inventé : mention exacte « en cours d’enregistrement » (décision 2026-11-14)', () => {
    const view = buildPrivacyView('fr');
    expect(view.references.map((r) => r.number)).toEqual([null, null, null, null]);
    const md = renderPageMarkdown(pageOrThrow('fr', 'confidentialite'));
    expect(md).toContain("Dossiers F115, F211, F112 et F118 en cours d'enregistrement auprès de la CNDP par SYNAPTIC SYSTEMS SARL AU (dpo@fisca.ma)");
    expect(md).not.toContain('à renseigner par le propriétaire');
    expect(md).not.toMatch(/(récépissé|autorisation)[^\n]*\b\d{3,}\b/i);
  });

  it('mention CNDP traduite : en, ar, ary ; zgh = français', () => {
    expect(cndpRegistrationNotice('en')).toBe('Files F115, F211, F112 and F118 are being registered with the CNDP by SYNAPTIC SYSTEMS SARL AU (dpo@fisca.ma)');
    for (const l of ['ar', 'ary'] as const) {
      expect(cndpRegistrationNotice(l)).toContain('SYNAPTIC SYSTEMS SARL AU (dpo@fisca.ma)');
      expect(cndpRegistrationNotice(l)).toMatch(/[\u0600-\u06FF]/);
    }
    expect(cndpRegistrationNotice(copyLocaleOf('zgh-Latn'))).toBe(cndpRegistrationNotice('fr'));
    expect(cndpRegistrationNotice(copyLocaleOf('zgh-Tfng'))).toBe(cndpRegistrationNotice('fr'));
  });

  it('mesure d’audience décrite telle qu’implémentée dans les 4 langues, sans « un jour » ni promesse de plus', () => {
    const expected: Readonly<Record<'fr' | 'en' | 'ar' | 'ary', RegExp>> = {
      fr: /compteurs quotidiens agrégés.*ni adresse IP, ni identifiant individuel, ni cookie.*robots et les chemins techniques ne sont pas comptés/,
      en: /aggregated daily counters.*no IP address, no individual identifier and no cookie.*robots and technical paths are not counted/,
      ar: /عدادات يومية مجمعة.*عنوان IP.*معرف فردي.*ملف تعريف ارتباط.*الروبوتات/,
      ary: /عدادات يومية مجمعة.*عنوان IP.*معرف فردي.*كوكي.*الروبوتات/,
    };
    for (const loc of ['fr', 'en', 'ar', 'ary'] as const) {
      const items = buildPrivacyView(loc).copy.cookies.items.join('\n');
      expect(items, loc).toMatch(expected[loc]);
      expect(items, loc).not.toMatch(/un jour|ever enabled|يوما ما|شي نهار/);
    }
  });

  it('durées de conservation fixées par le propriétaire (2026-11-14)', () => {
    const rules = Object.fromEntries(CONTROLLER_PROCESSINGS.map((p) => [p.id, p.retention]));
    expect(rules['T-01']).toEqual({ kind: 'CONTRACT_PLUS_MONTHS', monthsAfterClosure: 12, securityLogsRollingMonths: 12, otpChallengeMinutes: 10 });
    expect(rules['T-02']).toEqual({ kind: 'CONTRACT_PLUS_YEARS_AFTER_LAST_FISCAL_YEAR', years: 10 });
    expect(rules['T-03']).toEqual({ kind: 'INVOICES_YEARS_PLUS_TOKEN_PURGE', invoiceYears: 10 });
    expect(rules['T-04']).toEqual({ kind: 'CACHE_DAYS_PLUS_AUDIT_ARCHIVE', cacheDays: 30, auditArchiveMonths: 12 });
    const byId = Object.fromEntries(buildPrivacyView('fr').processings.map((p) => [p.id, p.retention]));
    expect(byId['T-01']).toBe('Contrat actif, puis 12 mois après clôture ; journaux de sécurité : 12 mois glissants ; défis OTP/MFA : 10 minutes.');
    expect(byId['T-02']).toContain('10 ans après la clôture du dernier exercice concerné (article 211 du CGI, loi n° 9-88)');
    expect(byId['T-03']).toBe('Factures : 10 ans après clôture ; jeton monétique Payzone : purgé dès la résiliation soldée.');
    expect(byId['T-04']).toBe('Cache actif : 30 jours, puis archive restreinte d’audit et de contestation : 12 mois.');
    for (const loc of ['fr', 'en', 'ar', 'ary'] as const) {
      for (const p of buildPrivacyView(loc).processings) expect(p.retention, `${loc}/${p.id}`).not.toMatch(/renseigner|filled in|يملؤ|يعمر/);
    }
    expect(buildPrivacyView('en').processings[3]?.retention).toBe('Active cache: 30 days, then a restricted audit and dispute archive: 12 months.');
  });
});
