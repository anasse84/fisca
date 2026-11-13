import type { L4 } from '../../content/silos/types.ts';
import type { ToolPageCopy } from './page-types.ts';
import { t } from './common.ts';

export const RAS_PAGE: ToolPageCopy = {
  title: t(
    'Calculateur RAS-TVA (art. 117) et plafond d’espèces (art. 11-II)',
    'VAT withholding (art. 117) and cash cap (art. 11-II) calculator',
    'حاسبة اقتطاع TVA (المادة 117) وسقف الأداء نقدا (المادة 11-II)',
    'حاسبة اقتطاع TVA (المادة 117) وسقف الكاش (المادة 11-II)',
  ),
  description: t(
    'Déterminez le taux de retenue à la source de TVA selon l’attestation fiscale, et scindez un règlement en espèces au-delà du plafond par fournisseur, avec l’écriture comptable équilibrée. Plafonds et taux sont des valeurs datées, calculs en centimes entiers.',
    'Determine the VAT withholding rate according to the tax attestation, and split a cash payment above the per-supplier cap, with the balanced accounting entry. Caps and rates are dated values, calculations in whole cents.',
    'حدد نسبة اقتطاع TVA من المنبع بحسب الشهادة الجبائية، وقسّم الأداء نقدا فوق السقف لكل مورد، مع القيد المحاسبي المتوازن. السقوف والنسب قيم مؤرخة والحسابات بالسنتيمات الصحيحة.',
    'حدد نسبة اقتطاع TVA من المنبع حسب الشهادة الجبائية، وقسم الأداء بالكاش فوق السقف د كل مورد، مع القيد المحاسبي المتوازن. السقوف والنسب قيم مؤرخة والحسابات بالسنتيمات الصحاح.',
  ),
  heading: t(
    'Calculateur de RAS-TVA et de plafond d’espèces',
    'VAT withholding and cash-cap calculator',
    'حاسبة اقتطاع TVA وسقف الأداء نقدا',
    'حاسبة اقتطاع TVA وسقف الكاش',
  ),
  lead: t(
    'Deux calculs pour les achats : la retenue à la source de TVA de l’article 117 (taux réduit avec une attestation de moins de {rasMonths} mois, taux plein sinon) et le plafond de règlement en espèces de l’article 11-II par jour et par mois pour un même fournisseur.',
    'Two purchase calculations: the VAT withholding of article 117 (reduced rate with an attestation under {rasMonths} months old, full rate otherwise) and the cash-payment cap of article 11-II per day and per month for the same supplier.',
    'حسابان للمشتريات: اقتطاع TVA من المنبع بموجب المادة 117 (نسبة مخفضة مع شهادة عمرها أقل من {rasMonths} أشهر ونسبة كاملة بدونها) وسقف الأداء نقدا بموجب المادة 11-II لكل يوم ولكل شهر عن المورد نفسه.',
    'جوج د الحسابات للمشتريات: اقتطاع TVA من المنبع بالمادة 117 (نسبة مخفضة مع شهادة عمرها قل من {rasMonths} شهور ونسبة كاملة بلاها) وسقف الأداء بالكاش بالمادة 11-II فكل نهار وفكل شهر على نفس المورد.',
  ),
  summary: t(
    'RAS-TVA : {rasReduced} de la TVA avec attestation de moins de {rasMonths} mois, {rasFull} sinon. Espèces : plafonds de {capDay} par jour et {capMonth} par mois et par fournisseur, base TTC par défaut ; excédent scindé, écriture équilibrée.',
    'VAT withholding: {rasReduced} of the VAT with an attestation under {rasMonths} months old, {rasFull} otherwise. Cash: caps of {capDay} per day and {capMonth} per month per supplier, VAT-inclusive basis by default; excess split, balanced entry.',
    'اقتطاع TVA: {rasReduced} من TVA مع شهادة عمرها أقل من {rasMonths} أشهر و{rasFull} بدونها. النقد: سقفان {capDay} لكل يوم و{capMonth} لكل شهر عن كل مورد، والأساس شامل الرسوم افتراضيا؛ يُقسَّم الفائض ويُنتج قيد متوازن.',
    'اقتطاع TVA: {rasReduced} د TVA مع شهادة عمرها قل من {rasMonths} شهور و{rasFull} بلاها. الكاش: سقفين {capDay} فكل نهار و{capMonth} فكل شهر على كل مورد، والأساس بالضريبة بشكل افتراضي؛ الزايد كيتقسم وكيخرج قيد متوازن.',
  ),
  steps: {
    fr: [
      { name: 'Choisir le calcul', text: 'Utilisez le bloc RAS-TVA pour un règlement fournisseur, ou le bloc Espèces pour contrôler les règlements en espèces d’un même fournisseur.' },
      { name: 'Saisir les montants et les dates', text: 'RAS-TVA : montant HT, taux de TVA, date de règlement et date de l’attestation. Espèces : une ligne par règlement (date ; fournisseur ; montant TTC).' },
      { name: 'Vérifier la base et les comptes', text: 'La base du plafond d’espèces est TTC par défaut et modifiable en HT. Renseignez les comptes qui ne sont pas cités par les spécifications : ils ne sont jamais devinés.' },
      { name: 'Lire le résultat et l’écriture', text: 'Relevez la retenue ou la part au-delà du plafond, l’écriture débit = crédit, et la date et l’état de recoupement de chaque valeur utilisée.' },
    ],
    en: [
      { name: 'Choose the calculation', text: 'Use the VAT-withholding block for a supplier payment, or the Cash block to check the cash payments made to one supplier.' },
      { name: 'Enter amounts and dates', text: 'VAT withholding: amount excl. VAT, VAT rate, payment date and attestation date. Cash: one line per payment (date; supplier; amount incl. VAT).' },
      { name: 'Check the basis and the accounts', text: 'The cash-cap basis is VAT-inclusive by default and can be switched to excl. VAT. Fill in the accounts that the specifications do not name: they are never guessed.' },
      { name: 'Read the result and the entry', text: 'Note the withholding or the part above the cap, the debit = credit entry, and the date and cross-check state of each value used.' },
    ],
    ar: [
      { name: 'اختيار الحساب', text: 'استعمل كتلة اقتطاع TVA لأداء مورد، أو كتلة النقد لمراقبة المدفوعات نقدا لمورد واحد.' },
      { name: 'إدخال المبالغ والتواريخ', text: 'اقتطاع TVA: المبلغ دون رسوم ونسبة TVA وتاريخ الأداء وتاريخ الشهادة. النقد: سطر لكل أداء (التاريخ؛ المورد؛ المبلغ شاملا الرسوم).' },
      { name: 'مراجعة الأساس والحسابات', text: 'أساس سقف النقد شامل الرسوم افتراضيا ويمكن تحويله إلى دون رسوم. املأ الحسابات التي لا تذكرها المواصفات: لا تُخمَّن أبدا.' },
      { name: 'قراءة النتيجة والقيد', text: 'دوّن الاقتطاع أو الجزء الذي يتجاوز السقف والقيد مدين = دائن وتاريخ كل قيمة مستعملة وحالة التحقق منها.' },
    ],
    ary: [
      { name: 'ختار الحساب', text: 'استعمل كتلة اقتطاع TVA لأداء مورد، ولا كتلة الكاش باش تراقب الأداءات بالكاش لنفس المورد.' },
      { name: 'دخل المبالغ والتواريخ', text: 'اقتطاع TVA: المبلغ بلا ضريبة ونسبة TVA وتاريخ الأداء وتاريخ الشهادة. الكاش: سطر لكل أداء (التاريخ؛ المورد؛ المبلغ بالضريبة).' },
      { name: 'راجع الأساس والحسابات', text: 'أساس سقف الكاش بالضريبة بشكل افتراضي وتقدر تبدلو لبلا ضريبة. عمر الحسابات اللي ما مذكورينش فالمواصفات: عمرهم ما كيتخمنو.' },
      { name: 'قرا النتيجة والقيد', text: 'سجل الاقتطاع ولا الجزء اللي فوق السقف والقيد مدين = دائن وتاريخ كل قيمة مستعملة وحالة التحقق منها.' },
    ],
  },
  faqs: {
    fr: [
      { question: 'Quel taux de retenue s’applique ?', answer: 'Selon les valeurs datées de cette page : {rasReduced} de la TVA si le fournisseur produit une attestation de régularité fiscale de moins de {rasMonths} mois au jour du règlement, {rasFull} sinon. Ces taux ne sont pas recoupés avec une source externe : champ d’application et seuils d’exclusion sont à faire valider.' },
      { question: 'Quels sont les plafonds d’espèces ?', answer: 'Selon les valeurs datées de cette page : {capDay} par jour et {capMonth} par mois, par fournisseur. Ces plafonds sont recoupés par plusieurs sources professionnelles de 2026. La base (TTC retenue par défaut, ou HT) est un paramètre : le texte ne la tranche pas clairement, faites-la valider.' },
      { question: 'Que se passe-t-il quand le cumul mensuel franchit le plafond ?', answer: 'Seule la part au-delà du plafond est scindée : l’outil réintègre le hors taxe correspondant et considère la TVA correspondante comme non récupérable. Exemple : onze factures de 4 800,00 MAD TTC payées en espèces le même mois au même fournisseur franchissent le plafond mensuel à la onzième, pour un excédent de 2 800,00 MAD TTC.' },
    ],
    en: [
      { question: 'Which withholding rate applies?', answer: 'According to this page’s dated values: {rasReduced} of the VAT if the supplier provides a tax-compliance attestation under {rasMonths} months old on the payment day, {rasFull} otherwise. These rates are not cross-checked against an external source: scope and exclusion thresholds are to be validated.' },
      { question: 'What are the cash caps?', answer: 'According to this page’s dated values: {capDay} per day and {capMonth} per month, per supplier. These caps are cross-checked against several 2026 professional sources. The basis (VAT-inclusive by default, or excl. VAT) is a parameter: the text does not settle it clearly, have it validated.' },
      { question: 'What happens when the monthly total crosses the cap?', answer: 'Only the part above the cap is split: the tool adds back the matching amount excl. VAT and treats the matching VAT as non-recoverable. Example: eleven invoices of 4,800.00 MAD incl. VAT paid in cash in the same month to the same supplier cross the monthly cap at the eleventh, for an excess of 2,800.00 MAD incl. VAT.' },
    ],
    ar: [
      { question: 'ما نسبة الاقتطاع المطبقة؟', answer: 'بحسب القيم المؤرخة في هذه الصفحة: {rasReduced} من TVA إذا قدم المورد شهادة الوضعية الجبائية عمرها أقل من {rasMonths} أشهر يوم الأداء و{rasFull} بدونها. لم يُتحقق من هذه النسب بمصدر خارجي: يجب اعتماد مجال التطبيق وعتبات الاستثناء.' },
      { question: 'ما سقوف الأداء نقدا؟', answer: 'بحسب القيم المؤرخة في هذه الصفحة: {capDay} لكل يوم و{capMonth} لكل شهر عن كل مورد. جرى التحقق من هذه السقوف بعدة مصادر مهنية لسنة 2026. أما الأساس (شامل الرسوم افتراضيا أو دون رسوم) فمعامل: لا يحسمه النص بوضوح، فاعتمده.' },
      { question: 'ماذا يحدث عندما يتجاوز المجموع الشهري السقف؟', answer: 'يُقسَّم الجزء الذي يتجاوز السقف فقط: تعيد الأداة إدماج المبلغ دون رسوم المقابل وتعتبر TVA المقابلة غير قابلة للاسترجاع. مثال: إحدى عشرة فاتورة بقيمة 4 800,00 درهم شاملة الرسوم مؤداة نقدا في الشهر نفسه للمورد نفسه تتجاوز السقف الشهري عند الحادية عشرة بفائض 2 800,00 درهم شاملة الرسوم.' },
    ],
    ary: [
      { question: 'شنو هي نسبة الاقتطاع اللي كتطبق؟', answer: 'حسب القيم المؤرخة فهاد الصفحة: {rasReduced} د TVA إلا قدم المورد شهادة الوضعية الجبائية عمرها قل من {rasMonths} شهور نهار الأداء و{rasFull} بلاها. هاد النسب ما تحققش منها بمصدر د برا: مجال التطبيق وعتبات الاستثناء خاصهم يتأكدو.' },
      { question: 'شنو هي سقوف الأداء بالكاش؟', answer: 'حسب القيم المؤرخة فهاد الصفحة: {capDay} فكل نهار و{capMonth} فكل شهر على كل مورد. هاد السقوف تحققنا منها بعدة مصادر مهنية د 2026. أما الأساس (بالضريبة بشكل افتراضي ولا بلا ضريبة) فهو معامل: النص ما كيحسموش بوضوح، خاصو يتأكد.' },
      { question: 'شنو كيوقع منين المجموع الشهري كيفوت السقف؟', answer: 'غير الجزء اللي فوق السقف هو اللي كيتقسم: الأداة كترجع تدمج المبلغ بلا ضريبة المقابل وكتعتبر TVA المقابلة ماشي قابلة للاسترجاع. مثال: احدعشر فاتورة د 4 800,00 درهم بالضريبة مخلصين بالكاش فنفس الشهر لنفس المورد كيفوتو السقف الشهري فالحداشر بزايد د 2 800,00 درهم بالضريبة.' },
    ],
  },
  sections: {
    fr: [
      {
        heading: 'RAS-TVA, article 117',
        paragraphs: ['Les taux, la durée de validité de l’attestation et le seuil d’exclusion sont des valeurs datées affichées avec chaque résultat.'],
        bullets: [
          'TVA = montant HT x taux de TVA ; TTC = HT + TVA.',
          'Retenue = TVA x taux de retenue : {rasReduced} si la date de règlement est postérieure ou égale à la date d’émission de l’attestation et strictement antérieure à son anniversaire de {rasMonths} mois ; {rasFull} sinon.',
          'Aucune retenue si le TTC ne dépasse pas {rasThreshold} (seuil d’exclusion, non recoupé).',
          'Net versé au fournisseur = TTC - retenue ; la retenue est due à l’État.',
        ],
      },
      {
        heading: 'Plafond d’espèces, article 11-II',
        paragraphs: ['Le cumul se fait par fournisseur : par jour avec le plafond journalier, par mois avec le plafond mensuel.'],
        bullets: [
          'La part qui entre dans le plafond reste admise ; la part au-delà est scindée.',
          'Hors taxe de la part au-delà : réintégré au Tableau 3 de l’IS. TVA correspondante : non récupérable.',
          'Écriture : les comptes cités par les spécifications sont préremplis (5161 caisse, 34552 TVA récupérable, 4411 fournisseurs) ; les autres comptes sont à renseigner.',
        ],
      },
      {
        heading: 'Limites et points à valider',
        paragraphs: [
          'Taux de retenue et seuil d’exclusion : non recoupés avec une source externe. Plafonds d’espèces : recoupés ; la base TTC ou HT reste à valider et le projet de loi de finances 2027 propose d’ajouter le dépôt bancaire aux modes de règlement admis.',
          'Le jour anniversaire exact de l’attestation (six mois pile) est traité comme expiré : la règle n’est pas tranchée. Le traitement comptable de la part non admise (charge, TVA non récupérable) est à valider par un expert-comptable ; les comptes de retenue due à l’État et de règlement ne sont cités par aucune spécification et restent à saisir.',
        ],
      },
    ],
    en: [
      {
        heading: 'VAT withholding, article 117',
        paragraphs: ['Rates, attestation validity and the exclusion threshold are dated values shown with each result.'],
        bullets: [
          'VAT = amount excl. VAT x VAT rate; amount incl. VAT = excl. VAT + VAT.',
          'Withholding = VAT x withholding rate: {rasReduced} if the payment date is on or after the attestation issue date and strictly before its {rasMonths}-month anniversary; {rasFull} otherwise.',
          'No withholding if the amount incl. VAT does not exceed {rasThreshold} (exclusion threshold, not cross-checked).',
          'Net paid to the supplier = amount incl. VAT - withholding; the withholding is owed to the State.',
        ],
      },
      {
        heading: 'Cash cap, article 11-II',
        paragraphs: ['Totals are per supplier: per day against the daily cap, per month against the monthly cap.'],
        bullets: [
          'The part within the cap remains allowed; the part above it is split.',
          'Amount excl. VAT of the part above the cap: added back in Table 3 of the corporate-tax return. Matching VAT: non-recoverable.',
          'Entry: accounts named by the specifications are pre-filled (5161 cash, 34552 recoverable VAT, 4411 suppliers); other accounts are left for you to fill in.',
        ],
      },
      {
        heading: 'Limits and points to validate',
        paragraphs: [
          'Withholding rates and exclusion threshold: not cross-checked against an external source. Cash caps: cross-checked; the VAT-inclusive or excl. VAT basis remains to be validated and the 2027 finance bill proposes adding bank deposit to the accepted payment methods.',
          'The exact attestation anniversary (six months to the day) is treated as expired: the rule is not settled. The accounting treatment of the disallowed part (expense, non-recoverable VAT) is to be validated by an accountant; the withholding-due and payment accounts are named by no specification and are left for you to enter.',
        ],
      },
    ],
    ar: [
      {
        heading: 'اقتطاع TVA، المادة 117',
        paragraphs: ['النسب ومدة صلاحية الشهادة وعتبة الاستثناء قيم مؤرخة تُعرض مع كل نتيجة.'],
        bullets: [
          'TVA = المبلغ دون رسوم × نسبة TVA؛ المبلغ شاملا الرسوم = دون رسوم + TVA.',
          'الاقتطاع = TVA × نسبة الاقتطاع: {rasReduced} إذا كان تاريخ الأداء مساويا أو لاحقا لتاريخ إصدار الشهادة وسابقا تماما لذكراها بعد {rasMonths} أشهر؛ و{rasFull} خلاف ذلك.',
          'لا اقتطاع إذا لم يتجاوز المبلغ شاملا الرسوم {rasThreshold} (عتبة الاستثناء، لم يُتحقق منها).',
          'الصافي المؤدى للمورد = المبلغ شاملا الرسوم - الاقتطاع؛ ويُستحق الاقتطاع للدولة.',
        ],
      },
      {
        heading: 'سقف الأداء نقدا، المادة 11-II',
        paragraphs: ['التجميع لكل مورد: يوميا مقابل السقف اليومي وشهريا مقابل السقف الشهري.'],
        bullets: [
          'الجزء داخل السقف يبقى مقبولا؛ والجزء الذي يتجاوزه يُقسَّم.',
          'المبلغ دون رسوم للجزء الذي يتجاوز السقف: يُعاد إدماجه في الجدول 3 من الضريبة على الشركات. وTVA المقابلة: غير قابلة للاسترجاع.',
          'القيد: تُملأ مسبقا الحسابات التي تذكرها المواصفات (5161 الصندوق، 34552 TVA القابلة للاسترجاع، 4411 الموردون)؛ أما بقية الحسابات فتُترك لك.',
        ],
      },
      {
        heading: 'الحدود ونقاط التحقق',
        paragraphs: [
          'نسب الاقتطاع وعتبة الاستثناء: لم يُتحقق منها بمصدر خارجي. سقوف النقد: جرى التحقق منها؛ ويبقى أساس الرسوم شاملة أو دونها محتاجا إلى اعتماد، ويقترح مشروع قانون المالية 2027 إضافة الإيداع البنكي إلى وسائل الأداء المقبولة.',
          'يُعامل يوم الذكرى بالضبط للشهادة (ستة أشهر تماما) كشهادة منتهية: القاعدة غير محسومة. والمعالجة المحاسبية للجزء غير المقبول (مصروف، TVA غير قابلة للاسترجاع) يجب أن يعتمدها خبير محاسب؛ وحسابا الاقتطاع المستحق والأداء لا تذكرهما أي مواصفة ويُتركان لك.',
        ],
      },
    ],
    ary: [
      {
        heading: 'اقتطاع TVA، المادة 117',
        paragraphs: ['النسب ومدة صلاحية الشهادة وعتبة الاستثناء قيم مؤرخة كتبان مع كل نتيجة.'],
        bullets: [
          'TVA = المبلغ بلا ضريبة × نسبة TVA؛ المبلغ بالضريبة = بلا ضريبة + TVA.',
          'الاقتطاع = TVA × نسبة الاقتطاع: {rasReduced} إلا كان تاريخ الأداء مساوي ولا من بعد تاريخ إصدار الشهادة وقبل ذكراها د {rasMonths} شهور بالضبط؛ و{rasFull} فالباقي.',
          'ما كاين اقتطاع إلا ما فاتش المبلغ بالضريبة {rasThreshold} (عتبة الاستثناء، ما تحققش منها).',
          'الصافي اللي كيتخلص للمورد = المبلغ بالضريبة - الاقتطاع؛ والاقتطاع كيتخلص للدولة.',
        ],
      },
      {
        heading: 'سقف الكاش، المادة 11-II',
        paragraphs: ['التجميع على كل مورد: فكل نهار مقابل السقف اليومي وفكل شهر مقابل السقف الشهري.'],
        bullets: [
          'الجزء اللي داخل السقف كيبقى مقبول؛ والجزء اللي فوقو كيتقسم.',
          'المبلغ بلا ضريبة د الجزء اللي فوق السقف: كيترجع فالجدول 3 د الضريبة على الشركات. وTVA المقابلة: ماشي قابلة للاسترجاع.',
          'القيد: الحسابات المذكورة فالمواصفات معمرة من قبل (5161 الصندوق، 34552 TVA القابلة للاسترجاع، 4411 الموردين)؛ والحسابات لخرين كتعمرهم نتا.',
        ],
      },
      {
        heading: 'الحدود ونقط خاصها تتحقق',
        paragraphs: [
          'نسب الاقتطاع وعتبة الاستثناء: ما تحققش منهم بمصدر د برا. سقوف الكاش: تحققنا منها؛ وأساس الضريبة ولا بلاها باقي خاصو يتأكد، ومشروع قانون المالية 2027 كيقترح يزيد الإيداع البنكي لوسائل الأداء المقبولة.',
          'نهار الذكرى بالضبط د الشهادة (ست شهور بالضبط) كيتعامل معاه بحال منتهية: القاعدة ماشي محسومة. والمعالجة المحاسبية د الجزء ماشي مقبول (مصروف، TVA ماشي قابلة للاسترجاع) خاصها تتأكد عند خبير محاسب؛ وحسابات الاقتطاع المستحق والأداء ما مذكورين فحتى مواصفة وكتعمرهم نتا.',
        ],
      },
    ],
  },
  legislation: { name: 'Code général des impôts, articles 117 et 11-II', identifier: 'CGI art. 117 et 11-II' },
};

