import { assertValidCompanyId, type WormObject, type WormVaultDriver } from '@fisca/shared-types';
import type { AipPayloadCipher } from './aip-cipher.ts';
import { fromBase64, isSha256Hex, sha256Hex, toBase64, utf8Decode, utf8Encode, fromHex } from './bytes.ts';
import { canonicalJson, type CanonicalJsonValue } from './canonical-json.ts';
import { VaultMerkleError } from './errors.ts';
import { formatInstant, MS_PER_DAY, parseInstantMs } from './time.ts';

/**
 * Archival Information Package (OAIS, ISO 14721 ; ISO 14641) : profil PROVISOIRE de Fisca, sans prétention de conformité.
 *
 * Un AIP = UN objet du coffre (écriture WORM unique et atomique) contenant, en JSON canonique (JCS-like, voir canonical-json.ts) :
 * le manifeste (lignes `${relativePath}|${sizeBytes}|${sha256Hex}` de Doc_12 § 11 / ERRATA section C), des métadonnées de
 * préservation PREMIS minimales et les objets en base64. Empreinte de l'AIP = SHA-256 des lignes du manifeste jointes par « \n ».
 */

export const AIP_STANDARD = 'FISCA-AIP-OAIS-PROVISIONAL' as const;
export const AIP_FORMAT_VERSION = 1 as const;

/**
 * Durée décennale du coffre : R2_LEGAL_VAULT, Object Lock Compliance 3653 jours, jurisdiction eu
 * (contrat CTR-BND-02, Doc_04 § 11 ; MinIO COMPLIANCE 3653d, Doc_16). Valeur par défaut documentaire : l'appelant fournit toujours la durée.
 */
export const DEFAULT_RETENTION_DAYS = 3653 as const;

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PATH_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_CONTENT_OBJECTS = 10_000;

export interface AipContentInput {
  /** Chemin relatif dans le paquet : segments [A-Za-z0-9._-], sans « .. », sans « | » ni retour à la ligne. */
  readonly relativePath: string;
  readonly bytes: Uint8Array;
  /** Montant TTC en centimes entiers (loi 1), optionnel, porté par les métadonnées. */
  readonly amountCents?: number;
}

export interface PremisEvent {
  readonly eventType: string;
  readonly eventDateTimeIso: string;
  readonly outcome: 'SUCCESS' | 'FAILURE';
  readonly detail?: string;
}

export interface BuildAipInput {
  readonly aipId: string;
  readonly companyId: string;
  readonly createdAtIso: string;
  /** Producteur (agent PREMIS) : identifiant technique opaque (ex. nom de service), jamais une personne. */
  readonly producer: string;
  /** Déclaration de droits PREMIS (ex. « Art. 211 CGI : conservation, accès sur réquisition »), texte libre sans donnée personnelle. */
  readonly rights: string;
  readonly contents: readonly AipContentInput[];
  readonly events?: readonly PremisEvent[];
}

export interface AipContentEntry {
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256Hex: string;
  readonly amountCents?: number;
  readonly dataB64: string;
}

export interface AipPackage {
  readonly standard: typeof AIP_STANDARD;
  readonly formatVersion: typeof AIP_FORMAT_VERSION;
  readonly aipId: string;
  readonly companyId: string;
  readonly createdAtIso: string;
  readonly manifest: {
    readonly lines: readonly string[];
    readonly filesCount: number;
    readonly totalBytes: number;
    readonly aipSha256Hex: string;
  };
  readonly premis: {
    readonly objectIdentifier: { readonly type: 'FISCA-AIP-ID'; readonly value: string };
    readonly creationDateTimeIso: string;
    readonly creatingAgent: string;
    readonly rightsStatement: string;
    readonly events: readonly PremisEvent[];
  };
  readonly contents: readonly AipContentEntry[];
}

function bad(code: 'AIP_INVALID_INPUT' | 'AIP_INVALID_PATH', detail: string): never {
  throw new VaultMerkleError(code, detail);
}

