/** Authentificateur simulé pour les tests WebAuthn : clés générées à la volée, encodage CBOR minimal. */

export const RP_ID = 'fisca.ma';
export const ORIGIN = 'https://app.fisca.ma';
export const FLAG_UP = 0x01;
export const FLAG_UV = 0x04;
export const FLAG_BE = 0x08;
export const FLAG_BS = 0x10;
export const FLAG_AT = 0x40;

const encoder = new TextEncoder();

export function b64u(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromB64u(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export type CborValue = number | string | Uint8Array | readonly CborValue[] | ReadonlyMap<number | string, CborValue>;

function head(major: number, value: number): Uint8Array {
  if (value < 24) {
    return Uint8Array.of((major << 5) | value);
  }
  if (value < 256) {
    return Uint8Array.of((major << 5) | 24, value);
  }
  return Uint8Array.of((major << 5) | 25, value >> 8, value & 0xff);
}

export function cbor(value: CborValue): Uint8Array {
  if (typeof value === 'number') {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = encoder.encode(value);
    return concat(head(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) {
    return concat(head(2, value.length), value);
  }
  if (value instanceof Map) {
    const parts: Uint8Array[] = [head(5, value.size)];
    for (const [key, item] of value) {
      parts.push(cbor(key), cbor(item));
    }
    return concat(...parts);
  }
  const items = Array.isArray(value) ? value : [];
  return concat(head(4, items.length), ...items.map((item) => cbor(item)));
}

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/** Convertit une signature ECDSA brute r||s en DER (format WebAuthn). */
export function rawToDer(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) {
      start += 1;
    }
    let body = bytes.slice(start);
    if (((body[0] ?? 0) & 0x80) !== 0) {
      body = concat(Uint8Array.of(0), body);
    }
    return concat(Uint8Array.of(0x02, body.length), body);
  };
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return concat(Uint8Array.of(0x30, r.length + s.length), r, s);
}

export type Alg = 'ES256' | 'EdDSA';

export interface FakeAuthenticator {
  readonly alg: Alg;
  readonly credentialId: Uint8Array<ArrayBuffer>;
  readonly coseKey: Uint8Array;
  readonly privateKey: CryptoKey;
  signCount: number;
}

export async function createAuthenticator(alg: Alg): Promise<FakeAuthenticator> {
  const credentialId = crypto.getRandomValues(new Uint8Array(32));
  if (alg === 'ES256') {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const coseKey = cbor(
      new Map<number, CborValue>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, fromB64u(jwk.x ?? '')],
        [-3, fromB64u(jwk.y ?? '')],
      ]),
    );
    return { alg, credentialId, coseKey, privateKey: pair.privateKey, signCount: 0 };
  }
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const coseKey = cbor(
    new Map<number, CborValue>([
      [1, 1],
      [3, -8],
      [-1, 6],
      [-2, fromB64u(jwk.x ?? '')],
    ]),
  );
  return { alg, credentialId, coseKey, privateKey: pair.privateKey, signCount: 0 };
}

export interface ClientDataOptions {
  readonly type: 'webauthn.create' | 'webauthn.get';
  readonly challenge: string;
  readonly origin?: string | undefined;
  readonly crossOrigin?: boolean;
}

export function clientDataJson(options: ClientDataOptions): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify({
      type: options.type,
      challenge: options.challenge,
      origin: options.origin ?? ORIGIN,
      crossOrigin: options.crossOrigin ?? false,
    }),
  );
}

export async function authData(options: {
  readonly rpId?: string | undefined;
  readonly flags: number;
  readonly signCount: number;
  readonly attested?: FakeAuthenticator;
}): Promise<Uint8Array<ArrayBuffer>> {
  const rpIdHash = await sha256(encoder.encode(options.rpId ?? RP_ID));
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, options.signCount, false);
  const base = concat(rpIdHash, Uint8Array.of(options.flags), counter);
  if (options.attested === undefined) {
    return base;
  }
  const idLength = Uint8Array.of(options.attested.credentialId.length >> 8, options.attested.credentialId.length & 0xff);
  return concat(base, new Uint8Array(16), idLength, options.attested.credentialId, options.attested.coseKey);
}

export interface BrowserCredentialJson {
  id: string;
  rawId: string;
  type: 'public-key';
  response: Record<string, unknown>;
  clientExtensionResults: Record<string, unknown>;
}

export async function makeRegistrationResponse(
  authenticator: FakeAuthenticator,
  challenge: string,
  overrides: {
    readonly origin?: string | undefined;
    readonly type?: 'webauthn.create' | 'webauthn.get';
    readonly flags?: number;
    readonly rpId?: string | undefined;
    readonly fmt?: string;
    readonly attStmt?: Map<string, CborValue>;
    readonly extensions?: Record<string, unknown>;
  } = {},
): Promise<BrowserCredentialJson> {
  const data = await authData({
    rpId: overrides.rpId,
    flags: overrides.flags ?? FLAG_UP | FLAG_UV | FLAG_AT,
    signCount: 0,
    attested: authenticator,
  });
  const attestation = cbor(
    new Map<string, CborValue>([
      ['fmt', overrides.fmt ?? 'none'],
      ['attStmt', overrides.attStmt ?? new Map<string, CborValue>()],
      ['authData', data],
    ]),
  );
  return {
    id: b64u(authenticator.credentialId),
    rawId: b64u(authenticator.credentialId),
    type: 'public-key',
    response: {
      clientDataJSON: b64u(
        clientDataJson({ type: overrides.type ?? 'webauthn.create', challenge, origin: overrides.origin }),
      ),
      attestationObject: b64u(attestation),
      transports: ['internal'],
    },
    clientExtensionResults: overrides.extensions ?? { prf: { enabled: true } },
  };
}

export async function makeAssertionResponse(
  authenticator: FakeAuthenticator,
  challenge: string,
  overrides: {
    readonly origin?: string | undefined;
    readonly type?: 'webauthn.create' | 'webauthn.get';
    readonly flags?: number;
    readonly rpId?: string | undefined;
    readonly signCount?: number;
    readonly userHandle?: string;
    readonly tamperSignature?: boolean;
    readonly extensions?: Record<string, unknown>;
  } = {},
): Promise<BrowserCredentialJson> {
  authenticator.signCount = overrides.signCount ?? authenticator.signCount + 1;
  const data = await authData({
    rpId: overrides.rpId,
    flags: overrides.flags ?? FLAG_UP | FLAG_UV,
    signCount: authenticator.signCount,
  });
  const clientData = clientDataJson({ type: overrides.type ?? 'webauthn.get', challenge, origin: overrides.origin });
  const signedData = concat(data, await sha256(clientData));
  let signature: Uint8Array;
  if (authenticator.alg === 'ES256') {
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, authenticator.privateKey, signedData));
    signature = rawToDer(raw);
  } else {
    signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, authenticator.privateKey, signedData));
  }
  if (overrides.tamperSignature === true) {
    signature = signature.slice();
    signature[signature.length - 1] = (signature[signature.length - 1] ?? 0) ^ 0xff;
  }
  const response: Record<string, unknown> = {
    clientDataJSON: b64u(clientData),
    authenticatorData: b64u(data),
    signature: b64u(signature),
  };
  if (overrides.userHandle !== undefined) {
    response['userHandle'] = overrides.userHandle;
  }
  return {
    id: b64u(authenticator.credentialId),
    rawId: b64u(authenticator.credentialId),
    type: 'public-key',
    response,
    clientExtensionResults: overrides.extensions ?? {},
  };
}
