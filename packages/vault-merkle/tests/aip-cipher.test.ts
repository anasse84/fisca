import { describe, expect, it } from 'vitest';
import { AIP_CIPHER_ALGORITHM, createE2eeAipCipher, DEFAULT_RETENTION_DAYS, readAip, verifyAip, writeAip } from '../src/index.ts';
import { makeInvoiceAip } from './support/fixture.ts';
import { createInMemoryWormVault } from './support/in-memory-worm-vault.ts';

const CREATED = '2026-03-01T10:00:00Z';
const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

describe('scelleur AES-256-GCM (AAD société|table|enregistrement|colonne)', () => {
  it('aller-retour via le coffre ; l’objet stocké est opaque', async () => {
    const vault = createInMemoryWormVault(() => Date.parse(CREATED));
    const cipher = createE2eeAipCipher(key);
    const aip = await makeInvoiceAip('soc-a', 1, CREATED);
    await writeAip({ vault, aip, retention: { days: DEFAULT_RETENTION_DAYS }, cipher });
    const stored = await vault.getObjectBytes('aip/v1/soc-a/aip_001.json');
    expect(stored?.metadata['fisca-encryption']).toBe(AIP_CIPHER_ALGORITHM);
    expect(new TextDecoder().decode(stored?.bytes)).not.toContain('invoices/');
    expect((await verifyAip({ vault, companyId: 'soc-a', aipId: 'aip_001', cipher })).ok).toBe(true);
  });

  it('mauvaise clé ou mauvais contexte : AIP_DECRYPTION_FAILED sans fuite', async () => {
    const vault = createInMemoryWormVault(() => Date.parse(CREATED));
    const aip = await makeInvoiceAip('soc-a', 2, CREATED);
    await writeAip({ vault, aip, retention: { days: 3653 }, cipher: createE2eeAipCipher(key) });
    const wrongKey = createE2eeAipCipher(key.map((byte) => byte ^ 1));
    await expect(readAip({ vault, companyId: 'soc-a', aipId: 'aip_002', cipher: wrongKey })).rejects.toMatchObject({ code: 'AIP_DECRYPTION_FAILED' });
    const sealed = await createE2eeAipCipher(key).seal(new Uint8Array([1]), { companyId: 'soc-a', aipId: 'x' });
    await expect(createE2eeAipCipher(key).open(sealed, { companyId: 'soc-b', aipId: 'x' })).rejects.toMatchObject({ code: 'AIP_DECRYPTION_FAILED' });
    await expect(createE2eeAipCipher(key).open(sealed, { companyId: 'soc-a', aipId: 'y' })).rejects.toMatchObject({ code: 'AIP_DECRYPTION_FAILED' });
  });
});
