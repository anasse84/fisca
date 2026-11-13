import type { L4 } from '../../content/silos/types.ts';
import type { ToolPageCopy } from './page-types.ts';
import { t } from './common.ts';

export const AE_PAGE: ToolPageCopy = {
  title: t(
    'Simulateur auto-entrepreneur : IR trimestriel et seuil par client',
    'Auto-entrepreneur simulator: quarterly income tax and per-client threshold',
    'محاكي المقاول الذاتي: الضريبة الفصلية والعتبة لكل زبون',
    'محاكي المقاول الذاتي: الضريبة د الفصل والعتبة على كل كليان',
  ),
  description: t(
    'Calculez l’IR trimestriel de l’auto-entrepreneur à un taux daté ou saisi, détectez le dépassement de {aeThreshold} cumulés pour un même client (retenue sur le surplus) et comparez avec le forfait Fisca Essentiel, en centimes entiers.',
    'Compute the auto-entrepreneur quarterly income tax at a dated or entered rate, detect when invoicing to one client exceeds {aeThreshold} (withholding on the surplus) and compare with the Fisca Essentiel plan, in whole cents.',
    'احسب الضريبة الفصلية على الدخل للمقاول الذاتي بنسبة مؤرخة أو مدخلة، واكتشف تجاوز {aeThreshold} المجمّعة لزبون واحد (اقتطاع على الفائض) وقارن مع باقة Fisca Essentiel، بالسنتيمات الصحيحة.',
    'حسب الضريبة د الفصل على الدخل للمقاول الذاتي بنسبة مؤرخة ولا مدخلة، وشوف واش تجاوزتي {aeThreshold} المجمّعة لكليان واحد (اقتطاع على الزايد) وقارن مع باقة Fisca Essentiel، بالسنتيمات الصحاح.',
  ),
  heading: t(
    'Simulateur auto-entrepreneur : IR trimestriel et seuil par client',
    'Auto-entrepreneur simulator: quarterly income tax and per-client threshold',
    'محاكي المقاول الذاتي: الضريبة الفصلية والعتبة لكل زبون',
    'محاكي المقاول الذاتي: الضريبة د الفصل والعتبة على كل كليان',
  ),
  lead: t(
    'Trois calculs en un : l’IR du trimestre au taux que vous choisissez, l’alerte de retenue quand le cumul facturé à un même client dépasse {aeThreshold}, et l’écart de coût annuel entre rester auto-entrepreneur et passer en société avec le forfait Essentiel. Aucun taux n’est présenté comme un fait : chaque valeur affiche sa date et son état de recoupement.',
    'Three calculations in one: the quarter’s income tax at the rate you choose, the withholding alert when the amount invoiced to one client exceeds {aeThreshold}, and the annual cost gap between staying an auto-entrepreneur and moving to a company on the Essentiel plan. No rate is presented as a fact: each value shows its date and cross-check state.',
    'ثلاثة حسابات في أداة واحدة: ضريبة الفصل بالنسبة التي تختارها، وتنبيه الاقتطاع حين يتجاوز المجموع المفوتر لزبون واحد {aeThreshold}، وفارق التكلفة السنوية بين البقاء مقاولا ذاتيا والانتقال إلى شركة بباقة Essentiel. لا تُعرض أي نسبة كأنها حقيقة ثابتة: تظهر مع كل قيمة تاريخها وحالة التحقق منها.',
    'تلات د الحسابات فأداة وحدة: ضريبة الفصل بالنسبة اللي كتختار، وتنبيه الاقتطاع منين المجموع المفوتر لكليان واحد كيفوت {aeThreshold}، وفرق التكلفة فالعام بين تبقى مقاول ذاتي وتدوز لشركة بباقة Essentiel. ما كاينة حتى نسبة معروضة بحال شي حقيقة ثابتة: كل قيمة كتبين التاريخ ديالها وحالة التحقق.',
  ),
  summary: t(
    'IR du trimestre = chiffre d’affaires x taux (points de base, demi supérieur) ; retenue de {aeWithholding} sur la part du cumul client au-delà de {aeThreshold} ; comparaison indicative avec le forfait Essentiel ({priceEssentielAnnual} HT par an).',
    'Quarter income tax = revenue x rate (basis points, half-up); {aeWithholding} withholding on the part of the client total above {aeThreshold}; indicative comparison with the Essentiel plan ({priceEssentielAnnual} excl. VAT per year).',
    'ضريبة الفصل = رقم المعاملات × النسبة (نقاط الأساس، التقريب إلى الأعلى عند النصف)؛ اقتطاع {aeWithholding} على جزء مجموع الزبون الذي يفوق {aeThreshold}؛ مقارنة إرشادية مع باقة Essentiel ({priceEssentielAnnual} دون احتساب الرسوم في السنة).',
    'ضريبة الفصل = رقم المعاملات × النسبة (نقاط الأساس، التقريب للأعلى فالنص)؛ اقتطاع {aeWithholding} على جزء مجموع الكليان اللي فاق {aeThreshold}؛ مقارنة إرشادية مع باقة Essentiel ({priceEssentielAnnual} بلا الضريبة فالعام).',
  ),
  steps: {
    fr: [
      { name: 'Saisir le chiffre d’affaires du trimestre', text: 'Indiquez le chiffre d’affaires encaissé sur le trimestre, en dirhams.' },
      { name: 'Choisir le taux d’IR', text: 'Prenez l’un des deux taux datés proposés ({aeIrLow} ou {aeIrHigh}) ou saisissez le taux qui s’applique à votre activité : l’outil ne rattache aucun taux à une activité.' },
      { name: 'Contrôler le cumul par client', text: 'Saisissez le cumul déjà facturé à un client depuis le début de l’année et la nouvelle facture : l’alerte indique la part au-delà de {aeThreshold} et la retenue de {aeWithholding}.' },
      { name: 'Comparer avec une société', text: 'Ajoutez vos autres coûts annuels de société (honoraires, etc.) : l’outil compare avec le forfait Essentiel, sans calculer l’impôt de la société.' },
    ],
    en: [
      { name: 'Enter the quarter’s revenue', text: 'Give the revenue collected over the quarter, in dirhams.' },
      { name: 'Choose the income tax rate', text: 'Take one of the two dated rates offered ({aeIrLow} or {aeIrHigh}) or enter the rate that applies to your activity: the tool does not tie any rate to an activity.' },
      { name: 'Check the per-client threshold', text: 'Enter the total already invoiced to a client since the start of the year and the new invoice: the alert shows the part above {aeThreshold} and the {aeWithholding} withholding.' },
      { name: 'Compare with a company', text: 'Add your other annual company costs (fees, etc.): the tool compares with the Essentiel plan, without computing the company’s tax.' },
    ],
    ar: [
      { name: 'إدخال رقم معاملات الفصل', text: 'أدخل رقم المعاملات المحصَّل خلال الفصل بالدرهم.' },
      { name: 'اختيار نسبة الضريبة', text: 'اختر إحدى النسبتين المؤرختين المقترحتين ({aeIrLow} أو {aeIrHigh}) أو أدخل النسبة المطبقة على نشاطك: الأداة لا تربط أي نسبة بنشاط معين.' },
      { name: 'مراقبة العتبة لكل زبون', text: 'أدخل المجموع المفوتر سابقا لزبون منذ بداية السنة والفاتورة الجديدة: يبيّن التنبيه الجزء الذي يفوق {aeThreshold} واقتطاع {aeWithholding}.' },
      { name: 'المقارنة مع شركة', text: 'أضف تكاليفك السنوية الأخرى للشركة (أتعاب وغيرها): تقارن الأداة مع باقة Essentiel دون حساب ضريبة الشركة.' },
    ],
    ary: [
      { name: 'دخل رقم معاملات الفصل', text: 'دخل رقم المعاملات اللي تحصل فالفصل بالدرهم.' },
      { name: 'ختار نسبة الضريبة', text: 'ختار وحدة من النسبتين المؤرختين المقترحين ({aeIrLow} ولا {aeIrHigh}) ولا دخل النسبة اللي كتطبق على النشاط ديالك: الأداة ما كتربط حتى نسبة بنشاط معين.' },
      { name: 'راقب العتبة على كل كليان', text: 'دخل المجموع اللي تفوتر قبل لكليان من بداية العام والفاتورة الجديدة: التنبيه كيبين الجزء اللي فاق {aeThreshold} واقتطاع {aeWithholding}.' },
      { name: 'قارن مع شركة', text: 'زيد التكاليف الأخرى د الشركة فالعام (أتعاب وغيرها): الأداة كتقارن مع باقة Essentiel بلا ما تحسب ضريبة الشركة.' },
    ],
  },
  faqs: {
    fr: [
      { question: 'Quel taux d’IR dois-je choisir, {aeIrLow} ou {aeIrHigh} ?', answer: 'Les spécifications de Fisca citent les deux taux ({aeIrLow} ou {aeIrHigh}) sans dire lequel correspond à quelle activité, et ils n’ont pas été recoupés avec une source externe. L’outil vous laisse donc choisir ou saisir le taux : demandez-le à votre expert-comptable ou à l’administration.' },
      { question: 'Que se passe-t-il au-delà de {aeThreshold} facturés à un même client ?', answer: 'L’outil applique une retenue de {aeWithholding} à la part du cumul qui dépasse {aeThreshold}. Exemple : {exPrior} déjà facturés puis une facture de {exInvoice} donnent un cumul de {exCumul}, un surplus de {exSurplus} et une retenue de {exWithheld}. L’assiette exacte de la retenue reste à faire valider.' },
      { question: 'La comparaison avec une société est-elle complète ?', answer: 'Non. Elle compare l’IR de l’auto-entrepreneur et le prix de Fisca Solo avec le forfait Fisca Essentiel ({priceEssentiel} HT par mois) et les autres coûts que vous saisissez. Elle ne calcule ni l’impôt sur les sociétés, ni la TVA, ni les honoraires : c’est un ordre de grandeur, pas une recommandation de changer de statut.' },
    ],
    en: [
      { question: 'Which income tax rate should I choose, {aeIrLow} or {aeIrHigh}?', answer: 'Fisca’s specifications cite both rates ({aeIrLow} or {aeIrHigh}) without saying which applies to which activity, and they have not been cross-checked against an external source. The tool therefore lets you choose or enter the rate: ask your accountant or the tax authority.' },
      { question: 'What happens above {aeThreshold} invoiced to one client?', answer: 'The tool applies a {aeWithholding} withholding to the part of the client total above {aeThreshold}. Example: {exPrior} already invoiced then a {exInvoice} invoice give a total of {exCumul}, a surplus of {exSurplus} and a withholding of {exWithheld}. The exact base of the withholding remains to be validated.' },
      { question: 'Is the comparison with a company complete?', answer: 'No. It compares the auto-entrepreneur’s income tax and the Fisca Solo price with the Fisca Essentiel plan ({priceEssentiel} excl. VAT per month) and the other costs you enter. It computes neither corporate tax, nor VAT, nor fees: it is an order of magnitude, not a recommendation to change status.' },
    ],
    ar: [
      { question: 'أي نسبة ضريبة أختار، {aeIrLow} أم {aeIrHigh}؟', answer: 'تذكر مواصفات Fisca النسبتين ({aeIrLow} أو {aeIrHigh}) دون أن تحدد أيهما تخص أي نشاط، ولم يُتحقق منهما بمصدر خارجي. لذلك تترك لك الأداة الاختيار أو إدخال النسبة: اسأل خبيرك المحاسب أو الإدارة.' },
      { question: 'ماذا يحدث عند تجاوز {aeThreshold} المفوترة لزبون واحد؟', answer: 'تطبق الأداة اقتطاعا بنسبة {aeWithholding} على جزء المجموع الذي يفوق {aeThreshold}. مثال: {exPrior} مفوترة سابقا ثم فاتورة بـ {exInvoice} تعطي مجموعا قدره {exCumul} وفائضا قدره {exSurplus} واقتطاعا قدره {exWithheld}. ويبقى وعاء الاقتطاع الدقيق في حاجة إلى اعتماد.' },
      { question: 'هل المقارنة مع الشركة كاملة؟', answer: 'لا. فهي تقارن ضريبة المقاول الذاتي وثمن Fisca Solo مع باقة Fisca Essentiel ({priceEssentiel} دون احتساب الرسوم في الشهر) والتكاليف الأخرى التي تدخلها. ولا تحسب ضريبة الشركات ولا TVA ولا الأتعاب: إنها تقدير للحجم وليست توصية بتغيير الوضع القانوني.' },
    ],
    ary: [
      { question: 'أنهي نسبة ضريبة نختار، {aeIrLow} ولا {aeIrHigh}؟', answer: 'مواصفات Fisca كتذكر النسبتين ({aeIrLow} ولا {aeIrHigh}) بلا ما تقول شمن وحدة كتخص شمن نشاط، وما تحققش منهم بمصدر د برا. علاش الأداة كتخليك تختار ولا تدخل النسبة: سول الخبير المحاسب ديالك ولا الإدارة.' },
      { question: 'شنو كيوقع منين كنفوت {aeThreshold} المفوترة لكليان واحد؟', answer: 'الأداة كتطبق اقتطاع بنسبة {aeWithholding} على جزء المجموع اللي فاق {aeThreshold}. مثال: {exPrior} تفوترو قبل من بعد فاتورة د {exInvoice} كيعطيو مجموع د {exCumul} وزايد د {exSurplus} واقتطاع د {exWithheld}. ووعاء الاقتطاع الدقيق باقي خاصو يتأكد.' },
      { question: 'واش المقارنة مع الشركة كاملة؟', answer: 'لا. كتقارن ضريبة المقاول الذاتي وثمن Fisca Solo مع باقة Fisca Essentiel ({priceEssentiel} بلا الضريبة فالشهر) والتكاليف الأخرى اللي كتدخل. وما كتحسبش ضريبة الشركات ولا TVA ولا الأتعاب: هادي مجرد فكرة على الحجم ماشي نصيحة باش تبدل الوضع القانوني.' },
    ],
  },
  sections: {
    fr: [
      {
        heading: 'Règle appliquée',
        paragraphs: ['Les valeurs numériques viennent de données datées ou de votre saisie, jamais d’un fait permanent du code ; tous les calculs se font en centimes et points de base entiers.'],
        bullets: [
          'IR du trimestre = chiffre d’affaires du trimestre x taux, arrondi au centime (demi supérieur).',
          'Cumul après facture = cumul déjà facturé au client + nouvelle facture.',
          'Surplus = part de la nouvelle facture qui dépasse {aeThreshold} (toute la facture si le cumul le dépassait déjà) ; retenue = surplus x {aeWithholding}.',
          'Comparaison = IR annualisé (quatre trimestres identiques) + Fisca Solo annuel, face à Fisca Essentiel annuel + vos autres coûts de société.',
          'Les prix Fisca sont ceux de la grille tarifaire publique, hors taxes.',
        ],
      },
      {
        heading: 'Limites et points à valider',
        paragraphs: [
          'Les taux d’IR, le seuil de {aeThreshold} et la retenue de {aeWithholding} ne sont pas recoupés avec une source externe : faites valider notamment l’assiette exacte de la retenue et le taux de votre activité par un expert-comptable.',
          'L’outil ne contrôle pas le plafond annuel de chiffre d’affaires du régime, ne calcule pas l’impôt ni la TVA d’une société et ne tient pas compte de vos charges sociales : le résultat est une estimation, pas une décision de changer de statut.',
        ],
      },
    ],
    en: [
      {
        heading: 'Rule applied',
        paragraphs: ['Numeric values come from dated data or from your input, never from a permanent fact in the code; every calculation is done in whole cents and basis points.'],
        bullets: [
          'Quarter income tax = quarter revenue x rate, rounded to the cent (half-up).',
          'Total after invoice = total already invoiced to the client + new invoice.',
          'Surplus = part of the new invoice above {aeThreshold} (the whole invoice if the total was already above it); withholding = surplus x {aeWithholding}.',
          'Comparison = annualised income tax (four identical quarters) + annual Fisca Solo, against annual Fisca Essentiel + your other company costs.',
          'Fisca prices are those of the public price list, excluding taxes.',
        ],
      },
      {
        heading: 'Limits and points to validate',
        paragraphs: [
          'The income tax rates, the {aeThreshold} threshold and the {aeWithholding} withholding have not been cross-checked against an external source: have an accountant validate in particular the exact base of the withholding and the rate for your activity.',
          'The tool does not check the regime’s annual revenue ceiling, does not compute a company’s tax or VAT and ignores your social contributions: the result is an estimate, not a decision to change status.',
        ],
      },
    ],
    ar: [
      {
        heading: 'القاعدة المطبقة',
        paragraphs: ['القيم العددية مأخوذة من معطيات مؤرخة أو من إدخالك، وليست حقيقة دائمة في الشيفرة؛ وتتم كل الحسابات بالسنتيمات ونقاط الأساس الصحيحة.'],
        bullets: [
          'ضريبة الفصل = رقم معاملات الفصل × النسبة، مقربة إلى السنتيم (النصف إلى الأعلى).',
          'المجموع بعد الفاتورة = المجموع المفوتر سابقا للزبون + الفاتورة الجديدة.',
          'الفائض = جزء الفاتورة الجديدة الذي يفوق {aeThreshold} (الفاتورة كلها إذا كان المجموع يفوقه من قبل)؛ الاقتطاع = الفائض × {aeWithholding}.',
          'المقارنة = الضريبة السنوية المحسوبة (أربعة فصول متماثلة) + Fisca Solo السنوية، مقابل Fisca Essentiel السنوية + تكاليف شركتك الأخرى.',
          'أسعار Fisca هي أسعار لائحة الأثمنة العمومية دون احتساب الرسوم.',
        ],
      },
      {
        heading: 'الحدود ونقاط التحقق',
        paragraphs: [
          'لم يُتحقق من نسب الضريبة ولا من عتبة {aeThreshold} ولا من اقتطاع {aeWithholding} بمصدر خارجي: اعرض على خبير محاسب خصوصا وعاء الاقتطاع الدقيق ونسبة نشاطك.',
          'لا تراقب الأداة سقف رقم المعاملات السنوي للنظام، ولا تحسب ضريبة الشركة ولا TVA، ولا تأخذ بعين الاعتبار اشتراكاتك الاجتماعية: النتيجة تقدير وليست قرارا بتغيير الوضع القانوني.',
        ],
      },
    ],
    ary: [
      {
        heading: 'القاعدة المطبقة',
        paragraphs: ['القيم العددية جايين من معطيات مؤرخة ولا من اللي كتدخل نتا، ماشي حقيقة دايمة فالكود؛ وكل الحسابات كتدار بالسنتيمات ونقاط الأساس الصحاح.'],
        bullets: [
          'ضريبة الفصل = رقم معاملات الفصل × النسبة، مقربة للسنتيم (النص للأعلى).',
          'المجموع من بعد الفاتورة = المجموع اللي تفوتر قبل للكليان + الفاتورة الجديدة.',
          'الزايد = جزء الفاتورة الجديدة اللي فاق {aeThreshold} (الفاتورة كاملة إلا كان المجموع فايتو من قبل)؛ الاقتطاع = الزايد × {aeWithholding}.',
          'المقارنة = الضريبة السنوية المحسوبة (4 فصول بحال بحال) + Fisca Solo فالعام، قدام Fisca Essentiel فالعام + التكاليف الأخرى د الشركة ديالك.',
          'أثمنة Fisca هي أثمنة اللائحة العمومية بلا الضريبة.',
        ],
      },
      {
        heading: 'الحدود ونقط خاصها تتحقق',
        paragraphs: [
          'نسب الضريبة وعتبة {aeThreshold} واقتطاع {aeWithholding} ما تحققش منهم بمصدر د برا: خلي خبير محاسب يأكد خصوصا وعاء الاقتطاع الدقيق ونسبة النشاط ديالك.',
          'الأداة ما كتراقبش سقف رقم المعاملات السنوي د النظام، وما كتحسبش ضريبة الشركة ولا TVA، وما كتدخلش فالحساب الاشتراكات الاجتماعية: النتيجة تقدير ماشي قرار باش تبدل الوضع القانوني.',
        ],
      },
    ],
  },
};

