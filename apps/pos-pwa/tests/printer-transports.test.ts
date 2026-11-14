import { describe, expect, it } from 'vitest';
import { PrintError } from '../src/printing/print-queue.ts';
import { createWebUsbTransport } from '../src/printing/transports/webusb.ts';
import type { UsbDeviceLike, UsbLike } from '../src/printing/transports/webusb.ts';
import { createWebBluetoothTransport } from '../src/printing/transports/webbluetooth.ts';
import type { BluetoothCharacteristicLike, BluetoothDeviceLike, BluetoothLike } from '../src/printing/transports/webbluetooth.ts';
import { createIpBridgeTransport } from '../src/printing/transports/ip-bridge.ts';
import type { PeripheralTransport } from '../src/pairing/peripherals.ts';

function fakeUsbDevice(log: { out: Uint8Array[]; ops: string[] }, over: Partial<UsbDeviceLike> = {}): UsbDeviceLike {
  return {
    vendorId: 0x04b8,
    productId: 0x0e15,
    productName: 'TM-T20',
    serialNumber: 'SN1',
    opened: false,
    configuration: {
      interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 7, endpoints: [{ endpointNumber: 1, direction: 'out', type: 'bulk' }, { endpointNumber: 2, direction: 'in', type: 'bulk' }] }] }],
    },
    open: async function () { log.ops.push('open'); this.opened = true; },
    selectConfiguration: async (n) => { log.ops.push(`config:${n}`); },
    claimInterface: async (n) => { log.ops.push(`claim:${n}`); },
    releaseInterface: async (n) => { log.ops.push(`release:${n}`); },
    close: async function () { log.ops.push('close'); this.opened = false; },
    transferOut: async (ep, data) => { log.ops.push(`out:${ep}`); log.out.push(new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))); return { status: 'ok' }; },
    transferIn: async () => ({ status: 'ok', data: new DataView(Uint8Array.from([0x12]).buffer) }),
    ...over,
  };
}

