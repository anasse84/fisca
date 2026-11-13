import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@fisca/shared-types';
import { INITIAL_PIH_SHA256, SEQUENCE_VIOLATION_MARKER } from './durable-object-ddl.ts';
import { createFakeDoDatabase, createFakeDoState, type FakeDurableObjectState } from './fake-do-storage.ts';
import { InvoiceSequencerDO, SequencerError, type AllocateInvoiceNumberRequest } from './invoice-sequencer-do.ts';

const COMPANY = 'company_alpha-01';
const NOW = '2026-03-01T09:30:00Z';

async function hashOf(label: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(label));
}

async function request(key: string, seriesKey = 'FAC-2026', label = `facture:${key}`): Promise<AllocateInvoiceNumberRequest> {
  return { idempotencyKey: key, seriesKey, invoiceSha256: await hashOf(label), requestedAtIso: NOW };
}

function newSequencer(state?: FakeDurableObjectState): { sequencer: InvoiceSequencerDO; state: FakeDurableObjectState } {
  const resolved = state ?? createFakeDoState(createFakeDoDatabase(), COMPANY);
  return { sequencer: new InvoiceSequencerDO(resolved, {}), state: resolved };
}

async function errorOf(action: () => Promise<unknown>): Promise<SequencerError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof SequencerError) {
      return error;
    }
    throw error;
  }
  throw new Error("l'action aurait dû lever une SequencerError");
}

