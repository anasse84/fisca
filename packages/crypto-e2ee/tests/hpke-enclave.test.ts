import { describe, expect, it } from 'vitest';
import vectorFile from './golden/rfc9180-base.vectors.json';
import {
  E2eeError,
  createHpkeEnclave,
  sealSecretForEnclave,
} from '../src/e2ee-engine.ts';
import type { E2eeErrorCode, HpkeKem } from '../src/e2ee-engine.ts';
import {
  aeadOpen,
  aeadSeal,
  computeNonce,
  hpkeBaseSchedule,
  importRecipientPrivateKeyRaw,
  hpkeOpenBase,
  hpkeSealBase,
  hpkeExport,
} from '../src/hpke-rfc9180.ts';

interface Vector {
  readonly kem_id: number;
  readonly info: string;
  readonly pkEm: string;
  readonly skEm: string;
  readonly pkRm: string;
  readonly skRm: string;
  readonly enc: string;
  readonly shared_secret: string;
  readonly key: string;
  readonly base_nonce: string;
  readonly exporter_secret: string;
  readonly encryptions: readonly { seq: number; pt: string; aad: string; nonce: string; ct: string }[];
  readonly exports: readonly { context: string; L: number; value: string }[];
}

const fromHex = (hex: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const SUITES: readonly { readonly label: string; readonly kem: HpkeKem; readonly vector: Vector }[] = [
  { label: 'A.1 DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 / AES-128-GCM', kem: 'DHKEM_X25519_HKDF_SHA256', vector: vectorFile.vectors['A.1'] },
  { label: 'A.3 DHKEM(P-256, HKDF-SHA256) / HKDF-SHA256 / AES-128-GCM', kem: 'DHKEM_P256_HKDF_SHA256', vector: vectorFile.vectors['A.3'] },
];

async function codeOf(promise: Promise<unknown>): Promise<E2eeErrorCode> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof E2eeError) return error.code;
    throw error;
  }
  throw new Error('une erreur E2eeError était attendue');
}

describe('vecteurs officiels RFC 9180 annexe A (mode Base)', () => {
  it('le fichier de vecteurs porte son état RECOUPÉ', () => {
    expect(vectorFile.etat).toBe('RECOUPÉ');
  });

  for (const { label, kem, vector } of SUITES) {
    describe(label, () => {
      it('KeySchedule : enc, shared_secret, key, base_nonce, exporter_secret', async () => {
        const schedule = await hpkeBaseSchedule({
          kem,
          recipientPublicKeyRaw: fromHex(vector.pkRm),
          info: fromHex(vector.info),
          ephemeral: { publicKeyRaw: fromHex(vector.pkEm), privateKeyRaw: fromHex(vector.skEm) },
        });
        expect(toHex(schedule.enc)).toBe(vector.enc);
        expect(toHex(schedule.sharedSecret)).toBe(vector.shared_secret);
        expect(toHex(schedule.key)).toBe(vector.key);
        expect(toHex(schedule.baseNonce)).toBe(vector.base_nonce);
        expect(toHex(schedule.exporterSecret)).toBe(vector.exporter_secret);
      });

      it('chiffrement AEAD aux numéros de séquence officiels', async () => {
        for (const item of vector.encryptions) {
          const nonce = computeNonce(fromHex(vector.base_nonce), BigInt(item.seq));
          expect(toHex(nonce)).toBe(item.nonce);
          const sealed = await aeadSeal(fromHex(vector.key), nonce, fromHex(item.aad), fromHex(item.pt));
          expect(toHex(sealed)).toBe(item.ct);
          expect(toHex(await aeadOpen(fromHex(vector.key), nonce, fromHex(item.aad), sealed))).toBe(item.pt);
        }
      });

      it('valeurs exportées (Export)', async () => {
        for (const item of vector.exports) {
          const value = await hpkeExport(kem, fromHex(vector.exporter_secret), fromHex(item.context), item.L);
          expect(toHex(value)).toBe(item.value);
        }
      });

      it('Seal avec éphémère imposé reproduit enc + ct du vecteur (seq 0), Open le déchiffre', async () => {
        const first = vector.encryptions[0];
        if (first === undefined) throw new Error('vecteur seq 0 attendu');
        const sealed = await hpkeSealBase({
          kem,
          recipientPublicKeyRaw: fromHex(vector.pkRm),
          info: fromHex(vector.info),
          aad: fromHex(first.aad),
          plaintext: fromHex(first.pt),
          ephemeral: { publicKeyRaw: fromHex(vector.pkEm), privateKeyRaw: fromHex(vector.skEm) },
        });
        expect(toHex(sealed.enc)).toBe(vector.enc);
        expect(toHex(sealed.ciphertext)).toBe(first.ct);
        const recipient = await importRecipientPrivateKeyRaw(kem, fromHex(vector.skRm), fromHex(vector.pkRm));
        const opened = await hpkeOpenBase({
          kem,
          recipientPrivateKey: recipient,
          recipientPublicKeyRaw: fromHex(vector.pkRm),
          enc: sealed.enc,
          info: fromHex(vector.info),
          aad: fromHex(first.aad),
          ciphertext: sealed.ciphertext,
        });
        expect(toHex(opened)).toBe(first.pt);
      });
    });
  }
});

