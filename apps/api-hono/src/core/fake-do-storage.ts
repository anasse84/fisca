/// <reference types="node" />
/**
 * Faux `ctx.storage` de Durable Object SQLite, fondé sur `node:sqlite`, comme `packages/db-schema/tests/fake-d1.ts` pour D1.
 * Il reproduit la sémantique documentée de l'API réelle :
 * - `sql.exec(query, ...bindings)` : liaisons positionnelles `?`, curseur (`toArray`, `one`, itération), `BEGIN`, `COMMIT`,
 *   `ROLLBACK`, `SAVEPOINT` refusés (il faut `transactionSync`) ;
 * - `transactionSync(closure)` : transaction atomique, ROLLBACK si le rappel lève, rappel asynchrone refusé ;
 * - `blockConcurrencyWhile(callback)` : exécute le rappel et mémorise sa promesse ;
 * - `id.name` : nom de l'objet, absent pour un identifiant sans nom.
 * Hors fidélité (voir le rapport) : isolation de curseur à travers `await`, limites de taille, déclencheurs et PRAGMA propres à la
 * production, entrées/sorties différées (input/output gates).
 */
import { DatabaseSync } from 'node:sqlite';
import type {
  DurableObjectStateLike,
  DurableObjectStorageLike,
  SqlStorageCursorLike,
  SqlStorageLike,
  SqlStorageValueLike,
} from './durable-object-sql.ts';

type NodeSqliteValue = string | number | bigint | null | Uint8Array;

const FORBIDDEN_TRANSACTION_STATEMENT = /^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

class FakeCursor<T extends Record<string, SqlStorageValueLike>> implements SqlStorageCursorLike<T> {
  private position = 0;

  constructor(
    private readonly rows: readonly T[],
    readonly rowsWritten: number,
  ) {}

  get rowsRead(): number {
    return this.position;
  }

  toArray(): T[] {
    const remaining = this.rows.slice(this.position);
    this.position = this.rows.length;
    return [...remaining];
  }

  one(): T {
    const remaining = this.rows.slice(this.position);
    if (remaining.length !== 1) {
      throw new Error(`Expected exactly one result from the query but got ${remaining.length} results.`);
    }
    this.position = this.rows.length;
    const [row] = remaining;
    if (row === undefined) {
      throw new Error('Expected exactly one result from the query but got 0 results.');
    }
    return row;
  }
}

function toBinding(value: unknown): NodeSqliteValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  throw new Error(`Type de liaison non supporté par le faux ctx.storage.sql : ${typeof value}`);
}

export interface FakeDoSqlOptions {
  /** Appelé avant chaque instruction : lever pour simuler une panne de stockage sur ce SQL. */
  readonly beforeExec?: (query: string, bindings: readonly unknown[]) => void;
}

export class FakeSqlStorage implements SqlStorageLike {
  readonly executed: string[] = [];
  beforeExec: ((query: string, bindings: readonly unknown[]) => void) | undefined;

  constructor(
    readonly database: DatabaseSync,
    options: FakeDoSqlOptions = {},
  ) {
    this.beforeExec = options.beforeExec;
  }

  exec<T extends Record<string, SqlStorageValueLike>>(query: string, ...bindings: unknown[]): SqlStorageCursorLike<T> {
    if (FORBIDDEN_TRANSACTION_STATEMENT.test(query)) {
      throw new Error('To execute a transaction, please use the state.storage.transaction() or state.storage.transactionSync() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements.');
    }
    this.beforeExec?.(query, bindings);
    this.executed.push(query);
    if (bindings.length === 0 && query.trim().replace(/;\s*$/, '').includes(';')) {
      this.database.exec(query);
      return new FakeCursor<T>([], 0);
    }
    const statement = this.database.prepare(query);
    const values = bindings.map(toBinding);
    if (statement.columns().length > 0) {
      const rows = statement.all(...values).map((row) => ({ ...row }) as unknown as T);
      return new FakeCursor<T>(rows, 0);
    }
    const outcome = statement.run(...values);
    return new FakeCursor<T>([], Number(outcome.changes));
  }
}

export class FakeDurableObjectStorage implements DurableObjectStorageLike {
  readonly sql: FakeSqlStorage;
  private depth = 0;

  constructor(readonly database: DatabaseSync) {
    this.sql = new FakeSqlStorage(database);
  }

  transactionSync<T>(closure: () => T): T {
    if (this.depth > 0) {
      return closure();
    }
    this.database.exec('BEGIN');
    this.depth += 1;
    try {
      const result = closure();
      if (typeof result === 'object' && result !== null && typeof (result as { readonly then?: unknown }).then === 'function') {
        throw new Error('transactionSync() callback must be synchronous (no Promise).');
      }
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth -= 1;
    }
  }
}

export class FakeDurableObjectState implements DurableObjectStateLike {
  readonly storage: FakeDurableObjectStorage;
  readonly blocked: Promise<unknown>[] = [];

  constructor(
    readonly database: DatabaseSync,
    readonly id: { readonly name?: string },
  ) {
    this.storage = new FakeDurableObjectStorage(database);
  }

  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    const running = callback();
    this.blocked.push(running);
    return running;
  }
}

/** Nouveau stockage de Durable Object : une base SQLite en mémoire que plusieurs instances (redémarrages) peuvent partager. */
export function createFakeDoDatabase(): DatabaseSync {
  return new DatabaseSync(':memory:');
}

export function createFakeDoState(database: DatabaseSync, name: string | undefined): FakeDurableObjectState {
  return new FakeDurableObjectState(database, name === undefined ? {} : { name });
}