describe('InvoiceSequencerDO : numérotation sans trou (Art. 145 CGI)', () => {
  it('attribue 1 puis 2 avec un PIH initial égal au SHA-256 de la chaîne vide', async () => {
    const { sequencer } = newSequencer();
    expect(INITIAL_PIH_SHA256).toBe(await hashOf(''));
    const first = await sequencer.allocateInvoiceNumber(await request('k1'));
    const second = await sequencer.allocateInvoiceNumber(await request('k2'));
    expect(first).toMatchObject({ seriesKey: 'FAC-2026', sequenceNumber: 1, previousInvoiceHash: INITIAL_PIH_SHA256, idempotentReplay: false });
    expect(second.sequenceNumber).toBe(2);
    expect(second.previousInvoiceHash).toBe(first.invoiceSha256);
  });

  it('200 demandes concurrentes (Promise.all) : numéros contigus 1..200, sans doublon, chaîne PIH intacte', async () => {
    const { sequencer } = newSequencer();
    const requests = await Promise.all(Array.from({ length: 200 }, (_, index) => request(`concurrent-${index}`)));
    const results = await Promise.all(requests.map((item) => sequencer.allocateInvoiceNumber(item)));
    const numbers = results.map((item) => item.sequenceNumber).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 200 }, (_, index) => index + 1));
    expect(new Set(numbers).size).toBe(200);
    const byNumber = [...results].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    byNumber.forEach((item, index) => {
      const expectedPrevious = index === 0 ? INITIAL_PIH_SHA256 : (byNumber[index - 1]?.invoiceSha256 ?? '');
      expect(item.previousInvoiceHash).toBe(expectedPrevious);
    });
    const verdict = await sequencer.verifyChain({ seriesKey: 'FAC-2026' });
    expect(verdict).toEqual({ seriesKey: 'FAC-2026', ok: true, length: 200, issues: [] });
    expect((await sequencer.getSeriesHead({ seriesKey: 'FAC-2026' }))?.lastNumber).toBe(200);
  });

  it("atomicité : l'échec de l'enregistrement PIH ne consomme aucun numéro", async () => {
    const { sequencer, state } = newSequencer();
    await sequencer.allocateInvoiceNumber(await request('ok-1'));
    let armed = true;
    state.storage.sql.beforeExec = (query) => {
      if (armed && query.includes('INSERT INTO fiscal_sequence_journal')) {
        armed = false;
        throw new Error('panne simulée du stockage');
      }
    };
    await expect(sequencer.allocateInvoiceNumber(await request('lost'))).rejects.toThrow('panne simulée du stockage');
    const head = await sequencer.getSeriesHead({ seriesKey: 'FAC-2026' });
    expect(head?.lastNumber).toBe(1);
    expect(head?.lastInvoiceHash).toBe(await hashOf('facture:ok-1'));
    const retried = await sequencer.allocateInvoiceNumber(await request('lost'));
    expect(retried.sequenceNumber).toBe(2);
    expect((await sequencer.verifyChain({ seriesKey: 'FAC-2026' })).ok).toBe(true);
  });

  it("atomicité : une série neuve dont l'enregistrement échoue n'est pas créée", async () => {
    const { sequencer, state } = newSequencer();
    state.storage.sql.beforeExec = (query) => {
      if (query.includes('INSERT INTO fiscal_sequence_journal')) {
        throw new Error('panne simulée');
      }
    };
    await expect(sequencer.allocateInvoiceNumber(await request('x', 'NDB-2026'))).rejects.toThrow('panne simulée');
    state.storage.sql.beforeExec = undefined;
    expect(await sequencer.getSeriesHead({ seriesKey: 'NDB-2026' })).toBeNull();
  });

  it('idempotence : rejouer la même demande rend le même numéro sans consommer', async () => {
    const { sequencer } = newSequencer();
    const original = await request('replay');
    const first = await sequencer.allocateInvoiceNumber(original);
    await sequencer.allocateInvoiceNumber(await request('autre'));
    const replayed = await sequencer.allocateInvoiceNumber({ ...original, requestedAtIso: '2026-03-02T00:00:00Z' });
    expect(replayed).toEqual({ ...first, idempotentReplay: true });
    const next = await sequencer.allocateInvoiceNumber(await request('suite'));
    expect(next.sequenceNumber).toBe(3);
  });

  it('idempotence : la même clé avec une autre série ou une autre empreinte est refusée sans consommer', async () => {
    const { sequencer } = newSequencer();
    await sequencer.allocateInvoiceNumber(await request('k'));
    const otherSeries = await errorOf(async () => sequencer.allocateInvoiceNumber(await request('k', 'AVO-2026', 'facture:k')));
    expect(otherSeries.code).toBe('SEQ_IDEMPOTENCY_CONFLICT');
    const otherHash = await errorOf(async () => sequencer.allocateInvoiceNumber(await request('k', 'FAC-2026', 'contenu différent')));
    expect(otherHash.code).toBe('SEQ_IDEMPOTENCY_CONFLICT');
    expect((await sequencer.getSeriesHead({ seriesKey: 'FAC-2026' }))?.lastNumber).toBe(1);
    expect(await sequencer.getSeriesHead({ seriesKey: 'AVO-2026' })).toBeNull();
  });

  it('exercices et séries indépendants, chacun avec sa propre chaîne depuis le PIH initial', async () => {
    const { sequencer } = newSequencer();
    const a = await sequencer.allocateInvoiceNumber(await request('a', 'FAC-2026'));
    const b = await sequencer.allocateInvoiceNumber(await request('b', 'FAC-2027'));
    const c = await sequencer.allocateInvoiceNumber(await request('c', 'AVO-2026'));
    const d = await sequencer.allocateInvoiceNumber(await request('d', 'FAC-2026'));
    expect([a.sequenceNumber, b.sequenceNumber, c.sequenceNumber, d.sequenceNumber]).toEqual([1, 1, 1, 2]);
    expect(b.previousInvoiceHash).toBe(INITIAL_PIH_SHA256);
    expect(c.previousInvoiceHash).toBe(INITIAL_PIH_SHA256);
    expect(d.previousInvoiceHash).toBe(a.invoiceSha256);
    for (const seriesKey of ['FAC-2026', 'FAC-2027', 'AVO-2026']) {
      expect((await sequencer.verifyChain({ seriesKey })).ok).toBe(true);
    }
  });

  it("reprise après redémarrage : une nouvelle instance sur le même stockage poursuit sans trou ni doublon", async () => {
    const database = createFakeDoDatabase();
    const first = newSequencer(createFakeDoState(database, COMPANY)).sequencer;
    const allocated = [await first.allocateInvoiceNumber(await request('r1')), await first.allocateInvoiceNumber(await request('r2')), await first.allocateInvoiceNumber(await request('r3'))];
    const restarted = newSequencer(createFakeDoState(database, COMPANY)).sequencer;
    const next = await restarted.allocateInvoiceNumber(await request('r4'));
    expect(next.sequenceNumber).toBe(4);
    expect(next.previousInvoiceHash).toBe(allocated[2]?.invoiceSha256);
    // Réponse perdue avant le crash : la demande rejouée après redémarrage retrouve son numéro.
    const recovered = await restarted.allocateInvoiceNumber(await request('r2'));
    expect(recovered).toEqual({ ...allocated[1], idempotentReplay: true });
    expect((await restarted.verifyChain({ seriesKey: 'FAC-2026' })).length).toBe(4);
  });

  it('suivi des tentatives de soumission : compte les essais sans toucher au numéro ni au PIH', async () => {
    const { sequencer } = newSequencer();
    const allocated = await sequencer.allocateInvoiceNumber(await request('s1'));
    const afterAllocation = await sequencer.getSeriesHead({ seriesKey: 'FAC-2026' });
    expect(afterAllocation?.submissionAttemptCounter).toBe(1);
    const attempt = await sequencer.recordSubmissionAttempt({ seriesKey: 'FAC-2026', requestedAtIso: NOW });
    expect(attempt.submissionAttemptCounter).toBe(2);
    const head = await sequencer.getSeriesHead({ seriesKey: 'FAC-2026' });
    expect(head).toMatchObject({ lastNumber: 1, lastInvoiceHash: allocated.invoiceSha256, submissionAttemptCounter: 2 });
    expect((await errorOf(() => sequencer.recordSubmissionAttempt({ seriesKey: 'FAC-2099', requestedAtIso: NOW }))).code).toBe('SEQ_SERIES_UNKNOWN');
  });
});

