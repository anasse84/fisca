/**
 * Passkeys FIDO2 / WebAuthn avec extension PRF (Doc_09 § 02 annexe, Doc_10 § 01 ; ticket T-S1A-04).
 *
 * Vérifications (WebAuthn niveau 3, WebCrypto seul, aucune dépendance tierce) :
 * - challenge de 32 octets aléatoires, à usage unique (consommation atomique du port), TTL de 5 minutes, lié à un
 *   objectif (enregistrement ou authentification) et, si connu, à un utilisateur ;
 * - clientDataJSON : type, challenge, origin dans la liste autorisée, crossOrigin refusé ;
 * - authenticatorData : rpIdHash, drapeaux UP et UV (vérification utilisateur exigée), signCount monotone ;
 * - attestation « none » uniquement ; clé COSE ES256 (-7) ou EdDSA (-8) ; signature vérifiée par WebCrypto.
 * Extension PRF : les options demandent `prf.eval` ; seul l'indicateur `prf.enabled` est mémorisé. Le résultat PRF
 * (clé de coffre dérivée côté navigateur) n'est jamais lu, stocké, renvoyé ni journalisé par ce module.
 * Le dépôt des identifiants (table S1B) et des challenges passe par des ports injectables.
 */

import { CborError, decodeCbor } from './cbor.ts';
import type { CborValue } from './cbor.ts';
import { concatBytes, decodeBase64Url, encodeBase64Url, isRecord, secureRandomBytes, sha256Bytes } from './encoding.ts';
import type { RandomSource } from './encoding.ts';

export const PASSKEY_CHALLENGE_TTL_SEC = 300 as const;
export const COSE_ALG_ES256 = -7 as const;
export const COSE_ALG_EDDSA = -8 as const;
export type PasskeyAlgorithm = typeof COSE_ALG_ES256 | typeof COSE_ALG_EDDSA;
const CHALLENGE_BYTES = 32;
const MAX_CREDENTIAL_ID_BYTES = 1023;
const PRF_SALT_LABEL = 'fisca:passkey-prf:v1';
const AUTH_DATA_FIXED_BYTES = 37;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;
const FLAG_ED = 0x80;

export type PasskeyErrorCode =
  | 'PASSKEY_REQUEST_MALFORMED'
  | 'PASSKEY_CHALLENGE_UNKNOWN'
  | 'PASSKEY_CLIENT_DATA_INVALID'
  | 'PASSKEY_ORIGIN_INVALID'
  | 'PASSKEY_RP_ID_MISMATCH'
  | 'PASSKEY_USER_PRESENCE_REQUIRED'
  | 'PASSKEY_USER_VERIFICATION_REQUIRED'
  | 'PASSKEY_ATTESTATION_UNSUPPORTED'
  | 'PASSKEY_ALGORITHM_UNSUPPORTED'
  | 'PASSKEY_CREDENTIAL_EXISTS'
  | 'PASSKEY_CREDENTIAL_UNKNOWN'
  | 'PASSKEY_SIGNATURE_INVALID'
  | 'PASSKEY_SIGNCOUNT_REPLAY'
  | 'PASSKEY_USER_MISMATCH';

export class PasskeyError extends Error {
  readonly code: PasskeyErrorCode;

  constructor(code: PasskeyErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'PasskeyError';
    this.code = code;
  }
}

