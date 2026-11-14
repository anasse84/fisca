/**
 * Registre des 78 routes canoniques des silos 1, 2, 4 et 5 (Doc_18 S05), de leurs 4 hubs, et pages éditoriales
 * dérivées pour les 6 langues : 468 URL de contenu et 24 URL de hub.
 */
import { BILLING_POLICY } from '../billing-policy.ts';
import type { BillingPolicy } from '../billing-policy.ts';
import { copyLocaleOf, fill, usesFrenchFallback } from '../../i18n/copy-locale.ts';
import type { EditorialPage } from '../pages.ts';
import { LOCALE_URL_PREFIX, MARKETING_LOCALES } from '../../i18n/locales.ts';
import type { MarketingLocale } from '../../i18n/locales.ts';
import { buildSiloPageView, siloMarkdownSections } from './build.ts';
import type { SiloPageView } from './build.ts';
import { CGI_SIMPL_PAGES, CGI_SIMPL_SLUG } from './cgi-simpl.ts';
import { CLEARANCE_PAGES, CLEARANCE_SLUG } from './clearance.ts';
import { METIERS_POS_PAGES, METIERS_POS_SLUG } from './metiers-pos.ts';
import { REGIONS_SLUG, REGION_PAGES } from './regions.ts';
import { buildSlots } from './slots.ts';
import type { L4, SiloId, SiloPageSpec } from './types.ts';
import { SILO_ORDER, SILO_ROUTE_COUNTS } from './types.ts';
import { UI } from './ui-copy.ts';

function t(fr: string, en: string, ar: string, ary: string): L4 {
  return { fr, en, ar, ary };
}

export interface SiloDefinition {
  readonly id: SiloId;
  readonly slug: string;
  readonly title: L4;
  readonly lead: L4;
  readonly pages: readonly SiloPageSpec[];
}

export const SILOS: readonly SiloDefinition[] = [
  {
    id: 'clearance',
    slug: CLEARANCE_SLUG,
    title: t('Clearance xHub et loi 43-20', 'xHub clearance and law 43-20', 'المصادقة المسبقة xHub والقانون 43-20', 'الكليرانس xHub والقانون 43-20'),
    lead: t(
      'Comment Fisca construit et signe une facture UBL 2.1 sur un profil provisoire, en attendant des schémas officiels qui ne sont pas publiés à ce jour. L’état affiché reste « Validation simulée ».',
      'How Fisca builds and signs a UBL 2.1 invoice on a provisional profile, pending official schemas that are not published to date. The status shown remains “Simulated validation”.',
      'كيف تنشئ فيسكا فاتورة UBL 2.1 وتوقعها على ملف مؤقت في انتظار مخططات رسمية غير منشورة إلى اليوم. وتبقى الحالة المعروضة «تحقق بالمحاكاة».',
      'كيفاش فيسكا كتصاوب فاتورة UBL 2.1 وكتوقعها على بروفيل مؤقت فانتظار مخططات رسمية ما تنشراتش حتى لدابا. والحالة اللي كتبان كتبقى «تحقق بالمحاكاة».',
    ),
    pages: CLEARANCE_PAGES,
  },
  {
    id: 'cgi-simpl',
    slug: CGI_SIMPL_SLUG,
    title: t('CGI et flux SIMPL', 'CGI and SIMPL flows', 'CGI وتدفقات SIMPL', 'CGI وتدفقات SIMPL'),
    lead: t(
      'Loi 69-21, RAS-TVA, plafond d’espèces, auto-entrepreneur, état 9421, DRVT : chaque règle avec son article, son flux XSD et un cas chiffré. Les valeurs fiscales sont des données datées, avec leur état de vérification.',
      'Law 69-21, VAT withholding, cash cap, auto-entrepreneur, 9421 statement, DRVT: each rule with its article, its XSD flow and a worked example. Tax values are dated data, with their verification state.',
      'القانون 69-21 واقتطاع TVA وسقف النقد والمقاول الذاتي وبيان 9421 وDRVT: كل قاعدة بمادتها وتدفق XSD وحالة مرقمة. والقيم الجبائية معطيات مؤرخة مع حالة التحقق منها.',
      'القانون 69-21 واقتطاع TVA وسقف الكاش والمقاول الذاتي وبيان 9421 وDRVT: كل قاعدة بالمادة ديالها وتدفق XSD وحالة مرقمة. والقيم الجبائية معطيات مؤرخة مع حالة التحقق ديالها.',
    ),
    pages: CGI_SIMPL_PAGES,
  },
  {
    id: 'metiers-pos',
    slug: METIERS_POS_SLUG,
    title: t('Métiers, cabinets et caisse POS', 'Trades, firms and POS tills', 'المهن والمكاتب وصناديق POS', 'المهن والمكاتب وكيسات POS'),
    lead: t(
      'Logiciel fiduciaire, caisse CHR, BTP, auto-entrepreneur : la grille tarifaire publique appliquée à des cas réels, avec le prorata de dossier, le Ticket Z hors ligne et la retenue.',
      'Fiduciary software, food-service tills, construction, auto-entrepreneur: the public price list applied to real cases, with file proration, the offline Z ticket and withholding.',
      'برنامج المكاتب الاستئمانية وصندوق المطاعم والبناء والمقاول الذاتي: لائحة الأسعار المعلنة مطبقة على حالات واقعية مع تناسب الملفات وتذكرة Z دون اتصال والاقتطاع.',
      'برنامج المكاتب الفيدوسيير وكايس المطاعم والبناء والمقاول الذاتي: لائحة الأثمنة المعلنة مطبقة على حالات واقعية مع حساب الدوسيات وتيكي Z بلا كونيكسيون والاقتطاع.',
    ),
    pages: METIERS_POS_PAGES,
  },
  {
    id: 'regions',
    slug: REGIONS_SLUG,
    title: t('Régions du Maroc et Mowakaba', 'Moroccan regions and Mowakaba', 'جهات المغرب وMowakaba', 'جهات المغرب وMowakaba'),
    lead: t(
      'Les 12 régions du Maroc et le calcul du reste à charge des packs Mowakaba. Les adresses des CRI et de la DGI ne sont pas publiées dans nos données à ce jour.',
      'Morocco’s 12 regions and the out-of-pocket cost of the Mowakaba packs. CRI and DGI addresses are not published in our data to date.',
      'جهات المغرب الاثنتا عشرة وحساب المبلغ المتبقي في حزم Mowakaba. وعناوين المراكز الجهوية للاستثمار والمديرية العامة للضرائب غير منشورة في معطياتنا إلى اليوم.',
      'جهات المغرب الاثناعش وحساب اللي بقا على الكليان فحزم Mowakaba. وعناوين المراكز الجهوية للاستثمار وDGI ما منشورينش فمعطياتنا حتى لدابا.',
    ),
    pages: REGION_PAGES,
  },
];

