import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import HomePage from '../src/pages/[locale]/index.astro';
import PrivacyPage from '../src/pages/[locale]/confidentialite.astro';

const ROOT = join(import.meta.dirname, '..');
const BASE_CSS = readFileSync(join(ROOT, 'src/styles/base.css'), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('polices auto-hébergées (décision du propriétaire 2026-11-14)', () => {
  const faces = [...BASE_CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '');

  it('6 @font-face : latin et arabe, poids 400/600/700, swap, unicode-range, woff2 locaux', () => {
    expect(faces).toHaveLength(6);
    const seen = new Set<string>();
    for (const face of faces) {
      expect(face).toContain('font-family: "Noto Sans Arabic"');
      expect(face).toContain('font-display: swap');
      expect(face).toMatch(/unicode-range: U\+/);
      const weight = /font-weight: (\d+)/.exec(face)?.[1] ?? '';
      const url = /url\("(\/fonts\/[^"]+\.woff2)"\)/.exec(face)?.[1] ?? '';
      expect(['400', '600', '700']).toContain(weight);
      expect(url).not.toBe('');
      expect(existsSync(join(ROOT, 'public', url)), url).toBe(true);
      seen.add(`${weight}|${url}`);
    }
    expect(seen.size).toBe(6);
    expect(faces.filter((f) => f.includes('noto-sans-arabic-latin-'))).toHaveLength(3);
    expect(faces.filter((f) => f.includes('noto-sans-arabic-arabic-'))).toHaveLength(3);
  });

  it('licence OFL livrée avec les polices ; aucune police IBM Plex dans le Web (réservée aux PDF)', () => {
    const license = readFileSync(join(ROOT, 'public/fonts/OFL-noto-sans-arabic.txt'), 'utf8');
    expect(license).toContain('SIL Open Font License, Version 1.1');
    const files = readdirSync(join(ROOT, 'public/fonts'));
    expect(files.filter((f) => f.endsWith('.woff2'))).toHaveLength(6);
    expect(files.some((f) => /plex/i.test(f))).toBe(false);
    expect(BASE_CSS).not.toMatch(/IBM Plex/i);
  });

  it('aucun domaine tiers dans le CSS ni dans les sources', () => {
    expect(BASE_CSS).not.toMatch(/https?:\/\//);
    expect(BASE_CSS).not.toContain('@import');
    for (const file of walk(join(ROOT, 'src')).filter((f) => /\.(astro|css|ts)$/.test(f))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/fonts\.googleapis|fonts\.gstatic|use\.typekit|cdn\.jsdelivr|unpkg\.com|cdnjs/);
    }
  });

  it('HTML rendu : aucun lien de police tiers, aucune feuille de style externe', async () => {
    for (const component of [HomePage, PrivacyPage]) {
      for (const prefix of ['fr', 'ar', 'ary', 'en', 'zgh-latn', 'zgh-tfng']) {
        const container = await AstroContainer.create();
        const response = await container.renderToResponse(component, { params: { locale: prefix }, request: new Request(`https://fisca.ma/${prefix}/`) });
        const html = await response.text();
        for (const link of html.matchAll(/<link\b[^>]*>/gi)) {
          const tag = link[0];
          const href = /href="([^"]*)"/.exec(tag)?.[1] ?? '';
          if (/rel="(stylesheet|preload|preconnect|dns-prefetch)"/.test(tag)) expect(href, tag).not.toMatch(/^(https?:)?\/\//);
          expect(href, tag).not.toMatch(/fonts\.(googleapis|gstatic)/);
        }
        expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
      }
    }
  });
});
