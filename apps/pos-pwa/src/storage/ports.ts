/**
 * Port d'accès au stockage local de la caisse (équivalent, côté terminal, du `FiscaInfrastructureAdapter` serveur).
 * Interface asynchrone : l'implémentation OPFS vit dans un Worker et se pilote par messages.
 * Valeurs SQL limitées aux types structurellement clonables ; montants = entiers (centimes) en `number` sûr ou `bigint`.
 */

export type SqlValue = string | number | bigint | null;
export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface SqlStatement {
  readonly sql: string;
  readonly params?: readonly SqlValue[];
}

export interface PosStorage {
  /** Exécute une instruction sans résultat. */
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  /** Exécute une requête et renvoie toutes les lignes. */
  all(sql: string, params?: readonly SqlValue[]): Promise<readonly SqlRow[]>;
  /** Exécute les instructions dans UNE transaction : tout ou rien. */
  batch(statements: readonly SqlStatement[]): Promise<void>;
  close(): Promise<void>;
}
