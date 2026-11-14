import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import SiloRoute from '../src/pages/[locale]/[...slug].astro';
import { ALL_EDITORIAL_PAGES, findEditorialPage, mirrorPathOf } from '../src/content/pages.ts';
import { PRICING_CATALOG_OFFERS, PRICING_PLANS } from '../src/content/pricing.ts';
import { CGNC_ACCOUNTS } from '../src/content/cgnc/dataset.ts';
import type { CgncAccountRecord } from '../src/content/cgnc/dataset.ts';
import { buildCgncAccountView, buildCgncHubView, cgncMarkdownSections } from '../src/content/cgnc/build.ts';
import type { CgncAccountView } from '../src/content/cgnc/build.ts';
import { ANALYTIC_NOTE, CGNC_HUB_SLUG, CODE_EDI_PENDING, COUNTER, HISTORICAL_LABEL, PROVENANCE, accountSlug } from '../src/content/cgnc/copy.ts';
import { CGNC_ACCOUNT_SLUGS, CGNC_CONTRACT, CGNC_PAGES, buildCgncPages } from '../src/content/cgnc/registry.ts';
import { buildCanonicalUrl } from '../src/i18n/hreflang.ts';
import { LOCALE_URL_PREFIX, MARKETING_LOCALES } from '../src/i18n/locales.ts';
import type { MarketingLocale } from '../src/i18n/locales.ts';
import { buildLlmsFullTxt, buildLlmsTxt } from '../src/seo/llms.ts';
import { handleLlmsFullTxt, handleLlmsTxt, handleMirrorRequest, handleSitemapXml, selectLlmsIndex, selectPublished } from '../src/seo/handlers.ts';
import { buildSitemapXml, publishedSitemapSlugs } from '../src/seo/sitemap.ts';

const INDEXED = ['fr', 'ar', 'en'] as const;
const OTHER: readonly MarketingLocale[] = ['ary', 'zgh-Latn', 'zgh-Tfng'];
const FIRST = CGNC_ACCOUNTS[0] as CgncAccountRecord;

async function render(locale: MarketingLocale, slug: string): Promise<{ html: string; status: number }> {
  const container = await AstroContainer.create();
  const prefix = LOCALE_URL_PREFIX[locale];
  const response = await container.renderToResponse(SiloRoute, {
    params: { locale: prefix, slug },
    request: new Request(`https://fisca.ma/${prefix}/${slug}`),
  });
  return { html: await response.text(), status: response.status };
}

function mainOf(html: string): string {
  const start = html.indexOf('<main');
  const end = html.indexOf('</main>');
  return start < 0 || end < 0 ? html : html.slice(start, end);
}

const XSD_PHRASES: readonly string[] = [CODE_EDI_PENDING.fr, CODE_EDI_PENDING.ar, CODE_EDI_PENDING.en];

function stripXsdPhrase(text: string): string {
  let out = text;
  for (const p of XSD_PHRASES) out = out.replaceAll(p, '');
  return out;
}

function stripMoney(text: string): string {
  return text.replace(/\d[\d ]*,\d{2} MAD/g, '');
}

const FORBIDDEN = /officiel|official|certifi|certified|authentique|authentic|رسمي|رسمية|معتمد|أصلي|أصيل|conforme|homologu|compliant/i;
const NUMERIC_CODE_EDI = /codeEdi(?:\s+SIMPL-IS)?\s*[:=]\s*[\p{N}]|codeEdi[^\p{L}]{0,6}[\p{N}]/u;

function siteViews(locale: MarketingLocale): readonly CgncAccountView[] {
  return CGNC_ACCOUNTS.map((a) => buildCgncAccountView(locale, a));
}

