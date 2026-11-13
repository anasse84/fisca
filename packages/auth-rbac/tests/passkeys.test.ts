import { describe, expect, it } from 'vitest';
import {
  PASSKEY_CHALLENGE_TTL_SEC,
  PasskeyError,
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
} from '../src/index.ts';
import type { PasskeyChallengeRecord, PasskeyCredentialRecord, PasskeyDeps } from '../src/index.ts';
import {
  FLAG_AT,
  FLAG_BE,
  FLAG_UP,
  FLAG_UV,
  ORIGIN,
  RP_ID,
  b64u,
  cbor,
  createAuthenticator,
  fromB64u,
  makeAssertionResponse,
  makeRegistrationResponse,
} from './webauthn-fixtures.ts';
import type { Alg, CborValue, FakeAuthenticator } from './webauthn-fixtures.ts';

const NOW = 1_800_000_000;

function harness() {
  const challenges = new Map<string, PasskeyChallengeRecord>();
  const credentials = new Map<string, PasskeyCredentialRecord>();
  let now = NOW;
  const deps: PasskeyDeps = {
    config: { rpId: RP_ID, rpName: 'Fisca', allowedOrigins: [ORIGIN] },
    challenges: {
      save: async (record) => {
        challenges.set(record.challenge, record);
      },
      consume: async (challenge) => {
        const record = challenges.get(challenge) ?? null;
        challenges.delete(challenge);
        return record;
      },
    },
    credentials: {
      listByUser: async (userId) => [...credentials.values()].filter((item) => item.userId === userId),
      findByCredentialId: async (id) => credentials.get(id) ?? null,
      insert: async (record) => {
        if (credentials.has(record.credentialId)) {
          return false;
        }
        credentials.set(record.credentialId, record);
        return true;
      },
      updateSignCount: async (id, expectedPrevious, next, backupState) => {
        const row = credentials.get(id);
        if (row === undefined || row.signCount !== expectedPrevious) {
          return false;
        }
        credentials.set(id, { ...row, signCount: next, backupState });
        return true;
      },
    },
    nowEpochSec: () => now,
  };
  return {
    deps,
    challenges,
    credentials,
    advance: (seconds: number) => {
      now += seconds;
    },
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PasskeyError) {
      return error.code;
    }
    throw error;
  }
  return 'AUCUNE_ERREUR';
}

async function register(h: ReturnType<typeof harness>, authenticator: FakeAuthenticator, userId = 'user-1') {
  const options = await beginPasskeyRegistration(h.deps, { userId, userName: 'nadia@example.ma', displayName: 'Nadia' });
  const credential = await makeRegistrationResponse(authenticator, options.challenge);
  return finishPasskeyRegistration(h.deps, { userId, credential });
}

