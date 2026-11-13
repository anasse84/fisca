/**
 * InvoiceSequencerDO : séquenceur fiscal sans trou ni doublon (Art. 145 CGI) et chaînage PIH (Doc_02 § 02, Doc_04 § 06,
 * Doc_06 § 07). Une instance par société (nom d'objet = identifiant de société, résolu par `ctx.id.name`), mono-thread.
 *
 * Ce que Doc_02 / Doc_04 / Doc_06 fixent, et ce que ce fichier en tire :
 * - PIH = « hash SHA-256 de la facture validée précédente » (Doc_02 § 02, Doc_07) ; empreinte initiale = SHA-256 de la chaîne vide
 *   (valeur par défaut de `last_cleared_pi_hash`, Doc_06 § 07) ;
 * - numérotation par `series_key` (exemples `FAC-2026`, `AVO-2026`, `NDB-2026`), entier croissant sans trou ;
 * - attribution et chaînage dans la même transaction ; une facture rejetée par xHub conserve son numéro et son hash (Doc_02 § 02),
 *   un essai de soumission n'incrémente que `submission_attempt_counter` (Doc_01).
 *
 * Ce que les spécifications NE fixent PAS, et que ce fichier n'invente donc pas :
 * - le FORMAT du numéro affiché (`invoices.sequential_number` est un TEXT sans gabarit) : le séquenceur rend l'entier
 *   `sequenceNumber` et la clé de série, la mise en forme appartient à l'appelant une fois le gabarit fixé ;
 * - la CONSTRUCTION de l'empreinte d'une facture (octets hachés : XML UBL canonique, PDF, enregistrement) : le séquenceur ne hache
 *   jamais une facture, il enregistre l'empreinte SHA-256 `invoiceSha256` que le domaine de facturation calcule et la sert comme
 *   PIH de la facture suivante de la série. Il vérifie le chaînage, pas le contenu ;
 * - le compteur monotone ICV (Doc_06 § 03, colonne `invoices.icv_counter`) : aucun emplacement dans Doc_06 § 07, non implémenté.
 *
 * Horloge et identifiants : tout horodatage est fourni par l'appelant (`requestedAtIso`), la clé d'idempotence aussi.
 */
import {
  applyDurableObjectSchema,
  companyIdOfState,
  isCanonicalUtcTimestamp,
  isPlainRecord,
  jsonResponse,
  readJsonBody,
  SHA256_LOWER_HEX,
  type DurableObjectStateLike,
} from './durable-object-sql.ts';
import { INITIAL_PIH_SHA256, INVOICE_SEQUENCER_SCHEMA } from './durable-object-ddl.ts';

export type SequencerErrorCode =
  | 'SEQ_INVALID_REQUEST'
  | 'SEQ_IDEMPOTENCY_CONFLICT'
  | 'SEQ_COMPANY_UNRESOLVED'
  | 'SEQ_CHAIN_CORRUPT'
  | 'SEQ_SERIES_UNKNOWN';

export class SequencerError extends Error {
  readonly code: SequencerErrorCode;

  constructor(code: SequencerErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'SequencerError';
    this.code = code;
  }
}

export interface AllocateInvoiceNumberRequest {
  /** Clé de rejeu fournie par l'appelant (par exemple l'identifiant de la facture). */
  readonly idempotencyKey: string;
  /** Clé de série `AAA-AAAA` : type de pièce et exercice (`FAC-2026`). */
  readonly seriesKey: string;
  /** Empreinte SHA-256 hexadécimale minuscule de la facture, calculée par le domaine de facturation. */
  readonly invoiceSha256: string;
  readonly requestedAtIso: string;
}

export interface AllocatedInvoiceNumber {
  readonly seriesKey: string;
  readonly sequenceNumber: number;
  /** PIH : empreinte de la facture précédente de la série (empreinte initiale pour le numéro 1). */
  readonly previousInvoiceHash: string;
  readonly invoiceSha256: string;
  readonly allocatedAtIso: string;
  readonly idempotentReplay: boolean;
}

export interface SubmissionAttemptRequest {
  readonly seriesKey: string;
  readonly requestedAtIso: string;
}

export interface SubmissionAttemptResult {
  readonly seriesKey: string;
  readonly submissionAttemptCounter: number;
}

export interface SeriesRequest {
  readonly seriesKey: string;
}