describe('Silo 3 : routes, slugs, comptes', () => {
  it('hub /<locale>/dictionnaire-cgnc et 61 fiches /compte-<numéro> dans les 6 langues (372 pages)', () => {
    expect(CGNC_HUB_SLUG).toBe('dictionnaire-cgnc');
    expect(CGNC_PAGES).toHaveLength(6 + 61 * 6);
    expect(CGNC_ACCOUNT_SLUGS).toHaveLength(61);
    expect(CGNC_ACCOUNT_SLUGS[0]).toBe('dictionnaire-cgnc/compte-1111');
    expect(accountSlug('44558')).toBe('compte-44558');
    expect(new Set(CGNC_ACCOUNT_SLUGS).size).toBe(61);
    for (const slug of [CGNC_HUB_SLUG, ...CGNC_ACCOUNT_SLUGS]) {
      expect(slug).toMatch(/^[a-z0-9-]+(?:\/[a-z0-9-]+)?$/);
      for (const locale of MARKETING_LOCALES) expect(findEditorialPage(locale, slug), `${locale}/${slug}`).toBeDefined();
    }
    expect(ALL_EDITORIAL_PAGES).toHaveLength(18 + 24 + 468 + 42 + 372);
  });

  it('183 fiches indexables (61 x fr, ar, en) ; ary, zgh et zgh-tfng servies en noindex ; hub indexable partout', () => {
    for (const slug of CGNC_ACCOUNT_SLUGS) {
      for (const locale of INDEXED) expect(findEditorialPage(locale, slug)?.noindex, `${locale}/${slug}`).toBe(false);
      for (const locale of OTHER) expect(findEditorialPage(locale, slug)?.noindex, `${locale}/${slug}`).toBe(true);
    }
    const indexable = CGNC_PAGES.filter((p) => p.slug !== CGNC_HUB_SLUG && p.noindex === false);
    expect(indexable).toHaveLength(183);
    for (const locale of MARKETING_LOCALES) expect(findEditorialPage(locale, CGNC_HUB_SLUG)?.noindex).toBe(false);
  });

  it('langue du texte : ary lit l’arabe, zgh-Latn et zgh-Tfng lisent le français', () => {
    expect(findEditorialPage('ary', CGNC_ACCOUNT_SLUGS[0] ?? '')?.contentLanguage).toBe('ar');
    expect(findEditorialPage('zgh-Latn', CGNC_ACCOUNT_SLUGS[0] ?? '')?.contentLanguage).toBe('fr');
    expect(findEditorialPage('zgh-Tfng', CGNC_HUB_SLUG)?.contentLanguage).toBe('fr');
    expect(findEditorialPage('ar', CGNC_HUB_SLUG)?.contentLanguage).toBe('ar');
  });
});

describe('gabarit Answer-First', () => {
  it('verdict de 40 à 60 mots, tableau de moins de 5 colonnes, dans les 3 langues, pour les 61 comptes', () => {
    for (const locale of INDEXED) {
      for (const v of siteViews(locale)) {
        expect(v.verdictWords, `${locale}/${v.accountNumber}`).toBeGreaterThanOrEqual(40);
        expect(v.verdictWords, `${locale}/${v.accountNumber}`).toBeLessThanOrEqual(60);
        expect(v.table.columns.length).toBeLessThan(5);
        expect(v.table.rows.length).toBeGreaterThanOrEqual(3);
        expect(v.faqs.length).toBeGreaterThanOrEqual(2);
        expect(v.quality.missing, `${locale}/${v.accountNumber}`).toEqual([]);
      }
    }
  });

  it('verdicts, titres et descriptions tous distincts (pas de pages dupliquées)', () => {
    for (const locale of INDEXED) {
      const views = siteViews(locale);
      expect(new Set(views.map((v) => v.verdict)).size, locale).toBe(61);
      expect(new Set(views.map((v) => v.title)).size, locale).toBe(61);
      expect(new Set(views.map((v) => v.description)).size, locale).toBe(61);
      expect(new Set(views.map((v) => v.faqs[0]?.answer)).size, locale).toBe(61);
    }
  });

  it('chaque verdict nomme le numéro du compte, son intitulé du jeu, le sens normal et la rubrique', () => {
    for (const a of CGNC_ACCOUNTS) {
      const fr = buildCgncAccountView('fr', a).verdict;
      expect(fr).toContain(a.account_number);
      expect(fr).toContain(a.label_fr);
      expect(fr).toContain(a.normal_balance === 'DEBIT' ? 'débiteur' : 'créditeur');
      expect(buildCgncAccountView('en', a).verdict).toContain(a.label_en);
      expect(buildCgncAccountView('ar', a).verdict).toContain(a.label_ar);
    }
  });

  it('cas chiffré = l’écriture d’exemple du jeu, en centimes formatés, débits = crédits = total', () => {
    for (const a of CGNC_ACCOUNTS) {
      const v = buildCgncAccountView('fr', a);
      const debit = v.entry.lines.reduce((s, l) => s + (l.debitCents ?? 0), 0);
      const credit = v.entry.lines.reduce((s, l) => s + (l.creditCents ?? 0), 0);
      expect(debit, a.account_number).toBe(a.sample_entry.total_cents);
      expect(credit, a.account_number).toBe(a.sample_entry.total_cents);
      expect(v.entry.totalCents).toBe(a.sample_entry.total_cents);
      expect(v.steps).toHaveLength(a.sample_entry.lines.length);
    }
  });
});

