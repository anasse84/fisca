import type { WormVaultDriver } from '@fisca/shared-types';
import { describe, expect, it } from 'vitest';

export interface WormVaultContractFixture {
  readonly vault: WormVaultDriver;
  /** Tentative de suppression (hors interface) : doit être refusée avant l'échéance de rétention. */
  readonly tryDelete: (key: string) => Promise<void>;
  /** Instant courant du pilote, en ms. */
  readonly nowMs: () => number;
}

const encoder = new TextEncoder();

async function digestHex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rejectionCode(action: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await action();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

/** Contrat réutilisable : immutabilité, rétention, suppression refusée avant échéance. */
export function runWormVaultDriverContractTests(factory: () => WormVaultContractFixture): void {
  describe('contrat WormVaultDriver', () => {
    const retention = (fixture: WormVaultContractFixture) => new Date(fixture.nowMs() + 86_400_000 * 3653).toISOString().slice(0, 19) + 'Z';

    it('écrit puis relit les octets et les métadonnées (copie défensive)', async () => {
      const fixture = factory();
      const bytes = encoder.encode('contenu');
      await fixture.vault.putImmutableObject('a/b.bin', bytes, { retentionUntilIso: retention(fixture), sha256Hex: await digestHex(bytes), customMetadata: { k: 'v' } });
      const read = await fixture.vault.getObjectBytes('a/b.bin');
      expect(read?.metadata['k']).toBe('v');
      expect(new TextDecoder().decode(read?.bytes)).toBe('contenu');
      if (read !== null) read.bytes[0] = 0;
      expect(new TextDecoder().decode((await fixture.vault.getObjectBytes('a/b.bin'))?.bytes)).toBe('contenu');
      expect(await fixture.vault.getObjectBytes('absent')).toBeNull();
    });

    it("refuse l'écrasement d'une clé existante", async () => {
      const fixture = factory();
      const bytes = encoder.encode('x');
      const options = { retentionUntilIso: retention(fixture), sha256Hex: await digestHex(bytes), customMetadata: {} };
      await fixture.vault.putImmutableObject('k/1', bytes, options);
      expect(await rejectionCode(() => fixture.vault.putImmutableObject('k/1', bytes, options))).toBe('INFRA_VAULT_IMMUTABLE');
    });

    it('refuse une rétention passée ou mal formée et un condensé incohérent', async () => {
      const fixture = factory();
      const bytes = encoder.encode('x');
      const good = { retentionUntilIso: retention(fixture), sha256Hex: await digestHex(bytes), customMetadata: {} };
      expect(await rejectionCode(() => fixture.vault.putImmutableObject('k/2', bytes, { ...good, retentionUntilIso: '2000-01-01T00:00:00Z' }))).toBe('INFRA_VAULT_INVALID_RETENTION');
      expect(await rejectionCode(() => fixture.vault.putImmutableObject('k/3', bytes, { ...good, retentionUntilIso: 'demain' }))).toBe('INFRA_VAULT_INVALID_RETENTION');
      expect(await rejectionCode(() => fixture.vault.putImmutableObject('k/4', bytes, { ...good, sha256Hex: '0'.repeat(64) }))).toBe('INFRA_VAULT_HASH_MISMATCH');
      expect(await fixture.vault.getObjectBytes('k/2')).toBeNull();
    });

    it('refuse la suppression avant échéance de la rétention', async () => {
      const fixture = factory();
      const bytes = encoder.encode('x');
      await fixture.vault.putImmutableObject('k/5', bytes, { retentionUntilIso: retention(fixture), sha256Hex: await digestHex(bytes), customMetadata: {} });
      expect(await rejectionCode(() => fixture.tryDelete('k/5'))).toBe('INFRA_VAULT_IMMUTABLE');
      expect(await fixture.vault.getObjectBytes('k/5')).not.toBeNull();
    });
  });
}
