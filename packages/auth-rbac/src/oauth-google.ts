/**
 * Courtier Google OAuth 2.0 / OIDC avec PKCE S256 et Safe Account Linking sur `sub`
 * (Doc_09 § 02 et § 04 ; ticket T-S1A-02 ; contrats CTR-API-04, CTR-API-05, CTR-SEC-03, CTR-SQL-09).
 *
 * Règles :
 * - WebCrypto uniquement (compatible Cloudflare Workers) ; aucun accès réseau, horloge ni stockage en dur :
 *   tout passe par des ports injectés (client HTTP, JWKS, stockage des transactions, dépôt des comptes).
 * - Le secret GOOGLE_OAUTH_CLIENT_SECRET et le pepper AUTH_PEPPER sont fournis par l'appelant, jamais lus ici.
 * - Un compte se lie par le claim `sub`, jamais par l'e-mail seul. Un e-mail déjà porté par un compte non lié
 *   exige une preuve (mot de passe ou lien e-mail) avant liaison : aucune prise de contrôle automatique.
 * - Un e-mail Google non vérifié est refusé.
 * - La table `user_oauth_accounts` (CTR-SQL-09) est produite par S1B : ce module ne définit que le port
 *   `OAuthAccountRepository` que l'implémentation D1 satisfera.
 */

import { timingSafeEqualBytes, verifyPasswordWorkerSafe } from './auth-2fa.ts';

// ---------------------------------------------------------------------------
// Constantes publiques de Google (documentation OpenID Connect de Google)
// ---------------------------------------------------------------------------

export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth' as const;
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token' as const;
export const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs' as const;
export const GOOGLE_ISSUERS: readonly string[] = ['https://accounts.google.com', 'accounts.google.com'];
export const GOOGLE_SCOPES = 'openid email profile' as const;

/** Durée de vie d'une transaction state/nonce/verifier : 10 minutes. */
export const OAUTH_TRANSACTION_TTL_SEC = 600 as const;
/** Durée de vie d'une liaison en attente de preuve : 15 minutes. */
export const PENDING_LINK_TTL_SEC = 900 as const;
/** Nombre d'essais de preuve avant destruction de la liaison en attente. */
export const PENDING_LINK_MAX_ATTEMPTS = 5 as const;

const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const MAX_AUTHORIZATION_CODE_LENGTH = 2048;
const RANDOM_TOKEN_BYTES = 32;

// ---------------------------------------------------------------------------
// Erreurs typées
// ---------------------------------------------------------------------------

export type GoogleOAuthErrorCode =
  | 'PKCE_VERIFIER_INVALID'
  | 'TURNSTILE_REQUIRED'
  | 'STATE_INVALID'
  | 'STATE_EXPIRED'
  | 'CODE_MISSING'
  | 'PROVIDER_ERROR'
  | 'TOKEN_EXCHANGE_FAILED'
  | 'ID_TOKEN_MALFORMED'
  | 'ID_TOKEN_SIGNATURE_INVALID'
  | 'ID_TOKEN_ISSUER_INVALID'
  | 'ID_TOKEN_AUDIENCE_INVALID'
  | 'ID_TOKEN_EXPIRED'
  | 'ID_TOKEN_NONCE_INVALID'
  | 'EMAIL_NOT_VERIFIED'
  | 'LINK_PENDING_NOT_FOUND'
  | 'LINK_PENDING_EXPIRED'
  | 'LINK_PROOF_INVALID'
  | 'SUB_ALREADY_LINKED';

export class GoogleOAuthError extends Error {
  readonly code: GoogleOAuthErrorCode;

  constructor(code: GoogleOAuthErrorCode, detail: string) {
    super(`GOOGLE_OAUTH_${code}: ${detail}`);
    this.name = 'GoogleOAuthError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Utilitaires binaires (base64url, aléa, SHA-256)
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export type RandomBytes = (length: number) => Uint8Array;

/** Source d'aléa par défaut : WebCrypto. */
export const webCryptoRandomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Décode du base64url sans remplissage ; renvoie null si l'entrée n'est pas du base64url valide. */
function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL_PATTERN.test(input) || input.length % 4 === 1) {
    return null;
  }
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      out[index] = binary.charCodeAt(index);
    }
    return out;
  } catch {
    return null;
  }
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function randomToken(randomBytes: RandomBytes): string {
  return base64UrlEncode(randomBytes(RANDOM_TOKEN_BYTES));
}

