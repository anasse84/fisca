/**
 * Mêmes scénarios POS sur SQLite (D1) et sur PostgreSQL 16 réel, avec les migrations de db-schema : synchronisation en lots successifs,
 * triggers de `pos_tickets` / `pos_z_closures` (immutabilité, conversion monotone), conversion atomique avec défaillance injectée,
 * concurrence, et contrainte d'unicité de `reversal_of_entry_id`. Aucune expectation n'est affaiblie pour PostgreSQL.
 */
import type { SqlStatementParams, TenantSqlDriver } from '@fisca/shared-types';
import { convertPosTicketToB2b, createSqlPosConversionStore, createSqlTerminalDirectory } from '@fisca/ubl-xades/pos';
import { CONTROL_PLANE_MIGRATIONS, ensureTenantSchemaUpToDate } from '@fisca/db-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { openBareSqliteDriver } from '../../core/ledger-test-harness.ts';
import { LedgerBackendFactory, type BackendKind } from '../invoices/backend-factory.ts';
import { buildPosKit, CLIENT_ICE, TERMINAL, Z_ENTRY, type PosKit } from './pos-routes-test-kit.ts';

const factory = new LedgerBackendFactory();
afterEach(async () => {
  await factory.closeAll();
});

const TOKEN = 'qr-token-0000000000000001';

async function kitOn(kind: BackendKind): Promise<PosKit> {
  const kit = await buildPosKit({ backend: await factory.open(kind) });
  await kit.seedSession();
  return kit;
}

async function rejects(db: TenantSqlDriver, statement: SqlStatementParams): Promise<boolean> {
  try {
    await db.executeBatchAtomically([statement]);
    return false;
  } catch {
    return true;
  }
}

