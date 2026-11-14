import type { PeripheralTransport } from '../../pairing/peripherals.ts';
import { PrintError } from '../print-queue.ts';
import { chunkBytes } from '../transport.ts';
import type { PrinterConnection, PrinterStatus } from '../transport.ts';

/** Sous-ensemble de l'API WebUSB utilisé ici (typé localement : la bibliothèque DOM de TypeScript ne le fournit pas). */
export interface UsbEndpointLike {
  readonly endpointNumber: number;
  readonly direction: 'in' | 'out';
  readonly type: string;
}
export interface UsbInterfaceLike {
  readonly interfaceNumber: number;
  readonly alternates: readonly { readonly interfaceClass: number; readonly endpoints: readonly UsbEndpointLike[] }[];
}
export interface UsbDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string | undefined;
  readonly serialNumber?: string | undefined;
  opened: boolean;
  configuration: { readonly interfaces: readonly UsbInterfaceLike[] } | null;
  open(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  close(): Promise<void>;
  transferOut(endpointNumber: number, data: Uint8Array): Promise<{ readonly status: 'ok' | 'stall' | 'babble' }>;
  transferIn(endpointNumber: number, length: number): Promise<{ readonly status: 'ok' | 'stall' | 'babble'; readonly data?: DataView }>;
}
export interface UsbLike {
  requestDevice(options: { filters: readonly { classCode: number }[] }): Promise<UsbDeviceLike>;
  getDevices(): Promise<readonly UsbDeviceLike[]>;
}

export interface WebUsbConfig {
  /** `navigator.usb` ou un double de test ; `undefined` : navigateur sans WebUSB. */
  readonly usb: UsbLike | undefined;
  /** Taille maximale d'un transfert (octets). */
  readonly chunkSize?: number;
}

const USB_PRINTER_CLASS = 7;
const DEFAULT_CHUNK = 4096;
/** DLE EOT n : état temps réel (ESC/POS). n = 2 : capot ; n = 4 : capteur de papier. */
const dleEot = (n: number): Uint8Array => Uint8Array.from([0x10, 0x04, n]);

export function deviceIdOf(device: UsbDeviceLike): string {
  const hex = (n: number): string => n.toString(16).padStart(4, '0');
  return `usb:${hex(device.vendorId)}:${hex(device.productId)}:${device.serialNumber ?? ''}`;
}

function findPrinterInterface(device: UsbDeviceLike): { interfaceNumber: number; out: number; inEndpoint: number | null } | null {
  for (const iface of device.configuration?.interfaces ?? []) {
    for (const alt of iface.alternates) {
      if (alt.interfaceClass !== USB_PRINTER_CLASS) continue;
      const out = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      const inEndpoint = alt.endpoints.find((e) => e.direction === 'in' && e.type === 'bulk');
      if (out !== undefined) return { interfaceNumber: iface.interfaceNumber, out: out.endpointNumber, inEndpoint: inEndpoint?.endpointNumber ?? null };
    }
  }
  return null;
}

export function createWebUsbTransport(config: WebUsbConfig): { connect(deviceId: string): Promise<PrinterConnection> } & PeripheralTransport {
  const chunkSize = config.chunkSize ?? DEFAULT_CHUNK;
  const usb = config.usb;
  return {
    kind: 'usb',
    isSupported: () => usb !== undefined,
    async requestDevice() {
      if (usb === undefined) throw new PrintError('UNSUPPORTED', 'WebUSB indisponible dans ce navigateur.');
      const device = await usb.requestDevice({ filters: [{ classCode: USB_PRINTER_CLASS }] });
      return {
        kind: 'usb',
        id: deviceIdOf(device),
        label: device.productName ?? deviceIdOf(device),
        vendorId: device.vendorId,
        productId: device.productId,
      };
    },
    async connect(deviceId): Promise<PrinterConnection> {
      if (usb === undefined) throw new PrintError('UNSUPPORTED', 'WebUSB indisponible dans ce navigateur.');
      const device = (await usb.getDevices()).find((d) => deviceIdOf(d) === deviceId);
      if (device === undefined) throw new PrintError('PRINTER_ABSENT', `Imprimante USB « ${deviceId} » introuvable ou non autorisée.`);
      try {
        if (!device.opened) await device.open();
        if (device.configuration === null) await device.selectConfiguration(1);
        const found = findPrinterInterface(device);
        if (found === null) throw new PrintError('PRINTER_ABSENT', 'Aucune interface imprimante (classe 7) avec point de sortie bulk.');
        await device.claimInterface(found.interfaceNumber);
        const write = async (data: Uint8Array): Promise<void> => {
          for (const chunk of chunkBytes(data, chunkSize)) {
            const result = await device.transferOut(found.out, chunk);
            if (result.status !== 'ok') throw new PrintError('TRANSPORT_FAILED', `Transfert USB refusé (${result.status}).`);
          }
        };
        const query = async (n: number): Promise<number> => {
          if (found.inEndpoint === null) throw new PrintError('TRANSPORT_FAILED', 'Aucun point d’entrée bulk pour lire l’état.');
          await write(dleEot(n));
          const reply = await device.transferIn(found.inEndpoint, 1);
          if (reply.status !== 'ok' || reply.data === undefined) throw new PrintError('TRANSPORT_FAILED', `Lecture d’état USB refusée (${reply.status}).`);
          return reply.data.getUint8(0);
        };
        return {
          write,
          async readStatus(): Promise<PrinterStatus> {
            const paper = await query(4);
            const cover = await query(2);
            return { paperOut: (paper & 0x60) === 0x60, coverOpen: (cover & 0x04) !== 0, offline: false };
          },
          async close() {
            await device.releaseInterface(found.interfaceNumber);
            await device.close();
          },
        };
      } catch (error) {
        if (error instanceof PrintError) throw error;
        throw new PrintError('PRINTER_ABSENT', error instanceof Error ? error.message : String(error));
      }
    },
  };
}