export interface RasUiCopy {
  readonly rasHeading: string;
  readonly cashHeading: string;
  readonly htLabel: string;
  readonly vatRateLabel: string;
  readonly paymentDateLabel: string;
  readonly attestationLabel: string;
  readonly attestationHint: string;
  readonly paymentAccountLabel: string;
  readonly withheldAccountLabel: string;
  readonly accountHint: string;
  readonly rasSubmit: string;
  readonly vat: string;
  readonly ttc: string;
  readonly attestationState: string;
  readonly attNone: string;
  readonly attValid: string;
  readonly attExpired: string;
  readonly rate: string;
  readonly withheld: string;
  readonly netPaid: string;
  readonly belowThreshold: string;
  readonly entryHeading: string;
  readonly colAccount: string;
  readonly colLabel: string;
  readonly colDebit: string;
  readonly colCredit: string;
  readonly accountToFill: string;
  readonly totals: string;
  readonly balanced: string;
  readonly linesLabel: string;
  readonly linesHint: string;
  readonly capBasisLabel: string;
  readonly capBasisTtc: string;
  readonly capBasisHt: string;
  readonly expenseAccountLabel: string;
  readonly cashSubmit: string;
  readonly loadExample: string;
  readonly exampleSupplier: string;
  readonly cashTableCaption: string;
  readonly colDate: string;
  readonly colSupplier: string;
  readonly colTtc: string;
  readonly colAllowed: string;
  readonly colExcess: string;
  readonly colReintegrated: string;
  readonly colLostVat: string;
  readonly colCumulMonth: string;
  readonly crossed: string;
  readonly noExcess: string;
  readonly excessTotal: string;
  readonly reintegratedTotal: string;
  readonly lostVatTotal: string;
  readonly bindingDay: string;
  readonly bindingMonth: string;
  readonly rulesUsed: string;
  readonly errAmount: string;
  readonly errPaymentDate: string;
  readonly errAttestationDate: string;
  readonly errAttestationAfter: string;
  readonly errLinesEmpty: string;
  readonly errLinesFormat: string;
  readonly errLinesDate: string;
  readonly errLinesAmount: string;
  readonly errAccount: string;
}

