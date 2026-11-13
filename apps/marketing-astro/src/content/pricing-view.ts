import {
  ADDITIONAL_SEAT_MONTHLY_HT_CENTS,
  ENTERPRISE_CONTRACTS,
  FIDUCIARY_METER,
  PACK_MOWAKABA_CABINET,
  PME_COMPARISON,
  POS_MODULES,
  PRICING_FAMILY_ORDER,
  PRICING_PLANS,
  discountedDossierCents,
} from './pricing.ts';
import type { PricingFamilyId, RecurringPlanCode } from './pricing.ts';
import { fill } from '../i18n/copy-locale.ts';
import { getPricingCopy } from '../i18n/pricing-copy.ts';
import type { FaqCopy, OfferCode, PricingCopy } from '../i18n/pricing-copy.ts';
import type { MarketingLocale } from '../i18n/locales.ts';
import { formatCentsMad } from '../lib/money.ts';

/** Phrase avec un montant optionnel inséré entre `before` et `after` (le montant s'affiche en tabular-nums, dir=ltr). */
export interface FactView {
  readonly before: string;
  readonly cents: number | null;
  readonly after: string;
}

export interface CardPriceView {
  /** Montant mensuel HT, ou `null`. */
  readonly monthlyCents: number | null;
  readonly annualCents: number | null;
  readonly oneOffCents: number | null;
  /** Vrai si l'offre est incluse sans supplément (montant 0). */
  readonly included: boolean;
  /** Libellé de l'unité mensuelle (« par mois » ou « par dossier actif et par mois »). */
  readonly monthlyUnit: string;
  /** Vrai si le sélecteur mensuel/annuel agit sur la carte. */
  readonly togglesBilling: boolean;
}

export interface CardView {
  readonly code: OfferCode;
  readonly name: string;
  readonly audience: string;
  readonly inclusions: readonly string[];
  readonly price: CardPriceView;
  readonly facts: readonly FactView[];
  readonly trialCta: boolean;
}

export interface FamilyView {
  readonly id: PricingFamilyId;
  readonly heading: string;
  readonly intro: string;
  readonly cards: readonly CardView[];
  readonly notes: readonly string[];
}

export type CellView =
  | { readonly kind: 'money'; readonly cents: number }
  | { readonly kind: 'text'; readonly text: string };

export interface TableRowView {
  readonly header: string;
  readonly cells: readonly CellView[];
}

export interface TableView {
  readonly id: 'pme' | 'pos' | 'oec' | 'enterprise';
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly TableRowView[];
}

export interface PricingView {
  readonly locale: MarketingLocale;
  readonly copy: PricingCopy;
  readonly notes: readonly string[];
  readonly families: readonly FamilyView[];
  readonly tablesHeading: string;
  readonly tables: readonly TableView[];
  readonly faqHeading: string;
  readonly faq: readonly FaqCopy[];
}

const DASH = '—';

function text(value: string): CellView {
  return { kind: 'text', text: value };
}

function money(cents: number): CellView {
  return { kind: 'money', cents };
}

/** Un montant nul s'affiche « Inclus » : jamais « 0,00 MAD ». */
function moneyOrIncluded(cents: number, copy: PricingCopy): CellView {
  return cents === 0 ? text(copy.labels.included) : money(cents);
}

function offerText(copy: PricingCopy, code: OfferCode): PricingCopy['offers'][OfferCode] {
  return copy.offers[code];
}

function seatFact(copy: PricingCopy): FactView {
  const [before = '', after = ''] = copy.labels.additionalSeat.split('{price}');
  return { before, cents: ADDITIONAL_SEAT_MONTHLY_HT_CENTS, after };
}

