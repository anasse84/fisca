import { describe, expect, it } from 'vitest';
import { buildInvoiceKit, COMPANY_B, INVOICE_ID, USER_CAISSIER, USER_VENTES, type InvoiceKit } from './invoice-routes-test-kit.ts';

const PATH = `/api/v1/invoices/${INVOICE_ID}/certify`;

async function kitWithDraft(): Promise<InvoiceKit> {
  const kit = await buildInvoiceKit();
  await kit.seedInvoice(INVOICE_ID);
  return kit;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('POST /invoices/:id/certify : nominal', () => {
  it('202 {invoiceId, clearanceState, workflowInstanceId, displayState}, facture numérotée puis signée, audit en deux lignes', async () => {
    const kit = await kitWithDraft();
    const response = await kit.call('POST', PATH);
    expect(response.status).toBe(202);
    const body = await json(response);
    expect(body).toEqual({ invoiceId: INVOICE_ID, clearanceState: 'SIGNEE_LOI_43_20', workflowInstanceId: INVOICE_ID, displayState: 'Validation simulée' });
    expect(JSON.stringify(body)).not.toMatch(/certifi|conforme|homologu/i);
    const [row] = await kit.rows<{ clearance_state: string; sequential_number: string; icv_counter: number; previous_pi_hash: string; sha256_hash: string; aip_archive_id: string }>(
      'SELECT clearance_state, sequential_number, icv_counter, previous_pi_hash, sha256_hash, aip_archive_id FROM invoices WHERE id = ?',
      [INVOICE_ID],
    );
    expect(row).toMatchObject({ clearance_state: 'SIGNEE_LOI_43_20', sequential_number: 'FAC-2026-000001', icv_counter: 1, aip_archive_id: `aip-${INVOICE_ID}` });
    expect(row?.sha256_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.previous_pi_hash).toMatch(/^[0-9a-f]{64}$/);
    const audits = await kit.rows<{ from_state: string; to_state: string; actor_kind: string; actor_id: string }>(
      "SELECT from_state, to_state, actor_kind, actor_id FROM state_transition_audit WHERE entity_id = ? ORDER BY created_at, id",
      [INVOICE_ID],
    );
    expect(audits.map((a) => `${a.from_state}>${a.to_state}`).sort()).toEqual(['BROUILLON>NUMEROTEE_VERROUILLEE', 'NUMEROTEE_VERROUILLEE>SIGNEE_LOI_43_20']);
    expect(kit.probes.workflowStarts).toHaveLength(1);
    expect(kit.probes.workflowStarts[0]?.companyId).toBe('societe-a001');
    expect(kit.probes.recordedHashes).toEqual([row?.sha256_hash]);
  });

  it('le rôle Commercial facturation est admis', async () => {
    const kit = await kitWithDraft();
    expect((await kit.call('POST', PATH, { user: USER_VENTES })).status).toBe(202);
  });

  it('deux factures successives : numéros 1 et 2, previous_pi_hash fourni par le séquenceur', async () => {
    const kit = await kitWithDraft();
    await kit.seedInvoice('inv-t09-2');
    expect((await kit.call('POST', PATH)).status).toBe(202);
    expect((await kit.call('POST', '/api/v1/invoices/inv-t09-2/certify')).status).toBe(202);
    const rows = await kit.rows<{ sequential_number: string; icv_counter: number }>('SELECT sequential_number, icv_counter FROM invoices ORDER BY icv_counter');
    expect(rows.map((r) => r.sequential_number)).toEqual(['FAC-2026-000001', 'FAC-2026-000002']);
  });
});

describe('POST /invoices/:id/certify : idempotence (Idempotency-Key 72 h)', () => {
  it('même clé et même corps : réponse rejouée identique, une seule exécution', async () => {
    const kit = await kitWithDraft();
    const key = kit.key();
    const first = await kit.call('POST', PATH, { key });
    const replay = await kit.call('POST', PATH, { key });
    expect(replay.status).toBe(202);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await json(replay)).toEqual(await json(first));
    expect(kit.probes.calls.filter((c) => c === 'sign')).toHaveLength(1);
    expect(kit.probes.workflowStarts).toHaveLength(1);
  });

  it('même clé, corps différent : 422 sans second effet', async () => {
    const kit = await kitWithDraft();
    const key = kit.key();
    await kit.call('POST', PATH, { key });
    const other = await kit.call('POST', PATH, { key, rawBody: '{ }' });
    expect(other.status).toBe(422);
    expect(other.headers.get('content-type')).toContain('application/problem+json');
    expect(kit.probes.calls.filter((c) => c === 'sign')).toHaveLength(1);
  });

  it('Idempotency-Key absente : 400', async () => {
    const kit = await kitWithDraft();
    expect((await kit.call('POST', PATH, { key: null })).status).toBe(400);
  });

  it('autre clé sur une facture déjà signée dont le Workflow n’a pas démarré : reprise sans nouvelle signature', async () => {
    const kit = await kitWithDraft();
    kit.probes.failWorkflow = true;
    expect((await kit.call('POST', PATH)).status).toBe(503);
    kit.probes.failWorkflow = false;
    const retry = await kit.call('POST', PATH);
    expect(retry.status).toBe(202);
    expect(kit.probes.calls.filter((c) => c === 'sign')).toHaveLength(1);
    expect(kit.probes.calls.filter((c) => c === 'allocate')).toHaveLength(1);
  });
});

