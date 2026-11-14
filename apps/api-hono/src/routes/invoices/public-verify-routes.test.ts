/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_VERIFY_HEADERS } from './public-verify.ts';
import { buildInvoiceKit, PUBLIC_UUID, EMITTER_ICE, type InvoiceKit } from './invoice-routes-test-kit.ts';

const SHA = 'a'.repeat(64);
const PATH = `/api/v1/public/verify/${PUBLIC_UUID}`;

async function kitWithView(piiRestricted = false): Promise<InvoiceKit> {
  const kit = await buildInvoiceKit();
  kit.publicViews.set(PUBLIC_UUID, { invoiceNumber: 'FAC-2026-000001', issueDate: '2026-11-13', xmlSha256: SHA, emitterIce: EMITTER_ICE, piiRestricted });
  return kit;
}

const get = async (kit: InvoiceKit, path: string): Promise<Response> => kit.app.request(`${path}?cf-turnstile-response=tok`, { method: 'GET' });

describe('GET /public/verify/:xhubUuid : route publique', () => {
  it('200 sans aucun JWT : champs publics minimaux exactement', async () => {
    const kit = await kitWithView();
    const response = await get(kit, PATH);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ invoiceNumber: 'FAC-2026-000001', issueDate: '2026-11-13', displayState: 'Validation simulée', xmlSha256: SHA, emitterIce: EMITTER_ICE });
    expect(kit.publicGuard.turnstileTokens).toEqual(['tok']);
  });

  it('jamais d’identifiant du client ni de montant, même si la vue en portait', async () => {
    const kit = await kitWithView();
    const polluted = { invoiceNumber: 'FAC-2026-000001', issueDate: '2026-11-13', xmlSha256: SHA, emitterIce: EMITTER_ICE, piiRestricted: false, customerIce: '001197530853397', totalTtcCents: 120000 };
    kit.publicViews.set(PUBLIC_UUID, polluted);
    const text = JSON.stringify(await (await get(kit, PATH)).json());
    expect(text).not.toMatch(/customer|001197530853397|total|cents|120000|buyer|client/i);
  });

  it('pii_restricted_flag = 1 : état affiché et empreinte seulement', async () => {
    const kit = await kitWithView(true);
    expect(await (await get(kit, PATH)).json()).toEqual({ displayState: 'Validation simulée', xmlSha256: SHA });
  });

  it('UUID inconnu : 404 uniforme, corps identique quelle que soit la cause', async () => {
    const kit = await kitWithView();
    const unknown = await get(kit, '/api/v1/public/verify/3f2b8c1e-5d4a-4e7b-9a10-2c6d8e0f1a99');
    expect(unknown.status).toBe(404);
    const body = (await unknown.json()) as Record<string, unknown>;
    expect(body['errorCode']).toBe('PUBLIC_VERIFY_NOT_FOUND');
    expect(JSON.stringify(body)).not.toMatch(/restreint|restricted|pii/i);
  });

  it('UUID strict v4 ou v7 : v1, v5, variante invalide, chaîne libre et injection refusés (400), v7 et majuscules acceptés', async () => {
    const kit = await kitWithView();
    for (const bad of ['3f2b8c1e-5d4a-1e7b-9a10-2c6d8e0f1a23', '3f2b8c1e-5d4a-5e7b-9a10-2c6d8e0f1a23', '3f2b8c1e-5d4a-4e7b-7a10-2c6d8e0f1a23', 'pas-un-uuid', '3f2b8c1e5d4a4e7b9a102c6d8e0f1a23', '%27%20OR%201%3D1']) {
      const response = await get(kit, `/api/v1/public/verify/${bad}`);
      expect(response.status, bad).toBe(400);
    }
    expect(kit.publicLookups).toEqual([]);
    const v7 = '018f3b5e-7c2a-7d3e-8a1b-0123456789ab';
    kit.publicViews.set(v7, { invoiceNumber: 'FAC-2026-000002', issueDate: '2026-11-13', xmlSha256: SHA, emitterIce: EMITTER_ICE, piiRestricted: false });
    expect((await get(kit, `/api/v1/public/verify/${v7.toUpperCase()}`)).status).toBe(200);
    expect(kit.publicLookups).toEqual([v7]);
  });

  it('Turnstile refusé : 403 sans consulter l’index ; limite de débit : 429 avant Turnstile', async () => {
    const kit = await kitWithView();
    kit.publicGuard.turnstileOk = false;
    expect((await get(kit, PATH)).status).toBe(403);
    kit.publicGuard.rateOk = false;
    kit.publicGuard.turnstileTokens.length = 0;
    expect((await get(kit, PATH)).status).toBe(429);
    expect(kit.publicGuard.turnstileTokens).toEqual([]);
    expect(kit.publicLookups).toEqual([]);
  });

  it('en-têtes de cache et de sécurité sur 200, 404 et 400', async () => {
    const kit = await kitWithView();
    for (const path of [PATH, '/api/v1/public/verify/3f2b8c1e-5d4a-4e7b-9a10-2c6d8e0f1a99', '/api/v1/public/verify/nope']) {
      const response = await get(kit, path);
      for (const [name, value] of Object.entries(PUBLIC_VERIFY_HEADERS)) expect(response.headers.get(name), `${path} ${name}`).toBe(value);
    }
  });

  it('l’état d’abonnement n’est JAMAIS lu : abonnement impayé ou source en panne, la vérification répond 200', async () => {
    const kit = await kitWithView();
    kit.entitlements.failing = true;
    kit.entitlements.rows = null;
    const response = await get(kit, PATH);
    expect(response.status).toBe(200);
    expect(kit.entitlements.loads).toBe(0);
  });

  it('le code de la route ne référence ni abonnement, ni droits, ni pipeline authentifié', () => {
    const source = readFileSync(new URL('./public-verify.ts', import.meta.url), 'utf8');
    const imports = source.split('\n').filter((line) => /^\s*(import|\} from)/.test(line)).join('\n');
    expect(imports).not.toMatch(/entitlement|request-pipeline|tenant-router|idempotency|sql-infrastructure/i);
    expect(source).not.toMatch(/createRequestPipeline|c\.get\('(entitlements|tenant|auth)'\)/);
  });

  it('la route n’écrit aucun journal : aucun console.* dans la route', () => {
    const source = readFileSync(new URL('./public-verify.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/console\./);
  });
});
