import type { ToolPageCopy } from './page-types.ts';
import { t } from './common.ts';

/** Page « Validateur local UBL / FEC-MA » : contrôle de structure indicatif, jamais une validation DGI (ERRATA B-13). */
export const UBL_FEC_PAGE: ToolPageCopy = {
  title: t(
    'Validateur local UBL et FEC-MA : contrôle de structure, pas une validation DGI',
    'Local UBL and FEC-MA checker: structure check, not a DGI validation',
    'مدقق UBL وFEC-MA محلي: فحص للبنية وليس مصادقة من DGI',
    'مدقق UBL وFEC-MA محلي: تحقق د البنية ماشي مصادقة د DGI',
  ),
  description: t(
    'Contrôlez dans votre navigateur la structure d’un fichier FEC à 24 colonnes (pipe, CRLF, journal AN, équilibre au centime) ou d’une facture UBL 2.1 (types 380 à 389, ICE, IF). Contrôle de structure indicatif : pas une validation DGI, aucun envoi à un serveur.',
    'Check in your browser the structure of a 24-column FEC file (pipe, CRLF, AN journal, balance to the cent) or of a UBL 2.1 invoice (types 380 to 389, ICE, IF). Indicative structure check: not a DGI validation, nothing is sent to a server.',
    'افحص داخل متصفحك بنية ملف FEC من 24 عمودا (الفاصل |، نهايات الأسطر CRLF، دفتر AN، التوازن حتى السنتيم) أو فاتورة UBL 2.1 (الأنواع 380 إلى 389، ICE، IF). فحص إرشادي للبنية: ليس مصادقة من DGI ولا يُرسل أي شيء إلى خادم.',
    'تحقق فالمتصفح ديالك من بنية ملف FEC د 24 عمود (الفاصل |، نهايات الأسطر CRLF، دفتر AN، التوازن حتى السنتيم) ولا فاتورة UBL 2.1 (الأنواع 380 حتى 389، ICE، IF). تحقق إرشادي د البنية: ماشي مصادقة د DGI وما كيتصيفط والو لسيرفر.',
  ),
  heading: t('Validateur local UBL / FEC-MA', 'Local UBL / FEC-MA checker', 'مدقق UBL / FEC-MA المحلي', 'مدقق UBL / FEC-MA المحلي'),
  lead: t(
    'Déposez un fichier FEC (.txt) ou collez une facture UBL 2.1 (XML) : l’outil contrôle la structure, localement. C’est un contrôle de structure indicatif, pas une validation DGI : les schémas officiels de la facturation électronique ne sont pas publiés, le contrôle s’appuie sur un profil provisoire.',
    'Drop an FEC file (.txt) or paste a UBL 2.1 invoice (XML): the tool checks the structure, locally. It is an indicative structure check, not a DGI validation: the official e-invoicing schemas are not published, so the check relies on a provisional profile.',
    'أسقط ملف FEC (.txt) أو الصق فاتورة UBL 2.1 (XML): تفحص الأداة البنية محليا. هذا فحص إرشادي للبنية وليس مصادقة من DGI: المخططات الرسمية للفوترة الإلكترونية غير منشورة، ويعتمد الفحص على ملف تعريف مؤقت.',
    'سقط ملف FEC (.txt) ولا لصق فاتورة UBL 2.1 (XML): الأداة كتفحص البنية محليا. هادا تحقق إرشادي د البنية ماشي مصادقة د DGI: المخططات الرسمية د الفوترة الإلكترونية ما منشورينش، والتحقق معتمد على ملف تعريف مؤقت.',
  ),
  summary: t(
    'FEC : 24 colonnes séparées par un pipe, fins de ligne CRLF, UTF-8, journal AN en tête et équilibré, débit = crédit par écriture et sur le fichier. UBL : XML bien formé, racine Invoice ou CreditNote, type 380, 381, 383, 386 ou 389, ICE et IF avec leur schemeID. Contrôle de structure indicatif, pas une validation DGI.',
    'FEC: 24 pipe-separated columns, CRLF line ends, UTF-8, AN journal first and balanced, debit = credit per entry and across the file. UBL: well-formed XML, Invoice or CreditNote root, type 380, 381, 383, 386 or 389, ICE and IF with their schemeID. Indicative structure check, not a DGI validation.',
    'FEC: 24 عمودا مفصولة بـ|، نهايات أسطر CRLF، UTF-8، دفتر AN في الأول ومتوازن، المدين = الدائن لكل قيد وللملف. UBL: XML سليم الشكل، جذر Invoice أو CreditNote، نوع 380 أو 381 أو 383 أو 386 أو 389، وICE وIF مع schemeID. فحص إرشادي للبنية وليس مصادقة من DGI.',
    'FEC: 24 عمود مفصولين بـ|، نهايات أسطر CRLF، UTF-8، دفتر AN فالأول ومتوازن، المدين = الدائن لكل قيد وللملف. UBL: XML سليم الشكل، جذر Invoice ولا CreditNote، نوع 380 ولا 381 ولا 383 ولا 386 ولا 389، وICE وIF مع schemeID. تحقق إرشادي د البنية ماشي مصادقة د DGI.',
  ),
  steps: {
    fr: [
      { name: 'Choisir le type de fichier', text: 'Utilisez le bloc FEC pour un fichier plat .txt, le bloc UBL pour une facture XML. Les PDF et les Factur-X ne sont pas lus : collez ou chargez le XML.' },
      { name: 'Charger ou coller', text: 'Chargez le fichier (traitement local) ou collez le XML dans la zone de texte. Pour le FEC, le nom du fichier est contrôlé aussi : IF + FEC + date AAAAMMJJ + .txt, par exemple 12345678FEC20261231.txt.' },
      { name: 'Lire le contrôle de structure', text: 'Chaque contrôle est affiché avec son origine : spécifications de Fisca (profil provisoire), norme OASIS UBL 2.1 ou forme XML. Les lignes en cause sont numérotées.' },
      { name: 'Corriger et faire valider', text: 'Corrigez la source comptable puis recommencez. Un contrôle réussi ne vaut ni dépôt ni validation DGI : faites valider le fichier par votre expert-comptable.' },
    ],
    en: [
      { name: 'Pick the file type', text: 'Use the FEC block for a flat .txt file, the UBL block for an XML invoice. PDFs and Factur-X are not read: paste or load the XML.' },
      { name: 'Load or paste', text: 'Load the file (local processing) or paste the XML in the text area. For FEC, the file name is checked too: IF + FEC + date YYYYMMDD + .txt, for example 12345678FEC20261231.txt.' },
      { name: 'Read the structure check', text: 'Each check is shown with its origin: Fisca specifications (provisional profile), OASIS UBL 2.1 standard or XML form. Offending lines are numbered.' },
      { name: 'Fix and have it validated', text: 'Fix the accounting source and run it again. A passing check is neither a filing nor a DGI validation: have the file validated by your accountant.' },
    ],
    ar: [
      { name: 'اختيار نوع الملف', text: 'استعمل خانة FEC لملف .txt مسطح، وخانة UBL لفاتورة XML. لا تُقرأ ملفات PDF ولا Factur-X: الصق ملف XML أو حمّله.' },
      { name: 'التحميل أو اللصق', text: 'حمّل الملف (معالجة محلية) أو الصق XML في خانة النص. وبالنسبة لـ FEC يُفحص اسم الملف أيضا: IF + FEC + التاريخ AAAAMMJJ + .txt، مثلا 12345678FEC20261231.txt.' },
      { name: 'قراءة فحص البنية', text: 'يظهر كل فحص مع مصدره: مواصفات Fisca (ملف تعريف مؤقت) أو معيار OASIS UBL 2.1 أو شكل XML. وتُرقَّم الأسطر المعنية.' },
      { name: 'التصحيح والاعتماد', text: 'صحّح المصدر المحاسبي ثم أعد المحاولة. ونجاح الفحص ليس إيداعا ولا مصادقة من DGI: اعرض الملف على خبيرك المحاسب.' },
    ],
    ary: [
      { name: 'ختار نوع الملف', text: 'استعمل خانة FEC لملف .txt مسطح، وخانة UBL لفاتورة XML. PDF وFactur-X ما كيتقراوش: لصق XML ولا حملو.' },
      { name: 'حمل ولا لصق', text: 'حمل الملف (معالجة محلية) ولا لصق XML فخانة النص. وفـ FEC كيتفحص حتى سمية الملف: IF + FEC + التاريخ AAAAMMJJ + .txt، بحال 12345678FEC20261231.txt.' },
      { name: 'قرا تحقق البنية', text: 'كل تحقق كيبان مع المصدر ديالو: مواصفات Fisca (ملف تعريف مؤقت) ولا معيار OASIS UBL 2.1 ولا شكل XML. والسطور المعنية مرقمة.' },
      { name: 'صلح وخلي يتأكد', text: 'صلح المصدر المحاسبي وعاود. ونجاح التحقق ماشي إيداع ولا مصادقة د DGI: عرض الملف على الخبير المحاسب ديالك.' },
    ],
  },
  faqs: {
    fr: [
      { question: 'Cet outil valide-t-il mon FEC ou ma facture auprès de la DGI ?', answer: 'Non. C’est un contrôle de structure indicatif, exécuté dans votre navigateur : il ne dépose rien, ne contacte aucun serveur et ne vaut pas validation DGI. Au 2026-11-13, ni la DGI ni xHub n’ont publié de spécification technique de la facturation électronique : le contrôle UBL s’appuie sur un profil provisoire, cius-ma-provisional.' },
      { question: 'La continuité des empreintes SHA-256 du FEC est-elle vérifiée ?', answer: 'Non. Les colonnes EntryHashSHA256 et PrevHashSHA256 figurent dans le profil, mais les spécifications de Fisca ne documentent aucune formule de calcul : l’outil ne la vérifie donc pas et l’affiche à l’écran, au lieu d’en inventer une.' },
      { question: 'Mon fichier est-il envoyé quelque part ? Puis-je contrôler un Factur-X ou un PDF ?', answer: 'Aucun fichier n’est envoyé : tout se passe dans votre navigateur, sans cookie ni script tiers. Les PDF et les Factur-X ne sont pas pris en charge : seul le XML UBL collé ou chargé est lu, et aucun schéma XSD n’est exécuté.' },
    ],
    en: [
      { question: 'Does this tool validate my FEC or invoice with the DGI?', answer: 'No. It is an indicative structure check run in your browser: it files nothing, contacts no server and is not a DGI validation. As of 2026-11-13, neither the DGI nor xHub has published a technical specification for e-invoicing: the UBL check relies on a provisional profile, cius-ma-provisional.' },
      { question: 'Is the continuity of the FEC SHA-256 hashes verified?', answer: 'No. The EntryHashSHA256 and PrevHashSHA256 columns are in the profile, but Fisca’s specifications document no computation formula: the tool therefore does not verify it and says so on screen, rather than inventing one.' },
      { question: 'Is my file sent anywhere? Can I check a Factur-X or a PDF?', answer: 'No file is sent: everything happens in your browser, with no cookie and no third-party script. PDFs and Factur-X are not supported: only pasted or loaded UBL XML is read, and no XSD schema is run.' },
    ],
    ar: [
      { question: 'هل تصادق هذه الأداة على FEC أو فاتورتي لدى DGI؟', answer: 'لا. هذا فحص إرشادي للبنية يعمل داخل متصفحك: لا يودع شيئا ولا يتصل بأي خادم وليس مصادقة من DGI. حتى 2026-11-13 لم تنشر DGI ولا xHub أي مواصفة تقنية للفوترة الإلكترونية: ويعتمد فحص UBL على ملف تعريف مؤقت هو cius-ma-provisional.' },
      { question: 'هل يُتحقق من تسلسل بصمات SHA-256 في FEC؟', answer: 'لا. عمودا EntryHashSHA256 وPrevHashSHA256 موجودان في ملف التعريف، لكن مواصفات Fisca لا توثق أي صيغة حساب: لذلك لا تتحقق الأداة منها وتعلن ذلك على الشاشة بدل اختراع صيغة.' },
      { question: 'هل يُرسل ملفي إلى مكان ما؟ وهل يمكن فحص Factur-X أو PDF؟', answer: 'لا يُرسل أي ملف: كل شيء يجري داخل متصفحك دون كوكيز ودون سكربت خارجي. ولا تُدعم ملفات PDF وFactur-X: لا يُقرأ إلا XML من نوع UBL الملصوق أو المحمَّل، ولا يُنفَّذ أي مخطط XSD.' },
    ],
    ary: [
      { question: 'واش هاد الأداة كتصادق على FEC ولا الفاتورة ديالي عند DGI؟', answer: 'لا. هادا تحقق إرشادي د البنية كيخدم فالمتصفح ديالك: ما كيودع والو وما كيتصل بحتى سيرفر وماشي مصادقة د DGI. حتى 2026-11-13 DGI وxHub ما نشرو حتى مواصفة تقنية د الفوترة الإلكترونية: وتحقق UBL معتمد على ملف تعريف مؤقت هو cius-ma-provisional.' },
      { question: 'واش كيتحقق من تسلسل بصمات SHA-256 د FEC؟', answer: 'لا. العمودين EntryHashSHA256 وPrevHashSHA256 كاينين فملف التعريف، ولكن مواصفات Fisca ما كتوثق حتى صيغة د الحساب: علاش الأداة ما كتتحققش منها وكتقولها فالشاشة عوض ما تخترع صيغة.' },
      { question: 'واش الملف ديالي كيتصيفط لشي بلاصة؟ وواش نقدر نفحص Factur-X ولا PDF؟', answer: 'ما كيتصيفط حتى ملف: كلشي كيدوز فالمتصفح ديالك بلا كوكيز وبلا سكريبت د برا. PDF وFactur-X ما مدعومينش: كيتقرا غير XML د UBL اللي تلصق ولا تحمل، وما كيتنفذ حتى مخطط XSD.' },
    ],
  },
  sections: {
    fr: [
      {
        heading: 'Ce que le contrôle vérifie',
        paragraphs: ['Les contrôles du FEC suivent le profil provisoire à 24 colonnes ; ceux de l’UBL ne portent que sur les éléments nommés par les spécifications et sur quelques éléments de base de la norme OASIS UBL 2.1. Rien d’autre n’est déclaré obligatoire.'],
        bullets: [
          'FEC : UTF-8 valide, séparateur pipe, fins de ligne CRLF, première ligne = en-tête du profil, exactement 24 colonnes par ligne.',
          'FEC : journal AN présent, placé en tête et équilibré ; débit = crédit, en centimes entiers, par écriture (journal et numéro d’écriture) et sur le fichier ; virgule ou point acceptés comme séparateur décimal.',
          'FEC : nom de fichier IF + FEC + date AAAAMMJJ + .txt, contrôlé seulement si le nom est connu.',
          'UBL : XML bien formé, déclaration DOCTYPE refusée, racine Invoice ou CreditNote de l’espace de noms UBL 2.1.',
          'UBL, spécifications de Fisca (profil provisoire) : type 380, 381, 383, 386 ou 389 ; BillingReference pour un 381 ; ICE de 15 chiffres sous PartyLegalEntity/CompanyID avec schemeID MA:ICE et IF sous PartyTaxScheme/CompanyID avec schemeID MA:IF (obligatoires côté vendeur, signalés seulement côté acheteur).',
          'UBL, éléments de base UBL 2.1 hors profil marocain (norme OASIS UBL 2.1) : ID, IssueDate, AccountingSupplierParty, AccountingCustomerParty, LegalMonetaryTotal et au moins une ligne.',
        ],
      },
      {
        heading: 'Limites et points à valider',
        paragraphs: [
          'Profil Fisca Art. 211 CGI en attente d’arrêté technique DGI : l’ordre des 18 colonnes standard (inspiré du FEC publié, arrêté du 29 juillet 2013, art. A47 A-1 du LPF) est confirmé par le propriétaire du projet ; les 6 extensions viennent des spécifications de Fisca. État : PROVISOIRE, au 2026-11-13.',
          'UBL : profil provisoire cius-ma-provisional. Les schémas officiels de la facturation électronique ne sont pas publiés (au 2026-11-13) : aucune validation XSD ni Schematron n’est exécutée ici. Un contrôle réussi dit seulement que les éléments contrôlés sont présents.',
          'Continuité des empreintes SHA-256 du FEC : non vérifiée, la formule n’étant pas documentée. Les dates, les comptes et les libellés du FEC ne sont pas contrôlés. Factur-X et PDF : non pris en charge, XML collé ou chargé seulement.',
        ],
      },
    ],
    en: [
      {
        heading: 'What the check verifies',
        paragraphs: ['The FEC checks follow the provisional 24-column profile; the UBL checks cover only the elements named by the specifications and a few base elements of the OASIS UBL 2.1 standard. Nothing else is declared mandatory.'],
        bullets: [
          'FEC: valid UTF-8, pipe separator, CRLF line ends, first line = profile header, exactly 24 columns per line.',
          'FEC: AN journal present, first and balanced; debit = credit, in whole cents, per entry (journal and entry number) and across the file; comma or point accepted as the decimal separator.',
          'FEC: file name IF + FEC + date YYYYMMDD + .txt, checked only when the name is known.',
          'UBL: well-formed XML, DOCTYPE declaration refused, Invoice or CreditNote root in the UBL 2.1 namespace.',
          'UBL, Fisca specifications (provisional profile): type 380, 381, 383, 386 or 389; BillingReference for a 381; 15-digit ICE under PartyLegalEntity/CompanyID with schemeID MA:ICE and IF under PartyTaxScheme/CompanyID with schemeID MA:IF (required on the seller side, only flagged on the buyer side).',
          'UBL, UBL 2.1 base elements outside the Moroccan profile (OASIS UBL 2.1 standard): ID, IssueDate, AccountingSupplierParty, AccountingCustomerParty, LegalMonetaryTotal and at least one line.',
        ],
      },
      {
        heading: 'Limits and points to validate',
        paragraphs: [
          'Fisca Art. 211 CGI profile, pending the DGI technical order: the order of the 18 standard columns (modelled on the published French FEC, order of 29 July 2013, art. A47 A-1 of the LPF) is confirmed by the project owner; the 6 extensions come from Fisca’s specifications. State: PROVISOIRE, as of 2026-11-13.',
          'UBL: provisional profile cius-ma-provisional. The official e-invoicing schemas are not published (as of 2026-11-13): no XSD or Schematron validation is run here. A passing check only says the checked elements are present.',
          'FEC SHA-256 hash continuity: not verified, the formula being undocumented. FEC dates, accounts and labels are not checked. Factur-X and PDF: not supported, pasted or loaded XML only.',
        ],
      },
    ],
    ar: [
      {
        heading: 'ما الذي يفحصه الفحص',
        paragraphs: ['تتبع فحوص FEC ملف التعريف المؤقت ذا 24 عمودا؛ أما فحوص UBL فتقتصر على العناصر التي تسميها المواصفات وبعض العناصر الأساسية من معيار OASIS UBL 2.1. ولا يُعلن أي شيء آخر إلزاميا.'],
        bullets: [
          'FEC: UTF-8 سليم، الفاصل |، نهايات أسطر CRLF، السطر الأول = رأس ملف التعريف، و24 عمودا بالضبط في كل سطر.',
          'FEC: دفتر AN موجود وفي الأول ومتوازن؛ المدين = الدائن، بالسنتيمات الصحيحة، لكل قيد (الدفتر ورقم القيد) وللملف كله؛ ويُقبل الفاصل العشري فاصلة أو نقطة.',
          'FEC: اسم الملف IF + FEC + التاريخ AAAAMMJJ + .txt، ويُفحص فقط إذا كان الاسم معروفا.',
          'UBL: XML سليم الشكل، ويُرفض تصريح DOCTYPE، والجذر Invoice أو CreditNote في فضاء أسماء UBL 2.1.',
          'UBL، مواصفات Fisca (ملف تعريف مؤقت): النوع 380 أو 381 أو 383 أو 386 أو 389؛ وBillingReference للنوع 381؛ وICE من 15 رقما تحت PartyLegalEntity/CompanyID مع schemeID MA:ICE وIF تحت PartyTaxScheme/CompanyID مع schemeID MA:IF (إلزامي جهة البائع ويُشار إليه فقط جهة المشتري).',
          'UBL، عناصر UBL 2.1 الأساسية خارج الملف المغربي (معيار OASIS UBL 2.1): ID وIssueDate وAccountingSupplierParty وAccountingCustomerParty وLegalMonetaryTotal وسطر واحد على الأقل.',
        ],
      },
      {
        heading: 'الحدود ونقاط التحقق',
        paragraphs: [
          'ملف Fisca وفق المادة 211 من CGI في انتظار القرار التقني للمديرية العامة للضرائب (DGI): ترتيب الأعمدة الـ18 القياسية (على غرار FEC الفرنسي المنشور، قرار 29 يوليوز 2013، المادة A47 A-1 من LPF) أكده مالك المشروع؛ أما الامتدادات الستة فمأخوذة من مواصفات Fisca. الحالة: PROVISOIRE، بتاريخ 2026-11-13.',
          'UBL: ملف التعريف المؤقت cius-ma-provisional. المخططات الرسمية للفوترة الإلكترونية غير منشورة (حتى 2026-11-13): لا يُنفَّذ هنا أي تحقق XSD أو Schematron. ونجاح الفحص يعني فقط أن العناصر المفحوصة موجودة.',
          'تسلسل بصمات SHA-256 في FEC: غير مفحوص لأن الصيغة غير موثقة. ولا تُفحص تواريخ FEC وحساباته وبياناته. Factur-X وPDF: غير مدعومين، XML ملصوق أو محمَّل فقط.',
        ],
      },
    ],
    ary: [
      {
        heading: 'شنو كيتحقق التحقق',
        paragraphs: ['تحققات FEC كيتبعو ملف التعريف المؤقت د 24 عمود؛ وتحققات UBL كتقتصر على العناصر اللي سمات المواصفات وشي عناصر أساسية من معيار OASIS UBL 2.1. وحتى شي حاجة أخرى ما معلنة إلزامية.'],
        bullets: [
          'FEC: UTF-8 سليم، الفاصل |، نهايات أسطر CRLF، السطر الأول = رأس ملف التعريف، و24 عمود بالضبط فكل سطر.',
          'FEC: دفتر AN كاين وفالأول ومتوازن؛ المدين = الدائن، بالسنتيمات الصحاح، لكل قيد (الدفتر ورقم القيد) وللملف كامل؛ والفاصل العشري مقبول فاصلة ولا نقطة.',
          'FEC: سمية الملف IF + FEC + التاريخ AAAAMMJJ + .txt، وكيتفحص غير إلا كانت السمية معروفة.',
          'UBL: XML سليم الشكل، وتصريح DOCTYPE مرفوض، والجذر Invoice ولا CreditNote فالفضاء د UBL 2.1.',
          'UBL، مواصفات Fisca (ملف تعريف مؤقت): النوع 380 ولا 381 ولا 383 ولا 386 ولا 389؛ وBillingReference للنوع 381؛ وICE د 15 رقم تحت PartyLegalEntity/CompanyID مع schemeID MA:ICE وIF تحت PartyTaxScheme/CompanyID مع schemeID MA:IF (إلزامي من جهة البائع وكيتشار ليه غير من جهة المشتري).',
          'UBL، عناصر UBL 2.1 الأساسية خارج الملف المغربي (معيار OASIS UBL 2.1): ID وIssueDate وAccountingSupplierParty وAccountingCustomerParty وLegalMonetaryTotal وسطر واحد على الأقل.',
        ],
      },
      {
        heading: 'الحدود ونقط خاصها تتحقق',
        paragraphs: [
          'ملف Fisca حسب المادة 211 د CGI كيتسنى القرار التقني د المديرية العامة للضرائب (DGI): ترتيب الأعمدة الـ18 القياسية (على شاكلة FEC الفرنسي المنشور، قرار 29 يوليوز 2013، المادة A47 A-1 د LPF) أكدو مالك المشروع؛ والامتدادات الستة جايين من مواصفات Fisca. الحالة: PROVISOIRE، بتاريخ 2026-11-13.',
          'UBL: ملف التعريف المؤقت cius-ma-provisional. المخططات الرسمية د الفوترة الإلكترونية ما منشورينش (حتى 2026-11-13): ما كيتنفذ هنا حتى تحقق XSD ولا Schematron. ونجاح التحقق كيعني غير بلي العناصر المفحوصة كاينة.',
          'تسلسل بصمات SHA-256 د FEC: ما كيتفحصش حيت الصيغة ما موثقاش. وتواريخ FEC وحساباتو وبياناتو ما كيتفحصوش. Factur-X وPDF: ما مدعومينش، XML ملصوق ولا محمل غير.',
        ],
      },
    ],
  },
};
