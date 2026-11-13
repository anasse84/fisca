import type { PosStorage } from './ports.ts';

/**
 * Migrations locales de la base SQLite de la caisse (OPFS). Même discipline que `@fisca/db-schema` :
 * versionnées, immuables une fois appliquées (empreinte SHA-256 de `upSqlStatements.join("\n")` vérifiée à chaque ouverture).
 *
 * Migration 1 : les trois tables de caisse alignées sur le DDL serveur (`packages/db-schema/src/tenant.ts`, migration 2) :
 *   montants en centimes entiers (INTEGER + CHECK d'entier), séquence par terminal UNIQUE, empreintes SHA-256 de 64 minuscules.
 *   Seul écart : `pos_tickets.converted_invoice_id` perd sa clé étrangère vers `invoices` (table absente du terminal).
 * Migration 2 : tables et déclencheurs propres au terminal (identité, séquenceur, état de synchronisation, périphériques).
 *   L'inviolabilité serveur (triggers v4 : pas de DELETE) est reprise localement et durcie : pas d'UPDATE non plus,
 *   puisque l'état de synchronisation vit dans une table à part.
 */

const POS_SESSION_STATUSES = ['SESSION_OUVERTE_ACTIVE', 'COMPTAGE_AVEUGLE_PRE_Z', 'CLOTURE_TICKET_Z_SCELLEE'] as const;
const POS_TICKET_KINDS = ['SALE_B2C', 'RETURN_REFUND'] as const;
const POS_B2B_CONVERSION_STATES = ['NONE', 'CONVERTI_B2B_AVANT_Z', 'CONVERTI_B2B_POST_Z_NEUTRALISE'] as const;

const quoteList = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(', ');
const integerCheck = (column: string): string => `CHECK (${column} = CAST(${column} AS INTEGER))`;

const CREATE_POS_SESSIONS = `CREATE TABLE pos_sessions (
    id TEXT PRIMARY KEY,
    terminal_id TEXT NOT NULL,
    cashier_user_id TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    opening_float_cents INTEGER NOT NULL CHECK (opening_float_cents >= 0) ${integerCheck('opening_float_cents')},
    expected_closing_cash_cents INTEGER NOT NULL DEFAULT 0 CHECK (expected_closing_cash_cents >= 0) ${integerCheck('expected_closing_cash_cents')},
    blind_counted_cash_cents INTEGER CHECK (blind_counted_cash_cents >= 0) ${integerCheck('blind_counted_cash_cents')},
    cash_variance_cents INTEGER ${integerCheck('cash_variance_cents')},
    status TEXT NOT NULL CHECK (status IN (${quoteList(POS_SESSION_STATUSES)}))
)`;

const CREATE_POS_TICKETS = `CREATE TABLE pos_tickets (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES pos_sessions(id),
    terminal_id TEXT NOT NULL,
    terminal_seq_number TEXT NOT NULL UNIQUE,
    issued_at TEXT NOT NULL,
    ticket_kind TEXT NOT NULL CHECK (ticket_kind IN (${quoteList(POS_TICKET_KINDS)})),
    origin_ticket_id TEXT REFERENCES pos_tickets(id),
    ht_20_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('ht_20_cents')},
    vat_20_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('vat_20_cents')},
    ht_10_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('ht_10_cents')},
    vat_10_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('vat_10_cents')},
    ht_0_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('ht_0_cents')},
    stamp_duty_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('stamp_duty_cents')},
    total_ttc_cents INTEGER NOT NULL CHECK (total_ttc_cents >= 0) ${integerCheck('total_ttc_cents')},
    paid_cash_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('paid_cash_cents')},
    paid_card_tpe_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('paid_card_tpe_cents')},
    paid_delivery_app_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('paid_delivery_app_cents')},
    qr_conversion_token TEXT NOT NULL UNIQUE,
    b2b_conversion_state TEXT NOT NULL DEFAULT 'NONE' CHECK (b2b_conversion_state IN (${quoteList(POS_B2B_CONVERSION_STATES)})),
    converted_invoice_id TEXT,
    prev_ticket_sha256 TEXT NOT NULL,
    ticket_sha256 TEXT NOT NULL CHECK (length(ticket_sha256) = 64 AND ticket_sha256 = lower(ticket_sha256)),
    ecdsa_signature_b64 TEXT NOT NULL,
    CHECK (ticket_kind <> 'RETURN_REFUND' OR origin_ticket_id IS NOT NULL)
)`;

