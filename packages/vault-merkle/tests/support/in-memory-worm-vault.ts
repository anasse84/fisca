import { assertValidObjectKey, InfrastructureError, type WormObject, type WormPutOptions, type WormVaultDriver } from '@fisca/shared-types';

/**
 * Pilote mémoire de coffre WORM : MATÉRIEL DE TEST uniquement (jamais exporté de src/). Ne prouve rien d'un vrai Object Lock.
 * Ajoute, hors interface WormVaultDriver, une tentative de suppression pour contrôler le refus avant échéance.
 */
export interface TestWormVault extends WormVaultDriver {
  /** Tentative de suppression d'un objet : refusée tant que la rétention n'est pas échue. */
  tryDeleteObject(key: string): Promise<void>;
  readonly keys: () => readonly string[];
}

interface Stored {
  readonly bytes: Uint8Array;
  readonly metadata: Readonly<Record<string, string>>;
  readonly retentionUntilMs: number;
}

const HEX = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export function createInMemoryWormVault(nowMs: () => number): TestWormVault {
  const objects = new Map<string, Stored>();
  return {
    jurisdiction: 'eu',
    keys: () => [...objects.keys()].sort(),
    async putImmutableObject(key: string, ciphertext: Uint8Array, options: WormPutOptions) {
      assertValidObjectKey(key);
      const until = Date.parse(options.retentionUntilIso);
      if (Number.isNaN(until) || until <= nowMs()) throw new InfrastructureError('INFRA_VAULT_INVALID_RETENTION', 'rétention invalide ou passée.');
      if (objects.has(key)) throw new InfrastructureError('INFRA_VAULT_IMMUTABLE', 'objet WORM déjà écrit : écrasement interdit.');
      const actual = HEX(await crypto.subtle.digest('SHA-256', ciphertext));
      if (actual !== options.sha256Hex) throw new InfrastructureError('INFRA_VAULT_HASH_MISMATCH', 'SHA-256 déclaré différent du contenu.');
      objects.set(key, { bytes: new Uint8Array(ciphertext), metadata: { ...options.customMetadata }, retentionUntilMs: until });
      return { etag: actual };
    },
    async getObjectBytes(key: string): Promise<WormObject | null> {
      assertValidObjectKey(key);
      const stored = objects.get(key);
      return stored === undefined ? null : { bytes: new Uint8Array(stored.bytes), metadata: { ...stored.metadata } };
    },
    async tryDeleteObject(key: string) {
      const stored = objects.get(key);
      if (stored === undefined) return;
      if (stored.retentionUntilMs > nowMs()) throw new InfrastructureError('INFRA_VAULT_IMMUTABLE', 'suppression refusée : rétention non échue.');
      objects.delete(key);
    },
  };
}
