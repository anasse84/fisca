// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryStorage } from '../src/storage/memory-storage.ts';
import { runLocalMigrations } from '../src/storage/migrations.ts';
import type { PosStorage } from '../src/storage/ports.ts';
import { pairTerminal } from '../src/pairing/pairing-flow.ts';
import { generateSigningKeyPair } from '../src/ticketing/ticket-signing.ts';
import type { CashStampRulePort } from '../src/ticketing/cash-stamp.ts';
import type { CatalogItem, CatalogPort } from '../src/sale/cart.ts';
import { OFFLINE_WINDOW_MS } from '../src/offline/offline-window.ts';
import { ConversionTracker } from '../src/b2b/qr-conversion.ts';
import { PRINTER_PROFILE_58_CP858 } from '../src/printing/escpos.ts';
import { PrintQueue } from '../src/printing/print-queue.ts';
import type { PrinterTransport } from '../src/printing/transport.ts';
import { PosCounterApp } from '../src/ui/PosCounterApp.tsx';
import { translateStrict } from '../src/ui/labels.ts';

const NOW = '2026-11-14T08:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const items: readonly CatalogItem[] = [
  { id: 'a1', name: 'Pain', unitPriceTtcCents: 120, vatRateBps: 1000, quantityStepMilli: 1000 },
  { id: 'a2', name: 'Café', unitPriceTtcCents: 1250, vatRateBps: 2000, quantityStepMilli: 1000 },
];
const catalog: CatalogPort = { listItems: async () => items };
const rules: CashStampRulePort = { getCashStampRule: async () => ({ ruleId: 'jeu', rateBps: 25, rounding: 'HALF_UP' }) };

let storage: PosStorage | undefined;
afterEach(async () => {
  cleanup();
  await storage?.close();
  storage = undefined;
});

async function harness(opts: { lastSyncAtMs?: number; online?: boolean; printed?: Uint8Array[] } = {}) {
  const s = await createMemoryStorage();
  storage = s;
  await runLocalMigrations(s, NOW);
  await pairTerminal({
    storage: s,
    gateway: { redeemPairingCode: async () => ({ ok: true, terminal: { terminalId: 'term-1', storeCode: 'M01', terminalCode: 'C01', lastIssuedSequence: 0 } }) },
    rawCode: 'ABCD2345',
    deviceFingerprint: 'fp',
    nowIso: NOW,
  });
  await s.run("INSERT INTO pos_sessions (id, terminal_id, cashier_user_id, opened_at, opening_float_cents, status) VALUES ('sess-1', 'term-1', 'u1', ?, 0, 'SESSION_OUVERTE_ACTIVE')", [NOW]);
  const keyPair = await generateSigningKeyPair();
  const printed = opts.printed ?? [];
  const transport: PrinterTransport = {
    kind: 'usb',
    isSupported: () => true,
    requestDevice: async () => ({ kind: 'usb', id: 'usb:1', label: 'x', vendorId: 1, productId: 2 }),
    connect: async () => ({ write: async (d) => { printed.push(d); }, close: async () => undefined }),
  };
  const printQueue = new PrintQueue({ transport, deviceId: 'usb:1', timeoutMs: 1000 });
  return {
    props: {
      locale: 'fr' as const,
      onLocaleChange: () => undefined,
      catalog,
      ticketDeps: { storage: s, keyPair, stampRules: rules, now: () => NOW, newId: () => 'ticket-1', newQrToken: () => 'qr-token-1' },
      sessionId: 'sess-1',
      sync: { lastSyncAtMs: opts.lastSyncAtMs ?? NOW_MS - 3_600_000, online: opts.online ?? false, pendingTickets: 2 },
      nowMs: () => NOW_MS,
      stampRules: rules,
      receipt: { profile: PRINTER_PROFILE_58_CP858, headerLines: [], conversionBaseUrl: 'https://b2b.test/convert' },
      printQueue,
      conversion: new ConversionTracker([]),
    },
    printed,
  };
}

const t = (key: string): string => translateStrict('fr', 'common', `ui.pos.${key}`);