describe('InvoiceSequencerDO : irréversibilité et intégrité de la chaîne', () => {
  it("n'expose aucune opération de libération, de remise ou de réutilisation de numéro", () => {
    const names = Object.getOwnPropertyNames(InvoiceSequencerDO.prototype);
    expect(names.filter((name) => /release|free|reset|rollback|delete|remove|reuse|cancel|void/i.test(name))).toEqual([]);
  });

  it("l'annulation passe par un avoir (autre série) : le numéro de la facture reste consommé", async () => {
    const { sequencer } = newSequencer();
    await sequencer.allocateInvoiceNumber(await request('f1'));
    const credit = await sequencer.allocateInvoiceNumber(await request('avoir-f1', 'AVO-2026'));
    const next = await sequencer.allocateInvoiceNumber(await request('f2'));
    expect(credit.sequenceNumber).toBe(1);
    expect(next.sequenceNumber).toBe(2);
  });

  it('les déclencheurs du DDL interdisent UPDATE/DELETE du journal, la suppression de série, le recul et le saut de numéro', async () => {
    const { sequencer, state } = newSequencer();
    await sequencer.allocateInvoiceNumber(await request('t1'));
    const sql = state.storage.sql;
    const hex = 'a'.repeat(64);
    expect(() => sql.exec('DELETE FROM fiscal_sequence_journal')).toThrow(SEQUENCE_VIOLATION_MARKER);
    expect(() => sql.exec('UPDATE fiscal_sequence_journal SET invoice_sha256 = ?', hex)).toThrow(SEQUENCE_VIOLATION_MARKER);
    expect(() => sql.exec('DELETE FROM fiscal_sequences')).toThrow(SEQUENCE_VIOLATION_MARKER);
    expect(() => sql.exec('UPDATE fiscal_sequences SET last_cleared_number = 0')).toThrow(SEQUENCE_VIOLATION_MARKER);
    expect(() => sql.exec('UPDATE fiscal_sequences SET last_cleared_number = 3, last_cleared_pi_hash = ?', hex)).toThrow(SEQUENCE_VIOLATION_MARKER);
    expect(() => sql.exec('UPDATE fiscal_sequences SET last_cleared_pi_hash = ?', hex)).toThrow(SEQUENCE_VIOLATION_MARKER);
    expect((await sequencer.getSeriesHead({ seriesKey: 'FAC-2026' }))?.lastNumber).toBe(1);
  });

  it("détecte une rupture de chaîne PIH (empreinte altérée) et un trou dans le journal", async () => {
    const { sequencer, state } = newSequencer();
    for (let index = 1; index <= 5; index += 1) {
      await sequencer.allocateInvoiceNumber(await request(`c${index}`));
    }
    const sql = state.storage.sql;
    // Corruption hors API (restauration défectueuse, accès direct) : on retire la protection pour la simuler.
    sql.exec('DROP TRIGGER fiscal_sequence_journal_no_update');
    sql.exec('UPDATE fiscal_sequence_journal SET invoice_sha256 = ? WHERE sequence_number = 3', 'b'.repeat(64));
    const altered = await sequencer.verifyChain({ seriesKey: 'FAC-2026' });
    expect(altered.ok).toBe(false);
    expect(altered.issues).toEqual([{ sequenceNumber: 4, code: 'PIH_BROKEN', detail: expect.stringContaining('previous_hash') }]);

    sql.exec('DROP TRIGGER fiscal_sequence_journal_no_delete');
    sql.exec('DELETE FROM fiscal_sequence_journal WHERE sequence_number = 2');
    const gap = await sequencer.verifyChain({ seriesKey: 'FAC-2026' });
    expect(gap.ok).toBe(false);
    expect(gap.issues.map((issue) => issue.code)).toContain('GAP_OR_DUPLICATE');
  });

  it("refuse d'attribuer un numéro quand l'en-tête de série ne correspond plus au journal", async () => {
    const { sequencer, state } = newSequencer();
    for (let index = 1; index <= 3; index += 1) {
      await sequencer.allocateInvoiceNumber(await request(`h${index}`));
    }
    state.storage.sql.exec('DROP TRIGGER fiscal_sequence_journal_no_delete');
    state.storage.sql.exec('DELETE FROM fiscal_sequence_journal WHERE sequence_number = 3');
    const refused = await errorOf(async () => sequencer.allocateInvoiceNumber(await request('h4')));
    expect(refused.code).toBe('SEQ_CHAIN_CORRUPT');
    const verdict = await sequencer.verifyChain({ seriesKey: 'FAC-2026' });
    expect(verdict.issues.map((issue) => issue.code)).toContain('HEAD_MISMATCH');
  });
});

