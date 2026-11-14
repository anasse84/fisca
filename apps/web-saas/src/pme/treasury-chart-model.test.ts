import { describe, expect, it } from 'vitest';
import { buildChartGeometry, summarizeForecast } from './treasury-chart-model.ts';
import type { TreasuryPoint } from './ports.ts';

const pts: readonly TreasuryPoint[] = [
  { date: '2027-01-01', settledCents: 100000, forecastCents: null, vatProvisionCents: 0 },
  { date: '2027-01-02', settledCents: 150000, forecastCents: 150000, vatProvisionCents: 20000 },
  { date: '2027-01-03', settledCents: null, forecastCents: 50000, vatProvisionCents: 40000 },
  { date: '2027-01-04', settledCents: null, forecastCents: -50000, vatProvisionCents: 40000 },
];

describe('buildChartGeometry : coordonnées entières, aucun flottant', () => {
  const g = buildChartGeometry(pts, { width: 300, height: 120, padding: 10 });
  it('échelle x entière et monotone, première et dernière abscisses aux bords utiles', () => {
    expect(g.xs).toEqual([10, 103, 197, 290]);
  });
  it('inclut le zéro dans l’échelle et place les extrêmes en haut/bas', () => {
    expect(g.yOf(150000)).toBe(10);
    expect(g.yOf(-50000)).toBe(110);
    expect(g.zeroY).toBe(g.yOf(0));
    expect(Number.isInteger(g.zeroY)).toBe(true);
  });
  it('trace en trait plein, pointillé et provision ; les trous coupent le tracé', () => {
    expect(g.settledPath.startsWith('M10 ')).toBe(true);
    expect(g.settledPath.split('M').length - 1).toBe(1);
    expect(g.forecastPath.startsWith('M103 ')).toBe(true);
    expect(g.vatPath.split('M').length - 1).toBe(1);
    expect(g.settledPath).not.toMatch(/\d\.\d|NaN/);
    expect(g.forecastPath).not.toMatch(/\d\.\d|NaN/);
  });
  it('graduations entières avec valeurs en centimes entiers', () => {
    expect(g.ticks.length).toBeGreaterThanOrEqual(3);
    for (const t of g.ticks) {
      expect(Number.isInteger(t.valueCents)).toBe(true);
      expect(Number.isInteger(t.y)).toBe(true);
    }
    expect(g.ticks[0]?.valueCents).toBe(-50000);
    expect(g.ticks[g.ticks.length - 1]?.valueCents).toBe(150000);
  });
  it('série constante : pas de division par zéro', () => {
    const flat = buildChartGeometry([{ date: 'a', settledCents: 5, forecastCents: null, vatProvisionCents: null }, { date: 'b', settledCents: 5, forecastCents: null, vatProvisionCents: null }], { width: 100, height: 50, padding: 5 });
    expect(Number.isInteger(flat.yOf(5))).toBe(true);
  });
  it('un seul point : tracé réduit à un point sans erreur', () => {
    const one = buildChartGeometry([{ date: 'a', settledCents: 5, forecastCents: null, vatProvisionCents: null }], { width: 100, height: 50, padding: 5 });
    expect(one.xs).toEqual([5]);
  });
});

describe('summarizeForecast', () => {
  it('trouve plus bas et plus haut sur toutes les séries, avec leurs dates', () => {
    const s = summarizeForecast(pts);
    expect(s).toEqual({ from: '2027-01-01', to: '2027-01-04', minCents: -50000, minDate: '2027-01-04', maxCents: 150000, maxDate: '2027-01-02' });
  });
  it('liste vide → null', () => {
    expect(summarizeForecast([])).toBeNull();
  });
});
