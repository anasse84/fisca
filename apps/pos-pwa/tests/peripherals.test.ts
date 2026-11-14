import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../src/storage/memory-storage.ts';
import { runLocalMigrations } from '../src/storage/migrations.ts';
import type { PosStorage } from '../src/storage/ports.ts';
import { listPairedPeripherals, pairPeripheral } from '../src/pairing/peripherals.ts';
import type { PeripheralDescriptor, PeripheralTransport } from '../src/pairing/peripherals.ts';

const NOW = '2026-11-14T08:00:00.000Z';
let storage: PosStorage | undefined;
afterEach(async () => {
  await storage?.close();
  storage = undefined;
});

const usbPrinter: PeripheralDescriptor = { kind: 'usb', id: 'usb:04b8:0e15:SN1', label: 'Imprimante 80 mm', vendorId: 0x04b8, productId: 0x0e15 };

function transport(kind: 'usb' | 'bluetooth', supported: boolean, device: PeripheralDescriptor | Error): PeripheralTransport {
  return {
    kind,
    isSupported: () => supported,
    requestDevice: async () => {
      if (device instanceof Error) throw device;
      return device;
    },
    connect: async () => ({ write: async () => undefined, close: async () => undefined }),
  };
}

async function fresh(): Promise<PosStorage> {
  const s = await createMemoryStorage();
  await runLocalMigrations(s, NOW);
  storage = s;
  return s;
}

describe('appairage de périphériques (ports WebUSB / Bluetooth abstraits)', () => {
  it('enregistre le périphérique choisi par l’utilisateur', async () => {
    const s = await fresh();
    const outcome = await pairPeripheral(s, transport('usb', true, usbPrinter), NOW);
    expect(outcome).toEqual({ status: 'PAIRED', device: usbPrinter });
    expect(await listPairedPeripherals(s)).toEqual([{ ...usbPrinter, pairedAt: NOW }]);
  });

  it('ré-appairer le même périphérique ne crée pas de doublon', async () => {
    const s = await fresh();
    await pairPeripheral(s, transport('usb', true, usbPrinter), NOW);
    await pairPeripheral(s, transport('usb', true, { ...usbPrinter, label: 'Imprimante comptoir' }), '2026-11-15T08:00:00.000Z');
    const list = await listPairedPeripherals(s);
    expect(list).toHaveLength(1);
    expect(list[0]?.label).toBe('Imprimante comptoir');
  });

  it('transport non pris en charge : refus sans ouvrir de sélecteur', async () => {
    const s = await fresh();
    expect(await pairPeripheral(s, transport('bluetooth', false, usbPrinter), NOW)).toEqual({ status: 'UNSUPPORTED', kind: 'bluetooth' });
  });

  it('sélection annulée par l’utilisateur : rien d’enregistré', async () => {
    const s = await fresh();
    const outcome = await pairPeripheral(s, transport('usb', true, new Error('annulé')), NOW);
    expect(outcome).toEqual({ status: 'CANCELLED', message: 'annulé' });
    expect(await listPairedPeripherals(s)).toEqual([]);
  });
});
