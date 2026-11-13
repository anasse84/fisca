import { describe, expect, it } from 'vitest';
import { buildLlmsTxt, buildLlmsFullTxt } from '../src/seo/llms.ts';
import { EDITORIAL_PAGES } from '../src/content/pages.ts';
import { PRICING_PLANS } from '../src/content/pricing.ts';
import { formatCentsMad } from '../src/lib/money.ts';
import { handleLlmsTxt, handleLlmsFullTxt } from '../src/seo/handlers.ts';

const FORBIDDEN = /conforme|homologu|certifi/i;

describe('llms.txt', () => {
  const txt = buildLlmsTxt(PRICING_PLANS, EDITORIAL_PAGES);

  it('commence par un H1 et un résumé, et nomme l’éditeur', () => {
    expect(txt.startsWith('# Fisca')).toBe(true);
    expect(txt).toContain('> ');
    expect(txt).toContain('SYNAPTIC SYSTEMS SARL AU');
    expect(txt).toContain('Rabat');
  });

  it('contient les sections attendues', () => {
    for (const h of ['## Éditeur', '## Tarifs publics', '## Guides et pages', '## Barèmes fiscaux', '## Accès agents']) {
      expect(txt).toContain(h);
    }
  });

  it('liste chaque offre avec son prix formaté depuis pricing.ts', () => {
    for (const p of PRICING_PLANS) {
      const cents = p.kind === 'RECURRING' ? p.monthly_ht_cents : p.one_off_ht_cents;
      expect(txt).toContain(formatCentsMad(cents));
      expect(txt).toContain(p.name);
    }
  });

  it('lie chaque page éditoriale à son miroir .md', () => {
    expect(txt).toContain('https://fisca.ma/fr/index.md');
    expect(txt).toContain('https://fisca.ma/zgh-tfng/index.md');
  });

  it('ne code aucun barème, aucune formulation interdite, aucune date de réforme', () => {
    expect(txt).not.toMatch(FORBIDDEN);
    expect(txt).not.toMatch(/\b20(2[5-9]|3\d)\b/);
    expect(txt).not.toMatch(/\d\s?%/);
    expect(txt).toContain('valeur datée, à saisir depuis les tables');
  });

  it('est déterministe', () => {
    expect(buildLlmsTxt(PRICING_PLANS, EDITORIAL_PAGES)).toBe(txt);
  });
});

describe('llms-full.txt', () => {
  const full = buildLlmsFullTxt(PRICING_PLANS, EDITORIAL_PAGES);

  it('contient les sections détaillées', () => {
    for (const h of ['## Éditeur', '## Grille tarifaire', '## Arbre des guides', '## Barèmes fiscaux', '## Accès agents']) {
      expect(full).toContain(h);
    }
  });

  it('détaille mensuel et annuel HT et le pack Mowakaba', () => {
    expect(full).toContain('129,00 MAD');
    expect(full).toContain('1 290,00 MAD');
    expect(full).toContain('18 000,00 MAD');
    expect(full).toContain('PACK_MOWAKABA_TPME');
  });

  it('renvoie les barèmes aux tables D1 / Wiki sans valeur', () => {
    expect(full).toContain('D1');
    expect(full).toContain('valeur datée, à saisir depuis les tables');
  });

  it('aucune formulation interdite ni date de réforme', () => {
    expect(full).not.toMatch(FORBIDDEN);
    expect(full).not.toMatch(/\b20(2[5-9]|3\d)\b/);
  });
});

describe('handlers llms', () => {
  it('servent text/plain ou markdown en UTF-8, sans cookie', async () => {
    for (const handler of [handleLlmsTxt, handleLlmsFullTxt]) {
      const res = handler();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(res.headers.get('set-cookie')).toBeNull();
      expect((await res.text()).length).toBeGreaterThan(200);
    }
  });
});
