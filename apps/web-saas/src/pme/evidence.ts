/** Validation côté client des preuves de litige (politique fournie par le port) et empreinte SHA-256 par WebCrypto. */
import type { EvidencePolicy } from './ports-ops.ts';

export type EvidenceFileError = 'tooLarge' | 'type' | 'empty';

export interface FileLike {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

export function validateEvidenceFile(file: FileLike, policy: EvidencePolicy): EvidenceFileError | null {
  if (file.size <= 0) return 'empty';
  if (file.size > policy.maxFileBytes) return 'tooLarge';
  if (file.type === '' || !policy.allowedMimeTypes.includes(file.type)) return 'type';
  return null;
}

/** `alreadyCount` : fichiers déjà retenus ; dépasser `maxFiles` est refusé. */
export function validateEvidenceSelection(files: readonly FileLike[], policy: EvidencePolicy, alreadyCount: number): { readonly tooMany: boolean } {
  return { tooMany: alreadyCount + files.length > policy.maxFiles };
}

const HEX_RADIX = 16;

/** SHA-256 en 64 hexadécimaux minuscules (WebCrypto pur, aucune dépendance). */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(HEX_RADIX).padStart(2, '0')).join('');
}

export type ByteUnit = 'byte' | 'kb' | 'mb';

const KILO = 1_000;
const MEGA = 1_000_000;

/** Plus grande unité décimale qui divise exactement la taille (affichage fidèle de la politique, sans arrondi). */
export function formatBytes(bytes: number): { readonly value: number; readonly unit: ByteUnit } {
  if (bytes >= MEGA && bytes % MEGA === 0) return { value: Math.trunc(bytes / MEGA), unit: 'mb' };
  if (bytes >= KILO && bytes % KILO === 0) return { value: Math.trunc(bytes / KILO), unit: 'kb' };
  return { value: bytes, unit: 'byte' };
}
