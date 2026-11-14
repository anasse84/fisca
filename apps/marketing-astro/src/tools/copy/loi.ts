import type { L4 } from '../../content/silos/types.ts';
import type { ToolPageCopy } from './page-types.ts';
import { t } from './common.ts';

export const LOI_PAGE: ToolPageCopy = {
  title: t(
    'Simulateur d’amendes de retard de paiement, loi 69-21',
    'Late-payment penalty simulator, law 69-21',
    'محاكي غرامات التأخر في الأداء، القانون 69-21',
    'محاكي غرامات التأخير فالأداء، القانون 69-21',
  ),
  description: t(
    'Calculez la pénalité de retard de paiement de la loi 69-21 : échéance, jours de retard, mois entamés, taux et montant arrondi au dirham supérieur, en centimes entiers. Le taux directeur Bank Al-Maghrib est un paramètre daté que vous saisissez.',
    'Compute the law 69-21 late-payment penalty: due date, days late, started months, rate and amount rounded up to the next dirham, in whole cents. The Bank Al-Maghrib policy rate is a dated parameter that you enter.',
    'احسب غرامة التأخر في الأداء وفق القانون 69-21: تاريخ الاستحقاق وأيام التأخر والأشهر التي بدأت والنسبة والمبلغ مقربا إلى الدرهم الأعلى، بالسنتيمات الصحيحة. سعر الفائدة الرئيسي لبنك المغرب معامل مؤرخ تدخله أنت.',
    'حسب غرامة التأخير فالأداء بالقانون 69-21: تاريخ الاستحقاق وأيام التأخير والشهور اللي بداو والنسبة والمبلغ مقرب للدرهم الأعلى، بالسنتيمات الصحاح. سعر الفائدة د بنك المغرب معامل مؤرخ كتدخلو نتا.',
  ),
  heading: t(
    'Simulateur de pénalités de retard, loi 69-21',
    'Late-payment penalty simulator, law 69-21',
    'محاكي غرامات التأخر في الأداء، القانون 69-21',
    'محاكي غرامات التأخير فالأداء، القانون 69-21',
  ),
  lead: t(
    'À partir de la date de livraison et du délai légal, l’outil calcule l’échéance, les jours de retard et les mois entamés, applique le taux directeur que vous saisissez plus la majoration par mois supplémentaire, et arrondit la pénalité au dirham supérieur, sans aucun nombre flottant.',
    'From the delivery date and the statutory term, the tool computes the due date, the days late and the started months, applies the policy rate you enter plus the surcharge per additional month, and rounds the penalty up to the next dirham, with no floating-point number.',
    'انطلاقا من تاريخ التسليم والأجل القانوني تحسب الأداة تاريخ الاستحقاق وأيام التأخر والأشهر التي بدأت، وتطبق سعر الفائدة الرئيسي الذي تدخله مع الزيادة عن كل شهر إضافي، وتقرب الغرامة إلى الدرهم الأعلى دون أي عدد عشري عائم.',
    'من تاريخ التسليم والأجل القانوني الأداة كتحسب الاستحقاق وأيام التأخير والشهور اللي بداو، وكتطبق سعر الفائدة اللي كتدخل زائد الزيادة على كل شهر زايد، وكتقرب الغرامة للدرهم الأعلى بلا حتى رقم عائم.',
  ),
  summary: t(
    'Échéance = livraison + délai légal ; mois entamés ; taux = taux directeur + majoration x (mois - 1) ; pénalité arrondie au dirham supérieur, en centimes entiers.',
    'Due date = delivery + statutory term; started months; rate = policy rate + surcharge x (months - 1); penalty rounded up to the next dirham, in whole cents.',
    'الاستحقاق = التسليم + الأجل القانوني؛ الأشهر التي بدأت؛ النسبة = سعر الفائدة الرئيسي + الزيادة × (الأشهر - 1)؛ الغرامة مقربة إلى الدرهم الأعلى بالسنتيمات الصحيحة.',
    'الاستحقاق = التسليم + الأجل القانوني؛ الشهور اللي بداو؛ النسبة = سعر الفائدة + الزيادة × (الشهور - 1)؛ الغرامة مقربة للدرهم الأعلى بالسنتيمات الصحاح.',
  ),
  steps: {
    fr: [
      { name: 'Saisir la facture', text: 'Indiquez le montant TTC, la date de livraison ou de prestation et le délai légal applicable ({legalDays}, {contractualDays} ou {sectorDays} jours).' },
      { name: 'Indiquer la date de paiement', text: 'Saisissez la date de paiement effectif, ou la date d’arrêté du calcul si la facture est encore impayée.' },
      { name: 'Contrôler le taux directeur', text: 'Remplacez la valeur datée proposée par le taux directeur de Bank Al-Maghrib en vigueur ; la majoration par mois supplémentaire est modifiable de la même façon.' },
      { name: 'Lire le résultat et la règle utilisée', text: 'Relevez l’échéance, les jours de retard, les mois entamés, le taux et la pénalité, avec la date et l’état de recoupement de chaque valeur.' },
    ],
    en: [
      { name: 'Enter the invoice', text: 'Give the VAT-inclusive amount, the delivery or service date and the applicable statutory term ({legalDays}, {contractualDays} or {sectorDays} days).' },
      { name: 'Give the payment date', text: 'Enter the actual payment date, or the cut-off date of the calculation if the invoice is still unpaid.' },
      { name: 'Check the policy rate', text: 'Replace the dated value offered with the Bank Al-Maghrib policy rate in force; the surcharge per additional month can be changed the same way.' },
      { name: 'Read the result and the rule used', text: 'Note the due date, days late, started months, rate and penalty, with the date and cross-check state of each value.' },
    ],
    ar: [
      { name: 'إدخال الفاتورة', text: 'أدخل المبلغ شاملا الرسوم وتاريخ التسليم أو أداء الخدمة والأجل القانوني المطبق ({legalDays} أو {contractualDays} أو {sectorDays} يوما).' },
      { name: 'تحديد تاريخ الأداء', text: 'أدخل تاريخ الأداء الفعلي، أو تاريخ إيقاف الحساب إذا كانت الفاتورة غير مؤداة بعد.' },
      { name: 'مراجعة سعر الفائدة الرئيسي', text: 'استبدل القيمة المؤرخة المقترحة بسعر الفائدة الرئيسي لبنك المغرب الساري؛ ويمكن تعديل الزيادة عن كل شهر إضافي بالطريقة نفسها.' },
      { name: 'قراءة النتيجة والقاعدة المستعملة', text: 'دوّن تاريخ الاستحقاق وأيام التأخر والأشهر التي بدأت والنسبة والغرامة، مع تاريخ كل قيمة وحالة التحقق منها.' },
    ],
    ary: [
      { name: 'دخل الفاتورة', text: 'دخل المبلغ بالضريبة وتاريخ التسليم ولا الخدمة والأجل القانوني المطبق ({legalDays} ولا {contractualDays} ولا {sectorDays} يوم).' },
      { name: 'حدد تاريخ الأداء', text: 'دخل تاريخ الأداء الفعلي، ولا تاريخ توقيف الحساب إلا كانت الفاتورة باقا ما تخلصاتش.' },
      { name: 'راجع سعر الفائدة', text: 'بدل القيمة المؤرخة المقترحة بسعر الفائدة د بنك المغرب الساري؛ والزيادة على كل شهر زايد تقدر تبدلها بنفس الطريقة.' },
      { name: 'قرا النتيجة والقاعدة المستعملة', text: 'سجل تاريخ الاستحقاق وأيام التأخير والشهور اللي بداو والنسبة والغرامة، مع تاريخ كل قيمة وحالة التحقق منها.' },
    ],
  },
  faqs: {
    fr: [
      { question: 'Comment sont comptés les mois entamés ?', answer: 'Les mois sont des mois calendaires comptés à partir de l’échéance, et tout mois commencé est dû. Avec une échéance au 31 juillet et un paiement le 15 septembre (46 jours de retard), 1 mois et 15 jours font 2 mois entamés. Cette convention de décompte est celle de l’outil ; faites-la valider.' },
      { question: 'D’où vient le taux de {totalRate} de l’exemple ?', answer: 'L’exemple de référence suppose un taux directeur de {baseRate} plus {incrementRate} pour le mois supplémentaire, soit {totalBps} points de base pour 2 mois entamés. Ce taux n’a pas été recoupé avec une source externe : le taux directeur est une donnée datée à saisir à sa valeur en vigueur.' },
      { question: 'Pourquoi la pénalité est-elle arrondie au dirham supérieur ?', answer: 'Le calcul retient le dirham supérieur : 444,42 MAD deviennent 445,00 MAD, soit 44 500 centimes. L’arrondi se fait en nombres entiers, sans flottant.' },
    ],
    en: [
      { question: 'How are started months counted?', answer: 'Months are calendar months counted from the due date, and any month begun is owed. With a due date of 31 July and payment on 15 September (46 days late), 1 month and 15 days make 2 started months. This counting convention is the tool’s own; have it validated.' },
      { question: 'Where does the {totalRate} rate in the example come from?', answer: 'The reference example assumes a policy rate of {baseRate} plus {incrementRate} for the additional month, i.e. {totalBps} basis points for 2 started months. This rate has not been cross-checked against an external source: the policy rate is dated data to be entered at its current value.' },
      { question: 'Why is the penalty rounded up to the next dirham?', answer: 'The calculation rounds up to the next dirham: 444.42 MAD becomes 445.00 MAD, i.e. 44,500 cents. Rounding is done in whole numbers, with no floating point.' },
    ],
    ar: [
      { question: 'كيف تُحتسب الأشهر التي بدأت؟', answer: 'الأشهر أشهر تقويمية تُحسب ابتداء من تاريخ الاستحقاق، وكل شهر بدأ مستحق. مع استحقاق في 31 يوليوز وأداء في 15 شتنبر (46 يوما تأخرا)، يشكل شهر و15 يوما شهرين بدآ. هذه قاعدة العد المعتمدة في الأداة؛ يجب اعتمادها.' },
      { question: 'من أين تأتي نسبة {totalRate} في المثال؟', answer: 'يفترض المثال المرجعي سعر فائدة رئيسي {baseRate} زائد {incrementRate} للشهر الإضافي أي {totalBps} نقطة أساس لشهرين بدآ. لم يُتحقق من هذه النسبة بمصدر خارجي: سعر الفائدة الرئيسي معطى مؤرخ يُدخل بقيمته السارية.' },
      { question: 'لماذا تُقرَّب الغرامة إلى الدرهم الأعلى؟', answer: 'يعتمد الحساب الدرهم الأعلى: يصبح 444,42 درهما 445,00 درهما أي 44 500 سنتيم. ويتم التقريب بأعداد صحيحة دون عدد عشري عائم.' },
    ],
    ary: [
      { question: 'كيفاش كيتحسبو الشهور اللي بداو؟', answer: 'الشهور هي شهور تقويمية كتتحسب من الاستحقاق، وكل شهر بدا كيتخلص. مع استحقاق ف31 يوليوز وأداء ف15 شتنبر (46 يوم د التأخير)، شهر و15 يوم كيعطيو شهرين بداو. هادي هي طريقة العد د الأداة؛ خاصها تتأكد.' },
      { question: 'منين جات النسبة {totalRate} فالمثال؟', answer: 'المثال المرجعي كيفترض سعر فائدة {baseRate} زائد {incrementRate} للشهر الزايد يعني {totalBps} نقطة أساس لشهرين بداو. هاد النسبة ما تحققش منها بمصدر د برا: سعر الفائدة معطى مؤرخ كتدخلو بالقيمة الجارية.' },
      { question: 'علاش الغرامة كتقرب للدرهم الأعلى؟', answer: 'الحساب كياخد الدرهم الأعلى: 444,42 درهم كيولي 445,00 درهم يعني 44 500 سنتيم. والتقريب كيتدار بأعداد صحاح بلا رقم عائم.' },
    ],
  },
  sections: {
    fr: [
      {
        heading: 'Règle appliquée',
        paragraphs: ['Les valeurs numériques viennent de données datées, jamais d’un fait permanent du code.'],
        bullets: [
          'Échéance = date de livraison + délai légal en jours (paramètre daté).',
          'Retard = nombre de jours entre l’échéance et la date de paiement ou d’arrêté ; aucun retard, aucune pénalité.',
          'Mois entamés = mois calendaires à partir de l’échéance ; tout mois commencé compte.',
          'Taux = taux directeur de Bank Al-Maghrib saisi + majoration par mois supplémentaire x (mois entamés - 1).',
          'Pénalité = montant TTC x taux, arrondie au dirham supérieur, en centimes entiers.',
        ],
      },
      {
        heading: 'Limites et points à valider',
        paragraphs: [
          'Le taux directeur et la majoration ne sont pas recoupés avec une source externe : saisissez le taux en vigueur à la date concernée. La convention de décompte des mois calendaires et la lecture « majoration par mois supplémentaire » pour plus de deux mois sont celles de l’outil, à faire valider par un expert-comptable.',
          'L’outil ne calcule pas l’impact de la pénalité sur le résultat fiscal et ne produit pas de note justificative : le montant est une estimation, pas une mise en demeure.',
        ],
      },
    ],
    en: [
      {
        heading: 'Rule applied',
        paragraphs: ['Numeric values come from dated data, never from a permanent fact in the code.'],
        bullets: [
          'Due date = delivery date + statutory term in days (dated parameter).',
          'Delay = number of days between the due date and the payment or cut-off date; no delay, no penalty.',
          'Started months = calendar months from the due date; any month begun counts.',
          'Rate = Bank Al-Maghrib policy rate entered + surcharge per additional month x (started months - 1).',
          'Penalty = VAT-inclusive amount x rate, rounded up to the next dirham, in whole cents.',
        ],
      },
      {
        heading: 'Limits and points to validate',
        paragraphs: [
          'The policy rate and the surcharge have not been cross-checked against an external source: enter the rate in force on the relevant date. The calendar-month counting convention and the reading “surcharge per additional month” beyond two months are the tool’s own, to be validated by an accountant.',
          'The tool does not compute the penalty’s effect on taxable profit and produces no supporting note: the amount is an estimate, not a formal notice.',
        ],
      },
    ],
    ar: [
      {
        heading: 'القاعدة المطبقة',
        paragraphs: ['القيم الرقمية مأخوذة من معطيات مؤرخة وليست حقيقة دائمة مكتوبة في الشفرة.'],
        bullets: [
          'الاستحقاق = تاريخ التسليم + الأجل القانوني بالأيام (معامل مؤرخ).',
          'التأخر = عدد الأيام بين الاستحقاق وتاريخ الأداء أو إيقاف الحساب؛ لا تأخر فلا غرامة.',
          'الأشهر التي بدأت = أشهر تقويمية ابتداء من الاستحقاق؛ ويُحتسب كل شهر بدأ.',
          'النسبة = سعر الفائدة الرئيسي لبنك المغرب المُدخل + الزيادة عن كل شهر إضافي × (الأشهر التي بدأت - 1).',
          'الغرامة = المبلغ شاملا الرسوم × النسبة، مقربة إلى الدرهم الأعلى بالسنتيمات الصحيحة.',
        ],
      },
      {
        heading: 'الحدود ونقاط التحقق',
        paragraphs: [
          'لم يُتحقق من سعر الفائدة الرئيسي والزيادة بمصدر خارجي: أدخل السعر الساري في التاريخ المعني. وقاعدة عد الأشهر التقويمية وقراءة «الزيادة عن كل شهر إضافي» بعد شهرين هما قاعدتا الأداة، ويجب أن يعتمدهما خبير محاسب.',
          'لا تحسب الأداة أثر الغرامة على النتيجة الجبائية ولا تنتج مذكرة تبريرية: المبلغ تقدير وليس إنذارا.',
        ],
      },
    ],
    ary: [
      {
        heading: 'القاعدة المطبقة',
        paragraphs: ['القيم الرقمية كتجي من معطيات مؤرخة ماشي من حقيقة دايمة مكتوبة فالكود.'],
        bullets: [
          'الاستحقاق = تاريخ التسليم + الأجل القانوني بالأيام (معامل مؤرخ).',
          'التأخير = عدد الأيام بين الاستحقاق وتاريخ الأداء ولا توقيف الحساب؛ ما كاين تأخير ما كاين غرامة.',
          'الشهور اللي بداو = شهور تقويمية من الاستحقاق؛ وكل شهر بدا كيتحسب.',
          'النسبة = سعر الفائدة د بنك المغرب اللي دخلتي + الزيادة على كل شهر زايد × (الشهور اللي بداو - 1).',
          'الغرامة = المبلغ بالضريبة × النسبة، مقربة للدرهم الأعلى بالسنتيمات الصحاح.',
        ],
      },
      {
        heading: 'الحدود ونقط خاصها تتحقق',
        paragraphs: [
          'سعر الفائدة والزيادة ما تحققش منهم بمصدر د برا: دخل السعر الساري فالتاريخ المعني. وطريقة عد الشهور التقويمية وقراءة «الزيادة على كل شهر زايد» من بعد شهرين هما د الأداة، وخاصهم يتأكدو عند خبير محاسب.',
          'الأداة ما كتحسبش أثر الغرامة على النتيجة الجبائية وما كتخرجش مذكرة تبريرية: المبلغ تقدير ماشي إنذار.',
        ],
      },
    ],
  },
  legislation: { name: 'Loi n° 69-21 relative aux délais de paiement', identifier: '69-21' },
};

