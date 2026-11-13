import { describe, expect, it } from 'vitest';
import { createFakeDoDatabase, createFakeDoState, type FakeDurableObjectState } from './fake-do-storage.ts';
import {
  AgentHindsightMemoryDO,
  HindsightError,
  type ExperienceInput,
  type HindsightErrorCode,
} from './agent-hindsight-memory-do.ts';

const COMPANY = 'company_alpha-01';
const BIDX_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const BIDX_B = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const LABEL_HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

function uuid7(index: number): string {
  return `0190f0a0-0000-7000-8000-${index.toString(16).padStart(12, '0')}`;
}

function at(minute: number): string {
  return `2026-03-01T10:${String(minute).padStart(2, '0')}:00Z`;
}

function experience(index: number, override: Partial<ExperienceInput> = {}): ExperienceInput {
  return {
    id: uuid7(index),
    supplierIceBidx: BIDX_A,
    rawLabelHash: LABEL_HASH,
    proposedPcgeAccount: '6125',
    humanFinalPcgeAccount: null,
    wasAcceptedAsIs: true,
    createdAtIso: at(index),
    ...override,
  };
}

function newMemory(state?: FakeDurableObjectState): { memory: AgentHindsightMemoryDO; state: FakeDurableObjectState } {
  const resolved = state ?? createFakeDoState(createFakeDoDatabase(), COMPANY);
  return { memory: new AgentHindsightMemoryDO(resolved, {}), state: resolved };
}