function fail(code: PasskeyErrorCode, message: string): never {
  throw new PasskeyError(code, message);
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export type PasskeyPurpose = 'REGISTRATION' | 'AUTHENTICATION';

export interface PasskeyChallengeRecord {
  /** Challenge en base64url, tel qu'il figure dans clientDataJSON. */
  readonly challenge: string;
  readonly purpose: PasskeyPurpose;
  /** Utilisateur auquel le challenge est lié ; null pour une authentification sans identifiant (passkey découvrable). */
  readonly userId: string | null;
  readonly expiresAtEpochSec: number;
}

export interface PasskeyChallengeStore {
  save(record: PasskeyChallengeRecord): Promise<void>;
  /** Retire atomiquement le challenge et le renvoie ; null s'il est inconnu ou déjà consommé. */
  consume(challenge: string): Promise<PasskeyChallengeRecord | null>;
}

/** Vue applicative d'un identifiant de passkey (table S1B). Aucun résultat PRF n'y figure. */
export interface PasskeyCredentialRecord {
  /** Identifiant d'identifiant en base64url. */
  readonly credentialId: string;
  readonly userId: string;
  /** Clé publique au format COSE, en base64url. */
  readonly publicKeyCose: string;
  readonly algorithm: PasskeyAlgorithm;
  readonly signCount: number;
  readonly transports: readonly string[];
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  /** Vrai si l'authentificateur a annoncé prf.enabled à l'enregistrement. */
  readonly prfEnabled: boolean;
  readonly createdAtEpochSec: number;
}

export interface PasskeyCredentialStore {
  listByUser(userId: string): Promise<readonly PasskeyCredentialRecord[]>;
  findByCredentialId(credentialId: string): Promise<PasskeyCredentialRecord | null>;
  /** Insère l'identifiant ; false s'il existe déjà (contrainte d'unicité). */
  insert(record: PasskeyCredentialRecord): Promise<boolean>;
  /** Compare-and-set : met à jour signCount et backupState seulement si signCount valait `expectedPrevious`. */
  updateSignCount(credentialId: string, expectedPrevious: number, next: number, backupState: boolean): Promise<boolean>;
}

export interface PasskeyConfig {
  /** Identifiant de partie de confiance (domaine), ex. fisca.ma. */
  readonly rpId: string;
  readonly rpName: string;
  /** Origines web autorisées (https://app.fisca.ma, ...). */
  readonly allowedOrigins: readonly string[];
}

export interface PasskeyDeps {
  readonly config: PasskeyConfig;
  readonly challenges: PasskeyChallengeStore;
  readonly credentials: PasskeyCredentialStore;
  readonly nowEpochSec: () => number;
  readonly randomBytes?: RandomSource;
}

// ---------------------------------------------------------------------------
// Options (JSON pour navigator.credentials.*, via parseCreationOptionsFromJSON / parseRequestOptionsFromJSON)
// ---------------------------------------------------------------------------

export interface PasskeyCredentialDescriptor {
  readonly type: 'public-key';
  readonly id: string;
  readonly transports: readonly string[];
}

export interface PrfExtensionInput {
  readonly prf: { readonly eval: { readonly first: string } };
}

export interface PasskeyRegistrationOptions {
  readonly challenge: string;
  readonly rp: { readonly id: string; readonly name: string };
  readonly user: { readonly id: string; readonly name: string; readonly displayName: string };
  readonly pubKeyCredParams: readonly { readonly type: 'public-key'; readonly alg: PasskeyAlgorithm }[];
  readonly timeout: number;
  readonly attestation: 'none';
  readonly authenticatorSelection: { readonly residentKey: 'preferred'; readonly userVerification: 'required' };
  readonly excludeCredentials: readonly PasskeyCredentialDescriptor[];
  readonly extensions: PrfExtensionInput;
}

export interface PasskeyAuthenticationOptions {
  readonly challenge: string;
  readonly rpId: string;
  readonly timeout: number;
  readonly userVerification: 'required';
  readonly allowCredentials: readonly PasskeyCredentialDescriptor[];
  readonly extensions: PrfExtensionInput;
}

/** Sel PRF constant et public : la sortie PRF reste propre à chaque identifiant, car le secret HMAC est celui de l'authentificateur. */
async function prfExtension(): Promise<PrfExtensionInput> {
  const salt = await sha256Bytes(new TextEncoder().encode(PRF_SALT_LABEL));
  return { prf: { eval: { first: encodeBase64Url(salt) } } };
}

function descriptor(record: PasskeyCredentialRecord): PasskeyCredentialDescriptor {
  return { type: 'public-key', id: record.credentialId, transports: record.transports };
}

async function issueChallenge(deps: PasskeyDeps, purpose: PasskeyPurpose, userId: string | null): Promise<string> {
  const challenge = encodeBase64Url((deps.randomBytes ?? secureRandomBytes)(CHALLENGE_BYTES));
  await deps.challenges.save({
    challenge,
    purpose,
    userId,
    expiresAtEpochSec: deps.nowEpochSec() + PASSKEY_CHALLENGE_TTL_SEC,
  });
  return challenge;
}

export async function beginPasskeyRegistration(
  deps: PasskeyDeps,
  input: { readonly userId: string; readonly userName: string; readonly displayName: string },
): Promise<PasskeyRegistrationOptions> {
  const existing = await deps.credentials.listByUser(input.userId);
  return {
    challenge: await issueChallenge(deps, 'REGISTRATION', input.userId),
    rp: { id: deps.config.rpId, name: deps.config.rpName },
    user: { id: encodeBase64Url(new TextEncoder().encode(input.userId)), name: input.userName, displayName: input.displayName },
    pubKeyCredParams: [
      { type: 'public-key', alg: COSE_ALG_ES256 },
      { type: 'public-key', alg: COSE_ALG_EDDSA },
    ],
    timeout: PASSKEY_CHALLENGE_TTL_SEC * 1000,
    attestation: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: existing.map(descriptor),
    extensions: await prfExtension(),
  };
}

export async function beginPasskeyAuthentication(
  deps: PasskeyDeps,
  input: { readonly userId?: string },
): Promise<PasskeyAuthenticationOptions> {
  const userId = input.userId ?? null;
  const allowed = userId === null ? [] : await deps.credentials.listByUser(userId);
  return {
    challenge: await issueChallenge(deps, 'AUTHENTICATION', userId),
    rpId: deps.config.rpId,
    timeout: PASSKEY_CHALLENGE_TTL_SEC * 1000,
    userVerification: 'required',
    allowCredentials: allowed.map(descriptor),
    extensions: await prfExtension(),
  };
}

// ---------------------------------------------------------------------------
// Analyse des entrées navigateur (PublicKeyCredential.toJSON())
// ---------------------------------------------------------------------------

interface ParsedCredential {
  readonly id: string;
  readonly response: Record<string, unknown>;
  readonly clientExtensionResults: Record<string, unknown>;
}

function bytesField(source: Record<string, unknown>, name: string): Uint8Array<ArrayBuffer> {
  const value = source[name];
  const decoded = typeof value === 'string' ? decodeBase64Url(value) : null;
  if (decoded === null || decoded.length === 0) {
    return fail('PASSKEY_REQUEST_MALFORMED', `champ ${name} absent ou invalide.`);
  }
  return decoded;
}

function parseCredential(input: unknown): ParsedCredential {
  if (!isRecord(input)) {
    return fail('PASSKEY_REQUEST_MALFORMED', 'identifiant attendu sous forme d’objet.');
  }
  const { id, rawId, type, response, clientExtensionResults } = input;
  if (typeof id !== 'string' || id.length === 0 || id !== rawId || type !== 'public-key' || !isRecord(response)) {
    return fail('PASSKEY_REQUEST_MALFORMED', 'identifiant WebAuthn mal formé.');
  }
  const decodedId = decodeBase64Url(id);
  if (decodedId === null || decodedId.length === 0 || decodedId.length > MAX_CREDENTIAL_ID_BYTES) {
    return fail('PASSKEY_REQUEST_MALFORMED', 'identifiant d’identifiant invalide.');
  }
  return { id, response, clientExtensionResults: isRecord(clientExtensionResults) ? clientExtensionResults : {} };
}

interface ClientData {
  readonly type: string;
  readonly challenge: string;
  readonly origin: string;
  readonly raw: Uint8Array<ArrayBuffer>;
}

function parseClientData(response: Record<string, unknown>, expectedType: 'webauthn.create' | 'webauthn.get'): ClientData {
  const raw = bytesField(response, 'clientDataJSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    return fail('PASSKEY_CLIENT_DATA_INVALID', 'clientDataJSON illisible.');
  }
  if (!isRecord(parsed)) {
    return fail('PASSKEY_CLIENT_DATA_INVALID', 'clientDataJSON non objet.');
  }
  const { type, challenge, origin, crossOrigin } = parsed;
  if (type !== expectedType) {
    return fail('PASSKEY_CLIENT_DATA_INVALID', `type attendu : ${expectedType}.`);
  }
  if (typeof challenge !== 'string' || challenge.length === 0 || typeof origin !== 'string') {
    return fail('PASSKEY_CLIENT_DATA_INVALID', 'challenge ou origin absent.');
  }
  if (crossOrigin === true) {
    return fail('PASSKEY_ORIGIN_INVALID', 'requête inter-origine refusée.');
  }
  return { type: expectedType, challenge, origin, raw };
}

async function consumeChallenge(
  deps: PasskeyDeps,
  clientData: ClientData,
  purpose: PasskeyPurpose,
): Promise<PasskeyChallengeRecord> {
  const record = await deps.challenges.consume(clientData.challenge);
  if (record === null || record.purpose !== purpose || record.challenge !== clientData.challenge || record.expiresAtEpochSec <= deps.nowEpochSec()) {
    return fail('PASSKEY_CHALLENGE_UNKNOWN', 'challenge inconnu, expiré ou déjà utilisé.');
  }
  return record;
}

function assertOrigin(deps: PasskeyDeps, clientData: ClientData): void {
  if (!deps.config.allowedOrigins.includes(clientData.origin)) {
    fail('PASSKEY_ORIGIN_INVALID', 'origine non autorisée.');
  }
}

// ---------------------------------------------------------------------------
// authenticatorData
// ---------------------------------------------------------------------------

interface AttestedCredential {
  readonly credentialId: Uint8Array<ArrayBuffer>;
  readonly coseKey: Uint8Array<ArrayBuffer>;
  readonly coseMap: ReadonlyMap<number | string, CborValue>;
}

interface AuthenticatorData {
  readonly rpIdHash: Uint8Array<ArrayBuffer>;
  readonly flags: number;
  readonly signCount: number;
  readonly attested: AttestedCredential | null;
}

function parseAuthenticatorData(bytes: Uint8Array<ArrayBuffer>): AuthenticatorData {
  if (bytes.length < AUTH_DATA_FIXED_BYTES) {
    return fail('PASSKEY_REQUEST_MALFORMED', 'authenticatorData trop court.');
  }
  const flags = bytes[32] ?? 0;
  const signCount = new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0, false);
  let offset = AUTH_DATA_FIXED_BYTES;
  let attested: AttestedCredential | null = null;
  try {
    if ((flags & FLAG_AT) !== 0) {
      const idLengthOffset = offset + 16;
      if (bytes.length < idLengthOffset + 2) {
        return fail('PASSKEY_REQUEST_MALFORMED', 'données d’attestation tronquées.');
      }
      const idLength = new DataView(bytes.buffer, bytes.byteOffset + idLengthOffset, 2).getUint16(0, false);
      const idStart = idLengthOffset + 2;
      if (idLength === 0 || idLength > MAX_CREDENTIAL_ID_BYTES || bytes.length < idStart + idLength) {
        return fail('PASSKEY_REQUEST_MALFORMED', 'identifiant d’attestation invalide.');
      }
      const credentialId = bytes.slice(idStart, idStart + idLength);
      const decoded = decodeCbor(bytes, idStart + idLength);
      if (!(decoded.value instanceof Map)) {
        return fail('PASSKEY_REQUEST_MALFORMED', 'clé COSE invalide.');
      }
      const coseKey = bytes.slice(idStart + idLength, idStart + idLength + decoded.length);
      attested = { credentialId, coseKey, coseMap: decoded.value };
      offset = idStart + idLength + decoded.length;
    }
    if ((flags & FLAG_ED) !== 0) {
      offset += decodeCbor(bytes, offset).length;
    }
  } catch (error) {
    if (error instanceof CborError) {
      return fail('PASSKEY_REQUEST_MALFORMED', 'CBOR invalide dans authenticatorData.');
    }
    throw error;
  }
  if (offset !== bytes.length) {
    return fail('PASSKEY_REQUEST_MALFORMED', 'octets inattendus après authenticatorData.');
  }
  return { rpIdHash: bytes.slice(0, 32), flags, signCount, attested };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

async function assertAuthenticatorData(deps: PasskeyDeps, data: AuthenticatorData): Promise<void> {
  const expected = await sha256Bytes(new TextEncoder().encode(deps.config.rpId));
  if (!equalBytes(data.rpIdHash, expected)) {
    fail('PASSKEY_RP_ID_MISMATCH', 'rpIdHash inattendu.');
  }
  if ((data.flags & FLAG_UP) === 0) {
    fail('PASSKEY_USER_PRESENCE_REQUIRED', 'présence utilisateur (UP) absente.');
  }
  if ((data.flags & FLAG_UV) === 0) {
    fail('PASSKEY_USER_VERIFICATION_REQUIRED', 'vérification utilisateur (UV) absente.');
  }
  if ((data.flags & FLAG_BS) !== 0 && (data.flags & FLAG_BE) === 0) {
    fail('PASSKEY_REQUEST_MALFORMED', 'état de sauvegarde sans éligibilité (BS sans BE).');
  }
}

// ---------------------------------------------------------------------------
// Clés COSE et signatures
// ---------------------------------------------------------------------------

function coseNumber(map: ReadonlyMap<number | string, CborValue>, key: number): number | null {
  const value = map.get(key);
  return typeof value === 'number' ? value : null;
}

function coseBytes(map: ReadonlyMap<number | string, CborValue>, key: number): Uint8Array<ArrayBuffer> | null {
  const value = map.get(key);
  return value instanceof Uint8Array ? value : null;
}

const COORDINATE_BYTES = 32;

async function importCoseKey(map: ReadonlyMap<number | string, CborValue>): Promise<{ readonly key: CryptoKey; readonly algorithm: PasskeyAlgorithm }> {
  const alg = coseNumber(map, 3);
  try {
    if (alg === COSE_ALG_ES256) {
      const x = coseBytes(map, -2);
      const y = coseBytes(map, -3);
      if (coseNumber(map, 1) !== 2 || coseNumber(map, -1) !== 1 || x?.length !== COORDINATE_BYTES || y?.length !== COORDINATE_BYTES) {
        return fail('PASSKEY_ALGORITHM_UNSUPPORTED', 'clé ES256 invalide.');
      }
      const key = await crypto.subtle.importKey(
        'raw',
        concatBytes(Uint8Array.of(0x04), x, y),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      return { key, algorithm: COSE_ALG_ES256 };
    }
    if (alg === COSE_ALG_EDDSA) {
      const x = coseBytes(map, -2);
      if (coseNumber(map, 1) !== 1 || coseNumber(map, -1) !== 6 || x?.length !== COORDINATE_BYTES) {
        return fail('PASSKEY_ALGORITHM_UNSUPPORTED', 'clé EdDSA invalide.');
      }
      const key = await crypto.subtle.importKey('raw', x, { name: 'Ed25519' }, false, ['verify']);
      return { key, algorithm: COSE_ALG_EDDSA };
    }
  } catch (error) {
    if (error instanceof PasskeyError) {
      throw error;
    }
    return fail('PASSKEY_ALGORITHM_UNSUPPORTED', 'clé publique refusée par WebCrypto.');
  }
  return fail('PASSKEY_ALGORITHM_UNSUPPORTED', 'algorithme COSE non pris en charge (ES256 et EdDSA seulement).');
}

function derIntegerToFixed(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) {
    start += 1;
  }
  const trimmed = bytes.slice(start);
  if (trimmed.length === 0 || trimmed.length > COORDINATE_BYTES) {
    return null;
  }
  const out = new Uint8Array(COORDINATE_BYTES);
  out.set(trimmed, COORDINATE_BYTES - trimmed.length);
  return out;
}

/** Convertit une signature ECDSA DER (WebAuthn) en r||s de 64 octets (WebCrypto) ; null si le DER est invalide. */
function derToRawEcdsa(der: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2 || der[2] !== 0x02) {
    return null;
  }
  const rLength = der[3] ?? 0;
  const sTagOffset = 4 + rLength;
  if (der[sTagOffset] !== 0x02 || sTagOffset + 2 > der.length) {
    return null;
  }
  const sLength = der[sTagOffset + 1] ?? 0;
  if (sTagOffset + 2 + sLength !== der.length) {
    return null;
  }
  const r = derIntegerToFixed(der.slice(4, 4 + rLength));
  const s = derIntegerToFixed(der.slice(sTagOffset + 2));
  return r === null || s === null ? null : concatBytes(r, s);
}