export interface AeUiCopy {
  readonly irHeading: string;
  readonly thrHeading: string;
  readonly revenueLabel: string;
  readonly revenueHint: string;
  readonly rateLabel: string;
  readonly rateOption: string;
  readonly rateCustomOption: string;
  readonly customRateLabel: string;
  readonly customRateHint: string;
  readonly costsLabel: string;
  readonly costsHint: string;
  readonly irSubmit: string;
  readonly quarterIr: string;
  readonly annualIr: string;
  readonly soloAnnual: string;
  readonly aeTotal: string;
  readonly essentielAnnual: string;
  readonly otherCosts: string;
  readonly companyTotal: string;
  readonly difference: string;
  readonly differenceMore: string;
  readonly differenceLess: string;
  readonly differenceNote: string;
  readonly priceSource: string;
  readonly priorLabel: string;
  readonly priorHint: string;
  readonly invoiceLabel: string;
  readonly thrSubmit: string;
  readonly cumulAfter: string;
  readonly headroom: string;
  readonly surplus: string;
  readonly withheld: string;
  readonly net: string;
  readonly alertOver: string;
  readonly okUnder: string;
  readonly rulesUsed: string;
  readonly errRevenue: string;
  readonly errRate: string;
  readonly errCosts: string;
  readonly errPrior: string;
  readonly errInvoice: string;
}

