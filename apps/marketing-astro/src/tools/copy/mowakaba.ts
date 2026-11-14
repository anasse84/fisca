import type { L4 } from '../../content/silos/types.ts';
import type { ToolPageCopy } from './page-types.ts';
import { t } from './common.ts';

export const MOWAKABA_PAGE: ToolPageCopy = {
  title: t(
    'Estimateur de subvention Mowakaba : éligibilité et reste à charge',
    'Mowakaba subsidy estimator: eligibility and remaining cost',
    'مقدّر دعم مواكبة: الأهلية والمبلغ المتبقي على عاتقك',
    'مقدر دعم مواكبة: الأهلية والمبلغ اللي كيبقى عليك',
  ),
  description: t(
    'Estimez en 30 secondes votre éligibilité (chiffre d’affaires jusqu’à {mowCeiling} HT) et le reste à charge d’un pack Fisca selon la fourchette de prise en charge : Pack TPME entre {tpmeFrom} et {tpmeTo} HT, Pack Fiduciaire entre {cabFrom} et {cabTo} HT, en centimes entiers.',
    'Estimate in 30 seconds your eligibility (revenue up to {mowCeiling} excl. VAT) and the remaining cost of a Fisca pack across the coverage range: SME Pack between {tpmeFrom} and {tpmeTo} excl. VAT, Accounting-firm Pack between {cabFrom} and {cabTo} excl. VAT, in whole cents.',
    'قدّر في 30 ثانية أهليتك (رقم معاملات يصل إلى {mowCeiling} دون الرسوم) والمبلغ المتبقي على عاتقك لباقة Fisca حسب مجال التكفل: باقة TPME بين {tpmeFrom} و{tpmeTo} دون الرسوم، وباقة المكاتب المحاسبية بين {cabFrom} و{cabTo} دون الرسوم، بالسنتيمات الصحيحة.',
    'قدر فـ 30 ثانية الأهلية ديالك (رقم معاملات حتى {mowCeiling} بلا الضريبة) والمبلغ اللي كيبقى عليك فباقة Fisca حسب مجال التكفل: باقة TPME بين {tpmeFrom} و{tpmeTo} بلا الضريبة، وباقة المكاتب المحاسبية بين {cabFrom} و{cabTo} بلا الضريبة، بالسنتيمات الصحاح.',
  ),
  heading: t(
    'Estimateur de subvention Mowakaba',
    'Mowakaba subsidy estimator',
    'مقدّر دعم مواكبة',
    'مقدر دعم مواكبة',
  ),
  lead: t(
    'Indiquez votre chiffre d’affaires annuel hors taxes et le pack visé : l’outil vérifie le plafond d’éligibilité, puis chiffre la subvention et le reste à charge à chaque extrémité de la fourchette de prise en charge. C’est une estimation : l’octroi relève de l’organisme gestionnaire, pas de Fisca ni de cet outil.',
    'Enter your annual revenue excluding VAT and the pack you are after: the tool checks the eligibility ceiling, then computes the subsidy and the remaining cost at each end of the coverage range. This is an estimate: the grant is decided by the managing body, not by Fisca or this tool.',
    'أدخل رقم معاملاتك السنوي دون الرسوم والباقة المقصودة: تتحقق الأداة من سقف الأهلية، ثم تحسب الدعم والمبلغ المتبقي عند طرفي مجال التكفل. هذا تقدير فقط: منح الدعم من اختصاص الهيئة المسيرة وليس من اختصاص Fisca ولا هذه الأداة.',
    'دخل رقم المعاملات السنوي ديالك بلا الضريبة والباقة اللي بغيتي: الأداة كتتحقق من سقف الأهلية، من بعد كتحسب الدعم والمبلغ اللي كيبقى عليك فطرفي مجال التكفل. هادا غير تقدير: منح الدعم كيرجع للهيئة المسيرة ماشي لـ Fisca ولا لهاد الأداة.',
  ),
  summary: t(
    'Éligible si le chiffre d’affaires annuel est au plus égal à {mowCeiling} HT ; subvention = prix du pack x taux de prise en charge ({mowLow} à {mowHigh}) ; reste à charge = prix - subvention, en centimes entiers.',
    'Eligible if annual revenue is at most {mowCeiling} excl. VAT; subsidy = pack price x coverage rate ({mowLow} to {mowHigh}); remaining cost = price - subsidy, in whole cents.',
    'مؤهل إذا كان رقم المعاملات السنوي لا يتجاوز {mowCeiling} دون الرسوم؛ الدعم = ثمن الباقة × نسبة التكفل ({mowLow} إلى {mowHigh})؛ المتبقي = الثمن - الدعم، بالسنتيمات الصحيحة.',
    'مؤهل إلا كان رقم المعاملات السنوي ما كيفوتش {mowCeiling} بلا الضريبة؛ الدعم = ثمن الباقة × نسبة التكفل ({mowLow} حتى {mowHigh})؛ المتبقي = الثمن - الدعم، بالسنتيمات الصحاح.',
  ),
  steps: {
    fr: [
      { name: 'Saisir le chiffre d’affaires', text: 'Indiquez le chiffre d’affaires annuel hors taxes de l’entreprise, en dirhams.' },
      { name: 'Renseigner la détention', text: 'Si une entreprise ou un groupe détient votre capital, indiquez sa part : au-delà de {mowOwnership}, l’entreprise relève des contrats annuels et non de Mowakaba. Champ facultatif.' },
      { name: 'Choisir le pack', text: 'Choisissez le Pack TPME ({packTpme} HT) ou le Pack Fiduciaire ({packCabinet} HT) : les prix sont ceux de la grille tarifaire publique.' },
      { name: 'Lire la fourchette', text: 'Relevez l’éligibilité, la subvention et le reste à charge à {mowLow} et à {mowHigh} de prise en charge, avec la date et l’état de recoupement de chaque règle.' },
    ],
    en: [
      { name: 'Enter the revenue', text: 'Give the company’s annual revenue excluding VAT, in dirhams.' },
      { name: 'Give the ownership', text: 'If a company or group holds your capital, give its share: above {mowOwnership}, the company falls under annual contracts rather than Mowakaba. Optional field.' },
      { name: 'Choose the pack', text: 'Choose the SME Pack ({packTpme} excl. VAT) or the Accounting-firm Pack ({packCabinet} excl. VAT): prices are those of the public price list.' },
      { name: 'Read the range', text: 'Note the eligibility, the subsidy and the remaining cost at {mowLow} and at {mowHigh} coverage, with the date and cross-check state of each rule.' },
    ],
    ar: [
      { name: 'إدخال رقم المعاملات', text: 'أدخل رقم المعاملات السنوي للمقاولة دون الرسوم بالدرهم.' },
      { name: 'تحديد نسبة الملكية', text: 'إذا كانت شركة أو مجموعة تملك رأسمالك فأدخل حصتها: فوق {mowOwnership} تدخل المقاولة ضمن العقود السنوية لا ضمن مواكبة. حقل اختياري.' },
      { name: 'اختيار الباقة', text: 'اختر باقة TPME ({packTpme} دون الرسوم) أو باقة المكاتب المحاسبية ({packCabinet} دون الرسوم): الأثمنة هي أثمنة لائحة الأسعار العمومية.' },
      { name: 'قراءة المجال', text: 'دوّن الأهلية والدعم والمبلغ المتبقي عند تكفل {mowLow} وعند {mowHigh}، مع تاريخ كل قاعدة وحالة التحقق منها.' },
    ],
    ary: [
      { name: 'دخل رقم المعاملات', text: 'دخل رقم المعاملات السنوي د المقاولة بلا الضريبة بالدرهم.' },
      { name: 'حدد نسبة الملكية', text: 'إلا كانت شركة ولا مجموعة مالكة الرأسمال ديالك دخل الحصة ديالها: فوق {mowOwnership} المقاولة كتدخل فالعقود السنوية ماشي فمواكبة. حقل اختياري.' },
      { name: 'ختار الباقة', text: 'ختار باقة TPME ({packTpme} بلا الضريبة) ولا باقة المكاتب المحاسبية ({packCabinet} بلا الضريبة): الأثمنة هي أثمنة اللائحة العمومية.' },
      { name: 'قرا المجال', text: 'سجل الأهلية والدعم والمبلغ اللي كيبقى عليك عند تكفل {mowLow} وعند {mowHigh}، مع تاريخ كل قاعدة وحالة التحقق منها.' },
    ],
  },
  faqs: {
    fr: [
      { question: 'Qui est éligible à Mowakaba selon cet outil ?', answer: 'L’outil retient un chiffre d’affaires annuel au plus égal à {mowCeiling} hors taxes, et, si vous la renseignez, une détention par un grand groupe d’au plus {mowOwnership}. Ces critères viennent des spécifications de Fisca et n’ont pas été recoupés avec l’organisme gestionnaire : l’éligibilité réelle se vérifie auprès de lui.' },
      { question: 'Combien me reste-t-il à payer pour le Pack TPME ?', answer: 'Le Pack TPME coûte {packTpme} HT. Avec une prise en charge de {mowLow} à {mowHigh}, le reste à charge se situe entre {tpmeFrom} et {tpmeTo} HT. Le Pack Fiduciaire ({packCabinet} HT) revient entre {cabFrom} et {cabTo} HT. Les taux de prise en charge n’ont pas été recoupés : ils sont datés et affichés avec leur état.' },
      { question: 'Cette estimation vaut-elle promesse de subvention ?', answer: 'Non. L’outil calcule un ordre de grandeur à partir de règles datées ; il n’instruit aucun dossier, n’envoie rien à un organisme et ne garantit ni l’octroi ni le taux obtenu. Les montants sont hors taxes, en centimes entiers.' },
    ],
    en: [
      { question: 'Who is eligible for Mowakaba according to this tool?', answer: 'The tool takes annual revenue of at most {mowCeiling} excluding VAT and, if you give it, ownership by a large group of at most {mowOwnership}. These criteria come from Fisca’s specifications and have not been cross-checked with the managing body: real eligibility must be verified with it.' },
      { question: 'How much do I still pay for the SME Pack?', answer: 'The SME Pack costs {packTpme} excl. VAT. With {mowLow} to {mowHigh} covered, the remaining cost is between {tpmeFrom} and {tpmeTo} excl. VAT. The Accounting-firm Pack ({packCabinet} excl. VAT) comes to between {cabFrom} and {cabTo} excl. VAT. The coverage rates have not been cross-checked: they are dated and shown with their state.' },
      { question: 'Does this estimate promise a subsidy?', answer: 'No. The tool computes an order of magnitude from dated rules; it handles no application, sends nothing to any body and guarantees neither the grant nor the rate obtained. Amounts are excluding VAT, in whole cents.' },
    ],
    ar: [
      { question: 'من المؤهل لمواكبة حسب هذه الأداة؟', answer: 'تعتمد الأداة رقم معاملات سنوي لا يتجاوز {mowCeiling} دون الرسوم، وإذا أدخلتها، ملكية مجموعة كبرى لا تتجاوز {mowOwnership}. هذه المعايير مأخوذة من مواصفات Fisca ولم يُتحقق منها لدى الهيئة المسيرة: الأهلية الفعلية تُتحقق منها لديها.' },
      { question: 'كم يبقى علي أداؤه لباقة TPME؟', answer: 'تكلف باقة TPME مبلغ {packTpme} دون الرسوم. وبتكفل من {mowLow} إلى {mowHigh} يتراوح المتبقي بين {tpmeFrom} و{tpmeTo} دون الرسوم. أما باقة المكاتب المحاسبية ({packCabinet} دون الرسوم) فيتراوح المتبقي فيها بين {cabFrom} و{cabTo} دون الرسوم. لم يُتحقق من نسب التكفل: هي مؤرخة وتُعرض مع حالتها.' },
      { question: 'هل يعد هذا التقدير بمنح الدعم؟', answer: 'لا. تحسب الأداة تقديرا للحجم انطلاقا من قواعد مؤرخة؛ ولا تدرس أي ملف ولا ترسل شيئا إلى أي هيئة ولا تضمن منح الدعم ولا النسبة المحصَّل عليها. المبالغ دون الرسوم بالسنتيمات الصحيحة.' },
    ],
    ary: [
      { question: 'شكون مؤهل لمواكبة بهاد الأداة؟', answer: 'الأداة كتعتمد رقم معاملات سنوي ما كيفوتش {mowCeiling} بلا الضريبة، وإلا دخلتيها، ملكية د مجموعة كبيرة ما كتفوتش {mowOwnership}. هاد المعايير جايين من مواصفات Fisca وما تحققش منهم عند الهيئة المسيرة: الأهلية الحقيقية كتتحقق عندها.' },
      { question: 'شحال كيبقى ليا نخلص فباقة TPME؟', answer: 'باقة TPME كتكلف {packTpme} بلا الضريبة. وبتكفل من {mowLow} حتى {mowHigh} المتبقي كيكون بين {tpmeFrom} و{tpmeTo} بلا الضريبة. وباقة المكاتب المحاسبية ({packCabinet} بلا الضريبة) المتبقي فيها بين {cabFrom} و{cabTo} بلا الضريبة. نسب التكفل ما تحققش منها: هي مؤرخة وكتبان مع الحالة ديالها.' },
      { question: 'واش هاد التقدير وعد بالدعم؟', answer: 'لا. الأداة كتحسب فكرة على الحجم من قواعد مؤرخة؛ وما كتدرس حتى ملف وما كتصيفط والو لأي هيئة وما كتضمنش لا منح الدعم ولا النسبة اللي غادي تحصل. المبالغ بلا الضريبة بالسنتيمات الصحاح.' },
    ],
  },
  sections: {
    fr: [
      {
        heading: 'Règle appliquée',
        paragraphs: ['Les valeurs numériques viennent de données datées et de la grille tarifaire publique, jamais d’un fait permanent du code ; tous les calculs se font en centimes et points de base entiers.'],
        bullets: [
          'Éligibilité : chiffre d’affaires annuel HT au plus égal à {mowCeiling} (borne incluse) et, si renseignée, détention par un grand groupe au plus égale à {mowOwnership}.',
          'Subvention = prix HT du pack x taux de prise en charge, arrondie au centime (demi supérieur).',
          'Reste à charge = prix HT du pack - subvention.',
          'Fourchette de prise en charge : de {mowLow} à {mowHigh} ; vous pouvez aussi saisir un taux dans cette fourchette.',
          'Hors taxes : aucun taux de TVA n’est appliqué.',
        ],
      },
      {
        heading: 'Limites et points à valider',
        paragraphs: [
          'Le plafond de chiffre d’affaires, le seuil de détention et la fourchette de prise en charge ne sont pas recoupés avec l’organisme gestionnaire : confirmez l’éligibilité, le taux et les conditions auprès de lui avant toute décision.',
          'L’outil ne dépose aucune demande, ne conserve aucune donnée et ne tient pas compte des autres conditions éventuelles du dispositif : le résultat est une estimation, pas une promesse de subvention.',
        ],
      },
    ],
    en: [
      {
        heading: 'Rule applied',
        paragraphs: ['Numeric values come from dated data and from the public price list, never from a permanent fact in the code; every calculation is done in whole cents and basis points.'],
        bullets: [
          'Eligibility: annual revenue excl. VAT of at most {mowCeiling} (limit included) and, if given, ownership by a large group of at most {mowOwnership}.',
          'Subsidy = pack price excl. VAT x coverage rate, rounded to the cent (half-up).',
          'Remaining cost = pack price excl. VAT - subsidy.',
          'Coverage range: {mowLow} to {mowHigh}; you can also enter a rate within this range.',
          'Excluding VAT: no VAT rate is applied.',
        ],
      },
      {
        heading: 'Limits and points to validate',
        paragraphs: [
          'The revenue ceiling, the ownership threshold and the coverage range have not been cross-checked with the managing body: confirm eligibility, the rate and the conditions with it before any decision.',
          'The tool files no application, keeps no data and ignores any other conditions of the scheme: the result is an estimate, not a promise of subsidy.',
        ],
      },
    ],
    ar: [
      {
        heading: 'القاعدة المطبقة',
        paragraphs: ['القيم العددية مأخوذة من معطيات مؤرخة ومن لائحة الأسعار العمومية، وليست حقيقة دائمة في الشيفرة؛ وتتم كل الحسابات بالسنتيمات ونقاط الأساس الصحيحة.'],
        bullets: [
          'الأهلية: رقم معاملات سنوي دون الرسوم لا يتجاوز {mowCeiling} (الحد مشمول)، وإذا أُدخلت، ملكية مجموعة كبرى لا تتجاوز {mowOwnership}.',
          'الدعم = ثمن الباقة دون الرسوم × نسبة التكفل، مقربا إلى السنتيم (النصف إلى الأعلى).',
          'المتبقي على عاتقك = ثمن الباقة دون الرسوم - الدعم.',
          'مجال التكفل: من {mowLow} إلى {mowHigh}؛ ويمكنك أيضا إدخال نسبة ضمن هذا المجال.',
          'دون الرسوم: لا تُطبق أي نسبة TVA.',
        ],
      },
      {
        heading: 'الحدود ونقاط التحقق',
        paragraphs: [
          'لم يُتحقق من سقف رقم المعاملات ولا من عتبة الملكية ولا من مجال التكفل لدى الهيئة المسيرة: أكد الأهلية والنسبة والشروط لديها قبل أي قرار.',
          'لا تودع الأداة أي طلب ولا تحتفظ بأي معطى ولا تأخذ بعين الاعتبار الشروط الأخرى المحتملة للمنظومة: النتيجة تقدير وليست وعدا بالدعم.',
        ],
      },
    ],
    ary: [
      {
        heading: 'القاعدة المطبقة',
        paragraphs: ['القيم العددية جايين من معطيات مؤرخة ومن اللائحة العمومية د الأثمنة، ماشي حقيقة دايمة فالكود؛ وكل الحسابات كتدار بالسنتيمات ونقاط الأساس الصحاح.'],
        bullets: [
          'الأهلية: رقم معاملات سنوي بلا الضريبة ما كيفوتش {mowCeiling} (الحد داخل)، وإلا دخلتي الملكية، مجموعة كبيرة ما كتفوتش {mowOwnership}.',
          'الدعم = ثمن الباقة بلا الضريبة × نسبة التكفل، مقرب للسنتيم (النص للأعلى).',
          'اللي كيبقى عليك = ثمن الباقة بلا الضريبة - الدعم.',
          'مجال التكفل: من {mowLow} حتى {mowHigh}؛ وتقدر تدخل نسبة فهاد المجال.',
          'بلا الضريبة: ما كيتطبق حتى سعر TVA.',
        ],
      },
      {
        heading: 'الحدود ونقط خاصها تتحقق',
        paragraphs: [
          'سقف رقم المعاملات وعتبة الملكية ومجال التكفل ما تحققش منهم عند الهيئة المسيرة: أكد الأهلية والنسبة والشروط عندها قبل أي قرار.',
          'الأداة ما كتودع حتى طلب وما كتحتافظ بحتى معطى وما كتحسبش الشروط الأخرى المحتملة د المنظومة: النتيجة تقدير ماشي وعد بالدعم.',
        ],
      },
    ],
  },
};