async function verifySignature(
  key: CryptoKey,
  algorithm: PasskeyAlgorithm,
  signature: Uint8Array<ArrayBuffer>,
  signedData: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  if (algorithm === COSE_ALG_ES256) {
    const raw = derToRawEcdsa(signature);
    return raw !== null && crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, signedData);
  }
  return crypto.subtle.verify({ name: 'Ed25519' }, key, signature, signedData);
}

// ---------------------------------------------------------------------------
// Enregistrement
// ---------------------------------------------------------------------------

export interface PasskeyRegistrationResult {
  readonly credentialId: string;
  readonly algorithm: PasskeyAlgorithm;
  readonly prfEnabled: boolean;
}

function parseAttestationObject(response: Record<string, unknown>): Uint8Array<ArrayBuffer> {
  let decoded: CborValue;
  try {
    decoded = decodeCbor(bytesField(response, 'attestationObject')).value;
  } catch (error) {
    if (error instanceof CborError) {
      return fail('PASSKEY_REQUEST_MALFORMED', 'attestationObject illisible.');
    }
    throw error;
  }
  if (!(decoded instanceof Map)) {
    return fail('PASSKEY_REQUEST_MALFORMED', 'attestationObject non table.');
  }
  const authData = decoded.get('authData');
  if (!(authData instanceof Uint8Array)) {
    return fail('PASSKEY_REQUEST_MALFORMED', 'authData absent.');
  }
  const attStmt = decoded.get('attStmt');
  if (decoded.get('fmt') !== 'none' || !(attStmt instanceof Map) || attStmt.size !== 0) {
    return fail('PASSKEY_ATTESTATION_UNSUPPORTED', 'seule l’attestation « none » est acceptée.');
  }
  return authData.slice();
}