const FR: AeUiCopy = {
  irHeading: 'IR trimestriel et comparaison avec une société',
  thrHeading: 'Seuil par client et retenue',
  revenueLabel: 'Chiffre d’affaires encaissé sur le trimestre (MAD)',
  revenueHint: 'Exemple : 50 000,00',
  rateLabel: 'Taux d’IR',
  rateOption: '{value} : taux daté ({state}, {date})',
  rateCustomOption: 'Autre taux, saisi par moi',
  customRateLabel: 'Taux saisi (%)',
  customRateHint: 'Utilisé seulement si « Autre taux » est choisi. Valeur saisie par vous : état NON RECOUPÉ.',
  costsLabel: 'Autres coûts annuels de la société, HT (MAD)',
  costsHint: 'Honoraires, frais, etc. : saisis par vous, jamais calculés. Laissez vide pour zéro.',
  irSubmit: 'Calculer et comparer',
  quarterIr: 'IR du trimestre',
  annualIr: 'IR annuel indicatif (quatre trimestres identiques)',
  soloAnnual: 'Fisca Solo, annuel HT',
  aeTotal: 'Total annuel auto-entrepreneur',
  essentielAnnual: 'Fisca Essentiel, annuel HT',
  otherCosts: 'Autres coûts de société saisis',
  companyTotal: 'Total annuel société (hors impôt de la société)',
  difference: 'Écart annuel indicatif société - auto-entrepreneur',
  differenceMore: 'La société coûterait {amount} de plus par an, hors impôt de la société.',
  differenceLess: 'La société coûterait {amount} de moins par an, hors impôt de la société.',
  differenceNote: 'L’impôt de la société, la TVA et les honoraires ne sont pas calculés : ordre de grandeur uniquement.',
  priceSource: 'Prix HT de la grille tarifaire publique (page Tarifs).',
  priorLabel: 'Cumul déjà facturé à ce client depuis le début de l’année (MAD)',
  priorHint: 'Exemple : 75 000,00 ; zéro si première facture.',
  invoiceLabel: 'Nouvelle facture à ce client (MAD)',
  thrSubmit: 'Contrôler le seuil',
  cumulAfter: 'Cumul après cette facture',
  headroom: 'Marge restante avant le seuil',
  surplus: 'Surplus au-delà du seuil (base de la retenue)',
  withheld: 'Retenue',
  net: 'Net encaissé sur cette facture',
  alertOver: 'Alerte : le cumul dépasse {threshold} pour ce client. Une retenue de {rate} s’applique au surplus.',
  okUnder: 'Le cumul reste au plus égal à {threshold} : aucune retenue.',
  rulesUsed: 'Règle utilisée pour ce résultat',
  errRevenue: 'Saisissez un chiffre d’affaires valide, supérieur à zéro, avec au plus deux décimales.',
  errRate: 'Saisissez un taux valide en pourcentage, entre 0 et 100, avec au plus deux décimales.',
  errCosts: 'Saisissez des coûts valides, positifs ou nuls, avec au plus deux décimales.',
  errPrior: 'Saisissez un cumul valide, positif ou nul, avec au plus deux décimales.',
  errInvoice: 'Saisissez un montant de facture valide, supérieur à zéro, avec au plus deux décimales.',
};