export interface MowakabaUiCopy {
  readonly revenueLabel: string;
  readonly revenueHint: string;
  readonly ownershipLabel: string;
  readonly ownershipHint: string;
  readonly packLabel: string;
  readonly packOption: string;
  readonly coverageLabel: string;
  readonly coverageRange: string;
  readonly coverageHint: string;
  readonly submit: string;
  readonly resultHeading: string;
  readonly eligibleYes: string;
  readonly eligibleNo: string;
  readonly reasonRevenue: string;
  readonly reasonOwnership: string;
  readonly packPrice: string;
  readonly rangeLine: string;
  readonly fullPrice: string;
  readonly tableCaption: string;
  readonly colCoverage: string;
  readonly colSubsidy: string;
  readonly colRemaining: string;
  readonly rowLow: string;
  readonly rowChosen: string;
  readonly rowHigh: string;
  readonly priceSource: string;
  readonly notPromise: string;
  readonly rulesUsed: string;
  readonly errRevenue: string;
  readonly errOwnership: string;
  readonly errCoverage: string;
}

const FR: MowakabaUiCopy = {
  revenueLabel: 'Chiffre d’affaires annuel hors taxes (MAD)',
  revenueHint: 'Exemple : 12 000 000,00',
  ownershipLabel: 'Part du capital détenue par un grand groupe (%), facultatif',
  ownershipHint: 'Laissez vide si aucune entreprise ni aucun groupe ne détient votre capital.',
  packLabel: 'Pack visé',
  packOption: '{name} : {price} HT',
  coverageLabel: 'Taux de prise en charge à simuler (%), facultatif',
  coverageRange: 'Fourchette datée : de {low} à {high}.',
  coverageHint: 'Laissez vide pour voir les deux extrémités ; sinon saisissez un taux dans la fourchette.',
  submit: 'Estimer ma subvention',
  resultHeading: 'Résultat',
  eligibleYes: 'Critères de l’outil satisfaits : éligibilité probable, à confirmer auprès de l’organisme gestionnaire.',
  eligibleNo: 'Critères de l’outil non satisfaits : pas de subvention estimée, tarif plein.',
  reasonRevenue: 'Le chiffre d’affaires dépasse le plafond de {ceiling} HT.',
  reasonOwnership: 'La détention par un grand groupe dépasse {threshold}.',
  packPrice: 'Prix du pack, HT',
  rangeLine: 'Reste à charge HT, de haut à bas de fourchette',
  fullPrice: 'Reste à charge au tarif plein',
  tableCaption: 'Subvention et reste à charge selon le taux de prise en charge (HT)',
  colCoverage: 'Prise en charge',
  colSubsidy: 'Subvention',
  colRemaining: 'Reste à charge',
  rowLow: 'Bas de fourchette',
  rowChosen: 'Taux saisi',
  rowHigh: 'Haut de fourchette',
  priceSource: 'Prix HT de la grille tarifaire publique (page Tarifs).',
  notPromise: 'Estimation indicative : l’octroi relève de l’organisme gestionnaire, jamais de cet outil.',
  rulesUsed: 'Règle utilisée pour ce résultat',
  errRevenue: 'Saisissez un chiffre d’affaires valide, positif ou nul, avec au plus deux décimales.',
  errOwnership: 'Saisissez une part valide en pourcentage, entre 0 et 100, ou laissez vide.',
  errCoverage: 'Saisissez un taux compris dans la fourchette indiquée, ou laissez vide.',
};

