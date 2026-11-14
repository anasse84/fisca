/**
 * S1B point 1 : POST /api/v1/ledger/entries/:id/visa (CTR-API-48), visa PIÈCE PAR PIÈCE (`engine.visaCycle`, DRAFT → REVISEE_CYCLE),
 * par le pipeline COMPLET sur SQLite réel. Aucune route de visa par code de cycle n'existe.
 */
import { describe, expect, it } from 'vitest';
import type { PermissionAction } from '@fisca/auth-rbac';
import { API_V1_ROUTE_CONTRACTS } from '../../core/api-v1-contracts.ts';
import { ProblemBodySchema } from '../../core/api-v1-schemas.ts';
import { COMPANY_A, KEY, L, USER_1, USER_2, USER_AIDE, USER_CHEF, USER_OEC, buildKit, grantMandate, type Kit } from './ledger-routes-test-kit.ts';

const VISA = (id: string): string => `/api/v1/ledger/entries/${id}/visa`;
const UNKNOWN_ID = '018f3b5e-7c2a-7d3e-8a1b-0000000000ff';

async function problem(response: Response, status: number): Promise<ReturnType<typeof ProblemBodySchema.parse>> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  return ProblemBodySchema.parse(await response.json());
}

async function statusOf(kit: Kit, id: string): Promise<string | undefined> {
  return (await kit.rows<{ status: string }>('SELECT status FROM journal_entries WHERE id = ?', [id]))[0]?.status;
}

async function visaAudits(kit: Kit, id: string): Promise<number> {
  const rows = await kit.rows<{ n: number }>('SELECT COUNT(*) AS n FROM state_transition_audit WHERE entity_id = ? AND to_state = ?', [id, 'REVISEE_CYCLE']);
  return Number(rows[0]?.n);
}

describe('contrat CTR-API-48', () => {
  it('POST /api/v1/ledger/entries/:id/visa, clé d\'idempotence requise, corps {} ; aucune route /ledger/cycles/:cycleCode/visa', () => {
    const contract = API_V1_ROUTE_CONTRACTS.find((c) => c.registryId === 'CTR-API-48');
    expect(contract === undefined ? null : `${contract.method.toUpperCase()} ${contract.path} ${String(contract.idempotencyKey)} ${String(contract.companyHeader)}`).toBe('POST /api/v1/ledger/entries/:id/visa true true');
    expect(API_V1_ROUTE_CONTRACTS.some((c) => c.path.includes('/cycles/'))).toBe(false);
  });
});

