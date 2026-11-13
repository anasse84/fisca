import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditAndRepairIce, isDivisibleBy97, normalizeIceCell } from '../src/tools/ice.ts';
import { buildCorrectedCsv, auditIceColumn, detectIceColumn, EXPORT_COLUMN_ICE, EXPORT_COLUMN_STATUS } from '../src/tools/ice-table.ts';
import { decodeCsvBytes, detectDelimiter, neutralizeFormula, parseCsv, serializeCsv } from '../src/tools/csv.ts';
import { readSheet, SheetReadError, sheetFormatOfName } from '../src/tools/sheet-reader.ts';
import { columnIndexOfRef, decodeXmlEntities, readXlsxRows, XlsxError } from '../src/tools/xlsx.ts';
import { buildXlsxFixture, buildZip, WORKBOOK_RELS_XML, WORKBOOK_XML } from './helpers/zip.ts';

interface IceVector {
  readonly raw: string;
  readonly status: string;
  readonly normalized: string | null;
}
const VECTORS = JSON.parse(readFileSync(new URL('./golden/tools-viraux.vectors.json', import.meta.url), 'utf8')) as { ice_vectors: IceVector[] };

describe('ICE : modulo 97 et réparation (Doc_18 S06 et S11, ERRATA E)', () => {
  it('vecteurs d’or : valides, tronqués réparés, invalides rejetés', () => {
    for (const v of VECTORS.ice_vectors) {
      const r = auditAndRepairIce(v.raw);
      expect(r.status, v.raw).toBe(v.status);
      expect(r.normalizedIce15 ?? null, v.raw).toBe(v.normalized);
    }
  });

  it('découpe un ICE valide : racine 9, établissement 4, clé 2', () => {
    const r = auditAndRepairIce('001534290000057');
    expect([r.enterpriseRoot9, r.establishmentCode4, r.controlKey2]).toEqual(['001534290', '0000', '57']);
  });

  it('inversion de deux chiffres : rejet immédiat par la clé', () => {
    const r = auditAndRepairIce('001534290000075');
    expect(r.status).toBe('INVALID_CHECKSUM_OR_FORMAT');
    expect(r.reason).toBe('CHECKSUM');
  });

  it('tolère espaces, points, tirets, apostrophe Excel, chiffres arabes', () => {
    expect(normalizeIceCell(" '001 534-290.000_057 ")).toBe('001534290000057');
    expect(auditAndRepairIce('٠٠١٥٣٤٢٩٠٠٠٠٠٥٧').status).toBe('VALID_15');
    expect(auditAndRepairIce('001 534 290 000 057').status).toBe('VALID_15');
  });

  it('13 et 14 chiffres seulement sont réparés ; 12 chiffres ne sont jamais réparés (écart assumé avec Doc_18 S11)', () => {
    expect(auditAndRepairIce('534290000057').status).toBe('INVALID_CHECKSUM_OR_FORMAT');
    expect(auditAndRepairIce('534290000057').reason).toBe('BAD_LENGTH');
    const fourteen = auditAndRepairIce('03042032000080');
    expect(fourteen.status).toBe('AUTO_REPAIRED_EXCEL_LEADING_ZEROS');
    expect(fourteen.normalizedIce15).toBe('003042032000080');
  });

  it('13 chiffres dont le complément à 15 ne passe pas la clé : non réparé, jamais deviné', () => {
    const r = auditAndRepairIce('1534290000058');
    expect(r.status).toBe('INVALID_CHECKSUM_OR_FORMAT');
    expect(r.reason).toBe('REPAIR_CHECKSUM');
    expect(r.normalizedIce15).toBeUndefined();
  });

  it('notation scientifique d’Excel : perte irréversible, signalée', () => {
    const r = auditAndRepairIce('1,53429E+12');
    expect(r.reason).toBe('SCIENTIFIC_NOTATION');
    expect(auditAndRepairIce('1.53429E+12').reason).toBe('SCIENTIFIC_NOTATION');
  });

  it('cellule vide, lettres, trop longue, racine nulle', () => {
    expect(auditAndRepairIce('   ').status).toBe('EMPTY');
    expect(auditAndRepairIce('ICE001534290000057').reason).toBe('NON_DIGIT');
    expect(auditAndRepairIce('0015342900000571').reason).toBe('BAD_LENGTH');
    expect(auditAndRepairIce('000000000000000').reason).toBe('ZERO_ENTERPRISE_ROOT');
  });

  it('isDivisibleBy97 exige exactement 15 chiffres', () => {
    expect(isDivisibleBy97('001534290000057')).toBe(true);
    expect(isDivisibleBy97('1534290000057')).toBe(false);
  });

  it('propriété : tout ICE accepté est sur 15 chiffres et divisible par 97 ; le résultat réparé conserve les chiffres d’origine en suffixe', () => {
    for (let n = 0; n < 400; n += 1) {
      const root = String(100000000 + n * 7919).padStart(9, '0');
      const body = `${root}0000`;
      const key = String((97n - ((BigInt(body) * 100n) % 97n)) % 97n).padStart(2, '0');
      const ice = `${body}${key}`;
      if (!isDivisibleBy97(ice)) continue;
      const r = auditAndRepairIce(ice);
      expect(r.status).toBe('VALID_15');
      const stripped = ice.replace(/^0+/, '');
      if (stripped.length === 13 || stripped.length === 14) {
        const repaired = auditAndRepairIce(stripped);
        expect(repaired.status).toBe('AUTO_REPAIRED_EXCEL_LEADING_ZEROS');
        expect(repaired.normalizedIce15?.endsWith(stripped)).toBe(true);
        expect(repaired.normalizedIce15).toHaveLength(15);
      }
    }
  });
});

