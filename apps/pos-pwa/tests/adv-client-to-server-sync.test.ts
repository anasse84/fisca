import { describe, expect, it } from 'vitest';
import { closingHarness, LINES_10, LINES_20 } from './helpers-closing.ts';
import { syncPosBatch, type PosSyncTicket } from '../../../packages/ubl-xades/src/pos/index.ts';
import { directoryFor, memoryStore, RULES_2026, TERMINAL, COMPANY, type TerminalKeys } from '../../../packages/ubl-xades/tests/support/pos-kit.ts';

/** AUDIT G2 : tickets ÉMIS PAR LE CLIENT (ticket-issuer.ts, ticket_kind = SALE_B2C) → serveur (syncPosBatch). */
describe('AUDIT G2 : le serveur accepte-t-il les tickets réellement émis par le client ?', () => {
  it('3 tickets client, clé ECDSA non extractible → syncPosBatch', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const h = await closingHarness(keyPair);
    await h.issue({ lines: LINES_20, payments: { cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 } });
    await h.issue({ lines: LINES_10, payments: { cashCents: 0, cardTpeCents: 5500, deliveryAppCents: 0 } });
    await h.issue({ lines: LINES_10, payments: { cashCents: 5500, cardTpeCents: 0, deliveryAppCents: 0 } });
    const rows = await h.storage.all('SELECT * FROM pos_tickets ORDER BY rowid');
    const tickets: PosSyncTicket[] = rows.map((r) => ({
      ticketId: String(r['id']), sessionId: String(r['session_id']),
      terminalSeqNumber: Number(String(r['terminal_seq_number']).split('-').at(-1)),
      issuedAtIso: String(r['issued_at']), ticketKind: String(r['ticket_kind']) as 'SALE_B2C', originTicketId: null,
      ht20Cents: Number(r['ht_20_cents']), vat20Cents: Number(r['vat_20_cents']), ht10Cents: Number(r['ht_10_cents']), vat10Cents: Number(r['vat_10_cents']), ht0Cents: Number(r['ht_0_cents']),
      stampDutyCents: Number(r['stamp_duty_cents']), totalTtcCents: Number(r['total_ttc_cents']),
      paidCashCents: Number(r['paid_cash_cents']), paidCardTpeCents: Number(r['paid_card_tpe_cents']), paidDeliveryAppCents: Number(r['paid_delivery_app_cents']),
      qrConversionToken: ('qr-token-padding-' + String(r['qr_conversion_token'])), prevTicketSha256: String(r['prev_ticket_sha256']), ticketSha256: String(r['ticket_sha256']),
      ecdsaSignatureB64: String(r['ecdsa_signature_b64'] ?? r['signature_b64'] ?? ''),
    }));
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const keys = { publicJwk: { kty: 'EC', crv: 'P-256', x: String(jwk.x), y: String(jwk.y) } } as unknown as TerminalKeys;
    const store = memoryStore();
    const res = await syncPosBatch({ store, terminals: directoryFor(keys), vatRules: RULES_2026, clock: { nowIso: () => '2026-11-13T19:00:00.000Z' } }, { companyId: COMPANY, terminalId: TERMINAL, tickets });
    expect(res.results.map((x) => x.outcome)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
  });
});
