import { InfrastructureError, type SqlStatementParams } from '@fisca/shared-types';

/** Message lisible d'une erreur de moteur, avec le SQLSTATE PostgreSQL quand il existe. */
export function describeEngineError(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? ` [${error.code}]` : '';
    return `${error.message}${code}`;
  }
  return String(error);
}

/**
 * ADR-03 : aucun paramètre flottant ni hors plage sûre n'atteint un moteur (comme le pilote mémoire de shared-types).
 * Les types string, number et null sont garantis par `SqlParam` ; ce contrôle protège les appels non typés.
 */
export function assertSqlParams(statement: SqlStatementParams): void {
  for (const value of statement.params) {
    if (value === null || typeof value === 'string') {
      continue;
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new InfrastructureError(
        'INFRA_SQL_REJECTED',
        `paramètre non entier, hors plage sûre ou de type non supporté (ADR-03) : ${String(value)}`,
      );
    }
  }
}

export function isInfrastructureError(error: unknown): error is InfrastructureError {
  return error instanceof InfrastructureError;
}
