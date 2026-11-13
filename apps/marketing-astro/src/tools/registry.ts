/**
 * Registre des outils publics (T-P2C-06 et T-P2C-07) : 5 outils + un hub, chacun en 6 langues = 36 pages éditoriales, source unique du
 * HTML, du miroir Markdown, de llms.txt, du sitemap, des hreflang et du JSON-LD (HowTo, FAQPage).
 */
import { datedValue } from '../content/dated-values.ts';
import type { VerificationState } from '../content/dated-values.ts';
import type { EditorialPage } from '../content/pages.ts';
import { copyLocaleOf, fill, usesFrenchFallback } from '../i18n/copy-locale.ts';
import type { CopyLocale } from '../i18n/copy-locale.ts';
import { LOCALE_URL_PREFIX, MARKETING_LOCALES } from '../i18n/locales.ts';
import type { MarketingLocale } from '../i18n/locales.ts';
import { formatBpsPercent, formatCentsMad } from '../lib/money.ts';
import { getPricingPlan, PACK_MOWAKABA_CABINET } from '../content/pricing.ts';
import { AE_PAGE } from './copy/ae.ts';
import { COMMON, PARAM_LABELS, TOOLS_HUB_SLUG } from './copy/common.ts';
import { ICE_EXISTENCE_NOTICE, ICE_PAGE } from './copy/ice.ts';
import { LOI_PAGE } from './copy/loi.ts';
import { MOWAKABA_PAGE } from './copy/mowakaba.ts';
import type { ToolFaq, ToolPageCopy, ToolSection, ToolStep } from './copy/page-types.ts';
import { RAS_PAGE } from './copy/ras.ts';
import type { RulesPayload } from './ui/dom.ts';
import { computeAeClientThreshold } from './auto-entrepreneur.ts';
import { scenarioFor } from './mowakaba.ts';
import { AE_PARAM_KEYS, CASH_PARAM_KEYS, LATE_PARAM_KEYS, MOWAKABA_PARAM_KEYS, RAS_PARAM_KEYS } from './rule-params.ts';

export type ToolId = 'ice' | 'loi' | 'ras' | 'ae' | 'mowakaba';

/** Exemple affiché dans la FAQ de l'auto-entrepreneur : entrées de VEC-CGI-04 (le résultat est recalculé, jamais recopié). */
export const AE_EXAMPLE = { priorCumulCents: 7500000, invoiceCents: 1200000 } as const;

export interface ToolDefinition {
  readonly id: ToolId;
  /** Slug complet, sans préfixe de langue. */
  readonly slug: string;
  readonly copy: ToolPageCopy;
  readonly paramKeys: readonly string[];
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  { id: 'ice', slug: `${TOOLS_HUB_SLUG}/audit-ice-excel`, copy: ICE_PAGE, paramKeys: ['ice_key_modulus'] },
  { id: 'loi', slug: `${TOOLS_HUB_SLUG}/simulateur-loi-69-21`, copy: LOI_PAGE, paramKeys: LATE_PARAM_KEYS },
  { id: 'ras', slug: `${TOOLS_HUB_SLUG}/ras-tva-especes`, copy: RAS_PAGE, paramKeys: [...new Set([...RAS_PARAM_KEYS, ...CASH_PARAM_KEYS])] },
  { id: 'ae', slug: `${TOOLS_HUB_SLUG}/simulateur-auto-entrepreneur`, copy: AE_PAGE, paramKeys: AE_PARAM_KEYS },
  { id: 'mowakaba', slug: `${TOOLS_HUB_SLUG}/subvention-mowakaba`, copy: MOWAKABA_PAGE, paramKeys: MOWAKABA_PARAM_KEYS },
];

export function toolDefinition(id: ToolId): ToolDefinition {
  const found = TOOL_DEFINITIONS.find((d) => d.id === id);
  if (found === undefined) throw new RangeError(`Outil inconnu : ${id}`);
  return found;
}

export function toolIdFromSlug(segment: string): ToolId | null {
  return TOOL_DEFINITIONS.find((d) => d.slug === `${TOOLS_HUB_SLUG}/${segment}`)?.id ?? null;
}