const EN: AeUiCopy = {
  irHeading: 'Quarterly income tax and comparison with a company',
  thrHeading: 'Per-client threshold and withholding',
  revenueLabel: 'Revenue collected over the quarter (MAD)',
  revenueHint: 'Example: 50,000.00',
  rateLabel: 'Income tax rate',
  rateOption: '{value}: dated rate ({state}, {date})',
  rateCustomOption: 'Other rate, entered by me',
  customRateLabel: 'Rate entered (%)',
  customRateHint: 'Used only if “Other rate” is chosen. Value entered by you: state NON RECOUPÉ (not cross-checked).',
  costsLabel: 'Other annual company costs, excl. VAT (MAD)',
  costsHint: 'Fees, expenses, etc.: entered by you, never computed. Leave empty for zero.',
  irSubmit: 'Compute and compare',
  quarterIr: 'Quarter income tax',
  annualIr: 'Indicative annual income tax (four identical quarters)',
  soloAnnual: 'Fisca Solo, annual excl. VAT',
  aeTotal: 'Annual total as auto-entrepreneur',
  essentielAnnual: 'Fisca Essentiel, annual excl. VAT',
  otherCosts: 'Other company costs entered',
  companyTotal: 'Annual total as a company (before the company’s tax)',
  difference: 'Indicative annual gap company - auto-entrepreneur',
  differenceMore: 'The company would cost {amount} more per year, before the company’s tax.',
  differenceLess: 'The company would cost {amount} less per year, before the company’s tax.',
  differenceNote: 'The company’s tax, VAT and fees are not computed: order of magnitude only.',
  priceSource: 'Prices excl. VAT from the public price list (Pricing page).',
  priorLabel: 'Total already invoiced to this client since the start of the year (MAD)',
  priorHint: 'Example: 75,000.00; zero if first invoice.',
  invoiceLabel: 'New invoice to this client (MAD)',
  thrSubmit: 'Check the threshold',
  cumulAfter: 'Total after this invoice',
  headroom: 'Room left before the threshold',
  surplus: 'Surplus above the threshold (withholding base)',
  withheld: 'Withholding',
  net: 'Net collected on this invoice',
  alertOver: 'Alert: the total exceeds {threshold} for this client. A {rate} withholding applies to the surplus.',
  okUnder: 'The total stays at or below {threshold}: no withholding.',
  rulesUsed: 'Rule used for this result',
  errRevenue: 'Enter a valid revenue, above zero, with at most two decimals.',
  errRate: 'Enter a valid percentage rate between 0 and 100 with at most two decimals.',
  errCosts: 'Enter valid costs, zero or more, with at most two decimals.',
  errPrior: 'Enter a valid total, zero or more, with at most two decimals.',
  errInvoice: 'Enter a valid invoice amount, above zero, with at most two decimals.',
};

