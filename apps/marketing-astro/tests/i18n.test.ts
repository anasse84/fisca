import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_URL_PREFIX,
  MARKETING_LOCALES,
  getLocaleMeta,
  localeFromPrefix,
} from '../src/i18n/locales.ts';
import { buildCanonicalUrl, buildMultilingualAlternates } from '../src/i18n/hreflang.ts';
import { resolveRootRedirect } from '../src/i18n/redirect.ts';
import { buildPageHead, splitLocalizedPath } from '../src/i18n/head.ts';

describe('routage 6 langues', () => {
  it('expose exactement 6 locales avec leur préfixe d’URL', () => {
    expect(MARKETING_LOCALES).toEqual(['fr', 'ar', 'ary', 'zgh-Latn', 'zgh-Tfng', 'en']);
    expect(LOCALE_URL_PREFIX).toEqual({
      fr: 'fr',
      ar: 'ar',
      ary: 'ary',
      'zgh-Latn': 'zgh',
      'zgh-Tfng': 'zgh-tfng',
      en: 'en',
    });
  });

  it('la locale par défaut est fr', () => {
    expect(DEFAULT_LOCALE).toBe('fr');
  });

  it('mappe préfixe -> locale et rejette les préfixes inconnus', () => {
    expect(localeFromPrefix('fr')).toBe('fr');
    expect(localeFromPrefix('zgh')).toBe('zgh-Latn');
    expect(localeFromPrefix('zgh-tfng')).toBe('zgh-Tfng');
    expect(localeFromPrefix('ary')).toBe('ary');
    expect(localeFromPrefix('de')).toBeNull();
    expect(localeFromPrefix('zgh-Tfng')).toBeNull();
    expect(localeFromPrefix('')).toBeNull();
    expect(localeFromPrefix(undefined)).toBeNull();
  });

  it('direction : rtl pour ar et ary, ltr pour fr, en, zgh-Latn et zgh-Tfng (Doc_08 S07)', () => {
    expect(getLocaleMeta('ar').dir).toBe('rtl');
    expect(getLocaleMeta('ary').dir).toBe('rtl');
    expect(getLocaleMeta('fr').dir).toBe('ltr');
    expect(getLocaleMeta('en').dir).toBe('ltr');
    expect(getLocaleMeta('zgh-Latn').dir).toBe('ltr');
    expect(getLocaleMeta('zgh-Tfng').dir).toBe('ltr');
  });

  it('métadonnées : tag BCP47 et script', () => {
    expect(getLocaleMeta('zgh-Tfng')).toMatchObject({ hreflang: 'zgh-Tfng', script: 'Tfng', prefix: 'zgh-tfng' });
    expect(getLocaleMeta('zgh-Latn')).toMatchObject({ hreflang: 'zgh-Latn', script: 'Latn', prefix: 'zgh' });
    expect(getLocaleMeta('ar')).toMatchObject({ script: 'Arab' });
    expect(getLocaleMeta('fr')).toMatchObject({ script: 'Latn' });
  });

  it('découpe un chemin localisé', () => {
    expect(splitLocalizedPath('/zgh-tfng/outils/ice')).toEqual({ locale: 'zgh-Tfng', slug: 'outils/ice' });
    expect(splitLocalizedPath('/fr/')).toEqual({ locale: 'fr', slug: '' });
    expect(splitLocalizedPath('/fr')).toEqual({ locale: 'fr', slug: '' });
    expect(splitLocalizedPath('/xx/a')).toBeNull();
    expect(splitLocalizedPath('/')).toBeNull();
  });
});

describe('hreflang et canonical', () => {
  it('génère 6 alternates + x-default avec les URL https://fisca.ma/<prefixe>/<slug>', () => {
    const links = buildMultilingualAlternates('/outils/ice');
    expect(links).toEqual([
      { hreflang: 'fr', href: 'https://fisca.ma/fr/outils/ice' },
      { hreflang: 'ar', href: 'https://fisca.ma/ar/outils/ice' },
      { hreflang: 'ary', href: 'https://fisca.ma/ary/outils/ice' },
      { hreflang: 'zgh-Latn', href: 'https://fisca.ma/zgh/outils/ice' },
      { hreflang: 'zgh-Tfng', href: 'https://fisca.ma/zgh-tfng/outils/ice' },
      { hreflang: 'en', href: 'https://fisca.ma/en/outils/ice' },
      { hreflang: 'x-default', href: 'https://fisca.ma/fr/outils/ice' },
    ]);
  });

  it('accueil : slug vide', () => {
    const links = buildMultilingualAlternates('');
    expect(links).toHaveLength(7);
    expect(links[3]).toEqual({ hreflang: 'zgh-Latn', href: 'https://fisca.ma/zgh/' });
    expect(links[6]).toEqual({ hreflang: 'x-default', href: 'https://fisca.ma/fr/' });
  });

  it('mode 3 langues (fr, ar, en) + x-default', () => {
    const links = buildMultilingualAlternates('dictionnaire/pcge', false);
    expect(links.map((l) => l.hreflang)).toEqual(['fr', 'ar', 'en', 'x-default']);
  });

  it('canonical par locale', () => {
    expect(buildCanonicalUrl('ar', '/')).toBe('https://fisca.ma/ar/');
    expect(buildCanonicalUrl('zgh-Tfng', 'a/b')).toBe('https://fisca.ma/zgh-tfng/a/b');
    expect(buildCanonicalUrl('en', '')).toBe('https://fisca.ma/en/');
  });

  it('la réciprocité : chaque page porte les mêmes 7 alternates', () => {
    const base = buildMultilingualAlternates('x');
    for (const loc of MARKETING_LOCALES) {
      expect(buildPageHead(loc, 'x', { title: 't', description: 'd' }).alternates).toEqual(base);
    }
  });
});

describe('en-tête de page', () => {
  it('html lang/dir et canonical', () => {
    const head = buildPageHead('ar', '', { title: 'T', description: 'D' });
    expect(head).toMatchObject({
      htmlLang: 'ar',
      dir: 'rtl',
      canonical: 'https://fisca.ma/ar/',
      title: 'T',
      description: 'D',
    });
    expect(buildPageHead('zgh-Tfng', '', { title: 'T', description: 'D' }).htmlLang).toBe('zgh-Tfng');
  });
});

describe('redirection de la racine', () => {
  it('redirige / vers la langue par défaut', () => {
    expect(resolveRootRedirect()).toEqual({ status: 302, location: '/fr/' });
  });
});
