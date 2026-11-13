/**
 * Silo 5 « Régions & Mowakaba » : 12 routes canoniques, une par région (Doc_18 S05).
 * Les noms des régions et de leurs chefs-lieux sont des faits géographiques publics, hors spécifications du dépôt.
 * Les adresses du CRI et de la DGI ne sont publiées dans aucune spécification : les pages disent « non publié à ce jour ».
 */
import type { Fact, L4, SiloPageSpec } from './types.ts';

function t(fr: string, en: string, ar: string, ary: string = ar): L4 {
  return { fr, en, ar, ary };
}

export const REGIONS_SLUG = 'regions-mowakaba';

interface RegionData {
  readonly slug: string;
  readonly name: L4;
  readonly seat: L4;
}

export const REGIONS: readonly RegionData[] = [
  { slug: 'tanger-tetouan-al-hoceima', name: t('Tanger-Tétouan-Al Hoceïma', 'Tanger-Tétouan-Al Hoceïma', 'طنجة تطوان الحسيمة'), seat: t('Tanger', 'Tangier', 'طنجة') },
  { slug: 'oriental', name: t('l’Oriental', 'the Oriental region', 'جهة الشرق'), seat: t('Oujda', 'Oujda', 'وجدة') },
  { slug: 'fes-meknes', name: t('Fès-Meknès', 'Fès-Meknès', 'فاس مكناس'), seat: t('Fès', 'Fès', 'فاس') },
  { slug: 'rabat-sale-kenitra', name: t('Rabat-Salé-Kénitra', 'Rabat-Salé-Kénitra', 'الرباط سلا القنيطرة'), seat: t('Rabat', 'Rabat', 'الرباط') },
  { slug: 'beni-mellal-khenifra', name: t('Béni Mellal-Khénifra', 'Béni Mellal-Khénifra', 'بني ملال خنيفرة'), seat: t('Béni Mellal', 'Béni Mellal', 'بني ملال') },
  { slug: 'casablanca-settat', name: t('Casablanca-Settat', 'Casablanca-Settat', 'الدار البيضاء سطات'), seat: t('Casablanca', 'Casablanca', 'الدار البيضاء') },
  { slug: 'marrakech-safi', name: t('Marrakech-Safi', 'Marrakech-Safi', 'مراكش آسفي'), seat: t('Marrakech', 'Marrakesh', 'مراكش') },
  { slug: 'draa-tafilalet', name: t('Drâa-Tafilalet', 'Drâa-Tafilalet', 'درعة تافيلالت'), seat: t('Errachidia', 'Errachidia', 'الرشيدية') },
  { slug: 'souss-massa', name: t('Souss-Massa', 'Souss-Massa', 'سوس ماسة'), seat: t('Agadir', 'Agadir', 'أكادير') },
  { slug: 'guelmim-oued-noun', name: t('Guelmim-Oued Noun', 'Guelmim-Oued Noun', 'كلميم واد نون'), seat: t('Guelmim', 'Guelmim', 'كلميم') },
  { slug: 'laayoune-sakia-el-hamra', name: t('Laâyoune-Sakia El Hamra', 'Laâyoune-Sakia El Hamra', 'العيون الساقية الحمراء'), seat: t('Laâyoune', 'Laâyoune', 'العيون') },
  { slug: 'dakhla-oued-ed-dahab', name: t('Dakhla-Oued Ed-Dahab', 'Dakhla-Oued Ed-Dahab', 'الداخلة وادي الذهب'), seat: t('Dakhla', 'Dakhla', 'الداخلة') },
];

const UNPUBLISHED: L4 = t(
  'Non publiée à ce jour dans les données de Fisca ; consulter le site officiel',
  'Not published to date in Fisca’s data; consult the official website',
  'غير منشورة إلى اليوم في معطيات فيسكا؛ يرجى مراجعة الموقع الرسمي',
  'ما منشورة حتى لدابا فمعطيات فيسكا؛ شوفو الموقع الرسمي',
);

function fillRegion(template: L4, region: RegionData): L4 {
  const swap = (text: string, lang: keyof L4): string => text.replaceAll('{region}', region.name[lang]).replaceAll('{seat}', region.seat[lang]);
  return { fr: swap(template.fr, 'fr'), en: swap(template.en, 'en'), ar: swap(template.ar, 'ar'), ary: swap(template.ary, 'ary') };
}

