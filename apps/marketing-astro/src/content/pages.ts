import { getHomeCopy, isFallbackCopy } from '../i18n/home-copy.ts';
import { getSiteCopy } from '../i18n/site-copy.ts';
import { buildPricingView, pricingMarkdownSections } from './pricing-view.ts';
import { buildPrivacyView, privacyMarkdownSections } from './privacy-view.ts';
import type { FaqPair, HowToInput, LegislationRef } from '../seo/jsonld.ts';
import { SILO_PAGES } from './silos/registry.ts';
import { TOOL_PAGES } from '../tools/registry.ts';
import { LOCALE_URL_PREFIX, MARKETING_LOCALES, localeFromPrefix } from '../i18n/locales.ts';
import type { MarketingLocale } from '../i18n/locales.ts';
import { buildCanonicalUrl } from '../i18n/hreflang.ts';

export interface EditorialSection {
  readonly heading: string;
  readonly body: string;
}

/** Page éditoriale : source unique du HTML, du miroir Markdown, de llms.txt et du graphe JSON-LD. */
export interface EditorialPage {
  readonly locale: MarketingLocale;
  /** Sans préfixe de langue ; chaîne vide pour l'accueil. */
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly heading: string;
  readonly lead: string;
  /** Langue réelle du texte (repli français tant que la rédaction IRCAM n'est pas livrée). */
  readonly contentLanguage: 'fr' | 'ar' | 'ary' | 'en';
  readonly sections: readonly EditorialSection[];
  /** Questions fréquentes de la page : source du JSON-LD FAQPage et du miroir Markdown. */
  readonly faqs?: readonly FaqPair[];
  /** Vrai : page servie en noindex et exclue du sitemap (seuil de qualité Doc_18 S10 non atteint). */
  readonly noindex?: boolean;
  /** Référence légale principale : nœud Legislation du JSON-LD. */
  readonly legislation?: LegislationRef;
  /** Étapes HowTo du JSON-LD. */
  readonly howTo?: HowToInput;
}

/** Slugs des pages enregistrées (identiques dans les 6 langues, Doc_18 S11 `buildMultilingualAlternates`). */
export const PRICING_SLUG = 'tarifs';
export const PRIVACY_SLUG = 'confidentialite';

function contentLanguageOf(locale: MarketingLocale): EditorialPage['contentLanguage'] {
  if (isFallbackCopy(locale)) return 'fr';
  switch (locale) {
    case 'ar':
      return 'ar';
    case 'ary':
      return 'ary';
    case 'en':
      return 'en';
    case 'fr':
    case 'zgh-Latn':
    case 'zgh-Tfng':
      return 'fr';
  }
}

function homePage(locale: MarketingLocale): EditorialPage {
  const copy = getHomeCopy(locale);
  const site = getSiteCopy(locale);
  return {
    locale,
    slug: '',
    title: copy.title,
    description: copy.description,
    heading: copy.heading,
    lead: copy.lead,
    contentLanguage: contentLanguageOf(locale),
    sections: [
      { heading: copy.benefits.heading, body: copy.benefits.items.map((i) => `- **${i.title}** : ${i.body}`).join('\n') },
      { heading: copy.simulated.heading, body: copy.simulated.paragraphs.join('\n\n') },
      {
        heading: copy.sovereignty.heading,
        body: [copy.sovereignty.intro, '', ...copy.sovereignty.items.map((i) => `- **${i.title}** : ${i.body}`)].join('\n'),
      },
      {
        heading: copy.pricingTeaser.heading,
        body: `${copy.pricingTeaser.body}\n\n- ${site.navPricing} : /${LOCALE_URL_PREFIX[locale]}/${PRICING_SLUG}\n- ${site.navPrivacy} : /${LOCALE_URL_PREFIX[locale]}/${PRIVACY_SLUG}`,
      },
    ],
  };
}

