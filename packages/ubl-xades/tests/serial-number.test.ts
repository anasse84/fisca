import { beforeAll, describe, expect, it } from 'vitest';
import {
  generateUblInvoiceXml,
  resolveSchema,
  schemaKindOfTypeCode,
  signUblXades,
  UblSignatureError,
  verifyUblXades,
  XMLLINT_MAX_SERIAL_DIGITS,
} from '../src/index.ts';
import { parseCertificate } from '../src/signature/certificate.ts';
import { buildFullInput } from './support/fixtures.ts';
import { createOpensslTestCertificate } from './support/openssl-certificate.ts';
import { createOpensslDigestSigner, createTestTimestampProvider, generateTestKeyPair, type RecordingDigestSigner, type TestKeyPair, type TestTimestampProvider } from './support/test-pki.ts';
import { validateWithXmllint } from './support/xmllint.ts';

/**
 * Comportement EXACT de signUblXades et de xmllint face à un numéro de série de certificat très long (T-P2A-05, correctif b).
 * Le XSD (ds:X509SerialNumber : xs:integer) est non borné ; libxml2 (xmllint) refuse au-delà de 24 chiffres décimaux (mesuré 2.10.x :
 * 24 valides, 25 refusés). Décision : échec fermé explicite UBL_SIGNATURE_SERIAL_UNSUPPORTED plutôt qu'un XML refusé par le validateur
 * produit en silence ; option explicite allowLongSerialNumber pour passer outre. Aucune alternative qui fasse passer le XSD : l'élément
 * est obligatoire et de type xs:integer dans xades:SigningCertificate (IssuerSerial) ; SigningCertificateV2 n'existe pas dans le XSD vendorisé.
 */
const ICE = '000970000000097';
const SIGNING_TIME = new Date(Date.UTC(2026, 10, 13, 12, 0, 0));
/** 48 chiffres décimaux, 20 octets, bit de poids fort à 0 (valide RFC 5280). */
const SERIAL_48 = 7n * 10n ** 47n + 123456789012345678901234567n;
/** 24 chiffres (limite de xmllint) et 25 chiffres. */
const SERIAL_24 = 10n ** 24n - 1n;
const SERIAL_25 = 10n ** 24n;

let key: TestKeyPair;
let tsa: TestTimestampProvider;
beforeAll(async () => {
  key = await generateTestKeyPair('ecdsa-p256');
  tsa = await createTestTimestampProvider({ now: () => new Date(Date.UTC(2026, 10, 13, 12, 0, 5)) });
}, 60_000);

function prepare(serial: bigint): { readonly certificateDer: Uint8Array; readonly signer: RecordingDigestSigner } {
  return { certificateDer: createOpensslTestCertificate(key, { serial, organizationIdentifier: `NTRMA-${ICE}` }), signer: createOpensslDigestSigner(key) };
}

const xml = (): string => generateUblInvoiceXml(buildFullInput('380'));
const schemaPath = (): string => resolveSchema(schemaKindOfTypeCode('380'), '2.1').path;

describe('numéro de série de certificat de 48 chiffres décimaux (certificat fabriqué avec openssl, serial de 20 octets)', () => {
  it('le certificat de test porte bien un serial de 48 chiffres sur 20 octets', () => {
    const certificate = parseCertificate(prepare(SERIAL_48).certificateDer);
    expect(certificate.serialNumber).toBe(SERIAL_48);
    expect(certificate.serialNumber.toString().length).toBe(48);
    expect(certificate.serialDer.length - 2).toBe(20);
  });

  it('signUblXades : échec fermé UBL_SIGNATURE_SERIAL_UNSUPPORTED, avant tout appel au signataire et à la TSA', async () => {
    const { certificateDer, signer } = prepare(SERIAL_48);
    const imprintsBefore = tsa.imprints.length;
    let thrown: unknown;
    try {
      await signUblXades(xml(), { certificateDer, signer, timestampProvider: tsa, signingTime: SIGNING_TIME });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UblSignatureError);
    expect((thrown as UblSignatureError).code).toBe('UBL_SIGNATURE_SERIAL_UNSUPPORTED');
    expect((thrown as UblSignatureError).message).toContain(String(XMLLINT_MAX_SERIAL_DIGITS));
    expect((thrown as UblSignatureError).message).not.toContain(SERIAL_48.toString());
    expect(signer.calls.length).toBe(0);
    expect(tsa.imprints.length).toBe(imprintsBefore);
  });

  it('allowLongSerialNumber : XML produit, vérifié par WebCrypto, mais REFUSÉ par xmllint (limite de libxml2 sur xs:integer)', async () => {
    const { certificateDer, signer } = prepare(SERIAL_48);
    const signed = await signUblXades(xml(), { certificateDer, signer, timestampProvider: tsa, signingTime: SIGNING_TIME, allowLongSerialNumber: true });
    expect(signed.xml).toContain(`<ds:X509SerialNumber>${SERIAL_48.toString()}</ds:X509SerialNumber>`);
    expect((await verifyUblXades(signed.xml)).valid).toBe(true);
    const lint = validateWithXmllint(signed.xml, schemaPath());
    expect(lint.valid).toBe(false);
    expect(lint.output).toContain('X509SerialNumber');
  });

  it('SigningCertificateV2 : pas de limite de longueur (IssuerSerialV2 en base64), mais refusé par le XSD vendorisé', async () => {
    const { certificateDer, signer } = prepare(SERIAL_48);
    const signed = await signUblXades(xml(), { certificateDer, signer, timestampProvider: tsa, signingTime: SIGNING_TIME, signingCertificateElement: 'SigningCertificateV2' });
    expect((await verifyUblXades(signed.xml)).valid).toBe(true);
    const lint = validateWithXmllint(signed.xml, schemaPath());
    expect(lint.valid).toBe(false);
    expect(lint.output).not.toContain('X509SerialNumber');
    expect(lint.output).toContain('SigningCertificateV2');
  });

  it('limite exacte : 24 chiffres signés et valides au XSD ; 25 chiffres refusés fermé', async () => {
    const ok = prepare(SERIAL_24);
    const signed = await signUblXades(xml(), { certificateDer: ok.certificateDer, signer: ok.signer, timestampProvider: tsa, signingTime: SIGNING_TIME });
    expect(signed.xml).toContain(`<ds:X509SerialNumber>${SERIAL_24.toString()}</ds:X509SerialNumber>`);
    expect((await verifyUblXades(signed.xml)).valid).toBe(true);
    const lint = validateWithXmllint(signed.xml, schemaPath());
    expect(lint.valid, lint.output).toBe(true);

    const over = prepare(SERIAL_25);
    await expect(signUblXades(xml(), { certificateDer: over.certificateDer, signer: over.signer, timestampProvider: tsa, signingTime: SIGNING_TIME })).rejects.toMatchObject({
      code: 'UBL_SIGNATURE_SERIAL_UNSUPPORTED',
    });
    const forced = await signUblXades(xml(), { certificateDer: over.certificateDer, signer: over.signer, timestampProvider: tsa, signingTime: SIGNING_TIME, allowLongSerialNumber: true });
    expect(validateWithXmllint(forced.xml, schemaPath()).valid).toBe(false);
  });
});
