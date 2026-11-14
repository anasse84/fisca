import { describe, expect, it } from 'vitest';
import { OPFS_DB_FILENAME, OPFS_SAHPOOL_DIRECTORY, OpfsUnavailableError, openOpfsStorage } from '../src/storage/opfs-sahpool-storage.ts';

describe('stockage OPFS (variante opfs-sahpool)', () => {
  it('constantes de la variante retenue', () => {
    expect(OPFS_SAHPOOL_DIRECTORY).toBe('/fisca-pos-sahpool');
    expect(OPFS_DB_FILENAME).toBe('/fisca-pos.sqlite3');
  });

  it('sous Node (sans OPFS) : échec explicite typé, jamais de repli silencieux en mémoire', async () => {
    await expect(openOpfsStorage()).rejects.toBeInstanceOf(OpfsUnavailableError);
  });
});
