import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
import { describe, expect, it } from 'vitest';
import HomePage from '../src/pages/[locale]/index.astro';
import PricingPage from '../src/pages/[locale]/tarifs.astro';
import PrivacyPage from '../src/pages/[locale]/confidentialite.astro';
import { PRICING_CATALOG_OFFERS } from '../src/content/pricing.ts';
import { LOCALE_URL_PREFIX, MARKETING_LOCALES, getLocaleMeta } from '../src/i18n/locales.ts';
import type { MarketingLocale } from '../src/i18n/locales.ts';
import { formatCentsMad } from '../src/lib/money.ts';

const PAGES: ReadonlyArray<{ slug: string; component: AstroComponentFactory }> = [
  { slug: '', component: HomePage },
  { slug: 'tarifs', component: PricingPage },
  { slug: 'confidentialite', component: PrivacyPage },
];

async function render(locale: MarketingLocale, slug: string, component: AstroComponentFactory): Promise<{ html: string; response: Response }> {
  const container = await AstroContainer.create();
  const prefix = LOCALE_URL_PREFIX[locale];
  const url = slug === '' ? `https://fisca.ma/${prefix}/` : `https://fisca.ma/${prefix}/${slug}`;
  const response = await container.renderToResponse(component, { params: { locale: prefix }, request: new Request(url) });
  const clone = response.clone();
  const raw = await clone.text();
  // Le mode développement de Vite annote chaque balise : on les retire pour comparer le HTML de production.
  return { html: raw.replace(/ data-astro-source-(?:file|loc)="[^"]*"/g, ''), response };
}

const cache = new Map<string, { html: string; response: Response }>();
async function cached(locale: MarketingLocale, slug: string, component: AstroComponentFactory) {
  const key = `${locale}/${slug}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const fresh = await render(locale, slug, component);
  cache.set(key, fresh);
  return fresh;
}

const FIRST_PARTY_HOST = /^https:\/\/([a-z0-9-]+\.)?fisca\.ma(\/|$)/;

describe('HTML rendu : 3 pages x 6 langues', () => {
  it('statut 200, lang et dir corrects, hreflang réciproques', async () => {
    for (const locale of MARKETING_LOCALES) {
      for (const { slug, component } of PAGES) {
        const { html, response } = await cached(locale, slug, component);
        const meta = getLocaleMeta(locale);
        expect(response.status, `${locale}/${slug}`).toBe(200);
        expect(html, `${locale}/${slug}`).toContain(`<html lang="${meta.hreflang}" dir="${meta.dir}">`);
        expect((html.match(/rel="alternate" hreflang="/g) ?? []).length, `${locale}/${slug}`).toBe(7);
        expect(html).toContain('hreflang="x-default"');
        expect(html).toContain('<h1');
      }
    }
  });

  it('aucun script tiers : seul le JSON-LD du site, aucune source externe', async () => {
    for (const locale of MARKETING_LOCALES) {
      for (const { slug, component } of PAGES) {
        const { html } = await cached(locale, slug, component);
        const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1] ?? '');
        expect(scripts.length).toBeGreaterThan(0);
        for (const attrs of scripts) {
          expect(attrs, `${locale}/${slug}`).toContain('type="application/ld+json"');
          expect(attrs).not.toMatch(/\bsrc=/i);
        }
        expect(html).not.toMatch(/<(iframe|img|video|audio|embed|object|link[^>]+rel="(stylesheet|preload|prefetch|preconnect|dns-prefetch)")/i);
        expect(html).not.toMatch(/(googletagmanager|google-analytics|connect\.facebook|fbevents|doubleclick|hotjar|clarity\.ms|plausible|matomo|cdn\.)/i);
        expect(html).not.toMatch(/https?:\/\/fonts\.(googleapis|gstatic)/i);
      }
    }
  });

  it('aucun cookie : pas de Set-Cookie, pas de document.cookie', async () => {
    for (const locale of MARKETING_LOCALES) {
      for (const { slug, component } of PAGES) {
        const { html, response } = await cached(locale, slug, component);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(html).not.toMatch(/document\.cookie|localStorage|sessionStorage/);
      }
    }
  });

  it('liens externes limités aux sous-domaines de fisca.ma', async () => {
    for (const locale of MARKETING_LOCALES) {
      for (const { slug, component } of PAGES) {
        const { html } = await cached(locale, slug, component);
        const external = [...html.matchAll(/(?:href|src|action)="(https?:\/\/[^"]+)"/g)].map((m) => m[1] ?? '');
        for (const url of external) expect(url, `${locale}/${slug}`).toMatch(FIRST_PARTY_HOST);
      }
    }
  });

  it('sélecteur de langue : 6 liens avec hreflang, lien courant marqué', async () => {
    for (const locale of MARKETING_LOCALES) {
      const { html } = await cached(locale, 'tarifs', PricingPage);
      const nav = html.slice(html.indexOf('class="lang-nav"'), html.indexOf('</nav>', html.indexOf('class="lang-nav"')));
      expect((nav.match(/<a /g) ?? []).length).toBe(6);
      for (const l of MARKETING_LOCALES) {
        expect(nav).toContain(`href="/${LOCALE_URL_PREFIX[l]}/tarifs"`);
        expect(nav).toContain(`hreflang="${getLocaleMeta(l).hreflang}"`);
      }
      expect((nav.match(/aria-current="page"/g) ?? []).length).toBe(1);
    }
  });

  it('pied de page : éditeur, Loi 09-08, absence de traceurs, mention CNDP « en cours d’enregistrement »', async () => {
    for (const locale of MARKETING_LOCALES) {
      const { html } = await cached(locale, '', HomePage);
      const footer = html.slice(html.indexOf('<footer'));
      expect(footer, locale).toContain('SYNAPTIC SYSTEMS SARL AU');
      expect(footer).toContain('Rabat');
      expect(footer).toContain('dpo@fisca.ma');
      expect(footer).toMatch(/09-08/);
      expect(footer).toContain('class="cndp-status"');
      expect(footer).not.toContain('à renseigner par le propriétaire');
      expect(footer).toMatch(/F115[^<]*F211[^<]*F112[^<]*F118[^<]*SYNAPTIC SYSTEMS SARL AU \(dpo@fisca\.ma\)/);
      expect(footer).toContain(`/${LOCALE_URL_PREFIX[locale]}/confidentialite`);
    }
  });

  it('langues amazighes : repli français explicite (avis bilingue fr/ar, lang="fr")', async () => {
    for (const locale of ['zgh-Latn', 'zgh-Tfng'] as const) {
      for (const { slug, component } of PAGES) {
        const { html } = await cached(locale, slug, component);
        expect(html).toContain('<body lang="fr">');
        expect(html).toContain('class="notice"');
        expect(html).toContain('IRCAM');
      }
    }
    const { html } = await cached('fr', '', HomePage);
    expect(html).not.toContain('class="notice"');
  });

  it('page d’accueil : section Validation simulée, jamais de formule interdite', async () => {
    for (const locale of MARKETING_LOCALES) {
      const { html } = await cached(locale, '', HomePage);
      expect(html).toContain('badge-simulated');
      expect(html).not.toMatch(/conforme|homologu|certifi/i);
      expect(html).not.toMatch(/\b20(2[5-9]|3\d)\b/);
    }
  });
});

describe('page tarifs : HTML rendu', () => {
  it('chaque montant du catalogue figure en tabular-nums et dir=ltr', async () => {
    const { html } = await cached('fr', 'tarifs', PricingPage);
    for (const offer of PRICING_CATALOG_OFFERS) {
      for (const cents of [offer.monthly_ht_cents, offer.annual_ht_cents, offer.one_off_ht_cents]) {
        if (cents === null || cents === 0) continue;
        expect(html, `${offer.code} ${String(cents)}`).toContain(`<span dir="ltr" class="fisca-tabular-num">${formatCentsMad(cents)}</span>`);
      }
    }
    expect(html).toContain('58,65 MAD');
  });

  it('aucun montant hors composant Money : tout nombre « MAD » est isolé', async () => {
    for (const locale of MARKETING_LOCALES) {
      const { html } = await cached(locale, 'tarifs', PricingPage);
      const amounts = [...html.matchAll(/\d[\d ]*,\d{2} MAD/g)].length;
      const wrapped = [...html.matchAll(/<span dir="ltr" class="fisca-tabular-num">[^<]*MAD<\/span>/g)].length;
      expect(amounts, locale).toBeGreaterThan(30);
      expect(wrapped, locale).toBe(amounts);
    }
  });

  it('sélecteur mensuel/annuel en HTML/CSS : 2 radios, 2 labels, aucun script', async () => {
    const { html } = await cached('fr', 'tarifs', PricingPage);
    expect((html.match(/type="radio" name="billing"/g) ?? []).length).toBe(2);
    expect(html).toContain('for="billing-monthly"');
    expect(html).toContain('for="billing-annual"');
    expect(html).toContain('when-monthly');
    expect(html).toContain('when-annual');
    expect(html).not.toMatch(/<script(?![^>]*ld\+json)/);
    expect(html).not.toMatch(/\sonclick=|\sonchange=/);
  });

  it('comparatifs : 4 tableaux avec caption, en-têtes scope=col et scope=row', async () => {
    for (const locale of MARKETING_LOCALES) {
      const { html } = await cached(locale, 'tarifs', PricingPage);
      expect((html.match(/<table\b/g) ?? []).length).toBe(4);
      expect((html.match(/<caption>/g) ?? []).length).toBe(4);
      expect((html.match(/<th scope="col">/g) ?? []).length).toBeGreaterThanOrEqual(16);
      expect((html.match(/<th scope="row">/g) ?? []).length).toBe(18);
    }
  });

  it('les 4 familles sont des sections nommées', async () => {
    const { html } = await cached('en', 'tarifs', PricingPage);
    for (const id of ['famille-pme', 'famille-pos', 'famille-oec', 'famille-corporate-souverain']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('JSON-LD de la page : offres de toutes les familles et FAQPage', async () => {
    const { html } = await cached('fr', 'tarifs', PricingPage);
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const raw = match?.[1] ?? '';
    expect(raw).toContain('ENT_SOUVERAIN');
    expect(raw).toContain('PACK_MOWAKABA_CABINET');
    expect(raw).toContain('FAQPage');
    expect(() => JSON.parse(raw.replace(/\\u003c/g, '<'))).not.toThrow();
  });
});

describe('page confidentialité : mentions CNDP', () => {
  it('affiche le responsable, les droits, la mention CNDP en cours d’enregistrement, la mesure réelle et l’absence de cookies', async () => {
    const { html } = await cached('fr', 'confidentialite', PrivacyPage);
    expect(html).toContain('SYNAPTIC SYSTEMS SARL AU');
    expect(html).toContain('Rabat, Maroc');
    expect(html).toContain('mailto:dpo@fisca.ma');
    expect(html).toContain('Accès (article 7)');
    expect(html).toContain('Rectification (article 8)');
    expect(html).toContain('Opposition (article 9)');
    expect(html).toContain('Ce site ne dépose aucun cookie.');
    expect(html).toContain("Dossiers F115, F211, F112 et F118 en cours d&#39;enregistrement auprès de la CNDP par SYNAPTIC SYSTEMS SARL AU (dpo@fisca.ma)");
    expect(html).not.toContain('à renseigner par le propriétaire');
    expect(html).not.toContain('class="pending"');
    expect(html).toContain('compteurs quotidiens agrégés');
    expect(html).not.toContain('Si une mesure d’audience est activée un jour');
    expect((html.match(/<table\b/g) ?? []).length).toBe(2);
  });
});
