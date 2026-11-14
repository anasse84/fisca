import { describe, expect, it } from 'vitest';
import { base64UrlDecodeToText, base64UrlEncodeText, hmacSha256Hex } from '../src/edge/hmac.ts';
import {
  APP_ORIGIN,
  DEFAULT_HANDOFF_TTL_SECONDS,
  HANDOFF_ENDPOINT_PATH,
  HANDOFF_QUERY_PARAM,
  MAX_HANDOFF_TTL_SECONDS,
  MIN_HANDOFF_TTL_SECONDS,
  MemoryNonceStore,
  issueHandoffLink,
  verifyHandoffToken,
} from '../src/edge/handoff.ts';
import { handleHandoffRequest } from '../src/edge/handoff-endpoint.ts';
import type { HandoffEndpointDeps } from '../src/edge/handoff-endpoint.ts';

/** Valeurs fabriquées pour les tests : ni secret réel ni ICE réel. */
const SECRET = 'secret-handoff-de-test';
const ICE = '001234567000045';
const NOW = 1_789_000_000;
const TTL = 90;

let counter = 0;
const randomBytes = (length: number): Uint8Array => {
  counter += 1;
  return Uint8Array.from({ length }, (_, i) => (counter * 31 + i * 7) % 256);
};

async function issue(overrides: Partial<Parameters<typeof issueHandoffLink>[0]> = {}) {
  return issueHandoffLink({ ice: ICE, secret: SECRET, ttlSeconds: TTL, nowSeconds: () => NOW, randomBytes, ...overrides });
}

function tokenOf(url: string): string {
  return new URL(url).searchParams.get(HANDOFF_QUERY_PARAM) ?? '';
}

function options(now = NOW, nonces = new MemoryNonceStore()) {
  return { secret: SECRET, nowSeconds: () => now, nonces };
}

describe('lien signé vers app.fisca.ma : émission', () => {
  it('URL de destination, paramètre listé, durée de vie exprimée en secondes (paramètre)', async () => {
    const issued = await issue();
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.url.startsWith(`${APP_ORIGIN}/?${HANDOFF_QUERY_PARAM}=v1.`)).toBe(true);
    expect(APP_ORIGIN).toBe('https://app.fisca.ma');
    expect(HANDOFF_QUERY_PARAM).toBe('fisca_handoff');
    expect(issued.expiresAtSeconds).toBe(NOW + TTL);
    expect(DEFAULT_HANDOFF_TTL_SECONDS).toBeGreaterThanOrEqual(MIN_HANDOFF_TTL_SECONDS);
    expect(DEFAULT_HANDOFF_TTL_SECONDS).toBeLessThanOrEqual(MAX_HANDOFF_TTL_SECONDS);
    const longer = await issue({ ttlSeconds: 300 });
    expect(longer.ok && longer.expiresAtSeconds).toBe(NOW + 300);
  });

  it('charge utile minimale : version, ICE, nonce, expiration, rien d’autre ; le secret n’y figure pas', async () => {
    const issued = await issue();
    if (!issued.ok) throw new Error('émission attendue');
    const [version, payloadB64, signature] = issued.token.split('.');
    expect(version).toBe('v1');
    const payload = JSON.parse(base64UrlDecodeToText(payloadB64 ?? '') ?? '{}') as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['exp', 'ice', 'n', 'v']);
    expect(payload).toMatchObject({ v: 1, ice: ICE, exp: NOW + TTL });
    expect(issued.url).not.toContain(SECRET);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('nonce différent à chaque émission', async () => {
    const a = await issue();
    const b = await issue();
    expect(a.ok && b.ok && a.token !== b.token).toBe(true);
  });

  it('refus : secret absent, ICE invalide, durée hors bornes ou non entière', async () => {
    expect(await issue({ secret: undefined })).toEqual({ ok: false, error: 'MISSING_SECRET' });
    for (const ice of ['', '12345', '00123456700004', '0012345670000456', '00123456700004A', '001 234 567 000 045']) {
      expect(await issue({ ice }), ice).toEqual({ ok: false, error: 'INVALID_ICE' });
    }
    for (const ttlSeconds of [0, -1, MIN_HANDOFF_TTL_SECONDS - 1, MAX_HANDOFF_TTL_SECONDS + 1, 90.5, Number.NaN]) {
      expect(await issue({ ttlSeconds }), String(ttlSeconds)).toEqual({ ok: false, error: 'INVALID_TTL' });
    }
    const bounds = [MIN_HANDOFF_TTL_SECONDS, MAX_HANDOFF_TTL_SECONDS];
    for (const ttlSeconds of bounds) expect((await issue({ ttlSeconds })).ok).toBe(true);
  });
});