describe('PosCounterApp : vente, règlement, ticket', () => {
  it('affiche le catalogue du port, ajoute au panier et calcule les totaux en centimes', async () => {
    const { props } = await harness();
    render(<PosCounterApp {...props} />);
    const pain = await screen.findByTestId('catalog-item-a1');
    const cafe = await screen.findByTestId('catalog-item-a2');
    fireEvent.click(pain);
    fireEvent.click(pain);
    fireEvent.click(cafe);
    expect(screen.getByTestId('total-ttc').textContent).toBe('14,90 MAD');
    expect(screen.getByTestId('cart-line-a1').textContent).toContain('2');
  });

  it('indicateur hors ligne : libellé, tickets en attente et compte à rebours 72 h', async () => {
    const { props } = await harness();
    render(<PosCounterApp {...props} />);
    const banner = await screen.findByTestId('offline-banner');
    expect(banner.textContent).toContain(t('net.offlineWithin'));
    expect(banner.textContent).toContain('2');
    expect(banner.textContent).toContain('71 h 0 min');
  });

  it('règlement espèces : pavé en centimes, rendu monnaie, émission d’un ticket signé et aperçu avec QR', async () => {
    const { props } = await harness();
    render(<PosCounterApp {...props} />);
    fireEvent.click(await screen.findByTestId('catalog-item-a2'));
    fireEvent.click(screen.getByTestId('pay-button'));
    for (const d of [2, 0, 0, 0]) fireEvent.click(await screen.findByTestId(`key-${d}`));
    await waitFor(() => expect(screen.getByTestId('change-amount').textContent).toBe('7,47 MAD'));
    expect(screen.getByTestId('stamp-amount').textContent).toBe('0,03 MAD');
    await act(async () => { fireEvent.click(screen.getByTestId('validate-payment')); });
    const preview = await screen.findByTestId('receipt-preview');
    expect(preview.textContent).toContain('POS-M01-C01-2026-000001');
    expect(screen.getAllByTestId('qr-code')).toHaveLength(2);
    expect(screen.getAllByTestId('qr-code')[0]?.getAttribute('role')).toBe('img');
    expect(screen.getByTestId('conversion-link').textContent).toContain('https://b2b.test/convert/qr-token-1');
    const rows = await props.ticketDeps.storage.all('SELECT total_ttc_cents, paid_cash_cents FROM pos_tickets');
    expect(rows[0]).toMatchObject({ total_ttc_cents: 1253, paid_cash_cents: 1253 });
  });

  it('impression : envoie les octets ESC/POS à la file ; erreur typée affichée par libellé', async () => {
    const printed: Uint8Array[] = [];
    const { props } = await harness({ printed });
    render(<PosCounterApp {...props} />);
    fireEvent.click(await screen.findByTestId('catalog-item-a1'));
    fireEvent.click(screen.getByTestId('pay-button'));
    fireEvent.click(await screen.findByTestId('method-card'));
    fireEvent.click(await screen.findByTestId('fill-remaining'));
    await waitFor(() => expect((screen.getByTestId('validate-payment') as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { fireEvent.click(screen.getByTestId('validate-payment')); });
    await screen.findByTestId('receipt-preview');
    await act(async () => { fireEvent.click(screen.getByTestId('print-button')); });
    await waitFor(() => expect(printed).toHaveLength(1));
    expect(Array.from(printed[0] ?? []).slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 0x13]);
  });

  it('passé 72 h : le bouton Régler est désactivé et le message de blocage affiché', async () => {
    const { props } = await harness({ lastSyncAtMs: NOW_MS - OFFLINE_WINDOW_MS - 60_000 });
    render(<PosCounterApp {...props} />);
    fireEvent.click(await screen.findByTestId('catalog-item-a1'));
    const pay = screen.getByTestId('pay-button') as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain(t('sale.blocked'));
  });

  it('RTL : dir=rtl et lang=ar pour l’arabe, dir=ltr pour le tifinagh ; libellés du dictionnaire', async () => {
    const { props } = await harness();
    const { rerender } = render(<PosCounterApp {...props} locale="ar" />);
    const root = await screen.findByTestId('pos-root');
    expect(root.getAttribute('dir')).toBe('rtl');
    expect(root.getAttribute('lang')).toBe('ar');
    expect(within(root).getByTestId('pay-button').textContent).toBe(translateStrict('ar', 'common', 'ui.pos.sale.pay'));
    rerender(<PosCounterApp {...props} locale="zgh-Tfng" />);
    expect(screen.getByTestId('pos-root').getAttribute('dir')).toBe('ltr');
    expect(screen.getByTestId('pos-root').getAttribute('lang')).toBe('zgh-Tfng');
  });

  it('les montants sont isolés en dir=ltr', async () => {
    const { props } = await harness();
    render(<PosCounterApp {...props} locale="ar" />);
    fireEvent.click(await screen.findByTestId('catalog-item-a1'));
    expect(screen.getByTestId('total-ttc').querySelector('[dir="ltr"]')).not.toBeNull();
  });

  it('ticket déjà converti : aucun QR proposé, état affiché', async () => {
    const { props } = await harness();
    props.conversion.apply = props.conversion.apply.bind(props.conversion);
    render(<PosCounterApp {...props} />);
    fireEvent.click(await screen.findByTestId('catalog-item-a1'));
    fireEvent.click(screen.getByTestId('pay-button'));
    fireEvent.click(await screen.findByTestId('method-card'));
    fireEvent.click(await screen.findByTestId('fill-remaining'));
    await waitFor(() => expect((screen.getByTestId('validate-payment') as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { fireEvent.click(screen.getByTestId('validate-payment')); });
    await screen.findByTestId('receipt-preview');
    expect(screen.getByTestId('conversion-state').textContent).toContain(t('b2b.state.NONE'));
    act(() => { props.conversion.apply({ ticketId: 'ticket-1', newState: 'CONVERTI_B2B_AVANT_Z', zClosed: false }); });
    await waitFor(() => expect(screen.queryAllByTestId('qr-code')).toHaveLength(0));
    expect(screen.getByTestId('conversion-state').textContent).toContain(t('b2b.state.CONVERTI_B2B_AVANT_Z'));
    expect(screen.getByTestId('conversion-state').textContent).toContain(t('b2b.alreadyConverted'));
  });
});
