import type { CaseId } from './cases.ts';
import type { CaseCopy, L4 } from './types.ts';

function l4(fr: string, en: string, ar: string, ary: string): L4 {
  return { fr, en, ar, ary };
}

const ILLUSTRATIVE = l4(
  'Exemple illustratif : le montant reprend celui d’un vecteur documenté, il ne décrit pas votre situation. Information, pas un conseil réservé aux experts-comptables (loi 15-89).',
  'Illustrative example: the amount reuses a documented test vector and does not describe your situation. Information only, not advice reserved to chartered accountants (law 15-89).',
  'مثال توضيحي: المبلغ مأخوذ من متجه اختبار موثق ولا يصف وضعيتكم. معلومة فقط وليست استشارة محجوزة للخبراء المحاسبين (القانون 15-89).',
  'مثال للتوضيح: المبلغ مأخود من متجه اختبار موثق وما كيوصفش وضعيتكم. معلومة غير، ماشي استشارة مخصصة للخبراء المحاسبين (القانون 15-89).',
);

const VECTOR = l4(
  'Les montants sont ceux du vecteur d’or indiqué ; la valeur fiscale citée est datée et son état de vérification figure dans l’encadré « Valeurs datées ». Information, pas un conseil réservé aux experts-comptables (loi 15-89).',
  'The amounts are those of the cited golden vector; the tax value is dated and its verification state is in the “Dated values” box. Information only, not advice reserved to chartered accountants (law 15-89).',
  'المبالغ هي مبالغ المتجه المرجعي المذكور؛ القيمة الضريبية مؤرخة وحالة التحقق منها في إطار «القيم المؤرخة». معلومة فقط وليست استشارة محجوزة للخبراء المحاسبين (القانون 15-89).',
  'المبالغ هي ديال المتجه المرجعي المذكور؛ القيمة الضريبية مؤرخة وحالة التحقق ديالها فإطار «القيم المؤرخة». معلومة غير، ماشي استشارة مخصصة للخبراء المحاسبين (القانون 15-89).',
);

const PRICING_NOTE = l4(
  'Montants HT issus de la grille tarifaire publique de Fisca ; la taxe applicable s’ajoute à la facturation.',
  'Amounts exclude tax and come from Fisca’s public price list; the applicable tax is added when invoicing.',
  'المبالغ بدون ضريبة ومأخوذة من لائحة أسعار فيسكا المعلنة؛ تضاف الضريبة المطبقة عند الفوترة.',
  'المبالغ بلا TVA ومأخودة من لائحة الأثمنة المعلنة ديال فيسكا؛ الضريبة المطبقة كتزاد فالفاتورة.',
);

