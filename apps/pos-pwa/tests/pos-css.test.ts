import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_TOKENS, contrastRatio } from '@fisca/ui-mercury';
import type { SemanticTokenName, ThemeName } from '@fisca/ui-mercury';

const CSS = readFileSync(join(import.meta.dirname, '../src/ui/pos.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  readonly selector: string;
  readonly declarations: ReadonlyMap<string, string>;
  readonly media: string;
}

function parse(css: string): readonly Rule[] {
  const rules: Rule[] = [];
  const walk = (block: string, media: string): void => {
    let i = 0;
    while (i < block.length) {
      const open = block.indexOf('{', i);
      if (open < 0) break;
      const selector = block.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < block.length && depth > 0) {
        if (block[j] === '{') depth += 1;
        if (block[j] === '}') depth -= 1;
        j += 1;
      }
      const body = block.slice(open + 1, j - 1);
      if (selector.startsWith('@media')) walk(body, selector);
      else {
        const declarations = new Map<string, string>();
        for (const d of body.split(';')) {
          const k = d.indexOf(':');
          if (k > 0) declarations.set(d.slice(0, k).trim(), d.slice(k + 1).trim());
        }
        rules.push({ selector, declarations, media });
      }
      i = j;
    }
  };
  walk(css, '');
  return rules;
}

const rules = parse(CSS);
const resolve = (value: string, theme: ThemeName): string | null => {
  const m = /^var\((--[a-z-]+)\)$/.exec(value);
  return m === null ? null : (THEME_TOKENS[theme][(m[1] ?? '') as SemanticTokenName] ?? null);
};

describe('cibles tactiles (Doc_08 § 06 : 56 × 56 px en tablette POS, 44 px minimum en mobile)', () => {
  it('--pos-touch vaut 56px par défaut et jamais moins de 44px sous 768 px', () => {
    const root = rules.find((r) => r.selector.includes('.pos-root') && r.media === '' && r.declarations.has('--pos-touch'));
    expect(root?.declarations.get('--pos-touch')).toBe('56px');
    const mobile = rules.find((r) => r.media.includes('max-width: 767px') && r.declarations.has('--pos-touch'));
    const px = Number(/^(\d+)px$/.exec(mobile?.declarations.get('--pos-touch') ?? '')?.[1]);
    expect(px).toBeGreaterThanOrEqual(44);
  });

  it('toute règle de contrôle interactif impose min-inline-size et min-block-size = var(--pos-touch)', () => {
    const targets = rules.filter((r) => r.declarations.get('--pos-target') === 'touch');
    expect(targets.length).toBeGreaterThanOrEqual(6);
    for (const r of targets) {
      expect(r.declarations.get('min-block-size'), r.selector).toBe('var(--pos-touch)');
      expect(r.declarations.get('min-inline-size'), r.selector).toBe('var(--pos-touch)');
    }
  });

  it('les sélecteurs button, [role="radio"], input sont tous couverts par une règle cible tactile', () => {
    const touch = rules.filter((r) => r.declarations.get('min-block-size') === 'var(--pos-touch)').map((r) => r.selector).join(',');
    for (const needle of ['button', '[role="radio"]', 'input']) expect(touch, needle).toContain(needle);
  });
});

describe('contraste : libellés comptables au jeton de texte principal (≥ 7:1, clair et sombre)', () => {
  it('--text-primary sur --bg-surface, --bg-canvas et --bg-subtle ≥ 7:1', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const bg of ['--bg-surface', '--bg-canvas', '--bg-subtle'] as const) {
        expect(contrastRatio(THEME_TOKENS[theme]['--text-primary'], THEME_TOKENS[theme][bg]), `${theme} ${bg}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('les libellés comptables (montants, totaux, libellés de ligne) utilisent var(--text-primary)', () => {
    const accounting = rules.filter((r) => r.declarations.get('--pos-text') === 'accounting');
    expect(accounting.length).toBeGreaterThanOrEqual(3);
    for (const r of accounting) expect(r.declarations.get('color'), r.selector).toBe('var(--text-primary)');
  });

  it('chaque couple color / background déclaré dans pos.css atteint 7:1 dans les deux thèmes', () => {
    for (const r of rules) {
      const color = r.declarations.get('color');
      const bg = r.declarations.get('background') ?? r.declarations.get('background-color');
      if (color === undefined || bg === undefined) continue;
      for (const theme of ['light', 'dark'] as const) {
        const fg = resolve(color, theme);
        const back = resolve(bg, theme);
        if (fg !== null && back !== null) expect(contrastRatio(fg, back), `${r.selector} (${theme})`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('--brand-indigo n’est jamais une couleur de texte', () => {
    for (const r of rules) {
      for (const prop of ['color', '-webkit-text-fill-color', 'text-decoration-color', 'caret-color']) expect(r.declarations.get(prop) ?? '', r.selector).not.toContain('--brand-indigo');
    }
  });

  it('anneau de focus visible : outline 2px solid var(--brand-indigo) avec décalage', () => {
    const focus = rules.find((r) => r.selector.includes(':focus-visible'));
    expect(focus?.declarations.get('outline')).toBe('2px solid var(--brand-indigo)');
    expect(focus?.declarations.get('outline-offset')).toBeDefined();
  });
});

describe('CSS logique et tokens', () => {
  it('aucune propriété physique (left, right, margin-left, padding-right, text-align left/right)', () => {
    expect(CSS).not.toMatch(/(^|[\s;{])(margin|padding|border)-(left|right)\s*:/m);
    expect(CSS).not.toMatch(/(^|[\s;{])(left|right)\s*:/m);
    expect(CSS).not.toMatch(/text-align\s*:\s*(left|right)/);
  });

  it('aucune couleur hexadécimale : variables sémantiques seulement', () => {
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('montants en chiffres tabulaires', () => {
    expect(CSS).toMatch(/tabular-nums/);
  });

  it('retour visuel au toucher sous 50 ms (transition ≤ 50 ms sur :active)', () => {
    expect(CSS).toMatch(/:active/);
    const durations = [...CSS.matchAll(/transition(?:-duration)?\s*:[^;]*?(\d+)ms/g)].map((m) => Number(m[1]));
    for (const d of durations) expect(d).toBeLessThanOrEqual(50);
  });
});
