/**
 * Générateur de pages éditoriales « Answer-First » (Doc_18 S04) : une spécification de page + une langue + une
 * politique de facturation donnent une vue typée (HTML, miroir Markdown, JSON-LD, seuil de qualité Doc_18 S10).
 */
import { BILLING_POLICY } from '../billing-policy.ts';
import type { BillingPolicy } from '../billing-policy.ts';
import { datedValue, datedValueKeys } from '../dated-values.ts';
import type { VerificationState } from '../dated-values.ts';
import { TRIAL_DAYS } from '../pricing.ts';
import { copyLocaleOf, fill } from '../../i18n/copy-locale.ts';
import type { CopyLocale } from '../../i18n/copy-locale.ts';
import { LOCALE_URL_PREFIX } from '../../i18n/locales.ts';
import type { MarketingLocale } from '../../i18n/locales.ts';
import { formatBpsPercent, formatCentsMad } from '../../lib/money.ts';
import { buildCase, isCaseId } from './cases.ts';
import { CASE_COPY } from './cases-copy.ts';
import { getFact } from './facts.ts';
import { buildSlots } from './slots.ts';
import type { Slots } from './slots.ts';
import { getSource, isPrimarySource } from './sources.ts';
import type { CaseCopy, CaseView, Fact, L4, SiloId, SiloPageSpec, SourceKind } from './types.ts';
import { UI } from './ui-copy.ts';

export const VERDICT_MIN_WORDS = 40;
export const VERDICT_MAX_WORDS = 60;
export const TABLE_MAX_COLUMNS = 4;
export const TABLE_MIN_ROWS = 3;

export interface TableView {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface CaseLineView {
  readonly id: string;
  readonly label: string;
  readonly cents: number | null;
  readonly text: string | null;
  readonly isResult: boolean;
}

export interface CaseRenderView {
  readonly id: string;
  readonly title: string;
  readonly scenario: string;
  readonly basisLabel: string;
  readonly basis: readonly string[];
  readonly lines: readonly CaseLineView[];
  readonly note: string;
}

export interface SourceView {
  readonly id: string;
  readonly label: string;
  readonly kindLabel: string;
  readonly kind: SourceKind;
  readonly primary: boolean;
}

export interface DatedValueView {
  readonly key: string;
  readonly display: string;
  readonly as_of: string;
  readonly state: VerificationState;
}

export interface LinkView {
  readonly label: string;
  readonly href: string;
}

export interface QualityReport {
  readonly indexable: boolean;
  /** Critères du seuil Doc_18 S10 non atteints. */
  readonly missing: readonly string[];
}

export interface SiloPageView {
  readonly kind: 'page';
  readonly locale: MarketingLocale;
  readonly contentLanguage: CopyLocale;
  readonly silo: SiloId;
  readonly siloSlug: string;
  /** Slug complet, sans préfixe de langue : `<silo>/<page>`. */
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly verdict: string;
  readonly verdictWords: number;
  readonly table: TableView;
  readonly case: CaseRenderView | null;
  readonly datedValues: readonly DatedValueView[];
  readonly sources: readonly SourceView[];
  readonly faqs: readonly { readonly question: string; readonly answer: string }[];
  readonly steps: readonly { readonly name: string; readonly text: string }[];
  readonly cta: LinkView;
  readonly related: readonly LinkView[];
  readonly breadcrumb: readonly LinkView[];
  readonly quality: QualityReport;
  readonly legislation: { readonly name: string; readonly identifier: string } | null;
  readonly labels: SiloUiLabels;
}

export interface SiloUiLabels {
  readonly verdict: string;
  readonly tableHeading: string;
  readonly caseHeading: string;
  readonly datedHeading: string;
  readonly datedIntro: string;
  readonly sourcesHeading: string;
  readonly faqHeading: string;
  readonly relatedHeading: string;
  readonly breadcrumbLabel: string;
  readonly disclaimer: string;
  readonly notIndexed: string;
  readonly howToName: string;
  readonly noteHeading: string;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

const slotCache = new Map<string, Slots>();

function slotsFor(locale: CopyLocale, policy: BillingPolicy): Slots {
  const key = `${locale}|${policy.fiduciaryProrata}`;
  const hit = slotCache.get(key);
  if (hit !== undefined) return hit;
  const fresh = buildSlots(locale, policy);
  slotCache.set(key, fresh);
  return fresh;
}

/** Noms de variables `{nom}` présents dans un gabarit. */
export function slotNamesIn(template: string): readonly string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '');
}

function datedKeyOfSlot(name: string): string | undefined {
  return datedValueKeys().find((k) => k === name || k === `${name}_bps` || k === `${name}_cents`);
}

function sourceKindLabel(kind: SourceKind, loc: CopyLocale): string {
  switch (kind) {
    case 'law':
      return UI.sourceLaw[loc];
    case 'xsd':
      return UI.sourceXsd[loc];
    case 'standard':
      return UI.sourceStandard[loc];
    case 'internal':
      return UI.sourceInternal[loc];
  }
}

