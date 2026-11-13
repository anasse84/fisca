import { describe, expect, it } from 'vitest';
import { EDITORIAL_PAGES, findEditorialPage, findEditorialPageByPath, mirrorPathOf } from '../src/content/pages.ts';
import { MARKETING_LOCALES } from '../src/i18n/locales.ts';
import { renderPageMarkdown } from '../src/seo/mirror.ts';
import { prefersMarkdown } from '../src/seo/negotiation.ts';
import { handleMirrorRequest, negotiateMarkdown } from '../src/seo/handlers.ts';

const MD = 'text/markdown; charset=utf-8';

function req(path: string, accept?: string, method = 'GET'): Request {
  const headers = new Headers();
  if (accept !== undefined) headers.set('accept', accept);
  return new Request(`https://fisca.ma${path}`, { method, headers });
}

describe('registre des pages éditoriales', () => {
  it('contient l’accueil des 6 langues', () => {
    expect(EDITORIAL_PAGES).toHaveLength(6);
    for (const loc of MARKETING_LOCALES) {
      expect(findEditorialPage(loc, '')).toBeDefined();
    }
  });

  it('chemins miroirs', () => {
    const fr = findEditorialPage('fr', '');
    if (fr === undefined) throw new Error('accueil fr absent');
    expect(mirrorPathOf(fr)).toBe('/fr/index.md');
    const tfng = findEditorialPage('zgh-Tfng', '');
    if (tfng === undefined) throw new Error('accueil zgh-tfng absent');
    expect(mirrorPathOf(tfng)).toBe('/zgh-tfng/index.md');
  });

  it('retrouve une page par chemin HTML (avec ou sans slash final)', () => {
    expect(findEditorialPageByPath('/fr/')?.locale).toBe('fr');
    expect(findEditorialPageByPath('/fr')?.locale).toBe('fr');
    expect(findEditorialPageByPath('/zgh/')?.locale).toBe('zgh-Latn');
    expect(findEditorialPageByPath('/fr/inconnu')).toBeUndefined();
    expect(findEditorialPageByPath('/xx/')).toBeUndefined();
  });
});

describe('renderPageMarkdown', () => {
  it('Markdown pur, sans balise HTML, avec canonique et alternates', () => {
    const page = findEditorialPage('fr', '');
    if (page === undefined) throw new Error('accueil fr absent');
    const md = renderPageMarkdown(page);
    expect(md.startsWith('# ')).toBe(true);
    expect(md).not.toMatch(/<[a-z!/][^>]*>/i);
    expect(md).toContain('https://fisca.ma/fr/');
    expect(md).toContain('https://fisca.ma/ar/');
    expect(md).not.toMatch(/conforme|homologu|certifi/i);
  });
});

describe('négociation Accept', () => {
  it('markdown explicite gagne', () => {
    expect(prefersMarkdown('text/markdown')).toBe(true);
    expect(prefersMarkdown('text/markdown, text/html;q=0.8')).toBe(true);
    expect(prefersMarkdown('text/html;q=0.5, text/markdown')).toBe(true);
  });
  it('navigateur, curl, absence d’en-tête : HTML', () => {
    expect(prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe(false);
    expect(prefersMarkdown('*/*')).toBe(false);
    expect(prefersMarkdown(null)).toBe(false);
    expect(prefersMarkdown('')).toBe(false);
  });
  it('q=0 refuse le markdown ; html préféré plus fort gagne', () => {
    expect(prefersMarkdown('text/markdown;q=0, text/html')).toBe(false);
    expect(prefersMarkdown('text/markdown;q=0.5, text/html;q=0.9')).toBe(false);
  });
});

describe('handleMirrorRequest (jumeau .md)', () => {
  it('sert /fr/index.md en text/markdown UTF-8', async () => {
    const res = handleMirrorRequest(req('/fr/index.md'));
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toBe(MD);
    expect(res?.headers.get('vary')).toBe('Accept');
    expect(res?.headers.get('set-cookie')).toBeNull();
    expect(res?.headers.get('link')).toContain('https://fisca.ma/fr/');
    expect(await res?.text()).toMatch(/^# /);
  });

  it('sert les 6 langues, rend undefined hors registre', () => {
    for (const p of ['fr', 'ar', 'ary', 'zgh', 'zgh-tfng', 'en']) {
      expect(handleMirrorRequest(req(`/${p}/index.md`))?.status).toBe(200);
    }
    expect(handleMirrorRequest(req('/fr/guides/inconnu.md'))).toBeUndefined();
    expect(handleMirrorRequest(req('/fr/'))).toBeUndefined();
  });

  it('HEAD : mêmes en-têtes, sans corps', async () => {
    const res = handleMirrorRequest(req('/fr/index.md', undefined, 'HEAD'));
    expect(res?.headers.get('content-type')).toBe(MD);
    expect(await res?.text()).toBe('');
  });

  it('POST refusé en 405', () => {
    expect(handleMirrorRequest(req('/fr/index.md', undefined, 'POST'))?.status).toBe(405);
  });
});

describe('negotiateMarkdown (URL HTML + Accept)', () => {
  it('Accept: text/markdown sur /fr/ renvoie le Markdown', async () => {
    const res = negotiateMarkdown(req('/fr/', 'text/markdown'));
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toBe(MD);
    expect(res?.headers.get('vary')).toBe('Accept');
    expect(await res?.text()).toMatch(/^# /);
  });

  it('navigateur : undefined (laisse passer vers le HTML)', () => {
    expect(negotiateMarkdown(req('/fr/', 'text/html,*/*;q=0.8'))).toBeUndefined();
  });

  it('URL hors registre ou endpoint technique : undefined', () => {
    expect(negotiateMarkdown(req('/fr/inconnu', 'text/markdown'))).toBeUndefined();
    expect(negotiateMarkdown(req('/llms.txt', 'text/markdown'))).toBeUndefined();
    expect(negotiateMarkdown(req('/.well-known/mcp.json', 'text/markdown'))).toBeUndefined();
  });

  it('POST ignoré', () => {
    expect(negotiateMarkdown(req('/fr/', 'text/markdown', 'POST'))).toBeUndefined();
  });
});
