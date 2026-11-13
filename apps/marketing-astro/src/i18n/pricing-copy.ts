import {
  ANNUAL_BILLED_MONTHS,
  ANNUAL_FREE_MONTHS,
  FIDUCIARY_METER,
  LARGE_GROUP_OWNERSHIP_THRESHOLD_BPS,
  MOWAKABA_ELIGIBILITY_MAX_REVENUE_HT_MAD_MILLIONS,
  PACK_MOWAKABA_CABINET,
  TRIAL_DAYS,
} from '../content/pricing.ts';
import { BILLING_POLICY, PRORATA_FAQ_TOKEN, PRORATA_INTRO_TOKEN, prorataClause } from '../content/billing-policy.ts';
import type { BillingPolicy, ProrataClause } from '../content/billing-policy.ts';
import type { PosCondition, PricingFamilyId } from '../content/pricing.ts';
import { formatBpsPercent, formatCentsMad } from '../lib/money.ts';
import { copyLocaleOf } from './copy-locale.ts';
import type { CopyLocale } from './copy-locale.ts';
import type { MarketingLocale } from './locales.ts';

export type OfferCode =
  | 'SOLO_AE'
  | 'ESSENTIEL_TPE'
  | 'CROISSANCE_PME'
  | 'PACK_MOWAKABA_TPME'
  | 'POS_BRIDGE'
  | 'POS_TACTILE_INC'
  | 'POS_TACTILE_STD'
  | 'POS_TACTILE_FLEET'
  | 'CABINET_BASE'
  | 'DOSSIER_SIMPLIFIE'
  | 'DOSSIER_TPE'
  | 'DOSSIER_PME_COMPLET'
  | 'PACK_MOWAKABA_CABINET'
  | 'ENT_CORPORATE'
  | 'ENT_SOUVERAIN';

export interface OfferCopy {
  readonly name: string;
  readonly audience: string;
  readonly inclusions: readonly string[];
}

export interface FaqCopy {
  readonly question: string;
  readonly answer: string;
}

export interface PricingCopy {
  readonly title: string;
  readonly description: string;
  readonly heading: string;
  readonly lead: string;
  readonly taxNote: string;
  readonly trialNote: string;
  readonly annualNote: string;
  readonly billing: { readonly legend: string; readonly monthly: string; readonly annual: string; readonly appliesTo: string };
  readonly labels: {
    readonly perMonth: string;
    readonly perYear: string;
    readonly oneOff: string;
    readonly included: string;
    readonly ctaTrial: string;
    readonly additionalSeat: string;
    readonly yes: string;
    readonly no: string;
    readonly includedIce: string;
    readonly perDossierMonth: string;
    readonly annualFree: string;
  };
  readonly families: Readonly<Record<PricingFamilyId, { readonly heading: string; readonly intro: string }>>;
  readonly offers: Readonly<Record<OfferCode, OfferCopy>>;
  readonly tables: {
    readonly heading: string;
    readonly pme: {
      readonly caption: string;
      readonly criterion: string;
      readonly rows: {
        readonly monthly: string;
        readonly annual: string;
        readonly seats: string;
        readonly pos: string;
        readonly extraSeat: string;
        readonly connectors: string;
        readonly ledger: string;
        readonly btp: string;
      };
      readonly posValues: { readonly none: string; readonly bridge: string; readonly tactile1: string };
    };
    readonly pos: {
      readonly caption: string;
      readonly columns: readonly [string, string, string, string, string];
      readonly conditions: Readonly<Record<PosCondition, string>>;
    };
    readonly oec: {
      readonly caption: string;
      readonly columns: readonly [string, string, string];
      readonly discountedColumn: string;
      readonly notDiscounted: string;
    };
    readonly enterprise: {
      readonly caption: string;
      readonly columns: readonly [string, string, string, string, string];
      readonly hostingStandard: string;
      readonly hostingMorocco: string;
    };
  };
  readonly faqHeading: string;
  readonly faq: readonly FaqCopy[];
  readonly portalsNote: string;
  readonly mowakabaNote: string;
}

const DAYS = String(TRIAL_DAYS);
const BILLED = String(ANNUAL_BILLED_MONTHS);
const FREE = String(ANNUAL_FREE_MONTHS);
const MIN_DOSSIERS = String(FIDUCIARY_METER.volumeDiscount.minActiveDossiers);
const DISCOUNT = formatBpsPercent(FIDUCIARY_METER.volumeDiscount.discount_bps);
const MOWAKABA_MAX = String(MOWAKABA_ELIGIBILITY_MAX_REVENUE_HT_MAD_MILLIONS);
const GROUP_OWNERSHIP = formatBpsPercent(LARGE_GROUP_OWNERSHIP_THRESHOLD_BPS);
const CABINET_WALLET = formatCentsMad(PACK_MOWAKABA_CABINET.prepaidDossierWallet_ht_cents);

