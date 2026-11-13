/**
 * Connexion par passkey WebAuthn : CTR-API-39 (authenticate/options) puis CTR-API-40 (authenticate/verify), avec
 * navigator.credentials.get fourni par l'appelant (jamais lu en global ici). Extension PRF : la sortie PRF est
 * une matière de clé E2EE, elle reste en mémoire chez l'appelant et n'est JAMAIS envoyée au serveur.
 */
import type { ApiProblem, AuthApi, SessionTokens } from './api-client.ts';

export interface CredentialsLike {
  get(options: { publicKey: PublicKeyCredentialRequestOptions }): Promise<unknown>;
}

export function isPasskeySupported(credentials: CredentialsLike | null): credentials is CredentialsLike {
  return credentials !== null;
}

const B64URL = /^[A-Za-z0-9_-]*$/;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  if (!B64URL.test(text) || text.length % 4 === 1) {
    return null;
  }
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Options JSON du serveur (base64url) → PublicKeyCredentialRequestOptions (octets). Null si malformées. */
export function toRequestOptions(raw: unknown): PublicKeyCredentialRequestOptions | null {
  if (!isRecord(raw) || typeof raw['challenge'] !== 'string') {
    return null;
  }
  const challenge = base64UrlToBytes(raw['challenge']);
  if (challenge === null || challenge.length === 0) {
    return null;
  }
  const allow: PublicKeyCredentialDescriptor[] = [];
  const allowRaw = raw['allowCredentials'];
  if (allowRaw !== undefined) {
    if (!Array.isArray(allowRaw)) {
      return null;
    }
    for (const entry of allowRaw) {
      const id = isRecord(entry) && typeof entry['id'] === 'string' ? base64UrlToBytes(entry['id']) : null;
      if (id === null || id.length === 0 || !isRecord(entry)) {
        return null;
      }
      const transports = Array.isArray(entry['transports']) ? entry['transports'].filter((t): t is AuthenticatorTransport => typeof t === 'string') : [];
      allow.push({ type: 'public-key', id, ...(transports.length > 0 ? { transports } : {}) });
    }
  }
  const options: PublicKeyCredentialRequestOptions = {
    challenge,
    allowCredentials: allow,
    userVerification: raw['userVerification'] === 'required' || raw['userVerification'] === 'preferred' || raw['userVerification'] === 'discouraged' ? raw['userVerification'] : 'required',
    ...(typeof raw['rpId'] === 'string' ? { rpId: raw['rpId'] } : {}),
    ...(typeof raw['timeout'] === 'number' ? { timeout: raw['timeout'] } : {}),
  };
  const prfFirst = readPrfSalt(raw['extensions']);
  if (prfFirst !== null) {
    const extensions: AuthenticationExtensionsClientInputs = { prf: { eval: { first: prfFirst } } };
    return { ...options, extensions };
  }
  return options;
}

function readPrfSalt(extensions: unknown): Uint8Array<ArrayBuffer> | null {
  if (!isRecord(extensions) || !isRecord(extensions['prf'])) {
    return null;
  }
  const evalInput = extensions['prf']['eval'];
  return isRecord(evalInput) && typeof evalInput['first'] === 'string' ? base64UrlToBytes(evalInput['first']) : null;
}

interface AssertionLike {
  readonly id: string;
  readonly rawId: ArrayBuffer;
  readonly type: string;
  readonly response: {
    readonly clientDataJSON: ArrayBuffer;
    readonly authenticatorData: ArrayBuffer;
    readonly signature: ArrayBuffer;
    readonly userHandle: ArrayBuffer | null;
  };
  getClientExtensionResults(): unknown;
}

function isBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value) || Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function toBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  return ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
}