function pricingPage(locale: MarketingLocale): EditorialPage {
  const view = buildPricingView(locale);
  return {
    locale,
    slug: PRICING_SLUG,
    title: view.copy.title,
    description: view.copy.description,
    heading: view.copy.heading,
    lead: view.copy.lead,
    contentLanguage: contentLanguageOf(locale),
    sections: pricingMarkdownSections(view),
    faqs: view.faq.map((f) => ({ question: f.question, answer: f.answer })),
  };
}

function privacyPage(locale: MarketingLocale): EditorialPage {
  const view = buildPrivacyView(locale);
  return {
    locale,
    slug: PRIVACY_SLUG,
    title: view.copy.title,
    description: view.copy.description,
    heading: view.copy.heading,
    lead: view.copy.lead,
    contentLanguage: contentLanguageOf(locale),
    sections: privacyMarkdownSections(view),
  };
}

/** T-P2C-03 : accueil, tarifs et confidentialité dans les 6 langues (socle du site, hors silos). */
export const EDITORIAL_PAGES: readonly EditorialPage[] = [
  ...MARKETING_LOCALES.map(homePage),
  ...MARKETING_LOCALES.map(pricingPage),
  ...MARKETING_LOCALES.map(privacyPage),
];

/**
 * T-P2C-04 : socle + 4 hubs de silo + 78 routes de silos, chacun en 6 langues (18 + 24 + 468 = 510 pages).
 * T-P2C-06 : + hub des outils et 3 outils publics, 6 langues (24 pages) : 534 pages.
 * T-P2C-07 : + 2 outils (simulateur auto-entrepreneur, estimateur Mowakaba), 6 langues (12 pages) : 546 pages.
 */
export const ALL_EDITORIAL_PAGES: readonly EditorialPage[] = [...EDITORIAL_PAGES, ...SILO_PAGES, ...TOOL_PAGES];

const PAGE_INDEX: ReadonlyMap<string, EditorialPage> = new Map(ALL_EDITORIAL_PAGES.map((p) => [`${p.locale}|${p.slug}`, p]));

export function findEditorialPage(locale: MarketingLocale, slug: string): EditorialPage | undefined {
  const clean = slug.replace(/^\/+|\/+$/g, '');
  return PAGE_INDEX.get(`${locale}|${clean}`);
}

/** `/fr/`, `/fr`, `/fr/guides/x/` -> page du registre (chemin HTML, pas le jumeau .md). */
export function findEditorialPageByPath(pathname: string): EditorialPage | undefined {
  const segments = pathname.split('/').filter((s) => s.length > 0);
  const locale = localeFromPrefix(segments[0]);
  if (locale === null) return undefined;
  return findEditorialPage(locale, segments.slice(1).join('/'));
}

/** Chemin du jumeau Markdown : `/fr/index.md` pour l'accueil, `/fr/<slug>.md` sinon. */
export function mirrorPathOf(page: EditorialPage): string {
  const prefix = LOCALE_URL_PREFIX[page.locale];
  return page.slug === '' ? `/${prefix}/index.md` : `/${prefix}/${page.slug}.md`;
}

/** `/fr/index.md` -> accueil fr ; `/fr/guides/x.md` -> slug `guides/x`. */
export function findEditorialPageByMirrorPath(pathname: string): EditorialPage | undefined {
  if (!pathname.endsWith('.md')) return undefined;
  const segments = pathname.slice(0, -3).split('/').filter((s) => s.length > 0);
  const locale = localeFromPrefix(segments[0]);
  if (locale === null) return undefined;
  const rest = segments.slice(1);
  if (rest.length === 1 && rest[0] === 'index') return findEditorialPage(locale, '');
  if (rest.length === 0) return undefined;
  return findEditorialPage(locale, rest.join('/'));
}

export function canonicalUrlOf(page: EditorialPage): string {
  return buildCanonicalUrl(page.locale, page.slug);
}
