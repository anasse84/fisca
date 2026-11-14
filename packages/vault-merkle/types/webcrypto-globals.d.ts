/**
 * Types WebCrypto globaux pour la vérification de types seulement : @fisca/crypto-e2ee (dépendance) utilise les noms globaux
 * du DOM, que ce paquet n'active pas (la bibliothèque DOM est incompatible avec les sources de @fisca/ubl-xades). Ils sont
 * repris du module `webcrypto` de Node ; aucun code d'exécution, rien n'est émis, rien n'est utilisé par src/.
 */
import type { webcrypto } from 'node:crypto';

declare global {
  type CryptoKey = webcrypto.CryptoKey;
  type CryptoKeyPair = webcrypto.CryptoKeyPair;
  type JsonWebKey = webcrypto.JsonWebKey;
  type AesKeyAlgorithm = webcrypto.AesKeyAlgorithm;
  type HmacKeyAlgorithm = webcrypto.HmacKeyAlgorithm;
  type RsaHashedKeyAlgorithm = webcrypto.RsaHashedKeyAlgorithm;
}
