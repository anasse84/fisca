import { divRoundHalfUpBigInt } from '@fisca/shared-types';
import type { TreasuryPoint } from './ports.ts';

export interface ChartBox {
  readonly width: number;
  readonly height: number;
  readonly padding: number;
}

export interface ChartTick {
  readonly valueCents: number;
  readonly y: number;
}

export interface ChartGeometry {
  readonly xs: readonly number[];
  readonly yOf: (valueCents: number) => number;
  readonly zeroY: number;
  readonly settledPath: string;
  readonly forecastPath: string;
  readonly vatPath: string;
  readonly ticks: readonly ChartTick[];
}

const TICK_COUNT = 4;

/**
 * Géométrie du graphique en ENTIERS : les centimes sont mis à l'échelle en pixels par `divRoundHalfUpBigInt`
 * (aucune division flottante sur un montant). Le zéro est toujours dans l'échelle. Une valeur `null` coupe le tracé.
 */
export function buildChartGeometry(points: readonly TreasuryPoint[], box: ChartBox): ChartGeometry {
  const plotW = BigInt(box.width - 2 * box.padding);
  const plotH = BigInt(box.height - 2 * box.padding);
  const pad = BigInt(box.padding);
  const count = points.length;
  const xs = points.map((_, i) => (count <= 1 ? box.padding : Number(pad + divRoundHalfUpBigInt(BigInt(i) * plotW, BigInt(count - 1)))));

  const values: bigint[] = [0n];
  for (const p of points) {
    for (const v of [p.settledCents, p.forecastCents, p.vatProvisionCents]) {
      if (v !== null) values.push(BigInt(v));
    }
  }
  const lo = values.reduce((a, b) => (b < a ? b : a));
  const hi = values.reduce((a, b) => (b > a ? b : a));
  const span = hi - lo === 0n ? 1n : hi - lo;
  const yBig = (v: bigint): number => Number(pad + divRoundHalfUpBigInt((hi - v) * plotH, span));
  const yOf = (valueCents: number): number => yBig(BigInt(valueCents));

  const pathOf = (pick: (p: TreasuryPoint) => number | null): string => {
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      const v = pick(p);
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${xs[i] ?? 0} ${yOf(v)}`;
      pen = true;
    });
    return d;
  };

  const ticks: ChartTick[] = [];
  for (let k = 0; k < TICK_COUNT; k += 1) {
    const value = lo + divRoundHalfUpBigInt(BigInt(k) * span, BigInt(TICK_COUNT - 1));
    ticks.push({ valueCents: Number(value), y: yBig(value) });
  }

  return {
    xs,
    yOf,
    zeroY: yBig(0n),
    settledPath: pathOf((p) => p.settledCents),
    forecastPath: pathOf((p) => p.forecastCents),
    vatPath: pathOf((p) => p.vatProvisionCents),
    ticks,
  };
}

export interface ForecastSummary {
  readonly from: string;
  readonly to: string;
  readonly minCents: number;
  readonly minDate: string;
  readonly maxCents: number;
  readonly maxDate: string;
}

/** Plus bas et plus haut points, toutes séries confondues (première occurrence en cas d'égalité). */
export function summarizeForecast(points: readonly TreasuryPoint[]): ForecastSummary | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return null;
  let min: { v: number; date: string } | null = null;
  let max: { v: number; date: string } | null = null;
  for (const p of points) {
    for (const v of [p.settledCents, p.forecastCents, p.vatProvisionCents]) {
      if (v === null) continue;
      if (min === null || v < min.v) min = { v, date: p.date };
      if (max === null || v > max.v) max = { v, date: p.date };
    }
  }
  if (min === null || max === null) return null;
  return { from: first.date, to: last.date, minCents: min.v, minDate: min.date, maxCents: max.v, maxDate: max.date };
}
