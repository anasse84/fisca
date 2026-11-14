// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createAuthApi } from './api-client.ts';
import { fakeFetch, problemBody } from './auth-test-kit.ts';
import { authenticateWithPasskey, base64UrlToBytes, bytesToBase64Url, isPasskeySupported, toRequestOptions } from './passkey.ts';
import type { CredentialsLike } from './passkey.ts';

const OPTIONS = {
  challenge: 'AQIDBA',
  rpId: 'fisca.ma',
  timeout: 300000,
  userVerification: 'required',
  allowCredentials: [{ type: 'public-key', id: 'BQYH', transports: ['internal'] }],
  extensions: { prf: { eval: { first: 'CAkK' } } },
};

const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

function fakeAssertion(prf: ArrayBuffer | null) {
  return {
    id: 'BQYH',
    rawId: bytes(5, 6, 7),
    type: 'public-key',
    response: { clientDataJSON: bytes(1, 2), authenticatorData: bytes(3, 4), signature: bytes(250, 251, 252), userHandle: bytes(9) },
    getClientExtensionResults: () => (prf === null ? { prf: { enabled: true } } : { prf: { enabled: true, results: { first: prf } } }),
  };
}

describe('codec base64url', () => {
  it('aller-retour sans remplissage, alphabet URL', () => {
    const data = new Uint8Array([251, 255, 254, 0, 1]);
    const text = bytesToBase64Url(data);
    expect(text).toBe('-__-AAE');
    expect([...base64UrlToBytes(text) ?? []]).toEqual([...data]);
    expect(base64UrlToBytes('***')).toBeNull();
  });
});

describe('options WebAuthn', () => {
  it('convertit challenge, identifiants et sel PRF en octets', () => {
    const converted = toRequestOptions(OPTIONS);
    expect(converted).not.toBeNull();
    expect([...new Uint8Array(converted?.challenge as ArrayBuffer)]).toEqual([1, 2, 3, 4]);
    expect(converted?.rpId).toBe('fisca.ma');
    expect(converted?.userVerification).toBe('required');
    expect([...new Uint8Array(converted?.allowCredentials?.[0]?.id as ArrayBuffer)]).toEqual([5, 6, 7]);
    const prf = (converted?.extensions as { prf?: { eval?: { first: ArrayBuffer } } }).prf;
    expect([...new Uint8Array(prf?.eval?.first as ArrayBuffer)]).toEqual([8, 9, 10]);
  });
  it('rejette des options malformées', () => {
    expect(toRequestOptions(null)).toBeNull();
    expect(toRequestOptions({ ...OPTIONS, challenge: 5 })).toBeNull();
    expect(toRequestOptions({ ...OPTIONS, allowCredentials: [{ id: '***' }] })).toBeNull();
  });
});

describe('connexion par passkey : authenticate/options puis authenticate/verify', () => {
  const session = { status: 'AUTHENTICATED', accessToken: 'jwt-mem', expiresInSec: 900 };

  it('appelle options, navigator.credentials.get avec publicKey, puis verify avec le credential sérialisé', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /api/v1/auth/passkeys/authenticate/options': { status: 200, body: OPTIONS },
      'POST /api/v1/auth/passkeys/authenticate/verify': { status: 200, body: session },
    });
    let received: unknown = null;
    const credentials: CredentialsLike = {
      get: async (options) => {
        received = options;
        return fakeAssertion(null);
      },
    };
    const api = createAuthApi({ fetch, getTurnstileToken: async () => 'ts' });
    const result = await authenticateWithPasskey({ api, credentials });
    expect(result).toMatchObject({ ok: true, session: { accessToken: 'jwt-mem', expiresInSec: 900 }, prfOutput: null });
    expect(calls.map((c) => c.url)).toEqual([
      '/api/v1/auth/passkeys/authenticate/options?cf-turnstile-response=ts',
      '/api/v1/auth/passkeys/authenticate/verify?cf-turnstile-response=ts',
    ]);
    expect(received).toMatchObject({ publicKey: { rpId: 'fisca.ma' } });
    expect(calls[1]?.body).toEqual({
      credential: {
        id: 'BQYH',
        rawId: 'BQYH',
        type: 'public-key',
        response: { clientDataJSON: 'AQI', authenticatorData: 'AwQ', signature: '-vv8', userHandle: 'CQ' },
        clientExtensionResults: { prf: { enabled: true } },
      },
    });
  });

  it('la sortie PRF reste en mémoire : jamais envoyée au serveur', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /api/v1/auth/passkeys/authenticate/options': { status: 200, body: OPTIONS },
      'POST /api/v1/auth/passkeys/authenticate/verify': { status: 200, body: session },
    });
    const prf = bytes(77, 78, 79, 80);
    const result = await authenticateWithPasskey({ api: createAuthApi({ fetch }), credentials: { get: async () => fakeAssertion(prf) } });
    expect(result.ok && result.prfOutput && [...result.prfOutput]).toEqual([77, 78, 79, 80]);
    const sent = JSON.stringify(calls[1]?.body);
    expect(sent).not.toContain('results');
    expect(sent).not.toContain(bytesToBase64Url(new Uint8Array(prf)));
  });

  it('annulation par l’utilisateur (NotAllowedError) : CANCELLED, aucun verify', async () => {
    const { fetch, calls } = fakeFetch({ 'POST /api/v1/auth/passkeys/authenticate/options': { status: 200, body: OPTIONS } });
    const result = await authenticateWithPasskey({
      api: createAuthApi({ fetch }),
      credentials: {
        get: async () => {
          throw new DOMException('refusé', 'NotAllowedError');
        },
      },
    });
    expect(result).toEqual({ ok: false, reason: 'CANCELLED' });
    expect(calls).toHaveLength(1);
  });

  it('API indisponible, options invalides ou verify refusé : API avec le ProblemDetails', async () => {
    const refused = fakeFetch({
      'POST /api/v1/auth/passkeys/authenticate/options': { status: 200, body: OPTIONS },
      'POST /api/v1/auth/passkeys/authenticate/verify': { status: 401, body: problemBody(401, 'PASSKEY_AUTHENTICATION_FAILED') },
    });
    const result = await authenticateWithPasskey({ api: createAuthApi({ fetch: refused.fetch }), credentials: { get: async () => fakeAssertion(null) } });
    expect(result).toMatchObject({ ok: false, reason: 'API', problem: { errorCode: 'PASSKEY_AUTHENTICATION_FAILED' } });
    const bad = fakeFetch({ 'POST /api/v1/auth/passkeys/authenticate/options': { status: 200, body: { challenge: 3 } } });
    const invalid = await authenticateWithPasskey({ api: createAuthApi({ fetch: bad.fetch }), credentials: { get: async () => fakeAssertion(null) } });
    expect(invalid).toMatchObject({ ok: false, reason: 'API', problem: { errorCode: 'RESPONSE_INVALID' } });
  });

  it('sans conteneur de credentials : UNSUPPORTED, aucun appel réseau', async () => {
    const { fetch, calls } = fakeFetch({});
    expect(await authenticateWithPasskey({ api: createAuthApi({ fetch }), credentials: null })).toEqual({ ok: false, reason: 'UNSUPPORTED' });
    expect(calls).toHaveLength(0);
    expect(isPasskeySupported(null)).toBe(false);
    expect(isPasskeySupported({ get: async () => null })).toBe(true);
  });
});
