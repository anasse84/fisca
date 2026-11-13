import { bytesEqual, toHex } from './bytes.ts';
import { OID } from './certificate.ts';
import {
  children,
  decodeInteger,
  decodeOid,
  decodeTime,
  derBoolean,
  derNull,
  expectTag,
  integerFromBigInt,
  integerFromUnsignedBytes,
  octetString,
  oid,
  parseDer,
  sequence,
  TAG,
  type DerNode,
} from './der.ts';
import { UblSignatureError } from './errors.ts';

/** RFC 3161 : construction DER d'une TimeStampReq et lecture/contrôle basique d'un TimeStampToken. Aucun client HTTP. */

export interface TimeStampRequestOptions {
  /** Nonce (octets big-endian, 1 à 16 octets) ; tiré par crypto.getRandomValues si omis. */
  readonly nonce?: Uint8Array;
  /** certReq (RFC 3161 § 2.4.1) : true par défaut — la TSA joint son certificat. */
  readonly certReq?: boolean;
  /** Politique demandée (OID pointé) : non fournie par défaut — jamais inventée. */
  readonly policyOid?: string;
}

export interface TimeStampRequest {
  readonly der: Uint8Array;
  readonly nonce: Uint8Array;
}

/** TimeStampReq ::= SEQUENCE { version 1, messageImprint { sha256, condensé }, reqPolicy?, nonce, certReq } */
export function buildTimeStampRequest(messageImprintSha256: Uint8Array, options: TimeStampRequestOptions = {}): TimeStampRequest {
  if (messageImprintSha256.length !== 32) {
    throw new UblSignatureError('TIMESTAMP_TOKEN_INVALID', 'Le condensé à horodater doit faire 32 octets (SHA-256).');
  }
  const nonce = options.nonce ?? crypto.getRandomValues(new Uint8Array(8));
  if (nonce.length === 0 || nonce.length > 16) throw new UblSignatureError('TIMESTAMP_TOKEN_INVALID', 'Nonce de 1 à 16 octets attendu.');
  const parts: Uint8Array[] = [
    integerFromBigInt(1n),
    sequence(sequence(oid(OID.sha256), derNull()), octetString(messageImprintSha256)),
  ];
  if (options.policyOid !== undefined) parts.push(oid(options.policyOid));
  parts.push(integerFromUnsignedBytes(nonce));
  parts.push(derBoolean(options.certReq ?? true));
  return { der: sequence(...parts), nonce };
}

export interface ParsedTimeStampToken {
  readonly genTime: Date;
  readonly messageImprint: Uint8Array;
  readonly hashAlgorithmOid: string;
  readonly policyOid: string;
  readonly serialNumberHex: string;
  readonly nonce: Uint8Array | undefined;
  /** Certificats DER joints au jeton (certReq=true). */
  readonly certificates: readonly Uint8Array[];
  readonly tstInfoDer: Uint8Array;
}

function invalidToken(): UblSignatureError {
  return new UblSignatureError('TIMESTAMP_TOKEN_INVALID', 'TimeStampToken illisible ou non conforme à RFC 3161.');
}

/**
 * Extrait le TSTInfo d'un TimeStampToken (ContentInfo CMS SignedData, id-ct-TSTInfo).
 * CONTRÔLE BASIQUE : structure, empreinte (si `expectedImprintSha256` fournie) et genTime.
 * La signature CMS de la TSA et la chaîne de son certificat NE sont PAS vérifiées ici (ancres de confiance : ticket P2A-05).
 */
