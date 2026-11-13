import { describe, expect, it } from 'vitest';
import { assertReadOnlySageSql, assertSafeMcpToolSchema } from '../src/invariants.ts';

const TENANT_ERROR = /^ADR_02_10_TENANT_LEAK_RISK/;
const SAGE_ERROR = /^ADR_11_SAGE100_CORRUPTION_GUARD/;

describe('assertSafeMcpToolSchema : identifiants de base et de société (réserve 2)', () => {
  it.each([
    'databaseId', 'database_id', 'DATABASE-ID', 'database.id', 'orgId', 'org_id', 'ORG_ID',
    'd1Id', 'd1_id', 'tenantUuid', 'tenant_uuid', 'companyUuid', 'company_uuid',
    // anciens motifs, toujours refusés
    'tenantId', 'companyId', 'd1DatabaseId', 'organizationId', 'dbId',
  ])('refuse %s', (key) => {
    expect(() => assertSafeMcpToolSchema('t', ['status', key])).toThrowError(TENANT_ERROR);
  });

  it('refuse les variantes Unicode et les caractères de format invisibles', () => {
    expect(() => assertSafeMcpToolSchema('t', ['ｄatabaseＩd'])).toThrowError(TENANT_ERROR);
    expect(() => assertSafeMcpToolSchema('t', ['or\u200Bg_id'])).toThrowError(TENANT_ERROR);
  });

  it('accepte les clés légitimes voisines', () => {
    expect(() =>
      assertSafeMcpToolSchema('t', [
        'partnerId', 'issue_date', 'tenantsCount', 'database', 'organizationName', 'orgName', 'organization',
        'invoiceId', 'uuid', 'companyName', 'tenant', 'd1', 'databaseName',
      ]),
    ).not.toThrow();
  });
});

describe('assertReadOnlySageSql : jointure implicite par virgule (réserve 3)', () => {
  it.each([
    'SELECT * FROM t,u WITH (NOLOCK)',
    'SELECT * FROM t, u WITH (NOLOCK)',
    'SELECT * FROM t WITH (NOLOCK), u WITH (NOLOCK)',
    'SELECT * FROM t WITH (NOLOCK) , u WITH (NOLOCK) , v WITH (NOLOCK)',
    'SELECT * FROM t WITH (NOLOCK)\n,\nu WITH (NOLOCK)',
    'SELECT a FROM t WITH (NOLOCK) JOIN u WITH (NOLOCK) ON t.id = u.id, v WITH (NOLOCK)',
    'SELECT * FROM t WITH (NOLOCK) WHERE id IN (SELECT id FROM u,v WITH (NOLOCK))',
    'SELECT * FROM t WITH (NOLOCK) WHERE id IN (SELECT id FROM u WITH (NOLOCK), v WITH (NOLOCK))',
    'SELECT * FROM (SELECT a FROM t,u WITH (NOLOCK)) x WITH (NOLOCK)',
    'SELECT (SELECT TOP 1 a FROM u, v WITH (NOLOCK)) AS c FROM t WITH (NOLOCK)',
    'SELECT a FROM t WITH (NOLOCK) UNION SELECT b FROM u, v WITH (NOLOCK)',
    // identifiants entre crochets ou guillemets : leur contenu ne désarme pas le contrôle
    'SELECT * FROM [WHERE], u WITH (NOLOCK)',
    'SELECT * FROM t WITH (NOLOCK), "GROUP" WITH (NOLOCK)',
    // parenthèses déséquilibrées : refus fermé
    'SELECT * FROM t WITH (NOLOCK))',
    'SELECT * FROM (t WITH (NOLOCK)',
  ])('refuse %j', (sql) => {
    expect(() => assertReadOnlySageSql(sql)).toThrowError(SAGE_ERROR);
  });

  it.each([
    'SELECT a, b, c FROM t WITH (NOLOCK)',
    'SELECT a,b FROM t WITH (NOLOCK) WHERE x = 1 ORDER BY a, b',
    'SELECT REPLACE(a, b, c) AS r FROM t WITH (NOLOCK)',
    'SELECT COALESCE(a,b) FROM t WITH (NOLOCK) WHERE id IN (1, 2, 3)',
    'SELECT * FROM t WITH (NOLOCK) WHERE name IN (\'a,b\', \'c\')',
    'SELECT * FROM t WITH (NOLOCK) WHERE name = \'x,y\'',
    'SELECT a FROM t WITH (NOLOCK) GROUP BY a, b HAVING COUNT(a) > 1',
    'SELECT a FROM t WITH (NOLOCK) JOIN u WITH (NOLOCK) ON t.id = u.id AND ISNULL(t.a, u.a) = 1',
    'SELECT a FROM t WITH (NOLOCK) INNER JOIN u WITH (NOLOCK) ON t.id = u.id LEFT JOIN v WITH (NOLOCK) ON v.id = u.id ORDER BY t.a, u.b',
    'SELECT * FROM t WITH (NOLOCK) WHERE id IN (SELECT id FROM u WITH (NOLOCK) WHERE k IN (1,2))',
    'SELECT (SELECT TOP 1 a FROM u WITH (NOLOCK) ORDER BY a, b) AS c, d FROM t WITH (NOLOCK)',
    'SELECT a, b FROM t WITH (NOLOCK) UNION SELECT c, d FROM u WITH (NOLOCK)',
    'SELECT [a,b], c FROM [t,u] WITH (NOLOCK)',
  ])('accepte %j', (sql) => {
    expect(() => assertReadOnlySageSql(sql)).not.toThrow();
  });
});