function transportsOf(response: Record<string, unknown>): readonly string[] {
  const value = response['transports'];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 8) : [];
}

export async function finishPasskeyRegistration(
  deps: PasskeyDeps,
  input: { readonly userId: string; readonly credential: unknown },
): Promise<PasskeyRegistrationResult> {
  const credential = parseCredential(input.credential);
  const clientData = parseClientData(credential.response, 'webauthn.create');
  const challenge = await consumeChallenge(deps, clientData, 'REGISTRATION');
  if (challenge.userId !== input.userId) {
    fail('PASSKEY_USER_MISMATCH', 'challenge émis pour un autre utilisateur.');
  }
  assertOrigin(deps, clientData);
  const authData = parseAuthenticatorData(parseAttestationObject(credential.response));
  await assertAuthenticatorData(deps, authData);
  if (authData.attested === null) {
    return fail('PASSKEY_REQUEST_MALFORMED', 'données d’identifiant attesté absentes.');
  }
  const credentialId = encodeBase64Url(authData.attested.credentialId);
  if (credentialId !== credential.id) {
    fail('PASSKEY_REQUEST_MALFORMED', 'identifiant incohérent avec authenticatorData.');
  }
  const imported = await importCoseKey(authData.attested.coseMap);
  const prf = credential.clientExtensionResults['prf'];
  // Seul l'indicateur `enabled` est lu : `prf.results` (clé dérivée côté navigateur) n'est jamais touché.
  const prfEnabled = isRecord(prf) && prf['enabled'] === true;
  const inserted = await deps.credentials.insert({
    credentialId,
    userId: input.userId,
    publicKeyCose: encodeBase64Url(authData.attested.coseKey),
    algorithm: imported.algorithm,
    signCount: authData.signCount,
    transports: transportsOf(credential.response),
    backupEligible: (authData.flags & FLAG_BE) !== 0,
    backupState: (authData.flags & FLAG_BS) !== 0,
    prfEnabled,
    createdAtEpochSec: deps.nowEpochSec(),
  });
  if (!inserted) {
    fail('PASSKEY_CREDENTIAL_EXISTS', 'identifiant déjà enregistré.');
  }
  return { credentialId, algorithm: imported.algorithm, prfEnabled };
}

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

