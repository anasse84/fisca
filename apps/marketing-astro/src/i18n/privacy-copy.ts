import { ACCESS_REQUEST_TARGET_DAYS, FISCAL_RECORD_RETENTION_YEARS } from '../content/cndp.ts';
import type { CndpFormId, DataCategoryId, HostingRegion, ProcessingId, SubProcessorId } from '../content/cndp.ts';
import { copyLocaleOf } from './copy-locale.ts';
import type { CopyLocale } from './copy-locale.ts';
import type { MarketingLocale } from './locales.ts';

export interface PrivacyCopy {
  readonly title: string;
  readonly description: string;
  readonly heading: string;
  readonly lead: string;
  readonly controller: { readonly heading: string; readonly body: string; readonly contactLabel: string; readonly addressLabel: string; readonly address: string };
  readonly roles: { readonly heading: string; readonly items: readonly string[] };
  readonly purposes: {
    readonly heading: string;
    readonly intro: string;
    readonly columns: readonly [string, string, string, string];
    readonly byProcessing: Readonly<Record<ProcessingId, string>>;
    readonly categories: Readonly<Record<DataCategoryId, string>>;
    readonly noCardData: string;
  };
  readonly retention: {
    readonly heading: string;
    readonly fiscal: string;
    readonly nonAccounting: string;
    readonly toBeSet: string;
    readonly ownerPending: string;
  };
  readonly rights: {
    readonly heading: string;
    readonly intro: string;
    readonly items: readonly { readonly title: string; readonly body: string }[];
    readonly howTo: string;
    readonly delay: string;
    readonly fiscalLimit: string;
  };
  readonly cndp: {
    readonly heading: string;
    readonly intro: string;
    readonly forms: Readonly<Record<CndpFormId, string>>;
    readonly numberLabel: string;
    readonly pending: string;
  };
  readonly hosting: {
    readonly heading: string;
    readonly intro: string;
    readonly columns: readonly [string, string, string];
    readonly roles: Readonly<Record<SubProcessorId, string>>;
    readonly regions: Readonly<Record<HostingRegion, string>>;
    readonly legalBasis: string;
  };
  readonly cookies: { readonly heading: string; readonly items: readonly string[] };
}

const DELAY = String(ACCESS_REQUEST_TARGET_DAYS);
const YEARS = String(FISCAL_RECORD_RETENTION_YEARS);

