import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTimeStampRequest, extractTimeStampTokenFromResponse, parseTimeStampToken, UblSignatureError } from '../src/index.ts';
import { sha256, toHex } from '../src/signature/bytes.ts';
import { decodeOid, ecdsaDerToP1363, ecdsaP1363ToDer, integerFromBigInt, oid, parseDer, readNode, sequence, TAG, tlv } from '../src/signature/der.ts';
import { guardTool, opensslAvailability } from './support/java-tools.ts';
import { createTestTimestampProvider, TEST_TSA_LABEL, TEST_TSA_POLICY_OID } from './support/test-pki.ts';

const opensslEnabled = guardTool('OpenSSL (ts -query / ts -reply)', opensslAvailability);

describe('DER minimal', () => {
  it('OID : encodage et décodage aller-retour (SHA-256, signedData, grand arc)', () => {
    for (const dotted of ['2.16.840.1.101.3.4.2.1', '1.2.840.113549.1.7.2', '1.3.6.1.4.1.99999.0.1', '2.5.4.97']) {
      expect(decodeOid(parseDer(oid(dotted)))).toBe(dotted);
    }
    expect(toHex(oid('2.16.840.1.101.3.4.2.1'))).toBe('0609608648016503040201');
  });

  it('INTEGER non négatif : zéro de tête si le bit de poids fort est posé ; longueurs longues', () => {
    expect(toHex(integerFromBigInt(0x80n))).toBe('02020080');
    expect(toHex(integerFromBigInt(0n))).toBe('020100');
    const big = tlv(TAG.OCTET_STRING, new Uint8Array(300));
    expect(toHex(big.subarray(0, 4))).toBe('04820' + '12c');
    expect(readNode(big).node.content.length).toBe(300);
  });

  it('refuse la longueur indéfinie et les troncatures', () => {
    expect(() => parseDer(Uint8Array.of(0x30, 0x80, 0x00, 0x00))).toThrow(UblSignatureError);
    expect(() => parseDer(Uint8Array.of(0x30, 0x05, 0x01))).toThrow(UblSignatureError);
  });

  it('ECDSA : r||s ↔ DER, aller-retour', () => {
    const raw = new Uint8Array(64).map((_, index) => (index === 0 || index === 32 ? 0x90 : index));
    expect(toHex(ecdsaDerToP1363(ecdsaP1363ToDer(raw), 32))).toBe(toHex(raw));
    expect(toHex(sequence(integerFromBigInt(1n)))).toBe('3003020101');
  });
});

