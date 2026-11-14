/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lintLogicalCss } from '../src/logical-css-lint.ts';

describe('linter CSS logique', () => {
  it('accepte les propriétés logiques', () => {
    const css = `.a { margin-inline: 1rem; padding-inline-start: 4px; margin-inline-end: 0;
      border-inline-start: 1px solid; inset-inline-start: 0; text-align: start; float: inline-end;
      border-start-start-radius: 4px; padding-block: 2px; }`;
    expect(lintLogicalCss(css)).toEqual([]);
  });

  it('rejette les propriétés physiques avec ligne et nom', () => {
    const css = '.a {\n  margin-left: 1px;\n  padding-right: 2px;\n  left: 0;\n  right: 0;\n}';
    const v = lintLogicalCss(css);
    expect(v.map((x) => [x.property, x.line])).toEqual([
      ['margin-left', 2],
      ['padding-right', 3],
      ['left', 4],
      ['right', 5],
    ]);
    expect(v[0]?.suggestion).toBe('margin-inline-start');
  });

  it('rejette bordures, rayons et défilement physiques', () => {
    const css = `.a { border-left: 1px solid; border-right-color: red; border-top-left-radius: 2px;
      scroll-margin-right: 1px; padding-left: 0; margin-right: 0 }`;
    expect(lintLogicalCss(css).map((x) => x.property)).toEqual([
      'border-left',
      'border-right-color',
      'border-top-left-radius',
      'scroll-margin-right',
      'padding-left',
      'margin-right',
    ]);
  });

  it('rejette les valeurs physiques de text-align, float et clear', () => {
    const css = '.a { text-align: left; float: right; clear: both; } .b { text-align: RIGHT !important; clear: left }';
    expect(lintLogicalCss(css).map((x) => `${x.property}:${x.value}`)).toEqual([
      'text-align:left',
      'float:right',
      'text-align:RIGHT',
      'clear:left',
    ]);
  });

  it('détecte dans les at-rules imbriquées et en minifié', () => {
    const css = '@media (min-width:600px){.a{margin-left:1px}}';
    expect(lintLogicalCss(css)).toHaveLength(1);
  });

  it('ignore les commentaires, chaînes et noms de variables personnalisées', () => {
    const css = `/* margin-left: 1px */ .a { --left: 1px; content: "margin-left: 2px"; margin-inline: var(--left); }`;
    expect(lintLogicalCss(css)).toEqual([]);
  });

  it('accepte une exception documentée avec raison (ligne précédente ou même ligne)', () => {
    const before = '.a {\n  /* mercury-allow-physical: miroir de la grille PDF Factur-X */\n  margin-left: 1px;\n}';
    const same = '.a { left: 0; /* mercury-allow-physical: ancrage canvas absolu */ }';
    expect(lintLogicalCss(before)).toEqual([]);
    expect(lintLogicalCss(same)).toEqual([]);
  });

  it('refuse une exception sans raison et ne la propage pas aux lignes suivantes', () => {
    const noReason = '.a {\n  /* mercury-allow-physical: */\n  margin-left: 1px;\n}';
    expect(lintLogicalCss(noReason)).toHaveLength(1);
    const far = '.a {\n  /* mercury-allow-physical: raison */\n  margin-inline: 1px;\n  margin-left: 1px;\n}';
    expect(lintLogicalCss(far)).toHaveLength(1);
  });

  it('tokens.css respecte la règle logique', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/tokens.css', import.meta.url)), 'utf8');
    expect(lintLogicalCss(css)).toEqual([]);
  });
});