async function codeOf(action: () => Promise<unknown>): Promise<HindsightErrorCode> {
  try {
    await action();
  } catch (error) {
    if (error instanceof HindsightError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("l'action aurait dû lever une HindsightError");
}

describe('AgentHindsightMemoryDO : world_facts (retain / recall)', () => {
  it('retient un fait stable, le rappelle, et le met à jour par clé', async () => {
    const { memory } = newMemory();
    await memory.retainFact({ factKey: 'bank.statement_format', fact: { format: 'CSV', columns: 7, separators: [';', ','] }, updatedAtIso: at(1) });
    expect(await memory.recallFact({ factKey: 'bank.statement_format' })).toEqual({
      factKey: 'bank.statement_format',
      fact: { format: 'CSV', columns: 7, separators: [';', ','] },
      updatedAtIso: at(1),
    });
    await memory.retainFact({ factKey: 'bank.statement_format', fact: { format: 'OFX' }, updatedAtIso: at(2) });
    expect(await memory.recallFact({ factKey: 'bank.statement_format' })).toMatchObject({ fact: { format: 'OFX' }, updatedAtIso: at(2) });
    expect(await memory.recallFact({ factKey: 'absent' })).toBeNull();
  });

  const personalData: readonly (readonly [string, unknown])[] = [
    ['un ICE en clair (15 chiffres)', { note: 'fournisseur 001234567000089' }],
    ['un RIB en clair (24 chiffres)', { rib: '011780000012345678901234' }],
    ['un courriel', { contact: 'ahmed.alaoui@exemple.ma' }],
    ['un téléphone marocain', { tel: '0612345678' }],
    ['un IBAN marocain', { iban: 'MA64011519000001205000534921' }],
    ['une donnée personnelle imbriquée', { a: { b: [{ c: 'écrire à contact@exemple.ma' }] } }],
  ];

  it.each(personalData)('refuse %s (aucune donnée personnelle en clair)', async (_label, fact) => {
    const { memory } = newMemory();
    expect(await codeOf(() => memory.retainFact({ factKey: 'note', fact: fact as never, updatedAtIso: at(1) }))).toBe('HINDSIGHT_PII_REJECTED');
    expect(await memory.recallFact({ factKey: 'note' })).toBeNull();
  });

  it('accepte une empreinte SHA-256 hexadécimale même si elle contient une longue suite de chiffres', async () => {
    const { memory } = newMemory();
    const hash = `${'1'.repeat(20)}abcdef${'2'.repeat(38)}`;
    await memory.retainFact({ factKey: 'known_hash', fact: { hash }, updatedAtIso: at(1) });
    expect(await memory.recallFact({ factKey: 'known_hash' })).toMatchObject({ fact: { hash } });
  });

  it('refuse les faits non conformes : clé invalide, nombre non entier, trop volumineux, horodatage invalide, champ inconnu', async () => {
    const { memory } = newMemory();
    expect(await codeOf(() => memory.retainFact({ factKey: 'Clé Invalide', fact: {}, updatedAtIso: at(1) }))).toBe('HINDSIGHT_INVALID_REQUEST');
    expect(await codeOf(() => memory.retainFact({ factKey: 'k', fact: { ratio: 0.5 }, updatedAtIso: at(1) }))).toBe('HINDSIGHT_INVALID_REQUEST');
    expect(await codeOf(() => memory.retainFact({ factKey: 'k', fact: { big: 'x'.repeat(5000) }, updatedAtIso: at(1) }))).toBe('HINDSIGHT_INVALID_REQUEST');
    expect(await codeOf(() => memory.retainFact({ factKey: 'k', fact: {}, updatedAtIso: 'hier' }))).toBe('HINDSIGHT_INVALID_REQUEST');
    expect(await codeOf(() => memory.retainFact({ factKey: 'k', fact: {}, updatedAtIso: at(1), companyId: 'x' } as never))).toBe('HINDSIGHT_INVALID_REQUEST');
    expect(await codeOf(() => memory.retainFact({ factKey: 'k', fact: undefined as never, updatedAtIso: at(1) }))).toBe('HINDSIGHT_INVALID_REQUEST');
  });
});

describe('AgentHindsightMemoryDO : experiences et evolving_opinions (retain / reflect / recall)', () => {
  it('retient une proposition acceptée telle quelle et la rejoue sans doublon', async () => {
    const { memory } = newMemory();
    const input = experience(1);
    expect(await memory.retainExperience(input)).toEqual({ id: input.id, replayed: false });
    expect(await memory.retainExperience(input)).toEqual({ id: input.id, replayed: true });
    expect(await codeOf(() => memory.retainExperience({ ...input, proposedPcgeAccount: '6142' }))).toBe('HINDSIGHT_EXPERIENCE_CONFLICT');
    const recalled = await memory.recall({ supplierIceBidx: BIDX_A });
    expect(recalled.opinion).toBeNull();
    expect(recalled.recentExperiences).toEqual([
      { id: input.id, rawLabelHash: LABEL_HASH, proposedPcgeAccount: '6125', humanFinalPcgeAccount: null, wasAcceptedAsIs: true, createdAtIso: at(1) },
    ]);
  });

  it('boucle Doc_14 : la correction 6125 → 6142 sur un fournisseur fait proposer 6142 à la facture suivante du même ICE', async () => {
    const { memory } = newMemory();
    const before = await memory.recall({ supplierIceBidx: BIDX_A });
    expect(before.opinion).toBeNull();
    const reflected = await memory.reflectOnHumanCorrection(
      experience(1, { humanFinalPcgeAccount: '6142', wasAcceptedAsIs: false }),
    );
    expect(reflected.opinion).toEqual({
      patternKey: `supplier:${BIDX_A}`,
      preferredPcgeAccount: '6142',
      confidenceBps: 10000,
      occurrencesCount: 1,
      updatedAtIso: at(1),
    });
    const next = await memory.recall({ supplierIceBidx: BIDX_A });
    expect(next.opinion?.preferredPcgeAccount).toBe('6142');
    expect((await memory.recall({ supplierIceBidx: BIDX_B })).opinion).toBeNull();
  });

  it("la confiance (bps entiers) est la part d'expériences décidées qui confirment le compte retenu, arrondie au demi supérieur", async () => {
    const { memory } = newMemory();
    for (const index of [1, 2, 3]) {
      await memory.retainExperience(experience(index));
    }
    const first = await memory.reflectOnHumanCorrection(experience(4, { humanFinalPcgeAccount: '6142', wasAcceptedAsIs: false }));
    expect(first.opinion).toMatchObject({ preferredPcgeAccount: '6142', occurrencesCount: 1, confidenceBps: 2500 });
    const second = await memory.reflectOnHumanCorrection(experience(5, { humanFinalPcgeAccount: '6142', wasAcceptedAsIs: false }));
    expect(second.opinion).toMatchObject({ preferredPcgeAccount: '6142', occurrencesCount: 2, confidenceBps: 4000 });
    const back = await memory.reflectOnHumanCorrection(
      experience(6, { proposedPcgeAccount: '6142', humanFinalPcgeAccount: '6125', wasAcceptedAsIs: false }),
    );
    expect(back.opinion).toMatchObject({ preferredPcgeAccount: '6125', occurrencesCount: 4, confidenceBps: 6667 });
  });

  it("n'attribue pas d'opinion sur les propositions non décidées (ni acceptées, ni corrigées)", async () => {
    const { memory } = newMemory();
    await memory.retainExperience(experience(1, { wasAcceptedAsIs: false, humanFinalPcgeAccount: null }));
    expect(await codeOf(() => memory.reflectOnHumanCorrection(experience(2, { wasAcceptedAsIs: false, humanFinalPcgeAccount: null })))).toBe(
      'HINDSIGHT_INVALID_REQUEST',
    );
    expect((await memory.recall({ supplierIceBidx: BIDX_A })).opinion).toBeNull();
  });

  it('refuse les expériences invalides', async () => {
    const { memory } = newMemory();
    const cases: readonly Partial<ExperienceInput>[] = [
      { id: 'pas-un-uuid' },
      { supplierIceBidx: 'ABC' },
      { supplierIceBidx: '001234567000089' },
      { rawLabelHash: 'libellé brut en clair' },
      { proposedPcgeAccount: '61 25' },
      { humanFinalPcgeAccount: 'six' },
      { createdAtIso: '2026-03-01' },
      { wasAcceptedAsIs: true, humanFinalPcgeAccount: '6142' },
      { wasAcceptedAsIs: false, humanFinalPcgeAccount: '6125' },
    ];
    for (const override of cases) {
      expect(await codeOf(() => memory.retainExperience(experience(1, override)))).toBe('HINDSIGHT_INVALID_REQUEST');
    }
    expect(await codeOf(() => memory.reflectOnHumanCorrection(experience(1, { supplierIceBidx: null, humanFinalPcgeAccount: '6142', wasAcceptedAsIs: false })))).toBe(
      'HINDSIGHT_INVALID_REQUEST',
    );
    expect(await codeOf(() => memory.recall({ supplierIceBidx: 'x' }))).toBe('HINDSIGHT_INVALID_REQUEST');
    expect((await memory.recall({ supplierIceBidx: BIDX_A })).recentExperiences).toEqual([]);
  });

  it("atomicité : si la mise à jour de l'opinion échoue, l'expérience n'est pas retenue", async () => {
    const { memory, state } = newMemory();
    state.storage.sql.beforeExec = (query) => {
      if (query.includes('evolving_opinions') && query.includes('INSERT')) {
        throw new Error('panne simulée');
      }
    };
    await expect(memory.reflectOnHumanCorrection(experience(1, { humanFinalPcgeAccount: '6142', wasAcceptedAsIs: false }))).rejects.toThrow('panne simulée');
    state.storage.sql.beforeExec = undefined;
    expect((await memory.recall({ supplierIceBidx: BIDX_A })).recentExperiences).toEqual([]);
  });

  it('recall plafonne et ordonne les expériences récentes (plus récentes d’abord)', async () => {
    const { memory } = newMemory();
    for (let index = 1; index <= 8; index += 1) {
      await memory.retainExperience(experience(index));
    }
    const recalled = await memory.recall({ supplierIceBidx: BIDX_A, recentLimit: 3 });
    expect(recalled.recentExperiences.map((item) => item.createdAtIso)).toEqual([at(8), at(7), at(6)]);
    expect(await codeOf(() => memory.recall({ supplierIceBidx: BIDX_A, recentLimit: 0 }))).toBe('HINDSIGHT_INVALID_REQUEST');
    expect(await codeOf(() => memory.recall({ supplierIceBidx: BIDX_A, recentLimit: 51 }))).toBe('HINDSIGHT_INVALID_REQUEST');
  });

  it('droit à l’oubli : forgetSupplier purge expériences et opinion de ce fournisseur seulement', async () => {
    const { memory } = newMemory();
    await memory.retainFact({ factKey: 'bank.cutoff_day', fact: { day: 25 }, updatedAtIso: at(1) });
    await memory.reflectOnHumanCorrection(experience(1, { humanFinalPcgeAccount: '6142', wasAcceptedAsIs: false }));
    await memory.reflectOnHumanCorrection(experience(2, { supplierIceBidx: BIDX_B, humanFinalPcgeAccount: '6125', proposedPcgeAccount: '6142', wasAcceptedAsIs: false }));
    expect(await memory.forgetSupplier({ supplierIceBidx: BIDX_A })).toEqual({ experiencesDeleted: 1, opinionsDeleted: 1 });
    expect(await memory.recall({ supplierIceBidx: BIDX_A })).toEqual({ supplierIceBidx: BIDX_A, opinion: null, recentExperiences: [] });
    expect((await memory.recall({ supplierIceBidx: BIDX_B })).opinion?.preferredPcgeAccount).toBe('6125');
    expect(await memory.recallFact({ factKey: 'bank.cutoff_day' })).toMatchObject({ fact: { day: 25 } });
  });
});

describe('AgentHindsightMemoryDO : isolation par société et reprise', () => {
  it('deux sociétés = deux stockages : aucune lecture croisée', async () => {
    const one = newMemory(createFakeDoState(createFakeDoDatabase(), 'company_one')).memory;
    const two = newMemory(createFakeDoState(createFakeDoDatabase(), 'company_two')).memory;
    await one.reflectOnHumanCorrection(experience(1, { humanFinalPcgeAccount: '6142', wasAcceptedAsIs: false }));
    await one.retainFact({ factKey: 'secret.habit', fact: { v: 1 }, updatedAtIso: at(1) });
    expect((await two.recall({ supplierIceBidx: BIDX_A })).opinion).toBeNull();
    expect(await two.recallFact({ factKey: 'secret.habit' })).toBeNull();
  });

  it("sans nom d'objet valide (société non résolue), tout est refusé", async () => {
    for (const name of [undefined, 'control-plane', 'société/x']) {
      const { memory } = newMemory(createFakeDoState(createFakeDoDatabase(), name));
      expect(await codeOf(() => memory.recallFact({ factKey: 'k' }))).toBe('HINDSIGHT_COMPANY_UNRESOLVED');
    }
  });

  it('une nouvelle instance sur le même stockage retrouve la mémoire', async () => {
    const database = createFakeDoDatabase();
    const first = newMemory(createFakeDoState(database, COMPANY)).memory;
    await first.reflectOnHumanCorrection(experience(1, { humanFinalPcgeAccount: '6142', wasAcceptedAsIs: false }));
    const restarted = newMemory(createFakeDoState(database, COMPANY)).memory;
    expect((await restarted.recall({ supplierIceBidx: BIDX_A })).opinion?.preferredPcgeAccount).toBe('6142');
  });

  it('ne stocke que des empreintes et index aveugles : aucune colonne de donnée personnelle en clair', async () => {
    const { memory, state } = newMemory();
    await memory.reflectOnHumanCorrection(experience(1, { humanFinalPcgeAccount: '6142', wasAcceptedAsIs: false }));
    const columns = state.storage.sql
      .exec<{ name: string }>("SELECT p.name AS name FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name IN ('world_facts','experiences','evolving_opinions')")
      .toArray()
      .map((row) => row.name);
    expect(columns.filter((name) => /name|nom|email|phone|tel|iban|rib|ice(?!_bidx)|label(?!_hash)/i.test(name))).toEqual([]);
    expect(columns).toEqual(expect.arrayContaining(['supplier_ice_bidx', 'raw_label_hash']));
  });
});

describe('AgentHindsightMemoryDO : protocole fetch', () => {
  async function post(memory: AgentHindsightMemoryDO, path: string, body: unknown): Promise<Response> {
    return memory.fetch(new Request(`https://do.invalid${path}`, { method: 'POST', body: JSON.stringify(body) }));
  }

  it('retain-fact, recall-fact, reflect, recall, forget-supplier', async () => {
    const { memory } = newMemory();
    expect((await post(memory, '/v1/retain-fact', { factKey: 'k', fact: { n: 1 }, updatedAtIso: at(1) })).status).toBe(200);
    expect(await (await post(memory, '/v1/recall-fact', { factKey: 'k' })).json()).toMatchObject({ fact: { n: 1 } });
    const reflected = await post(memory, '/v1/reflect', experience(1, { humanFinalPcgeAccount: '6142', wasAcceptedAsIs: false }));
    expect(await reflected.json()).toMatchObject({ experienceId: uuid7(1), opinion: { preferredPcgeAccount: '6142' } });
    expect(await (await post(memory, '/v1/recall', { supplierIceBidx: BIDX_A })).json()).toMatchObject({ opinion: { preferredPcgeAccount: '6142' } });
    expect(await (await post(memory, '/v1/retain-experience', experience(2))).json()).toEqual({ id: uuid7(2), replayed: false });
    expect(await (await post(memory, '/v1/forget-supplier', { supplierIceBidx: BIDX_A })).json()).toEqual({ experiencesDeleted: 2, opinionsDeleted: 1 });
  });

  it('erreurs typées : 400 (champ companyId interdit, JSON illisible), 409, 404, 405, 500 société non résolue', async () => {
    const { memory } = newMemory();
    const bad = await post(memory, '/v1/recall', { supplierIceBidx: BIDX_A, companyId: 'autre' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: 'HINDSIGHT_INVALID_REQUEST' } });
    expect((await memory.fetch(new Request('https://do.invalid/v1/recall', { method: 'POST', body: '{x' }))).status).toBe(400);
    await post(memory, '/v1/retain-experience', experience(1));
    expect((await post(memory, '/v1/retain-experience', experience(1, { proposedPcgeAccount: '6142' }))).status).toBe(409);
    expect((await post(memory, '/v1/inconnu', {})).status).toBe(404);
    expect((await memory.fetch(new Request('https://do.invalid/v1/recall', { method: 'GET' }))).status).toBe(405);
    const orphan = newMemory(createFakeDoState(createFakeDoDatabase(), undefined)).memory;
    const response = await post(orphan, '/v1/recall', { supplierIceBidx: BIDX_A });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'HINDSIGHT_COMPANY_UNRESOLVED' } });
  });
});
