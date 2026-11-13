/**
 * T-S1B-12 : colle des routes CTR-API-45 (POST /ledger/entries), CTR-API-46 (POST /ledger/entries/:id/submit) et CTR-API-47
 * (GET /ledger/verify-chain), par le pipeline COMPLET sur SQLite réel. La route de visa par cycle n'existe pas (voir le rapport :
 * le moteur ne vise que pièce par pièce).
 */
import { describe, expect, it } from 'vitest';
import type { PermissionAction } from '@fisca/auth-rbac';
import { ProblemBodySchema } from '../../core/api-v1-schemas.ts';
import { API_V1_ROUTE_CONTRACTS } from '../../core/api-v1-contracts.ts';
import { COMPANY_A, COMPANY_B, KEY, L, USER_2, USER_AIDE, USER_CHEF, USER_OEC, buildKit, grantMandate, type Kit } from './ledger-routes-test-kit.ts';

const ENTRIES = '/api/v1/ledger/entries';
const SUBMIT = (id: string): string => `${ENTRIES}/${id}/submit`;
const VERIFY = (query: string): string => `/api/v1/ledger/verify-chain${query}`;
const UNKNOWN_ID = '018f3b5e-7c2a-7d3e-8a1b-0000000000ff';
const HEX64 = /^[0-9a-f]{64}$/;
const NON_INTEGER = 10.5;

const draftBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  journalId: 'jr-cai',
  fiscalYearId: 'fy-2026',
  entryDate: '2026-03-01',
  reviewCycle: 'TRESORERIE',
  sourceDocumentType: 'PAYMENT',
  lines: [
    { accountNumber: '51610000', debitCents: 500000, creditCents: 0, description: 'encaissement' },
    { accountNumber: '11110000', debitCents: 0, creditCents: 500000, description: 'capital' },
  ],
  ...overrides,
});

async function problem(response: Response, status: number): Promise<ReturnType<typeof ProblemBodySchema.parse>> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  return ProblemBodySchema.parse(await response.json());
}

