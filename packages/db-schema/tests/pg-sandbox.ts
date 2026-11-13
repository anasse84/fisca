import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { singleConnectionSource, createPostgresTenantDriver } from '../src/drivers/pg-driver.ts';
import type { TenantSqlDriver } from '@fisca/shared-types';

export const PG_URL = process.env['FISCA_TEST_PG_URL'] ?? 'postgres://fisca@127.0.0.1:54329/postgres';

/** PostgreSQL 16 réel, dans un schéma temporaire supprimé en fin de test. */
export class PgSandbox {
  readonly schema = `fisca_m_${randomBytes(6).toString('hex')}`;
  readonly client = new Client({ connectionString: PG_URL });

  async open(): Promise<void> {
    await this.client.connect();
    await this.reset();
  }

  /** Repart d'un schéma vide (search_path pointé dessus). */
  async reset(): Promise<void> {
    await this.client.query(`DROP SCHEMA IF EXISTS ${this.schema} CASCADE`);
    await this.client.query(`CREATE SCHEMA ${this.schema}`);
    await this.client.query(`SET search_path TO ${this.schema}`);
  }

  driver(tenantId: string): TenantSqlDriver {
    return createPostgresTenantDriver(tenantId, singleConnectionSource(this.client));
  }

  async close(): Promise<void> {
    await this.client.query(`DROP SCHEMA IF EXISTS ${this.schema} CASCADE`);
    await this.client.end();
  }
}
