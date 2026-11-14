/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_TOKENS, contrastRatio } from '@fisca/ui-mercury';
import type { SemanticTokenName } from '@fisca/ui-mercury';

const css = readFileSync(fileURLToPath(new URL('./pme-ops.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: (m[1] ?? '').trim(), body: m[2] ?? '' }));
const colorOf = (body: string): string | null => /(?:^|;|\s)color\s*:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? null;

describe('pme-ops.css : contraste des libellés comptables (T-P2B-08)', () => {
  it('chaque règle comptable (acct, th, td, total, table, caption) déclare le texte principal', () => {
    const accounting = rules.filter((r) => /__acct|__total|__table|__th|__td|__caption/.test(r.selector) && colorOf(r.body) !== null);
    expect(accounting.length).toBeGreaterThanOrEqual(4);
    for (const r of accounting) expect(colorOf(r.body), r.selector).toBe('var(--text-primary)');
  });
  it('les en-têtes de grille passent au texte principal (la grille générique utilise le secondaire)', () => {
    const header = rules.find((r) => r.selector === '.fisca-pme .fisca-grid__header');
    expect(colorOf(header?.body ?? '')).toBe('var(--text-primary)');
  });
  it('les pastilles de statut gardent le texte principal : le ton passe par fond, bordure et icône', () => {
    const badge = rules.find((r) => r.selector === '.fisca-pme-ops__badge');
    expect(colorOf(badge?.body ?? '')).toBe('var(--text-primary)');
    for (const r of rules.filter((x) => /__badge\[data-tone/.test(x.selector) && !/icon/.test(x.selector))) expect(colorOf(r.body), r.selector).toBeNull();
  });
  it('aucun texte secondaire ni --brand-indigo en couleur de texte dans cette feuille', () => {
    for (const r of rules) {
      const c = colorOf(r.body) ?? '';
      expect(c, r.selector).not.toContain('text-secondary');
      expect(c, r.selector).not.toContain('brand-indigo');
    }
  });
  it('aucune propriété physique (RTL) : seulement des propriétés logiques', () => {
    expect(css).not.toMatch(/\b(margin|padding|border)-(left|right)\b|\btext-align\s*:\s*(left|right)\b|(^|[\s;{])(left|right)\s*:/);
  });
  for (const theme of ['light', 'dark'] as const) {
    const t = THEME_TOKENS[theme];
    const token = (name: SemanticTokenName): string => t[name];
    for (const bg of ['--bg-surface', '--bg-subtle', '--status-warning-bg', '--status-danger-bg', '--status-cleared-bg'] as const) {
      it(`${theme} : texte principal sur ${bg} (pastilles, lignes, tableaux) ≥ 7:1`, () => {
        expect(contrastRatio(token('--text-primary'), token(bg))).toBeGreaterThanOrEqual(7);
      });
    }
  }
});
