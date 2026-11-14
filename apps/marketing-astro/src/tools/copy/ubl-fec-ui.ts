import type { CopyLocale } from '../../i18n/copy-locale.ts';
import type { L4 } from '../../content/silos/types.ts';
import type { FecIssueCode } from '../fec-check.ts';
import type { UblBasis, UblCheckId, UblDetail } from '../ubl-check.ts';
import { t } from './common.ts';

/**
 * Textes de l'interface du validateur : les messages d'anomalie portent des variables `{line}`, `{found}`, `{column}`,
 * `{entry}`, `{debit}`, `{credit}`, `{detail}` remplacées à l'exécution. Aucun message n’affirme une validation officielle.
 */
export interface ValidatorUiCopy {
  readonly indicativeBanner: string;
  readonly localProcessing: string;
  readonly fecHeading: string;
  readonly fecDropTitle: string;
  readonly fecDropHint: string;
  readonly ublHeading: string;
  readonly ublFileLabel: string;
  readonly ublTextLabel: string;
  readonly ublRun: string;
  readonly ublFormats: string;
  readonly resultHeading: string;
  readonly fecResultTitle: string;
  readonly ublResultTitle: string;
  readonly verdictOk: string;
  readonly verdictKo: string;
  readonly verdictNote: string;
  readonly profileLine: string;
  readonly fecStats: string;
  readonly fecHashNotVerified: string;
  readonly fecHashFilled: string;
  readonly fecNotChecked: string;
  readonly fecBalanceSkipped: string;
  readonly fecFileNameSkipped: string;
  readonly issuesHeading: string;
  readonly moreIssues: string;
  readonly ublProfileLine: string;
  readonly ublNoXsd: string;
  readonly ublRootFound: string;
  readonly ublTypeFound: string;
  readonly statusPass: string;
  readonly statusFail: string;
  readonly statusWarn: string;
  readonly statusNa: string;
  readonly colCheck: string;
  readonly colOrigin: string;
  readonly colStatus: string;
  readonly colDetail: string;
  readonly tableCaption: string;
  readonly analyzing: string;
  readonly fecLoaded: string;
  readonly ublLoaded: string;
  readonly errTooLarge: string;
  readonly errPdf: string;
  readonly errRead: string;
  readonly errEmptyXml: string;
  readonly fecIssues: Readonly<Record<FecIssueCode, string>>;
  readonly ublChecks: Readonly<Record<UblCheckId, string>>;
  readonly ublBasis: Readonly<Record<UblBasis, string>>;
  readonly ublDetails: Readonly<Record<UblDetail, string>>;
}

