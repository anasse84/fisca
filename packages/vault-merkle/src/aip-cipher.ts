import { decryptFieldWithAad, encryptFieldWithAad, type E2eeKeyMaterial } from '@fisca/crypto-e2ee';
import { fromBase64, toBase64, utf8Decode, utf8Encode } from './bytes.ts';
import { VaultMerkleError } from './errors.ts';

/** Contexte de liaison d'un paquet scellé : seuls des identifiants opaques. */
export interface AipSealContext {
  readonly companyId: string;
  readonly aipId: string;
}

/**
 * Scelleur de l'objet AIP avant écriture dans le coffre (ADR-07 et Doc_10 § 03 : paquet R2 chiffré AES-256-GCM).
 * Injecté par l'appelant : l'enveloppement de la DEK par la clé maîtresse société (Secrets Store ou séquestre) n'est pas du
 * ressort de ce paquet. Les empreintes du manifeste et de Merkle portent sur le CLAIR : elles se vérifient sans la clé.
 */
export interface AipPayloadCipher {
  /** Étiquette stockée en métadonnée d'objet (non secrète). */
  readonly algorithm: string;
  seal(plaintext: Uint8Array, context: AipSealContext): Promise<Uint8Array>;
  open(sealed: Uint8Array, context: AipSealContext): Promise<Uint8Array>;
}

export const AIP_CIPHER_ALGORITHM = 'aes-256-gcm-aad-v1' as const;

/** Colonnes de liaison de l'AAD : table `archival_packages`, enregistrement = aip_id, colonne = r2_object_key. */
const AAD_TABLE = 'archival_packages';
const AAD_COLUMN = 'r2_object_key';

/**
 * Pilote de scellement par `encryptFieldWithAad` (@fisca/crypto-e2ee) : AAD = `companyId|archival_packages|aipId|r2_object_key`.
 * `encryptFieldWithAad` chiffre une chaîne : l'AIP, en octets, est transporté en base64 avant chiffrement (surcoût d'un tiers).
 */
export function createE2eeAipCipher(dek: E2eeKeyMaterial): AipPayloadCipher {
  const aad = (context: AipSealContext) => ({ companyId: context.companyId, tableName: AAD_TABLE, recordId: context.aipId, columnName: AAD_COLUMN });
  return {
    algorithm: AIP_CIPHER_ALGORITHM,
    async seal(plaintext, context) {
      return utf8Encode(await encryptFieldWithAad(dek, toBase64(plaintext), aad(context)));
    },
    async open(sealed, context) {
      try {
        return fromBase64(await decryptFieldWithAad(dek, utf8Decode(sealed), aad(context)));
      } catch {
        throw new VaultMerkleError('AIP_DECRYPTION_FAILED', 'déchiffrement du paquet AIP impossible (clé, contexte ou contenu invalide).');
      }
    },
  };
}