export interface LoiUiCopy {
  readonly amountLabel: string;
  readonly amountHint: string;
  readonly deliveryLabel: string;
  readonly delayLabel: string;
  readonly delayOption: string;
  readonly paymentLabel: string;
  readonly paymentHint: string;
  readonly directorLabel: string;
  readonly directorHint: string;
  readonly incrementLabel: string;
  readonly submit: string;
  readonly resultHeading: string;
  readonly dueDate: string;
  readonly delayDays: string;
  readonly startedMonths: string;
  readonly rate: string;
  readonly rawPenalty: string;
  readonly penalty: string;
  readonly noDelay: string;
  readonly rulesUsed: string;
  readonly errAmount: string;
  readonly errDelivery: string;
  readonly errPayment: string;
  readonly errRate: string;
  readonly errDelay: string;
  readonly unitDays: string;
  readonly unitMonths: string;
}

const FR: LoiUiCopy = {
  amountLabel: 'Montant TTC de la facture (MAD)',
  amountHint: 'Exemple : 12 345,00',
  deliveryLabel: 'Date de livraison ou de prestation',
  delayLabel: 'Délai légal de paiement',
  delayOption: '{n} jours',
  paymentLabel: 'Date de paiement ou d’arrêté du calcul',
  paymentHint: 'Si la facture est impayée, saisissez la date à laquelle vous arrêtez le calcul.',
  directorLabel: 'Taux directeur Bank Al-Maghrib (%)',
  directorHint: 'Valeur datée proposée : {value} au {date} ({state}). Remplacez-la par le taux en vigueur.',
  incrementLabel: 'Majoration par mois supplémentaire (%)',
  submit: 'Calculer la pénalité',
  resultHeading: 'Résultat',
  dueDate: 'Échéance',
  delayDays: 'Jours de retard',
  startedMonths: 'Mois entamés',
  rate: 'Taux appliqué',
  rawPenalty: 'Pénalité avant arrondi',
  penalty: 'Pénalité arrondie au dirham supérieur',
  noDelay: 'Aucun retard à la date indiquée : aucune pénalité.',
  rulesUsed: 'Règle utilisée pour ce résultat',
  errAmount: 'Saisissez un montant TTC valide, supérieur à zéro, avec au plus deux décimales.',
  errDelivery: 'Saisissez une date de livraison valide.',
  errPayment: 'Saisissez une date de paiement valide.',
  errRate: 'Saisissez des taux valides en pourcentage, avec au plus deux décimales.',
  errDelay: 'Choisissez un délai légal.',
  unitDays: 'jours',
  unitMonths: 'mois',
};

