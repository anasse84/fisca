/**
 * Générateur des fiches du dictionnaire CGNC (Silo 3), gabarit « Answer-First » de Doc_18 S04 : un enregistrement du jeu
 * + une langue donnent une vue typée (HTML, miroir Markdown, JSON-LD) et le seuil de qualité Doc_18 S10 propre au silo :
 * sans sens du compte, règle de TVA et écriture équilibrée, la fiche est noindex. Texte = gabarit + données du compte.
 */
import { fill } from '../../i18n/copy-locale.ts';
import { LOCALE_URL_PREFIX } from '../../i18n/locales.ts';
import type { MarketingLocale } from '../../i18n/locales.ts';
import { formatCentsMad } from '../../lib/money.ts';
import { TABLE_MAX_COLUMNS, TABLE_MIN_ROWS, VERDICT_MAX_WORDS, VERDICT_MIN_WORDS, countWords } from '../silos/build.ts';
import { CGNC_ACCOUNTS, NORMAL_BALANCES, VAT_ENCAISSEMENT_RULES, entryIntegrity, findCgncAccount } from './dataset.ts';
import type { CgncAccountRecord, EntryLine } from './dataset.ts';
import {
  BALANCE_ADJ,
  BALANCE_SIDE,
  CGNC_HUB_SLUG,
  CGNC_SOURCES,
  CGNC_UI,
  CLASS_TITLES,
  CODE_EDI_PENDING,
  COUNTER,
  DISCLAIMER,
  HUB_LEAD,
  HUB_TITLE,
  PROVENANCE,
  RUBRIC_TEXT,
  VAT_RULE_ACCOUNT,
  VAT_RULE_TEXT,
  accountSlug,
  cgncLocaleOf,
} from './copy.ts';
import type { CgncLocale, T3 } from './copy.ts';
import { entryDescription } from './entry-descriptions.ts';

export interface LinkView {
  readonly label: string;
  readonly href: string;
}

