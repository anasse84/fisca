import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CIUS_MA_PROVISIONAL,
  resolveSchema,
  SCHEMA_DISPLAY_NAME,
  UblSchemaError,
} from '../src/index.ts';

const packageRoot = new URL('../', import.meta.url);

describe('resolveSchema', () => {
  it.each([
    ['invoice', 'UBL-Invoice-2.1.xsd'],
    ['credit-note', 'UBL-CreditNote-2.1.xsd'],
    ['debit-note', 'UBL-DebitNote-2.1.xsd'],
  ] as const)('%s → XSD officiel OASIS vendorisé', (kind, file) => {
    const schema = resolveSchema(kind, '2.1');
    expect(schema.path.endsWith(`/xsd/maindoc/${file}`)).toBe(true);
    expect(existsSync(schema.path)).toBe(true);
    expect(schema.name).toBe('OASIS UBL 2.1 officiel');
    expect(SCHEMA_DISPLAY_NAME).toBe('OASIS UBL 2.1 officiel');
    expect(schema.official).toBe(true);
  });

  it('refuse une version ou un type inconnu', () => {
    expect(() => resolveSchema('invoice', '2.2' as '2.1')).toThrow(UblSchemaError);
    expect(() => resolveSchema('order' as 'invoice', '2.1')).toThrow(UblSchemaError);
  });

  it('chaque XSD vendorisé correspond à l’empreinte consignée dans SOURCE.md', () => {
    const source = readFileSync(new URL('xsd/SOURCE.md', packageRoot), 'utf8');
    const rows = [...source.matchAll(/\| `(xsd\/[^`]+)` \| ([0-9a-f]{64}) \|/g)];
    expect(rows.length).toBeGreaterThanOrEqual(17);
    for (const row of rows) {
      const [, file, hash] = row;
      const digest = createHash('sha256').update(readFileSync(new URL(file as string, packageRoot))).digest('hex');
      expect(digest).toBe(hash);
    }
    expect(source).toContain('https://docs.oasis-open.org/ubl/os-UBL-2.1/UBL-2.1.zip');
  });
});

describe('profil cius-ma-provisional', () => {
  const profile = JSON.parse(readFileSync(new URL('profiles/cius-ma-provisional/profile.json', packageRoot), 'utf8')) as {
    name: string;
    status: string;
    customizationId: string;
    profileId: string;
    ublVersionId: string;
    mapping: Record<string, unknown>;
  };

  it('porte l’état provisoire et les identifiants hypothétiques', () => {
    expect(profile.name).toBe('cius-ma-provisional');
    expect(profile.status).toContain('PROVISOIRE');
    expect(profile.customizationId).toBe('ma:cius-ma-provisional:1.0');
    expect(profile.profileId).toBe('ma:cius-ma-provisional:1.0');
    expect(profile.ublVersionId).toBe('2.1');
  });

  it('est identique aux constantes du générateur', () => {
    expect(CIUS_MA_PROVISIONAL.customizationId).toBe(profile.customizationId);
    expect(CIUS_MA_PROVISIONAL.profileId).toBe(profile.profileId);
    expect(CIUS_MA_PROVISIONAL.ublVersionId).toBe(profile.ublVersionId);
    expect(JSON.stringify(profile.mapping)).toContain('MA:ICE');
    expect(JSON.stringify(profile.mapping)).toContain('MA:IF');
  });

  it('README : mention obligatoire et aucune revendication de conformité officielle', () => {
    const readme = readFileSync(new URL('profiles/cius-ma-provisional/README.md', packageRoot), 'utf8');
    expect(readme).toContain(
      'PROVISOIRE — règles marocaines dérivées de Doc_07, non publiées par la DGI, conformité officielle non vérifiée',
    );
    const forbidden = new RegExp([['conform', 'e DGI'], ['homolog', 'u'], ['certifi', 'é']].map((parts) => parts.join('')).join('|'), 'i');
    expect(readme).not.toMatch(forbidden);
  });
});
