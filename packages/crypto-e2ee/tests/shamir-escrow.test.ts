import { describe, expect, it, vi } from 'vitest';
import vectorFile from './golden/shamir-escrow.vectors.json';
import {
  ESCROW_HOLDER_ROLES,
  SHAMIR_SHARE_VERSION,
  E2eeError,
  gf256Inverse,
  gf256Multiply,
  parseShamirShare,
  reconstructEscrowSecret,
  reconstructSecretShamir2of3,
  sealEscrowSecret,
  serializeShamirShare,
  splitSecretShamir2of3,
} from '../src/e2ee-engine.ts';
import type { E2eeErrorCode, EscrowPresentation, ShamirShare } from '../src/e2ee-engine.ts';
import { fromBase64Url, toBase64Url } from '../src/e2ee-encoding.ts';

interface Vectors {
  readonly article: string;
  readonly date: string;
  readonly etat: string;
  readonly gf256: {
    readonly products: readonly { a: string; b: string; product: string }[];
    readonly inverses: readonly { a: string; inverse: string }[];
  };
  readonly shamir: { readonly secret: string; readonly shares: Readonly<Record<string, string>> };
}

const VECTORS: Vectors = vectorFile;

function hex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function random(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function codeOf(promise: Promise<unknown>): Promise<E2eeErrorCode> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof E2eeError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('NO_ERROR_THROWN');
}

function pick(shares: readonly [ShamirShare, ShamirShare, ShamirShare], i: number): ShamirShare {
  const share = shares[i];
  if (share === undefined) {
    throw new Error('MISSING');
  }
  return share;
}

describe('GF(256), polynôme AES 0x11b', () => {
  it('0x53 * 0xCA = 0x01 (inverses AES connus)', () => {
    expect(gf256Multiply(0x53, 0xca)).toBe(0x01);
    expect(gf256Inverse(0x53)).toBe(0xca);
  });

  it('reproduit les vecteurs FIPS 197 du fichier golden', () => {
    for (const v of VECTORS.gf256.products) {
      expect(gf256Multiply(hex(v.a)[0] ?? 0, hex(v.b)[0] ?? 0)).toBe(hex(v.product)[0]);
    }
    for (const v of VECTORS.gf256.inverses) {
      expect(gf256Inverse(hex(v.a)[0] ?? 0)).toBe(hex(v.inverse)[0]);
    }
  });

  it('a * inv(a) = 1 pour les 255 éléments non nuls, commutativité, distributivité', () => {
    for (let a = 1; a < 256; a += 1) {
      expect(gf256Multiply(a, gf256Inverse(a))).toBe(1);
      expect(gf256Multiply(a, 7)).toBe(gf256Multiply(7, a));
      expect(gf256Multiply(a, 0x35 ^ 0x4c)).toBe(gf256Multiply(a, 0x35) ^ gf256Multiply(a, 0x4c));
    }
  });

  it("l'inverse de zéro est refusé de façon typée", () => {
    expect(() => gf256Inverse(0)).toThrowError(E2eeError);
  });
});

