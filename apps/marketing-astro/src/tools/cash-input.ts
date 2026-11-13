/** Saisie des règlements en espèces : une ligne = `AAAA-MM-JJ ; fournisseur ; montant TTC en MAD`. */
import { parseMadToCents } from './amounts.ts';
import { addDays, formatIsoDate, parseIsoDate } from './civil-date.ts';
import type { CashPayment } from './cash-cap.ts';

export type CashLinesOutcome =
  | { readonly ok: true; readonly payments: readonly CashPayment[] }
  | { readonly ok: false; readonly error: 'EMPTY' | 'FORMAT' | 'DATE' | 'AMOUNT'; readonly lineNumber?: number };

export const MAX_CASH_LINES = 500;

export function parseCashLines(text: string): CashLinesOutcome {
  const payments: CashPayment[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = (lines[i] ?? '').trim();
    if (raw === '') continue;
    const parts = raw.split(/[;\t]/).map((s) => s.trim());
    if (parts.length !== 3) return { ok: false, error: 'FORMAT', lineNumber: i + 1 };
    const [date = '', supplier = '', amount = ''] = parts;
    if (parseIsoDate(date) === null) return { ok: false, error: 'DATE', lineNumber: i + 1 };
    const cents = parseMadToCents(amount);
    if (cents === null || cents === 0) return { ok: false, error: 'AMOUNT', lineNumber: i + 1 };
    payments.push({ date, supplier, amountTtcCents: cents });
    if (payments.length > MAX_CASH_LINES) return { ok: false, error: 'FORMAT', lineNumber: i + 1 };
  }
  return payments.length === 0 ? { ok: false, error: 'EMPTY' } : { ok: true, payments };
}

/** Exemple D-20 : `count` règlements d'un même fournisseur, un par jour à partir de `firstDate`, du même montant TTC (MAD). */
export function buildMonthlyExample(firstDate: string, supplier: string, count: number, amountMad: string): string {
  const start = parseIsoDate(firstDate);
  if (start === null) throw new RangeError('Date de départ invalide');
  const lines: string[] = [];
  for (let i = 0; i < count; i += 1) lines.push(`${formatIsoDate(addDays(start, i))};${supplier};${amountMad}`);
  return lines.join('\n');
}