async function count(kit: Kit, where = '1 = 1'): Promise<number> {
  const [row] = await kit.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM journal_entries WHERE ${where}`);
  return Number(row?.n);
}

async function proposition(kit: Kit): Promise<string> {
  const created = await kit.engine.createDraft(kit.actors.aide, {
    journalId: 'jr-cai',
    fiscalYearId: 'fy-2026',
    entryDate: '2026-03-01',
    reviewCycle: 'TRESORERIE',
    sourceDocumentType: 'PAYMENT',
    initialState: 'IA_PROPOSITION',
    lines: [L('51610000', 1000, 0), L('11110000', 0, 1000)],
  });
  return created.entryId;
}

describe('contrats du registre (T-S1B-12)', () => {
  it('CTR-API-45 à 47 : méthodes et chemins exacts, écritures avec clé d\'idempotence, lecture sans', () => {
    const wanted = API_V1_ROUTE_CONTRACTS.filter((c) => ['CTR-API-45', 'CTR-API-46', 'CTR-API-47'].includes(c.registryId)).map((c) => `${c.registryId} ${c.method.toUpperCase()} ${c.path} ${String(c.idempotencyKey)}`);
    expect(wanted).toEqual([
      'CTR-API-45 POST /api/v1/ledger/entries true',
      'CTR-API-46 POST /api/v1/ledger/entries/:id/submit true',
      'CTR-API-47 GET /api/v1/ledger/verify-chain false',
    ]);
  });
});

describe('POST /api/v1/ledger/entries', () => {
  it('crée un brouillon DRAFT par le moteur : 201, référence, séquence, lignes en centimes entiers', async () => {
    const kit = await buildKit();
    const response = await kit.call('POST', ENTRIES, { user: USER_AIDE, body: draftBody() });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { entryId: string; entryReference: string; sequenceNumber: number; status: string };
    expect(body).toMatchObject({ status: 'DRAFT', sequenceNumber: 1 });
    expect(body.entryReference).not.toBe('');
    const [row] = await kit.rows<{ status: string; total_debit_cents: number; total_credit_cents: number }>('SELECT status, total_debit_cents, total_credit_cents FROM journal_entries WHERE id = ?', [body.entryId]);
    expect(row).toEqual({ status: 'DRAFT', total_debit_cents: 500000, total_credit_cents: 500000 });
    expect(await kit.rows('SELECT id FROM journal_entry_lines WHERE entry_id = ?', [body.entryId])).toHaveLength(2);
  });

  it('accepte l\'état initial IA_PROPOSITION explicite (le moteur refuse tout autre état)', async () => {
    const kit = await buildKit();
    const response = await kit.call('POST', ENTRIES, { user: USER_AIDE, body: draftBody({ initialState: 'IA_PROPOSITION' }) });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { status: string }).status).toBe('IA_PROPOSITION');
    expect((await problem(await kit.call('POST', ENTRIES, { user: USER_AIDE, body: draftBody({ initialState: 'POSTED' }) }), 400)).errorCode).toBe('REQUEST_VALIDATION_FAILED');
    expect(await count(kit, `status = 'POSTED'`)).toBe(0);
  });

  it('validation 400 avec issues[] : montant décimal, champ manquant, champ superflu, cycle inconnu, date inexistante, montant négatif, corps illisible', async () => {
    const kit = await buildKit();
    const bad: readonly Record<string, unknown>[] = [
      draftBody({ lines: [{ accountNumber: '51610000', debitCents: NON_INTEGER, creditCents: 0, description: 'x' }, { accountNumber: '11110000', debitCents: 0, creditCents: NON_INTEGER, description: 'y' }] }),
      draftBody({ journalId: undefined }),
      draftBody({ companyLabel: 'x' }),
      draftBody({ reviewCycle: 'INVENTE' }),
      draftBody({ entryDate: '2026-02-30' }),
      draftBody({ lines: [{ accountNumber: '51610000', debitCents: -5, creditCents: 0, description: 'x' }] }),
      draftBody({ lines: [] }),
    ];
    for (const body of bad) {
      const parsed = await problem(await kit.call('POST', ENTRIES, { user: USER_AIDE, body }), 400);
      expect(parsed.errorCode).toBe('REQUEST_VALIDATION_FAILED');
      expect(parsed.issues?.length ?? 0).toBeGreaterThan(0);
    }
    expect((await problem(await kit.call('POST', ENTRIES, { user: USER_AIDE, rawBody: '{pas du json' }), 400)).errorCode).toBe('REQUEST_BODY_INVALID');
    expect(await count(kit)).toBe(0);
  });

  it('erreurs du moteur mappées comme /post : déséquilibre 422, journal inconnu 404, exercice inconnu 404, type réservé REVERSAL 400', async () => {
    const kit = await buildKit();
    const unbalanced = draftBody({ lines: [{ accountNumber: '51610000', debitCents: 500000, creditCents: 0, description: 'x' }, { accountNumber: '11110000', debitCents: 0, creditCents: 400000, description: 'y' }] });
    expect((await problem(await kit.call('POST', ENTRIES, { user: USER_AIDE, body: unbalanced }), 422)).errorCode).toBe('LEDGER_UNBALANCED');
    expect((await problem(await kit.call('POST', ENTRIES, { user: USER_AIDE, body: draftBody({ journalId: 'jr-inconnu' }) }), 404)).errorCode).toBe('LEDGER_UNKNOWN_JOURNAL');
    expect((await problem(await kit.call('POST', ENTRIES, { user: USER_AIDE, body: draftBody({ fiscalYearId: 'fy-inconnu' }) }), 404)).errorCode).toBe('LEDGER_UNKNOWN_FISCAL_YEAR');
    expect((await problem(await kit.call('POST', ENTRIES, { user: USER_AIDE, body: draftBody({ sourceDocumentType: 'REVERSAL' }) }), 400)).errorCode).toBe('LEDGER_INVALID_INPUT');
    expect(await count(kit)).toBe(0);
  });

  it('refus RBAC hérité du moteur : le caissier n\'a pas LEDGER_SAVE_DRAFT, 403 LEDGER_ACCESS_DENIED, rien écrit', async () => {
    const kit = await buildKit();
    expect((await problem(await kit.call('POST', ENTRIES, { user: 'user-caissier', body: draftBody() }), 403)).errorCode).toBe('LEDGER_ACCESS_DENIED');
    expect(await count(kit)).toBe(0);
  });

  it('plafond de mandat propagé : sans LEDGER_SAVE_DRAFT dans le plafond, 403 ; avec, 201', async () => {
    const kit = await buildKit();
    grantMandate(kit.mandates, USER_2, COMPANY_A, 'AIDE_COMPTABLE', { permissionCeiling: new Set<PermissionAction>(['INVOICE_CREATE_DRAFT']) });
    expect((await problem(await kit.call('POST', ENTRIES, { user: USER_2, body: draftBody() }), 403)).errorCode).toBe('LEDGER_ACCESS_DENIED');
    expect(await count(kit)).toBe(0);
    grantMandate(kit.mandates, USER_2, COMPANY_A, 'AIDE_COMPTABLE', { permissionCeiling: new Set<PermissionAction>(['LEDGER_SAVE_DRAFT']) });
    expect((await kit.call('POST', ENTRIES, { user: USER_2, body: draftBody() })).status).toBe(201);
  });

  it('idempotence : sans clé 400, même clé = réponse mémorisée (un seul brouillon), même clé autre corps 422', async () => {
    const kit = await buildKit();
    expect((await problem(await kit.call('POST', ENTRIES, { user: USER_AIDE, key: null, body: draftBody() }), 400)).errorCode).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const key = KEY(0xe01);
    const first = await kit.call('POST', ENTRIES, { user: USER_AIDE, key, body: draftBody() });
    expect(first.status).toBe(201);
    const firstBody: unknown = await first.json();
    const replay = await kit.call('POST', ENTRIES, { user: USER_AIDE, key, body: draftBody() });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await replay.json()).toEqual(firstBody);
    expect(await count(kit)).toBe(1);
    expect((await problem(await kit.call('POST', ENTRIES, { user: USER_AIDE, key, body: draftBody({ entryDate: '2026-03-02' }) }), 422)).errorCode).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await count(kit)).toBe(1);
  });

  it('dossier étranger 403, sans jeton 401', async () => {
    const kit = await buildKit();
    expect((await problem(await kit.call('POST', ENTRIES, { user: USER_AIDE, company: COMPANY_B, body: draftBody() }), 403)).errorCode).toBe('ABAC_TENANT_OUT_OF_SCOPE');
    expect((await problem(await kit.call('POST', ENTRIES, { user: null, body: draftBody() }), 401)).errorCode).toBe('AUTH_REQUIRED');
  });
});

describe('POST /api/v1/ledger/entries/:id/submit (moteur : submitDraft, IA_PROPOSITION → DRAFT)', () => {
  it('fait passer une proposition IA en DRAFT : 200, audit de transition écrit', async () => {
    const kit = await buildKit();
    const id = await proposition(kit);
    const response = await kit.call('POST', SUBMIT(id), { user: USER_AIDE });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entryId: id, fromState: 'IA_PROPOSITION', toState: 'DRAFT', replayed: false });
    const [row] = await kit.rows<{ status: string }>('SELECT status FROM journal_entries WHERE id = ?', [id]);
    expect(row?.status).toBe('DRAFT');
    const audits = await kit.rows<{ n: number }>('SELECT COUNT(*) AS n FROM state_transition_audit WHERE entity_id = ? AND to_state = ?', [id, 'DRAFT']);
    expect(Number(audits[0]?.n)).toBe(1);
  });

  it('pièce inconnue 404, pièce déjà DRAFT 409, identifiant non UUIDv7 400, corps superflu 400', async () => {
    const kit = await buildKit();
    expect((await problem(await kit.call('POST', SUBMIT(UNKNOWN_ID), { user: USER_AIDE }), 404)).errorCode).toBe('LEDGER_UNKNOWN_ENTRY');
    const draft = await kit.entryAt('DRAFT');
    expect((await problem(await kit.call('POST', SUBMIT(draft), { user: USER_AIDE }), 409)).errorCode).toBe('LEDGER_ENTRY_NOT_IN_EXPECTED_STATE');
    expect((await problem(await kit.call('POST', SUBMIT('pas-un-uuid'), { user: USER_AIDE }), 400)).errorCode).toBe('REQUEST_VALIDATION_FAILED');
    const id = await proposition(kit);
    expect((await problem(await kit.call('POST', SUBMIT(id), { user: USER_AIDE, body: { force: true } }), 400)).errorCode).toBe('REQUEST_VALIDATION_FAILED');
    const [row] = await kit.rows<{ status: string }>('SELECT status FROM journal_entries WHERE id = ?', [id]);
    expect(row?.status).toBe('IA_PROPOSITION');
  });

  it('refus RBAC : le caissier 403, pièce intacte ; le chef de mission (LEDGER_SAVE_DRAFT) passe', async () => {
    const kit = await buildKit();
    const id = await proposition(kit);
    expect((await problem(await kit.call('POST', SUBMIT(id), { user: 'user-caissier' }), 403)).errorCode).toBe('LEDGER_ACCESS_DENIED');
    const [row] = await kit.rows<{ status: string }>('SELECT status FROM journal_entries WHERE id = ?', [id]);
    expect(row?.status).toBe('IA_PROPOSITION');
    expect((await kit.call('POST', SUBMIT(id), { user: USER_CHEF })).status).toBe(200);
  });

  it('plafond de mandat propagé : plafond sans LEDGER_SAVE_DRAFT = 403, pièce intacte', async () => {
    const kit = await buildKit();
    const id = await proposition(kit);
    grantMandate(kit.mandates, USER_2, COMPANY_A, 'AIDE_COMPTABLE', { permissionCeiling: new Set<PermissionAction>(['INVOICE_CREATE_DRAFT']) });
    expect((await problem(await kit.call('POST', SUBMIT(id), { user: USER_2 }), 403)).errorCode).toBe('LEDGER_ACCESS_DENIED');
    const [row] = await kit.rows<{ status: string }>('SELECT status FROM journal_entries WHERE id = ?', [id]);
    expect(row?.status).toBe('IA_PROPOSITION');
  });

  it('idempotence : sans clé 400 ; même clé = réponse mémorisée, une seule transition ; même clé autre pièce 422', async () => {
    const kit = await buildKit();
    const id = await proposition(kit);
    expect((await problem(await kit.call('POST', SUBMIT(id), { user: USER_AIDE, key: null }), 400)).errorCode).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const key = KEY(0xe02);
    const first = await kit.call('POST', SUBMIT(id), { user: USER_AIDE, key });
    const firstBody: unknown = await first.json();
    const replay = await kit.call('POST', SUBMIT(id), { user: USER_AIDE, key });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await replay.json()).toEqual(firstBody);
    const audits = await kit.rows<{ n: number }>('SELECT COUNT(*) AS n FROM state_transition_audit WHERE entity_id = ? AND to_state = ?', [id, 'DRAFT']);
    expect(Number(audits[0]?.n)).toBe(1);
    const other = await proposition(kit);
    // l'empreinte du pipeline ne couvre que le corps (identique ici) : c'est le moteur qui refuse la clé réutilisée pour une autre pièce
    expect((await problem(await kit.call('POST', SUBMIT(other), { user: USER_AIDE, key }), 422)).errorCode).toBe('LEDGER_IDEMPOTENCY_KEY_REUSED');
  });
});

describe('GET /api/v1/ledger/verify-chain (moteur : verifyJournalChain)', () => {
  it('chaîne intacte : valid true, longueur = pièces scellées ; journal vide : longueur 0 ; aucune Idempotency-Key requise', async () => {
    const kit = await buildKit();
    const a = await kit.entryAt('POSTED');
    const b = await kit.entryAt('POSTED', { entryDate: '2026-03-02' });
    expect(a).not.toBe(b);
    const response = await kit.call('GET', VERIFY('?journalId=jr-cai'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ journalId: 'jr-cai', valid: true, length: 2, brokenAtEntryId: null });
    const empty = await kit.call('GET', VERIFY('?journalId=jr-od'));
    expect(await empty.json()).toEqual({ journalId: 'jr-od', valid: true, length: 0, brokenAtEntryId: null });
  });

  it('chaîne altérée (ligne scellée modifiée hors moteur) : 200, valid false et pièce rompue désignée', async () => {
    const kit = await buildKit();
    const first = await kit.entryAt('POSTED');
    await kit.entryAt('POSTED', { entryDate: '2026-03-02' });
    await kit.exec('DROP TRIGGER prevent_posted_lines_mutation_update');
    await kit.exec('UPDATE journal_entry_lines SET debit_cents = debit_cents + 1 WHERE entry_id = ? AND debit_cents > 0', [first]);
    const response = await kit.call('GET', VERIFY('?journalId=jr-cai'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { journalId: string; valid: boolean; length: number; brokenAtEntryId: string | null };
    expect(body).toEqual({ journalId: 'jr-cai', valid: false, length: 1, brokenAtEntryId: first });
    expect(HEX64.test(first)).toBe(false);
  });

  it('tête de journal altérée : valid false sans pièce désignée', async () => {
    const kit = await buildKit();
    await kit.entryAt('POSTED');
    await kit.exec(`UPDATE journals SET last_sequence_number = last_sequence_number + 1 WHERE id = 'jr-cai'`);
    const body = (await (await kit.call('GET', VERIFY('?journalId=jr-cai'))).json()) as { valid: boolean; brokenAtEntryId: string | null };
    expect(body).toMatchObject({ valid: false, brokenAtEntryId: null });
  });

  it('paramètres de requête validés : journalId absent, vide, trop long, paramètre inconnu = 400 ; journal inconnu 404', async () => {
    const kit = await buildKit();
    for (const query of ['', '?journalId=', `?journalId=${'x'.repeat(65)}`, '?journalId=jr-cai&limit=5', '?journalId=jr-cai&journalId=jr-od']) {
      const parsed = await problem(await kit.call('GET', VERIFY(query)), 400);
      expect(parsed.errorCode).toBe('REQUEST_VALIDATION_FAILED');
    }
    expect((await problem(await kit.call('GET', VERIFY('?journalId=jr-inconnu')), 404)).errorCode).toBe('LEDGER_UNKNOWN_JOURNAL');
  });

  it('pipeline : sans jeton 401, dossier étranger 403, en-tête de dossier absent 400 ; tout membre du dossier lit (aucune action RBAC de lecture dans auth-rbac)', async () => {
    const kit = await buildKit();
    expect((await problem(await kit.call('GET', VERIFY('?journalId=jr-cai'), { user: null }), 401)).errorCode).toBe('AUTH_REQUIRED');
    expect((await problem(await kit.call('GET', VERIFY('?journalId=jr-cai'), { company: COMPANY_B }), 403)).errorCode).toBe('ABAC_TENANT_OUT_OF_SCOPE');
    expect((await problem(await kit.call('GET', VERIFY('?journalId=jr-cai'), { company: null }), 400)).errorCode).toBe('COMPANY_ID_REQUIRED');
    expect((await kit.call('GET', VERIFY('?journalId=jr-cai'), { user: USER_OEC })).status).toBe(200);
  });
});
