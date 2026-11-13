import { describe, expect, it } from 'vitest';
import { ProblemBodySchema, HealthDeepResponseSchema } from '../../core/api-v1-schemas.ts';
import { LedgerError } from '../../core/immutable-cgnc-ledger-engine.ts';
import { testOnlyHasher } from '../../core/ledger-test-harness.ts';
import {
  COMPANY_A,
  COMPANY_B,
  COMPANY_C,
  ICE_BAD_CHECKSUM,
  ICE_OK,
  ICE_UNKNOWN,
  KEY,
  L,
  SALE_INVOICE_LINES,
  USER_AIDE,
  USER_CHEF,
  USER_OEC,
  USER_2,
  buildKit,
  grantMandate,
  type Kit,
} from './ledger-routes-test-kit.ts';

const HEX64 = /^[0-9a-f]{64}$/;
const NON_INTEGER = 10.5;

async function problem(response: Response, status: number): Promise<ReturnType<typeof ProblemBodySchema.parse>> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  const body: unknown = await response.json();
  const parsed = ProblemBodySchema.parse(body);
  return parsed;
}

const POST_PATH = (id: string): string => `/api/v1/ledger/entries/${id}/post`;

describe('pipeline complet sur les routes du socle', () => {
  const routes: readonly { readonly method: string; readonly path: string }[] = [
    { method: 'GET', path: `/api/v1/directory/ice/${ICE_OK}` },
    { method: 'POST', path: POST_PATH('018f3b5e-7c2a-7d3e-8a1b-000000000001') },
    { method: 'POST', path: '/api/v1/banking/reconcile' },
  ];

  it('refuse sans jeton : 401 problem+json avec WWW-Authenticate, pour chaque route', async () => {
    const kit = await buildKit();
    for (const route of routes) {
      const response = await kit.call(route.method, route.path, { user: null });
      expect((await problem(response, 401)).errorCode).toBe('AUTH_REQUIRED');
      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer');
    }
  });

  it("refuse un jeton invalide (signature d'une autre clé) en 401", async () => {
    const kit = await buildKit();
    const response = await kit.app.request(`/api/v1/ledger/entries/x/post`, {
      method: 'POST',
      headers: { Authorization: 'Bearer eyJhbGciOiJFZERTQSJ9.e30.AAAA', 'X-Fisca-Company-Id': COMPANY_A },
    });
    expect((await problem(response, 401)).errorCode).toBe('AUTH_REQUIRED');
  });

  it('dossier : en-tête absent 400, UUID invalide 400, dossier étranger ou inconnu 403 identique', async () => {
    const kit = await buildKit();
    const path = POST_PATH('018f3b5e-7c2a-7d3e-8a1b-000000000001');
    expect((await problem(await kit.call('POST', path, { company: null, body: { action: 'SEAL' } }), 400)).errorCode).toBe('COMPANY_ID_REQUIRED');
    expect((await problem(await kit.call('POST', path, { company: 'soc-alpha', body: { action: 'SEAL' } }), 400)).errorCode).toBe('COMPANY_ID_INVALID');
    const foreign = await problem(await kit.call('POST', path, { company: COMPANY_B, body: { action: 'SEAL' } }), 403);
    const unknown = await problem(await kit.call('POST', path, { company: COMPANY_C, body: { action: 'SEAL' } }), 403);
    expect(foreign.errorCode).toBe('ABAC_TENANT_OUT_OF_SCOPE');
    expect(unknown.errorCode).toBe(foreign.errorCode);
  });

  it('un corps qui porte companyId ou tenantId est refusé avant toute route', async () => {
    const kit = await buildKit();
    const response = await kit.call('POST', POST_PATH('018f3b5e-7c2a-7d3e-8a1b-000000000001'), { body: { action: 'SEAL', companyId: COMPANY_B } });
    expect((await problem(response, 400)).errorCode).toBe('TENANT_SELECTOR_FORBIDDEN');
  });

  it('mandat OEC : refusé sans résolveur de mandat (échec fermé), accepté avec un mandat actif', async () => {
    const closed = await buildKit({ withMandates: false });
    grantMandate(closed.mandates, USER_2, COMPANY_A);
    const entryId = await closed.entryAt('REVISEE_CYCLE');
    expect((await problem(await closed.call('POST', POST_PATH(entryId), { user: USER_2, body: { action: 'SEAL' } }), 403)).errorCode).toBe('ABAC_TENANT_OUT_OF_SCOPE');

    const open = await buildKit();
    grantMandate(open.mandates, USER_2, COMPANY_A);
    const id = await open.entryAt('REVISEE_CYCLE');
    const ok = await open.call('POST', POST_PATH(id), { user: USER_2, body: { action: 'SEAL' } });
    expect(ok.status).toBe(200);
    open.mandates.mandates.clear();
    const id2 = await open.entryAt('REVISEE_CYCLE');
    expect((await problem(await open.call('POST', POST_PATH(id2), { user: USER_2, body: { action: 'SEAL' } }), 403)).errorCode).toBe('ABAC_TENANT_OUT_OF_SCOPE');
  });

  it("idempotence : écriture sans clé 400, clé non UUIDv7 400, rejeu identique rejoué sans réécriture, corps différent 422", async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('REVISEE_CYCLE');
    expect((await problem(await kit.call('POST', POST_PATH(id), { key: null, body: { action: 'SEAL' } }), 400)).errorCode).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await problem(await kit.call('POST', POST_PATH(id), { key: 'pas-un-uuid', body: { action: 'SEAL' } }), 400)).errorCode).toBe('IDEMPOTENCY_KEY_INVALID');
    const key = kit.key();
    const first = await kit.call('POST', POST_PATH(id), { key, body: { action: 'SEAL' } });
    expect(first.status).toBe(200);
    const firstBody: unknown = await first.json();
    const replay = await kit.call('POST', POST_PATH(id), { key, body: { action: 'SEAL' } });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await replay.json()).toEqual(firstBody);
    const audits = await kit.rows<{ n: number }>('SELECT COUNT(*) AS n FROM state_transition_audit WHERE entity_id = ? AND to_state = ?', [id, 'POSTED']);
    expect(Number(audits[0]?.n)).toBe(1);
    const reused = await kit.call('POST', POST_PATH(id), { key, body: { action: 'REVERSE', entryDate: '2026-03-02', reasonText: 'motif' } });
    expect((await problem(reused, 422)).errorCode).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('GET /api/v1/directory/ice/:ice', () => {
  it('renvoie IF, RC, ADC450 et la raison sociale, sans fuite des colonnes non contractuelles', async () => {
    const kit = await buildKit();
    const response = await kit.call('GET', `/api/v1/directory/ice/${ICE_OK}`, { company: null, user: USER_AIDE });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('TP-SECRET-1');
    expect(JSON.parse(text)).toEqual({
      ice: ICE_OK,
      identifiantFiscal: '12345678',
      rcNumber: '45678',
      rcTribunal: 'Rabat',
      raisonSocialeFr: 'Société Test SARL',
      raisonSocialeAr: null,
      legalForm: 'SARL',
      shareCapitalCents: 10000000,
      addressAdc450: '12 avenue Mohammed V, Rabat',
      verifiedCount: 3,
    });
  });

  it('route hors dossier : un connecté sans aucun dossier y accède (tout connecté)', async () => {
    const kit = await buildKit();
    const response = await kit.call('GET', `/api/v1/directory/ice/${ICE_OK}`, { company: null, user: 'user-sans-dossier' });
    expect(response.status).toBe(200);
  });

  it('refuse un ICE mal formé (longueur, lettres) et une clé modulo 97 invalide, avec issues[]', async () => {
    const kit = await buildKit();
    for (const bad of ['123', 'ABCDEFGHIJKLMNO', '0000000000000970']) {
      const body = await problem(await kit.call('GET', `/api/v1/directory/ice/${bad}`, { company: null }), 400);
      expect(body.errorCode).toBe('REQUEST_VALIDATION_FAILED');
      expect(body.issues?.[0]?.path).toBe('ice');
    }
    const checksum = await problem(await kit.call('GET', `/api/v1/directory/ice/${ICE_BAD_CHECKSUM}`, { company: null }), 400);
    expect(checksum.issues?.[0]?.message).toContain('modulo 97');
  });

  it('ICE valide mais absent de l\'annuaire : 404 DIRECTORY_ICE_NOT_FOUND', async () => {
    const kit = await buildKit();
    expect((await problem(await kit.call('GET', `/api/v1/directory/ice/${ICE_UNKNOWN}`, { company: null }), 404)).errorCode).toBe('DIRECTORY_ICE_NOT_FOUND');
  });

  it('annuaire en panne : 503 générique sans détail SQL', async () => {
    const kit = await buildKit();
    await kit.controlDb.executeBatchAtomically([{ sql: 'DROP TABLE morocco_company_directory', params: [] }]);
    const response = await kit.call('GET', `/api/v1/directory/ice/${ICE_OK}`, { company: null });
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toMatchObject({ errorCode: 'DIRECTORY_UNAVAILABLE' });
    expect(text).not.toContain('morocco_company_directory');
  });
});

