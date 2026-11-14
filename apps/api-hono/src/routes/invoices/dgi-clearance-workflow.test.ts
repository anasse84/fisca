import { computeClearanceBackoffSchedule, type SimulatedStep } from '@fisca/ubl-xades/clearance';
import { describe, expect, it, vi } from 'vitest';
import { DgiClearanceWorkflow, runDgiClearanceWorkflow, type WorkflowEventLike } from './dgi-clearance-workflow.ts';
import { DgiClearanceWorkflowPayloadSchema, DgiClearanceWorkflowResultSchema, type DgiClearanceWorkflowPayload } from './events.ts';
import { auditRows, COMPANY_ID, createFixture, INVOICE_ID, SERIES_KEY, snapshotOf, type Fixture } from './clearance-test-kit.ts';

function eventOf(fixture: Fixture, overrides: Partial<DgiClearanceWorkflowPayload> = {}): WorkflowEventLike<DgiClearanceWorkflowPayload> {
  return {
    payload: { invoiceId: INVOICE_ID, companyId: COMPANY_ID, xmlSha256: fixture.xmlSha256, requestedAtIso: '2026-11-13T10:00:00.000Z', ...overrides },
    timestamp: new Date('2026-11-13T10:00:00.000Z'),
  };
}

async function run(fixture: Fixture, overrides: Partial<DgiClearanceWorkflowPayload> = {}) {
  return runDgiClearanceWorkflow(() => Promise.resolve(fixture.ports), eventOf(fixture, overrides), fixture.step);
}

const transient = (count: number): readonly SimulatedStep[] => Array.from({ length: count }, () => ({ kind: 'transient' as const, code: 'HTTP_503' }));

describe('DgiClearanceWorkflow : succès', () => {
  it('succès au 1er coup : DEPOSEE_CERTIFIEE_DGI, xhub_uuid posé, numéro intact, état affiché « Validation simulée »', async () => {
    const fixture = await createFixture();
    const result = await run(fixture);
    expect(result).toEqual({ status: 'DEPOSEE_CERTIFIEE_DGI', xhubUuid: '00000000-0000-4000-8000-000000000001', displayState: 'Validation simulée' });
    expect(DgiClearanceWorkflowResultSchema.safeParse(result).success).toBe(true);
    expect(fixture.step.stepNames).toEqual(['load-invoice', 'submit-0', 'record-outcome']);
    expect(fixture.step.sleeps).toEqual([]);
    const row = await snapshotOf(fixture.db);
    expect(row).toMatchObject({ clearance_state: 'DEPOSEE_CERTIFIEE_DGI', xhub_uuid: '00000000-0000-4000-8000-000000000001', sequential_number: 'FAC-2026-000001', total_ttc_cents: 120000 });
    expect(await auditRows(fixture.db)).toEqual([
      expect.objectContaining({ from_state: 'SIGNEE_LOI_43_20', to_state: 'DEPOSEE_CERTIFIEE_DGI', actor_kind: 'DETERMINISTIC_SYSTEM', proof_ref: 'XHUB_UUID_RECEIVED' }),
    ]);
  });

  it('succès après 3 pannes transitoires : attentes 84, 168, 336 s, une seule soumission acceptée', async () => {
    const fixture = await createFixture({ script: transient(3) });
    const result = await run(fixture);
    expect(result.status).toBe('DEPOSEE_CERTIFIEE_DGI');
    expect(fixture.step.sleeps).toEqual([84_000, 168_000, 336_000]);
    expect(fixture.gateway.callCount).toBe(4);
    expect(fixture.gateway.acceptedCount).toBe(1);
    // 1 de l'allocation initiale du séquenceur + 4 essais de soumission.
    expect((await fixture.sequencer.getSeriesHead({ seriesKey: SERIES_KEY }))?.submissionAttemptCounter).toBe(5);
  });

  it('8 pannes puis succès au 9e essai (8 réessais exactement)', async () => {
    const fixture = await createFixture({ script: transient(8) });
    expect((await run(fixture)).status).toBe('DEPOSEE_CERTIFIEE_DGI');
    expect(fixture.step.sleeps).toEqual(computeClearanceBackoffSchedule().map((s) => s * 1000));
    expect(fixture.gateway.callCount).toBe(9);
  });
});

