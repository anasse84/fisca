import type { CertifiableInvoice, CertifyPorts, NumberingResult } from '../../src/certify/index.ts';
import { INVOICE_GENESIS_HASH } from '../../src/index.ts';
import { buildInput, SUPPLIER_ICE, CUSTOMER_ICE } from './fixtures.ts';

export interface FakeWorld {
  readonly ports: CertifyPorts;
  readonly calls: string[];
  readonly state: { invoice: CertifiableInvoice | null; archive: { signedXml: string; aipArchiveId: string } | null; audits: string[] };
  readonly failures: { signer?: Error; facturX?: Error; archive?: Error; workflow?: Error; allocator?: Error };
}

export const NUMBERING: NumberingResult = { sequentialNumber: 'FAC-2026-000001', icvCounter: 1, previousPiHash: INVOICE_GENESIS_HASH };

export function draftInvoice(overrides: Partial<CertifiableInvoice> = {}): CertifiableInvoice {
  return {
    id: 'inv-1',
    clearanceState: 'BROUILLON',
    cdvLifecycleStatus: 'NONE',
    typeCode: '380',
    issueYear: 2026,
    sha256Hash: null,
    aipArchiveId: null,
    row: {
      ubl_type_code: '380_FACTURE',
      sequential_number: null,
      icv_counter: null,
      issue_date: '2026-11-13',
      currency_code: 'MAD',
      total_ht_cents: 110000,
      total_vat_cents: 21000,
      stamp_duty_cents: 0,
      total_ttc_cents: 131000,
      previous_pi_hash: null,
    },
    ...overrides,
  };
}

export function createWorld(invoice: CertifiableInvoice | null = draftInvoice()): FakeWorld {
  const calls: string[] = [];
  const failures: FakeWorld['failures'] = {};
  const state: FakeWorld['state'] = { invoice, archive: null, audits: [] };
  let ids = 0;
  const ports: CertifyPorts = {
    repository: {
      load: () => {
        calls.push('load');
        return Promise.resolve(state.invoice);
      },
      commitNumbered: (input) => {
        calls.push('commitNumbered');
        state.audits.push(input.idempotencyKey);
        if (state.invoice !== null) {
          state.invoice = {
            ...state.invoice,
            clearanceState: 'NUMEROTEE_VERROUILLEE',
            row: { ...state.invoice.row, sequential_number: input.numbering.sequentialNumber, icv_counter: input.numbering.icvCounter, previous_pi_hash: input.numbering.previousPiHash },
          };
        }
        return Promise.resolve();
      },
      commitSigned: (input) => {
        calls.push('commitSigned');
        state.audits.push(input.idempotencyKey);
        if (state.invoice !== null) state.invoice = { ...state.invoice, clearanceState: 'SIGNEE_LOI_43_20', sha256Hash: input.piHash, aipArchiveId: input.aipArchiveId };
        return Promise.resolve();
      },
    },
    allocator: {
      allocate: () => {
        calls.push('allocate');
        return failures.allocator === undefined ? Promise.resolve(NUMBERING) : Promise.reject(failures.allocator);
      },
      recordInvoiceHash: () => {
        calls.push('recordInvoiceHash');
        return Promise.resolve();
      },
    },
    ublSource: {
      build: (_id, numbering) => {
        calls.push('ublBuild');
        return Promise.resolve({ ublInput: { ...buildInput('380'), number: numbering.sequentialNumber }, emitterIce15: SUPPLIER_ICE, buyerIdentifier: CUSTOMER_ICE });
      },
    },
    signer: {
      sign: (xml) => {
        calls.push('sign');
        return failures.signer === undefined ? Promise.resolve({ signedXml: `${xml}<!--signé-->` }) : Promise.reject(failures.signer);
      },
    },
    facturX: {
      build: () => {
        calls.push('facturx');
        return failures.facturX === undefined ? Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46])) : Promise.reject(failures.facturX);
      },
    },
    archive: {
      findSigned: () => {
        calls.push('findSigned');
        return Promise.resolve(state.archive);
      },
      archive: (input) => {
        calls.push('archive');
        if (failures.archive !== undefined) return Promise.reject(failures.archive);
        state.archive = { signedXml: input.signedXml, aipArchiveId: 'aip-1' };
        return Promise.resolve({ aipArchiveId: 'aip-1' });
      },
    },
    workflow: {
      startClearanceWorkflow: (input) => {
        calls.push('workflow');
        return failures.workflow === undefined ? Promise.resolve({ instanceId: input.invoiceId }) : Promise.reject(failures.workflow);
      },
    },
    clock: { nowIso: () => '2026-11-13T10:00:00.000Z' },
    ids: { newId: () => `audit-${(ids += 1)}` },
  };
  return { ports, calls, state, failures };
}