describe('POST /api/v1/ledger/entries/:id/post', () => {
  it('scelle une pièce REVISEE_CYCLE : POSTED, empreinte SHA-256, chaîne du journal valide (moteur sur SQLite réel)', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('REVISEE_CYCLE');
    const response = await kit.call('POST', POST_PATH(id), { body: { action: 'SEAL' } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { action: string; entryId: string; fromState: string; toState: string; replayed: boolean; entryHash: string; previousEntryHash: string };
    expect(body).toMatchObject({ action: 'SEAL', entryId: id, fromState: 'REVISEE_CYCLE', toState: 'POSTED', replayed: false });
    expect(body.entryHash).toMatch(HEX64);
    const [row] = await kit.rows<{ status: string; entry_hash: string }>('SELECT status, entry_hash FROM journal_entries WHERE id = ?', [id]);
    expect(row).toEqual({ status: 'POSTED', entry_hash: body.entryHash });
    expect(await kit.engine.verifyJournalChain('jr-cai')).toMatchObject({ valid: true, length: 1 });
    expect(testOnlyHasher).toBeDefined();
  });

  it('refuse le rôle insuffisant (aide-comptable, chef de mission) : 403 LEDGER_ACCESS_DENIED, pièce intacte', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('REVISEE_CYCLE');
    for (const user of [USER_AIDE, USER_CHEF]) {
      expect((await problem(await kit.call('POST', POST_PATH(id), { user, body: { action: 'SEAL' } }), 403)).errorCode).toBe('LEDGER_ACCESS_DENIED');
    }
    const [row] = await kit.rows<{ status: string }>('SELECT status FROM journal_entries WHERE id = ?', [id]);
    expect(row?.status).toBe('REVISEE_CYCLE');
  });

  it('refuse un Step-Up périmé (> 300 s)', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('REVISEE_CYCLE');
    const stale = await kit.jwt.issue(USER_OEC, kit.clock.currentEpochSec());
    kit.clock.advanceSeconds(301);
    // le jeton reste valide (même session) mais sa preuve MFA est ancienne
    const response = await kit.app.request(POST_PATH(id), {
      method: 'POST',
      headers: { Authorization: `Bearer ${stale}`, 'X-Fisca-Company-Id': COMPANY_A, 'Content-Type': 'application/json', 'Idempotency-Key': kit.key() },
      body: JSON.stringify({ action: 'SEAL' }),
    });
    expect((await problem(response, 403)).errorCode).toBe('LEDGER_ACCESS_DENIED');
  });

  it('pièce inconnue 404, pièce dans le mauvais état 409, identifiant non UUIDv7 400', async () => {
    const kit = await buildKit();
    expect((await problem(await kit.call('POST', POST_PATH('018f3b5e-7c2a-7d3e-8a1b-0000000000aa'), { body: { action: 'SEAL' } }), 404)).errorCode).toBe('LEDGER_UNKNOWN_ENTRY');
    const draft = await kit.entryAt('DRAFT');
    expect((await problem(await kit.call('POST', POST_PATH(draft), { body: { action: 'SEAL' } }), 409)).errorCode).toMatch(/^LEDGER_/);
    const bad = await problem(await kit.call('POST', POST_PATH('abc'), { body: { action: 'SEAL' } }), 400);
    expect(bad.issues?.[0]?.path).toBe('id');
  });

  it('corps invalide : JSON illisible 400, action inconnue 400 avec issues[], champ superflu 400', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('REVISEE_CYCLE');
    expect((await problem(await kit.call('POST', POST_PATH(id), { rawBody: '{pas du json' }), 400)).errorCode).toBe('REQUEST_BODY_INVALID');
    const unknownAction = await problem(await kit.call('POST', POST_PATH(id), { body: { action: 'DELETE' } }), 400);
    expect(unknownAction.errorCode).toBe('REQUEST_VALIDATION_FAILED');
    expect(unknownAction.issues?.length).toBeGreaterThan(0);
    expect((await problem(await kit.call('POST', POST_PATH(id), { body: { action: 'SEAL', force: true } }), 400)).errorCode).toBe('REQUEST_VALIDATION_FAILED');
    expect((await problem(await kit.call('POST', POST_PATH(id), { body: { action: 'REVERSE', entryDate: '2026-02-30', reasonText: 'motif' } }), 400)).issues?.[0]?.path).toBe('entryDate');
  });

  it('contre-passation : brouillon lié par reversal_of_entry_id, jamais de changement de statut de l\'originale ; seconde tentative 409', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('POSTED');
    const response = await kit.call('POST', POST_PATH(id), { body: { action: 'REVERSE', entryDate: '2026-03-05', reasonText: 'Erreur de compte' } });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { action: string; reversalEntryId: string; reversalOfEntryId: string; status: string };
    expect(body).toMatchObject({ action: 'REVERSE', reversalOfEntryId: id, status: 'DRAFT' });
    const [reversal] = await kit.rows<{ reversal_of_entry_id: string; source_document_type: string }>('SELECT reversal_of_entry_id, source_document_type FROM journal_entries WHERE id = ?', [body.reversalEntryId]);
    expect(reversal).toEqual({ reversal_of_entry_id: id, source_document_type: 'REVERSAL' });
    const [original] = await kit.rows<{ status: string }>('SELECT status FROM journal_entries WHERE id = ?', [id]);
    expect(original?.status).toBe('POSTED');
    expect((await problem(await kit.call('POST', POST_PATH(id), { body: { action: 'REVERSE', entryDate: '2026-03-06', reasonText: 'Encore' } }), 409)).errorCode).toBe('LEDGER_ALREADY_REVERSED');
  });

  it('refuse un montant décimal injecté dans un corps (aucun flottant sur le réseau)', async () => {
    const kit = await buildKit();
    const response = await kit.call('POST', '/api/v1/banking/reconcile', { user: USER_AIDE, body: { bankTransactionId: 'b1', journalId: 'jr-od', fiscalYearId: 'fy-2026', entryDate: '2026-04-20', paymentMethodCode: '30_VIREMENT', candidates: [{ invoiceEntryId: '018f3b5e-7c2a-7d3e-8a1b-0000000000aa', settledBeforeCents: NON_INTEGER }] } });
    expect((await problem(response, 400)).issues?.[0]?.path).toBe('candidates.0.settledBeforeCents');
  });

  it('une erreur interne ne fuit rien : 500 constant et rapport sans message', async () => {
    const kit = await buildKit();
    const id = await kit.entryAt('REVISEE_CYCLE');
    await kit.exec('DROP TABLE state_transition_audit');
    const response = await kit.call('POST', POST_PATH(id), { body: { action: 'SEAL' } });
    const text = await response.text();
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(text).not.toContain('state_transition_audit');
    expect(LedgerError).toBeDefined();
  });
});

