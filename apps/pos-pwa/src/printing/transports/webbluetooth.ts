import type { PeripheralTransport } from '../../pairing/peripherals.ts';
import { PrintError } from '../print-queue.ts';
import { chunkBytes } from '../transport.ts';
import type { PrinterConnection } from '../transport.ts';

/** Sous-ensemble de Web Bluetooth (GATT) utilisé ici. */
export interface BluetoothCharacteristicLike {
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
}
export interface BluetoothServiceLike {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristicLike>;
}
export interface BluetoothServerLike {
  getPrimaryService(uuid: string): Promise<BluetoothServiceLike>;
  disconnect(): void;
}
export interface BluetoothDeviceLike {
  readonly id: string;
  readonly name?: string | undefined;
  readonly gatt: { connected: boolean; connect(): Promise<BluetoothServerLike>; disconnect(): void } | undefined;
}
export interface BluetoothLike {
  requestDevice(options: { filters: readonly { services: readonly string[] }[] }): Promise<BluetoothDeviceLike>;
}

export interface WebBluetoothConfig {
  /** `navigator.bluetooth` ou un double de test ; `undefined` : navigateur sans Web Bluetooth. */
  readonly bluetooth: BluetoothLike | undefined;
  /** UUID du service GATT série de l'imprimante : propre à chaque modèle, fourni par la configuration, jamais en dur. */
  readonly serviceUuid: string;
  /** UUID de la caractéristique d'écriture. */
  readonly characteristicUuid: string;
  /** Taille de bloc (MTU négocié moins 3 octets) ; 100 par défaut, à régler selon le modèle. */
  readonly chunkSize?: number;
}

const DEFAULT_CHUNK = 100;

export function createWebBluetoothTransport(config: WebBluetoothConfig): { connect(deviceId: string): Promise<PrinterConnection> } & PeripheralTransport {
  const known = new Map<string, BluetoothDeviceLike>();
  const chunkSize = config.chunkSize ?? DEFAULT_CHUNK;
  const ble = config.bluetooth;
  return {
    kind: 'bluetooth',
    isSupported: () => ble !== undefined,
    async requestDevice() {
      if (ble === undefined) throw new PrintError('UNSUPPORTED', 'Web Bluetooth indisponible dans ce navigateur.');
      const device = await ble.requestDevice({ filters: [{ services: [config.serviceUuid] }] });
      known.set(device.id, device);
      return { kind: 'bluetooth', id: device.id, label: device.name ?? device.id, vendorId: null, productId: null };
    },
    async connect(deviceId): Promise<PrinterConnection> {
      const device = known.get(deviceId);
      if (device?.gatt === undefined) throw new PrintError('PRINTER_ABSENT', `Imprimante Bluetooth « ${deviceId} » inconnue : l’appairer d’abord.`);
      let characteristic: BluetoothCharacteristicLike;
      let server: BluetoothServerLike;
      try {
        server = await device.gatt.connect();
        const service = await server.getPrimaryService(config.serviceUuid);
        characteristic = await service.getCharacteristic(config.characteristicUuid);
      } catch (error) {
        throw new PrintError('PRINTER_ABSENT', error instanceof Error ? error.message : String(error));
      }
      return {
        async write(data) {
          try {
            for (const chunk of chunkBytes(data, chunkSize)) await characteristic.writeValueWithoutResponse(new Uint8Array(chunk));
          } catch (error) {
            throw new PrintError('TRANSPORT_FAILED', error instanceof Error ? error.message : String(error));
          }
        },
        async close() {
          server.disconnect();
        },
      };
    },
  };
}