describe('lien signé : vérification de référence (signature valide, altérée, expirée, rejouée)', () => {
  it('signature valide : ICE restitué', async () => {
    const issued = await issue();
    if (!issued.ok) throw new Error('émission attendue');
    const result = await verifyHandoffToken(tokenOf(issued.url), options());
    expect(result).toMatchObject({ ok: true, ice: ICE, expiresAtSeconds: NOW + TTL });
  });

  it('signature altérée ou charge utile altérée : BAD_SIGNATURE, nonce non consommé', async () => {
    const issued = await issue();
    if (!issued.ok) throw new Error('émission attendue');
    const [v, payloadB64 = '', sig = ''] = issued.token.split('.');
    const nonces = new MemoryNonceStore();
    const flippedSig = `${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`;
    const forgedPayload = base64UrlEncodeText(JSON.stringify({ v: 1, ice: '009999999000000', n: 'AAAAAAAAAAAAAAAAAAAAAA', exp: NOW + TTL }));
    const reSignedWithWrongKey = await hmacSha256Hex('autre-secret', `fisca-handoff-v1.${payloadB64}`);
    for (const token of [`${v}.${payloadB64}.${flippedSig}`, `${v}.${forgedPayload}.${sig}`, `${v}.${payloadB64}.${reSignedWithWrongKey}`, `${v}.${payloadB64}.${'z'.repeat(64)}`, `${v}.${payloadB64}.`]) {
      expect(await verifyHandoffToken(token, options(NOW, nonces)), token.slice(0, 20)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    }
    expect(await verifyHandoffToken(issued.token, options(NOW, nonces))).toMatchObject({ ok: true });
  });

  it('expirée : refusée à l’instant d’expiration et après, acceptée une seconde avant', async () => {
    const issued = await issue();
    if (!issued.ok) throw new Error('émission attendue');
    expect(await verifyHandoffToken(issued.token, options(NOW + TTL))).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(await verifyHandoffToken(issued.token, options(NOW + TTL + 3600))).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(await verifyHandoffToken(issued.token, options(NOW + TTL - 1))).toMatchObject({ ok: true });
  });

  it('rejouée : le second usage du même jeton est refusé, même signature valide', async () => {
    const issued = await issue();
    if (!issued.ok) throw new Error('émission attendue');
    const nonces = new MemoryNonceStore();
    expect(await verifyHandoffToken(issued.token, options(NOW, nonces))).toMatchObject({ ok: true });
    expect(await verifyHandoffToken(issued.token, options(NOW + 1, nonces))).toEqual({ ok: false, reason: 'REPLAYED' });
    const other = await issue();
    if (!other.ok) throw new Error('émission attendue');
    expect(await verifyHandoffToken(other.token, options(NOW, nonces))).toMatchObject({ ok: true });
  });

  it('un jeton expiré ne consomme pas son nonce ; secret absent ou jeton mal formé : refus', async () => {
    const issued = await issue();
    if (!issued.ok) throw new Error('émission attendue');
    const nonces = new MemoryNonceStore();
    await verifyHandoffToken(issued.token, options(NOW + TTL + 1, nonces));
    expect(await nonces.consume('nouveau-nonce-1234567890')).toBe(true);
    expect(await verifyHandoffToken(issued.token, { secret: undefined, nowSeconds: () => NOW, nonces })).toEqual({ ok: false, reason: 'MISSING_SECRET' });
    for (const token of ['', 'abc', 'v2.a.b', 'v1.!!!.00', 'v1.a.b.c', `v1.${base64UrlEncodeText('pas du json')}.${'0'.repeat(64)}`, `v1.${base64UrlEncodeText('{"v":1,"ice":"12","n":"x","exp":1}')}.${'0'.repeat(64)}`]) {
      expect(await verifyHandoffToken(token, options(NOW, nonces)), token).toEqual({ ok: false, reason: 'MALFORMED' });
    }
  });
});

describe(`émetteur ${HANDOFF_ENDPOINT_PATH} : le secret reste dans le Worker`, () => {
  const deps = (over: Partial<HandoffEndpointDeps> = {}): HandoffEndpointDeps => ({ secret: SECRET, ttlSeconds: undefined, nowSeconds: () => NOW, randomBytes, ...over });
  const post = (body: unknown, headers: Record<string, string> = {}, method = 'POST') =>
    new Request(`https://fisca.ma${HANDOFF_ENDPOINT_PATH}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });

  it('200 : URL signée vers app.fisca.ma, durée par défaut, aucun cache, secret absent de la réponse', async () => {
    const res = await handleHandoffRequest(post({ ice: ICE }, { Origin: 'https://fisca.ma' }), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const body = JSON.parse(text) as { url: string; expiresInSeconds: number };
    expect(body.expiresInSeconds).toBe(DEFAULT_HANDOFF_TTL_SECONDS);
    expect(await verifyHandoffToken(tokenOf(body.url), options(NOW + 1))).toMatchObject({ ok: true, ice: ICE });
  });

  it('durée lue sur le paramètre ; valeur invalide : défaut', async () => {
    const custom = await (await handleHandoffRequest(post({ ice: ICE }), deps({ ttlSeconds: 45 }))).json() as { url: string; expiresInSeconds: number };
    expect(custom.expiresInSeconds).toBe(45);
    expect(await verifyHandoffToken(tokenOf(custom.url), options(NOW + 46))).toEqual({ ok: false, reason: 'EXPIRED' });
    const invalid = await (await handleHandoffRequest(post({ ice: ICE }), deps({ ttlSeconds: 99999 }))).json() as { expiresInSeconds: number };
    expect(invalid.expiresInSeconds).toBe(DEFAULT_HANDOFF_TTL_SECONDS);
  });

  it('ICE saisi avec espaces, points ou chiffres arabes : normalisé avant signature', async () => {
    for (const typed of ['001 234 567 000 045', '001.234.567.000.045', '٠٠١٢٣٤٥٦٧٠٠٠٠٤٥']) {
      const body = (await (await handleHandoffRequest(post({ ice: typed }), deps())).json()) as { url: string };
      expect(await verifyHandoffToken(tokenOf(body.url), options(NOW + 1)), typed).toMatchObject({ ok: true, ice: ICE });
    }
  });

  it('refus : origine étrangère 403, méthode 405, secret absent 503, type 415, JSON invalide 400, ICE invalide 400, corps énorme 413', async () => {
    expect((await handleHandoffRequest(post({ ice: ICE }, { Origin: 'https://evil.example' }), deps())).status).toBe(403);
    const get = await handleHandoffRequest(post({}, {}, 'GET'), deps());
    expect(get.status).toBe(405);
    expect(get.headers.get('Allow')).toBe('POST');
    expect((await handleHandoffRequest(post({ ice: ICE }), deps({ secret: undefined }))).status).toBe(503);
    expect((await handleHandoffRequest(post({ ice: ICE }, { 'Content-Type': 'text/plain' }), deps())).status).toBe(415);
    expect((await handleHandoffRequest(post('{pas du json'), deps())).status).toBe(400);
    for (const body of [{ ice: '123' }, { ice: 42 }, {}, [], null]) expect((await handleHandoffRequest(post(body), deps())).status, JSON.stringify(body)).toBe(400);
    expect((await handleHandoffRequest(post({ ice: ICE, pad: 'x'.repeat(600) }), deps())).status).toBe(413);
  });
});
