import { divRoundHalfUpBigInt } from '@fisca/shared-types';
import { UblGeneratorError, type UblTotalsMismatchDetail } from '../errors.ts';
import type { ParsedUblInvoiceInput } from './input.ts';

export type VatCategoryCode = 'S' | 'Z' | 'E' | 'O';

export interface ComputedLine {
  readonly grossCents: bigint;
  readonly discountCents: bigint;
  readonly lineExtensionCents: bigint;
  readonly categoryCode: VatCategoryCode;
}

export interface ComputedTaxSubtotal {
  readonly categoryCode: VatCategoryCode;
  readonly vatRateBps: number;
  readonly exemptionReasonCode: string | undefined;
  readonly taxableCents: bigint;
  readonly taxCents: bigint;
}

export interface ComputedTotals {
  readonly lines: readonly ComputedLine[];
  readonly taxSubtotals: readonly ComputedTaxSubtotal[];
  readonly lineExtensionCents: bigint;
  readonly taxExclusiveCents: bigint;
  readonly taxTotalCents: bigint;
  readonly taxInclusiveCents: bigint;
  readonly payableCents: bigint;
}

const MILLI_PER_UNIT = 1000n;
const BPS_FULL = 10000n;

type ParsedLine = ParsedUblInvoiceInput['lines'][number];

function categoryOf(line: ParsedLine): VatCategoryCode {
  if (line.isDisbursementDebours) return 'O';
  if (line.vatRateBps > 0) return 'S';
  return line.vatExemptionReasonCode === undefined ? 'Z' : 'E';
}

/**
 * Recalcul des totaux à partir des lignes (Loi 1) :
 * brut = quantité(milli) × prix / 1000, remise = brut × remise(bps) / 10000, chaque division arrondie au demi supérieur
 * (divRoundHalfUpBigInt, ERRATA D-09) ; TVA = base de la catégorie × taux(bps) / 10000, arrondie une fois par catégorie.
 */
export function computeTotals(invoice: ParsedUblInvoiceInput): ComputedTotals {
  const groups = new Map<string, { line: ParsedLine; category: VatCategoryCode; taxable: bigint }>();
  const lines: ComputedLine[] = [];
  let lineExtension = 0n;

  for (const line of invoice.lines) {
    const gross = divRoundHalfUpBigInt(BigInt(line.quantityMilli) * BigInt(line.unitPriceCents), MILLI_PER_UNIT);
    const discount = divRoundHalfUpBigInt(gross * BigInt(line.discountBps), BPS_FULL);
    const net = gross - discount;
    const category = categoryOf(line);
    lines.push({ grossCents: gross, discountCents: discount, lineExtensionCents: net, categoryCode: category });
    lineExtension += net;
    const key = `${category}|${line.vatRateBps}|${line.vatExemptionReasonCode ?? ''}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { line, category, taxable: net });
    } else {
      group.taxable += net;
    }
  }

  const taxSubtotals: ComputedTaxSubtotal[] = [];
  let taxTotal = 0n;
  for (const group of groups.values()) {
    const tax = divRoundHalfUpBigInt(group.taxable * BigInt(group.line.vatRateBps), BPS_FULL);
    taxTotal += tax;
    taxSubtotals.push({
      categoryCode: group.category,
      vatRateBps: group.line.vatRateBps,
      exemptionReasonCode: group.line.vatExemptionReasonCode,
      taxableCents: group.taxable,
      taxCents: tax,
    });
  }

  const taxInclusive = lineExtension + taxTotal;
  return {
    lines,
    taxSubtotals,
    lineExtensionCents: lineExtension,
    taxExclusiveCents: lineExtension,
    taxTotalCents: taxTotal,
    taxInclusiveCents: taxInclusive,
    payableCents: taxInclusive,
  };
}

const DECLARED_FIELDS = [
  'lineExtensionCents',
  'taxExclusiveCents',
  'taxTotalCents',
  'taxInclusiveCents',
  'payableCents',
] as const;

/** Compare les totaux fournis (s'il y en a) aux totaux recalculés ; tout écart est une erreur typée. */
export function assertDeclaredTotals(invoice: ParsedUblInvoiceInput, computed: ComputedTotals): void {
  const declared = invoice.declaredTotals;
  if (declared === undefined) return;
  const mismatches: UblTotalsMismatchDetail[] = [];
  for (const field of DECLARED_FIELDS) {
    const value = declared[field];
    if (value !== undefined && BigInt(value) !== computed[field]) {
      mismatches.push({ field, expectedCents: computed[field].toString(), declaredCents: String(value) });
    }
  }
  if (mismatches.length > 0) {
    throw new UblGeneratorError(
      'UBL_TOTALS_MISMATCH',
      `Totaux déclarés incohérents avec les lignes : ${mismatches.map((m) => m.field).join(', ')}.`,
      mismatches,
    );
  }
}
