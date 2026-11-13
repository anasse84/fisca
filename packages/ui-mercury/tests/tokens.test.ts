/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHexColor, relativeLuminance } from '../src/contrast.ts';
import {
  DENSITY_TOKENS,
  SEMANTIC_TOKEN_NAMES,
  THEME_TOKENS,
  parseTokenDeclarations,
} from '../src/tokens.ts';

const css = readFileSync(fileURLToPath(new URL('../src/tokens.css', import.meta.url)), 'utf8');

function blockOf(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `sélecteur ${selector} absent`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

const SPEC_LIGHT = {
  '--bg-canvas': '#FAF9F5',
  '--bg-surface': '#FFFFFF',
  '--bg-subtle': '#F2EFE9',
  '--text-primary': '#141413',
  '--text-secondary': '#5C5A54',
  '--line-border': '#E4E1D8',
  '--brand-emerald': '#0F5338',
  '--brand-indigo': '#4F46E5',
  '--status-cleared-bg': '#E3F2E9',
  '--status-cleared-text': '#0B4F32',
  '--status-warning-bg': '#F8EEDB',
  '--status-warning-text': '#8A5300',
  '--status-danger-bg': '#FCE8E6',
  '--status-danger-text': '#A51D24',
} as const;

const SPEC_DARK = {
  '--bg-canvas': '#0B0E14',
  '--bg-surface': '#121722',
  '--bg-subtle': '#181F2E',
  '--text-primary': '#F3F4F6',
  '--text-secondary': '#9CA3AF',
  '--line-border': '#222B3A',
  '--brand-emerald': '#10B981',
  '--brand-indigo': '#6366F1',
  '--status-cleared-bg': '#092E20',
  '--status-cleared-text': '#34D399',
  '--status-warning-bg': '#2E210B',
  '--status-warning-text': '#FBBF24',
  '--status-danger-bg': '#311114',
  '--status-danger-text': '#F87171',
} as const;

describe('tokens.css — thèmes Mercury Hybride', () => {
  it('thème clair : canvas #FAF9F5 et tous les tokens sémantiques de la Section 02', () => {
    const light = parseTokenDeclarations(blockOf(':root,'));
    for (const [name, value] of Object.entries(SPEC_LIGHT)) {
      expect(light.get(name), name).toBe(value);
    }
    expect(light.get('--bg-canvas')).toBe('#FAF9F5');
  });

  it('thème clair identique sous :root et [data-theme="light"]', () => {
    expect(css).toMatch(/:root,\s*\[data-theme="light"\]\s*\{/);
  });

  it('thème sombre : canvas #0B0E14 et tous les tokens sémantiques de la Section 02', () => {
    const dark = parseTokenDeclarations(blockOf('[data-theme="dark"]'));
    for (const [name, value] of Object.entries(SPEC_DARK)) {
      expect(dark.get(name), name).toBe(value);
    }
    expect(dark.get('--bg-canvas')).toBe('#0B0E14');
  });

  it('densité : 44px par défaut, 28px en mode compact', () => {
    expect(parseTokenDeclarations(blockOf(':root,')).get('--table-row-height')).toBe('44px');
    expect(parseTokenDeclarations(blockOf('[data-density="compact"]')).get('--table-row-height')).toBe('28px');
  });

  it('classe .fisca-tabular-num : chiffres tabulaires et isolation bidi', () => {
    const body = blockOf('.fisca-tabular-num');
    expect(body).toContain('tabular-nums lining-nums');
    expect(body).toContain('unicode-bidi: isolate');
  });

  it('le module TS reflète exactement le CSS', () => {
    const light = parseTokenDeclarations(blockOf(':root,'));
    const dark = parseTokenDeclarations(blockOf('[data-theme="dark"]'));
    for (const name of SEMANTIC_TOKEN_NAMES) {
      expect(THEME_TOKENS.light[name], name).toBe(light.get(name));
      expect(THEME_TOKENS.dark[name], name).toBe(dark.get(name));
    }
    expect(SEMANTIC_TOKEN_NAMES).toHaveLength(14);
    expect(DENSITY_TOKENS).toEqual({ comfortable: '44px', compact: '28px' });
  });

  it('aucun token sombre ne manque et aucun token surnuméraire dans le sombre', () => {
    const dark = parseTokenDeclarations(blockOf('[data-theme="dark"]'));
    expect([...dark.keys()].sort()).toEqual([...SEMANTIC_TOKEN_NAMES].sort());
  });
});

describe('contraste WCAG 2.x', () => {
  it('calcule les valeurs de référence (noir/blanc = 21, identique = 1)', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance(parseHexColor('#FFFFFF'))).toBeCloseTo(1, 5);
  });

  it('rejette une couleur hexadécimale invalide', () => {
    expect(() => parseHexColor('rouge')).toThrow();
  });

  const themes = [
    ['clair', THEME_TOKENS.light],
    ['sombre', THEME_TOKENS.dark],
  ] as const;

  for (const [label, t] of themes) {
    const pairs: ReadonlyArray<readonly [string, string, string]> = [
      ['text-primary / bg-canvas', t['--text-primary'], t['--bg-canvas']],
      ['text-primary / bg-surface', t['--text-primary'], t['--bg-surface']],
      ['text-primary / bg-subtle', t['--text-primary'], t['--bg-subtle']],
      ['text-secondary / bg-canvas', t['--text-secondary'], t['--bg-canvas']],
      ['text-secondary / bg-surface', t['--text-secondary'], t['--bg-surface']],
      ['text-secondary / bg-subtle', t['--text-secondary'], t['--bg-subtle']],
      ['brand-emerald / bg-canvas', t['--brand-emerald'], t['--bg-canvas']],
      ['brand-emerald / bg-surface', t['--brand-emerald'], t['--bg-surface']],
      ['status-cleared-text / status-cleared-bg', t['--status-cleared-text'], t['--status-cleared-bg']],
      ['status-warning-text / status-warning-bg', t['--status-warning-text'], t['--status-warning-bg']],
      ['status-danger-text / status-danger-bg', t['--status-danger-text'], t['--status-danger-bg']],
    ];
    for (const [name, fg, bg] of pairs) {
      it(`thème ${label} : ${name} >= 4.5`, () => {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  // --brand-indigo sert au focus clavier et aux repères IA (Section 02) : composant d'interface,
  // seuil WCAG 1.4.11 de 3:1. Le sombre (#6366F1) mesure ~4,32 sur canvas et ~4,01 sur surface :
  // sous 4,5, donc non utilisable comme texte courant sans arbitrage du propriétaire.
  for (const [label, t] of themes) {
    for (const bgName of ['--bg-canvas', '--bg-surface'] as const) {
      it(`thème ${label} : brand-indigo (non-texte) / ${bgName.slice(2)} >= 3`, () => {
        expect(contrastRatio(t['--brand-indigo'], t[bgName])).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it('thème clair : brand-indigo / bg-canvas et bg-surface >= 4.5 (usable en texte)', () => {
    expect(contrastRatio(THEME_TOKENS.light['--brand-indigo'], THEME_TOKENS.light['--bg-canvas'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(THEME_TOKENS.light['--brand-indigo'], THEME_TOKENS.light['--bg-surface'])).toBeGreaterThanOrEqual(4.5);
  });
});
