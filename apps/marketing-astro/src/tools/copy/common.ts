/** Textes communs aux trois outils publics (T-P2C-06), en 4 langues écrites ; les langues amazighes retombent sur le français. */
import type { L4 } from '../../content/silos/types.ts';
import type { VerificationState } from '../../content/dated-values.ts';

export function t(fr: string, en: string, ar: string, ary: string): L4 {
  return { fr, en, ar, ary };
}

export const TOOLS_HUB_SLUG = 'outils';

export const COMMON = {
  home: t('Accueil', 'Home', 'الرئيسية', 'الرئيسية'),
  toolsLabel: t('Outils gratuits', 'Free tools', 'أدوات مجانية', 'أدوات بلا فلوس'),
  breadcrumbLabel: t('Fil d’Ariane', 'Breadcrumb', 'مسار التنقل', 'مسار التنقل'),
  hubTitle: t('Outils fiscaux gratuits, sans compte', 'Free tax tools, no account', 'أدوات جبائية مجانية دون حساب', 'أدوات جبائية بلا فلوس وبلا حساب'),
  hubDescription: t(
    'Cinq outils qui s’exécutent dans votre navigateur : audit et réparation des ICE d’un fichier Excel, simulateur de la loi 69-21, calculateur de RAS-TVA et de plafond d’espèces, simulateur auto-entrepreneur et estimateur de subvention Mowakaba.',
    'Five tools that run in your browser: audit and repair of the ICE numbers in an Excel file, law 69-21 simulator, VAT withholding and cash-cap calculator, auto-entrepreneur simulator and Mowakaba subsidy estimator.',
    'خمس أدوات تعمل داخل متصفحك: تدقيق وإصلاح أرقام ICE في ملف Excel، ومحاكي القانون 69-21، وحاسبة اقتطاع TVA وسقف الأداء نقدا، ومحاكي المقاول الذاتي، ومقدّر دعم مواكبة.',
    'خمس د الأدوات كتخدم فالمتصفح ديالك: تدقيق وإصلاح ICE فملف Excel، ومحاكي القانون 69-21، وحاسبة اقتطاع TVA وسقف الكاش، ومحاكي المقاول الذاتي، ومقدر دعم مواكبة.',
  ),
  hubLead: t(
    'Aucun compte, aucun cookie, aucun script tiers : vos fichiers et vos montants ne quittent pas votre navigateur. Chaque résultat affiche la règle utilisée, sa date et son état de recoupement.',
    'No account, no cookie, no third-party script: your files and amounts never leave your browser. Each result shows the rule used, its date and its cross-check state.',
    'دون حساب ودون كوكيز ودون سكربت خارجي: ملفاتك ومبالغك لا تغادر متصفحك. وتعرض كل نتيجة القاعدة المستعملة وتاريخها وحالة التحقق منها.',
    'بلا حساب وبلا كوكيز وبلا سكريبت د برا: الملفات والمبالغ ديالك ما كيخرجوش من المتصفح. وكل نتيجة كتبين القاعدة المستعملة والتاريخ ديالها وحالة التحقق.',
  ),
  disclaimer: t(
    'Information indicative, pas un conseil d’expert-comptable (loi 15-89). Faites valider le résultat par votre expert-comptable avant toute écriture ou déclaration.',
    'Indicative information, not chartered-accountant advice (law 15-89). Have the result validated by your accountant before any booking or filing.',
    'معلومة إرشادية وليست استشارة خبير محاسب (القانون 15-89). اعرض النتيجة على خبيرك المحاسب قبل أي قيد أو تصريح.',
    'معلومة إرشادية ماشي نصيحة د الخبير المحاسب (القانون 15-89). عرض النتيجة على الخبير المحاسب ديالك قبل أي قيد ولا تصريح.',
  ),
  localProcessing: t(
    'Tout s’exécute dans votre navigateur : aucun fichier ni aucune saisie n’est envoyé à un serveur ; aucun cookie, aucun script tiers.',
    'Everything runs in your browser: no file or input is sent to a server; no cookie, no third-party script.',
    'كل شيء يعمل داخل متصفحك: لا يُرسل أي ملف أو إدخال إلى خادم؛ ولا كوكيز ولا سكربت خارجي.',
    'كلشي كيخدم فالمتصفح ديالك: ما كيتصيفط حتى ملف ولا إدخال لسيرفر؛ وبلا كوكيز وبلا سكريبت د برا.',
  ),
  rulesHeading: t('Règles et valeurs datées utilisées', 'Rules and dated values used', 'القواعد والقيم المؤرخة المستعملة', 'القواعد والقيم المؤرخة المستعملة'),
  rulesIntro: t(
    'Ces valeurs sont des données de contenu datées, jamais des faits permanents : elles sont mises à jour à la parution d’une règle plus récente. L’état dit si la valeur a été recoupée avec une source externe.',
    'These values are dated content data, never permanent facts: they are updated when a newer rule appears. The state tells whether the value has been cross-checked against an external source.',
    'هذه القيم معطيات محتوى مؤرخة وليست حقائق دائمة: تُحدَّث عند صدور قاعدة أحدث. وتبيّن الحالة هل جرى التحقق من القيمة بمصدر خارجي.',
    'هاد القيم معطيات محتوى مؤرخة ماشي حقائق دايمة: كتتحدث منين كتخرج قاعدة جديدة. والحالة كتقول واش القيمة تحققات بمصدر د برا.',
  ),
  asOf: t('au', 'as of', 'بتاريخ', 'بتاريخ'),
  userValue: t('valeur saisie par vous', 'value entered by you', 'قيمة أدخلتها أنت', 'قيمة دخلتيها نتا'),
  howToHeading: t('Comment l’utiliser', 'How to use it', 'طريقة الاستعمال', 'كيفاش تستعملو'),
  faqHeading: t('Questions fréquentes', 'Frequently asked questions', 'أسئلة شائعة', 'أسئلة متكررة'),
  limitsHeading: t('Limites et points à valider', 'Limits and points to validate', 'الحدود ونقاط التحقق', 'الحدود ونقط خاصها تتحقق'),
  existenceHeading: t('Clé modulo 97 : un contrôle de cohérence, pas une preuve d’existence', 'Modulo 97 key: a consistency check, not proof of existence', 'مفتاح modulo 97: فحص اتساق وليس دليلا على الوجود', 'مفتاح modulo 97: تحقق د التناسق ماشي دليل على الوجود'),
  disclaimerHeading: t('Avertissement', 'Notice', 'تنبيه', 'تنبيه'),
  resultHeading: t('Résultat', 'Result', 'النتيجة', 'النتيجة'),
  toolHeading: t('L’outil', 'The tool', 'الأداة', 'الأداة'),
  otherTools: t('Autres outils', 'Other tools', 'أدوات أخرى', 'أدوات خرين'),
  trial: t('Essayer Fisca 14 jours', 'Try Fisca for 14 days', 'جرّب فيسكا 14 يوما', 'جرب فيسكا 14 يوم'),
  jsRequired: t(
    'Cet outil a besoin de JavaScript, exécuté localement dans votre navigateur. Aucune donnée n’est envoyée.',
    'This tool needs JavaScript, executed locally in your browser. No data is sent.',
    'تحتاج هذه الأداة إلى JavaScript يعمل محليا في متصفحك. ولا تُرسل أي بيانات.',
    'هاد الأداة محتاجة JavaScript كيخدم محليا فالمتصفح ديالك. وما كيتصيفط حتى شي معطى.',
  ),
  /** Libellés du résumé d'état de recoupement (ERRATA E). Le code reste affiché en clair à côté. */
  states: {
    'RECOUPÉ': t('recoupé avec une source externe', 'cross-checked with an external source', 'جرى التحقق منه بمصدر خارجي', 'تحقق منو بمصدر د برا'),
    'NON RECOUPÉ': t('non recoupé : à faire valider', 'not cross-checked: to be validated', 'لم يُتحقق منه: يجب اعتماده', 'ما تحققش منو: خاصو يتأكد'),
    PROVISOIRE: t('provisoire', 'provisional', 'مؤقت', 'مؤقت'),
  } satisfies Record<VerificationState, L4>,
} as const;

