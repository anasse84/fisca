import { describe, expect, it } from 'vitest';
import {
  REFRESH_COOKIE_NAME,
  RefreshError,
  buildClearRefreshCookie,
  buildRefreshCookie,
  createSessionService,
  hashRefreshToken,
  readRefreshCookie,
  revokeRefreshFamily,
  rotateRefreshToken,
  startRefreshFamily,
} from '../src/index.ts';
import type { RefreshDeps, RefreshTokenRecord, RefreshTokenStore } from '../src/index.ts';
import { generateEd25519PrivateJwkJson } from './jwt-fixtures.ts';

const TTL = 30 * 24 * 3600;

function memoryStore() {
  const rows = new Map<string, RefreshTokenRecord>();
  const store: RefreshTokenStore = {
    insert: async (record) => {
      rows.set(record.tokenHash, record);
    },
    findByHash: async (hash) => rows.get(hash) ?? null,
    markRotated: async (hash, now) => {
      const row = rows.get(hash);
      if (row === undefined || row.rotatedAtEpochSec !== null) {
        return false;
      }
      rows.set(hash, { ...row, rotatedAtEpochSec: now });
      return true;
    },
    revokeFamily: async (familyId, now) => {
      for (const [hash, row] of rows) {
        if (row.familyId === familyId) {
          rows.set(hash, { ...row, revokedAtEpochSec: now });
        }
      }
    },
  };
  return { rows, store };
}

function harness() {
  const memory = memoryStore();
  let now = 1_800_000_000;
  const deps: RefreshDeps = { store: memory.store, ttlSec: TTL, nowEpochSec: () => now };
  return {
    ...memory,
    deps,
    advance: (seconds: number) => {
      now += seconds;
    },
    now: () => now,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RefreshError) {
      return error.code;
    }
    throw error;
  }
  return 'AUCUNE_ERREUR';
}

const SESSION = { userId: 'user-1', mfaVerifiedAtEpochSec: null, amr: ['pwd'] } as const;

describe('refresh cookie rotatif', () => {
  it('émet un jeton opaque haute entropie stocké uniquement sous forme d’empreinte', async () => {
    const h = harness();
    const issued = await startRefreshFamily(h.deps, SESSION);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.rows.size).toBe(1);
    const [stored] = [...h.rows.values()];
    expect(stored?.tokenHash).toBe(await hashRefreshToken(issued.token));
    expect(JSON.stringify([...h.rows.values()])).not.toContain(issued.token);
    expect(stored?.expiresAtEpochSec).toBe(h.now() + TTL);
    const second = await startRefreshFamily(h.deps, SESSION);
    expect(second.token).not.toBe(issued.token);
    expect(second.familyId).not.toBe(issued.familyId);
  });

  it('pose un cookie HttpOnly, Secure, SameSite=Strict, préfixé __Host-', () => {
    const cookie = buildRefreshCookie('abc', 3600);
    expect(cookie.startsWith(`${REFRESH_COOKIE_NAME}=abc`)).toBe(true);
    expect(REFRESH_COOKIE_NAME.startsWith('__Host-')).toBe(true);
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=3600']) {
      expect(cookie.split('; ')).toContain(attribute);
    }
    expect(cookie).not.toContain('Domain');
    const cleared = buildClearRefreshCookie();
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('HttpOnly');
  });

  it('lit le cookie de refresh dans un en-tête Cookie', () => {
    expect(readRefreshCookie(`a=1; ${REFRESH_COOKIE_NAME}=jeton_123; b=2`)).toBe('jeton_123');
    expect(readRefreshCookie('a=1')).toBeNull();
    expect(readRefreshCookie(null)).toBeNull();
  });

  it('tourne à chaque usage : l’ancien jeton est consommé, le nouveau reste dans la famille', async () => {
    const h = harness();
    const first = await startRefreshFamily(h.deps, { userId: 'user-1', mfaVerifiedAtEpochSec: 1_799_999_000, amr: ['pwd', 'otp'] });
    h.advance(600);
    const second = await rotateRefreshToken(h.deps, { token: first.token });
    expect(second.token).not.toBe(first.token);
    expect(second.familyId).toBe(first.familyId);
    expect(second.userId).toBe('user-1');
    expect(second.mfaVerifiedAtEpochSec).toBe(1_799_999_000);
    expect(second.amr).toEqual(['pwd', 'otp']);
    expect(second.expiresAtEpochSec).toBe(h.now() + TTL);
    const third = await rotateRefreshToken(h.deps, { token: second.token });
    expect(third.familyId).toBe(first.familyId);
  });

  it('détecte le rejeu d’un refresh déjà tourné et révoque toute la famille', async () => {
    const h = harness();
    const first = await startRefreshFamily(h.deps, SESSION);
    const second = await rotateRefreshToken(h.deps, { token: first.token });
    expect(await codeOf(rotateRefreshToken(h.deps, { token: first.token }))).toBe('REFRESH_TOKEN_REUSED');
    expect(await codeOf(rotateRefreshToken(h.deps, { token: second.token }))).toBe('REFRESH_TOKEN_REVOKED');
    for (const row of h.rows.values()) {
      expect(row.revokedAtEpochSec).not.toBeNull();
    }
  });

  it('ne révoque pas les autres familles du même utilisateur', async () => {
    const h = harness();
    const a = await startRefreshFamily(h.deps, SESSION);
    const b = await startRefreshFamily(h.deps, SESSION);
    await rotateRefreshToken(h.deps, { token: a.token });
    await codeOf(rotateRefreshToken(h.deps, { token: a.token }));
    await expect(rotateRefreshToken(h.deps, { token: b.token })).resolves.toBeDefined();
  });

  it('traite deux rotations concurrentes comme un rejeu', async () => {
    const h = harness();
    const first = await startRefreshFamily(h.deps, SESSION);
    const results = await Promise.all([
      codeOf(rotateRefreshToken(h.deps, { token: first.token })),
      codeOf(rotateRefreshToken(h.deps, { token: first.token })),
    ]);
    expect(results.filter((code) => code === 'AUCUNE_ERREUR')).toHaveLength(1);
    expect(results.filter((code) => code === 'REFRESH_TOKEN_REUSED')).toHaveLength(1);
  });

  it('refuse un jeton expiré, inconnu, mal formé ou vide', async () => {
    const h = harness();
    const first = await startRefreshFamily(h.deps, SESSION);
    expect(await codeOf(rotateRefreshToken(h.deps, { token: 'A'.repeat(43) }))).toBe('REFRESH_TOKEN_INVALID');
    expect(await codeOf(rotateRefreshToken(h.deps, { token: 'court' }))).toBe('REFRESH_TOKEN_INVALID');
    expect(await codeOf(rotateRefreshToken(h.deps, { token: '' }))).toBe('REFRESH_TOKEN_INVALID');
    h.advance(TTL);
    expect(await codeOf(rotateRefreshToken(h.deps, { token: first.token }))).toBe('REFRESH_TOKEN_EXPIRED');
  });

  it('révoque une famille à la déconnexion', async () => {
    const h = harness();
    const first = await startRefreshFamily(h.deps, SESSION);
    await revokeRefreshFamily(h.deps, { token: first.token });
    expect(await codeOf(rotateRefreshToken(h.deps, { token: first.token }))).toBe('REFRESH_TOKEN_REVOKED');
  });

  it('refuse un TTL de refresh non entier positif', async () => {
    const h = harness();
    await expect(startRefreshFamily({ ...h.deps, ttlSec: 0 }, SESSION)).rejects.toThrow();
  });
});