export const CASE_COPY: Readonly<Record<CaseId, CaseCopy>> = {
  cash: {
    title: l4('Facture réglée en espèces au-delà du plafond journalier', 'Invoice paid in cash above the daily cap', 'فاتورة مؤداة نقدا فوق السقف اليومي', 'فاتورة مخلصة بالكاش فوق السقف اليومي'),
    scenario: l4(
      'Un achat de 6 000,00 MAD HT, TVA au taux standard, est réglé en une seule fois en espèces le même jour.',
      'A purchase of MAD 6,000.00 excluding tax, at the standard VAT rate, is paid in cash in one go on the same day.',
      'مشترى بمبلغ 6 000,00 MAD بدون ضريبة، بنسبة TVA العادية، يؤدى نقدا دفعة واحدة في اليوم نفسه.',
      'مشترى بـ 6 000,00 MAD بلا TVA، بنسبة TVA العادية، كيتخلص بالكاش دفعة وحدة فنفس النهار.',
    ),
    labels: {
      ht: l4('Montant HT', 'Amount excl. tax', 'المبلغ بدون ضريبة', 'المبلغ بلا TVA'),
      vat: l4('TVA', 'VAT', 'TVA', 'TVA'),
      ttc: l4('Montant TTC réglé', 'Amount paid incl. tax', 'المبلغ المؤدى بالضريبة', 'المبلغ المخلص بالـ TVA'),
      cap: l4('Part TTC admise (plafond le plus bas)', 'Admitted amount incl. tax (lowest cap)', 'الجزء المقبول بالضريبة (أدنى سقف)', 'الجزء المقبول بالـ TVA (أقل سقف)'),
      deductible_ht: l4('HT déductible', 'Deductible amount excl. tax', 'المبلغ القابل للخصم بدون ضريبة', 'المبلغ اللي كيتخصم بلا TVA'),
      recoverable_vat: l4('TVA récupérable', 'Recoverable VAT', 'TVA القابلة للاسترجاع', 'TVA اللي كتتسترجع'),
      reintegrated: l4('HT réintégré au tableau 3 de la liasse', 'Amount added back in table 3 of the tax return', 'المبلغ المعاد إدراجه في الجدول 3 من الإقرار', 'المبلغ اللي كيتزاد فالجدول 3 ديال الإقرار'),
      lost_vat: l4('TVA non récupérable', 'Non-recoverable VAT', 'TVA غير القابلة للاسترجاع', 'TVA اللي ما كتتسترجعش'),
    },
    note: VECTOR,
  },
  cash_month: {
    title: l4('Onze factures en espèces chez le même fournisseur', 'Eleven cash invoices from the same supplier', 'إحدى عشرة فاتورة نقدية لدى المورد نفسه', 'إحدى عشر فاتورة بالكاش عند نفس المورد'),
    scenario: l4(
      'Le même mois, des factures de 4 800,00 MAD TTC sont réglées en espèces au même fournisseur ; chacune reste sous le plafond journalier.',
      'In the same month, invoices of MAD 4,800.00 including tax are paid in cash to the same supplier; each stays under the daily cap.',
      'في الشهر نفسه تؤدى نقدا فواتير بمبلغ 4 800,00 MAD بالضريبة لنفس المورد؛ وتبقى كل واحدة تحت السقف اليومي.',
      'فنفس الشهر كيتخلصو فواتير بـ 4 800,00 MAD بالـ TVA بالكاش لنفس المورد؛ وكل وحدة كتبقى تحت السقف اليومي.',
    ),
    labels: {
      unit: l4('Montant TTC d’une facture', 'Amount of one invoice incl. tax', 'مبلغ فاتورة واحدة بالضريبة', 'مبلغ فاتورة وحدة بالـ TVA'),
      cumul_ten: l4('Cumul après la dixième facture', 'Total after the tenth invoice', 'المجموع بعد الفاتورة العاشرة', 'المجموع من بعد الفاتورة العاشرة'),
      cap: l4('Plafond mensuel TTC par fournisseur', 'Monthly cap incl. tax per supplier', 'السقف الشهري بالضريبة لكل مورد', 'السقف الشهري بالـ TVA لكل مورد'),
      cumul_eleven: l4('Cumul après la onzième facture', 'Total after the eleventh invoice', 'المجموع بعد الفاتورة الحادية عشرة', 'المجموع من بعد الفاتورة الحادية عشر'),
      excess: l4('Excédent TTC à scinder', 'Excess incl. tax to split', 'الزيادة بالضريبة الواجب تجزيئها', 'الزيادة بالـ TVA اللي خاص تتقسم'),
    },
    note: VECTOR,
  },
  late: {
    title: l4('Pénalité de retard sur une facture de 12 345,00 MAD TTC', 'Late-payment penalty on a MAD 12,345.00 invoice incl. tax', 'غرامة التأخير على فاتورة بمبلغ 12 345,00 MAD بالضريبة', 'غرامة التأخير على فاتورة بـ 12 345,00 MAD بالـ TVA'),
    scenario: l4(
      'Facture impayée avec 46 jours de retard : deux mois entamés, taux directeur majoré du supplément du second mois.',
      'Unpaid invoice, 46 days late: two started months, policy rate plus the second-month increment.',
      'فاتورة غير مؤداة بتأخير 46 يوما: شهران بادئان، سعر الفائدة المرجعي مضافا إليه زيادة الشهر الثاني.',
      'فاتورة ما تخلصاتش بتأخير 46 يوم: جوج شهور مبدوءين، السعر المرجعي زائد الزيادة ديال الشهر الثاني.',
    ),
    labels: {
      unpaid: l4('Facture impayée TTC', 'Unpaid invoice incl. tax', 'الفاتورة غير المؤداة بالضريبة', 'الفاتورة اللي ما تخلصاتش بالـ TVA'),
      delay: l4('Jours de retard', 'Days late', 'أيام التأخير', 'أيام التأخير'),
      raw: l4('Pénalité brute (taux cumulé sur la facture)', 'Raw penalty (combined rate on the invoice)', 'الغرامة الخام (النسبة المجمعة على الفاتورة)', 'الغرامة الخام (النسبة المجمعة على الفاتورة)'),
      penalty: l4('Pénalité arrondie au dirham supérieur', 'Penalty rounded up to the next dirham', 'الغرامة مقربة إلى الدرهم الأعلى', 'الغرامة مقربة للدرهم اللي كيعلى'),
    },
    note: VECTOR,
  },
  late_dispute: {
    title: l4('Même facture, litige documenté', 'Same invoice, documented dispute', 'الفاتورة نفسها مع نزاع موثق', 'نفس الفاتورة مع نزاع موثق'),
    scenario: l4(
      'Le montant contesté est documenté dans le coffre : la déclaration l’isole sans pénalité.',
      'The disputed amount is documented in the vault: the return isolates it without penalty.',
      'المبلغ المتنازع عليه موثق في الخزنة: يعزله الإقرار دون غرامة.',
      'المبلغ المتنازع عليه موثق فالخزنة: الإقرار كيعزلو بلا غرامة.',
    ),
    labels: {
      unpaid: l4('Facture impayée TTC', 'Unpaid invoice incl. tax', 'الفاتورة غير المؤداة بالضريبة', 'الفاتورة اللي ما تخلصاتش بالـ TVA'),
      disputed: l4('Montant objet du litige', 'Disputed amount', 'المبلغ موضوع النزاع', 'المبلغ موضوع النزاع'),
      penalty: l4('Pénalité retenue', 'Penalty applied', 'الغرامة المطبقة', 'الغرامة المطبقة'),
    },
    note: VECTOR,
  },
  ras: {
    title: l4('Retenue à la source de TVA : attestation valide ou expirée', 'VAT withholding: valid or expired attestation', 'الاقتطاع من المنبع للـ TVA: شهادة سارية أو منتهية', 'الاقتطاع من المنبع ديال TVA: شهادة صالحة ولا سالات'),
    scenario: l4(
      'Prestation de 10 000,00 MAD HT, TVA de 2 000,00 MAD, payée le 15 juin. Attestation de régularité du 15 février (4 mois) ou du 15 novembre précédent (7 mois).',
      'Service of MAD 10,000.00 excluding tax, VAT of MAD 2,000.00, paid on 15 June. Tax-clearance attestation dated 15 February (4 months) or the previous 15 November (7 months).',
      'خدمة بمبلغ 10 000,00 MAD بدون ضريبة، وTVA بمبلغ 2 000,00 MAD، تؤدى في 15 يونيو. شهادة الخلو من الضريبة بتاريخ 15 فبراير (4 أشهر) أو 15 نونبر السابق (7 أشهر).',
      'خدمة بـ 10 000,00 MAD بلا TVA، وTVA ديالها 2 000,00 MAD، كتتخلص فـ 15 يونيو. شهادة الخلو من الضريبة ديال 15 فبراير (4 شهور) ولا ديال 15 نونبر اللي قبل (7 شهور).',
    ),
    labels: {
      ttc: l4('Facture TTC', 'Invoice incl. tax', 'الفاتورة بالضريبة', 'الفاتورة بالـ TVA'),
      vat: l4('TVA facturée', 'VAT invoiced', 'TVA المفوترة', 'TVA المفوترة'),
      ras_valid: l4('Retenue avec attestation de 4 mois', 'Withholding with a 4-month attestation', 'الاقتطاع مع شهادة عمرها 4 أشهر', 'الاقتطاع مع شهادة عمرها 4 شهور'),
      net_valid: l4('Net versé au fournisseur (attestation valide)', 'Net paid to supplier (valid attestation)', 'الصافي المؤدى للمورد (شهادة سارية)', 'الصافي اللي كيتعطى للمورد (شهادة صالحة)'),
      ras_expired: l4('Retenue avec attestation de 7 mois', 'Withholding with a 7-month attestation', 'الاقتطاع مع شهادة عمرها 7 أشهر', 'الاقتطاع مع شهادة عمرها 7 شهور'),
      net_expired: l4('Net versé au fournisseur (attestation expirée)', 'Net paid to supplier (expired attestation)', 'الصافي المؤدى للمورد (شهادة منتهية)', 'الصافي اللي كيتعطى للمورد (شهادة سالات)'),
    },
    note: VECTOR,
  },
  ae: {
    title: l4('Auto-entrepreneur : dépassement du seuil par client', 'Auto-entrepreneur: exceeding the per-client threshold', 'المقاول الذاتي: تجاوز السقف لكل زبون', 'المقاول الذاتي: تجاوز السقف على كل كليان'),
    scenario: l4(
      'L’auto-entrepreneur a déjà facturé 75 000,00 MAD au même client dans l’année ; il émet une nouvelle facture de 12 000,00 MAD.',
      'The auto-entrepreneur has already invoiced MAD 75,000.00 to the same client this year and issues a new invoice of MAD 12,000.00.',
      'سبق للمقاول الذاتي أن فوتر 75 000,00 MAD لنفس الزبون خلال السنة، ويصدر فاتورة جديدة بمبلغ 12 000,00 MAD.',
      'المقاول الذاتي سبق ليه فوتر 75 000,00 MAD لنفس الكليان فالعام، وكيصدر فاتورة جديدة بـ 12 000,00 MAD.',
    ),
    labels: {
      threshold: l4('Seuil par client', 'Per-client threshold', 'السقف لكل زبون', 'السقف على كل كليان'),
      before: l4('Cumul avant la facture', 'Total before the invoice', 'المجموع قبل الفاتورة', 'المجموع قبل الفاتورة'),
      invoice: l4('Nouvelle facture', 'New invoice', 'الفاتورة الجديدة', 'الفاتورة الجديدة'),
      surplus: l4('Surplus au-dessus du seuil', 'Surplus above the threshold', 'الفائض فوق السقف', 'الزيادة فوق السقف'),
      withholding: l4('Retenue à la source sur le surplus', 'Withholding on the surplus', 'الاقتطاع من المنبع على الفائض', 'الاقتطاع من المنبع على الزيادة'),
      net: l4('Net encaissé sur la facture', 'Net collected on the invoice', 'الصافي المقبوض من الفاتورة', 'الصافي اللي تقبض من الفاتورة'),
    },
    note: VECTOR,
  },
  vat_admit: {
    title: l4('Un taux de TVA refusé et les trois taux admis', 'One rejected VAT rate and the three admitted rates', 'نسبة TVA مرفوضة والنسب الثلاث المقبولة', 'نسبة TVA مرفوضة والنسب التلاتة المقبولة'),
    scenario: l4(
      'Une facture émise en février est saisie à {vat_rejected_sample} ; la même base de 10 000,00 MAD HT est ensuite recalculée aux trois taux admis.',
      'An invoice issued in February is entered at {vat_rejected_sample}; the same MAD 10,000.00 excl. tax base is then recomputed at the three admitted rates.',
      'فاتورة صادرة في فبراير أدخلت بنسبة {vat_rejected_sample}؛ ثم تحسب القاعدة نفسها (10 000,00 MAD بدون ضريبة) بالنسب الثلاث المقبولة.',
      'فاتورة صادرة فبراير تدخلات بنسبة {vat_rejected_sample}؛ من بعد كتتحسب نفس القاعدة (10 000,00 MAD بلا TVA) بالنسب التلاتة المقبولة.',
    ),
    labels: {
      ht: l4('Base HT', 'Base excl. tax', 'القاعدة بدون ضريبة', 'القاعدة بلا TVA'),
      rejected_code: l4('Code de rejet du taux non admis', 'Rejection code for the non-admitted rate', 'رمز رفض النسبة غير المقبولة', 'رمز رفض النسبة اللي ماشي مقبولة'),
      vat_standard: l4('TVA au taux standard', 'VAT at the standard rate', 'TVA بالنسبة العادية', 'TVA بالنسبة العادية'),
      vat_reduced: l4('TVA au taux réduit', 'VAT at the reduced rate', 'TVA بالنسبة المخفضة', 'TVA بالنسبة المخفضة'),
      vat_zero: l4('TVA au taux zéro', 'VAT at the zero rate', 'TVA بنسبة صفر', 'TVA بنسبة صفر'),
    },
    note: VECTOR,
  },
  btp: {
    title: l4('Décompte de travaux avec retenue de garantie et débours', 'Works statement with retention and disbursements', 'كشف حساب أشغال مع ضمان محتجز ومصاريف', 'كشف حساب ديال أشغال مع الضمان المحتجز والمصاريف'),
    scenario: l4(
      'Travaux de 100 000,00 MAD HT, débours de 5 000,00 MAD, retenue de garantie sur les travaux, TVA au taux standard.',
      'Works of MAD 100,000.00 excl. tax, disbursements of MAD 5,000.00, retention on the works, VAT at the standard rate.',
      'أشغال بمبلغ 100 000,00 MAD بدون ضريبة، مصاريف بمبلغ 5 000,00 MAD، ضمان محتجز على الأشغال، وTVA بالنسبة العادية.',
      'أشغال بـ 100 000,00 MAD بلا TVA، مصاريف بـ 5 000,00 MAD، ضمان محتجز على الأشغال، وTVA بالنسبة العادية.',
    ),
    labels: {
      works: l4('Travaux HT', 'Works excl. tax', 'الأشغال بدون ضريبة', 'الأشغال بلا TVA'),
      debours: l4('Débours (hors champ de la TVA)', 'Disbursements (outside VAT)', 'المصاريف (خارج نطاق TVA)', 'المصاريف (خارج TVA)'),
      retention: l4('Retenue de garantie', 'Retention', 'الضمان المحتجز', 'الضمان المحتجز'),
      vat_works: l4('TVA sur les travaux', 'VAT on the works', 'TVA على الأشغال', 'TVA على الأشغال'),
      deferred_vat: l4('TVA différée sur la retenue', 'Deferred VAT on retention', 'TVA المؤجلة على الضمان المحتجز', 'TVA المؤجلة على الضمان المحتجز'),
      vat_due_now: l4('TVA exigible au décompte', 'VAT due on the statement', 'TVA المستحقة عند الكشف', 'TVA المستحقة فالكشف'),
      debours_vat: l4('TVA sur les débours', 'VAT on disbursements', 'TVA على المصاريف', 'TVA على المصاريف'),
    },
    note: VECTOR,
  },
  ubl: {
    title: l4('Une facture de 12 000,00 MAD TTC dans les éléments UBL 2.1', 'A MAD 12,000.00 invoice in UBL 2.1 elements', 'فاتورة بمبلغ 12 000,00 MAD في عناصر UBL 2.1', 'فاتورة بـ 12 000,00 MAD فعناصر UBL 2.1'),
    scenario: l4(
      'Prestation de 10 000,00 MAD HT avec TVA au taux standard : où chaque montant se range dans le total monétaire UBL.',
      'Service of MAD 10,000.00 excl. tax with VAT at the standard rate: where each amount sits in the UBL monetary total.',
      'خدمة بمبلغ 10 000,00 MAD بدون ضريبة مع TVA بالنسبة العادية: موضع كل مبلغ في المجموع المالي لـ UBL.',
      'خدمة بـ 10 000,00 MAD بلا TVA مع TVA بالنسبة العادية: فين كيتحط كل مبلغ فالمجموع المالي ديال UBL.',
    ),
    labels: {
      exclusive: l4('TaxExclusiveAmount : total HT', 'TaxExclusiveAmount: total excl. tax', 'TaxExclusiveAmount: المجموع بدون ضريبة', 'TaxExclusiveAmount: المجموع بلا TVA'),
      tax: l4('TaxTotal / TaxAmount : TVA', 'TaxTotal / TaxAmount: VAT', 'TaxTotal / TaxAmount: TVA', 'TaxTotal / TaxAmount: TVA'),
      inclusive: l4('TaxInclusiveAmount : total TTC', 'TaxInclusiveAmount: total incl. tax', 'TaxInclusiveAmount: المجموع بالضريبة', 'TaxInclusiveAmount: المجموع بالـ TVA'),
      payable: l4('PayableAmount : net à payer', 'PayableAmount: net payable', 'PayableAmount: الصافي المستحق', 'PayableAmount: الصافي اللي خاص يتخلص'),
    },
    note: VECTOR,
  },
  credit_note: {
    title: l4('Un avoir qui annule une facture de 12 000,00 MAD TTC', 'A credit note cancelling a MAD 12,000.00 invoice', 'إشعار دائن يلغي فاتورة بمبلغ 12 000,00 MAD', 'إشعار دائن كيلغي فاتورة بـ 12 000,00 MAD'),
    scenario: l4(
      'L’avoir (type 381) référence la facture d’origine et reprend son montant intégral.',
      'The credit note (type 381) references the original invoice and takes over its full amount.',
      'يشير الإشعار الدائن (النوع 381) إلى الفاتورة الأصلية ويأخذ مبلغها كاملا.',
      'الإشعار الدائن (النوع 381) كيشير للفاتورة الأصلية وكياخد المبلغ ديالها كامل.',
    ),
    labels: {
      invoice: l4('Facture d’origine TTC', 'Original invoice incl. tax', 'الفاتورة الأصلية بالضريبة', 'الفاتورة الأصلية بالـ TVA'),
      credit: l4('Avoir TTC', 'Credit note incl. tax', 'الإشعار الدائن بالضريبة', 'الإشعار الدائن بالـ TVA'),
      balance: l4('Solde restant dû', 'Remaining balance', 'الرصيد المتبقي', 'الرصيد اللي بقا'),
    },
    note: VECTOR,
  },
  stamp: {
    title: l4('Droit de timbre sur un règlement en espèces de 7 200,00 MAD', 'Stamp duty on a MAD 7,200.00 cash payment', 'رسم الدمغة على أداء نقدي بمبلغ 7 200,00 MAD', 'رسم الطابع على خلاص بالكاش بـ 7 200,00 MAD'),
    scenario: l4(
      'Hypothèse de calcul : l’assiette est le montant réglé en espèces, au taux de timbre daté ci-dessous. À confirmer par un expert-comptable.',
      'Calculation assumption: the base is the amount paid in cash, at the dated stamp rate below. To be confirmed by a chartered accountant.',
      'فرضية الحساب: الوعاء هو المبلغ المؤدى نقدا، بنسبة الدمغة المؤرخة أدناه. يجب أن يؤكدها خبير محاسب.',
      'فرضية الحساب: الوعاء هو المبلغ اللي تخلص بالكاش، بنسبة الطابع المؤرخة لتحت. خاصها تتأكد من عند خبير محاسب.',
    ),
    labels: {
      cash: l4('Montant réglé en espèces', 'Amount paid in cash', 'المبلغ المؤدى نقدا', 'المبلغ اللي تخلص بالكاش'),
      stamp: l4('Droit de timbre', 'Stamp duty', 'رسم الدمغة', 'رسم الطابع'),
    },
    note: ILLUSTRATIVE,
  },
  drvt: {
    title: l4('Honoraires de 10 000,00 MAD : retenue selon le bénéficiaire', 'MAD 10,000.00 fees: withholding by beneficiary', 'أتعاب بمبلغ 10 000,00 MAD: الاقتطاع بحسب المستفيد', 'أتعاب بـ 10 000,00 MAD: الاقتطاع على حسب المستفيد'),
    scenario: l4(
      'Le même montant d’honoraires est retenu à deux taux datés, selon que le bénéficiaire est une personne morale soumise à l’IS ou une personne physique soumise à l’IR.',
      'The same fee amount is withheld at two dated rates, depending on whether the beneficiary is a company subject to corporate tax or an individual subject to income tax.',
      'يُقتطع مبلغ الأتعاب نفسه بنسبتين مؤرختين، بحسب كون المستفيد شخصا معنويا خاضعا للضريبة على الشركات أو شخصا ذاتيا خاضعا للضريبة على الدخل.',
      'نفس مبلغ الأتعاب كيتقتطع منو بجوج نسب مؤرخة، على حسب واش المستفيد شركة خاضعة للـ IS ولا شخص ذاتي خاضع للـ IR.',
    ),
    labels: {
      fees: l4('Honoraires bruts', 'Gross fees', 'الأتعاب الإجمالية', 'الأتعاب الإجمالية'),
      ras_legal: l4('Retenue : personne morale (IS)', 'Withholding: company (corporate tax)', 'الاقتطاع: شخص معنوي (IS)', 'الاقتطاع: شخص معنوي (IS)'),
      ras_individual: l4('Retenue : personne physique (IR)', 'Withholding: individual (income tax)', 'الاقتطاع: شخص ذاتي (IR)', 'الاقتطاع: شخص ذاتي (IR)'),
    },
    note: ILLUSTRATIVE,
  },
  rent: {
    title: l4('Loyers annuels de 120 000,00 MAD bruts', 'MAD 120,000.00 gross annual rents', 'إيجارات سنوية إجمالية بمبلغ 120 000,00 MAD', 'كرا سنوي إجمالي بـ 120 000,00 MAD'),
    scenario: l4(
      'Le montant correspond au palier de loyers bruts annuels cité par le cahier des charges ; les deux taux datés sont montrés sans choisir à la place du déclarant.',
      'The amount matches the annual gross rent tier quoted in the specification; both dated rates are shown without choosing on the filer’s behalf.',
      'المبلغ يوافق شريحة الإيجارات الإجمالية السنوية المذكورة في دفتر التحملات؛ وتُعرض النسبتان المؤرختان دون الاختيار نيابة عن المصرح.',
      'المبلغ هو شريحة الكرا الإجمالي السنوي المذكورة فدفتر التحملات؛ والنسبتين المؤرختين معروضين بلا ما نختارو بلاصة المصرح.',
    ),
    labels: {
      rent: l4('Loyers bruts annuels', 'Annual gross rents', 'الإيجارات الإجمالية السنوية', 'الكرا الإجمالي السنوي'),
      ras_low: l4('Retenue au premier taux daté', 'Withholding at the first dated rate', 'الاقتطاع بالنسبة المؤرخة الأولى', 'الاقتطاع بالنسبة المؤرخة الأولى'),
      ras_high: l4('Retenue au second taux daté', 'Withholding at the second dated rate', 'الاقتطاع بالنسبة المؤرخة الثانية', 'الاقتطاع بالنسبة المؤرخة الثانية'),
    },
    note: ILLUSTRATIVE,
  },
  foreign: {
    title: l4('Prestation d’un fournisseur étranger de 10 000,00 MAD', 'Service from a foreign supplier of MAD 10,000.00', 'خدمة من مورد أجنبي بمبلغ 10 000,00 MAD', 'خدمة من مورد أجنبي بـ 10 000,00 MAD'),
    scenario: l4(
      'Facture d’un non-résident : auto-liquidation de la TVA et retenue à la source de l’IS provisionnée avant le virement.',
      'Invoice from a non-resident: VAT self-assessment and corporate-tax withholding provisioned before the transfer.',
      'فاتورة من غير مقيم: تصفية ذاتية للـ TVA واقتطاع من المنبع للضريبة على الشركات يُرصد قبل التحويل.',
      'فاتورة ديال شي واحد ماشي مقيم: التصفية الذاتية ديال TVA والاقتطاع من المنبع ديال IS كيتحسب قبل التحويل.',
    ),
    labels: {
      invoice: l4('Facture du fournisseur étranger', 'Foreign supplier invoice', 'فاتورة المورد الأجنبي', 'فاتورة المورد الأجنبي'),
      self_vat: l4('TVA auto-liquidée', 'Self-assessed VAT', 'TVA المصفاة ذاتيا', 'TVA المصفاة ذاتيا'),
      ras: l4('Retenue à la source de l’IS provisionnée', 'Corporate-tax withholding provisioned', 'الاقتطاع من المنبع للضريبة على الشركات المرصود', 'الاقتطاع من المنبع ديال IS المرصود'),
      transfer: l4('Virement net au fournisseur', 'Net transfer to the supplier', 'التحويل الصافي للمورد', 'التحويل الصافي للمورد'),
    },
    note: ILLUSTRATIVE,
  },
  prorata: {
    title: l4('Dossier ajouté le 16 d’un mois de 30 jours', 'Client file added on the 16th of a 30-day month', 'ملف مضاف يوم 16 من شهر من 30 يوما', 'دوسي تزاد نهار 16 من شهر فيه 30 يوم'),
    scenario: l4(
      'Quinze jours actifs sur trente. La règle appliquée vient de la politique de facturation unique de Fisca : calcul au jour exact en centimes entiers, plancher d’un jour, sans mois minimum.',
      'Fifteen active days out of thirty. The rule applied comes from Fisca’s single billing policy: exact day-based calculation in whole cents, one-day floor, no minimum month.',
      'خمسة عشر يوما نشطا من ثلاثين. القاعدة المطبقة تأتي من سياسة الفوترة الموحدة لفيسكا: حساب يومي دقيق بالسنتيمات الصحيحة، حد أدنى يوم واحد، دون شهر أدنى.',
      'خمستاش يوم نشيط من تلاتين. القاعدة المطبقة جاية من سياسة الفوترة الموحدة ديال فيسكا: حساب باليوم بالضبط بالسنتيمات الصحيحة، على الأقل نهار واحد، بلا شهر أدنى.',
    ),
    labels: {
      tpe_full: l4('Dossier TPE, mois entier HT', 'TPE file, full month excl. tax', 'ملف TPE، شهر كامل بدون ضريبة', 'دوسي TPE، شهر كامل بلا TVA'),
      pme_full: l4('Dossier PME complet, mois entier HT', 'Full PME file, full month excl. tax', 'ملف PME كامل، شهر كامل بدون ضريبة', 'دوسي PME كامل، شهر كامل بلا TVA'),
      tpe_billed: l4('Dossier TPE : facturé ce mois', 'TPE file: billed this month', 'ملف TPE: المفوتر هذا الشهر', 'دوسي TPE: اللي تفوتر هاد الشهر'),
      pme_billed: l4('Dossier PME complet : facturé ce mois', 'Full PME file: billed this month', 'ملف PME كامل: المفوتر هذا الشهر', 'دوسي PME كامل: اللي تفوتر هاد الشهر'),
    },
    note: PRICING_NOTE,
  },
  meter_mid: {
    title: l4('Facture mensuelle d’un cabinet de 60 dossiers et 2 caisses', 'Monthly invoice of a 60-file firm with 2 tills', 'فاتورة شهرية لمكتب بـ 60 ملفا وصندوقين', 'فاتورة شهرية ديال مكتب فيه 60 دوسي وجوج كيسات'),
    scenario: l4(
      'Dix dossiers simplifiés, trente-cinq dossiers TPE, quinze dossiers PME complets, deux caisses POS partenaires et le socle cabinet.',
      'Ten simplified files, thirty-five TPE files, fifteen full PME files, two partner POS tills and the firm base.',
      'عشرة ملفات مبسطة، خمسة وثلاثون ملف TPE، خمسة عشر ملف PME كاملا، صندوقا POS شريكان وقاعدة المكتب.',
      'عشرة دوسيات مبسطة، خمسة وتلاتين دوسي TPE، خمستاش دوسي PME كامل، جوج كيسات POS شريكين وقاعدة المكتب.',
    ),
    labels: {
      base: l4('Socle cabinet', 'Firm base', 'قاعدة المكتب', 'قاعدة المكتب'),
      simplified: l4('10 dossiers simplifiés', '10 simplified files', '10 ملفات مبسطة', '10 دوسيات مبسطة'),
      tpe: l4('35 dossiers TPE', '35 TPE files', '35 ملف TPE', '35 دوسي TPE'),
      pme: l4('15 dossiers PME complets', '15 full PME files', '15 ملف PME كاملا', '15 دوسي PME كامل'),
      pos: l4('2 caisses POS partenaires', '2 partner POS tills', 'صندوقا POS شريكان', 'جوج كيسات POS شريكين'),
      ht: l4('Total HT', 'Total excl. tax', 'المجموع بدون ضريبة', 'المجموع بلا TVA'),
      vat: l4('TVA', 'VAT', 'TVA', 'TVA'),
      ttc: l4('Total TTC', 'Total incl. tax', 'المجموع بالضريبة', 'المجموع بالـ TVA'),
    },
    note: PRICING_NOTE,
  },
  volume: {
    title: l4('Cabinet de 100 dossiers actifs : la remise de volume', 'A 100-active-file firm: the volume discount', 'مكتب بـ 100 ملف نشط: تخفيض الحجم', 'مكتب فيه 100 دوسي نشيط: تخفيض الحجم'),
    scenario: l4(
      'Vingt dossiers simplifiés, cinquante dossiers TPE, trente dossiers PME complets : la remise s’applique aux lignes de dossiers, pas au socle.',
      'Twenty simplified files, fifty TPE files, thirty full PME files: the discount applies to file lines, not to the base.',
      'عشرون ملفا مبسطا، خمسون ملف TPE، ثلاثون ملف PME كاملا: يطبق التخفيض على سطور الملفات لا على القاعدة.',
      'عشرين دوسي مبسط، خمسين دوسي TPE، تلاتين دوسي PME كامل: التخفيض كيتطبق على سطور الدوسيات ماشي على القاعدة.',
    ),
    labels: {
      gross: l4('Lignes de dossiers avant remise', 'File lines before discount', 'سطور الملفات قبل التخفيض', 'سطور الدوسيات قبل التخفيض'),
      discount: l4('Remise de volume', 'Volume discount', 'تخفيض الحجم', 'تخفيض الحجم'),
      base: l4('Socle cabinet (non remisé)', 'Firm base (not discounted)', 'قاعدة المكتب (دون تخفيض)', 'قاعدة المكتب (بلا تخفيض)'),
      net: l4('Net HT', 'Net excl. tax', 'الصافي بدون ضريبة', 'الصافي بلا TVA'),
      vat: l4('TVA', 'VAT', 'TVA', 'TVA'),
      ttc: l4('Net TTC', 'Net incl. tax', 'الصافي بالضريبة', 'الصافي بالـ TVA'),
    },
    note: PRICING_NOTE,
  },
  mowakaba: {
    title: l4('Reste à charge des deux packs Mowakaba', 'Out-of-pocket cost of the two Mowakaba packs', 'المبلغ المتبقي على عاتق الزبون في حزمتي Mowakaba', 'اللي بقا على الكليان فحزمتين ديال Mowakaba'),
    scenario: l4(
      'Prix HT du pack moins la prise en charge basse puis haute de la fourchette annoncée. L’aide dépend de l’organisme financeur ; Fisca ne la garantit pas.',
      'Pack price excl. tax minus the low then high end of the announced coverage range. Funding depends on the funding body; Fisca does not guarantee it.',
      'ثمن الحزمة بدون ضريبة ناقص الحد الأدنى ثم الأعلى من نسبة التكفل المعلنة. يرجع التمويل إلى الجهة الممولة ولا تضمنه فيسكا.',
      'ثمن الحزمة بلا TVA ناقص الحد الأدنى من بعد الحد الأعلى ديال نسبة التكفل المعلنة. التمويل كيرجع للجهة الممولة وفيسكا ما كتضمنوش.',
    ),
    labels: {
      tpme_price: l4('Pack TPME HT', 'TPME pack excl. tax', 'حزمة TPME بدون ضريبة', 'حزمة TPME بلا TVA'),
      tpme_low_out: l4('Reste à charge TPME (prise en charge basse)', 'TPME out-of-pocket (low coverage)', 'المتبقي على عاتق TPME (تكفل أدنى)', 'اللي بقا على TPME (تكفل أدنى)'),
      tpme_high_out: l4('Reste à charge TPME (prise en charge haute)', 'TPME out-of-pocket (high coverage)', 'المتبقي على عاتق TPME (تكفل أعلى)', 'اللي بقا على TPME (تكفل أعلى)'),
      cabinet_price: l4('Pack Cabinet HT', 'Firm pack excl. tax', 'حزمة المكتب بدون ضريبة', 'حزمة المكتب بلا TVA'),
      cabinet_low_out: l4('Reste à charge Cabinet (prise en charge basse)', 'Firm out-of-pocket (low coverage)', 'المتبقي على عاتق المكتب (تكفل أدنى)', 'اللي بقا على المكتب (تكفل أدنى)'),
      cabinet_high_out: l4('Reste à charge Cabinet (prise en charge haute)', 'Firm out-of-pocket (high coverage)', 'المتبقي على عاتق المكتب (تكفل أعلى)', 'اللي بقا على المكتب (تكفل أعلى)'),
    },
    note: PRICING_NOTE,
  },
  pos_chr: {
    title: l4('Un restaurant avec trois caisses', 'A restaurant with three tills', 'مطعم بثلاثة صناديق', 'مطعم فيه تلاتة كيسات'),
    scenario: l4(
      'Le forfait Croissance inclut la première caisse tactile ; deux caisses additionnelles s’ajoutent au tarif mensuel public.',
      'The Growth plan includes the first touch till; two additional tills are added at the public monthly price.',
      'تشمل باقة Croissance أول صندوق لمسي؛ ويضاف صندوقان إضافيان بالتسعيرة الشهرية المعلنة.',
      'باقة Croissance فيها أول كايس تاكتيل؛ وكيتزادو جوج كيسات زايدين بالثمن الشهري المعلن.',
    ),
    labels: {
      plan: l4('Forfait Croissance, mensuel HT', 'Growth plan, monthly excl. tax', 'باقة Croissance، شهريا بدون ضريبة', 'باقة Croissance، شهريا بلا TVA'),
      extra_unit: l4('Une caisse additionnelle, mensuel HT', 'One additional till, monthly excl. tax', 'صندوق إضافي واحد، شهريا بدون ضريبة', 'كايس زايد واحد، شهريا بلا TVA'),
      extra_two: l4('Deux caisses additionnelles', 'Two additional tills', 'صندوقان إضافيان', 'جوج كيسات زايدين'),
      total: l4('Total mensuel HT', 'Monthly total excl. tax', 'المجموع الشهري بدون ضريبة', 'المجموع الشهري بلا TVA'),
    },
    note: PRICING_NOTE,
  },
  pos_fleet: {
    title: l4('Dix caisses : tarif standard ou tarif flotte', 'Ten tills: standard or fleet price', 'عشرة صناديق: التسعيرة العادية أو تسعيرة الأسطول', 'عشرة كيسات: الثمن العادي ولا ثمن الأسطول'),
    scenario: l4(
      'À partir de dix caisses, ou via un cabinet partenaire, le tarif flotte remplace le tarif de caisse additionnelle.',
      'From ten tills, or through a partner firm, the fleet price replaces the additional-till price.',
      'ابتداء من عشرة صناديق، أو عبر مكتب شريك، تحل تسعيرة الأسطول محل تسعيرة الصندوق الإضافي.',
      'من عشرة كيسات، ولا عبر مكتب شريك، ثمن الأسطول كيعوض ثمن الكايس الزايد.',
    ),
    labels: {
      std_ten: l4('Dix caisses au tarif additionnel, mensuel HT', 'Ten tills at the additional-till price, monthly excl. tax', 'عشرة صناديق بتسعيرة الإضافي، شهريا بدون ضريبة', 'عشرة كيسات بثمن الزايد، شهريا بلا TVA'),
      fleet_ten: l4('Dix caisses au tarif flotte, mensuel HT', 'Ten tills at the fleet price, monthly excl. tax', 'عشرة صناديق بتسعيرة الأسطول، شهريا بدون ضريبة', 'عشرة كيسات بثمن الأسطول، شهريا بلا TVA'),
      saving: l4('Écart mensuel HT', 'Monthly difference excl. tax', 'الفرق الشهري بدون ضريبة', 'الفرق الشهري بلا TVA'),
    },
    note: PRICING_NOTE,
  },
  annual_growth: {
    title: l4('Fisca Croissance : paiement annuel ou mensuel', 'Fisca Growth: annual or monthly payment', 'Fisca Croissance: الأداء السنوي أو الشهري', 'Fisca Croissance: الخلاص السنوي ولا الشهري'),
    scenario: l4(
      'Le paiement annuel règle dix mensualités pour douze mois d’utilisation.',
      'Annual payment settles ten monthly instalments for twelve months of use.',
      'يسدد الأداء السنوي عشرة أقساط شهرية مقابل اثني عشر شهرا من الاستعمال.',
      'الخلاص السنوي كيخلص عشر شهور على اثناعش شهر ديال الاستعمال.',
    ),
    labels: {
      monthly: l4('Mensualité HT', 'Monthly price excl. tax', 'الثمن الشهري بدون ضريبة', 'الثمن الشهري بلا TVA'),
      twelve: l4('Douze mensualités', 'Twelve monthly payments', 'اثنا عشر قسطا شهريا', 'اثناعش خلاص شهري'),
      annual: l4('Paiement annuel HT', 'Annual payment excl. tax', 'الأداء السنوي بدون ضريبة', 'الخلاص السنوي بلا TVA'),
      saving: l4('Économie annuelle HT', 'Annual saving excl. tax', 'التوفير السنوي بدون ضريبة', 'التوفير السنوي بلا TVA'),
    },
    note: PRICING_NOTE,
  },
  annual_essential: {
    title: l4('Fisca Essentiel : paiement annuel ou mensuel', 'Fisca Essential: annual or monthly payment', 'Fisca Essentiel: الأداء السنوي أو الشهري', 'Fisca Essentiel: الخلاص السنوي ولا الشهري'),
    scenario: l4(
      'Le paiement annuel règle dix mensualités pour douze mois d’utilisation.',
      'Annual payment settles ten monthly instalments for twelve months of use.',
      'يسدد الأداء السنوي عشرة أقساط شهرية مقابل اثني عشر شهرا من الاستعمال.',
      'الخلاص السنوي كيخلص عشر شهور على اثناعش شهر ديال الاستعمال.',
    ),
    labels: {
      monthly: l4('Mensualité HT', 'Monthly price excl. tax', 'الثمن الشهري بدون ضريبة', 'الثمن الشهري بلا TVA'),
      twelve: l4('Douze mensualités', 'Twelve monthly payments', 'اثنا عشر قسطا شهريا', 'اثناعش خلاص شهري'),
      annual: l4('Paiement annuel HT', 'Annual payment excl. tax', 'الأداء السنوي بدون ضريبة', 'الخلاص السنوي بلا TVA'),
      saving: l4('Économie annuelle HT', 'Annual saving excl. tax', 'التوفير السنوي بدون ضريبة', 'التوفير السنوي بلا TVA'),
    },
    note: PRICING_NOTE,
  },
  z_ticket: {
    title: l4('Un Ticket Z qui totalise deux ventes', 'A Z ticket totalling two sales', 'تذكرة Z تجمع بيعتين', 'تيكي Z كيجمع جوج مبيعات'),
    scenario: l4(
      'Deux tickets de caisse, de 12 000,00 MAD et de 7 200,00 MAD TTC, sont clôturés ensemble ; la TVA est extraite du total au taux standard daté.',
      'Two till receipts, of MAD 12,000.00 and MAD 7,200.00 including tax, are closed together; VAT is extracted from the total at the dated standard rate.',
      'تغلق تذكرتا صندوق، بمبلغ 12 000,00 MAD و7 200,00 MAD بالضريبة، معا؛ وتُستخرج TVA من المجموع بالنسبة العادية المؤرخة.',
      'تيكيتين ديال الكايس، 12 000,00 MAD و7 200,00 MAD بالـ TVA، كيتسدو مجموعين؛ والـ TVA كتتخرج من المجموع بالنسبة العادية المؤرخة.',
    ),
    labels: {
      first: l4('Premier ticket TTC', 'First receipt incl. tax', 'التذكرة الأولى بالضريبة', 'التيكي الأول بالـ TVA'),
      second: l4('Second ticket TTC', 'Second receipt incl. tax', 'التذكرة الثانية بالضريبة', 'التيكي الثاني بالـ TVA'),
      total: l4('Total du Ticket Z TTC', 'Z ticket total incl. tax', 'مجموع تذكرة Z بالضريبة', 'مجموع تيكي Z بالـ TVA'),
      ht: l4('Part HT', 'Excl. tax part', 'الجزء بدون ضريبة', 'الجزء بلا TVA'),
      vat: l4('TVA contenue', 'VAT included', 'TVA المتضمنة', 'TVA اللي فيه'),
    },
    note: ILLUSTRATIVE,
  },
  qr_convert: {
    title: l4('Ticket de 12 000,00 MAD converti en facture B2B', 'A MAD 12,000.00 receipt converted to a B2B invoice', 'تذكرة بمبلغ 12 000,00 MAD محولة إلى فاتورة B2B', 'تيكي بـ 12 000,00 MAD تحول لفاتورة B2B'),
    scenario: l4(
      'Le Ticket Z du jour est déjà comptabilisé : la conversion crée la facture et extourne la vente B2C dans une seule transaction.',
      'The day’s Z ticket is already booked: the conversion creates the invoice and reverses the B2C sale in a single transaction.',
      'تذكرة Z لليوم مسجلة محاسبيا: ينشئ التحويل الفاتورة ويعكس بيع B2C في معاملة واحدة.',
      'تيكي Z ديال النهار تسجل فالمحاسبة: التحويل كينشئ الفاتورة وكيرجع بيعة B2C فمعاملة وحدة.',
    ),
    labels: {
      ticket: l4('Ticket B2C TTC', 'B2C receipt incl. tax', 'تذكرة B2C بالضريبة', 'تيكي B2C بالـ TVA'),
      invoice: l4('Facture B2B créée', 'B2B invoice created', 'فاتورة B2B المنشأة', 'فاتورة B2B اللي تصاوبت'),
      reversal: l4('Extourne B2C du jour', 'B2C reversal of the day', 'عكس B2C لليوم', 'رجوع B2C ديال النهار'),
      residual: l4('Chiffre d’affaires compté deux fois', 'Revenue counted twice', 'رقم المعاملات المحتسب مرتين', 'رقم المعاملات اللي تحسب جوج مرات'),
    },
    note: ILLUSTRATIVE,
  },
};