const CREATE_POS_Z_CLOSURES = `CREATE TABLE pos_z_closures (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE REFERENCES pos_sessions(id),
    terminal_id TEXT NOT NULL,
    closure_number INTEGER NOT NULL ${integerCheck('closure_number')},
    business_date TEXT NOT NULL,
    net_b2c_ht_20_cents INTEGER NOT NULL ${integerCheck('net_b2c_ht_20_cents')},
    net_b2c_vat_20_cents INTEGER NOT NULL ${integerCheck('net_b2c_vat_20_cents')},
    net_b2c_ht_10_cents INTEGER NOT NULL ${integerCheck('net_b2c_ht_10_cents')},
    net_b2c_vat_10_cents INTEGER NOT NULL ${integerCheck('net_b2c_vat_10_cents')},
    net_b2c_ht_0_cents INTEGER NOT NULL ${integerCheck('net_b2c_ht_0_cents')},
    total_stamp_duty_cents INTEGER NOT NULL ${integerCheck('total_stamp_duty_cents')},
    tpe_gross_cents INTEGER NOT NULL ${integerCheck('tpe_gross_cents')},
    gl_journal_entry_id TEXT,
    aip_archive_id TEXT,
    prev_z_sha256 TEXT NOT NULL,
    z_sha256 TEXT NOT NULL CHECK (length(z_sha256) = 64 AND z_sha256 = lower(z_sha256)),
    UNIQUE(terminal_id, closure_number)
)`;

const CREATE_POS_TERMINAL_IDENTITY = `CREATE TABLE pos_terminal_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    terminal_id TEXT NOT NULL,
    store_code TEXT NOT NULL CHECK (length(store_code) > 0 AND store_code NOT GLOB '*[^A-Z0-9]*'),
    terminal_code TEXT NOT NULL CHECK (length(terminal_code) > 0 AND terminal_code NOT GLOB '*[^A-Z0-9]*'),
    device_fingerprint TEXT NOT NULL,
    paired_at TEXT NOT NULL
)`;

const CREATE_POS_PAIRING_ATTEMPTS = `CREATE TABLE pos_pairing_attempts (
    code_sha256 TEXT PRIMARY KEY CHECK (length(code_sha256) = 64 AND code_sha256 = lower(code_sha256)),
    outcome TEXT NOT NULL CHECK (outcome IN ('PAIRED', 'CODE_ALREADY_USED')),
    attempted_at TEXT NOT NULL
)`;

const CREATE_POS_SEQUENCE_COUNTERS = `CREATE TABLE pos_sequence_counters (
    terminal_id TEXT PRIMARY KEY,
    last_issued_seq INTEGER NOT NULL CHECK (last_issued_seq >= 0) ${integerCheck('last_issued_seq')}
)`;

const CREATE_POS_SEQUENCE_RESERVATIONS = `CREATE TABLE pos_sequence_reservations (
    terminal_id TEXT NOT NULL REFERENCES pos_sequence_counters(terminal_id),
    seq INTEGER NOT NULL CHECK (seq >= 1) ${integerCheck('seq')},
    ticket_number TEXT NOT NULL UNIQUE,
    reserved_at TEXT NOT NULL,
    consumed_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('RESERVED', 'CONSUMED')),
    PRIMARY KEY (terminal_id, seq)
)`;

const CREATE_POS_SYNC_STATE = `CREATE TABLE pos_sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_sync_at TEXT NOT NULL
)`;

const CREATE_POS_TICKET_SYNC_STATUS = `CREATE TABLE pos_ticket_sync_status (
    ticket_id TEXT PRIMARY KEY REFERENCES pos_tickets(id),
    queued_at TEXT NOT NULL,
    synced_at TEXT
)`;

const CREATE_POS_PAIRED_PERIPHERALS = `CREATE TABLE pos_paired_peripherals (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('usb', 'bluetooth')),
    label TEXT NOT NULL,
    vendor_id INTEGER ${integerCheck('vendor_id')},
    product_id INTEGER ${integerCheck('product_id')},
    paired_at TEXT NOT NULL
)`;

const raise = (message: string): string => `SELECT RAISE(ABORT, '${message}')`;

