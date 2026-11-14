import { assertCertificateMatchesEmitter } from '@fisca/shared-types';
import { bytesEqual, fromBase64, toBase64, utf8 } from './bytes.ts';
import { OID, parseCertificate, rsaModulusLengthBytes, subjectDistinguishedNameForEmitterCheck, type ParsedCertificate } from './certificate.ts';
import { children, expectTag, parseDer, TAG } from './der.ts';
import type { DigestSigner, SignatureAlgorithm } from './types.ts';

/**
 * Client Barid eSign HSM : Cloud Signature Consortium (CSC) API v2.0 sur mTLS, `signDigestViaBaridEsignCscV2` (CTR-COD-15 ;
 * Doc_17 § 06 et § 11). TypeScript pur, compatible Cloudflare Workers : aucun import node:*, aucun appel réseau direct (le client
 * HTTP est injecté), aucune clé privée, aucun secret journalisé ni recopié dans une erreur.
 *
 * Source des noms de points d'accès et de paramètres : CSC « Architectures and protocols for remote signature applications »,
 * version 2.0.0.2 (Cloud Signature Consortium, 20 avril 2023), § 11.2 auth/login, § 11.5 credentials/info, § 11.6
 * credentials/authorize, § 11.10 signatures/signHash. Tout ce qui est propre à Barid eSign et que Doc_17 pose sans le démontrer est
 * marqué HYPOTHÈSE ci-dessous ; rien n'est vérifié contre un serveur Barid eSign réel.
 *
 * Signature de TEST dans les tests, jamais qualifiée sans HSM Barid eSign réel.
 */

/** OID du condensé SHA-256 (NIST) : valeur de `hashAlgorithmOID`. */
export const CSC_HASH_ALGORITHM_OID = OID.sha256;

/** OID `signAlgo` par algorithme : ecdsa-with-SHA256 ; sha256WithRSAEncryption (ou rsaEncryption si le credential n'annonce que celui-là). */
export const CSC_SIGN_ALGO_OID = {
  ECDSA_P256_SHA256: OID.ecdsaWithSha256,
  RSA_PKCS1_SHA256: OID.sha256WithRsa,
} as const;
const RSA_ENCRYPTION_SIGN_ALGO_OID = OID.rsaEncryption;

/** Délai par appel (Doc_17 § 06 : « Barid eSign HSM/TSA 8 s »). */
export const CSC_DEFAULT_TIMEOUT_MS = 8000;
/** Nombre maximal de tentatives SUPPLÉMENTAIRES de auth/login (seul appel rejouable). */
export const CSC_MAX_LOGIN_RETRIES = 2;

export type CscPhase = 'login' | 'credentialsInfo' | 'credentialsAuthorize' | 'signHash';

export type CscSignerErrorCode =
  | 'CSC_CONFIG_INVALID'
  | 'CSC_DIGEST_INVALID'
  | 'CSC_AUTH_FAILED'
  | 'CSC_AUTHORIZATION_DATA_UNAVAILABLE'
  | 'CSC_AUTHORIZATION_REFUSED'
  | 'CSC_AUTHORIZATION_UNSUPPORTED'
  | 'CSC_SAD_EXPIRED'
  | 'CSC_CREDENTIAL_UNAVAILABLE'
  | 'CSC_REQUEST_REJECTED'
  | 'CSC_SERVER_ERROR'
  | 'CSC_TIMEOUT'
  | 'CSC_NETWORK_ERROR'
  | 'CSC_RESPONSE_INVALID'
  | 'CSC_CERTIFICATE_UNAVAILABLE'
  | 'CSC_CERTIFICATE_CHANGED'
  | 'CSC_CERTIFICATE_ALGORITHM_MISMATCH'
  | 'CSC_ALGORITHM_UNSUPPORTED'
  | 'CSC_SIGNATURE_FORMAT_UNSUPPORTED';

interface CscErrorDetail {
  readonly phase?: CscPhase;
  readonly httpStatus?: number;
  readonly cscError?: string;
}

/**
 * Erreur du client CSC. Le message est constant (par code) : jamais d'identifiant de credential, de DN, d'ICE, de jeton, de SAD, de PIN
 * ni de secret. `cscError` est le code d'erreur CSC (jeton court normalisé, ex. « invalid_request »), jamais sa description.
 * Pour `signHash`, `CSC_TIMEOUT` et `CSC_NETWORK_ERROR` veulent dire « issue inconnue » : l'appelant ne doit pas rejouer à l'aveugle.
 */