describe.each(['sqlite', 'postgres'] as const)('POS SQL sur %s', (kind: BackendKind) => {
  it('lots successifs : la chaîne se raccorde au dernier ticket stocké (séquences 1 à 12, ordre numérique au-delà de 9)', async () => {
    const kit = await kitOn(kind);
    const chain = await kit.makeChain(12);
    for (const slice of [chain.slice(0, 5), chain.slice(5, 10), chain.slice(10)]) {
      const response = await kit.syncBatch(slice);
      expect(response.status).toBe(200);
    }
    const rows = await kit.rows<{ terminal_seq_number: string; prev_ticket_sha256: string }>('SELECT terminal_seq_number, prev_ticket_sha256 FROM pos_tickets ORDER BY terminal_seq_number');
    expect(rows).toHaveLength(12);
    expect(rows[0]?.prev_ticket_sha256).toBe('0'.repeat(64));
    const skipped = await kit.syncBatch([await kit.makeTicket({ seq: 14, prev: (chain[11] as NonNullable<(typeof chain)[0]>).ticketSha256 })]);
    expect(skipped.status).toBe(207);
    expect(((await skipped.json()) as { results: { code: string }[] }).results[0]?.code).toBe('SEQUENCE_GAP');
  });

  it('triggers pos_tickets : modification, suppression, amorce de 45 caractères et prev non hexadécimal refusés', async () => {
    const kit = await kitOn(kind);
    await kit.syncBatch(await kit.makeChain(1));
    expect(await rejects(kit.tenantDb, { sql: 'UPDATE pos_tickets SET ht_20_cents = ht_20_cents + 1 WHERE id = ?', params: ['tkt-1'] })).toBe(true);
    expect(await rejects(kit.tenantDb, { sql: 'UPDATE pos_tickets SET ticket_sha256 = ? WHERE id = ?', params: ['f'.repeat(64), 'tkt-1'] })).toBe(true);
    expect(await rejects(kit.tenantDb, { sql: 'DELETE FROM pos_tickets WHERE id = ?', params: ['tkt-1'] })).toBe(true);
    const [t] = await kit.rows<Record<string, string | number>>('SELECT * FROM pos_tickets WHERE id = ?', ['tkt-1']);
    const insert = (id: string, seq: string, token: string, prev: string): SqlStatementParams => ({
      sql: `INSERT INTO pos_tickets (id, session_id, terminal_id, terminal_seq_number, issued_at, ticket_kind, ht_20_cents, vat_20_cents, ht_10_cents, vat_10_cents, ht_0_cents, stamp_duty_cents,
              total_ttc_cents, paid_cash_cents, paid_card_tpe_cents, paid_delivery_app_cents, qr_conversion_token, prev_ticket_sha256, ticket_sha256, ecdsa_signature_b64)
            VALUES (?, 'sess-1', ?, ?, ?, 'SALE_B2C', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?, 'sig')`,
      params: [id, TERMINAL, seq, String(t?.['issued_at']), token, prev, 'a'.repeat(64)],
    });
    expect(await rejects(kit.tenantDb, insert('x1', `${TERMINAL}-000000090`, 'qr-token-aaaaaaaaaaaaaaaa', `GENESIS_HASH_${'0'.repeat(32)}`))).toBe(true);
    expect(await rejects(kit.tenantDb, insert('x2', `${TERMINAL}-000000091`, 'qr-token-bbbbbbbbbbbbbbbb', 'Z'.repeat(64)))).toBe(true);
    expect(await rejects(kit.tenantDb, insert('x3', `${TERMINAL}-000000092`, 'qr-token-cccccccccccccccc', '0'.repeat(64)))).toBe(false);
  });

  it('triggers pos_z_closures : montants et chaîne immuables, suppression refusée, gl_journal_entry_id posé une fois', async () => {
    const kit = await kitOn(kind);
    await kit.sealZ({ glEntry: false });
    expect(await rejects(kit.tenantDb, { sql: 'UPDATE pos_z_closures SET net_b2c_ht_20_cents = 1 WHERE id = ?', params: ['z-1'] })).toBe(true);
    expect(await rejects(kit.tenantDb, { sql: 'UPDATE pos_z_closures SET prev_z_sha256 = ? WHERE id = ?', params: ['zz', 'z-1'] })).toBe(true);
    expect(await rejects(kit.tenantDb, { sql: 'DELETE FROM pos_z_closures WHERE id = ?', params: ['z-1'] })).toBe(true);
    await kit.tenantDb.executeBatchAtomically([
      { sql: `INSERT INTO journal_entries (id, fiscal_year_id, journal_id, sequence_number, entry_reference, entry_date, status, source_document_type, total_debit_cents, total_credit_cents) VALUES (?, 'fy-2026', 'jr-vte', 1, 'VTE-Z-1', '2026-11-13', 'DRAFT', 'POS_Z_CLOSURE', 12000, 12000)`, params: [Z_ENTRY] },
    ]);
    expect(await rejects(kit.tenantDb, { sql: 'UPDATE pos_z_closures SET gl_journal_entry_id = ? WHERE id = ?', params: [Z_ENTRY, 'z-1'] })).toBe(false);
    expect(await rejects(kit.tenantDb, { sql: 'UPDATE pos_z_closures SET gl_journal_entry_id = NULL WHERE id = ?', params: ['z-1'] })).toBe(true);
  });

  it('conversion monotone au niveau SQL : NONE → converti avec facture une fois, jamais deux, jamais sans facture', async () => {
    const kit = await kitOn(kind);
    await kit.syncBatch(await kit.makeChain(2));
    await kit.tenantDb.executeBatchAtomically([
      ...(await kit.conversionPorts.invoices.buildDraftStatements({
        invoiceId: 'inv-sql-1',
        clientIce: CLIENT_ICE,
        clientLegalName: null,
        nowIso: '2026-11-13T12:00:00.000Z',
        ticket: { ticketId: 'tkt-1', ticketKind: 'SALE_B2C', sessionId: 'sess-1', terminalId: TERMINAL, issuedAtIso: '2026-11-13T09:00:01.000Z', ht20Cents: 10000, vat20Cents: 2000, ht10Cents: 0, vat10Cents: 0, ht0Cents: 0, stampDutyCents: 30, totalTtcCents: 12030, conversionState: 'NONE', convertedInvoiceId: null, closure: null },
      })),
    ]);
    expect(await rejects(kit.tenantDb, { sql: "UPDATE pos_tickets SET b2b_conversion_state = 'CONVERTI_B2B_AVANT_Z' WHERE id = 'tkt-1'", params: [] })).toBe(true);
    expect(await rejects(kit.tenantDb, { sql: "UPDATE pos_tickets SET b2b_conversion_state = 'CONVERTI_B2B_AVANT_Z', converted_invoice_id = 'inv-sql-1', ht_20_cents = 1 WHERE id = 'tkt-1'", params: [] })).toBe(true);
    expect(await rejects(kit.tenantDb, { sql: "UPDATE pos_tickets SET b2b_conversion_state = 'CONVERTI_B2B_AVANT_Z', converted_invoice_id = 'inv-sql-1' WHERE id = 'tkt-1'", params: [] })).toBe(false);
    expect(await rejects(kit.tenantDb, { sql: "UPDATE pos_tickets SET b2b_conversion_state = 'CONVERTI_B2B_POST_Z_NEUTRALISE' WHERE id = 'tkt-1'", params: [] })).toBe(true);
    expect(await rejects(kit.tenantDb, { sql: "UPDATE pos_tickets SET b2b_conversion_state = 'NONE', converted_invoice_id = NULL WHERE id = 'tkt-1'", params: [] })).toBe(true);
  });

  it('UNIQUE(pos_ticket_id) : une seconde facture pour le même ticket est refusée par la base', async () => {
    const kit = await kitOn(kind);
    await kit.syncBatch(await kit.makeChain(1));
    const base = { clientIce: CLIENT_ICE, clientLegalName: null, nowIso: '2026-11-13T12:00:00.000Z', ticket: { ticketId: 'tkt-1', ticketKind: 'SALE_B2C', sessionId: 'sess-1', terminalId: TERMINAL, issuedAtIso: '2026-11-13T09:00:01.000Z', ht20Cents: 10000, vat20Cents: 2000, ht10Cents: 0, vat10Cents: 0, ht0Cents: 0, stampDutyCents: 30, totalTtcCents: 12030, conversionState: 'NONE', convertedInvoiceId: null, closure: null } } as const;
    await kit.tenantDb.executeBatchAtomically([...(await kit.conversionPorts.invoices.buildDraftStatements({ ...base, invoiceId: 'inv-a' }))]);
    expect(await rejects(kit.tenantDb, (await kit.conversionPorts.invoices.buildDraftStatements({ ...base, invoiceId: 'inv-b' }))[1] as SqlStatementParams)).toBe(true);
  });

  it('atomicité réelle : échec injecté au 2e statement, ni facture, ni extourne, ni marquage', async () => {
    const kit = await kitOn(kind);
    await kit.syncBatch(await kit.makeChain(1));
    await kit.sealZ();
    const failing: TenantSqlDriver = {
      tenantId: kit.tenantDb.tenantId,
      query: (stmt) => kit.tenantDb.query(stmt),
      executeBatchAtomically: (statements) => {
        const injected: SqlStatementParams[] = [...statements];
        injected.splice(1, 0, { sql: 'INSERT INTO table_inexistante_pos (id) VALUES (1)', params: [] });
        return kit.tenantDb.executeBatchAtomically(injected);
      },
    };
    let counter = 0;
    await expect(
      convertPosTicketToB2b(
        { store: createSqlPosConversionStore(failing), ...kit.conversionPorts, clock: { nowIso: () => '2026-11-14T08:00:00.000Z' }, ids: { newId: () => `inv-fail-${(counter += 1)}` } },
        { conversionWindowDays: 30 },
        { qrToken: TOKEN, clientIce: CLIENT_ICE, clientLegalName: null },
      ),
    ).rejects.toMatchObject({ code: 'POS_CONVERSION_FAILED' });
    expect(await kit.rows('SELECT id FROM invoices')).toHaveLength(0);
    expect(await kit.rows("SELECT id FROM journal_entries WHERE source_document_type = 'B2C_TO_B2B_REVERSAL'")).toHaveLength(0);
    expect(await kit.rows("SELECT id FROM pos_tickets WHERE b2b_conversion_state <> 'NONE'")).toHaveLength(0);
    const ok = await kit.convert(TOKEN, { clientIce: CLIENT_ICE });
    expect(ok.status).toBe(200);
  });

  it('concurrence : deux conversions simultanées du même ticket, une seule réussit', async () => {
    const kit = await kitOn(kind);
    await kit.syncBatch(await kit.makeChain(1));
    await kit.sealZ();
    const [a, b] = await Promise.all([kit.convert(TOKEN, { clientIce: CLIENT_ICE }), kit.convert(TOKEN, { clientIce: CLIENT_ICE })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await kit.rows('SELECT id FROM invoices')).toHaveLength(1);
    expect(await kit.rows("SELECT id FROM journal_entries WHERE source_document_type = 'B2C_TO_B2B_REVERSAL'")).toHaveLength(1);
  });

  it('deux tickets du même jour : deux extournes B2C_TO_B2B_REVERSAL liées à leur facture, TVA totale conservée', async () => {
    const kit = await kitOn(kind);
    await kit.syncBatch(await kit.makeChain(2));
    await kit.sealZ();
    expect((await kit.convert('qr-token-0000000000000001', { clientIce: CLIENT_ICE })).status).toBe(200);
    expect((await kit.convert('qr-token-0000000000000002', { clientIce: CLIENT_ICE })).status).toBe(200);
    const [sum] = await kit.rows<{ vat: number | string }>("SELECT SUM(l.debit_cents) AS vat FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.source_document_type = 'B2C_TO_B2B_REVERSAL' AND l.account_id = 'acc-44551000'");
    expect(Number(sum?.vat)).toBe(4000);
  });

  it('SEAM : l’index unique partiel sur reversal_of_entry_id existe (une seule contre-passation REVERSAL par pièce) ; une REVERSAL exige une cible POSTED', async () => {
    const kit = await kitOn(kind);
    await kit.sealZ();
    const definition =
      kind === 'sqlite'
        ? await kit.rows<{ def: string }>("SELECT sql AS def FROM sqlite_master WHERE type = 'index' AND name = 'uq_journal_entries_reversal_of'")
        : await kit.rows<{ def: string }>("SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'uq_journal_entries_reversal_of' AND schemaname = current_schema()");
    expect(definition[0]?.def).toMatch(/UNIQUE/i);
    expect(definition[0]?.def).toContain('reversal_of_entry_id');
    const reversal: SqlStatementParams = {
      sql: `INSERT INTO journal_entries (id, fiscal_year_id, journal_id, sequence_number, entry_reference, entry_date, status, source_document_type, reversal_of_entry_id, total_debit_cents, total_credit_cents)
            VALUES ('r1', 'fy-2026', 'jr-vte', 10, 'REV-r1', '2026-11-13', 'DRAFT', 'REVERSAL', ?, 100, 100)`,
      params: [Z_ENTRY],
    };
    expect(await rejects(kit.tenantDb, reversal)).toBe(true);
  });

  it('licence du terminal : pos_terminal_meters du plan de contrôle (SQLite) : actif, désactivé, inconnu, clé absente', async () => {
    if (kind === 'postgres') return;
    const control = openBareSqliteDriver('control-plane');
    await ensureTenantSchemaUpToDate(null, control, 'control-plane', CONTROL_PLANE_MIGRATIONS);
    await control.query({ sql: 'PRAGMA foreign_keys = OFF', params: [] });
    await control.executeBatchAtomically([
      { sql: `INSERT INTO pos_terminal_meters (terminal_id, organization_id, company_id, device_fingerprint, is_included_free, monthly_rate_ht_cents, activated_on_date, status) VALUES (?, 'org-1', 'societe-a001', 'fp', 0, 9900, '2026-11-01', 'ACTIVE')`, params: [TERMINAL] },
      { sql: `INSERT INTO pos_terminal_meters (terminal_id, organization_id, company_id, device_fingerprint, is_included_free, monthly_rate_ht_cents, activated_on_date, status) VALUES ('POS-OFF', 'org-1', 'societe-a001', 'fp2', 0, 9900, '2026-11-01', 'DECOMMISSIONED')`, params: [] },
    ]);
    const jwk = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } as const;
    const directory = createSqlTerminalDirectory(control, (id) => Promise.resolve(id === 'POS-NOKEY' ? null : { kind: 'jwk', jwk }));
    expect(await directory.find(TERMINAL)).toMatchObject({ terminalId: TERMINAL, companyId: 'societe-a001', status: 'ACTIVE' });
    expect(await directory.find('POS-OFF')).toMatchObject({ status: 'DECOMMISSIONED' });
    expect(await directory.find('POS-INCONNU')).toBeNull();
    expect(await directory.find('POS-NOKEY')).toBeNull();
  });
});