describe('Shamir 2-sur-3', () => {
  it.each([1, 32, 64])('aller-retour sur les 3 paires pour un secret de %i octets', async (length) => {
    const secret = random(length);
    const shares = await splitSecretShamir2of3(secret);
    expect(shares.map((s) => s.index)).toEqual([1, 2, 3]);
    const pairs: readonly [number, number][] = [[0, 1], [0, 2], [1, 2], [1, 0], [2, 1]];
    for (const [i, j] of pairs) {
      expect(await reconstructSecretShamir2of3([pick(shares, i), pick(shares, j)])).toEqual(secret);
    }
    expect(await reconstructSecretShamir2of3([...shares])).toEqual(secret);
  });

  it('100 clés de 256 bits : toutes les paires reconstruisent exactement', async () => {
    for (let n = 0; n < 100; n += 1) {
      const secret = random(32);
      const shares = await splitSecretShamir2of3(secret);
      for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) {
        expect(await reconstructSecretShamir2of3([pick(shares, i), pick(shares, j)])).toEqual(secret);
      }
    }
  });

  it('une part seule est insuffisante', async () => {
    const shares = await splitSecretShamir2of3(random(32));
    expect(await codeOf(reconstructSecretShamir2of3([pick(shares, 0)]))).toBe('SHAMIR_INSUFFICIENT_SHARES');
    expect(await codeOf(reconstructSecretShamir2of3([]))).toBe('SHAMIR_INSUFFICIENT_SHARES');
  });

  it('la même part fournie deux fois est refusée', async () => {
    const shares = await splitSecretShamir2of3(random(32));
    expect(await codeOf(reconstructSecretShamir2of3([pick(shares, 1), pick(shares, 1)]))).toBe('SHAMIR_DUPLICATE_SHARE');
  });

  it('une part seule ne révèle rien : pour un octet de secret donné, toute valeur de part est atteignable et uniforme', async () => {
    const secret = new Uint8Array([0xa5]);
    const counts = new Array<number>(256).fill(0);
    for (let n = 0; n < 25_600; n += 1) {
      const shares = await splitSecretShamir2of3(secret);
      const y = fromBase64Url(pick(shares, 0).data)[0] ?? 0;
      counts[y] = (counts[y] ?? 0) + 1;
    }
    expect(counts.every((c) => c > 0)).toBe(true);
    // espérance 100 par valeur ; borne très large (~ 10 sigma) pour éviter un test instable
    expect(Math.max(...counts)).toBeLessThan(200);
    expect(Math.min(...counts)).toBeGreaterThan(30);
  });

  it('structurel : pour toute valeur de part et tout secret candidat, une pente unique existe', () => {
    const x = 2;
    for (const y of [0, 1, 0x7f, 0xff]) {
      for (const candidate of [0, 1, 0xa5, 0xff]) {
        const slope = gf256Multiply(y ^ candidate, gf256Inverse(x));
        expect(candidate ^ gf256Multiply(slope, x)).toBe(y);
      }
    }
  });

  it("l'aléa est différent à chaque partage et vient de crypto.getRandomValues", async () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    const math = vi.spyOn(Math, 'random');
    try {
      const secret = random(32);
      spy.mockClear();
      const a = await splitSecretShamir2of3(secret);
      const b = await splitSecretShamir2of3(secret);
      expect(spy).toHaveBeenCalled();
      expect(math).not.toHaveBeenCalled();
      expect(pick(a, 0).data).not.toBe(pick(b, 0).data);
      expect(pick(a, 0).setId).not.toBe(pick(b, 0).setId);
    } finally {
      spy.mockRestore();
      math.mockRestore();
    }
  });

  it('vecteur golden : reconstruit le secret à partir des parts calculées indépendamment', async () => {
    expect(VECTORS.article).toBe('Art. 211 CGI');
    expect(['RECOUPÉ', 'NON RECOUPÉ', 'PROVISOIRE']).toContain(VECTORS.etat);
    const secret = hex(VECTORS.shamir.secret);
    const setId = toBase64Url(new Uint8Array(8));
    const make = async (index: 1 | 2 | 3): Promise<ShamirShare> =>
      parseShamirShare(
        serializeShamirShare(await shareWithCheck(index, setId, hex(VECTORS.shamir.shares[String(index)] ?? ''))),
      );
    const s1 = await make(1);
    const s2 = await make(2);
    const s3 = await make(3);
    expect(await reconstructSecretShamir2of3([s1, s3])).toEqual(secret);
    expect(await reconstructSecretShamir2of3([s2, s3])).toEqual(secret);
    expect(await reconstructSecretShamir2of3([s1, s2, s3])).toEqual(secret);
  });

  it('refuse les secrets vides ou démesurés', async () => {
    expect(await codeOf(splitSecretShamir2of3(new Uint8Array(0)))).toBe('INVALID_INPUT');
    expect(await codeOf(splitSecretShamir2of3(new Uint8Array(4097)))).toBe('INVALID_INPUT');
  });
});

/** Construit une part valide (empreinte incluse) à partir d'octets donnés, via le format sérialisé public. */
async function shareWithCheck(index: 1 | 2 | 3, setId: string, data: Uint8Array): Promise<ShamirShare> {
  const { buildShamirShare } = await import('../src/shamir-escrow.ts');
  return buildShamirShare(index, setId, data);
}

