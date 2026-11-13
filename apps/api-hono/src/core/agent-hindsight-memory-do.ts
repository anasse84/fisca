/**
 * AgentHindsightMemoryDO : mémoire auto-apprenante à trois niveaux d'une société (Doc_04 § 06, Doc_06 § 07, Doc_02 § 03,
 * Doc_14 § 07). Une instance par société (nom d'objet = identifiant de société), jamais d'accès inter-société : aucune charge ne
 * porte de société, l'instance ne connaît que son propre stockage.
 *
 * Opérations (noms de Doc_04 / Doc_02 / Doc_14) :
 * - retain : `retainFact` (world_facts), `retainExperience` (experiences) ;
 * - recall : `recallFact`, `recall` (opinion apprise + expériences récentes d'un fournisseur) ;
 * - reflect : `reflectOnHumanCorrection` (retient l'expérience corrigée et recalcule l'opinion `evolving_opinions` du fournisseur).
 * Plus `forgetSupplier` : droit à l'oubli sur les données non fiscales (Doc_06 § 09, Doc_11 : purge immédiate du non-comptable).
 *
 * Données personnelles : la spécification impose la pseudonymisation avant IA ; ce DO ne reçoit que des index aveugles
 * (`supplier_ice_bidx`, 32 hexadécimaux), des empreintes de libellé (`raw_label_hash`), des comptes PCGE et des faits JSON ; tout fait
 * contenant un ICE, un RIB, un IBAN, un courriel ou un téléphone en clair est refusé (heuristique, voir le rapport).
 *
 * Ce que la spécification ne fixe pas, et le choix retenu ici (à confirmer) :
 * - clé de motif : `supplier:<supplier_ice_bidx>` (Doc_02 § 04 : « ajuster evolving_opinions sur ce fournisseur ») ;
 * - règle d'opinion : le compte préféré est le compte final de l'expérience décidée la plus récente (une correction humaine l'emporte,
 *   Doc_14 § 07 : « proposer 6142 dès la facture suivante ») ; la confiance en points de base est la part des expériences décidées qui
 *   confirment ce compte, arrondie au demi supérieur par `divRoundHalfUpBigInt` (ERRATA D-09) ; `occurrences_count` en est le numérateur.
 *   Une expérience est décidée si elle est acceptée telle quelle (compte final = proposé) ou corrigée par un humain ;
 * - aucun plafond de capacité ni purge automatique : la spécification n'en définit pas.
 * Aucune lecture de l'horloge ni génération d'identifiant : horodatages et identifiants UUIDv7 viennent de l'appelant.
 */
import { divRoundHalfUpBigInt } from '@fisca/shared-types';
import { AGENT_HINDSIGHT_SCHEMA } from './durable-object-ddl.ts';
import {
  applyDurableObjectSchema,
  companyIdOfState,
  isCanonicalUtcTimestamp,
  isPlainRecord,
  jsonResponse,
  readJsonBody,
  SHA256_LOWER_HEX,
  utf8Length,
  type DurableObjectStateLike,
} from './durable-object-sql.ts';

export type HindsightErrorCode =
  | 'HINDSIGHT_INVALID_REQUEST'
  | 'HINDSIGHT_PII_REJECTED'
  | 'HINDSIGHT_EXPERIENCE_CONFLICT'
  | 'HINDSIGHT_COMPANY_UNRESOLVED';

export class HindsightError extends Error {
  readonly code: HindsightErrorCode;

  constructor(code: HindsightErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'HindsightError';
    this.code = code;
  }
}

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface RetainFactRequest {
  readonly factKey: string;
  readonly fact: JsonValue;
  readonly updatedAtIso: string;
}

export interface RetainedFact {
  readonly factKey: string;
  readonly fact: JsonValue;
  readonly updatedAtIso: string;
}

export interface FactRequest {
  readonly factKey: string;
}

