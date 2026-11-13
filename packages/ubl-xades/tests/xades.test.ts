import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  canonicalizeC14n11,
  generateUblInvoiceXml,
  resolveSchema,
  schemaKindOfTypeCode,
  signUblXades,
  UblSignatureError,
  verifyUblXades,
  type SignedUblXades,
} from '../src/index.ts';
import { buildFullInput, buildInput, TYPE_CODES } from './support/fixtures.ts';
import { guardTool, javaAvailability, JAVA, javaEnv, JAVA_TESTS_DIR } from './support/java-tools.ts';
import { createTestIdentity, createTestTimestampProvider, type KeyKind, type TestIdentity, type TestTimestampProvider } from './support/test-pki.ts';
import { validateWithXmllint } from './support/xmllint.ts';

const SIGNING_TIME = new Date(Date.UTC(2026, 10, 13, 12, 0, 0));

function jdkValidate(xml: string): { readonly status: number | null; readonly output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fisca-xmldsig-'));
  try {
    const file = join(dir, 'signed.xml');
    writeFileSync(file, xml, 'utf8');
    const run = spawnSync(JAVA, ['XmlDsigVerifier.java', file], { encoding: 'utf8', cwd: JAVA_TESTS_DIR, env: javaEnv() });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const jdkEnabled = guardTool('Vérification XML-DSig du JDK (javax.xml.crypto.dsig)', javaAvailability);

describe.each<KeyKind>(['ecdsa-p256', 'rsa-2048'])('XAdES-Baseline-T bout en bout (%s, clés éphémères WebCrypto, TSA de test non qualifiée)', (kind) => {
  let identity: TestIdentity;
  let tsa: TestTimestampProvider;
  const signed: Partial<Record<(typeof TYPE_CODES)[number], SignedUblXades>> = {};

  beforeAll(async () => {
    identity = await createTestIdentity(kind);
    tsa = await createTestTimestampProvider({ now: () => new Date(Date.UTC(2026, 10, 13, 12, 0, 5)) });
    for (const code of TYPE_CODES) {
      signed[code] = await signUblXades(generateUblInvoiceXml(buildFullInput(code)), {
        certificateDer: identity.certificateDer,
        signer: identity.signer,
        timestampProvider: tsa,
        signingTime: SIGNING_TIME,
      });
    }
  }, 60_000);

  it('signe les 5 types de documents ; le vérificateur WebCrypto les valide (a)', async () => {
    for (const code of TYPE_CODES) {
      const result = await verifyUblXades(signed[code]?.xml ?? '');
      expect(result.failure, `type ${code}`).toBeUndefined();
      expect(result.valid).toBe(true);
      expect(result.signingTime?.toISOString()).toBe('2026-11-13T12:00:00.000Z');
      expect(result.timestampGenTime?.toISOString()).toBe('2026-11-13T12:00:05.000Z');
      expect(result.signatureAlgorithm).toBe(identity.key.algorithm);
      expect(result.trust).toBe('NOT_EVALUATED');
    }
  });

  it('n’envoie au signataire que le condensé SHA-256 de 32 octets', () => {
    expect(identity.signer.calls.length).toBeGreaterThanOrEqual(5);
    for (const call of identity.signer.calls) expect(call.digestSha256.length).toBe(32);
  });

  it('place ds:Signature dans UBLExtensions/UBLExtension/ExtensionContent AVANT cbc:UBLVersionID, avec le jeton EncapsulatedTimeStamp', () => {
    const xml = signed['380']?.xml ?? '';
    expect(xml.indexOf('<ext:UBLExtensions')).toBeLessThan(xml.indexOf('<cbc:UBLVersionID'));
    expect(xml).toMatch(/<ext:UBLExtensions[^>]*><ext:UBLExtension><ext:ExtensionContent><ds:Signature /);
    expect(xml).toContain('<xades:EncapsulatedTimeStamp>');
    expect(xml).toContain('http://www.w3.org/2006/12/xml-c14n11');
    expect(xml).toContain('<xades:SigningCertificate><xades:Cert>');
    expect(xml).not.toContain('SignaturePolicyIdentifier');
    expect(tsa.imprints.length).toBeGreaterThanOrEqual(5);
  });

  it('(5) reste valide contre le XSD OASIS UBL 2.1 (xmllint), pour chaque type', () => {
    for (const code of TYPE_CODES) {
      const schema = resolveSchema(schemaKindOfTypeCode(code), '2.1');
      const result = validateWithXmllint(signed[code]?.xml ?? '', schema.path);
      expect(result.valid, `type ${code}\n${result.output}`).toBe(true);
    }
  });

  it.runIf(jdkEnabled)('(b) validation INDÉPENDANTE par le JDK (javax.xml.crypto.dsig) de chaque type', () => {
    for (const code of TYPE_CODES) {
      const run = jdkValidate(signed[code]?.xml ?? '');
      expect(run.output, `type ${code}`).toContain('VALID');
      expect(run.output).toContain('signatureValue=true');
      expect(run.output).toContain('reference[]=true');
      expect(run.output).toContain('c14n=http://www.w3.org/2006/12/xml-c14n11');
      expect(run.status).toBe(0);
    }
  }, 60_000);

  it('négatif : un octet du document altéré → échec (WebCrypto ET JDK)', async () => {
    const xml = signed['380']?.xml ?? '';
    const tampered = xml.replace('<cbc:ID>FAC-2026-000001</cbc:ID>', '<cbc:ID>FAC-2026-000002</cbc:ID>');
    expect(tampered).not.toBe(xml);
    const result = await verifyUblXades(tampered);
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('XADES_DIGEST_MISMATCH');
    if (jdkEnabled) {
      const run = jdkValidate(tampered);
      expect(run.status).toBe(3);
      expect(run.output).toContain('INVALID');
    }
  }, 60_000);

  it('négatif : SignedProperties altérées → échec', async () => {
    const xml = signed['380']?.xml ?? '';
    const tampered = xml.replace('2026-11-13T12:00:00Z', '2026-11-14T12:00:00Z');
    expect(tampered).not.toBe(xml);
    const result = await verifyUblXades(tampered);
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('XADES_DIGEST_MISMATCH');
    if (jdkEnabled) expect(jdkValidate(tampered).status).toBe(3);
  }, 60_000);

  it('négatif : SignatureValue altérée → signature invalide ; jeton retiré → refus Baseline-T', async () => {
    const xml = signed['380']?.xml ?? '';
    const value = /<ds:SignatureValue Id="[^"]*">([^<]+)</.exec(xml)?.[1] ?? '';
    const flipped = `${value.slice(0, 10)}${value[10] === 'A' ? 'B' : 'A'}${value.slice(11)}`;
    const tampered = xml.replace(value, flipped);
    const bad = await verifyUblXades(tampered);
    expect(bad.valid).toBe(false);
    expect(['XADES_SIGNATURE_INVALID', 'TIMESTAMP_IMPRINT_MISMATCH', 'XADES_STRUCTURE_INVALID', 'DER_MALFORMED']).toContain(bad.failure);
    const withoutStamp = xml.replace(/<xades:UnsignedProperties>.*<\/xades:UnsignedProperties>/s, '');
    const missing = await verifyUblXades(withoutStamp);
    expect(missing.failure).toBe('XADES_TIMESTAMP_MISSING');
    expect((await verifyUblXades(withoutStamp, { requireTimestamp: false })).valid).toBe(true);
  });

  it('négatif : jeton d’horodatage d’un autre condensé → TIMESTAMP_IMPRINT_MISMATCH', async () => {
    const other = await signUblXades(generateUblInvoiceXml(buildInput('380')), {
      certificateDer: identity.certificateDer,
      signer: identity.signer,
      timestampProvider: tsa,
      signingTime: SIGNING_TIME,
    });
    const otherToken = /<xades:EncapsulatedTimeStamp>([^<]+)</.exec(other.xml)?.[1] ?? '';
    const xml = signed['380']?.xml ?? '';
    const token = /<xades:EncapsulatedTimeStamp>([^<]+)</.exec(xml)?.[1] ?? '';
    const result = await verifyUblXades(xml.replace(token, otherToken));
    expect(result.failure).toBe('TIMESTAMP_IMPRINT_MISMATCH');
  });

  it('négatif : certificat de KeyInfo remplacé → échec (SigningCertificateV2 ou signature)', async () => {
    const stranger = await createTestIdentity(kind);
    const xml = signed['380']?.xml ?? '';
    const certificate = /<ds:X509Certificate>([^<]+)</.exec(xml)?.[1] ?? '';
    const swapped = xml.replace(certificate, Buffer.from(stranger.certificateDer).toString('base64'));
    const result = await verifyUblXades(swapped);
    expect(result.valid).toBe(false);
    expect(['XADES_SIGNATURE_INVALID', 'XADES_CERTIFICATE_MISMATCH']).toContain(result.failure);
  });

  it('négatif : ordre UBLExtensions invalide (après UBLVersionID) → le XSD OASIS échoue', () => {
    const xml = signed['380']?.xml ?? '';
    const match = /<ext:UBLExtensions.*<\/ext:UBLExtensions>/s.exec(xml);
    expect(match).not.toBeNull();
    const block = match?.[0] ?? '';
    const moved = xml.replace(block, '').replace(/(<cbc:UBLVersionID>[^<]*<\/cbc:UBLVersionID>)/, `$1${block}`);
    expect(moved).not.toBe(xml);
    const schema = resolveSchema(schemaKindOfTypeCode('380'), '2.1');
    const result = validateWithXmllint(moved, schema.path);
    expect(result.valid).toBe(false);
    expect(result.output).toMatch(/UBLExtensions/);
  });

  it('négatif : XML signé avec un DOCTYPE → refus à la vérification (aucune entité développée)', async () => {
    const xml = signed['380']?.xml ?? '';
    const withDoctype = xml.replace(/^(<\?xml[^>]*\?>\s*)?/, '$1<!DOCTYPE Invoice [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>');
    const result = await verifyUblXades(withDoctype);
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('XML_DOCTYPE_FORBIDDEN');
  });

  it('refus à la signature : document déjà signé, non UBL, ou DOCTYPE', async () => {
    const options = { certificateDer: identity.certificateDer, signer: identity.signer, timestampProvider: tsa, signingTime: SIGNING_TIME };
    await expect(signUblXades(signed['380']?.xml ?? '', options)).rejects.toMatchObject({ code: 'XML_ALREADY_SIGNED' });
    await expect(signUblXades('<Foo xmlns="urn:x"><a/></Foo>', options)).rejects.toMatchObject({ code: 'XML_NOT_UBL_DOCUMENT' });
    await expect(signUblXades('<!DOCTYPE a><a/>', options)).rejects.toBeInstanceOf(UblSignatureError);
  });

  it('refus : signataire qui renvoie une signature au mauvais format', async () => {
    const broken = { async signDigest() { return new Uint8Array(10); } };
    await expect(
      signUblXades(generateUblInvoiceXml(buildInput('380')), { certificateDer: identity.certificateDer, signer: broken, timestampProvider: tsa }),
    ).rejects.toMatchObject({ code: 'SIGNER_RESULT_INVALID' });
  });

  it('signature d’une facture avec politique de signature facultative (hypothèse) : valide et conforme au XSD', async () => {
    const withPolicy = await signUblXades(generateUblInvoiceXml(buildInput('380')), {
      certificateDer: identity.certificateDer,
      signer: identity.signer,
      timestampProvider: tsa,
      signingTime: SIGNING_TIME,
      signaturePolicy: { identifier: 'urn:fisca:test:politique-hypothese', digestSha256: new Uint8Array(32).fill(7) },
    });
    expect(withPolicy.xml).toContain('SignaturePolicyIdentifier');
    expect((await verifyUblXades(withPolicy.xml)).valid).toBe(true);
    const schema = resolveSchema(schemaKindOfTypeCode('380'), '2.1');
    expect(validateWithXmllint(withPolicy.xml, schema.path).valid).toBe(true);
  });

  it('option SigningCertificateV2 (EN 319 132-1) : valide en WebCrypto et au JDK, mais REFUSÉE par le XSD OASIS vendorisé (limite documentée)', async () => {
    const v2 = await signUblXades(generateUblInvoiceXml(buildInput('380')), {
      certificateDer: identity.certificateDer,
      signer: identity.signer,
      timestampProvider: tsa,
      signingTime: SIGNING_TIME,
      signingCertificateElement: 'SigningCertificateV2',
    });
    expect(v2.xml).toContain('<xades:SigningCertificateV2>');
    expect(v2.xml).toContain('<xades:IssuerSerialV2>');
    expect((await verifyUblXades(v2.xml)).valid).toBe(true);
    if (jdkEnabled) expect(jdkValidate(v2.xml).status).toBe(0);
    const schema = resolveSchema(schemaKindOfTypeCode('380'), '2.1');
    const xsd = validateWithXmllint(v2.xml, schema.path);
    expect(xsd.valid).toBe(false);
    expect(xsd.output).toContain('SigningCertificateV2');
  }, 60_000);

  it('la canonisation c14n11 du document signé (hors Signature) est stable : le document non signé garde ses octets', () => {
    const original = generateUblInvoiceXml(buildFullInput('380'));
    const xml = signed['380']?.xml ?? '';
    const stripped = xml.replace(/<ext:UBLExtensions.*<\/ext:UBLExtensions>/s, '');
    expect(stripped).toBe(original);
    expect(canonicalizeC14n11(original).length).toBeGreaterThan(0);
  });
});
