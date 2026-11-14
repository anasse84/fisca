import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { API_V1_ROUTE_CONTRACTS } from '../../core/api-v1-contracts.ts';
import { openApiPathOf } from '../../core/openapi-document.ts';
import { INVOICE_ROUTE_CONTRACTS } from './invoice-route-schemas.ts';

describe('contrats des routes invoices (CTR-API-14, 15, 18) : prêts pour openapi:gen', () => {
  it('trois contrats, chemins et méthodes du registre, aucun doublon avec le socle', () => {
    expect(INVOICE_ROUTE_CONTRACTS.map((c) => `${c.registryId} ${c.method.toUpperCase()} ${c.path}`)).toEqual([
      'CTR-API-14 POST /api/v1/invoices/:id/certify',
      'CTR-API-15 POST /api/v1/invoices/:id/cdv-response',
      'CTR-API-18 GET /api/v1/public/verify/:xhubUuid',
    ]);
    const known = new Set(API_V1_ROUTE_CONTRACTS.map((c) => c.path));
    for (const contract of INVOICE_ROUTE_CONTRACTS) expect(known.has(contract.path)).toBe(false);
    expect(INVOICE_ROUTE_CONTRACTS.map((c) => openApiPathOf(c.path))).toContain('/api/v1/public/verify/{xhubUuid}');
  });

  it('tous les schémas Zod se convertissent en JSON Schema (comme openapi:gen) ; écriture : Idempotency-Key, pas de Company-Id pour la route publique', () => {
    for (const contract of INVOICE_ROUTE_CONTRACTS) {
      for (const schema of [contract.params, contract.body, ...contract.success.map((s) => s.schema)]) {
        if (schema !== undefined) expect(() => z.toJSONSchema(schema, { target: 'draft-2020-12' })).not.toThrow();
      }
      expect(contract.idempotencyKey).toBe(contract.method === 'post');
    }
    const publicContract = INVOICE_ROUTE_CONTRACTS.find((c) => c.registryId === 'CTR-API-18');
    expect(publicContract).toMatchObject({ auth: 'NONE', companyHeader: false });
  });

  it('les réponses de succès n’autorisent aucune clé supplémentaire (objets stricts)', () => {
    for (const contract of INVOICE_ROUTE_CONTRACTS) {
      for (const success of contract.success) {
        const json = z.toJSONSchema(success.schema, { target: 'draft-2020-12' });
        expect(JSON.stringify(json)).toContain('"additionalProperties":false');
      }
    }
  });
});