export class CscSignerError extends Error {
  readonly code: CscSignerErrorCode;
  readonly phase: CscPhase | undefined;
  readonly httpStatus: number | undefined;
  readonly cscError: string | undefined;

  constructor(code: CscSignerErrorCode, message: string, detail: CscErrorDetail = {}) {
    super(message);
    this.name = 'CscSignerError';
    this.code = code;
    this.phase = detail.phase;
    this.httpStatus = detail.httpStatus;
    this.cscError = detail.cscError;
  }
}

const MESSAGES: Readonly<Record<CscSignerErrorCode, string>> = {
  CSC_CONFIG_INVALID: 'Configuration du client CSC invalide.',
  CSC_DIGEST_INVALID: 'Le condensé à signer doit être un SHA-256 de 32 octets.',
  CSC_AUTH_FAILED: 'Authentification auprès du service CSC refusée.',
  CSC_AUTHORIZATION_DATA_UNAVAILABLE: 'Données d’autorisation du signataire indisponibles.',
  CSC_AUTHORIZATION_REFUSED: 'Autorisation du credential refusée par le service CSC.',
  CSC_AUTHORIZATION_UNSUPPORTED: 'Mode d’autorisation du credential non supporté (réponse différée).',
  CSC_SAD_EXPIRED: 'Activation de signature (SAD) expirée.',
  CSC_CREDENTIAL_UNAVAILABLE: 'Credential de signature indisponible (désactivé, verrouillé, expiré ou certificat non valide).',
  CSC_REQUEST_REJECTED: 'Requête refusée par le service CSC.',
  CSC_SERVER_ERROR: 'Erreur du service CSC.',
  CSC_TIMEOUT: 'Délai dépassé lors de l’appel au service CSC.',
  CSC_NETWORK_ERROR: 'Échec réseau lors de l’appel au service CSC.',
  CSC_RESPONSE_INVALID: 'Réponse du service CSC invalide.',
  CSC_CERTIFICATE_UNAVAILABLE: 'Certificat du signataire absent ou illisible dans la réponse CSC.',
  CSC_CERTIFICATE_CHANGED: 'Le certificat du credential ne correspond pas au certificat attendu.',
  CSC_CERTIFICATE_ALGORITHM_MISMATCH: 'L’algorithme demandé ne correspond pas à la clé du certificat.',
  CSC_ALGORITHM_UNSUPPORTED: 'Algorithme de signature non supporté par ce credential ou par ce client.',
  CSC_SIGNATURE_FORMAT_UNSUPPORTED: 'Format de signature retourné par le HSM non reconnu (échec fermé).',
};

function cscError(code: CscSignerErrorCode, detail: CscErrorDetail = {}): CscSignerError {
  return new CscSignerError(code, MESSAGES[code], detail);
}

/** Sous-ensemble de RequestInit utilisé (compatible avec le `fetch` d'un binding mTLS de Cloudflare Workers). */
export interface CscRequestInit {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal?: AbortSignal;
}

/** Sous-ensemble de Response utilisé. */
export interface CscResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/**
 * Client HTTP injecté par l'appelant. En production Workers : le `fetch` d'un binding de certificat mTLS (le certificat client est une
 * ressource de la plateforme, jamais une clé dans ce paquet). Dans les tests : un faux serveur local.
 */
export interface CscHttpClient {
  readonly fetch: (url: string, init: CscRequestInit) => Promise<CscResponse>;
}

/** Objet d'authentification (CSC § 8.3.1) : « { id, value } », ex. PIN ou OTP collecté par l'application appelante. */
export interface CscAuthObject {
  readonly id: string;
  readonly value: string;
}

