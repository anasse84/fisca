import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFecAmountToCents } from '../src/tools/fec-amount.ts';
import { checkFecBytes, checkFecText, isValidFecFileName } from '../src/tools/fec-check.ts';
import type { FecCheckResult, FecIssueCode } from '../src/tools/fec-check.ts';
import { FEC_MA_PROVISIONAL_PROFILE, fecColumnIndex } from '../src/tools/fec-profile.ts';

interface FecVector {
  readonly id: string;
  readonly source: string;
  readonly state: string;
  readonly rule_date: string;
  readonly input: { readonly lines: readonly string[]; readonly line_ending: 'CRLF' | 'LF'; readonly file_name?: string };
  readonly expected: {
    readonly ok: boolean;
    readonly codes?: readonly string[];
    readonly codes_include?: readonly string[];
    readonly total_debit_cents?: number;
    readonly total_credit_cents?: number;
    readonly entry_count?: number;
    readonly line_count?: number;
    readonly first_line?: number;
    readonly found?: number;
    readonly column?: string;
    readonly entry_debit_cents?: number;
    readonly entry_credit_cents?: number;
    readonly hash_verified?: boolean;
    readonly hash_filled_lines?: number;
  };
}
const GOLD = JSON.parse(readFileSync(new URL('./golden/validateur-ubl-fec.vectors.json', import.meta.url), 'utf8')) as {
  readonly rule_date: string;
  readonly state: string;
  readonly columns: readonly string[];
  readonly fec_vectors: readonly FecVector[];
};

function textOf(v: FecVector): string {
  const eol = v.input.line_ending === 'CRLF' ? '\r\n' : '\n';
  return v.input.lines.join(eol) + eol;
}
function run(v: FecVector): FecCheckResult {
  return checkFecText(textOf(v), v.input.file_name === undefined ? {} : { fileName: v.input.file_name });
}
function codes(r: FecCheckResult): string[] {
  return r.issues.map((i) => i.code);
}
function vector(id: string): FecVector {
  const found = GOLD.fec_vectors.find((v) => v.id === id);
  if (found === undefined) throw new Error(`vecteur absent : ${id}`);
  return found;
}

/** Motifs interdits dans les sources (AGENTS.md loi 10), assemblés par morceaux pour ne pas se déclencher eux-mêmes. */
const FORBIDDEN_SOURCE = new RegExp(
  ['parse' + 'Float', 'to' + 'Fixed', 'Math\\.(round|floor|ceil|trunc)\\(', ':\\s*an' + 'y\\b', '\\bas an' + 'y\\b', 'eslint' + '-disable', '@ts' + '-ignore', '\\.sk' + 'ip\\(', '\\.on' + 'ly\\('].join('|'),
);

