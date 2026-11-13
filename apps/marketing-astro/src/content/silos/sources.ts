/**
 * Sources primaires citées par les guides (Doc_18 S10). Seules figurent les références que les spécifications
 * du dépôt nomment (`specRef`) : aucun article, aucune loi, aucune version n'est ajouté de mémoire.
 */
import type { L4, SourceRef } from './types.ts';

function same(text: string): L4 {
  return { fr: text, en: text, ar: text, ary: text };
}

function cgi(article: string): L4 {
  return {
    fr: `Code général des impôts (CGI), ${article}`,
    en: `General Tax Code (CGI), ${article}`,
    ar: `المدونة العامة للضرائب (CGI)، ${article}`,
    ary: `المدونة العامة للضرائب (CGI)، ${article}`,
  };
}

function law(fr: string, en: string, ar: string): L4 {
  return { fr, en, ar, ary: ar };
}

export const SOURCES: readonly SourceRef[] = [
  { id: 'cgi-11-ii', kind: 'law', label: cgi('art. 11-II'), specRef: 'ERRATA E ; Doc_14 S03' },
  { id: 'cgi-106-ii', kind: 'law', label: cgi('art. 106-II'), specRef: 'ERRATA E ; Doc_14 S03' },
  { id: 'cgi-117', kind: 'law', label: cgi('art. 117'), specRef: 'ERRATA E ; Doc_14 S03 ; Doc_07 S08' },
  { id: 'cgi-145', kind: 'law', label: cgi('art. 145'), specRef: 'Doc_01 S03 et S13' },
  { id: 'cgi-211', kind: 'law', label: cgi('art. 211'), specRef: 'Doc_01 S05 ; Doc_07 S10' },
  { id: 'cgi-20-i', kind: 'law', label: cgi('art. 20-I'), specRef: 'Doc_07 S09' },
  { id: 'cgi-15-115', kind: 'law', label: cgi('art. 15 et 115'), specRef: 'Doc_01 S05' },
  { id: 'cgi-104-113', kind: 'law', label: cgi('art. 104 et 113'), specRef: 'Doc_01 S05' },
  { id: 'cgi-204-bis', kind: 'law', label: cgi('art. 204 bis'), specRef: 'Doc_01 S05' },
  { id: 'cgi-144', kind: 'law', label: cgi('art. 144'), specRef: 'Doc_01 S05' },
  {
    id: 'loi-69-21',
    kind: 'law',
    label: law('Loi 69-21 sur les délais de paiement (Bulletin officiel)', 'Law 69-21 on payment deadlines (Official Bulletin)', 'القانون 69-21 المتعلق بآجال الأداء (الجريدة الرسمية)'),
    specRef: 'ERRATA E ; Doc_14 S03 ; Doc_07 S08',
  },
  {
    id: 'loi-43-20',
    kind: 'law',
    label: law('Loi 43-20 sur les services de confiance (signature électronique)', 'Law 43-20 on trust services (electronic signature)', 'القانون 43-20 المتعلق بخدمات الثقة (التوقيع الإلكتروني)'),
    specRef: 'Doc_01 S03 ; Doc_07 S07',
  },
  {
    id: 'lois-5-96-17-95',
    kind: 'law',
    label: law('Lois 5-96 et 17-95 (identifiants légaux des sociétés)', 'Laws 5-96 and 17-95 (company legal identifiers)', 'القانونان 5-96 و17-95 (المعرفات القانونية للشركات)'),
    specRef: 'Doc_07 S07',
  },
  {
    id: 'lf-2026',
    kind: 'law',
    label: law('Loi de finances 2026 (taux de TVA admis)', 'Finance Act 2026 (admitted VAT rates)', 'قانون المالية 2026 (نسب TVA المقبولة)'),
    specRef: 'ERRATA D-04 ; Doc_14 S03',
  },
  {
    id: 'ae-regime',
    kind: 'law',
    label: law(
      'Régime de l’auto-entrepreneur (seuil par client) : numéro d’article non précisé par les spécifications du dépôt',
      'Auto-entrepreneur regime (per-client threshold): article number not given by the repository specifications',
      'نظام المقاول الذاتي (السقف لكل زبون): رقم المادة غير محدد في مواصفات المستودع',
    ),
    specRef: 'ERRATA E ; Doc_14 S03',
  },
  {
    id: 'loi-15-89',
    kind: 'law',
    label: law('Loi 15-89 (profession d’expert-comptable)', 'Law 15-89 (chartered accountant profession)', 'القانون 15-89 (مهنة الخبير المحاسب)'),
    specRef: 'Doc_01 S10',
  },
  {
    id: 'loi-103-12',
    kind: 'law',
    label: law('Loi bancaire 103-12', 'Banking law 103-12', 'القانون البنكي 103-12'),
    specRef: 'Doc_01 S10',
  },
  { id: 'adc500b', kind: 'xsd', label: same('DGI, modèle ADC500B-23I v1.0 (DeclarationDelaisPaiement)'), specRef: 'Doc_07 S08' },
  { id: 'simpl-tva-v4', kind: 'xsd', label: same('DGI, SIMPL-TVA annexe v4.0 (DeclarationReleveDeduction)'), specRef: 'Doc_07 S08' },
  { id: 'rdrs-v1', kind: 'xsd', label: same('DGI, RAS-TVA annexe RDRS v1.0 (DeclarationReleveRetenueSource)'), specRef: 'Doc_07 S08' },
  { id: 'ras-versement', kind: 'xsd', label: same('DGI, DeclarationVersementRASTVA (flux client payeur)'), specRef: 'Doc_07 S08' },
  { id: 'simpl-is-v203', kind: 'xsd', label: same('DGI, SIMPL-IS v2.0.3 (liasse fiscale)'), specRef: 'Doc_07 S09' },
  { id: 'drvt-v203', kind: 'xsd', label: same('DGI, DRVT v2.0.3 (trois archives XML)'), specRef: 'Doc_07 S09' },
  { id: 'etat-9421', kind: 'xsd', label: same('DGI, SIMPL-IR, état 9421 (TraitementEtSalaire)'), specRef: 'Doc_07 S10' },
  { id: 'fec-ma', kind: 'xsd', label: same('FEC-MA à 24 colonnes (contrôle fiscal informatisé)'), specRef: 'Doc_07 S10' },
  { id: 'saft-cgnc', kind: 'xsd', label: same('SAF-T CGNC v2.0 (AuditFile OCDE v2.00 adapté Maroc)'), specRef: 'Doc_07 S10' },
  { id: 'oasis-ubl21', kind: 'standard', label: same('OASIS UBL 2.1 (docs.oasis-open.org)'), specRef: 'ERRATA B-13 ; Doc_07 S07' },
  { id: 'en-16931', kind: 'standard', label: same('Norme européenne EN 16931'), specRef: 'ERRATA B-13 ; Doc_07 S07' },
  { id: 'xades-t', kind: 'standard', label: same('XAdES-Baseline-T avec jeton RFC 3161'), specRef: 'Doc_07 S07' },
  { id: 'facturx', kind: 'standard', label: same('PDF/A-3b Factur-X'), specRef: 'Doc_07 S07' },
  { id: 'iso-20022', kind: 'standard', label: same('ISO 20022 (pain.001.001.03, camt.053)'), specRef: 'Doc_07 S10' },
  {
    id: 'errata-b13',
    kind: 'internal',
    label: law(
      'ERRATA B-13 : régime provisoire, schémas officiels non publiés',
      'ERRATA B-13: provisional regime, official schemas not published',
      'ERRATA B-13: نظام مؤقت، المخططات الرسمية غير منشورة',
    ),
    specRef: 'ERRATA B-13',
  },
  {
    id: 'errata-e',
    kind: 'internal',
    label: law(
      'ERRATA section E : état de vérification des règles fiscales',
      'ERRATA section E: verification state of the tax rules',
      'ERRATA القسم E: حالة التحقق من القواعد الضريبية',
    ),
    specRef: 'ERRATA E',
  },
  {
    id: 'fisca-pricing',
    kind: 'internal',
    label: law('Grille tarifaire publique de Fisca', 'Fisca public price list', 'لائحة أسعار فيسكا المعلنة'),
    specRef: 'Doc_03 S02 à S06',
  },
  {
    id: 'fisca-pos',
    kind: 'internal',
    label: law('Spécification Fisca POS Tactile et POS Bridge', 'Fisca POS Tactile and POS Bridge specification', 'مواصفات Fisca POS Tactile وPOS Bridge'),
    specRef: 'Doc_01 S13 ; Doc_07 S03',
  },
  {
    id: 'fisca-cabinet',
    kind: 'internal',
    label: law('Spécification du portail cabinet Fisca', 'Fisca firm portal specification', 'مواصفات بوابة المكاتب لفيسكا'),
    specRef: 'Doc_01 S06 ; Doc_03 S04',
  },
  {
    id: 'fisca-mowakaba',
    kind: 'internal',
    label: law('Packs Mowakaba de Fisca (dispositif Maroc PME)', 'Fisca Mowakaba packs (Maroc PME scheme)', 'حزم Mowakaba من فيسكا (برنامج Maroc PME)'),
    specRef: 'Doc_03 S06',
  },
];

const BY_ID: ReadonlyMap<string, SourceRef> = new Map(SOURCES.map((s) => [s.id, s]));

export function getSource(id: string): SourceRef {
  const found = BY_ID.get(id);
  if (found === undefined) throw new RangeError(`Source inconnue : ${id}`);
  return found;
}

export function isPrimarySource(source: SourceRef): boolean {
  return source.kind !== 'internal';
}