const FR: PricingCopy = {
  title: 'Tarifs Fisca — grille transparente, hors taxes',
  description: 'Tarifs publics de Fisca en dirhams hors taxes : PME, caisse POS, cabinets et fiduciaires, contrats grands comptes et Fisca Souverain.',
  heading: 'Tarifs transparents',
  lead: 'Quatre familles d’offres, des montants en dirhams hors taxes et aucune option cachée. Le sélecteur ci-dessous bascule les offres récurrentes entre prix mensuel et prix annuel.',
  taxNote: 'Tous les montants sont hors taxes (HT) ; la taxe applicable s’ajoute à la facturation.',
  trialNote: `Essai Sandbox gratuit de ${DAYS} jours.`,
  annualNote: `Paiement annuel : ${BILLED} mensualités pour 12 mois, soit ${FREE} mois offerts.`,
  billing: { legend: 'Périodicité de facturation', monthly: 'Mensuel', annual: 'Annuel', appliesTo: 'S’applique aux offres PME et POS.' },
  labels: {
    perMonth: 'par mois',
    perYear: 'par an',
    oneOff: 'paiement unique',
    included: 'Inclus',
    ctaTrial: `Démarrer l’essai de ${DAYS} jours`,
    additionalSeat: 'Siège supplémentaire : {price} par mois',
    yes: 'Oui',
    no: 'Non',
    includedIce: 'Jusqu’à {count} ICE inclus',
    perDossierMonth: 'par dossier actif et par mois',
    annualFree: `${FREE} mois offerts`,
  },
  families: {
    PME: { heading: 'PME, TPE et indépendants', intro: 'Trois forfaits directs pour gérer facturation et pré-comptabilité en autonomie, plus le pack Mowakaba pour les TPME éligibles.' },
    POS: { heading: 'Caisse POS', intro: 'Un connecteur pour les caisses existantes, et la caisse tactile native de Fisca.' },
    OEC: { heading: 'Cabinets comptables et fiduciaires', intro: 'Un socle cabinet fixe plus un prix par dossier client actif, {fiduciary_prorata_intro}.' },
    CORPORATE_SOUVERAIN: { heading: 'Grands comptes et Fisca Souverain', intro: `Contrats annuels facturés d’avance, pour les entreprises dont le chiffre d’affaires dépasse ${MOWAKABA_MAX} M MAD HT (hors dispositif Mowakaba) ou détenues à plus de ${GROUP_OWNERSHIP} par un grand groupe.` },
  },
  offers: {
    SOLO_AE: { name: 'Fisca Solo', audience: 'Auto-entrepreneurs', inclusions: ['1 siège utilisateur et 1 accès comptable', 'Base de données dédiée, devis signés par code à usage unique, factures bilingues', 'Suivi du plafond d’auto-entrepreneur et alerte de seuil par client', 'Coffre d’archivage de dix ans'] },
    ESSENTIEL_TPE: { name: 'Fisca Essentiel', audience: 'TPE et professions libérales', inclusions: ['5 sièges utilisateurs', 'Tout Fisca Solo', 'Scan OCR par IA, notes de frais et ordres de mission', 'Lettrage bancaire et export SIMPL-TVA', 'Fisca POS Bridge et connecteurs Sage et Odoo', 'Envoi à la plateforme en pilote simulé et signature électronique (loi 43-20)'] },
    CROISSANCE_PME: { name: 'Fisca Croissance', audience: 'PME, négoce et BTP', inclusions: ['15 sièges utilisateurs', 'Tout Fisca Essentiel', '1 terminal Fisca POS Tactile inclus', 'Grand livre CGNC immuable', 'Décomptes BTP, débours et devises', 'Liasse SIMPL-IS, état 9421, DRVT et FEC'] },
    PACK_MOWAKABA_TPME: { name: 'Pack TPME Mowakaba', audience: 'TPME éligibles au dispositif Mowakaba', inclusions: ['Rapport d’audit IA de maturité numérique', 'Assainissement de la base tiers ICE et IF', 'Paramétrage du plan comptable et de la signature Barid eSign (loi 43-20)', 'Formation attestée des équipes', '12 mois d’abonnement Fisca Croissance prépayés'] },
    POS_BRIDGE: { name: 'Fisca POS Bridge', audience: 'Connecteur de caisses tierces', inclusions: ['Import des clôtures Ticket Z de caisses tierces', 'Inclus dès l’offre Essentiel'] },
    POS_TACTILE_INC: { name: 'Fisca POS Tactile, 1re caisse', audience: 'Première caisse tactile native', inclusions: ['Incluse dans l’offre Croissance'] },
    POS_TACTILE_STD: { name: 'Fisca POS Tactile, caisse additionnelle', audience: 'Caisse tactile additionnelle', inclusions: ['De 1 à 9 caisses actives', 'Un terminal identifié par licence, caissiers illimités', 'Mode hors ligne et archivage des tickets Z'] },
    POS_TACTILE_FLEET: { name: 'Fisca POS Tactile, flotte ou partenaire OEC', audience: 'Tarif flotte ou partenaire OEC', inclusions: ['Dès 10 caisses, ou via un cabinet partenaire', 'Mêmes fonctions que la caisse additionnelle'] },
    CABINET_BASE: { name: 'Socle cabinet marque blanche', audience: 'Cabinets comptables et fiduciaires', inclusions: ['Sous-domaine en marque blanche', 'Collaborateurs comptables illimités', 'Circuit de validation interne à trois niveaux', 'Serveur MCP cabinet et connecteurs Sage 100 et Odoo', 'Socle fixe, non remisé'] },
    DOSSIER_SIMPLIFIE: { name: 'Dossier simplifié', audience: 'AE, SCI ou société sans activité', inclusions: [] },
    DOSSIER_TPE: { name: 'Dossier TPE', audience: 'Tenue CGNC, OCR IA, télétransmission et TVA', inclusions: [] },
    DOSSIER_PME_COMPLET: { name: 'Dossier PME complet', audience: 'Agents IA, IS, état 9421, DRVT et loi 69-21', inclusions: [] },
    PACK_MOWAKABA_CABINET: { name: 'Pack Cabinet Mowakaba', audience: 'Cabinets et fiduciaires éligibles au dispositif Mowakaba', inclusions: ['Audit du cabinet', 'Reprise des balances historiques Sage et JBS', 'Déploiement du portail marque blanche', 'Certification des collaborateurs du cabinet', '12 mois de socle cabinet inclus', `Portefeuille prépayé de ${CABINET_WALLET} HT de consommation de dossiers clients`] },
    ENT_CORPORATE: { name: 'Fisca Corporate', audience: 'ETI, holdings et groupes privés', inclusions: ['Utilisateurs illimités', 'Connecteurs ERP (SAP, Sage X3, Oracle, Odoo)', 'Rapprochement à trois voies multi-bons de livraison', 'SSO SAML/OIDC et matrice de séparation des tâches', 'Contrat annuel facturé d’avance'] },
    ENT_SOUVERAIN: { name: 'Fisca Souverain (loi 05-20)', audience: 'Banques, assurances, opérateurs d’importance vitale et secteur public', inclusions: ['Tout Fisca Corporate', 'Chiffrement de bout en bout avec séquestre de clés 2 sur 3', 'Base de données, coffre d’archivage et inférence GPU au Maroc', 'Contrat annuel facturé d’avance'] },
  },
  tables: {
    heading: 'Comparatifs',
    pme: {
      caption: 'Comparatif des offres PME (montants hors taxes)',
      criterion: 'Critère',
      rows: { monthly: 'Prix mensuel', annual: `Prix annuel (${BILLED} mensualités)`, seats: 'Sièges utilisateurs inclus', pos: 'Caisse POS incluse', extraSeat: 'Siège supplémentaire (par mois)', connectors: 'Connecteurs Sage et Odoo', ledger: 'Grand livre CGNC immuable', btp: 'Décomptes BTP et liasse' },
      posValues: { none: 'Non incluse', bridge: 'POS Bridge', tactile1: '1 terminal tactile' },
    },
    pos: {
      caption: 'Licences POS (montants hors taxes)',
      columns: ['Module', 'Périmètre', 'Mensuel', 'Annuel', 'Condition'],
      conditions: { INCLUDED_FROM_ESSENTIEL: 'Inclus dès Essentiel', INCLUDED_IN_CROISSANCE: 'Incluse dans Croissance', FROM_1_TO_9_ACTIVE_TERMINALS: 'De 1 à 9 caisses actives', FROM_10_TERMINALS_OR_OEC_PARTNER: 'Dès 10 caisses ou via un cabinet partenaire' },
    },
    oec: {
      caption: 'Tarification cabinet : socle et prix par dossier actif (mensuel, hors taxes)',
      columns: ['Composante', 'Prix mensuel', 'Prix mensuel après remise de volume'],
      discountedColumn: `Après remise de ${DISCOUNT} dès ${MIN_DOSSIERS} dossiers actifs`,
      notDiscounted: 'Non remisé',
    },
    enterprise: {
      caption: 'Contrats annuels grands comptes (montants hors taxes)',
      columns: ['Contrat', 'Annuel', 'ICE inclus', 'ICE supplémentaire (annuel)', 'Hébergement'],
      hostingStandard: 'Union européenne, miroir au Maroc',
      hostingMorocco: 'Maroc uniquement',
    },
  },
  faqHeading: 'Questions fréquentes',
  faq: [
    { question: 'Les prix sont-ils hors taxes ?', answer: 'Oui. Tous les montants affichés sont en dirhams hors taxes ; la taxe applicable est ajoutée à la facturation.' },
    { question: 'Comment fonctionne l’essai gratuit ?', answer: `L’essai Sandbox est gratuit et dure ${DAYS} jours.` },
    { question: 'Que signifie « 2 mois offerts » ?', answer: `En paiement annuel, vous réglez ${BILLED} mensualités pour 12 mois d’utilisation.` },
    { question: 'Comment un cabinet est-il facturé ?', answer: `Un socle mensuel fixe, plus un prix mensuel par dossier client actif, {fiduciary_prorata_faq}. Dès ${MIN_DOSSIERS} dossiers actifs, une remise de volume de ${DISCOUNT} s’applique aux lignes de dossiers ; le socle n’est pas remisé.` },
    { question: 'Fisca est-il validé par l’administration fiscale ?', answer: 'Non : Fisca ne revendique aucune validation officielle de la DGI ni de xHub. L’envoi à la plateforme est aujourd’hui un pilote simulé, affiché « Validation simulée ».' },
    { question: 'Où sont hébergées mes données ?', answer: 'Offres standard : hébergement principal dans l’Union européenne avec un miroir au Maroc. Fisca Souverain : tout au Maroc. Le détail est sur la page Confidentialité.' },
    { question: 'Qui peut prendre un pack Mowakaba ?', answer: `Les TPME et cabinets dont le chiffre d’affaires est inférieur ou égal à ${MOWAKABA_MAX} M MAD HT. Une éventuelle prise en charge dépend de l’organisme financeur : Fisca ne la garantit pas.` },
  ],
  portalsNote: 'Les portails Fiduciaire et Corporate sont disponibles en français, arabe et anglais.',
  mowakabaNote: `Éligibilité : chiffre d’affaires inférieur ou égal à ${MOWAKABA_MAX} M MAD HT. La prise en charge dépend de l’organisme financeur.`,
};

