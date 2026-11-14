/**
 * Registre du Silo 3 : 60 fiches de compte + 1 hub, dans les 6 langues (366 pages). Les fiches fr, ar et en sont
 * indexables (60 x 3 = 180 URL) ; ary lit l'arabe, zgh-Latn et zgh-Tfng lisent le français, et ces trois langues
 * sont servies en noindex hors sitemap et hors llms. Le hub est indexable dans les 6 langues.
 */
import { MARKETING_LOCALES } from '../../i18n/locales.ts';
import type { MarketingLocale } from '../../i18n/locales.ts';
import type { EditorialPage } from '../pages.ts';
import { CGNC_ACCOUNTS } from './dataset.ts';
import type { CgncAccountRecord } from './dataset.ts';
import { buildCgncAccountView, buildCgncHubView, cgncHubMarkdownSections, cgncMarkdownSections } from './build.ts';
import { CGNC_HUB_SLUG, CGNC_INDEXED_LOCALES, COUNTER, accountSlug, cgncLocaleOf } from './copy.ts';

export { CGNC_HUB_SLUG, accountSlug };

/** Contrat du Silo 3 (ERRATA B-13 : régime provisoire). Inscription au registre des contrats par l'orchestrateur. */
export const CGNC_CONTRACT = {
  dataset: 'FISCA_CGNC_CORE_60_V1',
  status: 'PROVISIONAL',
  doc_section_ref: 'Doc_18 S05 et S10 ; ERRATA B-13 ; conformité officielle non vérifiée',
  coreAccounts: 60,
  sectorSubAccountsToEnrich: 190,
  enrichAfterGate: 'G4',
  indexedUrls: 180,
  counter: COUNTER,
} as const;

function contentLanguageOf(locale: MarketingLocale): EditorialPage['contentLanguage'] {
  return cgncLocaleOf(locale);
}

export function isCgncAccountIndexable(record: CgncAccountRecord, accounts: readonly CgncAccountRecord[] = CGNC_ACCOUNTS): boolean {
  return buildCgncAccountView('fr', record, accounts).quality.indexable;
}

export function buildCgncAccountPage(locale: MarketingLocale, record: CgncAccountRecord, accounts: readonly CgncAccountRecord[] = CGNC_ACCOUNTS): EditorialPage {
  const view = buildCgncAccountView(locale, record, accounts);
  const indexable = isCgncAccountIndexable(record, accounts);
  return {
    locale,
    slug: view.slug,
    title: view.title,
    description: view.description,
    heading: view.title,
    lead: view.verdict,
    contentLanguage: contentLanguageOf(locale),
    sections: cgncMarkdownSections(view),
    faqs: view.faqs,
    noindex: !indexable || !CGNC_INDEXED_LOCALES.includes(locale),
    indexLocales: CGNC_INDEXED_LOCALES,
    legislation: { name: view.legislation.name, identifier: view.legislation.identifier },
    howTo: { name: view.labels.howToName, steps: view.steps },
  };
}

export function buildCgncHubPage(locale: MarketingLocale, accounts: readonly CgncAccountRecord[] = CGNC_ACCOUNTS): EditorialPage {
  const view = buildCgncHubView(locale, accounts);
  return {
    locale,
    slug: view.slug,
    title: view.title,
    description: view.description,
    heading: view.title,
    lead: view.lead,
    contentLanguage: contentLanguageOf(locale),
    sections: cgncHubMarkdownSections(view),
    noindex: false,
  };
}

/** Toutes les pages du silo pour un jeu de comptes donné (le jeu fourni, ou un jeu dégradé dans les tests). */
export function buildCgncPages(accounts: readonly CgncAccountRecord[] = CGNC_ACCOUNTS): readonly EditorialPage[] {
  return [
    ...MARKETING_LOCALES.map((locale) => buildCgncHubPage(locale, accounts)),
    ...accounts.flatMap((record) => MARKETING_LOCALES.map((locale) => buildCgncAccountPage(locale, record, accounts))),
  ];
}

export const CGNC_PAGES: readonly EditorialPage[] = buildCgncPages();

export const CGNC_ACCOUNT_SLUGS: readonly string[] = CGNC_ACCOUNTS.map((a) => `${CGNC_HUB_SLUG}/${accountSlug(a.account_number)}`);

export function findCgncAccountBySlug(slug: string): CgncAccountRecord | undefined {
  const clean = slug.replace(/^\/+|\/+$/g, '');
  const prefix = `${CGNC_HUB_SLUG}/compte-`;
  if (!clean.startsWith(prefix)) return undefined;
  const number = clean.slice(prefix.length);
  return CGNC_ACCOUNTS.find((a) => a.account_number === number);
}
