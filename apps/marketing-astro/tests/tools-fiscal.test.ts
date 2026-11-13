import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ceilDivBigInt, htFromTtc, parseMadToCents, parsePercentToBps, proportionHalfUp } from '../src/tools/amounts.ts';
import { addDays, addMonths, diffDays, formatIsoDate, parseIsoDate } from '../src/tools/civil-date.ts';
import { evaluateCashPayments } from '../src/tools/cash-cap.ts';
import type { CashParams, CashPayment } from '../src/tools/cash-cap.ts';
import { buildEntry, cleanAccountInput, CITED_ACCOUNTS } from '../src/tools/ledger.ts';
import { computeLoi6921, rateForStartedMonths, startedMonthsBetween } from '../src/tools/loi-69-21.ts';
import type { Loi6921Params } from '../src/tools/loi-69-21.ts';
import { computeRasTva } from '../src/tools/ras-tva.ts';
import type { RasParams } from '../src/tools/ras-tva.ts';
import { ruleParam } from '../src/tools/rule-params.ts';

interface Vectors {
  readonly vectors: readonly { readonly id: string; readonly state: string; readonly input: Record<string, number | string>; readonly expected: Record<string, number | string> }[];
  readonly rule_date: string;
}
const GOLD = JSON.parse(readFileSync(new URL('./golden/tools-viraux.vectors.json', import.meta.url), 'utf8')) as Vectors;
function vector(id: string): Vectors['vectors'][number] {
  const found = GOLD.vectors.find((v) => v.id === id);
  if (found === undefined) throw new Error(`vecteur absent : ${id}`);
  return found;
}
const num = (v: Record<string, number | string>, key: string): number => {
  const x = v[key];
  if (typeof x !== 'number') throw new Error(`nombre attendu : ${key}`);
  return x;
};
const str = (v: Record<string, number | string>, key: string): string => {
  const x = v[key];
  if (typeof x !== 'string') throw new Error(`texte attendu : ${key}`);
  return x;
};

/** Paramètres lus des données de contenu datées, jamais recopiés ici. */
const LOI_PARAMS: Loi6921Params = { directorRateBps: ruleParam('late_base_bps').value, monthlyIncrementBps: ruleParam('late_increment_bps').value };
const CASH_PARAMS: CashParams = {
  capDayCents: ruleParam('cash_cap_day_cents').value,
  capMonthCents: ruleParam('cash_cap_month_cents').value,
  vatRateBps: ruleParam('vat_standard_bps').value,
  capBasis: 'TTC',
};
const RAS_PARAMS: RasParams = {
  reducedBps: ruleParam('ras_reduced_bps').value,
  fullBps: ruleParam('ras_full_bps').value,
  attestationMonths: ruleParam('ras_attestation_months').value,
  exclusionThresholdTtcCents: ruleParam('ras_exclusion_threshold_ttc_cents').value,
};

describe('saisie et arrondis entiers', () => {
  it('MAD -> centimes sans flottant', () => {
    expect(parseMadToCents('12 345,67')).toBe(1234567);
    expect(parseMadToCents('12345.6')).toBe(1234560);
    expect(parseMadToCents('4800')).toBe(480000);
    expect(parseMadToCents('0,01')).toBe(1);
    expect(parseMadToCents('1,234')).toBeNull();
    expect(parseMadToCents('-5')).toBeNull();
    expect(parseMadToCents('abc')).toBeNull();
    expect(parseMadToCents('')).toBeNull();
    expect(parseMadToCents('0,29')).toBe(29);
    expect(parseMadToCents('1234567890123456')).toBeNull();
  });

  it('pourcentage -> points de base', () => {
    expect(parsePercentToBps('2,75')).toBe(275);
    expect(parsePercentToBps('3.6 %')).toBe(360);
    expect(parsePercentToBps('20')).toBe(2000);
    expect(parsePercentToBps('2,755')).toBeNull();
    expect(parsePercentToBps('x')).toBeNull();
  });

  it('plafond à l’entier supérieur et demi supérieur, BigInt', () => {
    expect(ceilDivBigInt(0n, 7n)).toBe(0n);
    expect(ceilDivBigInt(1n, 7n)).toBe(1n);
    expect(ceilDivBigInt(7n, 7n)).toBe(1n);
    expect(ceilDivBigInt(8n, 7n)).toBe(2n);
    expect(proportionHalfUp(1234500, 360)).toBe(44442);
    expect(htFromTtc(500000, 2000)).toBe(416667);
    expect(htFromTtc(720000, 2000)).toBe(600000);
  });
});