function constantTimeStringEqual(left: string, right: string): boolean {
  return timingSafeEqualBytes(textEncoder.encode(left), textEncoder.encode(right));
}

// ---------------------------------------------------------------------------
// PKCE S256 (RFC 7636)
// ---------------------------------------------------------------------------

/** Vrai si la chaîne respecte RFC 7636 § 4.1 : 43 à 128 caractères du jeu non réservé. */
export function isValidCodeVerifier(verifier: string): boolean {
  return CODE_VERIFIER_PATTERN.test(verifier);
}

/** code_verifier aléatoire : 32 octets d'aléa en base64url = 43 caractères. */
export function generateCodeVerifier(randomBytes: RandomBytes = webCryptoRandomBytes): string {
  return randomToken(randomBytes);
}

/** code_challenge = base64url(SHA-256(code_verifier)) (méthode S256). */
export async function computeCodeChallengeS256(codeVerifier: string): Promise<string> {
  if (!isValidCodeVerifier(codeVerifier)) {
    throw new GoogleOAuthError('PKCE_VERIFIER_INVALID', 'le code_verifier doit comporter 43 à 128 caractères RFC 7636.');
  }
  return base64UrlEncode(await sha256(textEncoder.encode(codeVerifier)));
}

// ---------------------------------------------------------------------------
// Ports injectables
// ---------------------------------------------------------------------------

export interface GoogleOAuthConfig {
  readonly clientId: string;
  /** Valeur de GOOGLE_OAUTH_CLIENT_SECRET, fournie par l'environnement. */
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/** Transaction d'autorisation : state, nonce et verifier à usage unique. */
export interface OAuthTransaction {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  /** Preuve que la route /google/start a passé Turnstile avant l'émission de ce state. */
  readonly turnstileVerified: boolean;
  readonly expiresAtEpochSec: number;
}

export interface OAuthTransactionStore {
  save(transaction: OAuthTransaction): Promise<void>;
  /** Lecture ET suppression atomiques : un second appel avec le même state renvoie null. */
  consume(state: string): Promise<OAuthTransaction | null>;
}

export interface OAuthHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface OAuthHttpClient {
  postForm(url: string, form: Readonly<Record<string, string>>): Promise<OAuthHttpResponse>;
}

/** Signature minimale de fetch ; la fonction réelle est injectée par l'appelant. */
export type FetchLike = (
  input: string,
  init: { readonly method: 'POST'; readonly headers: Readonly<Record<string, string>>; readonly body: string },
) => Promise<{ readonly status: number; json(): Promise<unknown> }>;

export function createFetchHttpClient(fetchFn: FetchLike): OAuthHttpClient {
  return {
    postForm: async (url, form) => {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      });
      const body: unknown = await response.json().catch((): unknown => null);
      return { status: response.status, body };
    },
  };
}

export interface JwksProvider {
  /** Clé publique de vérification RS256 pour ce kid, ou null si elle est inconnue. */
  getVerificationKey(kid: string): Promise<CryptoKey | null>;
}

export type OAuthProvider = 'GOOGLE';

export interface ExistingUserRecord {
  readonly userId: string;
  /** NULL si le compte a été créé exclusivement via Google. */
  readonly passwordHash: string | null;
}

export interface CreateOAuthUserInput {
  readonly provider: OAuthProvider;
  readonly subject: string;
  readonly emailNormalized: string;
  readonly providerEmail: string;
  readonly fullName: string;
  readonly avatarUrl: string | null;
}

export interface LinkOAuthAccountInput {
  readonly userId: string;
  readonly provider: OAuthProvider;
  readonly subject: string;
  readonly providerEmail: string;
}

/**
 * Port du dépôt des comptes (table `user_oauth_accounts`, CTR-SQL-09, et `users`) ; l'implémentation D1 est
 * livrée par S1B. `createUserWithOAuthAccount` doit être atomique ; `linkOAuthAccount` doit échouer si la
 * contrainte UNIQUE(provider, provider_subject_id) est violée.
 */
export interface OAuthAccountRepository {
  findOAuthAccount(provider: OAuthProvider, subject: string): Promise<{ readonly userId: string } | null>;
  findUserByEmailNormalized(emailNormalized: string): Promise<ExistingUserRecord | null>;
  createUserWithOAuthAccount(input: CreateOAuthUserInput): Promise<{ readonly userId: string }>;
  linkOAuthAccount(input: LinkOAuthAccountInput): Promise<void>;
}

export type LinkProofMethod = 'PASSWORD' | 'EMAIL_LINK';

