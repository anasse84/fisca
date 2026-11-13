import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { SessionJwtError } from '@fisca/auth-rbac';
import { SchemaMigrationError } from '@fisca/db-schema';
import {
  AdrInvariantError,
  FiscaIntegerError,
  FsmTransitionError,
  InfrastructureError,
  ProblemDetailsSchema,
} from '@fisca/shared-types';
import { LedgerError } from './ledger-errors.ts';
import {
  MAX_PROBLEM_ISSUES,
  PROBLEM_CONTENT_TYPE,
  PolicyDenialError,
  ProblemError,
  buildProblemBody,
  createProblemErrorHandler,
  createProblemNotFoundHandler,
  problemForError,
  traceIdFromRequest,
  type InternalErrorReport,
  type TraceVariables,
} from './problem-details.ts';

const SECRET_SQL = 'SELECT secret_column FROM tenant_databases WHERE company_id = ?';
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

function appThrowing(error: unknown, reports: InternalErrorReport[] = []): Hono<{ Variables: TraceVariables }> {
  const app = new Hono<{ Variables: TraceVariables }>();
  app.use('*', async (c, next) => {
    c.set('traceId', TRACE);
    await next();
  });
  app.get('/boom', () => {
    throw error;
  });
  app.onError(createProblemErrorHandler({ reportInternalError: (report) => reports.push(report) }));
  app.notFound(createProblemNotFoundHandler());
  return app;
}

