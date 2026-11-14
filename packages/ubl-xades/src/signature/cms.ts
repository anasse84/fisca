import { sha256 } from './bytes.ts';
import { issuerSerialDer, OID, signatureAlgorithmIdentifier, type ParsedCertificate } from './certificate.ts';
import { derNull, ecdsaP1363ToDer, explicit, octetString, oid, sequence, setOf, tlv, utcTime } from './der.ts';
import { UblSignatureError } from './errors.ts';
import type { DigestSigner, SignatureAlgorithm } from './types.ts';

/**
 * Construction d'un CMS SignedData (RFC 5652) avec attributs signés CAdES-BASELINE (contentType, messageDigest, signingTime,
 * ESS signing-certificate-v2) et attribut non signé id-aa-timeStampToken (RFC 3161). Usage interne (PAdES) ; la clé privée
 * n'est jamais manipulée : seul `DigestSigner` signe le condensé SHA-256 des attributs signés DER.
 */

const attribute = (typeOid: string, value: Uint8Array): Uint8Array => sequence(oid(typeOid), setOf(value));

export interface SignedAttributesInput {
  readonly certificate: ParsedCertificate;
  readonly signingTime: Date;
  readonly contentDigestSha256: Uint8Array;
  readonly contentTypeOid: string;
}

/** SET OF Attribute (tag 0x31) : exactement ce qui est haché et signé (RFC 5652 § 5.4). */
export async function buildSignedAttributes(input: SignedAttributesInput): Promise<Uint8Array> {
  const certHash = await sha256(input.certificate.der);
  const essCertIdV2 = sequence(octetString(certHash), issuerSerialDer(input.certificate));
  return setOf(
    attribute(OID.contentType, oid(input.contentTypeOid)),
    attribute(OID.messageDigest, octetString(input.contentDigestSha256)),
    attribute(OID.signingTime, utcTime(input.signingTime)),
    attribute(OID.signingCertificateV2, sequence(sequence(essCertIdV2))),
  );
}

/** Normalise la sortie du signataire en valeur de signature CMS (ECDSA : Ecdsa-Sig-Value DER ; RSA : octets bruts). */
export function cmsSignatureValue(algorithm: SignatureAlgorithm, rawSignature: Uint8Array): Uint8Array {
  if (algorithm === 'ECDSA_P256_SHA256') {
    if (rawSignature.length !== 64) throw new UblSignatureError('SIGNER_RESULT_INVALID', 'Signature ECDSA P-256 : 64 octets (r||s) attendus.');
    return ecdsaP1363ToDer(rawSignature);
  }
  if (rawSignature.length < 128) throw new UblSignatureError('SIGNER_RESULT_INVALID', 'Signature RSA trop courte.');
  return rawSignature;
}

export async function signCmsAttributes(signer: DigestSigner, algorithm: SignatureAlgorithm, signedAttributesSet: Uint8Array): Promise<Uint8Array> {
  const digest = await sha256(signedAttributesSet);
  return cmsSignatureValue(algorithm, await signer.signDigest(digest, algorithm));
}

export interface AssembleCmsInput {
  readonly certificate: ParsedCertificate;
  readonly algorithm: SignatureAlgorithm;
  readonly signedAttributesSet: Uint8Array;
  readonly signatureValue: Uint8Array;
  /** Jeton RFC 3161 (ContentInfo DER) pour l'attribut non signé id-aa-timeStampToken. */
  readonly timeStampToken?: Uint8Array;
  /** Contenu encapsulé (jeton TSTInfo de test) ; absent = signature détachée (PAdES). */
  readonly eContent?: { readonly typeOid: string; readonly value: Uint8Array };
  readonly extraCertificates?: readonly Uint8Array[];
}

export function assembleCms(input: AssembleCmsInput): Uint8Array {
  const digestAlgorithm = sequence(oid(OID.sha256), derNull());
  // [0] IMPLICIT : le tag 0x31 du SET devient 0xA0 (même contenu).
  const signedAttributesImplicit = tlv(0xa0, input.signedAttributesSet.subarray(headerLength(input.signedAttributesSet)));
  const signerInfoParts: Uint8Array[] = [
    tlv(0x02, Uint8Array.of(1)),
    sequence(input.certificate.issuerDer, input.certificate.serialDer),
    digestAlgorithm,
    signedAttributesImplicit,
    signatureAlgorithmIdentifier(input.algorithm),
    octetString(input.signatureValue),
  ];
  if (input.timeStampToken !== undefined) {
    signerInfoParts.push(tlv(0xa1, attribute(OID.timeStampTokenAttr, input.timeStampToken)));
  }
  const encapsulated =
    input.eContent === undefined
      ? sequence(oid(OID.data))
      : sequence(oid(input.eContent.typeOid), explicit(0, octetString(input.eContent.value)));
  const certificates = tlv(0xa0, input.certificate.der, ...(input.extraCertificates ?? []));
  const signedData = sequence(
    tlv(0x02, Uint8Array.of(input.eContent === undefined || input.eContent.typeOid === OID.data ? 1 : 3)),
    setOf(digestAlgorithm),
    encapsulated,
    certificates,
    setOf(sequence(...signerInfoParts)),
  );
  return sequence(oid(OID.signedData), explicit(0, signedData));
}

function headerLength(der: Uint8Array): number {
  const first = der[1] ?? 0;
  return first < 0x80 ? 2 : 2 + (first & 0x7f);
}