const FR: RasUiCopy = {
  rasHeading: 'Retenue à la source de TVA (art. 117)',
  cashHeading: 'Plafond de règlement en espèces (art. 11-II)',
  htLabel: 'Montant HT de la facture (MAD)',
  vatRateLabel: 'Taux de TVA',
  paymentDateLabel: 'Date de règlement',
  attestationLabel: 'Date d’émission de l’attestation de régularité fiscale',
  attestationHint: 'Laissez vide si le fournisseur n’en produit pas.',
  paymentAccountLabel: 'Compte de règlement (banque ou caisse)',
  withheldAccountLabel: 'Compte de retenue due à l’État',
  accountHint: 'Facultatif : 3 à 8 chiffres. Non cité par les spécifications, jamais deviné.',
  rasSubmit: 'Calculer la retenue',
  vat: 'TVA',
  ttc: 'Montant TTC',
  attestationState: 'Attestation',
  attNone: 'aucune attestation : taux plein',
  attValid: 'valide au jour du règlement : taux réduit',
  attExpired: 'expirée au jour du règlement : taux plein',
  rate: 'Taux de retenue',
  withheld: 'Retenue à la source',
  netPaid: 'Net versé au fournisseur',
  belowThreshold: 'Le TTC ne dépasse pas le seuil d’exclusion ({threshold}) : aucune retenue.',
  entryHeading: 'Écriture comptable',
  colAccount: 'Compte',
  colLabel: 'Libellé',
  colDebit: 'Débit',
  colCredit: 'Crédit',
  accountToFill: 'à renseigner',
  totals: 'Totaux',
  balanced: 'Écriture équilibrée : débit = crédit.',
  linesLabel: 'Règlements en espèces (un par ligne : date ; fournisseur ; montant TTC en MAD)',
  linesHint: 'Format : 2026-11-03 ; Atlas Fournitures ; 7 200,00',
  capBasisLabel: 'Base du plafond',
  capBasisTtc: 'TTC (par défaut)',
  capBasisHt: 'HT',
  expenseAccountLabel: 'Compte de charge',
  cashSubmit: 'Contrôler les plafonds',
  loadExample: 'Charger l’exemple : 11 factures de 4 800 MAD TTC',
  exampleSupplier: 'Fournisseur A',
  cashTableCaption: 'Contrôle des règlements en espèces par fournisseur',
  colDate: 'Date',
  colSupplier: 'Fournisseur',
  colTtc: 'Règlement TTC',
  colAllowed: 'Dans le plafond (TTC)',
  colExcess: 'Au-delà (TTC)',
  colReintegrated: 'HT réintégré',
  colLostVat: 'TVA perdue',
  colCumulMonth: 'Cumul du mois',
  crossed: 'Plafond franchi à la ligne {n}.',
  noExcess: 'Aucun règlement ne franchit un plafond.',
  excessTotal: 'Excédent total scindé (TTC)',
  reintegratedTotal: 'HT à réintégrer au Tableau 3 de l’IS',
  lostVatTotal: 'TVA non récupérable',
  bindingDay: 'plafond du jour',
  bindingMonth: 'plafond du mois',
  rulesUsed: 'Règles utilisées pour ce résultat',
  errAmount: 'Saisissez un montant HT valide, supérieur à zéro, avec au plus deux décimales.',
  errPaymentDate: 'Saisissez une date de règlement valide.',
  errAttestationDate: 'La date de l’attestation n’est pas valide.',
  errAttestationAfter: 'La date de l’attestation est postérieure au règlement : elle ne peut pas être prise en compte.',
  errLinesEmpty: 'Saisissez au moins un règlement.',
  errLinesFormat: 'Ligne {n} : attendu « date ; fournisseur ; montant ».',
  errLinesDate: 'Ligne {n} : date invalide (format AAAA-MM-JJ).',
  errLinesAmount: 'Ligne {n} : montant invalide.',
  errAccount: 'Un numéro de compte comporte 3 à 8 chiffres.',
};

