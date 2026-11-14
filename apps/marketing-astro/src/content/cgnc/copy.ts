/**
 * Textes du Silo 3 (dictionnaire CGNC) en français, arabe et anglais. L'arabe dialectal (ary) lit l'arabe (Doc_08 S07,
 * chaîne ary vers ar) ; les deux variantes amazighes lisent le français avec l'avis bilingue du gabarit.
 * Aucune règle fiscale n'est écrite ici : seuls les codes du jeu de données sont décrits, avec les comptes qu'ils nomment.
 */
import type { MarketingLocale } from '../../i18n/locales.ts';
import type { CgncClass, NormalBalance, StatementRubric, VatEncaissementRule } from './dataset.ts';

export type CgncLocale = 'fr' | 'ar' | 'en';

export interface T3<T = string> {
  readonly fr: T;
  readonly ar: T;
  readonly en: T;
}

function t(fr: string, en: string, ar: string): T3 {
  return { fr, ar, en };
}

/** Langue du texte servi pour une langue de site : ary lit ar ; zgh-Latn et zgh-Tfng lisent fr. */
export function cgncLocaleOf(locale: MarketingLocale): CgncLocale {
  switch (locale) {
    case 'ar':
    case 'ary':
      return 'ar';
    case 'en':
      return 'en';
    case 'fr':
    case 'zgh-Latn':
    case 'zgh-Tfng':
      return 'fr';
  }
}

/** Langues dont les fiches sont indexables : 61 comptes x 3 = 183 URL. Les autres langues sont servies en noindex. */
export const CGNC_INDEXED_LOCALES: readonly MarketingLocale[] = ['fr', 'ar', 'en'];

export const CGNC_HUB_SLUG = 'dictionnaire-cgnc';

export function accountSlug(accountNumber: string): string {
  return `compte-${accountNumber}`;
}

/** Phrase imposée par le propriétaire, traduite : aucun codeEdi chiffré n'est jamais affiché. */
export const CODE_EDI_PENDING: T3 = t(
  'codeEdi SIMPL-IS : en attente d’import du référentiel XSD officiel DGI',
  'codeEdi SIMPL-IS: pending import of the official DGI XSD reference',
  'codeEdi SIMPL-IS: في انتظار استيراد المرجع الرسمي XSD الخاص بالمديرية العامة للضرائب',
);

export const PROVENANCE: T3 = t(
  'Plan comptable marocain (CGNC) — fiche pédagogique, à vérifier auprès de votre expert-comptable',
  'Moroccan chart of accounts (CGNC) — educational sheet, to be checked with your chartered accountant',
  'المخطط المحاسبي المغربي (CGNC) — بطاقة تعليمية، يجب التحقق منها لدى خبيرك المحاسب',
);

export const COUNTER: T3 = t(
  '61 comptes piliers, 190 sous-comptes sectoriels à enrichir après G4',
  '61 core accounts, 190 sector sub-accounts to be enriched after G4',
  '61 حسابا رئيسيا، و190 حسابا فرعيا قطاعيا سيتم إثراؤها بعد G4',
);

/** Mention des subdivisions analytiques Fisca (is_official_cgnc_base = false) : jamais présentées comme compte de la base CGNC. */
export const ANALYTIC_NOTE: T3 = t(
  'Subdivision analytique Fisca du compte {parent} (suivi de la TVA sur encaissement)',
  'Fisca analytical subdivision of account {parent} (tracking of VAT on cash collection)',
  'تقسيم تحليلي خاص بفيسكا للحساب {parent} (تتبع TVA عند التحصيل)',
);

/** Libellé historique conservé tel quel (« État, IGR » n'est pas traduit). */
export const HISTORICAL_LABEL: T3 = t('libellé historique : {label}', 'historical label: {label}', 'التسمية التاريخية: {label}');

export const DISCLAIMER: T3 = t(
  'Information générale, pas un conseil réservé aux experts-comptables (loi 15-89). Jeu de données fourni par l’éditeur, non recoupé avec le texte du CGNC. Fisca n’est pas validée par la DGI ni par xHub : l’état affiché reste « Validation simulée ».',
  'General information, not advice reserved to chartered accountants (law 15-89). Dataset supplied by the publisher, not cross-checked against the text of the CGNC. Fisca is not validated by the DGI or xHub: the status shown remains “Simulated validation”.',
  'معلومات عامة وليست استشارة محجوزة للخبراء المحاسبين (القانون 15-89). مجموعة البيانات مقدمة من الناشر ولم تُطابق مع نص CGNC. فيسكا غير مصادق عليها من DGI أو xHub: وتبقى الحالة المعروضة «تحقق بالمحاكاة».',
);