describe('dates civiles entières', () => {
  it('analyse stricte, années bissextiles, ajout de jours et de mois', () => {
    expect(parseIsoDate('2026-02-29')).toBeNull();
    expect(parseIsoDate('2028-02-29')).not.toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('26-01-01')).toBeNull();
    const june1 = parseIsoDate('2026-06-01');
    if (june1 === null) throw new Error('date');
    expect(formatIsoDate(addDays(june1, 60))).toBe('2026-07-31');
    expect(formatIsoDate(addMonths({ year: 2026, month: 1, day: 31 }, 1))).toBe('2026-02-28');
    expect(formatIsoDate(addMonths({ year: 2026, month: 11, day: 15 }, 3))).toBe('2027-02-15');
    expect(diffDays({ year: 2026, month: 7, day: 31 }, { year: 2026, month: 9, day: 15 })).toBe(46);
    expect(diffDays({ year: 2028, month: 2, day: 28 }, { year: 2028, month: 3, day: 1 })).toBe(2);
  });

  it('aller-retour jour <-> date sur 1970-2200 par pas de 37 jours', () => {
    for (let d = 0; d < 80000; d += 37) {
      const start = parseIsoDate('1970-01-01');
      if (start === null) throw new Error('date');
      const date = addDays(start, d);
      const again = parseIsoDate(formatIsoDate(date));
      expect(again).toEqual(date);
      expect(diffDays(start, date)).toBe(d);
    }
  });
});