function isAssertion(value: unknown): value is AssertionLike {
  if (!isRecord(value) || typeof value['id'] !== 'string' || value['type'] !== 'public-key' || !isBuffer(value['rawId'])) {
    return false;
  }
  const response = value['response'];
  return (
    isRecord(response) &&
    isBuffer(response['clientDataJSON']) &&
    isBuffer(response['authenticatorData']) &&
    isBuffer(response['signature']) &&
    (response['userHandle'] === null || response['userHandle'] === undefined || isBuffer(response['userHandle'])) &&
    typeof value['getClientExtensionResults'] === 'function'
  );
}

export interface SerializedAssertion {
  /** Forme PublicKeyCredential.toJSON() attendue par CTR-API-40, sans sortie PRF. */
  readonly credential: Record<string, unknown>;
  readonly prfOutput: Uint8Array | null;
}

export function serializeAssertion(assertion: AssertionLike): SerializedAssertion {
  const results = assertion.getClientExtensionResults();
  let prfOutput: Uint8Array | null = null;
  let prfEnabled: boolean | null = null;
  if (isRecord(results) && isRecord(results['prf'])) {
    const prf = results['prf'];
    if (typeof prf['enabled'] === 'boolean') {
      prfEnabled = prf['enabled'];
    }
    const outputs = prf['results'];
    if (isRecord(outputs) && isBuffer(outputs['first'])) {
      prfOutput = new Uint8Array(toBytes(outputs['first']));
      prfEnabled = true;
    }
  }
  const handle = assertion.response.userHandle;
  return {
    credential: {
      id: assertion.id,
      rawId: bytesToBase64Url(toBytes(assertion.rawId)),
      type: 'public-key',
      response: {
        clientDataJSON: bytesToBase64Url(toBytes(assertion.response.clientDataJSON)),
        authenticatorData: bytesToBase64Url(toBytes(assertion.response.authenticatorData)),
        signature: bytesToBase64Url(toBytes(assertion.response.signature)),
        ...(handle === null || handle === undefined ? {} : { userHandle: bytesToBase64Url(toBytes(handle)) }),
      },
      clientExtensionResults: prfEnabled === null ? {} : { prf: { enabled: prfEnabled } },
    },
    prfOutput,
  };
}

export type PasskeyOutcome =
  | { readonly ok: true; readonly session: SessionTokens; readonly prfOutput: Uint8Array | null }
  | { readonly ok: false; readonly reason: 'UNSUPPORTED' | 'CANCELLED' }
  | { readonly ok: false; readonly reason: 'API'; readonly problem: ApiProblem };

const apiFailure = (errorCode: string): PasskeyOutcome => ({ ok: false, reason: 'API', problem: { status: 0, errorCode, retryAfterSec: null, fieldErrors: {} } });

export async function authenticateWithPasskey(input: { readonly api: AuthApi; readonly credentials: CredentialsLike | null }): Promise<PasskeyOutcome> {
  if (!isPasskeySupported(input.credentials)) {
    return { ok: false, reason: 'UNSUPPORTED' };
  }
  const optionsResult = await input.api.passkeyAuthenticateOptions();
  if (!optionsResult.ok) {
    return { ok: false, reason: 'API', problem: optionsResult.problem };
  }
  const publicKey = toRequestOptions(optionsResult.data);
  if (publicKey === null) {
    return apiFailure('RESPONSE_INVALID');
  }
  let assertion: unknown;
  try {
    assertion = await input.credentials.get({ publicKey });
  } catch (error) {
    const name = isRecord(error) && typeof error['name'] === 'string' ? error['name'] : '';
    return name === 'NotAllowedError' || name === 'AbortError' ? { ok: false, reason: 'CANCELLED' } : apiFailure('PASSKEY_AUTHENTICATION_FAILED');
  }
  if (!isAssertion(assertion)) {
    return apiFailure('PASSKEY_AUTHENTICATION_FAILED');
  }
  const serialized = serializeAssertion(assertion);
  const verified = await input.api.passkeyAuthenticateVerify(serialized.credential);
  return verified.ok ? { ok: true, session: verified.data, prfOutput: serialized.prfOutput } : { ok: false, reason: 'API', problem: verified.problem };
}
