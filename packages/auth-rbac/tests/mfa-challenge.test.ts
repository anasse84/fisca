import { describe, expect, it } from 'vitest';
import {
  MFA_CHALLENGE_MAX_FAILED_ATTEMPTS,
  MFA_CHALLENGE_TTL_SEC,
  MfaError,
  RECOVERY_CODE_BATCH_SIZE,
  TOTP_STEP_SECONDS,
  buildOtpauthUri,
  completeMfaChallenge,
  createMfaRouter,
  decodeBase32,
  enableTotp,
  encodeBase32,
  findMatchingRecoveryCodeHash,
  generateRecoveryCodes,
  generateTotpCodeRfc6238,
  generateTotpSecretBase32,
  issueMfaChallengeToken,
  setupTotp,
  startMfaChallenge,
  verifyMfaChallengeToken,
  verifyTotpCodeRfc6238,
  verifyTotpWithReplayGuard,
} from '../src/index.ts';
import type {
  InfobipOtpVerifier,
  MfaChallengeStore,
  MfaEngineDeps,
  MfaFactorRecord,
  MfaFactorStore,
  MfaRouterDeps,
  MfaSessionAuthenticator,
  MfaSessionIssuer,
  MfaSessionRequest,
  RateLimiter,
  TotpReplayStore,
  TotpSecretVault,
  TurnstileVerifier,
} from '../src/index.ts';

// Valeurs factices de test uniquement : jamais une vraie clé de production.
const SIGNING_KEY = 'cle-de-signature-factice-de-test-32-octets-minimum';
const OTHER_KEY = 'autre-cle-de-signature-factice-de-test-32-octets';
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET_B32 = encodeBase32(new TextEncoder().encode(RFC_SECRET_ASCII));
const NOW = 1_800_000_000; // multiple de 30 : début exact d'un pas

// ---------------------------------------------------------------------------
// RFC 6238 annexe B (SHA-1) et base32
// ---------------------------------------------------------------------------