export function assertValidRelativePath(path: string): void {
  if (path.length === 0 || path.length > 512 || path.startsWith('/')) bad('AIP_INVALID_PATH', 'chemin relatif vide, trop long ou absolu.');
  for (const segment of path.split('/')) {
    if (segment === '..' || segment === '.' || !PATH_SEGMENT.test(segment)) bad('AIP_INVALID_PATH', 'segment de chemin non admis (« | », retour à la ligne, « .. » ou caractère hors [A-Za-z0-9._-]).');
  }
}

/** Tri par point de code (déterministe, indépendant de la locale : écart assumé avec `localeCompare` de Doc_12 § 11). */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function manifestLine(entry: { readonly relativePath: string; readonly sizeBytes: number; readonly sha256Hex: string }): string {
  return `${entry.relativePath}|${entry.sizeBytes}|${entry.sha256Hex}`;
}

/** Empreinte de l'AIP : SHA-256 (hexadécimal minuscule) des lignes du manifeste, triées, jointes par « \n ». */
export async function computeAipSha256Hex(lines: readonly string[]): Promise<string> {
  return sha256Hex(utf8Encode(lines.join('\n')));
}

function assertCents(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) bad('AIP_INVALID_INPUT', 'montant en centimes : entier sûr positif ou nul attendu.');
}

export async function buildAip(input: BuildAipInput): Promise<AipPackage> {
  assertValidCompanyId(input.companyId);
  if (!OPAQUE_ID.test(input.aipId)) bad('AIP_INVALID_INPUT', 'aipId : identifiant opaque [A-Za-z0-9_-]{1,64} attendu.');
  parseInstantMs(input.createdAtIso, 'AIP_INVALID_INPUT');
  if (input.producer.trim().length === 0 || input.rights.trim().length === 0) bad('AIP_INVALID_INPUT', 'producteur et déclaration de droits requis.');
  if (input.contents.length === 0 || input.contents.length > MAX_CONTENT_OBJECTS) bad('AIP_INVALID_INPUT', 'au moins un objet (et au plus 10000) par paquet.');
  const seen = new Set<string>();
  const entries: AipContentEntry[] = [];
  for (const content of input.contents) {
    assertValidRelativePath(content.relativePath);
    if (seen.has(content.relativePath)) bad('AIP_INVALID_PATH', 'chemin relatif en double dans le paquet.');
    seen.add(content.relativePath);
    if (content.amountCents !== undefined) assertCents(content.amountCents);
    entries.push({
      relativePath: content.relativePath,
      sizeBytes: content.bytes.length,
      sha256Hex: await sha256Hex(content.bytes),
      ...(content.amountCents === undefined ? {} : { amountCents: content.amountCents }),
      dataB64: toBase64(content.bytes),
    });
  }
  entries.sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
  const events: PremisEvent[] = [{ eventType: 'creation', eventDateTimeIso: input.createdAtIso, outcome: 'SUCCESS' }];
  for (const event of input.events ?? []) {
    parseInstantMs(event.eventDateTimeIso, 'AIP_INVALID_INPUT');
    events.push(event);
  }
  const lines = entries.map(manifestLine);
  return {
    standard: AIP_STANDARD,
    formatVersion: AIP_FORMAT_VERSION,
    aipId: input.aipId,
    companyId: input.companyId,
    createdAtIso: input.createdAtIso,
    manifest: {
      lines,
      filesCount: entries.length,
      totalBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
      aipSha256Hex: await computeAipSha256Hex(lines),
    },
    premis: {
      objectIdentifier: { type: 'FISCA-AIP-ID', value: input.aipId },
      creationDateTimeIso: input.createdAtIso,
      creatingAgent: input.producer,
      rightsStatement: input.rights,
      events,
    },
    contents: entries,
  };
}

