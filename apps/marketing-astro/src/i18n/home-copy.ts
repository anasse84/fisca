import { FIDUCIARY_METER, TRIAL_DAYS } from '../content/pricing.ts';
import { formatBpsPercent } from '../lib/money.ts';
import { copyLocaleOf, usesFrenchFallback } from './copy-locale.ts';
import type { CopyLocale } from './copy-locale.ts';
import type { MarketingLocale } from './locales.ts';

export interface CopyItem {
  readonly title: string;
  readonly body: string;
}

export interface HomeCopy {
  readonly title: string;
  readonly description: string;
  readonly heading: string;
  readonly lead: string;
  readonly ctaPricing: string;
  readonly ctaTrial: string;
  readonly heroNote: string;
  readonly benefits: { readonly heading: string; readonly items: readonly CopyItem[] };
  /** Section « Validation simulée » : l'envoi à la plateforme est un pilote simulé, jamais une validation officielle. */
  readonly simulated: { readonly heading: string; readonly badge: string; readonly paragraphs: readonly string[] };
  readonly sovereignty: {
    readonly heading: string;
    readonly intro: string;
    readonly items: readonly CopyItem[];
    readonly link: string;
  };
  readonly pricingTeaser: {
    readonly heading: string;
    readonly body: string;
    readonly cta: string;
    readonly fromLabel: string;
    readonly perMonthHt: string;
  };
}

const DAYS = String(TRIAL_DAYS);
const MIN_DOSSIERS = String(FIDUCIARY_METER.volumeDiscount.minActiveDossiers);
const DISCOUNT = formatBpsPercent(FIDUCIARY_METER.volumeDiscount.discount_bps);

const FR: HomeCopy = {
  title: 'Fisca — Facturation et comptabilité pour les entreprises marocaines',
  description: 'Fisca simplifie la facturation, la TVA et la comptabilité CGNC des PME, TPE et indépendants au Maroc.',
  heading: 'Facturation et comptabilité pour les entreprises marocaines',
  lead: `Fisca réunit facturation bilingue français-arabe, comptabilité CGNC, caisse tactile et espace cabinet. Les tarifs sont publics et hors taxes ; l’essai Sandbox dure ${DAYS} jours.`,
  ctaPricing: 'Voir les tarifs',
  ctaTrial: `Essai gratuit de ${DAYS} jours`,
  heroNote: 'L’envoi des factures à la plateforme de facturation électronique est aujourd’hui simulé (voir « Validation simulée » plus bas).',
  benefits: {
    heading: 'Ce que Fisca fait pour vous',
    items: [
      { title: 'Factures bilingues français-arabe', body: 'Devis signés par code à usage unique et factures bilingues, pour l’auto-entrepreneur comme pour la PME.' },
      { title: 'Comptabilité CGNC', body: 'Grand livre CGNC immuable : une écriture validée ne se modifie pas, elle se corrige par une contre-passation.' },
      { title: 'Caisse tactile et connecteurs', body: 'Une caisse tactile avec mode hors ligne, ou un connecteur pour vos caisses existantes. Fisca POS Bridge est inclus dès l’offre Essentiel.' },
      { title: 'Espace cabinet pour les fiduciaires', body: `Socle cabinet en marque blanche et facturation au dossier actif, avec une remise de volume de ${DISCOUNT} dès ${MIN_DOSSIERS} dossiers.` },
      { title: 'Prix publics, sans compteur caché', body: 'Pas de crédits d’IA ni de facturation à la pièce : la grille est publique, en dirhams hors taxes.' },
      { title: 'Archivage de dix ans', body: 'Un coffre d’archivage à écriture unique conserve vos pièces pendant dix ans.' },
    ],
  },
  simulated: {
    heading: 'Validation simulée',
    badge: 'Validation simulée',
    paragraphs: [
      'Fisca prépare l’envoi de vos factures vers la plateforme de facturation électronique. Aujourd’hui, cet envoi se fait uniquement en pilote simulé : l’état affiché dans l’interface est « Validation simulée ».',
      'Fisca ne revendique aucune validation officielle de la DGI ni de xHub. Tant que les spécifications techniques officielles ne sont pas publiées, les profils de Fisca restent provisoires et seront remplacés à leur parution.',
      'Cette simulation ne remplace aucune démarche auprès de l’administration fiscale.',
    ],
  },
  sovereignty: {
    heading: 'Souveraineté et protection des données',
    intro: 'Ce que décrit l’architecture de Fisca, sans promesse au-delà.',
    items: [
      { title: 'Hébergement principal dans l’Union européenne', body: 'Bases de données et coffre d’archivage chez Cloudflare, en juridiction UE, avec une réplication asynchrone vers un serveur miroir situé au Maroc.' },
      { title: 'Paiement et signature au Maroc', body: 'Le paiement par carte passe par Payzone et la signature électronique par Barid eSign, deux prestataires situés au Maroc ; Fisca ne collecte ni numéro de carte ni cryptogramme.' },
      { title: 'IA : données anonymisées avant l’appel', body: 'Les données personnelles sont anonymisées en mémoire avant tout appel à un service d’IA externe.' },
      { title: 'Aucun traceur tiers', body: 'Ce site ne dépose aucun cookie et ne charge aucun pixel ni script tiers.' },
      { title: 'Fisca Souverain : tout au Maroc', body: 'Pour les entités soumises à la loi 05-20, un contrat annuel place la base de données, le coffre d’archivage et l’inférence GPU sur le territoire marocain.' },
    ],
    link: 'Détail des traitements et des sous-traitants',
  },
  pricingTeaser: {
    heading: 'Une grille tarifaire publique',
    body: 'Solo, Essentiel et Croissance pour les PME, caisse tactile, tarification au dossier pour les cabinets, contrats annuels pour les grands comptes.',
    cta: 'Voir toute la grille tarifaire',
    fromLabel: 'dès',
    perMonthHt: 'par mois, hors taxes',
  },
};