describe('TOTP RFC 6238 : vecteurs annexe B (SHA-1, secret ASCII 12345678901234567890)', () => {
  const vectors: readonly { readonly time: number; readonly eight: string }[] = [
    { time: 59, eight: '94287082' },
    { time: 1111111109, eight: '07081804' },
    { time: 1111111111, eight: '14050471' },
    { time: 1234567890, eight: '89005924' },
    { time: 2000000000, eight: '69279037' },
    { time: 20000000000, eight: '65353130' },
  ];

  it('le secret ASCII de la RFC se code en base32 canonique', () => {
    expect(RFC_SECRET_B32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(new TextDecoder().decode(decodeBase32(RFC_SECRET_B32))).toBe(RFC_SECRET_ASCII);
  });

  for (const vector of vectors) {
    it(`T=${vector.time} : 8 chiffres ${vector.eight} et 6 chiffres ${vector.eight.slice(2)}`, async () => {
      expect(await generateTotpCodeRfc6238({ base32Secret: RFC_SECRET_B32, nowEpochSec: vector.time, digits: 8 })).toBe(
        vector.eight,
      );
      const six = vector.eight.slice(2);
      expect(await generateTotpCodeRfc6238({ base32Secret: RFC_SECRET_B32, nowEpochSec: vector.time })).toBe(six);
      const result = await verifyTotpCodeRfc6238({
        base32Secret: RFC_SECRET_B32,
        sixDigitCode: six,
        nowEpochSec: vector.time,
        lastUsedStep: null,
      });
      expect(result).toEqual({ valid: true, matchedStep: Math.floor(vector.time / TOTP_STEP_SECONDS) });
    });
  }

  it('refuse un code qui n’a pas exactement 6 chiffres', async () => {
    for (const code of ['28708', '2870822', '28708a', ' 287082', '']) {
      const result = await verifyTotpCodeRfc6238({
        base32Secret: RFC_SECRET_B32,
        sixDigitCode: code,
        nowEpochSec: 59,
        lastUsedStep: null,
      });
      expect(result.valid).toBe(false);
    }
  });

  it('refuse un secret base32 invalide par une erreur typée', async () => {
    await expect(
      verifyTotpCodeRfc6238({ base32Secret: 'abc1!', sixDigitCode: '123456', nowEpochSec: 59, lastUsedStep: null }),
    ).rejects.toMatchObject({ code: 'TOTP_INVALID_BASE32_SECRET' });
  });
});

describe('TOTP : dérive ±1 pas', () => {
  const stepOf = (time: number): number => Math.floor(time / TOTP_STEP_SECONDS);

  it('accepte le pas courant, précédent et suivant', async () => {
    const code = await generateTotpCodeRfc6238({ base32Secret: RFC_SECRET_B32, nowEpochSec: NOW });
    for (const delta of [-TOTP_STEP_SECONDS, 0, TOTP_STEP_SECONDS]) {
      const result = await verifyTotpCodeRfc6238({
        base32Secret: RFC_SECRET_B32,
        sixDigitCode: code,
        nowEpochSec: NOW + delta,
        lastUsedStep: null,
      });
      expect(result).toEqual({ valid: true, matchedStep: stepOf(NOW) });
    }
  });

  it('refuse deux pas d’écart', async () => {
    const code = await generateTotpCodeRfc6238({ base32Secret: RFC_SECRET_B32, nowEpochSec: NOW });
    for (const delta of [-2 * TOTP_STEP_SECONDS, 2 * TOTP_STEP_SECONDS]) {
      const result = await verifyTotpCodeRfc6238({
        base32Secret: RFC_SECRET_B32,
        sixDigitCode: code,
        nowEpochSec: NOW + delta,
        lastUsedStep: null,
      });
      expect(result.valid).toBe(false);
    }
  });
});

describe('TOTP : anti-rejeu du même pas de 30 s', () => {
  it('un pas déjà accepté ne valide jamais une seconde fois (fonction pure)', async () => {
    const code = await generateTotpCodeRfc6238({ base32Secret: RFC_SECRET_B32, nowEpochSec: NOW });
    const first = await verifyTotpCodeRfc6238({
      base32Secret: RFC_SECRET_B32,
      sixDigitCode: code,
      nowEpochSec: NOW,
      lastUsedStep: null,
    });
    expect(first.valid).toBe(true);
    const replay = await verifyTotpCodeRfc6238({
      base32Secret: RFC_SECRET_B32,
      sixDigitCode: code,
      nowEpochSec: NOW + 5,
      lastUsedStep: first.matchedStep ?? null,
    });
    expect(replay.valid).toBe(false);
  });

  it('un pas antérieur au dernier pas accepté est aussi refusé', async () => {
    const older = await generateTotpCodeRfc6238({ base32Secret: RFC_SECRET_B32, nowEpochSec: NOW - TOTP_STEP_SECONDS });
    const result = await verifyTotpCodeRfc6238({
      base32Secret: RFC_SECRET_B32,
      sixDigitCode: older,
      nowEpochSec: NOW,
      lastUsedStep: NOW / TOTP_STEP_SECONDS,
    });
    expect(result.valid).toBe(false);
  });

  it('via le port TotpReplayStore : succès une fois, refus ensuite, sur le même utilisateur seulement', async () => {
    const replay = createMemoryReplayStore();
    const code = await generateTotpCodeRfc6238({ base32Secret: RFC_SECRET_B32, nowEpochSec: NOW });
    const params = { base32Secret: RFC_SECRET_B32, sixDigitCode: code, nowEpochSec: NOW, store: replay };
    expect(await verifyTotpWithReplayGuard({ ...params, userId: 'u1' })).toBe(true);
    expect(await verifyTotpWithReplayGuard({ ...params, userId: 'u1' })).toBe(false);
    expect(await verifyTotpWithReplayGuard({ ...params, userId: 'u2' })).toBe(true);
  });

  it('deux validations concurrentes du même pas : une seule réussit (compare-and-set)', async () => {
    const replay = createMemoryReplayStore();
    const code = await generateTotpCodeRfc6238({ base32Secret: RFC_SECRET_B32, nowEpochSec: NOW });
    const params = { userId: 'u1', base32Secret: RFC_SECRET_B32, sixDigitCode: code, nowEpochSec: NOW, store: replay };
    const outcomes = await Promise.all([verifyTotpWithReplayGuard(params), verifyTotpWithReplayGuard(params)]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });

  it('un mauvais code ne consomme pas le pas', async () => {
    const replay = createMemoryReplayStore();
    const good = await generateTotpCodeRfc6238({ base32Secret: RFC_SECRET_B32, nowEpochSec: NOW });
    const bad = good === '000000' ? '000001' : '000000';
    const base = { userId: 'u1', base32Secret: RFC_SECRET_B32, nowEpochSec: NOW, store: replay };
    expect(await verifyTotpWithReplayGuard({ ...base, sixDigitCode: bad })).toBe(false);
    expect(await verifyTotpWithReplayGuard({ ...base, sixDigitCode: good })).toBe(true);
  });
});

describe('TOTP : secret et URI otpauth', () => {
  it('génère un secret base32 de 160 bits, différent à chaque appel', () => {
    const a = generateTotpSecretBase32();
    const b = generateTotpSecretBase32();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(decodeBase32(a)).toHaveLength(20);
    expect(a).not.toBe(b);
  });

  it('construit une URI otpauth://totp conforme', () => {
    const uri = buildOtpauthUri({ issuer: 'Fisca', accountName: 'a.b@exemple.ma', base32Secret: RFC_SECRET_B32 });
    expect(uri).toBe(
      `otpauth://totp/Fisca:a.b%40exemple.ma?secret=${RFC_SECRET_B32}&issuer=Fisca&algorithm=SHA1&digits=6&period=30`,
    );
  });

  it('encode et décode le base32 sans perte', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(decodeBase32(encodeBase32(bytes)))).toEqual(Array.from(bytes));
  });
});

// ---------------------------------------------------------------------------
// Codes de secours
// ---------------------------------------------------------------------------

