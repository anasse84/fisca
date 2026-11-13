/**
 * Client API d'authentification de Fisca (T-P2B-06) : `fetch` injectable, jamais de fetch global en dur.
 * Routes du registre (CTR-API-01 à 09, 35 à 42, 10) ; l'API fait foi : le client ne valide que la forme des réponses.
 * Zero-trust : aucun stockage, aucun journal ; le jeton d'accès vit en mémoire chez l'appelant (`getAccessToken`) ;
 * l'en-tête X-Fisca-Company-Id n'est jamais émis ici (les routes d'auth et l'annuaire n'ont pas de dossier).
 * Les textes `title` et `detail` du serveur ne sont jamais affichés : seul `errorCode` pilote les libellés i18n.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const TURNSTILE_QUERY_PARAM = 'cf-turnstile-response' as const;

export const AUTH_PATHS = {
  register: '/api/v1/auth/register',
  verifyEmail: '/api/v1/auth/verify-email',
  login: '/api/v1/auth/login',
  googleStart: '/api/v1/auth/google/start',
  passwordForgot: '/api/v1/auth/password/forgot',
  passwordReset: '/api/v1/auth/password/reset',
  mfaVerify: '/api/v1/auth/2fa/verify',
  passkeyAuthenticateOptions: '/api/v1/auth/passkeys/authenticate/options',
  passkeyAuthenticateVerify: '/api/v1/auth/passkeys/authenticate/verify',
  directoryIce: '/api/v1/directory/ice',
} as const;

export type SecondFactorMethod = 'TOTP' | 'RECOVERY_CODE' | 'INFOBIP_OTP';
const SECOND_FACTOR_METHODS: readonly SecondFactorMethod[] = ['TOTP', 'RECOVERY_CODE', 'INFOBIP_OTP'];

export interface FieldIssue {
  readonly code: string | undefined;
}

export interface ApiProblem {
  readonly status: number;
  readonly errorCode: string;
  readonly traceId?: string;
  readonly instance?: string;
  readonly legalRef?: string;
  readonly retryAfterSec: number | null;
  /** Erreurs par champ (premier segment du chemin de `issues[]`) ; sans le texte serveur. */
  readonly fieldErrors: Readonly<Record<string, readonly FieldIssue[]>>;
}

export type ApiResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly problem: ApiProblem };

export interface SessionTokens {
  readonly accessToken: string;
  readonly expiresInSec: number;
}

export type LoginOutcome =
  | ({ readonly kind: 'AUTHENTICATED' } & SessionTokens)
  | {
      readonly kind: 'MFA_REQUIRED';
      readonly mfaChallengeToken: string;
      readonly expiresAtEpochSec: number;
      readonly methods: readonly SecondFactorMethod[];
    };

export interface IceDossier {
  readonly ice: string;
  readonly identifiantFiscal: string;
  readonly rcNumber: string | null;
  readonly rcTribunal: string | null;
  readonly raisonSocialeFr: string;
  readonly raisonSocialeAr: string | null;
  readonly legalForm: string | null;
  readonly shareCapitalCents: number | null;
  readonly addressAdc450: string;
  readonly verifiedCount: number;
}

export interface AuthApiOptions {
  readonly fetch: FetchLike;
  readonly baseUrl?: string;
  /** Jeton Turnstile du widget (fourni par l'hôte) ; absent : le paramètre n'est pas envoyé et le serveur répond TURNSTILE_REQUIRED. */
  readonly getTurnstileToken?: () => Promise<string | null>;
  /** Jeton d'accès en mémoire (jamais lu dans un stockage). */
  readonly getAccessToken?: () => string | null;
  readonly credentials?: RequestCredentials;
}

