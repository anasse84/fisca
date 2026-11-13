import { bytesToHex, fromBase64Url, toBase64Url } from './e2ee-encoding.ts';
import { E2eeError } from './e2ee-errors.ts';

/**
 * Enveloppes de clés multi-acteurs RSA-OAEP-256 (Doc_09 § 09, Doc_10 § 03 et § 10, Doc_06 § 03 `tenant_key_grants`).
 *
 * Choix : module RSA 3072 bits, exposant 65537, OAEP SHA-256 (les spécifications ne fixent pas la taille ;
 * 3072 bits offre 128 bits de sécurité classique). Le LABEL OAEP porte le contexte lié
 * (société, rôle, acteur, version de DEK, empreinte SHA-256 de la clé publique, finalité) : une enveloppe
 * copiée vers une autre société, un autre acteur, une autre clé publique ou une autre version ne se déballe pas.
 * Les chaînes enveloppées ont l'en-tête `v1:<version de DEK>:<base64url>` (agilité vers ML-KEM, Doc_10 § 10).
 */
export const KEY_ENVELOPE_VERSION = 'v1';
export const RSA_OAEP_MODULUS_BITS = 3072;
export const GRANTEE_ROLES = ['OWNER_ADMIN', 'EXTERNAL_CPA', 'ERP_CONNECTOR_AGENT', 'DGI_AUDIT_ESCROW'] as const;
export type GranteeRole = (typeof GRANTEE_ROLES)[number];

const SECRET_BYTES = 32;
const TEXT_ENCODER = new TextEncoder();
const PUBLIC_EXPONENT = new Uint8Array([0x01, 0x00, 0x01]);
const VERSION_PATTERN = /^[1-9][0-9]{0,8}$/;

type Bytes = Uint8Array<ArrayBuffer>;
type EnvelopePurpose = 'dek' | 'bidx';

/** Paire d'acteur. La clé privée reste chez l'acteur (jamais écrite dans le dépôt, l'environnement ni les journaux). */
export interface ActorKeyPair {
  readonly publicKeySpkiB64: string;
  readonly publicKeyFingerprintHex: string;
  readonly privateKey: CryptoKey;
}

/** Ligne modélisant `tenant_key_grants` (CTR-SQL-19, créée par S1B ; ici, le modèle et non la table). */
export interface KeyGrantRecord {
  readonly grantId: string;
  readonly granteeRole: GranteeRole;
  readonly granteeActorId: string;
  readonly granteePublicKeySpkiB64: string;
  readonly wrappedDekB64: string;
  readonly wrappedBidxKeyB64: string;
  readonly shamirShareIndex: number | null;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

/** Secrets d'une société : Tenant_DEK (AES-256-GCM), Tenant_BIDX_Key (HMAC-SHA256), version de DEK. */
export interface TenantKeyMaterial {
  readonly dek: Uint8Array;
  readonly bidxKey: Uint8Array;
  readonly dekVersion: number;
}

export interface GranteeDescriptor {
  readonly role: GranteeRole;
  readonly actorId: string;
  readonly publicKeySpkiB64: string;
  readonly shamirShareIndex?: number | null;
}

export interface ActorIdentity {
  readonly role: GranteeRole;
  readonly actorId: string;
  readonly privateKey: CryptoKey;
}

/** Port de stockage injectable ; l'adaptateur D1 de `tenant_key_grants` est livré par S1B. */
export interface KeyGrantStore {
  listGrants(companyId: string): Promise<readonly KeyGrantRecord[]>;
  insertGrant(companyId: string, grant: KeyGrantRecord): Promise<void>;
  /** Révoque toutes les versions de l'acteur ; GRANT_NOT_FOUND s'il n'a aucune enveloppe active. */
  revokeGrant(companyId: string, role: GranteeRole, actorId: string, revokedAt: string): Promise<void>;
}

function assertComponent(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.includes('|')) {
    throw new E2eeError('INVALID_INPUT');
  }
}

function assertRole(role: string): asserts role is GranteeRole {
  if (!(GRANTEE_ROLES as readonly string[]).includes(role)) {
    throw new E2eeError('INVALID_INPUT');
  }
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1 || version > 999_999_999) {
    throw new E2eeError('INVALID_INPUT');
  }
}