export interface PasskeyAuthenticationResult {
  readonly userId: string;
  readonly credentialId: string;
  readonly signCount: number;
  readonly backupState: boolean;
}

export async function finishPasskeyAuthentication(
  deps: PasskeyDeps,
  input: { readonly credential: unknown; readonly expectedUserId?: string },
): Promise<PasskeyAuthenticationResult> {
  const credential = parseCredential(input.credential);
  const clientData = parseClientData(credential.response, 'webauthn.get');
  const challenge = await consumeChallenge(deps, clientData, 'AUTHENTICATION');
  assertOrigin(deps, clientData);
  const stored = await deps.credentials.findByCredentialId(credential.id);
  if (stored === null) {
    return fail('PASSKEY_CREDENTIAL_UNKNOWN', 'identifiant inconnu.');
  }
  if (
    (challenge.userId !== null && challenge.userId !== stored.userId) ||
    (input.expectedUserId !== undefined && input.expectedUserId !== stored.userId)
  ) {
    fail('PASSKEY_USER_MISMATCH', 'identifiant d’un autre utilisateur.');
  }
  const userHandle = credential.response['userHandle'];
  if (typeof userHandle === 'string' && userHandle.length > 0) {
    const handle = decodeBase64Url(userHandle);
    if (handle === null || !equalBytes(handle, new TextEncoder().encode(stored.userId))) {
      fail('PASSKEY_USER_MISMATCH', 'userHandle incohérent.');
    }
  }
  const authDataBytes = bytesField(credential.response, 'authenticatorData');
  const authData = parseAuthenticatorData(authDataBytes);
  await assertAuthenticatorData(deps, authData);
  const publicKeyBytes = decodeBase64Url(stored.publicKeyCose);
  if (publicKeyBytes === null) {
    return fail('PASSKEY_ALGORITHM_UNSUPPORTED', 'clé publique mémorisée illisible.');
  }
  const imported = await importCoseKey(coseMapOf(publicKeyBytes));
  if (imported.algorithm !== stored.algorithm) {
    fail('PASSKEY_ALGORITHM_UNSUPPORTED', 'algorithme mémorisé incohérent.');
  }
  const signedData = concatBytes(authDataBytes, await sha256Bytes(clientData.raw));
  if (!(await verifySignature(imported.key, imported.algorithm, bytesField(credential.response, 'signature'), signedData))) {
    fail('PASSKEY_SIGNATURE_INVALID', 'signature invalide.');
  }
  // Compteur monotone : un compteur nul des deux côtés est admis (passkeys synchronisées qui n'en gèrent pas).
  const counterIsManaged = authData.signCount !== 0 || stored.signCount !== 0;
  if (counterIsManaged && authData.signCount <= stored.signCount) {
    fail('PASSKEY_SIGNCOUNT_REPLAY', 'signCount non monotone : clone possible.');
  }
  const backupState = (authData.flags & FLAG_BS) !== 0;
  if (!(await deps.credentials.updateSignCount(stored.credentialId, stored.signCount, authData.signCount, backupState))) {
    fail('PASSKEY_SIGNCOUNT_REPLAY', 'mise à jour concurrente du compteur.');
  }
  return { userId: stored.userId, credentialId: stored.credentialId, signCount: authData.signCount, backupState };
}

function coseMapOf(bytes: Uint8Array<ArrayBuffer>): ReadonlyMap<number | string, CborValue> {
  try {
    const decoded = decodeCbor(bytes).value;
    if (decoded instanceof Map) {
      return decoded;
    }
  } catch (error) {
    if (!(error instanceof CborError)) {
      throw error;
    }
  }
  return fail('PASSKEY_ALGORITHM_UNSUPPORTED', 'clé COSE mémorisée illisible.');
}
