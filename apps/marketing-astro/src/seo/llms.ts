import { MCP_MANIFEST_PATH, MCP_SERVER_URL, NON_INDEXABLE_HOSTS, OAUTH_PROTOCOL_LABEL, PUBLISHER } from '../content/identity.ts';
import { DATED_FISCAL_PARAMETER_SLOTS } from '../content/fiscal-reference.ts';
import { mirrorPathOf } from '../content/pages.ts';
import type { EditorialPage } from '../content/pages.ts';
import { FIDUCIARY_METER, PRICING_CURRENCY, headlinePriceCents } from '../content/pricing.ts';
import type { CatalogOffer, PricingPlan } from '../content/pricing.ts';
import { LOCALE_URL_PREFIX, MARKETING_LOCALES } from '../i18n/locales.ts';
import { SITE_ORIGIN } from '../i18n/hreflang.ts';
import { formatCentsMad } from '../lib/money.ts';

const NON_PME_FAMILIES: readonly CatalogOffer['family'][] = ['POS', 'OEC', 'CORPORATE_SOUVERAIN'];

const BAREMES_POINTER =
  'Les barèmes, taux et plafonds fiscaux ne sont pas publiés dans ce fichier : ce sont des règles datées tenues dans les tables D1 (dynamic_fiscal_rules) et le Wiki Fisca. Chaque guide cite l’article de loi et la règle datée applicable.';

function identityLines(): string[] {
  return [
    `- Éditeur : ${PUBLISHER.legalName}`,
    `- Marque : ${PUBLISHER.brand} (${SITE_ORIGIN})`,
    `- Siège : ${PUBLISHER.locality}, Maroc`,
    `- Contact données personnelles : ${PUBLISHER.dpoEmail}`,
  ];
}

function priceLine(plan: PricingPlan): string {
  if (plan.kind === 'RECURRING') {
    return `- ${plan.name} (${plan.audience}) : ${formatCentsMad(plan.monthly_ht_cents)} HT par mois`;
  }
  return `- ${plan.name} (${plan.audience}) : ${formatCentsMad(headlinePriceCents(plan))} HT, paiement unique`;
}

function catalogPriceLine(offer: CatalogOffer): string {
  const parts: string[] = [];
  if (offer.monthly_ht_cents !== null) {
    parts.push(offer.monthly_ht_cents === 0 ? 'inclus (0,00 MAD)' : `${formatCentsMad(offer.monthly_ht_cents)} HT par mois`);
  }
  if (offer.annual_ht_cents !== null && offer.annual_ht_cents > 0) parts.push(`${formatCentsMad(offer.annual_ht_cents)} HT par an`);
  if (offer.one_off_ht_cents !== null) parts.push(`${formatCentsMad(offer.one_off_ht_cents)} HT, paiement unique`);
  return `- ${offer.name} [${offer.family}] (${offer.audience}) : ${parts.join(' ; ')}`;
}

function catalogLines(catalog: readonly CatalogOffer[] | undefined): string[] {
  if (catalog === undefined) return [];
  const lines = catalog.filter((o) => NON_PME_FAMILIES.includes(o.family)).map(catalogPriceLine);
  const d = FIDUCIARY_METER.volumeDiscount;
  lines.push(
    `- Remise de volume cabinet : ${String(d.discount_bps)} bps sur les lignes de dossiers dès ${String(d.minActiveDossiers)} dossiers actifs (socle non remisé)`,
  );
  return lines;
}

function pagesByLocale(pages: readonly EditorialPage[]): string[] {
  const lines: string[] = [];
  for (const locale of MARKETING_LOCALES) {
    const own = pages.filter((p) => p.locale === locale);
    if (own.length === 0) continue;
    lines.push(`### ${LOCALE_URL_PREFIX[locale]}`);
    for (const p of own) {
      const depth = p.slug === '' ? 0 : p.slug.split('/').length;
      lines.push(`${'  '.repeat(depth)}- [${p.heading}](${SITE_ORIGIN}${mirrorPathOf(p)}) : ${p.description}`);
    }
    lines.push('');
  }
  return lines;
}

