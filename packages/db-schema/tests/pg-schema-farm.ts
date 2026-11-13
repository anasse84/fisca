import type { TenantSqlDriver } from '@fisca/shared-types';
import { createPostgresTenantDriver, type PgConnectionSource, type PgPoolClientLike, type PgQueryResultLike } from '../src/index.ts';
import type { PgSandbox } from './pg-sandbox.ts';

/**
 * Un schéma PostgreSQL par identifiant de base (société ou plan de contrôle) sur UNE connexion : chaque acquisition remet le
 * search_path du schéma voulu, ce qui reproduit l'isolation « une base par société » sans créer de bases.
 */
export class PgSchemaFarm {
  private readonly created = new Set<string>();
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly sandbox: PgSandbox) {}

  async reset(): Promise<void> {
    for (const schema of this.created) {
      await this.sandbox.client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    this.created.clear();
  }

  driver(tenantId: string): TenantSqlDriver {
    const schema = `${this.sandbox.schema}_${tenantId.replace(/-/g, '_')}`;
    const client = this.sandbox.client;
    const source: PgConnectionSource = {
      connect: async (): Promise<PgPoolClientLike> => {
        const previous = this.chain;
        let done: () => void = () => undefined;
        this.chain = new Promise<void>((resolve) => {
          done = resolve;
        });
        await previous;
        if (!this.created.has(schema)) {
          await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
          this.created.add(schema);
        }
        await client.query(`SET search_path TO ${schema}`);
        return {
          query: (text: string, values?: unknown[]): Promise<PgQueryResultLike> => client.query(text, values),
          release: (): void => done(),
        };
      },
    };
    return createPostgresTenantDriver(tenantId, source);
  }
}
