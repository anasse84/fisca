import { FISCA_ADR_INVARIANTS } from '@fisca/shared-types';
import { describe, expect, it } from 'vitest';
import * as goldenSuite from '../fiscal-golden-suite.ts';

/**
 * Tests adverses du verdict du pont S0 : ils ne s'affaiblissent jamais pour passer au vert.
 * Les blocs (a) à (c) dépendent de la correction de @fisca/shared-types (autre sous-agent).
 */

const INVARIANT_NAMES = [
  'assertSafeIntegerAmount',
  'assertValidVatRateForIssueYear',
  'assertCertificateMatchesEmitter',
  'assertSafeMcpToolSchema',
  'assertReadOnlySageSql',
] as const;

describe('(a) FISCA_ADR_INVARIANTS expose des fonctions', () => {
  it.each(INVARIANT_NAMES)('%s est une fonction', (name) => {
    expect(typeof FISCA_ADR_INVARIANTS[name]).toBe('function');
  });
});

describe('(b) assertValidVatRateForIssueYear rejette une date d\'émission illisible', () => {
  it.each(['', 'abc', '26-02-01', '2026-13-45'])('1400 bps, date %j', (date) => {
    expect(() => FISCA_ADR_INVARIANTS.assertValidVatRateForIssueYear(1400, date)).toThrow();
  });
});

describe('(c) assertSafeMcpToolSchema rejette toute clé de périmètre société', () => {
  it.each(['TenantId', 'tenantID', 'tenant-id', 'companyID', 'companyid', 'company_Id', 'd1_database_id'])('clé %s', (key) => {
    expect(() => FISCA_ADR_INVARIANTS.assertSafeMcpToolSchema('adversarial', [key])).toThrow(/ADR_02_10_TENANT_LEAK_RISK/);
  });
});

describe('(d) fiscal-golden-suite exporte le validateur .PNM', () => {
  it('assertValidSage100PnmBuffer est une fonction', () => {
    expect(typeof goldenSuite.assertValidSage100PnmBuffer).toBe('function');
  });
});
