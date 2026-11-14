import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ToolPage from '../src/pages/[locale]/outils/[tool].astro';
import { findEditorialPage, mirrorPathOf } from '../src/content/pages.ts';
import { LOCALE_URL_PREFIX, MARKETING_LOCALES } from '../src/i18n/locales.ts';
import type { MarketingLocale } from '../src/i18n/locales.ts';
import { copyLocaleOf } from '../src/i18n/copy-locale.ts';
import { COMMON } from '../src/tools/copy/common.ts';
import { validatorUiCopy } from '../src/tools/copy/ubl-fec-ui.ts';
import { basisSentence, conventionSection, conventionsFor, TOOL_CONVENTIONS, TURNSTILE_DEV_NOTE } from '../src/tools/conventions.ts';
import type { ConventionId, ConventionTool } from '../src/tools/conventions.ts';
import { buildToolView, buildToolsHubView, TOOL_PAGES } from '../src/tools/registry.ts';
import { handleLlmsFullTxt, handleLlmsTxt, handleMirrorRequest, handleSitemapXml } from '../src/seo/handlers.ts';
import { renderPageMarkdown } from '../src/seo/mirror.ts';

const SEGMENT = 'validateur-ubl-fec';
const FIRST_PARTY_HOST = /^https:\/\/([a-z0-9-]+\.)?fisca\.ma(\/|$)/;

const cache = new Map<MarketingLocale, { html: string; response: Response }>();
async function render(locale: MarketingLocale, segment: string): Promise<{ html: string; response: Response }> {
  const hit = segment === SEGMENT ? cache.get(locale) : undefined;
  if (hit !== undefined) return hit;
  const container = await AstroContainer.create();
  const prefix = LOCALE_URL_PREFIX[locale];
  const response = await container.renderToResponse(ToolPage, { params: { locale: prefix, tool: segment }, request: new Request(`https://fisca.ma/${prefix}/outils/${segment}`) });
  const html = (await response.clone().text()).replace(/ data-astro-source-(?:file|loc)="[^"]*"/g, '');
  const out = { html, response };
  if (segment === SEGMENT) cache.set(locale, out);
  return out;
}