const EN: MowakabaUiCopy = {
  revenueLabel: 'Annual revenue excluding VAT (MAD)',
  revenueHint: 'Example: 12,000,000.00',
  ownershipLabel: 'Share of capital held by a large group (%), optional',
  ownershipHint: 'Leave empty if no company or group holds your capital.',
  packLabel: 'Pack wanted',
  packOption: '{name}: {price} excl. VAT',
  coverageLabel: 'Coverage rate to simulate (%), optional',
  coverageRange: 'Dated range: {low} to {high}.',
  coverageHint: 'Leave empty to see both ends; otherwise enter a rate within the range.',
  submit: 'Estimate my subsidy',
  resultHeading: 'Result',
  eligibleYes: 'The tool’s criteria are met: eligibility likely, to be confirmed with the managing body.',
  eligibleNo: 'The tool’s criteria are not met: no subsidy estimated, full price.',
  reasonRevenue: 'Revenue exceeds the {ceiling} excl. VAT ceiling.',
  reasonOwnership: 'Ownership by a large group exceeds {threshold}.',
  packPrice: 'Pack price, excl. VAT',
  rangeLine: 'Remaining cost excl. VAT, from high to low end of the range',
  fullPrice: 'Remaining cost at full price',
  tableCaption: 'Subsidy and remaining cost by coverage rate (excl. VAT)',
  colCoverage: 'Coverage',
  colSubsidy: 'Subsidy',
  colRemaining: 'Remaining cost',
  rowLow: 'Low end',
  rowChosen: 'Rate entered',
  rowHigh: 'High end',
  priceSource: 'Prices excl. VAT from the public price list (Pricing page).',
  notPromise: 'Indicative estimate: the grant is decided by the managing body, never by this tool.',
  rulesUsed: 'Rule used for this result',
  errRevenue: 'Enter a valid revenue, zero or more, with at most two decimals.',
  errOwnership: 'Enter a valid percentage share between 0 and 100, or leave empty.',
  errCoverage: 'Enter a rate within the range shown, or leave empty.',
};

