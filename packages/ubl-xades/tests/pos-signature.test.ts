import { describe, expect, it } from 'vitest';
import { PosError, verifyPosTicketSignature } from '../src/pos/index.ts';
import { newTerminalKeys, toBase64 } from './support/pos-kit.ts';

const HASH = 'a9677d45d9429b948d9d36c01641db05086575926ef658879d61c8e57d32c7fe';

/** DER SEQUENCE { INTEGER r, INTEGER s } minimal, construit à la main pour le test. */
function derOf(rs: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array): number[] => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
    const body = [...bytes.subarray(start)];
    if ((body[0] ?? 0) >= 0x80) body.unshift(0);
    return [0x02, body.length, ...body];
  };
  const parts = [...integer(rs.subarray(0, 32)), ...integer(rs.subarray(32))];
  return Uint8Array.from([0x30, parts.length, ...parts]);
}

describe('verifyPosTicketSignature (ECDSA P-256 / SHA-256 sur l’UTF-8 de l’empreinte hexadécimale)', () => {
  it('r‖s brut de 64 octets valide', async () => {
    const keys = await newTerminalKeys();
    const signature = toBase64(await keys.sign(HASH));
    expect(await verifyPosTicketSignature({ publicKey: { kind: 'jwk', jwk: keys.publicJwk }, ticketHash: HASH, signature })).toBe(true);
  });
  it('signature DER convertie explicitement, valide', async () => {
    const keys = await newTerminalKeys();
    const signature = toBase64(derOf(await keys.sign(HASH)));
    expect(await verifyPosTicketSignature({ publicKey: { kind: 'jwk', jwk: keys.publicJwk }, ticketHash: HASH, signature })).toBe(true);
  });
  it('clé SPKI base64 acceptée', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const spki = toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
    const sig = toBase64(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(HASH))));
    expect(await verifyPosTicketSignature({ publicKey: { kind: 'spki', spkiBase64: spki }, ticketHash: HASH, signature: sig })).toBe(true);
  });
  it('empreinte modifiée : invalide', async () => {
    const keys = await newTerminalKeys();
    const signature = toBase64(await keys.sign(HASH));
    expect(await verifyPosTicketSignature({ publicKey: { kind: 'jwk', jwk: keys.publicJwk }, ticketHash: `b${HASH.slice(1)}`, signature })).toBe(false);
  });
  it('signature d’un autre terminal : invalide', async () => {
    const [mine, other] = [await newTerminalKeys(), await newTerminalKeys()];
    const signature = toBase64(await other.sign(HASH));
    expect(await verifyPosTicketSignature({ publicKey: { kind: 'jwk', jwk: mine.publicJwk }, ticketHash: HASH, signature })).toBe(false);
  });
  it('format inconnu : échec fermé (longueur, base64url, vide, DER tronqué)', async () => {
    const keys = await newTerminalKeys();
    const publicKey = { kind: 'jwk', jwk: keys.publicJwk } as const;
    const raw = await keys.sign(HASH);
    for (const bad of ['', toBase64(raw.subarray(0, 63)), toBase64(Uint8Array.from([...raw, 1])), '-_-_'.repeat(22), 'pas du base64!', toBase64(derOf(raw).subarray(0, 40))]) {
      await expect(verifyPosTicketSignature({ publicKey, ticketHash: HASH, signature: bad }), bad).rejects.toMatchObject({ code: 'POS_SIGNATURE_FORMAT_UNKNOWN' });
    }
  });
  it('clé inutilisable : POS_TERMINAL_KEY_INVALID ; courbe autre que P-256 refusée', async () => {
    const keys = await newTerminalKeys();
    const signature = toBase64(await keys.sign(HASH));
    await expect(verifyPosTicketSignature({ publicKey: { kind: 'spki', spkiBase64: 'AAAA' }, ticketHash: HASH, signature })).rejects.toMatchObject({ code: 'POS_TERMINAL_KEY_INVALID' });
    await expect(
      verifyPosTicketSignature({ publicKey: { kind: 'jwk', jwk: { ...keys.publicJwk, crv: 'P-384' as unknown as 'P-256' } }, ticketHash: HASH, signature }),
    ).rejects.toBeInstanceOf(PosError);
  });
  it('empreinte mal formée refusée', async () => {
    const keys = await newTerminalKeys();
    await expect(verifyPosTicketSignature({ publicKey: { kind: 'jwk', jwk: keys.publicJwk }, ticketHash: 'xyz', signature: toBase64(await keys.sign(HASH)) })).rejects.toMatchObject({ code: 'POS_FIELDS_INVALID' });
  });
});