export function getSilo(id: SiloId): SiloDefinition {
  const found = SILOS.find((s) => s.id === id);
  if (found === undefined) throw new RangeError(`Silo inconnu : ${id}`);
  return found;
}

export function siloSlugOf(id: SiloId): string {
  return getSilo(id).slug;
}

/** Les 78 routes canoniques (slug complet, sans préfixe de langue). */
export const SILO_ROUTES: readonly { readonly silo: SiloId; readonly slug: string; readonly spec: SiloPageSpec }[] = SILOS.flatMap((silo) =>
  silo.pages.map((spec) => ({ silo: silo.id, slug: `${silo.slug}/${spec.slug}`, spec })),
);

export const SILO_HUB_SLUGS: readonly string[] = SILOS.map((s) => s.slug);

export function siloRouteCount(id: SiloId): number {
  return SILO_ROUTES.filter((r) => r.silo === id).length;
}

export function assertSiloCounts(): void {
  for (const id of SILO_ORDER) {
    if (siloRouteCount(id) !== SILO_ROUTE_COUNTS[id]) {
      throw new RangeError(`Silo ${id} : ${String(siloRouteCount(id))} routes au lieu de ${String(SILO_ROUTE_COUNTS[id])}`);
    }
  }
}

function contextOf(silo: SiloDefinition) {
  return {
    siloSlug: silo.slug,
    siloTitle: silo.title,
    pageTitleOf: (slug: string): L4 => {
      const found = silo.pages.find((p) => p.slug === slug);
      if (found === undefined) throw new RangeError(`Page liée inconnue : ${silo.slug}/${slug}`);
      return found.title;
    },
  };
}

export function findSiloRoute(slug: string): { readonly silo: SiloDefinition; readonly spec: SiloPageSpec } | undefined {
  const clean = slug.replace(/^\/+|\/+$/g, '');
  const route = SILO_ROUTES.find((r) => r.slug === clean);
  if (route === undefined) return undefined;
  return { silo: getSilo(route.silo), spec: route.spec };
}