describe('DgiClearanceWorkflow : échecs', () => {
  it('pannes persistantes : échec définitif après 8 réessais sur ≤ 6 h, facture et numéro intacts, aucun numéro libéré ni réutilisé', async () => {
    const fixture = await createFixture({ script: transient(20) });
    const headBefore = await fixture.sequencer.getSeriesHead({ seriesKey: SERIES_KEY });
    const result = await run(fixture);
    expect(result).toEqual({ status: 'CLEARANCE_EXHAUSTED', displayState: 'Validation simulée' });
    expect(fixture.step.sleeps).toEqual(computeClearanceBackoffSchedule().map((s) => s * 1000));
    expect(fixture.step.elapsedMs).toBeLessThanOrEqual(21_600_000);
    expect(fixture.gateway.callCount).toBe(9);
    expect(fixture.gateway.acceptedCount).toBe(0);

    const row = await snapshotOf(fixture.db);
    expect(row).toMatchObject({ clearance_state: 'SIGNEE_LOI_43_20', xhub_uuid: null, sequential_number: 'FAC-2026-000001' });
    const audit = await auditRows(fixture.db);
    expect(audit).toEqual([expect.objectContaining({ from_state: 'SIGNEE_LOI_43_20', to_state: 'SIGNEE_LOI_43_20', proof_ref: 'CLEARANCE_RETRIES_EXHAUSTED' })]);

    const headAfter = await fixture.sequencer.getSeriesHead({ seriesKey: SERIES_KEY });
    expect(headAfter?.lastNumber).toBe(headBefore?.lastNumber);
    expect(headAfter?.lastInvoiceHash).toBe(headBefore?.lastInvoiceHash);
    expect(headAfter?.submissionAttemptCounter).toBe((headBefore?.submissionAttemptCounter ?? 0) + 9);
    expect(await fixture.sequencer.verifyChain({ seriesKey: SERIES_KEY })).toMatchObject({ ok: true, length: 1 });
    const count = await fixture.db.query<{ n: number }>({ sql: 'SELECT COUNT(*) AS n FROM invoices', params: [] });
    expect(count[0]?.n).toBe(1);

    // Rejeu du dernier pas : l'événement d'échec n'est écrit qu'une fois.
    const replay = await run(fixture);
    expect(replay.status).toBe('CLEARANCE_EXHAUSTED');
    expect((await auditRows(fixture.db)).length).toBe(1);
  });

  it('rejet permanent : immédiat, aucun réessai, REJETEE_XHUB, numéro et hash conservés', async () => {
    const fixture = await createFixture({ script: [{ kind: 'reject', code: 'REJ_METIER' }] });
    const result = await run(fixture);
    expect(result).toEqual({ status: 'REJETEE_XHUB', code: 'REJ_METIER', displayState: 'Validation simulée' });
    expect(fixture.step.sleeps).toEqual([]);
    expect(fixture.gateway.callCount).toBe(1);
    expect(await snapshotOf(fixture.db)).toMatchObject({ clearance_state: 'REJETEE_XHUB', sequential_number: 'FAC-2026-000001' });
    expect((await auditRows(fixture.db))[0]).toMatchObject({ to_state: 'REJETEE_XHUB', proof_ref: 'XHUB_REJECT:REJ_METIER' });
  });

  it('XML dont le SHA-256 diffère du payload : ABORTED, aucune soumission, rien d\'écrit', async () => {
    const fixture = await createFixture();
    const result = await run(fixture, { xmlSha256: 'f'.repeat(64) });
    expect(result).toEqual({ status: 'ABORTED', code: 'CLEARANCE_XML_DIGEST_MISMATCH' });
    expect(fixture.gateway.callCount).toBe(0);
    expect(await auditRows(fixture.db)).toEqual([]);
  });

  it('facture non signée ou inconnue : ABORTED, état inchangé', async () => {
    const unsigned = await createFixture({ clearanceState: 'NUMEROTEE_VERROUILLEE' });
    expect(await run(unsigned)).toEqual({ status: 'ABORTED', code: 'CLEARANCE_INVOICE_NOT_SIGNED' });
    expect((await snapshotOf(unsigned.db)).clearance_state).toBe('NUMEROTEE_VERROUILLEE');
    const unknown = await createFixture();
    expect(await run(unknown, { invoiceId: 'inconnue' })).toEqual({ status: 'ABORTED', code: 'CLEARANCE_INVOICE_NOT_FOUND' });
  });

  it('société du payload différente de la base résolue : ABORTED (isolation par société)', async () => {
    const fixture = await createFixture();
    expect(await run(fixture, { companyId: 'autre-societe' })).toEqual({ status: 'ABORTED', code: 'CLEARANCE_INVOICE_NOT_FOUND' });
    expect(fixture.gateway.callCount).toBe(0);
  });
});

