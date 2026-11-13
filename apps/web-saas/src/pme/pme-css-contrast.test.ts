/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_TOKENS, contrastRatio } from '@fisca/ui-mercury';
import type { SemanticTokenName } from '@fisca/ui-mercury';

const dir = fileURLToPath(new URL('.', import.meta.url));
/** Lecture directe sur disque : Vitest ne rend pas le contenu des CSS importés (css désactivé par défaut). */
const cssFiles = readdirSync(dir).filter((f: string) => f.endsWith('.css'));
const cssSources: Record<string, string> = Object.fromEntries(cssFiles.map((f: string) => [f, readFileSync(`${dir}${f}`, 'utf8')]));

interface Rule {
  readonly file: string;
  readonly selector: string;
  readonly body: string;
}

function parseRules(file: string): Rule[] {
  const css = (cssSources[file] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null = re.exec(css);
  while (m !== null) {
    rules.push({ file, selector: (m[1] ?? '').trim(), body: m[2] ?? '' });
    m = re.exec(css);
  }
  return rules;
}

const rules = cssFiles.flatMap(parseRules);

function colorOf(rule: Rule): string | null {
  const m = /(?:^|;|\s)color\s*:\s*([^;]+)/.exec(rule.body);
  return m === null ? null : (m[1] ?? '').trim();
}

/** Sélecteurs non comptables : seuls autorisés à utiliser le texte secondaire (6,9:1). */
const NON_ACCOUNTING = /--muted|__hint|__meta|__legend-note/;

describe('CSS de l’espace PME : contraste (décision du pilote)', () => {
  it('au moins une feuille de style existe', () => {
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  it('--brand-indigo n’est jamais utilisé en texte', () => {
    for (const r of rules) {
      expect(colorOf(r) ?? '', `${r.file} ${r.selector}`).not.toContain('brand-indigo');
    }
  });

  it('seules des variables sémantiques en couleur de texte (aucun hex ni couleur nommée)', () => {
    for (const r of rules) {
      const c = colorOf(r);
      if (c === null) continue;
      expect(c, `${r.selector}`).toMatch(/^(var\(--[a-z-]+\)|inherit|currentColor)$/);
    }
  });

  it('le texte secondaire n’apparaît que sur des sélecteurs non comptables', () => {
    const offenders = rules.filter((r) => colorOf(r)?.includes('--text-secondary') === true && !NON_ACCOUNTING.test(r.selector));
    expect(offenders.map((r) => r.selector)).toEqual([]);
  });

  it('les libellés comptables déclarent le texte principal (montants, lignes, totaux, en-têtes de tableau)', () => {
    const accounting = rules.filter((r) => /__acct|__amount|__total|__table|__th|__td|__caption/.test(r.selector) && colorOf(r) !== null);
    expect(accounting.length).toBeGreaterThan(0);
    for (const r of accounting) {
      expect(colorOf(r), r.selector).toBe('var(--text-primary)');
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    const t = THEME_TOKENS[theme];
    const token = (name: SemanticTokenName): string => t[name];
    for (const bg of ['--bg-canvas', '--bg-surface', '--bg-subtle'] as const) {
      it(`${theme} : texte principal sur ${bg} ≥ 7:1`, () => {
        expect(contrastRatio(token('--text-primary'), token(bg))).toBeGreaterThanOrEqual(7);
      });
    }
    for (const bg of ['--status-warning-bg', '--status-danger-bg', '--status-cleared-bg'] as const) {
      it(`${theme} : texte principal sur ${bg} ≥ 7:1 (corps des bannières)`, () => {
        expect(contrastRatio(token('--text-primary'), token(bg))).toBeGreaterThanOrEqual(7);
      });
    }
    it(`${theme} : texte secondaire sur fond de surface ≥ 4,5:1 (non comptable seulement)`, () => {
      expect(contrastRatio(token('--text-secondary'), token('--bg-surface'))).toBeGreaterThanOrEqual(4.5);
    });
  }
});