describe('service de session (JWT 15 min + refresh)', () => {
  async function build() {
    const h = harness();
    const service = await createSessionService({
      privateJwk: await generateEd25519PrivateJwkJson(),
      issuer: 'https://api.fisca.ma',
      audience: 'fisca-api',
      refresh: h.deps,
      nowEpochSec: h.deps.nowEpochSec,
    });
    return { h, service };
  }

  it('émet après second facteur un JWT avec mfa_verified_at et le cookie de refresh', async () => {
    const { h, service } = await build();
    const issued = await service.issueSession({
      userId: 'user-1',
      firstFactor: 'PASSWORD',
      secondFactor: 'TOTP',
      mfaVerifiedAtEpochSec: h.now(),
    });
    expect(issued.expiresInSec).toBe(900);
    expect(issued.setCookie).toContain('SameSite=Strict');
    const claims = await service.verify(issued.accessToken);
    expect(claims.sub).toBe('user-1');
    expect(claims.mfaVerifiedAtEpochSec).toBe(h.now());
    expect(claims.amr).toEqual(['pwd', 'otp']);
  });

  it('émet sans second facteur un JWT sans mfa_verified_at', async () => {
    const { service } = await build();
    const issued = await service.issueFirstFactorSession({ userId: 'user-2', firstFactor: 'GOOGLE_OAUTH' });
    const claims = await service.verify(issued.accessToken);
    expect(claims.mfaVerifiedAtEpochSec).toBeNull();
    expect(claims.amr).toEqual(['google']);
  });

  it('rafraîchit : nouveau JWT, nouveau cookie, même famille ; rejeu => famille révoquée', async () => {
    const { h, service } = await build();
    const issued = await service.issueFirstFactorSession({ userId: 'user-3', firstFactor: 'PASSWORD' });
    const cookie = (issued.setCookie ?? '').split(';')[0] ?? '';
    h.advance(120);
    const refreshed = await service.refresh({ cookie });
    expect(refreshed.userId).toBe('user-3');
    expect(refreshed.setCookie).not.toBe(issued.setCookie);
    const before = await service.verify(issued.accessToken);
    const after = await service.verify(refreshed.accessToken);
    expect(after.sid).toBe(before.sid);
    expect(after.jti).not.toBe(before.jti);
    await expect(service.refresh({ cookie })).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
    const newCookie = (refreshed.setCookie ?? '').split(';')[0] ?? '';
    await expect(service.refresh({ cookie: newCookie })).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REVOKED' });
  });

  it('refuse un refresh sans cookie', async () => {
    const { service } = await build();
    await expect(service.refresh({ cookie: null })).rejects.toMatchObject({ code: 'REFRESH_TOKEN_MISSING' });
  });
});