describe('profil FEC-MA provisoire : constante unique', () => {
  it('24 colonnes dans l’ordre des spécifications : 18 standard puis 6 extensions marocaines', () => {
    expect(FEC_MA_PROVISIONAL_PROFILE.columns).toHaveLength(24);
    expect([...FEC_MA_PROVISIONAL_PROFILE.columns]).toEqual([...GOLD.columns]);
    expect(FEC_MA_PROVISIONAL_PROFILE.columns.slice(0, 18).join('|')).toBe(
      'JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise',
    );
    expect(FEC_MA_PROVISIONAL_PROFILE.columns.slice(18).join('|')).toBe('TiersIF|TiersICE|ClearanceUUID|ModePaiementDGI|EntryHashSHA256|PrevHashSHA256');
    expect(FEC_MA_PROVISIONAL_PROFILE.standardColumnCount + FEC_MA_PROVISIONAL_PROFILE.extensionColumnCount).toBe(24);
    expect(FEC_MA_PROVISIONAL_PROFILE.state).toBe('PROVISOIRE');
    expect(FEC_MA_PROVISIONAL_PROFILE.separator).toBe('|');
    expect(FEC_MA_PROVISIONAL_PROFILE.lineEnding).toBe('\r\n');
    expect(fecColumnIndex('Debit')).toBe(11);
    expect(fecColumnIndex('PrevHashSHA256')).toBe(23);
    expect(() => fecColumnIndex('Inconnue' as never)).toThrow(RangeError);
  });

  it('le commentaire exact de provisoire précède la constante, une seule constante porte les noms', () => {
    const source = readFileSync(new URL('../src/tools/fec-profile.ts', import.meta.url), 'utf8');
    expect(source).toContain('// profil provisoire, noms des 18 colonnes standard NON RECOUPÉS avec le texte marocain, à confirmer par le propriétaire\nexport const FEC_MA_PROVISIONAL_PROFILE');
    for (const file of ['fec-check.ts', 'fec-amount.ts', 'copy/ubl-fec-ui.ts', 'ui/ubl-fec-ui.ts']) {
      const other = readFileSync(new URL(`../src/tools/${file}`, import.meta.url), 'utf8');
      expect(other, file).not.toContain("'JournalLib'");
      expect(other, file).not.toContain("'TiersICE'");
    }
  });

  it('les vecteurs d’or portent date et état de recoupement (B-09)', () => {
    expect(GOLD.rule_date).toBe('2026-11-13');
    expect(GOLD.state).toBe('PROVISOIRE');
    for (const v of GOLD.fec_vectors) {
      expect(v.rule_date, v.id).toBe('2026-11-13');
      expect(['RECOUPÉ', 'NON RECOUPÉ', 'PROVISOIRE'], v.id).toContain(v.state);
      expect(v.source, v.id).toMatch(/Doc_07|Doc_14/);
    }
  });
});

describe('montants du FEC : décimal textuel -> centimes entiers', () => {
  it('virgule ou point, deux décimales au plus, cellule vide = zéro', () => {
    expect(parseFecAmountToCents('1200,50')).toBe(120050n);
    expect(parseFecAmountToCents('1200.50')).toBe(120050n);
    expect(parseFecAmountToCents('0,1')).toBe(10n);
    expect(parseFecAmountToCents('0.01')).toBe(1n);
    expect(parseFecAmountToCents('12')).toBe(1200n);
    expect(parseFecAmountToCents('')).toBe(0n);
    expect(parseFecAmountToCents('  7,05 ')).toBe(705n);
  });
  it('refuse trois décimales, signe, milliers, exposant, séparateurs doubles, lettres', () => {
    for (const bad of ['12,345', '-5,00', '+5', '1 200,50', '1,200.50', '1e3', '1,', ',5', '1..5', 'abc', '12,3,4', '99999999999999,00']) {
      expect(parseFecAmountToCents(bad), bad).toBeNull();
    }
  });
  it('propriété : aller-retour exact sur 2 000 montants pseudo-aléatoires, virgule et point', () => {
    let seed = 20261113;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let i = 0; i < 2000; i += 1) {
      const whole = next() % 100000000;
      const frac = next() % 100;
      const text = `${String(whole)}${i % 2 === 0 ? ',' : '.'}${String(frac).padStart(2, '0')}`;
      expect(parseFecAmountToCents(text), text).toBe(BigInt(whole) * 100n + BigInt(frac));
    }
  });
});

