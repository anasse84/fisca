/** Algorithme de signature supporté : le HSM signe un condensé SHA-256 déjà calculé (CSC API v2.0 signHash). */
export type SignatureAlgorithm = 'ECDSA_P256_SHA256' | 'RSA_PKCS1_SHA256';

/**
 * Signataire injectable. La clé privée n'est JAMAIS dans ce paquet : l'implémentation réelle (client CSC v2.0 sur mTLS,
 * /csc/v2/signatures/signHash) est fournie par le ticket P2A-05.
 * Format attendu du retour : RSA PKCS#1 v1.5 → signature brute (big-endian, longueur du module) ;
 * ECDSA P-256 → IEEE P1363 (r || s, 64 octets). Hypothèse non vérifiée : le format réel du HSM Barid eSign.
 */
export interface DigestSigner {
  signDigest(digestSha256: Uint8Array, signatureAlgorithm: SignatureAlgorithm): Promise<Uint8Array>;
}

/** Fournisseur de jeton d'horodatage RFC 3161 (TimeStampToken DER). Le client HTTP/mTLS n'est pas dans ce paquet. */
export interface TimestampProvider {
  timestamp(messageImprintSha256: Uint8Array): Promise<Uint8Array>;
}
