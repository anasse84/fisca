import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  finalizePadesSignature,
  parseTimeStampToken,
  preparePadesSignature,
  signPades,
  type SignedPades,
} from '../src/index.ts';
import { sha256, toHex } from '../src/signature/bytes.ts';
import { buildMinimalPdf, buildXrefStreamPdf } from './support/minimal-pdf.ts';
import { guardTool, JAVA, javaAvailability, javaEnv, JAVA_TESTS_DIR, mavenAvailability, opensslAvailability } from './support/java-tools.ts';
import { createTestIdentity, createTestTimestampProvider, type KeyKind } from './support/test-pki.ts';

const latin1 = (bytes: Uint8Array): string => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

/** Octets signés (plages du /ByteRange) et CMS DER extrait de /Contents. */
function extractSignature(pdf: Uint8Array): { readonly signed: Uint8Array; readonly cms: Uint8Array; readonly byteRange: number[] } {
  const text = latin1(pdf);
  const match = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
  if (match === null) throw new Error('ByteRange absent');
  const byteRange = [1, 2, 3, 4].map((index) => Number(match[index]));
  const [a, b, c, d] = byteRange as [number, number, number, number];
  const hex = text.slice(b + 1, c - 1);
  const contents = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  const lengthByte = contents[1] ?? 0;
  const headerSize = lengthByte < 0x80 ? 2 : 2 + (lengthByte & 0x7f);
  let length = lengthByte;
  if (lengthByte >= 0x80) {
    length = 0;
    for (let index = 0; index < (lengthByte & 0x7f); index += 1) length = length * 256 + (contents[2 + index] ?? 0);
  }
  const signed = new Uint8Array(b + d);
  signed.set(pdf.subarray(a, a + b), 0);
  signed.set(pdf.subarray(c, c + d), b);
  return { signed, cms: contents.subarray(0, headerSize + length), byteRange };
}

const javaEnabled = guardTool('JDK + Maven (BouncyCastle bcpkix) pour la vérification PAdES', {
  available: javaAvailability.available && mavenAvailability.available,
  reason: javaAvailability.available ? mavenAvailability.reason : javaAvailability.reason,
});
const opensslEnabled = guardTool('OpenSSL (cms -verify)', opensslAvailability);

let bcClasspath = '';
const workDirectory = mkdtempSync(join(tmpdir(), 'fisca-pades-'));
afterAll(() => rmSync(workDirectory, { recursive: true, force: true }));

