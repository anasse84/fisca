import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../src/contrast.ts';
import { THEME_TOKENS } from '../src/tokens.ts';
import type { SemanticTokenName, ThemeName } from '../src/tokens.ts';

const SRC = join(import.meta.dirname, '../src');
const files = (ext: string): readonly string[] => readdirSync(SRC).filter((name) => name.endsWith(ext)).sort();
const read = (name: string): string => readFileSync(join(SRC, name), 'utf8');
const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stripCode = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

interface Rule {
  readonly selector: string;
  readonly declarations: ReadonlyMap<string, string>;
}

function parseRules(css: string): readonly Rule[] {
  const rules: Rule[] = [];
  for (const m of stripCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>();
    for (const d of (m[2] ?? '').split(';')) {
      const i = d.indexOf(':');
      if (i > 0) {
        declarations.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
      }
    }
    rules.push({ selector: (m[1] ?? '').trim(), declarations });
  }
  return rules;
}

describe('indigo : jamais en texte courant (4,32:1 en sombre, Doc_08 Section 10)', () => {
  it('le jeton --brand-indigo sombre reste sous 4,5:1 sur le fond : il est donc réservé aux icônes, bordures et anneaux', () => {
    expect(contrastRatio(THEME_TOKENS.dark['--brand-indigo'], THEME_TOKENS.dark['--bg-surface'])).toBeLessThan(4.5);
  });

  for (const name of files('.css')) {
    it(`${name} : aucune règle « color: var(--brand-indigo) »`, () => {
      for (const rule of parseRules(read(name))) {
        for (const property of ['color', '-webkit-text-fill-color', 'text-decoration-color', 'caret-color']) {
          expect(rule.declarations.get(property) ?? '', `${rule.selector} { ${property} }`).not.toMatch(/--brand-indigo/);
        }
      }
    });
  }

  for (const name of files('.tsx')) {
    it(`${name} : aucune classe texte ni fond de texte en indigo`, () => {
      expect(stripCode(read(name))).not.toMatch(/\btext-\[var\(--brand-indigo\)\]/);
      expect(stripCode(read(name))).not.toMatch(/bg-\[var\(--brand-indigo\)\][^"'`]*\btext-/);
    });
  }
});

describe('contraste texte / fond des règles CSS (≥ 4,5:1, clair et sombre)', () => {
  const resolve = (value: string, theme: ThemeName): string | null => {
    if (value === 'white') {
      return '#FFFFFF';
    }
    const m = /^var\((--[a-z-]+)\)$/.exec(value);
    return m === null ? null : (THEME_TOKENS[theme][(m[1] ?? '') as SemanticTokenName] ?? null);
  };
  for (const name of files('.css').filter((n) => n !== 'tokens.css')) {
    it(`${name}`, () => {
      for (const rule of parseRules(read(name))) {
        const color = rule.declarations.get('color');
        const background = rule.declarations.get('background') ?? rule.declarations.get('background-color');
        if (color === undefined || background === undefined) {
          continue;
        }
        for (const theme of ['light', 'dark'] as const) {
          const fg = resolve(color, theme);
          const bg = resolve(background, theme);
          if (fg !== null && bg !== null) {
            expect(contrastRatio(fg, bg), `${rule.selector} (${theme})`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    });
  }
});

describe('aucun libellé de repli en dur dans les composants à libellés', () => {
  const FRENCH_UI_TEXT =
    /Point à examiner|Valider|Rejeter|Rejeté|Validé|Montant illisible|Confiance|Fermer|Rechercher|Aucun|résultat|Document source|Révision|Saisie|Palette de commande|\bIA\b/;
  for (const name of ['AiCrafterCards.tsx', 'CommandPalette.tsx', 'SplitScreenReviewDrawer.tsx']) {
    it(`${name} : pas de texte français dans le code, pas de valeur de repli pour les libellés`, () => {
      const code = stripCode(read(name));
      expect(code).not.toMatch(FRENCH_UI_TEXT);
      expect(code).not.toMatch(/labels\??\.[A-Za-z.]+\s*(\?\?|\|\|)/);
      expect(code).not.toMatch(/\blabels = /);
    });
  }
});

describe('focus visible sur les zones défilantes (Chromium les rend focalisables au clavier)', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['review-drawer.css', '.fisca-drawer__pane:focus-visible'],
    ['grid.css', '.fisca-grid__scroller:focus-visible'],
    ['command-palette.css', '.fisca-palette__list:focus-visible'],
  ];
  for (const [name, selector] of cases) {
    it(`${name} : ${selector} dessine un anneau indigo de 2 px`, () => {
      const rule = parseRules(read(name)).find((r) => r.selector.split(',').map((x) => x.trim()).includes(selector));
      expect(rule, selector).toBeDefined();
      expect(rule?.declarations.get('outline')).toBe('2px solid var(--brand-indigo)');
    });
  }
});
