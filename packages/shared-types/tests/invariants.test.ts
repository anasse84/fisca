import { describe, expect, it } from 'vitest';
import {
  FISCA_ADR_INVARIANT_CATALOG,
  assertCertificateMatchesEmitter,
  assertReadOnlySageSql,
  assertSafeIntegerAmount,
  assertSafeMcpToolSchema,
  assertValidVatRateForIssueYear,
  runAdrInvariantSelfCheck,
} from '../src/index.ts';

describe('FISCA_ADR_INVARIANT_CATALOG (13 invariants) : structure', () => {
  it('couvre exactement ADR-01 à ADR-12', () => {
    const adrs = new Set(FISCA_ADR_INVARIANT_CATALOG.map((entry) => entry.adr));
    expect([...adrs].sort()).toEqual(
      Array.from({ length: 12 }, (_, index) => `ADR-${String(index + 1).padStart(2, '0')}`),
    );
  });

  it('a des identifiants uniques, un énoncé, une origine et une vraie fonction de contrôle', () => {
    const ids = FISCA_ADR_INVARIANT_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of FISCA_ADR_INVARIANT_CATALOG) {
      expect(entry.id).toMatch(/^INV-ADR-\d{2}-\d{2}$/);
      expect(entry.statement.length).toBeGreaterThan(20);
      expect(['DOC_05_SECTION_14', 'DERIVE_GARDE_FOU_ADR']).toContain(entry.origin);
      expect(typeof entry.check).toBe('function');
    }
  });

  it('est gelé en profondeur', () => {
    expect(Object.isFrozen(FISCA_ADR_INVARIANT_CATALOG)).toBe(true);
    for (const entry of FISCA_ADR_INVARIANT_CATALOG) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  for (const entry of FISCA_ADR_INVARIANT_CATALOG) {
    describe(`${entry.id} (${entry.adr})`, () => {
      it('accepte tous ses cas conformes', () => {
        expect(entry.conforming.length).toBeGreaterThan(0);
        for (const input of entry.conforming) {
          expect(() => entry.check(input)).not.toThrow();
        }
      });

      it('refuse tous ses cas violants avec son code d’erreur', () => {
        expect(entry.violating.length).toBeGreaterThan(0);
        for (const input of entry.violating) {
          expect(() => entry.check(input)).toThrowError(entry.errorCode);
        }
      });

      it('refuse une entrée de forme inattendue', () => {
        expect(() => entry.check(undefined)).toThrowError(entry.errorCode);
      });
    });
  }
});

describe('auto-contrôle', () => {
  it('ne trouve aucun écart', () => {
    expect(runAdrInvariantSelfCheck()).toEqual([]);
  });
});

describe('contrôles repris de Doc_05 Section 14', () => {
  it('ADR-03 entier sûr', () => {
    expect(assertSafeIntegerAmount(100, 'x')).toBe(100);
    expect(() => assertSafeIntegerAmount(1.1, 'x')).toThrowError(/ADR_03_FLOAT_FORBIDDEN/);
    expect(() => assertSafeIntegerAmount(Number.NaN, 'x')).toThrowError(/ADR_03_FLOAT_FORBIDDEN/);
    expect(() => assertSafeIntegerAmount(Number.MAX_SAFE_INTEGER + 1, 'x')).toThrowError(/ADR_03/);
  });

  it('ADR-04 TVA : 2026 strict, antérieur libre', () => {
    for (const rate of [2000, 1000, 0]) {
      expect(() => assertValidVatRateForIssueYear(rate, '2026-01-01')).not.toThrow();
    }
    expect(() => assertValidVatRateForIssueYear(1400, '2026-03-01')).toThrowError(/ADR_04_LF2026_VAT_VIOLATION/);
    expect(() => assertValidVatRateForIssueYear(700, '2027-03-01')).toThrowError(/ADR_04/);
    expect(() => assertValidVatRateForIssueYear(1400, '2025-12-31')).not.toThrow();
  });

  it('ADR-06 certificat', () => {
    const ice = '003976749000084';
    expect(() => assertCertificateMatchesEmitter(`CN=X, 2.5.4.97=${ice}`, ice, '1234567')).not.toThrow();
    expect(() => assertCertificateMatchesEmitter('CN=X, SERIALNUMBER=1234567', ice, '1234567')).not.toThrow();
    expect(() => assertCertificateMatchesEmitter('CN=X', ice, '1234567')).toThrowError(/ADR_06_LOI4320_CERT_MISMATCH/);
  });

  it('ADR-02/10 schéma MCP', () => {
    expect(() => assertSafeMcpToolSchema('t', ['invoiceId'])).not.toThrow();
    for (const key of ['tenantId', 'tenant_id', 'companyId', 'company_id', 'd1DatabaseId']) {
      expect(() => assertSafeMcpToolSchema('t', ['a', key])).toThrowError(/ADR_02_10_TENANT_LEAK_RISK/);
    }
  });

  it('ADR-11 SQL Sage en lecture seule', () => {
    expect(() => assertReadOnlySageSql('SELECT * FROM F_ECRITUREC WITH (NOLOCK)')).not.toThrow();
    for (const verb of ['INSERT INTO', 'update', 'DELETE FROM', 'MERGE', 'DROP TABLE', 'ALTER TABLE', 'TRUNCATE TABLE']) {
      expect(() => assertReadOnlySageSql(`${verb} F_ECRITUREC`)).toThrowError(/ADR_11_SAGE100_CORRUPTION_GUARD/);
    }
  });
});