const AR: MowakabaUiCopy = {
  revenueLabel: 'رقم المعاملات السنوي دون الرسوم (درهم)',
  revenueHint: 'مثال: 12000000,00',
  ownershipLabel: 'حصة رأس المال المملوكة لمجموعة كبرى (%)، اختياري',
  ownershipHint: 'اتركه فارغا إذا لم تكن أي شركة أو مجموعة تملك رأسمالك.',
  packLabel: 'الباقة المقصودة',
  packOption: '{name}: {price} دون الرسوم',
  coverageLabel: 'نسبة التكفل المراد محاكاتها (%)، اختياري',
  coverageRange: 'المجال المؤرخ: من {low} إلى {high}.',
  coverageHint: 'اتركه فارغا لرؤية الطرفين؛ وإلا فأدخل نسبة ضمن المجال.',
  submit: 'قدّر دعمي',
  resultHeading: 'النتيجة',
  eligibleYes: 'معايير الأداة مستوفاة: الأهلية محتملة، وتحتاج إلى تأكيد لدى الهيئة المسيرة.',
  eligibleNo: 'معايير الأداة غير مستوفاة: لا دعم مقدَّر، الثمن كامل.',
  reasonRevenue: 'رقم المعاملات يتجاوز السقف {ceiling} دون الرسوم.',
  reasonOwnership: 'ملكية المجموعة الكبرى تتجاوز {threshold}.',
  packPrice: 'ثمن الباقة، دون الرسوم',
  rangeLine: 'المتبقي على عاتقك دون الرسوم، من الحد الأعلى إلى الأدنى للمجال',
  fullPrice: 'المتبقي على عاتقك بالثمن الكامل',
  tableCaption: 'الدعم والمتبقي حسب نسبة التكفل (دون الرسوم)',
  colCoverage: 'التكفل',
  colSubsidy: 'الدعم',
  colRemaining: 'المتبقي على عاتقك',
  rowLow: 'الحد الأدنى للمجال',
  rowChosen: 'النسبة المدخلة',
  rowHigh: 'الحد الأعلى للمجال',
  priceSource: 'أسعار دون الرسوم من لائحة الأثمنة العمومية (صفحة الأسعار).',
  notPromise: 'تقدير إرشادي: منح الدعم من اختصاص الهيئة المسيرة وليس من اختصاص هذه الأداة أبدا.',
  rulesUsed: 'القاعدة المستعملة لهذه النتيجة',
  errRevenue: 'أدخل رقم معاملات صالحا، صفرا أو أكثر، بعشريتين على الأكثر.',
  errOwnership: 'أدخل حصة مئوية صالحة بين 0 و100، أو اتركها فارغة.',
  errCoverage: 'أدخل نسبة ضمن المجال المبيّن، أو اتركها فارغة.',
};