const AR: HomeCopy = {
  title: 'فيسكا — الفوترة والمحاسبة للمقاولات المغربية',
  description: 'تبسّط فيسكا الفوترة والضريبة على القيمة المضافة والمحاسبة وفق المخطط المحاسبي المغربي للمقاولات الصغيرة والمتوسطة.',
  heading: 'الفوترة والمحاسبة للمقاولات المغربية',
  lead: `تجمع فيسكا بين الفوترة ثنائية اللغة (العربية والفرنسية) والمحاسبة وفق المخطط المحاسبي المغربي للمقاولات (CGNC) والصندوق اللمسي وفضاء المكاتب المحاسبية. الأسعار معلنة ودون احتساب الضريبة، ومدة التجربة ${DAYS} يوما.`,
  ctaPricing: 'عرض الأسعار',
  ctaTrial: `تجربة مجانية لمدة ${DAYS} يوما`,
  heroNote: 'إرسال الفواتير إلى منصة الفوترة الإلكترونية يتم حاليا بشكل محاكى فقط (انظر «تحقق محاكى» أسفله).',
  benefits: {
    heading: 'ما تقدمه فيسكا لك',
    items: [
      { title: 'فواتير ثنائية اللغة', body: 'عروض أسعار موقعة برمز لمرة واحدة وفواتير بالعربية والفرنسية، تناسب المقاول الذاتي كما تناسب المقاولة المتوسطة.' },
      { title: 'محاسبة CGNC', body: 'دفتر أستاذ عام غير قابل للتعديل: القيد المصادق عليه لا يُعدَّل، بل يُصحَّح بقيد عكسي.' },
      { title: 'صندوق لمسي وموصلات', body: 'صندوق لمسي بوضع الاشتغال دون اتصال، أو موصل لأجهزة الأداء الحالية. موصل Fisca POS Bridge مشمول ابتداء من عرض Essentiel.' },
      { title: 'فضاء للمكاتب المحاسبية', body: `قاعدة مكتب بالعلامة البيضاء وفوترة حسب الملف النشط، مع تخفيض على الحجم قدره ${DISCOUNT} ابتداء من ${MIN_DOSSIERS} ملف.` },
      { title: 'أسعار معلنة دون عدّاد خفي', body: 'لا أرصدة للذكاء الاصطناعي ولا فوترة بالقطعة: الشبكة التعريفية معلنة بالدرهم ودون احتساب الضريبة.' },
      { title: 'أرشفة لمدة عشر سنوات', body: 'خزنة أرشفة بالكتابة لمرة واحدة تحفظ مستنداتك مدة عشر سنوات.' },
    ],
  },
  simulated: {
    heading: 'تحقق محاكى',
    badge: 'تحقق محاكى',
    paragraphs: [
      'تُعدّ فيسكا إرسال فواتيرك إلى منصة الفوترة الإلكترونية. وحاليا يتم هذا الإرسال في إطار تجريبي محاكى فقط، والحالة المعروضة في الواجهة هي «تحقق محاكى».',
      'لا تدّعي فيسكا أي مصادقة رسمية من المديرية العامة للضرائب (DGI) أو من xHub. وما دامت المواصفات التقنية الرسمية غير منشورة، تبقى ملفات فيسكا مؤقتة وسيتم استبدالها عند صدورها.',
      'هذه المحاكاة لا تغني عن أي إجراء لدى الإدارة الضريبية.',
    ],
  },
  sovereignty: {
    heading: 'السيادة وحماية المعطيات',
    intro: 'ما تصفه بنية فيسكا، دون وعود تتجاوزه.',
    items: [
      { title: 'الاستضافة الرئيسية في الاتحاد الأوروبي', body: 'قواعد البيانات وخزنة الأرشيف لدى Cloudflare ضمن الاختصاص القضائي للاتحاد الأوروبي، مع نسخ غير متزامن إلى خادم مرآة موجود بالمغرب.' },
      { title: 'الأداء والتوقيع بالمغرب', body: 'يتم الأداء بالبطاقة عبر Payzone والتوقيع الإلكتروني عبر Barid eSign، وهما مزودان موجودان بالمغرب؛ ولا تجمع فيسكا رقم البطاقة ولا رمز التحقق.' },
      { title: 'الذكاء الاصطناعي: معطيات مجهولة الهوية قبل الاستدعاء', body: 'تُخفى هوية المعطيات الشخصية في الذاكرة قبل أي استدعاء لخدمة ذكاء اصطناعي خارجية.' },
      { title: 'لا متتبعات خارجية', body: 'لا يضع هذا الموقع أي ملف تعريف ارتباط ولا يحمّل أي بكسل أو سكريبت تابع لطرف ثالث.' },
      { title: 'Fisca Souverain: كل شيء داخل المغرب', body: 'بالنسبة للجهات الخاضعة للقانون 05-20، يضع عقد سنوي قاعدة البيانات وخزنة الأرشيف والاستدلال بمعالجات GPU فوق التراب المغربي.' },
    ],
    link: 'تفاصيل المعالجات والمناولين',
  },
  pricingTeaser: {
    heading: 'شبكة تعريفية معلنة',
    body: 'Solo وEssentiel وCroissance للمقاولات، وصندوق لمسي، وتسعير حسب الملف للمكاتب المحاسبية، وعقود سنوية للحسابات الكبرى.',
    cta: 'عرض الشبكة التعريفية كاملة',
    fromLabel: 'ابتداء من',
    perMonthHt: 'في الشهر، دون احتساب الضريبة',
  },
};

