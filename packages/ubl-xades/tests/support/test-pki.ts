const PEM_DASHES = '-'.repeat(5);
const PEM_LABEL = ['PRIVATE', 'KEY'].join(' ');
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256, toBase64 } from '../../src/signature/bytes.ts';
import { OID, parseCertificate, signatureAlgorithmIdentifier } from '../../src/signature/certificate.ts';
import { assembleCms, buildSignedAttributes, cmsSignatureValue } from '../../src/signature/cms.ts';
import {
  bitString,
  derBoolean,
  ecdsaDerToP1363,
  ecdsaP1363ToDer,
  explicit,
  generalizedTime,
  integerFromBigInt,
  integerFromUnsignedBytes,
  octetString,
  oid,
  printableString,
  sequence,
  setOf,
  utcTime,
  utf8String,
  tlv,
} from '../../src/signature/der.ts';
import type { DigestSigner, SignatureAlgorithm, TimestampProvider } from '../../src/signature/types.ts';

/**
 * Matériel de TEST uniquement (jamais exporté depuis src/) : clés éphémères générées par WebCrypto à chaque exécution,
 * certificat X.509 auto-signé fabriqué ici, « TSA de test, non qualifiée ». Aucun secret réel, aucune valeur de production.
 */
export const TEST_TSA_LABEL = 'TSA de test, non qualifiée';
export const TEST_SEAL_LABEL = 'TEST SEAL - NON QUALIFIE';
/** Identifiant de politique de la TSA de test (arc d'entreprise privé de test : n'identifie aucune politique réelle). */
export const TEST_TSA_POLICY_OID = '1.3.6.1.4.1.99999.0.1';

export type KeyKind = 'ecdsa-p256' | 'rsa-2048';

export interface TestKeyPair {
  readonly kind: KeyKind;
  readonly algorithm: SignatureAlgorithm;
  readonly publicKeySpki: Uint8Array;
  readonly privateKeyPkcs8: Uint8Array;
  readonly privateKey: Awaited<ReturnType<typeof crypto.subtle.importKey>>;
}

export async function generateTestKeyPair(kind: KeyKind): Promise<TestKeyPair> {
  const pair =
    kind === 'ecdsa-p256'
      ? await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
      : await crypto.subtle.generateKey(
          { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
          true,
          ['sign', 'verify'],
        );
  return {
    kind,
    algorithm: kind === 'ecdsa-p256' ? 'ECDSA_P256_SHA256' : 'RSA_PKCS1_SHA256',
    publicKeySpki: new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)),
    privateKeyPkcs8: new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    privateKey: pair.privateKey,
  };
}

const name = (rdns: readonly (readonly [string, Uint8Array])[]): Uint8Array =>
  sequence(...rdns.map(([type, value]) => setOf(sequence(oid(type), value))));

export interface TestCertificateOptions {
  readonly commonName?: string;
  /** Valeur de l'attribut organizationIdentifier (2.5.4.97), ex. « ICE000970000000097 ». */
  readonly organizationIdentifier?: string;
  readonly serialNumberAttribute?: string;
  readonly timeStamping?: boolean;
  readonly notBefore?: Date;
  readonly notAfter?: Date;
}

/** Certificat auto-signé de test, signé avec la clé de test par WebCrypto. */
export async function createSelfSignedTestCertificate(key: TestKeyPair, options: TestCertificateOptions = {}): Promise<Uint8Array> {
  const subject = name([
    ['2.5.4.6', printableString('MA')],
    ['2.5.4.10', utf8String('TEST - Société fictive (non qualifié)')],
    ...(options.organizationIdentifier === undefined ? [] : ([['2.5.4.97', utf8String(options.organizationIdentifier)]] as const)),
    ...(options.serialNumberAttribute === undefined ? [] : ([['2.5.4.5', printableString(options.serialNumberAttribute)]] as const)),
    ['2.5.4.3', utf8String(options.commonName ?? TEST_SEAL_LABEL)],
  ]);
  const signatureAlgorithm = signatureAlgorithmIdentifier(key.algorithm);
  const serial = crypto.getRandomValues(new Uint8Array(8));
  serial[0] = (serial[0] ?? 1) & 0x7f;
  const extensions = [
    sequence(oid('2.5.29.15'), derBoolean(true), octetString(tlv(0x03, Uint8Array.of(6, 0xc0)))),
    ...(options.timeStamping === true
      ? [sequence(oid('2.5.29.37'), derBoolean(true), octetString(sequence(oid('1.3.6.1.5.5.7.3.8'))))]
      : []),
  ];
  const tbs = sequence(
    explicit(0, integerFromBigInt(2n)),
    integerFromUnsignedBytes(serial),
    signatureAlgorithm,
    subject,
    sequence(utcTime(options.notBefore ?? new Date(Date.UTC(2026, 0, 1))), utcTime(options.notAfter ?? new Date(Date.UTC(2046, 0, 1)))),
    subject,
    key.publicKeySpki,
    explicit(3, sequence(...extensions)),
  );
  const rawSignature =
    key.kind === 'ecdsa-p256'
      ? ecdsaP1363ToDer(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, tbs)))
      : new Uint8Array(await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key.privateKey, tbs));
  return sequence(tbs, signatureAlgorithm, bitString(rawSignature));
}

