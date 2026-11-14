import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AdrInvariantError } from '@fisca/shared-types';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  fetchBaridEsignCscV2Certificate,
  generateUblInvoiceXml,
  resolveSchema,
  schemaKindOfTypeCode,
  signDigestViaBaridEsignCscV2,
  signUblXades,
  verifyUblXades,
  type BaridEsignCscV2Config,
} from '../src/index.ts';
import { OID } from '../src/signature/certificate.ts';
import { ecdsaP1363ToDer } from '../src/signature/der.ts';
import { buildFullInput } from './support/fixtures.ts';
import { createFakeCscServer, PATHS } from './support/fake-csc-server.ts';
import { guardTool, javaAvailability, JAVA, javaEnv, JAVA_TESTS_DIR } from './support/java-tools.ts';
import {
  createOpensslDigestSigner,
  createSelfSignedTestCertificate,
  createTestTimestampProvider,
  generateTestKeyPair,
  type KeyKind,
  type TestKeyPair,
  type TestTimestampProvider,
} from './support/test-pki.ts';
import { validateWithXmllint } from './support/xmllint.ts';

/**
 * Bout en bout : signUblXades + signDigestViaBaridEsignCscV2 contre un FAUX serveur CSC local (tests/ uniquement) qui signe avec une clé
 * éphémère de test. Signature de TEST, jamais qualifiée sans HSM Barid eSign réel ; aucun réseau.
 */
const ICE = '000970000000097';
const IF = '12345678';
const SIGNING_TIME = new Date(Date.UTC(2026, 10, 13, 12, 0, 0));
const jdkEnabled = guardTool('Vérification XML-DSig du JDK (javax.xml.crypto.dsig)', javaAvailability);

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

let tsa: TestTimestampProvider;
beforeAll(async () => {
  tsa = await createTestTimestampProvider({ now: () => new Date(Date.UTC(2026, 10, 13, 12, 0, 5)) });
}, 60_000);

const variants: readonly { readonly label: string; readonly kind: KeyKind; readonly der: boolean }[] = [
  { label: 'ECDSA P-256, signHash rendu en DER', kind: 'ecdsa-p256', der: true },
  { label: 'ECDSA P-256, signHash rendu en r‖s brut', kind: 'ecdsa-p256', der: false },
  { label: 'RSA 2048, signHash rendu en octets bruts', kind: 'rsa-2048', der: false },
];

describe.each(variants)('signUblXades + signDigestViaBaridEsignCscV2 : $label', ({ kind, der }) => {
  let key: TestKeyPair;
  let certificateDer: Uint8Array;
  let configOf: (overrides?: Partial<BaridEsignCscV2Config>) => BaridEsignCscV2Config;
  let server: ReturnType<typeof createFakeCscServer>;

  beforeAll(async () => {
    key = await generateTestKeyPair(kind);
    certificateDer = await createSelfSignedTestCertificate(key, { organizationIdentifier: `NTRMA-${ICE}` });
    const hsm = createOpensslDigestSigner(key);
    server = createFakeCscServer({
      certificateDer,
      keyAlgoOids: [kind === 'ecdsa-p256' ? OID.ecdsaWithSha256 : OID.sha256WithRsa],
      sign: async (digest) => {
        const raw = await hsm.signDigest(digest, key.algorithm);
        return der ? ecdsaP1363ToDer(raw) : raw;
      },
    });
    configOf = (overrides = {}) => ({
      baseUrl: 'https://csc.barid-esign.test',
      http: server.client,
      credentialId: 'credential-de-test',
      emitterIce: ICE,
      emitterIf: IF,
      auth: { clientId: 'client-de-test', clientSecret: 'secret-de-test' },
      authorizationData: () => Promise.resolve([{ id: 'PIN', value: '0000' }]),
      timeoutMs: 5000,
      ...overrides,
    });
  }, 60_000);

  it('produit un XAdES-Baseline-T valide : vérification WebCrypto, XSD OASIS (xmllint) et JDK', async () => {
    const signerCertificate = await fetchBaridEsignCscV2Certificate(configOf());
    expect(Buffer.from(signerCertificate).equals(Buffer.from(certificateDer))).toBe(true);
    const signed = await signUblXades(generateUblInvoiceXml(buildFullInput('380')), {
      certificateDer: signerCertificate,
      signer: signDigestViaBaridEsignCscV2(configOf({ expectedCertificateDer: signerCertificate })),
      timestampProvider: tsa,
      signingTime: SIGNING_TIME,
    });
    const verified = await verifyUblXades(signed.xml);
    expect(verified.failure).toBeUndefined();
    expect(verified.valid).toBe(true);
    expect(verified.signatureAlgorithm).toBe(key.algorithm);
    expect(verified.trust).toBe('NOT_EVALUATED');
    const schema = resolveSchema(schemaKindOfTypeCode('380'), '2.1');
    const lint = validateWithXmllint(signed.xml, schema.path);
    expect(lint.valid, lint.output).toBe(true);
    if (jdkEnabled) {
      const run = jdkValidate(signed.xml);
      expect(run.output).toContain('VALID');
      expect(run.output).toContain('signatureValue=true');
      expect(run.output).toContain('reference[]=true');
      expect(run.status).toBe(0);
    }
    // Un seul signHash par signature de document ; seul le condensé de 32 octets est parti vers le serveur.
    const signHashCalls = server.calls.filter((call) => call.path === PATHS.signHash);
    expect(signHashCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of signHashCalls) {
      const hashes = call.body['hashes'] as string[];
      expect(hashes.length).toBe(1);
      expect(atob(hashes[0] ?? '').length).toBe(32);
    }
  }, 60_000);

  it('certificat d’un autre émetteur : signUblXades échoue (ADR_06_LOI4320_CERT_MISMATCH) sans aucun signHash', async () => {
    const otherCertificate = await createSelfSignedTestCertificate(key, { organizationIdentifier: 'NTRMA-001197530853397' });
    const hsm = createOpensslDigestSigner(key);
    const other = createFakeCscServer({ certificateDer: otherCertificate, keyAlgoOids: [OID.ecdsaWithSha256, OID.sha256WithRsa], sign: (digest) => hsm.signDigest(digest, key.algorithm) });
    const error = await signUblXades(generateUblInvoiceXml(buildFullInput('380')), {
      certificateDer: otherCertificate,
      signer: signDigestViaBaridEsignCscV2(configOf({ http: other.client })),
      timestampProvider: tsa,
      signingTime: SIGNING_TIME,
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AdrInvariantError);
    expect((error as AdrInvariantError).code).toBe('ADR_06_LOI4320_CERT_MISMATCH');
    expect(other.count(PATHS.signHash)).toBe(0);
    expect(other.count(PATHS.authorize)).toBe(0);
  }, 60_000);
});
