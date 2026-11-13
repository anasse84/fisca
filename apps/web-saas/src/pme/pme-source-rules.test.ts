/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('.', import.meta.url));
const names = readdirSync(dir).filter((f: string) => /\.(ts|tsx|css)$/.test(f));
const sources: Record<string, string> = Object.fromEntries(names.map((f: string) => [`./${f}`, readFileSync(`${dir}${f}`, 'utf8')]));
const prod = Object.keys(sources).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|test-kit/.test(f));
const read = (f: string): string => (sources[f] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('code de production de l’espace PME : lois du dépôt', () => {
  it('contient des fichiers de production', () => {
    expect(prod.length).toBeGreaterThan(5);
  });
  it('aucun seuil, taux, plafond ni année de règle écrit en dur', () => {
    for (const f of prod.filter((x) => x !== './amount-in-words.ts')) {
      const code = read(f);
      expect(code, f).not.toMatch(/\b(20\d\d)\b/);
      expect(code, f).not.toMatch(/\b(5000|50000|80000|400000|1000|2000|1400|700)\b(?!\s*n\b)/);
    }
  });
  it('aucun flottant monétaire : pas de parseFloat, toFixed ni Number(x)/100', () => {
    for (const f of prod) {
      const code = read(f);
      expect(code, f).not.toMatch(/parseFloat|toFixed|Number\([^)]*\)\s*\/\s*100/);
    }
  });
  it('aucun libellé de repli en dur : pas de ?? "texte" ni de || "texte" sur des libellés', () => {
    for (const f of prod) {
      expect(read(f), f).not.toMatch(/(\?\?|\|\|)\s*['"`][A-Za-zÀ-ÿ\u0600-\u06FF]{3,}/);
    }
  });
  it('aucune propriété CSS physique (RTL)', () => {
    for (const f of Object.keys(sources).filter((x) => x.endsWith('.css'))) {
      expect(read(f).replace(/\.css$/, ''), f).not.toMatch(/\b(margin|padding)-(left|right)\b|\btext-align\s*:\s*(left|right)\b|(^|[\s;{])(left|right)\s*:/);
    }
  });
  it('aucune affirmation « conforme / homologué / certifié »', () => {
    for (const f of prod) {
      expect(read(f), f).not.toMatch(/conforme|homologu|certifi/i);
    }
  });
});
