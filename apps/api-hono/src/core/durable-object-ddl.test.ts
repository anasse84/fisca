import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@fisca/shared-types';
import {
  AGENT_HINDSIGHT_SCHEMA,
  INITIAL_PIH_SHA256,
  INVOICE_SEQUENCER_SCHEMA,
} from './durable-object-ddl.ts';
import {
  applyDurableObjectSchema,
  DO_SCHEMA_TRACKING_TABLE,
  DoSchemaError,
  schemaVersionSha256,
  type DurableObjectSchemaVersion,
} from './durable-object-sql.ts';
import { createFakeDoDatabase, createFakeDoState } from './fake-do-storage.ts';

function columnsOf(table: string, state: ReturnType<typeof createFakeDoState>): string[] {
  return state.storage.sql
    .exec<{ name: string }>('SELECT name FROM pragma_table_info(?) ORDER BY cid', table)
    .toArray()
    .map((row) => row.name);
}

describe('DDL versionné des Durable Objects (Doc_06 § 07)', () => {
  it('chaque version porte une empreinte SHA-256 épinglée qui correspond à ses instructions', async () => {
    for (const version of [...INVOICE_SEQUENCER_SCHEMA, ...AGENT_HINDSIGHT_SCHEMA]) {
      expect(version.expectedSha256Hex).toMatch(/^[0-9a-f]{64}$/);
      expect(await schemaVersionSha256(version.statements)).toBe(version.expectedSha256Hex);
    }
  });

  it("l'empreinte initiale du PIH est le SHA-256 de la chaîne vide et la valeur par défaut de la colonne", async () => {
    expect(INITIAL_PIH_SHA256).toBe(await sha256Hex(new Uint8Array()));
    const state = createFakeDoState(createFakeDoDatabase(), 'company_x');
    await applyDurableObjectSchema(state.storage, INVOICE_SEQUENCER_SCHEMA);
    state.storage.sql.exec("INSERT INTO fiscal_sequences (series_key, updated_at) VALUES ('FAC-2026', '2026-01-01T00:00:00Z')");
    const row = state.storage.sql.exec<{ last_cleared_pi_hash: string; last_cleared_number: number; submission_attempt_counter: number }>(
      'SELECT last_cleared_pi_hash, last_cleared_number, submission_attempt_counter FROM fiscal_sequences',
    ).one();
    expect(row).toEqual({ last_cleared_pi_hash: INITIAL_PIH_SHA256, last_cleared_number: 0, submission_attempt_counter: 0 });
  });

  it('applique le DDL du séquenceur sur ctx.storage.sql : colonnes de Doc_06 § 07 dans l’ordre', async () => {
    const state = createFakeDoState(createFakeDoDatabase(), 'company_x');
    await applyDurableObjectSchema(state.storage, INVOICE_SEQUENCER_SCHEMA);
    expect(columnsOf('fiscal_sequences', state)).toEqual([
      'series_key',
      'submission_attempt_counter',
      'last_cleared_number',
      'last_cleared_pi_hash',
      'updated_at',
    ]);
    expect(columnsOf('fiscal_sequence_journal', state)).toEqual([
      'series_key',
      'sequence_number',
      'idempotency_key',
      'previous_hash',
      'invoice_sha256',
      'allocated_at',
    ]);
  });

  it('applique le DDL de la mémoire Hindsight : trois tables de Doc_06 § 07 avec leurs colonnes et le CHECK de confiance', async () => {
    const state = createFakeDoState(createFakeDoDatabase(), 'company_x');
    await applyDurableObjectSchema(state.storage, AGENT_HINDSIGHT_SCHEMA);
    expect(columnsOf('world_facts', state)).toEqual(['fact_key', 'fact_json', 'updated_at']);
    expect(columnsOf('experiences', state)).toEqual([
      'id',
      'supplier_ice_bidx',
      'raw_label_hash',
      'proposed_pcge_account',
      'human_final_pcge_account',
      'was_accepted_as_is',
      'created_at',
    ]);
    expect(columnsOf('evolving_opinions', state)).toEqual([
      'pattern_key',
      'preferred_pcge_account',
      'confidence_bps',
      'occurrences_count',
      'updated_at',
    ]);
    const insert = (confidence: number): void => {
      state.storage.sql.exec(
        "INSERT INTO evolving_opinions (pattern_key, preferred_pcge_account, confidence_bps, updated_at) VALUES ('p', '6142', ?, '2026-01-01T00:00:00Z')",
        confidence,
      );
    };
    expect(() => insert(10001)).toThrow();
    expect(() => insert(10000)).not.toThrow();
  });

  it('est idempotent : réappliquer (redémarrage) ne rejoue rien et laisse une ligne de suivi par version', async () => {
    const state = createFakeDoState(createFakeDoDatabase(), 'company_x');
    await applyDurableObjectSchema(state.storage, INVOICE_SEQUENCER_SCHEMA);
    await applyDurableObjectSchema(state.storage, INVOICE_SEQUENCER_SCHEMA);
    const rows = state.storage.sql
      .exec<{ version: number; name: string; sha256: string }>(`SELECT version, name, sha256 FROM ${DO_SCHEMA_TRACKING_TABLE}`)
      .toArray();
    expect(rows).toEqual([{ version: 1, name: 'invoice_sequencer_v1', sha256: INVOICE_SEQUENCER_SCHEMA[0]?.expectedSha256Hex }]);
  });

  it("refuse un DDL dont l'empreinte épinglée ne correspond plus (code modifié sans nouvelle version)", async () => {
    const state = createFakeDoState(createFakeDoDatabase(), 'company_x');
    const altered: readonly DurableObjectSchemaVersion[] = INVOICE_SEQUENCER_SCHEMA.map((version) => ({
      ...version,
      statements: [...version.statements, 'CREATE TABLE clandestine (x TEXT)'],
    }));
    await expect(applyDurableObjectSchema(state.storage, altered)).rejects.toMatchObject({ code: 'DO_SCHEMA_DDL_ALTERED' });
    expect(state.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = 'clandestine'").toArray()).toEqual([]);
  });

  it("refuse un stockage dont la version appliquée porte une autre empreinte", async () => {
    const state = createFakeDoState(createFakeDoDatabase(), 'company_x');
    await applyDurableObjectSchema(state.storage, AGENT_HINDSIGHT_SCHEMA);
    state.storage.sql.exec(`UPDATE ${DO_SCHEMA_TRACKING_TABLE} SET sha256 = ?`, 'd'.repeat(64));
    const error = await applyDurableObjectSchema(state.storage, AGENT_HINDSIGHT_SCHEMA).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DoSchemaError);
    expect(error).toMatchObject({ code: 'DO_SCHEMA_STORAGE_ALTERED' });
  });
});
