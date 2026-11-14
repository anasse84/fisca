import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computeInvoicePih,
  computeInvoiceTotals,
  formatCentsDecimal,
  generateUblInvoiceXml,
  serializePihTuple,
  type InvoicePihFields,
  type UblInvoiceInput,
} from '../src/index.ts';
import { buildInput } from './support/fixtures.ts';

/** Vecteurs d'or (ERRATA B-09, section E) : chaque vecteur porte article, date de règle, état, calcul détaillé. */
const GOLDEN_DIR = new URL('./golden/', import.meta.url);
const STATES = ['RECOUPÉ', 'NON RECOUPÉ', 'PROVISOIRE'] as const;

interface VectorBase {
  readonly id: string;
  readonly title: string;
  readonly legalArticle: string;
  readonly ruleDate: string;
  readonly status: string;
  readonly calculation: string;
}
interface TotalsVector extends VectorBase {
  readonly input: Pick<UblInvoiceInput, 'lines' | 'retention' | 'stampDuty'>;
  readonly expected: Record<string, number>;
}
interface PihVector extends VectorBase {
  readonly input: InvoicePihFields;
  readonly expectedSerialization: string;
  readonly expectedHash: string;
}
interface VectorFile<T> {
  readonly schema: string;
  readonly vectors: readonly T[];
}

function load<T extends VectorBase>(name: string): VectorFile<T> {
  return JSON.parse(readFileSync(new URL(name, GOLDEN_DIR), 'utf8')) as VectorFile<T>;
}

const TOTALS_FILES = ['invoice-debours.vectors.json', 'invoice-retention-garantie.vectors.json', 'invoice-stamp-duty.vectors.json'] as const;

describe('métadonnées de tous les vecteurs', () => {
  const files = readdirSync(GOLDEN_DIR).filter((name) => name.endsWith('.vectors.json'));
  it('les six fichiers attendus existent', () => {
    expect(files.sort()).toEqual([...TOTALS_FILES, 'invoice-pih.vectors.json', 'amount-in-words.vectors.json', 'pos-hash.vectors.json'].sort());
  });
  it.each(files)('%s : article, date, état et calcul renseignés', (name) => {
    const file = load<VectorBase>(name);
    expect(file.schema).toBe('fisca.golden-vectors/1');
    expect(file.vectors.length).toBeGreaterThan(0);
    for (const vector of file.vectors) {
      expect(vector.legalArticle.length).toBeGreaterThan(10);
      expect(vector.ruleDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(STATES).toContain(vector.status);
      expect(vector.calculation.length).toBeGreaterThan(20);
    }
  });
});

describe.each(TOTALS_FILES)('rejeu des totaux : %s', (name) => {
  const file = load<TotalsVector>(name);
  it.each(file.vectors.map((vector) => [vector.id, vector] as const))('%s', (_id, vector) => {
    const input: UblInvoiceInput = { ...buildInput('380'), ...vector.input };
    const totals = computeInvoiceTotals(input);
    const actual: Record<string, number> = {
      lineExtensionCents: Number(totals.lineExtensionCents),
      vatBaseCents: Number(totals.vatBaseCents),
      disbursementsCents: Number(totals.disbursementsCents),
      taxTotalCents: Number(totals.taxTotalCents),
      stampDutyCents: Number(totals.stampDutyCents),
      taxExclusiveCents: Number(totals.taxExclusiveCents),
      taxInclusiveCents: Number(totals.taxInclusiveCents),
      retentionCents: Number(totals.retentionCents),
      payableCents: Number(totals.payableCents),
    };
    expect(actual).toEqual(vector.expected);
    // le XML porte les mêmes montants
    const xml = generateUblInvoiceXml(input);
    expect(xml).toContain(`<cbc:PayableAmount currencyID="MAD">${formatCentsDecimal(BigInt(vector.expected['payableCents'] ?? 0))}</cbc:PayableAmount>`);
  });
});

describe('rejeu des empreintes PIH', () => {
  const file = load<PihVector>('invoice-pih.vectors.json');
  it.each(file.vectors.map((vector) => [vector.id, vector] as const))('%s', async (_id, vector) => {
    expect(serializePihTuple(vector.input)).toBe(vector.expectedSerialization);
    expect(await computeInvoicePih(vector.input)).toBe(vector.expectedHash);
    expect(createHash('sha256').update(vector.expectedSerialization, 'utf8').digest('hex')).toBe(vector.expectedHash);
  });

  it('PIH-01 est l’empreinte d’or du propriétaire', () => {
    expect(file.vectors[0]?.id).toBe('PIH-01');
    expect(file.vectors[0]?.expectedHash).toBe('0ec5abda99c2661c14b933a1133263083d83965fcbea0d4d55ac147eda3aa797');
  });

  it('la chaîne PIH-01 → PIH-02 → PIH-03 se raccorde', () => {
    const hashes = file.vectors.map((vector) => vector.expectedHash);
    expect(file.vectors[1]?.input.previousPiHash).toBe(hashes[0]);
    expect(file.vectors[2]?.input.previousPiHash).toBe(hashes[1]);
  });
});
