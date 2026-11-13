import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import vectors from './ledger-hasher.vectors.json';
import {
  FISCA_GL_CLOSE_V1,
  FISCA_GL_ENTRY_V1,
  LEDGER_GENESIS_HASH,
  buildClosingHashTuple,
  buildEntryHashTuple,
  canonicalJsonTuple,
  defaultSha256LedgerHasher,
} from './ledger-hasher.ts';
import {
  ImmutableCgncLedgerEngine,
  type ClosingHashInput,
  type CreateDraftInput,
  type EntryHashInput,
  type EntryHashLine,
  type LedgerActor,
} from './immutable-cgnc-ledger-engine.ts';
import {
  COMPANY_ID,
  FY_2026,
  PostgresHarness,
  SequentialUuidV7,
  StepClock,
  StubPreCloseControls,
  actorOf,
  openSqliteBackend,
  seedLedger,
  testCipher,
  type LedgerBackend,
} from './ledger-test-harness.ts';

const HEX64 = /^[0-9a-f]{64}$/;
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

function line(overrides: Partial<EntryHashLine> & { lineNumber: number }): EntryHashLine {
  return {
    lineId: `l-${overrides.lineNumber}`,
    accountNumber: '34210000',
    auxiliaryAccount: null,
    debitCents: 0,
    creditCents: 0,
    descriptionEnc: 'v1:enc:A',
    isTaxDeductible: true,
    table3ReintegrationCode: null,
    ...overrides,
  };
}

function entryInput(overrides: Partial<EntryHashInput> = {}): EntryHashInput {
  return {
    companyId: 'soc-1',
    journalId: 'jr-vte',
    journalCode: 'VTE',
    fiscalYearId: 'FY-2026',
    entryId: 'e-1',
    sequenceNumber: 1,
    entryReference: 'VTE-2026-000001',
    entryDate: '2026-11-13',
    sourceDocumentType: 'INVOICE',
    reversalOfEntryId: null,
    invoiceId: 'INV-01',
    partnerId: null,
    dgiClearanceUuid: 'XHUB-UUID-01',
    totalDebitCents: 120000,
    totalCreditCents: 120000,
    validatedAt: '2026-11-13T16:00:00.000Z',
    previousEntryHash: LEDGER_GENESIS_HASH,
    chainPosition: 1,
    lines: [
      line({ lineNumber: 1, auxiliaryAccount: 'CLI0001', debitCents: 120000 }),
      line({ lineNumber: 2, accountNumber: '71110000', creditCents: 100000 }),
      line({ lineNumber: 3, accountNumber: '44558000', creditCents: 20000 }),
    ],
    ...overrides,
  };
}

function closingInput(overrides: Partial<ClosingHashInput> = {}): ClosingHashInput {
  const head = (journalCode: string, chainLength: number, lastEntryHash: string) => ({ journalId: `jr-${journalCode}`, journalCode, lastEntryHash, chainLength });
  return {
    companyId: 'soc-1',
    fiscalYearId: 'FY-2026',
    fiscalYearCode: 'EX-2026',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    postedEntryCount: 1,
    closedAtIso: '2027-03-15T18:00:00.000Z',
    grandTotalDebitCents: 120000,
    grandTotalCreditCents: 120000,
    journalHeads: [
      head('VTE', 1, vectors.entry_hash_V1.sha256),
      head('OD', 0, LEDGER_GENESIS_HASH),
      head('CAI', 0, LEDGER_GENESIS_HASH),
      head('BNQ', 0, LEDGER_GENESIS_HASH),
      head('AN', 0, LEDGER_GENESIS_HASH),
      head('ACH', 0, LEDGER_GENESIS_HASH),
    ],
    ...overrides,
  };
}

describe('constantes', () => {
  it('genèse unique de 45 caractères (Doc_06) et tags de version', () => {
    expect(LEDGER_GENESIS_HASH).toBe('GENESIS_HASH_00000000000000000000000000000000');
    expect(LEDGER_GENESIS_HASH).toHaveLength(45);
    expect(FISCA_GL_ENTRY_V1).toBe('FISCA_GL_ENTRY_V1');
    expect(FISCA_GL_CLOSE_V1).toBe('FISCA_GL_CLOSE_V1');
  });
});