describe('InvoiceSequencerDO : entrées invalides et société', () => {
  const invalidCases: readonly (readonly [string, Partial<AllocateInvoiceNumberRequest>])[] = [
    ['clé d’idempotence vide', { idempotencyKey: '' }],
    ['clé d’idempotence avec espace', { idempotencyKey: 'a b' }],
    ['série en minuscules', { seriesKey: 'fac-2026' }],
    ['série sans exercice', { seriesKey: 'FAC' }],
    ['empreinte en majuscules', { invoiceSha256: 'A'.repeat(64) }],
    ['empreinte trop courte', { invoiceSha256: 'a'.repeat(63) }],
    ['horodatage non canonique', { requestedAtIso: '2026-03-01 09:30:00' }],
    ['horodatage au calendrier invalide', { requestedAtIso: '2026-02-30T09:30:00Z' }],
  ];

  it.each(invalidCases)('refuse : %s', async (_label, override) => {
    const { sequencer } = newSequencer();
    const error = await errorOf(async () => sequencer.allocateInvoiceNumber({ ...(await request('v')), ...override }));
    expect(error.code).toBe('SEQ_INVALID_REQUEST');
    expect(await sequencer.getSeriesHead({ seriesKey: 'FAC-2026' })).toBeNull();
  });

  it("l'instance appartient à une société : sans nom d'objet valide, tout est refusé (échec fermé)", async () => {
    for (const name of [undefined, 'control-plane', 'société/x']) {
      const { sequencer } = newSequencer(createFakeDoState(createFakeDoDatabase(), name));
      const error = await errorOf(async () => sequencer.allocateInvoiceNumber(await request('x')));
      expect(error.code).toBe('SEQ_COMPANY_UNRESOLVED');
    }
  });

  it('deux sociétés = deux stockages : numérotations indépendantes, aucun accès croisé', async () => {
    const one = newSequencer(createFakeDoState(createFakeDoDatabase(), 'company_one')).sequencer;
    const two = newSequencer(createFakeDoState(createFakeDoDatabase(), 'company_two')).sequencer;
    await one.allocateInvoiceNumber(await request('a'));
    await one.allocateInvoiceNumber(await request('b'));
    const first = await two.allocateInvoiceNumber(await request('a'));
    expect(first.sequenceNumber).toBe(1);
    expect((await two.getSeriesHead({ seriesKey: 'FAC-2026' }))?.lastNumber).toBe(1);
  });
});

