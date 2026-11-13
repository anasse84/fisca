import { beforeAll, describe, expect, it } from 'vitest';
import {
  E2eeError,
  KEY_ENVELOPE_VERSION,
  RSA_OAEP_MODULUS_BITS,
  addActorGrant,
  createMemoryKeyGrantStore,
  decryptFieldWithAad,
  encryptFieldWithAad,
  generateActorKeyPair,
  generateTenantKeyMaterial,
  grantDekVersion,
  publicKeyFingerprintHex,
  revokeActorGrant,
  unwrapCurrentGrant,
  unwrapKeyGrant,
  wrapKeyMaterialForActor,
} from '../src/e2ee-engine.ts';
import { toBase64Url } from '../src/e2ee-encoding.ts';
import type { ActorKeyPair, E2eeErrorCode, KeyGrantRecord } from '../src/e2ee-engine.ts';

const COMPANY = 'co-1';
const OTHER_COMPANY = 'co-2';
const AAD = { companyId: COMPANY, tableName: 'fiscal_partners', recordId: 'rec-1', columnName: 'ice_enc' } as const;

let owner: ActorKeyPair;
let cpa: ActorKeyPair;
let erp: ActorKeyPair;
let intruder: ActorKeyPair;

beforeAll(async () => {
  [owner, cpa, erp, intruder] = await Promise.all([
    generateActorKeyPair(),
    generateActorKeyPair(),
    generateActorKeyPair(),
    generateActorKeyPair(),
  ]);
}, 120_000);

async function codeOf(promise: Promise<unknown>): Promise<E2eeErrorCode> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof E2eeError) return error.code;
    throw error;
  }
  throw new Error('une erreur E2eeError était attendue');
}

function ownerGrantee(): { role: 'OWNER_ADMIN'; actorId: string; publicKeySpkiB64: string } {
  return { role: 'OWNER_ADMIN', actorId: 'user-gerant', publicKeySpkiB64: owner.publicKeySpkiB64 };
}

describe('paire de clés d’acteur', () => {
  it('RSA-OAEP SHA-256 de 3072 bits, clé privée non extractible par défaut', async () => {
    expect(RSA_OAEP_MODULUS_BITS).toBe(3072);
    const algorithm = owner.privateKey.algorithm as RsaHashedKeyAlgorithm;
    expect(algorithm.name).toBe('RSA-OAEP');
    expect(algorithm.modulusLength).toBe(3072);
    expect(algorithm.hash.name).toBe('SHA-256');
    expect(owner.privateKey.extractable).toBe(false);
    expect(owner.publicKeyFingerprintHex).toMatch(/^[0-9a-f]{64}$/);
    expect(await publicKeyFingerprintHex(owner.publicKeySpkiB64)).toBe(owner.publicKeyFingerprintHex);
  });
});

