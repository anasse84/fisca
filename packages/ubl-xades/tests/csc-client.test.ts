import { AdrInvariantError } from '@fisca/shared-types';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CscSignerError,
  fetchBaridEsignCscV2Certificate,
  normalizeCscSignature,
  signDigestViaBaridEsignCscV2,
  subjectDistinguishedNameForEmitterCheck,
  type BaridEsignCscV2Config,
  type CscSignerErrorCode,
  type SignatureAlgorithm,
} from '../src/index.ts';
import { sha256, toBase64, toHex, utf8 } from '../src/signature/bytes.ts';
import { OID, parseCertificate, rsaModulusLengthBytes } from '../src/signature/certificate.ts';
import { ecdsaP1363ToDer, integerFromUnsignedBytes, octetString, oid, sequence, setOf, tlv, utf8String } from '../src/signature/der.ts';
import { createFakeCscServer, PATHS, type FakeCscOptions, type FakeCscServer, type ScriptedReply } from './support/fake-csc-server.ts';
import { createOpensslDigestSigner, createSelfSignedTestCertificate, generateTestKeyPair, type TestKeyPair } from './support/test-pki.ts';

/** Identifiants de TEST (aucune donnée réelle) : ICE de 15 chiffres, IF de 8 chiffres. */
const ICE = '000970000000097';
const IF = '12345678';
const OTHER_ICE = '001197530853397';
const OTHER_IF = '87654321';
const SECRET = 'secret-de-test-barid-esign-csc';
const PIN = 'pin-de-test-4821';
const CREDENTIAL_ID = 'credential-de-test-GX0112348';
const ACCESS_TOKEN = 'jeton-acces-de-test';
const SAD = 'sad-de-test';

let ecKey: TestKeyPair;
let rsaKey: TestKeyPair;
beforeAll(async () => {
  ecKey = await generateTestKeyPair('ecdsa-p256');
  rsaKey = await generateTestKeyPair('rsa-2048');
}, 60_000);

const ECDSA_OIDS = [OID.ecdsaWithSha256];

/** Signe le condensé reçu comme le ferait un HSM (clé éphémère de test) ; `asDer` sert l'ECDSA en DER au lieu de r‖s. */
function hsm(key: TestKeyPair, asDer: boolean): (digest: Uint8Array) => Promise<Uint8Array> {
  const signer = createOpensslDigestSigner(key);
  return async (digest) => {
    const raw = await signer.signDigest(digest, key.algorithm);
    return asDer && key.kind === 'ecdsa-p256' ? ecdsaP1363ToDer(raw) : raw;
  };
}

interface Rig {
  readonly server: FakeCscServer;
  readonly config: BaridEsignCscV2Config;
  readonly authorizationDataCalls: { count: number };
}

async function certificateFor(key: TestKeyPair, options: Parameters<typeof createSelfSignedTestCertificate>[1]): Promise<Uint8Array> {
  return createSelfSignedTestCertificate(key, options);
}

function rig(
  certificateDer: Uint8Array,
  key: TestKeyPair,
  extra: { readonly server?: Partial<FakeCscOptions>; readonly config?: Partial<BaridEsignCscV2Config>; readonly asDer?: boolean } = {},
): Rig {
  const authorizationDataCalls = { count: 0 };
  const server = createFakeCscServer({
    certificateDer,
    keyAlgoOids: key.kind === 'ecdsa-p256' ? ECDSA_OIDS : [OID.sha256WithRsa],
    sign: hsm(key, extra.asDer ?? false),
    accessToken: ACCESS_TOKEN,
    sad: SAD,
    ...extra.server,
  });
  const config: BaridEsignCscV2Config = {
    baseUrl: 'https://csc.barid-esign.test/',
    http: server.client,
    credentialId: CREDENTIAL_ID,
    emitterIce: ICE,
    emitterIf: IF,
    auth: { clientId: 'client-de-test', clientSecret: SECRET },
    authorizationData: () => {
      authorizationDataCalls.count += 1;
      return Promise.resolve([{ id: 'PIN', value: PIN }]);
    },
    timeoutMs: 2000,
    ...extra.config,
  };
  return { server, config, authorizationDataCalls };
}

const MESSAGE = utf8('document à signer — test CSC v2');

async function digestOfMessage(): Promise<Uint8Array> {
  return sha256(MESSAGE);
}

