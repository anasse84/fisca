import { FiscalAstError } from './errors.ts';

/** Calendrier grégorien entier : aucun objet Date, aucun fuseau, aucun flottant. */
export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Lit « AAAA-MM-JJ » d'un jour réel ; tout le reste est une erreur typée DATE_INVALID. */
export function parseIsoDate(iso: unknown, label: string): CalendarDate {
  if (typeof iso !== 'string') {
    throw new FiscalAstError('DATE_INVALID', `${label} : texte AAAA-MM-JJ attendu.`);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) {
    throw new FiscalAstError('DATE_INVALID', `${label} : date « ${iso} » hors format AAAA-MM-JJ.`);
  }
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new FiscalAstError('DATE_INVALID', `${label} : date « ${iso} » impossible au calendrier.`);
  }
  return { year, month, day };
}

export function formatIsoDate(date: CalendarDate): string {
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/** Numéro de jour continu (1er janvier de l'an 1 = 1) : comparaisons et écarts en jours, par sommation entière. */
export function dayNumber(date: CalendarDate): number {
  let total = 0;
  for (let year = 1; year < date.year; year += 1) {
    total += isLeapYear(year) ? 366 : 365;
  }
  for (let month = 1; month < date.month; month += 1) {
    total += daysInMonth(date.year, month);
  }
  return total + date.day;
}

/** Réciproque de dayNumber. */
export function dateFromDayNumber(value: number): CalendarDate {
  let remaining = value;
  let year = 1;
  while (remaining > (isLeapYear(year) ? 366 : 365)) {
    remaining -= isLeapYear(year) ? 366 : 365;
    year += 1;
  }
  let month = 1;
  while (remaining > daysInMonth(year, month)) {
    remaining -= daysInMonth(year, month);
    month += 1;
  }
  return { year, month, day: remaining };
}

/** Ajoute des mois entiers ; un jour inexistant dans le mois d'arrivée est ramené à son dernier jour (31 août + 6 mois = 28 février). */
export function addMonthsClamped(iso: string, months: number, label: string): string {
  const start = parseIsoDate(iso, label);
  const monthIndex = start.year * 12 + (start.month - 1) + months;
  const year = Math.trunc(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return formatIsoDate({ year, month, day: Math.min(start.day, daysInMonth(year, month)) });
}

/** Ajoute des jours entiers à une date ISO. */
export function addDays(iso: string, days: number, label: string): string {
  return formatIsoDate(dateFromDayNumber(dayNumber(parseIsoDate(iso, label)) + days));
}