describe('enveloppe par acteur', () => {
  it('aller-retour par acteur : DEK et clé d’index aveugle restitués', async () => {
    const material = generateTenantKeyMaterial();
    for (const [role, pair, actorId] of [
      ['OWNER_ADMIN', owner, 'a1'],
      ['EXTERNAL_CPA', cpa, 'a2'],
      ['ERP_CONNECTOR_AGENT', erp, 'a3'],
    ] as const) {
      const grant = await wrapKeyMaterialForActor({
        companyId: COMPANY,
        grantee: { role, actorId, publicKeySpkiB64: pair.publicKeySpkiB64 },
        material,
      });
      const opened = await unwrapKeyGrant({ companyId: COMPANY, grant, role, actorId, privateKey: pair.privateKey });
      expect(opened.dek).toEqual(material.dek);
      expect(opened.bidxKey).toEqual(material.bidxKey);
      expect(opened.dekVersion).toBe(1);
    }
  });

  it('format versionné v1:<version DEK>:<base64url> et enregistrement sans clair', async () => {
    const material = generateTenantKeyMaterial();
    const grant = await wrapKeyMaterialForActor({ companyId: COMPANY, grantee: ownerGrantee(), material });
    expect(KEY_ENVELOPE_VERSION).toBe('v1');
    expect(grant.wrappedDekB64).toMatch(new RegExp(`^v1:1:[A-Za-z0-9_-]{512}$`));
    expect(grant.wrappedBidxKeyB64).toMatch(/^v1:1:[A-Za-z0-9_-]{512}$/);
    expect(grantDekVersion(grant)).toBe(1);
    expect(grant.revokedAt).toBeNull();
    expect(grant.shamirShareIndex).toBeNull();
    expect(grant.granteeRole).toBe('OWNER_ADMIN');
    expect(JSON.stringify(grant)).not.toContain(toBase64Url(material.dek));
  });

  it('deux enveloppes de la même DEK diffèrent (OAEP randomisé)', async () => {
    const material = generateTenantKeyMaterial();
    const a = await wrapKeyMaterialForActor({ companyId: COMPANY, grantee: ownerGrantee(), material });
    const b = await wrapKeyMaterialForActor({ companyId: COMPANY, grantee: ownerGrantee(), material });
    expect(a.wrappedDekB64).not.toBe(b.wrappedDekB64);
  });

  it('un acteur non autorisé (autre clé privée) ne peut pas déballer', async () => {
    const material = generateTenantKeyMaterial();
    const grant = await wrapKeyMaterialForActor({ companyId: COMPANY, grantee: ownerGrantee(), material });
    expect(
      await codeOf(
        unwrapKeyGrant({ companyId: COMPANY, grant, role: 'OWNER_ADMIN', actorId: 'user-gerant', privateKey: intruder.privateKey }),
      ),
    ).toBe('DECRYPTION_FAILED');
  });

  it('une enveloppe d’une autre société est refusée', async () => {
    const material = generateTenantKeyMaterial();
    const grant = await wrapKeyMaterialForActor({ companyId: COMPANY, grantee: ownerGrantee(), material });
    expect(
      await codeOf(
        unwrapKeyGrant({ companyId: OTHER_COMPANY, grant, role: 'OWNER_ADMIN', actorId: 'user-gerant', privateKey: owner.privateKey }),
      ),
    ).toBe('DECRYPTION_FAILED');
  });

  it('une enveloppe rejouée pour un autre acteur ou un autre rôle est refusée', async () => {
    const material = generateTenantKeyMaterial();
    const grant = await wrapKeyMaterialForActor({ companyId: COMPANY, grantee: ownerGrantee(), material });
    const replayedActor: KeyGrantRecord = { ...grant, granteeActorId: 'user-autre' };
    expect(
      await codeOf(
        unwrapKeyGrant({ companyId: COMPANY, grant: replayedActor, role: 'OWNER_ADMIN', actorId: 'user-autre', privateKey: owner.privateKey }),
      ),
    ).toBe('DECRYPTION_FAILED');
    expect(
      await codeOf(
        unwrapKeyGrant({ companyId: COMPANY, grant, role: 'EXTERNAL_CPA', actorId: 'user-gerant', privateKey: owner.privateKey }),
      ),
    ).toBe('DECRYPTION_FAILED');
  });

  it('l’empreinte de clé publique est liée : SPKI substituée refusée', async () => {
    const material = generateTenantKeyMaterial();
    const grant = await wrapKeyMaterialForActor({ companyId: COMPANY, grantee: ownerGrantee(), material });
    const swapped: KeyGrantRecord = { ...grant, granteePublicKeySpkiB64: cpa.publicKeySpkiB64 };
    expect(
      await codeOf(
        unwrapKeyGrant({ companyId: COMPANY, grant: swapped, role: 'OWNER_ADMIN', actorId: 'user-gerant', privateKey: owner.privateKey }),
      ),
    ).toBe('DECRYPTION_FAILED');
  });

  it('la version de DEK est liée : version réécrite refusée', async () => {
    const material = generateTenantKeyMaterial();
    const grant = await wrapKeyMaterialForActor({ companyId: COMPANY, grantee: ownerGrantee(), material });
    const forged: KeyGrantRecord = {
      ...grant,
      wrappedDekB64: grant.wrappedDekB64.replace('v1:1:', 'v1:2:'),
      wrappedBidxKeyB64: grant.wrappedBidxKeyB64.replace('v1:1:', 'v1:2:'),
    };
    expect(
      await codeOf(unwrapKeyGrant({ companyId: COMPANY, grant: forged, role: 'OWNER_ADMIN', actorId: 'user-gerant', privateKey: owner.privateKey })),
    ).toBe('DECRYPTION_FAILED');
  });

  it('l’enveloppe de la DEK ne s’échange pas avec celle de la clé d’index aveugle', async () => {
    const material = generateTenantKeyMaterial();
    const grant = await wrapKeyMaterialForActor({ companyId: COMPANY, grantee: ownerGrantee(), material });
    const swapped: KeyGrantRecord = { ...grant, wrappedDekB64: grant.wrappedBidxKeyB64, wrappedBidxKeyB64: grant.wrappedDekB64 };
    expect(
      await codeOf(unwrapKeyGrant({ companyId: COMPANY, grant: swapped, role: 'OWNER_ADMIN', actorId: 'user-gerant', privateKey: owner.privateKey })),
    ).toBe('DECRYPTION_FAILED');
  });

  it('enveloppe altérée ou mal formée refusée sans fuite', async () => {
    const material = generateTenantKeyMaterial();
    const grant = await wrapKeyMaterialForActor({ companyId: COMPANY, grantee: ownerGrantee(), material });
    const last = grant.wrappedDekB64.slice(-1);
    const tampered: KeyGrantRecord = { ...grant, wrappedDekB64: grant.wrappedDekB64.slice(0, -1) + (last === 'A' ? 'B' : 'A') };
    const failure = await codeOf(
      unwrapKeyGrant({ companyId: COMPANY, grant: tampered, role: 'OWNER_ADMIN', actorId: 'user-gerant', privateKey: owner.privateKey }),
    );
    expect(failure).toBe('DECRYPTION_FAILED');
    for (const bad of ['', 'v1:1', 'v9:1:AAAA', 'v1:0:AAAA', 'v1:x:AAAA', 'v1:1:***']) {
      const code = await codeOf(
        unwrapKeyGrant({
          companyId: COMPANY,
          grant: { ...grant, wrappedDekB64: bad },
          role: 'OWNER_ADMIN',
          actorId: 'user-gerant',
          privateKey: owner.privateKey,
        }),
      );
      expect(['INVALID_FORMAT', 'UNSUPPORTED_VERSION']).toContain(code);
    }
    try {
      await unwrapKeyGrant({ companyId: COMPANY, grant: tampered, role: 'OWNER_ADMIN', actorId: 'user-gerant', privateKey: owner.privateKey });
    } catch (error) {
      expect(String((error as Error).message)).toBe('E2EE_DECRYPTION_FAILED');
    }
  });

  it('une enveloppe révoquée n’est plus déballée', async () => {
    const material = generateTenantKeyMaterial();
    const grant = await wrapKeyMaterialForActor({ companyId: COMPANY, grantee: ownerGrantee(), material });
    expect(
      await codeOf(
        unwrapKeyGrant({
          companyId: COMPANY,
          grant: { ...grant, revokedAt: '2026-01-01T00:00:00.000Z' },
          role: 'OWNER_ADMIN',
          actorId: 'user-gerant',
          privateKey: owner.privateKey,
        }),
      ),
    ).toBe('GRANT_REVOKED');
  });

  it('refuse une clé publique trop faible, un rôle inconnu et un identifiant contenant « | »', async () => {
    const weak = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt'],
    );
    const spki = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', weak.publicKey)));
    const material = generateTenantKeyMaterial();
    expect(
      await codeOf(wrapKeyMaterialForActor({ companyId: COMPANY, grantee: { role: 'EXTERNAL_CPA', actorId: 'x', publicKeySpkiB64: spki }, material })),
    ).toBe('INVALID_KEY');
    expect(
      await codeOf(
        wrapKeyMaterialForActor({
          companyId: COMPANY,
          grantee: { role: 'EXTERNAL_CPA', actorId: 'a|b', publicKeySpkiB64: cpa.publicKeySpkiB64 },
          material,
        }),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      await codeOf(
        wrapKeyMaterialForActor({
          companyId: COMPANY,
          grantee: { role: 'PIRATE' as never, actorId: 'a', publicKeySpkiB64: cpa.publicKeySpkiB64 },
          material,
        }),
      ),
    ).toBe('INVALID_INPUT');
  });
});

