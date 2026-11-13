/**
 * Authentification et TenantRouter (ticket T-S1B-11 ; Doc_04 § 04, Doc_07 § 01, ERRATA D-16).
 *
 * Loi zéro-trust : la base d'un dossier est résolue côté serveur, jamais depuis un argument client. `X-Fisca-Company-Id`
 * SÉLECTIONNE un dossier parmi ceux de l'utilisateur ; le serveur le vérifie contre les appartenances et les mandats
 * (port `MembershipResolver`), puis résout lui-même la base (`TenantDatabaseProvider`, p. ex. `SqlInfrastructure`).
 * Pour une route IA/MCP (`RoutePolicy.audience = 'AI_MCP'`), l'en-tête n'est JAMAIS lu : le dossier vient du jeton lié.
 * Échec fermé : dossier inconnu ou non autorisé → même réponse 403 ; base indisponible → 503.
 */
import { createMiddleware } from 'hono/factory';
import { SessionJwtError, type AccessTokenClaims, type RoleCode } from '@fisca/auth-rbac';
import { InfrastructureError, assertValidCompanyId, type TenantSqlDriver } from '@fisca/shared-types';
import {
  AUTH_REQUIRED_PROBLEM,
  TENANT_OUT_OF_SCOPE_PROBLEM,
  TENANT_UNAVAILABLE_PROBLEM,
  respondProblem,
  type ProblemInput,
  type TraceVariables,
} from './problem-details.ts';

export const COMPANY_ID_HEADER = 'X-Fisca-Company-Id' as const;
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;
/** Préfixe des mfa_challenge_token (packages/auth-rbac/src/auth-2fa.ts) : jamais une session. */
const MFA_CHALLENGE_PREFIX = 'fmc1';
const MAX_BODY_DEPTH = 64;
/** Clés normalisées (minuscules, sans `_` ni `-`) qu'un corps ou une requête ne peut jamais porter. */
const FORBIDDEN_SELECTOR_KEYS: ReadonlySet<string> = new Set(['tenantid', 'companyid', 'tenantdbid', 'tenantdatabaseid', 'databaseid', 'd1databaseuuid']);
const BODYLESS_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

// ---------------------------------------------------------------- ports

export interface AuthenticatedActor {
  readonly userId: string;
  readonly sessionId: string | null;
  /** Dossier auquel le jeton est lié (jeton MCP / agent) ; null pour une session humaine. */
  readonly boundCompanyId: string | null;
}

/** Port d'authentification : renvoie null pour toute authentification absente, invalide, expirée ou non-session. */
export interface SessionAuthenticator {
  authenticate(input: { readonly authorization: string | null }): Promise<AuthenticatedActor | null>;
}

/** Vérificateur de JWT de session (SessionService.verify de auth-rbac) : signature, algorithme, iss, aud, exp, nbf. */
export interface AccessTokenVerifier {
  verify(token: string): Promise<AccessTokenClaims>;
}

export type MembershipAccessKind = 'MEMBERSHIP' | 'MANDATE';

export interface MembershipAccess {
  readonly organizationId: string;
  readonly role: RoleCode;
  readonly accessKind: MembershipAccessKind;
  /** `subscriptions.plan_code` de l'organisation propriétaire du dossier. */
  readonly planCode: string;
}

/**
 * Appartenances (`organization_memberships`) et mandats actifs (révoqués exclus) de l'utilisateur. Renvoie null si l'utilisateur
 * n'a aucun accès à ce dossier, qu'il existe ou non : le routeur ne doit jamais distinguer les deux cas.
 */
export interface MembershipResolver {
  resolveAccess(query: { readonly userId: string; readonly companyId: string }): Promise<MembershipAccess | null>;
}

/** `SqlInfrastructure` satisfait ce port : résolution + migration JIT de la base du dossier. */
export interface TenantDatabaseProvider {
  getTenantDbUpToDate(companyId: string): Promise<TenantSqlDriver>;
}

export interface RoutePolicy {
  /** `AI_MCP` : l'en-tête de dossier n'est jamais lu ; le dossier vient du jeton (`boundCompanyId`). */
  readonly audience: 'HUMAN_API' | 'AI_MCP';
  /** `NONE` : route hors dossier (plan de contrôle) ; ni en-tête ni base ni droits de plan. */
  readonly tenantScope: 'COMPANY' | 'NONE';
  /** Clé de `plan_entitlements.feature_key` requise, ou null. */
  readonly featureKey: string | null;
  /** Export décennal Art. 211 CGI (ou réception xHub) : reste ouvert en lecture seule. */
  readonly legalExport: boolean;
}