describe('enclave RAM HPKE', () => {
  const COMPANY = 'co-1';

  for (const kem of ['DHKEM_X25519_HKDF_SHA256', 'DHKEM_P256_HKDF_SHA256'] as const) {
    it(`aller-retour d’un secret vers une enclave éphémère (${kem})`, async () => {
      const enclave = await createHpkeEnclave({ kem });
      const secret = crypto.getRandomValues(new Uint8Array(32));
      const envelope = await sealSecretForEnclave({
        kem,
        recipientPublicKeyRaw: enclave.publicKeyRaw,
        secret,
        companyId: COMPANY,
        purpose: 'liasse-simpl-is',
      });
      expect(envelope).toMatch(/^hpke1:[a-z0-9-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
      const opened = await enclave.openSecret(envelope, { companyId: COMPANY, purpose: 'liasse-simpl-is' });
      expect(opened).toEqual(secret);
      enclave.destroy();
    });
  }

  it('deux scellements du même secret diffèrent (clé éphémère de l’expéditeur)', async () => {
    const enclave = await createHpkeEnclave();
    const secret = new Uint8Array(32).fill(7);
    const args = { recipientPublicKeyRaw: enclave.publicKeyRaw, secret, companyId: COMPANY, purpose: 'p' };
    expect(await sealSecretForEnclave(args)).not.toBe(await sealSecretForEnclave(args));
    enclave.destroy();
  });

  it('société ou finalité différente refusée (info HPKE liée)', async () => {
    const enclave = await createHpkeEnclave();
    const envelope = await sealSecretForEnclave({
      recipientPublicKeyRaw: enclave.publicKeyRaw,
      secret: new Uint8Array(32).fill(1),
      companyId: COMPANY,
      purpose: 'a',
    });
    expect(await codeOf(enclave.openSecret(envelope, { companyId: 'co-2', purpose: 'a' }))).toBe('DECRYPTION_FAILED');
    expect(await codeOf(enclave.openSecret(envelope, { companyId: COMPANY, purpose: 'b' }))).toBe('DECRYPTION_FAILED');
    enclave.destroy();
  });

  it('une autre enclave ne peut pas ouvrir l’enveloppe ; altération et format invalide refusés', async () => {
    const enclave = await createHpkeEnclave();
    const other = await createHpkeEnclave();
    const envelope = await sealSecretForEnclave({
      recipientPublicKeyRaw: enclave.publicKeyRaw,
      secret: new Uint8Array(32).fill(1),
      companyId: COMPANY,
      purpose: 'a',
    });
    const ctx = { companyId: COMPANY, purpose: 'a' };
    expect(await codeOf(other.openSecret(envelope, ctx))).toBe('DECRYPTION_FAILED');
    const parts = envelope.split(':');
    const ct = parts[3] ?? '';
    const tampered = [parts[0], parts[1], parts[2], ct.slice(0, -1) + (ct.endsWith('A') ? 'B' : 'A')].join(':');
    expect(await codeOf(enclave.openSecret(tampered, ctx))).toBe('DECRYPTION_FAILED');
    for (const bad of ['', 'hpke1:x', 'hpke9:x25519:AA:AA', 'hpke1:unknown:AA:AA', 'hpke1:x25519:***:AA']) {
      expect(['INVALID_FORMAT', 'UNSUPPORTED_VERSION']).toContain(await codeOf(enclave.openSecret(bad, ctx)));
    }
    enclave.destroy();
    other.destroy();
  });

  it('destruction : l’enclave refuse tout déchiffrement ensuite, destroy est idempotent', async () => {
    const enclave = await createHpkeEnclave();
    const envelope = await sealSecretForEnclave({
      recipientPublicKeyRaw: enclave.publicKeyRaw,
      secret: new Uint8Array(32).fill(1),
      companyId: COMPANY,
      purpose: 'a',
    });
    expect(enclave.destroyed).toBe(false);
    enclave.destroy();
    enclave.destroy();
    expect(enclave.destroyed).toBe(true);
    expect(await codeOf(enclave.openSecret(envelope, { companyId: COMPANY, purpose: 'a' }))).toBe('ENCLAVE_DESTROYED');
  });

  it('la clé privée d’enclave est non extractible, jamais sérialisée', async () => {
    const enclave = await createHpkeEnclave();
    expect(enclave.privateKeyExtractable).toBe(false);
    const dumped = JSON.stringify(enclave);
    expect(dumped).not.toMatch(/"d"|privateKey|pkcs8/i);
    expect(Object.keys(enclave).sort()).toEqual(Object.keys(enclave).filter((k) => !/private/i.test(k)).sort());
    expect(String(enclave)).not.toMatch(/private/i);
    expect(enclave.publicKeyRaw).toHaveLength(32);
    enclave.destroy();
  });

  it('withOpenedSecret efface le secret en mémoire après usage, même en cas d’exception', async () => {
    const enclave = await createHpkeEnclave();
    const envelope = await sealSecretForEnclave({
      recipientPublicKeyRaw: enclave.publicKeyRaw,
      secret: new Uint8Array(32).fill(9),
      companyId: COMPANY,
      purpose: 'a',
    });
    let captured: Uint8Array = new Uint8Array(0);
    const value = await enclave.withOpenedSecret(envelope, { companyId: COMPANY, purpose: 'a' }, (secret) => {
      captured = secret;
      return secret.length;
    });
    expect(value).toBe(32);
    expect(captured.every((byte) => byte === 0)).toBe(true);

    await expect(
      enclave.withOpenedSecret(envelope, { companyId: COMPANY, purpose: 'a' }, (secret) => {
        captured = secret;
        throw new Error('échec métier');
      }),
    ).rejects.toThrow('échec métier');
    expect(captured.every((byte) => byte === 0)).toBe(true);
    enclave.destroy();
  });

  it('refuse un secret vide et une clé publique de mauvaise longueur', async () => {
    const enclave = await createHpkeEnclave();
    expect(
      await codeOf(sealSecretForEnclave({ recipientPublicKeyRaw: enclave.publicKeyRaw, secret: new Uint8Array(0), companyId: COMPANY, purpose: 'a' })),
    ).toBe('INVALID_INPUT');
    expect(
      await codeOf(sealSecretForEnclave({ recipientPublicKeyRaw: new Uint8Array(5), secret: new Uint8Array(32), companyId: COMPANY, purpose: 'a' })),
    ).toBe('INVALID_KEY');
    enclave.destroy();
  });
});