export const HUB_TITLE: T3 = t('Dictionnaire des comptes CGNC', 'CGNC account dictionary', 'قاموس حسابات CGNC');

export const HUB_LEAD: T3 = t(
  'Fiches pédagogiques des comptes piliers du plan comptable marocain (CGNC) : sens normal du solde, règle de TVA sur encaissement, rubrique de l’état de synthèse et écriture d’exemple équilibrée au centime.',
  'Educational sheets for the core accounts of the Moroccan chart of accounts (CGNC): normal balance, VAT cash-basis rule, financial statement heading and a worked entry balanced to the cent.',
  'بطاقات تعليمية للحسابات الرئيسية في المخطط المحاسبي المغربي (CGNC): الرصيد الطبيعي وقاعدة TVA عند التحصيل وبند القوائم التركيبية وقيد مثال متوازن إلى السنتيم.',
);

export const CLASS_TITLES: Readonly<Record<CgncClass, T3>> = {
  1: t('Classe 1 — Financement permanent', 'Class 1 — Permanent financing', 'الصنف 1 — التمويل الدائم'),
  2: t('Classe 2 — Actif immobilisé', 'Class 2 — Fixed assets', 'الصنف 2 — الأصول الثابتة'),
  3: t('Classe 3 — Actif circulant', 'Class 3 — Current assets', 'الصنف 3 — الأصول المتداولة'),
  4: t('Classe 4 — Passif circulant', 'Class 4 — Current liabilities', 'الصنف 4 — الخصوم المتداولة'),
  5: t('Classe 5 — Trésorerie', 'Class 5 — Cash and banks', 'الصنف 5 — الخزينة'),
  6: t('Classe 6 — Charges', 'Class 6 — Expenses', 'الصنف 6 — التحملات'),
  7: t('Classe 7 — Produits', 'Class 7 — Income', 'الصنف 7 — المنتوجات'),
  8: t('Classe 8 — Résultats', 'Class 8 — Results', 'الصنف 8 — النتائج'),
};

export const BALANCE_ADJ: Readonly<Record<NormalBalance, T3>> = {
  DEBIT: t('débiteur', 'debit', 'مدين'),
  CREDIT: t('créditeur', 'credit', 'دائن'),
};

export const BALANCE_SIDE: Readonly<Record<NormalBalance, T3>> = {
  DEBIT: t('au débit', 'on the debit side', 'في الجانب المدين'),
  CREDIT: t('au crédit', 'on the credit side', 'في الجانب الدائن'),
};

export interface VatRuleText {
  readonly short: T3;
  readonly description: T3;
}