/** Octets canoniques de l'AIP (JSON canonique, UTF-8). */
export function serializeAip(aip: AipPackage): Uint8Array {
  return utf8Encode(canonicalJson(aip as unknown as CanonicalJsonValue));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Relit un AIP sérialisé ; toute structure inattendue → AIP_UNREADABLE (message sans contenu). */
export function parseAip(bytes: Uint8Array): AipPackage {
  const unreadable = (): VaultMerkleError => new VaultMerkleError('AIP_UNREADABLE', 'paquet AIP illisible ou de structure inattendue.');
  let raw: unknown;
  try {
    raw = JSON.parse(utf8Decode(bytes));
  } catch {
    throw unreadable();
  }
  if (!isRecord(raw) || raw['standard'] !== AIP_STANDARD || raw['formatVersion'] !== AIP_FORMAT_VERSION) throw unreadable();
  const { aipId, companyId, createdAtIso, manifest, premis, contents } = raw;
  if (typeof aipId !== 'string' || typeof companyId !== 'string' || typeof createdAtIso !== 'string' || !isRecord(manifest) || !isRecord(premis) || !Array.isArray(contents)) throw unreadable();
  const { lines, filesCount, totalBytes, aipSha256Hex } = manifest;
  if (!Array.isArray(lines) || !lines.every((line): line is string => typeof line === 'string') || !Number.isSafeInteger(filesCount) || !Number.isSafeInteger(totalBytes) || typeof aipSha256Hex !== 'string') throw unreadable();
  const entries: AipContentEntry[] = [];
  for (const item of contents) {
    if (!isRecord(item)) throw unreadable();
    const { relativePath, sizeBytes, sha256Hex: declared, dataB64, amountCents } = item;
    if (typeof relativePath !== 'string' || typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || typeof declared !== 'string' || typeof dataB64 !== 'string') throw unreadable();
    if (amountCents !== undefined && (typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents))) throw unreadable();
    entries.push({ relativePath, sizeBytes, sha256Hex: declared, dataB64, ...(amountCents === undefined ? {} : { amountCents: amountCents as number }) });
  }
  const { objectIdentifier, creationDateTimeIso, creatingAgent, rightsStatement, events } = premis;
  if (!isRecord(objectIdentifier) || objectIdentifier['type'] !== 'FISCA-AIP-ID' || typeof objectIdentifier['value'] !== 'string' || typeof creationDateTimeIso !== 'string' || typeof creatingAgent !== 'string' || typeof rightsStatement !== 'string' || !Array.isArray(events)) throw unreadable();
  const parsedEvents: PremisEvent[] = [];
  for (const event of events) {
    if (!isRecord(event) || typeof event['eventType'] !== 'string' || typeof event['eventDateTimeIso'] !== 'string' || (event['outcome'] !== 'SUCCESS' && event['outcome'] !== 'FAILURE')) throw unreadable();
    const detail = event['detail'];
    parsedEvents.push({ eventType: event['eventType'], eventDateTimeIso: event['eventDateTimeIso'], outcome: event['outcome'], ...(typeof detail === 'string' ? { detail } : {}) });
  }
  return {
    standard: AIP_STANDARD,
    formatVersion: AIP_FORMAT_VERSION,
    aipId,
    companyId,
    createdAtIso,
    manifest: { lines, filesCount: filesCount as number, totalBytes: totalBytes as number, aipSha256Hex },
    premis: { objectIdentifier: { type: 'FISCA-AIP-ID', value: objectIdentifier['value'] }, creationDateTimeIso, creatingAgent, rightsStatement, events: parsedEvents },
    contents: entries,
  };
}

export type AipFailureCode =
  | 'MANIFEST_LINES_MISMATCH'
  | 'MANIFEST_DIGEST_MISMATCH'
  | 'CONTENT_UNDECODABLE'
  | 'CONTENT_SIZE_MISMATCH'
  | 'CONTENT_HASH_MISMATCH'
  | 'EXPECTED_DIGEST_MISMATCH';

export interface AipFailure {
  readonly code: AipFailureCode;
  readonly relativePath?: string;
}