const FR: PrivacyCopy = {
  title: 'Confidentialité et Loi 09-08 — Fisca',
  description: 'Responsable de traitement, finalités, durées, droits d’accès, de rectification et d’opposition, hébergement et absence de traceurs : mentions Loi 09-08 (CNDP) de Fisca.',
  heading: 'Confidentialité et protection des données (Loi n° 09-08)',
  lead: 'Cette page informe les personnes concernées conformément à la loi n° 09-08 relative à la protection des personnes physiques à l’égard du traitement des données à caractère personnel.',
  controller: {
    heading: 'Responsable de traitement',
    body: 'Le responsable de traitement est SYNAPTIC SYSTEMS SARL AU, éditeur de Fisca.',
    contactLabel: 'Contact pour exercer vos droits',
    addressLabel: 'Siège',
    address: 'Rabat, Maroc',
  },
  roles: {
    heading: 'Deux rôles distincts',
    items: [
      'Responsable de traitement : comptes utilisateurs, authentification, contrôle des dirigeants, facturation des abonnements, prospection commerciale et sécurité de la plateforme.',
      'Sous-traitant (article 23) : documents comptables, factures, journaux, déclarations et tickets de caisse traités uniquement sur instruction documentée de l’entreprise cliente ou du cabinet, qui reste responsable de ses propres traitements.',
    ],
  },
  purposes: {
    heading: 'Finalités et données traitées',
    intro: 'Traitements dont SYNAPTIC SYSTEMS SARL AU est responsable.',
    columns: ['Réf.', 'Finalité', 'Données', 'Durée de conservation'],
    byProcessing: {
      'T-01': 'Gestion des comptes, connexion OAuth et double authentification',
      'T-02': 'Vérification des dirigeants (KYB) et signature électronique',
      'T-03': 'Facturation des abonnements et recouvrement',
      'T-04': 'Scoring de solvabilité et d’authenticité documentaire des fournisseurs',
    },
    categories: {
      IDENTITY_CONTACT: 'Nom, adresse e-mail, téléphone',
      CONNECTION_LOGS: 'Adresse IP, journaux de connexion',
      MANAGER_ID_DOCUMENTS: 'CNIE du gérant, registre de commerce, RIB, certificat',
      BILLING_CONTACT: 'Contacts de facturation',
      PAYMENT_TOKEN: 'Jeton de paiement Payzone, RIB de virement',
      PUBLIC_REGISTER_DATA: 'Dirigeants référencés dans les registres publics, métadonnées de documents PDF',
    },
    noCardData: 'Fisca ne collecte aucun numéro de carte bancaire ni cryptogramme : le paiement est opéré par Payzone, qui ne restitue qu’un jeton opaque.',
  },
  retention: {
    heading: 'Durées de conservation',
    fiscal: `Pièces comptables et fiscales : ${YEARS} ans après la clôture de l’exercice (article 211 du CGI), puis effacement cryptographique.`,
    nonAccounting: 'Données non comptables (préférences marketing, historiques de conversation sans lien avec une pièce, brouillons non numérotés) : purgées sur demande d’opposition.',
    toBeSet: 'Durées propres à chaque traitement ci-dessus : à renseigner par le propriétaire.',
    ownerPending: 'à renseigner par le propriétaire',
  },
  rights: {
    heading: 'Vos droits',
    intro: 'La loi n° 09-08 vous reconnaît les droits suivants.',
    items: [
      { title: 'Information (article 5)', body: 'Savoir qui traite vos données, pourquoi, et comment exercer vos droits : c’est l’objet de cette page.' },
      { title: 'Accès (article 7)', body: 'Obtenir une copie des données personnelles que nous détenons sur vous.' },
      { title: 'Rectification (article 8)', body: 'Faire corriger des données inexactes ou incomplètes.' },
      { title: 'Opposition (article 9)', body: 'Vous opposer, pour des motifs légitimes, au traitement de vos données.' },
    ],
    howTo: 'Pour exercer ces droits, écrivez à l’adresse ci-dessous en précisant votre demande.',
    delay: `Délai cible de réponse à une demande d’accès : moins de ${DELAY} jours.`,
    fiscalLimit: 'Les pièces comptables et fiscales ne sont pas effaçables sur demande pendant leur durée légale de conservation : elles sont placées sous restriction d’accès. Les pièces validées ne sont jamais réécrites ; une pièce rectificative liée est émise.',
  },
  cndp: {
    heading: 'Références CNDP',
    intro: 'Les références ci-dessous sont celles attribuées par la Commission nationale de contrôle de la protection des données à caractère personnel (CNDP).',
    forms: {
      F115: 'Désignation du responsable et déclaration de l’entité (F115)',
      F211: 'Déclaration normale (F211)',
      F112: 'Autorisation préalable (F112)',
      F118: 'Transferts internationaux (F118)',
    },
    numberLabel: 'Numéro de récépissé ou d’autorisation',
    pending: 'à renseigner par le propriétaire',
  },
  hosting: {
    heading: 'Hébergement et sous-traitants ultérieurs',
    intro: 'Pour les offres standard, l’hébergement principal repose sur l’Union européenne ; la réplication miroir et plusieurs prestataires sont situés au Maroc. L’offre Fisca Souverain place les données au Maroc uniquement.',
    columns: ['Prestataire', 'Rôle', 'Localisation'],
    roles: {
      CLOUDFLARE: 'Bases de données et coffre d’archivage',
      AWS_SES: 'E-mails transactionnels',
      INFOBIP: 'WhatsApp Business et SMS',
      PAYZONE: 'Paiement par carte et abonnements',
      BARID_ESIGN: 'Signature électronique et horodatage',
      MIRROR_HOST: 'Réplication miroir et continuité',
    },
    regions: { EU: 'Union européenne', EU_MA: 'Union européenne et Maroc (Casablanca)', MA: 'Maroc' },
    legalBasis: 'Les transferts vers l’Union européenne s’appuient sur l’article 43 de la loi n° 09-08 et sur la liste des États offrant un niveau de protection suffisant retenue par la CNDP (délibération n° 236-2015), selon le registre interne des traitements.',
  },
  cookies: {
    heading: 'Cookies et traceurs',
    items: [
      'Ce site ne dépose aucun cookie.',
      'Aucun pixel publicitaire, aucun script et aucune police de caractères de tiers ne sont chargés.',
      'La langue se choisit par l’adresse de la page : rien n’est mémorisé.',
      'Si une mesure d’audience est activée un jour, elle se limitera à des compteurs quotidiens agrégés (page, langue, type de provenance), sans adresse IP ni identifiant individuel.',
      'L’application métier app.fisca.ma, distincte de ce site, n’utilise que des cookies techniques strictement nécessaires (session authentifiée, langue, protection anti-robot).',
    ],
  },
};