const EN: RasUiCopy = {
  rasHeading: 'VAT withholding at source (art. 117)',
  cashHeading: 'Cash-payment cap (art. 11-II)',
  htLabel: 'Invoice amount excl. VAT (MAD)',
  vatRateLabel: 'VAT rate',
  paymentDateLabel: 'Payment date',
  attestationLabel: 'Issue date of the tax-compliance attestation',
  attestationHint: 'Leave empty if the supplier provides none.',
  paymentAccountLabel: 'Payment account (bank or cash)',
  withheldAccountLabel: 'Withholding-due account',
  accountHint: 'Optional: 3 to 8 digits. Not named by the specifications, never guessed.',
  rasSubmit: 'Compute the withholding',
  vat: 'VAT',
  ttc: 'Amount incl. VAT',
  attestationState: 'Attestation',
  attNone: 'no attestation: full rate',
  attValid: 'valid on the payment day: reduced rate',
  attExpired: 'expired on the payment day: full rate',
  rate: 'Withholding rate',
  withheld: 'Withholding at source',
  netPaid: 'Net paid to the supplier',
  belowThreshold: 'The amount incl. VAT does not exceed the exclusion threshold ({threshold}): no withholding.',
  entryHeading: 'Accounting entry',
  colAccount: 'Account',
  colLabel: 'Label',
  colDebit: 'Debit',
  colCredit: 'Credit',
  accountToFill: 'to be filled in',
  totals: 'Totals',
  balanced: 'Balanced entry: debit = credit.',
  linesLabel: 'Cash payments (one per line: date; supplier; amount incl. VAT in MAD)',
  linesHint: 'Format: 2026-11-03; Atlas Supplies; 7,200.00',
  capBasisLabel: 'Cap basis',
  capBasisTtc: 'Incl. VAT (default)',
  capBasisHt: 'Excl. VAT',
  expenseAccountLabel: 'Expense account',
  cashSubmit: 'Check the caps',
  loadExample: 'Load the example: 11 invoices of 4,800 MAD incl. VAT',
  exampleSupplier: 'Supplier A',
  cashTableCaption: 'Cash payments checked per supplier',
  colDate: 'Date',
  colSupplier: 'Supplier',
  colTtc: 'Payment incl. VAT',
  colAllowed: 'Within cap (incl. VAT)',
  colExcess: 'Above cap (incl. VAT)',
  colReintegrated: 'Excl. VAT added back',
  colLostVat: 'VAT lost',
  colCumulMonth: 'Month total',
  crossed: 'Cap crossed at row {n}.',
  noExcess: 'No payment crosses a cap.',
  excessTotal: 'Total excess split (incl. VAT)',
  reintegratedTotal: 'Excl. VAT to add back in Table 3 of the corporate-tax return',
  lostVatTotal: 'Non-recoverable VAT',
  bindingDay: 'daily cap',
  bindingMonth: 'monthly cap',
  rulesUsed: 'Rules used for this result',
  errAmount: 'Enter a valid amount excl. VAT, above zero, with at most two decimals.',
  errPaymentDate: 'Enter a valid payment date.',
  errAttestationDate: 'The attestation date is not valid.',
  errAttestationAfter: 'The attestation date is after the payment: it cannot be taken into account.',
  errLinesEmpty: 'Enter at least one payment.',
  errLinesFormat: 'Row {n}: expected “date; supplier; amount”.',
  errLinesDate: 'Row {n}: invalid date (format YYYY-MM-DD).',
  errLinesAmount: 'Row {n}: invalid amount.',
  errAccount: 'An account number has 3 to 8 digits.',
};