/** Un libellé par code du jeu de données ; les comptes cités sont ceux que le code nomme, rien d'autre. */
export const VAT_RULE_TEXT: Readonly<Record<VatEncaissementRule, VatRuleText>> = {
  BASE_HT_SUBJECT_TO_ENCASHMENT: {
    short: t('base HT soumise à l’encaissement', 'excl.-tax base subject to cash collection', 'أساس بدون ضريبة خاضع للتحصيل'),
    description: t(
      'Base hors taxe soumise à l’encaissement : dans le jeu de données, le montant HT de ce compte relève de la règle de TVA sur encaissement.',
      'Excl.-tax base subject to cash collection: in the dataset, the excl.-tax amount of this account falls under the VAT cash-basis rule.',
      'أساس بدون ضريبة خاضع للتحصيل: في مجموعة البيانات يندرج المبلغ بدون ضريبة لهذا الحساب ضمن قاعدة TVA عند التحصيل.',
    ),
  },
  EXEMPT_OR_OUT_OF_SCOPE: {
    short: t('exonéré ou hors champ', 'exempt or out of scope', 'معفى أو خارج النطاق'),
    description: t(
      'Exonéré ou hors champ : le jeu de données ne rattache à ce compte aucune règle de TVA sur encaissement.',
      'Exempt or out of scope: the dataset attaches no VAT cash-basis rule to this account.',
      'معفى أو خارج النطاق: لا تربط مجموعة البيانات بهذا الحساب أي قاعدة TVA عند التحصيل.',
    ),
  },
  NONE: {
    short: t('aucune règle associée', 'no rule attached', 'لا توجد قاعدة مرتبطة'),
    description: t(
      'Aucune : le jeu de données n’associe aucune règle de TVA sur encaissement à ce compte.',
      'None: the dataset associates no VAT cash-basis rule with this account.',
      'لا شيء: لا تربط مجموعة البيانات أي قاعدة TVA عند التحصيل بهذا الحساب.',
    ),
  },
  RECOVERABLE_IMMOB_34551: {
    short: t('TVA récupérable sur immobilisations (34551)', 'recoverable VAT on fixed assets (34551)', 'TVA قابلة للاسترجاع على التثبيتات (34551)'),
    description: t(
      'TVA récupérable sur immobilisations : le jeu de données désigne le compte 34551.',
      'Recoverable VAT on fixed assets: the dataset points to account 34551.',
      'TVA قابلة للاسترجاع على التثبيتات: تشير مجموعة البيانات إلى الحساب 34551.',
    ),
  },
  RECOVERABLE_CHARGES_34552: {
    short: t('TVA récupérable sur charges (34552)', 'recoverable VAT on expenses (34552)', 'TVA قابلة للاسترجاع على التحملات (34552)'),
    description: t(
      'TVA récupérable sur charges : le jeu de données désigne le compte 34552.',
      'Recoverable VAT on expenses: the dataset points to account 34552.',
      'TVA قابلة للاسترجاع على التحملات: تشير مجموعة البيانات إلى الحساب 34552.',
    ),
  },
  COLLECTED_DUE_44551: {
    short: t('TVA facturée exigible (44551)', 'collected VAT due (44551)', 'TVA المفوترة المستحقة (44551)'),
    description: t(
      'TVA facturée exigible : le jeu de données désigne le compte 44551.',
      'Collected VAT due: the dataset points to account 44551.',
      'TVA المفوترة المستحقة: تشير مجموعة البيانات إلى الحساب 44551.',
    ),
  },
  RECOVERABLE_PENDING_34558: {
    short: t('TVA récupérable en attente (34558)', 'pending recoverable VAT (34558)', 'TVA قابلة للاسترجاع في الانتظار (34558)'),
    description: t(
      'TVA récupérable en attente : le jeu de données désigne le compte 34558.',
      'Pending recoverable VAT: the dataset points to account 34558.',
      'TVA قابلة للاسترجاع في الانتظار: تشير مجموعة البيانات إلى الحساب 34558.',
    ),
  },
  COLLECTED_PENDING_44558: {
    short: t('TVA facturée en attente d’encaissement (44558)', 'collected VAT awaiting collection (44558)', 'TVA المفوترة في انتظار التحصيل (44558)'),
    description: t(
      'TVA facturée en attente d’encaissement : le jeu de données désigne le compte 44558.',
      'Collected VAT awaiting collection: the dataset points to account 44558.',
      'TVA المفوترة في انتظار التحصيل: تشير مجموعة البيانات إلى الحساب 44558.',
    ),
  },
};

/** Compte désigné par le code (pour le lien vers sa fiche), ou null. */
export const VAT_RULE_ACCOUNT: Readonly<Record<VatEncaissementRule, string | null>> = {
  BASE_HT_SUBJECT_TO_ENCASHMENT: null,
  EXEMPT_OR_OUT_OF_SCOPE: null,
  NONE: null,
  RECOVERABLE_IMMOB_34551: '34551',
  RECOVERABLE_CHARGES_34552: '34552',
  COLLECTED_DUE_44551: '44551',
  RECOVERABLE_PENDING_34558: '34558',
  COLLECTED_PENDING_44558: '44558',
};

