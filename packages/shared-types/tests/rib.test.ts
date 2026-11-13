import { describe, expect, it } from 'vitest';
import {
  MoroccanRib24Schema,
  computeMoroccanRibKey2,
  isValidRibChecksum,
  validateMoroccanRib24,
} from '../src/index.ts';

/** Reste modulo 97 par la méthode de Horner chiffre à chiffre : indépendant de BigInt utilisé par l'implémentation. */
function hornerMod97(digits: string): number {
  let remainder = 0;
  for (const char of digits) {
    remainder = (remainder * 10 + Number(char)) % 97;
  }
  return remainder;
}

/** Clé attendue recalculée sans BigInt : (base22 × 100) mod 97 = Horner sur base22 suivie de « 00 ». */
function expectedKey(base22: string): number {
  return 97 - hornerMod97(`${base22}00`);
}

/** Contrôle ISO 13616 : RIB + « MA » (M=22, A=10) + chiffres de contrôle, reste attendu 1. */
function ibanIso13616Remainder(rib24: string, checkDigits: string): number {
  return hornerMod97(`${rib24}2210${checkDigits}`);
}

function ibanCheckDigits(rib24: string): string {
  return String(98 - hornerMod97(`${rib24}221000`)).padStart(2, '0');
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

const COVID_BASE = '0018100078000201106202';
const SEISME_BASE = '0018100078000201106203';
const KEY_97_BASE = '1000000000000000000046';

describe('RIB marocain : vecteurs Bank Al-Maghrib cités par le propriétaire', () => {
  // RECOUPÉ arithmétiquement ; origine : document du propriétaire ; NON RECOUPÉ auprès de Bank Al-Maghrib.
  const vectors = [
    { label: 'Fonds Covid-19', rib: '001810007800020110620221', base: COVID_BASE, key: 21 },
    { label: 'Fonds 126 Séisme', rib: '001810007800020110620318', base: SEISME_BASE, key: 18 },
  ];
  for (const vector of vectors) {
    it(`${vector.label} : clé ${vector.key} recalculée, multiple de 97, valide`, () => {
      expect(vector.rib).toBe(`${vector.base}${vector.key}`);
      expect(expectedKey(vector.base)).toBe(vector.key);
      expect(hornerMod97(vector.rib)).toBe(0);
      expect(computeMoroccanRibKey2(vector.base)).toBe(twoDigits(vector.key));
      const parsed = validateMoroccanRib24(vector.rib);
      expect(parsed).toEqual({
        valid: true,
        canonicalRib24: vector.rib,
        canonicalIbanMa28: `MA64${vector.rib}`,
        bankCode3: '001',
        localityCode3: '810',
        accountNumber16: vector.base.slice(6, 22),
        ribKey2: twoDigits(vector.key),
      });
      expect(isValidRibChecksum(vector.rib)).toBe(true);
    });
  }
});

describe('RIB marocain : chiffres de contrôle IBAN MA = 64 (ISO 13616)', () => {
  it('221000 mod 97 = 34 et 98 − 34 = 64', () => {
    expect(hornerMod97('221000')).toBe(34);
    expect(98 - 34).toBe(64);
  });

  it('tout RIB valide produit 64 et un reste ISO 13616 de 1', () => {
    for (const rib of ['001810007800020110620221', '001810007800020110620318', `${KEY_97_BASE}97`]) {
      expect(ibanCheckDigits(rib)).toBe('64');
      expect(ibanIso13616Remainder(rib, '64')).toBe(1);
    }
  });

  it('accepte MA64 + 24 chiffres et renvoie le RIB et l’IBAN canoniques', () => {
    const parsed = validateMoroccanRib24('MA64001810007800020110620221');
    expect(parsed.valid).toBe(true);
    if (parsed.valid) {
      expect(parsed.canonicalRib24).toBe('001810007800020110620221');
      expect(parsed.canonicalIbanMa28).toBe('MA64001810007800020110620221');
    }
  });

  it('tolère espaces, points, tirets et underscores', () => {
    for (const raw of [
      '001 810 0078000201106202 21',
      '001.810.0078000201106202.21',
      '001-810-0078000201106202-21',
      '001_810_0078000201106202_21',
      ' 0018100078000201106202 21 ',
      'MA64 0018 1000 7800 0201 1062 0221',
      'MA64-0018-1000-7800-0201-1062-0221',
    ]) {
      const parsed = validateMoroccanRib24(raw);
      expect(parsed.valid, raw).toBe(true);
      if (parsed.valid) {
        expect(parsed.canonicalRib24).toBe('001810007800020110620221');
      }
    }
  });

  it('refuse MA65…, MA00…, MA99… (chiffres de contrôle ≠ 64)', () => {
    for (const check of ['65', '00', '99', '63', '01']) {
      expect(validateMoroccanRib24(`MA${check}001810007800020110620221`)).toEqual({
        valid: false,
        errorCode: 'RIB_INVALID_MA_IBAN_CHECK_DIGITS',
      });
    }
  });

  it('refuse un IBAN MA aux longueurs ou caractères erronés', () => {
    for (const raw of [
      'MA6400181000780002011062022',
      'MA640018100078000201106202210',
      'MA64001810007800020110620A21',
      'MAXX001810007800020110620221',
      'MA',
      'MA64',
      'FR64001810007800020110620221',
    ]) {
      expect(validateMoroccanRib24(raw), raw).toEqual({ valid: false, errorCode: 'RIB_INVALID_FORMAT_OR_LENGTH' });
    }
  });

  it('est strict sur la casse : « ma64… » minuscule est refusé', () => {
    expect(validateMoroccanRib24('ma64001810007800020110620221')).toEqual({
      valid: false,
      errorCode: 'RIB_INVALID_FORMAT_OR_LENGTH',
    });
  });
});

describe('RIB marocain : clé 97 et clés hors plage', () => {
  it('base divisible par 97 → clé 97 (recalculé indépendamment)', () => {
    expect(hornerMod97(KEY_97_BASE)).toBe(0);
    expect(expectedKey(KEY_97_BASE)).toBe(97);
    expect(computeMoroccanRibKey2(KEY_97_BASE)).toBe('97');
    const parsed = validateMoroccanRib24(`${KEY_97_BASE}97`);
    expect(parsed.valid).toBe(true);
    expect(hornerMod97(`${KEY_97_BASE}97`)).toBe(0);
  });

  it('refuse les clés 00, 98 et 99 même quand N mod 97 = 0 pour la clé 00', () => {
    expect(hornerMod97(`${KEY_97_BASE}00`)).toBe(0); // 00 passerait le seul contrôle mod 97
    expect(validateMoroccanRib24(`${KEY_97_BASE}00`)).toEqual({ valid: false, errorCode: 'RIB_KEY_OUT_OF_RANGE' });
    expect(validateMoroccanRib24(`${KEY_97_BASE}98`)).toEqual({ valid: false, errorCode: 'RIB_KEY_OUT_OF_RANGE' });
    expect(validateMoroccanRib24(`${KEY_97_BASE}99`)).toEqual({ valid: false, errorCode: 'RIB_KEY_OUT_OF_RANGE' });
    expect(isValidRibChecksum(`${KEY_97_BASE}00`)).toBe(false);
    expect(isValidRibChecksum(`${KEY_97_BASE}98`)).toBe(false);
    expect(isValidRibChecksum(`${KEY_97_BASE}99`)).toBe(false);
  });

  it('refuse une mauvaise clé dans la plage : RIB_MOD97_CHECKSUM_MISMATCH', () => {
    expect(validateMoroccanRib24('001810007800020110620222')).toEqual({
      valid: false,
      errorCode: 'RIB_MOD97_CHECKSUM_MISMATCH',
    });
    expect(isValidRibChecksum('001810007800020110620222')).toBe(false);
  });

  it('computeMoroccanRibKey2 refuse une base mal formée', () => {
    for (const bad of ['', '123', '00181000780002011062021', '001810007800020110620211', '00181000780002011062A2', ' 0018100078000201106202']) {
      expect(() => computeMoroccanRibKey2(bad), bad).toThrowError(/RIB_BASE22_INVALID_FORMAT/);
    }
  });
});

describe('RIB marocain : format, banque 000 et compte nul', () => {
  it('refuse vide, non numérique, longueurs fausses et types inattendus sans lever', () => {
    const inputs: readonly unknown[] = [
      '', ' ', '---', '12345', '0018100078000201106202', '0018100078000201106202211',
      '00181000780002011062022A', '٠٠١٨١٠٠٠٧٨٠٠٠٢٠١١٠٦٢٠٢٢١', '0018100078000201106202,1',
      null, undefined, 24, {}, [],
    ];
    for (const input of inputs) {
      const parsed = validateMoroccanRib24(input as string);
      expect(parsed, String(input)).toEqual({ valid: false, errorCode: 'RIB_INVALID_FORMAT_OR_LENGTH' });
    }
  });

  it('refuse le code banque 000 même avec une clé arithmétiquement juste', () => {
    const base = '0008100078000201106202';
    const rib = `${base}${twoDigits(expectedKey(base))}`;
    expect(hornerMod97(rib)).toBe(0);
    expect(validateMoroccanRib24(rib)).toEqual({ valid: false, errorCode: 'RIB_ZERO_BANK_OR_ACCOUNT' });
  });

  it('refuse un compte de seize zéros même avec une clé juste', () => {
    const base = '0018100000000000000000';
    const rib = `${base}${twoDigits(expectedKey(base))}`;
    expect(hornerMod97(rib)).toBe(0);
    expect(validateMoroccanRib24(rib)).toEqual({ valid: false, errorCode: 'RIB_ZERO_BANK_OR_ACCOUNT' });
  });

  it('un compte non nul avec localité 000 reste accepté (seule la banque est contrôlée)', () => {
    const base = '0010000078000201106202';
    expect(validateMoroccanRib24(`${base}${twoDigits(expectedKey(base))}`).valid).toBe(true);
  });
});

describe('RIB marocain : exhaustivité de l’équivalence clé = formule ⇔ 1 ≤ clé ≤ 97 et N mod 97 = 0', () => {
  it('pour les 97 restes possibles de (base22 × 100) mod 97 et les 100 clés 00 à 99', () => {
    const remaindersSeen = new Set<number>();
    for (let seed = 1; seed <= 97; seed += 1) {
      // base de 22 chiffres, première position non nulle ; le reste r parcourt les 97 valeurs
      const base22 = `${'1'}${String(seed).padStart(21, '0')}`;
      const remainder = hornerMod97(`${base22}00`);
      remaindersSeen.add(remainder);
      const formulaKey = 97 - remainder;
      for (let key = 0; key <= 99; key += 1) {
        const rib = `${base22}${twoDigits(key)}`;
        const byFormula = key === formulaKey;
        const byModulus = key >= 1 && key <= 97 && hornerMod97(rib) === 0;
        expect(byFormula, `${base22} ${key}`).toBe(byModulus);
        expect(isValidRibChecksum(rib), `${base22} ${key}`).toBe(byFormula);
      }
    }
    expect(remaindersSeen.size).toBe(97);
  });
});

describe('RIB marocain : 2 000 RIB pseudo-aléatoires reproductibles (LCG à graine fixe)', () => {
  it('base aléatoire + clé calculée → valide ; clé décalée de ±1 → invalide', () => {
    let state = 20260714;
    const nextDigit = (): number => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return Math.floor(state / 65536) % 10;
    };
    for (let round = 0; round < 2000; round += 1) {
      let base22 = String(1 + (nextDigit() % 9)); // banque ≠ 000, compte non nul sauf probabilité 10^-16 écartée ci-dessous
      while (base22.length < 22) {
        base22 += String(nextDigit());
      }
      expect(base22.slice(6, 22)).not.toBe('0000000000000000');
      const key = expectedKey(base22);
      expect(computeMoroccanRibKey2(base22)).toBe(twoDigits(key));
      const rib = `${base22}${twoDigits(key)}`;
      const parsed = validateMoroccanRib24(rib);
      expect(parsed.valid, rib).toBe(true);
      expect(hornerMod97(rib)).toBe(0);
      expect(validateMoroccanRib24(`MA64${rib}`).valid).toBe(true);
      for (const shifted of [key + 1, key - 1]) {
        expect(validateMoroccanRib24(`${base22}${twoDigits((shifted + 100) % 100)}`).valid, rib).toBe(false);
      }
    }
  });
});

describe('MoroccanRib24Schema (Zod 4)', () => {
  it('transforme une saisie valide en RIB canonique à 24 chiffres', () => {
    expect(MoroccanRib24Schema.parse('001 810 0078000201106202 21')).toBe('001810007800020110620221');
    expect(MoroccanRib24Schema.parse('MA64001810007800020110620318')).toBe('001810007800020110620318');
  });

  it('rejette avec le code d’erreur dans le message, sans lever d’exception brute', () => {
    const result = MoroccanRib24Schema.safeParse('001810007800020110620222');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('RIB_MOD97_CHECKSUM_MISMATCH');
    }
    expect(MoroccanRib24Schema.safeParse('').success).toBe(false);
    expect(MoroccanRib24Schema.safeParse(42).success).toBe(false);
  });
});
