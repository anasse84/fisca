/**
 * ADAPTATEUR MÉMOIRE POUR LES TESTS UNIQUEMENT (jamais en production).
 *
 * `InMemoryInfrastructureAdapter` exige un acquittement explicite `NOT_FOR_PRODUCTION` à la construction.
 * Son moteur SQL ne comprend que le sous-ensemble portable SQLite/PostgreSQL 16 (ERRATA D-11, ADR-12) :
 * CREATE TABLE, INSERT, SELECT, UPDATE, DELETE avec conditions `col = ?` reliées par AND.
 */
import {
  CONTROL_PLANE_TENANT_ID,
  InfrastructureError,
  assertValidCompanyId,
  assertValidObjectKey,
  assertValidReplicationDelta,
  isKnownQueueName,
  sha256Hex,
  type AsyncQueueDriver,
  type BatchResult,
  type FiscaInfrastructureAdapter,
  type InfrastructureProviderMode,
  type SignedReplicationDelta,
  type SovereignMirrorDriver,
  type SqlParam,
  type SqlStatementParams,
  type TenantSqlDriver,
  type WormObject,
  type WormPutOptions,
  type WormVaultDriver,
} from './infra-adapter.ts';

export interface InMemoryInfrastructureAdapterOptions {
  readonly acknowledgeTestOnly: 'NOT_FOR_PRODUCTION';
  readonly providerMode: InfrastructureProviderMode;
  /** Horloge injectée (instant ISO 8601 UTC). */
  readonly nowIso: () => string;
}

type Row = Record<string, SqlParam>;

interface Table {
  readonly columns: readonly string[];
  readonly notNull: readonly string[];
  readonly primaryKey: string | null;
  rows: Row[];
}

type TableMap = Map<string, Table>;

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

function rejected(detail: string): InfrastructureError {
  return new InfrastructureError('INFRA_SQL_REJECTED', detail);
}

function unsupported(sql: string): InfrastructureError {
  return new InfrastructureError('INFRA_SQL_UNSUPPORTED', `hors du sous-ensemble portable SQLite/PostgreSQL : ${sql}`);
}

function cloneTables(tables: TableMap): TableMap {
  const copy: TableMap = new Map();
  for (const [name, table] of tables) {
    copy.set(name, { ...table, rows: table.rows.map((r) => ({ ...r })) });
  }
  return copy;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim());
}

interface Condition {
  readonly column: string;
}

function parseWhere(clause: string | undefined, sql: string): Condition[] {
  if (clause === undefined) return [];
  const conditions: Condition[] = [];
  for (const part of clause.split(/\s+AND\s+/i)) {
    const m = new RegExp(`^(${IDENT})\\s*=\\s*\\?$`).exec(part.trim());
    if (!m || m[1] === undefined) throw unsupported(sql);
    conditions.push({ column: m[1] });
  }
  return conditions;
}

function checkValue(value: SqlParam | undefined): SqlParam {
  if (value === undefined) throw rejected('paramètre manquant');
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw rejected(`paramètre numérique non entier ou hors plage sûre (ADR-03) : ${value}`);
  }
  return value;
}

function getTable(tables: TableMap, name: string): Table {
  const table = tables.get(name);
  if (!table) throw rejected(`table inconnue : ${name}`);
  return table;
}

function assertColumns(table: Table, columns: readonly string[], tableName: string): void {
  for (const c of columns) {
    if (!table.columns.includes(c)) throw rejected(`colonne inconnue : ${tableName}.${c}`);
  }
}

function matches(row: Row, conditions: readonly Condition[], values: readonly SqlParam[]): boolean {
  return conditions.every((c, i) => row[c.column] === values[i]);
}

function enforceRowConstraints(table: Table, tableName: string, row: Row, others: readonly Row[]): void {
  for (const c of table.notNull) {
    if (row[c] === null || row[c] === undefined) throw rejected(`NOT NULL violé : ${tableName}.${c}`);
  }
  const pk = table.primaryKey;
  if (pk !== null) {
    if (row[pk] === null || row[pk] === undefined) throw rejected(`PRIMARY KEY nulle : ${tableName}.${pk}`);
    if (others.some((o) => o[pk] === row[pk])) throw rejected(`PRIMARY KEY dupliquée : ${tableName}.${pk}`);
  }
}

interface ExecResult {
  readonly changes: number;
  readonly rows: readonly Row[];
}