export type RoutePolicyResolver = (request: { readonly method: string; readonly path: string }) => RoutePolicy;

// ---------------------------------------------------------------- contexte Hono

export interface TenantContext {
  readonly userId: string;
  readonly role: RoleCode;
  readonly companyId: string;
  readonly organizationId: string;
  readonly accessKind: MembershipAccessKind;
  readonly plan: string;
  readonly tenantDb: TenantSqlDriver;
}

export interface EntitlementView {
  readonly planCode: string;
  readonly subscriptionStatus: string;
  readonly readOnly: boolean;
}

export interface PipelineVariables extends TraceVariables {
  auth?: AuthenticatedActor;
  routePolicy?: RoutePolicy;
  tenant?: TenantContext;
  entitlements?: EntitlementView;
}

export interface PipelineEnv {
  Variables: PipelineVariables;
}

// ---------------------------------------------------------------- authentification

/** Adaptateur du port d'authentification sur un vérificateur de JWT. Un mfa_challenge_token n'est jamais une session. */
export function createAccessTokenAuthenticator(verifier: AccessTokenVerifier): SessionAuthenticator {
  return {
    authenticate: async ({ authorization }) => {
      const token = authorization === null ? undefined : BEARER_PATTERN.exec(authorization.trim())?.[1];
      if (token === undefined || token.startsWith(MFA_CHALLENGE_PREFIX)) {
        return null;
      }
      try {
        const claims = await verifier.verify(token);
        return { userId: claims.sub, sessionId: claims.sid, boundCompanyId: null };
      } catch (error) {
        if (error instanceof SessionJwtError) {
          return null;
        }
        throw error;
      }
    },
  };
}

const UNAUTHENTICATED: ProblemInput = { ...AUTH_REQUIRED_PROBLEM, headers: { 'WWW-Authenticate': 'Bearer' } };

export function createAuthenticationMiddleware(deps: { readonly authenticator: SessionAuthenticator }) {
  return createMiddleware<PipelineEnv>(async (c, next) => {
    const actor = await deps.authenticator.authenticate({ authorization: c.req.header('Authorization') ?? null });
    if (actor === null) {
      return respondProblem(c, UNAUTHENTICATED);
    }
    c.set('auth', Object.freeze({ ...actor }));
    await next();
    return undefined;
  });
}