function copyBytes(bytes: Uint8Array): Bytes {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

export async function publicKeyFingerprintHex(publicKeySpkiB64: string): Promise<string> {
  const spki = fromBase64Url(publicKeySpkiB64);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', spki)));
}

/** Génère une paire RSA-OAEP-256 de 3072 bits. Clé privée non extractible sauf demande explicite (sauvegarde chiffrée par PIN). */
export async function generateActorKeyPair(options?: { readonly extractablePrivateKey?: boolean }): Promise<ActorKeyPair> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: RSA_OAEP_MODULUS_BITS, publicExponent: PUBLIC_EXPONENT, hash: 'SHA-256' },
    options?.extractablePrivateKey === true,
    ['encrypt', 'decrypt'],
  )) as CryptoKeyPair;
  const publicKeySpkiB64 = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
  return {
    publicKeySpkiB64,
    publicKeyFingerprintHex: await publicKeyFingerprintHex(publicKeySpkiB64),
    privateKey: pair.privateKey,
  };
}

/** Tire une DEK (32 octets) et une clé d'index aveugle (32 octets) avec le CSPRNG WebCrypto. */
export function generateTenantKeyMaterial(dekVersion = 1): TenantKeyMaterial {
  assertVersion(dekVersion);
  return {
    dek: crypto.getRandomValues(new Uint8Array(SECRET_BYTES)),
    bidxKey: crypto.getRandomValues(new Uint8Array(SECRET_BYTES)),
    dekVersion,
  };
}

