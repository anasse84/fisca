/// <reference types="node" />
/**
 * Harnais de test du grand livre (code de test uniquement, jamais importé par le code de production).
 *
 * Recréé localement, comme le demande le ticket T-S1B-10, à partir des pilotes de `@fisca/db-schema` : un faux D1 fondé sur
 * `node:sqlite` et un schéma PostgreSQL 16 temporaire (supprimé en fin de test). Les deux bases sont migrées par
 * `ensureTenantSchemaUpToDate` avec `TENANT_MIGRATIONS` ; tout accès passe par `TenantSqlDriver` (loi 11).
 */
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import {
  TENANT_MIGRATIONS,
  createD1TenantDriver,
  createPostgresTenantDriver,
  ensureTenantSchemaUpToDate,
  tenantMigrationPostgresStatements,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type D1ResultLike,
} from '@fisca/db-schema';
import type { TenantSqlDriver } from '@fisca/shared-types';
import type { OrgPlanSegment, RoleCode } from '@fisca/auth-rbac';
import type {
  EntryHashInput,
  ClosingHashInput,
  LedgerActor,
  LedgerClock,
  LedgerFieldCipher,
  LedgerHasher,
  LedgerIdSource,
  PreCloseControls,
} from './immutable-cgnc-ledger-engine.ts';

export const COMPANY_ID = 'soc-ledger';
export const PG_URL = process.env['FISCA_TEST_PG_URL'] ?? 'postgres://fisca@127.0.0.1:54329/postgres';

type D1Value = string | number | null;
const READ_KEYWORDS = new Set(['SELECT', 'WITH', 'PRAGMA', 'VALUES']);
const DML_KEYWORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE']);

function keywordOf(sql: string): string {
  return (/^\s*([A-Za-z]+)/.exec(sql)?.[1] ?? '').toUpperCase();
}

function execute(sqlite: DatabaseSync, sql: string, values: readonly D1Value[]): D1ResultLike<Record<string, unknown>> {
  const statement = sqlite.prepare(sql);
  if (READ_KEYWORDS.has(keywordOf(sql))) {
    return { success: true, results: statement.all(...values).map((row) => ({ ...row })), meta: { changes: 0 } };
  }
  const outcome = statement.run(...values);
  return { success: true, results: [], meta: { changes: DML_KEYWORDS.has(keywordOf(sql)) ? Number(outcome.changes) : 0 } };
}

class LiteStatement implements D1PreparedStatementLike {
  constructor(
    readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly values: readonly D1Value[],
  ) {}

  bind(...values: unknown[]): LiteStatement {
    return new LiteStatement(
      this.sqlite,
      this.sql,
      values.map((value) => {
        if (value === null || typeof value === 'string' || typeof value === 'number') return value;
        throw new Error(`D1_TYPE_ERROR: ${typeof value}`);
      }),
    );
  }

  async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    try {
      return execute(this.sqlite, this.sql, this.values) as D1ResultLike<T>;
    } catch (error) {
      throw new Error(`D1_ERROR: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return this.all<T>();
  }
}

/** Faux D1 : `batch` est une transaction tout ou rien (sémantique documentée de D1). */
class LiteD1 implements D1DatabaseLike {
  constructor(private readonly sqlite: DatabaseSync) {
    sqlite.exec('PRAGMA foreign_keys = ON');
  }

  prepare(query: string): LiteStatement {
    return new LiteStatement(this.sqlite, query, []);
  }

  async batch(statements: readonly D1PreparedStatementLike[]): Promise<readonly D1ResultLike<unknown>[]> {
    const results: D1ResultLike<unknown>[] = [];
    this.sqlite.exec('BEGIN');
    try {
      for (const statement of statements) {
        if (!(statement instanceof LiteStatement)) throw new Error('D1_ERROR: instruction étrangère');
        results.push(execute(this.sqlite, statement.sql, statement.values));
      }
      this.sqlite.exec('COMMIT');
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw new Error(`D1_ERROR: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    return results;
  }
}

export interface LedgerBackend {
  readonly name: 'sqlite' | 'postgres';
  readonly driver: TenantSqlDriver;
}

export async function openSqliteBackend(): Promise<LedgerBackend> {
  const driver = createD1TenantDriver(COMPANY_ID, new LiteD1(new DatabaseSync(':memory:')));
  await ensureTenantSchemaUpToDate(null, driver, COMPANY_ID, TENANT_MIGRATIONS);
  return { name: 'sqlite', driver };
}

/** PostgreSQL 16 réel : un schéma temporaire par instance, supprimé par `close`. Un pool permet de vraies connexions concurrentes. */
export class PostgresHarness {
  readonly schema = `fisca_led_${randomBytes(6).toString('hex')}`;
  private admin = new Pool({ connectionString: PG_URL, max: 1 });
  private pool: Pool | null = null;