describe('vecteurs d\'or du propriétaire', () => {
  it('entry_hash : tuple exact, sérialisation sans espace, SHA-256 attendu', async () => {
    const v = vectors.entry_hash_V1;
    expect(v.etat).toBe('RECOUPÉ');
    expect(canonicalJsonTuple(v.tuple)).toBe(JSON.stringify(v.tuple));
    expect(canonicalJsonTuple(v.tuple)).not.toContain(' ');
    expect(sha(canonicalJsonTuple(v.tuple))).toBe(v.sha256);
    expect(buildEntryHashTuple(entryInput())).toEqual(v.tuple);
    expect(await defaultSha256LedgerHasher.computeEntryHash(entryInput())).toBe(v.sha256);
  });

  it('closing_hash : journaux triés ASCII, SHA-256 attendu', async () => {
    const v = vectors.closing_hash_V1;
    expect(buildClosingHashTuple(closingInput())).toEqual(v.tuple);
    expect(sha(canonicalJsonTuple(v.tuple))).toBe(v.sha256);
    expect(await defaultSha256LedgerHasher.computeClosingHash(closingInput())).toBe(v.sha256);
  });

  it('PIH facture, ticket POS et clôture Z (documentation P2-A) : la sérialisation unique reproduit les trois empreintes', () => {
    const p2a = vectors.pour_P2A_non_implemente;
    for (const v of [p2a.pih_facture, p2a.ticket_pos, p2a.cloture_z_pos]) {
      expect(v.etat).toBe('RECOUPÉ');
      expect(sha(canonicalJsonTuple(v.tuple))).toBe(v.sha256);
    }
  });
});

describe('sérialisation canonique', () => {
  it('undefined et null donnent la même empreinte ; -0 et 0 aussi', () => {
    expect(canonicalJsonTuple(['A', undefined, 1])).toBe(canonicalJsonTuple(['A', null, 1]));
    expect(canonicalJsonTuple(['A', -0])).toBe(canonicalJsonTuple(['A', 0]));
    expect(canonicalJsonTuple([-0])).toBe('[0]');
    expect(canonicalJsonTuple([[undefined]])).toBe('[[null]]');
  });

  it('refuse les nombres non entiers sûrs', () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, -(2 ** 53)]) {
      expect(() => canonicalJsonTuple(['A', bad])).toThrow(/entier sûr/);
    }
    expect(canonicalJsonTuple([Number.MAX_SAFE_INTEGER])).toBe(`[${Number.MAX_SAFE_INTEGER}]`);
    expect(() => canonicalJsonTuple([[1, [2.5]]])).toThrow(/entier sûr/);
  });

  it('les délimiteurs | et \\n d\'un libellé ou d\'une référence ne produisent pas de collision', async () => {
    const a = await defaultSha256LedgerHasher.computeEntryHash(entryInput({ entryReference: 'A|B', sourceDocumentType: 'C' }));
    const b = await defaultSha256LedgerHasher.computeEntryHash(entryInput({ entryReference: 'A', sourceDocumentType: 'B|C' }));
    const c = await defaultSha256LedgerHasher.computeEntryHash(entryInput({ entryReference: 'A\nB', sourceDocumentType: 'C' }));
    const d = await defaultSha256LedgerHasher.computeEntryHash(entryInput({ entryReference: 'A', sourceDocumentType: 'B\nC' }));
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect(canonicalJsonTuple(['x|y', 'a\nb'])).toBe('["x|y","a\\nb"]');
  });
});