describe('RFC 3161 : TimeStampReq', () => {
  const imprint = new Uint8Array(32).map((_, index) => index);

  it('encode version 1, empreinte SHA-256 (OID 2.16.840.1.101.3.4.2.1), nonce et certReq=true', () => {
    const request = buildTimeStampRequest(imprint, { nonce: Uint8Array.of(0x01, 0x02, 0x03, 0x04) });
    // SEQUENCE { INTEGER 1, SEQUENCE { SEQUENCE { OID sha256, NULL }, OCTET STRING(32) }, INTEGER nonce, BOOLEAN TRUE }
    const expected = `303f020101${'3031'}${'300d0609608648016503040201' + '0500'}0420${toHex(imprint)}0204010203040101ff`;
    expect(toHex(request.der)).toBe(expected);
  });

  it('exige 32 octets ; nonce aléatoire par défaut ; certReq désactivable', () => {
    expect(() => buildTimeStampRequest(new Uint8Array(20))).toThrow(UblSignatureError);
    const first = buildTimeStampRequest(imprint);
    const second = buildTimeStampRequest(imprint);
    expect(toHex(first.nonce)).not.toBe(toHex(second.nonce));
    expect(toHex(buildTimeStampRequest(imprint, { certReq: false }).der).endsWith('010100')).toBe(true);
  });

  it.runIf(opensslEnabled)('(OpenSSL) openssl ts -query relit la requête : SHA-256, nonce, certificat demandé', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fisca-tsq-'));
    try {
      const request = buildTimeStampRequest(imprint, { nonce: Uint8Array.of(0x12, 0x34, 0x56, 0x78) });
      writeFileSync(join(directory, 'req.tsq'), request.der);
      const run = spawnSync('openssl', ['ts', '-query', '-in', join(directory, 'req.tsq'), '-text'], { encoding: 'utf8' });
      expect(run.status).toBe(0);
      expect(run.stdout).toContain('Version: 1');
      expect(run.stdout).toContain('Hash Algorithm: sha256');
      expect(run.stdout).toContain('Nonce: 0x12345678');
      expect(run.stdout).toContain('Certificate required: yes');
      expect(run.stdout).toContain('0010 - 10 11 12 13 14 15 16 17-18 19 1a 1b 1c 1d 1e 1f');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe(`RFC 3161 : TimeStampToken (${TEST_TSA_LABEL})`, () => {
  const imprint = new Uint8Array(32).fill(0xab);

  it('extrait genTime, politique, empreinte et certificat joint du jeton ; contrôle de l’empreinte', async () => {
    const tsa = await createTestTimestampProvider({ now: () => new Date(Date.UTC(2026, 10, 13, 8, 30, 15)) });
    const token = await tsa.timestamp(imprint);
    const parsed = parseTimeStampToken(token, { expectedImprintSha256: imprint });
    expect(parsed.genTime.toISOString()).toBe('2026-11-13T08:30:15.000Z');
    expect(parsed.policyOid).toBe(TEST_TSA_POLICY_OID);
    expect(parsed.hashAlgorithmOid).toBe('2.16.840.1.101.3.4.2.1');
    expect(toHex(parsed.messageImprint)).toBe(toHex(imprint));
    expect(parsed.certificates).toHaveLength(1);
    expect(toHex(parsed.certificates[0] ?? new Uint8Array())).toBe(toHex(tsa.certificateDer));
  });

  it('refuse une empreinte différente (TIMESTAMP_IMPRINT_MISMATCH) et un jeton illisible (TIMESTAMP_TOKEN_INVALID)', async () => {
    const tsa = await createTestTimestampProvider();
    const token = await tsa.timestamp(imprint);
    expect(() => parseTimeStampToken(token, { expectedImprintSha256: new Uint8Array(32) })).toThrowError(/empreinte/);
    expect(() => parseTimeStampToken(new Uint8Array([1, 2, 3]))).toThrowError(/TimeStampToken illisible/);
    expect(() => parseTimeStampToken(sequence(oid('1.2.840.113549.1.7.1')))).toThrow(UblSignatureError);
    const decoded = await sha256(imprint);
    expect(decoded.length).toBe(32);
  });

  it.runIf(opensslEnabled)('(OpenSSL) openssl ts -reply -token_in relit le jeton de test', async () => {
    const tsa = await createTestTimestampProvider({ now: () => new Date(Date.UTC(2026, 10, 13, 8, 30, 15)) });
    const directory = mkdtempSync(join(tmpdir(), 'fisca-tst-'));
    try {
      writeFileSync(join(directory, 'token.der'), await tsa.timestamp(imprint));
      const run = spawnSync('openssl', ['ts', '-reply', '-in', join(directory, 'token.der'), '-token_in', '-text'], { encoding: 'utf8' });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain('Hash Algorithm: sha256');
      expect(run.stdout).toContain(`Policy OID: ${TEST_TSA_POLICY_OID}`);
      expect(run.stdout).toContain('Time stamp: Nov 13 08:30:15 2026 GMT');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('TimeStampResp : statut accordé → jeton ; statut refusé → erreur', async () => {
    const tsa = await createTestTimestampProvider();
    const token = await tsa.timestamp(imprint);
    const granted = sequence(sequence(integerFromBigInt(0n)), token);
    expect(toHex(extractTimeStampTokenFromResponse(granted))).toBe(toHex(token));
    const rejected = sequence(sequence(integerFromBigInt(2n)));
    expect(() => extractTimeStampTokenFromResponse(rejected)).toThrowError(/refusé/);
  });
});