const FEC_ISSUES: Record<FecIssueCode, L4> = {
  EMPTY_FILE: t('Le fichier est vide.', 'The file is empty.', 'الملف فارغ.', 'الملف خاوي.'),
  NOT_UTF8: t('Le fichier n’est pas de l’UTF-8 valide : le contrôle s’arrête.', 'The file is not valid UTF-8: the check stops.', 'الملف ليس UTF-8 سليما: يتوقف الفحص.', 'الملف ماشي UTF-8 سليم: التحقق كيوقف.'),
  BOM: t('Marque d’ordre des octets (BOM) en tête de fichier : à retirer.', 'Byte-order mark (BOM) at the start of the file: remove it.', 'علامة ترتيب البايتات (BOM) في بداية الملف: يجب حذفها.', 'علامة BOM فبداية الملف: خاصها تتحيد.'),
  LINE_ENDING_LF: t('{found} fin(s) de ligne LF seul : CRLF attendu.', '{found} bare LF line end(s): CRLF expected.', '{found} نهاية سطر LF فقط: المطلوب CRLF.', '{found} نهاية سطر LF بوحدو: المطلوب CRLF.'),
  LINE_ENDING_CR: t('{found} fin(s) de ligne CR seul : CRLF attendu.', '{found} bare CR line end(s): CRLF expected.', '{found} نهاية سطر CR فقط: المطلوب CRLF.', '{found} نهاية سطر CR بوحدو: المطلوب CRLF.'),
  EMPTY_LINE: t('Ligne {line} : ligne vide.', 'Line {line}: empty line.', 'السطر {line}: سطر فارغ.', 'السطر {line}: سطر خاوي.'),
  WRONG_SEPARATOR: t('Ligne {line} : séparateur « {detail} » détecté, le pipe « | » est attendu.', 'Line {line}: separator "{detail}" detected, the pipe "|" is expected.', 'السطر {line}: تم رصد الفاصل «{detail}»، والمطلوب الفاصل «|».', 'السطر {line}: لقينا الفاصل «{detail}»، والمطلوب «|».'),
  HEADER_COLUMN_COUNT: t('En-tête (ligne {line}) : {found} colonnes au lieu de 24.', 'Header (line {line}): {found} columns instead of 24.', 'الرأس (السطر {line}): {found} عمودا بدل 24.', 'الرأس (السطر {line}): {found} عمود عوض 24.'),
  HEADER_MISMATCH: t('En-tête (ligne {line}) : noms différents du profil aux positions {detail}.', 'Header (line {line}): names differ from the profile at positions {detail}.', 'الرأس (السطر {line}): أسماء تخالف ملف التعريف في المواضع {detail}.', 'الرأس (السطر {line}): سميات مخالفة لملف التعريف فالمواضع {detail}.'),
  COLUMN_COUNT: t('Ligne {line} : {found} colonnes au lieu de 24.', 'Line {line}: {found} columns instead of 24.', 'السطر {line}: {found} عمودا بدل 24.', 'السطر {line}: {found} عمود عوض 24.'),
  AMOUNT_INVALID: t('Ligne {line}, colonne {column} : montant illisible (virgule ou point, 2 décimales au plus, ni signe ni espace).', 'Line {line}, column {column}: unreadable amount (comma or point, at most 2 decimals, no sign or space).', 'السطر {line}، العمود {column}: مبلغ غير مقروء (فاصلة أو نقطة، منزلتان عشريتان على الأكثر، دون إشارة أو مسافة).', 'السطر {line}، العمود {column}: مبلغ ما مقروءش (فاصلة ولا نقطة، منزلتين عشريتين بزاف، بلا إشارة ولا فراغ).'),
  AMOUNT_TOO_LARGE: t('Un total dépasse la capacité de calcul exact de l’outil.', 'A total exceeds the tool’s exact-computation capacity.', 'مجموع يتجاوز قدرة الأداة على الحساب الدقيق.', 'مجموع كيفوت قدرة الأداة على الحساب الدقيق.'),
  EMPTY_ENTRY_NUM: t('Ligne {line} : numéro d’écriture (EcritureNum) vide.', 'Line {line}: empty entry number (EcritureNum).', 'السطر {line}: رقم القيد (EcritureNum) فارغ.', 'السطر {line}: رقم القيد (EcritureNum) خاوي.'),
  AN_ABSENT: t('Journal d’ouverture AN absent.', 'Opening journal AN is missing.', 'دفتر الافتتاح AN غير موجود.', 'دفتر الافتتاح AN ماكايناش.'),
  AN_NOT_FIRST: t('Ligne {line} : le journal AN doit occuper le début du fichier, avant tout autre journal.', 'Line {line}: the AN journal must come first in the file, before any other journal.', 'السطر {line}: يجب أن يتصدر دفتر AN الملف قبل أي دفتر آخر.', 'السطر {line}: دفتر AN خاصو يكون فالأول قبل أي دفتر آخر.'),
  AN_UNBALANCED: t('Journal AN déséquilibré : débit {debit}, crédit {credit} (centimes).', 'AN journal unbalanced: debit {debit}, credit {credit} (cents).', 'دفتر AN غير متوازن: المدين {debit}، الدائن {credit} (سنتيمات).', 'دفتر AN ماشي متوازن: المدين {debit}، الدائن {credit} (سنتيمات).'),
  ENTRY_UNBALANCED: t('Écriture {entry} (ligne {line}) déséquilibrée : débit {debit}, crédit {credit} (centimes).', 'Entry {entry} (line {line}) unbalanced: debit {debit}, credit {credit} (cents).', 'القيد {entry} (السطر {line}) غير متوازن: المدين {debit}، الدائن {credit} (سنتيمات).', 'القيد {entry} (السطر {line}) ماشي متوازن: المدين {debit}، الدائن {credit} (سنتيمات).'),
  FILE_UNBALANCED: t('Fichier déséquilibré : total débit {debit}, total crédit {credit} (centimes).', 'File unbalanced: total debit {debit}, total credit {credit} (cents).', 'الملف غير متوازن: مجموع المدين {debit}، مجموع الدائن {credit} (سنتيمات).', 'الملف ماشي متوازن: مجموع المدين {debit}، مجموع الدائن {credit} (سنتيمات).'),
  FILE_NAME: t('Nom de fichier « {detail} » : le format attendu est IF + FEC + date AAAAMMJJ + .txt.', 'File name "{detail}": the expected format is IF + FEC + date YYYYMMDD + .txt.', 'اسم الملف «{detail}»: الصيغة المطلوبة IF + FEC + التاريخ AAAAMMJJ + .txt.', 'سمية الملف «{detail}»: الصيغة المطلوبة IF + FEC + التاريخ AAAAMMJJ + .txt.'),
};