function uiLabels(loc: CopyLocale): SiloUiLabels {
  return {
    verdict: UI.verdict[loc],
    tableHeading: UI.tableHeading[loc],
    caseHeading: UI.caseHeading[loc],
    datedHeading: UI.datedHeading[loc],
    datedIntro: UI.datedIntro[loc],
    sourcesHeading: UI.sourcesHeading[loc],
    faqHeading: UI.faqHeading[loc],
    relatedHeading: UI.relatedHeading[loc],
    breadcrumbLabel: UI.breadcrumbLabel[loc],
    disclaimer: UI.disclaimer[loc],
    notIndexed: UI.notIndexed[loc],
    howToName: UI.howToName[loc],
    noteHeading: UI.noteHeading[loc],
  };
}

function buildCaseView(caseView: CaseView, copy: CaseCopy, loc: CopyLocale, slots: Slots): CaseRenderView {
  return {
    id: caseView.id,
    title: fill(copy.title[loc], slots),
    scenario: fill(copy.scenario[loc], slots),
    basisLabel: UI.caseBasis[loc],
    basis: caseView.basis,
    lines: caseView.lines.map((line) => {
      const label = copy.labels[line.id];
      if (label === undefined) throw new RangeError(`Libellé de ligne absent : ${caseView.id}/${line.id}`);
      return {
        id: line.id,
        label: label[loc],
        cents: line.cents ?? null,
        text: line.text === undefined ? null : line.text[loc],
        isResult: line.id === caseView.resultLineId,
      };
    }),
    note: fill(copy.note[loc], slots),
  };
}

function formatDated(key: string): string {
  const v = datedValue(key);
  return v.kind === 'bps' ? formatBpsPercent(v.value) : v.kind === 'cents' ? formatCentsMad(v.value) : String(v.value);
}

export interface SiloContext {
  readonly siloSlug: string;
  readonly siloTitle: L4;
  readonly pageTitleOf: (slug: string) => L4;
}

/** Seuil de qualité Doc_18 S10 : verdict, tableau, cas chiffré, sources. Sinon noindex et hors sitemap. */
export function assessQuality(view: Pick<SiloPageView, 'verdictWords' | 'table' | 'case' | 'sources' | 'faqs'>): QualityReport {
  const missing: string[] = [];
  if (view.verdictWords < VERDICT_MIN_WORDS || view.verdictWords > VERDICT_MAX_WORDS) missing.push('verdict');
  if (view.table.rows.length < TABLE_MIN_ROWS || view.table.columns.length > TABLE_MAX_COLUMNS) missing.push('tableau');
  const c = view.case;
  const integerCase = c !== null && c.lines.filter((l) => l.cents !== null).length >= 2 && c.lines.every((l) => l.cents === null || Number.isSafeInteger(l.cents));
  if (!integerCase) missing.push('cas chiffré');
  if (view.sources.length < 2 || !view.sources.some((s) => s.primary)) missing.push('sources');
  if (view.faqs.length < 1) missing.push('faq');
  return { indexable: missing.length === 0, missing };
}