describe('CSV : séparateurs, guillemets, encodage, injection', () => {
  it('détecte ; , tabulation | et garde ; par défaut', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('a|b|c')).toBe('|');
    expect(detectDelimiter('abc')).toBe(';');
    expect(detectDelimiter('"a;b";c,d,e')).toBe(',');
  });

  it('lit guillemets, doubles guillemets, retours à la ligne dans une cellule, CRLF, BOM, dernière ligne sans fin de ligne', () => {
    const { rows } = parseCsv('\uFEFFnom;ice\r\n"Société ""X""; SARL";001534290000057\r\n"deux\nlignes";3042032000080');
    expect(rows).toEqual([
      ['nom', 'ice'],
      ['Société "X"; SARL', '001534290000057'],
      ['deux\nlignes', '3042032000080'],
    ]);
  });

  it('cellules vides conservées, lignes vides ignorées', () => {
    expect(parseCsv('a;;c\n\n;;\n').rows).toEqual([['a', '', 'c'], ['', '', '']]);
  });

  it('neutralise les formules, écrit BOM + CRLF, re-quote correctement', () => {
    expect(neutralizeFormula('=1+1')).toBe("'=1+1");
    expect(neutralizeFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralizeFormula('-5')).toBe("'-5");
    expect(neutralizeFormula('Société')).toBe('Société');
    const out = serializeCsv([['a;b', '=cmd', 'x"y'], ['1', '2', '3']], ';', new Set([1]));
    expect(out).toBe('\uFEFF"a;b";=cmd;"x""y"\r\n1;2;3\r\n');
    expect(parseCsv(out).rows[0]).toEqual(['a;b', '=cmd', 'x"y']);
  });

  it('décode UTF-8, repli windows-1252 pour un CSV Excel francophone', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('Société')).encoding).toBe('utf-8');
    const latin = new Uint8Array([0x53, 0x6f, 0x63, 0x69, 0xe9, 0x74, 0xe9]);
    expect(decodeCsvBytes(latin)).toEqual({ text: 'Société', encoding: 'windows-1252' });
  });
});

describe('audit de colonne et CSV corrigé', () => {
  const text = 'Raison sociale;ICE;Ville\r\nAcme;1534290000057;Rabat\r\nBeta;003042032000080;Fès\r\nGamma;001534290000075;Salé\r\nDelta;;Agadir\r\n';
  const { rows, delimiter } = parseCsv(text);

  it('détecte la colonne ICE et l’en-tête', () => {
    expect(detectIceColumn(rows)).toEqual({ column: 1, hasHeader: true });
    expect(detectIceColumn([['x', '1534290000057'], ['y', '3042032000080']])).toEqual({ column: 1, hasHeader: false });
  });

  it('résultat par ligne et synthèse', () => {
    const audit = auditIceColumn(rows, 1, true);
    expect(audit.rows.map((r) => [r.rowNumber, r.result.status])).toEqual([
      [2, 'AUTO_REPAIRED_EXCEL_LEADING_ZEROS'],
      [3, 'VALID_15'],
      [4, 'INVALID_CHECKSUM_OR_FORMAT'],
      [5, 'EMPTY'],
    ]);
    expect(audit.summary).toEqual({ total: 4, valid: 1, repaired: 1, invalid: 1, empty: 1 });
  });

  it('export : colonnes d’origine intactes + ICE_corrige + ICE_statut, ICE d’origine jamais écrasé', () => {
    const audit = auditIceColumn(rows, 1, true);
    const csv = buildCorrectedCsv(rows, audit, true, delimiter);
    const back = parseCsv(csv).rows;
    expect(back[0]).toEqual(['Raison sociale', 'ICE', 'Ville', EXPORT_COLUMN_ICE, EXPORT_COLUMN_STATUS]);
    expect(back[1]).toEqual(['Acme', '1534290000057', 'Rabat', '001534290000057', 'AUTO_REPAIRED_EXCEL_LEADING_ZEROS']);
    expect(back[3]).toEqual(['Gamma', '001534290000075', 'Salé', '', 'INVALID_CHECKSUM_OR_FORMAT']);
    expect(back[4]?.[3]).toBe('');
  });

  it('sans en-tête : aucune ligne de données perdue', () => {
    const data: readonly (readonly string[])[] = [['A', '3042032000080'], ['B', '001534290000057']];
    const audit = auditIceColumn(data, 1, false);
    expect(audit.summary.total).toBe(2);
    const back = parseCsv(buildCorrectedCsv(data, audit, false, ';')).rows;
    expect(back).toHaveLength(2);
    expect(back[0]?.[2]).toBe('003042032000080');
  });

  it('une cellule d’origine en formule est neutralisée à l’export', () => {
    const evil: readonly (readonly string[])[] = [['nom', 'ICE'], ['=HYPERLINK("http://x")', '001534290000057']];
    const csv = buildCorrectedCsv(evil, auditIceColumn(evil, 1, true), true, ';');
    expect(parseCsv(csv).rows[1]?.[0]).toBe('\'=HYPERLINK("http://x")');
  });

  it('colonne invalide : erreur explicite', () => {
    expect(() => auditIceColumn(rows, -1, true)).toThrow(RangeError);
  });
});

