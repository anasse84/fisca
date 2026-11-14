/** Kit de test de la clearance (code de test uniquement) : base SQLite migrée du harnais du grand livre, faux `step`, ports simulés. */
import {
  createSimulatedClearanceGateway,
  sha256Hex,
  type ClearancePorts,
  type SimulatedClearanceGateway,
  type SimulatedStep,
} from '@fisca/ubl-xades/clearance';
import type { TenantSqlDriver } from '@fisca/shared-types';
import { createFakeDoDatabase, createFakeDoState } from '../../core/fake-do-storage.ts';
import { InvoiceSequencerDO } from '../../core/invoice-sequencer-do.ts';
import { COMPANY_ID, openSqliteBackend, type LedgerBackend } from '../../core/ledger-test-harness.ts';
import { createSqlIdempotencyStore } from '../../core/sql-idempotency-store.ts';
import { createSubmissionIdempotencyPort } from './idempotency-adapter.ts';
import type { WorkflowStepConfigLike, WorkflowStepLike } from './dgi-clearance-workflow.ts';

export { COMPANY_ID };
export const INVOICE_ID = 'inv-clearance-1';
export const SIGNED_XML = '<Invoice>facture signée de test</Invoice>';
export const SERIES_KEY = 'FAC-2026';
export const SEQUENCER_NOW = '2026-11-13T10:00:00Z';
const START_MS = Date.parse('2026-11-13T10:00:00.000Z');

export interface StepRecord {
  readonly kind: 'do' | 'sleep';
  readonly name: string;
  readonly config?: WorkflowStepConfigLike;
  readonly sleepMs?: number;
}

/** Faux `step` : exécute les callbacks (avec les réessais d'infrastructure de `retries.limit`), enregistre do/sleep et avance l'horloge. */
export class FakeStep implements WorkflowStepLike {
  readonly records: StepRecord[] = [];
  elapsedMs = 0;

  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
  do<T>(name: string, config: WorkflowStepConfigLike, callback: () => Promise<T>): Promise<T>;
  async do<T>(name: string, second: WorkflowStepConfigLike | (() => Promise<T>), third?: () => Promise<T>): Promise<T> {
    const config = typeof second === 'function' ? undefined : second;
    const callback = typeof second === 'function' ? second : third;
    if (callback === undefined) throw new Error('callback manquant');
    this.records.push({ kind: 'do', name, ...(config === undefined ? {} : { config }) });
    const limit = config?.retries?.limit ?? 0;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await callback();
      } catch (error) {
        if (attempt >= limit) throw error;
      }
    }
  }

  sleep(name: string, duration: number | string): Promise<void> {
    if (typeof duration !== 'number') throw new Error('durée numérique attendue');
    this.records.push({ kind: 'sleep', name, sleepMs: duration });
    this.elapsedMs += duration;
    return Promise.resolve();
  }

  get sleeps(): readonly number[] {
    return this.records.filter((r) => r.kind === 'sleep').map((r) => r.sleepMs ?? 0);
  }

  get stepNames(): readonly string[] {
    return this.records.map((r) => r.name);
  }
}

export interface Fixture {
  readonly db: TenantSqlDriver;
  readonly gateway: SimulatedClearanceGateway;
  readonly ports: ClearancePorts;
  readonly sequencer: InvoiceSequencerDO;
  readonly step: FakeStep;
  readonly xmlSha256: string;
  readonly auditIds: string[];
  readonly loadXmlCalls: { count: number };
}

export interface FixtureOptions {
  readonly script?: readonly SimulatedStep[];
  readonly clearanceState?: string;
  readonly xml?: string;
  /** Base de dossier : SQLite en mémoire par défaut ; PostgreSQL pour `clearance-backends.test.ts`. */
  readonly backend?: LedgerBackend;
}

