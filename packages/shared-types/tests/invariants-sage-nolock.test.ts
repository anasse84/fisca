import { describe, expect, it } from 'vitest';
import { AdrInvariantError, assertReadOnlySageSql } from '../src/invariants.ts';

function failure(sql: string): AdrInvariantError {
  try {
    assertReadOnlySageSql(sql);
  } catch (error) {
    if (error instanceof AdrInvariantError) {
      return error;
    }
    throw error;
  }
  throw new Error(`requête acceptée à tort : ${sql}`);
}

describe('assertReadOnlySageSql : NOLOCK table par table (décision du propriétaire)', () => {
  describe('refus : indice manquant', () => {
    it('JOIN sans NOLOCK masqué par un commentaire « -- WITH (NOLOCK) WITH (NOLOCK) »', () => {
      const error = failure(`
        -- WITH (NOLOCK) WITH (NOLOCK)
        SELECT e.cbMarq FROM F_ECRITUREC e WITH (NOLOCK)
        JOIN F_JOURNAUX j ON j.JO_Num = e.JO_Num`);
      expect(error.code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
      expect(error.message).toMatch(/^ADR_11_SAGE100_MISSING_NOLOCK/);
      expect(error.message).toContain('F_JOURNAUX');
      expect(error.message).not.toContain('F_ECRITUREC');
    });

    it('commentaire bloc contenant WITH (NOLOCK)', () => {
      const error = failure('SELECT a FROM T1 /* WITH (NOLOCK) */ WHERE a = 1');
      expect(error.code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
      expect(error.message).toContain('T1');
    });

    it('commentaire bloc imbriqué (SQL Server les imbrique) : le NOLOCK caché reste un commentaire', () => {
      expect(failure('SELECT a FROM T1 /* x /* y */ WITH (NOLOCK) */ WHERE a = 1').code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
    });

    it('littéral contenant WITH (NOLOCK)', () => {
      const error = failure("SELECT a FROM T1 WHERE b = 'WITH (NOLOCK)'");
      expect(error.code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
      expect(error.message).toContain('T1');
    });

    it('CTE valide mais table physique sans NOLOCK dans la requête principale', () => {
      const error = failure(`
        WITH c AS (SELECT cbMarq FROM F_ECRITUREC WITH (NOLOCK))
        SELECT c.cbMarq FROM c JOIN dbo.F_COMPTEG g ON g.cbMarq = c.cbMarq`);
      expect(error.code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
      expect(error.message).toContain('dbo.F_COMPTEG');
    });

    it('CTE dont le corps lit une table physique sans NOLOCK', () => {
      const error = failure('WITH c AS (SELECT a FROM F_ECRITUREC) SELECT a FROM c');
      expect(error.code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
      expect(error.message).toContain('F_ECRITUREC');
    });

    it('sous-requête en FROM dont la table intérieure est sans NOLOCK', () => {
      const error = failure('SELECT s.a FROM (SELECT a FROM F_ECRITUREC) s');
      expect(error.code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
      expect(error.message).toContain('F_ECRITUREC');
    });

    it('sous-requête dans un IN / une expression sans NOLOCK', () => {
      expect(failure('SELECT a FROM T1 WITH (NOLOCK) WHERE a IN (SELECT a FROM T2)').message).toContain('T2');
    });

    it('plusieurs JOIN dont un seul, au milieu, est sans NOLOCK', () => {
      const error = failure(`
        SELECT a.x FROM A a WITH (NOLOCK)
        INNER JOIN B b WITH (NOLOCK) ON b.id = a.id
        LEFT JOIN [dbo].[C] AS c ON c.id = b.id
        LEFT JOIN D d WITH(NOLOCK) ON d.id = c.id`);
      expect(error.code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
      expect(error.message).toContain('dbo.C');
      expect(error.message).toMatch(/absente de : dbo\.C\.$/);
    });

    it('liste toutes les tables fautives', () => {
      const error = failure('SELECT 1 FROM A JOIN B ON 1 = 1 JOIN C WITH (NOLOCK) ON 1 = 1 CROSS JOIN D');
      expect(error.code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
      expect(error.message).toContain('A, B, D');
    });

    it('WITH (UPDLOCK) seul : mot-clé interdit', () => {
      expect(failure('SELECT a FROM T1 WITH (UPDLOCK)').code).toBe('ADR_11_SAGE100_CORRUPTION_GUARD');
    });

    it('WITH (TABLOCK) seul (aucun NOLOCK) : indice manquant', () => {
      expect(failure('SELECT a FROM T1 WITH (TABLOCK)').code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
    });

    it('NOLOCK mentionné seulement dans INDEX(...) ou comme préfixe d\'un autre mot ne compte pas', () => {
      expect(failure('SELECT a FROM T1 WITH (INDEX(NOLOCK))').code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
      expect(failure('SELECT a FROM T1 WITH (NOLOCKX)').code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
    });

    it('un NOLOCK sur la table voisine ne couvre pas la suivante (indice avant le nom de table)', () => {
      expect(failure('SELECT a FROM A WITH (NOLOCK) JOIN B ON 1 = 1 WHERE x = 1').message).toContain('B');
    });

    it('fonction table, APPLY et nom de table pris pour une fonction : refus par défaut sûr', () => {
      expect(failure('SELECT a FROM dbo.fn_tab(1) WITH (NOLOCK)').code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
      expect(failure('SELECT a FROM T1 WITH (NOLOCK) CROSS APPLY dbo.fn_tab(T1.a) f').code).toBe('ADR_11_SAGE100_MISSING_NOLOCK');
      expect(failure('SELECT a FROM T1 WITH (NOLOCK) OUTER APPLY (SELECT TOP 1 b FROM T2 ORDER BY b) o').message).toContain('T2');
    });

    it('jointure parenthésée dont une table est sans NOLOCK', () => {
      expect(failure('SELECT 1 FROM (A WITH (NOLOCK) JOIN B ON 1 = 1)').message).toContain('B');
    });

    it('un nom de CTE ne s\'exempte pas quand il est qualifié par un schéma', () => {
      expect(failure('WITH c AS (SELECT 1 AS a FROM T1 WITH (NOLOCK)) SELECT a FROM dbo.c').message).toContain('dbo.c');
    });

    it('un nom de CTE n\'exempte pas une autre table', () => {
      expect(failure('WITH c AS (SELECT 1 AS a FROM T1 WITH (NOLOCK)) SELECT a FROM c JOIN T2 ON 1 = 1').message).toContain('T2');
    });
  });

  describe('refus : aucune table physique', () => {
    it.each([
      'SELECT 1',
      'SELECT 1 -- FROM t WITH (NOLOCK)',
      "SELECT 'FROM t WITH (NOLOCK)'",
      'SELECT /* FROM t WITH (NOLOCK) */ 1',
      'WITH c AS (SELECT 1 AS a) SELECT a FROM c',
    ])('%s', (sql) => {
      expect(failure(sql).code).toBe('ADR_11_SAGE100_EMPTY_TABLE_SOURCE');
    });
  });

  describe('refus : mots-clés interdits (code CORRUPTION_GUARD conservé)', () => {
    it.each([
      'SELECT * INTO F_COPIE FROM F_ECRITUREC WITH (NOLOCK)',
      'SELECT a FROM T1 WITH (UPDLOCK)',
      'SELECT a FROM T1 WITH (NOLOCK, UPDLOCK)',
      'SELECT a FROM T1 WITH (XLOCK)',
      'SELECT a FROM T1 WITH (NOLOCK, HOLDLOCK)',
      'SELECT a FROM T1 WITH (TABLOCKX)',
      'WITH x AS (SELECT 1) DELETE FROM F_ECRITUREC',
      'WITH x AS (SELECT a FROM T1 WITH (NOLOCK)) UPDATE T1 SET a = 1',
      'WITH x AS (SELECT a FROM T1 WITH (NOLOCK)) INSERT INTO T1 SELECT a FROM x',
      'WITH x AS (EXEC sp_who) SELECT a FROM T1 WITH (NOLOCK)',
      'SELECT a FROM T1 WITH (NOLOCK) WHERE a IN (SELECT a FROM T2 WITH (NOLOCK)) EXEC sp_who',
      'SELECT a FROM T1 WITH (NOLOCK);\nDROP TABLE T1',
      'SELECT a FROM T1 WITH (NOLOCK) /* x /* y */ */ ; DROP TABLE T1',
    ])('%s', (sql) => {
      expect(failure(sql).code).toBe('ADR_11_SAGE100_CORRUPTION_GUARD');
    });

    it('ne comptabilise pas les mots-clés cachés dans des commentaires ou des littéraux', () => {
      expect(() =>
        assertReadOnlySageSql("SELECT a FROM T1 WITH (NOLOCK) /* DELETE UPDLOCK */ WHERE b = 'INSERT INTO x' -- DROP"),
      ).not.toThrow();
    });

    it('refuse un commentaire non terminé, une fermeture orpheline et un littéral non terminé', () => {
      expect(failure('SELECT a FROM T1 WITH (NOLOCK) /* x').code).toBe('ADR_11_SAGE100_CORRUPTION_GUARD');
      expect(failure('SELECT a FROM T1 WITH (NOLOCK) */').code).toBe('ADR_11_SAGE100_CORRUPTION_GUARD');
      expect(failure("SELECT a FROM T1 WITH (NOLOCK) WHERE b = 'x").code).toBe('ADR_11_SAGE100_CORRUPTION_GUARD');
    });

    it('une requête commençant par WITH sans CTE bien formé est refusée', () => {
      expect(failure('WITH (NOLOCK) SELECT 1').code).toBe('ADR_11_SAGE100_CORRUPTION_GUARD');
      expect(failure('WITH x AS SELECT 1').code).toBe('ADR_11_SAGE100_CORRUPTION_GUARD');
      expect(failure('WITH x AS (SELECT 1 FROM T1 WITH (NOLOCK))').code).toBe('ADR_11_SAGE100_CORRUPTION_GUARD');
    });
  });

  describe('refus : jointure implicite par virgule conservée', () => {
    it.each([
      'SELECT * FROM t,u WITH (NOLOCK)',
      'SELECT * FROM t WITH (NOLOCK), u WITH (NOLOCK)',
      'WITH c AS (SELECT a FROM t WITH (NOLOCK), u WITH (NOLOCK)) SELECT a FROM c',
      'SELECT * FROM (SELECT a FROM t WITH (NOLOCK)) s, u WITH (NOLOCK)',
    ])('%s', (sql) => {
      expect(failure(sql).code).toBe('ADR_11_SAGE100_CORRUPTION_GUARD');
    });
  });

  describe('acceptation : requêtes conformes', () => {
    it.each([
      ['table simple avec schéma', 'SELECT cbMarq FROM dbo.F_ECRITUREC WITH (NOLOCK) WHERE cbMarq > 10'],
      ['crochets et schéma, alias AS, indices', 'SELECT e.cbMarq FROM [dbo].[F_ECRITUREC] AS e WITH (NOLOCK)'],
      ['WITH(NOLOCK) collé', 'SELECT a FROM T1 WITH(NOLOCK) JOIN T2 t2 WITH(NOLOCK) ON t2.id = T1.id'],
      ['WITH (NOLOCK, INDEX(...))', 'SELECT e.a FROM F_ECRITUREC e WITH (NOLOCK, INDEX(UKA_F_ECRITUREC_cbMarq)) WHERE e.a > 0'],
      ['INDEX avant NOLOCK', 'SELECT e.a FROM F_ECRITUREC e WITH (INDEX(1), NOLOCK)'],
      ['minuscules', 'select a.x, b.y from A a with (nolock) join B b with (nolock) on a.id = b.id;'],
      ['alias nommé « ordre »', 'SELECT ordre.a FROM F_ECRITUREC AS ordre WITH (NOLOCK) JOIN F_JOURNAUX ordre2 WITH (NOLOCK) ON ordre2.id = ordre.id'],
      ['alias sans AS nommé « ordre »', 'SELECT ordre.a FROM F_ECRITUREC ordre WITH (NOLOCK) WHERE ordre.a = 1'],
      ['alias entre crochets mot réservé', 'SELECT [Order].a FROM F_ECRITUREC AS [Order] WITH (NOLOCK) ORDER BY [Order].a, [Order].b'],
      ['table sans alias suivie d\'un mot de fin de clause', 'SELECT a FROM T1 WITH (NOLOCK) WHERE a = 1 GROUP BY a HAVING COUNT(a) > 1'],
      ['saut de ligne et tabulations', 'SELECT a\nFROM\tT1\r\n  WITH\n(NOLOCK)\nWHERE a=1'],
      ['LEFT OUTER JOIN', 'SELECT a FROM T1 WITH (NOLOCK) LEFT OUTER JOIN T2 WITH (NOLOCK) ON T2.id = T1.id'],
      ['UNION', 'SELECT a FROM T1 WITH (NOLOCK) UNION ALL SELECT a FROM T2 WITH (NOLOCK)'],
      ['virgules de colonnes, REPLACE, IN, ORDER BY', "SELECT a, REPLACE(b, 'x', c) AS r FROM T1 WITH (NOLOCK) WHERE k IN (1, 2) ORDER BY a, b"],
      ['commentaires autour', 'SELECT a /* c1 */ FROM -- c2\n T1 WITH (NOLOCK) -- c3'],
      ['sous-requête scalaire', 'SELECT (SELECT TOP 1 b FROM T2 WITH (NOLOCK) ORDER BY b) AS c FROM T1 WITH (NOLOCK)'],
      ['sous-requête IN', 'SELECT a FROM T1 WITH (NOLOCK) WHERE a IN (SELECT a FROM T2 WITH (NOLOCK))'],
      ['sous-requête EXISTS', 'SELECT a FROM T1 t WITH (NOLOCK) WHERE EXISTS (SELECT 1 FROM T2 u WITH (NOLOCK) WHERE u.a = t.a)'],
      ['sous-requête en FROM valide', 'SELECT s.a FROM (SELECT a FROM F_ECRITUREC WITH (NOLOCK)) s'],
      ['sous-requête en FROM + JOIN physique', 'SELECT s.a FROM (SELECT a FROM T1 WITH (NOLOCK)) AS s JOIN T2 WITH (NOLOCK) ON T2.a = s.a'],
      ['sous-requête en JOIN', 'SELECT t.a FROM T1 t WITH (NOLOCK) JOIN (SELECT a FROM T2 WITH (NOLOCK)) sub ON sub.a = t.a'],
      ['jointure parenthésée', 'SELECT 1 FROM (A WITH (NOLOCK) JOIN B WITH (NOLOCK) ON 1 = 1)'],
      ['identifiants Unicode', 'SELECT a FROM Écritures WITH (NOLOCK)'],
    ])('%s', (_label, sql) => {
      expect(() => assertReadOnlySageSql(sql)).not.toThrow();
    });

    it('CTE valide', () => {
      expect(() =>
        assertReadOnlySageSql(`
          WITH Filtered AS (
            SELECT cbMarq, CG_Num FROM dbo.F_ECRITUREC e WITH (NOLOCK)
          )
          SELECT f.cbMarq, g.CG_Intitule
          FROM Filtered f
          JOIN dbo.F_COMPTEG g WITH (NOLOCK) ON g.CG_Num = f.CG_Num`),
      ).not.toThrow();
    });

    it('plusieurs CTE, colonnes nommées, nom insensible à la casse, crochets', () => {
      expect(() =>
        assertReadOnlySageSql(`
          WITH a (x, y) AS (SELECT 1, 2 FROM T1 WITH (NOLOCK)),
               [b] AS (SELECT x FROM a)
          SELECT x FROM [B] JOIN A ON 1 = 1`),
      ).not.toThrow();
      expect(() =>
        assertReadOnlySageSql('WITH c AS (SELECT a FROM T1 WITH (NOLOCK)) SELECT C.a FROM C WHERE C.a > 0'),
      ).not.toThrow();
    });

    it('CTE récursive', () => {
      expect(() =>
        assertReadOnlySageSql(`
          WITH r AS (
            SELECT cbMarq, CG_Num FROM F_COMPTEG WITH (NOLOCK) WHERE cbMarq = 1
            UNION ALL
            SELECT g.cbMarq, g.CG_Num FROM F_COMPTEG g WITH (NOLOCK) JOIN r ON r.cbMarq = g.cbMarq - 1
          )
          SELECT cbMarq FROM r`),
      ).not.toThrow();
    });

    it('point-virgule final unique accepté', () => {
      expect(() => assertReadOnlySageSql('SELECT a FROM T1 WITH (NOLOCK);')).not.toThrow();
      expect(() => assertReadOnlySageSql('SELECT a FROM T1 WITH (NOLOCK); -- fin')).not.toThrow();
    });
  });
});
