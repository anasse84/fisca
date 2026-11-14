import { describe, expect, it } from 'vitest';
import {
  aipObjectKey, buildAip, computeAipSha256Hex, DEFAULT_RETENTION_DAYS, parseAip, readAip, retentionUntilIso, serializeAip, sha256Hex, verifyAip, verifyAipPackage, writeAip,
} from '../src/index.ts';
import { createClock, makeInvoiceAip, testCipher } from './support/fixture.ts';
import { createInMemoryWormVault } from './support/in-memory-worm-vault.ts';

const CREATED = '2026-03-01T10:00:00Z';
const encoder = new TextEncoder();

describe('AIP', () => {
  it('manifeste au format chemin|taille|sha256, trié, empreinte = SHA-256 des lignes jointes', async () => {
    const aip = await buildAip({
      aipId: 'a1', companyId: 'soc-a', createdAtIso: CREATED, producer: 'svc', rights: 'droits',
      contents: [{ relativePath: 'b/z.txt', bytes: encoder.encode('zz') }, { relativePath: 'a.txt', bytes: encoder.encode('abc') }],
    });
    const abc = await sha256Hex(encoder.encode('abc'));
    expect(aip.manifest.lines[0]).toBe(`a.txt|3|${abc}`);
    expect(aip.manifest.lines[1]).toMatch(/^b\/z\.txt\|2\|[0-9a-f]{64}$/);
    expect(aip.manifest.aipSha256Hex).toBe(await computeAipSha256Hex(aip.manifest.lines));
    expect(aip.manifest.aipSha256Hex).toBe(await sha256Hex(encoder.encode(aip.manifest.lines.join('\n'))));
  });

  it('build puis verify à travers le coffre (rétention 3653 jours, scellé)', async () => {
    const vault = createInMemoryWormVault(() => Date.parse(CREATED));
    const aip = await makeInvoiceAip('soc-a', 1, CREATED);
    const result = await writeAip({ vault, aip, retention: { days: DEFAULT_RETENTION_DAYS }, cipher: testCipher });
    expect(result.key).toBe(aipObjectKey('soc-a', 'aip_001'));
    expect(result.retentionUntilIso).toBe(retentionUntilIso(CREATED, { days: 3653 }));
    expect(result.retentionUntilIso).toBe('2036-03-01T10:00:00Z');
    const stored = await vault.getObjectBytes(result.key);
    expect(new TextDecoder().decode(stored?.bytes).startsWith('{')).toBe(false);
    const report = await verifyAip({ vault, companyId: 'soc-a', aipId: 'aip_001', cipher: testCipher });
    expect(report.ok).toBe(true);
    expect(report.recomputedAipSha256Hex).toBe(aip.manifest.aipSha256Hex);
    expect(parseAip(serializeAip(aip)).manifest.aipSha256Hex).toBe(aip.manifest.aipSha256Hex);
  });

  it("l'altération d'un octet d'un objet fait échouer la vérification", async () => {
    const aip = await makeInvoiceAip('soc-a', 2, CREATED);
    const first = aip.contents[0];
    if (first === undefined) throw new Error('contenu attendu');
    const bytes = Uint8Array.from(atob(first.dataB64), (char) => char.charCodeAt(0));
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const altered = { ...aip, contents: [{ ...first, dataB64: btoa(String.fromCharCode(...bytes)) }, ...aip.contents.slice(1)] };
    const report = await verifyAipPackage(altered);
    expect(report.ok).toBe(false);
    expect(report.failures.map((failure) => failure.code)).toContain('CONTENT_HASH_MISMATCH');
  });

  it("l'altération d'une ligne du manifeste est détectée", async () => {
    const aip = await makeInvoiceAip('soc-a', 3, CREATED);
    const lines = [...aip.manifest.lines];
    lines[0] = `${lines[0] as string}0`;
    const report = await verifyAipPackage({ ...aip, manifest: { ...aip.manifest, lines } });
    expect(report.failures.map((failure) => failure.code)).toEqual(expect.arrayContaining(['MANIFEST_LINES_MISMATCH', 'MANIFEST_DIGEST_MISMATCH']));
  });

  it('refuse un paquet incohérent à l’écriture et un écrasement de la clé', async () => {
    const vault = createInMemoryWormVault(() => Date.parse(CREATED));
    const aip = await makeInvoiceAip('soc-a', 4, CREATED);
    const broken = { ...aip, manifest: { ...aip.manifest, aipSha256Hex: '0'.repeat(64) } };
    await expect(writeAip({ vault, aip: broken, retention: { days: 3653 }, cipher: testCipher })).rejects.toMatchObject({ code: 'AIP_INVALID_INPUT' });
    expect(vault.keys()).toEqual([]);
    await writeAip({ vault, aip, retention: { days: 3653 }, cipher: testCipher });
    await expect(writeAip({ vault, aip, retention: { days: 3653 }, cipher: testCipher })).rejects.toMatchObject({ code: 'INFRA_VAULT_IMMUTABLE' });
  });

  it('rétention invalide et lecture sans scelleur ou paquet absent', async () => {
    const vault = createInMemoryWormVault(() => Date.parse(CREATED));
    const aip = await makeInvoiceAip('soc-a', 5, CREATED);
    await expect(writeAip({ vault, aip, retention: { days: 0 }, cipher: testCipher })).rejects.toMatchObject({ code: 'VAULT_RETENTION_INVALID' });
    await writeAip({ vault, aip, retention: { days: 3653 }, cipher: testCipher });
    await expect(readAip({ vault, companyId: 'soc-a', aipId: 'aip_005' })).rejects.toMatchObject({ code: 'AIP_DECRYPTION_FAILED' });
    await expect(readAip({ vault, companyId: 'soc-a', aipId: 'inconnu' })).rejects.toMatchObject({ code: 'AIP_NOT_FOUND' });
  });

  it('clés d’objet opaques : identifiants seulement, chemins dangereux refusés, messages sans contenu', async () => {
    expect(aipObjectKey('soc-a', 'aip_001')).toBe('aip/v1/soc-a/aip_001.json');
    expect(() => aipObjectKey('soc-a', 'Jean Dupont')).toThrow(/AIP_INVALID_INPUT/);
    expect(() => aipObjectKey('control-plane', 'a')).toThrow();
    for (const relativePath of ['../x', '/abs', 'a|b', 'a\nb', 'a//b']) {
      let message = '';
      try {
        await buildAip({ aipId: 'a', companyId: 'soc-a', createdAtIso: CREATED, producer: 'p', rights: 'r', contents: [{ relativePath, bytes: new Uint8Array(1) }] });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/^AIP_INVALID_PATH/);
      expect(message).not.toContain(relativePath);
    }
    expect(() => parseAip(encoder.encode('pas du json'))).toThrow(/AIP_UNREADABLE/);
    expect(createClock(CREATED).nowIso()).toBe(CREATED);
  });
});