/** Rubriques de l'état de synthèse : libellé construit sur le code du jeu (lettre de rubrique ou numéro de compte). */
export const RUBRIC_TEXT: Readonly<Record<StatementRubric, T3>> = {
  BILAN_ACTIF_A_IMMOB_NON_VALEUR: t('Bilan actif, A. Immobilisations en non-valeurs', 'Balance sheet assets, A. Non-value fixed assets', 'الميزانية (الأصول)، أ. التثبيتات في عدم القيمة'),
  BILAN_ACTIF_B_IMMOB_INCORPORELLES: t('Bilan actif, B. Immobilisations incorporelles', 'Balance sheet assets, B. Intangible fixed assets', 'الميزانية (الأصول)، ب. التثبيتات غير المادية'),
  BILAN_ACTIF_C_AMORTISSEMENTS: t('Bilan actif, C. Amortissements', 'Balance sheet assets, C. Accumulated depreciation', 'الميزانية (الأصول)، ج. الاستهلاكات'),
  BILAN_ACTIF_C_IMMOB_CORPORELLES: t('Bilan actif, C. Immobilisations corporelles', 'Balance sheet assets, C. Tangible fixed assets', 'الميزانية (الأصول)، ج. التثبيتات المادية'),
  BILAN_ACTIF_D_IMMOB_FINANCIERES: t('Bilan actif, D. Immobilisations financières', 'Balance sheet assets, D. Financial fixed assets', 'الميزانية (الأصول)، د. التثبيتات المالية'),
  BILAN_ACTIF_F_STOCKS: t('Bilan actif, F. Stocks', 'Balance sheet assets, F. Inventories', 'الميزانية (الأصول)، و. المخزونات'),
  BILAN_ACTIF_G_CREANCES_CIRCULANT: t('Bilan actif, G. Créances de l’actif circulant', 'Balance sheet assets, G. Current receivables', 'الميزانية (الأصول)، ز. ديون الأصول المتداولة'),
  BILAN_ACTIF_I_TRESORERIE_ACTIF: t('Bilan actif, I. Trésorerie actif', 'Balance sheet assets, I. Cash assets', 'الميزانية (الأصول)، ط. خزينة الأصول'),
  BILAN_PASSIF_A_CAPITAUX_PROPRES: t('Bilan passif, A. Capitaux propres', 'Balance sheet liabilities, A. Equity', 'الميزانية (الخصوم)، أ. الأموال الذاتية'),
  BILAN_PASSIF_C_DETTES_FINANCEMENT: t('Bilan passif, C. Dettes de financement', 'Balance sheet liabilities, C. Financing debts', 'الميزانية (الخصوم)، ج. ديون التمويل'),
  BILAN_PASSIF_D_PROVISIONS_DURABLES: t('Bilan passif, D. Provisions durables', 'Balance sheet liabilities, D. Long-term provisions', 'الميزانية (الخصوم)، د. المؤونات الدائمة'),
  BILAN_PASSIF_F_DETTES_CIRCULANT: t('Bilan passif, F. Dettes du passif circulant', 'Balance sheet liabilities, F. Current liabilities', 'الميزانية (الخصوم)، و. ديون الخصوم المتداولة'),
  BILAN_PASSIF_H_TRESORERIE_PASSIF: t('Bilan passif, H. Trésorerie passif', 'Balance sheet liabilities, H. Cash liabilities', 'الميزانية (الخصوم)، ح. خزينة الخصوم'),
  CPC_EXPLOITATION_CHARGES_611: t('CPC, charges d’exploitation, rubrique 611', 'Income statement (CPC), operating expenses, heading 611', 'حساب المنتوجات والتحملات (CPC)، تحملات الاستغلال، البند 611'),
  CPC_EXPLOITATION_CHARGES_612: t('CPC, charges d’exploitation, rubrique 612', 'Income statement (CPC), operating expenses, heading 612', 'حساب المنتوجات والتحملات (CPC)، تحملات الاستغلال، البند 612'),
  CPC_EXPLOITATION_CHARGES_613_614: t('CPC, charges d’exploitation, rubriques 613 et 614', 'Income statement (CPC), operating expenses, headings 613 and 614', 'حساب المنتوجات والتحملات (CPC)، تحملات الاستغلال، البندان 613 و614'),
  CPC_EXPLOITATION_CHARGES_617: t('CPC, charges d’exploitation, rubrique 617', 'Income statement (CPC), operating expenses, heading 617', 'حساب المنتوجات والتحملات (CPC)، تحملات الاستغلال، البند 617'),
  CPC_EXPLOITATION_PRODUITS_711: t('CPC, produits d’exploitation, rubrique 711', 'Income statement (CPC), operating income, heading 711', 'حساب المنتوجات والتحملات (CPC)، منتوجات الاستغلال، البند 711'),
  CPC_EXPLOITATION_PRODUITS_712: t('CPC, produits d’exploitation, rubrique 712', 'Income statement (CPC), operating income, heading 712', 'حساب المنتوجات والتحملات (CPC)، منتوجات الاستغلال، البند 712'),
  CPC_FINANCIER_CHARGES_631: t('CPC, charges financières, rubrique 631', 'Income statement (CPC), financial expenses, heading 631', 'حساب المنتوجات والتحملات (CPC)، التحملات المالية، البند 631'),
  CPC_FINANCIER_PRODUITS_738: t('CPC, produits financiers, rubrique 738', 'Income statement (CPC), financial income, heading 738', 'حساب المنتوجات والتحملات (CPC)، المنتوجات المالية، البند 738'),
  CPC_NON_COURANT_CHARGES_658: t('CPC, charges non courantes, rubrique 658', 'Income statement (CPC), non-recurring expenses, heading 658', 'حساب المنتوجات والتحملات (CPC)، التحملات غير الجارية، البند 658'),
  ESG_RESULTAT_NET: t('ESG, résultat net', 'ESG (management balances), net result', 'ESG (الأرصدة الوصفية للتدبير)، النتيجة الصافية'),
  ESG_SOLDE_EXPLOITATION: t('ESG, solde d’exploitation', 'ESG (management balances), operating balance', 'ESG (الأرصدة الوصفية للتدبير)، رصيد الاستغلال'),
};