export interface BaridEsignCscV2Config {
  /** URL de base HTTPS du service CSC (ex. « https://host/ » ; les chemins « /csc/v2/... » lui sont ajoutés). */
  readonly baseUrl: string;
  readonly http: CscHttpClient;
  readonly credentialId: string;
  /** ICE (15 chiffres) et IF de l'émetteur : confrontés au Subject DN du certificat par assertCertificateMatchesEmitter. */
  readonly emitterIce: string;
  readonly emitterIf: string;
  /**
   * HYPOTHÈSE (Doc_17 § 06 ne précise pas le mode de service authorization de Barid eSign) : auth/login par HTTP Basic (CSC § 11.2),
   * identifiant client + secret (BARID_ESIGN_CSC_SECRET). Le secret arrive ici par configuration ; il n'est ni journalisé ni copié dans une erreur.
   */
  readonly auth: { readonly clientId: string; readonly clientSecret: string };
  /**
   * Fournit les objets d'authentification du credential (PIN HSM, OTP : CSC § 11.6 authData). Appelé UNIQUEMENT après le contrôle bloquant du
   * certificat. Jamais conservé, jamais journalisé.
   */
  readonly authorizationData: () => Promise<readonly CscAuthObject[]>;
  /** Certificat attendu (DER), p. ex. celui passé à `signUblXades` : tout écart avec credentials/info fait échouer fermé. */
  readonly expectedCertificateDer?: Uint8Array;
  /** Délai par appel en ms (défaut CSC_DEFAULT_TIMEOUT_MS). */
  readonly timeoutMs?: number;
  /** Tentatives supplémentaires de auth/login seulement (0 par défaut, 2 au plus). Jamais de nouvelle tentative sur credentials/authorize ni signHash. */
  readonly loginRetries?: number;
}

interface Settings {
  readonly base: string;
  readonly timeoutMs: number;
  readonly loginRetries: number;
}

function validateConfig(config: BaridEsignCscV2Config): Settings {
  const nonEmpty = (value: unknown): boolean => typeof value === 'string' && value.length > 0;
  const timeoutMs = config.timeoutMs ?? CSC_DEFAULT_TIMEOUT_MS;
  const loginRetries = config.loginRetries ?? 0;
  if (
    typeof config.baseUrl !== 'string' ||
    !/^https:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/.test(config.baseUrl) ||
    !nonEmpty(config.credentialId) ||
    !nonEmpty(config.auth?.clientId) ||
    !nonEmpty(config.auth?.clientSecret) ||
    config.auth.clientId.includes(':') ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isInteger(loginRetries) ||
    loginRetries < 0 ||
    loginRetries > CSC_MAX_LOGIN_RETRIES ||
    typeof config.http?.fetch !== 'function' ||
    typeof config.authorizationData !== 'function'
  ) {
    throw cscError('CSC_CONFIG_INVALID');
  }
  return { base: config.baseUrl.replace(/\/+$/, ''), timeoutMs, loginRetries };
}

