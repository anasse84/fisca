import type { L4 } from './types.ts';

function t(fr: string, en: string, ar: string, ary: string): L4 {
  return { fr, en, ar, ary };
}

/** Libellés de l'interface des guides (4 langues écrites ; les langues amazighes retombent sur le français). */
export const UI = {
  verdict: t('Verdict', 'Verdict', 'الخلاصة', 'الخلاصة'),
  tableHeading: t('Tableau comparatif', 'Comparison table', 'جدول المقارنة', 'جدول المقارنة'),
  tableColumns: t('Élément|Valeur ou règle|Référence', 'Item|Value or rule|Reference', 'العنصر|القيمة أو القاعدة|المرجع', 'العنصر|القيمة ولا القاعدة|المرجع'),
  tableCaption: t('Synthèse de la page : éléments, valeurs et références', 'Page summary: items, values and references', 'ملخص الصفحة: العناصر والقيم والمراجع', 'ملخص الصفحة: العناصر والقيم والمراجع'),
  caseHeading: t('Cas chiffré, résolu au centime', 'Worked example, to the cent', 'حالة مرقمة محلولة إلى السنتيم', 'حالة مرقمة محلولة حتى السنتيم'),
  caseBasis: t('Montants issus de', 'Amounts taken from', 'المبالغ مأخوذة من', 'المبالغ مأخودة من'),
  datedHeading: t('Valeurs datées', 'Dated values', 'القيم المؤرخة', 'القيم المؤرخة'),
  datedIntro: t(
    'Valeur datée issue des règles AST/Wiki : une donnée de contenu, mise à jour à la parution d’une règle plus récente, jamais un fait permanent.',
    'Dated value from the AST/Wiki rules: a content datum, updated when a newer rule appears, never a permanent fact.',
    'قيمة مؤرخة مأخوذة من قواعد AST/Wiki: معطى محتوى يحدث عند صدور قاعدة أحدث وليست حقيقة دائمة.',
    'قيمة مؤرخة مأخودة من قواعد AST/Wiki: معطى محتوى كيتحدث منين كتخرج قاعدة جديدة وماشي حقيقة دايمة.',
  ),
  asOf: t('au', 'as of', 'بتاريخ', 'بتاريخ'),
  state: t('état', 'state', 'الحالة', 'الحالة'),
  sourcesHeading: t('Sources primaires', 'Primary sources', 'المصادر الأولية', 'المصادر الأولية'),
  sourceInternal: t('référence interne', 'internal reference', 'مرجع داخلي', 'مرجع داخلي'),
  sourceLaw: t('texte de loi', 'legal text', 'نص قانوني', 'نص قانوني'),
  sourceXsd: t('cahier des charges DGI', 'DGI specification', 'دفتر تحملات المديرية', 'دفتر تحملات DGI'),
  sourceStandard: t('norme publique', 'public standard', 'معيار عمومي', 'معيار عمومي'),
  faqHeading: t('Questions fréquentes', 'Frequently asked questions', 'أسئلة شائعة', 'أسئلة متكررة'),
  relatedHeading: t('Pages liées', 'Related pages', 'صفحات ذات صلة', 'صفحات مرتبطة'),
  breadcrumbLabel: t('Fil d’Ariane', 'Breadcrumb', 'مسار التنقل', 'مسار التنقل'),
  home: t('Accueil', 'Home', 'الرئيسية', 'الرئيسية'),
  guides: t('Guides', 'Guides', 'أدلة', 'أدلة'),
  ctaTrial: t(
    'Tester avec mon propre montant (essai gratuit de {days} jours)',
    'Test with my own amount (free {days}-day trial)',
    'جرّب بمبلغي الخاص (تجربة مجانية لمدة {days} يوما)',
    'جرب بالمبلغ ديالي (تجربة بلاش لمدة {days} يوم)',
  ),
  ctaPricing: t('Voir la grille tarifaire', 'See the price list', 'اطلع على لائحة الأسعار', 'شوف لائحة الأثمنة'),
  disclaimer: t(
    'Information générale, pas un conseil réservé aux experts-comptables (loi 15-89) ni une promesse de résultat fiscal. Fisca n’est pas validée par la DGI ni par xHub : l’état affiché est « Validation simulée ».',
    'General information, not advice reserved to chartered accountants (law 15-89) nor a promise of tax outcome. Fisca is not validated by the DGI or xHub: the status shown is “Simulated validation”.',
    'معلومات عامة وليست استشارة محجوزة للخبراء المحاسبين (القانون 15-89) ولا وعدا بنتيجة جبائية. فيسكا غير مصادق عليها من DGI أو xHub: الحالة المعروضة «تحقق بالمحاكاة».',
    'معلومات عامة وماشي استشارة مخصصة للخبراء المحاسبين (القانون 15-89) ولا وعد بنتيجة جبائية. فيسكا ما مصادق عليها لا من DGI ولا من xHub: الحالة اللي كتبان «تحقق بالمحاكاة».',
  ),
  descriptionTemplate: t(
    '{title} : verdict, tableau comparatif, cas chiffré au centime, sources primaires et questions fréquentes. Guide « {silo} » de Fisca.',
    '{title}: verdict, comparison table, worked example to the cent, primary sources and FAQ. Fisca guide “{silo}”.',
    '{title}: الخلاصة وجدول المقارنة وحالة مرقمة إلى السنتيم والمصادر الأولية والأسئلة الشائعة. دليل «{silo}» من فيسكا.',
    '{title}: الخلاصة وجدول المقارنة وحالة مرقمة حتى السنتيم والمصادر الأولية والأسئلة المتكررة. دليل «{silo}» ديال فيسكا.',
  ),
  noteHeading: t('Avertissement', 'Notice', 'تنبيه', 'تنبيه'),
  howToName: t('Lire le cas chiffré pas à pas', 'Reading the worked example step by step', 'قراءة الحالة المرقمة خطوة بخطوة', 'قراءة الحالة المرقمة خطوة بخطوة'),
  hubIntroPages: t('Pages de ce guide', 'Pages in this guide', 'صفحات هذا الدليل', 'صفحات هاد الدليل'),
  notIndexed: t(
    'Cette page n’est pas indexée : elle ne contient pas encore un exemple chiffré documenté.',
    'This page is not indexed: it does not yet contain a documented worked example.',
    'هذه الصفحة غير مفهرسة: لا تتضمن بعد مثالا محسوبا موثقا.',
    'هاد الصفحة ما مفهرسةش: ما فيهاش باقي مثال محسوب موثق.',
  ),
  hubLinkLabel: t('Retour au guide', 'Back to the guide', 'العودة إلى الدليل', 'الرجوع للدليل'),
} as const;