describe('POST /invoices/:id/certify : garde-fous', () => {
  it('401 sans JWT', async () => {
    const kit = await kitWithDraft();
    const response = await kit.call('POST', PATH, { user: null });
    expect(response.status).toBe(401);
    expect(kit.probes.calls).toEqual([]);
  });

  it('403 pour un rôle sans INVOICE_CERTIFY_XHUB (caissier)', async () => {
    const kit = await kitWithDraft();
    const response = await kit.call('POST', PATH, { user: USER_CAISSIER });
    expect(response.status).toBe(403);
    expect((await json(response))['errorCode']).toBe('RBAC_FORBIDDEN_FOR_CAISSIER_POS');
    expect(kit.probes.calls).toEqual([]);
  });

  it('403 Step-Up : second facteur plus ancien que 300 s refusé, 299 s accepté', async () => {
    const kit = await kitWithDraft();
    const stale = await kit.call('POST', PATH, { mfaAgeSec: 301 });
    expect(stale.status).toBe(403);
    expect((await json(stale))['errorCode']).toBe('ABAC_STEP_UP_MFA_REQUIRED');
    expect(kit.probes.calls).toEqual([]);
    expect((await kit.call('POST', PATH, { mfaAgeSec: 299 })).status).toBe(202);
  });

  it('dossier hors périmètre de l’utilisateur (D-16) : refus, aucune exécution', async () => {
    const kit = await kitWithDraft();
    const response = await kit.call('POST', PATH, { company: COMPANY_B });
    expect([403, 404]).toContain(response.status);
    expect(kit.probes.calls).toEqual([]);
  });

  it('400 : corps non vide, champ inconnu, JSON illisible, tableau', async () => {
    const kit = await kitWithDraft();
    for (const rawBody of ['{"tenantId":"x"}', '{"a":1}', '{oops', '[]']) {
      const response = await kit.call('POST', PATH, { rawBody });
      expect(response.status, rawBody).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
    }
    expect(kit.probes.calls).toEqual([]);
  });

  it('400 : identifiant de facture hors motif', async () => {
    const kit = await kitWithDraft();
    expect((await kit.call('POST', '/api/v1/invoices/a%20b/certify')).status).toBe(400);
  });
});

describe('POST /invoices/:id/certify : erreurs métier', () => {
  it('404 facture inconnue, avec instance', async () => {
    const kit = await buildInvoiceKit();
    const response = await kit.call('POST', '/api/v1/invoices/inconnue/certify');
    expect(response.status).toBe(404);
    expect((await json(response))['instance']).toBe('/api/v1/invoices/inconnue/certify');
  });

  it.each(['DEPOSEE_CERTIFIEE_DGI', 'REJETEE_XHUB', 'ANNULEE_BROUILLON', 'APPROUVEE'])('409 état %s', async (clearanceState) => {
    const kit = await buildInvoiceKit();
    await kit.seedInvoice(INVOICE_ID, { clearanceState, sequentialNumber: 'FAC-2026-000009', xhubUuid: clearanceState === 'ANNULEE_BROUILLON' ? null : '00000000-0000-4000-8000-000000000001' });
    const response = await kit.call('POST', PATH);
    expect(response.status).toBe(409);
    expect((await json(response))['errorCode']).toBe('INVOICE_STATE_INVALID');
    expect(kit.probes.calls).toEqual([]);
  });

  it('409 pour une facture reçue (RECUE)', async () => {
    const kit = await buildInvoiceKit();
    await kit.seedInvoice(INVOICE_ID, { direction: 'RECUE' });
    expect((await kit.call('POST', PATH)).status).toBe(409);
  });

  it('422 données de facture invalides, issues[] sans valeur', async () => {
    const kit = await kitWithDraft();
    kit.probes.dataInvalid = true;
    const response = await kit.call('POST', PATH);
    expect(response.status).toBe(422);
    const body = await json(response);
    expect(body['issues']).toEqual([{ path: 'supplier.ice', message: 'invalid_format' }]);
    expect(typeof body['traceId']).toBe('string');
  });

  it('503 signature indisponible : message constant, facture laissée NUMEROTEE_VERROUILLEE puis reprise', async () => {
    const kit = await kitWithDraft();
    kit.probes.failSigner = true;
    const response = await kit.call('POST', PATH);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await json(response))).not.toContain('CSC');
    const [row] = await kit.rows<{ clearance_state: string }>('SELECT clearance_state FROM invoices WHERE id = ?', [INVOICE_ID]);
    expect(row?.clearance_state).toBe('NUMEROTEE_VERROUILLEE');
    kit.probes.failSigner = false;
    expect((await kit.call('POST', PATH)).status).toBe(202);
    expect(kit.probes.calls.filter((c) => c === 'allocate')).toHaveLength(1);
  });
});