export function formatDatedValue(key: string): string {
  const v = datedValue(key);
  return v.kind === 'bps' ? formatBpsPercent(v.value) : v.kind === 'cents' ? formatCentsMad(v.value) : String(v.value);
}

function recurringPlan(code: 'SOLO_AE' | 'ESSENTIEL_TPE'): { readonly monthly: number; readonly annual: number } {
  const plan = getPricingPlan(code);
  if (plan.kind !== 'RECURRING') throw new RangeError(`Offre récurrente attendue : ${code}`);
  return { monthly: plan.monthly_ht_cents, annual: plan.annual_ht_cents };
}

function onePackPrice(): number {
  const plan = getPricingPlan('PACK_MOWAKABA_TPME');
  if (plan.kind !== 'ONE_OFF') throw new RangeError('Pack ponctuel attendu');
  return plan.one_off_ht_cents;
}

/** Prix des deux packs Mowakaba, lus de `content/pricing.ts`. */
export function mowakabaPackPrices(): { readonly tpmeCents: number; readonly cabinetCents: number } {
  return { tpmeCents: onePackPrice(), cabinetCents: PACK_MOWAKABA_CABINET.one_off_ht_cents };
}

function aeExampleSlots(): Readonly<Record<string, string>> {
  const out = computeAeClientThreshold(AE_EXAMPLE, { thresholdCents: datedValue('ae_client_threshold_cents').value, withholdingBps: datedValue('ae_withholding_bps').value });
  if (!out.ok) throw new RangeError('Exemple auto-entrepreneur invalide');
  const r = out.result;
  return {
    exPrior: formatCentsMad(AE_EXAMPLE.priorCumulCents),
    exInvoice: formatCentsMad(AE_EXAMPLE.invoiceCents),
    exCumul: formatCentsMad(r.cumulAfterCents),
    exSurplus: formatCentsMad(r.surplusCents),
    exWithheld: formatCentsMad(r.withheldCents),
  };
}

function mowakabaSlots(): Readonly<Record<string, string>> {
  const low = datedValue('mowakaba_coverage_low_bps').value;
  const high = datedValue('mowakaba_coverage_high_bps').value;
  const prices = mowakabaPackPrices();
  return {
    mowLow: formatDatedValue('mowakaba_coverage_low_bps'),
    mowHigh: formatDatedValue('mowakaba_coverage_high_bps'),
    mowCeiling: formatDatedValue('mowakaba_max_revenue_ht_cents'),
    mowOwnership: formatDatedValue('mowakaba_group_ownership_max_bps'),
    packTpme: formatCentsMad(prices.tpmeCents),
    packCabinet: formatCentsMad(prices.cabinetCents),
    tpmeFrom: formatCentsMad(scenarioFor(prices.tpmeCents, high).remainingCents),
    tpmeTo: formatCentsMad(scenarioFor(prices.tpmeCents, low).remainingCents),
    cabFrom: formatCentsMad(scenarioFor(prices.cabinetCents, high).remainingCents),
    cabTo: formatCentsMad(scenarioFor(prices.cabinetCents, low).remainingCents),
  };
}

/** Variables des textes de page : toutes tirées des valeurs datées, jamais recopiées dans les textes. */
export function toolSlots(): Readonly<Record<string, string>> {
  return {
    ...aeExampleSlots(),
    ...mowakabaSlots(),
    aeThreshold: formatDatedValue('ae_client_threshold_cents'),
    aeWithholding: formatDatedValue('ae_withholding_bps'),
    aeIrLow: formatDatedValue('ae_ir_rate_low_bps'),
    aeIrHigh: formatDatedValue('ae_ir_rate_high_bps'),
    priceEssentiel: formatCentsMad(recurringPlan('ESSENTIEL_TPE').monthly),
    priceEssentielAnnual: formatCentsMad(recurringPlan('ESSENTIEL_TPE').annual),
    legalDays: formatDatedValue('late_legal_days'),
    contractualDays: formatDatedValue('late_contractual_days'),
    sectorDays: formatDatedValue('late_sector_days'),
    baseRate: formatDatedValue('late_base_bps'),
    incrementRate: formatDatedValue('late_increment_bps'),
    totalBps: formatDatedValue('late_total_two_months_bps'),
    totalRate: formatBpsPercent(datedValue('late_total_two_months_bps').value),
    capDay: formatDatedValue('cash_cap_day_cents'),
    capMonth: formatDatedValue('cash_cap_month_cents'),
    rasReduced: formatDatedValue('ras_reduced_bps'),
    rasFull: formatDatedValue('ras_full_bps'),
    rasMonths: formatDatedValue('ras_attestation_months'),
    rasThreshold: formatDatedValue('ras_exclusion_threshold_ttc_cents'),
  };
}