describe('ProblemDetails (RFC 9457)', () => {
  it('produit un corps validé par ProblemDetailsSchema, en application/problem+json', async () => {
    const response = await appThrowing(
      new ProblemError({ status: 422, errorCode: 'X_CODE', title: 'Titre', detail: 'Détail fixe', legalRef: 'CGI art. 145' }),
    ).request('/boom?secret=1');
    expect(response.status).toBe(422);
    expect(response.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body: unknown = await response.json();
    const parsed = ProblemDetailsSchema.parse(body);
    expect(parsed).toMatchObject({ type: 'about:blank', status: 422, errorCode: 'X_CODE', traceId: TRACE, legalRef: 'CGI art. 145' });
    expect(body).toMatchObject({ instance: '/boom' });
  });

  it('borne les extensions : issues limitées en nombre et en longueur, instance sans requête', () => {
    const issues = Array.from({ length: MAX_PROBLEM_ISSUES + 5 }, (_, index) => ({ path: `p${index}`, message: 'm'.repeat(500) }));
    const body = buildProblemBody({ status: 400, errorCode: 'E', title: 'T', detail: 'D', issues }, TRACE, '/a/b?token=abc');
    expect(body.issues).toHaveLength(MAX_PROBLEM_ISSUES);
    expect(body.issues?.[0]?.message).toHaveLength(200);
    expect(body.instance).toBe('/a/b');
    expect(buildProblemBody({ status: 400, errorCode: 'E', title: 'T', detail: 'D' }, TRACE, 'http://autre/x').instance).toBeUndefined();
  });

  it('refuse un statut hors 100-599 (validation par le schéma)', () => {
    expect(() => buildProblemBody({ status: 99, errorCode: 'E', title: 'T', detail: 'D' }, TRACE, null)).toThrow();
  });

  it('ne fuit jamais de détail interne : 500 constant, ni pile ni SQL', async () => {
    const reports: InternalErrorReport[] = [];
    const leaky = new Error(`${SECRET_SQL} password=hunter2`);
    const response = await appThrowing(leaky, reports).request('/boom');
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain('secret_column');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('at ');
    expect(ProblemDetailsSchema.parse(JSON.parse(text))).toMatchObject({ errorCode: 'INTERNAL_ERROR', status: 500, traceId: TRACE });
    expect(reports).toEqual([{ traceId: TRACE, errorName: 'Error' }]);
    expect(JSON.stringify(reports)).not.toContain('hunter2');
  });

  it("n'expose pas non plus le message d'une erreur typée", async () => {
    const response = await appThrowing(new InfrastructureError('INFRA_SQL_REJECTED', SECRET_SQL)).request('/boom');
    const text = await response.text();
    expect(response.status).toBe(409);
    expect(text).not.toContain('secret_column');
    expect(JSON.parse(text)).toMatchObject({ errorCode: 'INFRA_SQL_REJECTED' });
  });

  it('traduit les erreurs typées connues vers des statuts et codes stables', () => {
    const cases: readonly [unknown, number, string][] = [
      [new InfrastructureError('INFRA_TENANT_NOT_FOUND', 'x'), 403, 'ABAC_TENANT_OUT_OF_SCOPE'],
      [new InfrastructureError('INFRA_INVALID_COMPANY_ID', 'x'), 400, 'INFRA_INVALID_COMPANY_ID'],
      [new InfrastructureError('INFRA_ADAPTER_NOT_FOR_PRODUCTION', 'x'), 500, 'INTERNAL_ERROR'],
      [new LedgerError('LEDGER_UNBALANCED', 'x'), 422, 'LEDGER_UNBALANCED'],
      [new LedgerError('LEDGER_POSTED_IMMUTABLE', 'x'), 409, 'LEDGER_POSTED_IMMUTABLE'],
      [new LedgerError('LEDGER_UNKNOWN_ENTRY', 'x'), 404, 'LEDGER_UNKNOWN_ENTRY'],
      [new LedgerError('LEDGER_INVALID_AMOUNT', 'x'), 400, 'LEDGER_INVALID_AMOUNT'],
      [new LedgerError('LEDGER_STORAGE_FAILURE', 'x'), 503, 'LEDGER_STORAGE_FAILURE'],
      [new LedgerError('LEDGER_INVALID_ID_SOURCE', 'x'), 500, 'INTERNAL_ERROR'],
      [new SchemaMigrationError('SCHEMA_CHECKSUM_MISMATCH', 'x'), 503, 'TENANT_SCHEMA_UNAVAILABLE'],
      [new FsmTransitionError('FSM_ILLEGAL_TRANSITION', 'x'), 409, 'FSM_ILLEGAL_TRANSITION'],
      [new FsmTransitionError('FSM_MISSING_PROOF', 'x'), 422, 'FSM_MISSING_PROOF'],
      [new FsmTransitionError('FSM_FORBIDDEN_ACTOR', 'x'), 403, 'FSM_FORBIDDEN_ACTOR'],
      [new FsmTransitionError('FSM_INVALID_DEFINITION', 'x'), 500, 'INTERNAL_ERROR'],
      [new PolicyDenialError('ABAC_SUBSCRIPTION_READ_ONLY', 'DAF_TRESORIER'), 403, 'ABAC_SUBSCRIPTION_READ_ONLY'],
      [new PolicyDenialError('RBAC_FORBIDDEN_FOR_CAISSIER_POS'), 403, 'RBAC_FORBIDDEN_FOR_CAISSIER_POS'],
      [new SessionJwtError('JWT_EXPIRED', 'x'), 401, 'AUTH_REQUIRED'],
      [new FiscaIntegerError('NOT_INTEGER', 'montant', 'x'), 400, 'ADR_03_FLOAT_FORBIDDEN'],
      [new AdrInvariantError('ADR_04_LF2026_VAT_VIOLATION', 'x'), 422, 'ADR_04_LF2026_VAT_VIOLATION'],
      [new HTTPException(413), 413, 'PAYLOAD_TOO_LARGE'],
      [new HTTPException(502), 500, 'INTERNAL_ERROR'],
      [new TypeError('boom'), 500, 'INTERNAL_ERROR'],
    ];
    for (const [error, status, errorCode] of cases) {
      const problem = problemForError(error);
      expect([problem.status, problem.errorCode]).toEqual([status, errorCode]);
      expect(ProblemDetailsSchema.safeParse(buildProblemBody(problem, TRACE, null)).success).toBe(true);
    }
  });

  it('répond au 404 de route inconnue en problem+json', async () => {
    const response = await appThrowing(new Error('x')).request('/nulle-part');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(ProblemDetailsSchema.parse(await response.json())).toMatchObject({ errorCode: 'ROUTE_NOT_FOUND' });
  });

  it("reprend l'identifiant de trace d'un traceparent W3C valide et refuse le reste", () => {
    expect(traceIdFromRequest(`00-${TRACE}-00f067aa0ba902b7-01`)).toBe(TRACE);
    expect(traceIdFromRequest(`00-${'0'.repeat(32)}-00f067aa0ba902b7-01`, () => 'gen')).toBe('gen');
    expect(traceIdFromRequest('n-importe-quoi', () => 'gen')).toBe('gen');
    expect(traceIdFromRequest(null, () => 'gen')).toBe('gen');
  });
});