describe('POST /api/v1/banking/reconcile', () => {
  async function invoice(kit: Kit, lines = SALE_INVOICE_LINES): Promise<string> {
    return kit.entryAt('POSTED', { journalId: 'jr-vte', sourceDocumentType: 'INVOICE', reviewCycle: 'VENTES', entryDate: '2026-04-01', lines });
  }
  async function bank(kit: Kit, id: string, amountCents: number): Promise<void> {
    await kit.exec(
      `INSERT INTO bank_transactions (id, bank_code, statement_date, value_date, raw_label_enc, reference_code, amount_cents) VALUES (?, 'BMCE', '2026-04-20', '2026-04-20', 'enc', NULL, ?)`,
      [id, amountCents],
    );
  }
  const request = (bankTransactionId: string, candidates: { invoiceEntryId: string; settledBeforeCents: number }[]) => ({
    bankTransactionId,
    journalId: 'jr-od',
    fiscalYearId: 'fy-2026',
    entryDate: '2026-04-20',
    paymentMethodCode: '30_VIREMENT',
    candidates,
  });

  it('lettrage exact : brouillon VAT_CLEARING par le moteur, banque MATCHED_FULL avec code de lettrage', async () => {
    const kit = await buildKit();
    const inv = await invoice(kit);
    await bank(kit, 'bk-1', 87500);
    const response = await kit.call('POST', '/api/v1/banking/reconcile', { user: USER_AIDE, body: request('bk-1', [{ invoiceEntryId: inv, settledBeforeCents: 0 }]) });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { outcome: string; clearingEntryId: string; clearedCents: number; reconciliationCode: string; invoiceEntryId: string };
    expect(body).toMatchObject({ outcome: 'MATCHED_FULL', invoiceEntryId: inv, clearedCents: 12500 });
    const [clearing] = await kit.rows<{ source_document_type: string; status: string }>('SELECT source_document_type, status FROM journal_entries WHERE id = ?', [body.clearingEntryId]);
    expect(clearing).toEqual({ source_document_type: 'VAT_CLEARING', status: 'DRAFT' });
    const [tx] = await kit.rows<{ reconciliation_state: string; reconciliation_code: string }>('SELECT reconciliation_state, reconciliation_code FROM bank_transactions WHERE id = ?', ['bk-1']);
    expect(tx).toEqual({ reconciliation_state: 'MATCHED_FULL', reconciliation_code: body.reconciliationCode });
  });

  it('deux factures de même montant sans référence distinctive : SUSPENS_AMBIGU_3497_4497, aucun lettrage automatique', async () => {
    const kit = await buildKit();
    const a = await invoice(kit);
    const b = await invoice(kit);
    await bank(kit, 'bk-2', 87500);
    const before = await kit.rows<{ n: number }>('SELECT COUNT(*) AS n FROM journal_entries');
    const response = await kit.call('POST', '/api/v1/banking/reconcile', { user: USER_AIDE, body: request('bk-2', [{ invoiceEntryId: a, settledBeforeCents: 0 }, { invoiceEntryId: b, settledBeforeCents: 0 }]) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: 'SUSPENS_AMBIGU_3497_4497', candidateCount: 2 });
    const [tx] = await kit.rows<{ reconciliation_state: string; gl_entry_id: string | null }>('SELECT reconciliation_state, gl_entry_id FROM bank_transactions WHERE id = ?', ['bk-2']);
    expect(tx).toEqual({ reconciliation_state: 'SUSPENS_AMBIGU_3497_4497', gl_entry_id: null });
    expect(await kit.rows('SELECT COUNT(*) AS n FROM journal_entries')).toEqual(before);
  });

  it('règlement partiel d\'une facture désignée seule : MATCHED_PARTIAL', async () => {
    const kit = await buildKit();
    const inv = await invoice(kit);
    await bank(kit, 'bk-3', 35000);
    const response = await kit.call('POST', '/api/v1/banking/reconcile', { user: USER_AIDE, body: request('bk-3', [{ invoiceEntryId: inv, settledBeforeCents: 0 }]) });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ outcome: 'MATCHED_PARTIAL', clearedCents: 5000 });
  });

  it('aucun candidat au bon montant parmi plusieurs : NO_MATCH, rien n\'est écrit', async () => {
    const kit = await buildKit();
    const a = await invoice(kit);
    const b = await invoice(kit);
    await bank(kit, 'bk-4', 12345);
    const response = await kit.call('POST', '/api/v1/banking/reconcile', { user: USER_AIDE, body: request('bk-4', [{ invoiceEntryId: a, settledBeforeCents: 0 }, { invoiceEntryId: b, settledBeforeCents: 0 }]) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'NO_MATCH', bankTransactionId: 'bk-4' });
    const [tx] = await kit.rows<{ reconciliation_state: string }>('SELECT reconciliation_state FROM bank_transactions WHERE id = ?', ['bk-4']);
    expect(tx?.reconciliation_state).toBe('UNMATCHED');
  });

  it('ligne bancaire inconnue 404, déjà lettrée 409, facture inconnue 404, rôle sans droit de brouillon 403', async () => {
    const kit = await buildKit();
    const inv = await invoice(kit);
    expect((await problem(await kit.call('POST', '/api/v1/banking/reconcile', { user: USER_AIDE, body: request('absent', [{ invoiceEntryId: inv, settledBeforeCents: 0 }]) }), 404)).errorCode).toBe('BANK_TRANSACTION_NOT_FOUND');
    await bank(kit, 'bk-5', 87500);
    const first = await kit.call('POST', '/api/v1/banking/reconcile', { user: USER_AIDE, body: request('bk-5', [{ invoiceEntryId: inv, settledBeforeCents: 0 }]) });
    expect(first.status).toBe(201);
    expect((await problem(await kit.call('POST', '/api/v1/banking/reconcile', { user: USER_AIDE, body: request('bk-5', [{ invoiceEntryId: inv, settledBeforeCents: 0 }]) }), 409)).errorCode).toBe('BANK_TRANSACTION_ALREADY_RECONCILED');
    await bank(kit, 'bk-6', 87500);
    expect((await problem(await kit.call('POST', '/api/v1/banking/reconcile', { user: USER_AIDE, body: request('bk-6', [{ invoiceEntryId: '018f3b5e-7c2a-7d3e-8a1b-0000000000aa', settledBeforeCents: 0 }]) }), 404)).errorCode).toBe('LEDGER_UNKNOWN_ENTRY');
    await kit.exec('UPDATE bank_transactions SET reconciliation_state = ? WHERE id = ?', ['UNMATCHED', 'bk-6']);
    const caissier = await kit.call('POST', '/api/v1/banking/reconcile', { user: 'user-caissier', body: request('bk-6', [{ invoiceEntryId: inv, settledBeforeCents: 0 }]) });
    expect(caissier.status).toBe(403);
  });
});