const AR: AeUiCopy = {
  irHeading: 'الضريبة الفصلية والمقارنة مع شركة',
  thrHeading: 'العتبة لكل زبون والاقتطاع',
  revenueLabel: 'رقم المعاملات المحصَّل خلال الفصل (درهم)',
  revenueHint: 'مثال: 50000,00',
  rateLabel: 'نسبة الضريبة',
  rateOption: '{value}: نسبة مؤرخة ({state}، {date})',
  rateCustomOption: 'نسبة أخرى أدخلها أنا',
  customRateLabel: 'النسبة المدخلة (%)',
  customRateHint: 'لا تُستعمل إلا عند اختيار «نسبة أخرى». قيمة أدخلتها أنت: الحالة NON RECOUPÉ (لم يُتحقق منها).',
  costsLabel: 'تكاليف سنوية أخرى للشركة دون الرسوم (درهم)',
  costsHint: 'أتعاب ومصاريف وغيرها: تدخلها أنت ولا تُحسب أبدا. اتركها فارغة للصفر.',
  irSubmit: 'احسب وقارن',
  quarterIr: 'ضريبة الفصل',
  annualIr: 'الضريبة السنوية التقريبية (أربعة فصول متماثلة)',
  soloAnnual: 'Fisca Solo، سنوي دون الرسوم',
  aeTotal: 'المجموع السنوي كمقاول ذاتي',
  essentielAnnual: 'Fisca Essentiel، سنوي دون الرسوم',
  otherCosts: 'تكاليف الشركة الأخرى المدخلة',
  companyTotal: 'المجموع السنوي كشركة (قبل ضريبة الشركة)',
  difference: 'الفارق السنوي التقريبي شركة - مقاول ذاتي',
  differenceMore: 'ستكلف الشركة {amount} أكثر في السنة قبل ضريبة الشركة.',
  differenceLess: 'ستكلف الشركة {amount} أقل في السنة قبل ضريبة الشركة.',
  differenceNote: 'لا تُحسب ضريبة الشركة ولا TVA ولا الأتعاب: تقدير للحجم فقط.',
  priceSource: 'أسعار دون الرسوم من لائحة الأثمنة العمومية (صفحة الأسعار).',
  priorLabel: 'المجموع المفوتر سابقا لهذا الزبون منذ بداية السنة (درهم)',
  priorHint: 'مثال: 75000,00؛ صفر إذا كانت الفاتورة الأولى.',
  invoiceLabel: 'الفاتورة الجديدة لهذا الزبون (درهم)',
  thrSubmit: 'راقب العتبة',
  cumulAfter: 'المجموع بعد هذه الفاتورة',
  headroom: 'الهامش المتبقي قبل العتبة',
  surplus: 'الفائض فوق العتبة (وعاء الاقتطاع)',
  withheld: 'الاقتطاع',
  net: 'الصافي المحصَّل من هذه الفاتورة',
  alertOver: 'تنبيه: المجموع يفوق {threshold} لهذا الزبون. ويُطبق اقتطاع {rate} على الفائض.',
  okUnder: 'يبقى المجموع في حدود {threshold} أو أقل: لا اقتطاع.',
  rulesUsed: 'القاعدة المستعملة لهذه النتيجة',
  errRevenue: 'أدخل رقم معاملات صالحا أكبر من الصفر بعشريتين على الأكثر.',
  errRate: 'أدخل نسبة مئوية صالحة بين 0 و100 بعشريتين على الأكثر.',
  errCosts: 'أدخل تكاليف صالحة، صفرا أو أكثر، بعشريتين على الأكثر.',
  errPrior: 'أدخل مجموعا صالحا، صفرا أو أكثر، بعشريتين على الأكثر.',
  errInvoice: 'أدخل مبلغ فاتورة صالحا أكبر من الصفر بعشريتين على الأكثر.',
};