const ARY: HomeCopy = {
  title: 'فيسكا — الفاتورة والمحاسبة للمقاولات فالمغرب',
  description: 'فيسكا كتسهّل عليك الفاتورة والـTVA والمحاسبة ديال الشركة الصغيرة والمتوسطة فالمغرب.',
  heading: 'الفاتورة والمحاسبة للمقاولات فالمغرب',
  lead: `فيسكا كتجمع ليك الفاتورة بالعربية والفرنسية، والمحاسبة ديال CGNC، والكايس اللمسي، وفضاء الفيدوسيير. الأثمنة معلنة وبلا TVA، والتجربة ديالها ${DAYS} يوم.`,
  ctaPricing: 'شوف الأثمنة',
  ctaTrial: `جرّب بلا فلوس ${DAYS} يوم`,
  heroNote: 'دابا، سيفاط الفواتير للمنصة ديال الفاتورة الإلكترونية كايتدار غير بالمحاكاة (شوف «تحقق بالمحاكاة» لتحت).',
  benefits: {
    heading: 'شنو كتدير ليك فيسكا',
    items: [
      { title: 'فواتير بالعربية والفرنسية', body: 'عروض أثمنة موقّعة بكود ديال مرة وحدة وفواتير بجوج لغات، كتصلح للمقاول الذاتي وللشركة الصغيرة والمتوسطة.' },
      { title: 'محاسبة CGNC', body: 'دفتر الأستاذ ما كيتبدلش: القيد اللي تصادق عليه ما كتعدّلوش، كتصححو بقيد عكسي.' },
      { title: 'الكايس اللمسي والموصلات', body: 'كايس لمسي كيخدم حتى بلا إنترنت، ولا موصل للكيسات اللي عندك. Fisca POS Bridge داخل فعرض Essentiel وما فوق.' },
      { title: 'فضاء للفيدوسيير', body: `قاعدة ديال المكتب بالعلامة البيضاء وفاتورة على قبل الدوسي النشيط، مع تخفيض ${DISCOUNT} من ${MIN_DOSSIERS} دوسي.` },
      { title: 'أثمنة معلنة وبلا عداد مخبّي', body: 'ما كاينش رصيد ديال الذكاء الاصطناعي ولا خلاص على قبل الوثيقة: الأثمنة معلنة بالدرهم وبلا TVA.' },
      { title: 'أرشيف لعشر سنين', body: 'خزنة ديال الأرشيف كتكتب مرة وحدة باش تحفظ الوثائق ديالك لعشر سنين.' },
    ],
  },
  simulated: {
    heading: 'تحقق بالمحاكاة',
    badge: 'تحقق بالمحاكاة',
    paragraphs: [
      'فيسكا كتحضّر سيفاط الفواتير ديالك للمنصة ديال الفاتورة الإلكترونية. دابا هاد السيفاط كايتدار غير فالتجربة بالمحاكاة، والحالة اللي كتبان فالواجهة هي «تحقق بالمحاكاة».',
      'فيسكا ما كتدّعي حتى مصادقة رسمية من DGI ولا من xHub. حتى تنشر المواصفات التقنية الرسمية، البروفيلات ديال فيسكا كتبقى مؤقتة وغادي تتبدل ملي تخرج.',
      'هاد المحاكاة ما كتعوّض حتى إجراء مع الإدارة الضريبية.',
    ],
  },
  sovereignty: {
    heading: 'السيادة وحماية المعطيات',
    intro: 'غير اللي كتوصفو الهندسة ديال فيسكا، بلا وعود زايدة.',
    items: [
      { title: 'الاستضافة الأساسية فالاتحاد الأوروبي', body: 'قواعد البيانات وخزنة الأرشيف عند Cloudflare فالاختصاص القضائي الأوروبي، مع نسخ غير متزامن لسيرفر مرآة كاين فالمغرب.' },
      { title: 'الخلاص والتوقيع فالمغرب', body: 'الخلاص بالكارطة كيدوز من Payzone والتوقيع الإلكتروني من Barid eSign، جوج مزودين فالمغرب؛ وفيسكا ما كتجمعش رقم الكارطة ولا الكود ديالها.' },
      { title: 'الذكاء الاصطناعي: معطيات بلا هوية قبل الاستدعاء', body: 'الهوية ديال المعطيات الشخصية كتّخبّا فالذاكرة قبل أي استدعاء لخدمة ذكاء اصطناعي خارجية.' },
      { title: 'ما كاين حتى متتبع خارجي', body: 'هاد الموقع ما كيحط حتى كوكي وما كيحمّل حتى بيكسل ولا سكريبت ديال طرف تالت.' },
      { title: 'Fisca Souverain: كلشي فالمغرب', body: 'للجهات اللي خاضعة للقانون 05-20، عقد سنوي كيحط قاعدة البيانات وخزنة الأرشيف والـGPU فالتراب المغربي.' },
    ],
    link: 'تفاصيل المعالجات والمناولين',
  },
  pricingTeaser: {
    heading: 'شبكة أثمنة معلنة',
    body: 'Solo وEssentiel وCroissance للشركات، والكايس اللمسي، والتسعير على قبل الدوسي للفيدوسيير، وعقود سنوية للحسابات الكبرى.',
    cta: 'شوف الشبكة كاملة',
    fromLabel: 'من',
    perMonthHt: 'فالشهر، بلا TVA',
  },
};

