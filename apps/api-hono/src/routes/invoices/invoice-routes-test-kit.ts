/// <reference types="node" />
/**
 * Kit de test des routes invoices (code de test uniquement). Pipeline COMPLET (JWT EdDSA réels, TenantRouter, EntitlementGuard,
 * Idempotency sur `createSqlIdempotencyStore`) au-dessus d'une base de dossier SQLite réelle migrée (ou PostgreSQL : `backend`).
 * Ports externes : séquenceur RÉEL (InvoiceSequencerDO sur faux stockage DO) ; signataire, Factur-X, coffre et Workflow simulés.
 */
import { CONTROL_PLANE_MIGRATIONS, ensureTenantSchemaUpToDate } from '@fisca/db-schema';
import type { SqlParam, TenantSqlDriver } from '@fisca/shared-types';
import { CertifyError, formatInvoiceNumber, type CertifyPorts, type UblInputSource } from '@fisca/ubl-xades/certify';
import { createSimulatedClearanceGateway, sha256Hex, type SimulatedClearanceGateway, type SimulatedStep } from '@fisca/ubl-xades/clearance';
import type { Hono } from 'hono';
import { createFakeDoDatabase, createFakeDoState } from '../../core/fake-do-storage.ts';
import { InvoiceSequencerDO } from '../../core/invoice-sequencer-do.ts';
import { createPipelineDeps } from '../../core/pipeline-composition.ts';
import {
  COMPANY_A,
  COMPANY_B,
  USER_1,
  activeRows,
  createFakeEntitlements,
  createFakeKv,
  createFakeMemberships,
  createTestClock,
  createTestJwt,
  grant,
} from '../../core/pipeline-test-support.ts';
import { StepClock, openBareSqliteDriver, openSqliteBackend, type LedgerBackend } from '../../core/ledger-test-harness.ts';
import { createSqlIdempotencyStore } from '../../core/sql-idempotency-store.ts';
import { COMPANY_ID_HEADER, createAccessTokenAuthenticator, type PipelineEnv } from '../../core/tenant-router.ts';
import { createInvoicesRoutes, type CertifyExternalPorts } from './index.ts';
import type { PublicInvoiceView } from './public-verify.ts';

export { COMPANY_A, COMPANY_B, COMPANY_ID_HEADER, USER_1 };
export const USER_VENTES = 'user-ventes';
export const USER_CAISSIER = 'user-caissier';
export const INVOICE_ID = 'inv-t09-1';
export const SERIES_KEY = 'FAC-2026';
export const KEY = (n: number): string => `018f3b5e-7c2a-7d3e-8a1b-${n.toString(16).padStart(12, '0')}`;
export const PUBLIC_UUID = '3f2b8c1e-5d4a-4e7b-9a10-2c6d8e0f1a23';
export const EMITTER_ICE = '000970000000097';

type UblInput = Awaited<ReturnType<UblInputSource['build']>>['ublInput'];

export function ublInputFor(number: string): UblInput {
  return {
    typeCode: '380',
    number,
    issueDate: '2026-11-13',
    dueDate: '2026-12-13',
    currencyCode: 'MAD',
    supplier: { name: 'Vendeur Test SARL AU', ice: EMITTER_ICE, identifiantFiscal: '12345678', address: { street: '1 rue de Test', city: 'Rabat', postalZone: '10000', countryCode: 'MA' } },
    customer: { name: 'Acheteur Test SA', ice: '001197530853397', address: { street: '2 avenue de Test', city: 'Casablanca', postalZone: '20000', countryCode: 'MA' } },
    lines: [{ descriptionFr: 'Article de test', quantityMilli: 1000, unitPriceCents: 100000, vatRateBps: 2000 }],
  };
}

export interface Probes {
  readonly calls: string[];
  failSigner: boolean;
  failWorkflow: boolean;
  dataInvalid: boolean;
  readonly archive: Map<string, { signedXml: string; aipArchiveId: string }>;
  readonly workflowStarts: { invoiceId: string; companyId: string; xmlSha256: string }[];
  readonly recordedHashes: string[];
  /** Exécute le Workflow de clearance en ligne (inclus dans le kit) au démarrage. */
  inlineWorkflow: ((start: { invoiceId: string; xmlSha256: string }) => Promise<void>) | null;
}

export interface InvoiceKit {
  readonly app: Hono<PipelineEnv>;
  readonly tenantDb: TenantSqlDriver;
  readonly clock: StepClock;
  readonly gateway: SimulatedClearanceGateway;
  readonly probes: Probes;
  readonly entitlements: ReturnType<typeof createFakeEntitlements>;
  readonly publicLookups: string[];
  readonly publicGuard: { turnstileOk: boolean; rateOk: boolean; turnstileTokens: (string | null)[] };
  readonly publicViews: Map<string, PublicInvoiceView>;
  readonly reports: { traceId: string; errorName: string }[];
  readonly sequencer: InvoiceSequencerDO;
  key(): string;
  token(userId: string, mfaAgeSec?: number): Promise<string>;
  call(method: string, path: string, options?: CallOptions): Promise<Response>;
  seedInvoice(id: string, options?: SeedOptions): Promise<void>;
  rows<T>(sql: string, params?: readonly SqlParam[]): Promise<readonly T[]>;
}