describe('WebUSB', () => {
  it('satisfait le port PeripheralTransport (kind usb)', () => {
    const t: PeripheralTransport = createWebUsbTransport({ usb: undefined });
    expect(t.kind).toBe('usb');
    expect(t.isSupported()).toBe(false);
  });

  it('requestDevice : filtre sur la classe imprimante (7), identifiant stable', async () => {
    const log = { out: [], ops: [] };
    const device = fakeUsbDevice(log);
    let filters: unknown;
    const usb: UsbLike = { requestDevice: async (o) => { filters = o.filters; return device; }, getDevices: async () => [device] };
    const t = createWebUsbTransport({ usb });
    const d = await t.requestDevice();
    expect(filters).toEqual([{ classCode: 7 }]);
    expect(d).toEqual({ kind: 'usb', id: 'usb:04b8:0e15:SN1', label: 'TM-T20', vendorId: 0x04b8, productId: 0x0e15 });
  });

  it('connect : ouvre, sélectionne la configuration si absente, réclame l’interface imprimante, écrit sur l’endpoint OUT, ferme', async () => {
    const log = { out: [] as Uint8Array[], ops: [] as string[] };
    const base = fakeUsbDevice(log);
    const dev: UsbDeviceLike = {
      ...base,
      configuration: null,
      selectConfiguration: async (n) => {
        log.ops.push(`config:${n}`);
        dev.configuration = base.configuration;
      },
    };
    const usb: UsbLike = { requestDevice: async () => dev, getDevices: async () => [dev] };
    const t = createWebUsbTransport({ usb });
    const conn = await t.connect('usb:04b8:0e15:SN1');
    await conn.write(Uint8Array.from([1, 2, 3]));
    await conn.close();
    expect(log.ops).toEqual(['open', 'config:1', 'claim:0', 'out:1', 'release:0', 'close']);
    expect(log.out[0]).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it('écriture découpée en paquets (taille injectable)', async () => {
    const log = { out: [] as Uint8Array[], ops: [] as string[] };
    const dev = fakeUsbDevice(log);
    const t = createWebUsbTransport({ usb: { requestDevice: async () => dev, getDevices: async () => [dev] }, chunkSize: 4 });
    const conn = await t.connect('usb:04b8:0e15:SN1');
    await conn.write(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(log.out.map((c) => c.length)).toEqual([4, 4, 1]);
  });

  it('périphérique introuvable : PRINTER_ABSENT', async () => {
    const t = createWebUsbTransport({ usb: { requestDevice: async () => { throw new Error('x'); }, getDevices: async () => [] } });
    await expect(t.connect('usb:ffff:ffff:none')).rejects.toMatchObject({ code: 'PRINTER_ABSENT' });
  });

  it('écriture refusée (stall) : TRANSPORT_FAILED', async () => {
    const log = { out: [] as Uint8Array[], ops: [] as string[] };
    const dev = fakeUsbDevice(log, { transferOut: async () => ({ status: 'stall' }) });
    const t = createWebUsbTransport({ usb: { requestDevice: async () => dev, getDevices: async () => [dev] } });
    const conn = await t.connect('usb:04b8:0e15:SN1');
    await expect(conn.write(Uint8Array.from([1]))).rejects.toBeInstanceOf(PrintError);
  });

  it('readStatus : DLE EOT 4 (10 04 04) puis lecture ; 0x60 = papier épuisé, 0x0c = presque épuisé ignoré', async () => {
    const log = { out: [] as Uint8Array[], ops: [] as string[] };
    const dev = fakeUsbDevice(log, { transferIn: async () => ({ status: 'ok', data: new DataView(Uint8Array.from([0x72]).buffer) }) });
    const t = createWebUsbTransport({ usb: { requestDevice: async () => dev, getDevices: async () => [dev] } });
    const conn = await t.connect('usb:04b8:0e15:SN1');
    const status = await conn.readStatus?.();
    expect(log.out[0]).toEqual(Uint8Array.from([0x10, 0x04, 0x04]));
    expect(status?.paperOut).toBe(true);
  });
});

describe('Web Bluetooth (GATT série)', () => {
  const SERVICE = 'service-uuid-injecte';
  const CHAR = 'char-uuid-injecte';
  function fakeBle(writes: Uint8Array[], opts: { connectFails?: boolean } = {}): { ble: BluetoothLike; device: BluetoothDeviceLike } {
    const characteristic: BluetoothCharacteristicLike = {
      writeValueWithoutResponse: async (v) => { writes.push(new Uint8Array(v instanceof ArrayBuffer ? v : v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))); },
    };
    const device: BluetoothDeviceLike = {
      id: 'ble-1',
      name: 'Imprimante BLE',
      gatt: {
        connected: false,
        connect: async function () {
          if (opts.connectFails === true) throw new Error('GATT');
          (this as { connected: boolean }).connected = true;
          return {
            getPrimaryService: async (u: string) => {
              expect(u).toBe(SERVICE);
              return { getCharacteristic: async (c: string) => { expect(c).toBe(CHAR); return characteristic; } };
            },
            disconnect: () => undefined,
          };
        },
        disconnect: () => undefined,
      },
    };
    return { ble: { requestDevice: async () => device }, device };
  }

  it('satisfait PeripheralTransport (kind bluetooth) ; UUID de service et de caractéristique injectés, jamais en dur', async () => {
    const { ble } = fakeBle([]);
    const t: PeripheralTransport = createWebBluetoothTransport({ bluetooth: ble, serviceUuid: SERVICE, characteristicUuid: CHAR });
    expect(t.kind).toBe('bluetooth');
    const d = await t.requestDevice();
    expect(d).toEqual({ kind: 'bluetooth', id: 'ble-1', label: 'Imprimante BLE', vendorId: null, productId: null });
  });

  it('écrit par blocs (MTU injectable) sur la caractéristique', async () => {
    const writes: Uint8Array[] = [];
    const { ble } = fakeBle(writes);
    const t = createWebBluetoothTransport({ bluetooth: ble, serviceUuid: SERVICE, characteristicUuid: CHAR, chunkSize: 5 });
    await t.requestDevice();
    const conn = await t.connect('ble-1');
    await conn.write(Uint8Array.from({ length: 12 }, (_, i) => i));
    expect(writes.map((w) => w.length)).toEqual([5, 5, 2]);
  });

  it('connexion GATT en échec : PRINTER_ABSENT ; appareil inconnu : PRINTER_ABSENT', async () => {
    const { ble } = fakeBle([], { connectFails: true });
    const t = createWebBluetoothTransport({ bluetooth: ble, serviceUuid: SERVICE, characteristicUuid: CHAR });
    await t.requestDevice();
    await expect(t.connect('ble-1')).rejects.toMatchObject({ code: 'PRINTER_ABSENT' });
    await expect(t.connect('autre')).rejects.toMatchObject({ code: 'PRINTER_ABSENT' });
  });

  it('non pris en charge sans navigateur compatible', () => {
    expect(createWebBluetoothTransport({ bluetooth: undefined, serviceUuid: SERVICE, characteristicUuid: CHAR }).isSupported()).toBe(false);
  });
});

describe('IP : pont local (WebSocket ou HTTP), adresse injectée', () => {
  it('HTTP : POST binaire vers l’URL injectée telle quelle', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const t = createIpBridgeTransport({
      mode: 'http',
      bridgeUrl: 'http://pont.local:9100/imprimer',
      label: 'Cuisine',
      fetchImpl: async (url, init) => { calls.push({ url: String(url), init: init ?? {} }); return new Response(null, { status: 200 }); },
    });
    expect(t.kind).toBe('ip');
    const d = await t.requestDevice();
    expect(d).toMatchObject({ kind: 'ip', id: 'ip:http://pont.local:9100/imprimer', label: 'Cuisine' });
    const conn = await t.connect(d.id);
    await conn.write(Uint8Array.from([1, 2]));
    expect(calls[0]?.url).toBe('http://pont.local:9100/imprimer');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBeInstanceOf(Uint8Array);
  });

  it('HTTP : réponse non 2xx → TRANSPORT_FAILED ; réseau coupé → PRINTER_ABSENT', async () => {
    const bad = createIpBridgeTransport({ mode: 'http', bridgeUrl: 'http://x/y', label: 'a', fetchImpl: async () => new Response(null, { status: 500 }) });
    await expect((await bad.connect('ip:http://x/y')).write(Uint8Array.from([1]))).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' });
    const off = createIpBridgeTransport({ mode: 'http', bridgeUrl: 'http://x/y', label: 'a', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    await expect((await off.connect('ip:http://x/y')).write(Uint8Array.from([1]))).rejects.toMatchObject({ code: 'PRINTER_ABSENT' });
  });

  it('WebSocket : envoie une trame binaire sur l’URL injectée puis ferme', async () => {
    const sent: unknown[] = [];
    let closed = false;
    class FakeSocket {
      readyState = 0;
      binaryType = 'blob';
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(public url: string) { queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
      send(data: unknown): void { sent.push(data); }
      close(): void { closed = true; }
    }
    const t = createIpBridgeTransport({ mode: 'websocket', bridgeUrl: 'ws://pont.local:9101/', label: 'Comptoir', webSocketFactory: (u) => new FakeSocket(u) });
    const conn = await t.connect('ip:ws://pont.local:9101/');
    await conn.write(Uint8Array.from([7, 8]));
    await conn.close();
    expect(sent).toHaveLength(1);
    expect(closed).toBe(true);
  });

  it('WebSocket : échec d’ouverture → PRINTER_ABSENT', async () => {
    class FailSocket {
      readyState = 0;
      binaryType = 'blob';
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() { queueMicrotask(() => this.onerror?.()); }
      send(): void { /* aucun envoi */ }
      close(): void { /* rien */ }
    }
    const t = createIpBridgeTransport({ mode: 'websocket', bridgeUrl: 'ws://x/', label: 'a', webSocketFactory: () => new FailSocket() });
    await expect(t.connect('ip:ws://x/')).rejects.toMatchObject({ code: 'PRINTER_ABSENT' });
  });

  it('refuse une adresse vide (aucune adresse par défaut)', () => {
    expect(() => createIpBridgeTransport({ mode: 'http', bridgeUrl: '', label: 'a' })).toThrow();
  });
});
