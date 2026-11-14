import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fiscaNumClass, wrapLtrIsolated } from '../src/lib/numeric.ts';

const SRC = new URL('../src/', import.meta.url).pathname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('Mercury : discipline CSS', () => {
  const files = walk(SRC).filter((f) => /\.(css|astro|ts)$/.test(f));

  it('aucune couleur hexadécimale hors tokens.css', () => {
    for (const f of files.filter((x) => !x.endsWith('tokens.css'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![-\w])/);
    }
  });

  it('aucune propriété physique left/right', () => {
    for (const f of files.filter((x) => /\.(css|astro)$/.test(x))) {
      const css = readFileSync(f, 'utf8');
      expect(css, f).not.toMatch(/(margin|padding|border)-(left|right)\s*:/);
      expect(css, f).not.toMatch(/text-align\s*:\s*(left|right)/);
      expect(css, f).not.toMatch(/(^|[\s{;])(left|right)\s*:/);
    }
  });

  it('tokens.css définit clair et sombre via prefers-color-scheme', () => {
    const t = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');
    expect(t).toContain('prefers-color-scheme: dark');
    expect(t).toContain('--bg-canvas');
    expect(t).toContain('tabular-nums');
  });

  it('aucun texte de conformité DGI/xHub', () => {
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/(conforme|homologu|certifi)\w*\s+(par\s+)?(la\s+)?(DGI|xHub)/i);
    }
  });
});

describe('utilitaire numérique', () => {
  it('classe tabular-nums', () => {
    expect(fiscaNumClass()).toBe('fisca-tabular-num');
  });
  it('enveloppe dir=ltr', () => {
    expect(wrapLtrIsolated('001234567000089')).toEqual({ dir: 'ltr', class: 'fisca-tabular-num', text: '001234567000089' });
  });
});
