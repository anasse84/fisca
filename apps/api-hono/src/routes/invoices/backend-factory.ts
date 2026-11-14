/** Fabrique de bases de dossier pour les tests (SQLite en mémoire ou PostgreSQL 16 réel, un schéma temporaire par base). Code de test uniquement. */
import { openSqliteBackend, PostgresHarness, type LedgerBackend } from '../../core/ledger-test-harness.ts';

export type BackendKind = 'sqlite' | 'postgres';

export class LedgerBackendFactory {
  private readonly harnesses: PostgresHarness[] = [];

  async open(kind: BackendKind): Promise<LedgerBackend> {
    if (kind === 'sqlite') return openSqliteBackend();
    const harness = new PostgresHarness();
    this.harnesses.push(harness);
    return harness.fresh();
  }

  async closeAll(): Promise<void> {
    while (this.harnesses.length > 0) await this.harnesses.pop()?.close();
  }
}