const AR: RasUiCopy = {
  rasHeading: 'اقتطاع TVA من المنبع (المادة 117)',
  cashHeading: 'سقف الأداء نقدا (المادة 11-II)',
  htLabel: 'مبلغ الفاتورة دون رسوم (درهم)',
  vatRateLabel: 'نسبة TVA',
  paymentDateLabel: 'تاريخ الأداء',
  attestationLabel: 'تاريخ إصدار شهادة الوضعية الجبائية',
  attestationHint: 'اتركه فارغا إذا لم يقدم المورد شهادة.',
  paymentAccountLabel: 'حساب الأداء (بنك أو صندوق)',
  withheldAccountLabel: 'حساب الاقتطاع المستحق للدولة',
  accountHint: 'اختياري: من 3 إلى 8 أرقام. لا تذكره المواصفات ولا يُخمَّن.',
  rasSubmit: 'احسب الاقتطاع',
  vat: 'TVA',
  ttc: 'المبلغ شاملا الرسوم',
  attestationState: 'الشهادة',
  attNone: 'لا شهادة: النسبة الكاملة',
  attValid: 'صالحة يوم الأداء: النسبة المخفضة',
  attExpired: 'منتهية يوم الأداء: النسبة الكاملة',
  rate: 'نسبة الاقتطاع',
  withheld: 'الاقتطاع من المنبع',
  netPaid: 'الصافي المؤدى للمورد',
  belowThreshold: 'لا يتجاوز المبلغ شاملا الرسوم عتبة الاستثناء ({threshold}): لا اقتطاع.',
  entryHeading: 'القيد المحاسبي',
  colAccount: 'الحساب',
  colLabel: 'البيان',
  colDebit: 'مدين',
  colCredit: 'دائن',
  accountToFill: 'يُملأ',
  totals: 'المجاميع',
  balanced: 'قيد متوازن: مدين = دائن.',
  linesLabel: 'المدفوعات نقدا (سطر لكل أداء: التاريخ؛ المورد؛ المبلغ شاملا الرسوم بالدرهم)',
  linesHint: 'الصيغة: 2026-11-03 ؛ أطلس للتوريدات ؛ 7200,00',
  capBasisLabel: 'أساس السقف',
  capBasisTtc: 'شامل الرسوم (افتراضي)',
  capBasisHt: 'دون رسوم',
  expenseAccountLabel: 'حساب المصروف',
  cashSubmit: 'راقب السقوف',
  loadExample: 'حمّل المثال: 11 فاتورة بقيمة 4800 درهم شاملة الرسوم',
  exampleSupplier: 'المورد أ',
  cashTableCaption: 'مراقبة المدفوعات نقدا لكل مورد',
  colDate: 'التاريخ',
  colSupplier: 'المورد',
  colTtc: 'الأداء شاملا الرسوم',
  colAllowed: 'داخل السقف (شامل الرسوم)',
  colExcess: 'فوق السقف (شامل الرسوم)',
  colReintegrated: 'المبلغ دون رسوم المعاد إدماجه',
  colLostVat: 'TVA المفقودة',
  colCumulMonth: 'مجموع الشهر',
  crossed: 'تم تجاوز السقف عند السطر {n}.',
  noExcess: 'لا يتجاوز أي أداء سقفا.',
  excessTotal: 'مجموع الفائض المُقسَّم (شامل الرسوم)',
  reintegratedTotal: 'المبلغ دون رسوم الواجب إدماجه في الجدول 3 من الضريبة على الشركات',
  lostVatTotal: 'TVA غير القابلة للاسترجاع',
  bindingDay: 'السقف اليومي',
  bindingMonth: 'السقف الشهري',
  rulesUsed: 'القواعد المستعملة لهذه النتيجة',
  errAmount: 'أدخل مبلغا صالحا دون رسوم أكبر من الصفر بعشريتين على الأكثر.',
  errPaymentDate: 'أدخل تاريخ أداء صالحا.',
  errAttestationDate: 'تاريخ الشهادة غير صالح.',
  errAttestationAfter: 'تاريخ الشهادة لاحق للأداء: لا يمكن اعتباره.',
  errLinesEmpty: 'أدخل أداء واحدا على الأقل.',
  errLinesFormat: 'السطر {n}: المتوقع «التاريخ؛ المورد؛ المبلغ».',
  errLinesDate: 'السطر {n}: تاريخ غير صالح (الصيغة سنة-شهر-يوم).',
  errLinesAmount: 'السطر {n}: مبلغ غير صالح.',
  errAccount: 'رقم الحساب من 3 إلى 8 أرقام.',
};

