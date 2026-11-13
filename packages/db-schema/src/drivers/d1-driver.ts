/**
 * Pilote D1 de `TenantSqlDriver` (Doc_04 § 10, loi 11 : le code métier ne touche jamais D1 directement).
 *
 * Il s'écrit contre une interface STRUCTURELLE minimale de `D1Database`, que le binding réel de Cloudflare satisfait :
 * `prepare(sql).bind(...valeurs).all()` / `.run()` renvoient un `D1Result` (`results`, `meta.changes`) et
 * `batch(instructions)` exécute la séquence comme UNE transaction, tout ou rien (documentation D1, « D1Database »
 * et « Prepared statement methods », consultées le 2026-11-13). Aucun import de `@cloudflare/workers-types`.
 */
import {
  InfrastructureError,
  type BatchResult,
  type SqlParam,
  type SqlStatementParams,
  type TenantSqlDriver,
} from '@fisca/shared-types';
import { assertSqlParams, describeEngineError, isInfrastructureError } from './sql-driver-support.ts';

export interface D1ResultLike<T = unknown> {
  readonly success?: boolean;
  readonly results?: readonly T[] | null;
  readonly meta?: { readonly changes?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<readonly D1ResultLike<unknown>[]>;
}

function prepared(db: D1DatabaseLike, statement: SqlStatementParams): D1PreparedStatementLike {
  const base = db.prepare(statement.sql);
  return statement.params.length === 0 ? base : base.bind(...(statement.params as readonly SqlParam[]));
}

/** `tenantId` : identifiant de société, ou `control-plane` pour le plan de contrôle. */
export function createD1TenantDriver(tenantId: string, db: D1DatabaseLike): TenantSqlDriver {
  return {
    tenantId,
    async query<TRow>(statement: SqlStatementParams): Promise<readonly TRow[]> {
      assertSqlParams(statement);
      try {
        const result = await prepared(db, statement).all<TRow>();
        return result.results ?? [];
      } catch (error) {
        if (isInfrastructureError(error)) {
          throw error;
        }
        throw new InfrastructureError('INFRA_SQL_REJECTED', describeEngineError(error));
      }
    },

    async executeBatchAtomically(statements: readonly SqlStatementParams[]): Promise<BatchResult> {
      for (const statement of statements) {
        assertSqlParams(statement);
      }
      if (statements.length === 0) {
        return { totalChanges: 0 };
      }
      try {
        const results = await db.batch(statements.map((statement) => prepared(db, statement)));
        return { totalChanges: results.reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0) };
      } catch (error) {
        if (isInfrastructureError(error)) {
          throw error;
        }
        throw new InfrastructureError('INFRA_BATCH_ROLLED_BACK', describeEngineError(error));
      }
    },
  };
}
