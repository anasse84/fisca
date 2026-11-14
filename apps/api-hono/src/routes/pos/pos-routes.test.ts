import { describe, expect, it } from 'vitest';
import { posRouteContracts } from './index.ts';
import { buildPosKit, CLIENT_ICE, COMPANY_B, KEY, MAX_BATCH, TERMINAL, USER_CAISSIER, USER_COMPTA, type PosKit } from './pos-routes-test-kit.ts';

async function seeded(options: Parameters<typeof buildPosKit>[0] = {}): Promise<PosKit> {
  const kit = await buildPosKit(options);
  await kit.seedSession();
  return kit;
}
const json = async (response: Response): Promise<Record<string, unknown>> => (await response.json()) as Record<string, unknown>;

describe('POST /api/v1/pos/sync-batch (CTR-API-16)', () => {
  it('200 : lot valide, résultats par ticket, tickets écrits avec la clé de séquence du terminal', async () => {
    const kit = await seeded();
    const response = await kit.syncBatch(await kit.makeChain(3));
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toMatchObject({ terminalId: TERMINAL, accepted: 3, replayed: 0, rejected: 0 });
    const rows = await kit.rows<{ terminal_seq_number: string }>('SELECT terminal_seq_number FROM pos_tickets ORDER BY terminal_seq_number');
    expect(rows.map((r) => r.terminal_seq_number)).toEqual([`${TERMINAL}-000000001`, `${TERMINAL}-000000002`, `${TERMINAL}-000000003`]);
  });
  it('le caissier est autorisé ; un rôle sans POS_ENCASH_TICKET reçoit 403', async () => {
    const kit = await seeded();
    expect((await kit.syncBatch(await kit.makeChain(1), { user: USER_CAISSIER })).status).toBe(200);
    const denied = await kit.syncBatch(await kit.makeChain(1, 2), { user: USER_COMPTA });
    expect(denied.status).toBe(403);
    expect((await json(denied))['errorCode']).toMatch(/RBAC|FORBIDDEN|DENIED/i);
  });
  it('401 sans JWT ; 403 pour une société qui n’est pas celle de l’utilisateur', async () => {
    const kit = await seeded();
    expect((await kit.syncBatch(await kit.makeChain(1), { user: null })).status).toBe(401);
    expect((await kit.syncBatch(await kit.makeChain(1), { company: COMPANY_B })).status).toBe(403);
  });
  it('terminal d’une autre société ou désactivé : 403 sans écriture', async () => {
    const other = await seeded({ terminalCompany: COMPANY_B });
    const r1 = await other.syncBatch(await other.makeChain(1));
    expect(r1.status).toBe(403);
    expect((await other.rows('SELECT id FROM pos_tickets')).length).toBe(0);
    const off = await seeded({ terminalStatus: 'DECOMMISSIONED' });
    const r2 = await off.syncBatch(await off.makeChain(1));
    expect(r2.status).toBe(403);
    expect((await json(r2))['errorCode']).toBe('POS_TERMINAL_INACTIVE');
  });
  it('207 : un ticket altéré est rejeté avec son code, le préfixe valide est conservé', async () => {
    const kit = await seeded();
    const chain = await kit.makeChain(3);
    const tampered = { ...(chain[1] as (typeof chain)[number]), totalTtcCents: 12031 };
    const response = await kit.syncBatch([chain[0], tampered, chain[2]] as typeof chain);
    expect(response.status).toBe(207);
    const body = await json(response);
    expect(body['results']).toEqual([
      { ticketId: 'tkt-1', terminalSeqNumber: 1, outcome: 'ACCEPTED' },
      { ticketId: 'tkt-2', terminalSeqNumber: 2, outcome: 'REJECTED', code: 'HASH_MISMATCH' },
      { ticketId: 'tkt-3', terminalSeqNumber: 3, outcome: 'REJECTED', code: 'PREDECESSOR_REJECTED' },
    ]);
    expect((await kit.rows('SELECT id FROM pos_tickets')).length).toBe(1);
  });
  it('409 : même identifiant avec contenu différent, ProblemDetails avec instance et issues[], rien d’écrit', async () => {
    const kit = await seeded();
    const [a, b] = await kit.makeChain(2);
    await kit.syncBatch([a as NonNullable<typeof a>]);
    const response = await kit.syncBatch([{ ...(a as NonNullable<typeof a>), paidCashCents: 5 }, b as NonNullable<typeof b>]);
    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    const body = await json(response);
    expect(body['errorCode']).toBe('POS_BATCH_CONFLICT');
    expect(body['instance']).toBe('/api/v1/pos/sync-batch');
    expect(body['issues']).toEqual([{ path: 'tickets[0]', message: 'ticket_conflict' }]);
    expect((await kit.rows('SELECT id FROM pos_tickets')).length).toBe(1);
  });
  it('idempotence : même clé et même corps rejoués, un seul jeu de lignes ; même lot avec une autre clé : REPLAYED', async () => {
    const kit = await seeded();
    const chain = await kit.makeChain(2);
    const key = kit.key();
    const first = await kit.syncBatch(chain, { key });
    const replay = await kit.syncBatch(chain, { key });
    expect(first.status).toBe(200);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    const second = await json(await kit.syncBatch(chain));
    expect(second).toMatchObject({ accepted: 0, replayed: 2, rejected: 0 });
    expect((await kit.rows('SELECT id FROM pos_tickets')).length).toBe(2);
  });
  it('400 : Idempotency-Key absente, corps hors contrat (clé inconnue, lot vide, trop long, flottant)', async () => {
    const kit = await seeded();
    const chain = await kit.makeChain(MAX_BATCH + 1);
    expect((await kit.syncBatch(chain.slice(0, 1), { key: null })).status).toBe(400);
    expect((await kit.syncBatch([])).status).toBe(400);
    expect((await kit.syncBatch(chain)).status).toBe(400);
    expect((await kit.syncBatch([], { rawBody: JSON.stringify({ terminalId: TERMINAL, tickets: [], extra: 1 }) })).status).toBe(400);
    expect((await kit.syncBatch([{ ...(chain[0] as NonNullable<(typeof chain)[0]>), ht20Cents: Number('1.5') }])).status).toBe(400);
    expect((await kit.rows('SELECT id FROM pos_tickets')).length).toBe(0);
  });
  it('les erreurs ne contiennent aucune donnée de ticket (hash, signature, jeton QR)', async () => {
    const kit = await seeded();
    const [a] = await kit.makeChain(1);
    const t = a as NonNullable<typeof a>;
    await kit.syncBatch([t]);
    const text = JSON.stringify(await json(await kit.syncBatch([{ ...t, paidCashCents: 9 }])));
    for (const secret of [t.ticketSha256, t.ecdsaSignatureB64, t.qrConversionToken]) expect(text).not.toContain(secret);
  });
});

