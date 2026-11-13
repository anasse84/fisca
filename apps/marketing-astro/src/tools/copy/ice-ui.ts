import type { L4 } from '../../content/silos/types.ts';

/** Textes de l'interface de l'auditeur d'ICE ; `{n}`, `{name}`, `{rows}` sont remplacés à l'exécution. */
export interface IceUiCopy {
  readonly dropTitle: string;
  readonly dropHint: string;
  readonly dropFormats: string;
  readonly analyzing: string;
  readonly loaded: string;
  readonly columnLabel: string;
  readonly columnOption: string;
  readonly headerLabel: string;
  readonly summaryHeading: string;
  readonly total: string;
  readonly valid: string;
  readonly repaired: string;
  readonly invalid: string;
  readonly empty: string;
  readonly tableCaption: string;
  readonly colRow: string;
  readonly colOriginal: string;
  readonly colStatus: string;
  readonly colCorrected: string;
  readonly colDetail: string;
  readonly statusValid: string;
  readonly statusRepaired: string;
  readonly statusInvalid: string;
  readonly statusEmpty: string;
  readonly reasonNonDigit: string;
  readonly reasonBadLength: string;
  readonly reasonZeroRoot: string;
  readonly reasonChecksum: string;
  readonly reasonRepairChecksum: string;
  readonly reasonScientific: string;
  readonly detailRepaired: string;
  readonly nothingToReview: string;
  readonly truncated: string;
  readonly exportButton: string;
  readonly exportNote: string;
  readonly errEmpty: string;
  readonly errTooLarge: string;
  readonly errUnsupported: string;
  readonly errXlsx: string;
  readonly errNoRows: string;
  readonly errRead: string;
}

const FR: IceUiCopy = {
  dropTitle: 'Déposez votre fichier ici, ou appuyez pour le choisir',
  dropHint: 'Traitement local : le fichier ne quitte pas votre navigateur.',
  dropFormats: 'Formats : .csv, .xlsx (20 Mo au maximum)',
  analyzing: 'Analyse en cours…',
  loaded: 'Fichier « {name} » analysé : {rows} lignes de données.',
  columnLabel: 'Colonne des ICE',
  columnOption: 'Colonne {n}',
  headerLabel: 'La première ligne contient des en-têtes',
  summaryHeading: 'Synthèse',
  total: 'Lignes analysées',
  valid: 'Valides (15 chiffres)',
  repaired: 'Réparées (zéros initiaux rétablis)',
  invalid: 'Invalides',
  empty: 'Vides',
  tableCaption: 'Lignes à relire : ICE réparés et ICE invalides',
  colRow: 'Ligne',
  colOriginal: 'Valeur d’origine',
  colStatus: 'Statut',
  colCorrected: 'ICE corrigé',
  colDetail: 'Détail',
  statusValid: 'Valide',
  statusRepaired: 'Réparé',
  statusInvalid: 'Invalide',
  statusEmpty: 'Vide',
  reasonNonDigit: 'caractères autres que des chiffres',
  reasonBadLength: 'longueur différente de 13, 14 ou 15 chiffres',
  reasonZeroRoot: 'racine d’entreprise composée de zéros',
  reasonChecksum: 'clé modulo 97 incohérente (faute de saisie probable)',
  reasonRepairChecksum: 'zéros initiaux non rétablissables : la clé reste incohérente',
  reasonScientific: 'notation scientifique : chiffres perdus par Excel, non réparable',
  detailRepaired: 'zéros initiaux rétablis ; relire avant reprise',
  nothingToReview: 'Aucune ligne à relire : tous les ICE renseignés sont valides.',
  truncated: '{n} lignes de plus ne sont pas affichées ; elles figurent dans l’export.',
  exportButton: 'Télécharger le CSV corrigé',
  exportNote: 'Le CSV garde vos colonnes et ajoute ICE_corrige et ICE_statut. Dans Excel, importez-le par Données > À partir d’un fichier texte en forçant la colonne ICE au format texte, sinon les zéros disparaîtront à nouveau.',
  errEmpty: 'Le fichier est vide.',
  errTooLarge: 'Le fichier dépasse 20 Mo.',
  errUnsupported: 'Format non pris en charge : utilisez un fichier .csv ou .xlsx.',
  errXlsx: 'Le classeur .xlsx n’a pas pu être lu ({reason}). Enregistrez-le en CSV et réessayez.',
  errNoRows: 'Aucune ligne n’a été trouvée dans le fichier.',
  errRead: 'Le fichier n’a pas pu être lu.',
};