describe('empreinte d\'une pièce', () => {
  const hash = (input: EntryHashInput) => defaultSha256LedgerHasher.computeEntryHash(input);

  it('sortie toujours en 64 hexadécimaux minuscules', async () => {
    for (const input of [entryInput(), entryInput({ entryReference: 'É\u0000|\n"', lines: [] }), entryInput({ invoiceId: null, dgiClearanceUuid: null })]) {
      expect(await hash(input)).toMatch(HEX64);
    }
    expect(await defaultSha256LedgerHasher.computeClosingHash(closingInput())).toMatch(HEX64);
  });

  it('un seul centime change l\'empreinte', async () => {
    const base = await hash(entryInput());
    const moved = entryInput({ lines: [line({ lineNumber: 1, auxiliaryAccount: 'CLI0001', debitCents: 120001 }), ...entryInput().lines.slice(1)] });
    expect(await hash(moved)).not.toBe(base);
    expect(await hash(entryInput({ totalDebitCents: 120001 }))).not.toBe(base);
    expect(await hash(entryInput({ totalCreditCents: 119999 }))).not.toBe(base);
  });

  it('l\'ordre des lignes en entrée ne compte pas (triées par lineNumber)', async () => {
    const lines = entryInput().lines;
    const reversed = [...lines].reverse();
    expect(await hash(entryInput({ lines: reversed }))).toBe(await hash(entryInput()));
    expect(buildEntryHashTuple(entryInput({ lines: reversed }))).toEqual(vectors.entry_hash_V1.tuple);
  });

  it('le chaînage previous_entry_hash change l\'empreinte', async () => {
    expect(await hash(entryInput({ previousEntryHash: vectors.entry_hash_V1.sha256 }))).not.toBe(await hash(entryInput()));
  });

  it('les champs chiffrés _enc ne figurent pas dans le tuple', async () => {
    const changed = entryInput({ lines: entryInput().lines.map((l) => ({ ...l, descriptionEnc: 'v1:enc:AUTRE-NONCE' })) });
    expect(await hash(changed)).toBe(await hash(entryInput()));
    expect(canonicalJsonTuple(buildEntryHashTuple(changed))).not.toContain('enc');
  });

  it('refuse un entier non sûr dans une pièce', async () => {
    await expect(hash(entryInput({ totalDebitCents: 2 ** 53 }))).rejects.toThrow(/entier sûr/);
    await expect(hash(entryInput({ lines: [line({ lineNumber: 1, debitCents: Number.NaN })] }))).rejects.toThrow(/entier sûr/);
  });

  it('les champs optionnels absents valent null ; isTaxDeductible est un booléen', () => {
    const tuple = buildEntryHashTuple(entryInput({ invoiceId: null, dgiClearanceUuid: null, lines: [line({ lineNumber: 1, isTaxDeductible: false, table3ReintegrationCode: 'T3-01' })] }));
    expect(tuple[8]).toBeNull();
    expect(tuple[9]).toBeNull();
    expect(tuple[10]).toBeNull();
    expect(tuple[14]).toEqual([[1, '34210000', null, 0, 0, false, 'T3-01']]);
  });
});

