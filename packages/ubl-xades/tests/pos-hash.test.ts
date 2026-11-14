import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computePosClosureHash,
  computePosTicketHash,
  POS_CHAIN_GENESIS,
  PosError,
  serializePosTuple,
  verifyPosClosureChain,
  verifyPosTicketChain,
  type PosChainClosure,
  type PosChainTicket,
  type PosClosureHashFields,
  type PosTicketHashFields,
} from '../src/pos/index.ts';

const GOLD_TICKET = 'a9677d45d9429b948d9d36c01641db05086575926ef658879d61c8e57d32c7fe';
const GOLD_Z = 'da7c65662e8e03d044f41f6f91957b6c850e9bc8a54195f36cea8b382691d7c2';

interface Vector {
  readonly id: string;
  readonly kind: 'TICKET' | 'CLOSURE';
  readonly input: Record<string, number | string>;
  readonly expected: Record<string, string>;
  readonly negativeZeroField?: string;
}
const file = JSON.parse(readFileSync(new URL('./golden/pos-hash.vectors.json', import.meta.url), 'utf8')) as { vectors: Vector[]; staleValues: Record<string, string> };

const ticketFields = (v: Vector): PosTicketHashFields => v.input as unknown as PosTicketHashFields;
const closureFields = (v: Vector): PosClosureHashFields => v.input as unknown as PosClosureHashFields;

describe('empreintes d’or POS (D-22, amorce de 64 zéros)', () => {
  it('l’amorce POS vaut 64 zéros', () => {
    expect(POS_CHAIN_GENESIS).toBe('0'.repeat(64));
  });
  it.each(file.vectors.map((v) => [v.id, v] as const))('%s : empreinte recalculée = attendue', async (_id, v) => {
    const fields = v.negativeZeroField === undefined ? v.input : { ...v.input, [v.negativeZeroField]: -0 };
    const actual = v.kind === 'TICKET' ? await computePosTicketHash(fields as unknown as PosTicketHashFields) : await computePosClosureHash(fields as unknown as PosClosureHashFields);
    expect(actual).toBe(v.kind === 'TICKET' ? v.expected['ticketSha256'] : v.expected['zSha256']);
  });
  it('les deux empreintes d’or du propriétaire sont retrouvées', async () => {
    const ticket = file.vectors.find((v) => v.id === 'POS-TKT-01');
    const closure = file.vectors.find((v) => v.id === 'POS-Z-01');
    expect(ticket && (await computePosTicketHash(ticketFields(ticket)))).toBe(GOLD_TICKET);
    expect(closure && (await computePosClosureHash(closureFields(closure)))).toBe(GOLD_Z);
  });
  it('les anciennes empreintes (genèse de 45 caractères) sont consignées comme périmées et ne sont pas produites', async () => {
    expect(Object.values(file.staleValues)).toEqual(expect.arrayContaining(['78ae3cdac0f54daa0c8d72dd417d1a972c1b3c90024248d8a59950021bcf75ee', '3721227a052b7f5ffce0a10702ed9a49d582a10cf3b1010c56e196cf2f3d7a97']));
    const ticket = file.vectors.find((v) => v.id === 'POS-TKT-01');
    expect(ticket && (await computePosTicketHash(ticketFields(ticket)))).not.toMatch(/^78ae3cda/);
  });
  it('sérialisation canonique : undefined → null, -0 → 0, aucun espace', () => {
    expect(serializePosTuple(['A', undefined, -0, 5])).toBe('["A",null,0,5]');
  });
  it('validation stricte : flottant, hors sécurité entière, date, prev non hexadécimal ou en majuscules, undefined', async () => {
    const base = ticketFields(file.vectors[0] as Vector);
    for (const bad of [{ ht20Cents: Number('1.5') }, { ht20Cents: 2 ** 53 }, { ht20Cents: Number.NaN }, { issuedAtIso: '2026-11-13T10:15:00Z' }, { issuedAtIso: '2026-02-30T10:15:00.000Z' }, { prevTicketSha256: 'A'.repeat(64) }, { prevTicketSha256: 'GENESIS_HASH_'.padEnd(45, '0') }, { prevTicketSha256: undefined }, { terminalSeqNumber: 0 }, { terminalId: '' }]) {
      await expect(computePosTicketHash({ ...base, ...bad } as unknown as PosTicketHashFields), JSON.stringify(bad)).rejects.toBeInstanceOf(PosError);
    }
    const z = closureFields(file.vectors[4] as Vector);
    await expect(computePosClosureHash({ ...z, businessDate: '2026-13-01' })).rejects.toBeInstanceOf(PosError);
    await expect(computePosClosureHash({ ...z, tpeGrossCents: Number('0.5') })).rejects.toBeInstanceOf(PosError);
  });
});

