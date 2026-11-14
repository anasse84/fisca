/**
 * Signature ECDSA P-256 (WebCrypto) des tickets. La clé privée est générée avec `extractable: false` : aucun JWK/PKCS#8 ne
 * peut en sortir (`exportKey` échoue). L'objet `CryptoKey` lui-même est stocké dans IndexedDB (clonage structuré), jamais une
 * représentation exportée. La clé publique, toujours exportable, sert à l'enrôlement côté serveur.
 * Ce qui est signé : l'UTF-8 des 64 hexadécimaux de l'empreinte du ticket (`ticket_sha256`), ECDSA + SHA-256 ;
 * signature au format IEEE P1363 (r‖s, 64 octets) encodée en base64 (`ecdsa_signature_b64`).
 */

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface SigningKeyStore {
  load(): Promise<CryptoKeyPair | null>;
  save(pair: CryptoKeyPair): Promise<void>;
}

export function createMemorySigningKeyStore(): SigningKeyStore {
  let current: CryptoKeyPair | null = null;
  return {
    load: async () => current,
    save: async (pair) => {
      current = pair;
    },
  };
}

const IDB_NAME = 'fisca-pos-keys';
const IDB_STORE = 'signing-keys';
const IDB_RECORD_KEY = 'ticket-signing-v1';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('Erreur IndexedDB.')));
  });
}

function openKeyDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore(IDB_STORE);
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('Ouverture IndexedDB impossible.')));
  });
}

/** Magasin IndexedDB : la paire `CryptoKeyPair` (clé privée non extractable) est stockée telle quelle. */
export function createIndexedDbSigningKeyStore(factory: IDBFactory, databaseName: string = IDB_NAME): SigningKeyStore {
  return {
    async load() {
      const db = await openKeyDatabase(factory, databaseName);
      try {
        const value: unknown = await requestResult(db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_RECORD_KEY));
        if (value === undefined) return null;
        const candidate = value as Partial<CryptoKeyPair>;
        if (candidate.privateKey === undefined || candidate.publicKey === undefined) throw new Error('Enregistrement de clé de signature illisible.');
        return { privateKey: candidate.privateKey, publicKey: candidate.publicKey };
      } finally {
        db.close();
      }
    },
    async save(pair) {
      const db = await openKeyDatabase(factory, databaseName);
      try {
        await requestResult(db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put({ privateKey: pair.privateKey, publicKey: pair.publicKey }, IDB_RECORD_KEY));
      } finally {
        db.close();
      }
    },
  };
}

/** Génère la paire de signature : clé privée NON extractable. */
export async function generateSigningKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALGORITHM, false, ['sign', 'verify']);
}

/** Relit la paire du magasin ou la crée une fois ; refuse une clé privée extractable. */
export async function loadOrCreateSigningKeyPair(store: SigningKeyStore): Promise<CryptoKeyPair> {
  const existing = await store.load();
  if (existing !== null) {
    if (existing.privateKey.extractable) throw new Error('Clé privée de signature extractable refusée : la clé doit rester non exportable.');
    return existing;
  }
  const created = await generateSigningKeyPair();
  await store.save(created);
  return created;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function exportPublicKeySpkiB64(pair: CryptoKeyPair): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
}

export async function importPublicKeySpkiB64(spkiB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', fromBase64(spkiB64), ALGORITHM, true, ['verify']);
}

function hashBytes(sha256Hex: string): Uint8Array<ArrayBuffer> {
  if (!SHA256_HEX.test(sha256Hex)) throw new TypeError('Signature : l’empreinte du ticket doit être 64 hexadécimaux minuscules.');
  return new TextEncoder().encode(sha256Hex);
}

export async function signTicketHash(privateKey: CryptoKey, sha256Hex: string): Promise<string> {
  const signature = await crypto.subtle.sign(SIGN_PARAMS, privateKey, hashBytes(sha256Hex));
  return toBase64(new Uint8Array(signature));
}

export async function verifyTicketSignature(publicKey: CryptoKey, sha256Hex: string, signatureB64: string): Promise<boolean> {
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = fromBase64(signatureB64);
  } catch {
    return false;
  }
  return crypto.subtle.verify(SIGN_PARAMS, publicKey, signature, hashBytes(sha256Hex));
}
