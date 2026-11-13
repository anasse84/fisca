/**
 * Preuve de typage : les classes des Durable Objects acceptent la FORME RÉELLE de `DurableObjectState` / `SqlStorage`.
 *
 * Les déclarations ci-dessous transcrivent les signatures publiées de `@cloudflare/workers-types` 5.20261113.1
 * (`SqlStorage`, `SqlStorageCursor`, `SqlStorageValue`, `DurableObjectStorage.transactionSync`, `DurableObjectState`,
 * `DurableObjectId.name`), lues dans l'archive npm hors du dépôt : le paquet n'est PAS ajouté en dépendance. Le test échoue à la
 * compilation (`tsc --noEmit`) si une classe cesse d'accepter cette forme ; il ne prouve rien sur le comportement réel du runtime.
 */
import { describe, expect, it } from 'vitest';
import { AgentHindsightMemoryDO } from './agent-hindsight-memory-do.ts';
import type { DurableObjectStateLike, SqlStorageLike } from './durable-object-sql.ts';
import { InvoiceSequencerDO } from './invoice-sequencer-do.ts';

type RealSqlStorageValue = ArrayBuffer | string | number | null;

declare abstract class RealSqlStorageCursor<T extends Record<string, RealSqlStorageValue>> {
  next(): IteratorResult<T, undefined>;
  toArray(): T[];
  one(): T;
  raw<U extends RealSqlStorageValue[]>(): IterableIterator<U>;
  columnNames: string[];
  get rowsRead(): number;
  get rowsWritten(): number;
  [Symbol.iterator](): IterableIterator<T>;
}

interface RealSqlStorage {
  exec<T extends Record<string, RealSqlStorageValue>>(query: string, ...bindings: unknown[]): RealSqlStorageCursor<T>;
  get databaseSize(): number;
}

interface RealDurableObjectId {
  toString(): string;
  equals(other: RealDurableObjectId): boolean;
  readonly name?: string;
  readonly jurisdiction?: string;
}

interface RealDurableObjectStorage {
  sql: RealSqlStorage;
  transactionSync<T>(closure: () => T): T;
  sync(): Promise<void>;
  deleteAll(): Promise<void>;
}

interface RealDurableObjectState {
  waitUntil(promise: Promise<unknown>): void;
  readonly id: RealDurableObjectId;
  readonly storage: RealDurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  abort(reason?: string): void;
}

type Assert<T extends true> = T;
type Incomplete = { readonly id: { readonly name?: string }; readonly storage: { readonly sql: RealSqlStorage } };

export type RealStateIsAccepted = Assert<RealDurableObjectState extends DurableObjectStateLike ? true : false>;
export type RealSqlIsAccepted = Assert<RealSqlStorage extends SqlStorageLike ? true : false>;
export type IncompleteStateIsRefused = Assert<Incomplete extends DurableObjectStateLike ? false : true>;

export function constructSequencerFromRealShape(state: RealDurableObjectState, env: unknown): InvoiceSequencerDO {
  return new InvoiceSequencerDO(state, env);
}

export function constructMemoryFromRealShape(state: RealDurableObjectState, env: unknown): AgentHindsightMemoryDO {
  return new AgentHindsightMemoryDO(state, env);
}

describe('forme réelle de ctx accepte par les classes (preuve à la compilation)', () => {
  it('exporte les deux constructeurs typés contre la forme réelle', () => {
    expect(typeof constructSequencerFromRealShape).toBe('function');
    expect(typeof constructMemoryFromRealShape).toBe('function');
  });
});