export interface CgncTableView {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface EntryLineView {
  readonly account: string;
  /** Intitulé tiré du jeu, uniquement pour un compte qui a sa fiche ; jamais fabriqué. */
  readonly label: string | null;
  /** Lien vers la fiche, uniquement si elle existe. */
  readonly href: string | null;
  readonly debitCents: number | null;
  readonly creditCents: number | null;
}

export interface EntryView {
  readonly title: string;
  readonly description: string;
  readonly caption: string;
  readonly columns: readonly string[];
  readonly lines: readonly EntryLineView[];
  readonly totalLabel: string;
  readonly totalCents: number;
  readonly noSheetLabel: string;
}

export interface CgncSourceView {
  readonly id: string;
  readonly label: string;
  readonly kindLabel: string;
  readonly primary: boolean;
}

export interface CgncQuality {
  readonly indexable: boolean;
  readonly missing: readonly string[];
}

export interface CgncLabels {
  readonly verdict: string;
  readonly tableHeading: string;
  readonly caseHeading: string;
  readonly sourcesHeading: string;
  readonly faqHeading: string;
  readonly relatedHeading: string;
  readonly breadcrumbLabel: string;
  readonly noteHeading: string;
  readonly howToName: string;
  readonly notIndexed: string;
}

export interface CgncAccountView {
  readonly kind: 'cgnc-account';
  readonly locale: MarketingLocale;
  readonly contentLanguage: CgncLocale;
  readonly accountNumber: string;
  /** Slug complet sans préfixe de langue : `dictionnaire-cgnc/compte-<numéro>`. */
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly provenance: string;
  readonly verdict: string;
  readonly verdictWords: number;
  readonly table: CgncTableView;
  readonly entry: EntryView;
  readonly codeEdiNotice: string;
  readonly faqs: readonly { readonly question: string; readonly answer: string }[];
  readonly steps: readonly { readonly name: string; readonly text: string }[];
  readonly sources: readonly CgncSourceView[];
  readonly cta: LinkView;
  readonly related: readonly LinkView[];
  readonly breadcrumb: readonly LinkView[];
  readonly quality: CgncQuality;
  readonly legislation: { readonly name: string; readonly identifier: string };
  readonly disclaimer: string;
  readonly labels: CgncLabels;
}

const VERDICT_CORE: T3 = {
  fr: 'Compte {n}, « {label} » (classe {c}) : solde normalement {adj}. Rubrique de l’état de synthèse : {rubric}. TVA sur encaissement : {vat}. Écriture d’exemple équilibrée : {total}.',
  en: 'Account {n}, “{label}” (class {c}): normally a {adj} balance. Financial statement heading: {rubric}. VAT cash-basis rule: {vat}. Balanced worked entry: {total}.',
  ar: 'الحساب {n}، «{label}» (الصنف {c}): رصيده الطبيعي {adj}. بند القوائم التركيبية: {rubric}. قاعدة TVA عند التحصيل: {vat}. قيد مثال متوازن: {total}.',
};

/** Phrases ajoutées au cœur du verdict, de la plus riche à la plus sobre, pour tenir dans 40 à 60 mots. */
const VERDICT_EXTRA: T3 = {
  fr: 'L’écriture d’exemple compte {k} lignes, avec des débits égaux aux crédits.',
  en: 'The worked entry has {k} lines, with debits equal to credits.',
  ar: 'يتضمن قيد المثال {k} أسطر، والمدين يساوي الدائن.',
};

const VERDICT_TAIL: T3 = {
  fr: 'Fiche pédagogique du plan comptable marocain (CGNC).',
  en: 'Educational sheet from the Moroccan chart of accounts (CGNC).',
  ar: 'بطاقة تعليمية من المخطط المحاسبي المغربي (CGNC).',
};

const FAQ_BALANCE_Q: T3 = {
  fr: 'Quel est le sens normal du compte {n} et comment figure-t-il dans une écriture ?',
  en: 'What is the normal balance of account {n} and how does it appear in an entry?',
  ar: 'ما هو الرصيد الطبيعي للحساب {n} وكيف يظهر في القيد؟',
};
const FAQ_BALANCE_A: T3 = {
  fr: 'Le solde normal du compte {n} ({label}) est {adj}. Dans l’écriture d’exemple « {desc} », d’un total de {total}, il est porté {side} pour {amount}.',
  en: 'The normal balance of account {n} ({label}) is a {adj} balance. In the worked entry “{desc}”, totalling {total}, it is posted {side} for {amount}.',
  ar: 'الرصيد الطبيعي للحساب {n} ({label}) هو {adj}. في قيد المثال «{desc}» ومجموعه {total}، يُسجَّل {side} بمبلغ {amount}.',
};
const FAQ_OTHERS: T3 = {
  fr: 'Autres comptes de l’écriture : {list}.',
  en: 'Other accounts in the entry: {list}.',
  ar: 'الحسابات الأخرى في القيد: {list}.',
};
const FAQ_VAT_Q: T3 = {
  fr: 'Quelle règle de TVA sur encaissement le jeu de données associe-t-il au compte {n} ?',
  en: 'Which VAT cash-basis rule does the dataset associate with account {n}?',
  ar: 'ما قاعدة TVA عند التحصيل التي تربطها مجموعة البيانات بالحساب {n}؟',
};
const FAQ_VAT_A_TAIL: T3 = {
  fr: 'Ce libellé décrit seulement le code du jeu de données ; à vérifier auprès de votre expert-comptable avant toute application.',
  en: 'This wording only describes the dataset code; check it with your chartered accountant before applying it.',
  ar: 'تصف هذه الصيغة رمز مجموعة البيانات فقط؛ تحقق منها لدى خبيرك المحاسب قبل أي تطبيق.',
};
const FAQ_EDI_Q: T3 = {
  fr: 'Quel est le codeEdi SIMPL-IS de ce compte ?',
  en: 'What is the SIMPL-IS codeEdi of this account?',
  ar: 'ما هو codeEdi SIMPL-IS الخاص بهذا الحساب؟',
};
const FAQ_EDI_A_TAIL: T3 = {
  fr: 'Fisca n’affiche aucun code tant que ce référentiel n’est pas importé.',
  en: 'Fisca shows no code until this reference is imported.',
  ar: 'لا تعرض فيسكا أي رمز إلى أن يُستورد هذا المرجع.',
};
const TITLE: T3 = {
  fr: 'Compte {n} — {label} (CGNC)',
  en: 'Account {n} — {label} (Moroccan CGNC)',
  ar: 'الحساب {n} — {label} (CGNC)',
};
const DESCRIPTION: T3 = {
  fr: 'Compte {n} « {label} » : sens normal du solde, règle de TVA sur encaissement, rubrique de l’état de synthèse et écriture d’exemple équilibrée. Fiche pédagogique CGNC, à vérifier auprès de votre expert-comptable.',
  en: 'Account {n} “{label}”: normal balance, VAT cash-basis rule, financial statement heading and a balanced worked entry. Educational CGNC sheet, to be checked with your chartered accountant.',
  ar: 'الحساب {n} «{label}»: الرصيد الطبيعي وقاعدة TVA عند التحصيل وبند القوائم التركيبية وقيد مثال متوازن. بطاقة CGNC تعليمية، يجب التحقق منها لدى خبيرك المحاسب.',
};
const STEP_VERB: Readonly<Record<'DEBIT' | 'CREDIT', T3>> = {
  DEBIT: { fr: 'Débiter', en: 'Debit', ar: 'قيّد في المدين' },
  CREDIT: { fr: 'Créditer', en: 'Credit', ar: 'قيّد في الدائن' },
};

export function labelOf(record: CgncAccountRecord, loc: CgncLocale): string {
  return loc === 'fr' ? record.label_fr : loc === 'ar' ? record.label_ar : record.label_en;
}

function entryText(record: CgncAccountRecord, loc: CgncLocale): string {
  const found = entryDescription(record.account_number);
  return found === undefined ? record.sample_entry.description_fr : found[loc];
}

/** Premier gabarit dont le décompte tient dans la fenêtre Doc_18 S04 (40 à 60 mots) ; sinon le cœur seul. */
function composeVerdict(loc: CgncLocale, vars: Readonly<Record<string, string>>): string {
  const core = fill(VERDICT_CORE[loc], vars);
  const extra = fill(VERDICT_EXTRA[loc], vars);
  const tail = VERDICT_TAIL[loc];
  const candidates = [`${core} ${extra} ${tail}`, `${core} ${tail}`, `${core} ${extra}`, core];
  return candidates.find((c) => countWords(c) >= VERDICT_MIN_WORDS && countWords(c) <= VERDICT_MAX_WORDS) ?? core;
}

export interface QualityInput {
  readonly verdictWords: number;
  readonly table: CgncTableView;
  readonly hasBalanceSide: boolean;
  readonly hasVatRule: boolean;
  readonly entryBalanced: boolean;
  readonly sources: readonly CgncSourceView[];
  readonly faqs: readonly unknown[];
}

/** Seuil Doc_18 S10 du Silo 3 : sens du compte + règle de TVA + écriture équilibrée, puis gabarit Answer-First. */
export function assessCgncQuality(input: QualityInput): CgncQuality {
  const missing: string[] = [];
  if (!input.hasBalanceSide) missing.push('sens');
  if (!input.hasVatRule) missing.push('règle TVA');
  if (!input.entryBalanced) missing.push('écriture équilibrée');
  if (input.verdictWords < VERDICT_MIN_WORDS || input.verdictWords > VERDICT_MAX_WORDS) missing.push('verdict');
  if (input.table.rows.length < TABLE_MIN_ROWS || input.table.columns.length > TABLE_MAX_COLUMNS) missing.push('tableau');
  if (input.sources.length < 2 || !input.sources.some((s) => s.primary)) missing.push('sources');
  if (input.faqs.length < 1) missing.push('faq');
  return { indexable: missing.length === 0, missing };
}

function isNormalBalance(value: string): boolean {
  return NORMAL_BALANCES.some((b) => b === value);
}

function isVatRule(value: string): boolean {
  return VAT_ENCAISSEMENT_RULES.some((r) => r === value);
}

function linkFor(prefix: string, record: CgncAccountRecord, loc: CgncLocale): LinkView {
  return { label: `${record.account_number} — ${labelOf(record, loc)}`, href: `/${prefix}/${CGNC_HUB_SLUG}/${accountSlug(record.account_number)}` };
}

function relatedOf(record: CgncAccountRecord, accounts: readonly CgncAccountRecord[], prefix: string, loc: CgncLocale): readonly LinkView[] {
  const wanted: string[] = [];
  const vatAccount = VAT_RULE_ACCOUNT[record.vat_encaissement_rule];
  if (vatAccount !== null) wanted.push(vatAccount);
  for (const line of record.sample_entry.lines) wanted.push(line.account_number);
  const sameClass = accounts.filter((a) => a.cgnc_class === record.cgnc_class);
  const at = sameClass.findIndex((a) => a.account_number === record.account_number);
  for (const offset of [-1, 1]) {
    const neighbour = sameClass[at + offset];
    if (neighbour !== undefined) wanted.push(neighbour.account_number);
  }
  const unique: string[] = [];
  for (const n of wanted) {
    if (n !== record.account_number && !unique.includes(n) && findCgncAccount(n, accounts) !== undefined) unique.push(n);
  }
  return unique.slice(0, 6).flatMap((n) => {
    const found = findCgncAccount(n, accounts);
    return found === undefined ? [] : [linkFor(prefix, found, loc)];
  });
}

function entryLineView(line: EntryLine, accounts: readonly CgncAccountRecord[], prefix: string, loc: CgncLocale): EntryLineView {
  const found = findCgncAccount(line.account_number, accounts);
  return {
    account: line.account_number,
    label: found === undefined ? null : labelOf(found, loc),
    href: found === undefined ? null : `/${prefix}/${CGNC_HUB_SLUG}/${accountSlug(found.account_number)}`,
    debitCents: line.side === 'DEBIT' ? line.amount_cents : null,
    creditCents: line.side === 'CREDIT' ? line.amount_cents : null,
  };
}

export function buildCgncAccountView(locale: MarketingLocale, record: CgncAccountRecord, accounts: readonly CgncAccountRecord[] = CGNC_ACCOUNTS): CgncAccountView {
  const loc = cgncLocaleOf(locale);
  const prefix = LOCALE_URL_PREFIX[locale];
  const n = record.account_number;
  const label = labelOf(record, loc);
  const entry = record.sample_entry;
  const integrity = entryIntegrity(entry);
  const hasBalanceSide = isNormalBalance(record.normal_balance);
  const hasVatRule = isVatRule(record.vat_encaissement_rule);

  const balanceAdj = hasBalanceSide ? BALANCE_ADJ[record.normal_balance][loc] : '';
  const vatText = hasVatRule ? VAT_RULE_TEXT[record.vat_encaissement_rule] : undefined;
  const rubric = RUBRIC_TEXT[record.cgnc_statement_rubric][loc];
  const total = formatCentsMad(entry.total_cents);
  const description = entryText(record, loc);

  const verdict = composeVerdict(loc, {
    n,
    label,
    c: String(record.cgnc_class),
    adj: balanceAdj,
    rubric,
    vat: vatText === undefined ? '' : vatText.short[loc],
    total,
    k: String(entry.lines.length),
  });

  const ownLine = entry.lines.find((l) => l.account_number === n);
  const ownAmount = ownLine === undefined ? total : formatCentsMad(ownLine.amount_cents);
  const ownSide = ownLine === undefined ? '' : BALANCE_SIDE[ownLine.side][loc];
  const otherAccounts = entry.lines.filter((l) => l.account_number !== n).map((l) => l.account_number);

  const ui = CGNC_UI;
  const rows: readonly (readonly string[])[] = [
    [ui.rowAccount[loc], fill(ui.accountClassValue[loc], { n, c: String(record.cgnc_class) }), ui.refDataset[loc]],
    [ui.rowBalance[loc], balanceAdj, ui.refDataset[loc]],
    [ui.rowVat[loc], vatText === undefined ? '' : vatText.description[loc], ui.refDataset[loc]],
    [ui.rowRubric[loc], rubric, ui.refDataset[loc]],
    [ui.rowCodeEdi[loc], CODE_EDI_PENDING[loc], ui.refSimplIs[loc]],
    [ui.rowEntry[loc], fill(ui.entryValue[loc], { total, k: String(entry.lines.length) }), ui.refDataset[loc]],
  ];
  const table: CgncTableView = { caption: ui.tableCaption[loc], columns: ui.tableColumns[loc].split('|'), rows };

  const lines = entry.lines.map((l) => entryLineView(l, accounts, prefix, loc));
  const entryView: EntryView = {
    title: ui.caseHeading[loc],
    description,
    caption: ui.entryCaption[loc],
    columns: ui.entryColumns[loc].split('|'),
    lines,
    totalLabel: ui.entryTotal[loc],
    totalCents: entry.total_cents,
    noSheetLabel: ui.entryNoSheet[loc],
  };

  const faqs = [
    {
      question: fill(FAQ_BALANCE_Q[loc], { n }),
      answer: fill(FAQ_BALANCE_A[loc], { n, label, adj: balanceAdj, desc: description, total, side: ownSide, amount: ownAmount }) + (otherAccounts.length > 0 ? ` ${fill(FAQ_OTHERS[loc], { list: otherAccounts.join(loc === 'ar' ? '، ' : ', ') })}` : ''),
    },
    {
      question: fill(FAQ_VAT_Q[loc], { n }),
      answer: `${vatText === undefined ? '' : vatText.description[loc]} ${FAQ_VAT_A_TAIL[loc]}`,
    },
    { question: FAQ_EDI_Q[loc], answer: `${CODE_EDI_PENDING[loc]}. ${FAQ_EDI_A_TAIL[loc]}` },
  ];

  const steps = lines.map((l, i) => {
    const source = entry.lines[i];
    const verb = STEP_VERB[source === undefined ? 'DEBIT' : source.side][loc];
    const cents = l.debitCents ?? l.creditCents ?? 0;
    const name = `${verb} ${l.account}${l.label === null ? '' : ` (${l.label})`}`;
    return { name, text: `${verb} ${l.account} : ${formatCentsMad(cents)}` };
  });

  const sources: readonly CgncSourceView[] = CGNC_SOURCES.map((s) => ({
    id: s.id,
    label: s.label[loc],
    kindLabel: s.kindLabel[loc],
    primary: s.kind !== 'internal',
  }));

  const title = fill(TITLE[loc], { n, label });
  const quality = assessCgncQuality({ verdictWords: countWords(verdict), table, hasBalanceSide, hasVatRule, entryBalanced: integrity.balanced && integrity.totalMatches, sources, faqs });
  const law = CGNC_SOURCES[0];
  if (law === undefined) throw new RangeError('Source Loi 9-88 absente');

  return {
    kind: 'cgnc-account',
    locale,
    contentLanguage: loc,
    accountNumber: n,
    slug: `${CGNC_HUB_SLUG}/${accountSlug(n)}`,
    title,
    description: fill(DESCRIPTION[loc], { n, label }),
    provenance: PROVENANCE[loc],
    verdict,
    verdictWords: countWords(verdict),
    table,
    entry: entryView,
    codeEdiNotice: CODE_EDI_PENDING[loc],
    faqs,
    steps,
    sources,
    cta: { label: ui.cta[loc], href: `/${prefix}/tarifs` },
    related: relatedOf(record, accounts, prefix, loc),
    breadcrumb: [
      { label: ui.home[loc], href: `/${prefix}/` },
      { label: HUB_TITLE[loc], href: `/${prefix}/${CGNC_HUB_SLUG}` },
      { label: title, href: `/${prefix}/${CGNC_HUB_SLUG}/${accountSlug(n)}` },
    ],
    quality,
    legislation: { name: law.label[loc], identifier: law.id },
    disclaimer: DISCLAIMER[loc],
    labels: {
      verdict: ui.verdict[loc],
      tableHeading: ui.tableHeading[loc],
      caseHeading: ui.caseHeading[loc],
      sourcesHeading: ui.sourcesHeading[loc],
      faqHeading: ui.faqHeading[loc],
      relatedHeading: ui.relatedHeading[loc],
      breadcrumbLabel: ui.breadcrumbLabel[loc],
      noteHeading: ui.noteHeading[loc],
      howToName: ui.howToName[loc],
      notIndexed: ui.notIndexed[loc],
    },
  };
}

/** Miroir Markdown : aucune balise HTML ; un compte absent du jeu n'a ni lien ni intitulé. */
export function cgncMarkdownSections(view: CgncAccountView): readonly { readonly heading: string; readonly body: string }[] {
  const header = `| ${view.table.columns.join(' | ')} |`;
  const sep = `| ${view.table.columns.map(() => '---').join(' | ')} |`;
  const body = view.table.rows.map((r) => `| ${r.map((c) => c.replaceAll('|', '/')).join(' | ')} |`);
  const entryLines = view.entry.lines.map((l) => {
    const cents = l.debitCents ?? l.creditCents ?? 0;
    const side = l.debitCents !== null ? view.entry.columns[1] : view.entry.columns[2];
    const who = l.href === null ? l.account : `[${l.account}](${l.href}) ${l.label ?? ''}`.trim();
    return `- ${who} — ${side ?? ''} : ${formatCentsMad(cents)}`;
  });
  const notes = view.quality.indexable ? view.disclaimer : `${view.disclaimer}\n\n${view.labels.notIndexed}`;
  return [
    { heading: view.labels.verdict, body: `${view.verdict}\n\n${view.provenance}` },
    { heading: view.labels.tableHeading, body: [header, sep, ...body].join('\n') },
    {
      heading: view.labels.caseHeading,
      body: [view.entry.description, '', ...entryLines, `- ${view.entry.totalLabel} : ${formatCentsMad(view.entry.totalCents)}`, '', view.codeEdiNotice].join('\n'),
    },
    { heading: view.labels.sourcesHeading, body: view.sources.map((s) => `- ${s.label} (${s.kindLabel})`).join('\n') },
    { heading: view.labels.faqHeading, body: view.faqs.map((f) => `**${f.question}**\n\n${f.answer}`).join('\n\n') },
    { heading: view.cta.label, body: view.cta.href },
    { heading: view.labels.relatedHeading, body: view.related.map((r) => `- [${r.label}](${r.href})`).join('\n') },
    { heading: view.labels.noteHeading, body: notes },
  ];
}

export interface CgncHubView {
  readonly kind: 'cgnc-hub';
  readonly locale: MarketingLocale;
  readonly contentLanguage: CgncLocale;
  readonly slug: string;
  readonly title: string;
  readonly lead: string;
  readonly description: string;
  readonly counter: string;
  readonly provenance: string;
  readonly codeEdiNotice: string;
  readonly disclaimer: string;
  readonly headingPages: string;
  readonly breadcrumbLabel: string;
  readonly breadcrumb: readonly LinkView[];
  readonly groups: readonly { readonly title: string; readonly entries: readonly { readonly number: string; readonly label: string; readonly href: string; readonly summary: string }[] }[];
}

function hubSummary(a: CgncAccountRecord, loc: CgncLocale): string {
  const side = isNormalBalance(a.normal_balance) ? BALANCE_ADJ[a.normal_balance][loc] : '';
  const vat = isVatRule(a.vat_encaissement_rule) ? VAT_RULE_TEXT[a.vat_encaissement_rule].short[loc] : '';
  return [side, vat].filter((x) => x.length > 0).join(' · ');
}

export function buildCgncHubView(locale: MarketingLocale, accounts: readonly CgncAccountRecord[] = CGNC_ACCOUNTS): CgncHubView {
  const loc = cgncLocaleOf(locale);
  const prefix = LOCALE_URL_PREFIX[locale];
  const lead = `${HUB_LEAD[loc]} ${COUNTER[loc]}.`;
  const classes = [...new Set(accounts.map((a) => a.cgnc_class))].sort((a, b) => a - b);
  return {
    kind: 'cgnc-hub',
    locale,
    contentLanguage: loc,
    slug: CGNC_HUB_SLUG,
    title: HUB_TITLE[loc],
    lead,
    description: lead,
    counter: COUNTER[loc],
    provenance: PROVENANCE[loc],
    codeEdiNotice: CODE_EDI_PENDING[loc],
    disclaimer: DISCLAIMER[loc],
    headingPages: CGNC_UI.hubPagesHeading[loc],
    breadcrumbLabel: CGNC_UI.breadcrumbLabel[loc],
    breadcrumb: [
      { label: CGNC_UI.home[loc], href: `/${prefix}/` },
      { label: HUB_TITLE[loc], href: `/${prefix}/${CGNC_HUB_SLUG}` },
    ],
    groups: classes.map((c) => ({
      title: CLASS_TITLES[c][loc],
      entries: accounts
        .filter((a) => a.cgnc_class === c)
        .map((a) => ({
          number: a.account_number,
          label: labelOf(a, loc),
          href: `/${prefix}/${CGNC_HUB_SLUG}/${accountSlug(a.account_number)}`,
          summary: hubSummary(a, loc),
        })),
    })),
  };
}

export function cgncHubMarkdownSections(view: CgncHubView): readonly { readonly heading: string; readonly body: string }[] {
  return [
    { heading: view.counter, body: `${view.provenance}\n\n${view.codeEdiNotice}` },
    ...view.groups.map((g) => ({ heading: g.title, body: g.entries.map((e) => `- [${e.number} — ${e.label}](${e.href}) : ${e.summary}`).join('\n') })),
    { heading: CGNC_UI.noteHeading[view.contentLanguage], body: view.disclaimer },
  ];
}