export interface ExperienceInput {
  /** UUIDv7 fourni par l'appelant (Doc_06 § 01). */
  readonly id: string;
  /** Index aveugle HMAC-SHA256 tronqué à 32 hexadécimaux (Doc_06 § 08), jamais l'ICE. */
  readonly supplierIceBidx: string | null;
  /** SHA-256 hexadécimal du libellé brut, jamais le libellé. */
  readonly rawLabelHash: string;
  readonly proposedPcgeAccount: string;
  readonly humanFinalPcgeAccount: string | null;
  readonly wasAcceptedAsIs: boolean;
  readonly createdAtIso: string;
}

export interface RetainedExperience {
  readonly id: string;
  readonly replayed: boolean;
}

export interface EvolvingOpinion {
  readonly patternKey: string;
  readonly preferredPcgeAccount: string;
  readonly confidenceBps: number;
  readonly occurrencesCount: number;
  readonly updatedAtIso: string;
}

export interface RecalledExperience {
  readonly id: string;
  readonly rawLabelHash: string;
  readonly proposedPcgeAccount: string;
  readonly humanFinalPcgeAccount: string | null;
  readonly wasAcceptedAsIs: boolean;
  readonly createdAtIso: string;
}

export interface RecallRequest {
  readonly supplierIceBidx: string;
  /** 1 à 50, 5 par défaut. */
  readonly recentLimit?: number;
}

export interface RecallResult {
  readonly supplierIceBidx: string;
  readonly opinion: EvolvingOpinion | null;
  readonly recentExperiences: readonly RecalledExperience[];
}

export interface ReflectionResult {
  readonly experienceId: string;
  readonly opinion: EvolvingOpinion;
}

export interface ForgetSupplierRequest {
  readonly supplierIceBidx: string;
}

export interface ForgetSupplierResult {
  readonly experiencesDeleted: number;
  readonly opinionsDeleted: number;
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BLIND_INDEX = /^[0-9a-f]{32}$/;
const PCGE_ACCOUNT = /^[1-9]\d{3,7}$/;
const FACT_KEY = /^[a-z][a-z0-9_.:-]{0,95}$/;
const DEFAULT_RECENT_LIMIT = 5;
const MAX_RECENT_LIMIT = 50;
const MAX_FACT_BYTES = 4096;
const MAX_FACT_DEPTH = 6;
const MAX_FACT_ENTRIES = 64;
const MAX_FACT_STRING = 512;

/** Données personnelles en clair : ICE (15 chiffres), RIB (24 chiffres), IBAN marocain, courriel, téléphone marocain. */
const PERSONAL_DATA_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['ICE', /(?<![0-9A-Za-z])\d{15}(?![0-9A-Za-z])/],
  ['RIB', /(?<![0-9A-Za-z])\d{24}(?![0-9A-Za-z])/],
  ['IBAN', /(?<![0-9A-Za-z])MA\d{2}\d{22,26}(?![0-9A-Za-z])/],
  ['courriel', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['téléphone', /(?<![0-9A-Za-z])(?:\+212|00212|0)[5-7]\d{8}(?![0-9A-Za-z])/],
];

function invalid(detail: string): never {
  throw new HindsightError('HINDSIGHT_INVALID_REQUEST', detail);
}

function strictObject(value: unknown, allowed: readonly string[], what: string): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return invalid(`${what} doit être un objet.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalid(`${what} : champ inconnu « ${key} » (la société est celle de l'instance, jamais dans la charge).`);
    }
  }
  return value;
}

function stringField(record: Record<string, unknown>, key: string, pattern: RegExp, expectation: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !pattern.test(value)) {
    return invalid(`${key} invalide : ${expectation}.`);
  }
  return value;
}

function timestampField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !isCanonicalUtcTimestamp(value)) {
    return invalid(`${key} doit être un horodatage UTC canonique YYYY-MM-DDTHH:MM:SSZ.`);
  }
  return value;
}