function execute(tables: TableMap, stmt: SqlStatementParams): ExecResult {
  const sql = stmt.sql.trim().replace(/;$/, '').replace(/\s+/g, ' ');
  const placeholders = (sql.match(/\?/g) ?? []).length;
  if (placeholders !== stmt.params.length) {
    throw rejected(`${placeholders} paramètre(s) attendu(s), ${stmt.params.length} fourni(s) : ${sql}`);
  }
  const params = stmt.params.map((p) => checkValue(p));

  const create = new RegExp(`^CREATE TABLE (IF NOT EXISTS )?(${IDENT}) \\((.*)\\)$`, 'i').exec(sql);
  if (create && create[2] !== undefined && create[3] !== undefined) {
    const name = create[2];
    if (tables.has(name)) {
      if (create[1] !== undefined) return { changes: 0, rows: [] };
      throw rejected(`table déjà existante : ${name}`);
    }
    const columns: string[] = [];
    const notNull: string[] = [];
    let primaryKey: string | null = null;
    for (const part of splitTopLevel(create[3])) {
      const first = part.split(' ')[0];
      if (first === undefined || !new RegExp(`^${IDENT}$`).test(first)) throw unsupported(sql);
      if (['PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'CONSTRAINT'].includes(first.toUpperCase())) throw unsupported(sql);
      columns.push(first);
      if (/\bNOT NULL\b/i.test(part)) notNull.push(first);
      if (/\bPRIMARY KEY\b/i.test(part)) primaryKey = first;
    }
    tables.set(name, { columns, notNull, primaryKey, rows: [] });
    return { changes: 0, rows: [] };
  }

  const insert = new RegExp(`^INSERT INTO (${IDENT}) \\(([^)]*)\\) VALUES \\(([^)]*)\\)$`, 'i').exec(sql);
  if (insert && insert[1] !== undefined && insert[2] !== undefined && insert[3] !== undefined) {
    const table = getTable(tables, insert[1]);
    const columns = insert[2].split(',').map((c) => c.trim());
    const marks = insert[3].split(',').map((c) => c.trim());
    if (marks.length !== columns.length || marks.some((m) => m !== '?')) throw unsupported(sql);
    assertColumns(table, columns, insert[1]);
    const row: Row = {};
    for (const c of table.columns) row[c] = null;
    columns.forEach((c, i) => {
      row[c] = params[i] ?? null;
    });
    enforceRowConstraints(table, insert[1], row, table.rows);
    table.rows.push(row);
    return { changes: 1, rows: [] };
  }

  const update = new RegExp(`^UPDATE (${IDENT}) SET (.+?)(?: WHERE (.+))?$`, 'i').exec(sql);
  if (update && update[1] !== undefined && update[2] !== undefined) {
    const table = getTable(tables, update[1]);
    const assignments = splitTopLevel(update[2]).map((a) => {
      const m = new RegExp(`^(${IDENT}) = \\?$`).exec(a);
      if (!m || m[1] === undefined) throw unsupported(sql);
      return m[1];
    });
    const conditions = parseWhere(update[3], sql);
    assertColumns(table, [...assignments, ...conditions.map((c) => c.column)], update[1]);
    const setValues = params.slice(0, assignments.length);
    const whereValues = params.slice(assignments.length);
    let changes = 0;
    const next = table.rows.map((row) => {
      if (!matches(row, conditions, whereValues)) return row;
      const updated: Row = { ...row };
      assignments.forEach((c, i) => {
        updated[c] = setValues[i] ?? null;
      });
      changes += 1;
      return updated;
    });
    for (const [i, row] of next.entries()) {
      enforceRowConstraints(table, update[1], row, next.filter((_, j) => j !== i));
    }
    table.rows = next;
    return { changes, rows: [] };
  }

  const del = new RegExp(`^DELETE FROM (${IDENT})(?: WHERE (.+))?$`, 'i').exec(sql);
  if (del && del[1] !== undefined) {
    const table = getTable(tables, del[1]);
    const conditions = parseWhere(del[2], sql);
    assertColumns(table, conditions.map((c) => c.column), del[1]);
    const before = table.rows.length;
    table.rows = table.rows.filter((row) => !matches(row, conditions, params));
    return { changes: before - table.rows.length, rows: [] };
  }

  const select = new RegExp(`^SELECT (\\*|${IDENT}(?:, ?${IDENT})*) FROM (${IDENT})(?: WHERE (.+))?$`, 'i').exec(sql);
  if (select && select[1] !== undefined && select[2] !== undefined) {
    const table = getTable(tables, select[2]);
    const columns = select[1] === '*' ? table.columns : select[1].split(',').map((c) => c.trim());
    const conditions = parseWhere(select[3], sql);
    assertColumns(table, [...columns, ...conditions.map((c) => c.column)], select[2]);
    const rows = table.rows
      .filter((row) => matches(row, conditions, params))
      .map((row) => {
        const out: Row = {};
        for (const c of columns) out[c] = row[c] ?? null;
        return out;
      });
    return { changes: 0, rows };
  }

  throw unsupported(sql);
}

class MemorySqlDriver implements TenantSqlDriver {
  readonly tenantId: string;
  private tables: TableMap = new Map();

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  async query<TRow>(stmt: SqlStatementParams): Promise<readonly TRow[]> {
    if (!/^\s*SELECT\b/i.test(stmt.sql)) {
      if (/^\s*(INSERT|UPDATE|DELETE|CREATE)\b/i.test(stmt.sql)) {
        throw rejected('query() n\'accepte que SELECT ; utiliser executeBatchAtomically');
      }
      throw unsupported(stmt.sql);
    }
    const scratch = cloneTables(this.tables);
    return execute(scratch, stmt).rows as unknown as readonly TRow[];
  }

  async executeBatchAtomically(statements: readonly SqlStatementParams[]): Promise<BatchResult> {
    const scratch = cloneTables(this.tables);
    let totalChanges = 0;
    try {
      for (const stmt of statements) {
        totalChanges += execute(scratch, stmt).changes;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new InfrastructureError('INFRA_BATCH_ROLLED_BACK', `lot annulé, aucune instruction appliquée : ${detail}`);
    }
    this.tables = scratch;
    return { totalChanges };
  }
}

interface StoredObject {
  readonly bytes: Uint8Array;
  readonly metadata: Readonly<Record<string, string>>;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

class MemoryVault implements WormVaultDriver {
  readonly jurisdiction: 'eu' | 'ma';
  private readonly objects = new Map<string, StoredObject>();
  private readonly nowIso: () => string;

  constructor(jurisdiction: 'eu' | 'ma', nowIso: () => string) {
    this.jurisdiction = jurisdiction;
    this.nowIso = nowIso;
  }

  async putImmutableObject(
    key: string,
    ciphertext: Uint8Array,
    options: WormPutOptions,
  ): Promise<{ readonly etag: string }> {
    assertValidObjectKey(key);
    if (!ISO_INSTANT.test(options.retentionUntilIso) || Number.isNaN(Date.parse(options.retentionUntilIso))) {
      throw new InfrastructureError('INFRA_VAULT_INVALID_RETENTION', `retentionUntilIso invalide : ${options.retentionUntilIso}`);
    }
    if (Date.parse(options.retentionUntilIso) <= Date.parse(this.nowIso())) {
      throw new InfrastructureError('INFRA_VAULT_INVALID_RETENTION', `[${key}] la rétention doit être postérieure à l'instant courant.`);
    }
    if (this.objects.has(key)) {
      throw new InfrastructureError('INFRA_VAULT_IMMUTABLE', `[${key}] objet WORM déjà écrit : écrasement interdit.`);
    }
    const actual = await sha256Hex(ciphertext);
    if (actual !== options.sha256Hex) {
      throw new InfrastructureError('INFRA_VAULT_HASH_MISMATCH', `[${key}] SHA-256 déclaré différent du contenu.`);
    }
    this.objects.set(key, {
      bytes: new Uint8Array(ciphertext),
      metadata: {
        ...options.customMetadata,
      },
    });
    return { etag: actual };
  }

  async getObjectBytes(key: string): Promise<WormObject | null> {
    assertValidObjectKey(key);
    const stored = this.objects.get(key);
    if (!stored) return null;
    return { bytes: new Uint8Array(stored.bytes), metadata: { ...stored.metadata } };
  }
}

class MemoryQueue implements AsyncQueueDriver {
  private readonly messages = new Map<string, Map<string, { readonly payload: unknown; readonly delaySeconds: number }>>();

  async enqueueIdempotent<TPayload>(
    queueName: string,
    idempotencyKey: string,
    payload: TPayload,
    delaySeconds?: number,
  ): Promise<void> {
    if (!isKnownQueueName(queueName)) {
      throw new InfrastructureError('INFRA_UNKNOWN_QUEUE', `file inconnue (ERRATA D-08) : ${queueName}`);
    }
    if (idempotencyKey.trim().length === 0) {
      throw new InfrastructureError('INFRA_INVALID_QUEUE_ARGUMENT', `[${queueName}] clé d'idempotence vide.`);
    }
    const delay = delaySeconds ?? 0;
    if (!Number.isSafeInteger(delay) || delay < 0) {
      throw new InfrastructureError('INFRA_INVALID_QUEUE_ARGUMENT', `[${queueName}] delaySeconds doit être un entier >= 0.`);
    }
    const queue = this.messages.get(queueName) ?? new Map();
    this.messages.set(queueName, queue);
    if (queue.has(idempotencyKey)) return;
    queue.set(idempotencyKey, { payload: JSON.parse(JSON.stringify(payload)) as unknown, delaySeconds: delay });
  }

  depth(queueName: string): number {
    return this.messages.get(queueName)?.size ?? 0;
  }
}

function copyDelta(d: SignedReplicationDelta): SignedReplicationDelta {
  return { ...d, r2AipKeysAdded: [...d.r2AipKeysAdded], latestJournalHashes: { ...d.latestJournalHashes } };
}

class MemoryMirror implements SovereignMirrorDriver {
  private readonly byCompany = new Map<string, SignedReplicationDelta[]>();

  async pushDelta(delta: SignedReplicationDelta): Promise<{ readonly acceptedSequence: number }> {
    assertValidReplicationDelta(delta);
    const list = this.byCompany.get(delta.companyId) ?? [];
    const last = list[list.length - 1];
    if (last !== undefined && delta.sequenceMonotonic <= last.sequenceMonotonic) {
      throw new InfrastructureError(
        'INFRA_MIRROR_SEQUENCE_REJECTED',
        `[${delta.deltaId}] séquence ${delta.sequenceMonotonic} <= dernière séquence ${last.sequenceMonotonic}.`,
      );
    }
    list.push(copyDelta(delta));
    this.byCompany.set(delta.companyId, list);
    return { acceptedSequence: delta.sequenceMonotonic };
  }

  async readDeltasAfter(companyId: string, afterSequence: number): Promise<readonly SignedReplicationDelta[]> {
    assertValidCompanyId(companyId);
    return (this.byCompany.get(companyId) ?? [])
      .filter((d) => d.sequenceMonotonic > afterSequence)
      .map((d) => copyDelta(d));
  }
}


export class InMemoryInfrastructureAdapter implements FiscaInfrastructureAdapter {
  readonly providerMode: InfrastructureProviderMode;
  private readonly controlPlane = new MemorySqlDriver(CONTROL_PLANE_TENANT_ID);
  private readonly tenants = new Map<string, MemorySqlDriver>();
  private readonly vault: MemoryVault;
  private readonly queue = new MemoryQueue();
  private readonly mirror = new MemoryMirror();

  constructor(options: InMemoryInfrastructureAdapterOptions) {
    if (options.acknowledgeTestOnly !== 'NOT_FOR_PRODUCTION') {
      throw new InfrastructureError(
        'INFRA_ADAPTER_NOT_FOR_PRODUCTION',
        'InMemoryInfrastructureAdapter est réservé aux tests ; acquittement NOT_FOR_PRODUCTION requis.',
      );
    }
    this.providerMode = options.providerMode;
    this.vault = new MemoryVault(options.providerMode === 'CLOUDFLARE_EDGE' ? 'eu' : 'ma', options.nowIso);
  }

  /** Crée la base d'une société (équivalent du provisionnement D1 hors de ce contrat). */
  provisionTenant(companyId: string): void {
    assertValidCompanyId(companyId);
    if (!this.tenants.has(companyId)) this.tenants.set(companyId, new MemorySqlDriver(companyId));
  }

  queueDepth(queueName: string): number {
    return this.queue.depth(queueName);
  }

  getControlPlaneDb(): TenantSqlDriver {
    return this.controlPlane;
  }

  async getTenantDb(companyId: string): Promise<TenantSqlDriver> {
    assertValidCompanyId(companyId);
    const driver = this.tenants.get(companyId);
    if (!driver) {
      throw new InfrastructureError('INFRA_TENANT_NOT_FOUND', `aucune base pour la société ${companyId}.`);
    }
    return driver;
  }

  getLegalVault(): WormVaultDriver {
    return this.vault;
  }

  getQueue(): AsyncQueueDriver {
    return this.queue;
  }

  getSovereignMirror(): SovereignMirrorDriver {
    return this.mirror;
  }
}
