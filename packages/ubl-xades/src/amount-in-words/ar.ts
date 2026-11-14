import { splitAmount, splitGroups } from './common.ts';

/**
 * Montant en toutes lettres, arabe classique, sans voyelles brèves. PROVISOIRE : à faire relire par un locuteur natif
 * (ERRATA section E). Règles retenues (dirham et centime sont masculins) :
 * - nominatif ; tamyiz de 11 à 99 au singulier accusatif (درهما) ; de 3 à 10 au pluriel (دراهم) ; accord inverse du
 *   genre : 3 à 10 en forme à ta marbuta (ثلاثة), 11 à 19 en forme masculine (أحد عشر).
 * - 1 et 2 : le nom seul (درهم / درهمان), jamais un mot de nombre ; après une centaine ou un groupe, « et » + nom
 *   (مائة ودرهم).
 * - مائة / مائتان / ثلاثمائة ... ; duel en annexion devant le nom compté : مائتا درهم, ألفا درهم, مليونا درهم.
 * - ألف / ألفان / آلاف ; مليون / مليونان / ملايين ; مليار / ملياران / مليارات ; de 11 à 99 : « عشرون ألفا » suivi d'un
 *   autre terme, « عشرون ألف درهم » en annexion quand le groupe termine le nombre.
 * - ordre décroissant, « و » devant chaque terme après le premier ; centimes après les dirhams, nuls omis ;
 *   « صفر درهم » conservé s'il reste des centimes.
 */

const MASC_UNITS = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة'] as const;
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'] as const;
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'] as const;
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'] as const;

/** Formes d'un nom compté ou d'une échelle. */
interface Forms {
  /** Singulier nominatif / génitif : درهم, ألف. */
  readonly singular: string;
  /** Duel nominatif : درهمان, ألفان. */
  readonly dual: string;
  /** Duel en annexion devant le nom compté : ألفا (le nom du dirham suit). */
  readonly dualAnnexed: string;
  /** Pluriel de 3 à 10 : دراهم, آلاف. */
  readonly plural: string;
  /** Singulier accusatif de 11 à 99 : درهما, ألفا. */
  readonly accusative: string;
}

const DIRHAM: Forms = { singular: 'درهم', dual: 'درهمان', dualAnnexed: 'درهما', plural: 'دراهم', accusative: 'درهما' };
const CENTIME: Forms = { singular: 'سنتيم', dual: 'سنتيمان', dualAnnexed: 'سنتيما', plural: 'سنتيمات', accusative: 'سنتيما' };
const THOUSAND: Forms = { singular: 'ألف', dual: 'ألفان', dualAnnexed: 'ألفا', plural: 'آلاف', accusative: 'ألفا' };
const MILLION: Forms = { singular: 'مليون', dual: 'مليونان', dualAnnexed: 'مليونا', plural: 'ملايين', accusative: 'مليونا' };
const BILLION: Forms = { singular: 'مليار', dual: 'ملياران', dualAnnexed: 'مليارا', plural: 'مليارات', accusative: 'مليارا' };

/** Nombre de 3 à 99, masculin (compté masculin). */
function wordsFrom3(n: number): string {
  if (n <= 10) return MASC_UNITS[n] ?? '';
  if (n < 20) return TEENS[n - 10] ?? '';
  const ten = Math.floor(n / 10);
  const one = n % 10;
  if (one === 0) return TENS[ten] ?? '';
  const unit = one === 1 ? 'أحد' : (MASC_UNITS[one] ?? '');
  return `${unit} و${TENS[ten] ?? ''}`;
}

/** Terme(s) d'un compte de 1 à 999 devant un nom ou une échelle. `annexed` : le nom compté suit directement. */
function terms(n: number, forms: Forms, annexed: boolean, isScale: boolean): string[] {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const tail = (count: number): string => (count >= 11 ? (annexed && isScale ? forms.singular : forms.accusative) : forms.plural);
  if (hundreds === 0) {
    if (rest === 1) return [forms.singular];
    if (rest === 2) return [annexed ? forms.dualAnnexed : forms.dual];
    return [`${wordsFrom3(rest)} ${tail(rest)}`];
  }
  if (rest === 0) {
    // Centaine seule : le duel est en annexion devant le nom (مائتا درهم, مائتا ألف).
    const word = hundreds === 2 ? 'مائتا' : (HUNDREDS[hundreds] ?? '');
    return [`${word} ${forms.singular}`];
  }
  if (rest === 1 || rest === 2) {
    const head = hundreds === 2 && isScale ? `مائتا ${forms.singular}` : isScale ? `${HUNDREDS[hundreds] ?? ''} ${forms.singular}` : (HUNDREDS[hundreds] ?? '');
    const last = rest === 1 ? forms.singular : annexed ? forms.dualAnnexed : forms.dual;
    return [head, last];
  }
  return [`${HUNDREDS[hundreds] ?? ''} و${wordsFrom3(rest)} ${tail(rest)}`];
}

/** Montant en centimes entiers (bigint) en toutes lettres arabes, sans le préfixe d'arrêté. */
export function amountInWordsAr(totalCents: bigint): string {
  const { dirhams, centimes } = splitAmount(totalCents);
  const groups = splitGroups(dirhams);
  const scaled: readonly (readonly [number, Forms])[] = [
    [groups.billions, BILLION],
    [groups.millions, MILLION],
    [groups.thousands, THOUSAND],
  ];
  const parts: string[] = [];
  const unitsFollow = groups.units > 0;
  const lastScaleIndex = scaled.reduce((last, [count], index) => (count > 0 ? index : last), -1);
  scaled.forEach(([count, forms], index) => {
    if (count === 0) return;
    const annexed = !unitsFollow && index === lastScaleIndex;
    parts.push(...terms(count, forms, annexed, true));
  });
  if (unitsFollow) {
    parts.push(...terms(groups.units, DIRHAM, false, false));
  } else if (parts.length > 0) {
    parts.push(DIRHAM.singular);
  }
  let dirhamPhrase: string;
  if (dirhams === 0n) {
    dirhamPhrase = `صفر ${DIRHAM.singular}`;
  } else if (unitsFollow) {
    dirhamPhrase = joinTerms(parts);
  } else {
    // Le nom du dirham s'ajoute au dernier terme (annexion) sans « و ».
    const noun = parts.pop() ?? DIRHAM.singular;
    dirhamPhrase = `${joinTerms(parts)} ${noun}`;
  }
  if (centimes === 0n) return dirhamPhrase;
  return `${dirhamPhrase} و${terms(Number(centimes), CENTIME, false, false).join(' و')}`;
}

function joinTerms(items: readonly string[]): string {
  return items.map((item, index) => (index === 0 ? item : `و${item}`)).join(' ');
}
