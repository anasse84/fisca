import { INVOICE_CDV_LIFECYCLE_STATUSES, INVOICE_CLEARANCE_STATES } from '@fisca/db-schema';
import { FsmTransitionError } from '@fisca/shared-types';
import {
  applyCdvStatus,
  CDV_COLUMN_VALUES,
  CDV_LIFECYCLE_FSM,
  CDV_STATUSES,
  CLEARANCE_STATES,
  ClearanceEngineError,
  parseCdvApplicationResponse,
  projectCdvStatus,
  type CdvStatus,
} from '@fisca/ubl-xades/clearance';
import { describe, expect, it } from 'vitest';
import { openSqliteBackend } from '../../core/ledger-test-harness.ts';
import { auditRows, seedInvoice, snapshotOf } from './clearance-test-kit.ts';

const clock = { nowIso: () => '2026-11-13T12:00:00.000Z', nowMs: () => Date.parse('2026-11-13T12:00:00.000Z') };
let counter = 0;
const ids = { newId: () => `audit-cdv-${(counter += 1)}` };

function cdvXml(code: string, id: string, number: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${id}</cbc:ID>
  <cbc:IssueDate>2026-11-13</cbc:IssueDate>
  <cac:DocumentResponse>
    <cac:Response><cbc:ResponseCode>${code}</cbc:ResponseCode></cac:Response>
    <cac:DocumentReference><cbc:ID>${number}</cbc:ID></cac:DocumentReference>
  </cac:DocumentResponse>
</ApplicationResponse>`;
}

describe('statuts CDV : cohérence avec le CHECK de db-schema', () => {
  it('les états de clearance_state et de cdv_lifecycle_status du moteur sont ceux des CHECK (CTR-SQL-72)', () => {
    expect([...CLEARANCE_STATES]).toEqual([...INVOICE_CLEARANCE_STATES]);
    expect([...CDV_COLUMN_VALUES]).toEqual([...INVOICE_CDV_LIFECYCLE_STATUSES]);
  });
});

describe('applyCdvStatus : base SQLite migrée', () => {
  const pairs = CDV_STATUSES.flatMap((from) => CDV_STATUSES.map((to) => [from, to] as const));
  const validPairs = new Set(CDV_LIFECYCLE_FSM.rules.flatMap((r) => r.from.map((from) => `${from}>${r.to}`)));

  async function seeded(from: CdvStatus, n: number) {
    const backend = await openSqliteBackend();
    const projection = projectCdvStatus(from);
    const id = `inv-cdv-${n}`;
    await seedInvoice(backend.driver, {
      id,
      sequentialNumber: `FAC-2026-${String(n).padStart(6, '0')}`,
      clearanceState: projection.clearanceState ?? 'DEPOSEE_CERTIFIEE_DGI',
      cdvLifecycleStatus: projection.cdvColumn ?? 'NONE',
    });
    return { db: backend.driver, id, number: `FAC-2026-${String(n).padStart(6, '0')}` };
  }

  it.each(pairs.filter(([from, to]) => validPairs.has(`${from}>${to}`) && to !== 'DEPOSEE_CERTIFIEE_DGI'))('transition valide %s -> %s : colonnes mises à jour, audit écrit', async (from, to) => {
    const { db, id, number } = await seeded(from, 1);
    const result = await applyCdvStatus({ db, clock, ids }, { invoiceId: id, responseId: 'R1', status: to as Exclude<CdvStatus, 'DEPOSEE_CERTIFIEE_DGI'>, invoiceReference: number, actorKind: 'EXTERNAL_WEBHOOK', actorId: 'xhub-cdv-webhook' });
    expect(result).toEqual({ applied: true, from, to });
    const row = await snapshotOf(db, id);
    const projection = projectCdvStatus(to);
    if (projection.clearanceState !== null) expect(row.clearance_state).toBe(projection.clearanceState);
    if (projection.cdvColumn !== null) expect(row.cdv_lifecycle_status).toBe(projection.cdvColumn);
    expect(row.sequential_number).toBe(number);
    expect(await auditRows(db, id)).toHaveLength(1);
  });

  it('chaque transition INVALIDE est refusée (FsmTransitionError) sans rien écrire', async () => {
    const invalid = pairs.filter(([from, to]) => !validPairs.has(`${from}>${to}`));
    expect(invalid.length).toBe(64 - validPairs.size);
    let n = 100;
    for (const [from, to] of invalid) {
      n += 1;
      const { db, id, number } = await seeded(from, n);
      const before = await snapshotOf(db, id);
      const attempt = applyCdvStatus(
        { db, clock, ids },
        { invoiceId: id, responseId: 'R1', status: to as Exclude<CdvStatus, 'DEPOSEE_CERTIFIEE_DGI'>, invoiceReference: number, actorKind: 'EXTERNAL_WEBHOOK', actorId: 'xhub-cdv-webhook' },
      );
      await expect(attempt, `${from} -> ${to}`).rejects.toBeInstanceOf(FsmTransitionError);
      expect(await snapshotOf(db, id)).toEqual(before);
      expect(await auditRows(db, id)).toHaveLength(0);
    }
  }, 60_000);

  it('rejeu du même message (cbc:ID) : no-op ; parcours complet DEPOSEE -> MISE -> PRISE -> APPROUVEE -> ENCAISSEE depuis des XML parsés', async () => {
    const { db, id, number } = await seeded('DEPOSEE_CERTIFIEE_DGI', 7);
    const flow = [
      ['AB', 'R1', 'MISE_A_DISPOSITION'],
      ['IP', 'R2', 'PRISE_EN_CHARGE'],
      ['AP', 'R3', 'APPROUVEE'],
      ['PD', 'R4', 'ENCAISSEE'],
    ] as const;
    for (const [code, responseId, expected] of flow) {
      const parsed = parseCdvApplicationResponse(cdvXml(code, responseId, number));
      const result = await applyCdvStatus({ db, clock, ids }, { invoiceId: id, responseId: parsed.responseId, status: parsed.status, invoiceReference: parsed.invoiceReference, actorKind: 'EXTERNAL_WEBHOOK', actorId: 'xhub-cdv-webhook' });
      expect(result.to).toBe(expected);
      expect(result.applied).toBe(true);
    }
    expect(await snapshotOf(db, id)).toMatchObject({ clearance_state: 'ENCAISSEE', cdv_lifecycle_status: 'PRISE_EN_CHARGE' });
    const replay = await applyCdvStatus({ db, clock, ids }, { invoiceId: id, responseId: 'R4', status: 'ENCAISSEE', invoiceReference: number, actorKind: 'EXTERNAL_WEBHOOK', actorId: 'xhub-cdv-webhook' });
    expect(replay.applied).toBe(false);
    expect(await auditRows(db, id)).toHaveLength(4);
  });

  it('refuse un message dont la référence ne correspond pas au numéro, ou une facture non déposée', async () => {
    const { db, id } = await seeded('DEPOSEE_CERTIFIEE_DGI', 8);
    const base = { invoiceId: id, responseId: 'R1', status: 'PRISE_EN_CHARGE', actorKind: 'EXTERNAL_WEBHOOK', actorId: 'w' } as const;
    await expect(applyCdvStatus({ db, clock, ids }, { ...base, invoiceReference: 'FAC-2026-999999' })).rejects.toMatchObject({ code: 'CDV_REFERENCE_MISMATCH' });
    const backend = await openSqliteBackend();
    await seedInvoice(backend.driver, { id: 'inv-signee', sequentialNumber: 'FAC-2026-000050', clearanceState: 'SIGNEE_LOI_43_20' });
    await expect(applyCdvStatus({ db: backend.driver, clock, ids }, { ...base, invoiceId: 'inv-signee', invoiceReference: 'FAC-2026-000050' })).rejects.toBeInstanceOf(ClearanceEngineError);
    await expect(applyCdvStatus({ db: backend.driver, clock, ids }, { ...base, invoiceId: 'inconnue', invoiceReference: 'x' })).rejects.toMatchObject({ code: 'CLEARANCE_INVOICE_NOT_FOUND' });
  });

  it("l'UPDATE conditionnel détecte un changement concurrent (FSM_CONCURRENCY_CONFLICT) sans écrire d'audit", async () => {
    const { db, id, number } = await seeded('DEPOSEE_CERTIFIEE_DGI', 9);
    const racing = {
      ...db,
      query: db.query.bind(db),
      executeBatchAtomically: async (statements: Parameters<typeof db.executeBatchAtomically>[0]) => {
        await db.executeBatchAtomically([{ sql: "UPDATE invoices SET cdv_lifecycle_status = 'MISE_A_DISPOSITION' WHERE id = ?", params: [id] }]);
        return db.executeBatchAtomically(statements);
      },
    };
    await expect(
      applyCdvStatus({ db: racing, clock, ids }, { invoiceId: id, responseId: 'R1', status: 'PRISE_EN_CHARGE', invoiceReference: number, actorKind: 'EXTERNAL_WEBHOOK', actorId: 'w' }),
    ).rejects.toMatchObject({ code: 'FSM_CONCURRENCY_CONFLICT' });
    expect(await auditRows(db, id)).toHaveLength(0);
  });
});
