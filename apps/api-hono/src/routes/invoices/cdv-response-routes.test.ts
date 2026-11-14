import { runDgiClearanceWorkflow } from './dgi-clearance-workflow.ts';
import { createSubmissionIdempotencyPort } from './idempotency-adapter.ts';
import { createSqlIdempotencyStore } from '../../core/sql-idempotency-store.ts';
import { describe, expect, it } from 'vitest';
import { FakeStep } from './clearance-test-kit.ts';
import { buildInvoiceKit, INVOICE_ID, USER_CAISSIER, type InvoiceKit } from './invoice-routes-test-kit.ts';

const PATH = `/api/v1/invoices/${INVOICE_ID}/cdv-response`;
const XHUB = '00000000-0000-4000-8000-000000000001';

async function kitDeposited(cdvStatus = 'NONE', clearanceState = 'DEPOSEE_CERTIFIEE_DGI', options: Parameters<typeof buildInvoiceKit>[0] = {}): Promise<InvoiceKit> {
  const kit = await buildInvoiceKit(options);
  await kit.seedInvoice(INVOICE_ID, { clearanceState, cdvStatus, sequentialNumber: 'FAC-2026-000001', xhubUuid: XHUB });
  return kit;
}

async function statusOf(kit: InvoiceKit): Promise<string> {
  const [row] = await kit.rows<{ clearance_state: string; cdv_lifecycle_status: string }>('SELECT clearance_state, cdv_lifecycle_status FROM invoices WHERE id = ?', [INVOICE_ID]);
  return `${row?.clearance_state}/${row?.cdv_lifecycle_status}`;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('POST /invoices/:id/cdv-response : nominal', () => {
  it('APPROUVEE : 200, émis vers xHub (simulé) puis appliqué par le FSM CDV', async () => {
    const kit = await kitDeposited();
    const response = await kit.call('POST', PATH, { body: { status: 'APPROUVEE' } });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ invoiceId: INVOICE_ID, previousStatus: 'DEPOSEE_CERTIFIEE_DGI', status: 'APPROUVEE', applied: true, displayState: 'Validation simulée' });
    expect(kit.gateway.emittedCdv).toEqual([expect.objectContaining({ invoiceId: INVOICE_ID, xhubUuid: XHUB, status: 'APPROUVEE', idempotencyKey: `cdv:${INVOICE_ID}:APPROUVEE` })]);
    expect(await statusOf(kit)).toBe('APPROUVEE/NONE');
  });

  it('EN_LITIGE_SUSPENDUE avec motif, puis ENCAISSEE refusé (409) : le litige ne mène pas à ENCAISSEE', async () => {
    const kit = await kitDeposited();
    expect((await kit.call('POST', PATH, { body: { status: 'EN_LITIGE_SUSPENDUE', reason: 'Quantité contestée' } })).status).toBe(200);
    expect(kit.gateway.emittedCdv[0]?.reason).toBe('Quantité contestée');
    expect(await statusOf(kit)).toBe('DEPOSEE_CERTIFIEE_DGI/EN_LITIGE_SUSPENDUE');
    expect((await kit.call('POST', PATH, { body: { status: 'ENCAISSEE' } })).status).toBe(409);
    expect(kit.gateway.emittedCdv).toHaveLength(1);
  });

  it('APPROUVEE puis ENCAISSEE', async () => {
    const kit = await kitDeposited();
    expect((await kit.call('POST', PATH, { body: { status: 'APPROUVEE' } })).status).toBe(200);
    expect((await kit.call('POST', PATH, { body: { status: 'ENCAISSEE' } })).status).toBe(200);
    expect(await statusOf(kit)).toBe('ENCAISSEE/NONE');
  });

  it('même Idempotency-Key et même corps : réponse rejouée, une seule émission', async () => {
    const kit = await kitDeposited();
    const key = kit.key();
    const first = await kit.call('POST', PATH, { key, body: { status: 'APPROUVEE' } });
    const replay = await kit.call('POST', PATH, { key, body: { status: 'APPROUVEE' } });
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await json(replay)).toEqual(await json(first));
    expect(kit.gateway.emittedCdv).toHaveLength(1);
  });

  it('même clé, corps différent : 422', async () => {
    const kit = await kitDeposited();
    const key = kit.key();
    await kit.call('POST', PATH, { key, body: { status: 'APPROUVEE' } });
    expect((await kit.call('POST', PATH, { key, body: { status: 'EN_LITIGE_SUSPENDUE' } })).status).toBe(422);
  });
});

