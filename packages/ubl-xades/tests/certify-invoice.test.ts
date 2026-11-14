import { AdrInvariantError } from '@fisca/shared-types';
import { describe, expect, it } from 'vitest';
import { CertifyError, certifyInvoice, type CertifyInput } from '../src/certify/index.ts';
import { sha256HexUtf8, UblGeneratorError } from '../src/index.ts';
import { createWorld, draftInvoice } from './support/certify-fakes.ts';

const INPUT: CertifyInput = { invoiceId: 'inv-1', companyId: 'soc-1', actorId: 'user-1', idempotencyKey: 'key-1' };

async function codeOf(promise: Promise<unknown>): Promise<CertifyError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CertifyError) return error;
    throw error;
  }
  throw new Error('erreur attendue');
}

describe('certifyInvoice : chemin nominal', () => {
  it('enchaîne numéro, UBL, PIH, signature, Factur-X, coffre, signature en base puis Workflow', async () => {
    const world = createWorld();
    const result = await certifyInvoice(world.ports, INPUT);
    expect(world.calls).toEqual(['load', 'allocate', 'commitNumbered', 'ublBuild', 'findSigned', 'sign', 'facturx', 'archive', 'recordInvoiceHash', 'commitSigned', 'workflow']);
    expect(result).toEqual({ invoiceId: 'inv-1', clearanceState: 'SIGNEE_LOI_43_20', workflowInstanceId: 'inv-1', displayState: 'Validation simulée' });
    expect(world.state.invoice?.sha256Hash).toMatch(/^[0-9a-f]{64}$/);
    expect(world.state.audits).toEqual(['certify:key-1:numbered', 'certify:key-1:signed']);
    expect(JSON.stringify(result)).not.toMatch(/certifi/i);
  });

  it('le XML signé archivé est celui dont l’empreinte part au Workflow', async () => {
    const world = createWorld();
    let started = '';
    const original = world.ports.workflow.startClearanceWorkflow;
    world.ports.workflow.startClearanceWorkflow = (input) => {
      started = input.xmlSha256;
      return original(input);
    };
    await certifyInvoice(world.ports, INPUT);
    expect(started).toBe(await sha256HexUtf8(world.state.archive?.signedXml ?? ''));
  });
});

describe('certifyInvoice : reprise idempotente', () => {
  it('SIGNEE après panne du Workflow : seul le démarrage est rejoué (pas de nouvelle signature ni de nouveau numéro)', async () => {
    const world = createWorld();
    world.failures.workflow = new Error('panne');
    await codeOf(certifyInvoice(world.ports, INPUT));
    expect(world.state.invoice?.clearanceState).toBe('SIGNEE_LOI_43_20');
    delete world.failures.workflow;
    world.calls.length = 0;
    const second = await certifyInvoice(world.ports, { ...INPUT, idempotencyKey: 'key-2' });
    expect(world.calls).toEqual(['load', 'findSigned', 'workflow']);
    expect(second.workflowInstanceId).toBe('inv-1');
  });

  it('panne après archivage et avant commitSigned : la reprise réutilise le XML archivé (jamais re-signé)', async () => {
    const world = createWorld();
    const commit = world.ports.repository.commitSigned;
    world.ports.repository.commitSigned = () => Promise.reject(new Error('base indisponible'));
    expect((await codeOf(certifyInvoice(world.ports, INPUT))).code).toBe('CERTIFY_ARCHIVE_UNAVAILABLE');
    expect(world.state.invoice?.clearanceState).toBe('NUMEROTEE_VERROUILLEE');
    world.ports.repository.commitSigned = commit;
    world.calls.length = 0;
    await certifyInvoice(world.ports, { ...INPUT, idempotencyKey: 'key-2' });
    expect(world.calls).not.toContain('sign');
    expect(world.calls).not.toContain('allocate');
    expect(world.calls).toContain('commitSigned');
  });
});

describe('certifyInvoice : refus et erreurs typées', () => {
  it('facture inconnue', async () => {
    expect((await codeOf(certifyInvoice(createWorld(null).ports, INPUT))).code).toBe('CERTIFY_INVOICE_NOT_FOUND');
  });

  it.each(['DEPOSEE_CERTIFIEE_DGI', 'REJETEE_XHUB', 'APPROUVEE', 'ENCAISSEE', 'ANNULEE_BROUILLON'])('état %s : CERTIFY_STATE_INVALID sans effet de bord', async (clearanceState) => {
    const world = createWorld(draftInvoice({ clearanceState }));
    expect((await codeOf(certifyInvoice(world.ports, INPUT))).code).toBe('CERTIFY_STATE_INVALID');
    expect(world.calls).toEqual(['load']);
  });

  it('séquenceur en panne : 503 numérotation, rien de persisté', async () => {
    const world = createWorld();
    world.failures.allocator = new Error('DO injoignable');
    expect((await codeOf(certifyInvoice(world.ports, INPUT))).code).toBe('CERTIFY_NUMBERING_UNAVAILABLE');
    expect(world.calls).toEqual(['load', 'allocate']);
  });

  it('certificat ne correspondant pas à l’émetteur : CERTIFY_EMITTER_CERTIFICATE_MISMATCH, rien archivé', async () => {
    const world = createWorld();
    world.failures.signer = new AdrInvariantError('ADR_06_LOI4320_CERT_MISMATCH', 'ICE différent');
    const error = await codeOf(certifyInvoice(world.ports, INPUT));
    expect(error.code).toBe('CERTIFY_EMITTER_CERTIFICATE_MISMATCH');
    expect(world.calls).not.toContain('archive');
    expect(error.message).not.toContain('ICE différent');
  });

  it.each([
    ['signer', 'CERTIFY_SIGNATURE_UNAVAILABLE'],
    ['facturX', 'CERTIFY_FACTURX_UNAVAILABLE'],
    ['archive', 'CERTIFY_ARCHIVE_UNAVAILABLE'],
    ['workflow', 'CERTIFY_WORKFLOW_UNAVAILABLE'],
  ] as const)('panne du port %s : %s, message constant', async (port, code) => {
    const world = createWorld();
    world.failures[port] = new Error('secret=hunter2 https://interne');
    const error = await codeOf(certifyInvoice(world.ports, INPUT));
    expect(error.code).toBe(code);
    expect(error.message).not.toContain('hunter2');
    if (port !== 'workflow') expect(world.calls).not.toContain('workflow');
  });

  it('données de facture invalides : issues[] avec chemins seuls', async () => {
    const world = createWorld();
    world.ports.ublSource.build = () => Promise.reject(new UblGeneratorError('UBL_INPUT_INVALID', 'x', [{ path: 'supplier.ice', code: 'invalid_format' }]));
    const error = await codeOf(certifyInvoice(world.ports, INPUT));
    expect(error.code).toBe('CERTIFY_INVOICE_DATA_INVALID');
    expect(error.issues).toEqual([{ path: 'supplier.ice', code: 'invalid_format' }]);
  });

  it('facture à statut CDV déjà avancé : refus', async () => {
    const world = createWorld(draftInvoice({ cdvLifecycleStatus: 'PRISE_EN_CHARGE' }));
    expect((await codeOf(certifyInvoice(world.ports, INPUT))).code).toBe('CERTIFY_STATE_INVALID');
  });
});