export interface AipIntegrityReport {
  readonly ok: boolean;
  readonly failures: readonly AipFailure[];
  /** Empreinte recalculée depuis les lignes du manifeste présentes dans le paquet. */
  readonly recomputedAipSha256Hex: string;
}

/** Recalcule tout : objets (taille, SHA-256), lignes du manifeste, empreinte du paquet. Pure, sans accès au coffre. */
export async function verifyAipPackage(aip: AipPackage, options: { readonly expectedAipSha256Hex?: string } = {}): Promise<AipIntegrityReport> {
  const failures: AipFailure[] = [];
  const declaredLines = aip.contents.map(manifestLine);
  if (declaredLines.length !== aip.manifest.lines.length || declaredLines.some((line, index) => line !== aip.manifest.lines[index])) {
    failures.push({ code: 'MANIFEST_LINES_MISMATCH' });
  }
  for (const entry of aip.contents) {
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(entry.dataB64);
    } catch {
      failures.push({ code: 'CONTENT_UNDECODABLE', relativePath: entry.relativePath });
      continue;
    }
    if (bytes.length !== entry.sizeBytes) failures.push({ code: 'CONTENT_SIZE_MISMATCH', relativePath: entry.relativePath });
    if (!isSha256Hex(entry.sha256Hex) || (await sha256Hex(bytes)) !== entry.sha256Hex) failures.push({ code: 'CONTENT_HASH_MISMATCH', relativePath: entry.relativePath });
  }
  const recomputed = await computeAipSha256Hex(aip.manifest.lines);
  if (recomputed !== aip.manifest.aipSha256Hex) failures.push({ code: 'MANIFEST_DIGEST_MISMATCH' });
  if (options.expectedAipSha256Hex !== undefined && recomputed !== options.expectedAipSha256Hex) failures.push({ code: 'EXPECTED_DIGEST_MISMATCH' });
  return { ok: failures.length === 0, failures, recomputedAipSha256Hex: recomputed };
}

/** Octets d'un objet du paquet, après vérification de leur empreinte (undefined si absent ou altéré). */
export async function readAipContent(aip: AipPackage, relativePath: string): Promise<Uint8Array | undefined> {
  const entry = aip.contents.find((candidate) => candidate.relativePath === relativePath);
  if (entry === undefined) return undefined;
  const bytes = fromBase64(entry.dataB64);
  return (await sha256Hex(bytes)) === entry.sha256Hex ? bytes : undefined;
}

/** Feuille de Merkle d'un AIP : les 32 octets de son empreinte. */
export function aipLeaf(aip: AipPackage): Uint8Array {
  return fromHex(aip.manifest.aipSha256Hex);
}

/** Clé d'objet déterministe et opaque : aucun nom de personne ni de pièce, seulement des identifiants. */
export function aipObjectKey(companyId: string, aipId: string): string {
  assertValidCompanyId(companyId);
  if (!OPAQUE_ID.test(aipId)) bad('AIP_INVALID_INPUT', 'aipId : identifiant opaque [A-Za-z0-9_-]{1,64} attendu.');
  return `aip/v1/${companyId}/${aipId}.json`;
}

export const METADATA_ENCRYPTION = 'fisca-encryption';
export const METADATA_AIP_SHA256 = 'fisca-aip-sha256';
export const METADATA_FORMAT = 'fisca-format';
const ENCRYPTION_NONE = 'none';

export interface RetentionPolicy {
  /** Durée de rétention en jours entiers, fournie par l'appelant (3653 pour R2_LEGAL_VAULT, voir DEFAULT_RETENTION_DAYS). */
  readonly days: number;
}

export function retentionUntilIso(fromIso: string, policy: RetentionPolicy): string {
  if (!Number.isSafeInteger(policy.days) || policy.days < 1) throw new VaultMerkleError('VAULT_RETENTION_INVALID', 'rétention : nombre entier de jours >= 1 attendu.');
  return formatInstant(parseInstantMs(fromIso, 'VAULT_RETENTION_INVALID') + policy.days * MS_PER_DAY);
}

