import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AMOUNT_IN_WORDS_MAX_CENTS,
  AmountInWordsError,
  amountInWords,
  amountInWordsAr,
  amountInWordsFr,
  ARRETE_PREFIXES,
  buildArreteSentences,
} from '../src/index.ts';

/** Même fichier de vecteurs que les tests JUnit du conteneur (une seule source de vérité). */
interface WordsVector {
  readonly id: string;
  readonly status: string;
  readonly statusNote: string;
  readonly input: { readonly amountCents: string };
  readonly expected?: { readonly fr: string; readonly ar: string };
  readonly expectedError?: string;
}

const FILE = JSON.parse(readFileSync(new URL('./golden/amount-in-words.vectors.json', import.meta.url), 'utf8')) as {
  readonly schema: string;
  readonly maxCents: string;
  readonly prefixes: Record<string, { readonly fr: string; readonly ar: string }>;
  readonly vectors: readonly WordsVector[];
};

describe('vecteurs d’or des arrêtés en toutes lettres', () => {
  const accepted = FILE.vectors.filter((vector) => vector.expected !== undefined);
  const rejected = FILE.vectors.filter((vector) => vector.expectedError !== undefined);

  it('au moins 40 montants, états PROVISOIRE avec la mention de relecture native', () => {
    expect(FILE.schema).toBe('fisca.golden-vectors/1');
    expect(accepted.length).toBeGreaterThanOrEqual(40);
    expect(rejected.length).toBeGreaterThanOrEqual(2);
    for (const vector of FILE.vectors) {
      expect(vector.status).toBe('PROVISOIRE');
      expect(vector.statusNote).toBe('PROVISOIRE — orthographe à faire relire par un locuteur natif');
    }
  });

  it('couvre les montants imposés par le ticket', () => {
    const cents = new Set(accepted.map((vector) => vector.input.amountCents));
    for (const required of ['0', '100', '200', '300', '1000', '1100', '2100', '7100', '8000', '8100', '9100', '10000', '20000', '20100', '100000', '120000', '200000', '100000000', '1234567890']) {
      expect(cents.has(required), required).toBe(true);
    }
  });

  it('le plafond du fichier est celui du code', () => {
    expect(BigInt(FILE.maxCents)).toBe(AMOUNT_IN_WORDS_MAX_CENTS);
  });

  it.each(accepted.map((vector) => [vector.id, vector] as const))('%s : FR et AR', (_id, vector) => {
    const cents = BigInt(vector.input.amountCents);
    expect(amountInWordsFr(cents)).toBe(vector.expected?.fr);
    expect(amountInWordsAr(cents)).toBe(vector.expected?.ar);
    expect(amountInWords(cents)).toEqual(vector.expected);
  });

  it.each(rejected.map((vector) => [vector.id, vector] as const))('%s : refus', (_id, vector) => {
    const cents = BigInt(vector.input.amountCents);
    for (const fn of [amountInWordsFr, amountInWordsAr, amountInWords]) {
      expect(() => fn(cents)).toThrow(AmountInWordsError);
    }
    expect(() => amountInWords(cents)).toThrow(expect.objectContaining({ code: vector.expectedError }));
  });
});

describe('arrêté complet', () => {
  it('préfixes identiques au fichier de vecteurs (rejoué aussi par JUnit)', () => {
    for (const code of ['380', '381', '383', '386', '389'] as const) {
      expect(ARRETE_PREFIXES.fr[code]).toBe(FILE.prefixes[code]?.fr);
      expect(ARRETE_PREFIXES.ar[code]).toBe(FILE.prefixes[code]?.ar);
    }
  });
  it('phrase du ticket pour une facture', () => {
    expect(buildArreteSentences('380', 122050n).fr).toBe('Arrêtée la présente facture à la somme de : mille deux cent vingt dirhams et cinquante centimes');
    expect(buildArreteSentences('380', 122050n).ar).toBe('أوقفت هذه الفاتورة عند مبلغ: ألف ومائتان وعشرون درهما وخمسون سنتيما');
  });
  it('préfixe masculin pour un avoir', () => {
    expect(buildArreteSentences('381', 100n).fr.startsWith('Arrêté le présent avoir')).toBe(true);
  });
});

describe('propriétés', () => {
  it('déterministe, sans flottant : mêmes entrées, mêmes sorties, sur une grille de valeurs', () => {
    let state = 12345n;
    for (let index = 0; index < 400; index += 1) {
      state = (state * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
      const cents = state % (AMOUNT_IN_WORDS_MAX_CENTS + 1n);
      expect(amountInWords(cents)).toEqual(amountInWords(cents));
      expect(amountInWordsFr(cents)).toMatch(/dirhams?/);
      expect(amountInWordsAr(cents)).toMatch(/درهم|دراهم/);
    }
  });
  it('refuse un type non bigint', () => {
    expect(() => amountInWordsFr(12 as unknown as bigint)).toThrow(AmountInWordsError);
  });
});
