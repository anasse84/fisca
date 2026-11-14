/**
 * Zero-Drop Handoff (Doc_18 S09) : l'ICE saisi dans l'auditeur d'ICE ou le simulateur Loi 69-21 transite vers app.fisca.ma
 * dans un paramètre signé éphémère.
 *
 * PROVISIONAL : la route de réception côté application n'est PAS spécifiée. Le nom du paramètre de requête (`fisca_handoff`),
 * le format du jeton et l'adresse de destination (https://app.fisca.ma/) sont des choix de ce ticket, « à brancher quand la
 * route d'inscription sera spécifiée ». Le jeton ne contient que l'ICE, un nonce, une version et une expiration.
 *
 * Jeton : `v1.<charge utile base64url>.<signature hex>`, signature = HMAC-SHA256(secret, `fisca-handoff-v1.` + charge utile base64url).
 * Le secret reste dans le Worker (liaison `MARKETING_HANDOFF_SECRET`) : le navigateur n'appelle que l'émetteur de lien.
 */
import { APP_ORIGIN, HANDOFF_QUERY_PARAM } from './handoff-contract.ts';
import { base64UrlDecodeToText, base64UrlEncode, base64UrlEncodeText, hmacSha256Hex, verifyHmacHex } from './hmac.ts';
import type { NowSeconds, RandomBytes } from './ports.ts';

export { APP_ORIGIN, HANDOFF_ENDPOINT_PATH, HANDOFF_QUERY_PARAM } from './handoff-contract.ts';
export const HANDOFF_TOKEN_VERSION = 'v1';
export const DEFAULT_HANDOFF_TTL_SECONDS = 120;
export const MIN_HANDOFF_TTL_SECONDS = 10;
export const MAX_HANDOFF_TTL_SECONDS = 900;
const SIGNING_PREFIX = 'fisca-handoff-v1.';
const NONCE_BYTES = 16;

export interface HandoffPayload {
  readonly v: 1;
  readonly ice: string;
  readonly n: string;
  readonly exp: number;
}

export type HandoffIssueError = 'INVALID_ICE' | 'INVALID_TTL' | 'MISSING_SECRET';

export interface HandoffIssueInput {
  readonly ice: string;
  readonly secret: string | undefined;
  readonly ttlSeconds: number;
  readonly nowSeconds: NowSeconds;
  readonly randomBytes: RandomBytes;
}

export type HandoffIssued =
  | { readonly ok: true; readonly url: string; readonly token: string; readonly expiresAtSeconds: number }
  | { readonly ok: false; readonly error: HandoffIssueError };

/** 15 chiffres exactement : la cohérence (contrôle modulo) est affichée par l'outil, le lien n'embarque jamais autre chose. */
export function isHandoffIce(value: string): boolean {
  return /^\d{15}$/.test(value);
}

export function isValidHandoffTtl(ttlSeconds: number): boolean {
  return Number.isInteger(ttlSeconds) && ttlSeconds >= MIN_HANDOFF_TTL_SECONDS && ttlSeconds <= MAX_HANDOFF_TTL_SECONDS;
}

async function sign(secret: string, payloadB64: string): Promise<string> {
  return hmacSha256Hex(secret, `${SIGNING_PREFIX}${payloadB64}`);
}

export async function issueHandoffLink(input: HandoffIssueInput): Promise<HandoffIssued> {
  if (input.secret === undefined) return { ok: false, error: 'MISSING_SECRET' };
  if (!isHandoffIce(input.ice)) return { ok: false, error: 'INVALID_ICE' };
  if (!isValidHandoffTtl(input.ttlSeconds)) return { ok: false, error: 'INVALID_TTL' };
  const expiresAtSeconds = input.nowSeconds() + input.ttlSeconds;
  const payload: HandoffPayload = { v: 1, ice: input.ice, n: base64UrlEncode(input.randomBytes(NONCE_BYTES)), exp: expiresAtSeconds };
  const payloadB64 = base64UrlEncodeText(JSON.stringify(payload));
  const token = `${HANDOFF_TOKEN_VERSION}.${payloadB64}.${await sign(input.secret, payloadB64)}`;
  return { ok: true, token, expiresAtSeconds, url: `${APP_ORIGIN}/?${HANDOFF_QUERY_PARAM}=${token}` };
}

/** Consommation d'un nonce : `true` la première fois, `false` si déjà vu. Côté application, ce port s'adosse à un stockage atomique. */
export interface NonceStore {
  consume(nonce: string, expiresAtSeconds: number): Promise<boolean>;
}

export class MemoryNonceStore implements NonceStore {
  private readonly seen = new Set<string>();

  consume(nonce: string): Promise<boolean> {
    if (this.seen.has(nonce)) return Promise.resolve(false);
    this.seen.add(nonce);
    return Promise.resolve(true);
  }
}

export type HandoffVerifyFailure = 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'REPLAYED' | 'MISSING_SECRET';

export type HandoffVerified =
  | { readonly ok: true; readonly ice: string; readonly nonce: string; readonly expiresAtSeconds: number }
  | { readonly ok: false; readonly reason: HandoffVerifyFailure };

function parsePayload(payloadB64: string): HandoffPayload | null {
  const text = base64UrlDecodeToText(payloadB64);
  if (text === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { v, ice, n, exp } = data as Record<string, unknown>;
  if (v !== 1 || typeof ice !== 'string' || !isHandoffIce(ice)) return null;
  if (typeof n !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(n)) return null;
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp)) return null;
  return { v: 1, ice, n, exp };
}

/**
 * Vérification de référence (la route de réception de l'application reste à spécifier). Ordre : forme, signature, expiration, rejeu :
 * un nonce n'est consommé que si la signature et la date sont bonnes.
 */
export async function verifyHandoffToken(
  token: string,
  options: { readonly secret: string | undefined; readonly nowSeconds: NowSeconds; readonly nonces: NonceStore },
): Promise<HandoffVerified> {
  if (options.secret === undefined) return { ok: false, reason: 'MISSING_SECRET' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HANDOFF_TOKEN_VERSION) return { ok: false, reason: 'MALFORMED' };
  const [, payloadB64 = '', signature = ''] = parts;
  const payload = parsePayload(payloadB64);
  if (payload === null) return { ok: false, reason: 'MALFORMED' };
  if (!(await verifyHmacHex(options.secret, `${SIGNING_PREFIX}${payloadB64}`, signature))) return { ok: false, reason: 'BAD_SIGNATURE' };
  if (options.nowSeconds() >= payload.exp) return { ok: false, reason: 'EXPIRED' };
  if (!(await options.nonces.consume(payload.n, payload.exp))) return { ok: false, reason: 'REPLAYED' };
  return { ok: true, ice: payload.ice, nonce: payload.n, expiresAtSeconds: payload.exp };
}
