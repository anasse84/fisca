import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  LEDGER_JOURNAL_TYPES,
  LEDGER_SOURCE_DOCUMENT_TYPES,
  LEDGER_STATUSES,
  TENANT_INDEX_NAMES,
  TENANT_MIGRATIONS,
  TENANT_TABLE_NAMES,
  TENANT_TRIGGER_NAMES,
  TENANT_VIEW_NAMES,
} from '../src/tenant.ts';
import { all, expectSqlError, NOW } from './support.ts';
import {
  accountRow,
  bankTransactionRow,
  entryRow,
  entryLineRow,
  entryWithLines,
  fiscalYearRow,
  fixedAssetRow,
  GENESIS_HASH,
  insertRow,
  insertRows,
  insertSqlite,
  journalRow,
  LEDGER_SEED,
  NON_INTEGER,
  openLedger,
  openTenant,
  POST_ENTRY_SQL,
  postParams,
  sealSqlite,
  simpleEntry,
  SHA_B,
  type RowValues,
} from './tenant-support.ts';

const CHECK_FAILED = /CHECK constraint failed/;
const UNIQUE_FAILED = /UNIQUE constraint failed/;
const FK_FAILED = /FOREIGN KEY constraint failed/;
const NOT_NULL_FAILED = /NOT NULL constraint failed/;

/** Fingerprints des migrations v1 et v2 livrées par T-S1B-02 et T-S1B-03 : elles ne bougent jamais. */
const MIGRATION_1_SHA256 = 'a554a3477c4d1e3561b81e72e243fc72e2be519d155a3120a497ef0d93a04f61';
const MIGRATION_2_SHA256 = 'bfb09b92f078d2796cc62c0604bbc50d9bf3b5f7dffc3539704b564dca15b581';

const LEDGER_TABLES = [
  'fiscal_years',
  'journals',
  'cgnc_accounts',
  'journal_entries',
  'journal_entry_lines',
  'bank_transactions',
  'fixed_assets_register',
] as const;

const TRIGGERS = [
  'prevent_posted_entry_update',
  'prevent_posted_entry_delete',
  'prevent_posted_lines_mutation_update',
  'prevent_posted_lines_mutation_delete',
  'enforce_balance_and_positive_cash_on_post',
  'prevent_direct_posted_insert',
] as const;

/** Textes de RAISE de Doc_06 § 05 (les cinq premiers) et du trigger D-03 ; identiques sous PostgreSQL (tenant-postgres.test.ts). */
const MSG_PII_DOWNGRADE = 'VIOLATION_CNDP_LOI_09_08_ART_211: Restriction fiscale irréversible : pii_restricted_flag ne peut pas redescendre de 1 à 0.';
const MSG_ENTRY_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Écriture validée immuable. Utilisez une contre-passation.';
const MSG_ENTRY_DELETE = 'VIOLATION_PAF_CGI_ART_145: Suppression interdite sur le Grand Livre.';
const MSG_LINE_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Modification de ligne interdite sur pièce POSTED.';
const MSG_LINE_DELETE = 'VIOLATION_PAF_CGI_ART_145: Suppression de ligne interdite sur pièce POSTED.';
const MSG_UNBALANCED = 'CGNC_UNBALANCED_LINES: La somme des lignes ne boucle pas avec le total de la pièce.';
const MSG_MISSING_HASH = 'PAF_MISSING_HASH: Empreinte SHA-256 obligatoire pour sceller en POSTED.';
const MSG_NEGATIVE_CASH = 'CGNC_NEGATIVE_CASH_5161: Décaissement refusé car il rendrait le solde de caisse 5161 créditeur.';
const MSG_DIRECT_POSTED = 'VIOLATION_PAF_CGI_ART_145: Insertion directe au statut POSTED interdite. Créez la pièce en brouillon puis validez-la.';

function names(db: DatabaseSync, type: 'table' | 'index' | 'trigger' | 'view'): string[] {
  return all(db, `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`, type).map((row) => String(row['name']));
}

function reject(db: DatabaseSync, table: string, values: RowValues, pattern: RegExp): void {
  const { sql, params } = insertSqlite(table, values);
  expectSqlError(db, sql, params, pattern);
}

function messageOf(db: DatabaseSync, sql: string, params: readonly (string | number | null)[]): string {
  try {
    db.prepare(sql).run(...params);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`Aucune erreur levée pour : ${sql}`);
}

function post(db: DatabaseSync, id: string): void {
  sealSqlite(db, id);
}

/** Pièce équilibrée de 1 200,00 : débit 3421 clients, crédit 7111 ventes (HT) et 4455 (TVA), puis scellée en POSTED. */
function seedPostedSale(db: DatabaseSync): void {
  insertRows(
    db,
    entryWithLines('je-vte', 1, 'jrn-vte', [
      { account: 'acc-3421', debit: 120000 },
      { account: 'acc-7111', credit: 100000 },
      { account: 'acc-4455', credit: 20000 },
    ]),
  );
  post(db, 'je-vte');
}