export interface ParamView {
  readonly key: string;
  readonly label: string;
  readonly display: string;
  readonly value: number;
  readonly as_of: string;
  readonly state: VerificationState;
  readonly stateLabel: string;
}

export function paramView(key: string, loc: CopyLocale): ParamView {
  const v = datedValue(key);
  const label = key === 'ice_key_modulus' ? ICE_KEY_LABEL[loc] : (PARAM_LABELS[key]?.[loc] ?? key);
  return { key, label, display: formatDatedValue(key), value: v.value, as_of: v.as_of, state: v.state, stateLabel: COMMON.states[v.state][loc] };
}

const ICE_KEY_LABEL = {
  fr: 'Diviseur du contrôle de cohérence de l’ICE (modulo)',
  en: 'Divisor of the ICE consistency check (modulo)',
  ar: 'القاسم في فحص اتساق ICE (modulo)',
  ary: 'القاسم فتحقق التناسق د ICE (modulo)',
} as const;

/** Données de règles transmises à l'îlot : affichées avec chaque résultat (valeur, date, état de recoupement). */
export function rulesPayload(keys: readonly string[], loc: CopyLocale): RulesPayload {
  return { asOf: COMMON.asOf[loc], stateWord: STATE_WORD[loc], userValue: COMMON.userValue[loc], items: keys.map((k) => paramView(k, loc)) };
}

export interface ToolLinkView {
  readonly label: string;
  readonly href: string;
}

export interface ToolView {
  readonly kind: 'tool';
  readonly id: ToolId;
  readonly locale: MarketingLocale;
  readonly copyLocale: CopyLocale;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly heading: string;
  readonly lead: string;
  readonly summary: string;
  readonly steps: readonly ToolStep[];
  readonly faqs: readonly ToolFaq[];
  readonly sections: readonly ToolSection[];
  readonly params: readonly ParamView[];
  readonly disclaimer: string;
  readonly localProcessing: string;
  /** Mention obligatoire de l'auditeur d'ICE : la clé n'est pas une preuve d'existence. */
  readonly existenceNotice: string | null;
  readonly legislation: { readonly name: string; readonly identifier: string } | null;
  readonly breadcrumb: readonly ToolLinkView[];
  readonly related: readonly ToolLinkView[];
  readonly labels: {
    readonly breadcrumbLabel: string;
    readonly toolHeading: string;
    readonly howToHeading: string;
    readonly howToName: string;
    readonly faqHeading: string;
    readonly rulesHeading: string;
    readonly rulesIntro: string;
    readonly asOf: string;
    readonly otherTools: string;
    readonly trial: string;
    readonly jsRequired: string;
    readonly stateLabel: string;
    readonly existenceHeading: string;
    readonly disclaimerHeading: string;
  };
}

function hrefOf(locale: MarketingLocale, slug: string): string {
  return `/${LOCALE_URL_PREFIX[locale]}/${slug}`;
}

function fillSection(s: ToolSection, slots: Readonly<Record<string, string>>): ToolSection {
  return {
    heading: fill(s.heading, slots),
    paragraphs: s.paragraphs.map((p) => fill(p, slots)),
    ...(s.bullets === undefined ? {} : { bullets: s.bullets.map((b) => fill(b, slots)) }),
  };
}