describe('POST /invoices/:id/cdv-response : refus', () => {
  it('transition invalide (APPROUVEE → EN_LITIGE_SUSPENDUE) : 409, aucune émission, base intacte', async () => {
    const kit = await kitDeposited('NONE', 'APPROUVEE');
    const response = await kit.call('POST', PATH, { body: { status: 'EN_LITIGE_SUSPENDUE' } });
    expect(response.status).toBe(409);
    expect((await json(response))['errorCode']).toBe('CDV_TRANSITION_INVALID');
    expect(kit.gateway.emittedCdv).toEqual([]);
    expect(await statusOf(kit)).toBe('APPROUVEE/NONE');
  });

  it('facture non déposée (SIGNEE_LOI_43_20) : 409 ; inconnue : 404', async () => {
    const kit = await kitDeposited('NONE', 'SIGNEE_LOI_43_20');
    expect((await kit.call('POST', PATH, { body: { status: 'APPROUVEE' } })).status).toBe(409);
    expect((await kit.call('POST', '/api/v1/invoices/inconnue/cdv-response', { body: { status: 'APPROUVEE' } })).status).toBe(404);
  });

  it('400 : statut hors des trois émis, champ inconnu, motif trop long ou vide, corps absent', async () => {
    const kit = await kitDeposited();
    const bad: unknown[] = [{ status: 'REFUSEE' }, { status: 'MISE_A_DISPOSITION' }, { status: 'APPROUVEE', extra: 1 }, { status: 'APPROUVEE', reason: 'x'.repeat(501) }, { status: 'APPROUVEE', reason: '  ' }, {}];
    for (const body of bad) expect((await kit.call('POST', PATH, { body })).status, JSON.stringify(body)).toBe(400);
    expect((await kit.call('POST', PATH, { rawBody: '' })).status).toBe(400);
    expect(kit.gateway.emittedCdv).toEqual([]);
  });

  it('401 sans JWT ; 403 caissier ; 403 Step-Up périmé', async () => {
    const kit = await kitDeposited();
    const body = { status: 'APPROUVEE' };
    expect((await kit.call('POST', PATH, { body, user: null })).status).toBe(401);
    expect((await kit.call('POST', PATH, { body, user: USER_CAISSIER })).status).toBe(403);
    const stale = await kit.call('POST', PATH, { body, mfaAgeSec: 400 });
    expect(stale.status).toBe(403);
    expect((await json(stale))['errorCode']).toBe('ABAC_STEP_UP_MFA_REQUIRED');
    expect(kit.gateway.emittedCdv).toEqual([]);
  });

  it('passerelle : rejet permanent 422, panne transitoire 503 ; base intacte, et un nouvel essai aboutit', async () => {
    const kit = await kitDeposited('NONE', 'DEPOSEE_CERTIFIEE_DGI', { cdvScript: [{ kind: 'reject', code: 'XHUB_REFUSED' }, { kind: 'transient', code: 'HTTP_503' }] });
    const body = { status: 'APPROUVEE' };
    const rejected = await kit.call('POST', PATH, { body });
    expect(rejected.status).toBe(422);
    expect(JSON.stringify(await json(rejected))).not.toContain('XHUB_REFUSED');
    expect((await kit.call('POST', PATH, { body })).status).toBe(503);
    expect(await statusOf(kit)).toBe('DEPOSEE_CERTIFIEE_DGI/NONE');
    expect((await kit.call('POST', PATH, { body })).status).toBe(200);
  });
});

describe('certify → clearance → cdv-response (bout en bout, pilote simulé)', () => {
  it('le Workflow réel dépose la facture, puis APPROUVEE est émis', async () => {
    const kit = await buildInvoiceKit();
    await kit.seedInvoice(INVOICE_ID);
    const step = new FakeStep();
    kit.probes.inlineWorkflow = async ({ invoiceId, xmlSha256 }) => {
      const result = await runDgiClearanceWorkflow(
        () =>
          Promise.resolve({
            db: kit.tenantDb,
            gateway: kit.gateway,
            idempotency: createSubmissionIdempotencyPort(createSqlIdempotencyStore(kit.tenantDb)),
            clock: { nowIso: () => kit.clock.nowIso(), nowMs: () => kit.clock.currentEpochSec() * 1000 },
            ids: { newId: () => crypto.randomUUID() },
            loadSignedXml: () => Promise.resolve(kit.probes.archive.get(invoiceId)?.signedXml ?? ''),
          }),
        { payload: { invoiceId, companyId: kit.tenantDb.tenantId, xmlSha256, requestedAtIso: '2026-11-13T10:00:00.000Z' }, timestamp: new Date('2026-11-13T10:00:00.000Z') },
        step,
      );
      expect(result.status).toBe('DEPOSEE_CERTIFIEE_DGI');
    };
    expect((await kit.call('POST', `/api/v1/invoices/${INVOICE_ID}/certify`)).status).toBe(202);
    expect(await statusOf(kit)).toBe('DEPOSEE_CERTIFIEE_DGI/NONE');
    expect((await kit.call('POST', PATH, { body: { status: 'APPROUVEE' } })).status).toBe(200);
    expect(await statusOf(kit)).toBe('APPROUVEE/NONE');
  });
});