describe('VEC-CGI-02 : loi 69-21 (vecteur d’or)', () => {
  const v = vector('VEC-CGI-02');
  it('46 jours, 2 mois entamés, 360 bps, 44 500 centimes', () => {
    const out = computeLoi6921(
      {
        amountTtcCents: num(v.input, 'amount_ttc_cents'),
        deliveryDate: str(v.input, 'delivery_date'),
        legalDelayDays: num(v.input, 'legal_delay_days'),
        paymentDate: str(v.input, 'payment_date'),
      },
      { directorRateBps: num(v.input, 'director_rate_bps'), monthlyIncrementBps: num(v.input, 'monthly_increment_bps') },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result).toEqual({
      dueDate: str(v.expected, 'due_date'),
      delayDays: num(v.expected, 'delay_days'),
      startedMonths: num(v.expected, 'started_months'),
      rateBps: num(v.expected, 'rate_bps'),
      rawPenaltyCents: num(v.expected, 'raw_penalty_cents'),
      penaltyCents: num(v.expected, 'penalty_cents'),
    });
  });

  it('les paramètres datés du contenu redonnent le même résultat (275 + 85) et portent date et état', () => {
    const out = computeLoi6921({ amountTtcCents: 1234500, deliveryDate: '2026-06-01', legalDelayDays: ruleParam('late_legal_days').value, paymentDate: '2026-09-15' }, LOI_PARAMS);
    expect(out.ok && out.result.penaltyCents).toBe(44500);
    expect(ruleParam('late_base_bps')).toMatchObject({ as_of: GOLD.rule_date, state: 'NON RECOUPÉ' });
    expect(ruleParam('late_increment_bps').as_of).toBe(GOLD.rule_date);
  });

  it('le taux directeur est un paramètre : un autre taux change le résultat', () => {
    const base = { amountTtcCents: 1234500, deliveryDate: '2026-06-01', legalDelayDays: 60, paymentDate: '2026-09-15' };
    const out = computeLoi6921(base, { directorRateBps: 300, monthlyIncrementBps: 85 });
    expect(out.ok && out.result.rateBps).toBe(385);
    expect(out.ok && out.result.penaltyCents).toBe(47600);
  });

  it('mois entamés : limites calendaires', () => {
    const due = { year: 2026, month: 7, day: 31 };
    expect(startedMonthsBetween(due, { year: 2026, month: 7, day: 31 })).toBe(0);
    expect(startedMonthsBetween(due, { year: 2026, month: 8, day: 1 })).toBe(1);
    expect(startedMonthsBetween(due, { year: 2026, month: 8, day: 31 })).toBe(1);
    expect(startedMonthsBetween(due, { year: 2026, month: 9, day: 1 })).toBe(2);
    expect(startedMonthsBetween(due, { year: 2026, month: 9, day: 30 })).toBe(2);
    expect(startedMonthsBetween(due, { year: 2026, month: 10, day: 1 })).toBe(3);
    expect(startedMonthsBetween(due, { year: 2025, month: 1, day: 1 })).toBe(0);
  });

  it('taux par mois entamé : directeur + majoration x (mois - 1)', () => {
    expect(rateForStartedMonths(0, LOI_PARAMS)).toBe(0);
    expect(rateForStartedMonths(1, LOI_PARAMS)).toBe(275);
    expect(rateForStartedMonths(2, LOI_PARAMS)).toBe(360);
    expect(rateForStartedMonths(5, LOI_PARAMS)).toBe(615);
  });

  it('paiement à l’échéance ou avant : aucune pénalité ; entrées invalides refusées', () => {
    const base = { amountTtcCents: 1234500, deliveryDate: '2026-06-01', legalDelayDays: 60, paymentDate: '2026-07-31' };
    expect(computeLoi6921(base, LOI_PARAMS)).toMatchObject({ ok: true, result: { penaltyCents: 0, delayDays: 0, startedMonths: 0 } });
    expect(computeLoi6921({ ...base, amountTtcCents: 0 }, LOI_PARAMS)).toEqual({ ok: false, error: 'AMOUNT' });
    expect(computeLoi6921({ ...base, amountTtcCents: Number.NaN }, LOI_PARAMS)).toEqual({ ok: false, error: 'AMOUNT' });
    expect(computeLoi6921({ ...base, deliveryDate: '2026-02-30' }, LOI_PARAMS)).toEqual({ ok: false, error: 'DELIVERY_DATE' });
    expect(computeLoi6921({ ...base, paymentDate: 'x' }, LOI_PARAMS)).toEqual({ ok: false, error: 'PAYMENT_DATE' });
    expect(computeLoi6921({ ...base, legalDelayDays: -1 }, LOI_PARAMS)).toEqual({ ok: false, error: 'DELAY' });
    expect(computeLoi6921(base, { directorRateBps: -1, monthlyIncrementBps: 85 })).toEqual({ ok: false, error: 'RATE' });
  });

  it('propriété : pénalité multiple de 100 centimes, jamais inférieure au brut, supérieure de moins de 100 centimes', () => {
    for (let amount = 100; amount < 2_000_000; amount += 99_991) {
      for (const payment of ['2026-08-05', '2026-09-15', '2027-03-01']) {
        const out = computeLoi6921({ amountTtcCents: amount, deliveryDate: '2026-06-01', legalDelayDays: 60, paymentDate: payment }, LOI_PARAMS);
        if (!out.ok) throw new Error('calcul');
        const { penaltyCents, rawPenaltyCents, rateBps } = out.result;
        expect(Number.isInteger(penaltyCents)).toBe(true);
        expect(penaltyCents % 100).toBe(0);
        const exactNumerator = BigInt(amount) * BigInt(rateBps);
        expect(BigInt(penaltyCents) * 10000n >= exactNumerator).toBe(true);
        expect(BigInt(penaltyCents) * 10000n - exactNumerator < 100n * 10000n).toBe(true);
        expect(Math.abs(penaltyCents - rawPenaltyCents)).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('VEC-CGI-01 : plafond d’espèces (vecteur d’or)', () => {
  const v = vector('VEC-CGI-01');
  it('720 000 c TTC à 20 % : 416 667 déductibles, 183 333 réintégrés, 36 667 de TVA perdue', () => {
    const out = evaluateCashPayments(
      [{ date: str(v.input, 'date'), supplier: str(v.input, 'supplier'), amountTtcCents: num(v.input, 'ttc_cents') }],
      { capDayCents: num(v.input, 'cap_day_cents'), capMonthCents: num(v.input, 'cap_month_cents'), vatRateBps: num(v.input, 'vat_rate_bps'), capBasis: 'TTC' },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const line = out.lines[0];
    expect(line).toMatchObject({
      htCents: num(v.expected, 'ht_cents'),
      deductibleHtCents: num(v.expected, 'deductible_ht_cents'),
      deductibleVatCents: num(v.expected, 'deductible_vat_cents'),
      reintegratedHtCents: num(v.expected, 'reintegrated_ht_cents'),
      lostVatCents: num(v.expected, 'lost_vat_cents'),
      binding: 'DAY',
    });
    const l = line;
    if (l === undefined) throw new Error('ligne');
    expect(l.deductibleHtCents + l.deductibleVatCents + l.reintegratedHtCents + l.lostVatCents).toBe(720000);
    expect(out.entry.totalDebitCents).toBe(out.entry.totalCreditCents);
    expect(out.entry.totalCreditCents).toBe(720000);
  });

  it('paramètres datés du contenu : plafonds 500 000 c / jour et 5 000 000 c / mois, RECOUPÉ', () => {
    expect(ruleParam('cash_cap_day_cents')).toMatchObject({ value: 500000, state: 'RECOUPÉ', as_of: GOLD.rule_date });
    expect(ruleParam('cash_cap_month_cents')).toMatchObject({ value: 5000000, state: 'RECOUPÉ' });
  });

  it('écriture : débit = crédit, caisse 5161 et TVA 34552 citées, charge à renseigner', () => {
    const out = evaluateCashPayments([{ date: '2026-11-03', supplier: 'A', amountTtcCents: 720000 }], CASH_PARAMS);
    if (!out.ok) throw new Error('calcul');
    const byRole = new Map(out.entry.lines.map((l) => [l.role, l]));
    expect(byRole.get('CASH')).toMatchObject({ account: '5161', creditCents: 720000 });
    expect(byRole.get('VAT_RECOVERABLE')).toMatchObject({ account: '34552', debitCents: 83333 });
    expect(byRole.get('EXPENSE_DEDUCTIBLE')?.account).toBeNull();
    expect(byRole.get('EXPENSE_NON_DEDUCTIBLE')).toMatchObject({ debitCents: 183333 });
    expect(byRole.get('VAT_NON_RECOVERABLE')).toMatchObject({ debitCents: 36667 });
    const withAccount = evaluateCashPayments([{ date: '2026-11-03', supplier: 'A', amountTtcCents: 720000 }], CASH_PARAMS, '6111');
    if (!withAccount.ok) throw new Error('calcul');
    expect(withAccount.entry.lines.filter((l) => l.account === '6111')).toHaveLength(3);
  });

  it('paiement sous le plafond : rien à scinder', () => {
    const out = evaluateCashPayments([{ date: '2026-11-03', supplier: 'A', amountTtcCents: 500000 }], CASH_PARAMS);
    if (!out.ok) throw new Error('calcul');
    expect(out.lines[0]).toMatchObject({ excessTtcCents: 0, reintegratedHtCents: 0, lostVatCents: 0, binding: null });
    expect(out.totals.excessTtcCents).toBe(0);
  });

  it('cap_basis HT : le plafond s’applique au hors taxe', () => {
    const out = evaluateCashPayments([{ date: '2026-11-03', supplier: 'A', amountTtcCents: 720000 }], { ...CASH_PARAMS, capBasis: 'HT' });
    if (!out.ok) throw new Error('calcul');
    expect(out.lines[0]).toMatchObject({ deductibleHtCents: 500000, deductibleVatCents: 100000, allowedTtcCents: 600000, reintegratedHtCents: 100000, lostVatCents: 20000, excessTtcCents: 120000 });
  });

  it('cumul par jour et par fournisseur : deux fournisseurs distincts ne se cumulent pas', () => {
    const out = evaluateCashPayments(
      [
        { date: '2026-11-03', supplier: 'A', amountTtcCents: 300000 },
        { date: '2026-11-03', supplier: 'a ', amountTtcCents: 300000 },
        { date: '2026-11-03', supplier: 'B', amountTtcCents: 300000 },
      ],
      CASH_PARAMS,
    );
    if (!out.ok) throw new Error('calcul');
    expect(out.lines.map((l) => l.excessTtcCents)).toEqual([0, 100000, 0]);
    expect(out.lines[1]?.binding).toBe('DAY');
  });

  it('entrées invalides refusées avec la ligne fautive', () => {
    expect(evaluateCashPayments([], CASH_PARAMS)).toEqual({ ok: false, error: 'EMPTY' });
    expect(evaluateCashPayments([{ date: '2026-02-30', supplier: 'A', amountTtcCents: 100 }], CASH_PARAMS)).toEqual({ ok: false, error: 'DATE', inputIndex: 0 });
    expect(evaluateCashPayments([{ date: '2026-02-03', supplier: 'A', amountTtcCents: 0 }], CASH_PARAMS)).toEqual({ ok: false, error: 'AMOUNT', inputIndex: 0 });
    expect(evaluateCashPayments([{ date: '2026-02-03', supplier: 'A', amountTtcCents: 5 }], { ...CASH_PARAMS, capDayCents: -1 })).toEqual({ ok: false, error: 'PARAMS' });
  });
});

describe('D-20 : cumul mensuel, onze factures de 4 800 MAD TTC', () => {
  const v = vector('D-20');
  const payments: CashPayment[] = Array.from({ length: num(v.input, 'invoices') }, (_, i) => ({
    date: `2026-11-${String(i + 1).padStart(2, '0')}`,
    supplier: 'Fournisseur A',
    amountTtcCents: num(v.input, 'ttc_cents_each'),
  }));

  it('franchissement à la onzième, excédent de 2 800 MAD TTC scindé', () => {
    const out = evaluateCashPayments(payments, CASH_PARAMS);
    if (!out.ok) throw new Error('calcul');
    expect(out.lines.slice(0, 10).every((l) => l.excessTtcCents === 0 && l.binding === null)).toBe(true);
    expect(out.lines[9]?.monthCumulCents).toBe(num(v.expected, 'cumul_after_10_cents'));
    const eleventh = out.lines[10];
    expect(eleventh).toMatchObject({
      allowedTtcCents: num(v.expected, 'eleventh_allowed_ttc_cents'),
      excessTtcCents: num(v.expected, 'eleventh_excess_ttc_cents'),
      reintegratedHtCents: num(v.expected, 'eleventh_reintegrated_ht_cents'),
      lostVatCents: num(v.expected, 'eleventh_lost_vat_cents'),
      binding: 'MONTH',
    });
    expect(out.lines.findIndex((l) => l.excessTtcCents > 0) + 1).toBe(num(v.expected, 'crossing_invoice_rank'));
    expect(out.totals.excessTtcCents).toBe(280000);
    expect(out.entry.totalDebitCents).toBe(out.entry.totalCreditCents);
    expect(out.entry.totalCreditCents).toBe(5280000);
  });

  it('dix factures ne franchissent pas le plafond mensuel (D-20 : 48 000 MAD)', () => {
    const out = evaluateCashPayments(payments.slice(0, 10), CASH_PARAMS);
    if (!out.ok) throw new Error('calcul');
    expect(out.totals.excessTtcCents).toBe(0);
  });

  it('l’ordre de saisie ne change pas le résultat (tri par date)', () => {
    const shuffled = [...payments].reverse();
    const out = evaluateCashPayments(shuffled, CASH_PARAMS);
    if (!out.ok) throw new Error('calcul');
    expect(out.totals.excessTtcCents).toBe(280000);
    expect(out.lines.find((l) => l.excessTtcCents > 0)?.date).toBe('2026-11-11');
  });

  it('propriété : somme des quatre parts = TTC, débit = crédit, aucun flottant, pour des montants variés', () => {
    for (const vat of [2000, 1000, 0]) {
      for (let ttc = 100; ttc < 3_000_000; ttc += 217_117) {
        const out = evaluateCashPayments(
          [
            { date: '2026-11-03', supplier: 'A', amountTtcCents: ttc },
            { date: '2026-11-04', supplier: 'A', amountTtcCents: ttc },
            { date: '2026-11-05', supplier: 'A', amountTtcCents: ttc },
          ],
          { ...CASH_PARAMS, vatRateBps: vat },
        );
        if (!out.ok) throw new Error('calcul');
        for (const l of out.lines) {
          expect(l.deductibleHtCents + l.deductibleVatCents + l.reintegratedHtCents + l.lostVatCents).toBe(l.ttcCents);
          expect(l.allowedTtcCents + l.excessTtcCents).toBe(l.ttcCents);
          for (const n of Object.values(l)) if (typeof n === 'number') expect(Number.isInteger(n)).toBe(true);
        }
        expect(out.entry.totalDebitCents).toBe(out.entry.totalCreditCents);
      }
    }
  });
});

describe('VEC-CGI-03 : RAS-TVA art. 117 (vecteurs d’or)', () => {
  for (const id of ['VEC-CGI-03-A', 'VEC-CGI-03-B']) {
    it(`${id}`, () => {
      const v = vector(id);
      const out = computeRasTva(
        { htCents: num(v.input, 'ht_cents'), vatRateBps: num(v.input, 'vat_rate_bps'), paymentDate: str(v.input, 'payment_date'), attestationDate: str(v.input, 'attestation_date') },
        RAS_PARAMS,
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result).toMatchObject({
        vatCents: num(v.expected, 'vat_cents'),
        ttcCents: num(v.expected, 'ttc_cents'),
        rateBps: num(v.expected, 'rate_bps'),
        withheldCents: num(v.expected, 'withheld_cents'),
        netPaidCents: num(v.expected, 'net_paid_cents'),
      });
      expect(out.result.entry.totalDebitCents).toBe(out.result.entry.totalCreditCents);
    });
  }

  it('attestation : valide / expirée / absente, bornes de six mois', () => {
    const base = { htCents: 1000000, vatRateBps: 2000 };
    const run = (paymentDate: string, attestationDate: string | null) => computeRasTva({ ...base, paymentDate, attestationDate }, RAS_PARAMS);
    expect(run('2026-11-14', '2026-05-15')).toMatchObject({ ok: true, result: { attestation: 'VALID', rateBps: 7500 } });
    expect(run('2026-11-15', '2026-05-15')).toMatchObject({ ok: true, result: { attestation: 'EXPIRED', rateBps: 10000 } });
    expect(run('2026-11-15', null)).toMatchObject({ ok: true, result: { attestation: 'NONE', rateBps: 10000, withheldCents: 200000 } });
    expect(run('2026-11-15', '2026-11-15')).toMatchObject({ ok: true, result: { attestation: 'VALID' } });
    expect(run('2026-11-15', '2026-11-16')).toEqual({ ok: false, error: 'ATTESTATION_AFTER_PAYMENT' });
    expect(run('2026-11-15', '2026-13-01')).toEqual({ ok: false, error: 'ATTESTATION_DATE' });
    expect(run('15/11/2026', null)).toEqual({ ok: false, error: 'PAYMENT_DATE' });
  });

  it('seuil d’exclusion : pas de retenue à 5 000 MAD TTC pile, retenue au-dessus', () => {
    const at = computeRasTva({ htCents: 416667, vatRateBps: 2000, paymentDate: '2026-11-15', attestationDate: null }, RAS_PARAMS);
    if (!at.ok) throw new Error('calcul');
    expect(at.result.ttcCents).toBe(500000);
    expect(at.result.aboveThreshold).toBe(false);
    expect(at.result.withheldCents).toBe(0);
    const above = computeRasTva({ htCents: 416668, vatRateBps: 2000, paymentDate: '2026-11-15', attestationDate: null }, RAS_PARAMS);
    expect(above.ok && above.result.aboveThreshold).toBe(true);
  });

  it('écriture : fournisseur 4411 au débit, comptes de règlement et de retenue à renseigner ou saisis, équilibrée', () => {
    const out = computeRasTva({ htCents: 1000000, vatRateBps: 2000, paymentDate: '2026-11-15', attestationDate: '2026-07-01' }, RAS_PARAMS, { payment: '5141', withheldDue: '4457' });
    if (!out.ok) throw new Error('calcul');
    expect(out.result.entry.lines).toEqual([
      { role: 'SUPPLIER', account: '4411', debitCents: 1200000, creditCents: 0 },
      { role: 'PAYMENT', account: '5141', debitCents: 0, creditCents: 1050000 },
      { role: 'VAT_WITHHELD_DUE', account: '4457', debitCents: 0, creditCents: 150000 },
    ]);
    const blank = computeRasTva({ htCents: 1000000, vatRateBps: 2000, paymentDate: '2026-11-15', attestationDate: null }, RAS_PARAMS);
    expect(blank.ok && blank.result.entry.lines.filter((l) => l.account === null)).toHaveLength(2);
  });

  it('paramètres datés : 7 500 / 10 000 bps, 6 mois, NON RECOUPÉ', () => {
    expect(ruleParam('ras_reduced_bps')).toMatchObject({ value: 7500, state: 'NON RECOUPÉ', as_of: GOLD.rule_date });
    expect(ruleParam('ras_full_bps')).toMatchObject({ value: 10000, state: 'NON RECOUPÉ' });
    expect(ruleParam('ras_attestation_months').value).toBe(6);
  });

  it('propriété : retenue + net = TTC, retenue <= TVA, tout entier', () => {
    for (let ht = 100000; ht < 9_000_000; ht += 333_333) {
      for (const attestationDate of [null, '2026-09-01', '2026-01-01']) {
        const out = computeRasTva({ htCents: ht, vatRateBps: 2000, paymentDate: '2026-11-15', attestationDate }, RAS_PARAMS);
        if (!out.ok) throw new Error('calcul');
        const r = out.result;
        expect(r.withheldCents + r.netPaidCents).toBe(r.ttcCents);
        expect(r.withheldCents).toBeLessThanOrEqual(r.vatCents);
        expect(Number.isInteger(r.withheldCents)).toBe(true);
        expect(out.result.entry.totalDebitCents).toBe(out.result.entry.totalCreditCents);
      }
    }
  });

  it('paramètres incohérents refusés', () => {
    expect(computeRasTva({ htCents: 1, vatRateBps: 2000, paymentDate: '2026-11-15', attestationDate: null }, { ...RAS_PARAMS, fullBps: 20000 })).toEqual({ ok: false, error: 'PARAMS' });
    expect(computeRasTva({ htCents: 0, vatRateBps: 2000, paymentDate: '2026-11-15', attestationDate: null }, RAS_PARAMS)).toEqual({ ok: false, error: 'AMOUNT' });
  });
});

describe('écriture comptable : équilibre et comptes cités', () => {
  it('refuse une écriture déséquilibrée ou une ligne mixte', () => {
    expect(() => buildEntry([{ role: 'CASH', account: '5161', debitCents: 0, creditCents: 100 }, { role: 'SUPPLIER', account: '4411', debitCents: 99, creditCents: 0 }])).toThrow(RangeError);
    expect(() => buildEntry([{ role: 'CASH', account: '5161', debitCents: 5, creditCents: 5 }])).toThrow(RangeError);
    expect(() => buildEntry([{ role: 'CASH', account: '5161', debitCents: Number.NaN, creditCents: 0 }])).toThrow(RangeError);
  });

  it('seuls 5161, 4411 et 34552 sont préremplis, avec leur référence de spécification', () => {
    expect(Object.values(CITED_ACCOUNTS).map((c) => c?.account).sort()).toEqual(['34552', '4411', '5161']);
    for (const c of Object.values(CITED_ACCOUNTS)) expect(c?.specRef.length).toBeGreaterThan(5);
  });

  it('saisie de compte : 3 à 8 chiffres sinon à renseigner', () => {
    expect(cleanAccountInput(' 6111 ')).toBe('6111');
    expect(cleanAccountInput('61')).toBeNull();
    expect(cleanAccountInput('61a1')).toBeNull();
  });
});

describe('aucun flottant dans les modules d’outils', () => {
  it('pas de parseFloat, Math.round, toFixed ni division flottante sur des montants', () => {
    for (const file of ['amounts', 'loi-69-21', 'cash-cap', 'ras-tva', 'ledger', 'ice', 'ice-table']) {
      const src = readFileSync(new URL(`../src/tools/${file}.ts`, import.meta.url), 'utf8');
      expect(src, file).not.toMatch(/parseFloat|Math\.round|toFixed|Number\(\s*['"`]\d+[.,]\d/);
    }
  });
});

describe('saisie des règlements en espèces', () => {
  it('lit date ; fournisseur ; montant, tolère tabulations, lignes vides, virgule décimale', async () => {
    const { parseCashLines } = await import('../src/tools/cash-input.ts');
    const out = parseCashLines('2026-11-03;Atlas;7 200,50\n\n2026-11-04\tBeta\t10');
    expect(out).toEqual({
      ok: true,
      payments: [
        { date: '2026-11-03', supplier: 'Atlas', amountTtcCents: 720050 },
        { date: '2026-11-04', supplier: 'Beta', amountTtcCents: 1000 },
      ],
    });
  });

  it('refuse avec le numéro de ligne : format, date, montant, vide', async () => {
    const { parseCashLines } = await import('../src/tools/cash-input.ts');
    expect(parseCashLines('')).toEqual({ ok: false, error: 'EMPTY' });
    expect(parseCashLines('2026-11-03;A')).toEqual({ ok: false, error: 'FORMAT', lineNumber: 1 });
    expect(parseCashLines('2026-11-03;A;5\n03/11/2026;A;5')).toEqual({ ok: false, error: 'DATE', lineNumber: 2 });
    expect(parseCashLines('2026-11-03;A;0')).toEqual({ ok: false, error: 'AMOUNT', lineNumber: 1 });
    expect(parseCashLines('2026-11-03;A;1,234')).toEqual({ ok: false, error: 'AMOUNT', lineNumber: 1 });
  });

  it('exemple D-20 : onze lignes qui donnent l’excédent de 2 800 MAD TTC', async () => {
    const { parseCashLines, buildMonthlyExample } = await import('../src/tools/cash-input.ts');
    const parsed = parseCashLines(buildMonthlyExample('2026-11-01', 'Fournisseur A', 11, '4800'));
    if (!parsed.ok) throw new Error('saisie');
    const out = evaluateCashPayments(parsed.payments, CASH_PARAMS);
    expect(out.ok && out.totals.excessTtcCents).toBe(280000);
  });
});

describe('pré-remplissage d’un taux', () => {
  it('points de base -> champ de pourcentage', async () => {
    const { formatBpsAsPercentInput } = await import('../src/tools/amounts.ts');
    expect(formatBpsAsPercentInput(275)).toBe('2,75');
    expect(formatBpsAsPercentInput(85)).toBe('0,85');
    expect(formatBpsAsPercentInput(0)).toBe('0,00');
    expect(formatBpsAsPercentInput(2000)).toBe('20,00');
    expect(() => formatBpsAsPercentInput(-1)).toThrow(RangeError);
  });
});