const VERDICT: L4 = t(
  'Pour {region}, le pack TPME de {c_mowakaba_tpme_price} HT laisse un reste à charge de {c_mowakaba_tpme_high_out} à {c_mowakaba_tpme_low_out} HT, pour une prise en charge annoncée de {mowakaba_coverage_low} à {mowakaba_coverage_high}. Nos données ne publient ni différence régionale ni adresse CRI ou DGI à {seat} : non publié à ce jour.',
  'For {region}, the Mowakaba TPME pack at {c_mowakaba_tpme_price} excluding tax leaves an out-of-pocket cost of {c_mowakaba_tpme_high_out} to {c_mowakaba_tpme_low_out} excluding tax, for announced coverage of {mowakaba_coverage_low} to {mowakaba_coverage_high}. Our data publishes no regional difference and no CRI or DGI address in {seat}: not published to date.',
  'بالنسبة لجهة {region} تترك حزمة TPME Mowakaba البالغة {c_mowakaba_tpme_price} بدون ضريبة مبلغا متبقيا من {c_mowakaba_tpme_high_out} إلى {c_mowakaba_tpme_low_out} بدون ضريبة، بتكفل معلن من {mowakaba_coverage_low} إلى {mowakaba_coverage_high}. ولا تنشر معطياتنا أي فرق جهوي ولا عنوان المركز الجهوي للاستثمار أو المديرية في {seat}: غير منشور إلى اليوم.',
  'بالنسبة لجهة {region} حزمة TPME Mowakaba ديال {c_mowakaba_tpme_price} بلا TVA كتخلي اللي بقا على الكليان من {c_mowakaba_tpme_high_out} حتى {c_mowakaba_tpme_low_out} بلا TVA، بتكفل معلن من {mowakaba_coverage_low} حتى {mowakaba_coverage_high}. ومعطياتنا ما كتنشر حتى فرق جهوي ولا عنوان المركز الجهوي للاستثمار ولا المديرية فـ {seat}: ما منشورش حتى لدابا.',
);

const TITLE: L4 = t(
  'Subvention Mowakaba et reste à charge : {region}',
  'Mowakaba subsidy and out-of-pocket cost: {region}',
  'دعم Mowakaba والمبلغ المتبقي: {region}',
  'دعم Mowakaba واللي بقا على الكليان: {region}',
);

const FAQ_Q: L4 = t(
  'Où trouver l’adresse du CRI et de la DGI de {seat} ?',
  'Where to find the CRI and DGI address in {seat}?',
  'أين أجد عنوان المركز الجهوي للاستثمار والمديرية في {seat}؟',
  'فين نلقى عنوان المركز الجهوي للاستثمار والمديرية فـ {seat}؟',
);

const FAQ_A: L4 = t(
  'Elle n’est pas publiée dans les données de Fisca à ce jour ; consultez le site officiel du centre régional d’investissement et celui de la DGI.',
  'It is not published in Fisca’s data to date; consult the official website of the regional investment centre and that of the DGI.',
  'غير منشورة في معطيات فيسكا إلى اليوم؛ يرجى مراجعة الموقع الرسمي للمركز الجهوي للاستثمار وموقع المديرية العامة للضرائب.',
  'ما منشورة فمعطيات فيسكا حتى لدابا؛ شوفو الموقع الرسمي ديال المركز الجهوي للاستثمار وديال DGI.',
);

function regionFacts(region: RegionData): readonly Fact[] {
  return [
    { id: `region_${region.slug}`, ref: 'fisca-mowakaba', label: t('Région', 'Region', 'الجهة'), value: region.name },
    { id: `seat_${region.slug}`, ref: 'fisca-mowakaba', label: t('Chef-lieu', 'Regional capital', 'عاصمة الجهة'), value: region.seat },
    { id: `cri_${region.slug}`, ref: 'fisca-mowakaba', label: t('Adresse du CRI', 'CRI address', 'عنوان المركز الجهوي للاستثمار'), value: UNPUBLISHED },
    { id: `dgi_${region.slug}`, ref: 'fisca-mowakaba', label: t('Adresse de la DGI', 'DGI address', 'عنوان المديرية العامة للضرائب'), value: UNPUBLISHED },
  ];
}

function regionPage(region: RegionData, index: number): SiloPageSpec {
  const next = REGIONS[(index + 1) % REGIONS.length];
  const previous = REGIONS[(index + REGIONS.length - 1) % REGIONS.length];
  if (next === undefined || previous === undefined) throw new RangeError('Régions : liste vide');
  return {
    silo: 'regions',
    slug: region.slug,
    title: fillRegion(TITLE, region),
    verdict: fillRegion(VERDICT, region),
    caseId: 'mowakaba',
    facts: ['mowakaba_packs', 'mowakaba_eligibility'],
    extraFacts: regionFacts(region),
    sources: ['fisca-mowakaba', 'fisca-pricing', 'loi-103-12'],
    faq: { q: fillRegion(FAQ_Q, region), a: fillRegion(FAQ_A, region) },
    cta: 'pricing',
    related: [next.slug, previous.slug, 'rabat-sale-kenitra'].filter((slug, i, all) => slug !== region.slug && all.indexOf(slug) === i),
    howTo: true,
  };
}

export const REGION_PAGES: readonly SiloPageSpec[] = REGIONS.map(regionPage);