export interface CallOptions {
  readonly user?: string | null;
  readonly company?: string | null;
  readonly key?: string | null;
  readonly body?: unknown;
  readonly rawBody?: string;
  readonly mfaAgeSec?: number;
  readonly headers?: Record<string, string>;
}

export interface SeedOptions {
  readonly clearanceState?: string;
  readonly cdvStatus?: string;
  readonly sequentialNumber?: string | null;
  readonly xhubUuid?: string | null;
  readonly direction?: 'EMISE' | 'RECUE';
}

export interface InvoiceKitOptions {
  readonly backend?: LedgerBackend;
  readonly gatewayScript?: readonly SimulatedStep[];
  readonly cdvScript?: readonly SimulatedStep[];
}

export async function buildInvoiceKit(options: InvoiceKitOptions = {}): Promise<InvoiceKit> {
  const backend = options.backend ?? (await openSqliteBackend());
  const controlDb = openBareSqliteDriver('control-plane');
  await ensureTenantSchemaUpToDate(null, controlDb, 'control-plane', CONTROL_PLANE_MIGRATIONS);
  const clock = new StepClock();
  const testClock = createTestClock(Date.parse('2026-11-13T10:00:00.000Z'));
  const jwt = await createTestJwt();
  const memberships = createFakeMemberships();
  grant(memberships, USER_1, COMPANY_A, 'OWNER_GERANT');
  grant(memberships, USER_VENTES, COMPANY_A, 'COMMERCIAL_FACTURATION');
  grant(memberships, USER_CAISSIER, COMPANY_A, 'CAISSIER_POS');
  const entitlements = createFakeEntitlements(activeRows([]));
  const reports: { traceId: string; errorName: string }[] = [];
  const sequencer = new InvoiceSequencerDO(createFakeDoState(createFakeDoDatabase(), COMPANY_A), {});
  const gateway = createSimulatedClearanceGateway({
    nowIso: () => clock.nowIso(),
    ...(options.gatewayScript === undefined ? {} : { script: options.gatewayScript }),
    ...(options.cdvScript === undefined ? {} : { cdvScript: options.cdvScript }),
  });
  const probes: Probes = { calls: [], failSigner: false, failWorkflow: false, dataInvalid: false, archive: new Map(), workflowStarts: [], recordedHashes: [], inlineWorkflow: null };
  const publicLookups: string[] = [];
  const publicViews = new Map<string, PublicInvoiceView>();
  const publicGuard = { turnstileOk: true, rateOk: true, turnstileTokens: [] as (string | null)[] };

  const composed = createPipelineDeps({
    controlPlane: controlDb,
    authenticator: createAccessTokenAuthenticator({ verify: (token) => jwt.verify(token, clock.currentEpochSec()) }),
    memberships,
    tenants: {
      getTenantDbUpToDate: async (companyId) => {
        if (companyId === COMPANY_A) return backend.driver;
        throw new Error('base inconnue');
      },
    },
    entitlements: { source: entitlements, kv: createFakeKv(testClock), cacheTtlSec: 120 },
    idempotencyStore: createSqlIdempotencyStore(backend.driver),
    nowMs: testClock.nowMs,
    reportInternalError: (report) => reports.push(report),
  });
  const { cpaMandatePresence, ...pipeline } = composed;
  void cpaMandatePresence;

  const external: CertifyExternalPorts = {
    allocator: {
      allocate: async (input) => {
        probes.calls.push('allocate');
        const allocated = await sequencer.allocateInvoiceNumber({
          idempotencyKey: input.invoiceId,
          seriesKey: `FAC-${input.issueYear}`,
          invoiceSha256: await sha256Hex(`draft:${input.invoiceId}`),
          requestedAtIso: input.requestedAtIso.replace(/\.\d{3}Z$/, 'Z'),
        });
        return { sequentialNumber: formatInvoiceNumber(input.typeCode, input.issueYear, allocated.sequenceNumber), icvCounter: allocated.sequenceNumber, previousPiHash: allocated.previousInvoiceHash };
      },
      recordInvoiceHash: ({ piHash }) => {
        probes.recordedHashes.push(piHash);
        return Promise.resolve();
      },
    },
    ublSource: {
      build: async (_id, numbering) => {
        if (probes.dataInvalid) throw new CertifyError('CERTIFY_INVOICE_DATA_INVALID', [{ path: 'supplier.ice', code: 'invalid_format' }]);
        return { ublInput: ublInputFor(numbering.sequentialNumber), emitterIce15: EMITTER_ICE, buyerIdentifier: '001197530853397' };
      },
    },
    signer: {
      sign: (xml) => {
        probes.calls.push('sign');
        return probes.failSigner ? Promise.reject(new Error('CSC injoignable')) : Promise.resolve({ signedXml: `${xml}<!--signé-->` });
      },
    },
    facturX: {
      build: () => {
        probes.calls.push('facturx');
        return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      },
    },
    archive: {
      findSigned: (invoiceId) => Promise.resolve(probes.archive.get(invoiceId) ?? null),
      archive: (input) => {
        probes.calls.push('archive');
        probes.archive.set(input.invoiceId, { signedXml: input.signedXml, aipArchiveId: `aip-${input.invoiceId}` });
        return Promise.resolve({ aipArchiveId: `aip-${input.invoiceId}` });
      },
    },
    workflow: {
      startClearanceWorkflow: async (input) => {
        probes.calls.push('workflow');
        if (probes.failWorkflow) throw new Error('binding indisponible');
        probes.workflowStarts.push({ invoiceId: input.invoiceId, companyId: input.companyId, xmlSha256: input.xmlSha256 });
        if (probes.inlineWorkflow !== null) await probes.inlineWorkflow({ invoiceId: input.invoiceId, xmlSha256: input.xmlSha256 });
        return { instanceId: input.invoiceId };
      },
    },
  };

  const app = createInvoicesRoutes({
    pipeline,
    externalPortsFor: () => external,
    gatewayFor: () => gateway,
    actorProfiles: { resolve: async () => ({ orgPlanSegment: 'DIRECT_PME', activeHumanMembersCount: 1, canAccessPayrollPii: false }) },
    clock: { nowMs: () => clock.currentEpochSec() * 1000, nowIso: () => clock.nowIso() },
    ids: { newId: () => crypto.randomUUID() },
    publicVerify: {
      lookup: {
        findByXhubUuid: (uuid) => {
          publicLookups.push(uuid);
          return Promise.resolve(publicViews.get(uuid) ?? null);
        },
      },
      rateLimiter: { allow: () => Promise.resolve(publicGuard.rateOk) },
      turnstile: {
        verify: ({ token }) => {
          publicGuard.turnstileTokens.push(token);
          return Promise.resolve(publicGuard.turnstileOk);
        },
      },
    },
  });

  let keyCounter = 5000;
  const token = (userId: string, mfaAgeSec = 0): Promise<string> => jwt.issue(userId, clock.currentEpochSec() - mfaAgeSec);
  return {
    app,
    tenantDb: backend.driver,
    clock,
    gateway,
    probes,
    entitlements,
    publicLookups,
    publicGuard,
    publicViews,
    reports,
    sequencer,
    key: () => KEY((keyCounter += 1)),
    token,
    rows: async <T>(sql: string, params: readonly SqlParam[] = []) => backend.driver.query<T>({ sql, params }),
    seedInvoice: async (id, seed = {}) => {
      await backend.driver.executeBatchAtomically([
        {
          sql: `INSERT INTO fiscal_partners (id, partner_role, tax_category, legal_name_enc, address_adc450_enc, pcge_auxiliary_account, created_at)
                SELECT 'partner-1', 'CLIENT', 'COMPANY_IS', 'enc', 'enc', '34210001', '2026-11-13T09:00:00.000Z' WHERE NOT EXISTS (SELECT 1 FROM fiscal_partners WHERE id = 'partner-1')`,
          params: [],
        },
        {
          sql: `INSERT INTO invoices (id, direction, ubl_type_code, partner_id, issue_date, service_delivery_date, legal_due_date, total_ht_cents, total_vat_cents,
                  total_ttc_cents, net_payable_cents, dgi_payment_method_id, ubl_payment_code, created_at, sequential_number, clearance_state, cdv_lifecycle_status, xhub_uuid)
                VALUES (?, ?, '380_FACTURE', 'partner-1', '2026-11-13', '2026-11-13', '2026-12-13', 100000, 20000, 120000, 120000, 3, '30_VIREMENT',
                  '2026-11-13T09:00:00.000Z', ?, ?, ?, ?)`,
          params: [id, seed.direction ?? 'EMISE', seed.sequentialNumber ?? null, seed.clearanceState ?? 'BROUILLON', seed.cdvStatus ?? 'NONE', seed.xhubUuid ?? null],
        },
      ]);
    },
    call: async (method, path, callOptions = {}) => {
      const headers: Record<string, string> = { ...callOptions.headers };
      const user = callOptions.user === undefined ? USER_1 : callOptions.user;
      if (user !== null) headers['Authorization'] = `Bearer ${await token(user, callOptions.mfaAgeSec ?? 0)}`;
      if (callOptions.company !== null && method !== 'GET') headers[COMPANY_ID_HEADER] = callOptions.company ?? COMPANY_A;
      const hasBody = method !== 'GET';
      if (hasBody) {
        headers['Content-Type'] = 'application/json';
        if (callOptions.key !== null) headers['Idempotency-Key'] = callOptions.key ?? KEY((keyCounter += 1));
      }
      const body = callOptions.rawBody ?? (callOptions.body === undefined ? '{}' : JSON.stringify(callOptions.body));
      return app.request(path, { method, headers, ...(hasBody ? { body } : {}) });
    },
  };
}

export type { CertifyPorts };