const UBL_CHECKS: Record<UblCheckId, L4> = {
  WELL_FORMED: t('XML bien formé', 'Well-formed XML', 'XML سليم الشكل', 'XML سليم الشكل'),
  NO_DOCTYPE: t('Aucune déclaration DOCTYPE ou ENTITY', 'No DOCTYPE or ENTITY declaration', 'لا تصريح DOCTYPE أو ENTITY', 'بلا تصريح DOCTYPE ولا ENTITY'),
  ROOT: t('Racine Invoice ou CreditNote (espace de noms UBL 2.1)', 'Invoice or CreditNote root (UBL 2.1 namespace)', 'جذر Invoice أو CreditNote (فضاء أسماء UBL 2.1)', 'جذر Invoice ولا CreditNote (فضاء UBL 2.1)'),
  BASE_ID: t('Élément ID', 'ID element', 'العنصر ID', 'العنصر ID'),
  BASE_ISSUE_DATE: t('Élément IssueDate', 'IssueDate element', 'العنصر IssueDate', 'العنصر IssueDate'),
  BASE_SUPPLIER: t('Élément AccountingSupplierParty', 'AccountingSupplierParty element', 'العنصر AccountingSupplierParty', 'العنصر AccountingSupplierParty'),
  BASE_CUSTOMER: t('Élément AccountingCustomerParty', 'AccountingCustomerParty element', 'العنصر AccountingCustomerParty', 'العنصر AccountingCustomerParty'),
  BASE_MONETARY_TOTAL: t('Élément LegalMonetaryTotal', 'LegalMonetaryTotal element', 'العنصر LegalMonetaryTotal', 'العنصر LegalMonetaryTotal'),
  BASE_LINE: t('Au moins une ligne (InvoiceLine ou CreditNoteLine)', 'At least one line (InvoiceLine or CreditNoteLine)', 'سطر واحد على الأقل (InvoiceLine أو CreditNoteLine)', 'سطر واحد على الأقل (InvoiceLine ولا CreditNoteLine)'),
  TYPE_CODE: t('Type de document (InvoiceTypeCode) dans 380, 381, 383, 386, 389', 'Document type (InvoiceTypeCode) in 380, 381, 383, 386, 389', 'نوع الوثيقة (InvoiceTypeCode) ضمن 380 و381 و383 و386 و389', 'نوع الوثيقة (InvoiceTypeCode) ضمن 380 و381 و383 و386 و389'),
  BILLING_REFERENCE: t('BillingReference pour un avoir (381)', 'BillingReference for a credit note (381)', 'BillingReference للإشعار الدائن (381)', 'BillingReference للإشعار الدائن (381)'),
  ICE_SUPPLIER: t('Vendeur : ICE sous PartyLegalEntity/CompanyID, schemeID MA:ICE', 'Seller: ICE under PartyLegalEntity/CompanyID, schemeID MA:ICE', 'البائع: ICE تحت PartyLegalEntity/CompanyID، schemeID MA:ICE', 'البائع: ICE تحت PartyLegalEntity/CompanyID، schemeID MA:ICE'),
  IF_SUPPLIER: t('Vendeur : IF sous PartyTaxScheme/CompanyID, schemeID MA:IF', 'Seller: IF under PartyTaxScheme/CompanyID, schemeID MA:IF', 'البائع: IF تحت PartyTaxScheme/CompanyID، schemeID MA:IF', 'البائع: IF تحت PartyTaxScheme/CompanyID، schemeID MA:IF'),
  ICE_CUSTOMER: t('Acheteur : ICE (schemeID MA:ICE), signalé seulement', 'Buyer: ICE (schemeID MA:ICE), flagged only', 'المشتري: ICE (schemeID MA:ICE)، للتنبيه فقط', 'المشتري: ICE (schemeID MA:ICE)، تنبيه غير'),
  IF_CUSTOMER: t('Acheteur : IF (schemeID MA:IF), signalé seulement', 'Buyer: IF (schemeID MA:IF), flagged only', 'المشتري: IF (schemeID MA:IF)، للتنبيه فقط', 'المشتري: IF (schemeID MA:IF)، تنبيه غير'),
};