function pmeCards(copy: PricingCopy): CardView[] {
  const cards: CardView[] = [];
  for (const plan of PRICING_PLANS) {
    const o = offerText(copy, plan.code);
    if (plan.kind === 'RECURRING') {
      const comparison = PME_COMPARISON.find((c) => c.code === plan.code);
      cards.push({
        code: plan.code,
        name: o.name,
        audience: o.audience,
        inclusions: o.inclusions,
        price: { monthlyCents: plan.monthly_ht_cents, annualCents: plan.annual_ht_cents, oneOffCents: null, included: false, monthlyUnit: copy.labels.perMonth, togglesBilling: true },
        facts: comparison?.additionalSeatAllowed === true ? [seatFact(copy)] : [],
        trialCta: true,
      });
    } else {
      cards.push({
        code: plan.code,
        name: o.name,
        audience: o.audience,
        inclusions: o.inclusions,
        price: { monthlyCents: null, annualCents: null, oneOffCents: plan.one_off_ht_cents, included: false, monthlyUnit: copy.labels.perMonth, togglesBilling: false },
        facts: [{ before: copy.mowakabaNote, cents: null, after: '' }],
        trialCta: false,
      });
    }
  }
  return cards;
}

function posCards(copy: PricingCopy): CardView[] {
  return POS_MODULES.map((m) => {
    const o = offerText(copy, m.code);
    return {
      code: m.code,
      name: o.name,
      audience: o.audience,
      inclusions: o.inclusions,
      price: { monthlyCents: m.monthly_ht_cents, annualCents: m.annual_ht_cents, oneOffCents: null, included: m.monthly_ht_cents === 0, monthlyUnit: copy.labels.perMonth, togglesBilling: true },
      facts: [],
      trialCta: false,
    };
  });
}

function oecCards(copy: PricingCopy): CardView[] {
  const base = offerText(copy, 'CABINET_BASE');
  const cards: CardView[] = [
    {
      code: 'CABINET_BASE',
      name: base.name,
      audience: base.audience,
      inclusions: base.inclusions,
      price: { monthlyCents: FIDUCIARY_METER.base.monthly_ht_cents, annualCents: null, oneOffCents: null, included: false, monthlyUnit: copy.labels.perMonth, togglesBilling: false },
      facts: [],
      trialCta: false,
    },
  ];
  for (const tier of FIDUCIARY_METER.dossierTiers) {
    const o = offerText(copy, tier.code);
    cards.push({
      code: tier.code,
      name: o.name,
      audience: o.audience,
      inclusions: o.inclusions,
      price: { monthlyCents: tier.monthly_ht_cents, annualCents: null, oneOffCents: null, included: false, monthlyUnit: copy.labels.perDossierMonth, togglesBilling: false },
      facts: [{ before: `${copy.tables.oec.discountedColumn} : `, cents: discountedDossierCents(tier), after: '' }],
      trialCta: false,
    });
  }
  const pack = offerText(copy, 'PACK_MOWAKABA_CABINET');
  cards.push({
    code: 'PACK_MOWAKABA_CABINET',
    name: pack.name,
    audience: pack.audience,
    inclusions: pack.inclusions,
    price: { monthlyCents: null, annualCents: null, oneOffCents: PACK_MOWAKABA_CABINET.one_off_ht_cents, included: false, monthlyUnit: copy.labels.perMonth, togglesBilling: false },
    facts: [{ before: copy.mowakabaNote, cents: null, after: '' }],
    trialCta: false,
  });
  return cards;
}

function enterpriseCards(copy: PricingCopy): CardView[] {
  return ENTERPRISE_CONTRACTS.map((c) => {
    const o = offerText(copy, c.code);
    return {
      code: c.code,
      name: o.name,
      audience: o.audience,
      inclusions: o.inclusions,
      price: { monthlyCents: null, annualCents: c.annual_ht_cents, oneOffCents: null, included: false, monthlyUnit: copy.labels.perMonth, togglesBilling: false },
      facts: [
        { before: fill(copy.labels.includedIce, { count: String(c.includedIce) }), cents: null, after: '' },
        { before: `${copy.tables.enterprise.columns[3]} : `, cents: c.additionalIceAnnual_ht_cents, after: '' },
      ],
      trialCta: false,
    };
  });
}