describe('ajout et révocation d’acteurs avec rotation de DEK', () => {
  async function seededStore(): Promise<{ store: ReturnType<typeof createMemoryKeyGrantStore>; dek1: Uint8Array }> {
    const store = createMemoryKeyGrantStore();
    const material = generateTenantKeyMaterial();
    await store.insertGrant(COMPANY, await wrapKeyMaterialForActor({ companyId: COMPANY, grantee: ownerGrantee(), material }));
    return { store, dek1: material.dek };
  }

  const ownerHolder = (): { role: 'OWNER_ADMIN'; actorId: string; privateKey: CryptoKey } => ({
    role: 'OWNER_ADMIN',
    actorId: 'user-gerant',
    privateKey: owner.privateKey,
  });

  it('ajout d’un cabinet par re-emballage depuis un détenteur de la DEK', async () => {
    const { store, dek1 } = await seededStore();
    const grant = await addActorGrant({
      store,
      companyId: COMPANY,
      holder: ownerHolder(),
      grantee: { role: 'EXTERNAL_CPA', actorId: 'cab-1', publicKeySpkiB64: cpa.publicKeySpkiB64 },
      now: '2026-02-01T10:00:00.000Z',
    });
    expect(grant.createdAt).toBe('2026-02-01T10:00:00.000Z');
    const opened = await unwrapCurrentGrant({
      store,
      companyId: COMPANY,
      actor: { role: 'EXTERNAL_CPA', actorId: 'cab-1', privateKey: cpa.privateKey },
    });
    expect(opened.dek).toEqual(dek1);
  });

  it('un non-détenteur ne peut pas ajouter d’acteur ; un doublon est refusé', async () => {
    const { store } = await seededStore();
    expect(
      await codeOf(
        addActorGrant({
          store,
          companyId: COMPANY,
          holder: { role: 'EXTERNAL_CPA', actorId: 'cab-1', privateKey: cpa.privateKey },
          grantee: { role: 'ERP_CONNECTOR_AGENT', actorId: 'erp-1', publicKeySpkiB64: erp.publicKeySpkiB64 },
        }),
      ),
    ).toBe('GRANT_NOT_FOUND');
    await addActorGrant({
      store,
      companyId: COMPANY,
      holder: ownerHolder(),
      grantee: { role: 'EXTERNAL_CPA', actorId: 'cab-1', publicKeySpkiB64: cpa.publicKeySpkiB64 },
    });
    expect(
      await codeOf(
        addActorGrant({
          store,
          companyId: COMPANY,
          holder: ownerHolder(),
          grantee: { role: 'EXTERNAL_CPA', actorId: 'cab-1', publicKeySpkiB64: cpa.publicKeySpkiB64 },
        }),
      ),
    ).toBe('GRANT_ALREADY_EXISTS');
  });

  it('révocation : rotation de la DEK, ré-emballage des restants, l’ancien cabinet ne déchiffre plus les nouvelles données', async () => {
    const { store } = await seededStore();
    await addActorGrant({
      store,
      companyId: COMPANY,
      holder: ownerHolder(),
      grantee: { role: 'EXTERNAL_CPA', actorId: 'cab-1', publicKeySpkiB64: cpa.publicKeySpkiB64 },
    });
    await addActorGrant({
      store,
      companyId: COMPANY,
      holder: ownerHolder(),
      grantee: { role: 'ERP_CONNECTOR_AGENT', actorId: 'erp-1', publicKeySpkiB64: erp.publicKeySpkiB64 },
    });

    const cpaBefore = await unwrapCurrentGrant({
      store,
      companyId: COMPANY,
      actor: { role: 'EXTERNAL_CPA', actorId: 'cab-1', privateKey: cpa.privateKey },
    });
    const cpaOldGrant = (await store.listGrants(COMPANY)).find((g) => g.granteeRole === 'EXTERNAL_CPA');
    if (cpaOldGrant === undefined) throw new Error('enveloppe du cabinet attendue');
    const oldData = await encryptFieldWithAad(await crypto.subtle.importKey('raw', cpaBefore.dek as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt']), 'ICE-ANCIEN', AAD);

    const result = await revokeActorGrant({
      store,
      companyId: COMPANY,
      holder: ownerHolder(),
      revoked: { role: 'EXTERNAL_CPA', actorId: 'cab-1' },
      now: '2026-03-01T08:00:00.000Z',
    });
    expect(result.newDekVersion).toBe(2);
    expect(result.regrantedActors).toBe(2);
    expect(result.material.dekVersion).toBe(2);
    expect(result.material.dek).not.toEqual(cpaBefore.dek);
    expect(result.material.bidxKey).toEqual(cpaBefore.bidxKey);

    // l’ancien cabinet n’a plus d’enveloppe active
    expect(
      await codeOf(unwrapCurrentGrant({ store, companyId: COMPANY, actor: { role: 'EXTERNAL_CPA', actorId: 'cab-1', privateKey: cpa.privateKey } })),
    ).toBe('GRANT_NOT_FOUND');
    // même en rejouant son ancienne ligne, la révocation est opposée
    const stored = (await store.listGrants(COMPANY)).filter((g) => g.granteeRole === 'EXTERNAL_CPA');
    expect(stored.every((g) => g.revokedAt === '2026-03-01T08:00:00.000Z')).toBe(true);

    // les acteurs restants lisent la nouvelle version
    for (const [role, actorId, pair] of [
      ['OWNER_ADMIN', 'user-gerant', owner],
      ['ERP_CONNECTOR_AGENT', 'erp-1', erp],
    ] as const) {
      const current = await unwrapCurrentGrant({ store, companyId: COMPANY, actor: { role, actorId, privateKey: pair.privateKey } });
      expect(current.dekVersion).toBe(2);
      expect(current.dek).toEqual(result.material.dek);
    }

    // nouvelles données chiffrées avec la DEK v2 : la DEK v1 de l’ancien cabinet échoue
    const dek2 = await crypto.subtle.importKey('raw', result.material.dek as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const dek1 = await crypto.subtle.importKey('raw', cpaBefore.dek as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const newData = await encryptFieldWithAad(dek2, 'ICE-NOUVEAU', AAD);
    await expect(decryptFieldWithAad(dek1, newData, AAD)).rejects.toBeInstanceOf(E2eeError);
    expect(await decryptFieldWithAad(dek2, newData, AAD)).toBe('ICE-NOUVEAU');
    // les archives antérieures (v1) restent lisibles par les acteurs restants qui conservent leur enveloppe v1
    expect(await decryptFieldWithAad(dek1, oldData, AAD)).toBe('ICE-ANCIEN');
    const remainingV1 = (await store.listGrants(COMPANY)).filter((g) => g.granteeRole === 'OWNER_ADMIN' && grantDekVersion(g) === 1);
    expect(remainingV1).toHaveLength(1);
    expect(remainingV1[0]?.revokedAt).toBeNull();
  });

  it('seul un OWNER_ADMIN révoque ; on ne révoque ni un inconnu ni le dernier propriétaire', async () => {
    const { store } = await seededStore();
    await addActorGrant({
      store,
      companyId: COMPANY,
      holder: ownerHolder(),
      grantee: { role: 'EXTERNAL_CPA', actorId: 'cab-1', publicKeySpkiB64: cpa.publicKeySpkiB64 },
    });
    expect(
      await codeOf(
        revokeActorGrant({
          store,
          companyId: COMPANY,
          holder: { role: 'EXTERNAL_CPA', actorId: 'cab-1', privateKey: cpa.privateKey },
          revoked: { role: 'OWNER_ADMIN', actorId: 'user-gerant' },
        }),
      ),
    ).toBe('ACTOR_NOT_AUTHORIZED');
    expect(
      await codeOf(revokeActorGrant({ store, companyId: COMPANY, holder: ownerHolder(), revoked: { role: 'EXTERNAL_CPA', actorId: 'inconnu' } })),
    ).toBe('GRANT_NOT_FOUND');
    expect(
      await codeOf(revokeActorGrant({ store, companyId: COMPANY, holder: ownerHolder(), revoked: { role: 'OWNER_ADMIN', actorId: 'user-gerant' } })),
    ).toBe('ACTOR_NOT_AUTHORIZED');
  });
});