export function buildSiloViewBySlug(locale: MarketingLocale, slug: string, policy: BillingPolicy = BILLING_POLICY): SiloPageView | undefined {
  const found = findSiloRoute(slug);
  if (found === undefined) return undefined;
  return buildSiloPageView(locale, found.spec, contextOf(found.silo), policy);
}

/** Une route est indexable si sa version de référence (français) atteint le seuil Doc_18 S10 ; les 6 langues suivent. */
export function isSiloRouteIndexable(slug: string, policy: BillingPolicy = BILLING_POLICY): boolean {
  const view = buildSiloViewBySlug('fr', slug, policy);
  return view !== undefined && view.quality.indexable;
}

export interface HubView {
  readonly kind: 'hub';
  readonly locale: MarketingLocale;
  readonly silo: SiloDefinition;
  readonly slug: string;
  readonly title: string;
  readonly lead: string;
  readonly description: string;
  readonly headingPages: string;
  readonly breadcrumb: readonly { readonly label: string; readonly href: string }[];
  readonly breadcrumbLabel: string;
  readonly entries: readonly { readonly label: string; readonly href: string; readonly summary: string; readonly indexable: boolean }[];
}

export function buildHubView(locale: MarketingLocale, id: SiloId, policy: BillingPolicy = BILLING_POLICY): HubView {
  const silo = getSilo(id);
  const loc = copyLocaleOf(locale);
  const prefix = LOCALE_URL_PREFIX[locale];
  const slots = buildSlots(loc, policy);
  const title = fill(silo.title[loc], slots);
  const ctx = contextOf(silo);
  const entries = silo.pages.map((spec) => {
    const view = buildSiloPageView(locale, spec, ctx, policy);
    return { label: view.title, href: `/${prefix}/${silo.slug}/${spec.slug}`, summary: view.description, indexable: isSiloRouteIndexable(`${silo.slug}/${spec.slug}`, policy) };
  });
  return {
    kind: 'hub',
    locale,
    silo,
    slug: silo.slug,
    title,
    lead: fill(silo.lead[loc], slots),
    description: silo.lead[loc],
    headingPages: UI.hubIntroPages[loc],
    breadcrumb: [
      { label: UI.home[loc], href: `/${prefix}/` },
      { label: title, href: `/${prefix}/${silo.slug}` },
    ],
    breadcrumbLabel: UI.breadcrumbLabel[loc],
    entries,
  };
}

function editorialOfPage(view: SiloPageView, noindex: boolean): EditorialPage {
  return {
    locale: view.locale,
    slug: view.slug,
    title: view.title,
    description: view.description,
    heading: view.title,
    lead: view.verdict,
    contentLanguage: usesFrenchFallback(view.locale) ? 'fr' : view.contentLanguage,
    sections: siloMarkdownSections(view),
    faqs: view.faqs,
    noindex,
    ...(view.legislation === null ? {} : { legislation: { name: view.legislation.name, identifier: view.legislation.identifier } }),
    ...(view.steps.length === 0 ? {} : { howTo: { name: view.labels.howToName, steps: view.steps } }),
  };
}

function editorialOfHub(view: HubView): EditorialPage {
  return {
    locale: view.locale,
    slug: view.slug,
    title: view.title,
    description: view.description,
    heading: view.title,
    lead: view.lead,
    contentLanguage: usesFrenchFallback(view.locale) ? 'fr' : copyLocaleOf(view.locale),
    sections: [{ heading: view.headingPages, body: view.entries.map((e) => `- [${e.label}](${e.href}) : ${e.summary}`).join('\n') }],
    noindex: false,
  };
}

/** 78 routes x 6 langues = 468 pages de contenu. */
export const SILO_CONTENT_PAGES: readonly EditorialPage[] = SILO_ROUTES.flatMap((route) => {
  const noindex = !isSiloRouteIndexable(route.slug);
  return MARKETING_LOCALES.map((locale) => {
    const view = buildSiloViewBySlug(locale, route.slug);
    if (view === undefined) throw new RangeError(`Vue absente : ${route.slug}`);
    return editorialOfPage(view, noindex);
  });
});

/** 4 hubs x 6 langues = 24 pages de navigation. */
export const SILO_HUB_PAGES: readonly EditorialPage[] = SILOS.flatMap((silo) => MARKETING_LOCALES.map((locale) => editorialOfHub(buildHubView(locale, silo.id))));

export const SILO_PAGES: readonly EditorialPage[] = [...SILO_HUB_PAGES, ...SILO_CONTENT_PAGES];