// ---------------------------------------------------------------- sélecteurs interdits

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function hasForbiddenKey(root: unknown): boolean {
  const stack: { readonly value: unknown; readonly depth: number }[] = [{ value: root, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || typeof current.value !== 'object' || current.value === null) {
      continue;
    }
    if (current.depth > MAX_BODY_DEPTH) {
      return true;
    }
    const children: readonly unknown[] = Array.isArray(current.value) ? current.value : Object.values(current.value);
    if (!Array.isArray(current.value) && Object.keys(current.value).some((key) => FORBIDDEN_SELECTOR_KEYS.has(normalizeKey(key)))) {
      return true;
    }
    for (const child of children) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return false;
}

function queryHasForbiddenKey(url: string): boolean {
  for (const key of new URL(url).searchParams.keys()) {
    if (FORBIDDEN_SELECTOR_KEYS.has(normalizeKey(key))) {
      return true;
    }
  }
  return false;
}

const SELECTOR_FORBIDDEN: ProblemInput = {
  status: 400,
  errorCode: 'TENANT_SELECTOR_FORBIDDEN',
  title: 'Sélecteur de dossier interdit',
  detail: "Le dossier se choisit uniquement par l'en-tête X-Fisca-Company-Id : aucun identifiant de société ou de base dans le corps ou la requête.",
};
const BODY_INVALID: ProblemInput = {
  status: 400,
  errorCode: 'REQUEST_BODY_INVALID',
  title: 'Corps invalide',
  detail: 'Le corps de la requête est illisible.',
};
const COMPANY_ID_REQUIRED: ProblemInput = {
  status: 400,
  errorCode: 'COMPANY_ID_REQUIRED',
  title: 'Dossier à préciser',
  detail: `L'en-tête ${COMPANY_ID_HEADER} est requis.`,
};
const COMPANY_ID_INVALID: ProblemInput = {
  status: 400,
  errorCode: 'COMPANY_ID_INVALID',
  title: 'Identifiant de dossier invalide',
  detail: `L'en-tête ${COMPANY_ID_HEADER} est invalide.`,
};

/** true si le corps (JSON ou formulaire) ou la requête porte un identifiant de société ou de base ; 'unreadable' si illisible. */
async function selectorViolation(request: { readonly method: string; readonly url: string; header(name: string): string | undefined; text(): Promise<string> }): Promise<'none' | 'forbidden' | 'unreadable'> {
  if (queryHasForbiddenKey(request.url)) {
    return 'forbidden';
  }
  if (BODYLESS_METHODS.has(request.method.toUpperCase())) {
    return 'none';
  }
  const contentType = (request.header('Content-Type') ?? '').toLowerCase();
  const isJson = contentType.includes('json');
  const isForm = contentType.includes('application/x-www-form-urlencoded');
  if (!isJson && !isForm) {
    return 'none';
  }
  const text = await request.text();
  if (text.length === 0) {
    return 'none';
  }
  if (isForm) {
    for (const key of new URLSearchParams(text).keys()) {
      if (FORBIDDEN_SELECTOR_KEYS.has(normalizeKey(key))) {
        return 'forbidden';
      }
    }
    return 'none';
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'unreadable';
  }
  return hasForbiddenKey(parsed) ? 'forbidden' : 'none';
}

// ---------------------------------------------------------------- TenantRouter

export interface TenantRouterDeps {
  readonly routePolicy: RoutePolicyResolver;
  readonly memberships: MembershipResolver;
  readonly tenants: TenantDatabaseProvider;
}

function isTenantDenial(error: unknown): boolean {
  return error instanceof InfrastructureError && (error.code === 'INFRA_TENANT_NOT_FOUND' || error.code === 'INFRA_INVALID_COMPANY_ID');
}

export function createTenantRouter(deps: TenantRouterDeps) {
  return createMiddleware<PipelineEnv>(async (c, next) => {
    const actor = c.get('auth');
    if (actor === undefined) {
      return respondProblem(c, UNAUTHENTICATED);
    }
    const policy = deps.routePolicy({ method: c.req.method, path: c.req.path });
    c.set('routePolicy', Object.freeze({ ...policy }));
    if (policy.tenantScope === 'NONE') {
      await next();
      return undefined;
    }

    const violation = await selectorViolation({
      method: c.req.method,
      url: c.req.url,
      header: (name) => c.req.header(name),
      text: () => c.req.text(),
    });
    if (violation === 'forbidden') {
      return respondProblem(c, SELECTOR_FORBIDDEN);
    }
    if (violation === 'unreadable') {
      return respondProblem(c, BODY_INVALID);
    }

    // D-16 : l'en-tête ne sert qu'aux appels humains ; une route IA/MCP ne le lit jamais.
    let companyId: string;
    if (policy.audience === 'AI_MCP') {
      if (actor.boundCompanyId === null) {
        return respondProblem(c, TENANT_OUT_OF_SCOPE_PROBLEM);
      }
      companyId = actor.boundCompanyId;
    } else {
      const header = c.req.header(COMPANY_ID_HEADER);
      if (header === undefined) {
        return respondProblem(c, COMPANY_ID_REQUIRED);
      }
      companyId = header;
    }
    try {
      assertValidCompanyId(companyId);
    } catch {
      return respondProblem(c, policy.audience === 'AI_MCP' ? TENANT_OUT_OF_SCOPE_PROBLEM : COMPANY_ID_INVALID);
    }

    let access: MembershipAccess | null;
    try {
      access = await deps.memberships.resolveAccess({ userId: actor.userId, companyId });
    } catch {
      return respondProblem(c, TENANT_UNAVAILABLE_PROBLEM);
    }
    if (access === null) {
      return respondProblem(c, TENANT_OUT_OF_SCOPE_PROBLEM);
    }

    let tenantDb: TenantSqlDriver;
    try {
      tenantDb = await deps.tenants.getTenantDbUpToDate(companyId);
    } catch (error) {
      return respondProblem(c, isTenantDenial(error) ? TENANT_OUT_OF_SCOPE_PROBLEM : TENANT_UNAVAILABLE_PROBLEM);
    }

    c.set(
      'tenant',
      Object.freeze({
        userId: actor.userId,
        role: access.role,
        companyId,
        organizationId: access.organizationId,
        accessKind: access.accessKind,
        plan: access.planCode,
        tenantDb,
      }),
    );
    await next();
    return undefined;
  });
}