  async fresh(): Promise<LedgerBackend> {
    await this.pool?.end();
    await this.admin.query(`DROP SCHEMA IF EXISTS ${this.schema} CASCADE`);
    await this.admin.query(`CREATE SCHEMA ${this.schema}`);
    const pool = new Pool({ connectionString: PG_URL, max: 4, options: `-c search_path=${this.schema}` });
    this.pool = pool;
    const driver = createPostgresTenantDriver(COMPANY_ID, pool);
    await ensureTenantSchemaUpToDate(null, driver, COMPANY_ID, TENANT_MIGRATIONS, {
      statementsFor: tenantMigrationPostgresStatements,
    });
    return { name: 'postgres', driver };
  }

  async close(): Promise<void> {
    await this.pool?.end();
    await this.admin.query(`DROP SCHEMA IF EXISTS ${this.schema} CASCADE`);
    await this.admin.end();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Graine du plan comptable, des journaux et des exercices.
// ---------------------------------------------------------------------------------------------------------------------

export interface SeedAccount {
  readonly number: string;
  readonly label: string;
  readonly cgncClass: number;
  readonly normalBalance: 'DEBIT' | 'CREDIT';
  readonly vatRole: string;
}

export const ACCOUNTS: readonly SeedAccount[] = [
  { number: '51610000', label: 'Caisse', cgncClass: 5, normalBalance: 'DEBIT', vatRole: 'NONE' },
  { number: '34210000', label: 'Clients', cgncClass: 3, normalBalance: 'DEBIT', vatRole: 'NONE' },
  { number: '71110000', label: 'Ventes de marchandises', cgncClass: 7, normalBalance: 'CREDIT', vatRole: 'NONE' },
  { number: '44558000', label: 'Etat TVA facturee sur encaissements', cgncClass: 4, normalBalance: 'CREDIT', vatRole: 'VAT_COLLECTED_PENDING' },
  { number: '44551000', label: 'Etat TVA facturee', cgncClass: 4, normalBalance: 'CREDIT', vatRole: 'VAT_COLLECTED_DUE' },
  { number: '34558000', label: 'Etat TVA recuperable sur paiements', cgncClass: 3, normalBalance: 'DEBIT', vatRole: 'VAT_RECOVERABLE_PENDING' },
  { number: '34552000', label: 'Etat TVA recuperable sur charges', cgncClass: 3, normalBalance: 'DEBIT', vatRole: 'VAT_RECOVERABLE_CHARGES' },
  { number: '34551000', label: 'Etat TVA recuperable sur immobilisations', cgncClass: 3, normalBalance: 'DEBIT', vatRole: 'VAT_RECOVERABLE_IMMOB' },
  { number: '61110000', label: 'Achats de marchandises', cgncClass: 6, normalBalance: 'DEBIT', vatRole: 'NONE' },
  { number: '44110000', label: 'Fournisseurs', cgncClass: 4, normalBalance: 'CREDIT', vatRole: 'NONE' },
  { number: '11110000', label: 'Capital social', cgncClass: 1, normalBalance: 'CREDIT', vatRole: 'NONE' },
  { number: '23400000', label: 'Materiel de transport', cgncClass: 2, normalBalance: 'DEBIT', vatRole: 'NONE' },
  { number: '34970000', label: 'Suspens clients', cgncClass: 3, normalBalance: 'DEBIT', vatRole: 'NONE' },
  { number: '44970000', label: 'Suspens fournisseurs', cgncClass: 4, normalBalance: 'CREDIT', vatRole: 'NONE' },
  { number: '11910000', label: 'Resultat net en instance', cgncClass: 1, normalBalance: 'CREDIT', vatRole: 'NONE' },
];

export const JOURNALS = [
  { id: 'jr-an', code: 'AN', name: 'A-nouveaux', type: 'OPENING' },
  { id: 'jr-ach', code: 'ACH', name: 'Achats', type: 'PURCHASE' },
  { id: 'jr-vte', code: 'VTE', name: 'Ventes', type: 'SALE' },
  { id: 'jr-bnq', code: 'BNQ', name: 'Banque', type: 'BANK' },
  { id: 'jr-cai', code: 'CAI', name: 'Caisse', type: 'CASH' },
  { id: 'jr-od', code: 'OD', name: 'Operations diverses', type: 'GENERAL' },
] as const;

export const FY_2026 = { id: 'fy-2026', code: 'EX-2026', start: '2026-01-01', end: '2026-12-31' } as const;
export const FY_2027 = { id: 'fy-2027', code: 'EX-2027', start: '2027-01-01', end: '2027-12-31' } as const;

export async function seedLedger(driver: TenantSqlDriver): Promise<void> {
  await driver.executeBatchAtomically([
    {
      sql: `INSERT INTO fiscal_years (id, code, start_date, end_date) VALUES (?, ?, ?, ?)`,
      params: [FY_2026.id, FY_2026.code, FY_2026.start, FY_2026.end],
    },
    ...JOURNALS.map((j) => ({
      sql: `INSERT INTO journals (id, code, name, journal_type) VALUES (?, ?, ?, ?)`,
      params: [j.id, j.code, j.name, j.type] as const,
    })),
    ...ACCOUNTS.map((a) => ({
      sql: `INSERT INTO cgnc_accounts (id, account_number, label_fr, cgnc_class, normal_balance, vat_regime_role) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [`acc-${a.number}`, a.number, a.label, a.cgncClass, a.normalBalance, a.vatRole] as const,
    })),
  ]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Sources injectées : horloge, UUIDv7, chiffrement, empreintes, contrôles de pré-clôture.
// ---------------------------------------------------------------------------------------------------------------------

export const BASE_EPOCH_MS = Date.parse('2026-11-13T10:00:00.000Z');
export const BASE_EPOCH_SEC = Math.floor(BASE_EPOCH_MS / 1000);

export class StepClock implements LedgerClock {
  private elapsedMs = 0;
  nowIso(): string {
    this.elapsedMs += 1000;
    return new Date(BASE_EPOCH_MS + this.elapsedMs).toISOString();
  }
  advanceSeconds(seconds: number): void {
    this.elapsedMs += seconds * 1000;
  }
  currentEpochSec(): number {
    return BASE_EPOCH_SEC + Math.floor(this.elapsedMs / 1000);
  }
}

/** UUIDv7 déterministe et strictement croissant (horodatage 48 bits, version 7, variante RFC 4122). */
export class SequentialUuidV7 implements LedgerIdSource {
  private counter = 0;
  newId(): string {
    this.counter += 1;
    const ts = (BASE_EPOCH_MS + this.counter).toString(16).padStart(12, '0');
    const tail = this.counter.toString(16).padStart(12, '0');
    return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7000-8000-${tail}`;
  }
}

export const testCipher: LedgerFieldCipher = {
  async encryptField(plaintext, aad) {
    return `v1:test:${Buffer.from(`${aad}#${plaintext}`, 'utf8').toString('base64url')}`;
  },
};

/**
 * GABARIT DE TEST SEULEMENT. Ni Doc_02 ni Doc_06 ne fixent les octets hachés pour entry_hash ni closing_hash : le moteur ne
 * définit pas la formule, il reçoit un `LedgerHasher`. Ce gabarit (SHA-256 d'un JSON ordonné de l'entrée) ne prétend à
 * aucune valeur normative et sert uniquement à exercer le chaînage.
 */
export const testOnlyHasher: LedgerHasher = {
  async computeEntryHash(input: EntryHashInput): Promise<string> {
    return createHash('sha256').update(JSON.stringify(input), 'utf8').digest('hex');
  },
  async computeClosingHash(input: ClosingHashInput): Promise<string> {
    return createHash('sha256').update(JSON.stringify(input), 'utf8').digest('hex');
  },
};

export class StubPreCloseControls implements PreCloseControls {
  passed = true;
  calls: string[] = [];
  async run(fiscalYearId: string): Promise<{ readonly passed: boolean; readonly detail: string }> {
    this.calls.push(fiscalYearId);
    return { passed: this.passed, detail: this.passed ? 'contrôles verts' : 'contrôle FEC rouge' };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Acteurs.
// ---------------------------------------------------------------------------------------------------------------------

export function actorOf(role: RoleCode, id: string, overrides: Partial<LedgerActor> = {}, clock?: StepClock): LedgerActor {
  const base: LedgerActor = {
    actorId: id,
    role,
    assignedCompanyIds: [COMPANY_ID],
    orgPlanSegment: 'FIDUCIAIRE' satisfies OrgPlanSegment,
    activeHumanMembersCount: 5,
    subscriptionReadOnly: false,
    canAccessPayrollPii: false,
    mfaVerifiedAtEpochSec: clock?.currentEpochSec() ?? BASE_EPOCH_SEC,
  };
  return { ...base, ...overrides };
}