export interface AuthApi {
  register(input: { email: string; password: string; fullName: string }): Promise<ApiResult<{ status: 'VERIFICATION_PENDING' }>>;
  verifyEmail(input: { token: string }): Promise<ApiResult<{ status: 'EMAIL_VERIFIED' }>>;
  login(input: { email: string; password: string }): Promise<ApiResult<LoginOutcome>>;
  googleStartUrl(): Promise<string>;
  forgotPassword(input: { email: string }): Promise<ApiResult<{ status: 'RESET_REQUESTED' }>>;
  resetPassword(input: { token: string; newPassword: string }): Promise<ApiResult<{ status: 'PASSWORD_RESET' }>>;
  verifyMfa(input: { mfaChallengeToken: string; method: SecondFactorMethod; code: string }): Promise<ApiResult<SessionTokens>>;
  passkeyAuthenticateOptions(): Promise<ApiResult<unknown>>;
  passkeyAuthenticateVerify(credential: unknown): Promise<ApiResult<SessionTokens>>;
  lookupIce(ice: string): Promise<ApiResult<IceDossier>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const localProblem = (status: number, errorCode: string): ApiProblem => ({ status, errorCode, retryAfterSec: null, fieldErrors: {} });

function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get('Retry-After');
  if (raw === null || !/^\d{1,9}$/.test(raw.trim())) {
    return null;
  }
  return Number.parseInt(raw.trim(), 10);
}

