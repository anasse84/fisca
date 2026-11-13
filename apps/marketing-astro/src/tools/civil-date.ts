/**
 * Dates civiles en arithmétique entière (aucun flottant, aucun fuseau horaire) : les outils publics ne manipulent
 * que des jours calendaires `AAAA-MM-JJ`. Années admises : 1970 à 2200.
 */
export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const MIN_YEAR = 1970;
const MAX_YEAR = 2200;

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** `AAAA-MM-JJ` strict ; null si le format ou le jour calendaire est invalide. */
export function parseIsoDate(text: string): CivilDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function formatIsoDate(date: CivilDate): string {
  const pad = (n: number, width: number): string => String(n).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/** Numéro de jour depuis 1970-01-01 (algorithme de Hinnant, entiers uniquement). */
export function toDayNumber(date: CivilDate): number {
  const shifted = date.month <= 2 ? date.year - 1 : date.year;
  const era = Math.trunc(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const monthIndex = date.month > 2 ? date.month - 3 : date.month + 9;
  const dayOfYear = Math.trunc((153 * monthIndex + 2) / 5) + date.day - 1;
  const dayOfEra = yearOfEra * 365 + Math.trunc(yearOfEra / 4) - Math.trunc(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

export function fromDayNumber(days: number): CivilDate {
  const shifted = days + 719468;
  const era = Math.trunc(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.trunc((dayOfEra - Math.trunc(dayOfEra / 1460) + Math.trunc(dayOfEra / 36524) - Math.trunc(dayOfEra / 146096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.trunc(yearOfEra / 4) - Math.trunc(yearOfEra / 100));
  const monthIndex = Math.trunc((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.trunc((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

export function addDays(date: CivilDate, days: number): CivilDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Ajoute des mois ; le jour est ramené à la fin du mois d'arrivée si besoin (31 janvier + 1 mois = 28 ou 29 février). */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.trunc(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** Nombre de jours entiers de `from` à `to` (négatif si `to` précède `from`). */
export function diffDays(from: CivilDate, to: CivilDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

export function compareDates(a: CivilDate, b: CivilDate): number {
  return toDayNumber(a) - toDayNumber(b);
}