describe('InvoiceSequencerDO : protocole fetch', () => {
  async function post(sequencer: InvoiceSequencerDO, path: string, body: unknown): Promise<Response> {
    return sequencer.fetch(new Request(`https://do.invalid${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
  }

  it('POST /v1/allocate attribue puis rejoue ; /v1/verify-chain et /v1/head répondent', async () => {
    const { sequencer } = newSequencer();
    const payload = await request('f1');
    const created = await post(sequencer, '/v1/allocate', payload);
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ sequenceNumber: 1, idempotentReplay: false });
    const replay = await post(sequencer, '/v1/allocate', payload);
    expect(await replay.json()).toMatchObject({ sequenceNumber: 1, idempotentReplay: true });
    expect(await (await post(sequencer, '/v1/verify-chain', { seriesKey: 'FAC-2026' })).json()).toMatchObject({ ok: true, length: 1 });
    expect(await (await post(sequencer, '/v1/head', { seriesKey: 'FAC-2026' })).json()).toMatchObject({ lastNumber: 1 });
    expect(await (await post(sequencer, '/v1/submission-attempt', { seriesKey: 'FAC-2026', requestedAtIso: NOW })).json()).toMatchObject({ submissionAttemptCounter: 2 });
  });

  it('erreurs typées : 400 charge invalide (clé inconnue comme companyId comprise), 409 conflit, 404, 405', async () => {
    const { sequencer } = newSequencer();
    const payload = await request('f1');
    const withCompany = await post(sequencer, '/v1/allocate', { ...payload, companyId: 'other' });
    expect(withCompany.status).toBe(400);
    expect(await withCompany.json()).toEqual({ error: { code: 'SEQ_INVALID_REQUEST', message: expect.any(String) } });
    const notJson = await sequencer.fetch(new Request('https://do.invalid/v1/allocate', { method: 'POST', body: '{pas du json' }));
    expect(notJson.status).toBe(400);
    await post(sequencer, '/v1/allocate', payload);
    const conflict = await post(sequencer, '/v1/allocate', { ...payload, invoiceSha256: 'c'.repeat(64) });
    expect(conflict.status).toBe(409);
    expect((await post(sequencer, '/v1/inconnu', payload)).status).toBe(404);
    expect((await sequencer.fetch(new Request('https://do.invalid/v1/allocate', { method: 'GET' }))).status).toBe(405);
  });

  it("société non résolue : 500 SEQ_COMPANY_UNRESOLVED, rien n'est écrit", async () => {
    const { sequencer } = newSequencer(createFakeDoState(createFakeDoDatabase(), undefined));
    const response = await post(sequencer, '/v1/allocate', await request('f1'));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'SEQ_COMPANY_UNRESOLVED' } });
  });
});
