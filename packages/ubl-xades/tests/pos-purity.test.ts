import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = new URL('../src/pos/', import.meta.url);
const files = readdirSync(DIR).filter((name) => name.endsWith('.ts'));

/** Motifs interdits, écrits par concaténation de morceaux pour ne pas se déclencher eux-mêmes. */
const FORBIDDEN: readonly (readonly [string, RegExp])[] = [
  ['arithmétique flottante Math', new RegExp(['Ma', 'th\\.(floor|round|ceil|trunc|abs|max|min|pow)'].join(''))],
  ['conversion flottante', new RegExp(['parse', 'Float|Number\\(\\s*[\'"]\\d+\\.\\d'].join(''))],
  ['type any', new RegExp([':\\s*an', 'y\\b|as\\s+an', 'y\\b|<an', 'y>'].join(''))],
  ['suppression de contrôle', new RegExp(['@ts-', 'ignore|@ts-expect-', 'error|eslint-', 'disable'].join(''))],
  ['marqueur de code factice', new RegExp(['TO', 'DO|FIX', 'ME|HA', 'CK|PLACE', 'HOLDER|X', 'XX'].join(''))],
  ['en-tête PEM littéral', new RegExp(['-----', 'BEGIN'].join(''))],
  ['affirmation interdite', new RegExp(['conforme (à la )?D', 'GI|homolog', 'ué|certifié par'].join(''), 'i')],
  ['Date.now / Math.random (horloge et aléa injectés)', new RegExp(['Date\\.', 'now\\(|Ma', 'th\\.random'].join(''))],
];

describe('pureté de src/pos', () => {
  it.each(files)('%s : aucun motif interdit', (name) => {
    const text = readFileSync(new URL(name, DIR), 'utf8');
    for (const [label, pattern] of FORBIDDEN) expect(pattern.test(text), `${name} : ${label}`).toBe(false);
  });
  it('WebCrypto uniquement : aucun import node:crypto dans src/pos', () => {
    for (const name of files) expect(readFileSync(new URL(name, DIR), 'utf8')).not.toMatch(/node:crypto|from 'crypto'/);
  });
});