function familyView(id: PricingFamilyId, copy: PricingCopy): FamilyView {
  const heading = copy.families[id].heading;
  const intro = copy.families[id].intro;
  switch (id) {
    case 'PME':
      return { id, heading, intro, cards: pmeCards(copy), notes: [copy.annualNote] };
    case 'POS':
      return { id, heading, intro, cards: posCards(copy), notes: [] };
    case 'OEC':
      return { id, heading, intro, cards: oecCards(copy), notes: [copy.portalsNote] };
    case 'CORPORATE_SOUVERAIN':
      return { id, heading, intro, cards: enterpriseCards(copy), notes: [copy.portalsNote] };
  }
}

function pmeTable(copy: PricingCopy): TableView {
  const t = copy.tables.pme;
  const codes: readonly RecurringPlanCode[] = ['SOLO_AE', 'ESSENTIEL_TPE', 'CROISSANCE_PME'];
  const plans = codes.map((code) => {
    const plan = PRICING_PLANS.find((p) => p.code === code);
    const comparison = PME_COMPARISON.find((c) => c.code === code);
    if (plan === undefined || plan.kind !== 'RECURRING' || comparison === undefined) throw new RangeError(`Palier PME incomplet : ${code}`);
    return { plan, comparison };
  });
  const yesNo = (value: boolean): CellView => text(value ? copy.labels.yes : copy.labels.no);
  const posLabel = (pos: 'NONE' | 'POS_BRIDGE' | 'POS_TACTILE_1'): string =>
    pos === 'NONE' ? t.posValues.none : pos === 'POS_BRIDGE' ? t.posValues.bridge : t.posValues.tactile1;
  return {
    id: 'pme',
    caption: t.caption,
    columns: [t.criterion, ...codes.map((code) => offerText(copy, code).name)],
    rows: [
      { header: t.rows.monthly, cells: plans.map((p) => money(p.plan.monthly_ht_cents)) },
      { header: t.rows.annual, cells: plans.map((p) => money(p.plan.annual_ht_cents)) },
      { header: t.rows.seats, cells: plans.map((p) => text(String(p.comparison.includedSeats))) },
      { header: t.rows.pos, cells: plans.map((p) => text(posLabel(p.comparison.pos))) },
      { header: t.rows.extraSeat, cells: plans.map((p) => (p.comparison.additionalSeatAllowed ? money(ADDITIONAL_SEAT_MONTHLY_HT_CENTS) : text(DASH))) },
      { header: t.rows.connectors, cells: plans.map((p) => yesNo(p.comparison.sageOdooConnectors)) },
      { header: t.rows.ledger, cells: plans.map((p) => yesNo(p.comparison.immutableLedger)) },
      { header: t.rows.btp, cells: plans.map((p) => yesNo(p.comparison.btpAndAnnualReturn)) },
    ],
  };
}

function posTable(copy: PricingCopy): TableView {
  const t = copy.tables.pos;
  return {
    id: 'pos',
    caption: t.caption,
    columns: [...t.columns],
    rows: POS_MODULES.map((m) => ({
      header: offerText(copy, m.code).name,
      cells: [text(offerText(copy, m.code).audience), moneyOrIncluded(m.monthly_ht_cents, copy), moneyOrIncluded(m.annual_ht_cents, copy), text(t.conditions[m.condition])],
    })),
  };
}

function oecTable(copy: PricingCopy): TableView {
  const t = copy.tables.oec;
  return {
    id: 'oec',
    caption: t.caption,
    columns: [t.columns[0], t.columns[1], t.discountedColumn],
    rows: [
      { header: offerText(copy, 'CABINET_BASE').name, cells: [money(FIDUCIARY_METER.base.monthly_ht_cents), text(t.notDiscounted)] },
      ...FIDUCIARY_METER.dossierTiers.map((tier) => ({
        header: offerText(copy, tier.code).name,
        cells: [money(tier.monthly_ht_cents), money(discountedDossierCents(tier))],
      })),
    ],
  };
}