describe('FEC : vecteurs d’or', () => {
  for (const id of ['FEC-OK', 'FEC-CENTS-EXACT', 'FEC-NAME-OK', 'FEC-HASH-NOT-VERIFIED']) {
    it(`${id} : aucun problème de structure`, () => {
      const v = vector(id);
      const r = run(v);
      expect(codes(r), id).toEqual([]);
      expect(r.ok).toBe(true);
      if (v.expected.total_debit_cents !== undefined) expect(r.stats.totalDebitCents).toBe(v.expected.total_debit_cents);
      if (v.expected.total_credit_cents !== undefined) expect(r.stats.totalCreditCents).toBe(v.expected.total_credit_cents);
      if (v.expected.entry_count !== undefined) expect(r.stats.entryCount).toBe(v.expected.entry_count);
      if (v.expected.line_count !== undefined) expect(r.stats.lineCount).toBe(v.expected.line_count);
    });
  }

  it('FEC-OK : le nom de fichier est contrôlé quand il est fourni, omis sinon', () => {
    const v = vector('FEC-OK');
    expect(run(v).fileNameChecked).toBe(true);
    expect(checkFecText(textOf(v)).fileNameChecked).toBe(false);
  });

  it('AN absent', () => {
    expect(codes(run(vector('FEC-AN-ABSENT')))).toEqual(vector('FEC-AN-ABSENT').expected.codes);
  });

  it('AN pas en tête : la ligne fautive est celle du premier AN après un autre journal', () => {
    const v = vector('FEC-AN-NOT-FIRST');
    const r = run(v);
    expect(codes(r)).toEqual(v.expected.codes);
    expect(r.issues[0]?.line).toBe(v.expected.first_line);
  });

  it('23 colonnes et 25 colonnes : ligne et nombre trouvé', () => {
    for (const id of ['FEC-23-COLUMNS', 'FEC-25-COLUMNS']) {
      const v = vector(id);
      const r = run(v);
      expect(codes(r), id).toEqual(['COLUMN_COUNT']);
      expect(r.issues[0]?.line).toBe(v.expected.first_line);
      expect(r.issues[0]?.found).toBe(v.expected.found);
    }
  });

  it('mauvais séparateur : détecté sur l’en-tête, le contrôle s’arrête', () => {
    const r = run(vector('FEC-SEMICOLON'));
    expect(codes(r)).toEqual(['WRONG_SEPARATOR']);
    expect(r.issues[0]?.detail).toBe(';');
    const tab = checkFecText(`${FEC_MA_PROVISIONAL_PROFILE.columns.join('\t')}\r\n`);
    expect(tab.issues[0]?.detail).toBe('TAB');
    expect(checkFecText(`${FEC_MA_PROVISIONAL_PROFILE.columns.join(',')}\r\n`).issues[0]?.detail).toBe(',');
  });

  it('LF au lieu de CRLF : les 6 fins de ligne sont comptées ; CR seul aussi', () => {
    const r = run(vector('FEC-LF-ONLY'));
    expect(codes(r)).toEqual(['LINE_ENDING_LF']);
    expect(r.issues[0]?.found).toBe(6);
    const cr = checkFecText(textOf({ ...vector('FEC-OK'), input: { ...vector('FEC-OK').input, line_ending: 'CRLF' } }).replace(/\r\n/g, '\r'));
    expect(codes(cr)).toEqual(['LINE_ENDING_CR']);
    const mixed = textOf(vector('FEC-OK')).replace('\r\n', '\n');
    expect(codes(checkFecText(mixed))).toEqual(['LINE_ENDING_LF']);
  });

  it('déséquilibre d’une pièce : écart d’un centime, écriture et fichier', () => {
    const v = vector('FEC-ENTRY-UNBALANCED');
    const r = run(v);
    expect(codes(r)).toEqual(v.expected.codes);
    const entry = r.issues.find((i) => i.code === 'ENTRY_UNBALANCED');
    expect(entry?.debitCents).toBe(v.expected.entry_debit_cents);
    expect(entry?.creditCents).toBe(v.expected.entry_credit_cents);
    expect(entry?.entryNum).toBe('2');
  });

  it('équilibre par écriture ET sur le fichier : +1 et -1 centime se compensent au niveau du fichier, pas des écritures', () => {
    const v = vector('FEC-ENTRY-UNBALANCED-FILE-BALANCED');
    const r = run(v);
    expect(codes(r)).toEqual(v.expected.codes);
    expect(r.stats.totalDebitCents).toBe(v.expected.total_debit_cents);
    expect(r.stats.totalCreditCents).toBe(v.expected.total_credit_cents);
    expect(r.issueTotals['FILE_UNBALANCED']).toBeUndefined();
  });

  it('montant à trois décimales refusé ; AN déséquilibré détecté à part', () => {
    const amount = run(vector('FEC-AMOUNT-3-DECIMALS'));
    expect(codes(amount)).toContain('AMOUNT_INVALID');
    expect(amount.issues.find((i) => i.code === 'AMOUNT_INVALID')?.column).toBe('Debit');
    expect(codes(run(vector('FEC-AN-UNBALANCED')))).toEqual(vector('FEC-AN-UNBALANCED').expected.codes);
    const an = run(vector('FEC-AN-UNBALANCED')).issues.find((i) => i.code === 'AN_UNBALANCED');
    expect(an?.debitCents).toBe(1000000);
    expect(an?.creditCents).toBe(999999);
  });

  it('nom de fichier {IF}FEC{YYYYMMDD}.txt', () => {
    for (const id of ['FEC-NAME-BAD-DATE', 'FEC-NAME-NO-IF', 'FEC-NAME-WRONG-EXT']) expect(codes(run(vector(id))), id).toEqual(['FILE_NAME']);
    expect(isValidFecFileName('12345678FEC20261231.txt')).toBe(true);
    expect(isValidFecFileName('1FEC20240229.txt')).toBe(true);
    expect(isValidFecFileName('1FEC20250229.txt')).toBe(false);
    expect(isValidFecFileName('12345678fec20261231.txt')).toBe(false);
    expect(isValidFecFileName('12345678FEC2026123.txt')).toBe(false);
  });

  it('empreintes SHA-256 : continuité jamais vérifiée, dite explicitement, lignes renseignées comptées', () => {
    const v = vector('FEC-HASH-NOT-VERIFIED');
    const r = run(v);
    expect(r.hashChain.verified).toBe(v.expected.hash_verified);
    expect(r.hashChain.reason).toBe('FORMULA_NOT_DOCUMENTED');
    expect(r.hashChain.filledLines).toBe(v.expected.hash_filled_lines);
    const none = run(vector('FEC-OK'));
    expect(none.hashChain.verified).toBe(false);
    expect(none.hashChain.filledLines).toBe(0);
  });

  it('chaque vecteur rend le verdict attendu (ok et liste de codes)', () => {
    for (const v of GOLD.fec_vectors) {
      const r = run(v);
      expect(r.ok, v.id).toBe(v.expected.ok);
      if (v.expected.codes !== undefined) expect(codes(r), v.id).toEqual(v.expected.codes);
      for (const c of v.expected.codes_include ?? []) expect(codes(r), v.id).toContain(c);
    }
  });
});