export function buildSiloPageView(locale: MarketingLocale, spec: SiloPageSpec, ctx: SiloContext, policy: BillingPolicy = BILLING_POLICY): SiloPageView {
  const loc = copyLocaleOf(locale);
  const slots = slotsFor(loc, policy);
  const prefix = LOCALE_URL_PREFIX[locale];
  const title = fill(spec.title[loc], slots);
  const verdictTemplate = spec.verdict[loc];
  const verdict = fill(verdictTemplate, slots);

  const facts: readonly Fact[] = [...(spec.extraFacts ?? []), ...spec.facts.map(getFact)];
  const rows = facts.map((f) => [fill(f.label[loc], slots), fill(f.value[loc], slots), getSource(f.ref).label[loc]]);
  const table: TableView = { caption: UI.tableCaption[loc], columns: UI.tableColumns[loc].split('|'), rows };

  let renderedCase: CaseRenderView | null = null;
  let caseDatedKeys: readonly string[] = [];
  if (spec.caseId !== null) {
    if (!isCaseId(spec.caseId)) throw new RangeError(`Cas inconnu : ${spec.caseId}`);
    const caseView = buildCase(spec.caseId, policy);
    renderedCase = buildCaseView(caseView, CASE_COPY[spec.caseId], loc, slots);
    caseDatedKeys = caseView.datedKeys;
  }

  const templates = [verdictTemplate, spec.faq.a[loc], ...facts.map((f) => f.value[loc])];
  const usedKeys = new Set<string>(caseDatedKeys);
  for (const tpl of templates) {
    for (const name of slotNamesIn(tpl)) {
      const key = datedKeyOfSlot(name);
      if (key !== undefined) usedKeys.add(key);
    }
  }
  const datedValues: DatedValueView[] = datedValueKeys()
    .filter((k) => usedKeys.has(k))
    .map((k) => ({ key: k, display: formatDated(k), as_of: datedValue(k).as_of, state: datedValue(k).state }));

  const sources: SourceView[] = spec.sources.map((id) => {
    const s = getSource(id);
    return { id, label: s.label[loc], kindLabel: sourceKindLabel(s.kind, loc), kind: s.kind, primary: isPrimarySource(s) };
  });

  const faqs = [{ question: fill(spec.faq.q[loc], slots), answer: fill(spec.faq.a[loc], slots) }];

  const steps =
    spec.howTo && renderedCase !== null
      ? renderedCase.lines.map((l) => ({
          name: l.label,
          text: l.cents !== null ? `${l.label} : ${formatCentsMad(l.cents)}` : `${l.label} : ${l.text ?? ''}`,
        }))
      : [];

  const base = `/${prefix}`;
  const cta: LinkView =
    spec.cta === 'trial'
      ? { label: fill(UI.ctaTrial[loc], { days: String(TRIAL_DAYS) }), href: 'https://app.fisca.ma/' }
      : { label: UI.ctaPricing[loc], href: `${base}/tarifs` };

  const related: LinkView[] = spec.related.map((slug) => ({
    label: fill(ctx.pageTitleOf(slug)[loc], slots),
    href: `${base}/${ctx.siloSlug}/${slug}`,
  }));

  const breadcrumb: LinkView[] = [
    { label: UI.home[loc], href: `${base}/` },
    { label: ctx.siloTitle[loc], href: `${base}/${ctx.siloSlug}` },
    { label: title, href: `${base}/${ctx.siloSlug}/${spec.slug}` },
  ];

  const law = spec.sources.map(getSource).find((s) => s.kind === 'law');
  const partial = { verdictWords: countWords(verdict), table, case: renderedCase, sources, faqs };
  return {
    kind: 'page',
    locale,
    contentLanguage: loc,
    silo: spec.silo,
    siloSlug: ctx.siloSlug,
    slug: `${ctx.siloSlug}/${spec.slug}`,
    title,
    description: fill(UI.descriptionTemplate[loc], { title, silo: ctx.siloTitle[loc] }),
    verdict,
    verdictWords: partial.verdictWords,
    table,
    case: renderedCase,
    datedValues,
    sources,
    faqs,
    steps,
    cta,
    related,
    breadcrumb,
    quality: assessQuality(partial),
    legislation: law === undefined ? null : { name: law.label[loc], identifier: law.id },
    labels: uiLabels(loc),
  };
}

/** Miroir Markdown des sections d'une page de silo : aucune balise HTML, tableaux en tubes. */
export function siloMarkdownSections(view: SiloPageView): readonly { readonly heading: string; readonly body: string }[] {
  const out: { heading: string; body: string }[] = [];
  out.push({ heading: view.labels.verdict, body: view.verdict });
  const header = `| ${view.table.columns.join(' | ')} |`;
  const sep = `| ${view.table.columns.map(() => '---').join(' | ')} |`;
  const body = view.table.rows.map((r) => `| ${r.map((c) => c.replaceAll('|', '/')).join(' | ')} |`);
  out.push({ heading: view.labels.tableHeading, body: [header, sep, ...body].join('\n') });
  if (view.case !== null) {
    const lines = view.case.lines.map((l) => `- ${l.label} : ${l.cents !== null ? formatCentsMad(l.cents) : (l.text ?? '')}`);
    out.push({
      heading: view.labels.caseHeading,
      body: [view.case.title, '', view.case.scenario, '', ...lines, '', `${view.case.basisLabel} : ${view.case.basis.join(', ')}.`, '', view.case.note].join('\n'),
    });
  }
  if (view.datedValues.length > 0) {
    out.push({
      heading: view.labels.datedHeading,
      body: [view.labels.datedIntro, '', ...view.datedValues.map((d) => `- ${d.key} : ${d.display} (${d.as_of}, ${d.state})`)].join('\n'),
    });
  }
  out.push({ heading: view.labels.sourcesHeading, body: view.sources.map((s) => `- ${s.label} (${s.kindLabel})`).join('\n') });
  out.push({ heading: view.labels.faqHeading, body: view.faqs.map((f) => `**${f.question}**\n\n${f.answer}`).join('\n\n') });
  out.push({ heading: view.cta.label, body: view.cta.href });
  out.push({ heading: view.labels.relatedHeading, body: view.related.map((r) => `- [${r.label}](${r.href})`).join('\n') });
  const notes = view.quality.indexable ? view.labels.disclaimer : `${view.labels.disclaimer}\n\n${view.labels.notIndexed}`;
  out.push({ heading: view.labels.noteHeading, body: notes });
  return out;
}