export interface TestIdentity {
  readonly key: TestKeyPair;
  readonly certificateDer: Uint8Array;
  readonly signer: RecordingDigestSigner;
}

export interface RecordingDigestSigner extends DigestSigner {
  readonly calls: { readonly digestSha256: Uint8Array; readonly algorithm: SignatureAlgorithm }[];
}

/**
 * Signataire de test : signe un condensé SHA-256 DÉJÀ calculé, comme le HSM d'une API CSC signHash, via `openssl pkeyutl`
 * (clé éphémère de test écrite dans un répertoire temporaire 0700 puis supprimée). WebCrypto ne signe pas de condensé brut.
 */
export function createOpensslDigestSigner(key: TestKeyPair): RecordingDigestSigner {
  const calls: { digestSha256: Uint8Array; algorithm: SignatureAlgorithm }[] = [];
  return {
    calls,
    async signDigest(digestSha256, algorithm) {
      calls.push({ digestSha256, algorithm });
      if (algorithm !== key.algorithm) throw new Error('algorithme de test incohérent avec la clé');
      const directory = mkdtempSync(join(tmpdir(), 'fisca-seal-test-'), { encoding: 'utf8' });
      try {
        const pem = `${PEM_DASHES}BEGIN ${PEM_LABEL}${PEM_DASHES}\n${(toBase64(key.privateKeyPkcs8).match(/.{1,64}/g) ?? []).join('\n')}\n${PEM_DASHES}END ${PEM_LABEL}${PEM_DASHES}\n`;
        writeFileSync(join(directory, 'key.pem'), pem, { mode: 0o600 });
        writeFileSync(join(directory, 'digest.bin'), digestSha256);
        const args = ['pkeyutl', '-sign', '-inkey', join(directory, 'key.pem'), '-in', join(directory, 'digest.bin'), '-out', join(directory, 'sig.bin')];
        if (key.kind === 'rsa-2048') args.push('-pkeyopt', 'digest:sha256');
        const run = spawnSync('openssl', args, { encoding: 'utf8' });
        if (run.status !== 0) throw new Error(`openssl pkeyutl a échoué : ${run.stderr}`);
        const signature = new Uint8Array(readFileSync(join(directory, 'sig.bin')));
        if (key.kind === 'rsa-2048') return signature;
        return ecdsaDerToP1363(signature, 32);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

export async function createTestIdentity(kind: KeyKind, options: TestCertificateOptions = {}): Promise<TestIdentity> {
  const key = await generateTestKeyPair(kind);
  const certificateDer = await createSelfSignedTestCertificate(key, {
    organizationIdentifier: 'ICE000970000000097',
    serialNumberAttribute: '000970000000097',
    ...options,
  });
  return { key, certificateDer, signer: createOpensslDigestSigner(key) };
}

export interface TestTimestampProvider extends TimestampProvider {
  readonly label: string;
  readonly certificateDer: Uint8Array;
  readonly imprints: Uint8Array[];
}

/** Fake local de TSA RFC 3161 : TimeStampToken CMS signé par une clé éphémère de test. NON QUALIFIÉE. Jamais exportée depuis src/. */
export async function createTestTimestampProvider(options: { readonly now?: () => Date } = {}): Promise<TestTimestampProvider> {
  const key = await generateTestKeyPair('ecdsa-p256');
  const certificateDer = await createSelfSignedTestCertificate(key, { commonName: TEST_TSA_LABEL, timeStamping: true });
  const certificate = parseCertificate(certificateDer);
  const imprints: Uint8Array[] = [];
  let serial = 0;
  return {
    label: TEST_TSA_LABEL,
    certificateDer,
    imprints,
    async timestamp(messageImprintSha256) {
      imprints.push(messageImprintSha256);
      serial += 1;
      const genTime = options.now?.() ?? new Date();
      const tstInfo = sequence(
        integerFromBigInt(1n),
        oid(TEST_TSA_POLICY_OID),
        sequence(sequence(oid(OID.sha256), tlv(0x05)), octetString(messageImprintSha256)),
        integerFromBigInt(BigInt(serial)),
        generalizedTime(genTime),
      );
      const attributes = await buildSignedAttributes({
        certificate,
        signingTime: genTime,
        contentDigestSha256: await sha256(tstInfo),
        contentTypeOid: OID.tstInfo,
      });
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, attributes));
      return assembleCms({
        certificate,
        algorithm: 'ECDSA_P256_SHA256',
        signedAttributesSet: attributes,
        signatureValue: cmsSignatureValue('ECDSA_P256_SHA256', raw),
        eContent: { typeOid: OID.tstInfo, value: tstInfo },
      });
    },
  };
}