const UBL_BASIS: Record<UblBasis, L4> = {
  XML: t('forme XML', 'XML form', 'شكل XML', 'شكل XML'),
  OASIS_UBL21: t('éléments de base UBL 2.1, hors profil marocain (norme OASIS UBL 2.1)', 'UBL 2.1 base elements, outside the Moroccan profile (OASIS UBL 2.1 standard)', 'عناصر UBL 2.1 الأساسية خارج الملف المغربي (معيار OASIS UBL 2.1)', 'عناصر UBL 2.1 الأساسية خارج الملف المغربي (معيار OASIS UBL 2.1)'),
  DOC07_S07: t('spécifications de Fisca, profil provisoire cius-ma-provisional', 'Fisca specifications, provisional profile cius-ma-provisional', 'مواصفات Fisca، الملف المؤقت cius-ma-provisional', 'مواصفات Fisca، الملف المؤقت cius-ma-provisional'),
};

const UBL_DETAILS: Record<UblDetail, L4> = {
  PASS: t('présent', 'present', 'موجود', 'كاين'),
  NOT_APPLICABLE: t('sans objet', 'not applicable', 'لا ينطبق', 'ما كينطبقش'),
  EMPTY_DOCUMENT: t('document vide', 'empty document', 'وثيقة فارغة', 'وثيقة خاوية'),
  DOCTYPE_REJECTED: t('déclaration DOCTYPE ou ENTITY refusée (aucune entité n’est traitée)', 'DOCTYPE or ENTITY declaration refused (no entity is processed)', 'تصريح DOCTYPE أو ENTITY مرفوض (لا تُعالج أي كيانات)', 'تصريح DOCTYPE ولا ENTITY مرفوض (ما كيتعالج حتى كيان)'),
  NOT_WELL_FORMED: t('XML mal formé', 'XML not well-formed', 'XML غير سليم الشكل', 'XML ماشي سليم الشكل'),
  ROOT_UNEXPECTED: t('racine « {found} » ou espace de noms inattendu', 'unexpected root "{found}" or namespace', 'جذر «{found}» أو فضاء أسماء غير متوقع', 'جذر «{found}» ولا فضاء أسماء ماشي متوقع'),
  ELEMENT_MISSING: t('élément absent', 'element missing', 'العنصر غير موجود', 'العنصر ماكاينش'),
  TYPE_CODE_MISSING: t('code de type absent', 'type code missing', 'رمز النوع غير موجود', 'رمز النوع ماكاينش'),
  TYPE_CODE_NOT_SUPPORTED: t('code « {found} » hors de la liste 380, 381, 383, 386, 389', 'code "{found}" outside the list 380, 381, 383, 386, 389', 'الرمز «{found}» خارج القائمة 380 و381 و383 و386 و389', 'الرمز «{found}» خارج اللائحة 380 و381 و383 و386 و389'),
  SCHEME_ID_MISSING: t('CompanyID présent sans schemeID', 'CompanyID present without schemeID', 'CompanyID موجود دون schemeID', 'CompanyID كاين بلا schemeID'),
  SCHEME_ID_WRONG: t('schemeID « {found} » au lieu de la valeur attendue', 'schemeID "{found}" instead of the expected value', 'schemeID «{found}» بدل القيمة المطلوبة', 'schemeID «{found}» عوض القيمة المطلوبة'),
  ICE_FORMAT: t('l’ICE n’a pas 15 chiffres', 'the ICE does not have 15 digits', 'ICE ليس من 15 رقما', 'ICE ماشي د 15 رقم'),
};

