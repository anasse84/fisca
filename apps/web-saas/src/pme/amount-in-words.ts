/**
 * Arrêté en toutes lettres (Doc_08 Section 09) : deux fonctions pures, sans IA, sur des centimes entiers.
 * Lexique de nombres seulement ; la phrase d'introduction (« Arrêtée la présente facture à la somme de : ») vient de i18n.
 * Le français suit l'orthographe usuelle (traits d'union entre dizaines et unités, « et » libre, accord de cent / vingt).
 * L'arabe est un ALGORITHME DU DÉPÔT (la spécification ne donne que deux exemples) : voir `amount-in-words.test.ts`
 * pour les vecteurs vérifiés à la main ; relecture par un arabisant comptable recommandée.
 */

const MAX_DIRHAMS = 10n ** 12n;

function toCents(value: number | bigint): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`AMOUNT_WORDS_INVALID: montant non entier (${value}).`);
  }
  const cents = BigInt(value);
  if (cents < 0n || cents >= MAX_DIRHAMS * 100n) {
    throw new Error(`AMOUNT_WORDS_INVALID: montant hors limites (${cents}).`);
  }
  return cents;
}

const FR_UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const FR_TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function frBelow100(n: number, plural80: boolean): string {
  if (n < 20) {
    return FR_UNITS[n] ?? '';
  }
  const tens = Math.trunc(n / 10);
  const unit = n % 10;
  if (tens <= 6) {
    const base = FR_TENS[tens] ?? '';
    if (unit === 0) return base;
    return unit === 1 ? `${base} et un` : `${base}-${FR_UNITS[unit] ?? ''}`;
  }
  if (tens === 7) {
    return unit === 1 ? 'soixante et onze' : `soixante-${FR_UNITS[10 + unit] ?? ''}`;
  }
  if (tens === 8) {
    return unit === 0 ? (plural80 ? 'quatre-vingts' : 'quatre-vingt') : `quatre-vingt-${FR_UNITS[unit] ?? ''}`;
  }
  return `quatre-vingt-${FR_UNITS[10 + unit] ?? ''}`;
}

/** `final` : « cent » et « quatre-vingts » prennent le s quand rien ne les suit dans le nom de nombre (sauf devant « mille »). */
function frBelow1000(n: number, final: boolean): string {
  const hundreds = Math.trunc(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) {
    parts.push(hundreds === 1 ? 'cent' : `${FR_UNITS[hundreds] ?? ''} cent${rest === 0 && final ? 's' : ''}`);
  }
  if (rest > 0) {
    parts.push(frBelow100(rest, final));
  }
  return parts.join(' ');
}

function frNumber(n: bigint): string {
  if (n === 0n) return 'zéro';
  const billions = Number(n / 1_000_000_000n);
  const millions = Number((n / 1_000_000n) % 1000n);
  const thousands = Number((n / 1000n) % 1000n);
  const units = Number(n % 1000n);
  const parts: string[] = [];
  if (billions > 0) parts.push(`${frBelow1000(billions, true)} milliard${billions > 1 ? 's' : ''}`);
  if (millions > 0) parts.push(`${frBelow1000(millions, true)} million${millions > 1 ? 's' : ''}`);
  if (thousands > 0) parts.push(thousands === 1 ? 'mille' : `${frBelow1000(thousands, false)} mille`);
  if (units > 0) parts.push(frBelow1000(units, true));
  return parts.join(' ');
}

/** « douze mille dirhams et zéro centime ». */
export function amountInWordsFr(cents: number | bigint): string {
  const total = toCents(cents);
  const dirhams = total / 100n;
  const centimes = total % 100n;
  const de = dirhams >= 1_000_000n && dirhams % 1_000_000n === 0n ? 'de ' : '';
  const dirhamNoun = dirhams >= 2n ? 'dirhams' : 'dirham';
  const centimeNoun = centimes >= 2n ? 'centimes' : 'centime';
  return `${frNumber(dirhams)} ${de}${dirhamNoun} et ${frNumber(centimes)} ${centimeNoun}`;
}

const AR_ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