async function chain(): Promise<PosChainTicket[]> {
  const [a, b] = [file.vectors[0], file.vectors[1]] as [Vector, Vector];
  return [
    { ...ticketFields(a), ticketSha256: a.expected['ticketSha256'] as string },
    { ...ticketFields(b), ticketSha256: b.expected['ticketSha256'] as string },
  ];
}

describe('verifyPosTicketChain', () => {
  it('chaîne valide depuis l’amorce, puis raccordée à un ancrage', async () => {
    const tickets = await chain();
    expect(await verifyPosTicketChain(tickets)).toEqual({ ok: true });
    expect(await verifyPosTicketChain(tickets.slice(1), { terminalSeqNumber: 1, ticketSha256: GOLD_TICKET })).toEqual({ ok: true });
  });
  it('rupture de chaîne (prev erroné)', async () => {
    const [a, b] = await chain();
    expect(await verifyPosTicketChain([a as PosChainTicket, { ...(b as PosChainTicket), prevTicketSha256: 'f'.repeat(64) }])).toEqual({ ok: false, index: 1, code: 'CHAIN_BREAK' });
  });
  it('trou de séquence et séquence non monotone', async () => {
    const [a, b] = await chain();
    expect(await verifyPosTicketChain([a as PosChainTicket, { ...(b as PosChainTicket), terminalSeqNumber: 3 }])).toEqual({ ok: false, index: 1, code: 'SEQUENCE_GAP' });
    expect(await verifyPosTicketChain([a as PosChainTicket, a as PosChainTicket])).toEqual({ ok: false, index: 1, code: 'SEQUENCE_REGRESSION' });
    expect(await verifyPosTicketChain([b as PosChainTicket])).toEqual({ ok: false, index: 0, code: 'SEQUENCE_GAP' });
  });
  it('empreinte altérée (un centime) et terminal mélangé', async () => {
    const [a, b] = await chain();
    expect(await verifyPosTicketChain([{ ...(a as PosChainTicket), totalTtcCents: 12031 }])).toEqual({ ok: false, index: 0, code: 'HASH_MISMATCH' });
    expect(await verifyPosTicketChain([a as PosChainTicket, { ...(b as PosChainTicket), terminalId: 'POS-M01-C02' }])).toEqual({ ok: false, index: 1, code: 'TERMINAL_MISMATCH' });
  });
});

describe('verifyPosClosureChain', () => {
  const z1 = (): PosChainClosure => ({ ...closureFields(file.vectors[4] as Vector), zSha256: GOLD_Z });
  const z2 = (): PosChainClosure => ({ ...closureFields(file.vectors[5] as Vector), zSha256: (file.vectors[5] as Vector).expected['zSha256'] as string });
  it('chaîne valide, rupture, trou, altération', async () => {
    expect(await verifyPosClosureChain([z1(), z2()])).toEqual({ ok: true });
    expect(await verifyPosClosureChain([z1(), { ...z2(), prevZSha256: '1'.repeat(64) }])).toEqual({ ok: false, index: 1, code: 'CHAIN_BREAK' });
    expect(await verifyPosClosureChain([z1(), { ...z2(), closureNumber: 4 }])).toEqual({ ok: false, index: 1, code: 'SEQUENCE_GAP' });
    expect(await verifyPosClosureChain([z2()])).toEqual({ ok: false, index: 0, code: 'SEQUENCE_GAP' });
    expect(await verifyPosClosureChain([{ ...z1(), tpeGrossCents: 1 }])).toEqual({ ok: false, index: 0, code: 'HASH_MISMATCH' });
  });
});