const EN: IceUiCopy = {
  dropTitle: 'Drop your file here, or press to choose it',
  dropHint: 'Local processing: the file never leaves your browser.',
  dropFormats: 'Formats: .csv, .xlsx (20 MB at most)',
  analyzing: 'Analysing…',
  loaded: 'File “{name}” analysed: {rows} data rows.',
  columnLabel: 'ICE column',
  columnOption: 'Column {n}',
  headerLabel: 'The first row contains headers',
  summaryHeading: 'Summary',
  total: 'Rows analysed',
  valid: 'Valid (15 digits)',
  repaired: 'Repaired (leading zeros restored)',
  invalid: 'Invalid',
  empty: 'Empty',
  tableCaption: 'Rows to review: repaired and invalid ICE numbers',
  colRow: 'Row',
  colOriginal: 'Original value',
  colStatus: 'Status',
  colCorrected: 'Corrected ICE',
  colDetail: 'Detail',
  statusValid: 'Valid',
  statusRepaired: 'Repaired',
  statusInvalid: 'Invalid',
  statusEmpty: 'Empty',
  reasonNonDigit: 'characters other than digits',
  reasonBadLength: 'length other than 13, 14 or 15 digits',
  reasonZeroRoot: 'enterprise root made of zeros',
  reasonChecksum: 'inconsistent modulo 97 key (likely typing error)',
  reasonRepairChecksum: 'leading zeros cannot be restored: the key stays inconsistent',
  reasonScientific: 'scientific notation: digits lost by Excel, not repairable',
  detailRepaired: 'leading zeros restored; review before use',
  nothingToReview: 'No row to review: every filled-in ICE is valid.',
  truncated: '{n} more rows are not displayed; they are in the export.',
  exportButton: 'Download the corrected CSV',
  exportNote: 'The CSV keeps your columns and adds ICE_corrige and ICE_statut. In Excel, import it with Data > From Text and force the ICE column to text, otherwise the zeros will vanish again.',
  errEmpty: 'The file is empty.',
  errTooLarge: 'The file exceeds 20 MB.',
  errUnsupported: 'Unsupported format: use a .csv or .xlsx file.',
  errXlsx: 'The .xlsx workbook could not be read ({reason}). Save it as CSV and try again.',
  errNoRows: 'No row was found in the file.',
  errRead: 'The file could not be read.',
};

const AR: IceUiCopy = {
  dropTitle: 'أسقط ملفك هنا أو اضغط لاختياره',
  dropHint: 'معالجة محلية: لا يغادر الملف متصفحك.',
  dropFormats: 'الصيغ: ‎.csv‎ و‎.xlsx‎ (20 ميغابايت كحد أقصى)',
  analyzing: 'جارٍ التحليل…',
  loaded: 'تم تحليل الملف «{name}»: {rows} سطر من البيانات.',
  columnLabel: 'عمود ICE',
  columnOption: 'العمود {n}',
  headerLabel: 'يحتوي السطر الأول على عناوين',
  summaryHeading: 'الخلاصة',
  total: 'الأسطر المحللة',
  valid: 'صالحة (15 رقما)',
  repaired: 'مُصلَحة (استُعيدت الأصفار الأولى)',
  invalid: 'غير صالحة',
  empty: 'فارغة',
  tableCaption: 'أسطر للمراجعة: ICE المُصلَحة وغير الصالحة',
  colRow: 'السطر',
  colOriginal: 'القيمة الأصلية',
  colStatus: 'الحالة',
  colCorrected: 'ICE المصحح',
  colDetail: 'التفصيل',
  statusValid: 'صالح',
  statusRepaired: 'مُصلَح',
  statusInvalid: 'غير صالح',
  statusEmpty: 'فارغ',
  reasonNonDigit: 'أحرف غير الأرقام',
  reasonBadLength: 'طول مختلف عن 13 أو 14 أو 15 رقما',
  reasonZeroRoot: 'جذر المقاولة مكوّن من أصفار',
  reasonChecksum: 'مفتاح modulo 97 غير متسق (خطأ إدخال محتمل)',
  reasonRepairChecksum: 'تعذر استرجاع الأصفار الأولى: يبقى المفتاح غير متسق',
  reasonScientific: 'ترميز علمي: فقد Excel الأرقام ولا يمكن إصلاحه',
  detailRepaired: 'استُعيدت الأصفار الأولى؛ راجِع قبل الاعتماد',
  nothingToReview: 'لا أسطر للمراجعة: كل أرقام ICE المدخلة صالحة.',
  truncated: 'هناك {n} أسطر أخرى غير معروضة؛ وهي موجودة في التصدير.',
  exportButton: 'تنزيل CSV المصحح',
  exportNote: 'يحتفظ ملف CSV بأعمدتك ويضيف ICE_corrige وICE_statut. في Excel استورده عبر «بيانات > من نص» مع فرض تنسيق النص على عمود ICE وإلا اختفت الأصفار مجددا.',
  errEmpty: 'الملف فارغ.',
  errTooLarge: 'يتجاوز الملف 20 ميغابايت.',
  errUnsupported: 'صيغة غير مدعومة: استعمل ملف ‎.csv‎ أو ‎.xlsx‎.',
  errXlsx: 'تعذرت قراءة المصنف ‎.xlsx‎ ({reason}). احفظه بصيغة CSV وأعد المحاولة.',
  errNoRows: 'لم يوجد أي سطر في الملف.',
  errRead: 'تعذرت قراءة الملف.',
};