export const STATE_WORD = { fr: 'état', en: 'state', ar: 'الحالة', ary: 'الحالة' } as const;
const HOWTO_NAME = {
  ice: { fr: 'Auditer et réparer des ICE dans un fichier Excel', en: 'Audit and repair ICE numbers in an Excel file', ar: 'تدقيق وإصلاح أرقام ICE في ملف Excel', ary: 'تدقيق وإصلاح ICE فملف Excel' },
  loi: { fr: 'Calculer la pénalité de retard de la loi 69-21', en: 'Compute the law 69-21 late-payment penalty', ar: 'حساب غرامة التأخر وفق القانون 69-21', ary: 'حساب غرامة التأخير بالقانون 69-21' },
  ras: { fr: 'Calculer la RAS-TVA et contrôler le plafond d’espèces', en: 'Compute VAT withholding and check the cash cap', ar: 'حساب اقتطاع TVA ومراقبة سقف النقد', ary: 'حساب اقتطاع TVA ومراقبة سقف الكاش' },
  ae: { fr: 'Simuler l’IR trimestriel et le seuil par client d’un auto-entrepreneur', en: 'Simulate an auto-entrepreneur’s quarterly income tax and per-client threshold', ar: 'محاكاة الضريبة الفصلية والعتبة لكل زبون للمقاول الذاتي', ary: 'محاكاة ضريبة الفصل والعتبة على كل كليان د المقاول الذاتي' },
  mowakaba: { fr: 'Estimer l’éligibilité Mowakaba et le reste à charge d’un pack', en: 'Estimate Mowakaba eligibility and the remaining cost of a pack', ar: 'تقدير الأهلية لمواكبة والمبلغ المتبقي لباقة', ary: 'تقدير الأهلية لمواكبة والمبلغ اللي كيبقى د باقة' },
} as const;

export function buildToolView(locale: MarketingLocale, id: ToolId): ToolView {
  const def = toolDefinition(id);
  const loc = copyLocaleOf(locale);
  const slots = toolSlots();
  const c = def.copy;
  const f = (text: string): string => fill(text, slots);
  return {
    kind: 'tool',
    id,
    locale,
    copyLocale: loc,
    slug: def.slug,
    title: f(c.title[loc]),
    description: f(c.description[loc]),
    heading: f(c.heading[loc]),
    lead: f(c.lead[loc]),
    summary: f(c.summary[loc]),
    steps: c.steps[loc].map((s) => ({ name: f(s.name), text: f(s.text) })),
    faqs: c.faqs[loc].map((q) => ({ question: f(q.question), answer: f(q.answer) })),
    sections: c.sections[loc].map((s) => fillSection(s, slots)),
    params: def.paramKeys.map((k) => paramView(k, loc)),
    disclaimer: COMMON.disclaimer[loc],
    localProcessing: COMMON.localProcessing[loc],
    existenceNotice: id === 'ice' ? ICE_EXISTENCE_NOTICE[loc] : null,
    legislation: c.legislation ?? null,
    breadcrumb: [
      { label: COMMON.home[loc], href: `/${LOCALE_URL_PREFIX[locale]}/` },
      { label: COMMON.toolsLabel[loc], href: hrefOf(locale, TOOLS_HUB_SLUG) },
      { label: f(c.heading[loc]), href: hrefOf(locale, def.slug) },
    ],
    related: TOOL_DEFINITIONS.filter((d) => d.id !== id).map((d) => ({ label: fill(d.copy.heading[loc], slots), href: hrefOf(locale, d.slug) })),
    labels: {
      breadcrumbLabel: COMMON.breadcrumbLabel[loc],
      toolHeading: COMMON.toolHeading[loc],
      howToHeading: COMMON.howToHeading[loc],
      howToName: HOWTO_NAME[id][loc],
      faqHeading: COMMON.faqHeading[loc],
      rulesHeading: COMMON.rulesHeading[loc],
      rulesIntro: COMMON.rulesIntro[loc],
      asOf: COMMON.asOf[loc],
      otherTools: COMMON.otherTools[loc],
      trial: COMMON.trial[loc],
      jsRequired: COMMON.jsRequired[loc],
      stateLabel: STATE_WORD[loc],
      existenceHeading: COMMON.existenceHeading[loc],
      disclaimerHeading: COMMON.disclaimerHeading[loc],
    },
  };
}

