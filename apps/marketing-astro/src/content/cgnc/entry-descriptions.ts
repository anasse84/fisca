/**
 * Intitulés des écritures d'exemple en trois langues, un par compte. Le français reprend `description_fr` du jeu,
 * sans les taux chiffrés : aucun taux n'est écrit dans un texte public (ADR-04), les montants viennent du jeu.
 */
import type { T3 } from './copy.ts';

function d(fr: string, en: string, ar: string): T3 {
  return { fr, en, ar };
}

export const ENTRY_DESCRIPTIONS: Readonly<Record<string, T3>> = {
  '1111': d('Libération du capital social initial par virement bancaire', 'Payment of the initial share capital by bank transfer', 'تحرير رأس المال الاجتماعي الأولي عن طريق تحويل بنكي'),
  '1140': d('Affectation d’une part du bénéfice net à la réserve légale', 'Allocation of part of the net profit to the legal reserve', 'تخصيص جزء من الربح الصافي للاحتياطي القانوني'),
  '1161': d('Affectation par l’assemblée du résultat en instance au report à nouveau', 'Appropriation by the general meeting of the pending result to retained earnings', 'تخصيص الجمعية العامة للنتيجة المعلقة للترحيل من جديد'),
  '1181': d('Constatation du résultat net de l’exercice en instance d’affectation, dans l’attente de la décision de l’assemblée', 'Recording of the net result of the year pending appropriation, awaiting the decision of the general meeting', 'إثبات النتيجة الصافية للسنة في انتظار التخصيص، ريثما تقرر الجمعية العامة'),
  '1191': d('Constatation du bénéfice net à l’ouverture de l’exercice suivant', 'Recording of the net profit at the opening of the next fiscal year', 'إثبات الربح الصافي عند افتتاح السنة المحاسبية الموالية'),
  '1481': d('Déblocage d’un emprunt bancaire d’investissement à moyen terme', 'Drawdown of a medium-term bank investment loan', 'صرف قرض بنكي للاستثمار متوسط الأجل'),
  '1511': d('Dotation d’une provision durable pour litige commercial', 'Allocation of a long-term provision for a commercial dispute', 'تخصيص مؤونة دائمة لنزاع تجاري'),
  '2111': d('Inscription des droits d’enregistrement et frais de création', 'Recording of registration duties and incorporation costs', 'تسجيل رسوم التسجيل ومصاريف التأسيس'),
  '2230': d('Acquisition d’un fonds commercial par virement notarié', 'Purchase of a business goodwill by notarised transfer', 'اقتناء أصل تجاري عن طريق تحويل موثق'),
  '2321': d('Acquisition d’un local professionnel neuf (TVA sur immobilisations)', 'Purchase of a new business premises (VAT on fixed assets)', 'اقتناء محل مهني جديد (TVA على التثبيتات)'),
  '2332': d('Facture d’achat d’une machine industrielle (TVA en attente)', 'Purchase invoice for an industrial machine (VAT pending)', 'فاتورة شراء آلة صناعية (TVA في الانتظار)'),
  '2340': d('Acquisition d’un véhicule utilitaire de livraison (HT et TVA sur immobilisations)', 'Purchase of a delivery van (excl. tax and VAT on fixed assets)', 'اقتناء سيارة نفعية للتوصيل (بدون ضريبة وTVA على التثبيتات)'),
  '2355': d('Achat de postes de travail et de terminaux tactiles (TVA incluse)', 'Purchase of workstations and touch terminals (VAT included)', 'شراء محطات عمل ومحطات لمسية (TVA مشمولة)'),
  '2486': d('Versement de deux mois de caution de bail commercial', 'Payment of a two-month commercial lease deposit', 'أداء ضمانة كراء تجاري عن شهرين'),
  '2835': d('Dotation annuelle aux amortissements du parc informatique', 'Annual depreciation charge on the IT equipment', 'مخصصات سنوية لاستهلاك العتاد المعلوماتي'),
  '3111': d('Constatation du stock final de marchandises à l’inventaire', 'Recording of the closing merchandise stock at the inventory', 'إثبات المخزون النهائي للبضائع عند الجرد'),
  '3421': d('Facture de vente B2B à crédit (TVA collectée en attente, compte 44558)', 'B2B credit sales invoice (collected VAT pending, account 44558)', 'فاتورة بيع بالأجل بين الشركات (TVA المحصلة في الانتظار، الحساب 44558)'),
  '3424': d('Reclassement d’une créance client impayée en client douteux', 'Reclassification of an unpaid customer receivable as doubtful', 'إعادة تصنيف دين زبون غير مؤدى كزبون مشكوك فيه'),
  '3425': d('Acceptation d’une LCN client (la TVA reste en 44558 jusqu’à l’encaissement)', 'Acceptance of a customer promissory note, LCN (VAT stays in 44558 until collection)', 'قبول كمبيالة زبون LCN (تبقى TVA في الحساب 44558 إلى حين التحصيل)'),
  '3453': d('Paiement d’un acompte provisionnel trimestriel d’IS à la DGI', 'Payment of a quarterly corporate income tax (IS) installment to the DGI', 'أداء تسبيق فصلي من IS إلى DGI'),
  '34551': d('Activation de la TVA récupérable sur immobilisation après règlement', 'Activation of recoverable VAT on a fixed asset after settlement', 'تفعيل TVA القابلة للاسترجاع على تثبيت بعد التسديد'),
  '34552': d('Virement de la TVA sur charges devenue déductible au décaissement', 'Transfer of VAT on expenses that became deductible on payment', 'تحويل TVA على التحملات التي أصبحت قابلة للخصم عند الأداء'),
  '34558': d('Constatation de la TVA en attente sur facture fournisseur non réglée', 'Recording of pending VAT on an unpaid supplier invoice', 'إثبات TVA في الانتظار على فاتورة مورد غير مسددة'),
  '3456': d('Liquidation mensuelle SIMPL-TVA dégageant un crédit reportable', 'Monthly SIMPL-TVA settlement producing a carry-forward credit', 'تصفية شهرية SIMPL-TVA تُنتج رصيدا دائنا قابلا للترحيل'),
  '3488': d('Avance de frais administratifs au nom et pour le compte du client', 'Advance of administrative costs in the name and on behalf of the client', 'تسبيق مصاريف إدارية باسم الزبون ولحسابه'),
  '3497': d('Isolement d’un prélèvement bancaire ambigu en attente de pièce', 'Isolation of an ambiguous bank debit pending a supporting document', 'عزل اقتطاع بنكي غامض في انتظار الوثيقة'),
  '4411': d('Réception d’une facture fournisseur de marchandises à 60 jours', 'Receipt of a supplier invoice for merchandise payable at 60 days', 'استلام فاتورة مورد للبضائع مستحقة بعد 60 يوما'),
  '4415': d('Remise d’une LCN à échéance au fournisseur (la TVA reste en 34558)', 'Delivery of a promissory note, LCN, to the supplier (VAT stays in 34558)', 'تسليم كمبيالة LCN للمورد (تبقى TVA في الحساب 34558)'),
  '4421': d('Encaissement d’un acompte client avec exigibilité immédiate de TVA', 'Collection of a customer deposit with immediate VAT due', 'تحصيل تسبيق زبون مع استحقاق فوري لـ TVA'),
  '4432': d('Virement des salaires nets mensuels au personnel', 'Transfer of the monthly net salaries to staff', 'تحويل الأجور الصافية الشهرية إلى المستخدمين'),
  '4441': d('Télépaiement DAMANCOM des cotisations salariales et patronales CNSS', 'DAMANCOM online payment of employee and employer CNSS contributions', 'الأداء الإلكتروني عبر DAMANCOM لاشتراكات CNSS الخاصة بالأجير والمشغل'),
  '44525': d('Reversement mensuel SIMPL-IR de l’impôt retenu sur salaires', 'Monthly SIMPL-IR remittance of the tax withheld on salaries', 'الأداء الشهري عبر SIMPL-IR للضريبة المقتطعة من الأجور'),
  '4453': d('Constatation de l’impôt sur les sociétés dû en fin d’exercice', 'Recording of the corporate income tax due at year end', 'إثبات الضريبة على الشركات المستحقة في نهاية السنة'),
  '44551': d('Bascule de la TVA collectée en attente vers la TVA exigible à l’encaissement', 'Transfer of pending collected VAT to VAT due on collection', 'تحويل TVA المحصلة في الانتظار إلى TVA المستحقة عند التحصيل'),
  '44558': d('Émission d’une facture client non encore encaissée (régime d’encaissement)', 'Issue of a customer invoice not yet collected (cash-basis regime)', 'إصدار فاتورة زبون لم تُحصَّل بعد (نظام التحصيل)'),
  '4456': d('Centralisation de la déclaration SIMPL-TVA mensuelle nette à payer', 'Centralisation of the monthly SIMPL-TVA return with net VAT payable', 'تجميع التصريح الشهري SIMPL-TVA بصافي TVA الواجبة الأداء'),
  '4457': d('Règlement fournisseur avec retenue à la source RAS-TVA (art. 117)', 'Supplier payment with RAS-TVA withholding at source (art. 117)', 'تسديد مورد مع الاقتطاع من المنبع RAS-TVA (المادة 117)'),
  '4497': d('Réception d’un virement bancaire sans référence client identifiable', 'Receipt of a bank transfer with no identifiable customer reference', 'استلام تحويل بنكي دون مرجع زبون يمكن تحديده'),
  '5141': d('Encaissement par virement bancaire d’une facture client échue', 'Bank transfer collection of an overdue customer invoice', 'تحصيل فاتورة زبون مستحقة عن طريق تحويل بنكي'),
  '5161': d('Encaissement en espèces à la clôture du Ticket Z (ventes HT, TVA et timbre)', 'Cash collection at Z ticket closing (excl.-tax sales, VAT and stamp duty)', 'تحصيل نقدي عند إغلاق تذكرة Z (مبيعات بدون ضريبة وTVA ورسم الطابع)'),
  '5541': d('Remboursement d’une ligne de découvert bancaire à court terme', 'Repayment of a short-term bank overdraft line', 'تسديد خط سحب على المكشوف قصير الأجل'),
  '6111': d('Achat de marchandises destinées à la revente en l’état (avec TVA)', 'Purchase of merchandise for resale as is (with VAT)', 'شراء بضائع معدة لإعادة البيع على حالها (مع TVA)'),
  '6121': d('Approvisionnement en matières premières de production', 'Supply of production raw materials', 'التزود بالمواد الأولية للإنتاج'),
  '6125': d('Facture d’électricité professionnelle réglée par prélèvement bancaire', 'Business electricity invoice settled by direct debit', 'فاتورة كهرباء مهنية مسددة بالاقتطاع البنكي'),
  '6131': d('Paiement du loyer mensuel de bureaux avec retenue à la source sur loyer', 'Payment of the monthly office rent with withholding at source on rent', 'أداء كراء المكاتب الشهري مع الاقتطاع من المنبع على الكراء'),
  '6134': d('Règlement de la prime annuelle d’assurance multirisque professionnelle', 'Payment of the annual professional multi-risk insurance premium', 'تسديد القسط السنوي للتأمين المهني متعدد المخاطر'),
  '6136': d('Facture d’honoraires fiduciaire OEC (TVA en attente)', 'Chartered accountant (OEC) fiduciary fee invoice (VAT pending)', 'فاتورة أتعاب مكتب محاسبة OEC (TVA في الانتظار)'),
  '6142': d('Facture de transport routier national de marchandises', 'Invoice for national road freight', 'فاتورة نقل بري وطني للبضائع'),
  '6145': d('Facture mensuelle de fibre optique et de flotte mobile (avec TVA)', 'Monthly invoice for fibre internet and mobile fleet (with VAT)', 'فاتورة شهرية للألياف البصرية وأسطول الهواتف (مع TVA)'),
  '61473': d('Prélèvement de commission monétique TPE (TVA bancaire)', 'Card terminal (TPE) processing commission debit (bank VAT)', 'اقتطاع عمولة النقديات الإلكترونية TPE (TVA البنكية)'),
  '6171': d('Comptabilisation du livre de paie mensuel (brut, CNSS salariale, IR, net)', 'Booking of the monthly payroll (gross, employee CNSS, IR, net)', 'تسجيل دفتر الأجور الشهري (الإجمالي، CNSS الأجير، IR، الصافي)'),
  '6311': d('Prélèvement des intérêts mensuels d’emprunt bancaire (avec TVA)', 'Debit of the monthly bank loan interest (with VAT)', 'اقتطاع الفوائد الشهرية لقرض بنكي (مع TVA)'),
  '6583': d('Paiement d’une amende pécuniaire Loi 69-21 à réintégrer au Tableau 3 de l’IS', 'Payment of a Law 69-21 fine to be added back in IS Table 3', 'أداء غرامة مالية بموجب القانون 69-21 تُعاد إلى الجدول 3 من IS'),
  '7111': d('Facture de vente de marchandises au Maroc soumise à la TVA', 'Invoice for domestic sales of merchandise subject to VAT', 'فاتورة بيع بضائع بالمغرب خاضعة لـ TVA'),
  '7119': d('Émission d’une facture d’avoir UBL 381 pour remise commerciale sur ventes', 'Issue of a UBL 381 credit note for a trade discount on sales', 'إصدار فاتورة دائنة UBL 381 لتخفيض تجاري على المبيعات'),
  '7121': d('Facturation de produits finis livrés à un client industriel marocain', 'Invoicing of finished goods delivered to a Moroccan industrial customer', 'فوترة منتوجات تامة الصنع سُلمت إلى زبون صناعي مغربي'),
  '7124': d('Facturation d’une prestation de conseil informatique au Maroc (avec TVA)', 'Invoicing of an IT consulting service in Morocco (with VAT)', 'فوترة خدمة استشارة معلوماتية بالمغرب (مع TVA)'),
  '7127': d('Refacturation de frais de livraison forfaitaires sur facture client', 'Re-invoicing of flat-rate delivery costs on a customer invoice', 'إعادة فوترة مصاريف التوصيل الجزافية على فاتورة الزبون'),
  '7381': d('Encaissement net d’intérêts créditeurs sur dépôt à terme bancaire', 'Net collection of interest income on a bank term deposit', 'تحصيل صافي فوائد دائنة على وديعة بنكية لأجل'),
  '8100': d('Virement pour solde des produits et charges d’exploitation à la clôture', 'Closing transfer balancing operating income and expenses', 'تحويل لتصفية منتوجات وتحملات الاستغلال عند الإقفال'),
  '8800': d('Détermination du résultat net comptable après imputation de l’IS', 'Determination of the accounting net result after corporate tax', 'تحديد النتيجة الصافية المحاسبية بعد خصم IS'),
};

export function entryDescription(accountNumber: string): T3 | undefined {
  return ENTRY_DESCRIPTIONS[accountNumber];
}