export interface CgncUi {
  readonly verdict: T3;
  readonly tableHeading: T3;
  readonly tableCaption: T3;
  readonly tableColumns: T3;
  readonly rowAccount: T3;
  readonly rowBalance: T3;
  readonly rowVat: T3;
  readonly rowRubric: T3;
  readonly rowNature: T3;
  readonly rowHistorical: T3;
  readonly rowCodeEdi: T3;
  readonly rowEntry: T3;
  readonly refDataset: T3;
  readonly refSimplIs: T3;
  readonly accountClassValue: T3;
  readonly entryValue: T3;
  readonly caseHeading: T3;
  readonly entryColumns: T3;
  readonly entryCaption: T3;
  readonly entryTotal: T3;
  readonly entryNoSheet: T3;
  readonly sourcesHeading: T3;
  readonly faqHeading: T3;
  readonly relatedHeading: T3;
  readonly breadcrumbLabel: T3;
  readonly noteHeading: T3;
  readonly howToName: T3;
  readonly notIndexed: T3;
  readonly hubPagesHeading: T3;
  readonly home: T3;
  readonly sourceInternal: T3;
  readonly cta: T3;
}

export const CGNC_UI: CgncUi = {
  verdict: t('Verdict', 'Verdict', 'الخلاصة'),
  tableHeading: t('Fiche du compte', 'Account sheet', 'بطاقة الحساب'),
  tableCaption: t('Fiche du compte : élément, valeur et référence', 'Account sheet: item, value and reference', 'بطاقة الحساب: العنصر والقيمة والمرجع'),
  tableColumns: t('Élément|Valeur|Référence', 'Item|Value|Reference', 'العنصر|القيمة|المرجع'),
  rowAccount: t('Numéro et classe', 'Number and class', 'الرقم والصنف'),
  rowBalance: t('Sens normal du solde', 'Normal balance', 'الرصيد الطبيعي'),
  rowVat: t('Règle de TVA sur encaissement', 'VAT cash-basis rule', 'قاعدة TVA عند التحصيل'),
  rowRubric: t('Rubrique de l’état de synthèse', 'Financial statement heading', 'بند القوائم التركيبية'),
  rowNature: t('Nature du compte', 'Nature of the account', 'طبيعة الحساب'),
  rowHistorical: t('Libellé', 'Label', 'التسمية'),
  rowCodeEdi: t('Correspondance SIMPL-IS', 'SIMPL-IS mapping', 'مطابقة SIMPL-IS'),
  rowEntry: t('Écriture d’exemple', 'Worked entry', 'قيد المثال'),
  refDataset: t('Jeu de données FISCA_CGNC_CORE_V2', 'Dataset FISCA_CGNC_CORE_V2', 'مجموعة البيانات FISCA_CGNC_CORE_V2'),
  refSimplIs: t('DGI, SIMPL-IS v2.0.3', 'DGI, SIMPL-IS v2.0.3', 'DGI، SIMPL-IS v2.0.3'),
  accountClassValue: t('{n}, classe {c}', '{n}, class {c}', '{n}، الصنف {c}'),
  entryValue: t('{total}, {k} lignes', '{total}, {k} lines', '{total}، {k} أسطر'),
  caseHeading: t('Écriture d’exemple, équilibrée au centime', 'Worked entry, balanced to the cent', 'قيد مثال متوازن إلى السنتيم'),
  entryColumns: t('Compte|Débit|Crédit', 'Account|Debit|Credit', 'الحساب|مدين|دائن'),
  entryCaption: t('Lignes de l’écriture d’exemple', 'Lines of the worked entry', 'أسطر قيد المثال'),
  entryTotal: t('Total de l’écriture', 'Entry total', 'مجموع القيد'),
  entryNoSheet: t('compte sans fiche dans ce dictionnaire', 'account without a sheet in this dictionary', 'حساب بلا بطاقة في هذا القاموس'),
  sourcesHeading: t('Sources', 'Sources', 'المصادر'),
  faqHeading: t('Questions fréquentes', 'Frequently asked questions', 'أسئلة شائعة'),
  relatedHeading: t('Comptes liés', 'Related accounts', 'حسابات ذات صلة'),
  breadcrumbLabel: t('Fil d’Ariane', 'Breadcrumb', 'مسار التنقل'),
  noteHeading: t('Avertissement', 'Notice', 'تنبيه'),
  howToName: t('Passer l’écriture d’exemple pas à pas', 'Posting the worked entry step by step', 'تسجيل قيد المثال خطوة بخطوة'),
  notIndexed: t(
    'Cette fiche n’est pas indexée : elle ne réunit pas encore le sens du compte, la règle de TVA et une écriture équilibrée.',
    'This sheet is not indexed: it does not yet combine the account balance side, the VAT rule and a balanced entry.',
    'هذه البطاقة غير مفهرسة: لا تجمع بعد بين طبيعة رصيد الحساب وقاعدة TVA وقيدا متوازنا.',
  ),
  hubPagesHeading: t('Les 61 comptes piliers, par classe', 'The 61 core accounts, by class', 'الحسابات الرئيسية الـ61، حسب الصنف'),
  home: t('Accueil', 'Home', 'الرئيسية'),
  sourceInternal: t('référence interne', 'internal reference', 'مرجع داخلي'),
  cta: t('Voir la grille tarifaire', 'See the price list', 'اطلع على لائحة الأسعار'),
};