/** Liaison en attente de preuve ; ne contient que l'empreinte du jeton e-mail. */
export interface PendingLink {
  readonly id: string;
  readonly userId: string;
  readonly provider: OAuthProvider;
  readonly subject: string;
  readonly providerEmail: string;
  readonly hasPassword: boolean;
  readonly emailProofTokenSha256: string;
  readonly attemptsLeft: number;
  readonly expiresAtEpochSec: number;
}

export interface PendingLinkStore {
  save(link: PendingLink): Promise<void>;
  /** Lecture ET suppression atomiques. */
  take(id: string): Promise<PendingLink | null>;
}

export interface EmailProofMessage {
  readonly emailNormalized: string;
  /** Jeton en clair à placer dans le lien envoyé par e-mail ; seule son empreinte est stockée. */
  readonly token: string;
}

export interface EmailProofSender {
  sendLinkProof(message: EmailProofMessage): Promise<void>;
}

export interface GoogleOAuthDeps {
  readonly config: GoogleOAuthConfig;
  readonly transactions: OAuthTransactionStore;
  readonly http: OAuthHttpClient;
  readonly jwks: JwksProvider;
  readonly accounts: OAuthAccountRepository;
  readonly pendingLinks: PendingLinkStore;
  readonly emailProof: EmailProofSender;
  readonly nowEpochSec: () => number;
  readonly randomBytes?: RandomBytes;
}

// ---------------------------------------------------------------------------
// Démarrage : URL d'autorisation
// ---------------------------------------------------------------------------

export interface BeginAuthorizationInput {
  /** Vrai seulement si la couche route a validé le jeton Turnstile. */
  readonly turnstileVerified: boolean;
}

export interface BeginAuthorizationResult {
  readonly authorizationUrl: string;
  readonly state: string;
}

