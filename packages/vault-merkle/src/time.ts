import { VaultMerkleError, type VaultMerkleErrorCode } from './errors.ts';

/** Dates en entiers : millisecondes UTC (entiers sûrs) et calendrier UTC. Aucun calcul flottant. */

export const MS_PER_DAY = 86_400_000;
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Instant ISO 8601 UTC strict → millisecondes entières ; refuse les dates inexistantes (30 février). */
export function parseInstantMs(iso: string, code: VaultMerkleErrorCode): number {
  const match = ISO_INSTANT.exec(iso);
  if (match === null) throw new VaultMerkleError(code, 'instant ISO 8601 UTC attendu (AAAA-MM-JJThh:mm:ssZ).');
  const [year, month, day, hour, minute, second, milli] = match.slice(1).map((part) => (part === undefined ? 0 : Number.parseInt(part, 10)));
  const ms = Date.UTC(year as number, (month as number) - 1, day as number, hour as number, minute as number, second as number, milli as number);
  if (new Date(ms).toISOString().slice(0, 19) !== iso.slice(0, 19)) throw new VaultMerkleError(code, 'instant ISO inexistant au calendrier.');
  return ms;
}

/** Jour AAAA-MM-JJ → millisecondes UTC de 00:00:00. */
export function parseDayStartMs(day: string, code: VaultMerkleErrorCode): number {
  const match = ISO_DAY.exec(day);
  if (match === null) throw new VaultMerkleError(code, 'jour AAAA-MM-JJ attendu.');
  const ms = Date.UTC(Number.parseInt(match[1] as string, 10), Number.parseInt(match[2] as string, 10) - 1, Number.parseInt(match[3] as string, 10));
  if (new Date(ms).toISOString().slice(0, 10) !== day) throw new VaultMerkleError(code, 'jour inexistant au calendrier.');
  return ms;
}

/** Instant ISO à la seconde, suffixe Z (accepté par WormPutOptions.retentionUntilIso). */
export function formatInstant(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** Ajoute des mois civils UTC ; le quantième est ramené au dernier jour du mois d'arrivée si nécessaire (31 jan + 1 mois = 28/29 fév). */
export function addMonthsUtc(ms: number, months: number): number {
  const date = new Date(ms);
  const totalMonths = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
}