export function parseTimeStampToken(tokenDer: Uint8Array, options: { readonly expectedImprintSha256?: Uint8Array; readonly expectedNonce?: Uint8Array } = {}): ParsedTimeStampToken {
  let tstInfo: DerNode;
  let certificates: Uint8Array[] = [];
  try {
    const contentInfo = children(expectTag(parseDer(tokenDer), TAG.SEQUENCE));
    if (decodeOid(expectTag(contentInfo[0], TAG.OID)) !== OID.signedData) throw invalidToken();
    const signedData = children(expectTag(children(expectTag(contentInfo[1], 0xa0))[0], TAG.SEQUENCE));
    // version, digestAlgorithms, encapContentInfo, [0] certificates?, [1] crls?, signerInfos
    const encap = children(expectTag(signedData[2], TAG.SEQUENCE));
    if (decodeOid(expectTag(encap[0], TAG.OID)) !== OID.tstInfo) throw invalidToken();
    const eContent = expectTag(children(expectTag(encap[1], 0xa0))[0], TAG.OCTET_STRING);
    tstInfo = expectTag(parseDer(eContent.content), TAG.SEQUENCE);
    const certificateSet = signedData.find((node) => node.tag === 0xa0);
    if (certificateSet !== undefined) certificates = children(certificateSet).map((node) => node.raw);
  } catch (error) {
    if (error instanceof UblSignatureError) throw invalidToken();
    throw error;
  }
  const fields = children(tstInfo);
  try {
    const policy = decodeOid(expectTag(fields[1], TAG.OID));
    const imprint = children(expectTag(fields[2], TAG.SEQUENCE));
    const hashAlgorithm = decodeOid(expectTag(children(expectTag(imprint[0], TAG.SEQUENCE))[0], TAG.OID));
    const hashed = expectTag(imprint[1], TAG.OCTET_STRING).content;
    const serial = expectTag(fields[3], TAG.INTEGER);
    const genTime = decodeTime(expectTag(fields[4], TAG.GENERALIZED_TIME));
    let nonce: Uint8Array | undefined;
    for (const optional of fields.slice(5)) {
      if (optional.tag === TAG.INTEGER) nonce = optional.content;
    }
    if (decodeInteger(expectTag(fields[0], TAG.INTEGER)) !== 1n) throw invalidToken();
    if (options.expectedImprintSha256 !== undefined && (hashAlgorithm !== OID.sha256 || !bytesEqual(hashed, options.expectedImprintSha256))) {
      throw new UblSignatureError('TIMESTAMP_IMPRINT_MISMATCH', 'L’empreinte du jeton d’horodatage ne correspond pas au condensé attendu.');
    }
    if (options.expectedNonce !== undefined) {
      const strip = (bytes: Uint8Array): Uint8Array => {
        let start = 0;
        while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
        return bytes.subarray(start);
      };
      if (nonce === undefined || !bytesEqual(strip(nonce), strip(options.expectedNonce))) {
        throw new UblSignatureError('TIMESTAMP_NONCE_MISMATCH', 'Le nonce du jeton ne correspond pas à la requête.');
      }
    }
    return {
      genTime,
      messageImprint: hashed,
      hashAlgorithmOid: hashAlgorithm,
      policyOid: policy,
      serialNumberHex: toHex(serial.content),
      nonce,
      certificates,
      tstInfoDer: tstInfo.raw,
    };
  } catch (error) {
    if (error instanceof UblSignatureError) {
      if (error.code === 'DER_MALFORMED') throw invalidToken();
      throw error;
    }
    throw error;
  }
}


/** TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken ContentInfo OPTIONAL } → jeton DER si statut granted (0) ou grantedWithMods (1). */
export function extractTimeStampTokenFromResponse(responseDer: Uint8Array): Uint8Array {
  try {
    const parts = children(expectTag(parseDer(responseDer), TAG.SEQUENCE));
    const status = children(expectTag(parts[0], TAG.SEQUENCE));
    const code = decodeInteger(expectTag(status[0], TAG.INTEGER));
    if (code !== 0n && code !== 1n) throw new UblSignatureError('TIMESTAMP_RESPONSE_INVALID', 'La TSA a refusé la demande d’horodatage.');
    const token = expectTag(parts[1], TAG.SEQUENCE);
    return token.raw;
  } catch (error) {
    if (error instanceof UblSignatureError && error.code === 'TIMESTAMP_RESPONSE_INVALID') throw error;
    throw new UblSignatureError('TIMESTAMP_RESPONSE_INVALID', 'Réponse d’horodatage RFC 3161 illisible.');
  }
}