const CREATE_TRIGGERS: readonly string[] = [
  `CREATE TRIGGER prevent_pos_ticket_delete BEFORE DELETE ON pos_tickets BEGIN ${raise('VIOLATION_PAF_CGI_ART_145: Suppression de ticket POS interdite. Retour par avoir lié.')}; END`,
  `CREATE TRIGGER prevent_pos_ticket_update BEFORE UPDATE ON pos_tickets BEGIN ${raise('VIOLATION_PAF_CGI_ART_145: Modification de ticket POS interdite. Retour par avoir lié.')}; END`,
  `CREATE TRIGGER prevent_pos_z_closure_delete BEFORE DELETE ON pos_z_closures BEGIN ${raise('VIOLATION_PAF_CGI_ART_145: Suppression de clôture Z interdite.')}; END`,
  `CREATE TRIGGER prevent_pos_z_closure_update BEFORE UPDATE ON pos_z_closures BEGIN ${raise('VIOLATION_PAF_CGI_ART_145: Modification de clôture Z interdite.')}; END`,
  `CREATE TRIGGER queue_pos_ticket_for_sync AFTER INSERT ON pos_tickets BEGIN INSERT INTO pos_ticket_sync_status (ticket_id, queued_at) VALUES (NEW.id, NEW.issued_at); END`,
];

export interface LocalMigration {
  readonly version: number;
  readonly name: string;
  readonly upSqlStatements: readonly string[];
  /** SHA-256 hexadécimal de `upSqlStatements.join("\n")`. */
  readonly expectedSha256Hex: string;
}

export const LOCAL_MIGRATIONS: readonly LocalMigration[] = [
  {
    version: 1,
    name: 'local_pos_sessions_tickets_z',
    upSqlStatements: [CREATE_POS_SESSIONS, CREATE_POS_TICKETS, CREATE_POS_Z_CLOSURES],
    expectedSha256Hex: '60f959f2b3cf7fd49582989f209ae750865bf6e6f557953815aab77f1014b2d0',
  },
  {
    version: 2,
    name: 'local_terminal_identity_sequencer_sync_peripherals',
    upSqlStatements: [
      CREATE_POS_TERMINAL_IDENTITY,
      CREATE_POS_PAIRING_ATTEMPTS,
      CREATE_POS_SEQUENCE_COUNTERS,
      CREATE_POS_SEQUENCE_RESERVATIONS,
      CREATE_POS_SYNC_STATE,
      CREATE_POS_TICKET_SYNC_STATUS,
      CREATE_POS_PAIRED_PERIPHERALS,
      ...CREATE_TRIGGERS,
    ],
    expectedSha256Hex: '955a6eb8b45ba94b7ffc781a643e6855b629d797e22c6416063c4d9fc802b2fb',
  },
];

export class LocalMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalMigrationError';
  }
}

const CREATE_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS local_schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    applied_at TEXT NOT NULL
)`;

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface MigrationReport {
  readonly applied: readonly number[];
}

/** Applique les migrations manquantes ; refuse une migration altérée ou une base plus récente que l'application. */
export async function runLocalMigrations(storage: PosStorage, nowIso: string): Promise<MigrationReport> {
  await storage.run(CREATE_MIGRATIONS_TABLE);
  const rows = await storage.all('SELECT version, name, checksum_sha256 FROM local_schema_migrations ORDER BY version');
  const appliedByVersion = new Map<number, string>();
  for (const row of rows) {
    appliedByVersion.set(Number(row['version']), String(row['checksum_sha256']));
  }
  const knownVersions = new Set(LOCAL_MIGRATIONS.map((migration) => migration.version));
  for (const version of appliedByVersion.keys()) {
    if (!knownVersions.has(version)) {
      throw new LocalMigrationError(`Base locale plus récente que l'application : migration v${version} inconnue.`);
    }
  }

  const applied: number[] = [];
  for (const migration of LOCAL_MIGRATIONS) {
    const checksum = await sha256Hex(migration.upSqlStatements.join('\n'));
    if (checksum !== migration.expectedSha256Hex) {
      throw new LocalMigrationError(`Migration locale v${migration.version} (${migration.name}) : empreinte du code source incohérente avec l'empreinte déclarée.`);
    }
    const stored = appliedByVersion.get(migration.version);
    if (stored !== undefined) {
      if (stored !== checksum) {
        throw new LocalMigrationError(`Migration locale v${migration.version} (${migration.name}) altérée.`);
      }
      continue;
    }
    await storage.batch([
      ...migration.upSqlStatements.map((sql) => ({ sql })),
      {
        sql: 'INSERT INTO local_schema_migrations (version, name, checksum_sha256, applied_at) VALUES (?, ?, ?, ?)',
        params: [migration.version, migration.name, checksum, nowIso],
      },
    ]);
    applied.push(migration.version);
  }
  return { applied };
}
