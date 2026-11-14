export type VaultMerkleErrorCode =
  | 'MERKLE_INDEX_OUT_OF_RANGE'
  | 'MERKLE_EMPTY_TREE'
  | 'MERKLE_INVALID_LEAF'
  | 'MERKLE_INVALID_PROOF'
  | 'AIP_INVALID_INPUT'
  | 'AIP_INVALID_PATH'
  | 'AIP_NOT_FOUND'
  | 'AIP_UNREADABLE'
  | 'AIP_DECRYPTION_FAILED'
  | 'VAULT_RETENTION_INVALID'
  | 'ANCHOR_INVALID_INPUT'
  | 'ANCHOR_TIMESTAMP_INVALID'
  | 'ANCHOR_ROOT_CONFLICT'
  | 'ANCHOR_SCOPE_CONFLICT'
  | 'LTA_INVALID_INPUT'
  | 'LTA_CHAIN_UNREADABLE'
  | 'LTA_BATCH_UNKNOWN';

/**
 * Erreur typée du coffre probant. Les messages décrivent la nature de l'échec, jamais le contenu d'un document
 * ni un identifiant de personne (loi 5 : aucune donnée personnelle dans les messages).
 */
export class VaultMerkleError extends Error {
  readonly code: VaultMerkleErrorCode;

  constructor(code: VaultMerkleErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'VaultMerkleError';
    this.code = code;
  }
}