async function importGranteePublicKey(publicKeySpkiB64: string): Promise<CryptoKey> {
  const spki = fromBase64Url(publicKeySpkiB64);
  try {
    const key = await crypto.subtle.importKey('spki', spki, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
    if (algorithm.modulusLength < RSA_OAEP_MODULUS_BITS) {
      throw new E2eeError('INVALID_KEY');
    }
    return key;
  } catch (error) {
    if (error instanceof E2eeError) throw error;
    throw new E2eeError('INVALID_KEY');
  }
}

function buildLabel(args: {
  readonly companyId: string;
  readonly role: GranteeRole;
  readonly actorId: string;
  readonly dekVersion: number;
  readonly fingerprintHex: string;
  readonly purpose: EnvelopePurpose;
}): Bytes {
  assertComponent(args.companyId);
  assertComponent(args.actorId);
  assertRole(args.role);
  assertVersion(args.dekVersion);
  return copyBytes(
    TEXT_ENCODER.encode(
      ['fisca-key-envelope', KEY_ENVELOPE_VERSION, args.companyId, args.role, args.actorId, String(args.dekVersion), args.fingerprintHex, args.purpose].join('|'),
    ),
  );
}

interface ParsedEnvelope {
  readonly dekVersion: number;
  readonly ciphertext: Bytes;
}

function parseEnvelope(value: string): ParsedEnvelope {
  const parts = value.split(':');
  const [version, dekVersion, payload] = parts;
  if (parts.length !== 3 || version === undefined || dekVersion === undefined || payload === undefined) {
    throw new E2eeError('INVALID_FORMAT');
  }
  if (version !== KEY_ENVELOPE_VERSION) {
    throw new E2eeError(/^v[0-9]+(_[a-z0-9]+)?$/.test(version) ? 'UNSUPPORTED_VERSION' : 'INVALID_FORMAT');
  }
  if (!VERSION_PATTERN.test(dekVersion) || payload.length === 0) {
    throw new E2eeError('INVALID_FORMAT');
  }
  return { dekVersion: Number(dekVersion), ciphertext: fromBase64Url(payload) };
}

/** Version de DEK portée par l'en-tête de l'enveloppe. */
export function grantDekVersion(grant: KeyGrantRecord): number {
  return parseEnvelope(grant.wrappedDekB64).dekVersion;
}

async function wrapOne(
  publicKey: CryptoKey,
  secret: Uint8Array,
  label: Bytes,
  dekVersion: number,
): Promise<string> {
  if (secret.length !== SECRET_BYTES) {
    throw new E2eeError('INVALID_INPUT');
  }
  try {
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP', label }, publicKey, copyBytes(secret)));
    return `${KEY_ENVELOPE_VERSION}:${dekVersion}:${toBase64Url(wrapped)}`;
  } catch {
    throw new E2eeError('ENCRYPTION_FAILED');
  }
}

/** Emballe DEK et clé d'index aveugle pour un acteur ; l'enveloppe est liée à (société, rôle, acteur, version, empreinte). */
export async function wrapKeyMaterialForActor(args: {
  readonly companyId: string;
  readonly grantee: GranteeDescriptor;
  readonly material: TenantKeyMaterial;
  readonly now?: string;
  readonly grantId?: string;
}): Promise<KeyGrantRecord> {
  const { companyId, grantee, material } = args;
  assertComponent(companyId);
  assertComponent(grantee.actorId);
  assertRole(grantee.role);
  assertVersion(material.dekVersion);
  const shamir = grantee.shamirShareIndex ?? null;
  if (shamir !== null && (!Number.isInteger(shamir) || shamir < 1 || shamir > 3)) {
    throw new E2eeError('INVALID_INPUT');
  }
  const publicKey = await importGranteePublicKey(grantee.publicKeySpkiB64);
  const fingerprintHex = await publicKeyFingerprintHex(grantee.publicKeySpkiB64);
  const base = { companyId, role: grantee.role, actorId: grantee.actorId, dekVersion: material.dekVersion, fingerprintHex };
  return {
    grantId: args.grantId ?? crypto.randomUUID(),
    granteeRole: grantee.role,
    granteeActorId: grantee.actorId,
    granteePublicKeySpkiB64: grantee.publicKeySpkiB64,
    wrappedDekB64: await wrapOne(publicKey, material.dek, buildLabel({ ...base, purpose: 'dek' }), material.dekVersion),
    wrappedBidxKeyB64: await wrapOne(publicKey, material.bidxKey, buildLabel({ ...base, purpose: 'bidx' }), material.dekVersion),
    shamirShareIndex: shamir,
    createdAt: args.now ?? new Date().toISOString(),
    revokedAt: null,
  };
}

async function unwrapOne(privateKey: CryptoKey, parsed: ParsedEnvelope, label: Bytes): Promise<Bytes> {
  let clear: Bytes;
  try {
    clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP', label }, privateKey, parsed.ciphertext));
  } catch {
    throw new E2eeError('DECRYPTION_FAILED');
  }
  if (clear.length !== SECRET_BYTES) {
    clear.fill(0);
    throw new E2eeError('DECRYPTION_FAILED');
  }
  return clear;
}

/**
 * Déballe une enveloppe avec la clé privée de l'acteur. `companyId`, `role` et `actorId` viennent de la session
 * authentifiée, jamais de l'enregistrement : toute divergence est un échec indistinguable d'une mauvaise clé.
 * L'appelant efface les octets rendus (`fill(0)`) après usage.
 */
export async function unwrapKeyGrant(args: {
  readonly companyId: string;
  readonly grant: KeyGrantRecord;
  readonly role: GranteeRole;
  readonly actorId: string;
  readonly privateKey: CryptoKey;
}): Promise<TenantKeyMaterial> {
  const { companyId, grant, role, actorId, privateKey } = args;
  assertComponent(companyId);
  assertComponent(actorId);
  assertRole(role);
  if (grant.revokedAt !== null) {
    throw new E2eeError('GRANT_REVOKED');
  }
  const algorithm = privateKey.algorithm as Partial<RsaHashedKeyAlgorithm>;
  const hashName = typeof algorithm.hash === 'object' ? algorithm.hash.name : undefined;
  if (algorithm.name !== 'RSA-OAEP' || hashName !== 'SHA-256' || privateKey.type !== 'private') {
    throw new E2eeError('INVALID_KEY');
  }
  const dekEnvelope = parseEnvelope(grant.wrappedDekB64);
  const bidxEnvelope = parseEnvelope(grant.wrappedBidxKeyB64);
  if (dekEnvelope.dekVersion !== bidxEnvelope.dekVersion) {
    throw new E2eeError('INVALID_FORMAT');
  }
  if (grant.granteeRole !== role || grant.granteeActorId !== actorId) {
    throw new E2eeError('DECRYPTION_FAILED');
  }
  const fingerprintHex = await publicKeyFingerprintHex(grant.granteePublicKeySpkiB64);
  const base = { companyId, role, actorId, dekVersion: dekEnvelope.dekVersion, fingerprintHex };
  const dek = await unwrapOne(privateKey, dekEnvelope, buildLabel({ ...base, purpose: 'dek' }));
  try {
    const bidxKey = await unwrapOne(privateKey, bidxEnvelope, buildLabel({ ...base, purpose: 'bidx' }));
    return { dek, bidxKey, dekVersion: dekEnvelope.dekVersion };
  } catch (error) {
    dek.fill(0);
    throw error;
  }
}

/** Pilote mémoire du port (tests, développement). L'adaptateur D1 est livré par S1B. */
export function createMemoryKeyGrantStore(): KeyGrantStore {
  const grantsByCompany = new Map<string, KeyGrantRecord[]>();
  const rowsOf = (companyId: string): KeyGrantRecord[] => {
    const existing = grantsByCompany.get(companyId);
    if (existing !== undefined) return existing;
    const created: KeyGrantRecord[] = [];
    grantsByCompany.set(companyId, created);
    return created;
  };
  return {
    async listGrants(companyId) {
      return rowsOf(companyId).map((row) => ({ ...row }));
    },
    async insertGrant(companyId, grant) {
      const rows = rowsOf(companyId);
      const version = grantDekVersion(grant);
      const duplicate = rows.some(
        (row) => row.granteeRole === grant.granteeRole && row.granteeActorId === grant.granteeActorId && grantDekVersion(row) === version,
      );
      if (duplicate) {
        throw new E2eeError('GRANT_ALREADY_EXISTS');
      }
      rows.push({ ...grant });
    },
    async revokeGrant(companyId, role, actorId, revokedAt) {
      const rows = rowsOf(companyId);
      let touched = false;
      rows.forEach((row, index) => {
        if (row.granteeRole === role && row.granteeActorId === actorId && row.revokedAt === null) {
          rows[index] = { ...row, revokedAt };
          touched = true;
        }
      });
      if (!touched) {
        throw new E2eeError('GRANT_NOT_FOUND');
      }
    },
  };
}

function latestActiveGrant(
  grants: readonly KeyGrantRecord[],
  role: GranteeRole,
  actorId: string,
): KeyGrantRecord | undefined {
  let best: KeyGrantRecord | undefined;
  let bestVersion = 0;
  for (const grant of grants) {
    if (grant.granteeRole !== role || grant.granteeActorId !== actorId || grant.revokedAt !== null) continue;
    const version = grantDekVersion(grant);
    if (version > bestVersion) {
      best = grant;
      bestVersion = version;
    }
  }
  return best;
}

/** Déballe l'enveloppe active de plus haute version de l'acteur. Sans enveloppe active : GRANT_NOT_FOUND (pas de fuite sur la cause). */
export async function unwrapCurrentGrant(args: {
  readonly store: KeyGrantStore;
  readonly companyId: string;
  readonly actor: ActorIdentity;
}): Promise<TenantKeyMaterial> {
  const grants = await args.store.listGrants(args.companyId);
  const grant = latestActiveGrant(grants, args.actor.role, args.actor.actorId);
  if (grant === undefined) {
    throw new E2eeError('GRANT_NOT_FOUND');
  }
  return unwrapKeyGrant({
    companyId: args.companyId,
    grant,
    role: args.actor.role,
    actorId: args.actor.actorId,
    privateKey: args.actor.privateKey,
  });
}

/**
 * Ajoute un acteur : un détenteur de la DEK la déballe puis la ré-emballe pour la clé publique du nouvel acteur.
 * Qui a le droit d'inviter relève du RBAC de l'appelant (Doc_09 § 06).
 */
export async function addActorGrant(args: {
  readonly store: KeyGrantStore;
  readonly companyId: string;
  readonly holder: ActorIdentity;
  readonly grantee: GranteeDescriptor;
  readonly now?: string;
}): Promise<KeyGrantRecord> {
  const { store, companyId, holder, grantee } = args;
  const existing = await store.listGrants(companyId);
  if (latestActiveGrant(existing, grantee.role, grantee.actorId) !== undefined) {
    throw new E2eeError('GRANT_ALREADY_EXISTS');
  }
  const material = await unwrapCurrentGrant({ store, companyId, actor: holder });
  try {
    const grant = await wrapKeyMaterialForActor({
      companyId,
      grantee,
      material,
      ...(args.now === undefined ? {} : { now: args.now }),
    });
    await store.insertGrant(companyId, grant);
    return grant;
  } finally {
    material.dek.fill(0);
    material.bidxKey.fill(0);
  }
}

export interface RevocationResult {
  /** Nouveau matériel (DEK de version n+1, même clé d'index aveugle) : à confier au détenteur qui rechiffre les nouvelles données. */
  readonly material: TenantKeyMaterial;
  readonly newDekVersion: number;
  readonly regrantedActors: number;
  readonly revokedAt: string;
}

/**
 * Révoque un acteur (Doc_09 § 09 : `revoked_at` renseigné, archives antérieures non rechiffrées) et fait tourner la DEK :
 * une DEK de version n+1 est emballée pour chaque acteur restant, pour que l'acteur révoqué ne lise aucune donnée nouvelle.
 * Seul un OWNER_ADMIN révoque, et jamais le dernier. La clé d'index aveugle n'est pas tournée (les index SQL
 * existants resteraient valides) ; les enveloppes v(n) des acteurs restants subsistent pour relire les archives.
 * Tous les ré-emballages sont calculés avant la moindre écriture.
 */
export async function revokeActorGrant(args: {
  readonly store: KeyGrantStore;
  readonly companyId: string;
  readonly holder: ActorIdentity;
  readonly revoked: { readonly role: GranteeRole; readonly actorId: string };
  readonly now?: string;
}): Promise<RevocationResult> {
  const { store, companyId, holder, revoked } = args;
  if (holder.role !== 'OWNER_ADMIN') {
    throw new E2eeError('ACTOR_NOT_AUTHORIZED');
  }
  const grants = await store.listGrants(companyId);
  if (latestActiveGrant(grants, revoked.role, revoked.actorId) === undefined) {
    throw new E2eeError('GRANT_NOT_FOUND');
  }
  const remaining = new Map<string, KeyGrantRecord>();
  for (const grant of grants) {
    if (grant.revokedAt !== null) continue;
    if (grant.granteeRole === revoked.role && grant.granteeActorId === revoked.actorId) continue;
    const latest = latestActiveGrant(grants, grant.granteeRole, grant.granteeActorId);
    if (latest !== undefined) remaining.set(`${grant.granteeRole}|${grant.granteeActorId}`, latest);
  }
  const owners = [...remaining.values()].filter((grant) => grant.granteeRole === 'OWNER_ADMIN');
  if (owners.length === 0) {
    throw new E2eeError('ACTOR_NOT_AUTHORIZED');
  }
  const current = await unwrapCurrentGrant({ store, companyId, actor: holder });
  const revokedAt = args.now ?? new Date().toISOString();
  try {
    const material: TenantKeyMaterial = {
      dek: crypto.getRandomValues(new Uint8Array(SECRET_BYTES)),
      bidxKey: copyBytes(current.bidxKey),
      dekVersion: current.dekVersion + 1,
    };
    const newGrants: KeyGrantRecord[] = [];
    for (const grant of remaining.values()) {
      newGrants.push(
        await wrapKeyMaterialForActor({
          companyId,
          grantee: {
            role: grant.granteeRole,
            actorId: grant.granteeActorId,
            publicKeySpkiB64: grant.granteePublicKeySpkiB64,
            shamirShareIndex: grant.shamirShareIndex,
          },
          material,
          now: revokedAt,
        }),
      );
    }
    await store.revokeGrant(companyId, revoked.role, revoked.actorId, revokedAt);
    for (const grant of newGrants) {
      await store.insertGrant(companyId, grant);
    }
    return { material, newDekVersion: material.dekVersion, regrantedActors: newGrants.length, revokedAt };
  } finally {
    current.dek.fill(0);
    current.bidxKey.fill(0);
  }
}