describe('codeEdi SIMPL-IS, provenance, mots interdits, « 250 »', () => {
  it('phrase imposée, traduite en ar et en, présente sur chaque fiche, hub, miroir', () => {
    expect(CODE_EDI_PENDING.fr).toBe('codeEdi SIMPL-IS : en attente d’import du référentiel XSD officiel DGI');
    expect(CODE_EDI_PENDING.en).toContain('codeEdi SIMPL-IS');
    expect(CODE_EDI_PENDING.ar).toContain('codeEdi SIMPL-IS');
    for (const page of CGNC_PAGES) {
      const text = `${page.lead} ${page.sections.map((s) => `${s.heading} ${s.body}`).join(' ')}`;
      const loc = page.contentLanguage === 'ary' ? 'ar' : page.contentLanguage;
      expect(text, `${page.locale}/${page.slug}`).toContain(CODE_EDI_PENDING[loc === 'ar' || loc === 'en' ? loc : 'fr']);
    }
  });

  it('aucun codeEdi chiffré dans les pages (HTML, miroir Markdown, llms, JSON-LD)', async () => {
    const texts: string[] = [];
    for (const page of CGNC_PAGES) texts.push(JSON.stringify(page));
    texts.push(await handleLlmsTxt().text(), await handleLlmsFullTxt().text());
    for (const locale of MARKETING_LOCALES) {
      texts.push((await render(locale, CGNC_ACCOUNT_SLUGS[10] ?? '')).html, (await render(locale, CGNC_HUB_SLUG)).html);
    }
    for (const text of texts) expect(text).not.toMatch(NUMERIC_CODE_EDI);
    expect(CODE_EDI_PENDING.fr).not.toMatch(NUMERIC_CODE_EDI);
  });

  it('aucun « officiel », « certifié » ni « authentique » hors de la phrase XSD officiel DGI (3 langues, HTML et miroirs)', async () => {
    for (const page of CGNC_PAGES) {
      const text = stripXsdPhrase(JSON.stringify(page));
      expect(text, `${page.locale}/${page.slug}`).not.toMatch(FORBIDDEN);
    }
    for (const locale of MARKETING_LOCALES) {
      for (const slug of [CGNC_HUB_SLUG, ...CGNC_ACCOUNT_SLUGS.slice(0, 12)]) {
        const { html } = await render(locale, slug);
        expect(stripXsdPhrase(mainOf(html)), `${locale}/${slug}`).not.toMatch(FORBIDDEN);
      }
    }
    for (const loc of ['fr', 'ar', 'en'] as const) expect(stripXsdPhrase(PROVENANCE[loc])).not.toMatch(FORBIDDEN);
    expect(PROVENANCE.fr).toBe('Plan comptable marocain (CGNC) — fiche pédagogique, à vérifier auprès de votre expert-comptable');
  });

  it('la phrase de provenance figure sur chaque fiche et sur le hub', () => {
    for (const locale of INDEXED) {
      for (const v of siteViews(locale)) expect(v.provenance).toBe(PROVENANCE[locale]);
      expect(buildCgncHubView(locale).provenance).toBe(PROVENANCE[locale]);
    }
  });

  it('« 250 » n’est jamais une promesse : ni pages, ni llms, ni contrat ; le compteur est 61 + 190 après G4', async () => {
    const all = [JSON.stringify(CGNC_PAGES), await handleLlmsTxt().text(), await handleLlmsFullTxt().text(), JSON.stringify(CGNC_CONTRACT)];
    for (const text of all) {
      expect(stripMoney(text)).not.toMatch(/(?<![\d,.])250(?![\d])/);
      expect(text).not.toMatch(/top\s*250/i);
      expect(text).not.toMatch(/\b60\s+(comptes|core accounts|حساب)|57\s*\+\s*3|58\s*\+\s*3/i);
    }
    expect(COUNTER.fr).toBe('61 comptes piliers, 190 sous-comptes sectoriels à enrichir après G4');
    expect(COUNTER.en).toBe('61 core accounts, 190 sector sub-accounts to be enriched after G4');
    expect(COUNTER.ar).toContain('61');
    expect(CGNC_CONTRACT.status).toBe('PROVISIONAL');
    expect(CGNC_CONTRACT.coreAccounts + CGNC_CONTRACT.sectorSubAccountsToEnrich).toBe(251);
    expect(CGNC_CONTRACT.coreAccounts).toBe(61);
    expect(CGNC_CONTRACT.indexedUrls).toBe(183);
    expect(CGNC_CONTRACT.dataset).toBe('FISCA_CGNC_CORE_V2');
  });

  it('le compteur s’affiche sur le hub (description, HTML, JSON-LD) et dans llms.txt, llms-full.txt, dans les 3 langues', async () => {
    const llms = await handleLlmsTxt().text();
    const full = await handleLlmsFullTxt().text();
    for (const locale of INDEXED) {
      expect(buildCgncHubView(locale).description).toContain(COUNTER[locale]);
      const { html } = await render(locale, CGNC_HUB_SLUG);
      expect(html).toContain(COUNTER[locale]);
      const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '';
      expect(JSON.parse(ld)['@graph'].some((n: { description?: string }) => n.description?.includes(COUNTER[locale]))).toBe(true);
      expect(llms).toContain(COUNTER[locale]);
      expect(full).toContain(COUNTER[locale]);
    }
  });
});

