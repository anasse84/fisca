import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIRECTORIES = [new URL('./', import.meta.url).pathname, new URL('../../../../../packages/ubl-xades/src/clearance/', import.meta.url).pathname];

function sources(): readonly { readonly name: string; readonly code: string }[] {
  return DIRECTORIES.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.includes('test-kit'))
      .map((name) => ({ name: join(dir, name), code: readFileSync(join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') })),
  );
}

describe('non-régression des montants : aucun flottant dans la clearance', () => {
  it('ni littéral décimal, ni Number()/parseFloat/toFixed/Math.round, ni division flottante', () => {
    const files = sources();
    expect(files.length).toBeGreaterThanOrEqual(12);
    for (const { name, code } of files) {
      const withoutStrings = code.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
      expect(withoutStrings, name).not.toMatch(/\b\d+\.\d+\b/);
      expect(withoutStrings, name).not.toMatch(/\b(parseFloat|toFixed|Math\.round|Math\.floor|Math\.ceil)\b|Number\(\s*['"]/);
      expect(withoutStrings, name).not.toMatch(new RegExp([String.raw`\b(an`, String.raw`y|@ts-ig`, String.raw`nore)\b\s*[;,)>\]]|:\s*an`, String.raw`y\b`].join('')));
    }
  });

  it('le moteur ne référence aucune allocation de numéro (le séquenceur reste seul propriétaire de la numérotation)', () => {
    for (const { name, code } of sources()) {
      expect(code, name).not.toMatch(/allocateInvoiceNumber|sequential_number\s*=|icv_counter\s*=|sha256_hash\s*=/);
    }
  });
});