export async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const backend = options.backend ?? (await openSqliteBackend());
  const db = backend.driver;
  const step = new FakeStep();
  const xml = options.xml ?? SIGNED_XML;
  const xmlSha256 = await sha256Hex(xml);
  const sequencer = new InvoiceSequencerDO(createFakeDoState(createFakeDoDatabase(), COMPANY_ID), {});
  await sequencer.allocateInvoiceNumber({ idempotencyKey: INVOICE_ID, seriesKey: SERIES_KEY, invoiceSha256: xmlSha256, requestedAtIso: SEQUENCER_NOW });
  await seedInvoice(db, { id: INVOICE_ID, clearanceState: options.clearanceState ?? 'SIGNEE_LOI_43_20', sequentialNumber: 'FAC-2026-000001' });
  const gateway = createSimulatedClearanceGateway({ nowIso: () => new Date(START_MS + step.elapsedMs).toISOString(), ...(options.script === undefined ? {} : { script: options.script }) });
  const auditIds: string[] = [];
  const loadXmlCalls = { count: 0 };
  const ports: ClearancePorts = {
    db,
    gateway,
    idempotency: createSubmissionIdempotencyPort(createSqlIdempotencyStore(db)),
    clock: { nowIso: () => new Date(START_MS + step.elapsedMs).toISOString(), nowMs: () => START_MS + step.elapsedMs },
    ids: {
      newId: () => {
        const id = `audit-${auditIds.length + 1}`;
        auditIds.push(id);
        return id;
      },
    },
    loadSignedXml: () => {
      loadXmlCalls.count += 1;
      return Promise.resolve(xml);
    },
    recordSubmissionAttempt: async () => {
      await sequencer.recordSubmissionAttempt({ seriesKey: SERIES_KEY, requestedAtIso: SEQUENCER_NOW });
    },
  };
  return { db, gateway, ports, sequencer, step, xmlSha256, auditIds, loadXmlCalls };
}

export interface SeedInvoice {
  readonly id: string;
  readonly clearanceState: string;
  readonly sequentialNumber: string;
  readonly cdvLifecycleStatus?: string;
}

export async function seedInvoice(db: TenantSqlDriver, invoice: SeedInvoice): Promise<void> {
  await db.executeBatchAtomically([
    {
      sql: `INSERT INTO fiscal_partners (id, partner_role, tax_category, legal_name_enc, address_adc450_enc, pcge_auxiliary_account, created_at)
            SELECT 'partner-1', 'CLIENT', 'COMPANY_IS', 'enc', 'enc', '34210001', '2026-11-13T09:00:00.000Z' WHERE NOT EXISTS (SELECT 1 FROM fiscal_partners WHERE id = 'partner-1')`,
      params: [],
    },
    {
      sql: `INSERT INTO invoices (id, direction, ubl_type_code, partner_id, issue_date, service_delivery_date, legal_due_date, total_ht_cents, total_vat_cents,
              total_ttc_cents, net_payable_cents, dgi_payment_method_id, ubl_payment_code, created_at, sequential_number, clearance_state, cdv_lifecycle_status)
            VALUES (?, 'EMISE', '380_FACTURE', 'partner-1', '2026-11-13', '2026-11-13', '2026-12-13', 100000, 20000, 120000, 120000, 3, '30_VIREMENT',
              '2026-11-13T09:00:00.000Z', ?, ?, ?)`,
      params: [invoice.id, invoice.sequentialNumber, invoice.clearanceState, invoice.cdvLifecycleStatus ?? 'NONE'],
    },
  ]);
}

export interface InvoiceSnapshot {
  readonly clearance_state: string;
  readonly cdv_lifecycle_status: string;
  readonly sequential_number: string | null;
  readonly xhub_uuid: string | null;
  readonly total_ttc_cents: number;
}

export async function snapshotOf(db: TenantSqlDriver, id: string = INVOICE_ID): Promise<InvoiceSnapshot> {
  const rows = await db.query<InvoiceSnapshot>({
    sql: 'SELECT clearance_state, cdv_lifecycle_status, sequential_number, xhub_uuid, total_ttc_cents FROM invoices WHERE id = ?',
    params: [id],
  });
  const row = rows[0];
  if (row === undefined) throw new Error('facture absente');
  return row;
}

export async function auditRows(db: TenantSqlDriver, id: string = INVOICE_ID): Promise<readonly { from_state: string; to_state: string; idempotency_key: string; proof_ref: string | null; actor_kind: string }[]> {
  return db.query({
    sql: "SELECT from_state, to_state, idempotency_key, proof_ref, actor_kind FROM state_transition_audit WHERE entity_table = 'invoices' AND entity_id = ? ORDER BY created_at, id",
    params: [id],
  });
}
