import { TENANT_MIGRATIONS } from '@fisca/db-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCAL_MIGRATIONS, LocalMigrationError, runLocalMigrations } from '../src/storage/migrations.ts';
import { createMemoryStorage } from '../src/storage/memory-storage.ts';
import type { PosStorage } from '../src/storage/ports.ts';

let storage: PosStorage | undefined;
afterEach(async () => {
  await storage?.close();
  storage = undefined;
});

const NOW = '2026-11-14T08:00:00.000Z';
const POS_TABLES = ['pos_sessions', 'pos_tickets', 'pos_z_closures'] as const;
const SHA = 'a'.repeat(64);

interface ColumnInfo {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
  readonly pk: number;
}

async function columnsOf(db: PosStorage, table: string): Promise<ColumnInfo[]> {
  const rows = await db.all(`SELECT name, type, "notnull" AS not_null, dflt_value, pk FROM pragma_table_info('${table}') ORDER BY cid`);
  return rows.map((row) => ({
    name: String(row['name']),
    type: String(row['type']),
    notnull: Number(row['not_null']),
    dflt_value: row['dflt_value'] === null ? null : String(row['dflt_value']),
    pk: Number(row['pk']),
  }));
}

async function seedSession(db: PosStorage): Promise<void> {
  await db.run(
    `INSERT INTO pos_sessions (id, terminal_id, cashier_user_id, opened_at, opening_float_cents, status)
     VALUES ('s1', 't1', 'u1', ?, 10000, 'SESSION_OUVERTE_ACTIVE')`,
    [NOW],
  );
}

const TICKET_SQL = `INSERT INTO pos_tickets (id, session_id, terminal_id, terminal_seq_number, issued_at, ticket_kind, total_ttc_cents,
  paid_cash_cents, qr_conversion_token, prev_ticket_sha256, ticket_sha256, ecdsa_signature_b64)
  VALUES (?, 's1', 't1', ?, ?, 'SALE_B2C', ?, ?, ?, ?, ?, 'sig')`;

