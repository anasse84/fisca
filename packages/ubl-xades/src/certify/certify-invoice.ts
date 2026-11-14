/**
 * Orchestration de POST /api/v1/invoices/:id/certify : machine à étapes, reprise idempotente par l'état persisté de la facture.
 *
 * BROUILLON → numéro (séquenceur) → commitNumbered (NUMEROTEE_VERROUILLEE) → UBL → PIH → signature XAdES → Factur-X → coffre →
 * commitSigned (SIGNEE_LOI_43_20) → démarrage du Workflow de clearance. Chaque étape est reprenable : l'état NUMEROTEE reprend
 * à la génération (réutilise l'archive du coffre si elle existe : le XML signé existant n'est jamais re-signé), l'état SIGNEE
 * reprend au démarrage du Workflow (idempotent par `invoiceId`). Une facture déjà déposée, rejetée ou annulée : CERTIFY_STATE_INVALID.
 * Aucune réponse n'affirme une certification DGI : l'état affiché reste « Validation simulée » tant que seul le pilote simulé existe (B-13).
 */
import { AdrInvariantError, FsmTransitionError } from '@fisca/shared-types';
import { SIMULATED_DISPLAY_STATE } from '../clearance/gateway.ts';
import { UblGeneratorError } from '../errors.ts';
import { buildPihFieldsFromInvoiceRow, computeInvoicePih, sha256HexUtf8 } from '../generator/pih.ts';
import { generateUblInvoiceXml } from '../generator/generate.ts';
import type { UblInvoiceInput } from '../generator/input.ts';
import { CertifyError, type CertifyIssue } from './errors.ts';
import type { CertifiableInvoice, CertifyPorts, NumberingResult } from './ports.ts';

export interface CertifyInput {
  readonly invoiceId: string;
  /** Société résolue côté serveur (D-16) ; jamais lue d'un corps de requête. */
  readonly companyId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
}

export interface CertifyResult {
  readonly invoiceId: string;
  readonly clearanceState: 'SIGNEE_LOI_43_20';
  readonly workflowInstanceId: string;
  readonly displayState: typeof SIMULATED_DISPLAY_STATE;
}

type CertifyStep = 'numbering' | 'generation' | 'signature' | 'facturx' | 'archive' | 'workflow';

const UNAVAILABLE: Readonly<Record<CertifyStep, 'CERTIFY_SOURCE_UNAVAILABLE' | 'CERTIFY_NUMBERING_UNAVAILABLE' | 'CERTIFY_SIGNATURE_UNAVAILABLE' | 'CERTIFY_FACTURX_UNAVAILABLE' | 'CERTIFY_ARCHIVE_UNAVAILABLE' | 'CERTIFY_WORKFLOW_UNAVAILABLE'>> = {
  numbering: 'CERTIFY_NUMBERING_UNAVAILABLE',
  generation: 'CERTIFY_SOURCE_UNAVAILABLE',
  signature: 'CERTIFY_SIGNATURE_UNAVAILABLE',
  facturx: 'CERTIFY_FACTURX_UNAVAILABLE',
  archive: 'CERTIFY_ARCHIVE_UNAVAILABLE',
  workflow: 'CERTIFY_WORKFLOW_UNAVAILABLE',
};

function issuesOf(error: UblGeneratorError): readonly CertifyIssue[] {
  return error.details.flatMap((detail) => ('path' in detail ? [{ path: detail.path, code: detail.code }] : [{ path: detail.field, code: 'totals_mismatch' }]));
}

/** Exécute une étape ; reclasse toute erreur non typée en indisponibilité (message constant, aucun détail interne). */
async function guarded<T>(step: CertifyStep, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof CertifyError) throw error;
    if (error instanceof UblGeneratorError) throw new CertifyError('CERTIFY_INVOICE_DATA_INVALID', issuesOf(error));
    if (error instanceof AdrInvariantError && error.code === 'ADR_06_LOI4320_CERT_MISMATCH') throw new CertifyError('CERTIFY_EMITTER_CERTIFICATE_MISMATCH');
    if (error instanceof FsmTransitionError && error.code === 'FSM_CONCURRENCY_CONFLICT') throw new CertifyError('CERTIFY_CONCURRENT_UPDATE');
    throw new CertifyError(UNAVAILABLE[step]);
  }
}

function withNumbering(invoice: CertifiableInvoice, numbering: NumberingResult): CertifiableInvoice['row'] {
  return { ...invoice.row, sequential_number: numbering.sequentialNumber, icv_counter: numbering.icvCounter, previous_pi_hash: numbering.previousPiHash };
}