describe.each<Alg>(['ES256', 'EdDSA'])('passkeys WebAuthn — %s', (alg) => {
  it('enregistre un identifiant (attestation none) puis authentifie avec signCount monotone', async () => {
    const h = harness();
    const authenticator = await createAuthenticator(alg);
    const registered = await register(h, authenticator);
    expect(registered.credentialId).toBe(b64u(authenticator.credentialId));
    expect(registered.prfEnabled).toBe(true);
    expect(registered.algorithm).toBe(alg === 'ES256' ? -7 : -8);
    expect(h.credentials.size).toBe(1);

    for (let round = 1; round <= 2; round += 1) {
      const options = await beginPasskeyAuthentication(h.deps, { userId: 'user-1' });
      const credential = await makeAssertionResponse(authenticator, options.challenge);
      const result = await finishPasskeyAuthentication(h.deps, { credential });
      expect(result).toMatchObject({ userId: 'user-1', credentialId: registered.credentialId, signCount: round });
      expect(h.credentials.get(registered.credentialId)?.signCount).toBe(round);
    }
  });

  it('refuse une signature altérée', async () => {
    const h = harness();
    const authenticator = await createAuthenticator(alg);
    await register(h, authenticator);
    const options = await beginPasskeyAuthentication(h.deps, { userId: 'user-1' });
    const credential = await makeAssertionResponse(authenticator, options.challenge, { tamperSignature: true });
    expect(await codeOf(finishPasskeyAuthentication(h.deps, { credential }))).toBe('PASSKEY_SIGNATURE_INVALID');
  });

  it('refuse un signCount non monotone (clone) sans le faire reculer', async () => {
    const h = harness();
    const authenticator = await createAuthenticator(alg);
    const registered = await register(h, authenticator);
    const first = await beginPasskeyAuthentication(h.deps, { userId: 'user-1' });
    await finishPasskeyAuthentication(h.deps, {
      credential: await makeAssertionResponse(authenticator, first.challenge, { signCount: 10 }),
    });
    for (const signCount of [10, 9]) {
      const options = await beginPasskeyAuthentication(h.deps, { userId: 'user-1' });
      const credential = await makeAssertionResponse(authenticator, options.challenge, { signCount });
      expect(await codeOf(finishPasskeyAuthentication(h.deps, { credential }))).toBe('PASSKEY_SIGNCOUNT_REPLAY');
    }
    expect(h.credentials.get(registered.credentialId)?.signCount).toBe(10);
  });

  it('accepte un compteur à zéro tant que l’authentificateur n’en gère pas (passkeys synchronisées)', async () => {
    const h = harness();
    const authenticator = await createAuthenticator(alg);
    await register(h, authenticator);
    for (let round = 0; round < 2; round += 1) {
      const options = await beginPasskeyAuthentication(h.deps, { userId: 'user-1' });
      const credential = await makeAssertionResponse(authenticator, options.challenge, { signCount: 0 });
      await expect(finishPasskeyAuthentication(h.deps, { credential })).resolves.toMatchObject({ signCount: 0 });
    }
  });
});

