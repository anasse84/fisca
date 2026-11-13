import { toBase64 } from './bytes.ts';
import { children, decodeInteger, decodeOid, derNull, expectTag, explicit, integerFromUnsignedBytes, oid, parseDer, sequence, TAG, type DerNode } from './der.ts';
import { UblSignatureError } from './errors.ts';
import type { SignatureAlgorithm } from './types.ts';

/** Lecture minimale d'un certificat X.509 DER : émetteur, numéro de série, clé publique. Aucune validation de chaîne (hors périmètre, P2A-05). */

export const OID = {
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
  sha256WithRsa: '1.2.840.113549.1.1.11',
  ecPublicKey: '1.2.840.10045.2.1',
  prime256v1: '1.2.840.10045.3.1.7',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  timeStampTokenAttr: '1.2.840.113549.1.9.16.2.14',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
} as const;

export interface ParsedCertificate {
  readonly der: Uint8Array;
  readonly issuerDer: Uint8Array;
  /** Encodage DER complet de l'INTEGER du numéro de série. */
  readonly serialDer: Uint8Array;
  readonly serialNumber: bigint;
  readonly spkiDer: Uint8Array;
  readonly algorithm: SignatureAlgorithm;
}

function invalid(): UblSignatureError {
  return new UblSignatureError('CERTIFICATE_INVALID', 'Certificat X.509 illisible.');
}

export function parseCertificate(der: Uint8Array): ParsedCertificate {
  try {
    const certificate = children(expectTag(parseDer(der), TAG.SEQUENCE));
    const tbs = children(expectTag(certificate[0], TAG.SEQUENCE));
    let index = tbs[0]?.tag === 0xa0 ? 1 : 0;
    const serial = expectTag(tbs[index], TAG.INTEGER);
    index += 2; // numéro de série, algorithme de signature
    const issuer = expectTag(tbs[index], TAG.SEQUENCE);
    const spki = expectTag(tbs[index + 3], TAG.SEQUENCE);
    const spkiParts = children(spki);
    const algorithmParts = children(expectTag(spkiParts[0], TAG.SEQUENCE));
    const keyOid = decodeOid(expectTag(algorithmParts[0], TAG.OID));
    let algorithm: SignatureAlgorithm;
    if (keyOid === OID.rsaEncryption) algorithm = 'RSA_PKCS1_SHA256';
    else if (keyOid === OID.ecPublicKey && algorithmParts[1] !== undefined && decodeOid(algorithmParts[1]) === OID.prime256v1) algorithm = 'ECDSA_P256_SHA256';
    else throw new UblSignatureError('CERTIFICATE_KEY_UNSUPPORTED', 'Clé du certificat non supportée (RSA ou ECDSA P-256 attendus).');
    return { der, issuerDer: issuer.raw, serialDer: serial.raw, serialNumber: decodeInteger(serial), spkiDer: spki.raw, algorithm };
  } catch (error) {
    if (error instanceof UblSignatureError) {
      if (error.code === 'CERTIFICATE_KEY_UNSUPPORTED') throw error;
      throw invalid();
    }
    throw error;
  }
}

/** Importe la clé publique du certificat pour crypto.subtle.verify. */
export async function importCertificatePublicKey(certificate: ParsedCertificate): Promise<Awaited<ReturnType<typeof crypto.subtle.importKey>>> {
  const algorithm =
    certificate.algorithm === 'ECDSA_P256_SHA256'
      ? ({ name: 'ECDSA', namedCurve: 'P-256' } as const)
      : ({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const);
  return crypto.subtle.importKey('spki', certificate.spkiDer, algorithm, false, ['verify']);
}

export async function verifySignatureBytes(certificate: ParsedCertificate, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const key = await importCertificatePublicKey(certificate);
  const algorithm = certificate.algorithm === 'ECDSA_P256_SHA256' ? ({ name: 'ECDSA', hash: 'SHA-256' } as const) : ({ name: 'RSASSA-PKCS1-v1_5' } as const);
  return crypto.subtle.verify(algorithm, key, signature, message);
}

/** IssuerSerial (RFC 5035 § 4) : SEQUENCE { GeneralNames { [4] directoryName }, serialNumber } — sert à ESS signing-certificate-v2 et à XAdES IssuerSerialV2. */
export function issuerSerialDer(certificate: ParsedCertificate): Uint8Array {
  return sequence(sequence(explicit(4, certificate.issuerDer)), certificate.serialDer);
}

export function issuerSerialV2Base64(certificate: ParsedCertificate): string {
  return toBase64(issuerSerialDer(certificate));
}

export function signatureAlgorithmIdentifier(algorithm: SignatureAlgorithm): Uint8Array {
  return algorithm === 'ECDSA_P256_SHA256' ? sequence(oid(OID.ecdsaWithSha256)) : sequence(oid(OID.sha256WithRsa), derNull());
}

export { integerFromUnsignedBytes, type DerNode };

const DN_KEYWORDS: Readonly<Record<string, string>> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
};

/** Nom distinctif au format RFC 2253 (RDN en ordre inverse ; OID inconnus ou valeurs non textuelles en « OID=#hex »). */
export function distinguishedNameRfc2253(nameDer: Uint8Array): string {
  const rdns = children(expectTag(parseDer(nameDer), TAG.SEQUENCE)).reverse();
  return rdns
    .map((rdn) =>
      children(expectTag(rdn, TAG.SET))
        .map((pair) => {
          const parts = children(expectTag(pair, TAG.SEQUENCE));
          const type = decodeOid(expectTag(parts[0], TAG.OID));
          const value = parts[1];
          if (value === undefined) throw invalid();
          const keyword = DN_KEYWORDS[type];
          const textual = value.tag === TAG.UTF8_STRING || value.tag === TAG.PRINTABLE_STRING;
          if (keyword === undefined || !textual) {
            return `${type}=#${Array.from(value.raw, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
          }
          const text = new TextDecoder().decode(value.content);
          const escaped = text.replace(/[,+"\\<>;]/g, (character) => `\\${character}`).replace(/^([ #])/, '\\$1').replace(/ $/, '\\ ');
          return `${keyword}=${escaped}`;
        })
        .join('+'),
    )
    .join(',');
}