export interface ToolsHubView {
  readonly kind: 'hub';
  readonly locale: MarketingLocale;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly lead: string;
  readonly breadcrumb: readonly ToolLinkView[];
  readonly breadcrumbLabel: string;
  readonly entries: readonly { readonly label: string; readonly href: string; readonly summary: string }[];
}

export function buildToolsHubView(locale: MarketingLocale): ToolsHubView {
  const loc = copyLocaleOf(locale);
  const slots = toolSlots();
  return {
    kind: 'hub',
    locale,
    slug: TOOLS_HUB_SLUG,
    title: COMMON.hubTitle[loc],
    description: COMMON.hubDescription[loc],
    lead: COMMON.hubLead[loc],
    breadcrumb: [
      { label: COMMON.home[loc], href: `/${LOCALE_URL_PREFIX[locale]}/` },
      { label: COMMON.toolsLabel[loc], href: hrefOf(locale, TOOLS_HUB_SLUG) },
    ],
    breadcrumbLabel: COMMON.breadcrumbLabel[loc],
    entries: TOOL_DEFINITIONS.map((d) => ({ label: fill(d.copy.heading[loc], slots), href: hrefOf(locale, d.slug), summary: fill(d.copy.summary[loc], slots) })),
  };
}

function sectionMarkdown(s: ToolSection): { readonly heading: string; readonly body: string } {
  const parts = [...s.paragraphs];
  if (s.bullets !== undefined) parts.push(s.bullets.map((b) => `- ${b}`).join('\n'));
  return { heading: s.heading, body: parts.join('\n\n') };
}

/** Sections du miroir Markdown d'un outil : mêmes contenus que la page HTML, sans HTML. */
export function toolMarkdownSections(view: ToolView): readonly { readonly heading: string; readonly body: string }[] {
  const sections: { heading: string; body: string }[] = [{ heading: view.labels.toolHeading, body: `${view.summary}\n\n${view.localProcessing}` }];
  sections.push({ heading: view.labels.howToHeading, body: view.steps.map((s, i) => `${String(i + 1)}. **${s.name}** : ${s.text}`).join('\n') });
  for (const s of view.sections) sections.push(sectionMarkdown(s));
  if (view.existenceNotice !== null) sections.push({ heading: view.labels.existenceHeading, body: view.existenceNotice });
  sections.push({
    heading: view.labels.rulesHeading,
    body: [view.labels.rulesIntro, '', ...view.params.map((p) => `- ${p.label} : ${p.display} (${view.labels.asOf} ${p.as_of}, ${view.labels.stateLabel} ${p.state})`)].join('\n'),
  });
  sections.push({ heading: view.labels.faqHeading, body: view.faqs.map((q) => `### ${q.question}\n\n${q.answer}`).join('\n\n') });
  sections.push({ heading: view.labels.disclaimerHeading, body: view.disclaimer });
  return sections;
}

function editorialOfTool(view: ToolView): EditorialPage {
  return {
    locale: view.locale,
    slug: view.slug,
    title: view.title,
    description: view.description,
    heading: view.heading,
    lead: view.lead,
    contentLanguage: usesFrenchFallback(view.locale) ? 'fr' : view.copyLocale,
    sections: toolMarkdownSections(view),
    faqs: view.faqs,
    ...(view.legislation === null ? {} : { legislation: view.legislation }),
    howTo: { name: view.labels.howToName, steps: view.steps },
  };
}

function editorialOfHub(view: ToolsHubView): EditorialPage {
  return {
    locale: view.locale,
    slug: view.slug,
    title: view.title,
    description: view.description,
    heading: view.title,
    lead: view.lead,
    contentLanguage: usesFrenchFallback(view.locale) ? 'fr' : copyLocaleOf(view.locale),
    sections: [{ heading: view.title, body: view.entries.map((e) => `- [${e.label}](${e.href}) : ${e.summary}`).join('\n') }],
  };
}

/** 5 outils + 1 hub, 6 langues : 36 pages. */
export const TOOL_PAGES: readonly EditorialPage[] = [
  ...MARKETING_LOCALES.map((l) => editorialOfHub(buildToolsHubView(l))),
  ...TOOL_DEFINITIONS.flatMap((d) => MARKETING_LOCALES.map((l) => editorialOfTool(buildToolView(l, d.id)))),
];