describe('migration v3 : grand livre CGNC (Doc_06 § 05) ajoutée sans toucher aux v1 et v2', () => {
  const v3 = TENANT_MIGRATIONS[2];

  it('est la troisième migration, après la v1 et la v2', () => {
    expect(TENANT_MIGRATIONS.map((m) => m.version).slice(0, 3)).toEqual([1, 2, 3]);
    expect(v3?.name).toBe('tenant_part3_general_ledger_cgnc_paf_triggers');
  });

  it('les migrations v1 et v2 sont inchangées : empreintes identiques à celles de T-S1B-02 et T-S1B-03, recalculées', () => {
    expect(TENANT_MIGRATIONS[0]?.expectedSha256Hex).toBe(MIGRATION_1_SHA256);
    expect(TENANT_MIGRATIONS[1]?.expectedSha256Hex).toBe(MIGRATION_2_SHA256);
    for (const [index, expected] of [MIGRATION_1_SHA256, MIGRATION_2_SHA256].entries()) {
      const digest = createHash('sha256').update(TENANT_MIGRATIONS[index]?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex');
      expect(digest, `migration v${index + 1}`).toBe(expected);
    }
    expect(TENANT_MIGRATIONS[0]?.tableNames).toHaveLength(7);
    expect(TENANT_MIGRATIONS[1]?.tableNames).toHaveLength(3);
  });

  it('empreinte SHA-256 de la v3 recalculée identique à celle déclarée (calcul de ensureTenantSchemaUpToDate)', () => {
    const digest = createHash('sha256').update(v3?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex');
    expect(digest).toBe(v3?.expectedSha256Hex);
    expect(v3?.expectedSha256Hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('crée exactement les 7 tables, 2 index, 6 triggers et la vue du registre, dans cet ordre', () => {
    expect(v3?.tableNames).toEqual([...LEDGER_TABLES]);
    expect(v3?.indexNames).toEqual(['idx_je_fy_status_seq', 'idx_jel_entry_account']);
    expect(v3?.triggerNames).toEqual([...TRIGGERS]);
    expect(v3?.viewNames).toEqual(['v_cgnc_trial_balance_6col']);
    expect(TENANT_TABLE_NAMES.slice(10, 17)).toEqual([...LEDGER_TABLES]);
    expect(TENANT_INDEX_NAMES.slice(0, 5)).toEqual(['idx_partners_ice_bidx', 'idx_invoices_dedup_bidx', 'idx_inv_partner_date_dir', 'idx_je_fy_status_seq', 'idx_jel_entry_account']);
    expect([...TENANT_TRIGGER_NAMES].slice(0, TRIGGERS.length)).toEqual([...TRIGGERS]);
    expect([...TENANT_VIEW_NAMES]).toEqual(['v_cgnc_trial_balance_6col']);
  });

  it('les migrations v1 et v2 ne déclarent ni trigger ni vue', () => {
    expect(TENANT_MIGRATIONS[0]?.triggerNames ?? []).toEqual([]);
    expect(TENANT_MIGRATIONS[0]?.viewNames ?? []).toEqual([]);
    expect(TENANT_MIGRATIONS[1]?.triggerNames ?? []).toEqual([]);
    expect(TENANT_MIGRATIONS[1]?.viewNames ?? []).toEqual([]);
  });

  it('les tables, index, triggers et vues déclarés sont ceux que la v3 crée réellement sur SQLite', () => {
    const db = openTenant(2);
    const before = { table: names(db, 'table'), index: names(db, 'index'), trigger: names(db, 'trigger'), view: names(db, 'view') };
    expect(before.trigger).toEqual([]);
    expect(before.view).toEqual([]);
    for (const statement of v3?.upSqlStatements ?? []) {
      db.exec(statement);
    }
    const created = (type: 'table' | 'index' | 'trigger' | 'view'): string[] =>
      names(db, type).filter((name) => !before[type].includes(name) && !name.startsWith('sqlite_autoindex'));
    expect(created('table')).toEqual([...LEDGER_TABLES].sort());
    expect(created('index')).toEqual([...(v3?.indexNames ?? [])].sort());
    expect(created('trigger')).toEqual([...TRIGGERS].sort());
    expect(created('view')).toEqual(['v_cgnc_trial_balance_6col']);
  });

  it('une base v2 se met à niveau en appliquant seulement la v3 (aucune ligne des tables v1 et v2 perdue)', () => {
    const db = openTenant(2);
    insertRow(db, 'fiscal_partners', { id: 'p-up', partner_role: 'CLIENT', tax_category: 'COMPANY_IS', legal_name_enc: 'v1:a:b', address_adc450_enc: 'v1:a:c', pcge_auxiliary_account: '34210001', created_at: NOW });
    for (const statement of v3?.upSqlStatements ?? []) {
      db.exec(statement);
    }
    expect(all(db, 'SELECT COUNT(*) AS n FROM fiscal_partners')).toEqual([{ n: 1 }]);
  });

  it('aucune colonne REAL, FLOAT ou NUMERIC : TEXT et INTEGER seulement, DDL sans type décimal', () => {
    const db = openTenant();
    for (const table of LEDGER_TABLES) {
      for (const column of all(db, `SELECT name, type FROM pragma_table_info(?)`, table)) {
        expect(['TEXT', 'INTEGER'], `${table}.${String(column['name'])}`).toContain(String(column['type']));
      }
    }
    expect(v3?.upSqlStatements.join('\n')).not.toMatch(/\b(REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL)\b/i);
  });

  it('chaque colonne entière porte le CHECK d\'entier strict (ou 0/1) ; les colonnes _cents et _bps portent le CAST', () => {
    const db = openTenant();
    let counted = 0;
    for (const table of LEDGER_TABLES) {
      const ddl = String(all(db, `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, table)[0]?.['sql']);
      for (const row of all(db, `SELECT name, type FROM pragma_table_info(?)`, table)) {
        const column = String(row['name']);
        if (String(row['type']) === 'INTEGER') {
          counted += 1;
          const strict = ddl.includes(`CHECK (${column} = CAST(${column} AS INTEGER))`) || ddl.includes(`CHECK (${column} IN (0, 1))`);
          expect(strict, `${table}.${column}`).toBe(true);
          if (/_(cents|bps)$/.test(column)) {
            expect(ddl, `${table}.${column}`).toContain(`CHECK (${column} = CAST(${column} AS INTEGER))`);
          }
        }
      }
    }
    expect(counted).toBe(25);
  });

  it("aucune colonne de taux de TVA ni de prorata en pourcentage dans le grand livre ; fiscal_years garde les bps (D-04, D-10)", () => {
    const db = openTenant();
    for (const table of LEDGER_TABLES) {
      const columns = all(db, `SELECT name FROM pragma_table_info(?)`, table).map((row) => String(row['name']));
      expect(columns.filter((c) => /vat_rate_bps|deduction_prorata_pct/.test(c)), table).toEqual([]);
    }
    const fiscalYears = all(db, `SELECT name FROM pragma_table_info('fiscal_years')`).map((row) => String(row['name']));
    expect(fiscalYears).toContain('provisional_vat_prorata_bps');
    expect(fiscalYears).toContain('definitive_vat_prorata_bps');
  });

  it('les index nommés couvrent (fiscal_year_id, status, journal_id, sequence_number) et (entry_id, account_id) (Doc_06 § 08)', () => {
    const db = openTenant();
    const columnsOfIndex = (index: string): string[] =>
      all(db, `SELECT name FROM pragma_index_info(?) ORDER BY seqno`, index).map((row) => String(row['name']));
    expect(columnsOfIndex('idx_je_fy_status_seq')).toEqual(['fiscal_year_id', 'status', 'journal_id', 'sequence_number']);
    expect(columnsOfIndex('idx_jel_entry_account')).toEqual(['entry_id', 'account_id']);
  });
});

describe('pii_restricted_flag sur le grand livre (ERRATA D-19, Doc_11 § 06)', () => {
  it('existe sur journal_entries et journal_entry_lines (avec invoices de v1), INTEGER 0/1 NOT NULL DEFAULT 0, nulle part ailleurs', () => {
    const db = openTenant();
    const tables = TENANT_TABLE_NAMES.filter((table) =>
      all(db, `SELECT name FROM pragma_table_info(?)`, table).some((c) => c['name'] === 'pii_restricted_flag'),
    );
    // v5 (T-S1B-05) ajoute la colonne à payroll_annual_subledger et archival_packages (Doc_11 § 06 : état 9421 et paquets AIP).
    expect(tables).toEqual(['invoices', 'journal_entries', 'journal_entry_lines', 'payroll_annual_subledger', 'archival_packages']);
    for (const table of ['journal_entries', 'journal_entry_lines']) {
      expect(all(db, `SELECT type, "notnull" AS not_null, dflt_value FROM pragma_table_info(?) WHERE name = 'pii_restricted_flag'`, table)).toEqual([
        { type: 'INTEGER', not_null: 1, dflt_value: '0' },
      ]);
    }
  });

  it('accepte 0 et 1 à la création d\'une pièce et d\'une ligne, refuse 2, -1, une valeur fractionnaire liée et NULL', () => {
    const db = openLedger();
    insertRows(db, simpleEntry('je-a', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 5000, { pii_restricted_flag: 1 }));
    insertRow(db, 'journal_entry_lines', entryLineRow({ id: 'jel-flag', entry_id: 'je-a', line_number: 9, account_id: 'acc-6111', debit_cents: 0, credit_cents: 1, pii_restricted_flag: 1 }));
    expect(all(db, `SELECT pii_restricted_flag AS f FROM journal_entries WHERE id = 'je-a'`)).toEqual([{ f: 1 }]);
    for (const bad of [2, -1, NON_INTEGER, null]) {
      reject(db, 'journal_entries', entryRow({ id: 'je-b', sequence_number: 2, entry_reference: 'X-2', status: 'DRAFT', pii_restricted_flag: bad }), bad === null ? NOT_NULL_FAILED : CHECK_FAILED);
      reject(db, 'journal_entry_lines', entryLineRow({ id: 'jel-b', line_number: 8, entry_id: 'je-a', account_id: 'acc-6111', pii_restricted_flag: bad }), bad === null ? NOT_NULL_FAILED : CHECK_FAILED);
    }
  });

  it('le drapeau d\'une pièce POSTED ne peut plus descendre de 1 à 0 (trigger d\'immuabilité) ; il se pose avant le scellement ou monte ensuite (v4)', () => {
    const db = openLedger();
    insertRows(db, simpleEntry('je-a', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 5000));
    db.prepare(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-a'`).run();
    post(db, 'je-a');
    expect([MSG_PII_DOWNGRADE, MSG_ENTRY_UPDATE]).toContain(messageOf(db, `UPDATE journal_entries SET pii_restricted_flag = 0 WHERE id = 'je-a'`, []));
    // Migration v4 (décision du pilote) : la montée 0 vers 1 d'une ligne POSTED est admise (DSAR), la descente reste refusée.
    db.prepare(`UPDATE journal_entry_lines SET pii_restricted_flag = 1 WHERE entry_id = 'je-a'`).run();
    expect([MSG_PII_DOWNGRADE, MSG_LINE_UPDATE]).toContain(messageOf(db, `UPDATE journal_entry_lines SET pii_restricted_flag = 0 WHERE entry_id = 'je-a'`, []));
    expect(all(db, `SELECT pii_restricted_flag AS f FROM journal_entries WHERE id = 'je-a'`)).toEqual([{ f: 1 }]);
  });
});

describe('fiscal_years, journals, cgnc_accounts', () => {
  it('exercice : valeurs par défaut de Doc_06 (OPEN, modèle 1, prorata provisoire 10000 bps, définitif NULL)', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_years', fiscalYearRow());
    expect(all(db, 'SELECT status, simpl_is_model, provisional_vat_prorata_bps, definitive_vat_prorata_bps, closing_hash FROM fiscal_years')).toEqual([
      { status: 'OPEN', simpl_is_model: 1, provisional_vat_prorata_bps: 10000, definitive_vat_prorata_bps: null, closing_hash: null },
    ]);
  });

  it.each(['OPEN', 'CLOSING', 'CLOSED'])('exercice : accepte le statut %s', (status) => {
    insertRow(openTenant(), 'fiscal_years', fiscalYearRow({ status }));
  });

  it('exercice : refuse un statut inconnu, un modèle SIMPL-IS hors 1 à 4, un prorata hors 0 à 10000, un montant non entier', () => {
    const db = openTenant();
    reject(db, 'fiscal_years', fiscalYearRow({ status: 'ARCHIVED' }), CHECK_FAILED);
    reject(db, 'fiscal_years', fiscalYearRow({ status: 'closed' }), CHECK_FAILED);
    reject(db, 'fiscal_years', fiscalYearRow({ simpl_is_model: 0 }), CHECK_FAILED);
    reject(db, 'fiscal_years', fiscalYearRow({ simpl_is_model: 5 }), CHECK_FAILED);
    reject(db, 'fiscal_years', fiscalYearRow({ provisional_vat_prorata_bps: 10001 }), CHECK_FAILED);
    reject(db, 'fiscal_years', fiscalYearRow({ provisional_vat_prorata_bps: -1 }), CHECK_FAILED);
    reject(db, 'fiscal_years', fiscalYearRow({ definitive_vat_prorata_bps: 10001 }), CHECK_FAILED);
    reject(db, 'fiscal_years', fiscalYearRow({ provisional_vat_prorata_bps: NON_INTEGER }), CHECK_FAILED);
    reject(db, 'fiscal_years', fiscalYearRow({ definitive_vat_prorata_bps: 'abc' }), CHECK_FAILED);
    reject(db, 'fiscal_years', fiscalYearRow({ closing_hash: 'ABC' }), CHECK_FAILED);
  });

  it('exercice : le prorata définitif de 8500 bps et un sceau SHA-256 minuscule sont acceptés ; code unique', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_years', fiscalYearRow({ definitive_vat_prorata_bps: 8500, closing_hash: SHA_B }));
    reject(db, 'fiscal_years', fiscalYearRow({ id: 'fy-x' }), UNIQUE_FAILED);
  });

  it('journal : type, code unique, valeurs par défaut (séquence 0, empreinte GENESIS)', () => {
    const db = openTenant();
    expect([...LEDGER_JOURNAL_TYPES]).toEqual(['OPENING', 'PURCHASE', 'SALE', 'BANK', 'CASH', 'GENERAL']);
    for (const [index, journalType] of LEDGER_JOURNAL_TYPES.entries()) {
      insertRow(db, 'journals', journalRow({ id: `j-${index}`, code: `J${index}`, journal_type: journalType }));
    }
    expect(all(db, `SELECT last_sequence_number AS n, last_entry_hash AS h FROM journals WHERE id = 'j-0'`)).toEqual([{ n: 0, h: GENESIS_HASH }]);
    reject(db, 'journals', journalRow({ id: 'j-x', code: 'J0' }), UNIQUE_FAILED);
    reject(db, 'journals', journalRow({ id: 'j-x', code: 'JX', journal_type: 'PAIE' }), CHECK_FAILED);
    reject(db, 'journals', journalRow({ id: 'j-x', code: 'JX', last_sequence_number: -1 }), CHECK_FAILED);
    reject(db, 'journals', journalRow({ id: 'j-x', code: 'JX', last_sequence_number: NON_INTEGER }), CHECK_FAILED);
  });

  it('compte : classe 1 à 8, sens, rôle TVA, numéro de 4 à 8 chiffres unique', () => {
    const db = openTenant();
    insertRow(db, 'cgnc_accounts', accountRow());
    expect(all(db, 'SELECT is_reconcilable, vat_regime_role FROM cgnc_accounts')).toEqual([{ is_reconcilable: 0, vat_regime_role: 'NONE' }]);
    reject(db, 'cgnc_accounts', accountRow({ id: 'a-x', account_number: '51610001', cgnc_class: 0 }), CHECK_FAILED);
    reject(db, 'cgnc_accounts', accountRow({ id: 'a-x', account_number: '51610001', cgnc_class: 9 }), CHECK_FAILED);
    reject(db, 'cgnc_accounts', accountRow({ id: 'a-x', account_number: '51610001', normal_balance: 'SOLDE' }), CHECK_FAILED);
    reject(db, 'cgnc_accounts', accountRow({ id: 'a-x', account_number: '51610001', vat_regime_role: 'VAT_AUTRE' }), CHECK_FAILED);
    reject(db, 'cgnc_accounts', accountRow({ id: 'a-x', account_number: '516' }), CHECK_FAILED);
    reject(db, 'cgnc_accounts', accountRow({ id: 'a-x', account_number: '516100001' }), CHECK_FAILED);
    reject(db, 'cgnc_accounts', accountRow({ id: 'a-x' }), UNIQUE_FAILED);
    reject(db, 'cgnc_accounts', accountRow({ id: 'a-x', account_number: '51610001', is_reconcilable: 2 }), CHECK_FAILED);
    for (const [index, role] of ['NONE', 'VAT_COLLECTED_PENDING', 'VAT_COLLECTED_DUE', 'VAT_RECOVERABLE_PENDING', 'VAT_RECOVERABLE_CHARGES', 'VAT_RECOVERABLE_IMMOB'].entries()) {
      insertRow(db, 'cgnc_accounts', accountRow({ id: `a-${role}`, account_number: `4455${index}00`, vat_regime_role: role }));
    }
  });
});

describe('journal_entries : statuts, contre-passation et contraintes de Doc_06 § 05', () => {
  it('les 4 statuts de Doc_06 : CONTRE_PASSEE n\'existe pas (ERRATA D-03)', () => {
    expect([...LEDGER_STATUSES]).toEqual(['IA_PROPOSITION', 'DRAFT', 'REVISEE_CYCLE', 'POSTED']);
    expect([...LEDGER_STATUSES]).not.toContain('CONTRE_PASSEE');
    expect([...LEDGER_SOURCE_DOCUMENT_TYPES]).toContain('REVERSAL');
  });

  it.each(['IA_PROPOSITION', 'DRAFT', 'REVISEE_CYCLE'])('une pièce peut naître au statut %s', (status) => {
    const db = openLedger();
    insertRows(db, simpleEntry('je-s', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 100, { status }));
  });

  it('le statut par défaut est IA_PROPOSITION et le cycle de revue GENERAL', () => {
    const db = openLedger();
    insertRow(db, 'journal_entries', entryRow());
    expect(all(db, 'SELECT status, review_cycle, validated_at, entry_hash, pii_restricted_flag FROM journal_entries')).toEqual([
      { status: 'IA_PROPOSITION', review_cycle: 'GENERAL', validated_at: null, entry_hash: null, pii_restricted_flag: 0 },
    ]);
  });

  it('refuse les statuts CONTRE_PASSEE, REVERSED, posted et vide à l\'insertion et à la mise à jour (CHECK)', () => {
    const db = openLedger();
    for (const status of ['CONTRE_PASSEE', 'REVERSED', 'posted', '']) {
      reject(db, 'journal_entries', entryRow({ status }), CHECK_FAILED);
    }
    insertRows(db, simpleEntry('je-s', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 100));
    expectSqlError(db, `UPDATE journal_entries SET status = ? WHERE id = 'je-s'`, ['CONTRE_PASSEE'], CHECK_FAILED);
    expect(all(db, `SELECT status FROM journal_entries WHERE id = 'je-s'`)).toEqual([{ status: 'DRAFT' }]);
  });

  it('cycles de revue, types de pièce source : valeurs de Doc_06 uniquement', () => {
    const db = openLedger();
    for (const [index, cycle] of ['TRESORERIE', 'ACHATS', 'VENTES', 'PAIE_SOCIAL', 'FISCAL', 'GENERAL'].entries()) {
      insertRow(db, 'journal_entries', entryRow({ id: `je-c${index}`, sequence_number: index + 1, entry_reference: `C-${index}`, review_cycle: cycle }));
    }
    reject(db, 'journal_entries', entryRow({ id: 'je-x', sequence_number: 50, entry_reference: 'X-50', review_cycle: 'RH' }), CHECK_FAILED);
    // Depuis la v9, la pièce visée par une contre-passation existe et est POSTED.
    insertRows(db, simpleEntry('je-orig', 200, 'jrn-vte', 'acc-3421', 'acc-7111', 100));
    post(db, 'je-orig');
    for (const [index, kind] of LEDGER_SOURCE_DOCUMENT_TYPES.entries()) {
      const reversal = kind === 'REVERSAL' ? { reversal_of_entry_id: 'je-orig' } : {};
      insertRow(db, 'journal_entries', entryRow({ id: `je-t${index}`, sequence_number: 100 + index, entry_reference: `T-${index}`, source_document_type: kind, ...reversal }));
    }
    reject(db, 'journal_entries', entryRow({ id: 'je-x', sequence_number: 99, entry_reference: 'X-99', source_document_type: 'MANUAL' }), CHECK_FAILED);
  });

  it('totaux : débit > 0, crédit = débit, entiers stricts', () => {
    const db = openLedger();
    reject(db, 'journal_entries', entryRow({ total_debit_cents: 0, total_credit_cents: 0 }), CHECK_FAILED);
    reject(db, 'journal_entries', entryRow({ total_debit_cents: -5, total_credit_cents: -5 }), CHECK_FAILED);
    reject(db, 'journal_entries', entryRow({ total_credit_cents: 119999 }), CHECK_FAILED);
    reject(db, 'journal_entries', entryRow({ total_debit_cents: NON_INTEGER, total_credit_cents: NON_INTEGER }), CHECK_FAILED);
    reject(db, 'journal_entries', entryRow({ total_debit_cents: 'abc', total_credit_cents: 'abc' }), CHECK_FAILED);
  });

  it('unicité : référence, et (journal, exercice, séquence) ; clés étrangères vers exercice, journal, facture, tiers, pièce d\'origine', () => {
    const db = openLedger();
    insertRow(db, 'journal_entries', entryRow());
    reject(db, 'journal_entries', entryRow({ id: 'je-x', sequence_number: 2 }), UNIQUE_FAILED);
    reject(db, 'journal_entries', entryRow({ id: 'je-x', entry_reference: 'AUTRE' }), UNIQUE_FAILED);
    reject(db, 'journal_entries', entryRow({ id: 'je-x', sequence_number: 2, entry_reference: 'X', fiscal_year_id: 'ghost' }), FK_FAILED);
    reject(db, 'journal_entries', entryRow({ id: 'je-x', sequence_number: 2, entry_reference: 'X', journal_id: 'ghost' }), FK_FAILED);
    reject(db, 'journal_entries', entryRow({ id: 'je-x', sequence_number: 2, entry_reference: 'X', invoice_id: 'ghost' }), FK_FAILED);
    reject(db, 'journal_entries', entryRow({ id: 'je-x', sequence_number: 2, entry_reference: 'X', partner_id: 'ghost' }), FK_FAILED);
    reject(db, 'journal_entries', entryRow({ id: 'je-x', sequence_number: 2, entry_reference: 'X', source_document_type: 'REVERSAL', reversal_of_entry_id: 'ghost' }), /CGNC_REVERSAL_TARGET_INVALID/);
  });

  it('l\'empreinte entry_hash, quand elle existe, est un SHA-256 hexadécimal minuscule de 64 caractères', () => {
    const db = openLedger();
    reject(db, 'journal_entries', entryRow({ entry_hash: 'abc' }), CHECK_FAILED);
    reject(db, 'journal_entries', entryRow({ entry_hash: 'B'.repeat(64) }), CHECK_FAILED);
    insertRow(db, 'journal_entries', entryRow({ entry_hash: SHA_B, previous_entry_hash: GENESIS_HASH }));
  });

  it('contre-passation : une pièce REVERSAL exige reversal_of_entry_id (écart assumé, comme l\'avoir 381) et ne se réfère pas à elle-même', () => {
    const db = openLedger();
    reject(db, 'journal_entries', entryRow({ source_document_type: 'REVERSAL' }), CHECK_FAILED);
    reject(db, 'journal_entries', entryRow({ source_document_type: 'REVERSAL', reversal_of_entry_id: 'je-1' }), CHECK_FAILED);
  });
});

describe('journal_entry_lines', () => {
  it('une ligne est soit au débit soit au crédit, jamais les deux, jamais nulle, jamais négative', () => {
    const db = openLedger();
    insertRows(db, [['journal_entries', entryRow({ status: 'DRAFT' })]]);
    reject(db, 'journal_entry_lines', entryLineRow({ debit_cents: 100, credit_cents: 100 }), CHECK_FAILED);
    reject(db, 'journal_entry_lines', entryLineRow({ debit_cents: 0, credit_cents: 0 }), CHECK_FAILED);
    reject(db, 'journal_entry_lines', entryLineRow({ debit_cents: -100, credit_cents: 0 }), CHECK_FAILED);
    reject(db, 'journal_entry_lines', entryLineRow({ debit_cents: 0, credit_cents: -100 }), CHECK_FAILED);
    reject(db, 'journal_entry_lines', entryLineRow({ debit_cents: NON_INTEGER }), CHECK_FAILED);
    reject(db, 'journal_entry_lines', entryLineRow({ debit_cents: 'abc' }), CHECK_FAILED);
    insertRow(db, 'journal_entry_lines', entryLineRow({ debit_cents: 0, credit_cents: 120000 }));
  });

  it('(entry_id, line_number) unique ; pièce et compte doivent exister ; description chiffrée obligatoire ; booléens 0/1', () => {
    const db = openLedger();
    insertRow(db, 'journal_entries', entryRow({ status: 'DRAFT' }));
    insertRow(db, 'journal_entry_lines', entryLineRow());
    reject(db, 'journal_entry_lines', entryLineRow({ id: 'jel-x' }), UNIQUE_FAILED);
    reject(db, 'journal_entry_lines', entryLineRow({ id: 'jel-x', line_number: 2, entry_id: 'ghost' }), FK_FAILED);
    reject(db, 'journal_entry_lines', entryLineRow({ id: 'jel-x', line_number: 2, account_id: 'ghost' }), FK_FAILED);
    reject(db, 'journal_entry_lines', entryLineRow({ id: 'jel-x', line_number: 2, description_enc: null }), NOT_NULL_FAILED);
    reject(db, 'journal_entry_lines', entryLineRow({ id: 'jel-x', line_number: 2, is_tax_deductible: 2 }), CHECK_FAILED);
    expect(all(db, 'SELECT is_tax_deductible, table3_reintegration_code, reconciliation_code, reconciled_at FROM journal_entry_lines')).toEqual([
      { is_tax_deductible: 1, table3_reintegration_code: null, reconciliation_code: null, reconciled_at: null },
    ]);
  });
});

describe('bank_transactions et fixed_assets_register', () => {
  it('un relevé : décaissement négatif accepté, état par défaut UNMATCHED, 4 états de rapprochement', () => {
    const db = openLedger();
    insertRow(db, 'bank_transactions', bankTransactionRow({ amount_cents: -45000 }));
    expect(all(db, 'SELECT amount_cents, reconciliation_state FROM bank_transactions')).toEqual([{ amount_cents: -45000, reconciliation_state: 'UNMATCHED' }]);
    for (const [index, state] of ['UNMATCHED', 'SUSPENS_AMBIGU_3497_4497', 'MATCHED_PARTIAL', 'MATCHED_FULL'].entries()) {
      insertRow(db, 'bank_transactions', bankTransactionRow({ id: `bt-s${index}`, reconciliation_state: state }));
    }
    reject(db, 'bank_transactions', bankTransactionRow({ id: 'bt-x', reconciliation_state: 'LETTREE' }), CHECK_FAILED);
    reject(db, 'bank_transactions', bankTransactionRow({ id: 'bt-x', amount_cents: NON_INTEGER }), CHECK_FAILED);
    reject(db, 'bank_transactions', bankTransactionRow({ id: 'bt-x', amount_cents: 'abc' }), CHECK_FAILED);
    reject(db, 'bank_transactions', bankTransactionRow({ id: 'bt-x', gl_entry_id: 'ghost' }), FK_FAILED);
    reject(db, 'bank_transactions', bankTransactionRow({ id: 'bt-x', raw_label_enc: null }), NOT_NULL_FAILED);
  });

  it('une transaction bancaire se rattache à une pièce du grand livre', () => {
    const db = openLedger();
    insertRow(db, 'journal_entries', entryRow());
    insertRow(db, 'bank_transactions', bankTransactionRow({ gl_entry_id: 'je-1' }));
  });

  it('immobilisation : valeurs par défaut de Doc_06 (prorata 10000 bps, 60 mois, TVA initiale 0)', () => {
    const db = openLedger();
    insertRow(db, 'fixed_assets_register', fixedAssetRow());
    expect(
      all(db, 'SELECT is_passenger_vehicle, initial_vat_deducted_cents, initial_prorata_bps, vat_retention_months_required, fiscal_depreciable_cap_cents, disposal_date FROM fixed_assets_register'),
    ).toEqual([
      { is_passenger_vehicle: 0, initial_vat_deducted_cents: 0, initial_prorata_bps: 10000, vat_retention_months_required: 60, fiscal_depreciable_cap_cents: null, disposal_date: null },
    ]);
  });

  it('immobilisation : plafond voiture de 40 000 000 centimes accepté ; refuse montants négatifs, fractionnaires, prorata et taux hors bornes, compte hors classe 2', () => {
    const db = openLedger();
    insertRow(db, 'fixed_assets_register', fixedAssetRow({ is_passenger_vehicle: 1, fiscal_depreciable_cap_cents: 40000000, vat_retention_months_required: 120 }));
    reject(db, 'fixed_assets_register', fixedAssetRow({ id: 'fa-x', acquisition_ht_cents: -1 }), CHECK_FAILED);
    reject(db, 'fixed_assets_register', fixedAssetRow({ id: 'fa-x', acquisition_ttc_cents: NON_INTEGER }), CHECK_FAILED);
    reject(db, 'fixed_assets_register', fixedAssetRow({ id: 'fa-x', fiscal_depreciable_cap_cents: -1 }), CHECK_FAILED);
    reject(db, 'fixed_assets_register', fixedAssetRow({ id: 'fa-x', initial_prorata_bps: 10001 }), CHECK_FAILED);
    reject(db, 'fixed_assets_register', fixedAssetRow({ id: 'fa-x', depreciation_rate_bps: 10001 }), CHECK_FAILED);
    reject(db, 'fixed_assets_register', fixedAssetRow({ id: 'fa-x', depreciation_rate_bps: 'abc' }), CHECK_FAILED);
    reject(db, 'fixed_assets_register', fixedAssetRow({ id: 'fa-x', vat_retention_months_required: 0 }), CHECK_FAILED);
    reject(db, 'fixed_assets_register', fixedAssetRow({ id: 'fa-x', asset_account_number: '61110000' }), CHECK_FAILED);
    reject(db, 'fixed_assets_register', fixedAssetRow({ id: 'fa-x', is_passenger_vehicle: 2 }), CHECK_FAILED);
    reject(db, 'fixed_assets_register', fixedAssetRow({ id: 'fa-x', acquisition_invoice_id: 'ghost' }), FK_FAILED);
    reject(db, 'fixed_assets_register', fixedAssetRow({ id: 'fa-x', label_enc: null }), NOT_NULL_FAILED);
  });
});

describe('triggers PAF (Doc_06 § 05) : chaque règle prouvée par l\'erreur levée', () => {
  it('UPDATE d\'une pièce POSTED refusé avec le message de Doc_06', () => {
    const db = openLedger();
    seedPostedSale(db);
    expect(messageOf(db, `UPDATE journal_entries SET entry_date = '2026-12-01' WHERE id = 'je-vte'`, [])).toBe(MSG_ENTRY_UPDATE);
    expect(messageOf(db, `UPDATE journal_entries SET status = 'DRAFT' WHERE id = 'je-vte'`, [])).toBe(MSG_ENTRY_UPDATE);
    expect(messageOf(db, `UPDATE journal_entries SET status = 'CONTRE_PASSEE' WHERE id = 'je-vte'`, [])).toBe(MSG_ENTRY_UPDATE);
    expect(all(db, `SELECT status, entry_date FROM journal_entries WHERE id = 'je-vte'`)).toEqual([{ status: 'POSTED', entry_date: '2026-11-13' }]);
  });

  it('DELETE d\'une pièce POSTED refusé ; un brouillon se supprime', () => {
    const db = openLedger();
    seedPostedSale(db);
    expect(messageOf(db, `DELETE FROM journal_entries WHERE id = 'je-vte'`, [])).toBe(MSG_ENTRY_DELETE);
    insertRow(db, 'journal_entries', entryRow({ id: 'je-d', sequence_number: 9, entry_reference: 'D-9', status: 'DRAFT' }));
    db.prepare(`DELETE FROM journal_entries WHERE id = 'je-d'`).run();
    expect(all(db, 'SELECT COUNT(*) AS n FROM journal_entries')).toEqual([{ n: 1 }]);
  });

  it('UPDATE et DELETE d\'une ligne d\'une pièce POSTED refusés avec leurs messages', () => {
    const db = openLedger();
    seedPostedSale(db);
    expect(messageOf(db, `UPDATE journal_entry_lines SET account_id = 'acc-6111' WHERE id = 'je-vte-l1'`, [])).toBe(MSG_LINE_UPDATE);
    expect(messageOf(db, `UPDATE journal_entry_lines SET debit_cents = 1 WHERE entry_id = 'je-vte'`, [])).toBe(MSG_LINE_UPDATE);
    expect(messageOf(db, `DELETE FROM journal_entry_lines WHERE id = 'je-vte-l1'`, [])).toBe(MSG_LINE_DELETE);
    expect(all(db, `SELECT COUNT(*) AS n FROM journal_entry_lines WHERE entry_id = 'je-vte'`)).toEqual([{ n: 3 }]);
  });

  it('les lignes d\'un brouillon restent modifiables et supprimables', () => {
    const db = openLedger();
    insertRows(db, simpleEntry('je-d', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 700));
    db.prepare(`UPDATE journal_entry_lines SET description_enc = 'v1:a:z' WHERE entry_id = 'je-d'`).run();
    db.prepare(`DELETE FROM journal_entry_lines WHERE id = 'je-d-l2'`).run();
    expect(all(db, `SELECT COUNT(*) AS n FROM journal_entry_lines WHERE entry_id = 'je-d'`)).toEqual([{ n: 1 }]);
  });

  it('passage à POSTED d\'une pièce déséquilibrée refusé (CGNC_UNBALANCED_LINES), débit comme crédit', () => {
    const db = openLedger();
    insertRows(db, entryWithLines('je-u', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 120000 }, { account: 'acc-7111', credit: 100000 }], { total_debit_cents: 120000, total_credit_cents: 120000 }));
    expect(messageOf(db, POST_ENTRY_SQL, postParams('je-u'))).toBe(MSG_UNBALANCED);
    insertRows(db, entryWithLines('je-v', 2, 'jrn-vte', [{ account: 'acc-3421', debit: 100000 }, { account: 'acc-7111', credit: 120000 }], { total_debit_cents: 120000, total_credit_cents: 120000 }));
    expect(messageOf(db, POST_ENTRY_SQL, postParams('je-v'))).toBe(MSG_UNBALANCED);
    insertRow(db, 'journal_entries', entryRow({ id: 'je-w', sequence_number: 3, entry_reference: 'W-3', status: 'DRAFT' }));
    expect(messageOf(db, POST_ENTRY_SQL, postParams('je-w'))).toBe(MSG_UNBALANCED);
    expect(all(db, `SELECT status FROM journal_entries WHERE id IN ('je-u', 'je-v', 'je-w') ORDER BY id`)).toEqual([{ status: 'DRAFT' }, { status: 'DRAFT' }, { status: 'DRAFT' }]);
  });

  it('passage à POSTED sans empreinte SHA-256 refusé (PAF_MISSING_HASH)', () => {
    const db = openLedger();
    insertRows(db, simpleEntry('je-h', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 5000));
    expect(messageOf(db, `UPDATE journal_entries SET status = 'POSTED' WHERE id = 'je-h'`, [])).toBe(MSG_MISSING_HASH);
    expect(messageOf(db, `UPDATE journal_entries SET status = 'POSTED', entry_hash = ? WHERE id = 'je-h'`, [SHA_B])).toBe(MSG_MISSING_HASH);
    expect(messageOf(db, `UPDATE journal_entries SET status = 'POSTED', previous_entry_hash = ? WHERE id = 'je-h'`, [GENESIS_HASH])).toBe(MSG_MISSING_HASH);
  });

  it('passage à POSTED qui rendrait la caisse 5161 négative refusé (CGNC_NEGATIVE_CASH_5161), sinon accepté', () => {
    const db = openLedger();
    // Encaissement de 1 000,00 en caisse.
    insertRows(db, simpleEntry('je-in', 1, 'jrn-cai', 'acc-5161', 'acc-3421', 100000));
    post(db, 'je-in');
    // Décaissement de 1 500,00 : caisse à -500,00, refusé.
    insertRows(db, simpleEntry('je-out-big', 2, 'jrn-cai', 'acc-6111', 'acc-5161', 150000));
    expect(messageOf(db, POST_ENTRY_SQL, postParams('je-out-big'))).toBe(MSG_NEGATIVE_CASH);
    expect(all(db, `SELECT status FROM journal_entries WHERE id = 'je-out-big'`)).toEqual([{ status: 'DRAFT' }]);
    // Décaissement de 1 000,00 : caisse à 0, accepté (positive ou nulle).
    insertRows(db, simpleEntry('je-out-ok', 3, 'jrn-cai', 'acc-6111', 'acc-5161', 100000));
    post(db, 'je-out-ok');
    // Plus rien en caisse : tout décaissement, même de 1 centime, est refusé.
    insertRows(db, simpleEntry('je-out-1', 4, 'jrn-cai', 'acc-6111', 'acc-5161', 1));
    expect(messageOf(db, POST_ENTRY_SQL, postParams('je-out-1'))).toBe(MSG_NEGATIVE_CASH);
  });

  it('une caisse jamais alimentée refuse aussi le premier décaissement ; un encaissement seul est accepté', () => {
    const db = openLedger();
    insertRows(db, simpleEntry('je-first', 1, 'jrn-cai', 'acc-6111', 'acc-5161', 5000));
    expect(messageOf(db, POST_ENTRY_SQL, postParams('je-first'))).toBe(MSG_NEGATIVE_CASH);
    insertRows(db, simpleEntry('je-enc', 2, 'jrn-cai', 'acc-5161', 'acc-7111', 5000));
    post(db, 'je-enc');
    expect(all(db, `SELECT status FROM journal_entries WHERE id = 'je-enc'`)).toEqual([{ status: 'POSTED' }]);
  });

  it('INSERT direct au statut POSTED refusé (ERRATA D-03) ; les autres statuts passent', () => {
    const db = openLedger();
    const { sql, params } = insertSqlite('journal_entries', entryRow({ status: 'POSTED', entry_hash: SHA_B, previous_entry_hash: GENESIS_HASH }));
    expect(messageOf(db, sql, params)).toBe(MSG_DIRECT_POSTED);
    expect(all(db, 'SELECT COUNT(*) AS n FROM journal_entries')).toEqual([{ n: 0 }]);
    insertRow(db, 'journal_entries', entryRow({ status: 'DRAFT' }));
  });

  it('flux légitime : insertion en DRAFT, lignes, puis UPDATE contrôlé vers POSTED accepté (le trigger d\'UPDATE ne vise que OLD.status = POSTED)', () => {
    const db = openLedger();
    insertRows(db, simpleEntry('je-ok', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 120000));
    db.prepare(`UPDATE journal_entries SET status = 'REVISEE_CYCLE' WHERE id = 'je-ok'`).run();
    post(db, 'je-ok');
    expect(all(db, `SELECT status, validated_at, entry_hash, previous_entry_hash FROM journal_entries WHERE id = 'je-ok'`)).toEqual([
      { status: 'POSTED', validated_at: NOW, entry_hash: SHA_B, previous_entry_hash: GENESIS_HASH },
    ]);
  });

  it('contre-passation : nouvelle écriture REVERSAL liée par reversal_of_entry_id, acceptée ; l\'original reste POSTED et intact', () => {
    const db = openLedger();
    insertRows(db, simpleEntry('je-in', 1, 'jrn-cai', 'acc-5161', 'acc-3421', 100000));
    post(db, 'je-in');
    insertRows(
      db,
      entryWithLines('je-rev', 2, 'jrn-cai', [{ account: 'acc-3421', debit: 100000 }, { account: 'acc-5161', credit: 100000 }], {
        source_document_type: 'REVERSAL',
        reversal_of_entry_id: 'je-in',
      }),
    );
    post(db, 'je-rev');
    expect(all(db, `SELECT id, status, reversal_of_entry_id FROM journal_entries ORDER BY id`)).toEqual([
      { id: 'je-in', status: 'POSTED', reversal_of_entry_id: null },
      { id: 'je-rev', status: 'POSTED', reversal_of_entry_id: 'je-in' },
    ]);
    const balance = all(db, `SELECT account_number, net_balance_cents AS n FROM v_cgnc_trial_balance_6col ORDER BY account_number`);
    expect(balance).toEqual([
      { account_number: '34211000', n: 0 },
      { account_number: '51610000', n: 0 },
    ]);
  });

  it('exercice CLOSED, migrations v1 à v3 : Doc_06 § 05 ne le fixe par aucun trigger ni CHECK sur les pièces ; seul le CHECK de statut de fiscal_years existe (la v4 y ajoute ses triggers)', () => {
    const db = openTenant(3);
    insertRows(db, LEDGER_SEED);
    const triggerSql = all(db, `SELECT sql FROM sqlite_master WHERE type = 'trigger'`).map((row) => String(row['sql'])).join('\n');
    expect(triggerSql).not.toMatch(/fiscal_years/);
    db.prepare(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`).run();
    expectSqlError(db, `UPDATE fiscal_years SET status = 'ARCHIVED' WHERE id = 'fy-2026'`, [], CHECK_FAILED);
  });
});

describe('vue v_cgnc_trial_balance_6col (balance générale à 6 colonnes SIMPL-IS)', () => {
  function seedBalance(db: DatabaseSync): void {
    // À-nouveaux : caisse 1 000,00 contre capital.
    insertRows(db, simpleEntry('je-an', 1, 'jrn-an', 'acc-5161', 'acc-1111', 100000, { source_document_type: 'CUTOFF_OD' }));
    post(db, 'je-an');
    // Vente 1 200,00 TTC : client / ventes 1 000,00 / TVA 200,00.
    seedPostedSale(db);
    // Encaissement de la vente en caisse.
    insertRows(db, simpleEntry('je-enc', 2, 'jrn-cai', 'acc-5161', 'acc-3421', 120000, { source_document_type: 'PAYMENT' }));
    post(db, 'je-enc');
    // Achat payé comptant 300,00.
    insertRows(db, simpleEntry('je-ach', 3, 'jrn-cai', 'acc-6111', 'acc-5161', 30000, { source_document_type: 'PAYMENT' }));
    post(db, 'je-ach');
    // Brouillon et pièce en revue : exclus de la balance.
    insertRows(db, simpleEntry('je-draft', 4, 'jrn-cai', 'acc-6111', 'acc-5161', 99900));
    insertRows(db, simpleEntry('je-rev', 5, 'jrn-cai', 'acc-6111', 'acc-5161', 88800, { status: 'REVISEE_CYCLE' }));
  }

  it('expose exactement les 9 colonnes de Doc_06, dans l\'ordre', () => {
    const db = openLedger();
    expect(all(db, `SELECT name FROM pragma_table_info('v_cgnc_trial_balance_6col') ORDER BY cid`).map((row) => String(row['name']))).toEqual([
      'fiscal_year_id',
      'account_number',
      'cgnc_class',
      'opening_debit_cents',
      'opening_credit_cents',
      'mvt_debit_cents',
      'mvt_credit_cents',
      'total_debit_cents',
      'total_credit_cents',
      'net_balance_cents',
    ]);
  });

  it('est vide tant qu\'aucune pièce n\'est POSTED (brouillons exclus)', () => {
    const db = openLedger();
    insertRows(db, simpleEntry('je-d', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 5000));
    expect(all(db, 'SELECT * FROM v_cgnc_trial_balance_6col')).toEqual([]);
  });

  it('rend les montants attendus compte par compte, ouverture (journal AN) séparée des mouvements', () => {
    const db = openLedger();
    seedBalance(db);
    expect(all(db, 'SELECT * FROM v_cgnc_trial_balance_6col ORDER BY account_number')).toEqual([
      { fiscal_year_id: 'fy-2026', account_number: '11110000', cgnc_class: 1, opening_debit_cents: 0, opening_credit_cents: 100000, mvt_debit_cents: 0, mvt_credit_cents: 0, total_debit_cents: 0, total_credit_cents: 100000, net_balance_cents: -100000 },
      { fiscal_year_id: 'fy-2026', account_number: '34211000', cgnc_class: 3, opening_debit_cents: 0, opening_credit_cents: 0, mvt_debit_cents: 120000, mvt_credit_cents: 120000, total_debit_cents: 120000, total_credit_cents: 120000, net_balance_cents: 0 },
      { fiscal_year_id: 'fy-2026', account_number: '44551000', cgnc_class: 4, opening_debit_cents: 0, opening_credit_cents: 0, mvt_debit_cents: 0, mvt_credit_cents: 20000, total_debit_cents: 0, total_credit_cents: 20000, net_balance_cents: -20000 },
      { fiscal_year_id: 'fy-2026', account_number: '51610000', cgnc_class: 5, opening_debit_cents: 100000, opening_credit_cents: 0, mvt_debit_cents: 120000, mvt_credit_cents: 30000, total_debit_cents: 220000, total_credit_cents: 30000, net_balance_cents: 190000 },
      { fiscal_year_id: 'fy-2026', account_number: '61110000', cgnc_class: 6, opening_debit_cents: 0, opening_credit_cents: 0, mvt_debit_cents: 30000, mvt_credit_cents: 0, total_debit_cents: 30000, total_credit_cents: 0, net_balance_cents: 30000 },
      { fiscal_year_id: 'fy-2026', account_number: '71111000', cgnc_class: 7, opening_debit_cents: 0, opening_credit_cents: 0, mvt_debit_cents: 0, mvt_credit_cents: 100000, total_debit_cents: 0, total_credit_cents: 100000, net_balance_cents: -100000 },
    ]);
  });

  it('la balance à 6 colonnes est équilibrée : débits = crédits à l\'ouverture, en mouvements, en totaux ; soldes nets de somme nulle', () => {
    const db = openLedger();
    seedBalance(db);
    expect(
      all(
        db,
        `SELECT SUM(opening_debit_cents) AS od, SUM(opening_credit_cents) AS oc, SUM(mvt_debit_cents) AS md, SUM(mvt_credit_cents) AS mc,
                SUM(total_debit_cents) AS td, SUM(total_credit_cents) AS tc, SUM(net_balance_cents) AS net FROM v_cgnc_trial_balance_6col`,
      ),
    ).toEqual([{ od: 100000, oc: 100000, md: 270000, mc: 270000, td: 370000, tc: 370000, net: 0 }]);
  });

  it('une pièce d\'un autre exercice ne se mélange pas : une ligne de balance par (exercice, compte)', () => {
    const db = openLedger();
    insertRow(db, 'fiscal_years', fiscalYearRow({ id: 'fy-2027', code: 'EX-2027', start_date: '2027-01-01', end_date: '2027-12-31' }));
    seedPostedSale(db);
    insertRows(db, simpleEntry('je-27', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 5000, { fiscal_year_id: 'fy-2027', entry_reference: 'VTE-2027-1' }));
    post(db, 'je-27');
    const rows = all(db, `SELECT fiscal_year_id, account_number, total_debit_cents FROM v_cgnc_trial_balance_6col WHERE account_number = '34211000' ORDER BY fiscal_year_id`);
    expect(rows).toEqual([
      { fiscal_year_id: 'fy-2026', account_number: '34211000', total_debit_cents: 120000 },
      { fiscal_year_id: 'fy-2027', account_number: '34211000', total_debit_cents: 5000 },
    ]);
  });
});