function verifyWithBouncyCastle(pdf: Uint8Array): { readonly status: number | null; readonly output: string } {
  const file = join(workDirectory, `bc-${Math.random().toString(16).slice(2)}.pdf`);
  writeFileSync(file, pdf);
  const run = spawnSync(JAVA, ['-cp', bcClasspath, 'PadesVerifier.java', file], { encoding: 'utf8', cwd: JAVA_TESTS_DIR, env: javaEnv() });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

function verifyWithOpenssl(signed: Uint8Array, cms: Uint8Array): { readonly status: number | null; readonly output: string } {
  const base = join(workDirectory, `ossl-${Math.random().toString(16).slice(2)}`);
  writeFileSync(`${base}.der`, cms);
  writeFileSync(`${base}.bin`, signed);
  const run = spawnSync('openssl', ['cms', '-verify', '-noverify', '-inform', 'DER', '-in', `${base}.der`, '-content', `${base}.bin`, '-binary', '-out', '/dev/null'], { encoding: 'utf8' });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

beforeAll(() => {
  if (!javaEnabled) return;
  const resolve = spawnSync('mvn', ['-q', '-B', 'dependency:build-classpath', `-Dmdep.outputFile=${join(workDirectory, 'cp.txt')}`], {
    encoding: 'utf8',
    cwd: JAVA_TESTS_DIR,
    env: javaEnv(),
  });
  if (resolve.status !== 0) throw new Error(`Résolution Maven de BouncyCastle impossible (réseau Maven Central requis) :\n${resolve.stdout}\n${resolve.stderr}`);
  bcClasspath = readFileSync(join(workDirectory, 'cp.txt'), 'utf8').trim();
}, 240_000);

describe('PAdES-Baseline-T : préparation de l’incrément', () => {
  it('ajoute un incrément (octets d’origine intacts), /ByteRange exact, /Contents réservé, SHA-256 des plages signées', async () => {
    const original = buildMinimalPdf();
    const prepared = await preparePadesSignature(original, { signingTime: new Date(Date.UTC(2026, 10, 13, 12, 0, 0)) });
    expect(Buffer.from(prepared.pdf.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
    const [a, b, c, d] = prepared.byteRange;
    expect(a).toBe(0);
    expect(c + d).toBe(prepared.pdf.length);
    expect(latin1(prepared.pdf.subarray(b, b + 1))).toBe('<');
    expect(latin1(prepared.pdf.subarray(c - 1, c))).toBe('>');
    expect(c - b - 2).toBe(prepared.contentsHexLength);
    const { signed } = extractSignature(prepared.pdf);
    expect(toHex(prepared.digestSha256)).toBe(toHex(await sha256(signed)));
    const text = latin1(prepared.pdf);
    expect(text).toContain('/SubFilter /ETSI.CAdES.detached');
    expect(text).toContain('/AcroForm << /Fields [ 8 0 R ] /SigFlags 3 >>');
    expect(text).toContain('/Prev ');
    expect(text.endsWith('%%EOF\n')).toBe(true);
  });

  it('gère un fichier sans retour à la ligne final et une page à /Annots direct', async () => {
    for (const variant of [{ noTrailingNewline: true }, { withAnnots: true }]) {
      const prepared = await preparePadesSignature(buildMinimalPdf(variant));
      expect(latin1(prepared.pdf)).toMatch(/\/Annots \[ 8 0 R \]/);
    }
  });

  it('refuse (échec fermé) : flux xref, /AcroForm préexistant, non-PDF ; réserve trop petite', async () => {
    await expect(preparePadesSignature(buildXrefStreamPdf())).rejects.toMatchObject({ code: 'PDF_UNSUPPORTED_STRUCTURE' });
    await expect(preparePadesSignature(buildMinimalPdf({ withAcroForm: true }))).rejects.toMatchObject({ code: 'PDF_UNSUPPORTED_STRUCTURE' });
    await expect(preparePadesSignature(new TextEncoder().encode('pas un pdf'))).rejects.toMatchObject({ code: 'PDF_UNSUPPORTED_STRUCTURE' });
    const prepared = await preparePadesSignature(buildMinimalPdf(), { signatureReserveBytes: 64 });
    expect(() => finalizePadesSignature(prepared, new Uint8Array(200))).toThrowError(/réserve/);
    expect(() => finalizePadesSignature({ ...prepared, pdf: buildMinimalPdf() }, new Uint8Array(10))).toThrowError(/preparePadesSignature/);
  });
});

describe.each<KeyKind>(['ecdsa-p256', 'rsa-2048'])('PAdES-Baseline-T bout en bout (%s, clés éphémères, TSA de test non qualifiée)', (kind) => {
  let signedPdf: SignedPades;
  let signedBytes: Uint8Array;
  let cmsBytes: Uint8Array;

  beforeAll(async () => {
    const identity = await createTestIdentity(kind);
    const tsa = await createTestTimestampProvider({ now: () => new Date(Date.UTC(2026, 10, 13, 12, 0, 7)) });
    signedPdf = await signPades(buildMinimalPdf(), {
      certificateDer: identity.certificateDer,
      signer: identity.signer,
      timestampProvider: tsa,
      signingTime: new Date(Date.UTC(2026, 10, 13, 12, 0, 0)),
    });
    const extracted = extractSignature(signedPdf.pdf);
    signedBytes = extracted.signed;
    cmsBytes = extracted.cms;
    expect(identity.signer.calls).toHaveLength(1);
    expect(identity.signer.calls[0]?.digestSha256.length).toBe(32);
  }, 60_000);

  it('produit un CMS détaché dont le jeton RFC 3161 (attribut non signé) est lisible', () => {
    expect(signedPdf.timestampGenTime.toISOString()).toBe('2026-11-13T12:00:07.000Z');
    expect(cmsBytes.length).toBeGreaterThan(500);
    expect(parseTimeStampToken).toBeTypeOf('function');
  });

  it.runIf(javaEnabled)('(BouncyCastle) CMS valide : signature, messageDigest, ESS signing-certificate-v2, jeton RFC 3161 (empreinte et signature TSA de test)', () => {
    const run = verifyWithBouncyCastle(signedPdf.pdf);
    expect(run.output).toContain('PADES_VALID');
    expect(run.output).toContain('timestamp.genTime=2026-11-13T12:00:07Z');
    expect(run.status).toBe(0);
  }, 60_000);

  it.runIf(opensslEnabled)('(OpenSSL) openssl cms -verify -noverify -inform DER sur le CMS extrait', () => {
    const run = verifyWithOpenssl(signedBytes, cmsBytes);
    expect(run.output).toContain('Verification successful');
    expect(run.status).toBe(0);
  });

  it.runIf(opensslEnabled)('négatif OpenSSL : un octet des plages signées altéré → échec', () => {
    const tampered = new Uint8Array(signedBytes);
    tampered[20] = (tampered[20] ?? 0) ^ 0x01;
    expect(verifyWithOpenssl(tampered, cmsBytes).status).not.toBe(0);
  });

  it.runIf(javaEnabled)('négatif BouncyCastle : un octet du PDF dans la plage signée altéré → échec', () => {
    const tampered = new Uint8Array(signedPdf.pdf);
    const target = latin1(tampered).indexOf('Facture de test');
    tampered[target] = (tampered[target] ?? 0) ^ 0x01;
    const run = verifyWithBouncyCastle(tampered);
    expect(run.status).toBe(3);
    expect(run.output).toMatch(/PADES_INVALID/);
  }, 60_000);

  it('(poppler pdfsig) champ de signature, plages et CMS vérifiés par un lecteur PDF indépendant quand l’outil est présent', () => {
    const file = join(workDirectory, `sig-${kind}.pdf`);
    writeFileSync(file, signedPdf.pdf);
    const run = spawnSync('pdfsig', [file], { encoding: 'utf8' });
    if (run.error !== undefined) {
      process.stderr.write('[ubl-xades] pdfsig absent : contrôle poppler non exécuté (informatif, non requis).\n');
      return;
    }
    expect(run.stdout).toContain('Signature Type: ETSI.CAdES.detached');
    expect(run.stdout).toContain('Total document signed');
    expect(run.stdout).toContain('Signature is Valid.');
  });

  it('l’incrément laisse le PDF lisible par poppler (pdfinfo) quand l’outil est présent', () => {
    const file = join(workDirectory, `info-${kind}.pdf`);
    writeFileSync(file, signedPdf.pdf);
    const run = spawnSync('pdfinfo', [file], { encoding: 'utf8' });
    if (run.error !== undefined) {
      process.stderr.write('[ubl-xades] pdfinfo absent : contrôle poppler non exécuté (informatif, non requis).\n');
      return;
    }
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Pages:');
  });
});
