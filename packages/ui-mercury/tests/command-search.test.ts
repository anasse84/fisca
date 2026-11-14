import { describe, expect, it } from 'vitest';
import { groupHits, normalizeSearchText, prepareCommands, searchCommands } from '../src/command-search.ts';
import type { PaletteCommand } from '../src/command-search.ts';

const commands: readonly PaletteCommand[] = [
  { id: 'inv-new', label: 'Créer une facture', group: 'Actions', keywords: ['invoice', 'vente'] },
  { id: 'simpl', label: 'Exporter un ZIP SIMPL-TVA', group: 'Actions', keywords: ['déclaration'] },
  { id: 'client-1', label: 'Société Atlas Éléctro', group: 'Dossiers' },
  { id: 'client-2', label: 'Boulangerie Al Amal', group: 'Dossiers' },
  { id: 'copilot', label: 'Interroger le copilote' },
];

describe('normalizeSearchText', () => {
  it('retire accents, casse et espaces multiples', () => {
    expect(normalizeSearchText('  Société   ÉLECTRO ')).toBe('societe electro');
  });

  it('retire les voyelles brèves et le tatwil arabes', () => {
    expect(normalizeSearchText('فَـاتُورَة')).toBe('فاتورة');
  });
});

describe('searchCommands', () => {
  const index = prepareCommands(commands);

  it('requête vide : toutes les commandes dans l’ordre fourni, bornées par la limite', () => {
    expect(searchCommands(index, '', 3).map((h) => h.command.id)).toEqual(['inv-new', 'simpl', 'client-1']);
  });

  it('préfixe de libellé avant sous-chaîne avant sous-séquence floue', () => {
    const idx = prepareCommands([
      { id: 'c', label: 'Rapport de caisse' },
      { id: 'b', label: 'Ouvrir la caisse' },
      { id: 'a', label: 'Caisse du jour' },
      { id: 'z', label: 'Clôture annuelle des comptes' },
    ]);
    expect(searchCommands(idx, 'caisse').map((h) => h.command.id)).toEqual(['a', 'b', 'c']);
    expect(searchCommands(idx, 'clcpt').map((h) => h.command.id)).toEqual(['z']);
  });

  it('insensible aux accents et à la casse', () => {
    expect(searchCommands(index, 'CREER').map((h) => h.command.id)).toEqual(['inv-new']);
    expect(searchCommands(index, 'electro').map((h) => h.command.id)).toEqual(['client-1']);
  });

  it('cherche aussi dans les mots-clés', () => {
    expect(searchCommands(index, 'invoice').map((h) => h.command.id)).toEqual(['inv-new']);
  });

  it('tous les mots de la requête doivent correspondre', () => {
    expect(searchCommands(index, 'zip tva').map((h) => h.command.id)).toEqual(['simpl']);
    expect(searchCommands(index, 'zip atlas')).toEqual([]);
  });

  it('aucun résultat pour une requête sans correspondance', () => {
    expect(searchCommands(index, 'xyzzy')).toEqual([]);
  });

  it('scores entiers et ordre stable à score égal', () => {
    const idx = prepareCommands([
      { id: '1', label: 'Facture A' },
      { id: '2', label: 'Facture B' },
    ]);
    const hits = searchCommands(idx, 'facture');
    expect(hits.map((h) => h.command.id)).toEqual(['1', '2']);
    expect(hits.every((h) => Number.isInteger(h.score))).toBe(true);
  });

  it('respecte la limite', () => {
    const many = prepareCommands(Array.from({ length: 300 }, (_, i) => ({ id: `${i}`, label: `Dossier ${i}` })));
    expect(searchCommands(many, 'dossier', 50)).toHaveLength(50);
  });
});

describe('groupHits', () => {
  const index = prepareCommands(commands);

  it('regroupe par groupe en conservant l’ordre d’apparition et l’ordre plat de navigation', () => {
    const groups = groupHits(searchCommands(index, ''));
    expect(groups.map((g) => g.group)).toEqual(['Actions', 'Dossiers', '']);
    expect(groups.flatMap((g) => g.hits.map((h) => h.command.id))).toEqual(['inv-new', 'simpl', 'client-1', 'client-2', 'copilot']);
  });

  it('place d’abord le groupe du meilleur résultat', () => {
    const groups = groupHits(searchCommands(index, 'atlas'));
    expect(groups.map((g) => g.group)).toEqual(['Dossiers']);
  });
});

describe('performance : résultat en moins de 150 ms sur 5 000 commandes (Doc_08 Section 05)', () => {
  const big: PaletteCommand[] = Array.from({ length: 5000 }, (_, i) => ({
    id: `cmd-${i}`,
    label: `Dossier client ${i} — Société ${i % 97} SARL`,
    group: i % 2 === 0 ? 'Dossiers' : 'Actions',
    keywords: [`ICE00${i}`, 'client'],
  }));

  it('indexation puis recherche floue sous 150 ms', () => {
    const t0 = performance.now();
    const index = prepareCommands(big);
    const hits = searchCommands(index, 'soc 4999 sarl');
    const grouped = groupHits(hits);
    const elapsed = performance.now() - t0;
    expect(hits.map((h) => h.command.id)).toContain('cmd-4999');
    expect(grouped.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(150);
  });

  it('frappe suivante sur index déjà prêt sous 150 ms', () => {
    const index = prepareCommands(big);
    const t0 = performance.now();
    const hits = searchCommands(index, 'dscl');
    const elapsed = performance.now() - t0;
    expect(hits.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(150);
  });
});