function assertJsonValue(value: unknown, depth: number, counter: { entries: number }): JsonValue {
  if (depth > MAX_FACT_DEPTH) {
    return invalid(`fact : profondeur supérieure à ${MAX_FACT_DEPTH}.`);
  }
  counter.entries += 1;
  if (counter.entries > MAX_FACT_ENTRIES) {
    return invalid(`fact : plus de ${MAX_FACT_ENTRIES} éléments.`);
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_FACT_STRING) {
      invalid(`fact : chaîne de plus de ${MAX_FACT_STRING} caractères.`);
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      invalid('fact : seuls les entiers sûrs sont admis (ADR-03, aucun flottant).');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => assertJsonValue(item, depth + 1, counter));
  }
  if (isPlainRecord(value)) {
    const entries: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      entries[key] = assertJsonValue(item, depth + 1, counter);
    }
    return entries;
  }
  return invalid('fact : valeur non JSON.');
}

function assertNoPersonalData(serialized: string): void {
  for (const [label, pattern] of PERSONAL_DATA_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new HindsightError(
        'HINDSIGHT_PII_REJECTED',
        `donnée personnelle en clair détectée (${label}) : pseudonymiser avant mémorisation (index aveugle, empreinte).`,
      );
    }
  }
}

function parseRetainFact(value: unknown): RetainFactRequest {
  const record = strictObject(value, ['factKey', 'fact', 'updatedAtIso'], 'fait');
  const factKey = stringField(record, 'factKey', FACT_KEY, 'minuscules, chiffres et . _ : -, 96 caractères au plus, lettre en tête');
  const fact = assertJsonValue(record['fact'], 0, { entries: 0 });
  const serialized = JSON.stringify(fact);
  if (utf8Length(serialized) > MAX_FACT_BYTES) {
    invalid(`fact : plus de ${MAX_FACT_BYTES} octets.`);
  }
  assertNoPersonalData(`${factKey} ${serialized}`);
  return { factKey, fact, updatedAtIso: timestampField(record, 'updatedAtIso') };
}

function parseFactRequest(value: unknown): FactRequest {
  const record = strictObject(value, ['factKey'], 'demande de fait');
  return { factKey: stringField(record, 'factKey', FACT_KEY, 'clé de fait invalide') };
}

function parseExperience(value: unknown): ExperienceInput {
  const record = strictObject(
    value,
    ['id', 'supplierIceBidx', 'rawLabelHash', 'proposedPcgeAccount', 'humanFinalPcgeAccount', 'wasAcceptedAsIs', 'createdAtIso'],
    'expérience',
  );
  const supplierRaw = record['supplierIceBidx'];
  const supplierIceBidx = supplierRaw === null ? null : stringField(record, 'supplierIceBidx', BLIND_INDEX, '32 hexadécimaux minuscules (index aveugle) ou null');
  const finalRaw = record['humanFinalPcgeAccount'];
  const humanFinalPcgeAccount = finalRaw === null ? null : stringField(record, 'humanFinalPcgeAccount', PCGE_ACCOUNT, 'compte PCGE de 4 à 8 chiffres ou null');
  const accepted = record['wasAcceptedAsIs'];
  if (typeof accepted !== 'boolean') {
    return invalid('wasAcceptedAsIs doit être un booléen.');
  }
  const proposedPcgeAccount = stringField(record, 'proposedPcgeAccount', PCGE_ACCOUNT, 'compte PCGE de 4 à 8 chiffres');
  if (accepted && humanFinalPcgeAccount !== null && humanFinalPcgeAccount !== proposedPcgeAccount) {
    invalid('une proposition acceptée telle quelle ne peut pas porter un autre compte final.');
  }
  if (!accepted && humanFinalPcgeAccount === proposedPcgeAccount) {
    invalid('un compte final identique à la proposition est une acceptation telle quelle.');
  }
  return {
    id: stringField(record, 'id', UUID_V7, 'UUIDv7 attendu'),
    supplierIceBidx,
    rawLabelHash: stringField(record, 'rawLabelHash', SHA256_LOWER_HEX, 'SHA-256 hexadécimal minuscule du libellé (jamais le libellé)'),
    proposedPcgeAccount,
    humanFinalPcgeAccount,
    wasAcceptedAsIs: accepted,
    createdAtIso: timestampField(record, 'createdAtIso'),
  };
}