interface CscReply {
  readonly status: number;
  readonly body: unknown;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

const field = (source: unknown, key: string): unknown => (isRecord(source) ? source[key] : undefined);

/** Un seul appel HTTP, borné par un délai (AbortController et course : un client qui ignore le signal est aussi coupé). Aucune nouvelle tentative ici. */
async function post(
  config: BaridEsignCscV2Config,
  settings: Settings,
  phase: CscPhase,
  path: string,
  headers: Readonly<Record<string, string>>,
  payload: unknown,
): Promise<CscReply> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(cscError('CSC_TIMEOUT', { phase }));
    }, settings.timeoutMs);
  });
  try {
    const request = config.http
      .fetch(`${settings.base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      .then(
        async (response): Promise<CscReply> => {
          let body: unknown;
          try {
            body = await response.json();
          } catch {
            body = undefined;
          }
          return { status: response.status, body };
        },
        (): never => {
          throw cscError(controller.signal.aborted ? 'CSC_TIMEOUT' : 'CSC_NETWORK_ERROR', { phase });
        },
      );
    request.catch(() => undefined);
    return await Promise.race([request, expiry]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Jeton d'erreur CSC normalisé (« invalid_request »…) ; description jamais conservée (peut contenir un DN). */
function errorToken(body: unknown): string | undefined {
  const token = field(body, 'error');
  return typeof token === 'string' && /^[a-z_]{1,40}$/.test(token) ? token : undefined;
}

function errorDescription(body: unknown): string {
  const description = field(body, 'error_description');
  return typeof description === 'string' ? description : '';
}

/** Transforme une réponse non 2xx en erreur typée sans recopier de contenu distant. */
function failureOf(phase: CscPhase, reply: CscReply): CscSignerError {
  const token = errorToken(reply.body);
  const detail: CscErrorDetail = { phase, httpStatus: reply.status, ...(token === undefined ? {} : { cscError: token }) };
  const description = errorDescription(reply.body);
  if (reply.status >= 500) return cscError('CSC_SERVER_ERROR', detail);
  if (reply.status === 401 || token === 'authentication_error' || token === 'access_denied') return cscError('CSC_AUTH_FAILED', detail);
  if (/\bSAD\b[^.]*\bexpired\b|\bexpired\b[^.]*\bSAD\b/i.test(description)) return cscError('CSC_SAD_EXPIRED', detail);
  if (token === 'invalid_otp' || token === 'invalid_authentication_data') return cscError('CSC_AUTHORIZATION_REFUSED', detail);
  if (/\b(disabled|locked|expired|revoked|suspended)\b/i.test(description)) return cscError('CSC_CREDENTIAL_UNAVAILABLE', detail);
  return cscError('CSC_REQUEST_REJECTED', detail);
}

function succeeded(reply: CscReply): boolean {
  return reply.status >= 200 && reply.status < 300;
}

function stringProperty(source: unknown, key: string, phase: CscPhase): string {
  const value = field(source, key);
  if (typeof value !== 'string' || value.length === 0) throw cscError('CSC_RESPONSE_INVALID', { phase });
  return value;
}

/** auth/login (CSC § 11.2) : HTTP Basic, jeton « access_token » ; seule étape avec nouvelle tentative explicite (erreurs réseau, délai, 5xx). */
async function login(config: BaridEsignCscV2Config, settings: Settings): Promise<string> {
  const basic = toBase64(utf8(`${config.auth.clientId}:${config.auth.clientSecret}`));
  let lastFailure: CscSignerError = cscError('CSC_AUTH_FAILED', { phase: 'login' });
  for (let attempt = 0; attempt <= settings.loginRetries; attempt += 1) {
    try {
      const reply = await post(config, settings, 'login', '/csc/v2/auth/login', { Authorization: `Basic ${basic}` }, { rememberMe: false });
      if (!succeeded(reply)) throw failureOf('login', reply);
      return stringProperty(reply.body, 'access_token', 'login');
    } catch (error) {
      if (!(error instanceof CscSignerError)) throw error;
      lastFailure = error;
      const retryable = error.code === 'CSC_TIMEOUT' || error.code === 'CSC_NETWORK_ERROR' || error.code === 'CSC_SERVER_ERROR';
      if (!retryable) throw error;
    }
  }
  throw lastFailure;
}

interface CredentialInfo {
  readonly certificate: ParsedCertificate;
  readonly keyAlgorithmOids: readonly string[];
}

/** credentials/info (CSC § 11.5) avec certificates=single ; contrôle BLOQUANT ADR-06 du Subject DN avant toute autre étape. */
async function inspectCredential(config: BaridEsignCscV2Config, settings: Settings, accessToken: string): Promise<CredentialInfo> {
  const reply = await post(
    config,
    settings,
    'credentialsInfo',
    '/csc/v2/credentials/info',
    { Authorization: `Bearer ${accessToken}` },
    { credentialID: config.credentialId, certificates: 'single', certInfo: false, authInfo: false },
  );
  if (!succeeded(reply)) throw failureOf('credentialsInfo', reply);
  const body = reply.body;
  const key = field(body, 'key');
  const cert = field(body, 'cert');
  if (!isRecord(key) || !isRecord(cert)) throw cscError('CSC_RESPONSE_INVALID', { phase: 'credentialsInfo' });
  const certStatus = field(cert, 'status');
  if (field(key, 'status') === 'disabled' || (typeof certStatus === 'string' && certStatus !== 'valid')) {
    throw cscError('CSC_CREDENTIAL_UNAVAILABLE', { phase: 'credentialsInfo' });
  }
  const algo = field(key, 'algo');
  if (!Array.isArray(algo) || !algo.every((entry): entry is string => typeof entry === 'string')) {
    throw cscError('CSC_RESPONSE_INVALID', { phase: 'credentialsInfo' });
  }
  const certificates = field(cert, 'certificates');
  const first: unknown = Array.isArray(certificates) ? certificates[0] : undefined;
  if (typeof first !== 'string') throw cscError('CSC_CERTIFICATE_UNAVAILABLE', { phase: 'credentialsInfo' });
  let certificate: ParsedCertificate;
  let subjectDn: string;
  try {
    certificate = parseCertificate(fromBase64(first));
    subjectDn = subjectDistinguishedNameForEmitterCheck(certificate.subjectDer);
  } catch {
    throw cscError('CSC_CERTIFICATE_UNAVAILABLE', { phase: 'credentialsInfo' });
  }
  // Contrôle bloquant : OID X.509 2.5.4.97 / 2.5.4.5 == ICE / IF de l'émetteur (échec : AdrInvariantError ADR_06_LOI4320_CERT_MISMATCH).
  assertCertificateMatchesEmitter(subjectDn, config.emitterIce, config.emitterIf);
  if (config.expectedCertificateDer !== undefined && !bytesEqual(config.expectedCertificateDer, certificate.der)) {
    throw cscError('CSC_CERTIFICATE_CHANGED', { phase: 'credentialsInfo' });
  }
  return { certificate, keyAlgorithmOids: algo };
}

/**
 * Récupère le certificat du signataire (credentials/info) APRÈS le contrôle bloquant ICE/IF, pour le passer à `signUblXades` / `signPades`.
 * Échec du contrôle : AdrInvariantError (ADR_06_LOI4320_CERT_MISMATCH).
 */
export async function fetchBaridEsignCscV2Certificate(config: BaridEsignCscV2Config): Promise<Uint8Array> {
  const settings = validateConfig(config);
  const token = await login(config, settings);
  return (await inspectCredential(config, settings, token)).certificate.der;
}

/** `signAlgo` à envoyer : celui que le credential annonce (key/algo), sinon échec fermé. */
function chooseSignAlgo(algorithm: SignatureAlgorithm, advertised: readonly string[]): string {
  const preferred = CSC_SIGN_ALGO_OID[algorithm];
  if (advertised.includes(preferred)) return preferred;
  if (algorithm === 'RSA_PKCS1_SHA256' && advertised.includes(RSA_ENCRYPTION_SIGN_ALGO_OID)) return RSA_ENCRYPTION_SIGN_ALGO_OID;
  throw cscError('CSC_ALGORITHM_UNSUPPORTED', { phase: 'credentialsInfo' });
}

const formatError = (): CscSignerError => cscError('CSC_SIGNATURE_FORMAT_UNSUPPORTED', { phase: 'signHash' });

/** Entier ECDSA DER strict : positif, minimal, non nul, au plus `size` octets significatifs ; retourne ses octets complétés à `size`. */
function derIntegerToFixed(content: Uint8Array, size: number): Uint8Array {
  if (content.length === 0) throw formatError();
  const first = content[0] ?? 0;
  if (first >= 0x80) throw formatError();
  if (first === 0 && content.length > 1 && (content[1] ?? 0) < 0x80) throw formatError();
  const trimmed = first === 0 && content.length > 1 ? content.subarray(1) : content;
  if (trimmed.length > size || trimmed.every((byte) => byte === 0)) throw formatError();
  const out = new Uint8Array(size);
  out.set(trimmed, size - trimmed.length);
  return out;
}

export interface NormalizeCscSignatureOptions {
  /** Longueur du module RSA en octets (certificat) : seule longueur acceptée pour une signature RSA brute. */
  readonly rsaModulusLength?: number;
}

/**
 * Convertit la signature renvoyée par signHash vers le contrat de `DigestSigner` (décision du pilote), ÉCHEC FERMÉ sur tout format inconnu :
 * - ECDSA P-256 : DER `SEQUENCE { r, s }` strict → r‖s de 64 octets (entiers complétés ou rognés) ; 64 octets → déjà r‖s (r et s non nuls) ; autre → refus.
 * - RSA PKCS#1 v1.5 : octets bruts d'exactement la longueur du module ; autre → refus.
 * - tout autre algorithme : refus.
 * Hypothèse non vérifiée : le format réel du HSM Barid eSign (brut, ou DER pour ECDSA).
 */
export function normalizeCscSignature(raw: Uint8Array, algorithm: SignatureAlgorithm, options: NormalizeCscSignatureOptions = {}): Uint8Array {
  if (algorithm === 'ECDSA_P256_SHA256') {
    if (raw.length === 64) {
      if (raw.subarray(0, 32).every((byte) => byte === 0) || raw.subarray(32).every((byte) => byte === 0)) throw formatError();
      return Uint8Array.from(raw);
    }
    if ((raw[0] ?? 0) !== 0x30) throw formatError();
    let parts;
    try {
      parts = children(expectTag(parseDer(raw), TAG.SEQUENCE));
    } catch {
      throw formatError();
    }
    const r = parts[0];
    const s = parts[1];
    if (parts.length !== 2 || r === undefined || s === undefined || r.tag !== TAG.INTEGER || s.tag !== TAG.INTEGER) throw formatError();
    const out = new Uint8Array(64);
    out.set(derIntegerToFixed(r.content, 32), 0);
    out.set(derIntegerToFixed(s.content, 32), 32);
    return out;
  }
  if (algorithm === 'RSA_PKCS1_SHA256') {
    const modulusLength = options.rsaModulusLength;
    if (modulusLength === undefined || !Number.isInteger(modulusLength) || modulusLength < 128 || raw.length !== modulusLength) throw formatError();
    return Uint8Array.from(raw);
  }
  throw cscError('CSC_ALGORITHM_UNSUPPORTED', { phase: 'signHash' });
}

/**
 * Fabrique d'un `DigestSigner` adossé au HSM Barid eSign par CSC API v2.0 (mTLS fourni par `config.http`).
 *
 * Chaque `signDigest` enchaîne : auth/login → credentials/info (certificat) → CONTRÔLE BLOQUANT OID X.509 2.5.4.97/2.5.4.5 == ICE/IF
 * (assertCertificateMatchesEmitter ; échec : AdrInvariantError ADR_06_LOI4320_CERT_MISMATCH, avant credentials/authorize et signHash) →
 * credentials/authorize (SAD lié au condensé, SCAL2) → UN SEUL appel signatures/signHash, sans nouvelle tentative (idempotence : un échec
 * ou un délai laisse l'issue inconnue ; l'appelant décide). Seul le condensé SHA-256 de 32 octets quitte le Worker.
 */
export function signDigestViaBaridEsignCscV2(config: BaridEsignCscV2Config): DigestSigner {
  const settings = validateConfig(config);
  return {
    async signDigest(digestSha256: Uint8Array, signatureAlgorithm: SignatureAlgorithm): Promise<Uint8Array> {
      if (!(digestSha256 instanceof Uint8Array) || digestSha256.length !== 32) throw cscError('CSC_DIGEST_INVALID');
      if (signatureAlgorithm !== 'ECDSA_P256_SHA256' && signatureAlgorithm !== 'RSA_PKCS1_SHA256') throw cscError('CSC_ALGORITHM_UNSUPPORTED');

      const accessToken = await login(config, settings);
      const info = await inspectCredential(config, settings, accessToken);
      if (info.certificate.algorithm !== signatureAlgorithm) throw cscError('CSC_CERTIFICATE_ALGORITHM_MISMATCH', { phase: 'credentialsInfo' });
      const signAlgo = chooseSignAlgo(signatureAlgorithm, info.keyAlgorithmOids);
      const rsaModulusLength = signatureAlgorithm === 'RSA_PKCS1_SHA256' ? rsaModulusLengthBytes(info.certificate.spkiDer) : undefined;
      const hash = toBase64(digestSha256);

      let authData: readonly CscAuthObject[];
      try {
        authData = await config.authorizationData();
      } catch {
        throw cscError('CSC_AUTHORIZATION_DATA_UNAVAILABLE');
      }
      const authorization = await post(
        config,
        settings,
        'credentialsAuthorize',
        '/csc/v2/credentials/authorize',
        { Authorization: `Bearer ${accessToken}` },
        {
          credentialID: config.credentialId,
          numSignatures: 1,
          hashes: [hash],
          hashAlgorithmOID: CSC_HASH_ALGORITHM_OID,
          authData: authData.map((object) => ({ id: object.id, value: object.value })),
        },
      );
      if (authorization.status === 202) throw cscError('CSC_AUTHORIZATION_UNSUPPORTED', { phase: 'credentialsAuthorize', httpStatus: 202 });
      if (!succeeded(authorization)) throw failureOf('credentialsAuthorize', authorization);
      const sad = stringProperty(authorization.body, 'SAD', 'credentialsAuthorize');

      const signed = await post(
        config,
        settings,
        'signHash',
        '/csc/v2/signatures/signHash',
        { Authorization: `Bearer ${accessToken}` },
        { credentialID: config.credentialId, SAD: sad, hashes: [hash], hashAlgorithmOID: CSC_HASH_ALGORITHM_OID, signAlgo },
      );
      if (!succeeded(signed)) throw failureOf('signHash', signed);
      const signatures = field(signed.body, 'signatures');
      if (!Array.isArray(signatures) || signatures.length !== 1 || typeof signatures[0] !== 'string') {
        throw cscError('CSC_RESPONSE_INVALID', { phase: 'signHash' });
      }
      let raw: Uint8Array;
      try {
        raw = fromBase64(signatures[0]);
      } catch {
        throw cscError('CSC_RESPONSE_INVALID', { phase: 'signHash' });
      }
      return normalizeCscSignature(raw, signatureAlgorithm, rsaModulusLength === undefined ? {} : { rsaModulusLength });
    },
  };
}
