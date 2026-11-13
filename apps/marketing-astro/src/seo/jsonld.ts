import { PUBLISHER } from '../content/identity.ts';
import { PRICING_CURRENCY, PRICING_PLANS } from '../content/pricing.ts';
import type { PricingPlan } from '../content/pricing.ts';
import { getLocaleMeta } from '../i18n/locales.ts';
import type { MarketingLocale } from '../i18n/locales.ts';
import { SITE_ORIGIN } from '../i18n/hreflang.ts';
import { centsToDecimalString } from '../lib/money.ts';

export interface FaqPair {
  readonly question: string;
  readonly answer: string;
}

export interface LegislationRef {
  readonly name: string;
  readonly identifier?: string;
  readonly url?: string;
}

export interface HowToStepInput {
  readonly name: string;
  readonly text: string;
}

export interface HowToInput {
  readonly name: string;
  readonly description?: string;
  readonly steps: readonly HowToStepInput[];
}

export interface JsonLdInput {
  readonly pageUrl: string;
  readonly locale: MarketingLocale;
  readonly title: string;
  readonly description: string;
  readonly dateModifiedIso?: string;
  readonly legislation?: LegislationRef;
  readonly howTo?: HowToInput;
  readonly faqs?: readonly FaqPair[];
  /** Grille tarifaire ; défaut : src/content/pricing.ts. */
  readonly plans?: readonly PricingPlan[];
}

export type JsonLdNode = Readonly<Record<string, unknown>>;

export interface JsonLdDocument {
  readonly '@context': 'https://schema.org';
  readonly '@graph': readonly JsonLdNode[];
}

const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`;
const SOFTWARE_ID = `${SITE_ORIGIN}/#software`;

function offerOf(plan: PricingPlan): JsonLdNode {
  const base = {
    '@type': 'Offer',
    '@id': `${SITE_ORIGIN}/#offer-${plan.code.toLowerCase()}`,
    name: plan.name,
    sku: plan.code,
    priceCurrency: PRICING_CURRENCY,
    seller: { '@id': ORGANIZATION_ID },
  };
  if (plan.kind === 'ONE_OFF') {
    return { ...base, price: centsToDecimalString(plan.one_off_ht_cents) };
  }
  return {
    ...base,
    price: centsToDecimalString(plan.monthly_ht_cents),
    priceSpecification: [
      {
        '@type': 'UnitPriceSpecification',
        price: centsToDecimalString(plan.monthly_ht_cents),
        priceCurrency: PRICING_CURRENCY,
        unitCode: 'MON',
        valueAddedTaxIncluded: false,
      },
      {
        '@type': 'UnitPriceSpecification',
        price: centsToDecimalString(plan.annual_ht_cents),
        priceCurrency: PRICING_CURRENCY,
        unitCode: 'ANN',
        valueAddedTaxIncluded: false,
      },
    ],
  };
}

function organizationNode(): JsonLdNode {
  return {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: PUBLISHER.legalName,
    brand: PUBLISHER.brand,
    url: SITE_ORIGIN,
    email: PUBLISHER.dpoEmail,
    address: {
      '@type': 'PostalAddress',
      addressLocality: PUBLISHER.locality,
      addressRegion: PUBLISHER.region,
      addressCountry: PUBLISHER.countryIso2,
    },
    areaServed: PUBLISHER.countryIso2,
  };
}

function softwareNode(plans: readonly PricingPlan[]): JsonLdNode {
  return {
    '@type': 'SoftwareApplication',
    '@id': SOFTWARE_ID,
    name: PUBLISHER.brand,
    description: PUBLISHER.summaryFr,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, iOS, Android',
    url: SITE_ORIGIN,
    provider: { '@id': ORGANIZATION_ID },
    offers: plans.map(offerOf),
  };
}

/** Graphe Schema.org interconnecté (Doc_18 S04 et S11, errata § B-13, C, D). Pure et déterministe. */
export function buildFiscaJsonLdObject(input: JsonLdInput): JsonLdDocument {
  const plans = input.plans ?? PRICING_PLANS;
  const pageId = `${input.pageUrl}#webpage`;
  const legislationId = `${input.pageUrl}#legislation`;
  const howToId = `${input.pageUrl}#howto`;
  const faqId = `${input.pageUrl}#faq`;

  const about: JsonLdNode[] = [{ '@id': SOFTWARE_ID }];
  if (input.legislation !== undefined) about.push({ '@id': legislationId });

  const page: Record<string, unknown> = {
    '@type': 'WebPage',
    '@id': pageId,
    url: input.pageUrl,
    name: input.title,
    description: input.description,
    inLanguage: getLocaleMeta(input.locale).hreflang,
    publisher: { '@id': ORGANIZATION_ID },
    about,
  };
  if (input.dateModifiedIso !== undefined) page['dateModified'] = input.dateModifiedIso;

  const graph: JsonLdNode[] = [organizationNode(), softwareNode(plans), page];

  if (input.legislation !== undefined) {
    const leg: Record<string, unknown> = {
      '@type': 'Legislation',
      '@id': legislationId,
      name: input.legislation.name,
      legislationJurisdiction: PUBLISHER.countryIso2,
    };
    if (input.legislation.identifier !== undefined) leg['legislationIdentifier'] = input.legislation.identifier;
    if (input.legislation.url !== undefined) leg['url'] = input.legislation.url;
    graph.push(leg);
  }

  if (input.howTo !== undefined && input.howTo.steps.length > 0) {
    const howTo: Record<string, unknown> = {
      '@type': 'HowTo',
      '@id': howToId,
      name: input.howTo.name,
      isPartOf: { '@id': pageId },
      step: input.howTo.steps.map((s, i) => ({
        '@type': 'HowToStep',
        position: i + 1,
        name: s.name,
        text: s.text,
      })),
    };
    if (input.howTo.description !== undefined) howTo['description'] = input.howTo.description;
    graph.push(howTo);
  }

  if (input.faqs !== undefined && input.faqs.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      '@id': faqId,
      isPartOf: { '@id': pageId },
      mainEntity: input.faqs.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Chaîne JSON prête pour `<script type="application/ld+json">` : `<` échappé en \u003c. */
export function buildFiscaJsonLdGraph(input: JsonLdInput): string {
  return JSON.stringify(buildFiscaJsonLdObject(input)).replace(/</g, '\\u003c');
}