const AR: PrivacyCopy = {
  title: 'الخصوصية والقانون 09-08 — فيسكا',
  description: 'المسؤول عن المعالجة والغايات والمدد وحقوق الولوج والتصحيح والتعرض والاستضافة وغياب المتتبعات: بيانات القانون 09-08 (اللجنة الوطنية CNDP) الخاصة بفيسكا.',
  heading: 'الخصوصية وحماية المعطيات (القانون رقم 09-08)',
  lead: 'تخبر هذه الصفحة الأشخاص المعنيين وفق القانون رقم 09-08 المتعلق بحماية الأشخاص الذاتيين تجاه معالجة المعطيات ذات الطابع الشخصي.',
  controller: {
    heading: 'المسؤول عن المعالجة',
    body: 'المسؤول عن المعالجة هو SYNAPTIC SYSTEMS SARL AU، ناشر فيسكا.',
    contactLabel: 'جهة الاتصال لممارسة حقوقكم',
    addressLabel: 'المقر',
    address: 'الرباط، المغرب',
  },
  roles: {
    heading: 'صفتان متميزتان',
    items: [
      'مسؤول عن المعالجة: حسابات المستخدمين والمصادقة ومراقبة المسيرين وفوترة الاشتراكات والتسويق التجاري وأمن المنصة.',
      'مناول (المادة 23): المستندات المحاسبية والفواتير والسجلات والتصريحات وتذاكر الصندوق، وتُعالج فقط بناء على تعليمات موثقة من المقاولة الزبونة أو المكتب، اللذين يظلان مسؤولين عن معالجاتهما الخاصة.',
    ],
  },
  purposes: {
    heading: 'الغايات والمعطيات المعالجة',
    intro: 'المعالجات التي تتحمل SYNAPTIC SYSTEMS SARL AU مسؤوليتها.',
    columns: ['المرجع', 'الغاية', 'المعطيات', 'مدة الحفظ'],
    byProcessing: {
      'T-01': 'تدبير الحسابات والولوج عبر OAuth والمصادقة الثنائية',
      'T-02': 'التحقق من المسيرين (KYB) والتوقيع الإلكتروني',
      'T-03': 'فوترة الاشتراكات والتحصيل',
      'T-04': 'تقييم الملاءة والتحقق من صحة مستندات الموردين',
    },
    categories: {
      IDENTITY_CONTACT: 'الاسم والبريد الإلكتروني والهاتف',
      CONNECTION_LOGS: 'عنوان IP وسجلات الاتصال',
      MANAGER_ID_DOCUMENTS: 'البطاقة الوطنية للمسير والسجل التجاري وRIB والشهادة',
      BILLING_CONTACT: 'جهات اتصال الفوترة',
      PAYMENT_TOKEN: 'رمز الأداء من Payzone وRIB التحويل',
      PUBLIC_REGISTER_DATA: 'مسيرون واردون في السجلات العمومية، والبيانات الوصفية لملفات PDF',
    },
    noCardData: 'لا تجمع فيسكا أي رقم لبطاقة بنكية ولا رمز تحقق: الأداء تتولاه Payzone التي لا ترجع سوى رمز مبهم.',
  },
  retention: {
    heading: 'مدد الحفظ',
    fiscal: `المستندات المحاسبية والجبائية: ${YEARS} سنوات بعد إقفال السنة المحاسبية (المادة 211 من المدونة العامة للضرائب)، ثم المحو التشفيري.`,
    nonAccounting: 'المعطيات غير المحاسبية (تفضيلات التسويق وسجلات المحادثة غير المرتبطة بمستند والمسودات غير المرقمة): تُمحى عند طلب التعرض.',
    toBeSet: 'المدد الخاصة بكل معالجة أعلاه: يملؤها مالك المشروع.',
    ownerPending: 'يملؤه مالك المشروع',
  },
  rights: {
    heading: 'حقوقكم',
    intro: 'يعترف لكم القانون رقم 09-08 بالحقوق التالية.',
    items: [
      { title: 'الإخبار (المادة 5)', body: 'معرفة من يعالج معطياتكم ولماذا وكيف تمارسون حقوقكم: وهذا هو موضوع هذه الصفحة.' },
      { title: 'الولوج (المادة 7)', body: 'الحصول على نسخة من المعطيات الشخصية التي نحتفظ بها عنكم.' },
      { title: 'التصحيح (المادة 8)', body: 'تصحيح المعطيات غير الدقيقة أو غير المكتملة.' },
      { title: 'التعرض (المادة 9)', body: 'التعرض، لأسباب مشروعة، على معالجة معطياتكم.' },
    ],
    howTo: 'لممارسة هذه الحقوق، راسلونا على العنوان أدناه مع بيان طلبكم.',
    delay: `الأجل المستهدف للرد على طلب الولوج: أقل من ${DELAY} يوما.`,
    fiscalLimit: 'لا يمكن محو المستندات المحاسبية والجبائية بناء على طلب خلال مدة الحفظ القانونية: توضع تحت تقييد الولوج. ولا يُعاد أبدا كتابة المستندات المصادق عليها؛ بل يُصدر مستند تصحيحي مرتبط بها.',
  },
  cndp: {
    heading: 'مراجع اللجنة الوطنية CNDP',
    intro: 'المراجع أدناه هي تلك التي تمنحها اللجنة الوطنية لمراقبة حماية المعطيات ذات الطابع الشخصي (CNDP).',
    forms: {
      F115: 'تعيين المسؤول والتصريح بالكيان (F115)',
      F211: 'تصريح عادي (F211)',
      F112: 'إذن مسبق (F112)',
      F118: 'التحويلات الدولية (F118)',
    },
    numberLabel: 'رقم الوصل أو الإذن',
    pending: 'يملؤه مالك المشروع',
  },
  hosting: {
    heading: 'الاستضافة والمناولون اللاحقون',
    intro: 'بالنسبة للعروض العادية، ترتكز الاستضافة الرئيسية على الاتحاد الأوروبي؛ أما النسخ المرآة وعدة مزودين فموجودون بالمغرب. ويضع عرض Fisca Souverain المعطيات بالمغرب فقط.',
    columns: ['المزود', 'الدور', 'الموقع'],
    roles: {
      CLOUDFLARE: 'قواعد البيانات وخزنة الأرشيف',
      AWS_SES: 'رسائل البريد الإلكتروني المعاملاتية',
      INFOBIP: 'WhatsApp Business والرسائل القصيرة',
      PAYZONE: 'الأداء بالبطاقة والاشتراكات',
      BARID_ESIGN: 'التوقيع الإلكتروني والتأريخ',
      MIRROR_HOST: 'النسخ المرآة واستمرارية الخدمة',
    },
    regions: { EU: 'الاتحاد الأوروبي', EU_MA: 'الاتحاد الأوروبي والمغرب (الدار البيضاء)', MA: 'المغرب' },
    legalBasis: 'ترتكز التحويلات نحو الاتحاد الأوروبي على المادة 43 من القانون رقم 09-08 وعلى لائحة الدول ذات مستوى الحماية الكافي التي اعتمدتها اللجنة الوطنية (المداولة رقم 236-2015)، وفق السجل الداخلي للمعالجات.',
  },
  cookies: {
    heading: 'ملفات تعريف الارتباط والمتتبعات',
    items: [
      'لا يضع هذا الموقع أي ملف تعريف ارتباط.',
      'لا يتم تحميل أي بكسل إعلاني ولا سكريبت ولا خط كتابة تابع لطرف ثالث.',
      'تُختار اللغة من عنوان الصفحة: ولا يُحفظ أي شيء.',
      'إذا فُعّل قياس الجمهور يوما ما، فسيقتصر على عدادات يومية مجمعة (الصفحة واللغة ونوع المصدر)، دون عنوان IP ودون معرف فردي.',
      'التطبيق المهني app.fisca.ma، المنفصل عن هذا الموقع، لا يستعمل إلا ملفات تعريف ارتباط تقنية ضرورية (جلسة موثقة، اللغة، الحماية من الروبوتات).',
    ],
  },
};