describe('Codes de secours', () => {
  it('génère un lot de 10 codes uniques, haute entropie, stockés uniquement en empreinte salée', async () => {
    const batch = await generateRecoveryCodes();
    expect(RECOVERY_CODE_BATCH_SIZE).toBe(10);
    expect(batch.codes).toHaveLength(10);
    expect(new Set(batch.codes).size).toBe(10);
    expect(batch.hashes).toHaveLength(10);
    expect(new Set(batch.hashes).size).toBe(10);
    for (const code of batch.codes) {
      expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    }
    for (const stored of batch.hashes) {
      expect(stored).toMatch(/^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
      for (const code of batch.codes) {
        expect(stored).not.toContain(code.replace(/-/g, ''));
      }
    }
  });

  it('deux lots différents donnent des empreintes différentes (sel par code)', async () => {
    const a = await generateRecoveryCodes();
    const b = await generateRecoveryCodes();
    expect(a.hashes.some((hash) => b.hashes.includes(hash))).toBe(false);
  });

  it('retrouve l’empreinte d’un code, insensible à la casse et aux tirets', async () => {
    const batch = await generateRecoveryCodes();
    const code = batch.codes[3] ?? '';
    expect(await findMatchingRecoveryCodeHash(code, batch.hashes)).toBe(batch.hashes[3]);
    expect(await findMatchingRecoveryCodeHash(code.toLowerCase().replace(/-/g, ' '), batch.hashes)).toBe(batch.hashes[3]);
    expect(await findMatchingRecoveryCodeHash('AAAA-BBBB-CCCC-DDDD', batch.hashes)).toBeNull();
    expect(await findMatchingRecoveryCodeHash('', batch.hashes)).toBeNull();
    expect(await findMatchingRecoveryCodeHash(code, ['malformé'])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mfa_challenge_token
// ---------------------------------------------------------------------------

describe('mfa_challenge_token', () => {
  it('est valable 5 minutes, lié à l’utilisateur et à la méthode du premier facteur', async () => {
    const issued = await issueMfaChallengeToken({
      userId: 'u1',
      firstFactor: 'GOOGLE_OAUTH',
      signingKey: SIGNING_KEY,
      nowEpochSec: NOW,
    });
    expect(MFA_CHALLENGE_TTL_SEC).toBe(300);
    expect(issued.expiresAtEpochSec).toBe(NOW + 300);
    const claims = await verifyMfaChallengeToken({ token: issued.token, signingKey: SIGNING_KEY, nowEpochSec: NOW + 299 });
    expect(claims).toMatchObject({ userId: 'u1', firstFactor: 'GOOGLE_OAUTH', jti: issued.jti, expiresAtEpochSec: NOW + 300 });
  });

  it('refuse un jeton expiré (borne incluse)', async () => {
    const issued = await issueMfaChallengeToken({ userId: 'u1', firstFactor: 'PASSWORD', signingKey: SIGNING_KEY, nowEpochSec: NOW });
    await expect(
      verifyMfaChallengeToken({ token: issued.token, signingKey: SIGNING_KEY, nowEpochSec: NOW + 300 }),
    ).rejects.toMatchObject({ code: 'MFA_CHALLENGE_EXPIRED' });
  });

  it('refuse un jeton falsifié (charge modifiée, signature modifiée, autre clé, format absurde)', async () => {
    const issued = await issueMfaChallengeToken({ userId: 'u1', firstFactor: 'PASSWORD', signingKey: SIGNING_KEY, nowEpochSec: NOW });
    const [prefix, payload, signature] = issued.token.split('.');
    const forgedPayload = btoa(JSON.stringify({ sub: 'u2' })).replace(/=+$/g, '');
    const flipped = `${(signature ?? '').slice(0, -2)}${(signature ?? '').endsWith('AA') ? 'BB' : 'AA'}`;
    const cases: readonly (readonly [string, string, string])[] = [
      [`${prefix}.${forgedPayload}.${signature}`, SIGNING_KEY, 'MFA_CHALLENGE_SIGNATURE_INVALID'],
      [`${prefix}.${payload}.${flipped}`, SIGNING_KEY, 'MFA_CHALLENGE_SIGNATURE_INVALID'],
      [issued.token, OTHER_KEY, 'MFA_CHALLENGE_SIGNATURE_INVALID'],
      ['', SIGNING_KEY, 'MFA_CHALLENGE_MALFORMED'],
      ['abc', SIGNING_KEY, 'MFA_CHALLENGE_MALFORMED'],
      [`${prefix}.${payload}`, SIGNING_KEY, 'MFA_CHALLENGE_MALFORMED'],
      [`autre.${payload}.${signature}`, SIGNING_KEY, 'MFA_CHALLENGE_MALFORMED'],
    ];
    for (const [token, key, code] of cases) {
      await expect(verifyMfaChallengeToken({ token, signingKey: key, nowEpochSec: NOW })).rejects.toMatchObject({ code });
    }
  });

  it('refuse un jeton présenté pour un autre utilisateur', async () => {
    const issued = await issueMfaChallengeToken({ userId: 'u1', firstFactor: 'PASSWORD', signingKey: SIGNING_KEY, nowEpochSec: NOW });
    await expect(
      verifyMfaChallengeToken({ token: issued.token, signingKey: SIGNING_KEY, nowEpochSec: NOW, expectedUserId: 'u2' }),
    ).rejects.toMatchObject({ code: 'MFA_CHALLENGE_USER_MISMATCH' });
    await expect(
      verifyMfaChallengeToken({ token: issued.token, signingKey: SIGNING_KEY, nowEpochSec: NOW, expectedUserId: 'u1' }),
    ).resolves.toMatchObject({ userId: 'u1' });
  });

  it('refuse une clé de signature trop courte (aucun secret en dur, aucune clé faible)', async () => {
    await expect(
      issueMfaChallengeToken({ userId: 'u1', firstFactor: 'PASSWORD', signingKey: 'court', nowEpochSec: NOW }),
    ).rejects.toMatchObject({ code: 'MFA_SIGNING_KEY_INVALID' });
  });

  it('chaque émission produit un identifiant unique', async () => {
    const a = await issueMfaChallengeToken({ userId: 'u1', firstFactor: 'PASSWORD', signingKey: SIGNING_KEY, nowEpochSec: NOW });
    const b = await issueMfaChallengeToken({ userId: 'u1', firstFactor: 'PASSWORD', signingKey: SIGNING_KEY, nowEpochSec: NOW });
    expect(a.jti).not.toBe(b.jti);
    expect(a.token).not.toBe(b.token);
  });
});

// ---------------------------------------------------------------------------
// Harnais de ports en mémoire
// ---------------------------------------------------------------------------

function createMemoryReplayStore(): TotpReplayStore {
  const steps = new Map<string, number>();
  return {
    getLastUsedStep: async (userId) => steps.get(userId) ?? null,
    advanceLastUsedStep: async (userId, step) => {
      const current = steps.get(userId);
      if (current !== undefined && step <= current) {
        return false;
      }
      steps.set(userId, step);
      return true;
    },
  };
}

interface Harness {
  readonly deps: MfaEngineDeps;
  readonly clock: { now: number };
  readonly factors: Map<string, MfaFactorRecord>;
  readonly sessions: { readonly userId: string; readonly secondFactor: string; readonly firstFactor: string }[];
  readonly infobipCalls: { readonly userId: string; readonly code: string }[];
}

function buildHarness(options: { infobipAccepts?: string; withInfobip?: boolean } = {}): Harness {
  const clock = { now: NOW };
  const factors = new Map<string, MfaFactorRecord>();
  const sessions: { userId: string; secondFactor: string; firstFactor: string }[] = [];
  const infobipCalls: { userId: string; code: string }[] = [];
  const consumed = new Set<string>();
  const failures = new Map<string, number>();

  const store: MfaFactorStore = {
    getFactor: async (userId) => factors.get(userId) ?? null,
    savePendingTotpSecret: async (userId, sealedSecret) => {
      factors.set(userId, { sealedTotpSecret: sealedSecret, totpVerifiedAtEpochSec: null, recoveryCodeHashes: [] });
    },
    activateTotp: async (userId, input) => {
      const current = factors.get(userId);
      factors.set(userId, {
        sealedTotpSecret: current?.sealedTotpSecret ?? null,
        totpVerifiedAtEpochSec: input.verifiedAtEpochSec,
        recoveryCodeHashes: input.recoveryCodeHashes,
      });
    },
    consumeRecoveryCodeHash: async (userId, hash) => {
      const current = factors.get(userId);
      if (current === undefined || !current.recoveryCodeHashes.includes(hash)) {
        return false;
      }
      factors.set(userId, { ...current, recoveryCodeHashes: current.recoveryCodeHashes.filter((entry) => entry !== hash) });
      return true;
    },
  };
  // Coffre factice de test : le vrai chiffrement relève de crypto-e2ee (ticket ultérieur).
  const vault: TotpSecretVault = {
    seal: async (userId, base32Secret) => `sealed:${userId}:${base32Secret}`,
    open: async (userId, sealed) => {
      const prefix = `sealed:${userId}:`;
      if (!sealed.startsWith(prefix)) {
        throw new Error('VAULT_AAD_MISMATCH');
      }
      return sealed.slice(prefix.length);
    },
  };
  const challengeStore: MfaChallengeStore = {
    isConsumed: async (jti) => consumed.has(jti),
    consume: async (jti) => {
      if (consumed.has(jti)) {
        return false;
      }
      consumed.add(jti);
      return true;
    },
    failureCount: async (jti) => failures.get(jti) ?? 0,
    recordFailure: async (jti) => {
      const next = (failures.get(jti) ?? 0) + 1;
      failures.set(jti, next);
      return next;
    },
  };
  const sessionIssuer: MfaSessionIssuer = {
    issueSession: async (input) => {
      sessions.push({ userId: input.userId, secondFactor: input.secondFactor, firstFactor: input.firstFactor });
      return { accessToken: `jwt-factice-${input.userId}-${sessions.length}`, expiresInSec: 900, setCookie: null };
    },
  };
  const infobip: InfobipOtpVerifier = {
    verify: async (input) => {
      infobipCalls.push({ userId: input.userId, code: input.code });
      return input.code === options.infobipAccepts;
    },
  };
  const deps: MfaEngineDeps = {
    factors: store,
    secretVault: vault,
    replay: createMemoryReplayStore(),
    challenges: challengeStore,
    sessions: sessionIssuer,
    ...(options.withInfobip === false ? {} : { infobip }),
    signingKey: SIGNING_KEY,
    issuerName: 'Fisca',
    nowEpochSec: () => clock.now,
  };
  return { deps, clock, factors, sessions, infobipCalls };
}

/** Inscrit un utilisateur au TOTP par les fonctions du moteur ; renvoie secret et codes de secours. */
async function enrollUser(harness: Harness, userId: string): Promise<{ secret: string; recoveryCodes: readonly string[] }> {
  const setup = await setupTotp(harness.deps, { userId, accountLabel: `${userId}@exemple.ma` });
  const code = await generateTotpCodeRfc6238({ base32Secret: setup.secret, nowEpochSec: harness.clock.now });
  const enabled = await enableTotp(harness.deps, { userId, code });
  harness.clock.now += 120; // le pas d'enrôlement est consommé : on avance l'horloge
  return { secret: setup.secret, recoveryCodes: enabled.recoveryCodes };
}

async function challengeFor(harness: Harness, userId: string, firstFactor: 'PASSWORD' | 'GOOGLE_OAUTH' = 'PASSWORD'): Promise<string> {
  const started = await startMfaChallenge(harness.deps, { userId, firstFactor });
  if (started.status !== 'MFA_REQUIRED') {
    throw new Error('défi attendu');
  }
  return started.mfaChallengeToken;
}

async function expectMfaError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(MfaError);
  await expect(promise).rejects.toMatchObject({ code });
}

// ---------------------------------------------------------------------------
// Moteur : enrôlement
// ---------------------------------------------------------------------------

describe('Moteur 2FA : enrôlement TOTP', () => {
  it('setup stocke le secret scellé (jamais en clair) et renvoie secret + URI', async () => {
    const harness = buildHarness();
    const setup = await setupTotp(harness.deps, { userId: 'u1', accountLabel: 'u1@exemple.ma' });
    expect(setup.otpauthUri).toContain(`secret=${setup.secret}`);
    expect(setup.otpauthUri.startsWith('otpauth://totp/Fisca:')).toBe(true);
    const stored = harness.factors.get('u1');
    expect(stored?.sealedTotpSecret).toBe(`sealed:u1:${setup.secret}`);
    expect(stored?.totpVerifiedAtEpochSec).toBeNull();
  });

  it('enable refuse un mauvais code, puis active et renvoie 10 codes de secours stockés en empreintes', async () => {
    const harness = buildHarness();
    const setup = await setupTotp(harness.deps, { userId: 'u1', accountLabel: 'u1@exemple.ma' });
    const good = await generateTotpCodeRfc6238({ base32Secret: setup.secret, nowEpochSec: NOW });
    const bad = good === '000000' ? '000001' : '000000';
    await expectMfaError(enableTotp(harness.deps, { userId: 'u1', code: bad }), 'TOTP_CODE_INVALID');
    expect(harness.factors.get('u1')?.totpVerifiedAtEpochSec).toBeNull();
    const enabled = await enableTotp(harness.deps, { userId: 'u1', code: good });
    expect(enabled.recoveryCodes).toHaveLength(10);
    const record = harness.factors.get('u1');
    expect(record?.totpVerifiedAtEpochSec).toBe(NOW);
    expect(record?.recoveryCodeHashes).toHaveLength(10);
    for (const code of enabled.recoveryCodes) {
      expect(JSON.stringify(record)).not.toContain(code.replace(/-/g, ''));
    }
  });

  it('enable sans setup préalable est refusé ; setup sur un 2FA déjà actif est refusé', async () => {
    const harness = buildHarness();
    await expectMfaError(enableTotp(harness.deps, { userId: 'u1', code: '123456' }), 'TOTP_SETUP_REQUIRED');
    await enrollUser(harness, 'u1');
    await expectMfaError(setupTotp(harness.deps, { userId: 'u1', accountLabel: 'x' }), 'TOTP_ALREADY_ENABLED');
  });

  it('le code d’enrôlement ne peut pas être rejoué pour franchir un défi (même pas de 30 s)', async () => {
    const harness = buildHarness();
    const setup = await setupTotp(harness.deps, { userId: 'u1', accountLabel: 'x' });
    const code = await generateTotpCodeRfc6238({ base32Secret: setup.secret, nowEpochSec: NOW });
    await enableTotp(harness.deps, { userId: 'u1', code });
    const token = await challengeFor(harness, 'u1');
    await expectMfaError(completeMfaChallenge(harness.deps, { token, method: 'TOTP', code }), 'MFA_CODE_INVALID');
    expect(harness.sessions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Moteur : étanchéité du mfa_challenge_token
// ---------------------------------------------------------------------------

describe('Moteur 2FA : étanchéité du mfa_challenge_token', () => {
  it('sans enrôlement, aucun défi n’est émis (le flux normal garde la main)', async () => {
    const harness = buildHarness();
    expect(await startMfaChallenge(harness.deps, { userId: 'u1', firstFactor: 'PASSWORD' })).toEqual({ status: 'MFA_NOT_ENROLLED' });
    await setupTotp(harness.deps, { userId: 'u1', accountLabel: 'x' });
    expect(await startMfaChallenge(harness.deps, { userId: 'u1', firstFactor: 'PASSWORD' })).toEqual({ status: 'MFA_NOT_ENROLLED' });
  });

  it('émettre un défi (Email ou Google) ne crée aucune session', async () => {
    const harness = buildHarness();
    await enrollUser(harness, 'u1');
    await challengeFor(harness, 'u1', 'PASSWORD');
    await challengeFor(harness, 'u1', 'GOOGLE_OAUTH');
    expect(harness.sessions).toHaveLength(0);
  });

  it('un code TOTP valide échange le défi (Google) contre une session portant les deux facteurs, une seule fois', async () => {
    const harness = buildHarness();
    const { secret } = await enrollUser(harness, 'u1');
    const token = await challengeFor(harness, 'u1', 'GOOGLE_OAUTH');
    const code = await generateTotpCodeRfc6238({ base32Secret: secret, nowEpochSec: harness.clock.now });
    const result = await completeMfaChallenge(harness.deps, { token, method: 'TOTP', code });
    expect(result.session.accessToken).toContain('u1');
    expect(harness.sessions).toEqual([{ userId: 'u1', firstFactor: 'GOOGLE_OAUTH', secondFactor: 'TOTP' }]);
    // jeton rejoué avec un code frais du pas suivant : refusé, pas de seconde session
    harness.clock.now += 30;
    const fresh = await generateTotpCodeRfc6238({ base32Secret: secret, nowEpochSec: harness.clock.now });
    await expectMfaError(completeMfaChallenge(harness.deps, { token, method: 'TOTP', code: fresh }), 'MFA_CHALLENGE_REPLAYED');
    expect(harness.sessions).toHaveLength(1);
  });

  it('anti-rejeu : le même code TOTP ne passe pas deux défis successifs dans le même pas', async () => {
    const harness = buildHarness();
    const { secret } = await enrollUser(harness, 'u1');
    const code = await generateTotpCodeRfc6238({ base32Secret: secret, nowEpochSec: harness.clock.now });
    const first = await challengeFor(harness, 'u1');
    await completeMfaChallenge(harness.deps, { token: first, method: 'TOTP', code });
    const second = await challengeFor(harness, 'u1');
    await expectMfaError(completeMfaChallenge(harness.deps, { token: second, method: 'TOTP', code }), 'MFA_CODE_INVALID');
    expect(harness.sessions).toHaveLength(1);
  });

  it('un mauvais code ne produit aucune session et le jeton se verrouille après 5 échecs', async () => {
    const harness = buildHarness();
    const { secret } = await enrollUser(harness, 'u1');
    const token = await challengeFor(harness, 'u1');
    const good = await generateTotpCodeRfc6238({ base32Secret: secret, nowEpochSec: harness.clock.now });
    const bad = good === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < MFA_CHALLENGE_MAX_FAILED_ATTEMPTS; attempt += 1) {
      await expectMfaError(completeMfaChallenge(harness.deps, { token, method: 'TOTP', code: bad }), 'MFA_CODE_INVALID');
    }
    await expectMfaError(completeMfaChallenge(harness.deps, { token, method: 'TOTP', code: good }), 'MFA_CHALLENGE_ATTEMPTS_EXHAUSTED');
    expect(harness.sessions).toHaveLength(0);
  });

  it('un jeton expiré est refusé même avec un code valide', async () => {
    const harness = buildHarness();
    const { secret } = await enrollUser(harness, 'u1');
    const token = await challengeFor(harness, 'u1');
    harness.clock.now += 300;
    const code = await generateTotpCodeRfc6238({ base32Secret: secret, nowEpochSec: harness.clock.now });
    await expectMfaError(completeMfaChallenge(harness.deps, { token, method: 'TOTP', code }), 'MFA_CHALLENGE_EXPIRED');
    expect(harness.sessions).toHaveLength(0);
  });

  it('un jeton falsifié ou signé par une autre clé est refusé', async () => {
    const harness = buildHarness();
    const { secret } = await enrollUser(harness, 'u1');
    const forged = await issueMfaChallengeToken({ userId: 'u1', firstFactor: 'PASSWORD', signingKey: OTHER_KEY, nowEpochSec: harness.clock.now });
    const code = await generateTotpCodeRfc6238({ base32Secret: secret, nowEpochSec: harness.clock.now });
    await expectMfaError(completeMfaChallenge(harness.deps, { token: forged.token, method: 'TOTP', code }), 'MFA_CHALLENGE_SIGNATURE_INVALID');
    expect(harness.sessions).toHaveLength(0);
  });

  it('le jeton d’un utilisateur ne valide jamais le facteur d’un autre', async () => {
    const harness = buildHarness();
    const alice = await enrollUser(harness, 'alice');
    const bob = await enrollUser(harness, 'bob');
    const tokenAlice = await challengeFor(harness, 'alice');
    const codeBob = await generateTotpCodeRfc6238({ base32Secret: bob.secret, nowEpochSec: harness.clock.now });
    await expectMfaError(completeMfaChallenge(harness.deps, { token: tokenAlice, method: 'TOTP', code: codeBob }), 'MFA_CODE_INVALID');
    await expectMfaError(
      completeMfaChallenge(harness.deps, { token: tokenAlice, method: 'RECOVERY_CODE', code: bob.recoveryCodes[0] ?? '' }),
      'MFA_CODE_INVALID',
    );
    await expectMfaError(
      completeMfaChallenge(harness.deps, { token: tokenAlice, method: 'TOTP', code: codeBob, expectedUserId: 'bob' }),
      'MFA_CHALLENGE_USER_MISMATCH',
    );
    expect(harness.sessions).toHaveLength(0);
    expect(alice.secret).not.toBe(bob.secret);
  });

  it('un défi est refusé si le facteur n’est pas inscrit au moment de l’échange', async () => {
    const harness = buildHarness();
    const token = (await issueMfaChallengeToken({ userId: 'ghost', firstFactor: 'PASSWORD', signingKey: SIGNING_KEY, nowEpochSec: NOW })).token;
    await expectMfaError(completeMfaChallenge(harness.deps, { token, method: 'TOTP', code: '123456' }), 'MFA_FACTOR_NOT_ENROLLED');
    expect(harness.sessions).toHaveLength(0);
  });
});

describe('Moteur 2FA : codes de secours et OTP Infobip', () => {
  it('un code de secours est à usage unique et son empreinte disparaît du stockage', async () => {
    const harness = buildHarness();
    const { recoveryCodes } = await enrollUser(harness, 'u1');
    const code = recoveryCodes[0] ?? '';
    const first = await challengeFor(harness, 'u1');
    await completeMfaChallenge(harness.deps, { token: first, method: 'RECOVERY_CODE', code });
    expect(harness.factors.get('u1')?.recoveryCodeHashes).toHaveLength(9);
    expect(harness.sessions).toEqual([{ userId: 'u1', firstFactor: 'PASSWORD', secondFactor: 'RECOVERY_CODE' }]);
    const second = await challengeFor(harness, 'u1');
    await expectMfaError(completeMfaChallenge(harness.deps, { token: second, method: 'RECOVERY_CODE', code }), 'MFA_CODE_INVALID');
    expect(harness.sessions).toHaveLength(1);
    // un autre code du lot reste utilisable
    await completeMfaChallenge(harness.deps, { token: second, method: 'RECOVERY_CODE', code: recoveryCodes[1] ?? '' });
    expect(harness.sessions).toHaveLength(2);
  });

  it('deux utilisations concurrentes du même code de secours : une seule session', async () => {
    const harness = buildHarness();
    const { recoveryCodes } = await enrollUser(harness, 'u1');
    const a = await challengeFor(harness, 'u1');
    const b = await challengeFor(harness, 'u1');
    const code = recoveryCodes[2] ?? '';
    const outcomes = await Promise.allSettled([
      completeMfaChallenge(harness.deps, { token: a, method: 'RECOVERY_CODE', code }),
      completeMfaChallenge(harness.deps, { token: b, method: 'RECOVERY_CODE', code }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(harness.sessions).toHaveLength(1);
  });

  it('l’OTP Infobip passe par le port injectable ; refusé sans session si le port le refuse', async () => {
    const harness = buildHarness({ infobipAccepts: '482913' });
    await enrollUser(harness, 'u1');
    const token = await challengeFor(harness, 'u1');
    await expectMfaError(completeMfaChallenge(harness.deps, { token, method: 'INFOBIP_OTP', code: '000000' }), 'MFA_CODE_INVALID');
    expect(harness.sessions).toHaveLength(0);
    await completeMfaChallenge(harness.deps, { token, method: 'INFOBIP_OTP', code: '482913' });
    expect(harness.infobipCalls.map((call) => call.userId)).toEqual(['u1', 'u1']);
    expect(harness.sessions).toEqual([{ userId: 'u1', firstFactor: 'PASSWORD', secondFactor: 'INFOBIP_OTP' }]);
  });

  it('sans port Infobip la méthode est indisponible', async () => {
    const harness = buildHarness({ withInfobip: false });
    await enrollUser(harness, 'u1');
    const token = await challengeFor(harness, 'u1');
    await expectMfaError(completeMfaChallenge(harness.deps, { token, method: 'INFOBIP_OTP', code: '482913' }), 'MFA_METHOD_UNAVAILABLE');
    expect(harness.sessions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Routes Hono
// ---------------------------------------------------------------------------

const SETUP = '/api/v1/auth/2fa/totp/setup';
const ENABLE = '/api/v1/auth/2fa/totp/enable';
const VERIFY = '/api/v1/auth/2fa/verify';

interface RouteHarness {
  readonly harness: Harness;
  readonly app: ReturnType<typeof createMfaRouter>;
  readonly rateKeys: string[];
  readonly turnstileCalls: { token: string | null; remoteIp: string | null }[];
}

function buildRoutes(options: { rateOk?: boolean; turnstileOk?: boolean; infobipAccepts?: string } = {}): RouteHarness {
  const harness = buildHarness(options.infobipAccepts === undefined ? {} : { infobipAccepts: options.infobipAccepts });
  const rateKeys: string[] = [];
  const turnstileCalls: { token: string | null; remoteIp: string | null }[] = [];
  const authenticator: MfaSessionAuthenticator = {
    // Session « JWT actif » factice de test : Bearer session-<userId>. Un mfa_challenge_token n'en est pas une.
    authenticate: async (request: MfaSessionRequest) => {
      const header = request.authorization ?? '';
      const match = /^Bearer session-([a-z0-9]+)$/.exec(header);
      const userId = match?.[1];
      return userId === undefined ? null : { userId, accountLabel: `${userId}@exemple.ma` };
    },
  };
  const rateLimiter: RateLimiter = {
    allow: async (key) => {
      rateKeys.push(key);
      return options.rateOk ?? true;
    },
  };
  const turnstile: TurnstileVerifier = {
    verify: async (input) => {
      turnstileCalls.push(input);
      return options.turnstileOk ?? true;
    },
  };
  const deps: MfaRouterDeps = { ...harness.deps, authenticator, rateLimiter, turnstile };
  return { harness, app: createMfaRouter(deps), rateKeys, turnstileCalls };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://fisca.test${path}?cf-turnstile-response=tok`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const asUser = (userId: string): Record<string, string> => ({ Authorization: `Bearer session-${userId}` });

async function json(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('objet JSON attendu');
  }
  return Object.fromEntries(Object.entries(parsed));
}

describe('Routes 2FA (routeur Hono)', () => {
  it('parcours complet : setup, enable, défi, verify TOTP → session ; rejeu et second usage refusés', async () => {
    const { app, harness } = buildRoutes();
    const setupResponse = await app.request(post(SETUP, {}, asUser('u1')));
    expect(setupResponse.status).toBe(200);
    expect(setupResponse.headers.get('Cache-Control')).toBe('no-store');
    const setupBody = await json(setupResponse);
    const secret = String(setupBody['secret']);
    expect(String(setupBody['otpauthUri'])).toMatch(/^otpauth:\/\/totp\//);

    const code = await generateTotpCodeRfc6238({ base32Secret: secret, nowEpochSec: harness.clock.now });
    const enableResponse = await app.request(post(ENABLE, { code }, asUser('u1')));
    expect(enableResponse.status).toBe(200);
    const enableBody = await json(enableResponse);
    expect(enableBody['status']).toBe('ENABLED');
    expect(enableBody['recoveryCodes']).toHaveLength(10);

    harness.clock.now += 120;
    const token = await challengeFor(harness, 'u1', 'GOOGLE_OAUTH');
    const verifyCode = await generateTotpCodeRfc6238({ base32Secret: secret, nowEpochSec: harness.clock.now });
    const verifyResponse = await app.request(post(VERIFY, { mfa_challenge_token: token, method: 'TOTP', code: verifyCode }));
    expect(verifyResponse.status).toBe(200);
    const verifyBody = await json(verifyResponse);
    expect(verifyBody['status']).toBe('AUTHENTICATED');
    expect(verifyBody['accessToken']).toContain('u1');
    expect(harness.sessions).toHaveLength(1);

    const replay = await app.request(post(VERIFY, { mfa_challenge_token: token, method: 'TOTP', code: verifyCode }));
    expect(replay.status).toBe(401);
    expect((await json(replay))['errorCode']).toBe('MFA_CHALLENGE_REPLAYED');
    expect(harness.sessions).toHaveLength(1);
  });

  it('setup et enable exigent une session active : sans elle, ou avec un mfa_challenge_token, 401', async () => {
    const { app, harness } = buildRoutes();
    await enrollUser(harness, 'u1');
    const token = await challengeFor(harness, 'u1');
    for (const path of [SETUP, ENABLE]) {
      const none = await app.request(post(path, { code: '123456' }));
      expect(none.status).toBe(401);
      const withChallenge = await app.request(post(path, { code: '123456' }, { Authorization: `Bearer ${token}` }));
      expect(withChallenge.status).toBe(401);
      expect((await json(withChallenge))['errorCode']).toBe('AUTH_REQUIRED');
    }
    expect(harness.sessions).toHaveLength(0);
  });

  it('étanchéité : verify sans jeton, avec jeton falsifié ou avec corps invalide ne produit aucune session', async () => {
    const { app, harness } = buildRoutes();
    await enrollUser(harness, 'u1');
    const bodies: readonly unknown[] = [
      {},
      '{pas du json',
      { mfa_challenge_token: 'x.y.z', method: 'TOTP', code: '123456' },
      { mfa_challenge_token: 42, method: 'TOTP', code: '123456' },
      { mfa_challenge_token: 'abc', method: 'SMS', code: '123456' },
      { mfa_challenge_token: 'abc', method: 'TOTP' },
    ];
    for (const body of bodies) {
      const response = await app.request(post(VERIFY, body));
      expect([400, 401]).toContain(response.status);
      expect(response.headers.get('Content-Type')).toContain('application/problem+json');
    }
    expect(harness.sessions).toHaveLength(0);
  });

  it('verify : mauvais code 401, code de secours une seule fois, jeton d’un autre utilisateur inutilisable', async () => {
    const { app, harness } = buildRoutes();
    const alice = await enrollUser(harness, 'alice');
    const bob = await enrollUser(harness, 'bob');
    const tokenAlice = await challengeFor(harness, 'alice');
    const bobCode = await generateTotpCodeRfc6238({ base32Secret: bob.secret, nowEpochSec: harness.clock.now });
    const wrong = await app.request(post(VERIFY, { mfa_challenge_token: tokenAlice, method: 'TOTP', code: bobCode }));
    expect(wrong.status).toBe(401);
    expect(harness.sessions).toHaveLength(0);

    const recovery = alice.recoveryCodes[0] ?? '';
    const ok = await app.request(post(VERIFY, { mfa_challenge_token: tokenAlice, method: 'RECOVERY_CODE', code: recovery }));
    expect(ok.status).toBe(200);
    const tokenAgain = await challengeFor(harness, 'alice');
    const again = await app.request(post(VERIFY, { mfa_challenge_token: tokenAgain, method: 'RECOVERY_CODE', code: recovery }));
    expect(again.status).toBe(401);
    expect(harness.sessions).toHaveLength(1);
  });

  it('verify : jeton expiré 401, jeton verrouillé 429', async () => {
    const { app, harness } = buildRoutes();
    const { secret } = await enrollUser(harness, 'u1');
    const expiring = await challengeFor(harness, 'u1');
    const locked = await challengeFor(harness, 'u1');
    const good = await generateTotpCodeRfc6238({ base32Secret: secret, nowEpochSec: harness.clock.now });
    const bad = good === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < MFA_CHALLENGE_MAX_FAILED_ATTEMPTS; attempt += 1) {
      await app.request(post(VERIFY, { mfa_challenge_token: locked, method: 'TOTP', code: bad }));
    }
    const exhausted = await app.request(post(VERIFY, { mfa_challenge_token: locked, method: 'TOTP', code: good }));
    expect(exhausted.status).toBe(429);
    harness.clock.now += 301;
    const fresh = await generateTotpCodeRfc6238({ base32Secret: secret, nowEpochSec: harness.clock.now });
    const expired = await app.request(post(VERIFY, { mfa_challenge_token: expiring, method: 'TOTP', code: fresh }));
    expect(expired.status).toBe(401);
    expect((await json(expired))['errorCode']).toBe('MFA_CHALLENGE_EXPIRED');
    expect(harness.sessions).toHaveLength(0);
  });

  it('verify : OTP Infobip via le port', async () => {
    const { app, harness } = buildRoutes({ infobipAccepts: '482913' });
    await enrollUser(harness, 'u1');
    const token = await challengeFor(harness, 'u1');
    const response = await app.request(post(VERIFY, { mfa_challenge_token: token, method: 'INFOBIP_OTP', code: '482913' }));
    expect(response.status).toBe(200);
    expect(harness.sessions[0]?.secondFactor).toBe('INFOBIP_OTP');
  });

  it('enable : mauvais code 401 ; setup sur 2FA actif 409 ; enable sans setup 409', async () => {
    const { app, harness } = buildRoutes();
    const noSetup = await app.request(post(ENABLE, { code: '123456' }, asUser('u9')));
    expect(noSetup.status).toBe(409);
    const setup = await json(await app.request(post(SETUP, {}, asUser('u1'))));
    const good = await generateTotpCodeRfc6238({ base32Secret: String(setup['secret']), nowEpochSec: harness.clock.now });
    const bad = good === '000000' ? '000001' : '000000';
    const wrong = await app.request(post(ENABLE, { code: bad }, asUser('u1')));
    expect(wrong.status).toBe(401);
    const invalid = await app.request(post(ENABLE, { code: 12 }, asUser('u1')));
    expect(invalid.status).toBe(400);
    expect((await app.request(post(ENABLE, { code: good }, asUser('u1')))).status).toBe(200);
    expect((await app.request(post(SETUP, {}, asUser('u1')))).status).toBe(409);
  });

  it('limitation de débit (429) et Turnstile (403) précèdent toute logique', async () => {
    const limited = buildRoutes({ rateOk: false });
    for (const path of [SETUP, ENABLE, VERIFY]) {
      expect((await limited.app.request(post(path, {}, asUser('u1')))).status).toBe(429);
    }
    expect(limited.rateKeys).toEqual([
      'auth:2fa:totp-setup:inconnu',
      'auth:2fa:totp-enable:inconnu',
      'auth:2fa:verify:inconnu',
    ]);
    expect(limited.turnstileCalls).toHaveLength(0);

    const blocked = buildRoutes({ turnstileOk: false });
    for (const path of [SETUP, ENABLE, VERIFY]) {
      const response = await blocked.app.request(post(path, {}, { ...asUser('u1'), 'CF-Connecting-IP': '203.0.113.9' }));
      expect(response.status).toBe(403);
    }
    expect(blocked.turnstileCalls[0]).toEqual({ token: 'tok', remoteIp: '203.0.113.9' });
    expect(blocked.harness.factors.size).toBe(0);
  });

  it('les chemins hors registre restent 404', async () => {
    const { app } = buildRoutes();
    expect((await app.request(post('/api/v1/auth/2fa/inconnu', {}, asUser('u1')))).status).toBe(404);
    expect((await app.request(post('/api/v1/auth/2fa/sms/send', {}, asUser('u1')))).status).toBe(404);
  });
});