const ARY: AeUiCopy = {
  irHeading: 'ضريبة الفصل والمقارنة مع شركة',
  thrHeading: 'العتبة على كل كليان والاقتطاع',
  revenueLabel: 'رقم المعاملات اللي تحصل فالفصل (درهم)',
  revenueHint: 'مثال: 50000,00',
  rateLabel: 'نسبة الضريبة',
  rateOption: '{value}: نسبة مؤرخة ({state}، {date})',
  rateCustomOption: 'نسبة أخرى كندخلها أنا',
  customRateLabel: 'النسبة المدخلة (%)',
  customRateHint: 'كتستعمل غير إلا ختاريتي «نسبة أخرى». قيمة دخلتيها نتا: الحالة NON RECOUPÉ (ما تحققش منها).',
  costsLabel: 'تكاليف أخرى د الشركة فالعام بلا الضريبة (درهم)',
  costsHint: 'أتعاب ومصاريف وغيرها: كتدخلها نتا وما كتتحسبش أبدا. خليها خاوية للصفر.',
  irSubmit: 'حسب وقارن',
  quarterIr: 'ضريبة الفصل',
  annualIr: 'الضريبة السنوية التقريبية (4 فصول بحال بحال)',
  soloAnnual: 'Fisca Solo، فالعام بلا الضريبة',
  aeTotal: 'المجموع السنوي كمقاول ذاتي',
  essentielAnnual: 'Fisca Essentiel، فالعام بلا الضريبة',
  otherCosts: 'تكاليف الشركة الأخرى المدخلة',
  companyTotal: 'المجموع السنوي كشركة (قبل ضريبة الشركة)',
  difference: 'الفرق السنوي التقريبي شركة - مقاول ذاتي',
  differenceMore: 'الشركة غادي تكلف {amount} أكثر فالعام قبل ضريبة الشركة.',
  differenceLess: 'الشركة غادي تكلف {amount} أقل فالعام قبل ضريبة الشركة.',
  differenceNote: 'ضريبة الشركة وTVA والأتعاب ما كيتحسبوش: غير فكرة على الحجم.',
  priceSource: 'أثمنة بلا الضريبة من اللائحة العمومية (صفحة الأسعار).',
  priorLabel: 'المجموع اللي تفوتر قبل لهاد الكليان من بداية العام (درهم)',
  priorHint: 'مثال: 75000,00؛ صفر إلا كانت أول فاتورة.',
  invoiceLabel: 'الفاتورة الجديدة لهاد الكليان (درهم)',
  thrSubmit: 'راقب العتبة',
  cumulAfter: 'المجموع من بعد هاد الفاتورة',
  headroom: 'الهامش اللي بقا قبل العتبة',
  surplus: 'الزايد فوق العتبة (وعاء الاقتطاع)',
  withheld: 'الاقتطاع',
  net: 'الصافي اللي تحصل من هاد الفاتورة',
  alertOver: 'تنبيه: المجموع فاق {threshold} لهاد الكليان. واقتطاع {rate} كيتطبق على الزايد.',
  okUnder: 'المجموع باقي فحدود {threshold} ولا أقل: ما كاين حتى اقتطاع.',
  rulesUsed: 'القاعدة المستعملة فهاد النتيجة',
  errRevenue: 'دخل رقم معاملات صالح كبر من الصفر وبجوج د الأرقام العشرية على الأكثر.',
  errRate: 'دخل نسبة مئوية صالحة بين 0 و100 وبجوج د الأرقام العشرية على الأكثر.',
  errCosts: 'دخل تكاليف صالحة، صفر ولا أكثر، وبجوج د الأرقام العشرية على الأكثر.',
  errPrior: 'دخل مجموع صالح، صفر ولا أكثر، وبجوج د الأرقام العشرية على الأكثر.',
  errInvoice: 'دخل مبلغ فاتورة صالح كبر من الصفر وبجوج د الأرقام العشرية على الأكثر.',
};

export const AE_UI: L4<AeUiCopy> = { fr: FR, en: EN, ar: AR, ary: ARY };