async function verifies(key: TestKeyPair, signature: Uint8Array): Promise<boolean> {
  const publicKey = await crypto.subtle.importKey(
    'spki',
    key.publicKeySpki,
    key.kind === 'ecdsa-p256' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(key.kind === 'ecdsa-p256' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' }, publicKey, signature, MESSAGE);
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return expect.unreachable('la promesse aurait dû être rejetée');
}

async function expectCsc(promise: Promise<unknown>, code: CscSignerErrorCode): Promise<CscSignerError> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(CscSignerError);
  expect((error as CscSignerError).code).toBe(code);
  return error as CscSignerError;
}

describe('requêtes CSC v2.0 : noms exacts des points d’accès et des paramètres', () => {
  it('login → info → authorize → signHash, un appel chacun, avec les paramètres de la spécification CSC 2.0.0.2', async () => {
    const certificate = await certificateFor(ecKey, { organizationIdentifier: `NTRMA-${ICE}` });
    const { server, config, authorizationDataCalls } = rig(certificate, ecKey);
    const digest = await digestOfMessage();
    const signature = await signDigestViaBaridEsignCscV2(config).signDigest(digest, 'ECDSA_P256_SHA256');
    expect(signature.length).toBe(64);
    expect(await verifies(ecKey, signature)).toBe(true);
    expect(server.calls.map((call) => call.path)).toEqual([PATHS.login, PATHS.info, PATHS.authorize, PATHS.signHash]);
    expect(authorizationDataCalls.count).toBe(1);
    const [login, info, authorize, signHash] = server.calls;
    expect(login?.headers['Authorization']).toBe(`Basic ${toBase64(utf8(`client-de-test:${SECRET}`))}`);
    expect(login?.body).toEqual({ rememberMe: false });
    expect(info?.headers['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(info?.body).toEqual({ credentialID: CREDENTIAL_ID, certificates: 'single', certInfo: false, authInfo: false });
    const hash = toBase64(digest);
    expect(authorize?.body).toEqual({
      credentialID: CREDENTIAL_ID,
      numSignatures: 1,
      hashes: [hash],
      hashAlgorithmOID: '2.16.840.1.101.3.4.2.1',
      authData: [{ id: 'PIN', value: PIN }],
    });
    expect(signHash?.headers['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(signHash?.body).toEqual({ credentialID: CREDENTIAL_ID, SAD, hashes: [hash], hashAlgorithmOID: '2.16.840.1.101.3.4.2.1', signAlgo: '1.2.840.10045.4.3.2' });
    // Le secret n'apparaît que dans l'en-tête du login ; seul le condensé de 32 octets part vers signHash (aucun clientData, aucun document).
    for (const call of [info, authorize, signHash]) expect(JSON.stringify(call)).not.toContain(SECRET);
    expect(JSON.stringify(signHash?.body)).not.toContain('clientData');
  });

  it('RSA : signAlgo sha256WithRSAEncryption, ou rsaEncryption si le credential n’annonce que celui-là', async () => {
    const certificate = await certificateFor(rsaKey, { organizationIdentifier: `VATMA-${IF}` });
    const first = rig(certificate, rsaKey);
    await signDigestViaBaridEsignCscV2(first.config).signDigest(await digestOfMessage(), 'RSA_PKCS1_SHA256');
    expect(first.server.calls.at(-1)?.body['signAlgo']).toBe('1.2.840.113549.1.1.11');
    const second = rig(certificate, rsaKey, { server: { keyAlgoOids: [OID.rsaEncryption] } });
    await signDigestViaBaridEsignCscV2(second.config).signDigest(await digestOfMessage(), 'RSA_PKCS1_SHA256');
    expect(second.server.calls.at(-1)?.body['signAlgo']).toBe('1.2.840.113549.1.1.1');
    const third = rig(certificate, rsaKey, { server: { keyAlgoOids: ['1.2.3.4'] } });
    await expectCsc(signDigestViaBaridEsignCscV2(third.config).signDigest(await digestOfMessage(), 'RSA_PKCS1_SHA256'), 'CSC_ALGORITHM_UNSUPPORTED');
    expect(third.server.count(PATHS.signHash)).toBe(0);
  });
});

describe('contrôle BLOQUANT OID X.509 == ICE/IF émetteur (assertCertificateMatchesEmitter)', () => {
  const accepted: readonly (readonly [string, string])[] = [
    ['organizationIdentifier NTRMA-<ICE>', `NTRMA-${ICE}`],
    ['organizationIdentifier ICEMA-<ICE>', `ICEMA-${ICE}`],
    ['organizationIdentifier VATMA-<IF>', `VATMA-${IF}`],
    ['organizationIdentifier IFMA-<IF>', `IFMA-${IF}`],
  ];
  it.each(accepted)('certificat conforme (%s) : signature produite, signHash appelé une fois', async (_label, value) => {
    const certificate = await certificateFor(ecKey, { organizationIdentifier: value });
    const { server, config } = rig(certificate, ecKey);
    const signature = await signDigestViaBaridEsignCscV2(config).signDigest(await digestOfMessage(), 'ECDSA_P256_SHA256');
    expect(await verifies(ecKey, signature)).toBe(true);
    expect(server.count(PATHS.signHash)).toBe(1);
  });

  it('serialNumber (2.5.4.5) portant l’ICE nue : accepté', async () => {
    const certificate = await certificateFor(ecKey, { serialNumberAttribute: ICE });
    const { server, config } = rig(certificate, ecKey);
    await signDigestViaBaridEsignCscV2(config).signDigest(await digestOfMessage(), 'ECDSA_P256_SHA256');
    expect(server.count(PATHS.signHash)).toBe(1);
  });

  const refused: readonly (readonly [string, Parameters<typeof createSelfSignedTestCertificate>[1]])[] = [
    ['certificat valide d’un AUTRE émetteur (ICE)', { organizationIdentifier: `NTRMA-${OTHER_ICE}` }],
    ['certificat d’un autre émetteur (IF)', { organizationIdentifier: `VATMA-${OTHER_IF}` }],
    ['CN seul trompeur : le CN porte l’ICE, aucun identifiant 2.5.4.97/2.5.4.5', { commonName: `SOCIETE ${ICE} ${IF}` }],
    ['CN trompeur, identifiants d’un autre émetteur', { commonName: `SOCIETE ${ICE}`, organizationIdentifier: `NTRMA-${OTHER_ICE}`, serialNumberAttribute: OTHER_ICE }],
    ['organizationIdentifier et serialNumber absents', {}],
    ['préfixe ETSI étranger (VATFR-)', { organizationIdentifier: `VATFR-${IF}` }],
    ['valeur qui tente d’injecter un second attribut', { organizationIdentifier: `x,2.5.4.97=NTRMA-${ICE}` }],
    ['valeur qui tente un second attribut par « + » et « / »', { organizationIdentifier: `x+2.5.4.97=${ICE}/2.5.4.5=${ICE}` }],
  ];
  it.each(refused)('refusé AVANT signHash : %s', async (_label, certificateOptions) => {
    const certificate = await certificateFor(ecKey, certificateOptions);
    const { server, config, authorizationDataCalls } = rig(certificate, ecKey);
    const error = await rejection(signDigestViaBaridEsignCscV2(config).signDigest(await digestOfMessage(), 'ECDSA_P256_SHA256'));
    expect(error).toBeInstanceOf(AdrInvariantError);
    expect((error as AdrInvariantError).code).toBe('ADR_06_LOI4320_CERT_MISMATCH');
    expect(server.count(PATHS.signHash)).toBe(0);
    expect(server.count(PATHS.authorize)).toBe(0);
    expect(authorizationDataCalls.count).toBe(0);
    expect(server.calls.map((call) => call.path)).toEqual([PATHS.login, PATHS.info]);
  });

  it('fetchBaridEsignCscV2Certificate applique le même contrôle et rend le DER conforme', async () => {
    const good = await certificateFor(ecKey, { organizationIdentifier: `NTRMA-${ICE}` });
    expect(toHex(await fetchBaridEsignCscV2Certificate(rig(good, ecKey).config))).toBe(toHex(good));
    const bad = await certificateFor(ecKey, { organizationIdentifier: `NTRMA-${OTHER_ICE}` });
    const error = await rejection(fetchBaridEsignCscV2Certificate(rig(bad, ecKey).config));
    expect((error as AdrInvariantError).code).toBe('ADR_06_LOI4320_CERT_MISMATCH');
  });

  it('ICE ou IF d’émetteur mal formé : refus (échec fermé de l’invariant) avant signHash', async () => {
    const certificate = await certificateFor(ecKey, { organizationIdentifier: `NTRMA-${ICE}` });
    const { server, config } = rig(certificate, ecKey, { config: { emitterIce: '123' } });
    const error = await rejection(signDigestViaBaridEsignCscV2(config).signDigest(await digestOfMessage(), 'ECDSA_P256_SHA256'));
    expect((error as AdrInvariantError).code).toBe('ADR_06_LOI4320_CERT_MISMATCH');
    expect(server.count(PATHS.signHash)).toBe(0);
  });

  it('certificat différent du certificat attendu (expectedCertificateDer) : CSC_CERTIFICATE_CHANGED, pas de signHash', async () => {
    const served = await certificateFor(ecKey, { organizationIdentifier: `NTRMA-${ICE}` });
    const expected = await certificateFor(ecKey, { organizationIdentifier: `NTRMA-${ICE}` });
    const { server, config } = rig(served, ecKey, { config: { expectedCertificateDer: expected } });
    await expectCsc(signDigestViaBaridEsignCscV2(config).signDigest(await digestOfMessage(), 'ECDSA_P256_SHA256'), 'CSC_CERTIFICATE_CHANGED');
    expect(server.count(PATHS.signHash)).toBe(0);
  });

  it('algorithme demandé différent de la clé du certificat : refus avant signHash', async () => {
    const certificate = await certificateFor(ecKey, { organizationIdentifier: `NTRMA-${ICE}` });
    const { server, config } = rig(certificate, ecKey);
    await expectCsc(signDigestViaBaridEsignCscV2(config).signDigest(await digestOfMessage(), 'RSA_PKCS1_SHA256'), 'CSC_CERTIFICATE_ALGORITHM_MISMATCH');
    expect(server.count(PATHS.signHash)).toBe(0);
  });

  it('certificat absent, non base64 ou illisible : CSC_CERTIFICATE_UNAVAILABLE', async () => {
    const certificate = await certificateFor(ecKey, { organizationIdentifier: `NTRMA-${ICE}` });
    const bodies = [
      { key: { status: 'enabled', algo: ECDSA_OIDS }, cert: { status: 'valid' } },
      { key: { status: 'enabled', algo: ECDSA_OIDS }, cert: { status: 'valid', certificates: ['@@@'] } },
      { key: { status: 'enabled', algo: ECDSA_OIDS }, cert: { status: 'valid', certificates: [toBase64(utf8('pas un certificat'))] } },
    ];
    for (const body of bodies) {
      const { server, config } = rig(certificate, ecKey, { server: { script: { [PATHS.info]: [{ status: 200, body }] } } });
      await expectCsc(signDigestViaBaridEsignCscV2(config).signDigest(await digestOfMessage(), 'ECDSA_P256_SHA256'), 'CSC_CERTIFICATE_UNAVAILABLE');
      expect(server.count(PATHS.signHash)).toBe(0);
    }
  });

  it('extraction DN : OID 2.5.4.97 et 2.5.4.5 lus dans le DER, échappements, types non textuels omis', () => {
    const attribute = (type: string, value: Uint8Array): Uint8Array => setOf(sequence(oid(type), value));
    const name = sequence(
      attribute('2.5.4.6', tlv(0x13, utf8('MA'))),
      attribute('2.5.4.97', utf8String(`NTRMA-${ICE}`)),
      attribute('2.5.4.5', tlv(0x16, utf8(IF))),
      attribute('2.5.4.10', utf8String('A, B + C / D "E" \\F')),
      attribute('2.5.4.3', utf8String('CN')),
    );
    expect(subjectDistinguishedNameForEmitterCheck(name)).toBe(`CN=CN,O=A\\, B \\+ C \\/ D \\"E\\" \\\\F,2.5.4.5=${IF},2.5.4.97=NTRMA-${ICE},C=MA`);
    const bmp = sequence(attribute('2.5.4.97', tlv(0x1e, Uint8Array.of(0, 0x41))), attribute('2.5.4.97', tlv(0x0c, Uint8Array.of(0xff, 0xfe))));
    expect(subjectDistinguishedNameForEmitterCheck(bmp)).toBe('');
    expect(() => subjectDistinguishedNameForEmitterCheck(Uint8Array.of(1, 2, 3))).toThrow(/illisible/);
  });
});

describe('conversion de format de la signature rendue par signHash (décision du pilote)', () => {
  it('ECDSA : DER SEQUENCE{r,s} → r‖s de 64 octets, vérifié par crypto.subtle.verify', async () => {
    const certificate = await certificateFor(ecKey, { organizationIdentifier: `NTRMA-${ICE}` });
    const { config } = rig(certificate, ecKey, { asDer: true });
    const signature = await signDigestViaBaridEsignCscV2(config).signDigest(await digestOfMessage(), 'ECDSA_P256_SHA256');
    expect(signature.length).toBe(64);
    expect(await verifies(ecKey, signature)).toBe(true);
  });

  it('ECDSA : r‖s déjà brut → inchangé, vérifié par crypto.subtle.verify', async () => {
    const certificate = await certificateFor(ecKey, { organizationIdentifier: `NTRMA-${ICE}` });
    const { config } = rig(certificate, ecKey, { asDer: false });
    const signature = await signDigestViaBaridEsignCscV2(config).signDigest(await digestOfMessage(), 'ECDSA_P256_SHA256');
    expect(signature.length).toBe(64);
    expect(await verifies(ecKey, signature)).toBe(true);
  });

  it('RSA : octets bruts de la longueur du module (256), vérifiés par crypto.subtle.verify', async () => {
    const certificate = await certificateFor(rsaKey, { organizationIdentifier: `NTRMA-${ICE}` });
    expect(rsaModulusLengthBytes(parseCertificate(certificate).spkiDer)).toBe(256);
    const { config } = rig(certificate, rsaKey);
    const signature = await signDigestViaBaridEsignCscV2(config).signDigest(await digestOfMessage(), 'RSA_PKCS1_SHA256');
    expect(signature.length).toBe(256);
    expect(await verifies(rsaKey, signature)).toBe(true);
  });

  describe('normalizeCscSignature : entiers DER complétés ou rognés', () => {
    const r = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const s = Uint8Array.from({ length: 32 }, (_, index) => 0x80 + index);
    const der = (...integers: readonly Uint8Array[]): Uint8Array => sequence(...integers.map((integer) => integerFromUnsignedBytes(integer)));

    it('rogne le 0x00 de signe (s ≥ 0x80) et complète les entiers courts à 32 octets', () => {
      const expected = new Uint8Array(64);
      expected.set(r, 0);
      expected.set(s, 32);
      expect(toHex(normalizeCscSignature(der(r, s), 'ECDSA_P256_SHA256'))).toBe(toHex(expected));
      const shortR = Uint8Array.from([0, 0, 0, ...r.subarray(3)]);
      const padded = new Uint8Array(64);
      padded.set(shortR, 0);
      padded.set(s, 32);
      expect(toHex(normalizeCscSignature(der(shortR, s), 'ECDSA_P256_SHA256'))).toBe(toHex(padded));
      const tiny = new Uint8Array(64);
      tiny[31] = 1;
      tiny[63] = 2;
      expect(toHex(normalizeCscSignature(der(Uint8Array.of(1), Uint8Array.of(2)), 'ECDSA_P256_SHA256'))).toBe(toHex(tiny));
    });

    it('r‖s de 64 octets déjà brut : copie identique', () => {
      const raw = new Uint8Array(64);
      raw.set(r, 0);
      raw.set(s, 32);
      const out = normalizeCscSignature(raw, 'ECDSA_P256_SHA256');
      expect(toHex(out)).toBe(toHex(raw));
      expect(out).not.toBe(raw);
    });

    const refusals: readonly (readonly [string, () => Uint8Array, SignatureAlgorithm, number | undefined])[] = [
      ['ECDSA : longueur inattendue (65)', () => new Uint8Array(65).fill(7), 'ECDSA_P256_SHA256', undefined],
      ['ECDSA : longueur inattendue (63)', () => new Uint8Array(63).fill(7), 'ECDSA_P256_SHA256', undefined],
      ['ECDSA : vide', () => new Uint8Array(0), 'ECDSA_P256_SHA256', undefined],
      ['ECDSA : r‖s brut avec r nul', () => Uint8Array.from({ length: 64 }, (_, index) => (index < 32 ? 0 : 5)), 'ECDSA_P256_SHA256', undefined],
      ['ECDSA : DER invalide (troncature)', () => der(r, s).subarray(0, 40), 'ECDSA_P256_SHA256', undefined],
      ['ECDSA : DER avec octets en trop', () => Uint8Array.from([...der(r, s), 0]), 'ECDSA_P256_SHA256', undefined],
      ['ECDSA : DER à trois entiers', () => der(r, s, r), 'ECDSA_P256_SHA256', undefined],
      ['ECDSA : DER dont un élément n’est pas un entier', () => sequence(integerFromUnsignedBytes(r), octetString(s)), 'ECDSA_P256_SHA256', undefined],
      ['ECDSA : entier négatif (0x80… sans octet de signe)', () => sequence(tlv(0x02, Uint8Array.from([0x80, ...r.subarray(1)])), integerFromUnsignedBytes(s)), 'ECDSA_P256_SHA256', undefined],
      ['ECDSA : zéro de tête superflu', () => sequence(tlv(0x02, Uint8Array.from([0, 1, 2])), integerFromUnsignedBytes(s)), 'ECDSA_P256_SHA256', undefined],
      ['ECDSA : entier de plus de 32 octets (33 significatifs)', () => sequence(integerFromUnsignedBytes(Uint8Array.from({ length: 33 }, () => 1)), integerFromUnsignedBytes(s)), 'ECDSA_P256_SHA256', undefined],
      ['ECDSA : s nul', () => sequence(integerFromUnsignedBytes(r), tlv(0x02, Uint8Array.of(0))), 'ECDSA_P256_SHA256', undefined],
      ['ECDSA : ni brut ni DER (premier octet inconnu)', () => new Uint8Array(70).fill(9), 'ECDSA_P256_SHA256', undefined],
      ['RSA : longueur différente du module (255 pour 256)', () => new Uint8Array(255).fill(3), 'RSA_PKCS1_SHA256', 256],
      ['RSA : longueur différente du module (257 pour 256)', () => new Uint8Array(257).fill(3), 'RSA_PKCS1_SHA256', 256],
      ['RSA : enveloppe DER (OCTET STRING) au lieu d’octets bruts', () => octetString(new Uint8Array(256).fill(3)), 'RSA_PKCS1_SHA256', 256],
      ['RSA : longueur du module inconnue', () => new Uint8Array(256).fill(3), 'RSA_PKCS1_SHA256', undefined],
      ['algorithme non supporté', () => new Uint8Array(64).fill(3), 'RSA_PSS_SHA256' as unknown as SignatureAlgorithm, 256],
    ];
    it.each(refusals)('échec fermé : %s', (_label, build, algorithm, modulus) => {
      const options = modulus === undefined ? {} : { rsaModulusLength: modulus };
      let thrown: unknown;
      try {
        normalizeCscSignature(build(), algorithm, options);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CscSignerError);
      expect(['CSC_SIGNATURE_FORMAT_UNSUPPORTED', 'CSC_ALGORITHM_UNSUPPORTED']).toContain((thrown as CscSignerError).code);
    });
  });

  it('format inconnu retourné par le faux serveur : échec fermé après signHash (un seul appel)', async () => {
    const certificate = await certificateFor(ecKey, { organizationIdentifier: `NTRMA-${ICE}` });
    const { server, config } = rig(certificate, ecKey, { server: { sign: () => Promise.resolve(new Uint8Array(65).fill(1)) } });
    const error = await expectCsc(signDigestViaBaridEsignCscV2(config).signDigest(await digestOfMessage(), 'ECDSA_P256_SHA256'), 'CSC_SIGNATURE_FORMAT_UNSUPPORTED');
    expect(error.phase).toBe('signHash');
    expect(server.count(PATHS.signHash)).toBe(1);
  });
});

describe('gestion d’erreurs CSC (faux client scripté)', () => {
  let certificate: Uint8Array;
  beforeAll(async () => {
    certificate = await certificateFor(ecKey, { organizationIdentifier: `NTRMA-${ICE}` });
  });
  const sign = async (rigged: Rig): Promise<Uint8Array> => signDigestViaBaridEsignCscV2(rigged.config).signDigest(await digestOfMessage(), 'ECDSA_P256_SHA256');
  const scripted = (path: (typeof PATHS)[keyof typeof PATHS], ...replies: readonly ScriptedReply[]): Partial<FakeCscOptions> => ({ script: { [path]: replies } });

  const signHashFailures: readonly (readonly [string, ScriptedReply, CscSignerErrorCode])[] = [
    ['500', { status: 500, body: { error: 'server_error' } }, 'CSC_SERVER_ERROR'],
    ['503', { status: 503, body: {} }, 'CSC_SERVER_ERROR'],
    ['400 SAD expiré', { status: 400, body: { error: 'invalid_request', error_description: 'SAD expired' } }, 'CSC_SAD_EXPIRED'],
    ['400 credential expiré', { status: 400, body: { error: 'invalid_request', error_description: 'Signing certificate is expired.' } }, 'CSC_CREDENTIAL_UNAVAILABLE'],
    ['400 credential désactivé', { status: 400, body: { error: 'invalid_request', error_description: 'The credential is disabled' } }, 'CSC_CREDENTIAL_UNAVAILABLE'],
    ['400 OTP invalide', { status: 400, body: { error: 'invalid_otp', error_description: 'The OTP is invalid' } }, 'CSC_AUTHORIZATION_REFUSED'],
    ['400 autre', { status: 400, body: { error: 'invalid_request', error_description: 'Invalid digest value length' } }, 'CSC_REQUEST_REJECTED'],
    ['401', { status: 401, body: {} }, 'CSC_AUTH_FAILED'],
    ['404 sans corps JSON', { status: 404, body: undefined }, 'CSC_REQUEST_REJECTED'],
  ];
  it.each(signHashFailures)('signHash %s : erreur typée, un seul appel signHash (aucun retry silencieux)', async (_label, reply, code) => {
    const rigged = rig(certificate, ecKey, { server: scripted(PATHS.signHash, reply, reply, reply), config: { loginRetries: 2 } });
    const error = await expectCsc(sign(rigged), code);
    expect(error.phase).toBe('signHash');
    expect(rigged.server.count(PATHS.signHash)).toBe(1);
    expect(rigged.server.count(PATHS.login)).toBe(1);
  });

  it('délai dépassé sur signHash : CSC_TIMEOUT, issue inconnue, jamais rejoué', async () => {
    const rigged = rig(certificate, ecKey, { server: scripted(PATHS.signHash, { hang: true }), config: { timeoutMs: 25, loginRetries: 2 } });
    const error = await expectCsc(sign(rigged), 'CSC_TIMEOUT');
    expect(error.phase).toBe('signHash');
    expect(rigged.server.count(PATHS.signHash)).toBe(1);
  });

  it('délai dépassé même si le client ignore le signal d’interruption', async () => {
    const stuck = { fetch: () => new Promise<never>(() => undefined) };
    const rigged = rig(certificate, ecKey, { config: { http: stuck, timeoutMs: 25 } });
    await expectCsc(sign(rigged), 'CSC_TIMEOUT');
  });

  it('échec réseau sur signHash : CSC_NETWORK_ERROR, un seul appel', async () => {
    const rigged = rig(certificate, ecKey, { server: scripted(PATHS.signHash, { networkError: true }), config: { loginRetries: 2 } });
    await expectCsc(sign(rigged), 'CSC_NETWORK_ERROR');
    expect(rigged.server.count(PATHS.signHash)).toBe(1);
  });

  it('authorize : erreurs typées, pas de signHash, un seul appel authorize', async () => {
    const cases: readonly (readonly [ScriptedReply, CscSignerErrorCode])[] = [
      [{ status: 400, body: { error: 'invalid_authentication_data', error_description: 'The authentication data is invalid' } }, 'CSC_AUTHORIZATION_REFUSED'],
      [{ status: 400, body: { error: 'invalid_request', error_description: 'Credential locked' } }, 'CSC_CREDENTIAL_UNAVAILABLE'],
      [{ status: 202, body: { handle: 'h' } }, 'CSC_AUTHORIZATION_UNSUPPORTED'],
      [{ status: 500, body: {} }, 'CSC_SERVER_ERROR'],
      [{ status: 200, body: {} }, 'CSC_RESPONSE_INVALID'],
    ];
    for (const [reply, code] of cases) {
      const rigged = rig(certificate, ecKey, { server: scripted(PATHS.authorize, reply, reply), config: { loginRetries: 2 } });
      const error = await expectCsc(sign(rigged), code);
      expect(error.phase).toBe('credentialsAuthorize');
      expect(rigged.server.count(PATHS.authorize)).toBe(1);
      expect(rigged.server.count(PATHS.signHash)).toBe(0);
    }
  });

  it('credentials/info : credential désactivé, certificat non valide ou erreur 5xx : pas de signHash', async () => {
    const bodies = [
      { key: { status: 'disabled', algo: ECDSA_OIDS }, cert: { status: 'valid', certificates: [toBase64(certificate)] } },
      { key: { status: 'enabled', algo: ECDSA_OIDS }, cert: { status: 'revoked', certificates: [toBase64(certificate)] } },
    ];
    for (const body of bodies) {
      const rigged = rig(certificate, ecKey, { server: scripted(PATHS.info, { status: 200, body }) });
      await expectCsc(sign(rigged), 'CSC_CREDENTIAL_UNAVAILABLE');
      expect(rigged.server.count(PATHS.signHash)).toBe(0);
    }
    const invalid = rig(certificate, ecKey, { server: scripted(PATHS.info, { status: 200, body: { nope: true } }) });
    await expectCsc(sign(invalid), 'CSC_RESPONSE_INVALID');
    const down = rig(certificate, ecKey, { server: scripted(PATHS.info, { status: 503, body: {} }), config: { loginRetries: 2 } });
    await expectCsc(sign(down), 'CSC_SERVER_ERROR');
    expect(down.server.count(PATHS.info)).toBe(1);
    expect(down.server.count(PATHS.login)).toBe(1);
  });

  it('réponse signHash invalide : signatures absentes, vides, multiples ou non base64', async () => {
    const bodies: readonly unknown[] = [{}, { signatures: [] }, { signatures: ['AAAA', 'AAAA'] }, { signatures: [7] }, { signatures: ['@@@@'] }, 'texte'];
    for (const body of bodies) {
      const rigged = rig(certificate, ecKey, { server: scripted(PATHS.signHash, { status: 200, body }) });
      await expectCsc(sign(rigged), 'CSC_RESPONSE_INVALID');
      expect(rigged.server.count(PATHS.signHash)).toBe(1);
    }
  });

  describe('auth/login : seul appel avec retry explicite', () => {
    it('par défaut aucun retry : un 503 échoue après un appel', async () => {
      const rigged = rig(certificate, ecKey, { server: scripted(PATHS.login, { status: 503, body: {} }) });
      await expectCsc(sign(rigged), 'CSC_SERVER_ERROR');
      expect(rigged.server.count(PATHS.login)).toBe(1);
    });
    it('loginRetries=1 : un 503 puis succès → signature, deux appels login, un seul signHash', async () => {
      const rigged = rig(certificate, ecKey, { server: scripted(PATHS.login, { status: 503, body: {} }), config: { loginRetries: 1 } });
      expect((await sign(rigged)).length).toBe(64);
      expect(rigged.server.count(PATHS.login)).toBe(2);
      expect(rigged.server.count(PATHS.signHash)).toBe(1);
    });
    it('loginRetries=2 : réseau, délai puis succès ; épuisement → dernière erreur', async () => {
      const ok = rig(certificate, ecKey, { server: scripted(PATHS.login, { networkError: true }, { hang: true }), config: { loginRetries: 2, timeoutMs: 25 } });
      expect((await sign(ok)).length).toBe(64);
      expect(ok.server.count(PATHS.login)).toBe(3);
      const failing = rig(certificate, ecKey, { server: scripted(PATHS.login, { status: 500, body: {} }, { status: 500, body: {} }, { status: 502, body: {} }), config: { loginRetries: 2 } });
      await expectCsc(sign(failing), 'CSC_SERVER_ERROR');
      expect(failing.server.count(PATHS.login)).toBe(3);
      expect(failing.server.count(PATHS.signHash)).toBe(0);
    });
    it('un refus d’authentification (400/401) n’est jamais rejoué', async () => {
      for (const reply of [{ status: 400, body: { error: 'authentication_error' } }, { status: 401, body: {} }] as const) {
        const rigged = rig(certificate, ecKey, { server: scripted(PATHS.login, reply, reply), config: { loginRetries: 2 } });
        await expectCsc(sign(rigged), 'CSC_AUTH_FAILED');
        expect(rigged.server.count(PATHS.login)).toBe(1);
      }
    });
    it('réponse sans access_token : CSC_RESPONSE_INVALID, pas de retry', async () => {
      const rigged = rig(certificate, ecKey, { server: scripted(PATHS.login, { status: 200, body: { token: 'x' } }), config: { loginRetries: 2 } });
      await expectCsc(sign(rigged), 'CSC_RESPONSE_INVALID');
      expect(rigged.server.count(PATHS.login)).toBe(1);
    });
  });

  it('données d’autorisation indisponibles : erreur typée, rien n’est envoyé à authorize', async () => {
    const rigged = rig(certificate, ecKey, { config: { authorizationData: () => Promise.reject(new Error(`PIN ${PIN} illisible`)) } });
    const error = await expectCsc(sign(rigged), 'CSC_AUTHORIZATION_DATA_UNAVAILABLE');
    expect(`${error.message}${String(error.stack)}`).not.toContain(PIN);
    expect(rigged.server.count(PATHS.authorize)).toBe(0);
  });

  it('configuration invalide et condensé invalide : refus avant tout appel réseau', async () => {
    const base = rig(certificate, ecKey).config;
    const bad: readonly Partial<BaridEsignCscV2Config>[] = [
      { baseUrl: 'http://csc.barid-esign.test' },
      { baseUrl: 'csc.barid-esign.test' },
      { credentialId: '' },
      { auth: { clientId: 'a:b', clientSecret: SECRET } },
      { auth: { clientId: 'a', clientSecret: '' } },
      { timeoutMs: 0 },
      { loginRetries: 3 },
      { loginRetries: -1 },
    ];
    for (const override of bad) {
      let thrown: unknown;
      try {
        signDigestViaBaridEsignCscV2({ ...base, ...override });
      } catch (error) {
        thrown = error;
      }
      expect((thrown as CscSignerError).code).toBe('CSC_CONFIG_INVALID');
      expect(JSON.stringify(thrown)).not.toContain(SECRET);
    }
    const rigged = rig(certificate, ecKey);
    const signer = signDigestViaBaridEsignCscV2(rigged.config);
    await expectCsc(signer.signDigest(new Uint8Array(31), 'ECDSA_P256_SHA256'), 'CSC_DIGEST_INVALID');
    await expectCsc(signer.signDigest(new Uint8Array(32), 'ED25519' as unknown as SignatureAlgorithm), 'CSC_ALGORITHM_UNSUPPORTED');
    expect(rigged.server.calls.length).toBe(0);
  });

  it('aucun secret ni donnée personnelle dans les messages, codes ni sérialisations d’erreur, même si le serveur les renvoie', async () => {
    const leak = `${SECRET} ${PIN} ${ICE} ${IF} ${CREDENTIAL_ID} ${ACCESS_TOKEN} ${SAD} CN=Dupont Jean,O=Société Réelle`;
    const hostile = { error: `invalid_request ${SECRET}`, error_description: `SAD expired ${leak}`, access_token: leak };
    const scenarios: readonly { readonly path: (typeof PATHS)[keyof typeof PATHS]; readonly reply: ScriptedReply }[] = [
      { path: PATHS.login, reply: { status: 400, body: hostile } },
      { path: PATHS.info, reply: { status: 400, body: hostile } },
      { path: PATHS.authorize, reply: { status: 400, body: hostile } },
      { path: PATHS.signHash, reply: { status: 400, body: hostile } },
      { path: PATHS.signHash, reply: { status: 500, body: hostile } },
      { path: PATHS.signHash, reply: { networkError: true } },
      { path: PATHS.signHash, reply: { status: 200, body: { signatures: [leak] } } },
    ];
    const forbidden = [SECRET, PIN, ICE, CREDENTIAL_ID, SAD, 'Dupont', 'Société Réelle', toBase64(utf8(`client-de-test:${SECRET}`))];
    for (const scenario of scenarios) {
      const rigged = rig(certificate, ecKey, { server: scripted(scenario.path, scenario.reply) });
      const error = await rejection(sign(rigged));
      expect(error).toBeInstanceOf(CscSignerError);
      const printed = `${(error as Error).message}|${String((error as Error).stack)}|${JSON.stringify(error)}|${(error as CscSignerError).cscError ?? ''}|${(error as CscSignerError).code}`;
      for (const value of forbidden) expect(printed, `${scenario.path} ${value}`).not.toContain(value);
      expect((error as Error).cause).toBeUndefined();
    }
  });
});