describe('migrations locales versionnées', () => {
  it('applique les migrations dans l’ordre et est idempotente', async () => {
    storage = await createMemoryStorage();
    const first = await runLocalMigrations(storage, NOW);
    expect(first.applied).toEqual(LOCAL_MIGRATIONS.map((migration) => migration.version));
    const second = await runLocalMigrations(storage, NOW);
    expect(second.applied).toEqual([]);
    expect(LOCAL_MIGRATIONS.map((m) => m.version)).toEqual([1, 2]);
  });

  it('les trois tables caisse ont exactement les colonnes, types, NOT NULL, défauts et clés du DDL serveur', async () => {
    const serverStorage = await createMemoryStorage();
    storage = await createMemoryStorage();
    try {
      for (const migration of TENANT_MIGRATIONS) {
        for (const statement of migration.upSqlStatements) {
          await serverStorage.run(statement);
        }
      }
      await runLocalMigrations(storage, NOW);
      for (const table of POS_TABLES) {
        const local = await columnsOf(storage, table);
        expect(local.length, table).toBeGreaterThan(8);
        expect(local, table).toEqual(await columnsOf(serverStorage, table));
      }
    } finally {
      await serverStorage.close();
    }
  });

  it('montants en centimes entiers : un montant décimal est refusé par le CHECK', async () => {
    storage = await createMemoryStorage();
    await runLocalMigrations(storage, NOW);
    await seedSession(storage);
    await storage.run(TICKET_SQL, ['k1', 'POS-M01-C02-2026-000001', NOW, 1200, 1200, 'qr1', '0'.repeat(64), SHA]);
    await expect(storage.run(TICKET_SQL, ['k2', 'POS-M01-C02-2026-000002', NOW, 12.5, 12.5, 'qr2', SHA, SHA])).rejects.toThrow(/CHECK/);
    const sessionColumns = await columnsOf(storage, 'pos_sessions');
    expect(sessionColumns.filter((c) => c.name.endsWith('_cents')).every((c) => c.type === 'INTEGER')).toBe(true);
  });

  it('numéro de séquence unique par terminal, empreinte SHA-256 de 64 minuscules, avoir lié obligatoire', async () => {
    storage = await createMemoryStorage();
    await runLocalMigrations(storage, NOW);
    await seedSession(storage);
    await storage.run(TICKET_SQL, ['k1', 'POS-M01-C02-2026-000001', NOW, 100, 100, 'qr1', '0'.repeat(64), SHA]);
    await expect(storage.run(TICKET_SQL, ['k2', 'POS-M01-C02-2026-000001', NOW, 100, 100, 'qr2', SHA, SHA])).rejects.toThrow(/UNIQUE/);
    await expect(storage.run(TICKET_SQL, ['k3', 'POS-M01-C02-2026-000003', NOW, 100, 100, 'qr3', SHA, 'A'.repeat(64)])).rejects.toThrow(/CHECK/);
    await expect(
      storage.run(
        `INSERT INTO pos_tickets (id, session_id, terminal_id, terminal_seq_number, issued_at, ticket_kind, total_ttc_cents, qr_conversion_token,
           prev_ticket_sha256, ticket_sha256, ecdsa_signature_b64) VALUES ('r1','s1','t1','POS-M01-C02-2026-000004',?,'RETURN_REFUND',100,'qr4',?,?,'sig')`,
        [NOW, SHA, SHA],
      ),
    ).rejects.toThrow(/CHECK/);
  });

  it('un ticket ne se supprime ni ne se modifie ; une clôture Z non plus', async () => {
    storage = await createMemoryStorage();
    await runLocalMigrations(storage, NOW);
    await seedSession(storage);
    await storage.run(TICKET_SQL, ['k1', 'POS-M01-C02-2026-000001', NOW, 100, 100, 'qr1', '0'.repeat(64), SHA]);
    await expect(storage.run("DELETE FROM pos_tickets WHERE id = 'k1'")).rejects.toThrow(/Suppression de ticket POS interdite/);
    await expect(storage.run("UPDATE pos_tickets SET total_ttc_cents = 1 WHERE id = 'k1'")).rejects.toThrow(/Modification de ticket POS interdite/);
    await storage.run(
      `INSERT INTO pos_z_closures (id, session_id, terminal_id, closure_number, business_date, net_b2c_ht_20_cents, net_b2c_vat_20_cents,
         net_b2c_ht_10_cents, net_b2c_vat_10_cents, net_b2c_ht_0_cents, total_stamp_duty_cents, tpe_gross_cents, prev_z_sha256, z_sha256)
       VALUES ('z1','s1','t1',1,'2026-11-14',0,0,0,0,0,0,0,?,?)`,
      ['0'.repeat(64), SHA],
    );
    await expect(storage.run("DELETE FROM pos_z_closures WHERE id = 'z1'")).rejects.toThrow(/Suppression de clôture Z interdite/);
    await expect(storage.run("UPDATE pos_z_closures SET tpe_gross_cents = 1 WHERE id = 'z1'")).rejects.toThrow(/Modification de clôture Z interdite/);
  });

  it('chaque ticket inséré entre dans la file de synchronisation', async () => {
    storage = await createMemoryStorage();
    await runLocalMigrations(storage, NOW);
    await seedSession(storage);
    await storage.run(TICKET_SQL, ['k1', 'POS-M01-C02-2026-000001', NOW, 100, 100, 'qr1', '0'.repeat(64), SHA]);
    expect(await storage.all('SELECT ticket_id, queued_at, synced_at FROM pos_ticket_sync_status')).toEqual([
      { ticket_id: 'k1', queued_at: NOW, synced_at: null },
    ]);
  });

  it('refuse une migration appliquée dont l’empreinte a changé', async () => {
    storage = await createMemoryStorage();
    await runLocalMigrations(storage, NOW);
    await storage.run("UPDATE local_schema_migrations SET checksum_sha256 = ? WHERE version = 1", [SHA]);
    await expect(runLocalMigrations(storage, NOW)).rejects.toThrow(LocalMigrationError);
    await expect(runLocalMigrations(storage, NOW)).rejects.toThrow(/altérée/);
  });

  it('refuse une base plus récente que l’application', async () => {
    storage = await createMemoryStorage();
    await runLocalMigrations(storage, NOW);
    await storage.run("INSERT INTO local_schema_migrations (version, name, checksum_sha256, applied_at) VALUES (999, 'futur', ?, ?)", [SHA, NOW]);
    await expect(runLocalMigrations(storage, NOW)).rejects.toThrow(/plus récente/);
  });

  it('les empreintes déclarées correspondent au SQL (SHA-256 de upSqlStatements.join("\\n"))', async () => {
    for (const migration of LOCAL_MIGRATIONS) {
      const bytes = new TextEncoder().encode(migration.upSqlStatements.join('\n'));
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
      expect(migration.expectedSha256Hex, migration.name).toBe(hex);
    }
  });
});