/** Libellés des paramètres datés affichés avec les résultats. */
export const PARAM_LABELS: Readonly<Record<string, L4>> = {
  late_base_bps: t('Taux directeur Bank Al-Maghrib retenu (loi 69-21)', 'Bank Al-Maghrib policy rate used (law 69-21)', 'سعر الفائدة الرئيسي لبنك المغرب المعتمد (القانون 69-21)', 'سعر الفائدة د بنك المغرب المعتمد (القانون 69-21)'),
  late_increment_bps: t('Majoration par mois supplémentaire entamé', 'Surcharge per additional started month', 'الزيادة عن كل شهر إضافي بدأ', 'الزيادة على كل شهر زايد بدا'),
  late_legal_days: t('Délai légal de paiement (jours)', 'Statutory payment term (days)', 'الأجل القانوني للأداء (أيام)', 'الأجل القانوني د الأداء (أيام)'),
  late_contractual_days: t('Délai conventionnel maximal (jours)', 'Maximum contractual term (days)', 'الأجل الاتفاقي الأقصى (أيام)', 'الأجل الاتفاقي الأقصى (أيام)'),
  late_sector_days: t('Délai sectoriel maximal (jours)', 'Maximum sector term (days)', 'الأجل القطاعي الأقصى (أيام)', 'الأجل القطاعي الأقصى (أيام)'),
  cash_cap_day_cents: t('Plafond d’espèces par jour et par fournisseur', 'Cash cap per day and per supplier', 'سقف الأداء نقدا لكل يوم ولكل مورد', 'سقف الكاش فكل نهار وكل مورد'),
  cash_cap_month_cents: t('Plafond d’espèces par mois et par fournisseur', 'Cash cap per month and per supplier', 'سقف الأداء نقدا لكل شهر ولكل مورد', 'سقف الكاش فكل شهر وكل مورد'),
  vat_standard_bps: t('Taux de TVA normal', 'Standard VAT rate', 'سعر TVA العادي', 'سعر TVA العادي'),
  vat_reduced_bps: t('Taux de TVA réduit', 'Reduced VAT rate', 'سعر TVA المخفض', 'سعر TVA المخفض'),
  vat_zero_bps: t('Taux de TVA nul', 'Zero VAT rate', 'سعر TVA الصفري', 'سعر TVA الصفري'),
  ras_reduced_bps: t('Retenue avec attestation de moins de 6 mois', 'Withholding with an attestation under 6 months old', 'نسبة الاقتطاع مع شهادة عمرها أقل من 6 أشهر', 'نسبة الاقتطاع مع شهادة عمرها قل من 6 شهور'),
  ras_full_bps: t('Retenue sans attestation valide', 'Withholding without a valid attestation', 'نسبة الاقتطاع دون شهادة صالحة', 'نسبة الاقتطاع بلا شهادة صالحة'),
  ras_attestation_months: t('Validité de l’attestation de régularité fiscale (mois)', 'Validity of the tax-compliance attestation (months)', 'صلاحية شهادة الوضعية الجبائية (أشهر)', 'صلاحية شهادة الوضعية الجبائية (شهور)'),
  ae_ir_rate_low_bps: t('Taux d’IR trimestriel de l’auto-entrepreneur, taux bas proposé', 'Auto-entrepreneur quarterly income tax rate, low rate offered', 'نسبة الضريبة الفصلية للمقاول الذاتي، النسبة الدنيا المقترحة', 'نسبة ضريبة الفصل د المقاول الذاتي، النسبة الصغيرة المقترحة'),
  ae_ir_rate_high_bps: t('Taux d’IR trimestriel de l’auto-entrepreneur, taux haut proposé', 'Auto-entrepreneur quarterly income tax rate, high rate offered', 'نسبة الضريبة الفصلية للمقاول الذاتي، النسبة العليا المقترحة', 'نسبة ضريبة الفصل د المقاول الذاتي، النسبة الكبيرة المقترحة'),
  ae_client_threshold_cents: t('Seuil de cumul par client (auto-entrepreneur)', 'Cumulative threshold per client (auto-entrepreneur)', 'عتبة المجموع لكل زبون (المقاول الذاتي)', 'عتبة المجموع على كل كليان (المقاول الذاتي)'),
  ae_withholding_bps: t('Taux de retenue sur le surplus au-delà du seuil', 'Withholding rate on the surplus above the threshold', 'نسبة الاقتطاع على الفائض فوق العتبة', 'نسبة الاقتطاع على الزايد فوق العتبة'),
  mowakaba_coverage_low_bps: t('Prise en charge Mowakaba, bas de fourchette', 'Mowakaba coverage, low end of the range', 'التكفل في مواكبة، الحد الأدنى للمجال', 'التكفل فمواكبة، الحد الأدنى د المجال'),
  mowakaba_coverage_high_bps: t('Prise en charge Mowakaba, haut de fourchette', 'Mowakaba coverage, high end of the range', 'التكفل في مواكبة، الحد الأعلى للمجال', 'التكفل فمواكبة، الحد الأعلى د المجال'),
  mowakaba_max_revenue_ht_cents: t('Plafond de chiffre d’affaires annuel HT d’éligibilité Mowakaba', 'Annual revenue ceiling (excl. VAT) for Mowakaba eligibility', 'سقف رقم المعاملات السنوي دون الرسوم للأهلية لمواكبة', 'سقف رقم المعاملات السنوي بلا الضريبة للأهلية لمواكبة'),
  mowakaba_group_ownership_max_bps: t('Détention maximale par un grand groupe pour rester éligible', 'Maximum ownership by a large group to stay eligible', 'الحد الأقصى لملكية مجموعة كبرى للبقاء مؤهلا', 'الحد الأقصى د ملكية مجموعة كبيرة باش تبقى مؤهل'),
  ras_exclusion_threshold_ttc_cents: t('Seuil TTC en dessous duquel la retenue ne s’applique pas', 'VAT-inclusive amount at or below which no withholding applies', 'المبلغ شامل الرسوم الذي لا يطبق الاقتطاع عند بلوغه أو دونه', 'المبلغ بالضريبة اللي ما كيتطبقش الاقتطاع تحتو ولا فيه'),
};