describe('passkeys — options', () => {
  it('génère des options d’enregistrement avec challenge à usage unique, ES256/EdDSA, attestation none et PRF', async () => {
    const h = harness();
    await register(h, await createAuthenticator('ES256'), 'autre');
    const options = await beginPasskeyRegistration(h.deps, { userId: 'user-1', userName: 'nadia@example.ma', displayName: 'Nadia' });
    expect(fromB64u(options.challenge)).toHaveLength(32);
    expect(options.rp).toEqual({ id: RP_ID, name: 'Fisca' });
    expect(options.attestation).toBe('none');
    expect(options.pubKeyCredParams.map((param) => param.alg)).toEqual([-7, -8]);
    expect(options.authenticatorSelection.userVerification).toBe('required');
    expect(options.extensions.prf.eval.first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(options.user.name).toBe('nadia@example.ma');
    expect(options.excludeCredentials).toEqual([]);
    const saved = h.challenges.get(options.challenge);
    expect(saved).toMatchObject({ purpose: 'REGISTRATION', userId: 'user-1', expiresAtEpochSec: NOW + PASSKEY_CHALLENGE_TTL_SEC });
    const second = await beginPasskeyRegistration(h.deps, { userId: 'user-1', userName: 'n', displayName: 'N' });
    expect(second.challenge).not.toBe(options.challenge);
  });

  it('exclut les identifiants déjà enregistrés par l’utilisateur', async () => {
    const h = harness();
    const registered = await register(h, await createAuthenticator('ES256'));
    const options = await beginPasskeyRegistration(h.deps, { userId: 'user-1', userName: 'n', displayName: 'N' });
    expect(options.excludeCredentials.map((item) => item.id)).toEqual([registered.credentialId]);
  });

  it('génère des options d’authentification avec allowCredentials, UV requis et PRF', async () => {
    const h = harness();
    const registered = await register(h, await createAuthenticator('EdDSA'));
    const options = await beginPasskeyAuthentication(h.deps, { userId: 'user-1' });
    expect(options.rpId).toBe(RP_ID);
    expect(options.userVerification).toBe('required');
    expect(options.allowCredentials.map((item) => item.id)).toEqual([registered.credentialId]);
    expect(options.extensions.prf.eval.first).toMatch(/^[A-Za-z0-9_-]+$/);
    const discoverable = await beginPasskeyAuthentication(h.deps, {});
    expect(discoverable.allowCredentials).toEqual([]);
    expect(h.challenges.get(discoverable.challenge)?.userId).toBeNull();
  });
});

describe('passkeys — enregistrement : refus', () => {
  async function attempt(overrides: Parameters<typeof makeRegistrationResponse>[2], mutate?: (h: ReturnType<typeof harness>) => void) {
    const h = harness();
    const authenticator = await createAuthenticator('ES256');
    const options = await beginPasskeyRegistration(h.deps, { userId: 'user-1', userName: 'n', displayName: 'N' });
    mutate?.(h);
    const credential = await makeRegistrationResponse(authenticator, options.challenge, overrides);
    return { h, code: await codeOf(finishPasskeyRegistration(h.deps, { userId: 'user-1', credential })) };
  }

  it('refuse un mauvais type, une mauvaise origine, un mauvais rpId', async () => {
    expect((await attempt({ type: 'webauthn.get' })).code).toBe('PASSKEY_CLIENT_DATA_INVALID');
    expect((await attempt({ origin: 'https://evil.example' })).code).toBe('PASSKEY_ORIGIN_INVALID');
    expect((await attempt({ rpId: 'evil.example' })).code).toBe('PASSKEY_RP_ID_MISMATCH');
  });

  it('refuse l’absence de UP, de UV ou de données d’attestation', async () => {
    expect((await attempt({ flags: FLAG_UV | FLAG_AT })).code).toBe('PASSKEY_USER_PRESENCE_REQUIRED');
    expect((await attempt({ flags: FLAG_UP | FLAG_AT })).code).toBe('PASSKEY_USER_VERIFICATION_REQUIRED');
    expect((await attempt({ flags: FLAG_UP | FLAG_UV })).code).toBe('PASSKEY_REQUEST_MALFORMED');
  });

  it('refuse toute attestation autre que none', async () => {
    expect((await attempt({ fmt: 'packed' })).code).toBe('PASSKEY_ATTESTATION_UNSUPPORTED');
    expect((await attempt({ attStmt: new Map<string, CborValue>([['sig', new Uint8Array(4)]]) })).code).toBe(
      'PASSKEY_ATTESTATION_UNSUPPORTED',
    );
  });

  it('refuse un challenge expiré, rejoué ou lié à un autre utilisateur', async () => {
    expect((await attempt({}, (h) => h.advance(PASSKEY_CHALLENGE_TTL_SEC))).code).toBe('PASSKEY_CHALLENGE_UNKNOWN');
    const h = harness();
    const authenticator = await createAuthenticator('ES256');
    const options = await beginPasskeyRegistration(h.deps, { userId: 'user-1', userName: 'n', displayName: 'N' });
    const credential = await makeRegistrationResponse(authenticator, options.challenge);
    await finishPasskeyRegistration(h.deps, { userId: 'user-1', credential });
    expect(await codeOf(finishPasskeyRegistration(h.deps, { userId: 'user-1', credential }))).toBe('PASSKEY_CHALLENGE_UNKNOWN');
    const other = await beginPasskeyRegistration(h.deps, { userId: 'user-1', userName: 'n', displayName: 'N' });
    const stolen = await makeRegistrationResponse(await createAuthenticator('ES256'), other.challenge);
    expect(await codeOf(finishPasskeyRegistration(h.deps, { userId: 'user-2', credential: stolen }))).toBe('PASSKEY_USER_MISMATCH');
  });

  it('refuse un challenge d’authentification utilisé pour enregistrer', async () => {
    const h = harness();
    const options = await beginPasskeyAuthentication(h.deps, {});
    const credential = await makeRegistrationResponse(await createAuthenticator('ES256'), options.challenge);
    expect(await codeOf(finishPasskeyRegistration(h.deps, { userId: 'user-1', credential }))).toBe('PASSKEY_CHALLENGE_UNKNOWN');
  });

  it('refuse un identifiant déjà enregistré et une entrée mal formée', async () => {
    const h = harness();
    const authenticator = await createAuthenticator('ES256');
    await register(h, authenticator);
    const options = await beginPasskeyRegistration(h.deps, { userId: 'user-2', userName: 'n', displayName: 'N' });
    const credential = await makeRegistrationResponse(authenticator, options.challenge);
    expect(await codeOf(finishPasskeyRegistration(h.deps, { userId: 'user-2', credential }))).toBe('PASSKEY_CREDENTIAL_EXISTS');
    expect(await codeOf(finishPasskeyRegistration(h.deps, { userId: 'user-2', credential: 'x' }))).toBe('PASSKEY_REQUEST_MALFORMED');
    expect(await codeOf(finishPasskeyRegistration(h.deps, { userId: 'user-2', credential: { id: 1 } }))).toBe('PASSKEY_REQUEST_MALFORMED');
  });

  it('refuse un algorithme COSE non pris en charge (RS256)', async () => {
    const h = harness();
    const authenticator = await createAuthenticator('ES256');
    const rsaLike: FakeAuthenticator = {
      ...authenticator,
      coseKey: cbor(new Map<number, CborValue>([[1, 3], [3, -257], [-1, new Uint8Array(256)], [-2, new Uint8Array(3)]])),
    };
    const options = await beginPasskeyRegistration(h.deps, { userId: 'user-1', userName: 'n', displayName: 'N' });
    const credential = await makeRegistrationResponse(rsaLike, options.challenge);
    expect(await codeOf(finishPasskeyRegistration(h.deps, { userId: 'user-1', credential }))).toBe('PASSKEY_ALGORITHM_UNSUPPORTED');
  });
});

describe('passkeys — authentification : refus', () => {
  async function prepared() {
    const h = harness();
    const authenticator = await createAuthenticator('ES256');
    await register(h, authenticator);
    const options = await beginPasskeyAuthentication(h.deps, { userId: 'user-1' });
    return { h, authenticator, options };
  }

  it('refuse un challenge rejoué et un challenge expiré', async () => {
    const { h, authenticator, options } = await prepared();
    const credential = await makeAssertionResponse(authenticator, options.challenge);
    await finishPasskeyAuthentication(h.deps, { credential });
    expect(await codeOf(finishPasskeyAuthentication(h.deps, { credential }))).toBe('PASSKEY_CHALLENGE_UNKNOWN');
    const second = await beginPasskeyAuthentication(h.deps, { userId: 'user-1' });
    h.advance(PASSKEY_CHALLENGE_TTL_SEC);
    const late = await makeAssertionResponse(authenticator, second.challenge);
    expect(await codeOf(finishPasskeyAuthentication(h.deps, { credential: late }))).toBe('PASSKEY_CHALLENGE_UNKNOWN');
  });

  it('refuse un challenge inconnu, un mauvais type, une mauvaise origine, un mauvais rpId', async () => {
    const { h, authenticator, options } = await prepared();
    expect(await codeOf(finishPasskeyAuthentication(h.deps, { credential: await makeAssertionResponse(authenticator, 'inconnu') }))).toBe(
      'PASSKEY_CHALLENGE_UNKNOWN',
    );
    const cases: [Parameters<typeof makeAssertionResponse>[2], string][] = [
      [{ type: 'webauthn.create' }, 'PASSKEY_CLIENT_DATA_INVALID'],
      [{ origin: 'https://evil.example' }, 'PASSKEY_ORIGIN_INVALID'],
      [{ rpId: 'evil.example' }, 'PASSKEY_RP_ID_MISMATCH'],
      [{ flags: FLAG_UV }, 'PASSKEY_USER_PRESENCE_REQUIRED'],
      [{ flags: FLAG_UP }, 'PASSKEY_USER_VERIFICATION_REQUIRED'],
    ];
    for (const [overrides, expected] of cases) {
      const fresh = await beginPasskeyAuthentication(h.deps, { userId: 'user-1' });
      const credential = await makeAssertionResponse(authenticator, fresh.challenge, overrides);
      expect(await codeOf(finishPasskeyAuthentication(h.deps, { credential }))).toBe(expected);
    }
    expect(options.challenge.length).toBeGreaterThan(0);
  });

  it('refuse un identifiant inconnu, un autre utilisateur attendu ou un userHandle différent', async () => {
    const { h, authenticator, options } = await prepared();
    const stranger = await createAuthenticator('ES256');
    expect(await codeOf(finishPasskeyAuthentication(h.deps, { credential: await makeAssertionResponse(stranger, options.challenge) }))).toBe(
      'PASSKEY_CREDENTIAL_UNKNOWN',
    );
    const second = await beginPasskeyAuthentication(h.deps, { userId: 'user-1' });
    expect(
      await codeOf(
        finishPasskeyAuthentication(h.deps, { expectedUserId: 'user-2', credential: await makeAssertionResponse(authenticator, second.challenge) }),
      ),
    ).toBe('PASSKEY_USER_MISMATCH');
    const third = await beginPasskeyAuthentication(h.deps, { userId: 'user-1' });
    const wrongHandle = await makeAssertionResponse(authenticator, third.challenge, { userHandle: b64u(new TextEncoder().encode('user-2')) });
    expect(await codeOf(finishPasskeyAuthentication(h.deps, { credential: wrongHandle }))).toBe('PASSKEY_USER_MISMATCH');
  });

  it('refuse un challenge lié à un utilisateur quand l’identifiant appartient à un autre', async () => {
    const h = harness();
    const mine = await createAuthenticator('ES256');
    const theirs = await createAuthenticator('ES256');
    await register(h, mine, 'user-1');
    await register(h, theirs, 'user-2');
    const options = await beginPasskeyAuthentication(h.deps, { userId: 'user-1' });
    const credential = await makeAssertionResponse(theirs, options.challenge);
    expect(await codeOf(finishPasskeyAuthentication(h.deps, { credential }))).toBe('PASSKEY_USER_MISMATCH');
  });
});

describe('passkeys — extension PRF', () => {
  it('ne stocke ni ne renvoie jamais le résultat PRF envoyé par le client', async () => {
    const h = harness();
    const authenticator = await createAuthenticator('ES256');
    const secretResult = b64u(crypto.getRandomValues(new Uint8Array(32)));
    const options = await beginPasskeyRegistration(h.deps, { userId: 'user-1', userName: 'n', displayName: 'N' });
    const credential = await makeRegistrationResponse(authenticator, options.challenge, {
      extensions: { prf: { enabled: true, results: { first: secretResult } } },
    });
    const registered = await finishPasskeyRegistration(h.deps, { userId: 'user-1', credential });
    const auth = await beginPasskeyAuthentication(h.deps, { userId: 'user-1' });
    const assertion = await makeAssertionResponse(authenticator, auth.challenge, {
      extensions: { prf: { results: { first: secretResult } } },
    });
    const result = await finishPasskeyAuthentication(h.deps, { credential: assertion });
    expect(JSON.stringify([...h.credentials.values()])).not.toContain(secretResult);
    expect(JSON.stringify(registered)).not.toContain(secretResult);
    expect(JSON.stringify(result)).not.toContain(secretResult);
    expect(JSON.stringify([...h.challenges.values()])).not.toContain(secretResult);
  });

  it('mémorise si PRF est pris en charge ; absent => prfEnabled faux', async () => {
    const h = harness();
    const authenticator = await createAuthenticator('ES256');
    const options = await beginPasskeyRegistration(h.deps, { userId: 'user-1', userName: 'n', displayName: 'N' });
    const credential = await makeRegistrationResponse(authenticator, options.challenge, { extensions: {} });
    const registered = await finishPasskeyRegistration(h.deps, { userId: 'user-1', credential });
    expect(registered.prfEnabled).toBe(false);
    expect(h.credentials.get(registered.credentialId)?.prfEnabled).toBe(false);
  });

  it('mémorise les drapeaux de sauvegarde (BE) et la clé publique COSE', async () => {
    const h = harness();
    const authenticator = await createAuthenticator('ES256');
    const options = await beginPasskeyRegistration(h.deps, { userId: 'user-1', userName: 'n', displayName: 'N' });
    const credential = await makeRegistrationResponse(authenticator, options.challenge, {
      flags: FLAG_UP | FLAG_UV | FLAG_AT | FLAG_BE,
    });
    const registered = await finishPasskeyRegistration(h.deps, { userId: 'user-1', credential });
    const row = h.credentials.get(registered.credentialId);
    expect(row?.backupEligible).toBe(true);
    expect(row?.backupState).toBe(false);
    expect(row?.publicKeyCose).toBe(b64u(authenticator.coseKey));
    expect(row?.createdAtEpochSec).toBe(NOW);
  });
});
