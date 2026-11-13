import { describe, expect, it } from 'vitest';
import { FISCA_ADR_INVARIANTS, FISCA_ADR_INVARIANT_CATALOG } from '../src/index.ts';

const ICE = '003976749000084';

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

describe('constat 1 : FISCA_ADR_INVARIANTS est un objet de fonctions (Doc_05 §14, Doc_14 §05, Doc_17 §11)', () => {
  it('est un objet gelé exposant les cinq gardes', () => {
    expect(Array.isArray(FISCA_ADR_INVARIANTS)).toBe(false);
    expect(Object.isFrozen(FISCA_ADR_INVARIANTS)).toBe(true);
    for (const name of [
      'assertSafeIntegerAmount',
      'assertValidVatRateForIssueYear',
      'assertCertificateMatchesEmitter',
      'assertSafeMcpToolSchema',
      'assertReadOnlySageSql',
    ] as const) {
      expect(typeof FISCA_ADR_INVARIANTS[name]).toBe('function');
    }
  });

  it('s\'appelle comme dans les spécifications', () => {
    expect(FISCA_ADR_INVARIANTS.assertSafeIntegerAmount(100, 'x')).toBe(100);
    expect(() => FISCA_ADR_INVARIANTS.assertSafeMcpToolSchema('t', ['companyId'])).toThrowError(/ADR_02_10_TENANT_LEAK_RISK/);
    expect(() => FISCA_ADR_INVARIANTS.assertValidVatRateForIssueYear(1400, '2026-02-01')).toThrowError(/ADR_04_LF2026_VAT_VIOLATION/);
    expect(() => FISCA_ADR_INVARIANTS.assertReadOnlySageSql('SELECT cbMarq FROM F_ECRITUREC WITH (NOLOCK)')).not.toThrow();
    expect(() => FISCA_ADR_INVARIANTS.assertCertificateMatchesEmitter(`CN=X, 2.5.4.97=${ICE}`, ICE, '1234567')).not.toThrow();
  });

  it('le catalogue des 13 invariants est conservé sous un autre nom', () => {
    expect(FISCA_ADR_INVARIANT_CATALOG).toHaveLength(13);
    expect(Object.isFrozen(FISCA_ADR_INVARIANT_CATALOG)).toBe(true);
  });
});

describe('constat 2 : ADR-04 ne tolère aucune date illisible', () => {
  const unreadable = ['', 'abc', '26-02-01', '2026-13-45', '2026-02-30', '2026-00-10', '2026-04-31', '2025-02-29', '2026-2-1', ' 2026-02-01', '2026-02-01T00:00:00Z'];
  for (const date of unreadable) {
    for (const rate of [1400, 2000, 0]) {
      it(`refuse la date ${JSON.stringify(date)} avec le taux ${rate}`, () => {
        expect(messageOf(() => FISCA_ADR_INVARIANTS.assertValidVatRateForIssueYear(rate, date))).toMatch(/^ADR_04_UNREADABLE_ISSUE_DATE/);
      });
    }
  }

  it('porte un code lisible sur l\'erreur typée', () => {
    try {
      FISCA_ADR_INVARIANTS.assertValidVatRateForIssueYear(1400, 'abc');
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'ADR_04_UNREADABLE_ISSUE_DATE' });
    }
  });

  it('garde le comportement de la spécification pour les dates valides', () => {
    for (const rate of [2000, 1000, 0]) {
      expect(() => FISCA_ADR_INVARIANTS.assertValidVatRateForIssueYear(rate, '2026-01-01')).not.toThrow();
    }
    expect(() => FISCA_ADR_INVARIANTS.assertValidVatRateForIssueYear(1400, '2026-01-01')).toThrowError(/ADR_04_LF2026_VAT_VIOLATION/);
    expect(() => FISCA_ADR_INVARIANTS.assertValidVatRateForIssueYear(1400, '2025-12-31')).not.toThrow();
    expect(() => FISCA_ADR_INVARIANTS.assertValidVatRateForIssueYear(1400, '2024-02-29')).not.toThrow();
  });
});