describe('POST /api/v1/public/pos-qr/:qrToken/convert-b2b (CTR-API-17)', () => {
  const TOKEN = 'qr-token-0000000000000001';

  async function withTicket(sealed: boolean, options: { glEntry?: boolean } = {}): Promise<PosKit> {
    const kit = await seeded();
    expect((await kit.syncBatch(await kit.makeChain(1))).status).toBe(200);
    if (sealed) await kit.sealZ(options);
    return kit;
  }

  it('avant Z : 200 sans JWT, réponse minimale, ticket marqué, aucune extourne', async () => {
    const kit = await withTicket(false);
    const response = await kit.convert(TOKEN, { clientIce: CLIENT_ICE });
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(['certificationPending', 'conversionState', 'invoiceRef']);
    expect(body['conversionState']).toBe('CONVERTI_B2B_AVANT_Z');
    const [ticket] = await kit.rows<{ b2b_conversion_state: string; converted_invoice_id: string }>('SELECT b2b_conversion_state, converted_invoice_id FROM pos_tickets');
    expect(ticket).toMatchObject({ b2b_conversion_state: 'CONVERTI_B2B_AVANT_Z', converted_invoice_id: body['invoiceRef'] });
    expect((await kit.rows("SELECT id FROM journal_entries WHERE source_document_type = 'B2C_TO_B2B_REVERSAL'")).length).toBe(0);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('après Z : facture B2B + extourne + marquage dans UNE transaction ; TVA conservée', async () => {
    const kit = await withTicket(true);
    const response = await kit.convert(TOKEN, { clientIce: CLIENT_ICE, clientLegalName: 'Acheteur Test SA' });
    expect(response.status).toBe(200);
    expect((await json(response))['conversionState']).toBe('CONVERTI_B2B_POST_Z_NEUTRALISE');
    const lines = await kit.rows<{ account_id: string; debit_cents: number | string; credit_cents: number | string }>(
      "SELECT l.account_id, l.debit_cents, l.credit_cents FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.source_document_type = 'B2C_TO_B2B_REVERSAL'",
    );
    const vat = lines.find((l) => l.account_id === 'acc-44551000');
    expect(Number(vat?.debit_cents)).toBe(2000);
    const [invoice] = await kit.rows<{ total_vat_cents: number | string; pos_ticket_id: string }>('SELECT total_vat_cents, pos_ticket_id FROM invoices');
    expect(Number(invoice?.total_vat_cents)).toBe(2000);
    expect(invoice?.pos_ticket_id).toBe('tkt-1');
  });
  it('second scan (autre clé) : 409 ; même clé et même corps : rejeu 200 ; même clé autre corps : 409', async () => {
    const kit = await withTicket(false);
    const key = kit.key();
    const first = await kit.convert(TOKEN, { clientIce: CLIENT_ICE }, { key });
    expect(first.status).toBe(200);
    const replay = await kit.convert(TOKEN, { clientIce: CLIENT_ICE }, { key });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(await replay.json()).toEqual(await first.clone().json());
    expect((await kit.convert(TOKEN, { clientIce: '000970000000097' }, { key })).status).toBe(409);
    const again = await kit.convert(TOKEN, { clientIce: CLIENT_ICE });
    expect(again.status).toBe(409);
    expect((await json(again))['errorCode']).toBe('POS_TICKET_ALREADY_CONVERTED');
    expect((await kit.rows('SELECT id FROM invoices')).length).toBe(1);
  });
  it('404 uniforme : jeton inconnu, mal formé, hors fenêtre ; corps identique', async () => {
    const kit = await withTicket(true);
    kit.nowOverride.iso = '2026-12-14T08:00:00.000Z';
    const bodies: unknown[] = [];
    for (const token of ['qr-token-ffffffffffffffff', TOKEN, 'x', 'a'.repeat(200)]) {
      const response = await kit.convert(token, { clientIce: CLIENT_ICE });
      expect(response.status, token).toBe(404);
      const body = await json(response);
      delete body['instance'];
      delete body['traceId'];
      bodies.push(body);
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect((await kit.rows('SELECT id FROM invoices')).length).toBe(0);
  });
  it('Turnstile refusé : 403 sans résoudre le jeton ; limite de débit : 429 ; limite par jeton : 429', async () => {
    const kit = await withTicket(false);
    kit.publicGuard.turnstileOk = false;
    expect((await kit.convert(TOKEN, { clientIce: CLIENT_ICE })).status).toBe(403);
    expect(kit.publicLookups).toEqual([]);
    kit.publicGuard.turnstileOk = true;
    kit.publicGuard.rateOk = false;
    expect((await kit.convert(TOKEN, { clientIce: CLIENT_ICE })).status).toBe(429);
    kit.publicGuard.rateOk = true;
    kit.publicGuard.tokenRateOk = false;
    expect((await kit.convert(TOKEN, { clientIce: CLIENT_ICE })).status).toBe(429);
    expect(kit.publicGuard.turnstileTokens[0]).toBe('tok');
    expect((await kit.rows('SELECT id FROM invoices')).length).toBe(0);
  });
  it('validation : ICE de clé invalide 422, format 400, clé inconnue 400, Idempotency-Key absente ou non v7 400', async () => {
    const kit = await withTicket(false);
    expect((await kit.convert(TOKEN, { clientIce: '001197530853398' })).status).toBe(422);
    expect((await kit.convert(TOKEN, { clientIce: '123' })).status).toBe(400);
    expect((await kit.convert(TOKEN, { clientIce: CLIENT_ICE, tenantId: 'x' })).status).toBe(400);
    expect((await kit.convert(TOKEN, { clientIce: CLIENT_ICE }, { key: null })).status).toBe(400);
    expect((await kit.convert(TOKEN, { clientIce: CLIENT_ICE }, { key: 'abc' })).status).toBe(400);
  });
  it('Z scellé mais écriture comptable absente : 409 POS_Z_ENTRY_PENDING, rien d’écrit, clé réutilisable', async () => {
    const kit = await withTicket(true, { glEntry: false });
    const key = kit.key();
    const response = await kit.convert(TOKEN, { clientIce: CLIENT_ICE }, { key });
    expect(response.status).toBe(409);
    expect((await json(response))['errorCode']).toBe('POS_Z_ENTRY_PENDING');
    expect((await kit.rows('SELECT id FROM invoices')).length).toBe(0);
    expect((await kit.convert(TOKEN, { clientIce: CLIENT_ICE }, { key })).status).toBe(409);
  });
  it('aucune donnée personnelle (ICE, raison sociale, jeton) dans les erreurs ni dans les en-têtes', async () => {
    const kit = await withTicket(false);
    await kit.convert(TOKEN, { clientIce: CLIENT_ICE, clientLegalName: 'Societe Secrete SARL' });
    const again = await kit.convert(TOKEN, { clientIce: CLIENT_ICE, clientLegalName: 'Societe Secrete SARL' });
    const text = JSON.stringify(await json(again)) + JSON.stringify([...again.headers.entries()]);
    for (const secret of [CLIENT_ICE, 'Societe Secrete', TOKEN]) expect(text).not.toContain(secret);
    expect(JSON.stringify(kit.reports)).not.toContain(CLIENT_ICE);
  });
  it('en-têtes publics : no-store, nosniff, no-referrer', async () => {
    const kit = await withTicket(false);
    const response = await kit.convert('qr-token-ffffffffffffffff', { clientIce: CLIENT_ICE });
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('contrats de routes (registre)', () => {
  it('CTR-API-16 et CTR-API-17 : PROVISIONAL, conformité officielle non vérifiée, route publique seulement pour la conversion', () => {
    const contracts = posRouteContracts(200);
    expect(contracts.map((c) => [c.registryId, c.path, c.publicRoute, c.status])).toEqual([
      ['CTR-API-16', '/api/v1/pos/sync-batch', false, 'PROVISIONAL'],
      ['CTR-API-17', '/api/v1/public/pos-qr/:qrToken/convert-b2b', true, 'PROVISIONAL'],
    ]);
    for (const contract of contracts) expect(contract.docSectionRef).toContain('conformité officielle non vérifiée');
    expect(KEY(1)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