describe('Parts sérialisées : version, index, empreinte de contrôle', () => {
  it('aller-retour de sérialisation avec version et index', async () => {
    const shares = await splitSecretShamir2of3(random(32));
    const text = serializeShamirShare(pick(shares, 1));
    expect(text.startsWith(`${SHAMIR_SHARE_VERSION}:2:`)).toBe(true);
    expect(await parseShamirShare(text)).toEqual(pick(shares, 1));
  });

  it('une part altérée est refusée (SHAMIR_SHARE_CORRUPT)', async () => {
    const shares = await splitSecretShamir2of3(random(32));
    const good = pick(shares, 0);
    const data = fromBase64Url(good.data);
    data[0] = (data[0] ?? 0) ^ 1;
    const tampered = { ...good, data: toBase64Url(data) };
    expect(await codeOf(reconstructSecretShamir2of3([tampered, pick(shares, 1)]))).toBe('SHAMIR_SHARE_CORRUPT');
    expect(await codeOf(parseShamirShare(serializeShamirShare(tampered)))).toBe('SHAMIR_SHARE_CORRUPT');
    const wrongIndex = { ...good, index: 3 } as ShamirShare;
    expect(await codeOf(reconstructSecretShamir2of3([wrongIndex, pick(shares, 1)]))).toBe('SHAMIR_SHARE_CORRUPT');
  });

  it('format invalide ou version inconnue', async () => {
    const shares = await splitSecretShamir2of3(random(32));
    const text = serializeShamirShare(pick(shares, 0));
    expect(await codeOf(parseShamirShare('n/importe/quoi'))).toBe('INVALID_FORMAT');
    expect(await codeOf(parseShamirShare(text.replace(SHAMIR_SHARE_VERSION, 'shm9')))).toBe('UNSUPPORTED_VERSION');
    expect(await codeOf(parseShamirShare(text.replace(':1:', ':4:')))).toBe('INVALID_FORMAT');
  });

  it('parts de deux partages différents mélangées : refusées', async () => {
    const secret = random(32);
    const first = await splitSecretShamir2of3(secret);
    const second = await splitSecretShamir2of3(secret);
    expect(await codeOf(reconstructSecretShamir2of3([pick(first, 0), pick(second, 1)]))).toBe('SHAMIR_SHARE_MISMATCH');
    const other = await splitSecretShamir2of3(random(32));
    expect(await codeOf(reconstructSecretShamir2of3([pick(first, 0), pick(other, 2)]))).toBe('SHAMIR_SHARE_MISMATCH');
  });

  it('longueurs différentes dans un même partage : refusées', async () => {
    const short = await splitSecretShamir2of3(random(16));
    const long = await splitSecretShamir2of3(random(32));
    const forged = { ...pick(long, 1), setId: pick(short, 0).setId };
    const rebuilt = await shareWithCheck(2, forged.setId, fromBase64Url(forged.data));
    expect(await codeOf(reconstructSecretShamir2of3([pick(short, 0), rebuilt]))).toBe('SHAMIR_SHARE_MISMATCH');
  });

  it('trois parts incohérentes (non alignées) refusées', async () => {
    const secret = random(32);
    const shares = await splitSecretShamir2of3(secret);
    const data = fromBase64Url(pick(shares, 2).data);
    data[5] = (data[5] ?? 0) ^ 0x10;
    const forged = await shareWithCheck(3, pick(shares, 2).setId, data);
    expect(await codeOf(reconstructSecretShamir2of3([pick(shares, 0), pick(shares, 1), forged]))).toBe('SHAMIR_SHARE_MISMATCH');
  });

  it('aucun message ne contient de part ni de secret', async () => {
    const secret = random(32);
    const shares = await splitSecretShamir2of3(secret);
    const data = fromBase64Url(pick(shares, 0).data);
    data[0] = (data[0] ?? 0) ^ 1;
    try {
      await reconstructSecretShamir2of3([{ ...pick(shares, 0), data: toBase64Url(data) }, pick(shares, 1)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).not.toContain(pick(shares, 0).data);
      expect(message).not.toContain(pick(shares, 1).data);
      expect(message).toMatch(/^E2EE_[A-Z_]+$/);
    }
  });

  it('ne journalise rien', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    try {
      const shares = await splitSecretShamir2of3(random(32));
      await reconstructSecretShamir2of3([pick(shares, 0), pick(shares, 2)]);
      await codeOf(reconstructSecretShamir2of3([pick(shares, 0)]));
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});

describe('Séquestre Art. 211 : détenteurs nommés', () => {
  const holders = [
    { role: 'MANDATAIRE_OEC', holderId: 'oec-001' },
    { role: 'HSM_SYNAPTIC', holderId: 'hsm-cold-01' },
    { role: 'TIERS_SEQUESTRE', holderId: 'sequestre-legal-7' },
  ] as const;

  it('les trois rôles de la spec (Doc_09 § 10, Doc_10 § 05) sont exposés', () => {
    expect(ESCROW_HOLDER_ROLES).toEqual(['MANDATAIRE_OEC', 'HSM_SYNAPTIC', 'TIERS_SEQUESTRE']);
  });

  it('scelle et reconstruit avec 2 détenteurs distincts, quelle que soit la paire', async () => {
    const secret = random(32);
    const sealed = await sealEscrowSecret(secret, holders);
    expect(sealed.map((s) => s.holderRole)).toEqual([...ESCROW_HOLDER_ROLES]);
    const presentation = (i: number): EscrowPresentation => {
      const item = sealed[i];
      if (item === undefined) {
        throw new Error('MISSING');
      }
      return { holderId: item.holderId, holderRole: item.holderRole, share: item.share };
    };
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) {
      expect(await reconstructEscrowSecret([presentation(i), presentation(j)])).toEqual(secret);
    }
    expect(await reconstructEscrowSecret([presentation(0), presentation(1), presentation(2)])).toEqual(secret);
  });

  it('un seul détenteur, ou le même détenteur deux fois, est refusé', async () => {
    const sealed = await sealEscrowSecret(random(32), holders);
    const first = sealed[0];
    const second = sealed[1];
    if (first === undefined || second === undefined) {
      throw new Error('MISSING');
    }
    const a: EscrowPresentation = { holderId: first.holderId, holderRole: first.holderRole, share: first.share };
    const b: EscrowPresentation = { holderId: second.holderId, holderRole: second.holderRole, share: second.share };
    expect(await codeOf(reconstructEscrowSecret([a]))).toBe('SHAMIR_INSUFFICIENT_SHARES');
    expect(await codeOf(reconstructEscrowSecret([a, a]))).toBe('SHAMIR_HOLDER_NOT_DISTINCT');
    // deux parts différentes présentées sous un même identifiant de détenteur
    expect(await codeOf(reconstructEscrowSecret([a, { ...b, holderId: a.holderId }]))).toBe('SHAMIR_HOLDER_NOT_DISTINCT');
    // deux parts différentes présentées sous un même rôle
    expect(await codeOf(reconstructEscrowSecret([a, { ...b, holderRole: a.holderRole }]))).toBe('SHAMIR_HOLDER_NOT_DISTINCT');
  });

  it("refuse une part présentée par un rôle qui n'est pas son détenteur", async () => {
    const sealed = await sealEscrowSecret(random(32), holders);
    const first = sealed[0];
    const second = sealed[1];
    if (first === undefined || second === undefined) {
      throw new Error('MISSING');
    }
    expect(
      await codeOf(
        reconstructEscrowSecret([
          { holderId: first.holderId, holderRole: 'HSM_SYNAPTIC', share: first.share },
          { holderId: second.holderId, holderRole: 'MANDATAIRE_OEC', share: second.share },
        ]),
      ),
    ).toBe('SHAMIR_SHARE_MISMATCH');
  });

  it('scellement : détenteurs non distincts, rôles manquants ou identifiants vides refusés', async () => {
    const secret = random(32);
    expect(await codeOf(sealEscrowSecret(secret, [holders[0], { ...holders[1], holderId: 'oec-001' }, holders[2]]))).toBe(
      'SHAMIR_HOLDER_NOT_DISTINCT',
    );
    expect(await codeOf(sealEscrowSecret(secret, [holders[0], holders[0], holders[2]]))).toBe('SHAMIR_HOLDER_NOT_DISTINCT');
    expect(await codeOf(sealEscrowSecret(secret, [holders[0], { ...holders[1], holderId: ' ' }, holders[2]]))).toBe('INVALID_INPUT');
  });

  it('part de deux scellements différents mélangées : refusées', async () => {
    const one = await sealEscrowSecret(random(32), holders);
    const two = await sealEscrowSecret(random(32), holders);
    const a = one[0];
    const b = two[1];
    if (a === undefined || b === undefined) {
      throw new Error('MISSING');
    }
    expect(
      await codeOf(
        reconstructEscrowSecret([
          { holderId: a.holderId, holderRole: a.holderRole, share: a.share },
          { holderId: b.holderId, holderRole: b.holderRole, share: b.share },
        ]),
      ),
    ).toBe('SHAMIR_SHARE_MISMATCH');
  });
});