describe('constat 3 : schéma MCP insensible à la casse et à la graphie', () => {
  const evasions = ['tenantID', 'companyid', 'tenant-id', 'company_Id', 'TenantId', 'd1_database_id', 'tenant id', 'company.id', 'D1-Database-Id', 'organization_id', 'organizationId', 'dbId', 'db_id', 'TENANT_ID', 'ｔenantId'];
  for (const key of evasions) {
    it(`refuse ${JSON.stringify(key)}`, () => {
      expect(messageOf(() => FISCA_ADR_INVARIANTS.assertSafeMcpToolSchema('t', ['status', key]))).toMatch(/^ADR_02_10_TENANT_LEAK_RISK/);
    });
  }

  it('accepte des paramètres légitimes', () => {
    expect(() =>
      FISCA_ADR_INVARIANTS.assertSafeMcpToolSchema('listInvoices', ['invoiceId', 'status', 'page', 'partnerId', 'issue_date', 'pageSize', 'tenantsCount']),
    ).not.toThrow();
    expect(() => FISCA_ADR_INVARIANTS.assertSafeMcpToolSchema('noop', [])).not.toThrow();
    expect(() => FISCA_ADR_INVARIANTS.assertSafeMcpToolSchema('t', ['database', 'identifier'])).not.toThrow();
  });
});

describe('constat 4a : SQL Sage = une seule instruction SELECT en lecture seule', () => {
  const adverse = [
    'SELECT * INTO F_COPIE FROM F_ECRITUREC',
    'select cbMarq into #t from F_ECRITUREC',
    'EXEC sp_who',
    'EXECUTE sp_configure',
    'CREATE TABLE t (id INT)',
    'GRANT ALL ON F_ECRITUREC TO public',
    'REVOKE SELECT ON F_ECRITUREC FROM public',
    'ALTER TABLE F_ECRITUREC ADD x INT',
    'DROP TABLE F_ECRITUREC',
    'TRUNCATE TABLE F_ECRITUREC',
    'MERGE F_ECRITUREC USING s ON 1=1 WHEN MATCHED THEN DELETE',
    'CALL purge()',
    'SELECT 1; SELECT 2',
    'SELECT 1; DROP TABLE F_ECRITUREC',
    'SELECT 1 /* x',
    'SELECT 1;;',
    "SELECT 'a",
    '',
    '   ',
    'WITH x AS (SELECT 1) DELETE FROM F_ECRITUREC',
    'SELECT 1\nEXEC sp_who',
    'REPLACE INTO F_ECRITUREC SELECT * FROM F_ECRITUREC WITH (NOLOCK)',
    'SELECT * FROM OPENROWSET(\'SQLNCLI\', \'x\', \'y\')',
  ];
  for (const sql of adverse) {
    it(`refuse ${JSON.stringify(sql)}`, () => {
      expect(messageOf(() => FISCA_ADR_INVARIANTS.assertReadOnlySageSql(sql))).toMatch(/^ADR_11_SAGE100_CORRUPTION_GUARD/);
    });
  }

  // Décision du propriétaire (S0) : commentaires supprimés avant analyse, NOLOCK exigé table par table ; ces refus
  // gardent leur sévérité mais portent désormais le code précis MISSING_NOLOCK ou EMPTY_TABLE_SOURCE.
  const refinedRefusals: readonly (readonly [string, RegExp])[] = [
    ['SELECT 1 -- DROP', /^ADR_11_SAGE100_EMPTY_TABLE_SOURCE/],
    ['SELECT /* x */ 1', /^ADR_11_SAGE100_EMPTY_TABLE_SOURCE/],
    ['SELECT 1', /^ADR_11_SAGE100_EMPTY_TABLE_SOURCE/],
    ['SELECT * FROM F_ECRITUREC', /^ADR_11_SAGE100_MISSING_NOLOCK.*F_ECRITUREC/],
    ['SELECT a.x FROM A a WITH (NOLOCK) JOIN B b ON a.id = b.id', /^ADR_11_SAGE100_MISSING_NOLOCK.*: B\./],
  ];
  for (const [sql, pattern] of refinedRefusals) {
    it(`refuse ${JSON.stringify(sql)} avec le code précis`, () => {
      expect(messageOf(() => FISCA_ADR_INVARIANTS.assertReadOnlySageSql(sql))).toMatch(pattern);
    });
  }

  it('accepte des SELECT légitimes', () => {
    for (const sql of [
      'SELECT cbMarq, EC_Montant FROM F_ECRITUREC WITH (NOLOCK) WHERE JO_Num = \'VT\'',
      'select a.x, b.y from A a with (nolock) join B b with (nolock) on a.id = b.id;',
      "SELECT CT_Intitule FROM F_COMPTET WITH (NOLOCK) WHERE CT_Intitule = 'CREATE; DROP -- /* INTO'",
      "SELECT CreatedAt, InsertedBy FROM T WITH (NOLOCK) WHERE n = 'l''été'",
      'SELECT REPLACE(CT_Intitule, \'a\', \'b\') FROM F_COMPTET WITH (NOLOCK)',
    ]) {
      expect(() => FISCA_ADR_INVARIANTS.assertReadOnlySageSql(sql)).not.toThrow();
    }
  });
});