export async function beginGoogleAuthorization(
  deps: Pick<GoogleOAuthDeps, 'config' | 'transactions' | 'nowEpochSec' | 'randomBytes'>,
  input: BeginAuthorizationInput,
): Promise<BeginAuthorizationResult> {
  if (!input.turnstileVerified) {
    throw new GoogleOAuthError('TURNSTILE_REQUIRED', 'la preuve Turnstile est exigée avant tout démarrage.');
  }
  const random = deps.randomBytes ?? webCryptoRandomBytes;
  const state = randomToken(random);
  const nonce = randomToken(random);
  const codeVerifier = generateCodeVerifier(random);
  const codeChallenge = await computeCodeChallengeS256(codeVerifier);

  await deps.transactions.save({
    state,
    nonce,
    codeVerifier,
    turnstileVerified: true,
    expiresAtEpochSec: deps.nowEpochSec() + OAUTH_TRANSACTION_TTL_SEC,
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: deps.config.clientId,
    redirect_uri: deps.config.redirectUri,
    scope: GOOGLE_SCOPES,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return { authorizationUrl: `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`, state };
}

// ---------------------------------------------------------------------------
// JWKS
// ---------------------------------------------------------------------------

interface RsaJwkEntry {
  readonly kid: string;
  readonly n: string;
  readonly e: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJwks(document: unknown): readonly RsaJwkEntry[] {
  if (!isRecord(document) || !Array.isArray(document['keys'])) {
    return [];
  }
  const entries: RsaJwkEntry[] = [];
  for (const candidate of document['keys'] as readonly unknown[]) {
    if (!isRecord(candidate)) continue;
    const { kid, kty, n, e } = candidate;
    if (kty === 'RSA' && typeof kid === 'string' && typeof n === 'string' && typeof e === 'string') {
      entries.push({ kid, n, e });
    }
  }
  return entries;
}

/**
 * Fournisseur JWKS à cache par kid. `fetchJwks` (injecté) renvoie le document JSON de GOOGLE_JWKS_URI ;
 * il n'est rappelé que lorsqu'un kid est inconnu. Toute erreur de récupération donne « clé inconnue ».
 */
export function createJwksProvider(fetchJwks: () => Promise<unknown>): JwksProvider {
  const cache = new Map<string, CryptoKey>();
  return {
    getVerificationKey: async (kid) => {
      const cached = cache.get(kid);
      if (cached !== undefined) {
        return cached;
      }
      let document: unknown;
      try {
        document = await fetchJwks();
      } catch {
        return null;
      }
      for (const entry of parseJwks(document)) {
        try {
          const key = await crypto.subtle.importKey(
            'jwk',
            { kty: 'RSA', n: entry.n, e: entry.e, alg: 'RS256', ext: true },
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify'],
          );
          cache.set(entry.kid, key);
        } catch {
          continue;
        }
      }
      return cache.get(kid) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Validation de l'id_token
// ---------------------------------------------------------------------------

export interface GoogleIdentityClaims {
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly picture: string | null;
}

export interface VerifyIdTokenParams {
  readonly idToken: string;
  readonly expectedNonce: string;
  readonly clientId: string;
  readonly nowEpochSec: number;
  readonly jwks: JwksProvider;
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  const bytes = base64UrlDecode(segment);
  if (bytes === null) {
    throw new GoogleOAuthError('ID_TOKEN_MALFORMED', 'segment non base64url.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(bytes));
  } catch {
    throw new GoogleOAuthError('ID_TOKEN_MALFORMED', "segment qui n'est pas du JSON.");
  }
  if (!isRecord(parsed)) {
    throw new GoogleOAuthError('ID_TOKEN_MALFORMED', "segment qui n'est pas un objet JSON.");
  }
  return parsed;
}

function isEmailVerifiedClaim(value: unknown): boolean {
  return value === true || value === 'true';
}

/** Valide signature (RS256 via JWKS), iss, aud, exp, nonce et email_verified ; renvoie les claims utiles. */
export async function verifyGoogleIdToken(params: VerifyIdTokenParams): Promise<GoogleIdentityClaims> {
  const segments = params.idToken.split('.');
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (
    segments.length !== 3 ||
    headerSegment === undefined ||
    payloadSegment === undefined ||
    signatureSegment === undefined ||
    headerSegment.length === 0 ||
    payloadSegment.length === 0 ||
    signatureSegment.length === 0
  ) {
    throw new GoogleOAuthError('ID_TOKEN_MALFORMED', 'un JWT comporte trois segments.');
  }
  const header = decodeJsonSegment(headerSegment);
  const payload = decodeJsonSegment(payloadSegment);
  const signature = base64UrlDecode(signatureSegment);
  if (signature === null) {
    throw new GoogleOAuthError('ID_TOKEN_MALFORMED', 'signature non base64url.');
  }
  if (header['alg'] !== 'RS256' || typeof header['kid'] !== 'string') {
    throw new GoogleOAuthError('ID_TOKEN_MALFORMED', 'alg RS256 et kid sont exigés.');
  }

  const key = await params.jwks.getVerificationKey(header['kid']);
  if (key === null) {
    throw new GoogleOAuthError('ID_TOKEN_SIGNATURE_INVALID', 'clé de vérification inconnue.');
  }
  const signedBytes = textEncoder.encode(`${headerSegment}.${payloadSegment}`);
  const signatureOk = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedBytes);
  if (!signatureOk) {
    throw new GoogleOAuthError('ID_TOKEN_SIGNATURE_INVALID', 'signature invalide.');
  }

  const iss = payload['iss'];
  if (typeof iss !== 'string' || !GOOGLE_ISSUERS.includes(iss)) {
    throw new GoogleOAuthError('ID_TOKEN_ISSUER_INVALID', 'émetteur inattendu.');
  }

  const aud = payload['aud'];
  const audiences: readonly unknown[] = Array.isArray(aud) ? (aud as readonly unknown[]) : [aud];
  if (!audiences.includes(params.clientId)) {
    throw new GoogleOAuthError('ID_TOKEN_AUDIENCE_INVALID', 'aud ne contient pas ce client.');
  }
  const azp = payload['azp'];
  if (azp !== undefined && azp !== params.clientId) {
    throw new GoogleOAuthError('ID_TOKEN_AUDIENCE_INVALID', 'azp ne correspond pas à ce client.');
  }

  const exp = payload['exp'];
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= params.nowEpochSec) {
    throw new GoogleOAuthError('ID_TOKEN_EXPIRED', 'jeton expiré ou sans exp.');
  }

  const nonce = payload['nonce'];
  if (typeof nonce !== 'string' || !constantTimeStringEqual(nonce, params.expectedNonce)) {
    throw new GoogleOAuthError('ID_TOKEN_NONCE_INVALID', 'nonce absent ou différent.');
  }

  const sub = payload['sub'];
  const email = payload['email'];
  if (typeof sub !== 'string' || sub.length === 0 || typeof email !== 'string' || email.length === 0) {
    throw new GoogleOAuthError('ID_TOKEN_MALFORMED', 'sub et email sont exigés.');
  }
  if (!isEmailVerifiedClaim(payload['email_verified'])) {
    throw new GoogleOAuthError('EMAIL_NOT_VERIFIED', "l'e-mail Google n'est pas vérifié.");
  }
  const name = payload['name'];
  const picture = payload['picture'];
  return {
    sub,
    email,
    emailVerified: true,
    name: typeof name === 'string' && name.length > 0 ? name : null,
    picture: typeof picture === 'string' && picture.length > 0 ? picture : null,
  };
}

// ---------------------------------------------------------------------------
// Callback : échange du code puis résolution d'identité
// ---------------------------------------------------------------------------

export type GoogleLoginOutcome =
  | { readonly kind: 'SIGNED_IN'; readonly userId: string }
  | { readonly kind: 'SIGNED_UP'; readonly userId: string }
  | {
      readonly kind: 'LINK_PROOF_REQUIRED';
      readonly pendingLinkId: string;
      readonly methods: readonly LinkProofMethod[];
    };

export interface CallbackInput {
  readonly code: string | null;
  readonly state: string | null;
  /** Paramètre `error` renvoyé par Google (ex. access_denied), ou null. */
  readonly providerError: string | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function exchangeCodeForIdToken(
  deps: Pick<GoogleOAuthDeps, 'config' | 'http'>,
  code: string,
  codeVerifier: string,
): Promise<string> {
  let response: OAuthHttpResponse;
  try {
    response = await deps.http.postForm(GOOGLE_TOKEN_ENDPOINT, {
      grant_type: 'authorization_code',
      code,
      client_id: deps.config.clientId,
      client_secret: deps.config.clientSecret,
      redirect_uri: deps.config.redirectUri,
      code_verifier: codeVerifier,
    });
  } catch {
    throw new GoogleOAuthError('TOKEN_EXCHANGE_FAILED', "l'appel au point d'échange a échoué.");
  }
  if (response.status !== 200 || !isRecord(response.body) || typeof response.body['id_token'] !== 'string') {
    throw new GoogleOAuthError('TOKEN_EXCHANGE_FAILED', "réponse d'échange invalide.");
  }
  return response.body['id_token'];
}

async function resolveGoogleIdentity(claims: GoogleIdentityClaims, deps: GoogleOAuthDeps): Promise<GoogleLoginOutcome> {
  if (!claims.emailVerified) {
    throw new GoogleOAuthError('EMAIL_NOT_VERIFIED', "l'e-mail Google n'est pas vérifié.");
  }
  const random = deps.randomBytes ?? webCryptoRandomBytes;

  // 1. Le sub fait foi : un compte déjà lié se reconnaît sans regarder l'e-mail.
  const linked = await deps.accounts.findOAuthAccount('GOOGLE', claims.sub);
  if (linked !== null) {
    return { kind: 'SIGNED_IN', userId: linked.userId };
  }

  const emailNormalized = normalizeEmail(claims.email);
  const existing = await deps.accounts.findUserByEmailNormalized(emailNormalized);

  // 2. Aucun compte avec cet e-mail : inscription via Google (e-mail vérifié par Google).
  if (existing === null) {
    const created = await deps.accounts.createUserWithOAuthAccount({
      provider: 'GOOGLE',
      subject: claims.sub,
      emailNormalized,
      providerEmail: claims.email,
      fullName: claims.name ?? emailNormalized,
      avatarUrl: claims.picture,
    });
    return { kind: 'SIGNED_UP', userId: created.userId };
  }

  // 3. E-mail déjà utilisé par un compte non lié : jamais de liaison automatique, preuve exigée.
  const pendingLinkId = randomToken(random);
  const emailToken = randomToken(random);
  const hasPassword = existing.passwordHash !== null;
  await deps.pendingLinks.save({
    id: pendingLinkId,
    userId: existing.userId,
    provider: 'GOOGLE',
    subject: claims.sub,
    providerEmail: claims.email,
    hasPassword,
    emailProofTokenSha256: base64UrlEncode(await sha256(textEncoder.encode(emailToken))),
    attemptsLeft: PENDING_LINK_MAX_ATTEMPTS,
    expiresAtEpochSec: deps.nowEpochSec() + PENDING_LINK_TTL_SEC,
  });
  await deps.emailProof.sendLinkProof({ emailNormalized, token: emailToken });
  return {
    kind: 'LINK_PROOF_REQUIRED',
    pendingLinkId,
    methods: hasPassword ? ['PASSWORD', 'EMAIL_LINK'] : ['EMAIL_LINK'],
  };
}

export async function completeGoogleAuthorization(input: CallbackInput, deps: GoogleOAuthDeps): Promise<GoogleLoginOutcome> {
  if (input.state === null || input.state.length === 0) {
    throw new GoogleOAuthError('STATE_INVALID', 'state absent.');
  }
  // Consommation immédiate : un state ne sert qu'une fois, même si la suite échoue.
  const transaction = await deps.transactions.consume(input.state);
  if (transaction === null) {
    throw new GoogleOAuthError('STATE_INVALID', 'state inconnu ou déjà utilisé.');
  }
  if (transaction.expiresAtEpochSec <= deps.nowEpochSec()) {
    throw new GoogleOAuthError('STATE_EXPIRED', 'state expiré.');
  }
  if (!transaction.turnstileVerified) {
    throw new GoogleOAuthError('TURNSTILE_REQUIRED', "la transaction n'a pas passé Turnstile.");
  }
  if (input.providerError !== null) {
    throw new GoogleOAuthError('PROVIDER_ERROR', `Google a refusé l'autorisation : ${input.providerError}.`);
  }
  if (input.code === null || input.code.length === 0 || input.code.length > MAX_AUTHORIZATION_CODE_LENGTH) {
    throw new GoogleOAuthError('CODE_MISSING', 'code absent ou hors limites.');
  }

  const idToken = await exchangeCodeForIdToken(deps, input.code, transaction.codeVerifier);
  const claims = await verifyGoogleIdToken({
    idToken,
    expectedNonce: transaction.nonce,
    clientId: deps.config.clientId,
    nowEpochSec: deps.nowEpochSec(),
    jwks: deps.jwks,
  });
  return resolveGoogleIdentity(claims, deps);
}

// ---------------------------------------------------------------------------
// Confirmation de liaison après preuve
// ---------------------------------------------------------------------------

export type LinkProof =
  | { readonly method: 'PASSWORD'; readonly password: string }
  | { readonly method: 'EMAIL_LINK'; readonly token: string };

export interface ConfirmPendingLinkInput {
  readonly pendingLinkId: string;
  readonly proof: LinkProof;
}

export interface ConfirmPendingLinkDeps {
  readonly accounts: OAuthAccountRepository;
  readonly pendingLinks: PendingLinkStore;
  readonly nowEpochSec: () => number;
  /** Valeur de AUTH_PEPPER, fournie par l'environnement. */
  readonly pepper: string;
}

async function proofIsValid(link: PendingLink, proof: LinkProof, deps: ConfirmPendingLinkDeps): Promise<boolean> {
  if (proof.method === 'EMAIL_LINK') {
    const digest = base64UrlEncode(await sha256(textEncoder.encode(proof.token)));
    return constantTimeStringEqual(digest, link.emailProofTokenSha256);
  }
  if (!link.hasPassword) {
    return false;
  }
  const user = await deps.accounts.findUserByEmailNormalized(normalizeEmail(link.providerEmail));
  if (user === null || user.userId !== link.userId || user.passwordHash === null) {
    return false;
  }
  return verifyPasswordWorkerSafe(proof.password, deps.pepper, user.passwordHash);
}

export async function confirmPendingLink(
  input: ConfirmPendingLinkInput,
  deps: ConfirmPendingLinkDeps,
): Promise<{ readonly kind: 'LINKED'; readonly userId: string }> {
  const link = await deps.pendingLinks.take(input.pendingLinkId);
  if (link === null) {
    throw new GoogleOAuthError('LINK_PENDING_NOT_FOUND', 'liaison en attente inconnue ou déjà utilisée.');
  }
  if (link.expiresAtEpochSec <= deps.nowEpochSec()) {
    throw new GoogleOAuthError('LINK_PENDING_EXPIRED', 'liaison en attente expirée.');
  }
  if (!(await proofIsValid(link, input.proof, deps))) {
    if (link.attemptsLeft > 1) {
      await deps.pendingLinks.save({ ...link, attemptsLeft: link.attemptsLeft - 1 });
    }
    throw new GoogleOAuthError('LINK_PROOF_INVALID', 'preuve invalide.');
  }
  const owner = await deps.accounts.findOAuthAccount(link.provider, link.subject);
  if (owner !== null) {
    throw new GoogleOAuthError('SUB_ALREADY_LINKED', 'ce sub est déjà lié à un compte.');
  }
  await deps.accounts.linkOAuthAccount({
    userId: link.userId,
    provider: link.provider,
    subject: link.subject,
    providerEmail: link.providerEmail,
  });
  return { kind: 'LINKED', userId: link.userId };
}