describe('FEC : fichier, encodage, en-tête, cas limites', () => {
  const base = vector('FEC-OK');
  it('UTF-8 valide exigé : octets invalides = NOT_UTF8 ; UTF-8 avec accents accepté', () => {
    expect(checkFecBytes(new Uint8Array([0xff, 0xfe, 0x41])).issues.map((i) => i.code)).toEqual(['NOT_UTF8']);
    const accents = textOf(base).replace('Capital', 'Capital social é').replace('5141 lib', 'Journal à');
    const bytes = new TextEncoder().encode(accents);
    expect(checkFecBytes(bytes).ok).toBe(true);
    expect(checkFecBytes(new TextEncoder().encode(textOf(base))).ok).toBe(true);
  });
  it('BOM signalé, fichier vide signalé', () => {
    expect(codes(checkFecText(`\uFEFF${textOf(base)}`))).toEqual(['BOM']);
    expect(codes(checkFecText(''))).toEqual(['EMPTY_FILE']);
    expect(codes(checkFecBytes(new Uint8Array([])))).toEqual(['EMPTY_FILE']);
  });
  it('en-tête : première ligne = noms du profil, positions fautives listées ; mauvais compte signalé', () => {
    const swapped = textOf(base).replace('JournalCode|JournalLib', 'JournalLib|JournalCode');
    const r = checkFecText(swapped);
    expect(codes(r)).toEqual(['HEADER_MISMATCH']);
    expect(r.issues[0]?.detail).toBe('1,2');
    const short = textOf(base).replace('|PrevHashSHA256', '');
    expect(codes(checkFecText(short))).toContain('HEADER_COLUMN_COUNT');
    const dataFirst = base.input.lines.slice(1).join('\r\n');
    expect(codes(checkFecText(dataFirst))).toContain('HEADER_MISMATCH');
  });
  it('ligne vide et numéro d’écriture vide signalés', () => {
    const lines = [...base.input.lines];
    lines.splice(3, 0, '');
    expect(codes(checkFecText(`${lines.join('\r\n')}\r\n`))).toEqual(['EMPTY_LINE']);
    const noNum = base.input.lines.map((l, i) => (i === 3 ? l.replace('|VT lib|2|', '|VT lib||') : l));
    expect(codes(checkFecText(`${noNum.join('\r\n')}\r\n`))).toContain('EMPTY_ENTRY_NUM');
  });
  it('un fichier sans CRLF final est accepté ; le total listé est plafonné à 20 anomalies par code avec total exact', () => {
    expect(checkFecText(base.input.lines.join('\r\n')).ok).toBe(true);
    const many = [base.input.lines[0] ?? '', base.input.lines[1] ?? '', base.input.lines[2] ?? ''];
    for (let i = 0; i < 30; i += 1) many.push('a|b');
    const r = checkFecText(`${many.join('\r\n')}\r\n`);
    expect(r.issues.filter((i) => i.code === 'COLUMN_COUNT')).toHaveLength(20);
    expect(r.issueTotals['COLUMN_COUNT']).toBe(30);
  });
  it('propriété : aucune valeur non entière dans les sorties (aucun flottant), sur tous les vecteurs', () => {
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'number') expect(Number.isInteger(value), path).toBe(true);
      else if (Array.isArray(value)) value.forEach((x, i) => walk(x, `${path}[${String(i)}]`));
      else if (typeof value === 'object' && value !== null) for (const [k, x] of Object.entries(value)) walk(x, `${path}.${k}`);
    };
    for (const v of GOLD.fec_vectors) walk(run(v), v.id);
    expect(FEC_MA_PROVISIONAL_PROFILE.columns.length).toBeGreaterThan(0);
  });
  it('les sources du validateur ne contiennent ni flottant, ni any, ni marqueur interdit', () => {
    for (const file of ['fec-profile.ts', 'fec-amount.ts', 'fec-check.ts', 'xml-lite.ts', 'ubl-check.ts', 'conventions.ts']) {
      const source = readFileSync(new URL(`../src/tools/${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(FORBIDDEN_SOURCE);
    }
  });
});

describe('codes d’anomalie : exhaustivité', () => {
  it('chaque code déclenché par les vecteurs existe dans le type FecIssueCode', () => {
    const known: readonly FecIssueCode[] = [
      'EMPTY_FILE', 'NOT_UTF8', 'BOM', 'LINE_ENDING_LF', 'LINE_ENDING_CR', 'EMPTY_LINE', 'WRONG_SEPARATOR', 'HEADER_COLUMN_COUNT', 'HEADER_MISMATCH', 'COLUMN_COUNT',
      'AMOUNT_INVALID', 'AMOUNT_TOO_LARGE', 'EMPTY_ENTRY_NUM', 'AN_ABSENT', 'AN_NOT_FIRST', 'AN_UNBALANCED', 'ENTRY_UNBALANCED', 'FILE_UNBALANCED', 'FILE_NAME',
    ];
    for (const v of GOLD.fec_vectors) for (const c of codes(run(v))) expect(known).toContain(c);
  });
});
