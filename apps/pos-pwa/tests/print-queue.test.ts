import { describe, expect, it } from 'vitest';
import { PrintError, PrintQueue } from '../src/printing/print-queue.ts';
import type { PrinterConnection, PrinterStatus, PrinterTransport } from '../src/printing/transport.ts';

function fakeTransport(opts: { writes: Uint8Array[]; failures?: PrintError[]; status?: PrinterStatus[]; connectError?: PrintError; hang?: boolean }): PrinterTransport {
  const failures = [...(opts.failures ?? [])];
  const statuses = [...(opts.status ?? [])];
  return {
    kind: 'usb',
    isSupported: () => true,
    requestDevice: async () => ({ kind: 'usb', id: 'usb:1', label: 'Imprimante', vendorId: 1, productId: 2 }),
    connect: async (): Promise<PrinterConnection> => {
      if (opts.connectError !== undefined) throw opts.connectError;
      return {
        write: async (data) => {
          if (opts.hang === true) return new Promise<void>(() => undefined);
          const failure = failures.shift();
          if (failure !== undefined) throw failure;
          opts.writes.push(data);
        },
        close: async () => undefined,
        readStatus: async () => statuses.shift() ?? { paperOut: false, coverOpen: false, offline: false },
      };
    },
  };
}

const bytes = (...n: number[]): Uint8Array => Uint8Array.from(n);

describe('file d’impression', () => {
  it('imprime en ordre d’arrivée, un travail à la fois', async () => {
    const writes: Uint8Array[] = [];
    const queue = new PrintQueue({ transport: fakeTransport({ writes }), deviceId: 'usb:1', timeoutMs: 1000 });
    await Promise.all([queue.enqueue(bytes(1)), queue.enqueue(bytes(2)), queue.enqueue(bytes(3))]);
    expect(writes.map((w) => w[0])).toEqual([1, 2, 3]);
    expect(queue.pendingCount()).toBe(0);
  });

  it('imprimante absente : PRINTER_ABSENT ; le travail reste en file et repart après retry()', async () => {
    const writes: Uint8Array[] = [];
    const failures = [new PrintError('PRINTER_ABSENT', 'absente')];
    const queue = new PrintQueue({ transport: fakeTransport({ writes, failures }), deviceId: 'usb:1', timeoutMs: 1000 });
    await expect(queue.enqueue(bytes(9))).rejects.toMatchObject({ code: 'PRINTER_ABSENT' });
    expect(queue.pendingCount()).toBe(1);
    expect(queue.lastError()?.code).toBe('PRINTER_ABSENT');
    await queue.retry();
    expect(writes.map((w) => w[0])).toEqual([9]);
    expect(queue.pendingCount()).toBe(0);
    expect(queue.lastError()).toBeNull();
  });

  it('papier épuisé détecté par la lecture d’état : PAPER_OUT, rien n’est écrit', async () => {
    const writes: Uint8Array[] = [];
    const queue = new PrintQueue({
      transport: fakeTransport({ writes, status: [{ paperOut: true, coverOpen: false, offline: false }] }),
      deviceId: 'usb:1',
      timeoutMs: 1000,
    });
    await expect(queue.enqueue(bytes(1))).rejects.toMatchObject({ code: 'PAPER_OUT' });
    expect(writes).toHaveLength(0);
  });

  it('capot ouvert : PAPER_OUT (même consigne opérateur)', async () => {
    const queue = new PrintQueue({
      transport: fakeTransport({ writes: [], status: [{ paperOut: false, coverOpen: true, offline: false }] }),
      deviceId: 'usb:1',
      timeoutMs: 1000,
    });
    await expect(queue.enqueue(bytes(1))).rejects.toMatchObject({ code: 'PAPER_OUT' });
  });

  it('écriture qui ne répond pas : TIMEOUT', async () => {
    const queue = new PrintQueue({ transport: fakeTransport({ writes: [], hang: true }), deviceId: 'usb:1', timeoutMs: 20 });
    await expect(queue.enqueue(bytes(1))).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('erreur de connexion non typée : enveloppée en TRANSPORT_FAILED', async () => {
    const transport: PrinterTransport = { ...fakeTransport({ writes: [] }), connect: async () => { throw new Error('boom'); } };
    const queue = new PrintQueue({ transport, deviceId: 'usb:1', timeoutMs: 1000 });
    await expect(queue.enqueue(bytes(1))).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' });
  });

  it('transport non pris en charge : UNSUPPORTED', async () => {
    const transport: PrinterTransport = { ...fakeTransport({ writes: [] }), isSupported: () => false };
    const queue = new PrintQueue({ transport, deviceId: 'usb:1', timeoutMs: 1000 });
    await expect(queue.enqueue(bytes(1))).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('notifie les observateurs à chaque changement (UI)', async () => {
    const queue = new PrintQueue({ transport: fakeTransport({ writes: [] }), deviceId: 'usb:1', timeoutMs: 1000 });
    const counts: number[] = [];
    queue.subscribe(() => counts.push(queue.pendingCount()));
    await queue.enqueue(bytes(1));
    expect(counts[0]).toBe(1);
    expect(counts.at(-1)).toBe(0);
  });
});