describe('constat 4b : certificat comparé à la valeur complète d\'un attribut du SubjectDN', () => {
  const IF = '1234567';
  const adverse: readonly [string, string][] = [
    ['sous-chaîne ICE dans un CN', `CN=ACME ${ICE}9 SARL, O=Z`],
    ['ICE préfixé dans un attribut', `CN=Z, 2.5.4.97=X${ICE}`],
    ['IF en sous-chaîne', `CN=Z, SERIALNUMBER=991234567`],
    ['IF en sous-chaîne dans O', `CN=Z, O=Societe ${IF}`],
    ['ICE dans un attribut non identifiant (O)', `CN=Z, O=${ICE}`],
    ['valeur échappée contenant une virgule', `CN=Z\\, SERIALNUMBER=${IF}`],
    ['DN vide', ''],
    ['CN seul égal à l\'ICE', `CN=${ICE}, O=ACME`],
    ['CN seul égal à l\'IF', `cn = ${IF} , o=ACME`],
    ['IF nu (sans préfixe VATMA-, IFMA-, IF:, IF-)', `C=MA,O=ACME,SERIALNUMBER=${IF}`],
  ];
  for (const [label, dn] of adverse) {
    it(`refuse : ${label}`, () => {
      expect(messageOf(() => FISCA_ADR_INVARIANTS.assertCertificateMatchesEmitter(dn, ICE, IF))).toMatch(/^ADR_06_LOI4320_CERT_MISMATCH/);
    });
  }

  it('refuse un ICE de longueur ≠ 15 et un IF trop court', () => {
    expect(() => FISCA_ADR_INVARIANTS.assertCertificateMatchesEmitter('CN=12345', '12345', '12345')).toThrowError(/ADR_06/);
  });

  it('accepte les correspondances exactes', () => {
    const ok: readonly string[] = [
      `CN=Emetteur, 2.5.4.97=${ICE}`,
      `CN=Emetteur, organizationIdentifier=${ICE}, C=MA`,
      `C=MA,O=ACME,SERIALNUMBER=IFMA-${IF}`,
      `CN=ACME\\, SARL, 2.5.4.5=IF-${IF}`,
    ];
    for (const dn of ok) {
      expect(() => FISCA_ADR_INVARIANTS.assertCertificateMatchesEmitter(dn, ICE, IF)).not.toThrow();
    }
  });
});
