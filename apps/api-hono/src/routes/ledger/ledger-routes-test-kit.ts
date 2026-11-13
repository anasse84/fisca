/// <reference types="node" />
/**
 * Kit de test des routes du socle comptable (code de test uniquement, jamais importé par le code de production).
 * Pipeline COMPLET (JWT EdDSA réels, TenantRouter, EntitlementGuard, Idempotency sur `createSqlIdempotencyStore`) au-dessus
 * d'une base de dossier SQLite RÉELLE migrée par `ensureTenantSchemaUpToDate`. Le `LedgerHasher` est le gabarit de test,
 * explicitement NON normatif (aucune spécification ne fixe les octets hachés).
 */
import type { Hono } from 'hono';
import { CONTROL_PLANE_MIGRATIONS, ensureTenantSchemaUpToDate } from '@fisca/db-schema';
import type { SqlParam, TenantSqlDriver } from '@fisca/shared-types';
import { createSqlCompanyDirectory } from '../../core/company-directory.ts';
import { createHealthDeepProbeSet } from '../../core/health-deep.ts';
import { createSqlIdempotencyStore } from '../../core/sql-idempotency-store.ts';
import {
  ImmutableCgncLedgerEngine,
  type CreateDraftInput,
  type DraftLineInput,
  type LedgerActor,
} from '../../core/immutable-cgnc-ledger-engine.ts';
import { createLedgerApi } from '../../core/ledger-api.ts';
import { createAccessTokenAuthenticator, COMPANY_ID_HEADER, type PipelineEnv } from '../../core/tenant-router.ts';
import {
  COMPANY_A,
  COMPANY_B,
  COMPANY_C,
  USER_1,
  USER_2,
  activeRows,
  createFakeKv,
  createFakeMandates,
  createFakeMemberships,
  createFakeEntitlements,
  createTestClock,
  createTestJwt,
  grant,
  grantMandate,
  type TestJwt,
} from '../../core/pipeline-test-support.ts';
import {
  FY_2026,
  SequentialUuidV7,
  StepClock,
  StubPreCloseControls,
  actorOf,
  openBareSqliteDriver,
  openSqliteBackend,
  seedLedger,
  testCipher,
  testOnlyHasher,
} from '../../core/ledger-test-harness.ts';
import { createLedgerRoutes } from './index.ts';

export const USER_AIDE = 'user-aide';
export const USER_CHEF = 'user-chef';
export const USER_OEC = 'user-oec';
export const KEY = (n: number): string => `018f3b5e-7c2a-7d3e-8a1b-${n.toString(16).padStart(12, '0')}`;
export { COMPANY_A, COMPANY_B, COMPANY_C, USER_1, USER_2, COMPANY_ID_HEADER };

/** ICE de test : 15 chiffres divisibles par 97 (clé modulo 97 de shared-types). */
export const ICE_OK = '000000000000097';
export const ICE_BAD_CHECKSUM = '000000000000098';
export const ICE_UNKNOWN = '000000000000194';

export const L = (accountNumber: string, debitCents: number, creditCents: number): DraftLineInput => ({
  accountNumber,
  debitCents,
  creditCents,
  description: `ligne ${accountNumber}`,
});

export interface Kit {
  readonly app: Hono<PipelineEnv>;
  readonly tenantDb: TenantSqlDriver;
  readonly controlDb: TenantSqlDriver;
  readonly clock: StepClock;
  readonly jwt: TestJwt;
  readonly memberships: ReturnType<typeof createFakeMemberships>;
  readonly mandates: ReturnType<typeof createFakeMandates>;
  readonly engine: ImmutableCgncLedgerEngine;
  readonly actors: { readonly aide: LedgerActor; readonly chef: LedgerActor; readonly oec: LedgerActor };
  readonly probes: { controlPlaneFails: boolean; vaultFails: boolean; vaultHangs: boolean };
  readonly reports: { traceId: string; errorName: string }[];
  token(userId: string): Promise<string>;
  call(method: string, path: string, options?: CallOptions): Promise<Response>;
  /** Pièce menée jusqu'au statut demandé, en passant par le moteur (aucune écriture SQL directe). */
  entryAt(state: 'DRAFT' | 'REVISEE_CYCLE' | 'POSTED', input?: Partial<CreateDraftInput>): Promise<string>;
  exec(sql: string, params?: readonly SqlParam[]): Promise<void>;
  rows<T>(sql: string, params?: readonly SqlParam[]): Promise<readonly T[]>;
  key(): string;
}