const ARY: MowakabaUiCopy = {
  revenueLabel: 'رقم المعاملات السنوي بلا الضريبة (درهم)',
  revenueHint: 'مثال: 12000000,00',
  ownershipLabel: 'حصة الرأسمال اللي مالكها شي مجموعة كبيرة (%)، اختياري',
  ownershipHint: 'خليه خاوي إلا ما كانت حتى شركة ولا مجموعة مالكة الرأسمال ديالك.',
  packLabel: 'الباقة اللي بغيتي',
  packOption: '{name}: {price} بلا الضريبة',
  coverageLabel: 'نسبة التكفل اللي بغيتي تجرب (%)، اختياري',
  coverageRange: 'المجال المؤرخ: من {low} حتى {high}.',
  coverageHint: 'خليه خاوي باش تشوف الطرفين؛ وإلا دخل نسبة فالمجال.',
  submit: 'قدر الدعم ديالي',
  resultHeading: 'النتيجة',
  eligibleYes: 'معايير الأداة مستوفاة: الأهلية محتملة، وخاصها تتأكد عند الهيئة المسيرة.',
  eligibleNo: 'معايير الأداة ماشي مستوفاة: ما كاين حتى دعم مقدر، الثمن كامل.',
  reasonRevenue: 'رقم المعاملات فاق السقف {ceiling} بلا الضريبة.',
  reasonOwnership: 'ملكية المجموعة الكبيرة فاتت {threshold}.',
  packPrice: 'ثمن الباقة، بلا الضريبة',
  rangeLine: 'اللي كيبقى عليك بلا الضريبة، من الحد الأعلى للأدنى د المجال',
  fullPrice: 'اللي كيبقى عليك بالثمن الكامل',
  tableCaption: 'الدعم واللي كيبقى حسب نسبة التكفل (بلا الضريبة)',
  colCoverage: 'التكفل',
  colSubsidy: 'الدعم',
  colRemaining: 'اللي كيبقى عليك',
  rowLow: 'الحد الأدنى د المجال',
  rowChosen: 'النسبة المدخلة',
  rowHigh: 'الحد الأعلى د المجال',
  priceSource: 'أثمنة بلا الضريبة من اللائحة العمومية (صفحة الأسعار).',
  notPromise: 'تقدير إرشادي: منح الدعم كيرجع للهيئة المسيرة ماشي لهاد الأداة أبدا.',
  rulesUsed: 'القاعدة المستعملة فهاد النتيجة',
  errRevenue: 'دخل رقم معاملات صالح، صفر ولا أكثر، وبجوج د الأرقام العشرية على الأكثر.',
  errOwnership: 'دخل حصة مئوية صالحة بين 0 و100، ولا خليها خاوية.',
  errCoverage: 'دخل نسبة فالمجال المبين، ولا خليها خاوية.',
};

export const MOWAKABA_UI: L4<MowakabaUiCopy> = { fr: FR, en: EN, ar: AR, ary: ARY };