describe('GET /api/v1/health/deep', () => {
  it('public, sans jeton : 200 et états des deux dépendances sans détail', async () => {
    const kit = await buildKit();
    const response = await kit.app.request('/api/v1/health/deep');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = HealthDeepResponseSchema.parse(await response.json());
    expect(body.status).toBe('UP');
    expect(body.dependencies.map((d) => d.name)).toEqual(['control_plane_db', 'legal_vault']);
    expect(body.dependencies.every((d) => d.status === 'UP')).toBe(true);
  });

  it('dépendance en panne : 503, statut DOWN pour elle seule, aucun message ni nom de ressource', async () => {
    const kit = await buildKit();
    kit.probes.controlPlaneFails = true;
    kit.probes.vaultFails = true;
    const response = await kit.app.request('/api/v1/health/deep');
    const text = await response.text();
    expect(response.status).toBe(503);
    for (const leak of ['10.1.2.3', 'hunter2', 'AKIA123', 'fisca-legal-vault-prod', 'ECONNREFUSED']) {
      expect(text).not.toContain(leak);
    }
    const body = HealthDeepResponseSchema.parse(JSON.parse(text));
    expect(body.status).toBe('DOWN');
    expect(body.dependencies.map((d) => d.status)).toEqual(['DOWN', 'DOWN']);
    expect(kit.reports).toEqual([]);
  });

  it('seul le coffre en panne : le plan de contrôle reste UP', async () => {
    const kit = await buildKit();
    kit.probes.vaultFails = true;
    const body = HealthDeepResponseSchema.parse(await (await kit.app.request('/api/v1/health/deep')).json());
    expect(body.dependencies.map((d) => d.status)).toEqual(['UP', 'DOWN']);
  });

  it('une sonde qui ne répond pas est coupée au délai : DOWN, 503', async () => {
    const kit = await buildKit();
    kit.probes.vaultHangs = true;
    const response = await kit.app.request('/api/v1/health/deep');
    expect(response.status).toBe(503);
  });
});

describe('contrat des clés', () => {
  it('KEY produit des UUIDv7', () => {
    expect(KEY(1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(L('1', 1, 0).accountNumber).toBe('1');
  });
});