const TEXTS = {
  indicativeBanner: t('Contrôle de structure indicatif, pas une validation DGI.', 'Indicative structure check, not a DGI validation.', 'فحص إرشادي للبنية، وليس مصادقة من DGI.', 'تحقق إرشادي د البنية، ماشي مصادقة د DGI.'),
  localProcessing: t('Traitement 100 % local : aucun fichier ni texte n’est envoyé à un serveur.', '100% local processing: no file or text is sent to a server.', 'معالجة محلية بالكامل: لا يُرسل أي ملف أو نص إلى خادم.', 'معالجة محلية 100 %: ما كيتصيفط حتى ملف ولا نص لسيرفر.'),
  fecHeading: t('Fichier FEC (24 colonnes)', 'FEC file (24 columns)', 'ملف FEC (24 عمودا)', 'ملف FEC (24 عمود)'),
  fecDropTitle: t('Choisissez le fichier FEC (.txt)', 'Choose the FEC file (.txt)', 'اختر ملف FEC (.txt)', 'ختار ملف FEC (.txt)'),
  fecDropHint: t('Le nom du fichier est contrôlé aussi : IF + FEC + date AAAAMMJJ + .txt. 20 Mo au maximum.', 'The file name is checked too: IF + FEC + date YYYYMMDD + .txt. 20 MB at most.', 'يُفحص اسم الملف أيضا: IF + FEC + التاريخ AAAAMMJJ + .txt. 20 ميغابايت على الأكثر.', 'كيتفحص حتى سمية الملف: IF + FEC + التاريخ AAAAMMJJ + .txt. 20 ميغابايت بزاف.'),
  ublHeading: t('Facture UBL 2.1 (XML)', 'UBL 2.1 invoice (XML)', 'فاتورة UBL 2.1 (XML)', 'فاتورة UBL 2.1 (XML)'),
  ublFileLabel: t('Charger un fichier XML', 'Load an XML file', 'تحميل ملف XML', 'حمل ملف XML'),
  ublTextLabel: t('Ou collez le XML ici', 'Or paste the XML here', 'أو الصق XML هنا', 'ولا لصق XML هنا'),
  ublRun: t('Contrôler la structure', 'Check the structure', 'فحص البنية', 'تحقق من البنية'),
  ublFormats: t('XML collé ou chargé seulement : les PDF et les Factur-X ne sont pas pris en charge. 5 Mo au maximum.', 'Pasted or loaded XML only: PDFs and Factur-X are not supported. 5 MB at most.', 'XML ملصوق أو محمَّل فقط: ملفات PDF وFactur-X غير مدعومة. 5 ميغابايت على الأكثر.', 'XML ملصوق ولا محمل غير: PDF وFactur-X ما مدعومينش. 5 ميغابايت بزاف.'),
  resultHeading: t('Résultat du contrôle de structure local', 'Local structure check result', 'نتيجة فحص البنية المحلي', 'نتيجة تحقق البنية المحلي'),
  fecResultTitle: t('FEC : contrôle de structure local', 'FEC: local structure check', 'FEC: فحص البنية المحلي', 'FEC: تحقق البنية المحلي'),
  ublResultTitle: t('UBL : contrôle de structure local', 'UBL: local structure check', 'UBL: فحص البنية المحلي', 'UBL: تحقق البنية المحلي'),
  verdictOk: t('Aucune anomalie de structure sur les points contrôlés.', 'No structure anomaly on the points checked.', 'لا توجد أي مخالفة في البنية في النقاط المفحوصة.', 'ماكاين حتى مشكل فالبنية فالنقط المفحوصة.'),
  verdictKo: t('Anomalies de structure détectées : à corriger à la source.', 'Structure anomalies detected: fix them at the source.', 'تم رصد مخالفات في البنية: يجب تصحيحها عند المصدر.', 'تلقاو مشاكل فالبنية: خاصهم يتصلحو فالمصدر.'),
  verdictNote: t('Information indicative : cela ne vaut ni dépôt ni validation DGI.', 'Indicative information: this is neither a filing nor a DGI validation.', 'معلومة إرشادية: هذا ليس إيداعا ولا مصادقة من DGI.', 'معلومة إرشادية: هادشي ماشي إيداع ولا مصادقة د DGI.'),
  profileLine: t('Profil FEC-MA provisoire (fec-ma-provisional), état PROVISOIRE : les noms des 18 colonnes standard ne sont pas recoupés avec le texte marocain.', 'Provisional FEC-MA profile (fec-ma-provisional), state PROVISOIRE: the names of the 18 standard columns are not cross-checked with the Moroccan text.', 'ملف FEC-MA المؤقت (fec-ma-provisional)، الحالة PROVISOIRE: أسماء الأعمدة الـ18 القياسية لم تُطابَق مع النص المغربي.', 'ملف FEC-MA المؤقت (fec-ma-provisional)، الحالة PROVISOIRE: سميات الأعمدة الـ18 القياسية ما تقارنوش مع النص المغربي.'),
  fecStats: t('{lines} lignes, {entries} écritures ; total débit {debit} et total crédit {credit}.', '{lines} lines, {entries} entries; total debit {debit} and total credit {credit}.', '{lines} سطرا، {entries} قيدا؛ مجموع المدين {debit} ومجموع الدائن {credit}.', '{lines} سطر، {entries} قيد؛ مجموع المدين {debit} ومجموع الدائن {credit}.'),
  fecHashNotVerified: t('Continuité des empreintes SHA-256 : NON vérifiée (la formule de calcul n’est pas documentée dans les spécifications).', 'SHA-256 hash continuity: NOT verified (the computation formula is not documented in the specifications).', 'تسلسل بصمات SHA-256: غير مفحوص (صيغة الحساب غير موثقة في المواصفات).', 'تسلسل بصمات SHA-256: ما تفحصش (صيغة الحساب ما موثقاش فالمواصفات).'),
  fecHashFilled: t('{n} ligne(s) portent des empreintes ; elles ne sont pas contrôlées.', '{n} line(s) carry hashes; they are not checked.', '{n} سطرا تحمل بصمات؛ ولا تُفحص.', '{n} سطر فيهم بصمات؛ وما كيتفحصوش.'),
  fecBalanceSkipped: t('Équilibre débit = crédit non contrôlé : des lignes illisibles rendent les totaux incomplets. Corrigez-les d’abord.', 'Debit = credit balance not checked: unreadable lines make the totals incomplete. Fix them first.', 'لم يُفحص توازن المدين = الدائن: أسطر غير مقروءة تجعل المجاميع ناقصة. صححها أولا.', 'توازن المدين = الدائن ما تفحصش: أسطر ما مقروءينش كيخليو المجاميع ناقصة. صلحهم أولا.'),
  fecNotChecked: t('Non contrôlés : dates, comptes, libellés.', 'Not checked: dates, accounts, labels.', 'غير مفحوص: التواريخ والحسابات والبيانات.', 'ما كيتفحصوش: التواريخ والحسابات والبيانات.'),
  fecFileNameSkipped: t('Nom de fichier non fourni : contrôle du nom omis.', 'File name not provided: name check skipped.', 'اسم الملف غير متوفر: فحص الاسم محذوف.', 'سمية الملف ماكايناش: فحص السمية تحيد.'),
  issuesHeading: t('Anomalies', 'Anomalies', 'المخالفات', 'المشاكل'),
  moreIssues: t('{n} anomalie(s) de ce type au total ; les 20 premières sont listées.', '{n} anomalies of this kind in total; the first 20 are listed.', '{n} مخالفة من هذا النوع في المجموع؛ وتُعرض العشرون الأولى.', '{n} مشكل من هاد النوع فالمجموع؛ وكيتعرضو العشرين الأولين.'),
  ublProfileLine: t('Profil provisoire cius-ma-provisional (état PROVISOIRE) : les schémas officiels de la facturation électronique ne sont pas publiés (ERRATA B-13).', 'Provisional profile cius-ma-provisional (state PROVISOIRE): the official e-invoicing schemas are not published (ERRATA B-13).', 'الملف المؤقت cius-ma-provisional (الحالة PROVISOIRE): المخططات الرسمية للفوترة الإلكترونية غير منشورة (ERRATA B-13).', 'الملف المؤقت cius-ma-provisional (الحالة PROVISOIRE): المخططات الرسمية د الفوترة الإلكترونية ما منشورينش (ERRATA B-13).'),
  ublNoXsd: t('Aucune validation XSD ni Schematron n’est exécutée : seuls les éléments listés ci-dessous sont contrôlés.', 'No XSD or Schematron validation is run: only the elements listed below are checked.', 'لا يُنفَّذ أي تحقق XSD أو Schematron: تُفحص فقط العناصر المدرجة أدناه.', 'ما كيتنفذ حتى تحقق XSD ولا Schematron: كيتفحصو غير العناصر اللي لتحت.'),
  ublRootFound: t('Racine lue : {name}.', 'Root read: {name}.', 'الجذر المقروء: {name}.', 'الجذر اللي تقرا: {name}.'),
  ublTypeFound: t('Code de type lu : {code}.', 'Type code read: {code}.', 'رمز النوع المقروء: {code}.', 'رمز النوع اللي تقرا: {code}.'),
  statusPass: t('OK', 'OK', 'سليم', 'مزيان'),
  statusFail: t('Anomalie', 'Anomaly', 'مخالفة', 'مشكل'),
  statusWarn: t('À signaler', 'Flagged', 'تنبيه', 'تنبيه'),
  statusNa: t('Sans objet', 'N/A', 'لا ينطبق', 'ما كينطبقش'),
  colCheck: t('Contrôle', 'Check', 'الفحص', 'التحقق'),
  colOrigin: t('Origine du contrôle', 'Origin of the check', 'مصدر الفحص', 'مصدر التحقق'),
  colStatus: t('Statut', 'Status', 'الحالة', 'الحالة'),
  colDetail: t('Détail', 'Detail', 'التفصيل', 'التفصيل'),
  tableCaption: t('Contrôles de structure UBL', 'UBL structure checks', 'فحوص بنية UBL', 'تحققات بنية UBL'),
  analyzing: t('Analyse en cours…', 'Analysing…', 'جار التحليل…', 'كنحللو…'),
  fecLoaded: t('Fichier « {name} » contrôlé.', 'File "{name}" checked.', 'تم فحص الملف «{name}».', 'تفحص الملف «{name}».'),
  ublLoaded: t('Document contrôlé.', 'Document checked.', 'تم فحص الوثيقة.', 'تفحصات الوثيقة.'),
  errTooLarge: t('Fichier trop volumineux pour un traitement local sûr.', 'File too large for safe local processing.', 'الملف كبير جدا للمعالجة المحلية الآمنة.', 'الملف كبير بزاف للمعالجة المحلية الآمنة.'),
  errPdf: t('PDF et Factur-X ne sont pas pris en charge : collez ou chargez le XML UBL.', 'PDF and Factur-X are not supported: paste or load the UBL XML.', 'ملفات PDF وFactur-X غير مدعومة: الصق XML الخاص بـ UBL أو حمّله.', 'PDF وFactur-X ما مدعومينش: لصق XML د UBL ولا حملو.'),
  errRead: t('Le fichier n’a pas pu être lu.', 'The file could not be read.', 'تعذرت قراءة الملف.', 'ما قدرناش نقراو الملف.'),
  errEmptyXml: t('Collez ou chargez un XML.', 'Paste or load an XML.', 'الصق XML أو حمّله.', 'لصق XML ولا حملو.'),
} satisfies Record<Exclude<keyof ValidatorUiCopy, 'fecIssues' | 'ublChecks' | 'ublBasis' | 'ublDetails'>, L4>;

function pickRecord<K extends string>(source: Readonly<Record<K, L4>>, loc: CopyLocale): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(source) as K[]) out[key] = source[key][loc];
  return out;
}

export function validatorUiCopy(loc: CopyLocale): ValidatorUiCopy {
  return {
    ...pickRecord(TEXTS, loc),
    fecIssues: pickRecord(FEC_ISSUES, loc),
    ublChecks: pickRecord(UBL_CHECKS, loc),
    ublBasis: pickRecord(UBL_BASIS, loc),
    ublDetails: pickRecord(UBL_DETAILS, loc),
  };
}