describe('POST /api/v1/ledger/entries/:id/visa (moteur : visaCycle, DRAFT → REVISEE_CYCLE)', () => {
  it('le chef de mission vise une pièce DRAFT : 200 {entryId, fromState, toState, replayed}, statut et audit écrits', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('DRAFT');
    const response = await kit.call('POST', VISA(id), { user: USER_CHEF });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entryId: id, fromState: 'DRAFT', toState: 'REVISEE_CYCLE', replayed: false });
    expect(await statusOf(kit, id)).toBe('REVISEE_CYCLE');
    expect(await visaAudits(kit, id)).toBe(1);
  });

  it("l'expert-comptable OEC (LEDGER_VISA_CYCLE) vise aussi ; une seule pièce à la fois : l'autre reste DRAFT", async () => {
    const kit = await buildKit();
    const first = await kit.entryAt('DRAFT');
    const second = await kit.entryAt('DRAFT', { entryDate: '2026-03-02' });
    expect((await kit.call('POST', VISA(first), { user: USER_OEC })).status).toBe(200);
    expect(await statusOf(kit, first)).toBe('REVISEE_CYCLE');
    expect(await statusOf(kit, second)).toBe('DRAFT');
  });

  it('le gérant (LEDGER_VISA_CYCLE, arbitrage du propriétaire, Loi 9-88) vise une pièce DRAFT : 200, statut et audit écrits', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('DRAFT');
    const response = await kit.call('POST', VISA(id), { user: USER_1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entryId: id, fromState: 'DRAFT', toState: 'REVISEE_CYCLE', replayed: false });
    expect(await statusOf(kit, id)).toBe('REVISEE_CYCLE');
    expect(await visaAudits(kit, id)).toBe(1);
  });

  it('400 : identifiant non UUIDv7, corps avec champ superflu, corps illisible ; pièce intacte', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('DRAFT');
    expect((await problem(await kit.call('POST', VISA('pas-un-uuid'), { user: USER_CHEF }), 400)).errorCode).toBe('REQUEST_VALIDATION_FAILED');
    expect((await problem(await kit.call('POST', VISA(id), { user: USER_CHEF, body: { cycle: 'TRESORERIE' } }), 400)).errorCode).toBe('REQUEST_VALIDATION_FAILED');
    expect((await problem(await kit.call('POST', VISA(id), { user: USER_CHEF, rawBody: '{pas du json' }), 400)).errorCode).toBe('REQUEST_BODY_INVALID');
    expect(await statusOf(kit, id)).toBe('DRAFT');
  });

  it('403 LEDGER_ACCESS_DENIED : aide-comptable et caissier (sans LEDGER_VISA_CYCLE) ; pièce intacte, aucun audit', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('DRAFT');
    for (const user of [USER_AIDE, 'user-caissier']) {
      expect((await problem(await kit.call('POST', VISA(id), { user }), 403)).errorCode).toBe('LEDGER_ACCESS_DENIED');
    }
    expect(await statusOf(kit, id)).toBe('DRAFT');
    expect(await visaAudits(kit, id)).toBe(0);
  });

  it('404 LEDGER_UNKNOWN_ENTRY : pièce inconnue', async () => {
    const kit = await buildKit();
    expect((await problem(await kit.call('POST', VISA(UNKNOWN_ID), { user: USER_CHEF }), 404)).errorCode).toBe('LEDGER_UNKNOWN_ENTRY');
  });

  it("409 : pièce pas DRAFT (IA_PROPOSITION, déjà REVISEE_CYCLE) = LEDGER_ENTRY_NOT_IN_EXPECTED_STATE ; POSTED = LEDGER_ENTRY_ALREADY_POSTED ; états intacts", async () => {
    const kit = await buildKit();
    const proposition = (
      await kit.engine.createDraft(kit.actors.aide, {
        journalId: 'jr-cai',
        fiscalYearId: 'fy-2026',
        entryDate: '2026-03-01',
        reviewCycle: 'TRESORERIE',
        sourceDocumentType: 'PAYMENT',
        initialState: 'IA_PROPOSITION',
        lines: [L('51610000', 1000, 0), L('11110000', 0, 1000)],
      })
    ).entryId;
    const revised = await kit.entryAt('REVISEE_CYCLE');
    const posted = await kit.entryAt('POSTED');
    expect((await problem(await kit.call('POST', VISA(proposition), { user: USER_CHEF }), 409)).errorCode).toBe('LEDGER_ENTRY_NOT_IN_EXPECTED_STATE');
    expect((await problem(await kit.call('POST', VISA(revised), { user: USER_CHEF }), 409)).errorCode).toBe('LEDGER_ENTRY_NOT_IN_EXPECTED_STATE');
    expect((await problem(await kit.call('POST', VISA(posted), { user: USER_CHEF }), 409)).errorCode).toBe('LEDGER_ENTRY_ALREADY_POSTED');
    expect(await statusOf(kit, proposition)).toBe('IA_PROPOSITION');
    expect(await statusOf(kit, revised)).toBe('REVISEE_CYCLE');
    expect(await statusOf(kit, posted)).toBe('POSTED');
  });

  it('idempotence : sans clé 400 ; même clé = réponse mémorisée (Idempotent-Replayed), une seule transition ; même clé autre pièce 422', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('DRAFT');
    expect((await problem(await kit.call('POST', VISA(id), { user: USER_CHEF, key: null }), 400)).errorCode).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const key = KEY(0xe48);
    const first = await kit.call('POST', VISA(id), { user: USER_CHEF, key });
    const firstBody: unknown = await first.json();
    const replay = await kit.call('POST', VISA(id), { user: USER_CHEF, key });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await replay.json()).toEqual(firstBody);
    expect(await visaAudits(kit, id)).toBe(1);
    const other = await kit.entryAt('DRAFT', { entryDate: '2026-03-03' });
    expect((await problem(await kit.call('POST', VISA(other), { user: USER_CHEF, key }), 422)).errorCode).toBe('LEDGER_IDEMPOTENCY_KEY_REUSED');
    expect(await statusOf(kit, other)).toBe('DRAFT');
  });

  it('plafond de mandat : sans LEDGER_VISA_CYCLE dans le plafond 403 (pièce intacte) ; avec, 200', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('DRAFT');
    grantMandate(kit.mandates, USER_2, COMPANY_A, 'CHEF_MISSION', { permissionCeiling: new Set<PermissionAction>(['LEDGER_SAVE_DRAFT']) });
    expect((await problem(await kit.call('POST', VISA(id), { user: USER_2 }), 403)).errorCode).toBe('LEDGER_ACCESS_DENIED');
    expect(await statusOf(kit, id)).toBe('DRAFT');
    grantMandate(kit.mandates, USER_2, COMPANY_A, 'CHEF_MISSION', { permissionCeiling: new Set<PermissionAction>(['LEDGER_VISA_CYCLE']) });
    expect((await kit.call('POST', VISA(id), { user: USER_2 })).status).toBe(200);
    expect(await statusOf(kit, id)).toBe('REVISEE_CYCLE');
  });

  it('pipeline : sans jeton 401, dossier étranger 403, en-tête de dossier absent 400', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('DRAFT');
    expect((await problem(await kit.call('POST', VISA(id), { user: null }), 401)).errorCode).toBe('AUTH_REQUIRED');
    expect((await problem(await kit.call('POST', VISA(id), { user: USER_CHEF, company: 'societe-b002' }), 403)).errorCode).toBe('ABAC_TENANT_OUT_OF_SCOPE');
    expect((await problem(await kit.call('POST', VISA(id), { user: USER_CHEF, company: null }), 400)).errorCode).toBe('COMPANY_ID_REQUIRED');
  });
});