const EN: LoiUiCopy = {
  amountLabel: 'Invoice amount incl. VAT (MAD)',
  amountHint: 'Example: 12,345.00',
  deliveryLabel: 'Delivery or service date',
  delayLabel: 'Statutory payment term',
  delayOption: '{n} days',
  paymentLabel: 'Payment or cut-off date',
  paymentHint: 'If the invoice is unpaid, enter the date at which you stop the calculation.',
  directorLabel: 'Bank Al-Maghrib policy rate (%)',
  directorHint: 'Dated value offered: {value} as of {date} ({state}). Replace it with the rate in force.',
  incrementLabel: 'Surcharge per additional month (%)',
  submit: 'Compute the penalty',
  resultHeading: 'Result',
  dueDate: 'Due date',
  delayDays: 'Days late',
  startedMonths: 'Started months',
  rate: 'Rate applied',
  rawPenalty: 'Penalty before rounding',
  penalty: 'Penalty rounded up to the next dirham',
  noDelay: 'No delay at the given date: no penalty.',
  rulesUsed: 'Rule used for this result',
  errAmount: 'Enter a valid amount incl. VAT, above zero, with at most two decimals.',
  errDelivery: 'Enter a valid delivery date.',
  errPayment: 'Enter a valid payment date.',
  errRate: 'Enter valid percentage rates with at most two decimals.',
  errDelay: 'Choose a statutory term.',
  unitDays: 'days',
  unitMonths: 'months',
};