const AR: PricingCopy = {
  title: 'أسعار فيسكا — شبكة شفافة دون احتساب الضريبة',
  description: 'الأسعار المعلنة لفيسكا بالدرهم دون احتساب الضريبة: المقاولات الصغيرة والمتوسطة، والصندوق اللمسي، والمكاتب المحاسبية، وعقود الحسابات الكبرى وفيسكا السيادية.',
  heading: 'أسعار شفافة',
  lead: 'أربع فئات من العروض، ومبالغ بالدرهم دون احتساب الضريبة، ولا خيارات خفية. يبدّل المحدد أدناه العروض المتكررة بين السعر الشهري والسعر السنوي.',
  taxNote: 'جميع المبالغ دون احتساب الضريبة؛ وتضاف الضريبة المطبقة عند الفوترة.',
  trialNote: `تجربة مجانية في بيئة Sandbox لمدة ${DAYS} يوما.`,
  annualNote: `الأداء السنوي: ${BILLED} دفعات شهرية مقابل 12 شهرا، أي شهران مجانا.`,
  billing: { legend: 'دورية الفوترة', monthly: 'شهري', annual: 'سنوي', appliesTo: 'ينطبق على عروض المقاولات والصندوق اللمسي.' },
  labels: {
    perMonth: 'في الشهر',
    perYear: 'في السنة',
    oneOff: 'دفعة واحدة',
    included: 'مشمول',
    ctaTrial: `ابدأ تجربة ${DAYS} يوما`,
    additionalSeat: 'مقعد إضافي: {price} في الشهر',
    yes: 'نعم',
    no: 'لا',
    includedIce: 'حتى {count} من ICE مشمولة',
    perDossierMonth: 'لكل ملف نشط في الشهر',
    annualFree: 'شهران مجانا',
  },
  families: {
    PME: { heading: 'المقاولات الصغيرة والمتوسطة والمستقلون', intro: 'ثلاث باقات مباشرة لتدبير الفوترة والمحاسبة الأولية باستقلالية، مع حزمة Mowakaba للمقاولات الصغيرة جدا والمتوسطة المؤهلة.' },
    POS: { heading: 'الصندوق POS', intro: 'موصل للصناديق الحالية، والصندوق اللمسي الأصلي من فيسكا.' },
    OEC: { heading: 'المكاتب المحاسبية والشركات الاستئمانية', intro: 'قاعدة مكتب ثابتة مضافا إليها سعر لكل ملف زبون نشط، {fiduciary_prorata_intro}.' },
    CORPORATE_SOUVERAIN: { heading: 'الحسابات الكبرى وفيسكا السيادية', intro: `عقود سنوية تُفوتر مسبقا للمقاولات التي يتجاوز رقم معاملاتها ${MOWAKABA_MAX} مليون درهم دون احتساب الضريبة (خارج برنامج Mowakaba) أو التي تملك مجموعة كبرى أكثر من ${GROUP_OWNERSHIP} من رأسمالها.` },
  },
  offers: {
    SOLO_AE: { name: 'Fisca Solo', audience: 'المقاولون الذاتيون', inclusions: ['مقعد مستخدم واحد وولوج محاسبي واحد', 'قاعدة بيانات مخصصة، وعروض أسعار موقعة برمز لمرة واحدة، وفواتير ثنائية اللغة', 'تتبع سقف المقاول الذاتي وتنبيه عتبة لكل زبون', 'خزنة أرشفة لمدة عشر سنوات'] },
    ESSENTIEL_TPE: { name: 'Fisca Essentiel', audience: 'المقاولات الصغيرة جدا والمهن الحرة', inclusions: ['5 مقاعد للمستخدمين', 'كل ما في Fisca Solo', 'مسح ضوئي بالذكاء الاصطناعي، ومصاريف وأوامر مهمة', 'مطابقة بنكية وتصدير SIMPL-TVA', 'Fisca POS Bridge وموصلات Sage وOdoo', 'إرسال إلى المنصة في إطار تجريبي محاكى وتوقيع إلكتروني (القانون 43-20)'] },
    CROISSANCE_PME: { name: 'Fisca Croissance', audience: 'المقاولات المتوسطة والتجارة والبناء', inclusions: ['15 مقعدا للمستخدمين', 'كل ما في Fisca Essentiel', 'محطة Fisca POS Tactile واحدة مشمولة', 'دفتر أستاذ عام CGNC غير قابل للتعديل', 'كشوف حسابات البناء والمصاريف المتحملة نيابة والعملات', 'ملف SIMPL-IS والبيان 9421 وDRVT وFEC'] },
    PACK_MOWAKABA_TPME: { name: 'حزمة Mowakaba للمقاولات الصغيرة والمتوسطة', audience: 'المقاولات المؤهلة لبرنامج Mowakaba', inclusions: ['تقرير تدقيق بالذكاء الاصطناعي حول النضج الرقمي', 'تطهير قاعدة الأغيار ICE وIF', 'ضبط المخطط المحاسبي والتوقيع عبر Barid eSign (القانون 43-20)', 'تكوين معتمد للفرق', 'اشتراك Fisca Croissance لمدة 12 شهرا مدفوع مسبقا'] },
    POS_BRIDGE: { name: 'Fisca POS Bridge', audience: 'موصل للصناديق التابعة لجهات أخرى', inclusions: ['استيراد إقفالات Ticket Z من صناديق أخرى', 'مشمول ابتداء من عرض Essentiel'] },
    POS_TACTILE_INC: { name: 'Fisca POS Tactile، الصندوق الأول', audience: 'أول صندوق لمسي أصلي', inclusions: ['مشمول في عرض Croissance'] },
    POS_TACTILE_STD: { name: 'Fisca POS Tactile، صندوق إضافي', audience: 'صندوق لمسي إضافي', inclusions: ['من 1 إلى 9 صناديق نشطة', 'محطة محددة الهوية لكل رخصة، وعدد غير محدود من الصناديق', 'وضع الاشتغال دون اتصال وأرشفة Ticket Z'] },
    POS_TACTILE_FLEET: { name: 'Fisca POS Tactile، أسطول أو شريك OEC', audience: 'تسعيرة الأسطول أو شريك OEC', inclusions: ['ابتداء من 10 صناديق، أو عبر مكتب شريك', 'نفس وظائف الصندوق الإضافي'] },
    CABINET_BASE: { name: 'قاعدة المكتب بالعلامة البيضاء', audience: 'المكاتب المحاسبية والشركات الاستئمانية', inclusions: ['نطاق فرعي بالعلامة البيضاء', 'عدد غير محدود من المحاسبين المتعاونين', 'مسار مصادقة داخلي من ثلاثة مستويات', 'خادم MCP للمكتب وموصلات Sage 100 وOdoo', 'قاعدة ثابتة غير قابلة للتخفيض'] },
    DOSSIER_SIMPLIFIE: { name: 'ملف مبسط', audience: 'مقاول ذاتي أو شركة مدنية عقارية أو شركة بلا نشاط', inclusions: [] },
    DOSSIER_TPE: { name: 'ملف مقاولة صغيرة جدا', audience: 'مسك CGNC، وOCR بالذكاء الاصطناعي، والإرسال الإلكتروني، والضريبة على القيمة المضافة', inclusions: [] },
    DOSSIER_PME_COMPLET: { name: 'ملف مقاولة متوسطة كامل', audience: 'وكلاء الذكاء الاصطناعي، والضريبة على الشركات، والبيان 9421، وDRVT، والقانون 69-21', inclusions: [] },
    PACK_MOWAKABA_CABINET: { name: 'حزمة المكتب Mowakaba', audience: 'المكاتب المؤهلة لبرنامج Mowakaba', inclusions: ['تدقيق المكتب', 'استرجاع الموازين التاريخية من Sage وJBS', 'نشر البوابة بالعلامة البيضاء', 'تأهيل متعاوني المكتب', 'اثنا عشر شهرا من قاعدة المكتب مشمولة', `محفظة مدفوعة مسبقا بقيمة ${CABINET_WALLET} دون احتساب الضريبة لاستهلاك ملفات الزبناء`] },
    ENT_CORPORATE: { name: 'Fisca Corporate', audience: 'المقاولات المتوسطة الكبرى والمجموعات الخاصة', inclusions: ['مستخدمون غير محدودين', 'موصلات ERP (SAP وSage X3 وOracle وOdoo)', 'مطابقة ثلاثية متعددة لسندات التسليم', 'SSO بمعيار SAML/OIDC ومصفوفة فصل المهام', 'عقد سنوي يُفوتر مسبقا'] },
    ENT_SOUVERAIN: { name: 'Fisca Souverain (القانون 05-20)', audience: 'الأبناك وشركات التأمين والمشغلون ذوو الأهمية الحيوية والقطاع العام', inclusions: ['كل ما في Fisca Corporate', 'تشفير من طرف إلى طرف مع حفظ المفاتيح بنظام 2 من 3', 'قاعدة البيانات وخزنة الأرشيف والاستدلال بمعالجات GPU داخل المغرب', 'عقد سنوي يُفوتر مسبقا'] },
  },
  tables: {
    heading: 'جداول المقارنة',
    pme: {
      caption: 'مقارنة عروض المقاولات (المبالغ دون احتساب الضريبة)',
      criterion: 'المعيار',
      rows: { monthly: 'السعر الشهري', annual: `السعر السنوي (${BILLED} دفعات شهرية)`, seats: 'مقاعد المستخدمين المشمولة', pos: 'صندوق POS مشمول', extraSeat: 'مقعد إضافي (في الشهر)', connectors: 'موصلات Sage وOdoo', ledger: 'دفتر أستاذ CGNC غير قابل للتعديل', btp: 'كشوف البناء والملف الضريبي' },
      posValues: { none: 'غير مشمول', bridge: 'POS Bridge', tactile1: 'محطة لمسية واحدة' },
    },
    pos: {
      caption: 'رخص POS (المبالغ دون احتساب الضريبة)',
      columns: ['الوحدة', 'النطاق', 'شهري', 'سنوي', 'الشرط'],
      conditions: { INCLUDED_FROM_ESSENTIEL: 'مشمول ابتداء من Essentiel', INCLUDED_IN_CROISSANCE: 'مشمول في Croissance', FROM_1_TO_9_ACTIVE_TERMINALS: 'من 1 إلى 9 صناديق نشطة', FROM_10_TERMINALS_OR_OEC_PARTNER: 'ابتداء من 10 صناديق أو عبر مكتب شريك' },
    },
    oec: {
      caption: 'تسعير المكتب: القاعدة وسعر كل ملف نشط (شهري، دون احتساب الضريبة)',
      columns: ['المكون', 'السعر الشهري', 'السعر الشهري بعد تخفيض الحجم'],
      discountedColumn: `بعد تخفيض ${DISCOUNT} ابتداء من ${MIN_DOSSIERS} ملف نشط`,
      notDiscounted: 'غير مخفض',
    },
    enterprise: {
      caption: 'العقود السنوية للحسابات الكبرى (المبالغ دون احتساب الضريبة)',
      columns: ['العقد', 'سنوي', 'ICE المشمولة', 'ICE إضافية (سنويا)', 'الاستضافة'],
      hostingStandard: 'الاتحاد الأوروبي مع مرآة بالمغرب',
      hostingMorocco: 'المغرب فقط',
    },
  },
  faqHeading: 'أسئلة شائعة',
  faq: [
    { question: 'هل الأسعار دون احتساب الضريبة؟', answer: 'نعم. جميع المبالغ المعروضة بالدرهم دون احتساب الضريبة، وتضاف الضريبة المطبقة عند الفوترة.' },
    { question: 'كيف تعمل التجربة المجانية؟', answer: `التجربة في بيئة Sandbox مجانية ومدتها ${DAYS} يوما.` },
    { question: 'ماذا يعني «شهران مجانا»؟', answer: `عند الأداء السنوي، تدفع ${BILLED} دفعات شهرية مقابل 12 شهرا من الاستعمال.` },
    { question: 'كيف يُفوتر المكتب المحاسبي؟', answer: `قاعدة شهرية ثابتة، مضافا إليها سعر شهري لكل ملف زبون نشط، {fiduciary_prorata_faq}. ابتداء من ${MIN_DOSSIERS} ملف نشط يُطبق تخفيض على الحجم قدره ${DISCOUNT} على أسطر الملفات؛ أما القاعدة فلا تُخفض.` },
    { question: 'هل صادقت الإدارة الضريبية على فيسكا؟', answer: 'لا: لا تدّعي فيسكا أي مصادقة رسمية من المديرية العامة للضرائب أو من xHub. الإرسال إلى المنصة هو حاليا تجربة محاكاة، وتظهر حالته «تحقق محاكى».' },
    { question: 'أين تُستضاف معطياتي؟', answer: 'العروض العادية: استضافة رئيسية في الاتحاد الأوروبي مع مرآة بالمغرب. فيسكا السيادية: كل شيء داخل المغرب. التفاصيل في صفحة الخصوصية.' },
    { question: 'من يمكنه اقتناء حزمة Mowakaba؟', answer: `المقاولات والمكاتب التي لا يتجاوز رقم معاملاتها ${MOWAKABA_MAX} مليون درهم دون احتساب الضريبة. وأي تحمل محتمل يعود إلى الجهة الممولة، ولا تضمنه فيسكا.` },
  ],
  portalsNote: 'بوابتا المكاتب المحاسبية والحسابات الكبرى متاحتان بالفرنسية والعربية والإنجليزية.',
  mowakabaNote: `الأهلية: رقم معاملات لا يتجاوز ${MOWAKABA_MAX} مليون درهم دون احتساب الضريبة. ويعود التحمل إلى الجهة الممولة.`,
};

