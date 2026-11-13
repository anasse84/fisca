import { describe, expect, it } from 'vitest';
import { ALL_EDITORIAL_PAGES, EDITORIAL_PAGES, findEditorialPage, findEditorialPageByMirrorPath, findEditorialPageByPath, mirrorPathOf } from '../src/content/pages.ts';
import { SILOS, SILO_CONTENT_PAGES, SILO_HUB_PAGES, SILO_HUB_SLUGS, SILO_ROUTES, assertSiloCounts, findSiloRoute, siloRouteCount } from '../src/content/silos/registry.ts';
import { SILO_ORDER, SILO_ROUTE_COUNTS } from '../src/content/silos/types.ts';
import { MARKETING_LOCALES, LOCALE_URL_PREFIX } from '../src/i18n/locales.ts';

describe('registre des silos : 78 routes canoniques, 468 URL', () => {
  it('comptes par silo 18 / 32 / 16 / 12 et 78 au total', () => {
    expect(SILO_ROUTE_COUNTS).toEqual({ clearance: 18, 'cgi-simpl': 32, 'metiers-pos': 16, regions: 12 });
    for (const id of SILO_ORDER) expect(siloRouteCount(id), id).toBe(SILO_ROUTE_COUNTS[id]);
    expect(SILO_ROUTES).toHaveLength(78);
    expect(() => assertSiloCounts()).not.toThrow();
  });

  it('468 URL de contenu (78 x 6 langues), toutes distinctes', () => {
    expect(SILO_CONTENT_PAGES).toHaveLength(468);
    const urls = new Set(SILO_CONTENT_PAGES.map((p) => `${LOCALE_URL_PREFIX[p.locale]}/${p.slug}`));
    expect(urls.size).toBe(468);
  });

  it('chaque route existe dans les 6 langues', () => {
    for (const route of SILO_ROUTES) {
      for (const locale of MARKETING_LOCALES) expect(findEditorialPage(locale, route.slug), `${locale}/${route.slug}`).toBeDefined();
    }
  });

  it('slugs : minuscules ASCII, uniques, sans année (B-13), hors langue', () => {
    const slugs = SILO_ROUTES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(78);
    for (const slug of [...slugs, ...SILO_HUB_SLUGS]) {
      expect(slug, slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/);
      expect(slug, slug).not.toMatch(/20(2[5-9]|3\d)/);
    }
  });

  it('4 hubs /<locale>/<silo-slug> dans les 6 langues, hors des 78 routes', () => {
    expect(SILOS.map((s) => s.slug)).toEqual(['clearance-xhub', 'cgi-flux-simpl', 'metiers-oec-pos', 'regions-mowakaba']);
    expect(SILO_HUB_PAGES).toHaveLength(24);
    for (const silo of SILOS) {
      for (const locale of MARKETING_LOCALES) {
        const hub = findEditorialPage(locale, silo.slug);
        expect(hub, `${locale}/${silo.slug}`).toBeDefined();
        expect(hub?.noindex).toBe(false);
        expect(findEditorialPageByPath(`/${LOCALE_URL_PREFIX[locale]}/${silo.slug}`)?.slug).toBe(silo.slug);
      }
      expect(findSiloRoute(silo.slug)).toBeUndefined();
    }
  });

  it('le socle T-P2C-03 reste à 18 pages ; le registre complet ajoute 24 hubs, 468 pages de silos et 36 pages d’outils (T-P2C-06 et T-P2C-07)', () => {
    expect(EDITORIAL_PAGES).toHaveLength(18);
    expect(ALL_EDITORIAL_PAGES).toHaveLength(18 + 24 + 468 + 36);
  });

  it('chemins HTML et miroirs .md imbriqués', () => {
    const page = findEditorialPage('ar', 'clearance-xhub/avoir-ubl-381');
    expect(page).toBeDefined();
    if (page === undefined) return;
    expect(mirrorPathOf(page)).toBe('/ar/clearance-xhub/avoir-ubl-381.md');
    expect(findEditorialPageByMirrorPath('/ar/clearance-xhub/avoir-ubl-381.md')?.locale).toBe('ar');
    expect(findEditorialPageByPath('/zgh-tfng/clearance-xhub/avoir-ubl-381/')?.locale).toBe('zgh-Tfng');
  });

  it('Silo 5 : une page par région, 12 régions distinctes', () => {
    const regions = SILO_ROUTES.filter((r) => r.silo === 'regions');
    expect(regions).toHaveLength(12);
    const titles = new Set(regions.map((r) => r.spec.title.fr));
    expect(titles.size).toBe(12);
  });
});