const ARY: IceUiCopy = {
  dropTitle: 'حط الملف ديالك هنا ولا ضغط باش تختارو',
  dropHint: 'معالجة محلية: الملف ما كيخرجش من المتصفح ديالك.',
  dropFormats: 'الصيغ: ‎.csv‎ و‎.xlsx‎ (20 ميغا بحد أقصى)',
  analyzing: 'كنحللو…',
  loaded: 'الملف «{name}» تحلل: {rows} سطر د المعطيات.',
  columnLabel: 'عمود ICE',
  columnOption: 'العمود {n}',
  headerLabel: 'السطر الأول فيه العناوين',
  summaryHeading: 'الخلاصة',
  total: 'السطور المحللة',
  valid: 'صالحة (15 رقم)',
  repaired: 'مصلحة (رجعو الصيفرات د البداية)',
  invalid: 'ماشي صالحة',
  empty: 'خاوية',
  tableCaption: 'سطور خاصها تتعاود: ICE المصلحة وماشي صالحة',
  colRow: 'السطر',
  colOriginal: 'القيمة الأصلية',
  colStatus: 'الحالة',
  colCorrected: 'ICE المصحح',
  colDetail: 'التفصيل',
  statusValid: 'صالح',
  statusRepaired: 'مصلح',
  statusInvalid: 'ماشي صالح',
  statusEmpty: 'خاوي',
  reasonNonDigit: 'حروف ماشي أرقام',
  reasonBadLength: 'الطول ماشي 13 ولا 14 ولا 15 رقم',
  reasonZeroRoot: 'جذر الشركة كله صيفرات',
  reasonChecksum: 'مفتاح modulo 97 ماشي متناسق (غالبا غلطة فالكتابة)',
  reasonRepairChecksum: 'ما قدرناش نرجعو الصيفرات د البداية: المفتاح بقا ماشي متناسق',
  reasonScientific: 'ترميز علمي: Excel ضيع الأرقام وما كيتصلحش',
  detailRepaired: 'رجعو الصيفرات د البداية؛ عاود قرا قبل ما تعتمد',
  nothingToReview: 'ما كاين حتى سطر باش يتعاود: كاع ICE المكتوبين صالحين.',
  truncated: 'كاين {n} سطر زايدين ما بانوش؛ كاينين فالتصدير.',
  exportButton: 'نزل CSV المصحح',
  exportNote: 'CSV كيحتافظ بالأعمدة ديالك وكيزيد ICE_corrige وICE_statut. فExcel دخلو عبر «بيانات > من نص» وفرض على عمود ICE تنسيق النص، وإلا الصيفرات غادي يمشيو مرة خرى.',
  errEmpty: 'الملف خاوي.',
  errTooLarge: 'الملف فوق 20 ميغا.',
  errUnsupported: 'صيغة ماشي مدعومة: استعمل ملف ‎.csv‎ ولا ‎.xlsx‎.',
  errXlsx: 'ما قدرناش نقراو المصنف ‎.xlsx‎ ({reason}). سجلو بصيغة CSV وعاود.',
  errNoRows: 'ما لقينا حتى سطر فالملف.',
  errRead: 'ما قدرناش نقراو الملف.',
};

export const ICE_UI: L4<IceUiCopy> = { fr: FR, en: EN, ar: AR, ary: ARY };
