// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createClosingPorts } from '../src/closing/closing-ports.ts';
import { ConversionTracker } from '../src/b2b/qr-conversion.ts';
import { PRINTER_PROFILE_58_CP858 } from '../src/printing/escpos.ts';
import { PrintQueue } from '../src/printing/print-queue.ts';
import type { PrinterTransport } from '../src/printing/transport.ts';
import type { CatalogPort } from '../src/sale/cart.ts';
import type { SyncState, SyncStateSource } from '../src/sync/sync-types.ts';
import { generateSigningKeyPair } from '../src/ticketing/ticket-signing.ts';
import { PosCounterApp } from '../src/ui/PosCounterApp.tsx';
import type { PosCounterAppProps } from '../src/ui/PosCounterApp.tsx';
import { resolvePosLabels } from '../src/ui/labels.ts';
import { NOW, STAMP_RULES, TEST_GRID_PORT, closingHarness, sellThree } from './helpers-closing.ts';
import type { ClosingHarness } from './helpers-closing.ts';

const open: ClosingHarness[] = [];
afterEach(async () => {
  cleanup();
  for (const h of open.splice(0)) await h.storage.close();
});
const catalog: CatalogPort = { listItems: async () => [{ id: 'a1', name: 'Pain', unitPriceTtcCents: 120, vatRateBps: 1000, quantityStepMilli: 1000 }] };
const labels = resolvePosLabels('fr');

async function appProps(printed: Uint8Array[] = []): Promise<{ props: PosCounterAppProps; h: ClosingHarness }> {
  const keyPair = await generateSigningKeyPair();
  const h = await closingHarness(keyPair);
  open.push(h);
  await sellThree(h);
  let n = 0;
  const closing = await createClosingPorts({
    storage: h.storage, grid: TEST_GRID_PORT, keyPair, now: () => NOW, newId: () => `z-${String((n += 1))}`,
    authorization: { canViewExpectedCash: async () => false }, actorUserId: 'u-cashier', sessionId: 'sess-1',
  });
  const transport: PrinterTransport = {
    kind: 'usb', isSupported: () => true,
    requestDevice: async () => ({ kind: 'usb', id: 'usb:1', label: 'x', vendorId: 1, productId: 2 }),
    connect: async () => ({ write: async (d) => { printed.push(d); }, close: async () => undefined }),
  };
  return {
    h,
    props: {
      locale: 'fr', onLocaleChange: () => undefined, catalog, ticketDeps: h.deps, sessionId: 'sess-1',
      sync: { lastSyncAtMs: Date.parse(NOW) - 3_600_000, online: true, pendingTickets: 3 }, nowMs: () => Date.parse(NOW), stampRules: STAMP_RULES,
      receipt: { profile: PRINTER_PROFILE_58_CP858, headerLines: [], conversionBaseUrl: 'https://b2b.test/convert' },
      printQueue: new PrintQueue({ transport, deviceId: 'usb:1', timeoutMs: 1000 }), conversion: new ConversionTracker([]), closing,
    },
  };
}

describe('PosCounterApp : fin de poste et indicateur de synchro', () => {
  it('fin de poste → comptage → verrouillage → Ticket Z scellé et imprimé par la file → vente impossible', async () => {
    const printed: Uint8Array[] = [];
    const { props, h } = await appProps(printed);
    render(<PosCounterApp {...props} />);
    fireEvent.click(await screen.findByTestId('closing-open'));
    fireEvent.click(await screen.findByTestId('count-increase-note-10000'));
    fireEvent.click(screen.getByTestId('count-lock'));
    fireEvent.click(await screen.findByTestId('z-seal'));
    await screen.findByTestId('z-sealed');
    fireEvent.click(screen.getByTestId('z-print'));
    await waitFor(() => expect(printed).toHaveLength(1));
    expect(printed[0]?.length).toBeGreaterThan(50);
    expect((await h.storage.all('SELECT status FROM pos_sessions'))[0]?.['status']).toBe('CLOTURE_TICKET_Z_SCELLEE');
    fireEvent.click(screen.getByTestId('closing-back'));
    const pay = await screen.findByTestId('pay-button');
    fireEvent.click(await screen.findByTestId('catalog-item-a1'));
    expect((pay as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(labels.z.noSale)).toBeTruthy();
  });

  it('pas de bouton de fin de poste sans configuration de clôture', async () => {
    const { props } = await appProps();
    const withoutClosing = Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'closing')) as unknown as PosCounterAppProps;
    render(<PosCounterApp {...withoutClosing} />);
    await screen.findByTestId('catalog-item-a1');
    expect(screen.queryByTestId('closing-open')).toBeNull();
  });

  it('affiche l’indicateur de synchro du moteur et se met à jour', async () => {
    const { props } = await appProps();
    let state: SyncState = { status: 'PENDING', pendingTickets: 3, pendingClosures: 0, lastSyncAtMs: null, errorCode: null, attempts: 0, nextRetryAtMs: null };
    const listeners = new Set<() => void>();
    const retry = vi.fn(async () => state);
    const source: SyncStateSource = { getState: () => state, subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); }, syncNow: retry };
    render(<PosCounterApp {...props} syncSource={source} />);
    expect((await screen.findByTestId('sync-indicator')).getAttribute('data-state')).toBe('PENDING');
    state = { ...state, status: 'ERROR', errorCode: 'NETWORK', attempts: 1, nextRetryAtMs: Date.parse(NOW) + 2000 };
    listeners.forEach((l) => l());
    await waitFor(() => expect(screen.getByTestId('sync-indicator').getAttribute('data-state')).toBe('ERROR'));
    fireEvent.click(screen.getByTestId('sync-retry'));
    expect(retry).toHaveBeenCalled();
  });
});