const AR: LoiUiCopy = {
  amountLabel: 'مبلغ الفاتورة شاملا الرسوم (درهم)',
  amountHint: 'مثال: 12345,00',
  deliveryLabel: 'تاريخ التسليم أو أداء الخدمة',
  delayLabel: 'الأجل القانوني للأداء',
  delayOption: '{n} يوما',
  paymentLabel: 'تاريخ الأداء أو إيقاف الحساب',
  paymentHint: 'إذا كانت الفاتورة غير مؤداة فأدخل التاريخ الذي توقف عنده الحساب.',
  directorLabel: 'سعر الفائدة الرئيسي لبنك المغرب (%)',
  directorHint: 'القيمة المؤرخة المقترحة: {value} بتاريخ {date} ({state}). استبدلها بالسعر الساري.',
  incrementLabel: 'الزيادة عن كل شهر إضافي (%)',
  submit: 'احسب الغرامة',
  resultHeading: 'النتيجة',
  dueDate: 'تاريخ الاستحقاق',
  delayDays: 'أيام التأخر',
  startedMonths: 'الأشهر التي بدأت',
  rate: 'النسبة المطبقة',
  rawPenalty: 'الغرامة قبل التقريب',
  penalty: 'الغرامة مقربة إلى الدرهم الأعلى',
  noDelay: 'لا تأخر في التاريخ المحدد: لا غرامة.',
  rulesUsed: 'القاعدة المستعملة لهذه النتيجة',
  errAmount: 'أدخل مبلغا صالحا شاملا الرسوم أكبر من الصفر بعشريتين على الأكثر.',
  errDelivery: 'أدخل تاريخ تسليم صالحا.',
  errPayment: 'أدخل تاريخ أداء صالحا.',
  errRate: 'أدخل نسبا مئوية صالحة بعشريتين على الأكثر.',
  errDelay: 'اختر أجلا قانونيا.',
  unitDays: 'أيام',
  unitMonths: 'أشهر',
};