describe('page /outils/validateur-ubl-fec : 6 langues', () => {
  it('registre, miroir .md, hub, sitemap (6 langues, x-default), llms.txt, llms-full.txt', async () => {
    const sitemap = await handleSitemapXml().text();
    for (const locale of MARKETING_LOCALES) {
      const prefix = LOCALE_URL_PREFIX[locale];
      const page = findEditorialPage(locale, `outils/${SEGMENT}`);
      expect(page, locale).toBeDefined();
      expect(mirrorPathOf(page ?? TOOL_PAGES[0]!)).toBe(`/${prefix}/outils/${SEGMENT}.md`);
      const mirror = handleMirrorRequest(new Request(`https://fisca.ma/${prefix}/outils/${SEGMENT}.md`));
      expect(mirror?.status).toBe(200);
      expect(sitemap).toContain(`<loc>https://fisca.ma/${prefix}/outils/${SEGMENT}</loc>`);
      const hub = buildToolsHubView(locale);
      expect(hub.entries).toHaveLength(6);
      expect(hub.entries.map((e) => e.href)).toContain(`/${prefix}/outils/${SEGMENT}`);
    }
    expect(sitemap).toContain(`hreflang="x-default" href="https://fisca.ma/fr/outils/${SEGMENT}"`);
    expect(await handleLlmsTxt().text()).toContain(`/fr/outils/${SEGMENT}.md`);
    expect(await handleLlmsFullTxt().text()).toContain(`/fr/outils/${SEGMENT}.md`);
  });

  it('HTML : 200, lang/dir, 7 hreflang, JSON-LD HowTo et FAQPage, un seul h1', async () => {
    for (const locale of MARKETING_LOCALES) {
      const { html, response } = await render(locale, SEGMENT);
      expect(response.status, locale).toBe(200);
      expect((html.match(/rel="alternate" hreflang="/g) ?? []).length).toBe(7);
      expect((html.match(/<h1/g) ?? []).length).toBe(1);
      const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
      expect(ld).toContain('"HowTo"');
      expect(ld).toContain('"FAQPage"');
      expect(html).toContain(`<link rel="canonical" href="https://fisca.ma/${LOCALE_URL_PREFIX[locale]}/outils/${SEGMENT}"`);
    }
    expect((await render('ar', SEGMENT)).html).toContain('dir="rtl"');
  });

  it('aucun cookie, aucun script externe ou tiers, aucun envoi : scripts = JSON-LD ou module du site', async () => {
    for (const locale of MARKETING_LOCALES) {
      const { html, response } = await render(locale, SEGMENT);
      expect(response.headers.get('set-cookie')).toBeNull();
      for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const attrs = m[1] ?? '';
        if (attrs.includes('application/ld+json')) continue;
        expect(attrs, locale).toMatch(/type="module"/);
        expect(m[2] ?? '', locale).not.toMatch(/document\.cookie|localStorage|sessionStorage|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|https?:\/\//);
      }
      expect(html).not.toMatch(/(googletagmanager|google-analytics|doubleclick|hotjar|clarity\.ms|plausible|matomo|turnstile|challenges\.cloudflare|cdn\.)/i);
      for (const m of html.matchAll(/(?:href|src|action)="(https?:\/\/[^"]+)"/g)) expect(m[1] ?? '', locale).toMatch(FIRST_PARTY_HOST);
      expect(html).not.toMatch(/<form[^>]+action=/i);
      expect(html).not.toMatch(/<(iframe|img|video|audio|embed|object)/i);
    }
  });

  it('mention « contrôle de structure indicatif, pas une validation DGI » dans chaque langue ; information indicative ; traitement local', async () => {
    for (const locale of MARKETING_LOCALES) {
      const loc = copyLocaleOf(locale);
      const { html } = await render(locale, SEGMENT);
      expect(html, locale).toContain(validatorUiCopy(loc).indicativeBanner.replace(/&/g, '&#38;').replace(/’/g, '’'));
      expect(html).toContain(COMMON.disclaimer[loc]);
      expect(html).toContain(COMMON.localProcessing[loc]);
      expect(html).toMatch(/15-89/);
    }
    expect(validatorUiCopy('fr').indicativeBanner).toBe('Contrôle de structure indicatif, pas une validation DGI.');
    for (const locale of ['zgh-Latn', 'zgh-Tfng'] as const) {
      const { html } = await render(locale, SEGMENT);
      expect(html).toContain('<body lang="fr">');
      expect(html).toContain('class="notice"');
      expect(html).toContain(COMMON.disclaimer.fr);
    }
  });

  it('jamais « conforme / homologué / certifié » associé à la DGI ou xHub, ni validation XSD annoncée, dans pages, miroirs et textes d’interface', () => {
    const forbidden = /(conforme|homologu|certifi)[^.\n]{0,60}(DGI|xHub)|(DGI|xHub)[^.\n]{0,60}(conforme|homologu|certifi)/i;
    for (const p of TOOL_PAGES) {
      expect(JSON.stringify(p) + renderPageMarkdown(p), `${p.locale}/${p.slug}`).not.toMatch(forbidden);
    }
    for (const loc of ['fr', 'en', 'ar', 'ary'] as const) {
      expect(JSON.stringify(validatorUiCopy(loc)), loc).not.toMatch(forbidden);
      expect(JSON.stringify(validatorUiCopy(loc)), loc).not.toMatch(/validé par la DGI|validated by the DGI|XSD valid/i);
    }
  });

  it('dit sur la page : profil provisoire cius-ma-provisional, schémas officiels non publiés (B-13), Factur-X et PDF non supportés, empreintes non vérifiées', () => {
    const fr = buildToolView('fr', 'ubl-fec');
    const text = JSON.stringify(fr) + JSON.stringify(validatorUiCopy('fr'));
    expect(text).toContain('cius-ma-provisional');
    expect(text).toMatch(/schémas officiels[^"]{0,80}ne sont pas publiés/);
    expect(text).toMatch(/Factur-X/);
    expect(text).toMatch(/PDF/);
    expect(text).toMatch(/non pris en charge|ne sont pas pris en charge/);
    expect(text).toMatch(/NON vérifiée|non vérifiée/);
    expect(text).toContain('profil provisoire');
    expect(text).toMatch(/ERRATA B-13/);
    expect(text).toContain('arrêté du 29 juillet 2013, art. A47 A-1 du LPF');
    expect(fr.params.map((p) => p.state)).toEqual(['PROVISOIRE', 'PROVISOIRE']);
    expect(fr.params.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.as_of))).toBe(true);
    expect(text).not.toMatch(/(seuil|threshold)[^.\n]{0,60}factur/i);
  });

  it('interface : champs étiquetés, zones annoncées, tableaux défilants (côté rendu), accept des deux entrées', async () => {
    for (const locale of MARKETING_LOCALES) {
      const { html } = await render(locale, SEGMENT);
      for (const id of ['fec-file', 'ubl-file', 'ubl-text']) expect(html, `${locale}/${id}`).toContain(`for="${id}"`);
      expect(html).toContain('accept=".txt,.csv,text/plain"');
      expect(html).toContain('accept=".xml,application/xml,text/xml"');
      expect(html).toMatch(/role="status" aria-live="polite" data-role="fec-status"/);
      expect(html).toMatch(/role="alert" data-role="ubl-error"/);
      expect(html).toContain('data-tool="ubl-fec"');
    }
  });

  it('copie d’interface : tous les codes d’anomalie et de contrôle ont un texte dans chaque langue', () => {
    for (const loc of ['fr', 'en', 'ar', 'ary'] as const) {
      const ui = validatorUiCopy(loc);
      expect(Object.keys(ui.fecIssues)).toHaveLength(19);
      expect(Object.keys(ui.ublChecks)).toHaveLength(15);
      expect(Object.keys(ui.ublDetails)).toHaveLength(12);
      for (const text of [...Object.values(ui.fecIssues), ...Object.values(ui.ublChecks), ...Object.values(ui.ublDetails), ...Object.values(ui.ublBasis)]) expect(text.length).toBeGreaterThan(1);
    }
  });
});

const EXPECTED_CONVENTIONS: Readonly<Record<ConventionId, { readonly tool: ConventionTool; readonly law: string | null }>> = {
  'late-started-months': { tool: 'loi', law: 'Loi 69-21' },
  'late-director-rate-plus-increment': { tool: 'loi', law: 'Loi 69-21' },
  'ras-attestation-six-months': { tool: 'ras', law: 'Art. 117 du CGI' },
  'ras-threshold-inclusive': { tool: 'ras', law: 'Art. 117 du CGI' },
  'ae-ir-rates': { tool: 'ae', law: null },
  'ae-client-threshold-withholding': { tool: 'ae', law: null },
  'mowakaba-eligibility-and-coverage': { tool: 'mowakaba', law: null },
};
const TO_CONFIRM = { fr: 'à confirmer par l’expert-comptable', en: 'to be confirmed by your chartered accountant' } as const;

describe('conventions de calcul rattachées à leur texte légal', () => {
  it('table typée : 7 conventions, chacune rattachée à la loi nommée par les spécifications ou « à confirmer »', () => {
    expect(TOOL_CONVENTIONS.map((c) => c.id).sort()).toEqual(Object.keys(EXPECTED_CONVENTIONS).sort());
    for (const c of TOOL_CONVENTIONS) {
      const expected = EXPECTED_CONVENTIONS[c.id];
      expect(c.tools, c.id).toEqual([expected.tool]);
      expect(c.specSources.length, c.id).toBeGreaterThan(0);
      expect(c.state, c.id).toBe('NON RECOUPÉ');
      if (expected.law === null) expect(c.basis.kind, c.id).toBe('TO_CONFIRM');
      else {
        expect(c.basis.kind, c.id).toBe('LAW');
        if (c.basis.kind === 'LAW') expect(c.basis.reference.fr, c.id).toBe(expected.law);
      }
    }
  });

  it('aucun article inventé : seul l’article 117 du CGI est nommé, la loi 69-21 reste sans article', () => {
    const named = new Set<string>();
    for (const c of TOOL_CONVENTIONS) {
      if (c.basis.kind === 'LAW') {
        expect(c.basis.articleNamed, c.id).toBe(c.basis.reference.fr.startsWith('Art. 117'));
        for (const loc of ['fr', 'en', 'ar', 'ary'] as const) for (const m of `${c.basis.reference[loc]} ${basisSentence(c, loc)}`.matchAll(/(?:Art\.|Article|المادة)\s*(\d+)/g)) named.add(m[1] ?? '');
      }
    }
    expect([...named]).toEqual(['117']);
    for (const c of TOOL_CONVENTIONS) for (const loc of ['fr', 'en', 'ar', 'ary'] as const) expect(c.label[loc], c.id).not.toMatch(/(?:Art\.|Article|المادة)\s*\d+/);
  });

  it('les points non nommés portent « à confirmer par l’expert-comptable » dans les 4 langues', () => {
    for (const c of TOOL_CONVENTIONS) {
      const needsConfirm = c.basis.kind === 'TO_CONFIRM' || !c.basis.articleNamed || c.confirmDetail;
      for (const loc of ['fr', 'en'] as const) {
        if (needsConfirm) expect(basisSentence(c, loc), `${c.id}/${loc}`).toContain(TO_CONFIRM[loc]);
      }
      if (needsConfirm) {
        expect(basisSentence(c, 'ar')).toContain('الخبير المحاسب');
        expect(basisSentence(c, 'ary')).toContain('الخبير المحاسب');
      }
    }
    expect(conventionSection('loi', 'fr').bullets?.join(' ')).toContain('article non précisé');
  });

  it('chaque page d’outil concernée rend ses conventions et leur base légale (HTML, 6 langues, et miroir Markdown)', async () => {
    const segments: Readonly<Record<ConventionTool, string>> = { loi: 'simulateur-loi-69-21', ras: 'ras-tva-especes', ae: 'simulateur-auto-entrepreneur', mowakaba: 'subvention-mowakaba' };
    for (const locale of MARKETING_LOCALES) {
      const loc = copyLocaleOf(locale);
      for (const tool of Object.keys(segments) as ConventionTool[]) {
        const view = buildToolView(locale, tool);
        const section = view.sections.at(-1);
        expect(section?.bullets, `${locale}/${tool}`).toHaveLength(conventionsFor(tool).length);
        const { html } = await render(locale, segments[tool]);
        const text = html.replace(/<[^>]+>/g, ' ').replace(/&#38;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
        for (const c of conventionsFor(tool)) expect(text, `${locale}/${c.id}`).toContain(basisSentence(c, loc).replace(/\s+/g, ' ').replace(/’/g, '’'));
      }
    }
    const md = renderPageMarkdown(findEditorialPage('fr', 'outils/ras-tva-especes') ?? TOOL_PAGES[0]!);
    expect(md).toContain('Base légale : Art. 117 du CGI');
    const ae = renderPageMarkdown(findEditorialPage('fr', 'outils/simulateur-auto-entrepreneur') ?? TOOL_PAGES[0]!);
    expect(ae).toContain('Base légale : à confirmer par l’expert-comptable.');
    const loi = renderPageMarkdown(findEditorialPage('fr', 'outils/simulateur-loi-69-21') ?? TOOL_PAGES[0]!);
    expect(loi).toContain('Base légale : Loi 69-21');
    expect(loi).toContain('Mois entamés');
    expect(loi).toContain('85 points de base par mois supplémentaire');
    const mow = renderPageMarkdown(findEditorialPage('fr', 'outils/subvention-mowakaba') ?? TOOL_PAGES[0]!);
    expect(mow).toContain('Mowakaba : éligibilité');
    const rasMd = renderPageMarkdown(findEditorialPage('fr', 'outils/ras-tva-especes') ?? TOOL_PAGES[0]!);
    expect(rasMd).toContain('Seuil d’exclusion inclusif');
    expect(rasMd).toContain('6 mois');
  });

  it('note de développement Turnstile : dans conventions.ts, jamais affichée ni dans le HTML, ni dans un miroir, ni dans llms', async () => {
    expect(TURNSTILE_DEV_NOTE).toBe('Cloudflare Turnstile : à brancher en P4 (secret côté serveur)');
    for (const locale of MARKETING_LOCALES) {
      const { html } = await render(locale, SEGMENT);
      expect(html.toLowerCase()).not.toContain('turnstile');
    }
    for (const p of TOOL_PAGES) expect((JSON.stringify(p) + renderPageMarkdown(p)).toLowerCase(), `${p.locale}/${p.slug}`).not.toContain('turnstile');
    expect((await handleLlmsFullTxt().text()).toLowerCase()).not.toContain('turnstile');
  });
});
