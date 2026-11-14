import { splitAmount, splitGroups } from './common.ts';

/**
 * Montant en toutes lettres, français : orthographe TRADITIONNELLE (pas l'orthographe rectifiée de 1990).
 * Règles retenues :
 * - trait d'union entre les mots d'un nombre composé inférieur à 100 (vingt-deux, quatre-vingt-un, dix-sept),
 *   sauf avec « et » (vingt et un, soixante et onze) ; espaces ailleurs (deux cent trois, deux mille).
 * - « vingt » et « cent » prennent un s quand ils sont multipliés et non suivis d'un autre nombre : quatre-vingts,
 *   deux cents ; pas de s devant « mille » (quatre-vingt mille, deux cent mille) ; s devant million/milliard
 *   (quatre-vingts millions, deux cents millions), noms et non adjectifs numéraux.
 * - « mille » est invariable et ne s'écrit pas « un mille ».
 * - million, milliard : « un million », « deux millions » ; « de » devant « dirhams » quand le montant entier se termine
 *   par ces mots (un million de dirhams).
 * - dirham : singulier pour 0 et 1, pluriel dès 2 ; centime : singulier pour 1. Centimes nuls omis ; « zéro dirham »
 *   conservé s'il reste des centimes. PROVISOIRE : à faire relire par un locuteur natif (ERRATA section E).
 */

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'] as const;
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'] as const;

function unit(n: number): string {
  return UNITS[n] ?? '';
}

/** 1 à 99 ; `final` : le nombre est le dernier mot avant le nom (donne le s de quatre-vingts). */
function below100(n: number, final: boolean): string {
  if (n <= 16) return unit(n);
  if (n < 20) return `dix-${unit(n - 10)}`;
  if (n < 70) {
    const ten = Math.floor(n / 10);
    const one = n % 10;
    if (one === 0) return TENS[ten] ?? '';
    return one === 1 ? `${TENS[ten] ?? ''} et un` : `${TENS[ten] ?? ''}-${unit(one)}`;
  }
  if (n < 80) {
    const one = n - 60;
    return one === 11 ? 'soixante et onze' : `soixante-${below100(one, false)}`;
  }
  if (n === 80) return final ? 'quatre-vingts' : 'quatre-vingt';
  return `quatre-vingt-${below100(n - 80, false)}`;
}

/** 1 à 999 ; `final` : s de « cents » et de « quatre-vingts » admis. */
function below1000(n: number, final: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds === 1) parts.push('cent');
  else if (hundreds > 1) parts.push(`${unit(hundreds)} cent${rest === 0 && final ? 's' : ''}`);
  if (rest > 0) parts.push(below100(rest, final));
  return parts.join(' ');
}

function plural(count: bigint, singular: string): string {
  return count > 1n ? `${singular}s` : singular;
}

/** Montant en centimes entiers (bigint) en toutes lettres françaises, sans le préfixe d'arrêté. */
export function amountInWordsFr(totalCents: bigint): string {
  const { dirhams, centimes } = splitAmount(totalCents);
  const groups = splitGroups(dirhams);
  const parts: string[] = [];
  let endsWithScale = false;
  if (groups.billions > 0) {
    parts.push(`${below1000(groups.billions, true)} ${plural(BigInt(groups.billions), 'milliard')}`);
    endsWithScale = true;
  }
  if (groups.millions > 0) {
    parts.push(`${below1000(groups.millions, true)} ${plural(BigInt(groups.millions), 'million')}`);
    endsWithScale = true;
  }
  if (groups.thousands > 0) {
    parts.push(groups.thousands === 1 ? 'mille' : `${below1000(groups.thousands, false)} mille`);
    endsWithScale = false;
  }
  if (groups.units > 0) {
    parts.push(below1000(groups.units, true));
    endsWithScale = false;
  }
  const dirhamWords = dirhams === 0n ? 'zéro' : parts.join(' ');
  const noun = endsWithScale ? 'de dirhams' : plural(dirhams, 'dirham');
  const dirhamPhrase = `${dirhamWords} ${noun}`;
  if (centimes === 0n) return dirhamPhrase;
  return `${dirhamPhrase} et ${below100(Number(centimes), true)} ${plural(centimes, 'centime')}`;
}