describe('empreinte de clôture', () => {
  it('journaux triés par code ASCII, quel que soit l\'ordre reçu ; un centime de total change l\'empreinte', async () => {
    const forward = closingInput();
    const shuffled = closingInput({ journalHeads: [...forward.journalHeads].reverse() });
    expect(await defaultSha256LedgerHasher.computeClosingHash(shuffled)).toBe(vectors.closing_hash_V1.sha256);
    expect(await defaultSha256LedgerHasher.computeClosingHash(closingInput({ grandTotalDebitCents: 120001 }))).not.toBe(vectors.closing_hash_V1.sha256);
    const withAux = buildClosingHashTuple(closingInput({ journalHeads: [...forward.journalHeads, { journalId: 'x', journalCode: 'a-aux', lastEntryHash: LEDGER_GENESIS_HASH, chainLength: 0 }] }));
    const codes = (withAux[8] as readonly (readonly unknown[])[]).map((j) => j[0]);
    expect(codes).toEqual(['ACH', 'AN', 'BNQ', 'CAI', 'OD', 'VTE', 'a-aux']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Bout en bout : le moteur scelle sans hasher injecté (SQLite et PostgreSQL 16).
// ---------------------------------------------------------------------------------------------------------------------

const postgres = new PostgresHarness();
afterAll(async () => {
  await postgres.close();
});

interface EntryRow {
  readonly id: string;
  readonly fiscal_year_id: string;
  readonly sequence_number: number;
  readonly entry_reference: string;
  readonly entry_date: string;
  readonly validated_at: string;
  readonly source_document_type: string;
  readonly invoice_id: string | null;
  readonly dgi_clearance_uuid: string | null;
  readonly reversal_of_entry_id: string | null;
  readonly total_debit_cents: number;
  readonly total_credit_cents: number;
  readonly previous_entry_hash: string;
  readonly entry_hash: string;
}

async function endToEnd(backend: LedgerBackend): Promise<void> {
  await seedLedger(backend.driver);
  const clock = new StepClock();
  const engine = new ImmutableCgncLedgerEngine({
    db: backend.driver,
    companyId: COMPANY_ID,
    clock,
    ids: new SequentialUuidV7(),
    cipher: testCipher,
    preCloseControls: new StubPreCloseControls(),
  });
  const aide = actorOf('AIDE_COMPTABLE', 'u-aide', {}, clock);
  const chef = actorOf('CHEF_MISSION', 'u-chef', {}, clock);
  const oec = actorOf('EXPERT_COMPTABLE_OEC', 'u-oec', {}, clock);
  const fresh = (actor: LedgerActor): LedgerActor => ({ ...actor, mfaVerifiedAtEpochSec: clock.currentEpochSec() });
  const rows = async <T>(sql: string, params: readonly (string | number | null)[] = []) => backend.driver.query<T>({ sql, params });
  const key = (() => {
    let n = 0;
    return () => `h-${(n += 1)}`;
  })();

  const seal = async (input: CreateDraftInput): Promise<string> => {
    const created = await engine.createDraft(aide, input);
    await engine.visaCycle(chef, { entryId: created.entryId, idempotencyKey: key() });
    await engine.sealEntry(fresh(oec), { entryId: created.entryId, idempotencyKey: key() });
    return created.entryId;
  };
  const line = (accountNumber: string, debitCents: number, creditCents: number) => ({ accountNumber, debitCents, creditCents, description: `ligne ${accountNumber}` });

  const first = await seal({
    journalId: 'jr-vte',
    fiscalYearId: FY_2026.id,
    entryDate: '2026-11-13',
    reviewCycle: 'TRESORERIE',
    sourceDocumentType: 'INVOICE',
    initialState: 'DRAFT',
    lines: [line('34210000', 120000, 0), line('71110000', 0, 100000), line('44558000', 0, 20000)],
  });
  const second = await seal({
    journalId: 'jr-vte',
    fiscalYearId: FY_2026.id,
    entryDate: '2026-11-14',
    reviewCycle: 'TRESORERIE',
    sourceDocumentType: 'INVOICE',
    initialState: 'DRAFT',
    lines: [line('34210000', 5000, 0), line('71110000', 0, 5000)],
  });
  expect(await engine.verifyJournalChain('jr-vte')).toEqual({ valid: true, length: 2 });

  const expectedEntryHash = async (entryId: string): Promise<{ stored: string; recomputed: string; previous: string }> => {
    const [e] = await rows<EntryRow>(
      `SELECT id, fiscal_year_id, sequence_number, entry_reference, entry_date, validated_at, source_document_type, invoice_id, dgi_clearance_uuid,
              reversal_of_entry_id, total_debit_cents, total_credit_cents, previous_entry_hash, entry_hash FROM journal_entries WHERE id = ?`,
      [entryId],
    );
    if (e === undefined) throw new Error('pièce absente');
    const lines = await rows<{ line_number: number; account_number: string; auxiliary_account: string | null; debit_cents: number; credit_cents: number; is_tax_deductible: number | boolean; table3_reintegration_code: string | null }>(
      `SELECT jel.line_number, ca.account_number, jel.auxiliary_account, jel.debit_cents, jel.credit_cents, jel.is_tax_deductible, jel.table3_reintegration_code
         FROM journal_entry_lines jel JOIN cgnc_accounts ca ON ca.id = jel.account_id WHERE jel.entry_id = ?`,
      [entryId],
    );
    const tuple = [
      'FISCA_GL_ENTRY_V1',
      e.fiscal_year_id,
      'VTE',
      Number(e.sequence_number),
      e.entry_reference,
      e.entry_date,
      e.validated_at,
      e.source_document_type,
      e.invoice_id ?? null,
      e.dgi_clearance_uuid ?? null,
      e.reversal_of_entry_id ?? null,
      Number(e.total_debit_cents),
      Number(e.total_credit_cents),
      e.previous_entry_hash,
      [...lines]
        .sort((a, b) => Number(a.line_number) - Number(b.line_number))
        .map((l) => [Number(l.line_number), l.account_number, l.auxiliary_account ?? null, Number(l.debit_cents), Number(l.credit_cents), Boolean(l.is_tax_deductible), l.table3_reintegration_code ?? null]),
    ];
    return { stored: e.entry_hash, recomputed: sha(JSON.stringify(tuple)), previous: e.previous_entry_hash };
  };

  const one = await expectedEntryHash(first);
  expect(one.previous).toBe(LEDGER_GENESIS_HASH);
  expect(one.stored).toMatch(HEX64);
  expect(one.stored).toBe(one.recomputed);
  const two = await expectedEntryHash(second);
  expect(two.previous).toBe(one.stored);
  expect(two.stored).toBe(two.recomputed);

  const begin = await engine.beginFiscalYearClosing(chef, { fiscalYearId: FY_2026.id, idempotencyKey: key() });
  expect(begin.toState).toBe('CLOSING');
  const closed = await engine.closeFiscalYear(fresh(oec), { fiscalYearId: FY_2026.id, idempotencyKey: key() });
  const [fy] = await rows<{ closed_at: string | null; closing_hash: string }>('SELECT NULL AS closed_at, closing_hash FROM fiscal_years WHERE id = ?', [FY_2026.id]);
  expect(fy?.closing_hash).toBe(closed.closingHash);
  const [totals] = await rows<{ d: number; c: number }>(
    `SELECT CAST(SUM(total_debit_cents) AS BIGINT) AS d, CAST(SUM(total_credit_cents) AS BIGINT) AS c FROM journal_entries WHERE fiscal_year_id = ? AND status = 'POSTED'`,
    [FY_2026.id],
  );
  expect(Number(totals?.d)).toBe(125000);
  const [audit] = await rows<{ occurred_at: string }>(
    `SELECT created_at AS occurred_at FROM state_transition_audit WHERE entity_id = ? AND to_state = 'CLOSED'`,
    [FY_2026.id],
  );
  const closedAtIso = audit?.occurred_at ?? '';
  const journals = await rows<{ code: string; last_sequence_number: number; last_entry_hash: string }>('SELECT code, last_sequence_number, last_entry_hash FROM journals', []);
  const closeTuple = [
    'FISCA_GL_CLOSE_V1',
    FY_2026.id,
    FY_2026.code,
    FY_2026.start,
    FY_2026.end,
    closedAtIso,
    Number(totals?.d),
    Number(totals?.c),
    [...journals]
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
      .map((j) => [j.code, Number(j.last_sequence_number), j.last_entry_hash]),
  ];
  expect(closeTuple[8]).toEqual([
    ['ACH', 0, LEDGER_GENESIS_HASH],
    ['AN', 0, LEDGER_GENESIS_HASH],
    ['BNQ', 0, LEDGER_GENESIS_HASH],
    ['CAI', 0, LEDGER_GENESIS_HASH],
    ['OD', 0, LEDGER_GENESIS_HASH],
    ['VTE', 2, two.stored],
  ]);
  expect(closed.closingHash).toBe(sha(JSON.stringify(closeTuple)));
}

describe('moteur sans hasher injecté : defaultSha256LedgerHasher par défaut', () => {
  it('SQLite : scelle, vérifie la chaîne, recalcule entry_hash et closing_hash à la main', async () => {
    await endToEnd(await openSqliteBackend());
  });

  it('PostgreSQL 16 : scelle, vérifie la chaîne, recalcule entry_hash et closing_hash à la main', async () => {
    await endToEnd(await postgres.fresh());
  });
});
