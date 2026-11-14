import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POS_TICKET_KIND_TUPLE_LABEL } from '../src/ticketing/ticket-hash.ts';

// Lecture seule de la table du serveur (packages/ubl-xades/src/pos/hash.ts) : les deux tables ne doivent pas dériver (G2).
const serverSource = readFileSync(new URL('../../../packages/ubl-xades/src/pos/hash.ts', import.meta.url), 'utf8');

function parseServerTable(source: string): Record<string, string> {
  const block = /POS_TICKET_KIND_TUPLE_LABEL[^=]*=\s*\{([^}]*)\}/.exec(source);
  if (block === null) throw new Error('table POS_TICKET_KIND_TUPLE_LABEL introuvable dans le serveur');
  const entries = [...(block[1] ?? '').matchAll(/([A-Z_0-9]+)\s*:\s*'([A-Z_0-9]+)'/g)];
  return Object.fromEntries(entries.map((m) => [m[1] as string, m[2] as string]));
}

describe('table nature de ticket → libellé du tuple : client = serveur', () => {
  it('la table du client est identique à celle du serveur (aucune dérive, aucune valeur en plus)', () => {
    const server = parseServerTable(serverSource);
    expect(Object.keys(server).length).toBeGreaterThan(0);
    expect({ ...POS_TICKET_KIND_TUPLE_LABEL }).toEqual(server);
  });
});
