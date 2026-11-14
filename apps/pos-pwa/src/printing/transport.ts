import type { PeripheralConnection, PeripheralDescriptor, PeripheralKind } from '../pairing/peripherals.ts';

/**
 * Transports d'impression. `PeripheralTransport` (appairage) ne connaît que `usb` et `bluetooth` (CHECK de
 * `pos_paired_peripherals`) ; la passerelle IP n'est pas un appairage de navigateur : son adresse est injectée
 * et jamais enregistrée dans cette table. `PrinterTransport` est donc le contrat élargi consommé par la file d'impression ;
 * tout `PeripheralTransport` y est assignable.
 */

export type PrinterTransportKind = PeripheralKind | 'ip';

export interface PrinterDescriptor extends Omit<PeripheralDescriptor, 'kind'> {
  readonly kind: PrinterTransportKind;
}

/** État relevé par l'imprimante (ESC/POS temps réel DLE EOT) ; `null` quand le transport ne sait pas lire l'état. */
export interface PrinterStatus {
  readonly paperOut: boolean;
  readonly coverOpen: boolean;
  readonly offline: boolean;
}

export interface PrinterConnection extends PeripheralConnection {
  readStatus?(): Promise<PrinterStatus>;
}

export interface PrinterTransport {
  readonly kind: PrinterTransportKind;
  isSupported(): boolean;
  requestDevice(): Promise<PrinterDescriptor>;
  connect(deviceId: string): Promise<PrinterConnection>;
}

/** Découpe un tampon en blocs de taille maximale `size` (MTU BLE, paquets USB). */
export function chunkBytes(data: Uint8Array, size: number): readonly Uint8Array[] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('Taille de bloc : entier positif exigé.');
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) chunks.push(data.slice(offset, offset + size));
  return chunks;
}