export interface WriteAipInput {
  readonly vault: WormVaultDriver;
  readonly aip: AipPackage;
  readonly retention: RetentionPolicy;
  /** Scelleur obligatoire : ADR-07 et Doc_10 exigent un paquet chiffré AES-256-GCM ; aucun AIP en clair n'entre au coffre. */
  readonly cipher: AipPayloadCipher;
}

export interface WriteAipResult {
  readonly key: string;
  readonly aipSha256Hex: string;
  readonly etag: string;
  readonly retentionUntilIso: string;
  readonly encrypted: true;
}

/**
 * Écrit l'AIP dans le coffre WORM : clé déterministe, rétention = date de création + durée fournie. Une clé existante est refusée
 * par le coffre (INFRA_VAULT_IMMUTABLE). L'intégrité est contrôlée AVANT écriture (aucun paquet incohérent n'entre au coffre).
 */
export async function writeAip(input: WriteAipInput): Promise<WriteAipResult> {
  const report = await verifyAipPackage(input.aip);
  if (!report.ok) throw new VaultMerkleError('AIP_INVALID_INPUT', 'paquet AIP incohérent : écriture refusée.');
  const key = aipObjectKey(input.aip.companyId, input.aip.aipId);
  const plain = serializeAip(input.aip);
  const stored = await input.cipher.seal(plain, { companyId: input.aip.companyId, aipId: input.aip.aipId });
  const until = retentionUntilIso(input.aip.createdAtIso, input.retention);
  const { etag } = await input.vault.putImmutableObject(key, stored, {
    retentionUntilIso: until,
    sha256Hex: await sha256Hex(stored),
    customMetadata: {
      [METADATA_FORMAT]: `aip-v${AIP_FORMAT_VERSION}`,
      [METADATA_AIP_SHA256]: input.aip.manifest.aipSha256Hex,
      [METADATA_ENCRYPTION]: input.cipher.algorithm,
    },
  });
  return { key, aipSha256Hex: input.aip.manifest.aipSha256Hex, etag, retentionUntilIso: until, encrypted: true };
}

export interface ReadAipInput {
  readonly vault: WormVaultDriver;
  readonly companyId: string;
  readonly aipId: string;
  readonly cipher?: AipPayloadCipher;
}

export async function readAip(input: ReadAipInput): Promise<AipPackage> {
  const object: WormObject | null = await input.vault.getObjectBytes(aipObjectKey(input.companyId, input.aipId));
  if (object === null) throw new VaultMerkleError('AIP_NOT_FOUND', 'aucun paquet AIP sous cette clé.');
  const encryption = object.metadata[METADATA_ENCRYPTION] ?? ENCRYPTION_NONE;
  let plain = object.bytes;
  if (encryption !== ENCRYPTION_NONE) {
    if (input.cipher === undefined || input.cipher.algorithm !== encryption) {
      throw new VaultMerkleError('AIP_DECRYPTION_FAILED', 'paquet scellé : scelleur compatible requis.');
    }
    plain = await input.cipher.open(object.bytes, { companyId: input.companyId, aipId: input.aipId });
  }
  const aip = parseAip(plain);
  if (aip.aipId !== input.aipId || aip.companyId !== input.companyId) throw new VaultMerkleError('AIP_UNREADABLE', 'identité du paquet différente de sa clé.');
  return aip;
}

/** Relit l'AIP dans le coffre et recalcule toutes les empreintes ; compare aussi à l'empreinte enregistrée en métadonnée. */
export async function verifyAip(input: ReadAipInput & { readonly expectedAipSha256Hex?: string }): Promise<AipIntegrityReport> {
  const aip = await readAip(input);
  const object = await input.vault.getObjectBytes(aipObjectKey(input.companyId, input.aipId));
  const expected = input.expectedAipSha256Hex ?? object?.metadata[METADATA_AIP_SHA256];
  return verifyAipPackage(aip, expected === undefined ? {} : { expectedAipSha256Hex: expected });
}