function enterpriseTable(copy: PricingCopy): TableView {
  const t = copy.tables.enterprise;
  return {
    id: 'enterprise',
    caption: t.caption,
    columns: [...t.columns],
    rows: ENTERPRISE_CONTRACTS.map((c) => ({
      header: offerText(copy, c.code).name,
      cells: [money(c.annual_ht_cents), text(String(c.includedIce)), money(c.additionalIceAnnual_ht_cents), text(c.dataResidencyMoroccoOnly ? t.hostingMorocco : t.hostingStandard)],
    })),
  };
}

/** Modèle unique de la page tarifs : source du HTML, du miroir Markdown, de llms.txt et du JSON-LD (FAQ). */
export function buildPricingView(locale: MarketingLocale): PricingView {
  const copy = getPricingCopy(locale);
  return {
    locale,
    copy,
    notes: [copy.taxNote, copy.trialNote],
    families: PRICING_FAMILY_ORDER.map((id) => familyView(id, copy)),
    tablesHeading: copy.tables.heading,
    tables: [pmeTable(copy), posTable(copy), oecTable(copy), enterpriseTable(copy)],
    faqHeading: copy.faqHeading,
    faq: copy.faq,
  };
}

export function cellToPlainText(cell: CellView): string {
  return cell.kind === 'money' ? formatCentsMad(cell.cents) : cell.text;
}

export function factToPlainText(fact: FactView): string {
  return `${fact.before}${fact.cents === null ? '' : formatCentsMad(fact.cents)}${fact.after}`;
}

function priceToPlainText(card: CardView, copy: PricingCopy): string {
  const p = card.price;
  if (p.included) return copy.labels.included;
  const parts: string[] = [];
  if (p.monthlyCents !== null) parts.push(`${formatCentsMad(p.monthlyCents)} ${p.monthlyUnit}`);
  if (p.annualCents !== null) parts.push(`${formatCentsMad(p.annualCents)} ${copy.labels.perYear}`);
  if (p.oneOffCents !== null) parts.push(`${formatCentsMad(p.oneOffCents)} (${copy.labels.oneOff})`);
  return parts.join(' ; ');
}

function markdownTable(table: TableView): string {
  const header = `| ${table.columns.join(' | ')} |`;
  const separator = `| ${table.columns.map(() => '---').join(' | ')} |`;
  const rows = table.rows.map((r) => `| ${[r.header, ...r.cells.map(cellToPlainText)].join(' | ')} |`);
  return [`**${table.caption}**`, '', header, separator, ...rows].join('\n');
}

export interface MarkdownSection {
  readonly heading: string;
  readonly body: string;
}

/** Sections Markdown du miroir /<langue>/tarifs.md : mêmes montants que le HTML, via formatCentsMad. */
export function pricingMarkdownSections(view: PricingView): MarkdownSection[] {
  const { copy } = view;
  const sections: MarkdownSection[] = [{ heading: copy.billing.legend, body: [...view.notes, copy.billing.appliesTo].join('\n\n') }];
  for (const family of view.families) {
    const lines: string[] = [family.intro, ''];
    for (const card of family.cards) {
      lines.push(`- **${card.name}** (${card.audience}) : ${priceToPlainText(card, copy)}`);
      for (const inclusion of card.inclusions) lines.push(`  - ${inclusion}`);
      for (const fact of card.facts) lines.push(`  - ${factToPlainText(fact)}`);
    }
    if (family.notes.length > 0) lines.push('', ...family.notes);
    sections.push({ heading: family.heading, body: lines.join('\n') });
  }
  sections.push({ heading: view.tablesHeading, body: view.tables.map(markdownTable).join('\n\n') });
  sections.push({ heading: view.faqHeading, body: view.faq.map((f) => `**${f.question}**\n\n${f.answer}`).join('\n\n') });
  return sections;
}