const ARY: LoiUiCopy = {
  amountLabel: 'مبلغ الفاتورة بالضريبة (درهم)',
  amountHint: 'مثال: 12345,00',
  deliveryLabel: 'تاريخ التسليم ولا الخدمة',
  delayLabel: 'الأجل القانوني د الأداء',
  delayOption: '{n} يوم',
  paymentLabel: 'تاريخ الأداء ولا توقيف الحساب',
  paymentHint: 'إلا كانت الفاتورة ما تخلصاتش دخل التاريخ اللي بغيتي توقف فيه الحساب.',
  directorLabel: 'سعر الفائدة د بنك المغرب (%)',
  directorHint: 'القيمة المؤرخة المقترحة: {value} بتاريخ {date} ({state}). بدلها بالسعر الساري.',
  incrementLabel: 'الزيادة على كل شهر زايد (%)',
  submit: 'حسب الغرامة',
  resultHeading: 'النتيجة',
  dueDate: 'تاريخ الاستحقاق',
  delayDays: 'أيام التأخير',
  startedMonths: 'الشهور اللي بداو',
  rate: 'النسبة المطبقة',
  rawPenalty: 'الغرامة قبل التقريب',
  penalty: 'الغرامة مقربة للدرهم الأعلى',
  noDelay: 'ما كاين تأخير فالتاريخ المحدد: ما كاين غرامة.',
  rulesUsed: 'القاعدة المستعملة فهاد النتيجة',
  errAmount: 'دخل مبلغ صالح بالضريبة كبر من الصفر وبجوج د الأرقام العشرية على الأكثر.',
  errDelivery: 'دخل تاريخ تسليم صالح.',
  errPayment: 'دخل تاريخ أداء صالح.',
  errRate: 'دخل نسب مئوية صالحة وبجوج د الأرقام العشرية على الأكثر.',
  errDelay: 'ختار أجل قانوني.',
  unitDays: 'أيام',
  unitMonths: 'شهور',
};

export const LOI_UI: L4<LoiUiCopy> = { fr: FR, en: EN, ar: AR, ary: ARY };