interface ArScale {
  readonly one: string;
  readonly dual: string;
  /** Duel à l'état construit (sans nun), devant le nom compté. */
  readonly dualConstruct: string;
  readonly plural: string;
  readonly singular: string;
}

const AR_THOUSAND: ArScale = { one: 'ألف', dual: 'ألفان', dualConstruct: 'ألفا', plural: 'آلاف', singular: 'ألف' };
const AR_MILLION: ArScale = { one: 'مليون', dual: 'مليونان', dualConstruct: 'مليونا', plural: 'ملايين', singular: 'مليون' };
const AR_BILLION: ArScale = { one: 'مليار', dual: 'ملياران', dualConstruct: 'مليارا', plural: 'مليارات', singular: 'مليار' };

/** 1 à 99, nom compté masculin (le numéral 3 à 10 prend le ta marbouta). */
function arBelow100(n: number): string {
  if (n < 10) return AR_ONES[n] ?? '';
  if (n === 10) return 'عشرة';
  if (n === 11) return 'أحد عشر';
  if (n === 12) return 'اثنا عشر';
  if (n < 20) return `${AR_ONES[n - 10] ?? ''} عشر`;
  const tens = Math.trunc(n / 10);
  const unit = n % 10;
  return unit === 0 ? (AR_TENS[tens] ?? '') : `${AR_ONES[unit] ?? ''} و${AR_TENS[tens] ?? ''}`;
}

function arScaled(group: number, scale: ArScale, isLast: boolean): string {
  const hundreds = Math.trunc(group / 100);
  const rest = group % 100;
  if (rest === 0) {
    return `${hundreds === 2 ? 'مائتا' : (AR_HUNDREDS[hundreds] ?? '')} ${scale.singular}`;
  }
  const lead = hundreds > 0 ? `${AR_HUNDREDS[hundreds] ?? ''} و` : '';
  if (rest === 1) return `${lead}${scale.one}`;
  if (rest === 2) return `${lead}${isLast ? scale.dualConstruct : scale.dual}`;
  if (rest <= 10) return `${lead}${arBelow100(rest)} ${scale.plural}`;
  return `${lead}${arBelow100(rest)} ${scale.singular}`;
}

function arUnits(group: number): string {
  const hundreds = Math.trunc(group / 100);
  const rest = group % 100;
  if (rest === 0) return hundreds === 2 ? 'مائتا' : (AR_HUNDREDS[hundreds] ?? '');
  const lead = hundreds > 0 ? `${AR_HUNDREDS[hundreds] ?? ''} و` : '';
  return `${lead}${arBelow100(rest)}`;
}

function arNumber(n: bigint): string {
  const groups: ReadonlyArray<readonly [number, ArScale | null]> = [
    [Number(n / 1_000_000_000n), AR_BILLION],
    [Number((n / 1_000_000n) % 1000n), AR_MILLION],
    [Number((n / 1000n) % 1000n), AR_THOUSAND],
    [Number(n % 1000n), null],
  ];
  const present = groups.filter(([value]) => value > 0);
  const phrases = present.map(([value, scale], index) =>
    scale === null ? arUnits(value) : arScaled(value, scale, index === present.length - 1),
  );
  return phrases.join(' و');
}

/** Nom compté (dirham ou centime) accordé : 1 singulier explicite, 2 duel, 3 à 10 pluriel, sinon singulier. */
function arCounted(n: bigint, forms: { readonly singular: string; readonly dual: string; readonly plural: string }): string {
  if (n === 0n) return `صفر ${forms.singular}`;
  if (n === 1n) return `${forms.singular} واحد`;
  if (n === 2n) return forms.dual;
  const rest = Number(n % 100n);
  return `${arNumber(n)} ${rest >= 3 && rest <= 10 ? forms.plural : forms.singular}`;
}

/** « اثنا عشر ألف درهم وصفر سنتيم ». */
export function amountInWordsAr(cents: number | bigint): string {
  const total = toCents(cents);
  const dirhams = arCounted(total / 100n, { singular: 'درهم', dual: 'درهمان', plural: 'دراهم' });
  const centimes = arCounted(total % 100n, { singular: 'سنتيم', dual: 'سنتيمان', plural: 'سنتيمات' });
  return `${dirhams} و${centimes}`;
}