export interface CgncSource {
  readonly id: string;
  readonly kind: 'law' | 'standard' | 'xsd' | 'internal';
  readonly label: T3;
  readonly kindLabel: T3;
}

const KIND_LABEL = {
  law: t('texte de loi', 'legal text', 'نص قانوني'),
  standard: t('référentiel comptable', 'accounting framework', 'مرجع محاسبي'),
  xsd: t('cahier des charges DGI', 'DGI specification', 'دفتر تحملات المديرية'),
  internal: t('référence interne', 'internal reference', 'مرجع داخلي'),
} as const;

/** Sources nommées par le jeu (`legal_source`) et les spécifications (Doc_07 S09 pour SIMPL-IS, ERRATA B-13). */
export const CGNC_SOURCES: readonly CgncSource[] = [
  {
    id: 'loi-9-88',
    kind: 'law',
    label: t(
      'Loi n° 9-88 relative aux obligations comptables des commerçants',
      'Law no. 9-88 on the accounting obligations of traders',
      'القانون رقم 9-88 المتعلق بالالتزامات المحاسبية للتجار',
    ),
    kindLabel: KIND_LABEL.law,
  },
  {
    id: 'cgnc',
    kind: 'standard',
    label: t(
      'Plan comptable général des entreprises (CGNC Maroc)',
      'General chart of accounts for companies (Moroccan CGNC)',
      'المخطط المحاسبي العام للمقاولات (CGNC المغرب)',
    ),
    kindLabel: KIND_LABEL.standard,
  },
  {
    id: 'simpl-is-v203',
    kind: 'xsd',
    label: t(
      'DGI, SIMPL-IS v2.0.3 (liasse fiscale) : référentiel XSD pas encore importé dans Fisca',
      'DGI, SIMPL-IS v2.0.3 (tax return package): XSD reference not yet imported into Fisca',
      'DGI، SIMPL-IS v2.0.3 (الملف الجبائي): مرجع XSD لم يُستورد بعد في فيسكا',
    ),
    kindLabel: KIND_LABEL.xsd,
  },
  {
    id: 'dataset',
    kind: 'internal',
    label: t(
      'Jeu FISCA_CGNC_CORE_V2 fourni par l’éditeur, non recoupé avec le texte du CGNC (contrat PROVISIONAL)',
      'Dataset FISCA_CGNC_CORE_V2 supplied by the publisher, not cross-checked against the text of the CGNC (PROVISIONAL contract)',
      'مجموعة FISCA_CGNC_CORE_V2 مقدمة من الناشر ولم تُطابق مع نص CGNC (عقد PROVISIONAL)',
    ),
    kindLabel: KIND_LABEL.internal,
  },
];