function parseFieldErrors(issues: unknown): Readonly<Record<string, readonly FieldIssue[]>> {
  const result: Record<string, FieldIssue[]> = {};
  if (!Array.isArray(issues)) {
    return result;
  }
  for (const issue of issues) {
    if (!isRecord(issue) || typeof issue['path'] !== 'string') {
      continue;
    }
    const field = issue['path'].split('.')[0] ?? '';
    if (field === '') {
      continue;
    }
    const code = typeof issue['code'] === 'string' ? issue['code'] : undefined;
    (result[field] ??= []).push({ code });
  }
  return result;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function toProblem(response: Response): Promise<ApiProblem> {
  const retryAfterSec = parseRetryAfter(response.headers);
  const body = await readJson(response);
  if (!isRecord(body) || typeof body['errorCode'] !== 'string') {
    return { status: response.status, errorCode: 'UNKNOWN_ERROR', retryAfterSec, fieldErrors: {} };
  }
  return {
    status: response.status,
    errorCode: body['errorCode'],
    ...(typeof body['traceId'] === 'string' ? { traceId: body['traceId'] } : {}),
    ...(typeof body['instance'] === 'string' ? { instance: body['instance'] } : {}),
    ...(typeof body['legalRef'] === 'string' ? { legalRef: body['legalRef'] } : {}),
    retryAfterSec,
    fieldErrors: parseFieldErrors(body['issues']),
  };
}

function parseSession(body: unknown): SessionTokens | null {
  if (!isRecord(body) || body['status'] !== 'AUTHENTICATED') {
    return null;
  }
  const { accessToken, expiresInSec } = body;
  return typeof accessToken === 'string' && accessToken.length > 0 && typeof expiresInSec === 'number' && Number.isSafeInteger(expiresInSec)
    ? { accessToken, expiresInSec }
    : null;
}

function parseLogin(body: unknown): LoginOutcome | null {
  const session = parseSession(body);
  if (session !== null) {
    return { kind: 'AUTHENTICATED', ...session };
  }
  if (!isRecord(body) || body['status'] !== 'MFA_REQUIRED') {
    return null;
  }
  const token = body['mfa_challenge_token'];
  const expires = body['expiresAtEpochSec'];
  const methods = body['methods'];
  if (typeof token !== 'string' || token.length === 0 || typeof expires !== 'number' || !Array.isArray(methods)) {
    return null;
  }
  const known = methods.filter((m): m is SecondFactorMethod => SECOND_FACTOR_METHODS.some((k) => k === m));
  return known.length === 0 ? null : { kind: 'MFA_REQUIRED', mfaChallengeToken: token, expiresAtEpochSec: expires, methods: known };
}

const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

function parseDossier(body: unknown): IceDossier | null {
  if (!isRecord(body)) {
    return null;
  }
  const { ice, identifiantFiscal, rcNumber, rcTribunal, raisonSocialeFr, raisonSocialeAr, legalForm, shareCapitalCents, addressAdc450, verifiedCount } = body;
  if (
    typeof ice !== 'string' || typeof identifiantFiscal !== 'string' || !nullableString(rcNumber) || !nullableString(rcTribunal) ||
    typeof raisonSocialeFr !== 'string' || !nullableString(raisonSocialeAr) || !nullableString(legalForm) ||
    !(shareCapitalCents === null || (typeof shareCapitalCents === 'number' && Number.isSafeInteger(shareCapitalCents))) ||
    typeof addressAdc450 !== 'string' || typeof verifiedCount !== 'number'
  ) {
    return null;
  }
  return { ice, identifiantFiscal, rcNumber, rcTribunal, raisonSocialeFr, raisonSocialeAr, legalForm, shareCapitalCents, addressAdc450, verifiedCount };
}

const hasStatus = (expected: string) => (body: unknown): true | null => (isRecord(body) && body['status'] === expected ? true : null);

export function createAuthApi(options: AuthApiOptions): AuthApi {
  const base = options.baseUrl ?? '';
  const credentials = options.credentials ?? 'same-origin';

  async function turnstileQuery(): Promise<string> {
    const token = options.getTurnstileToken === undefined ? null : await options.getTurnstileToken();
    return token === null || token === '' ? '' : `?${TURNSTILE_QUERY_PARAM}=${encodeURIComponent(token)}`;
  }

  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    init: { readonly body?: unknown; readonly turnstile: boolean; readonly bearer?: string },
    parse: (body: unknown) => T | null,
  ): Promise<ApiResult<T>> {
    const query = init.turnstile ? await turnstileQuery() : '';
    const headers: Record<string, string> = { Accept: 'application/json, application/problem+json' };
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (init.bearer !== undefined) {
      headers['Authorization'] = `Bearer ${init.bearer}`;
    }
    let response: Response;
    try {
      response = await options.fetch(`${base}${path}${query}`, {
        method,
        headers,
        credentials,
        cache: 'no-store',
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch {
      return { ok: false, problem: localProblem(0, 'NETWORK_ERROR') };
    }
    if (!response.ok) {
      return { ok: false, problem: await toProblem(response) };
    }
    const data = parse(await readJson(response));
    return data === null ? { ok: false, problem: localProblem(response.status, 'RESPONSE_INVALID') } : { ok: true, data };
  }

  return {
    register: ({ email, password, fullName }) =>
      call('POST', AUTH_PATHS.register, { body: { email, password, full_name: fullName }, turnstile: true }, (b) =>
        hasStatus('VERIFICATION_PENDING')(b) === null ? null : ({ status: 'VERIFICATION_PENDING' } as const),
      ),
    verifyEmail: ({ token }) =>
      call('POST', AUTH_PATHS.verifyEmail, { body: { token }, turnstile: true }, (b) =>
        hasStatus('EMAIL_VERIFIED')(b) === null ? null : ({ status: 'EMAIL_VERIFIED' } as const),
      ),
    login: ({ email, password }) => call('POST', AUTH_PATHS.login, { body: { email, password }, turnstile: true }, parseLogin),
    googleStartUrl: async () => `${base}${AUTH_PATHS.googleStart}${await turnstileQuery()}`,
    forgotPassword: ({ email }) =>
      call('POST', AUTH_PATHS.passwordForgot, { body: { email }, turnstile: true }, (b) =>
        hasStatus('RESET_REQUESTED')(b) === null ? null : ({ status: 'RESET_REQUESTED' } as const),
      ),
    resetPassword: ({ token, newPassword }) =>
      call('POST', AUTH_PATHS.passwordReset, { body: { token, newPassword }, turnstile: true }, (b) =>
        hasStatus('PASSWORD_RESET')(b) === null ? null : ({ status: 'PASSWORD_RESET' } as const),
      ),
    verifyMfa: ({ mfaChallengeToken, method, code }) =>
      call('POST', AUTH_PATHS.mfaVerify, { body: { mfa_challenge_token: mfaChallengeToken, method, code }, turnstile: true }, parseSession),
    passkeyAuthenticateOptions: () => call('POST', AUTH_PATHS.passkeyAuthenticateOptions, { body: {}, turnstile: true }, (b) => (isRecord(b) ? b : null)),
    passkeyAuthenticateVerify: (credential) => call('POST', AUTH_PATHS.passkeyAuthenticateVerify, { body: { credential }, turnstile: true }, parseSession),
    lookupIce: async (ice) => {
      const token = options.getAccessToken === undefined ? null : options.getAccessToken();
      if (!/^\d{15}$/.test(ice)) {
        return { ok: false, problem: localProblem(400, 'REQUEST_INVALID') };
      }
      if (token === null || token === '') {
        return { ok: false, problem: localProblem(401, 'AUTH_REQUIRED') };
      }
      return call('GET', `${AUTH_PATHS.directoryIce}/${ice}`, { turnstile: false, bearer: token }, parseDossier);
    },
  };
}