function agentAccessLines(): string[] {
  return [
    `- Manifeste de découverte : ${SITE_ORIGIN}${MCP_MANIFEST_PATH}`,
    `- Serveur MCP : ${MCP_SERVER_URL} (authentification ${OAUTH_PROTOCOL_LABEL})`,
    '- Miroirs Markdown : chaque page éditoriale /<langue>/<page> a un jumeau /<langue>/<page>.md ; l’en-tête Accept: text/markdown sur l’URL HTML renvoie la même version Markdown.',
    `- Les hôtes ${NON_INDEXABLE_HOSTS.join(', ')} ne sont pas destinés à l’indexation.`,
  ];
}

function baremesLines(detailed: boolean): string[] {
  const lines = [BAREMES_POINTER, ''];
  if (detailed) {
    for (const slot of DATED_FISCAL_PARAMETER_SLOTS) {
      lines.push(`- ${slot.label} (${slot.key}) : ${slot.status}, source ${slot.source}`);
    }
  } else {
    lines.push(`- Paramètres concernés : ${DATED_FISCAL_PARAMETER_SLOTS.map((s) => s.label).join(' ; ')}`);
    lines.push('- État : valeur datée, à saisir depuis les tables');
  }
  lines.push('');
  return lines;
}

/** /llms.txt : index court (Doc_18 S03). Barèmes absents par construction (ADR-04). */
export function buildLlmsTxt(plans: readonly PricingPlan[], pages: readonly EditorialPage[], catalog?: readonly CatalogOffer[]): string {
  return [
    `# ${PUBLISHER.brand} (fisca.ma)`,
    '',
    `> ${PUBLISHER.summaryFr}`,
    '',
    '## Éditeur',
    ...identityLines(),
    '',
    `## Tarifs publics (${PRICING_CURRENCY}, hors taxes)`,
    ...plans.map(priceLine),
    ...catalogLines(catalog),
    '',
    '## Guides et pages (miroirs Markdown)',
    ...pagesByLocale(pages),
    '## Barèmes fiscaux',
    ...baremesLines(false),
    '## Accès agents',
    ...agentAccessLines(),
    `- Version détaillée : ${SITE_ORIGIN}/llms-full.txt`,
    '',
  ].join('\n');
}

function detailedPlanLines(plan: PricingPlan): string[] {
  const head = [`### ${plan.name} (${plan.code})`, `- Public : ${plan.audience}`];
  if (plan.kind === 'RECURRING') {
    head.push(`- Mensuel HT : ${formatCentsMad(plan.monthly_ht_cents)}`);
    head.push(`- Annuel HT : ${formatCentsMad(plan.annual_ht_cents)} (facturation sur 10 mois)`);
  } else {
    head.push(`- Prix HT : ${formatCentsMad(plan.one_off_ht_cents)}, paiement unique`);
  }
  head.push(...plan.inclusions.map((i) => `- Inclus : ${i}`), '');
  return head;
}

/** /llms-full.txt : version détaillée (identité, grille complète, arbre des guides). */
export function buildLlmsFullTxt(plans: readonly PricingPlan[], pages: readonly EditorialPage[], catalog?: readonly CatalogOffer[]): string {
  return [
    `# ${PUBLISHER.brand} (fisca.ma) — version détaillée`,
    '',
    `> ${PUBLISHER.summaryFr}`,
    '',
    '## Éditeur',
    ...identityLines(),
    `- Pays : Maroc (${PUBLISHER.countryIso2})`,
    '',
    `## Grille tarifaire (${PRICING_CURRENCY}, hors taxes)`,
    ...plans.flatMap(detailedPlanLines),
    ...(catalog === undefined ? [] : ['### Autres familles (POS, cabinets, grands comptes)', ...catalogLines(catalog), '']),
    '## Arbre des guides',
    ...pagesByLocale(pages),
    '## Barèmes fiscaux',
    ...baremesLines(true),
    '## Accès agents',
    ...agentAccessLines(),
    '',
  ].join('\n');
}
