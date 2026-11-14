import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeTicketSha256 } from '../src/ticketing/ticket-hash.ts';
import { computePosTicketHash, POS_TICKET_KIND_TUPLE_LABEL } from '../../../packages/ubl-xades/src/pos/hash.ts';

const vec = JSON.parse(readFileSync(new URL('../../../packages/ubl-xades/tests/golden/pos-hash.vectors.json', import.meta.url), 'utf8')) as {
  vectors: { id: string; kind: string; input: Record<string, unknown>; expected: Record<string, string>; storedTicketKind?: string }[];
};

describe('AUDIT G2 : parité client (pos-pwa) / serveur (ubl-xades) sur le vecteur d’or', () => {
  for (const v of vec.vectors.filter((x) => x.kind === 'TICKET')) {
    const stored = v.storedTicketKind ?? 'SALE_B2C';
    const serverFields = { ...(v.input as object), ticketKind: stored } as Parameters<typeof computePosTicketHash>[0];
    it(`${v.id} : serveur (valeur STOCKÉE ${stored}) = empreinte d'or`, async () => {
      expect(await computePosTicketHash(serverFields)).toBe(v.expected['ticketSha256']);
    });
    it(`${v.id} : client alimenté par la valeur STOCKÉE (${stored}), comme ticket-issuer.ts, = serveur`, async () => {
      const client = await computeTicketSha256({ ...(v.input as object), ticketKind: stored } as Parameters<typeof computeTicketSha256>[0]);
      expect(client).toBe(await computePosTicketHash(serverFields));
    });
    it(`${v.id} : client alimenté par le libellé du tuple = serveur`, async () => {
      const label = (POS_TICKET_KIND_TUPLE_LABEL as Record<string, string>)[stored]!;
      const client = await computeTicketSha256({ ...(v.input as object), ticketKind: label } as Parameters<typeof computeTicketSha256>[0]);
      expect(client).toBe(v.expected['ticketSha256']);
    });
  }
});

import { computeZSha256 } from '../src/closing/z-closure.ts';
import { computePosClosureHash } from '../../../packages/ubl-xades/src/pos/hash.ts';
describe('AUDIT G2 : parité client/serveur sur la clôture Z', () => {
  for (const v of vec.vectors.filter((x) => x.kind === 'CLOSURE' || x.id.startsWith('POS-Z'))) {
    it(`${v.id} : client = serveur = empreinte d'or`, async () => {
      const f = v.input as never;
      expect(await computePosClosureHash(f)).toBe(v.expected['zSha256']);
      expect(await computeZSha256(f)).toBe(v.expected['zSha256']);
    });
  }
});