describe('DgiClearanceWorkflow : idempotence', () => {
  it('relancer le workflow sur une facture déposée ne crée pas de seconde soumission', async () => {
    const fixture = await createFixture();
    await run(fixture);
    const second = await run(fixture);
    expect(second.status).toBe('DEPOSEE_CERTIFIEE_DGI');
    expect(fixture.gateway.callCount).toBe(1);
    expect(fixture.gateway.acceptedCount).toBe(1);
    expect((await auditRows(fixture.db)).length).toBe(1);
  });

  it("relancer l'étape de soumission (clé = facture + SHA-256) rejoue la réponse mémorisée sans rappeler la passerelle", async () => {
    const fixture = await createFixture();
    const { attemptClearanceSubmission } = await import('@fisca/ubl-xades/clearance');
    const input = { invoiceId: INVOICE_ID, xmlSha256: fixture.xmlSha256 };
    const first = await attemptClearanceSubmission(fixture.ports, input);
    const again = await attemptClearanceSubmission(fixture.ports, input);
    expect(first).toMatchObject({ kind: 'CLEARED', replayed: false });
    expect(again).toMatchObject({ kind: 'CLEARED', replayed: true, xhubUuid: first.kind === 'CLEARED' ? first.xhubUuid : '' });
    expect(fixture.gateway.callCount).toBe(1);
  });

  it('reprise après interruption (clé IN_FLIGHT) : la passerelle reçoit la même clé et ne duplique pas', async () => {
    const fixture = await createFixture();
    const { attemptClearanceSubmission, clearanceIdempotencyKey } = await import('@fisca/ubl-xades/clearance');
    const input = { invoiceId: INVOICE_ID, xmlSha256: fixture.xmlSha256 };
    await fixture.ports.idempotency.reserve(clearanceIdempotencyKey(input), fixture.xmlSha256, fixture.ports.clock.nowMs());
    const outcome = await attemptClearanceSubmission(fixture.ports, input);
    expect(outcome).toMatchObject({ kind: 'CLEARED', replayed: false });
    expect(fixture.gateway.acceptedCount).toBe(1);
  });

  it("une panne transitoire libère la réservation : le réessai peut soumettre", async () => {
    const fixture = await createFixture({ script: transient(1) });
    const { attemptClearanceSubmission } = await import('@fisca/ubl-xades/clearance');
    const input = { invoiceId: INVOICE_ID, xmlSha256: fixture.xmlSha256 };
    expect(await attemptClearanceSubmission(fixture.ports, input)).toEqual({ kind: 'TRANSIENT', code: 'HTTP_503' });
    expect(await attemptClearanceSubmission(fixture.ports, input)).toMatchObject({ kind: 'CLEARED' });
  });
});