const ARY: PrivacyCopy = {
  title: 'الخصوصية والقانون 09-08 — فيسكا',
  description: 'شكون المسؤول على المعالجة، الغايات، المدد، حقوق الولوج والتصحيح والتعرض، الاستضافة وغياب المتتبعات: معلومات القانون 09-08 (CNDP) ديال فيسكا.',
  heading: 'الخصوصية وحماية المعطيات (القانون رقم 09-08)',
  lead: 'هاد الصفحة كتخبّر الأشخاص المعنيين على حسب القانون رقم 09-08 ديال حماية الأشخاص الذاتيين فمعالجة المعطيات الشخصية.',
  controller: {
    heading: 'المسؤول على المعالجة',
    body: 'المسؤول على المعالجة هو SYNAPTIC SYSTEMS SARL AU، الشركة اللي ناشرة فيسكا.',
    contactLabel: 'التواصل باش تمارس حقوقك',
    addressLabel: 'المقر',
    address: 'الرباط، المغرب',
  },
  roles: {
    heading: 'جوج صفات مختلفين',
    items: [
      'مسؤول على المعالجة: حسابات المستعملين، المصادقة، مراقبة المسيرين، فوترة الاشتراكات، التسويق التجاري وأمن المنصة.',
      'مناول (المادة 23): الوثائق المحاسبية، الفواتير، السجلات، التصريحات وتذاكر الكايس، كتتعالج غير على حسب تعليمات موثقة من الشركة الكليان ولا المكتب، وهوما اللي كيبقاو مسؤولين على المعالجات ديالهم.',
    ],
  },
  purposes: {
    heading: 'الغايات والمعطيات اللي كتتعالج',
    intro: 'المعالجات اللي SYNAPTIC SYSTEMS SARL AU مسؤولة عليها.',
    columns: ['المرجع', 'الغاية', 'المعطيات', 'مدة الحفظ'],
    byProcessing: {
      'T-01': 'تسيير الحسابات والدخول بـ OAuth والمصادقة الثنائية',
      'T-02': 'التحقق من المسيرين (KYB) والتوقيع الإلكتروني',
      'T-03': 'فوترة الاشتراكات والتحصيل',
      'T-04': 'تقييم الملاءة والتأكد من صحة وثائق الموردين',
    },
    categories: {
      IDENTITY_CONTACT: 'السمية، الإيميل، التيليفون',
      CONNECTION_LOGS: 'عنوان IP وسجلات الدخول',
      MANAGER_ID_DOCUMENTS: 'البطاقة الوطنية ديال المسير، السجل التجاري، RIB، الشهادة',
      BILLING_CONTACT: 'جهات الاتصال ديال الفوترة',
      PAYMENT_TOKEN: 'رمز الخلاص من Payzone وRIB ديال التحويل',
      PUBLIC_REGISTER_DATA: 'مسيرين مذكورين فالسجلات العمومية، والبيانات الوصفية ديال ملفات PDF',
    },
    noCardData: 'فيسكا ما كتجمع حتى رقم ديال كارطة بنكية ولا الكود ديالها: الخلاص كيديرو Payzone اللي ما كترجع غير رمز مبهم.',
  },
  retention: {
    heading: 'مدد الحفظ',
    fiscal: `الوثائق المحاسبية والجبائية: ${YEARS} سنين من بعد إقفال السنة المحاسبية (المادة 211 من المدونة العامة للضرائب)، من بعد كيتمحاو بالتشفير.`,
    nonAccounting: 'المعطيات اللي ماشي محاسبية (تفضيلات التسويق، سجلات المحادثة اللي ما مرتبطاش بوثيقة، المسودات اللي بلا ترقيم): كتتمحى إيلا طلبتي التعرض.',
    toBeSet: 'المدد الخاصة بكل معالجة فوق: خاص المالك يعمرها.',
    ownerPending: 'خاص المالك يعمرو',
  },
  rights: {
    heading: 'الحقوق ديالك',
    intro: 'القانون رقم 09-08 كيعطيك هاد الحقوق.',
    items: [
      { title: 'الإخبار (المادة 5)', body: 'تعرف شكون كيعالج المعطيات ديالك، علاش، وكيفاش تمارس حقوقك: وهادشي هو موضوع هاد الصفحة.' },
      { title: 'الولوج (المادة 7)', body: 'تاخذ نسخة من المعطيات الشخصية اللي عندنا عليك.' },
      { title: 'التصحيح (المادة 8)', body: 'تصحح المعطيات اللي ماشي صحيحة ولا ناقصة.' },
      { title: 'التعرض (المادة 9)', body: 'تعترض، لأسباب مشروعة، على معالجة المعطيات ديالك.' },
    ],
    howTo: 'باش تمارس هاد الحقوق، كتب لينا فالعنوان لتحت وقول لينا شنو بغيتي.',
    delay: `الأجل المستهدف للجواب على طلب الولوج: أقل من ${DELAY} يوم.`,
    fiscalLimit: 'الوثائق المحاسبية والجبائية ما كتتمحاش إيلا طلبتي هادشي مادام مدة الحفظ القانونية ما سالاتش: كتتحط تحت تقييد الولوج. الوثائق اللي تصادق عليها عمرها ما كتتعاود كتابتها؛ كتصدر وثيقة تصحيحية مرتبطة بها.',
  },
  cndp: {
    heading: 'مراجع CNDP',
    intro: 'المراجع لتحت هوما اللي كتعطيها اللجنة الوطنية لمراقبة حماية المعطيات ذات الطابع الشخصي (CNDP).',
    forms: {
      F115: 'تعيين المسؤول والتصريح بالكيان (F115)',
      F211: 'تصريح عادي (F211)',
      F112: 'إذن مسبق (F112)',
      F118: 'التحويلات الدولية (F118)',
    },
    numberLabel: 'رقم الوصل ولا الإذن',
    pending: 'خاص المالك يعمرو',
  },
  hosting: {
    heading: 'الاستضافة والمناولين اللاحقين',
    intro: 'فالعروض العادية، الاستضافة الأساسية كاينة فالاتحاد الأوروبي؛ والنسخ المرآة وبزاف ديال المزودين كاينين فالمغرب. عرض Fisca Souverain كيحط المعطيات فالمغرب غير.',
    columns: ['المزود', 'الدور', 'فين كاين'],
    roles: {
      CLOUDFLARE: 'قواعد البيانات وخزنة الأرشيف',
      AWS_SES: 'إيميلات المعاملات',
      INFOBIP: 'WhatsApp Business والرسائل القصيرة',
      PAYZONE: 'الخلاص بالكارطة والاشتراكات',
      BARID_ESIGN: 'التوقيع الإلكتروني والتأريخ',
      MIRROR_HOST: 'النسخ المرآة واستمرارية الخدمة',
    },
    regions: { EU: 'الاتحاد الأوروبي', EU_MA: 'الاتحاد الأوروبي والمغرب (الدار البيضاء)', MA: 'المغرب' },
    legalBasis: 'التحويلات للاتحاد الأوروبي مبنية على المادة 43 من القانون رقم 09-08 وعلى لائحة الدول اللي فيها حماية كافية اللي اعتمدتها CNDP (المداولة رقم 236-2015)، على حسب السجل الداخلي ديال المعالجات.',
  },
  cookies: {
    heading: 'الكوكيز والمتتبعات',
    items: [
      'هاد الموقع ما كيحط حتى كوكي.',
      'ما كاين حتى بيكسل إشهاري ولا سكريبت ولا خط ديال طرف تالت كيتحمل.',
      'اللغة كتختارها من عنوان الصفحة: ما كيتحفظ والو.',
      'إيلا تفعّل قياس الجمهور شي نهار، غادي يبقى غير عدادات يومية مجمعة (الصفحة، اللغة، نوع المصدر)، بلا عنوان IP وبلا معرف فردي.',
      'التطبيق app.fisca.ma، اللي بوحدو على هاد الموقع، كيستعمل غير كوكيز تقنية ضرورية (جلسة موثقة، اللغة، الحماية من الروبوتات).',
    ],
  },
};