export interface SeriesHead {
  readonly seriesKey: string;
  readonly lastNumber: number;
  readonly lastInvoiceHash: string;
  readonly submissionAttemptCounter: number;
  readonly updatedAtIso: string;
}

export type ChainIssueCode = 'GAP_OR_DUPLICATE' | 'PIH_BROKEN' | 'HEAD_MISMATCH';

export interface ChainIssue {
  readonly sequenceNumber: number;
  readonly code: ChainIssueCode;
  readonly detail: string;
}

export interface ChainVerification {
  readonly seriesKey: string;
  readonly ok: boolean;
  readonly length: number;
  readonly issues: readonly ChainIssue[];
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;
const SERIES_KEY = /^[A-Z]{2,8}-\d{4}$/;

type HeadRow = {
  series_key: string;
  submission_attempt_counter: number;
  last_cleared_number: number;
  last_cleared_pi_hash: string;
  updated_at: string;
};

type JournalRow = {
  series_key: string;
  sequence_number: number;
  idempotency_key: string;
  previous_hash: string;
  invoice_sha256: string;
  allocated_at: string;
};

function invalid(detail: string): never {
  throw new SequencerError('SEQ_INVALID_REQUEST', detail);
}

function strictObject(value: unknown, allowed: readonly string[], what: string): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return invalid(`${what} doit être un objet.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalid(`${what} : champ inconnu « ${key} » (ni société ni identifiant technique ne se passent dans la charge).`);
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

function seriesField(record: Record<string, unknown>): string {
  return stringField(record, 'seriesKey', SERIES_KEY, 'forme AAA-AAAA attendue (type de pièce en majuscules, exercice), par exemple FAC-2026');
}

function parseAllocate(value: unknown): AllocateInvoiceNumberRequest {
  const record = strictObject(value, ['idempotencyKey', 'seriesKey', 'invoiceSha256', 'requestedAtIso'], 'demande de numéro');
  return {
    idempotencyKey: stringField(record, 'idempotencyKey', IDEMPOTENCY_KEY, '1 à 128 caractères parmi A-Z a-z 0-9 . _ : -'),
    seriesKey: seriesField(record),
    invoiceSha256: stringField(record, 'invoiceSha256', SHA256_LOWER_HEX, '64 caractères hexadécimaux minuscules'),
    requestedAtIso: timestampField(record, 'requestedAtIso'),
  };
}

function parseAttempt(value: unknown): SubmissionAttemptRequest {
  const record = strictObject(value, ['seriesKey', 'requestedAtIso'], "essai de soumission");
  return { seriesKey: seriesField(record), requestedAtIso: timestampField(record, 'requestedAtIso') };
}

function parseSeries(value: unknown): SeriesRequest {
  const record = strictObject(value, ['seriesKey'], 'demande de série');
  return { seriesKey: seriesField(record) };
}

function toAllocated(row: JournalRow, idempotentReplay: boolean): AllocatedInvoiceNumber {
  return {
    seriesKey: row.series_key,
    sequenceNumber: row.sequence_number,
    previousInvoiceHash: row.previous_hash,
    invoiceSha256: row.invoice_sha256,
    allocatedAtIso: row.allocated_at,
    idempotentReplay,
  };
}

export class InvoiceSequencerDO {
  private readonly ready: Promise<string>;

  constructor(
    private readonly ctx: DurableObjectStateLike,
    readonly env: unknown = undefined,
  ) {
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const companyId = companyIdOfState(ctx);
      if (companyId === null) {
        throw new SequencerError(
          'SEQ_COMPANY_UNRESOLVED',
          "l'objet doit être obtenu par nom (idFromName / getByName) avec un identifiant de société valide.",
        );
      }
      await applyDurableObjectSchema(ctx.storage, INVOICE_SEQUENCER_SCHEMA);
      return companyId;
    });
    this.ready.catch(() => undefined);
  }

  /**
   * Attribue le prochain numéro de la série et enregistre l'empreinte de la facture (donc le PIH de la suivante) dans UNE transaction.
   * Rejouer la même clé d'idempotence rend le même résultat sans rien consommer.
   */
  async allocateInvoiceNumber(request: AllocateInvoiceNumberRequest): Promise<AllocatedInvoiceNumber> {
    await this.ready;
    const input = parseAllocate(request);
    return this.ctx.storage.transactionSync(() => this.allocateWithinTransaction(input));
  }

  /** Compte un essai de soumission (rejet xHub, nouvelle tentative) sans toucher au numéro ni au PIH. */
  async recordSubmissionAttempt(request: SubmissionAttemptRequest): Promise<SubmissionAttemptResult> {
    await this.ready;
    const input = parseAttempt(request);
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const head = sql
        .exec<HeadRow>('SELECT * FROM fiscal_sequences WHERE series_key = ?', input.seriesKey)
        .toArray()[0];
      if (head === undefined) {
        throw new SequencerError('SEQ_SERIES_UNKNOWN', `la série ${input.seriesKey} n'a encore attribué aucun numéro.`);
      }
      const counter = head.submission_attempt_counter + 1;
      sql.exec(
        'UPDATE fiscal_sequences SET submission_attempt_counter = ?, updated_at = ? WHERE series_key = ?',
        counter,
        input.requestedAtIso,
        input.seriesKey,
      );
      return { seriesKey: input.seriesKey, submissionAttemptCounter: counter };
    });
  }

  async getSeriesHead(request: SeriesRequest): Promise<SeriesHead | null> {
    await this.ready;
    const input = parseSeries(request);
    const head = this.ctx.storage.sql
      .exec<HeadRow>('SELECT * FROM fiscal_sequences WHERE series_key = ?', input.seriesKey)
      .toArray()[0];
    if (head === undefined) {
      return null;
    }
    return {
      seriesKey: head.series_key,
      lastNumber: head.last_cleared_number,
      lastInvoiceHash: head.last_cleared_pi_hash,
      submissionAttemptCounter: head.submission_attempt_counter,
      updatedAtIso: head.updated_at,
    };
  }

  /** Vérifie de bout en bout : numéros contigus depuis 1, chaque PIH égal à l'empreinte précédente, en-tête égal à la queue du journal. */
  async verifyChain(request: SeriesRequest): Promise<ChainVerification> {
    await this.ready;
    const input = parseSeries(request);
    const sql = this.ctx.storage.sql;
    const rows = sql
      .exec<JournalRow>('SELECT * FROM fiscal_sequence_journal WHERE series_key = ? ORDER BY sequence_number', input.seriesKey)
      .toArray();
    const head = sql.exec<HeadRow>('SELECT * FROM fiscal_sequences WHERE series_key = ?', input.seriesKey).toArray()[0];
    const issues: ChainIssue[] = [];
    let expectedNumber = 1;
    let previousHash = INITIAL_PIH_SHA256;
    for (const row of rows) {
      if (row.sequence_number !== expectedNumber) {
        issues.push({
          sequenceNumber: row.sequence_number,
          code: 'GAP_OR_DUPLICATE',
          detail: `numéro ${row.sequence_number} rencontré à la place de ${expectedNumber}.`,
        });
      }
      if (row.previous_hash !== previousHash) {
        issues.push({
          sequenceNumber: row.sequence_number,
          code: 'PIH_BROKEN',
          detail: `previous_hash ${row.previous_hash} différent de l'empreinte précédente ${previousHash}.`,
        });
      }
      expectedNumber = row.sequence_number + 1;
      previousHash = row.invoice_sha256;
    }
    const tail = rows[rows.length - 1];
    const tailNumber = tail?.sequence_number ?? 0;
    const tailHash = tail?.invoice_sha256 ?? INITIAL_PIH_SHA256;
    if (head === undefined ? rows.length > 0 : head.last_cleared_number !== tailNumber || head.last_cleared_pi_hash !== tailHash) {
      issues.push({
        sequenceNumber: tailNumber,
        code: 'HEAD_MISMATCH',
        detail: `en-tête (${head?.last_cleared_number ?? 'absent'}) différent de la queue du journal (${tailNumber}).`,
      });
    }
    return { seriesKey: input.seriesKey, ok: issues.length === 0, length: rows.length, issues };
  }

  /** Protocole HTTP interne (POST JSON) ; les méthodes ci-dessus restent la voie RPC. */
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const routes = ['/v1/allocate', '/v1/submission-attempt', '/v1/head', '/v1/verify-chain'];
    if (!routes.includes(path)) {
      return jsonResponse(404, { error: { code: 'SEQ_NOT_FOUND', message: `route inconnue ${path}` } });
    }
    if (request.method !== 'POST') {
      return jsonResponse(405, { error: { code: 'SEQ_METHOD_NOT_ALLOWED', message: 'POST attendu' } });
    }
    const body = await readJsonBody(request);
    try {
      if (body === undefined) {
        invalid('corps JSON illisible.');
      }
      switch (path) {
        case '/v1/allocate':
          return jsonResponse(200, await this.allocateInvoiceNumber(parseAllocate(body)));
        case '/v1/submission-attempt':
          return jsonResponse(200, await this.recordSubmissionAttempt(parseAttempt(body)));
        case '/v1/head':
          return jsonResponse(200, await this.getSeriesHead(parseSeries(body)));
        default:
          return jsonResponse(200, await this.verifyChain(parseSeries(body)));
      }
    } catch (error) {
      if (error instanceof SequencerError) {
        const status =
          error.code === 'SEQ_INVALID_REQUEST' ? 400 : error.code === 'SEQ_IDEMPOTENCY_CONFLICT' ? 409 : error.code === 'SEQ_SERIES_UNKNOWN' ? 404 : 500;
        return jsonResponse(status, { error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  }

  private allocateWithinTransaction(input: AllocateInvoiceNumberRequest): AllocatedInvoiceNumber {
    const sql = this.ctx.storage.sql;
    const replay = sql
      .exec<JournalRow>('SELECT * FROM fiscal_sequence_journal WHERE idempotency_key = ?', input.idempotencyKey)
      .toArray()[0];
    if (replay !== undefined) {
      if (replay.series_key !== input.seriesKey || replay.invoice_sha256 !== input.invoiceSha256) {
        throw new SequencerError(
          'SEQ_IDEMPOTENCY_CONFLICT',
          `la clé ${input.idempotencyKey} a déjà servi pour la série ${replay.series_key} avec une autre empreinte ou une autre série.`,
        );
      }
      return toAllocated(replay, true);
    }

    sql.exec(
      'INSERT OR IGNORE INTO fiscal_sequences (series_key, updated_at) VALUES (?, ?)',
      input.seriesKey,
      input.requestedAtIso,
    );
    const head = sql.exec<HeadRow>('SELECT * FROM fiscal_sequences WHERE series_key = ?', input.seriesKey).one();
    const tail = sql
      .exec<JournalRow>(
        'SELECT * FROM fiscal_sequence_journal WHERE series_key = ? ORDER BY sequence_number DESC LIMIT 1',
        input.seriesKey,
      )
      .toArray()[0];
    const tailNumber = tail?.sequence_number ?? 0;
    const tailHash = tail?.invoice_sha256 ?? INITIAL_PIH_SHA256;
    if (head.last_cleared_number !== tailNumber || head.last_cleared_pi_hash !== tailHash) {
      throw new SequencerError(
        'SEQ_CHAIN_CORRUPT',
        `série ${input.seriesKey} : l'en-tête (${head.last_cleared_number}) ne correspond plus au journal (${tailNumber}) ; aucun numéro n'est attribué.`,
      );
    }
    const sequenceNumber = head.last_cleared_number + 1;
    if (!Number.isSafeInteger(sequenceNumber)) {
      throw new SequencerError('SEQ_CHAIN_CORRUPT', `série ${input.seriesKey} : numéro hors des entiers sûrs.`);
    }
    // Ordre voulu : l'incrément d'abord, l'enregistrement PIH ensuite ; une panne sur le second annule le premier (transactionSync).
    sql.exec(
      `UPDATE fiscal_sequences
          SET last_cleared_number = ?, last_cleared_pi_hash = ?, submission_attempt_counter = submission_attempt_counter + 1, updated_at = ?
        WHERE series_key = ?`,
      sequenceNumber,
      input.invoiceSha256,
      input.requestedAtIso,
      input.seriesKey,
    );
    sql.exec(
      `INSERT INTO fiscal_sequence_journal (series_key, sequence_number, idempotency_key, previous_hash, invoice_sha256, allocated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.seriesKey,
      sequenceNumber,
      input.idempotencyKey,
      head.last_cleared_pi_hash,
      input.invoiceSha256,
      input.requestedAtIso,
    );
    return {
      seriesKey: input.seriesKey,
      sequenceNumber,
      previousInvoiceHash: head.last_cleared_pi_hash,
      invoiceSha256: input.invoiceSha256,
      allocatedAtIso: input.requestedAtIso,
      idempotentReplay: false,
    };
  }
}
