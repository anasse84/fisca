/**
 * Mêmes scénarios de clearance sur SQLite (D1) et sur PostgreSQL 16 réel : requêtes du Workflow (audit conditionnel, UPDATE gardé par
 * l'état attendu, `totalChanges`, CAST), de l'idempotence SQL, des routes certify et cdv-response. Aucune expectation n'est affaiblie
 * pour PostgreSQL : toute divergence échoue ici. PostgreSQL est démarré par le globalSetup de api-hono (`scripts/ensure-postgres.sh`).
 */
import { FsmTransitionError } from '@fisca/shared-types';
import { applyCdvStatus, commitInvoiceTransition } from '@fisca/ubl-xades/clearance';
import { afterEach, describe, expect, it } from 'vitest';
import { LedgerBackendFactory, type BackendKind } from './backend-factory.ts';
import { auditRows, createFixture, INVOICE_ID, seedInvoice, snapshotOf } from './clearance-test-kit.ts';
import { runDgiClearanceWorkflow } from './dgi-clearance-workflow.ts';
import { buildInvoiceKit } from './invoice-routes-test-kit.ts';

const factory = new LedgerBackendFactory();
afterEach(async () => {
  await factory.closeAll();
});

describe.each(['sqlite', 'postgres'] as const)('clearance SQL sur %s', (kind: BackendKind) => {
  it('Workflow : dépôt réussi, xhub_uuid posé, audit unique, numéro intact', async () => {
    const fixture = await createFixture({ backend: await factory.open(kind) });
    const event = { payload: { invoiceId: INVOICE_ID, companyId: fixture.db.tenantId, xmlSha256: fixture.xmlSha256, requestedAtIso: '2026-11-13T10:00:00.000Z' }, timestamp: new Date('2026-11-13T10:00:00.000Z') };
    const result = await runDgiClearanceWorkflow(() => Promise.resolve(fixture.ports), event, fixture.step);
    expect(result.status).toBe('DEPOSEE_CERTIFIEE_DGI');
    expect(await snapshotOf(fixture.db)).toMatchObject({ clearance_state: 'DEPOSEE_CERTIFIEE_DGI', sequential_number: 'FAC-2026-000001', xhub_uuid: '00000000-0000-4000-8000-000000000001' });
    expect(await auditRows(fixture.db)).toEqual([expect.objectContaining({ from_state: 'SIGNEE_LOI_43_20', to_state: 'DEPOSEE_CERTIFIEE_DGI', proof_ref: 'XHUB_UUID_RECEIVED' })]);
  });

  it('Workflow : rejet permanent → REJETEE_XHUB sans toucher au numéro', async () => {
    const fixture = await createFixture({ backend: await factory.open(kind), script: [{ kind: 'reject', code: 'XHUB_REFUSED' }] });
    const event = { payload: { invoiceId: INVOICE_ID, companyId: fixture.db.tenantId, xmlSha256: fixture.xmlSha256, requestedAtIso: '2026-11-13T10:00:00.000Z' }, timestamp: new Date('2026-11-13T10:00:00.000Z') };
    expect((await runDgiClearanceWorkflow(() => Promise.resolve(fixture.ports), event, fixture.step)).status).toBe('REJETEE_XHUB');
    expect(await snapshotOf(fixture.db)).toMatchObject({ clearance_state: 'REJETEE_XHUB', sequential_number: 'FAC-2026-000001' });
  });

  it('verrou optimiste : état modifié entre-temps → FSM_CONCURRENCY_CONFLICT, ni audit ni UPDATE (totalChanges < 2)', async () => {
    const fixture = await createFixture({ backend: await factory.open(kind) });
    const audit = { id: 'a-x', entityTable: 'invoices', entityId: INVOICE_ID, fromState: 'NUMEROTEE_VERROUILLEE', toState: 'SIGNEE_LOI_43_20', actorKind: 'DETERMINISTIC_SYSTEM', actorId: 't', idempotencyKey: 'k-x', proofRef: 'p', createdAtIso: '2026-11-13T10:00:00.000Z' } as const;
    await expect(commitInvoiceTransition(fixture.db, audit, { clearanceState: 'NUMEROTEE_VERROUILLEE', cdvLifecycleStatus: 'NONE' }, { clearanceState: 'SIGNEE_LOI_43_20' })).rejects.toBeInstanceOf(FsmTransitionError);
    expect(await auditRows(fixture.db)).toEqual([]);
    expect((await snapshotOf(fixture.db)).clearance_state).toBe('SIGNEE_LOI_43_20');
  });

  it('CDV : statut appliqué, rejeu du même message sans second audit, transition invalide refusée', async () => {
    const backend = await factory.open(kind);
    const fixture = await createFixture({ backend, clearanceState: 'DEPOSEE_CERTIFIEE_DGI' });
    const ports = { db: fixture.db, clock: fixture.ports.clock, ids: fixture.ports.ids };
    const input = { invoiceId: INVOICE_ID, responseId: 'm1', status: 'PRISE_EN_CHARGE', invoiceReference: 'FAC-2026-000001', actorKind: 'EXTERNAL_WEBHOOK', actorId: 'xhub' } as const;
    expect(await applyCdvStatus(ports, input)).toMatchObject({ applied: true, to: 'PRISE_EN_CHARGE' });
    expect(await applyCdvStatus(ports, input)).toMatchObject({ applied: false });
    expect((await snapshotOf(fixture.db)).cdv_lifecycle_status).toBe('PRISE_EN_CHARGE');
    expect(await auditRows(fixture.db)).toHaveLength(1);
    await expect(applyCdvStatus(ports, { ...input, responseId: 'm2', status: 'MISE_A_DISPOSITION' })).rejects.toBeDefined();
  });

  it('idempotence SQL de soumission : réservation, complétion, rejeu, conflit d’empreinte', async () => {
    const fixture = await createFixture({ backend: await factory.open(kind) });
    const port = fixture.ports.idempotency;
    expect(await port.reserve('k1', 'f1', 1_000)).toEqual({ outcome: 'RESERVED' });
    expect(await port.reserve('k1', 'f1', 2_000)).toEqual({ outcome: 'IN_PROGRESS' });
    await port.complete('k1', 'f1', { kind: 'CLEARED', xhubUuid: 'u', receivedAt: '2026-11-13T10:00:00.000Z' });
    expect(await port.reserve('k1', 'f1', 3_000)).toEqual({ outcome: 'COMPLETED', stored: { kind: 'CLEARED', xhubUuid: 'u', receivedAt: '2026-11-13T10:00:00.000Z' } });
    expect(await port.reserve('k1', 'autre', 4_000)).toEqual({ outcome: 'CONFLICT' });
    await seedInvoice(fixture.db, { id: 'inv-2', clearanceState: 'BROUILLON', sequentialNumber: 'FAC-2026-000002' });
    expect((await snapshotOf(fixture.db, 'inv-2')).total_ttc_cents).toBe(120000);
  });

  it('routes : certify (numérotation, signature, audit) puis cdv-response, entier et colonnes de type entier', async () => {
    const kit = await buildInvoiceKit({ backend: await factory.open(kind) });
    await kit.seedInvoice(INVOICE_ID);
    expect((await kit.call('POST', `/api/v1/invoices/${INVOICE_ID}/certify`)).status).toBe(202);
    const [row] = await kit.rows<{ clearance_state: string; icv_counter: number | string; sequential_number: string }>('SELECT clearance_state, icv_counter, sequential_number FROM invoices WHERE id = ?', [INVOICE_ID]);
    expect(row?.clearance_state).toBe('SIGNEE_LOI_43_20');
    expect(Number(row?.icv_counter)).toBe(1);
    expect(row?.sequential_number).toBe('FAC-2026-000001');
    expect(await kit.rows('SELECT 1 FROM state_transition_audit WHERE entity_id = ?', [INVOICE_ID])).toHaveLength(2);
    await kit.tenantDb.executeBatchAtomically([{ sql: "UPDATE invoices SET clearance_state = 'DEPOSEE_CERTIFIEE_DGI', xhub_uuid = ? WHERE id = ?", params: ['00000000-0000-4000-8000-0000000000aa', INVOICE_ID] }]);
    expect((await kit.call('POST', `/api/v1/invoices/${INVOICE_ID}/cdv-response`, { body: { status: 'APPROUVEE' } })).status).toBe(200);
    expect((await snapshotOf(kit.tenantDb)).clearance_state).toBe('APPROUVEE');
  });
});