const ARY: PricingCopy = {
  title: 'أثمنة فيسكا — شبكة واضحة وبلا TVA',
  description: 'الأثمنة المعلنة ديال فيسكا بالدرهم وبلا TVA: الشركات الصغيرة والمتوسطة، الكايس POS، المكاتب والفيدوسيير، عقود الحسابات الكبرى وفيسكا السيادية.',
  heading: 'أثمنة واضحة',
  lead: 'أربع عائلات ديال العروض، مبالغ بالدرهم وبلا TVA، وما كاين حتى خيار مخبّي. السيليكتور لتحت كيبدّل العروض المتكررة بين الثمن الشهري والثمن السنوي.',
  taxNote: 'كاع المبالغ بلا TVA؛ والضريبة المطبّقة كتزاد فالفاتورة.',
  trialNote: `تجربة Sandbox بلا فلوس ${DAYS} يوم.`,
  annualNote: `الخلاص السنوي: ${BILLED} شهور كتخلص على 12 شهر، يعني شهرين بلاش.`,
  billing: { legend: 'كل قداش كتخلص', monthly: 'شهري', annual: 'سنوي', appliesTo: 'كيخدم مع عروض الشركات والكايس اللمسي.' },
  labels: {
    perMonth: 'فالشهر',
    perYear: 'فالعام',
    oneOff: 'خلصة وحدة',
    included: 'داخل',
    ctaTrial: `بدا التجربة ديال ${DAYS} يوم`,
    additionalSeat: 'بلاصة زايدة: {price} فالشهر',
    yes: 'إيه',
    no: 'لا',
    includedIce: 'حتى {count} ديال ICE داخلين',
    perDossierMonth: 'على كل دوسي نشيط فالشهر',
    annualFree: 'شهرين بلاش',
  },
  families: {
    PME: { heading: 'الشركات الصغيرة والمتوسطة والمستقلين', intro: 'تلات باقات مباشرة باش تسيّر الفاتورة والمحاسبة الأولية بوحدك، وحزمة Mowakaba للشركات المؤهلة.' },
    POS: { heading: 'الكايس POS', intro: 'موصل للكيسات اللي عندك، والكايس اللمسي ديال فيسكا.' },
    OEC: { heading: 'مكاتب المحاسبة والفيدوسيير', intro: 'قاعدة ثابتة ديال المكتب وزايد ثمن على كل دوسي ديال كليان نشيط، {fiduciary_prorata_intro}.' },
    CORPORATE_SOUVERAIN: { heading: 'الحسابات الكبرى وفيسكا السيادية', intro: `عقود سنوية كتخلص بالسبيقة، للشركات اللي رقم المعاملات ديالها كتر من ${MOWAKABA_MAX} مليون درهم بلا TVA (برا Mowakaba) ولا اللي مجموعة كبيرة عندها فوق ${GROUP_OWNERSHIP}.` },
  },
  offers: {
    SOLO_AE: { name: 'Fisca Solo', audience: 'المقاولين الذاتيين', inclusions: ['بلاصة وحدة للمستعمل وولوج وحد للمحاسب', 'قاعدة بيانات خاصة بيك، عروض أثمنة موقّعة بكود ديال مرة وحدة، وفواتير بجوج لغات', 'تتبع السقف ديال المقاول الذاتي وتنبيه العتبة على كل كليان', 'خزنة أرشيف لعشر سنين'] },
    ESSENTIEL_TPE: { name: 'Fisca Essentiel', audience: 'الشركات الصغيرة جدا والمهن الحرة', inclusions: ['5 بلايص للمستعملين', 'كلشي اللي فـ Fisca Solo', 'سكان OCR بالذكاء الاصطناعي، مصاريف وأوامر مهمة', 'المطابقة البنكية وتصدير SIMPL-TVA', 'Fisca POS Bridge وموصلات Sage وOdoo', 'السيفاط للمنصة بالمحاكاة وتوقيع إلكتروني (القانون 43-20)'] },
    CROISSANCE_PME: { name: 'Fisca Croissance', audience: 'الشركات المتوسطة والتجارة والبناء', inclusions: ['15 بلاصة للمستعملين', 'كلشي اللي فـ Fisca Essentiel', 'كايس Fisca POS Tactile وحدة داخلة', 'دفتر الأستاذ CGNC اللي ما كيتبدلش', 'حسابات البناء والمصاريف والعملات', 'ملف SIMPL-IS والبيان 9421 وDRVT وFEC'] },
    PACK_MOWAKABA_TPME: { name: 'حزمة Mowakaba للشركات الصغيرة والمتوسطة', audience: 'الشركات المؤهلة لبرنامج Mowakaba', inclusions: ['تقرير تدقيق بالذكاء الاصطناعي على النضج الرقمي', 'تنقية قاعدة الأغيار ICE وIF', 'ضبط المخطط المحاسبي والتوقيع بـ Barid eSign (القانون 43-20)', 'تكوين معتمد للفرق', 'اشتراك Fisca Croissance ديال 12 شهر مخلّص بالسبيقة'] },
    POS_BRIDGE: { name: 'Fisca POS Bridge', audience: 'موصل للكيسات ديال شركات أخرى', inclusions: ['استيراد إقفالات Ticket Z من كيسات أخرى', 'داخل من عرض Essentiel'] },
    POS_TACTILE_INC: { name: 'Fisca POS Tactile، الكايس الأول', audience: 'أول كايس لمسي من فيسكا', inclusions: ['داخل فعرض Croissance'] },
    POS_TACTILE_STD: { name: 'Fisca POS Tactile، كايس زايد', audience: 'كايس لمسي زايد', inclusions: ['من 1 حتى 9 كيسات نشيطين', 'جهاز معرّف وحد فكل رخصة، وكاشيرية بلا حدود', 'كيخدم بلا إنترنت وأرشفة ديال Ticket Z'] },
    POS_TACTILE_FLEET: { name: 'Fisca POS Tactile، أسطول ولا شريك OEC', audience: 'ثمن الأسطول ولا شريك OEC', inclusions: ['من 10 كيسات، ولا عبر مكتب شريك', 'نفس الوظائف ديال الكايس الزايد'] },
    CABINET_BASE: { name: 'قاعدة المكتب بالعلامة البيضاء', audience: 'مكاتب المحاسبة والفيدوسيير', inclusions: ['دومين فرعي بالعلامة البيضاء', 'محاسبين متعاونين بلا حدود', 'مسار مصادقة داخلي فتلات مستويات', 'سيرفر MCP للمكتب وموصلات Sage 100 وOdoo', 'قاعدة ثابتة وما كتنقصش'] },
    DOSSIER_SIMPLIFIE: { name: 'دوسي مبسّط', audience: 'مقاول ذاتي، SCI ولا شركة بلا نشاط', inclusions: [] },
    DOSSIER_TPE: { name: 'دوسي شركة صغيرة جدا', audience: 'مسك CGNC، OCR بالذكاء الاصطناعي، الإرسال الإلكتروني وTVA', inclusions: [] },
    DOSSIER_PME_COMPLET: { name: 'دوسي شركة متوسطة كامل', audience: 'وكلاء الذكاء الاصطناعي، IS، البيان 9421، DRVT والقانون 69-21', inclusions: [] },
    PACK_MOWAKABA_CABINET: { name: 'حزمة المكتب Mowakaba', audience: 'المكاتب المؤهلة لبرنامج Mowakaba', inclusions: ['تدقيق المكتب', 'استرجاع الموازين القديمة من Sage وJBS', 'تركيب البوابة بالعلامة البيضاء', 'تأهيل المتعاونين ديال المكتب', '12 شهر ديال قاعدة المكتب داخلين', `محفظة مخلّصة بالسبيقة ب ${CABINET_WALLET} بلا TVA لاستهلاك دوسيات الكليان`] },
    ENT_CORPORATE: { name: 'Fisca Corporate', audience: 'الشركات الكبرى والهولدينغات والمجموعات الخاصة', inclusions: ['مستعملين بلا حدود', 'موصلات ERP (SAP وSage X3 وOracle وOdoo)', 'مطابقة ثلاثية لعدة سندات تسليم', 'SSO بـ SAML/OIDC ومصفوفة فصل المهام', 'عقد سنوي كيتخلص بالسبيقة'] },
    ENT_SOUVERAIN: { name: 'Fisca Souverain (القانون 05-20)', audience: 'الأبناك والتأمينات والجهات الحيوية والقطاع العام', inclusions: ['كلشي اللي فـ Fisca Corporate', 'تشفير من طرف لطرف مع تخبية المفاتيح 2 من 3', 'قاعدة البيانات وخزنة الأرشيف والـGPU فالمغرب', 'عقد سنوي كيتخلص بالسبيقة'] },
  },
  tables: {
    heading: 'جداول المقارنة',
    pme: {
      caption: 'مقارنة عروض الشركات (المبالغ بلا TVA)',
      criterion: 'المعيار',
      rows: { monthly: 'الثمن الشهري', annual: `الثمن السنوي (${BILLED} شهور)`, seats: 'بلايص المستعملين الداخلين', pos: 'كايس POS داخل', extraSeat: 'بلاصة زايدة (فالشهر)', connectors: 'موصلات Sage وOdoo', ledger: 'دفتر الأستاذ CGNC اللي ما كيتبدلش', btp: 'حسابات البناء والملف الضريبي' },
      posValues: { none: 'ماشي داخل', bridge: 'POS Bridge', tactile1: 'جهاز لمسي وحد' },
    },
    pos: {
      caption: 'رخص POS (المبالغ بلا TVA)',
      columns: ['الوحدة', 'النطاق', 'شهري', 'سنوي', 'الشرط'],
      conditions: { INCLUDED_FROM_ESSENTIEL: 'داخل من Essentiel', INCLUDED_IN_CROISSANCE: 'داخل فـ Croissance', FROM_1_TO_9_ACTIVE_TERMINALS: 'من 1 حتى 9 كيسات نشيطين', FROM_10_TERMINALS_OR_OEC_PARTNER: 'من 10 كيسات ولا عبر مكتب شريك' },
    },
    oec: {
      caption: 'تسعير المكتب: القاعدة وثمن كل دوسي نشيط (شهري، بلا TVA)',
      columns: ['العنصر', 'الثمن الشهري', 'الثمن الشهري من بعد تخفيض الحجم'],
      discountedColumn: `من بعد تخفيض ${DISCOUNT} من ${MIN_DOSSIERS} دوسي نشيط`,
      notDiscounted: 'ما فيهاش تخفيض',
    },
    enterprise: {
      caption: 'العقود السنوية للحسابات الكبرى (المبالغ بلا TVA)',
      columns: ['العقد', 'سنوي', 'ICE داخلين', 'ICE زايدين (سنوي)', 'الاستضافة'],
      hostingStandard: 'الاتحاد الأوروبي ومرآة فالمغرب',
      hostingMorocco: 'فالمغرب غير',
    },
  },
  faqHeading: 'أسئلة كثيرة كتتعاود',
  faq: [
    { question: 'واش الأثمنة بلا TVA؟', answer: 'إيه. كاع المبالغ بالدرهم وبلا TVA، والضريبة المطبّقة كتزاد فالفاتورة.' },
    { question: 'كيفاش كتخدم التجربة بلا فلوس؟', answer: `تجربة Sandbox بلاش ومدتها ${DAYS} يوم.` },
    { question: 'شنو يعني «شهرين بلاش»؟', answer: `فالخلاص السنوي، كتخلص ${BILLED} شهور على 12 شهر ديال الاستعمال.` },
    { question: 'كيفاش كيتحسب المكتب؟', answer: `قاعدة شهرية ثابتة، وزايد ثمن شهري على كل دوسي ديال كليان نشيط، {fiduciary_prorata_faq}. من ${MIN_DOSSIERS} دوسي نشيط كيتطبق تخفيض ${DISCOUNT} على سطور الدوسيات؛ والقاعدة ما كتنقصش.` },
    { question: 'واش الإدارة الضريبية صادقات على فيسكا؟', answer: 'لا: فيسكا ما كتدّعي حتى مصادقة رسمية من DGI ولا من xHub. السيفاط للمنصة دابا غير تجربة بالمحاكاة، والحالة كتبان «تحقق بالمحاكاة».' },
    { question: 'فين كاينين المعطيات ديالي؟', answer: 'العروض العادية: الاستضافة الأساسية فالاتحاد الأوروبي ومرآة فالمغرب. فيسكا السيادية: كلشي فالمغرب. التفاصيل فصفحة الخصوصية.' },
    { question: 'شكون يقدر ياخذ حزمة Mowakaba؟', answer: `الشركات والمكاتب اللي رقم المعاملات ديالها ما كيفوتش ${MOWAKABA_MAX} مليون درهم بلا TVA. التكفل، إيلا كان، كيرجع للجهة الممولة وفيسكا ما كتضمنوش.` },
  ],
  portalsNote: 'بوابتا المكاتب والحسابات الكبرى كاينين بالفرنسية والعربية والإنجليزية.',
  mowakabaNote: `الأهلية: رقم معاملات ما كيفوتش ${MOWAKABA_MAX} مليون درهم بلا TVA. التكفل كيرجع للجهة الممولة.`,
};