const ARY: RasUiCopy = {
  rasHeading: 'اقتطاع TVA من المنبع (المادة 117)',
  cashHeading: 'سقف الأداء بالكاش (المادة 11-II)',
  htLabel: 'مبلغ الفاتورة بلا ضريبة (درهم)',
  vatRateLabel: 'نسبة TVA',
  paymentDateLabel: 'تاريخ الأداء',
  attestationLabel: 'تاريخ إصدار شهادة الوضعية الجبائية',
  attestationHint: 'خليه خاوي إلا ما قدمش المورد شهادة.',
  paymentAccountLabel: 'حساب الأداء (بنك ولا صندوق)',
  withheldAccountLabel: 'حساب الاقتطاع المستحق للدولة',
  accountHint: 'اختياري: من 3 حتى ل 8 أرقام. ما مذكورش فالمواصفات وعمرو ما كيتخمن.',
  rasSubmit: 'حسب الاقتطاع',
  vat: 'TVA',
  ttc: 'المبلغ بالضريبة',
  attestationState: 'الشهادة',
  attNone: 'ما كايناش شهادة: النسبة الكاملة',
  attValid: 'صالحة نهار الأداء: النسبة المخفضة',
  attExpired: 'منتهية نهار الأداء: النسبة الكاملة',
  rate: 'نسبة الاقتطاع',
  withheld: 'الاقتطاع من المنبع',
  netPaid: 'الصافي اللي كيتخلص للمورد',
  belowThreshold: 'المبلغ بالضريبة ما فاتش عتبة الاستثناء ({threshold}): ما كاين اقتطاع.',
  entryHeading: 'القيد المحاسبي',
  colAccount: 'الحساب',
  colLabel: 'البيان',
  colDebit: 'مدين',
  colCredit: 'دائن',
  accountToFill: 'تعمر',
  totals: 'المجاميع',
  balanced: 'قيد متوازن: مدين = دائن.',
  linesLabel: 'الأداءات بالكاش (سطر لكل أداء: التاريخ؛ المورد؛ المبلغ بالضريبة بالدرهم)',
  linesHint: 'الصيغة: 2026-11-03 ؛ أطلس للتوريدات ؛ 7200,00',
  capBasisLabel: 'أساس السقف',
  capBasisTtc: 'بالضريبة (افتراضي)',
  capBasisHt: 'بلا ضريبة',
  expenseAccountLabel: 'حساب المصروف',
  cashSubmit: 'راقب السقوف',
  loadExample: 'حمل المثال: 11 فاتورة د 4800 درهم بالضريبة',
  exampleSupplier: 'المورد أ',
  cashTableCaption: 'مراقبة الأداءات بالكاش لكل مورد',
  colDate: 'التاريخ',
  colSupplier: 'المورد',
  colTtc: 'الأداء بالضريبة',
  colAllowed: 'داخل السقف (بالضريبة)',
  colExcess: 'فوق السقف (بالضريبة)',
  colReintegrated: 'المبلغ بلا ضريبة اللي ترجع',
  colLostVat: 'TVA الضايعة',
  colCumulMonth: 'مجموع الشهر',
  crossed: 'السقف تفات عند السطر {n}.',
  noExcess: 'ما كاين حتى أداء فات سقف.',
  excessTotal: 'مجموع الزايد المقسم (بالضريبة)',
  reintegratedTotal: 'المبلغ بلا ضريبة اللي خاصو يرجع فالجدول 3 د الضريبة على الشركات',
  lostVatTotal: 'TVA ماشي قابلة للاسترجاع',
  bindingDay: 'السقف د النهار',
  bindingMonth: 'السقف د الشهر',
  rulesUsed: 'القواعد المستعملة فهاد النتيجة',
  errAmount: 'دخل مبلغ صالح بلا ضريبة كبر من الصفر وبجوج د الأرقام العشرية على الأكثر.',
  errPaymentDate: 'دخل تاريخ أداء صالح.',
  errAttestationDate: 'تاريخ الشهادة ماشي صالح.',
  errAttestationAfter: 'تاريخ الشهادة من بعد الأداء: ما يمكنش نحسبو عليه.',
  errLinesEmpty: 'دخل أداء واحد على الأقل.',
  errLinesFormat: 'السطر {n}: المنتظر «التاريخ؛ المورد؛ المبلغ».',
  errLinesDate: 'السطر {n}: تاريخ ماشي صالح (الصيغة سنة-شهر-يوم).',
  errLinesAmount: 'السطر {n}: مبلغ ماشي صالح.',
  errAccount: 'رقم الحساب من 3 حتى ل 8 أرقام.',
};

export const RAS_UI: L4<RasUiCopy> = { fr: FR, en: EN, ar: AR, ary: ARY };
