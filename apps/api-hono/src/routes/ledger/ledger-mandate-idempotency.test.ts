/**
 * T-S1B-11, décisions du pilote 2 et 5, de bout en bout par le pipeline COMPLET (`createRequestPipeline`, adaptateur
 * `createSqlIdempotencyStore` sur SQLite) :
 * - décision 2 : le plafond de permissions d'un accès par mandat est appliqué par la route de lettrage et par le moteur ;
 * - décision 5 : lettrage rejoué AVEC la même Idempotency-Key = réponse mémorisée ; SANS clé identique = 409 conservé.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { PermissionAction } from '@fisca/auth-rbac';
import { ProblemBodySchema } from '../../core/api-v1-schemas.ts';
import { LedgerError } from '../../core/immutable-cgnc-ledger-engine.ts';
import { mandatePermissionCeiling } from '../../core/mandate-resolver.ts';
import { COMPANY_A, KEY, L, SALE_INVOICE_LINES, USER_2, buildKit, closeKitPostgres, grantMandate, type Kit } from './ledger-routes-test-kit.ts';

const RECONCILE = '/api/v1/banking/reconcile';

async function bank(kit: Kit, id: string, amountCents: number): Promise<void> {
  await kit.exec(
    `INSERT INTO bank_transactions (id, bank_code, statement_date, value_date, raw_label_enc, reference_code, amount_cents) VALUES (?, 'BMCE', '2026-04-20', '2026-04-20', 'enc', NULL, ?)`,
    [id, amountCents],
  );
}

async function invoice(kit: Kit): Promise<string> {
  return kit.entryAt('POSTED', { journalId: 'jr-vte', sourceDocumentType: 'INVOICE', reviewCycle: 'VENTES', entryDate: '2026-04-01', lines: SALE_INVOICE_LINES });
}

const reconcileBody = (bankTransactionId: string, invoiceEntryId: string) => ({
  bankTransactionId,
  journalId: 'jr-od',
  fiscalYearId: 'fy-2026',
  entryDate: '2026-04-20',
  paymentMethodCode: '30_VIREMENT',
  candidates: [{ invoiceEntryId, settledBeforeCents: 0 }],
});

afterAll(async () => {
  await closeKitPostgres();
});

describe.each(['sqlite', 'postgres'] as const)('décision 5 : lettrage et Idempotency-Key (pipeline complet, store SQL) sur %s', (backend) => {
  it('même clé : la 2e réponse EST la mémorisée (statut, corps, Idempotent-Replayed: true), un seul brouillon VAT_CLEARING, un seul lettrage ; clé différente : 409', async () => {
    const kit = await buildKit({ backend });
    const inv = await invoice(kit);
    await bank(kit, 'bk-idem', 87500);
    const key = KEY(0xabc);
    const first = await kit.call('POST', RECONCILE, { user: 'user-aide', key, body: reconcileBody('bk-idem', inv) });
    expect(first.status).toBe(201);
    expect(first.headers.get('Idempotent-Replayed')).toBeNull();
    const firstBody: unknown = await first.json();

    const replay = await kit.call('POST', RECONCILE, { user: 'user-aide', key, body: reconcileBody('bk-idem', inv) });
    expect(replay.status).toBe(first.status);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await replay.json()).toEqual(firstBody);

    expect(await kit.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM journal_entries WHERE source_document_type = 'VAT_CLEARING'`)).toEqual([{ n: 1 }]);
    expect(await kit.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM bank_transactions WHERE reconciliation_state = 'MATCHED_FULL'`)).toEqual([{ n: 1 }]);
    const { reconciliationCode } = z.object({ reconciliationCode: z.string() }).parse(firstBody);
    expect(await kit.rows<{ n: number }>('SELECT COUNT(DISTINCT reconciliation_code) AS n FROM journal_entry_lines WHERE reconciliation_code IS NOT NULL')).toEqual([{ n: 1 }]);
    expect(await kit.rows<{ reconciliation_code: string }>('SELECT reconciliation_code FROM bank_transactions WHERE id = ?', ['bk-idem'])).toEqual([{ reconciliation_code: reconciliationCode }]);

    const other = await kit.call('POST', RECONCILE, { user: 'user-aide', key: KEY(0xabd), body: reconcileBody('bk-idem', inv) });
    expect(other.status).toBe(409);
    expect(other.headers.get('Idempotent-Replayed')).toBeNull();
    expect(ProblemBodySchema.parse(await other.json()).errorCode).toBe('BANK_TRANSACTION_ALREADY_RECONCILED');
    expect(await kit.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM journal_entries WHERE source_document_type = 'VAT_CLEARING'`)).toEqual([{ n: 1 }]);
  });
});

describe('décision 2 : le plafond de permissions est appliqué par la route et par le moteur', () => {
  it('route de lettrage (LEDGER_SAVE_DRAFT) : plafond sans cette action = 403 LEDGER_ACCESS_DENIED, rien écrit ; plafond d\'intersection CHEF x AIDE (la contient) = 201', async () => {
    const kit = await buildKit();
    const inv = await invoice(kit);
    await bank(kit, 'bk-cap', 87500);
    const without = new Set<PermissionAction>(['INVOICE_CREATE_DRAFT']);
    grantMandate(kit.mandates, USER_2, COMPANY_A, 'AIDE_COMPTABLE', { permissionCeiling: without });
    const denied = await kit.call('POST', RECONCILE, { user: USER_2, body: reconcileBody('bk-cap', inv) });
    expect(denied.status).toBe(403);
    expect(ProblemBodySchema.parse(await denied.json()).errorCode).toBe('LEDGER_ACCESS_DENIED');
    expect(await kit.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM journal_entries WHERE source_document_type = 'VAT_CLEARING'`)).toEqual([{ n: 0 }]);

    grantMandate(kit.mandates, USER_2, COMPANY_A, 'AIDE_COMPTABLE', { permissionCeiling: mandatePermissionCeiling('CHEF_MISSION', 'AIDE_COMPTABLE') });
    const ok = await kit.call('POST', RECONCILE, { user: USER_2, body: reconcileBody('bk-cap', inv) });
    expect(ok.status).toBe(201);
  });

  it('moteur : un acteur dont le plafond exclut LEDGER_SAVE_DRAFT ne crée aucun brouillon (LEDGER_ACCESS_DENIED), même avec un rôle qui l\'autorise ; sans plafond, inchangé', async () => {
    const kit = await buildKit();
    const input = { journalId: 'jr-cai', fiscalYearId: 'fy-2026', entryDate: '2026-03-01', reviewCycle: 'TRESORERIE', sourceDocumentType: 'PAYMENT', initialState: 'DRAFT', lines: [L('51610000', 100, 0), L('11110000', 0, 100)] } as const;
    const capped = { ...kit.actors.aide, permissionCeiling: new Set<PermissionAction>(['INVOICE_CREATE_DRAFT']) };
    await expect(kit.engine.createDraft(capped, input)).rejects.toBeInstanceOf(LedgerError);
    await expect(kit.engine.createDraft(capped, input)).rejects.toMatchObject({ code: 'LEDGER_ACCESS_DENIED', denialCode: 'RBAC_FORBIDDEN_FOR_AIDE_COMPTABLE' });
    await expect(kit.engine.createDraft({ ...kit.actors.aide, permissionCeiling: null }, input)).resolves.toBeDefined();
    await expect(kit.engine.createDraft(kit.actors.aide, input)).resolves.toBeDefined();
  });
});
