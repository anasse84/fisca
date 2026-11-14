import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../src');
const strip = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** Littéraux de chaîne et texte JSX (hors imports) : seuls ces fragments peuvent porter un libellé affiché. */
function textLiterals(code: string): string[] {
  const body = code.replace(/^import .*$/gm, '');
  const out: string[] = [];
  for (const m of body.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`|>([^<>{}\n]+)</g)) out.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '');
  return out.filter((t) => /\s|[A-ZÀ-Ý]/u.test(t));
}
const uiFiles = readdirSync(join(SRC, 'ui')).filter((n) => n.endsWith('.tsx'));

describe('aucun libellé en dur ni repli dans les composants', () => {
  const FRENCH = /Vente|Panier|Régler|Règlement|Espèces|Carte|Valider|Imprimer|Quantité|Articles|Total|Rendu|Tiroir|Ticket|Facture|Fermer|Retour|Monnaie|hors ligne|Hors ligne/;
  it('au moins cinq composants tsx', () => {
    expect(uiFiles.length).toBeGreaterThanOrEqual(5);
  });
  for (const name of uiFiles) {
    it(`${name} : pas de texte français, pas de « labels.x ?? », pas de classe physique`, () => {
      const code = strip(readFileSync(join(SRC, 'ui', name), 'utf8'));
      expect(textLiterals(code).filter((t) => FRENCH.test(t))).toEqual([]);
      expect(code).not.toMatch(/labels\??\.[A-Za-z.]+\s*(\?\?|\|\|)/);
      expect(code).not.toMatch(/\b(ml|mr|pl|pr)-[0-9[]|\btext-(left|right)\b/);
    });
  }
});

describe('périmètre : aucune importation de web-saas, aucune route inventée', () => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(join(dir, e.name));
    }
  };
  for (const d of ['ui', 'sale', 'printing', 'b2b']) walk(join(SRC, d));
  it('jamais d’import depuis apps/web-saas', () => {
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/web-saas/);
  });
  it('la caisse n’appelle jamais convert-b2b (route du client B2B, CTR-API-17)', () => {
    for (const f of files) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/convert-b2b|\/api\/v1\//);
  });
});
