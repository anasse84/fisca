/**
 * DDL versionné des Durable Objects SQLite (Doc_06 § 07), avec empreinte SHA-256 épinglée par version.
 *
 * Une version appliquée ne se modifie jamais : toute évolution est une nouvelle version (même règle que les migrations D1).
 * L'empreinte est celle de `schemaVersionSha256` (SHA-256 des instructions jointes par « \n »). Le test
 * `durable-object-ddl.test.ts` la recalcule : modifier une instruction sans nouvelle version fait échouer le test, et
 * `applyDurableObjectSchema` refuse de démarrer.
 *
 * INVOICE_SEQUENCER_V1 : `fiscal_sequences` reprend Doc_06 § 07 mot pour mot. Deux ajouts internes au DO, absents de Doc_06 § 07
 * et à inscrire au registre (même démarche que D-19) :
 * - `fiscal_sequence_journal` : journal append-only des numéros attribués (clé d'idempotence, PIH, empreinte de la facture) ;
 *   il est indispensable à l'idempotence, à la vérification de chaîne et à la reprise après crash ;
 * - des déclencheurs qui rendent la numérotation irréversible : journal sans UPDATE ni DELETE, `fiscal_sequences` sans DELETE,
 *   numéro qui ne recule jamais, n'avance que de 1, et PIH figé tant que le numéro ne change pas.
 *
 * AGENT_HINDSIGHT_V1 : les trois tables de Doc_06 § 07 mot pour mot, plus un index de recherche par fournisseur.
 */
import type { DurableObjectSchemaVersion } from './durable-object-sql.ts';

/** SHA-256 de la chaîne vide : empreinte initiale du PIH (valeur par défaut de `last_cleared_pi_hash`, Doc_06 § 07). */
export const INITIAL_PIH_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export const SEQUENCE_VIOLATION_MARKER = 'VIOLATION_SEQUENCE_ART_145_CGI';

export const INVOICE_SEQUENCER_SCHEMA: readonly DurableObjectSchemaVersion[] = [
  {
    version: 1,
    name: 'invoice_sequencer_v1',
    statements: [
      `CREATE TABLE fiscal_sequences (
    series_key TEXT PRIMARY KEY,
    submission_attempt_counter INTEGER NOT NULL DEFAULT 0,
    last_cleared_number INTEGER NOT NULL DEFAULT 0,
    last_cleared_pi_hash TEXT NOT NULL DEFAULT '${INITIAL_PIH_SHA256}',
    updated_at TEXT NOT NULL
)`,
      `CREATE TABLE fiscal_sequence_journal (
    series_key TEXT NOT NULL,
    sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
    idempotency_key TEXT NOT NULL UNIQUE,
    previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 64),
    invoice_sha256 TEXT NOT NULL CHECK (length(invoice_sha256) = 64),
    allocated_at TEXT NOT NULL,
    PRIMARY KEY (series_key, sequence_number)
)`,
      `CREATE TRIGGER fiscal_sequence_journal_no_update BEFORE UPDATE ON fiscal_sequence_journal
BEGIN SELECT RAISE(ABORT, '${SEQUENCE_VIOLATION_MARKER}: journal immuable (UPDATE interdit)'); END`,
      `CREATE TRIGGER fiscal_sequence_journal_no_delete BEFORE DELETE ON fiscal_sequence_journal
BEGIN SELECT RAISE(ABORT, '${SEQUENCE_VIOLATION_MARKER}: journal immuable (DELETE interdit)'); END`,
      `CREATE TRIGGER fiscal_sequences_no_delete BEFORE DELETE ON fiscal_sequences
BEGIN SELECT RAISE(ABORT, '${SEQUENCE_VIOLATION_MARKER}: une série ne se supprime jamais'); END`,
      `CREATE TRIGGER fiscal_sequences_irreversible BEFORE UPDATE ON fiscal_sequences
WHEN NEW.series_key <> OLD.series_key
  OR NEW.last_cleared_number < OLD.last_cleared_number
  OR NEW.last_cleared_number > OLD.last_cleared_number + 1
  OR (NEW.last_cleared_number = OLD.last_cleared_number AND NEW.last_cleared_pi_hash <> OLD.last_cleared_pi_hash)
  OR NEW.submission_attempt_counter < OLD.submission_attempt_counter
BEGIN SELECT RAISE(ABORT, '${SEQUENCE_VIOLATION_MARKER}: numérotation irréversible, sans trou, avec chaînage PIH'); END`,
    ],
    expectedSha256Hex: 'edcc64af328c1f0179c4fc5454e1c2db906bd33a77309ab7a9d7342c25e6f86a',
  },
];

export const AGENT_HINDSIGHT_SCHEMA: readonly DurableObjectSchemaVersion[] = [
  {
    version: 1,
    name: 'agent_hindsight_v1',
    statements: [
      `CREATE TABLE world_facts (
    fact_key TEXT PRIMARY KEY,
    fact_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
)`,
      `CREATE TABLE experiences (
    id TEXT PRIMARY KEY,
    supplier_ice_bidx TEXT,
    raw_label_hash TEXT NOT NULL,
    proposed_pcge_account TEXT NOT NULL,
    human_final_pcge_account TEXT,
    was_accepted_as_is INTEGER NOT NULL,
    created_at TEXT NOT NULL
)`,
      `CREATE TABLE evolving_opinions (
    pattern_key TEXT PRIMARY KEY,
    preferred_pcge_account TEXT NOT NULL,
    confidence_bps INTEGER NOT NULL CHECK (confidence_bps BETWEEN 0 AND 10000),
    occurrences_count INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
)`,
      `CREATE INDEX idx_experiences_supplier ON experiences (supplier_ice_bidx, created_at)`,
    ],
    expectedSha256Hex: '1cb69c21108adddfb9049054d002b5879ee23bbfaceb7601a7e8004b5ede7ad1',
  },
];