const EN: PrivacyCopy = {
  title: 'Privacy and Law 09-08 — Fisca',
  description: 'Data controller, purposes, retention, rights of access, rectification and objection, hosting and absence of trackers: Fisca’s Law 09-08 (CNDP) notices.',
  heading: 'Privacy and data protection (Law No. 09-08)',
  lead: 'This page informs data subjects in line with Law No. 09-08 on the protection of individuals with regard to the processing of personal data.',
  controller: {
    heading: 'Data controller',
    body: 'The data controller is SYNAPTIC SYSTEMS SARL AU, publisher of Fisca.',
    contactLabel: 'Contact to exercise your rights',
    addressLabel: 'Registered office',
    address: 'Rabat, Morocco',
  },
  roles: {
    heading: 'Two distinct roles',
    items: [
      'Controller: user accounts, authentication, verification of managers, subscription billing, commercial prospecting and platform security.',
      'Processor (article 23): accounting documents, invoices, ledgers, returns and till receipts, processed only on the documented instruction of the client company or firm, which remains responsible for its own processing.',
    ],
  },
  purposes: {
    heading: 'Purposes and data processed',
    intro: 'Processing for which SYNAPTIC SYSTEMS SARL AU is the controller.',
    columns: ['Ref.', 'Purpose', 'Data', 'Retention period'],
    byProcessing: {
      'T-01': 'Account management, OAuth sign-in and two-factor authentication',
      'T-02': 'Verification of managers (KYB) and electronic signature',
      'T-03': 'Subscription billing and collection',
      'T-04': 'Solvency and document-authenticity scoring of suppliers',
    },
    categories: {
      IDENTITY_CONTACT: 'Name, e-mail address, telephone',
      CONNECTION_LOGS: 'IP address, connection logs',
      MANAGER_ID_DOCUMENTS: 'Manager’s national ID (CNIE), commercial register extract, bank details (RIB), certificate',
      BILLING_CONTACT: 'Billing contacts',
      PAYMENT_TOKEN: 'Payzone payment token, transfer bank details (RIB)',
      PUBLIC_REGISTER_DATA: 'Managers listed in public registers, PDF document metadata',
    },
    noCardData: 'Fisca collects no bank card number or security code: payment is handled by Payzone, which only returns an opaque token.',
  },
  retention: {
    heading: 'Retention periods',
    fiscal: `Accounting and tax records: ${YEARS} years after the close of the financial year (article 211 of the General Tax Code), then cryptographic erasure.`,
    nonAccounting: 'Non-accounting data (marketing preferences, conversation histories not tied to a document, unnumbered drafts): purged on request when you object.',
    toBeSet: 'Retention periods specific to each processing above: to be filled in by the owner.',
    ownerPending: 'to be filled in by the owner',
  },
  rights: {
    heading: 'Your rights',
    intro: 'Law No. 09-08 gives you the following rights.',
    items: [
      { title: 'Information (article 5)', body: 'To know who processes your data, why, and how to exercise your rights: this page serves that purpose.' },
      { title: 'Access (article 7)', body: 'To obtain a copy of the personal data we hold about you.' },
      { title: 'Rectification (article 8)', body: 'To have inaccurate or incomplete data corrected.' },
      { title: 'Objection (article 9)', body: 'To object, on legitimate grounds, to the processing of your data.' },
    ],
    howTo: 'To exercise these rights, write to the address below stating your request.',
    delay: `Target response time for an access request: under ${DELAY} days.`,
    fiscalLimit: 'Accounting and tax records cannot be erased on request during their legal retention period: they are placed under access restriction. Posted records are never rewritten; a linked corrective record is issued.',
  },
  cndp: {
    heading: 'CNDP references',
    intro: 'The references below are those assigned by the national commission for the control of personal data protection (CNDP).',
    forms: {
      F115: 'Designation of the controller and declaration of the entity (F115)',
      F211: 'Standard declaration (F211)',
      F112: 'Prior authorisation (F112)',
      F118: 'International transfers (F118)',
    },
    numberLabel: 'Receipt or authorisation number',
    pending: 'to be filled in by the owner',
  },
  hosting: {
    heading: 'Hosting and sub-processors',
    intro: 'For standard plans, primary hosting relies on the European Union; the mirror replica and several providers are located in Morocco. The Fisca Souverain plan keeps data in Morocco only.',
    columns: ['Provider', 'Role', 'Location'],
    roles: {
      CLOUDFLARE: 'Databases and archive vault',
      AWS_SES: 'Transactional e-mail',
      INFOBIP: 'WhatsApp Business and SMS',
      PAYZONE: 'Card payment and subscriptions',
      BARID_ESIGN: 'Electronic signature and timestamping',
      MIRROR_HOST: 'Mirror replication and continuity',
    },
    regions: { EU: 'European Union', EU_MA: 'European Union and Morocco (Casablanca)', MA: 'Morocco' },
    legalBasis: 'Transfers to the European Union rely on article 43 of Law No. 09-08 and on the list of States offering an adequate level of protection adopted by the CNDP (deliberation No. 236-2015), according to the internal register of processing.',
  },
  cookies: {
    heading: 'Cookies and trackers',
    items: [
      'This site sets no cookie.',
      'No advertising pixel, script or font from a third party is loaded.',
      'The language is chosen through the page address: nothing is remembered.',
      'If audience measurement is ever enabled, it will be limited to aggregated daily counters (page, language, type of referrer), with no IP address and no individual identifier.',
      'The business application app.fisca.ma, separate from this site, uses only strictly necessary technical cookies (authenticated session, language, anti-bot protection).',
    ],
  },
};

const PRIVACY_COPY: Readonly<Record<CopyLocale, PrivacyCopy>> = { fr: FR, ar: AR, ary: ARY, en: EN };

export function getPrivacyCopy(locale: MarketingLocale): PrivacyCopy {
  return PRIVACY_COPY[copyLocaleOf(locale)];
}