export interface CallOptions {
  readonly user?: string | null;
  readonly company?: string | null;
  readonly key?: string | null;
  readonly body?: unknown;
  readonly rawBody?: string;
}

export async function buildKit(options: { withMandates?: boolean } = {}): Promise<Kit> {
  const withMandates = options.withMandates ?? true;
  const backend = await openSqliteBackend();
  await seedLedger(backend.driver);
  const controlDb = openBareSqliteDriver('control-plane');
  await ensureTenantSchemaUpToDate(null, controlDb, 'control-plane', CONTROL_PLANE_MIGRATIONS);
  await controlDb.executeBatchAtomically([
    {
      sql: `INSERT INTO morocco_company_directory (ice, identifiant_fiscal, rc_number, rc_tribunal, taxe_pro, raison_sociale_fr, raison_sociale_ar, legal_form, share_capital_cents, address_adc450, verified_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [ICE_OK, '12345678', '45678', 'Rabat', 'TP-SECRET-1', 'Société Test SARL', null, 'SARL', 10000000, '12 avenue Mohammed V, Rabat', 3, '2026-01-01T00:00:00.000Z'],
    },
  ]);

  const clock = new StepClock();
  const testClock = createTestClock(Date.parse('2026-11-13T10:00:00.000Z'));
  const jwt = await createTestJwt();
  const memberships = createFakeMemberships();
  const mandates = createFakeMandates();
  grant(memberships, USER_AIDE, COMPANY_A, 'AIDE_COMPTABLE', { planCode: 'PLAN_TEST' });
  grant(memberships, USER_CHEF, COMPANY_A, 'CHEF_MISSION');
  grant(memberships, USER_OEC, COMPANY_A, 'EXPERT_COMPTABLE_OEC');
  grant(memberships, USER_1, COMPANY_A, 'OWNER_GERANT');
  grant(memberships, 'user-caissier', COMPANY_A, 'CAISSIER_POS');
  const probes = { controlPlaneFails: false, vaultFails: false, vaultHangs: false };
  const reports: { traceId: string; errorName: string }[] = [];
  const ids = new SequentialUuidV7();
  const preClose = new StubPreCloseControls();

  const engine = new ImmutableCgncLedgerEngine({
    db: backend.driver,
    companyId: COMPANY_A,
    clock,
    ids,
    hasher: testOnlyHasher,
    cipher: testCipher,
    preCloseControls: preClose,
  });

  const app = createLedgerRoutes({
    pipeline: {
      authenticator: createAccessTokenAuthenticator({ verify: (token) => jwt.verify(token, clock.currentEpochSec()) }),
      memberships,
      ...(withMandates ? { mandates } : {}),
      tenants: { getTenantDbUpToDate: async (companyId) => {
        if (companyId === COMPANY_A) return backend.driver;
        throw new Error('base inconnue');
      } },
      entitlements: { source: createFakeEntitlements(activeRows([])), kv: createFakeKv(testClock), cacheTtlSec: 120 },
      idempotencyStore: createSqlIdempotencyStore(backend.driver),
      nowMs: testClock.nowMs,
      reportInternalError: (report) => reports.push(report),
    },
    directory: createSqlCompanyDirectory(controlDb),
    ledger: createLedgerApi({
      clock,
      ids,
      hasher: testOnlyHasher,
      cipher: testCipher,
      preCloseControls: preClose,
      actorProfiles: { resolve: async () => ({ orgPlanSegment: 'FIDUCIAIRE', activeHumanMembersCount: 5, canAccessPayrollPii: false }) },
    }),
    health: {
      probes: createHealthDeepProbeSet({
        controlPlane: {
          check: async () => {
            if (probes.controlPlaneFails) throw new Error('connect ECONNREFUSED 10.1.2.3:5432 password=hunter2');
            await controlDb.query({ sql: 'SELECT id FROM organizations LIMIT 1', params: [] });
          },
        },
        legalVault: {
          check: async () => {
            if (probes.vaultFails) throw new Error('R2 bucket fisca-legal-vault-prod AccessDenied key=AKIA123');
            if (probes.vaultHangs) await new Promise<void>(() => undefined);
          },
        },
      }),
      nowMs: testClock.nowMs,
      timeoutMs: 50,
    },
  });

  let keyCounter = 1000;
  const token = (userId: string): Promise<string> => jwt.issue(userId, clock.currentEpochSec());
  const aide = actorOf('AIDE_COMPTABLE', 'u-aide', { assignedCompanyIds: [COMPANY_A] }, clock);
  const chef = actorOf('CHEF_MISSION', 'u-chef', { assignedCompanyIds: [COMPANY_A] }, clock);
  const oec = actorOf('EXPERT_COMPTABLE_OEC', 'u-oec', { assignedCompanyIds: [COMPANY_A] }, clock);
  const nextKey = (): string => KEY((keyCounter += 1));

  return {
    app,
    tenantDb: backend.driver,
    controlDb,
    clock,
    jwt,
    memberships,
    mandates,
    engine,
    actors: { aide, chef, oec },
    probes,
    reports,
    token,
    key: nextKey,
    exec: async (sql, params = []) => {
      await backend.driver.executeBatchAtomically([{ sql, params }]);
    },
    rows: async <T>(sql: string, params: readonly SqlParam[] = []) => backend.driver.query<T>({ sql, params }),
    entryAt: async (state, input = {}) => {
      const created = await engine.createDraft(aide, {
        journalId: 'jr-cai',
        fiscalYearId: FY_2026.id,
        entryDate: '2026-03-01',
        reviewCycle: 'TRESORERIE',
        sourceDocumentType: 'PAYMENT',
        initialState: 'DRAFT',
        lines: [L('51610000', 500000, 0), L('11110000', 0, 500000)],
        ...input,
      });
      if (state === 'DRAFT') return created.entryId;
      await engine.visaCycle(chef, { entryId: created.entryId, idempotencyKey: nextKey() });
      if (state === 'REVISEE_CYCLE') return created.entryId;
      await engine.sealEntry({ ...oec, mfaVerifiedAtEpochSec: clock.currentEpochSec() }, { entryId: created.entryId, idempotencyKey: nextKey() });
      return created.entryId;
    },
    call: async (method, path, callOptions = {}) => {
      const headers: Record<string, string> = {};
      const user = callOptions.user === undefined ? USER_OEC : callOptions.user;
      if (user !== null) headers['Authorization'] = `Bearer ${await token(user)}`;
      if (callOptions.company !== null) headers[COMPANY_ID_HEADER] = callOptions.company ?? COMPANY_A;
      const hasBody = method !== 'GET';
      if (hasBody) {
        headers['Content-Type'] = 'application/json';
        if (callOptions.key !== null) headers['Idempotency-Key'] = callOptions.key ?? nextKey();
      }
      const body = callOptions.rawBody ?? (callOptions.body === undefined ? '{}' : JSON.stringify(callOptions.body));
      return app.request(path, { method, headers, ...(hasBody ? { body } : {}) });
    },
  };
}

/** Facture de vente à TVA sur encaissement (TTC 875,00 ; TVA d'attente 44558). */
export const SALE_INVOICE_LINES: readonly DraftLineInput[] = [
  L('34210000', 87500, 0),
  L('71110000', 0, 50000),
  L('71110000', 0, 25000),
  L('44558000', 0, 10000),
  L('44558000', 0, 2500),
];
export { grantMandate };