export const ROLE_LABELS: Readonly<Record<string, L4>> = {
  EXPENSE_DEDUCTIBLE: t('Charge admise en déduction', 'Deductible expense', 'مصروف مقبول خصمه', 'مصروف مقبول فالخصم'),
  EXPENSE_NON_DEDUCTIBLE: t('Charge au-delà du plafond (à réintégrer au Tableau 3 de l’IS)', 'Expense above the cap (add back in Table 3 of the corporate-tax return)', 'مصروف يتجاوز السقف (يُعاد إدماجه في الجدول 3 من الضريبة على الشركات)', 'مصروف فوق السقف (كيترجع فالجدول 3 د الضريبة على الشركات)'),
  VAT_RECOVERABLE: t('TVA récupérable', 'Recoverable VAT', 'TVA قابلة للاسترجاع', 'TVA قابلة للاسترجاع'),
  VAT_NON_RECOVERABLE: t('TVA non récupérable (supportée en charge)', 'Non-recoverable VAT (borne as expense)', 'TVA غير قابلة للاسترجاع (تُحمَّل كمصروف)', 'TVA ماشي قابلة للاسترجاع (كتتحسب مصروف)'),
  CASH: t('Caisse', 'Cash', 'الصندوق', 'الصندوق'),
  SUPPLIER: t('Fournisseurs', 'Suppliers', 'الموردون', 'الموردين'),
  PAYMENT: t('Compte de règlement (banque ou caisse)', 'Payment account (bank or cash)', 'حساب الأداء (بنك أو صندوق)', 'حساب الأداء (بنك ولا صندوق)'),
  VAT_WITHHELD_DUE: t('TVA retenue à la source, due à l’État', 'VAT withheld at source, due to the State', 'TVA المقتطعة من المنبع المستحقة للدولة', 'TVA المقتطعة من المنبع المستحقة للدولة'),
};