describe('lecture .xlsx sans dépendance', () => {
  it('lit la première feuille : chaînes partagées (runs riches, entités), inlineStr, nombres bruts, cellules clairsemées', async () => {
    const rows = await readXlsxRows(buildXlsxFixture());
    expect(rows[0]).toEqual(['Raison sociale', 'ICE']);
    expect(rows[1]).toEqual(['Société A & B', '1534290000057']);
    expect(rows[2]).toEqual(['Société C', '003042032000080']);
    expect(rows[3]).toEqual([]);
    expect(rows[4]).toEqual(['', '1.53429E+12', '', '']);
  });

  it('une cellule numérique tronquée par Excel est réparée de bout en bout ; la notation scientifique est signalée', async () => {
    const sheet = await readSheet('tiers.xlsx', buildXlsxFixture());
    expect(sheet.format).toBe('xlsx');
    const audit = auditIceColumn(sheet.rows, 1, true);
    const statuses = audit.rows.map((r) => r.result.status);
    expect(statuses[0]).toBe('AUTO_REPAIRED_EXCEL_LEADING_ZEROS');
    expect(statuses[1]).toBe('VALID_15');
    expect(audit.rows.find((r) => r.result.reason === 'SCIENTIFIC_NOTATION')).toBeDefined();
  });

  it('rejette un fichier qui n’est pas un ZIP, un classeur sans feuille, une partie corrompue', async () => {
    await expect(readXlsxRows(new TextEncoder().encode('ceci est du texte, pas un classeur'))).rejects.toMatchObject({ code: 'NOT_ZIP' });
    const empty = buildZip([{ name: 'autre.txt', content: 'x' }]);
    await expect(readXlsxRows(empty)).rejects.toBeInstanceOf(XlsxError);
    const noSheet = buildZip([{ name: 'xl/workbook.xml', content: WORKBOOK_XML }, { name: 'xl/_rels/workbook.xml.rels', content: WORKBOOK_RELS_XML }]);
    await expect(readXlsxRows(noSheet)).rejects.toMatchObject({ code: 'NO_SHEET' });
    const truncated = buildXlsxFixture().slice(0, 120);
    await expect(readXlsxRows(truncated)).rejects.toBeInstanceOf(XlsxError);
  });

  it('références de colonne et entités XML', () => {
    expect(columnIndexOfRef('A1')).toBe(0);
    expect(columnIndexOfRef('Z9')).toBe(25);
    expect(columnIndexOfRef('AA10')).toBe(26);
    expect(decodeXmlEntities('a &amp; b &lt;c&gt; &#233; &#xE9; &unknown;')).toBe('a & b <c> é é &unknown;');
  });
});

describe('readSheet : formats et limites', () => {
  it('reconnaît les extensions, refuse le reste, fichier vide', async () => {
    expect(sheetFormatOfName('A.CSV')).toBe('csv');
    expect(sheetFormatOfName('a.xlsx')).toBe('xlsx');
    expect(sheetFormatOfName('a.pdf')).toBeNull();
    await expect(readSheet('a.pdf', new Uint8Array([1]))).rejects.toMatchObject({ code: 'UNSUPPORTED_EXTENSION' });
    await expect(readSheet('a.csv', new Uint8Array())).rejects.toBeInstanceOf(SheetReadError);
  });

  it('CSV : séparateur et encodage rapportés', async () => {
    const sheet = await readSheet('t.csv', new TextEncoder().encode('ICE;nom\n1534290000057;A'));
    expect(sheet).toMatchObject({ format: 'csv', delimiter: ';', encoding: 'utf-8' });
    expect(sheet.rows).toHaveLength(2);
  });

  it('performance : 20 000 lignes auditées en moins d’une seconde', () => {
    const rows: string[][] = [['nom', 'ICE']];
    for (let i = 0; i < 20000; i += 1) rows.push([`T${String(i)}`, i % 2 === 0 ? '1534290000057' : '001534290000075']);
    const start = performance.now();
    const audit = auditIceColumn(rows, 1, true);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(audit.summary.total).toBe(20000);
  });
});
