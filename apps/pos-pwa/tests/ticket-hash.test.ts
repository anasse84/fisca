import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POS_CHAIN_GENESIS, POS_TICKET_LABEL, buildTicketTuple, canonicalJsonTuple, computeTicketSha256 } from '../src/ticketing/ticket-hash.ts';
import type { TicketHashFields } from '../src/ticketing/ticket-hash.ts';

interface GoldenVectors {
  readonly pour_P2A_non_implemente: { readonly ticket_pos: { readonly tuple: readonly (string | number)[]; readonly sha256: string } };
}
// Lecture seule du fichier de vecteurs d’or (apps/api-hono) : la sérialisation, pas l’empreinte POS finale (recalculée par P2-A).
const golden = JSON.parse(readFileSync(new URL('../../api-hono/src/core/ledger-hasher.vectors.json', import.meta.url), 'utf8')) as GoldenVectors;
const goldenTicket = golden.pour_P2A_non_implemente.ticket_pos;

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const FIELDS: TicketHashFields = {
  terminalId: 'POS-M01-C01',
  terminalSeqNumber: 1,
  issuedAtIso: '2026-11-13T10:15:00.000Z',
  ticketKind: 'SALE_B2C',
  ht20Cents: 10000,
  vat20Cents: 2000,
  ht10Cents: 0,
  vat10Cents: 0,
  ht0Cents: 0,
  stampDutyCents: 30,
  totalTtcCents: 12030,
  prevTicketSha256: POS_CHAIN_GENESIS,
};

describe('empreinte du ticket POS (FISCA_POS_TKT_V1, ERRATA D-22)', () => {
  it('amorce POS = 64 zéros (CHECK v4), étiquette FISCA_POS_TKT_V1', () => {
    expect(POS_CHAIN_GENESIS).toBe('0'.repeat(64));
    expect(POS_TICKET_LABEL).toBe('FISCA_POS_TKT_V1');
  });

  it('même sérialisation que le fichier de vecteurs d’or : le tuple d’or redonne l’empreinte d’or (sans la recalculer ici)', async () => {
    const text = canonicalJsonTuple(goldenTicket.tuple);
    expect(text.includes(' ')).toBe(false);
    expect(await sha256Hex(text)).toBe(goldenTicket.sha256);
  });

  it('le tuple positionnel suit l’ordre décidé : étiquette, terminal, séquence, date, nature, 5 montants, timbre, TTC, précédent', () => {
    expect(buildTicketTuple(FIELDS)).toEqual([
      'FISCA_POS_TKT_V1', 'POS-M01-C01', 1, '2026-11-13T10:15:00.000Z', 'SALE_B2C', 10000, 2000, 0, 0, 0, 30, 12030, '0'.repeat(64),
    ]);
  });

  it('empreinte = SHA-256 minuscule de 64 hexadécimaux du JSON positionnel ; stable et sensible à un centime', async () => {
    const a = await computeTicketSha256(FIELDS);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(await sha256Hex(JSON.stringify(buildTicketTuple(FIELDS))));
    expect(await computeTicketSha256(FIELDS)).toBe(a);
    expect(await computeTicketSha256({ ...FIELDS, totalTtcCents: 12031 })).not.toBe(a);
    expect(await computeTicketSha256({ ...FIELDS, prevTicketSha256: 'a'.repeat(64) })).not.toBe(a);
  });

  it('-0 devient 0 ; un montant non entier ou hors entier sûr est refusé', async () => {
    expect(await computeTicketSha256({ ...FIELDS, ht0Cents: -0 })).toBe(await computeTicketSha256(FIELDS));
    await expect(computeTicketSha256({ ...FIELDS, ht20Cents: Number('100.5') })).rejects.toThrow(/entier sûr/);
    await expect(computeTicketSha256({ ...FIELDS, totalTtcCents: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow(/entier sûr/);
  });

  it('refuse un précédent qui n’est pas 64 hexadécimaux minuscules', async () => {
    await expect(computeTicketSha256({ ...FIELDS, prevTicketSha256: 'GENESIS_HASH_' + '0'.repeat(32) })).rejects.toThrow(/64 hexadécimaux/);
  });
});