const EN: PricingCopy = {
  title: 'Fisca pricing — transparent grid, excluding tax',
  description: 'Fisca public prices in dirhams excluding tax: SMEs, POS, accounting firms and fiduciaries, large-account contracts and Fisca Souverain.',
  heading: 'Transparent pricing',
  lead: 'Four offer families, amounts in dirhams excluding tax and no hidden options. The selector below switches recurring offers between monthly and annual prices.',
  taxNote: 'All amounts exclude tax; the applicable tax is added at invoicing.',
  trialNote: `Free ${DAYS}-day Sandbox trial.`,
  annualNote: `Annual payment: ${BILLED} monthly payments for 12 months, which is ${FREE} months free.`,
  billing: { legend: 'Billing period', monthly: 'Monthly', annual: 'Annual', appliesTo: 'Applies to SME and POS offers.' },
  labels: {
    perMonth: 'per month',
    perYear: 'per year',
    oneOff: 'one-off payment',
    included: 'Included',
    ctaTrial: `Start the ${DAYS}-day trial`,
    additionalSeat: 'Additional seat: {price} per month',
    yes: 'Yes',
    no: 'No',
    includedIce: 'Up to {count} ICE included',
    perDossierMonth: 'per active file per month',
    annualFree: `${FREE} months free`,
  },
  families: {
    PME: { heading: 'SMEs, small businesses and freelancers', intro: 'Three direct plans to run invoicing and pre-accounting on your own, plus the Mowakaba pack for eligible small businesses.' },
    POS: { heading: 'POS', intro: 'A connector for the tills you already use, and Fisca’s native touch POS.' },
    OEC: { heading: 'Accounting firms and fiduciaries', intro: 'A fixed firm base plus a price per active client file, {fiduciary_prorata_intro}.' },
    CORPORATE_SOUVERAIN: { heading: 'Large accounts and Fisca Souverain', intro: `Annual contracts invoiced in advance, for companies with revenue above MAD ${MOWAKABA_MAX} million excluding tax (outside the Mowakaba scheme) or more than ${GROUP_OWNERSHIP} owned by a large group.` },
  },
  offers: {
    SOLO_AE: { name: 'Fisca Solo', audience: 'Self-employed entrepreneurs (auto-entrepreneurs)', inclusions: ['1 user seat and 1 accountant access', 'Dedicated database, quotes signed with a one-time code, bilingual invoices', 'Self-employed ceiling tracking and a per-client threshold alert', 'Ten-year archive vault'] },
    ESSENTIEL_TPE: { name: 'Fisca Essentiel', audience: 'Small businesses and liberal professions', inclusions: ['5 user seats', 'Everything in Fisca Solo', 'AI OCR scanning, expense reports and mission orders', 'Bank reconciliation and SIMPL-TVA export', 'Fisca POS Bridge and Sage and Odoo connectors', 'Sending to the platform as a simulated pilot, and electronic signature (Law 43-20)'] },
    CROISSANCE_PME: { name: 'Fisca Croissance', audience: 'SMEs, trading and construction', inclusions: ['15 user seats', 'Everything in Fisca Essentiel', '1 Fisca POS Tactile terminal included', 'Immutable CGNC general ledger', 'Construction statements, disbursements and currencies', 'SIMPL-IS return, form 9421, DRVT and FEC'] },
    PACK_MOWAKABA_TPME: { name: 'Mowakaba SME pack', audience: 'Small and medium businesses eligible for the Mowakaba scheme', inclusions: ['AI digital-maturity audit report', 'Clean-up of the ICE and IF third-party database', 'Chart of accounts and Barid eSign setup (Law 43-20)', 'Attested staff training', '12 months of Fisca Croissance prepaid'] },
    POS_BRIDGE: { name: 'Fisca POS Bridge', audience: 'Third-party till connector', inclusions: ['Import of Z-ticket closings from third-party tills', 'Included from the Essentiel plan'] },
    POS_TACTILE_INC: { name: 'Fisca POS Tactile, 1st terminal', audience: 'First native touch terminal', inclusions: ['Included in the Croissance plan'] },
    POS_TACTILE_STD: { name: 'Fisca POS Tactile, additional terminal', audience: 'Additional touch terminal', inclusions: ['From 1 to 9 active terminals', 'One identified device per licence, unlimited cashiers', 'Offline mode and Z-ticket archiving'] },
    POS_TACTILE_FLEET: { name: 'Fisca POS Tactile, fleet or OEC partner', audience: 'Fleet or OEC partner rate', inclusions: ['From 10 terminals, or through a partner firm', 'Same features as the additional terminal'] },
    CABINET_BASE: { name: 'White-label firm base', audience: 'Accounting firms and fiduciaries', inclusions: ['White-label subdomain', 'Unlimited accounting staff', 'Three-level internal approval workflow', 'Firm MCP server and Sage 100 and Odoo connectors', 'Fixed base, not discounted'] },
    DOSSIER_SIMPLIFIE: { name: 'Simplified file', audience: 'Self-employed, property holding company (SCI) or dormant company', inclusions: [] },
    DOSSIER_TPE: { name: 'Small-business file', audience: 'CGNC bookkeeping, AI OCR, e-filing and VAT', inclusions: [] },
    DOSSIER_PME_COMPLET: { name: 'Full SME file', audience: 'AI agents, corporate tax, form 9421, DRVT and Law 69-21', inclusions: [] },
    PACK_MOWAKABA_CABINET: { name: 'Mowakaba firm pack', audience: 'Firms and fiduciaries eligible for the Mowakaba scheme', inclusions: ['Firm audit', 'Import of historical Sage and JBS balances', 'Deployment of the white-label portal', 'Certification of the firm’s staff', '12 months of firm base included', `Prepaid wallet of ${CABINET_WALLET} excluding tax for client-file consumption`] },
    ENT_CORPORATE: { name: 'Fisca Corporate', audience: 'Mid-caps, holdings and private groups', inclusions: ['Unlimited users', 'ERP connectors (SAP, Sage X3, Oracle, Odoo)', 'Three-way matching across multiple delivery notes', 'SAML/OIDC SSO and segregation-of-duties matrix', 'Annual contract invoiced in advance'] },
    ENT_SOUVERAIN: { name: 'Fisca Souverain (Law 05-20)', audience: 'Banks, insurers, critical-infrastructure operators and the public sector', inclusions: ['Everything in Fisca Corporate', 'End-to-end encryption with 2-of-3 key escrow', 'Database, archive vault and GPU inference in Morocco', 'Annual contract invoiced in advance'] },
  },
  tables: {
    heading: 'Comparisons',
    pme: {
      caption: 'SME plan comparison (amounts excluding tax)',
      criterion: 'Criterion',
      rows: { monthly: 'Monthly price', annual: `Annual price (${BILLED} monthly payments)`, seats: 'User seats included', pos: 'POS included', extraSeat: 'Additional seat (per month)', connectors: 'Sage and Odoo connectors', ledger: 'Immutable CGNC general ledger', btp: 'Construction statements and tax return' },
      posValues: { none: 'Not included', bridge: 'POS Bridge', tactile1: '1 touch terminal' },
    },
    pos: {
      caption: 'POS licences (amounts excluding tax)',
      columns: ['Module', 'Scope', 'Monthly', 'Annual', 'Condition'],
      conditions: { INCLUDED_FROM_ESSENTIEL: 'Included from Essentiel', INCLUDED_IN_CROISSANCE: 'Included in Croissance', FROM_1_TO_9_ACTIVE_TERMINALS: 'From 1 to 9 active terminals', FROM_10_TERMINALS_OR_OEC_PARTNER: 'From 10 terminals or through a partner firm' },
    },
    oec: {
      caption: 'Firm pricing: base and price per active file (monthly, excluding tax)',
      columns: ['Component', 'Monthly price', 'Monthly price after volume discount'],
      discountedColumn: `After ${DISCOUNT} discount from ${MIN_DOSSIERS} active files`,
      notDiscounted: 'Not discounted',
    },
    enterprise: {
      caption: 'Large-account annual contracts (amounts excluding tax)',
      columns: ['Contract', 'Annual', 'ICE included', 'Additional ICE (annual)', 'Hosting'],
      hostingStandard: 'European Union, mirror in Morocco',
      hostingMorocco: 'Morocco only',
    },
  },
  faqHeading: 'Frequently asked questions',
  faq: [
    { question: 'Are prices excluding tax?', answer: 'Yes. All amounts shown are in dirhams excluding tax; the applicable tax is added at invoicing.' },
    { question: 'How does the free trial work?', answer: `The Sandbox trial is free and lasts ${DAYS} days.` },
    { question: 'What does “2 months free” mean?', answer: `With annual payment, you pay ${BILLED} monthly payments for 12 months of use.` },
    { question: 'How is an accounting firm billed?', answer: `A fixed monthly base plus a monthly price per active client file, {fiduciary_prorata_faq}. From ${MIN_DOSSIERS} active files, a ${DISCOUNT} volume discount applies to the file lines; the base is not discounted.` },
    { question: 'Is Fisca validated by the tax administration?', answer: 'No: Fisca makes no claim of official validation by the DGI or xHub. Sending to the platform is a simulated pilot today, shown as “Simulated validation”.' },
    { question: 'Where is my data hosted?', answer: 'Standard plans: primary hosting in the European Union with a mirror in Morocco. Fisca Souverain: everything in Morocco. Details are on the Privacy page.' },
    { question: 'Who can take a Mowakaba pack?', answer: `SMEs and firms with revenue at or below MAD ${MOWAKABA_MAX} million excluding tax. Any funding depends on the funding body: Fisca does not guarantee it.` },
  ],
  portalsNote: 'The Fiduciary and Corporate portals are available in French, Arabic and English.',
  mowakabaNote: `Eligibility: revenue at or below MAD ${MOWAKABA_MAX} million excluding tax. Funding depends on the funding body.`,
};

const PRICING_COPY: Readonly<Record<CopyLocale, PricingCopy>> = { fr: FR, ar: AR, ary: ARY, en: EN };

function applyProrata<T>(value: T, clause: ProrataClause): T {
  if (typeof value === 'string') {
    return value.replaceAll(PRORATA_INTRO_TOKEN, clause.intro).replaceAll(PRORATA_FAQ_TOKEN, clause.faq) as T;
  }
  if (Array.isArray(value)) return value.map((item: unknown) => applyProrata(item, clause)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, applyProrata(v, clause)])) as T;
  }
  return value;
}

/** Le choix de prorata fiduciaire vient de `billing-policy.ts` (source unique, injectable pour les tests). */
export function getPricingCopy(locale: MarketingLocale, policy: BillingPolicy = BILLING_POLICY): PricingCopy {
  const copyLocale = copyLocaleOf(locale);
  return applyProrata(PRICING_COPY[copyLocale], prorataClause(copyLocale, policy));
}