function numberingOf(invoice: CertifiableInvoice): NumberingResult {
  const { sequential_number: sequentialNumber, icv_counter: icvCounter, previous_pi_hash: previousPiHash } = invoice.row;
  if (sequentialNumber === null || icvCounter === null || previousPiHash === null) throw new CertifyError('CERTIFY_STATE_INVALID');
  return { sequentialNumber, icvCounter, previousPiHash };
}

export async function certifyInvoice(ports: CertifyPorts, input: CertifyInput): Promise<CertifyResult> {
  let invoice = await ports.repository.load(input.invoiceId);
  if (invoice === null) throw new CertifyError('CERTIFY_INVOICE_NOT_FOUND');
  if (invoice.cdvLifecycleStatus !== 'NONE') throw new CertifyError('CERTIFY_STATE_INVALID');
  const startedAtIso = ports.clock.nowIso();

  if (invoice.clearanceState === 'BROUILLON') {
    const numbering = await guarded('numbering', () =>
      ports.allocator.allocate({ invoiceId: input.invoiceId, typeCode: invoice?.typeCode ?? '380', issueYear: invoice?.issueYear ?? 0, requestedAtIso: startedAtIso }),
    );
    await guarded('numbering', () =>
      ports.repository.commitNumbered({
        invoiceId: input.invoiceId,
        numbering,
        actorId: input.actorId,
        idempotencyKey: `certify:${input.idempotencyKey}:numbered`,
        auditId: ports.ids.newId(),
        nowIso: ports.clock.nowIso(),
      }),
    );
    invoice = { ...invoice, clearanceState: 'NUMEROTEE_VERROUILLEE', row: withNumbering(invoice, numbering) };
  }

  let xmlSha256: string;
  if (invoice.clearanceState === 'NUMEROTEE_VERROUILLEE') {
    xmlSha256 = await signAndArchive(ports, input, invoice);
  } else if (invoice.clearanceState === 'SIGNEE_LOI_43_20') {
    const archived = await guarded('archive', () => ports.archive.findSigned(input.invoiceId));
    if (archived === null) throw new CertifyError('CERTIFY_ARCHIVE_UNAVAILABLE');
    xmlSha256 = await sha256HexUtf8(archived.signedXml);
  } else {
    throw new CertifyError('CERTIFY_STATE_INVALID');
  }

  const started = await guarded('workflow', () =>
    ports.workflow.startClearanceWorkflow({ invoiceId: input.invoiceId, companyId: input.companyId, xmlSha256, requestedAtIso: ports.clock.nowIso() }),
  );
  return { invoiceId: input.invoiceId, clearanceState: 'SIGNEE_LOI_43_20', workflowInstanceId: started.instanceId, displayState: SIMULATED_DISPLAY_STATE };
}

async function signAndArchive(ports: CertifyPorts, input: CertifyInput, invoice: CertifiableInvoice): Promise<string> {
  const numbering = numberingOf(invoice);
  const source = await guarded('generation', () => ports.ublSource.build(input.invoiceId, numbering));
  const ublInput: UblInvoiceInput = source.ublInput;
  const piHash = await guarded('generation', () =>
    computeInvoicePih(buildPihFieldsFromInvoiceRow(invoice.row, { emitterIce15: source.emitterIce15, buyerIdentifier: source.buyerIdentifier })),
  );

  const existing = await guarded('archive', () => ports.archive.findSigned(input.invoiceId));
  let signedXml: string;
  let aipArchiveId: string;
  if (existing !== null) {
    signedXml = existing.signedXml;
    aipArchiveId = existing.aipArchiveId;
  } else {
    const xml = await guarded('generation', () => Promise.resolve(generateUblInvoiceXml(ublInput)));
    const signed = await guarded('signature', () => ports.signer.sign(xml, new Date(ports.clock.nowIso())));
    signedXml = signed.signedXml;
    const pdf = await guarded('facturx', () => ports.facturX.build({ invoiceId: input.invoiceId, ublInput, signedXml }));
    const sha = await sha256HexUtf8(signedXml);
    const archived = await guarded('archive', () => ports.archive.archive({ invoiceId: input.invoiceId, signedXml, facturXPdf: pdf, xmlSha256: sha }));
    aipArchiveId = archived.aipArchiveId;
  }

  await guarded('numbering', () => ports.allocator.recordInvoiceHash({ invoiceId: input.invoiceId, piHash }));
  await guarded('archive', () =>
    ports.repository.commitSigned({
      invoiceId: input.invoiceId,
      piHash,
      aipArchiveId,
      actorId: input.actorId,
      idempotencyKey: `certify:${input.idempotencyKey}:signed`,
      auditId: ports.ids.newId(),
      nowIso: ports.clock.nowIso(),
    }),
  );
  return sha256HexUtf8(signedXml);
}
