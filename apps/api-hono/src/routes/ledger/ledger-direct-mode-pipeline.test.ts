/**
 * S1B point 3 : visa implicite du mode direct, de bout en bout par le pipeline COMPLET (app.request) avec la composition
 * `createPipelineDeps` : la présence d'un mandat cabinet est lue au plan de contrôle par `createSqlCpaMandatePresence`.
 */
import { describe, expect, it } from 'vitest';
import { DIRECT_MODE_IMPLICIT_VISA_ACTOR_ID, DIRECT_MODE_IMPLICIT_VISA_PROOF_PREFIX } from '../../core/immutable-cgnc-ledger-engine.ts';
import { ProblemBodySchema } from '../../core/api-v1-schemas.ts';
import { CO_CLOUD, seedCpaWorld, seedMandate } from '../../core/cpa-test-support.ts';
import { COMPANY_A, USER_1, buildKit, type Kit } from './ledger-routes-test-kit.ts';

const POST = (id: string): string => `/api/v1/ledger/entries/${id}/post`;

interface AuditRow {
  readonly from_state: string;
  readonly to_state: string;
  readonly actor_kind: string;
  readonly actor_id: string;
  readonly proof_ref: string | null;
}

async function audits(kit: Kit, id: string): Promise<readonly AuditRow[]> {
  return kit.rows<AuditRow>('SELECT from_state, to_state, actor_kind, actor_id, proof_ref FROM state_transition_audit WHERE entity_id = ? ORDER BY rowid', [id]);
}

async function status(kit: Kit, id: string): Promise<string | undefined> {
  return (await kit.rows<{ status: string }>('SELECT status FROM journal_entries WHERE id = ?', [id]))[0]?.status;
}

/** Mandat cabinet ACTIVE sur le dossier du kit (graine du plan de contrôle réel du kit). */
async function activeMandateOnCompanyA(kit: Kit): Promise<void> {
  await seedCpaWorld(kit.controlDb);
  await kit.controlDb.executeBatchAtomically([
    {
      sql: `INSERT INTO tenant_databases (company_id, organization_id, ice, identifiant_fiscal, raison_sociale_fr, legal_form, vat_regime, vat_cadence, crypto_mode, d1_database_uuid, ingest_email_alias, created_at)
            VALUES (?, 'org-client', '001234567000191', '12345678', 'Atlas', 'SARL', 'ENCAISSEMENT', 'MENSUELLE', 'CLOUD_ASSISTED', 'd1-a', 'a@ingest.fisca.ma', '2026-11-13T10:00:00Z')`,
      params: [COMPANY_A],
    },
  ]);
  await seedMandate(kit.controlDb, { companyId: COMPANY_A });
  expect(CO_CLOUD).not.toBe(COMPANY_A);
}

describe('visa implicite du mode direct par le pipeline complet', () => {
  it('(i) gérant seul en DIRECT_PME, aucun mandat actif : SEAL depuis DRAFT = 200 POSTED, DEUX lignes d\'audit dont la première est le visa implicite', async () => {
    const kit = await buildKit({ orgPlanSegment: 'DIRECT_PME' });
    const id = await kit.entryAt('DRAFT');
    const response = await kit.call('POST', POST(id), { user: USER_1, body: { action: 'SEAL' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ action: 'SEAL', entryId: id, toState: 'POSTED' });
    expect(await status(kit, id)).toBe('POSTED');
    const rows = await audits(kit, id);
    expect(rows.map((r) => `${r.from_state}>${r.to_state}`)).toEqual(['DRAFT>REVISEE_CYCLE', 'REVISEE_CYCLE>POSTED']);
    expect(rows[0]).toMatchObject({ actor_kind: 'DETERMINISTIC_SYSTEM', actor_id: DIRECT_MODE_IMPLICIT_VISA_ACTOR_ID, proof_ref: `${DIRECT_MODE_IMPLICIT_VISA_PROOF_PREFIX}${USER_1}` });
    expect(rows[1]?.actor_id).toBe(USER_1);
  });

  it('(ii) même gérant, mandat cabinet ACTIVE sur le dossier : refusé 409 LEDGER_ENTRY_NOT_IN_EXPECTED_STATE sans visa du chef, DRAFT intact, aucun audit', async () => {
    const kit = await buildKit({ orgPlanSegment: 'DIRECT_PME' });
    await activeMandateOnCompanyA(kit);
    const id = await kit.entryAt('DRAFT');
    const response = await kit.call('POST', POST(id), { user: USER_1, body: { action: 'SEAL' } });
    expect(response.status).toBe(409);
    expect(ProblemBodySchema.parse(await response.json()).errorCode).toBe('LEDGER_ENTRY_NOT_IN_EXPECTED_STATE');
    expect(await status(kit, id)).toBe('DRAFT');
    expect(await audits(kit, id)).toHaveLength(0);
  });

  it('(iii-a) port de présence en panne : 503 TENANT_UNAVAILABLE (échec fermé, rien d\'écrit, pas de détail interne)', async () => {
    const kit = await buildKit({ orgPlanSegment: 'DIRECT_PME', presence: 'failing' });
    const id = await kit.entryAt('DRAFT');
    const response = await kit.call('POST', POST(id), { user: USER_1, body: { action: 'SEAL' } });
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ errorCode: 'TENANT_UNAVAILABLE' });
    expect(text).not.toContain('control-plane');
    expect(await status(kit, id)).toBe('DRAFT');
    expect(await audits(kit, id)).toHaveLength(0);
  });

  it('(iii-b) port de présence ABSENT : information inconnue = visa du chef exigé, 409, DRAFT intact', async () => {
    const kit = await buildKit({ orgPlanSegment: 'DIRECT_PME', presence: 'absent' });
    const id = await kit.entryAt('DRAFT');
    const response = await kit.call('POST', POST(id), { user: USER_1, body: { action: 'SEAL' } });
    expect(response.status).toBe(409);
    expect(ProblemBodySchema.parse(await response.json()).errorCode).toBe('LEDGER_ENTRY_NOT_IN_EXPECTED_STATE');
    expect(await status(kit, id)).toBe('DRAFT');
    expect(await audits(kit, id)).toHaveLength(0);
  });

  it('témoin : un gérant FIDUCIAIRE sans mandat ne bénéficie jamais du visa implicite (plan ≠ DIRECT_PME)', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('DRAFT');
    expect((await kit.call('POST', POST(id), { user: USER_1, body: { action: 'SEAL' } })).status).toBe(409);
    expect(await status(kit, id)).toBe('DRAFT');
  });
});