function parseRecall(value: unknown): RecallRequest {
  const record = strictObject(value, ['supplierIceBidx', 'recentLimit'], 'rappel');
  const supplierIceBidx = stringField(record, 'supplierIceBidx', BLIND_INDEX, '32 hexadécimaux minuscules (index aveugle)');
  const limit = record['recentLimit'];
  if (limit === undefined) {
    return { supplierIceBidx };
  }
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECENT_LIMIT) {
    return invalid(`recentLimit doit être un entier de 1 à ${MAX_RECENT_LIMIT}.`);
  }
  return { supplierIceBidx, recentLimit: limit };
}

function parseForget(value: unknown): ForgetSupplierRequest {
  const record = strictObject(value, ['supplierIceBidx'], 'oubli fournisseur');
  return { supplierIceBidx: stringField(record, 'supplierIceBidx', BLIND_INDEX, '32 hexadécimaux minuscules (index aveugle)') };
}

type FactRow = { fact_key: string; fact_json: string; updated_at: string };
type ExperienceRow = {
  id: string;
  supplier_ice_bidx: string | null;
  raw_label_hash: string;
  proposed_pcge_account: string;
  human_final_pcge_account: string | null;
  was_accepted_as_is: number;
  created_at: string;
};
type OpinionRow = {
  pattern_key: string;
  preferred_pcge_account: string;
  confidence_bps: number;
  occurrences_count: number;
  updated_at: string;
};
type DecidedRow = { final_account: string };
type CountRow = { total: number };

function patternKeyOf(supplierIceBidx: string): string {
  return `supplier:${supplierIceBidx}`;
}

function toOpinion(row: OpinionRow): EvolvingOpinion {
  return {
    patternKey: row.pattern_key,
    preferredPcgeAccount: row.preferred_pcge_account,
    confidenceBps: row.confidence_bps,
    occurrencesCount: row.occurrences_count,
    updatedAtIso: row.updated_at,
  };
}

function toRecalled(row: ExperienceRow): RecalledExperience {
  return {
    id: row.id,
    rawLabelHash: row.raw_label_hash,
    proposedPcgeAccount: row.proposed_pcge_account,
    humanFinalPcgeAccount: row.human_final_pcge_account,
    wasAcceptedAsIs: row.was_accepted_as_is === 1,
    createdAtIso: row.created_at,
  };
}

export class AgentHindsightMemoryDO {
  private readonly ready: Promise<string>;

