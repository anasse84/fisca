import { describe, expect, it } from 'vitest';
import {
  ADDITIONAL_SEAT_MONTHLY_HT_CENTS,
  ANNUAL_BILLED_MONTHS,
  ENTERPRISE_CONTRACTS,
  FIDUCIARY_METER,
  PACK_MOWAKABA_CABINET,
  PME_COMPARISON,
  POS_MODULES,
  PRICING_CATALOG_OFFERS,
  PRICING_FAMILY_ORDER,
  PRICING_PLANS,
  TRIAL_DAYS,
  catalogOffersOfFamily,
  discountedDossierCents,
  getEnterpriseContract,
  getPosModule,
} from '../src/content/pricing.ts';
import { applyDiscountBps, formatBpsPercent, formatCentsMad } from '../src/lib/money.ts';

function allNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allNumbers(v, out));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach((v) => allNumbers(v, out));
  return out;
}

describe('grille : 4 familles (Doc_03 S02 à S06)', () => {
  it('familles dans l’ordre PME, POS, OEC, Corporate/Souverain', () => {
    expect(PRICING_FAMILY_ORDER).toEqual(['PME', 'POS', 'OEC', 'CORPORATE_SOUVERAIN']);
    for (const family of PRICING_FAMILY_ORDER) {
      expect(catalogOffersOfFamily(family).length).toBeGreaterThan(0);
    }
  });

  it('PME : Solo, Essentiel, Croissance et Pack TPME Mowakaba, en centimes', () => {
    const pme = catalogOffersOfFamily('PME');
    expect(pme.map((o) => o.code)).toEqual(['SOLO_AE', 'ESSENTIEL_TPE', 'CROISSANCE_PME', 'PACK_MOWAKABA_TPME']);
    expect(pme.map((o) => o.monthly_ht_cents)).toEqual([12900, 39000, 89000, null]);
    expect(pme.map((o) => o.annual_ht_cents)).toEqual([129000, 390000, 890000, null]);
    expect(pme[3]?.one_off_ht_cents).toBe(1800000);
    expect(TRIAL_DAYS).toBe(14);
    expect(ANNUAL_BILLED_MONTHS).toBe(10);
    expect(ADDITIONAL_SEAT_MONTHLY_HT_CENTS).toBe(4900);
  });

  it('POS : 4 modules de Doc_03 S03', () => {
    expect(POS_MODULES.map((m) => [m.code, m.monthly_ht_cents, m.annual_ht_cents])).toEqual([
      ['POS_BRIDGE', 0, 0],
      ['POS_TACTILE_INC', 0, 0],
      ['POS_TACTILE_STD', 14900, 149000],
      ['POS_TACTILE_FLEET', 9900, 99000],
    ]);
    expect(getPosModule('POS_TACTILE_FLEET').condition).toBe('FROM_10_TERMINALS_OR_OEC_PARTNER');
    for (const m of POS_MODULES) expect(m.annual_ht_cents).toBe(m.monthly_ht_cents * ANNUAL_BILLED_MONTHS);
  });

  it('OEC : socle 49 000 c, dossiers 6 900 / 14 900 / 24 900, remise 1 500 bps dès 100 dossiers, pack cabinet', () => {
    expect(FIDUCIARY_METER.base.monthly_ht_cents).toBe(49000);
    expect(FIDUCIARY_METER.dossierTiers.map((t) => t.monthly_ht_cents)).toEqual([6900, 14900, 24900]);
    expect(FIDUCIARY_METER.volumeDiscount).toEqual({ minActiveDossiers: 100, discount_bps: 1500 });
    expect(PACK_MOWAKABA_CABINET.one_off_ht_cents).toBe(4500000);
    expect(PACK_MOWAKABA_CABINET.prepaidDossierWallet_ht_cents).toBe(2500000);
  });

  it('OEC : prix remisés exacts de Doc_03 S04 (58,65 / 126,65 / 211,65 MAD)', () => {
    expect(FIDUCIARY_METER.dossierTiers.map((t) => discountedDossierCents(t))).toEqual([5865, 12665, 21165]);
    expect(formatCentsMad(5865)).toBe('58,65 MAD');
  });

  it('Corporate : 58 000 MAD/an, 5 ICE ; Souverain : 140 000 MAD/an, 10 ICE, résidence Maroc', () => {
    const corp = getEnterpriseContract('ENT_CORPORATE');
    const sov = getEnterpriseContract('ENT_SOUVERAIN');
    expect([corp.annual_ht_cents, corp.includedIce, corp.additionalIceAnnual_ht_cents]).toEqual([5800000, 5, 750000]);
    expect([sov.annual_ht_cents, sov.includedIce, sov.additionalIceAnnual_ht_cents]).toEqual([14000000, 10, 1000000]);
    expect(corp.dataResidencyMoroccoOnly).toBe(false);
    expect(sov.dataResidencyMoroccoOnly).toBe(true);
    expect(ENTERPRISE_CONTRACTS).toHaveLength(2);
  });

  it('comparatif PME : paliers cumulatifs', () => {
    expect(PME_COMPARISON.map((c) => c.includedSeats)).toEqual([1, 5, 15]);
    expect(PME_COMPARISON.map((c) => c.pos)).toEqual(['NONE', 'POS_BRIDGE', 'POS_TACTILE_1']);
  });

  it('aucun flottant : tout nombre de la grille est un entier sûr', () => {
    const numbers = [
      ...allNumbers(PRICING_PLANS),
      ...allNumbers(POS_MODULES),
      ...allNumbers(FIDUCIARY_METER),
      ...allNumbers(PACK_MOWAKABA_CABINET),
      ...allNumbers(ENTERPRISE_CONTRACTS),
      ...allNumbers(PRICING_CATALOG_OFFERS),
      ...allNumbers(PME_COMPARISON),
    ];
    expect(numbers.length).toBeGreaterThan(50);
    for (const n of numbers) expect(Number.isSafeInteger(n)).toBe(true);
  });

  it('aucune règle fiscale : pas de champ TVA ni TTC dans la grille', () => {
    const json = JSON.stringify([PRICING_CATALOG_OFFERS, POS_MODULES, FIDUCIARY_METER, ENTERPRISE_CONTRACTS]);
    expect(json).not.toMatch(/ttc|vat|tva_rate/i);
  });

  it('catalogue plat : codes uniques, cohérent avec les familles', () => {
    const codes = PRICING_CATALOG_OFFERS.map((o) => o.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('PACK_MOWAKABA_CABINET');
    expect(codes).toContain('ENT_SOUVERAIN');
  });
});

describe('money : remise en bps, entiers seulement', () => {
  it('applyDiscountBps', () => {
    expect(applyDiscountBps(6900, 1500)).toBe(5865);
    expect(applyDiscountBps(14900, 1500)).toBe(12665);
    expect(applyDiscountBps(24900, 1500)).toBe(21165);
    expect(applyDiscountBps(1001, 1500)).toBe(851);
    expect(applyDiscountBps(5, 5000)).toBe(3);
    expect(applyDiscountBps(1234, 0)).toBe(1234);
    expect(applyDiscountBps(1234, 10000)).toBe(0);
  });
  it('applyDiscountBps refuse non entier ou taux hors bornes', () => {
    expect(() => applyDiscountBps(1.5, 100)).toThrow(RangeError);
    expect(() => applyDiscountBps(100, 10001)).toThrow(RangeError);
    expect(() => applyDiscountBps(100, -1)).toThrow(RangeError);
    expect(() => applyDiscountBps(100, 1.5)).toThrow(RangeError);
  });
  it('formatBpsPercent (affichage)', () => {
    expect(formatBpsPercent(1500)).toBe('15 %');
    expect(formatBpsPercent(25)).toBe('0,25 %');
    expect(formatBpsPercent(1250)).toBe('12,50 %');
    expect(() => formatBpsPercent(0.5)).toThrow(RangeError);
  });
});
