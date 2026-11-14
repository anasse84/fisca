import type { PosStorage } from '../storage/ports.ts';

/**
 * Appairage de périphériques (imprimante, lecteur) : ports WebUSB / Bluetooth ABSTRAITS.
 * Aucun pilote ici : seule la sélection, l'enregistrement local et le contrat de transport. Les pilotes ESC/POS (WebUSB, Web Bluetooth,
 * pont IP) vivent dans `src/printing/` (T-P2B-11).
 */

export type PeripheralKind = 'usb' | 'bluetooth';

export interface PeripheralDescriptor {
  readonly kind: PeripheralKind;
  readonly id: string;
  readonly label: string;
  readonly vendorId: number | null;
  readonly productId: number | null;
}

export interface PeripheralConnection {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface PeripheralTransport {
  readonly kind: PeripheralKind;
  isSupported(): boolean;
  /** Ouvre le sélecteur du navigateur (geste utilisateur requis) et renvoie le périphérique choisi. */
  requestDevice(): Promise<PeripheralDescriptor>;
  connect(deviceId: string): Promise<PeripheralConnection>;
}

export type PeripheralPairingOutcome =
  | { readonly status: 'PAIRED'; readonly device: PeripheralDescriptor }
  | { readonly status: 'UNSUPPORTED'; readonly kind: PeripheralKind }
  | { readonly status: 'CANCELLED'; readonly message: string };

export interface PairedPeripheral extends PeripheralDescriptor {
  readonly pairedAt: string;
}

export async function pairPeripheral(storage: PosStorage, transport: PeripheralTransport, nowIso: string): Promise<PeripheralPairingOutcome> {
  if (!transport.isSupported()) return { status: 'UNSUPPORTED', kind: transport.kind };
  let device: PeripheralDescriptor;
  try {
    device = await transport.requestDevice();
  } catch (error) {
    return { status: 'CANCELLED', message: error instanceof Error ? error.message : String(error) };
  }
  await storage.run(
    `INSERT INTO pos_paired_peripherals (id, kind, label, vendor_id, product_id, paired_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, label = excluded.label, vendor_id = excluded.vendor_id,
       product_id = excluded.product_id, paired_at = excluded.paired_at`,
    [device.id, device.kind, device.label, device.vendorId, device.productId, nowIso],
  );
  return { status: 'PAIRED', device };
}

export async function listPairedPeripherals(storage: PosStorage): Promise<readonly PairedPeripheral[]> {
  const rows = await storage.all('SELECT id, kind, label, vendor_id, product_id, paired_at FROM pos_paired_peripherals ORDER BY paired_at, id');
  return rows.map((row) => ({
    id: String(row['id']),
    kind: row['kind'] === 'bluetooth' ? 'bluetooth' : 'usb',
    label: String(row['label']),
    vendorId: row['vendor_id'] === null ? null : Number(row['vendor_id']),
    productId: row['product_id'] === null ? null : Number(row['product_id']),
    pairedAt: String(row['paired_at']),
  }));
}