  constructor(
    private readonly ctx: DurableObjectStateLike,
    readonly env: unknown = undefined,
  ) {
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const companyId = companyIdOfState(ctx);
      if (companyId === null) {
        throw new HindsightError(
          'HINDSIGHT_COMPANY_UNRESOLVED',
          "l'objet doit être obtenu par nom (idFromName / getByName) avec un identifiant de société valide.",
        );
      }
      await applyDurableObjectSchema(ctx.storage, AGENT_HINDSIGHT_SCHEMA);
      return companyId;
    });
    this.ready.catch(() => undefined);
  }

  async retainFact(request: RetainFactRequest): Promise<RetainedFact> {
    await this.ready;
    const input = parseRetainFact(request);
    this.ctx.storage.sql.exec(
      `INSERT INTO world_facts (fact_key, fact_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(fact_key) DO UPDATE SET fact_json = excluded.fact_json, updated_at = excluded.updated_at`,
      input.factKey,
      JSON.stringify(input.fact),
      input.updatedAtIso,
    );
    return { factKey: input.factKey, fact: input.fact, updatedAtIso: input.updatedAtIso };
  }

  async recallFact(request: FactRequest): Promise<RetainedFact | null> {
    await this.ready;
    const input = parseFactRequest(request);
    const row = this.ctx.storage.sql.exec<FactRow>('SELECT * FROM world_facts WHERE fact_key = ?', input.factKey).toArray()[0];
    if (row === undefined) {
      return null;
    }
    const fact = assertJsonValue(JSON.parse(row.fact_json), 0, { entries: 0 });
    return { factKey: row.fact_key, fact, updatedAtIso: row.updated_at };
  }

  /** Retient une proposition d'imputation (acceptée, corrigée ou en attente), idempotent par identifiant. */
  async retainExperience(request: ExperienceInput): Promise<RetainedExperience> {
    await this.ready;
    const input = parseExperience(request);
    return this.ctx.storage.transactionSync(() => this.insertExperience(input));
  }

  /** Rappel d'un fournisseur : opinion apprise (ou null) et expériences les plus récentes. */
  async recall(request: RecallRequest): Promise<RecallResult> {
    await this.ready;
    const input = parseRecall(request);
    const sql = this.ctx.storage.sql;
    const opinion = sql
      .exec<OpinionRow>('SELECT * FROM evolving_opinions WHERE pattern_key = ?', patternKeyOf(input.supplierIceBidx))
      .toArray()[0];
    const recent = sql
      .exec<ExperienceRow>(
        'SELECT * FROM experiences WHERE supplier_ice_bidx = ? ORDER BY created_at DESC, id DESC LIMIT ?',
        input.supplierIceBidx,
        input.recentLimit ?? DEFAULT_RECENT_LIMIT,
      )
      .toArray();
    return {
      supplierIceBidx: input.supplierIceBidx,
      opinion: opinion === undefined ? null : toOpinion(opinion),
      recentExperiences: recent.map(toRecalled),
    };
  }

  /**
   * Hook de la transition IA_PROPOSITION → DRAFT (Doc_02 § 04) : retient l'expérience corrigée par l'humain et recalcule l'opinion
   * du fournisseur, dans une seule transaction.
   */
  async reflectOnHumanCorrection(request: ExperienceInput): Promise<ReflectionResult> {
    await this.ready;
    const input = parseExperience(request);
    if (input.supplierIceBidx === null) {
      invalid('reflectOnHumanCorrection exige un fournisseur (supplierIceBidx).');
    }
    if (input.humanFinalPcgeAccount === null) {
      invalid('reflectOnHumanCorrection exige le compte final retenu par l’humain.');
    }
    const supplierIceBidx = input.supplierIceBidx;
    return this.ctx.storage.transactionSync(() => {
      this.insertExperience(input);
      return { experienceId: input.id, opinion: this.recomputeOpinion(supplierIceBidx, input.createdAtIso) };
    });
  }

  /** Droit à l'oubli sur les données non fiscales d'un fournisseur : purge ses expériences et son opinion. */
  async forgetSupplier(request: ForgetSupplierRequest): Promise<ForgetSupplierResult> {
    await this.ready;
    const input = parseForget(request);
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const experiences = sql
        .exec<CountRow>('SELECT COUNT(*) AS total FROM experiences WHERE supplier_ice_bidx = ?', input.supplierIceBidx)
        .one().total;
      const opinions = sql
        .exec<CountRow>('SELECT COUNT(*) AS total FROM evolving_opinions WHERE pattern_key = ?', patternKeyOf(input.supplierIceBidx))
        .one().total;
      sql.exec('DELETE FROM experiences WHERE supplier_ice_bidx = ?', input.supplierIceBidx);
      sql.exec('DELETE FROM evolving_opinions WHERE pattern_key = ?', patternKeyOf(input.supplierIceBidx));
      return { experiencesDeleted: experiences, opinionsDeleted: opinions };
    });
  }

  /** Protocole HTTP interne (POST JSON) ; les méthodes ci-dessus restent la voie RPC. */
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const routes = ['/v1/retain-fact', '/v1/recall-fact', '/v1/retain-experience', '/v1/recall', '/v1/reflect', '/v1/forget-supplier'];
    if (!routes.includes(path)) {
      return jsonResponse(404, { error: { code: 'HINDSIGHT_NOT_FOUND', message: `route inconnue ${path}` } });
    }
    if (request.method !== 'POST') {
      return jsonResponse(405, { error: { code: 'HINDSIGHT_METHOD_NOT_ALLOWED', message: 'POST attendu' } });
    }
    const body = await readJsonBody(request);
    try {
      if (body === undefined) {
        invalid('corps JSON illisible.');
      }
      switch (path) {
        case '/v1/retain-fact':
          return jsonResponse(200, await this.retainFact(parseRetainFact(body)));
        case '/v1/recall-fact':
          return jsonResponse(200, await this.recallFact(parseFactRequest(body)));
        case '/v1/retain-experience':
          return jsonResponse(200, await this.retainExperience(parseExperience(body)));
        case '/v1/recall':
          return jsonResponse(200, await this.recall(parseRecall(body)));
        case '/v1/reflect':
          return jsonResponse(200, await this.reflectOnHumanCorrection(parseExperience(body)));
        default:
          return jsonResponse(200, await this.forgetSupplier(parseForget(body)));
      }
    } catch (error) {
      if (error instanceof HindsightError) {
        const status =
          error.code === 'HINDSIGHT_INVALID_REQUEST'
            ? 400
            : error.code === 'HINDSIGHT_PII_REJECTED'
              ? 422
              : error.code === 'HINDSIGHT_EXPERIENCE_CONFLICT'
                ? 409
                : 500;
        return jsonResponse(status, { error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  }

  private insertExperience(input: ExperienceInput): RetainedExperience {
    const sql = this.ctx.storage.sql;
    const existing = sql.exec<ExperienceRow>('SELECT * FROM experiences WHERE id = ?', input.id).toArray()[0];
    if (existing !== undefined) {
      const same =
        existing.supplier_ice_bidx === input.supplierIceBidx &&
        existing.raw_label_hash === input.rawLabelHash &&
        existing.proposed_pcge_account === input.proposedPcgeAccount &&
        existing.human_final_pcge_account === input.humanFinalPcgeAccount &&
        (existing.was_accepted_as_is === 1) === input.wasAcceptedAsIs &&
        existing.created_at === input.createdAtIso;
      if (!same) {
        throw new HindsightError('HINDSIGHT_EXPERIENCE_CONFLICT', `l'identifiant ${input.id} existe déjà avec un autre contenu.`);
      }
      return { id: input.id, replayed: true };
    }
    sql.exec(
      `INSERT INTO experiences (id, supplier_ice_bidx, raw_label_hash, proposed_pcge_account, human_final_pcge_account, was_accepted_as_is, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.supplierIceBidx,
      input.rawLabelHash,
      input.proposedPcgeAccount,
      input.humanFinalPcgeAccount,
      input.wasAcceptedAsIs ? 1 : 0,
      input.createdAtIso,
    );
    return { id: input.id, replayed: false };
  }

  private recomputeOpinion(supplierIceBidx: string, updatedAtIso: string): EvolvingOpinion {
    const sql = this.ctx.storage.sql;
    const decided = sql
      .exec<DecidedRow>(
        `SELECT COALESCE(human_final_pcge_account, proposed_pcge_account) AS final_account
           FROM experiences
          WHERE supplier_ice_bidx = ? AND (human_final_pcge_account IS NOT NULL OR was_accepted_as_is = 1)
          ORDER BY created_at DESC, id DESC`,
        supplierIceBidx,
      )
      .toArray();
    const latest = decided[0];
    if (latest === undefined) {
      return invalid('aucune expérience décidée pour ce fournisseur.');
    }
    const preferredPcgeAccount = latest.final_account;
    const occurrencesCount = decided.filter((row) => row.final_account === preferredPcgeAccount).length;
    const confidenceBps = Number(divRoundHalfUpBigInt(BigInt(occurrencesCount) * 10000n, BigInt(decided.length)));
    sql.exec(
      `INSERT INTO evolving_opinions (pattern_key, preferred_pcge_account, confidence_bps, occurrences_count, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(pattern_key) DO UPDATE SET preferred_pcge_account = excluded.preferred_pcge_account,
         confidence_bps = excluded.confidence_bps, occurrences_count = excluded.occurrences_count, updated_at = excluded.updated_at`,
      patternKeyOf(supplierIceBidx),
      preferredPcgeAccount,
      confidenceBps,
      occurrencesCount,
      updatedAtIso,
    );
    return { patternKey: patternKeyOf(supplierIceBidx), preferredPcgeAccount, confidenceBps, occurrencesCount, updatedAtIso };
  }
}
