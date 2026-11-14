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
  /** HT des lignes + droit de timbre (charge hors TVA) : BR-CO-13 d'EN 16931. */
  readonly taxExclusiveCents: bigint;
  readonly taxTotalCents: bigint;
  /** TTC : HT lignes + droit de timbre + TVA (débours compris, hors base TVA). */
  readonly taxInclusiveCents: bigint;
  /** Net à payer : TTC - retenue de garantie. */
  readonly payableCents: bigint;
  /** Base de TVA : somme des bases des catégories dans le champ de la TVA (S, Z, E) ; ni débours ni droit de timbre (catégorie O). */
  readonly vatBaseCents: bigint;
  /** Total des débours (lignes de catégorie O), compté dans le TTC et le net à payer, pas dans la base TVA. */
  readonly disbursementsCents: bigint;
  /** Droit de timbre : divRoundHalfUpBigInt(TTC espèces × bps, 10000), 0 sans règle. */
  readonly stampDutyCents: bigint;
  /** Retenue de garantie : divRoundHalfUpBigInt(base × bps, 10000), 0 sans règle ; réduit le net à payer, jamais la base TVA. */
  readonly retentionCents: bigint;
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
  interface Group {
    category: VatCategoryCode;
    vatRateBps: number;
    exemptionReasonCode: string | undefined;
    taxable: bigint;
  }
  const groups = new Map<string, Group>();
  const lines: ComputedLine[] = [];
  let lineExtension = 0n;
  let disbursements = 0n;

  for (const line of invoice.lines) {
    const gross = divRoundHalfUpBigInt(BigInt(line.quantityMilli) * BigInt(line.unitPriceCents), MILLI_PER_UNIT);
    const discount = divRoundHalfUpBigInt(gross * BigInt(line.discountBps), BPS_FULL);
    const net = gross - discount;
    const category = categoryOf(line);
    lines.push({ grossCents: gross, discountCents: discount, lineExtensionCents: net, categoryCode: category });
    lineExtension += net;
    if (category === 'O') disbursements += net;
    const key = `${category}|${line.vatRateBps}|${line.vatExemptionReasonCode ?? ''}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { category, vatRateBps: line.vatRateBps, exemptionReasonCode: line.vatExemptionReasonCode, taxable: net });
    } else {
      group.taxable += net;
    }
  }

  let taxTotal = 0n;
  let vatBase = 0n;
  const taxSubtotals: ComputedTaxSubtotal[] = [];
  const flush = (group: Group): void => {
    const tax = divRoundHalfUpBigInt(group.taxable * BigInt(group.vatRateBps), BPS_FULL);
    taxTotal += tax;
    if (group.category !== 'O') vatBase += group.taxable;
    taxSubtotals.push({
      categoryCode: group.category,
      vatRateBps: group.vatRateBps,
      exemptionReasonCode: group.exemptionReasonCode,
      taxableCents: group.taxable,
      taxCents: tax,
    });
  };

  const preStampTtc = lineExtension + sumTax(groups);

  let stampDuty = 0n;
  const stampRule = invoice.stampDuty;
  if (stampRule !== undefined) {
    if (BigInt(stampRule.cashSettledCents) > preStampTtc) {
      throw new UblGeneratorError('UBL_STAMP_DUTY_INVALID', 'Le TTC réglé en espèces dépasse le TTC de la facture.', [
        { path: 'stampDuty.cashSettledCents', code: 'custom' },
      ]);
    }
    stampDuty = divRoundHalfUpBigInt(BigInt(stampRule.cashSettledCents) * BigInt(stampRule.rateBps), BPS_FULL);
    // Le droit de timbre est une charge hors champ de la TVA (catégorie O) : il rejoint la base du sous-total O (BR-O-08).
    const outOfScope = [...groups.values()].find((group) => group.category === 'O');
    if (outOfScope === undefined) {
      groups.set('O|0|', { category: 'O', vatRateBps: 0, exemptionReasonCode: undefined, taxable: stampDuty });
    } else {
      outOfScope.taxable += stampDuty;
    }
  }

  for (const group of groups.values()) flush(group);

  const taxExclusive = lineExtension + stampDuty;
  const taxInclusive = taxExclusive + taxTotal;

  let retention = 0n;
  const retentionRule = invoice.retention;
  if (retentionRule !== undefined) {
    const base = retentionRule.basis === 'LINE_EXTENSION' ? lineExtension : preStampTtc;
    retention = divRoundHalfUpBigInt(base * BigInt(retentionRule.rateBps), BPS_FULL);
    if (retention > taxInclusive) {
      throw new UblGeneratorError('UBL_RETENTION_INVALID', 'La retenue de garantie dépasse le TTC de la facture.', [
        { path: 'retention', code: 'custom' },
      ]);
    }
  }

  return {
    lines,
    taxSubtotals,
    lineExtensionCents: lineExtension,
    taxExclusiveCents: taxExclusive,
    taxTotalCents: taxTotal,
    taxInclusiveCents: taxInclusive,
    payableCents: taxInclusive - retention,
    vatBaseCents: vatBase,
    disbursementsCents: disbursements,
    stampDutyCents: stampDuty,
    retentionCents: retention,
  };
}

function sumTax(groups: ReadonlyMap<string, { vatRateBps: number; taxable: bigint }>): bigint {
  let total = 0n;
  for (const group of groups.values()) total += divRoundHalfUpBigInt(group.taxable * BigInt(group.vatRateBps), BPS_FULL);
  return total;
}

const DECLARED_FIELDS = [
  'lineExtensionCents',
  'taxExclusiveCents',
  'taxTotalCents',
  'taxInclusiveCents',
  'payableCents',
  'stampDutyCents',
  'retentionCents',
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