describe('DgiClearanceWorkflow : confidentialité et montants', () => {
  it('aucune donnée personnelle ni contenu de facture dans les résultats, audits et journaux, même si la passerelle lève une erreur libre', async () => {
    const secret = 'ICE-000970000000097-CLIENT-DUPONT';
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'info')];
    const fixture = await createFixture({ xml: `<Invoice>${secret}</Invoice>` });
    const failing = { ...fixture.gateway, submit: () => Promise.reject(new Error(`échec pour ${secret}`)) };
    const ports = { ...fixture.ports, gateway: failing };
    const result = await runDgiClearanceWorkflow(() => Promise.resolve(ports), eventOf(fixture), fixture.step);
    expect(result.status).toBe('CLEARANCE_EXHAUSTED');
    const audit = await fixture.db.query({ sql: 'SELECT * FROM state_transition_audit', params: [] });
    const idem = await fixture.db.query({ sql: 'SELECT * FROM idempotency_records', params: [] });
    const dump = JSON.stringify([result, audit, idem, fixture.step.records, logs.map((l) => l.mock.calls)]);
    expect(dump).not.toContain(secret);
    expect(dump).not.toContain('DUPONT');
    const { attemptClearanceSubmission } = await import('@fisca/ubl-xades/clearance');
    const probe = await createFixture({ xml: `<Invoice>${secret}</Invoice>` });
    const outcome = await attemptClearanceSubmission({ ...probe.ports, gateway: { ...probe.gateway, submit: () => Promise.reject(new Error(`échec pour ${secret}`)) } }, { invoiceId: INVOICE_ID, xmlSha256: probe.xmlSha256 });
    expect(outcome).toEqual({ kind: 'TRANSIENT', code: 'GATEWAY_UNEXPECTED_ERROR' });
    for (const spy of logs) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it('les montants en centimes restent des entiers inchangés après clearance', async () => {
    const fixture = await createFixture();
    await run(fixture);
    const rows = await fixture.db.query<{ total_ht_cents: number; total_vat_cents: number; total_ttc_cents: number; net_payable_cents: number }>({
      sql: 'SELECT total_ht_cents, total_vat_cents, total_ttc_cents, net_payable_cents FROM invoices WHERE id = ?',
      params: [INVOICE_ID],
    });
    expect(rows[0]).toEqual({ total_ht_cents: 100000, total_vat_cents: 20000, total_ttc_cents: 120000, net_payable_cents: 120000 });
    expect(Object.values(rows[0] ?? {}).every((v) => Number.isInteger(v))).toBe(true);
  });
});

describe('contrat des événements et classe Workflow', () => {
  const valid = { invoiceId: 'inv-1', companyId: 'soc-1', xmlSha256: 'a'.repeat(64), requestedAtIso: '2026-11-13T10:00:00.000Z' };

  it('le schéma Zod est strict : champ inconnu, empreinte invalide, identifiant vide ou date non UTC refusés', () => {
    expect(DgiClearanceWorkflowPayloadSchema.safeParse(valid).success).toBe(true);
    expect(DgiClearanceWorkflowPayloadSchema.safeParse({ ...valid, tenantId: 'x' }).success).toBe(false);
    expect(DgiClearanceWorkflowPayloadSchema.safeParse({ ...valid, xmlSha256: 'A'.repeat(64) }).success).toBe(false);
    expect(DgiClearanceWorkflowPayloadSchema.safeParse({ ...valid, invoiceId: '' }).success).toBe(false);
    expect(DgiClearanceWorkflowPayloadSchema.safeParse({ ...valid, requestedAtIso: '2026-11-13 10:00' }).success).toBe(false);
    expect(DgiClearanceWorkflowPayloadSchema.safeParse({ invoiceId: valid.invoiceId, xmlSha256: valid.xmlSha256, requestedAtIso: valid.requestedAtIso }).success).toBe(false);
  });

  it('un payload invalide fait échouer l\'instance avant toute étape', async () => {
    const fixture = await createFixture();
    await expect(run(fixture, { xmlSha256: 'xyz' })).rejects.toThrow();
    expect(fixture.step.records).toEqual([]);
  });

  it('DgiClearanceWorkflow.run délègue au moteur avec les ports de la société', async () => {
    const fixture = await createFixture();
    const workflow = new DgiClearanceWorkflow({}, { resolveClearancePorts: () => Promise.resolve(fixture.ports) });
    expect(DgiClearanceWorkflow.name).toBe('DgiClearanceWorkflow');
    expect((await workflow.run(eventOf(fixture), fixture.step)).status).toBe('DEPOSEE_CERTIFIEE_DGI');
  });

  it('les étapes d\'infrastructure portent un retries exponentiel et un timeout', async () => {
    const fixture = await createFixture();
    await run(fixture);
    for (const record of fixture.step.records.filter((r) => r.kind === 'do')) {
      expect(record.config?.retries?.backoff).toBe('exponential');
      expect(record.config?.timeout).toBeDefined();
    }
  });
});