const EN: HomeCopy = {
  title: 'Fisca — Invoicing and accounting for Moroccan businesses',
  description: 'Fisca simplifies invoicing, VAT and CGNC accounting for small and medium businesses and freelancers in Morocco.',
  heading: 'Invoicing and accounting for Moroccan businesses',
  lead: `Fisca brings together bilingual French-Arabic invoicing, CGNC accounting, a touch point-of-sale and a firm workspace. Prices are public and exclude tax; the Sandbox trial lasts ${DAYS} days.`,
  ctaPricing: 'See pricing',
  ctaTrial: `Free ${DAYS}-day trial`,
  heroNote: 'Sending invoices to the e-invoicing platform is simulated today (see “Simulated validation” below).',
  benefits: {
    heading: 'What Fisca does for you',
    items: [
      { title: 'Bilingual French-Arabic invoices', body: 'Quotes signed with a one-time code and bilingual invoices, for freelancers and for businesses alike.' },
      { title: 'CGNC accounting', body: 'An immutable CGNC general ledger: a posted entry is never edited, it is corrected with a reversal entry.' },
      { title: 'Touch POS and connectors', body: 'A touch POS with an offline mode, or a connector for the tills you already use. Fisca POS Bridge is included from the Essentiel plan.' },
      { title: 'A workspace for accounting firms', body: `A white-label firm base and billing per active client file, with a ${DISCOUNT} volume discount from ${MIN_DOSSIERS} files.` },
      { title: 'Public prices, no hidden meter', body: 'No AI credits and no per-document billing: the price grid is public, in dirhams, excluding tax.' },
      { title: 'Ten-year archive', body: 'A write-once archive vault keeps your documents for ten years.' },
    ],
  },
  simulated: {
    heading: 'Simulated validation',
    badge: 'Simulated validation',
    paragraphs: [
      'Fisca is preparing to send your invoices to the e-invoicing platform. Today this sending only runs as a simulated pilot: the status shown in the interface is “Simulated validation”.',
      'Fisca makes no claim of official validation by the DGI or xHub. Until the official technical specifications are published, Fisca’s profiles remain provisional and will be replaced when they appear.',
      'This simulation does not replace any step with the tax administration.',
    ],
  },
  sovereignty: {
    heading: 'Sovereignty and data protection',
    intro: 'What Fisca’s architecture describes, with no promise beyond it.',
    items: [
      { title: 'Primary hosting in the European Union', body: 'Databases and the archive vault at Cloudflare, under EU jurisdiction, with asynchronous replication to a mirror server located in Morocco.' },
      { title: 'Payment and signature in Morocco', body: 'Card payment goes through Payzone and electronic signature through Barid eSign, two providers located in Morocco; Fisca collects no card number or security code.' },
      { title: 'AI: data anonymised before the call', body: 'Personal data is anonymised in memory before any call to an external AI service.' },
      { title: 'No third-party trackers', body: 'This site sets no cookie and loads no third-party pixel or script.' },
      { title: 'Fisca Souverain: everything in Morocco', body: 'For entities subject to Law 05-20, an annual contract places the database, the archive vault and GPU inference on Moroccan territory.' },
    ],
    link: 'Details of processing and sub-processors',
  },
  pricingTeaser: {
    heading: 'A public price grid',
    body: 'Solo, Essentiel and Croissance for businesses, a touch POS, per-file pricing for accounting firms, annual contracts for large accounts.',
    cta: 'See the full price grid',
    fromLabel: 'from',
    perMonthHt: 'per month, excluding tax',
  },
};

const HOME_COPY: Readonly<Record<CopyLocale, HomeCopy>> = { fr: FR, ar: AR, ary: ARY, en: EN };

/**
 * Repli terminologique de Doc_08 S07 : zgh-Latn et zgh-Tfng retombent sur le français
 * tant que la rédaction IRCAM n'est pas livrée et relue.
 */
export function getHomeCopy(locale: MarketingLocale): HomeCopy {
  return HOME_COPY[copyLocaleOf(locale)];
}

export function isFallbackCopy(locale: MarketingLocale): boolean {
  return usesFrenchFallback(locale);
}