describe('comptes cités sans fiche : numéro seul, ni lien ni intitulé fabriqué', () => {
  const ABSENT = ['4481', '6114', '6193', '6195', '6701', '8600'];

  function fabricated(view: CgncAccountView): string[] {
    const known = new Set(CGNC_ACCOUNTS.map((a) => a.account_number));
    return view.entry.lines.filter((l) => !known.has(l.account) && (l.label !== null || l.href !== null)).map((l) => l.account);
  }

  it('aucune écriture ne fabrique un lien ou un intitulé pour un compte absent du jeu (3 langues)', () => {
    let seen = 0;
    for (const locale of INDEXED) {
      for (const v of siteViews(locale)) {
        expect(fabricated(v), `${locale}/${v.accountNumber}`).toEqual([]);
        seen += v.entry.lines.filter((l) => ABSENT.includes(l.account)).length;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('le détecteur échoue si un intitulé ou un lien est fabriqué', () => {
    const base = buildCgncAccountView('fr', CGNC_ACCOUNTS.find((a) => a.account_number === '2321') ?? FIRST);
    const withLabel: CgncAccountView = { ...base, entry: { ...base.entry, lines: base.entry.lines.map((l) => (l.account === '4481' ? { ...l, label: 'Fournisseurs d’immobilisations' } : l)) } };
    const withLink: CgncAccountView = { ...base, entry: { ...base.entry, lines: base.entry.lines.map((l) => (l.account === '4481' ? { ...l, href: '/fr/dictionnaire-cgnc/compte-4481' } : l)) } };
    expect(fabricated(base)).toEqual([]);
    expect(fabricated(withLabel)).toEqual(['4481']);
    expect(fabricated(withLink)).toEqual(['4481']);
  });

  it('HTML et miroir de la fiche 2321 : 4481 en numéro nu ; 34558 lié vers sa fiche', async () => {
    const { html } = await render('fr', 'dictionnaire-cgnc/compte-2321');
    expect(html).toContain('4481');
    expect(html).not.toContain('compte-4481');
    expect(html).toContain('href="/fr/dictionnaire-cgnc/compte-34558"');
    const md = await handleMirrorRequest(new Request('https://fisca.ma/fr/dictionnaire-cgnc/compte-2321.md'))?.text();
    expect(md).toContain('- 4481 —');
    expect(md).not.toContain('compte-4481');
    expect(md).toContain('[34558](/fr/dictionnaire-cgnc/compte-34558)');
    for (const n of ABSENT) expect(findEditorialPage('fr', `dictionnaire-cgnc/compte-${n}`)).toBeUndefined();
  });

  it('tout compte lié pointe vers une fiche existante du registre', () => {
    for (const v of siteViews('en')) {
      for (const l of v.entry.lines) if (l.href !== null) expect(findEditorialPage('en', l.href.replace('/en/', '')), l.href).toBeDefined();
      for (const r of v.related) expect(findEditorialPage('en', r.href.replace('/en/', '')), r.href).toBeDefined();
    }
  });
});

describe('seuil de qualité Doc_18 S10 : les 61 fiches sont indexables, une fiche dégradée sort du sitemap et de llms', () => {
  it('sitemap : hub + 61 fiches, fr/ar/en seulement pour les fiches, 7 hreflang ; llms : arbre fr des 61 fiches', async () => {
    const slugs = publishedSitemapSlugs(ALL_EDITORIAL_PAGES);
    expect(slugs).toContain(CGNC_HUB_SLUG);
    for (const s of CGNC_ACCOUNT_SLUGS) expect(slugs, s).toContain(s);
    const xml = await handleSitemapXml().text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? '');
    expect(locs.filter((l) => l.includes('/compte-'))).toHaveLength(183);
    expect(locs.filter((l) => l.endsWith(`/${CGNC_HUB_SLUG}`))).toHaveLength(6);
    for (const p of ['ary', 'zgh', 'zgh-tfng']) expect(locs.some((l) => l.includes(`/${p}/${CGNC_HUB_SLUG}/compte-`))).toBe(false);
    const block = xml.split('<url>').find((b) => b.includes(`<loc>${buildCanonicalUrl('ar', CGNC_ACCOUNT_SLUGS[0] ?? '')}</loc>`)) ?? '';
    expect((block.match(/hreflang="/g) ?? []).length).toBe(7);
    const short = await handleLlmsTxt().text();
    const full = await handleLlmsFullTxt().text();
    for (const s of CGNC_ACCOUNT_SLUGS) {
      expect(short, s).toContain(`/fr/${s}`);
      expect(full, s).toContain(`/ar/${s}`);
      expect(full, s).not.toContain(`/ary/${s}`);
    }
    for (const locale of MARKETING_LOCALES) expect(short).toContain(`/${LOCALE_URL_PREFIX[locale]}/${CGNC_HUB_SLUG}`);
  });

  const target = `${CGNC_HUB_SLUG}/${accountSlug('1111')}`;

  function degraded(edit: (r: CgncAccountRecord) => CgncAccountRecord) {
    const accounts = CGNC_ACCOUNTS.map((a) => (a.account_number === '1111' ? edit(a) : a));
    const pages = buildCgncPages(accounts);
    const all = [...ALL_EDITORIAL_PAGES.filter((p) => !p.slug.startsWith(CGNC_HUB_SLUG)), ...pages];
    return { pages, all };
  }

  const CASES: readonly (readonly [string, (r: CgncAccountRecord) => CgncAccountRecord])[] = [
    ['écriture déséquilibrée', (r) => ({ ...r, sample_entry: { ...r.sample_entry, lines: r.sample_entry.lines.map((l, i) => (i === 0 ? { ...l, amount_cents: l.amount_cents + 1 } : l)) } })],
    ['total différent des lignes', (r) => ({ ...r, sample_entry: { ...r.sample_entry, total_cents: r.sample_entry.total_cents + 1 } })],
    ['sens du compte absent', (r) => ({ ...r, normal_balance: String('') as CgncAccountRecord['normal_balance'] })],
    ['règle de TVA absente', (r) => ({ ...r, vat_encaissement_rule: String('') as CgncAccountRecord['vat_encaissement_rule'] })],
  ];

  for (const [name, edit] of CASES) {
    it(`${name} : noindex dans les 6 langues, hors sitemap, hors llms.txt et llms-full.txt ; les 60 autres restent`, () => {
      const { pages, all } = degraded(edit);
      for (const locale of MARKETING_LOCALES) expect(pages.find((p) => p.locale === locale && p.slug === target)?.noindex, locale).toBe(true);
      const slugs = publishedSitemapSlugs(all);
      expect(slugs).not.toContain(target);
      expect(slugs.filter((s) => s.includes('/compte-'))).toHaveLength(60);
      expect(buildSitemapXml(all)).not.toContain(`/${target}`);
      const index = buildLlmsTxt(PRICING_PLANS, selectLlmsIndex(all), PRICING_CATALOG_OFFERS);
      const full = buildLlmsFullTxt(PRICING_PLANS, selectPublished(all), PRICING_CATALOG_OFFERS);
      expect(index).not.toContain(target);
      expect(full).not.toContain(target);
      expect(index).toContain('compte-1140');
      const mirror = pages.find((p) => p.locale === 'fr' && p.slug === target);
      expect(mirror?.sections.some((s) => s.body.includes('n’est pas indexée'))).toBe(true);
    });
  }

  it('la dégradation d’une seule langue (ar) retire aussi la fiche du sitemap', () => {
    const pages = ALL_EDITORIAL_PAGES.map((p) => (p.slug === target && p.locale === 'ar' ? { ...p, noindex: true } : p));
    expect(publishedSitemapSlugs(pages)).not.toContain(target);
  });
});

describe('HTML rendu : hub et fiches en fr, ar, en, ary, zgh et zgh-tfng', () => {
  const slugs = [CGNC_HUB_SLUG, 'dictionnaire-cgnc/compte-44558', 'dictionnaire-cgnc/compte-1111'];

  it('200, h1, canonical, 7 hreflang, JSON-LD valide (FAQPage, HowTo, Legislation), aucun script ni cookie tiers', async () => {
    for (const locale of MARKETING_LOCALES) {
      for (const slug of slugs) {
        const { html, status } = await render(locale, slug);
        const id = `${locale}/${slug}`;
        expect(status, id).toBe(200);
        expect(html, id).toContain('<h1');
        expect(html, id).toContain(`rel="canonical" href="${buildCanonicalUrl(locale, slug)}"`);
        expect((html.match(/rel="alternate" hreflang="/g) ?? []).length, id).toBe(7);
        const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
        expect(scripts.length, id).toBe(1);
        for (const m of scripts) {
          expect(m[1], id).toContain('application/ld+json');
          expect(m[1], id).not.toMatch(/\bsrc=/i);
        }
        const graph: { '@type': string }[] = JSON.parse(scripts[0]?.[2] ?? '{}')['@graph'];
        const types = graph.map((n) => n['@type']);
        for (const t of ['Organization', 'SoftwareApplication', 'WebPage']) expect(types, id).toContain(t);
        if (slug !== CGNC_HUB_SLUG) for (const t of ['FAQPage', 'HowTo', 'Legislation']) expect(types, id).toContain(t);
        expect(html, id).not.toMatch(/document\.cookie|googletagmanager|google-analytics|doubleclick|hotjar|plausible|fonts\.googleapis/i);
      }
    }
  });

  it('indexable en fr, ar, en ; noindex (meta et X-Robots-Tag du miroir) en ary, zgh et zgh-tfng ; hub toujours indexable', async () => {
    for (const locale of INDEXED) expect((await render(locale, slugs[1] ?? '')).html).not.toContain('noindex');
    for (const locale of OTHER) {
      const { html } = await render(locale, slugs[1] ?? '');
      expect(html).toContain('<meta name="robots" content="noindex, follow"');
      const page = findEditorialPage(locale, slugs[1] ?? '');
      const res = handleMirrorRequest(new Request(`https://fisca.ma${page === undefined ? '' : mirrorPathOf(page)}`));
      expect(res?.headers.get('x-robots-tag')).toBe('noindex, follow');
    }
    for (const locale of MARKETING_LOCALES) expect((await render(locale, CGNC_HUB_SLUG)).html).not.toContain('noindex');
  });

  it('repli français signalé en zgh : avis bilingue et texte français ; ary : arabe RTL', async () => {
    const zgh = await render('zgh-Latn', slugs[1] ?? '');
    expect(zgh.html).toContain('role="note"');
    expect(zgh.html).toContain(CODE_EDI_PENDING.fr);
    const ary = await render('ary', slugs[1] ?? '');
    expect(ary.html).toContain('dir="rtl"');
    expect(ary.html).toContain(CODE_EDI_PENDING.ar);
  });

  it('ar : RTL, montants et numéros en dir=ltr avec chiffres tabulaires, tableaux dans .table-scroll', async () => {
    const { html } = await render('ar', 'dictionnaire-cgnc/compte-44558');
    expect(html).toContain('dir="rtl"');
    expect(html).toMatch(/<span dir="ltr" class="fisca-tabular-num"[^>]*>[^<]*MAD<\/span>/);
    expect(html).toMatch(/class="fisca-tabular-num" dir="ltr"[^>]*>44558</);
    expect((html.match(/class="table-scroll"/g) ?? []).length).toBe(2);
  });

  it('la fiche expose verdict, tableau, écriture, sources Loi 9-88 et CGNC, FAQ, lien vers l’offre', async () => {
    const { html } = await render('fr', 'dictionnaire-cgnc/compte-44558');
    for (const needle of ['id="verdict"', 'id="fiche"', 'id="ecriture"', 'id="sources"', 'id="faq"', 'Loi n° 9-88', 'CGNC Maroc', 'href="/fr/tarifs"', '6 000,00 MAD']) {
      expect(html, needle).toContain(needle);
    }
  });

  it('hub : 61 liens de fiches groupés par les 8 classes ; fiche inconnue : 404', async () => {
    const { html } = await render('fr', CGNC_HUB_SLUG);
    expect((html.match(/href="\/fr\/dictionnaire-cgnc\/compte-\d+"/g) ?? []).length).toBe(61);
    expect((html.match(/<h3[^>]*>Classe \d/g) ?? []).length).toBe(8);
    expect((await render('fr', 'dictionnaire-cgnc/compte-4481')).status).toBe(404);
  });
});

describe('miroirs Markdown', () => {
  it('372 miroirs .md servis, sans balise HTML, avec le verdict et la phrase codeEdi', async () => {
    for (const page of CGNC_PAGES) {
      const res = handleMirrorRequest(new Request(`https://fisca.ma${mirrorPathOf(page)}`));
      expect(res?.status, mirrorPathOf(page)).toBe(200);
    }
    const body = (await handleMirrorRequest(new Request('https://fisca.ma/en/dictionnaire-cgnc/compte-44558.md'))?.text()) ?? '';
    expect(body).not.toMatch(/<[a-z][^>]*>/i);
    expect(body).toContain(CODE_EDI_PENDING.en);
    expect(body).toContain('## Verdict');
    expect(cgncMarkdownSections(buildCgncAccountView('fr', FIRST)).length).toBeGreaterThanOrEqual(8);
  });
});

const ALL_LOCALES: readonly MarketingLocale[] = MARKETING_LOCALES;
const ANALYTIC = CGNC_ACCOUNTS.filter((a) => !a.is_official_cgnc_base);
const SECTION_START = 'id="verdict"';
const SECTION_END = 'id="liees"';

/** Corps de la fiche sans la liste « Comptes liés » (qui cite légitimement le compte voisin). */
function ownBody(html: string): string {
  const start = html.indexOf(SECTION_START);
  const end = html.indexOf(SECTION_END);
  return start < 0 || end < 0 ? html : html.slice(start, end);
}

async function mirror(locale: MarketingLocale, slug: string): Promise<string> {
  const page = findEditorialPage(locale, slug);
  const res = handleMirrorRequest(new Request(`https://fisca.ma${page === undefined ? '' : mirrorPathOf(page)}`));
  return (await res?.text()) ?? '';
}

function withoutRelated(md: string, locale: MarketingLocale): string {
  const heading = CGNC_UI_RELATED[locale === 'ar' || locale === 'ary' ? 'ar' : locale === 'en' ? 'en' : 'fr'];
  const at = md.indexOf(`## ${heading}`);
  return at < 0 ? md : md.slice(0, at);
}
const CGNC_UI_RELATED = { fr: 'Comptes liés', en: 'Related accounts', ar: 'حسابات ذات صلة' } as const;

describe('V2 : comptes à base CGNC et subdivisions analytiques Fisca (aucun « officiel » pour un compte is_official_cgnc_base = false)', () => {
  it('le jeu compte exactement 3 subdivisions analytiques : 34558, 44551, 44558', () => {
    expect(ANALYTIC.map((a) => a.account_number)).toEqual(['34558', '44551', '44558']);
  });

  it('HTML (6 langues) et miroirs .md : aucun « officiel », « official », « certifié », « authentique » ni équivalent arabe, hors phrase XSD imposée', async () => {
    for (const a of ANALYTIC) {
      const slug = `${CGNC_HUB_SLUG}/${accountSlug(a.account_number)}`;
      for (const locale of ALL_LOCALES) {
        const { html } = await render(locale, slug);
        expect(stripXsdPhrase(mainOf(html)), `html ${locale}/${a.account_number}`).not.toMatch(FORBIDDEN);
        expect(stripXsdPhrase(await mirror(locale, slug)), `md ${locale}/${a.account_number}`).not.toMatch(FORBIDDEN);
        const page = findEditorialPage(locale, slug);
        expect(stripXsdPhrase(JSON.stringify(page)), `page ${locale}/${a.account_number}`).not.toMatch(FORBIDDEN);
      }
    }
  });

  it('llms.txt et llms-full.txt : les lignes des 3 subdivisions n’affichent jamais « officiel » (hors phrase XSD)', async () => {
    const llms = [await handleLlmsTxt().text(), await handleLlmsFullTxt().text()];
    for (const text of llms) {
      for (const a of ANALYTIC) {
        const lines = text.split('\n').filter((l) => l.includes(`compte-${a.account_number}`));
        expect(lines.length, a.account_number).toBeGreaterThan(0);
        for (const line of lines) expect(stripXsdPhrase(line), a.account_number).not.toMatch(FORBIDDEN);
      }
    }
  });

  it('mention imposée : « Subdivision analytique Fisca du compte <parent> (suivi de la TVA sur encaissement) » en fr, en et ar, dans le HTML et le miroir', async () => {
    expect(ANALYTIC_NOTE.fr).toBe('Subdivision analytique Fisca du compte {parent} (suivi de la TVA sur encaissement)');
    for (const a of ANALYTIC) {
      const parent = a.parent_cgnc_account ?? '';
      expect(parent).toMatch(/^(3455|4455)$/);
      const slug = `${CGNC_HUB_SLUG}/${accountSlug(a.account_number)}`;
      for (const locale of ['fr', 'en', 'ar'] as const) {
        const expected = ANALYTIC_NOTE[locale].replace('{parent}', parent);
        const view = buildCgncAccountView(locale, a);
        expect(view.analyticNote, `${locale}/${a.account_number}`).toBe(expected);
        expect(view.table.rows.some((r) => r[1] === expected)).toBe(true);
        expect((await render(locale, slug)).html, `${locale}/${a.account_number}`).toContain(expected);
        expect(await mirror(locale, slug), `${locale}/${a.account_number}`).toContain(expected);
        expect(view.title, `${locale}/${a.account_number}`).not.toMatch(/CGNC/);
      }
    }
    expect(buildCgncAccountView('fr', ANALYTIC[0] ?? FIRST).analyticNote).toBe('Subdivision analytique Fisca du compte 3455 (suivi de la TVA sur encaissement)');
    expect(ANALYTIC_NOTE.ar).toContain('{parent}');
    expect(ANALYTIC_NOTE.en).toContain('Fisca');
  });

  it('les 58 autres comptes : fiche inchangée (provenance seule), sans mention analytique', async () => {
    const base = CGNC_ACCOUNTS.filter((a) => a.is_official_cgnc_base);
    expect(base).toHaveLength(58);
    for (const a of base) {
      for (const locale of INDEXED) {
        const v = buildCgncAccountView(locale, a);
        expect(v.analyticNote, `${locale}/${a.account_number}`).toBeNull();
        expect(v.provenance).toBe(PROVENANCE[locale]);
        expect(v.title).toMatch(/CGNC/);
      }
    }
    const { html } = await render('fr', 'dictionnaire-cgnc/compte-2321');
    expect(html).toContain(PROVENANCE.fr);
    expect(html).not.toContain('Subdivision analytique');
  });

  it('44525 : « libellé historique : État, IGR » (fr), traduit en en et ar avec « État, IGR » tel quel ; aucun autre compte ne l’affiche', async () => {
    const slug = `${CGNC_HUB_SLUG}/${accountSlug('44525')}`;
    const record = CGNC_ACCOUNTS.find((a) => a.account_number === '44525') ?? FIRST;
    expect(HISTORICAL_LABEL.fr).toBe('libellé historique : {label}');
    for (const locale of ['fr', 'en', 'ar'] as const) {
      const expected = HISTORICAL_LABEL[locale].replace('{label}', 'État, IGR');
      expect(buildCgncAccountView(locale, record).historicalNote).toBe(expected);
      expect((await render(locale, slug)).html, locale).toContain(expected);
      expect(await mirror(locale, slug), locale).toContain(expected);
      expect(expected).toContain('État, IGR');
    }
    expect(buildCgncAccountView('fr', record).historicalNote).toBe('libellé historique : État, IGR');
    expect(buildCgncAccountView('fr', record).analyticNote).toBeNull();
    for (const a of CGNC_ACCOUNTS.filter((x) => x.account_number !== '44525')) expect(buildCgncAccountView('fr', a).historicalNote).toBeNull();
  });
});

describe('V2 : 34551 sur immobilisations, 34552 sur charges, dans les 3 langues (HTML et miroir)', () => {
  const EXPECT = {
    '34551': {
      fr: { yes: ['sur immobilisations'], no: ['sur charges'] },
      en: { yes: ['on fixed assets'], no: ['on expenses', 'on operating expenses'] },
      ar: { yes: ['التثبيتات', 'المستقرات'], no: ['التحملات', 'التكاليف'] },
    },
    '34552': {
      fr: { yes: ['sur charges'], no: ['sur immobilisations'] },
      en: { yes: ['on expenses'], no: ['on fixed assets'] },
      ar: { yes: ['التحملات', 'التكاليف'], no: ['التثبيتات', 'المستقرات'] },
    },
  } as const;

  for (const number of ['34551', '34552'] as const) {
    it(`compte ${number}`, async () => {
      const slug = `${CGNC_HUB_SLUG}/${accountSlug(number)}`;
      for (const locale of ['fr', 'en', 'ar'] as const) {
        const { yes, no } = EXPECT[number][locale];
        const html = ownBody((await render(locale, slug)).html);
        const md = withoutRelated(await mirror(locale, slug), locale);
        for (const [kind, text] of [['html', html], ['md', md]] as const) {
          for (const y of yes) expect(text, `${kind} ${locale}/${number} contient ${y}`).toContain(y);
          for (const n of no) expect(text, `${kind} ${locale}/${number} ne contient pas ${n}`).not.toContain(n);
        }
      }
    });
  }

  it('les écritures citent le bon compte de TVA : 6125, 61473, 6311 → 34552 ; 3456, 4456 → 34552 en crédit ; 2321 reste en 34558', () => {
    const lines = (n: string): readonly string[] => (CGNC_ACCOUNTS.find((a) => a.account_number === n)?.sample_entry.lines ?? []).map((l) => l.account_number);
    for (const n of ['6125', '61473', '6311', '3456', '4456']) {
      expect(lines(n), n).toContain('34552');
      expect(lines(n), n).not.toContain('34551');
    }
    expect(lines('34551')).toEqual(['34551', '34558']);
    expect(lines('34552')).toEqual(['34552', '34558']);
  });

  it('chaque écriture rendue (fr, ar, en) est équilibrée en centimes entiers et son total égale total_cents', () => {
    for (const locale of INDEXED) {
      for (const v of siteViews(locale)) {
        const debit = v.entry.lines.reduce((sum, l) => sum + (l.debitCents ?? 0), 0);
        const credit = v.entry.lines.reduce((sum, l) => sum + (l.creditCents ?? 0), 0);
        const record = CGNC_ACCOUNTS.find((a) => a.account_number === v.accountNumber);
        expect(Number.isSafeInteger(debit) && Number.isSafeInteger(credit)).toBe(true);
        expect(debit, `${locale}/${v.accountNumber}`).toBe(credit);
        expect(debit, `${locale}/${v.accountNumber}`).toBe(record?.sample_entry.total_cents);
        expect(v.entry.lines.some((l) => l.account === v.accountNumber), `${locale}/${v.accountNumber} cite son compte`).toBe(true);
      }
    }
  });
});

describe('V2 : fiche 1161 et 1181', () => {
  it('1161 existe, indexable en fr, ar et en ; 1181 est « en instance d’affectation » ; l’écriture 1181 → 1161 est liée', async () => {
    for (const locale of INDEXED) {
      expect(findEditorialPage(locale, 'dictionnaire-cgnc/compte-1161')?.noindex, locale).toBe(false);
    }
    const fr = buildCgncAccountView('fr', CGNC_ACCOUNTS.find((a) => a.account_number === '1161') ?? FIRST);
    expect(fr.entry.lines.map((l) => l.account)).toEqual(['1181', '1161']);
    expect(fr.entry.lines.every((l) => l.href !== null)).toBe(true);
    const f1181 = buildCgncAccountView('fr', CGNC_ACCOUNTS.find((a) => a.account_number === '1181') ?? FIRST);
    expect(f1181.title).toContain('Résultats nets en instance d’affectation'.replace('’', "'"));
    expect((await render('ar', 'dictionnaire-cgnc/compte-1161')).status).toBe(200);
  });
});
