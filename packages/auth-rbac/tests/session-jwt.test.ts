import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TTL_SEC,
  SessionJwtError,
  issueAccessToken,
  loadSessionSigningKeys,
  verifyAccessToken,
} from '../src/index.ts';
import { encodeSegment, generateEd25519PrivateJwkJson } from './jwt-fixtures.ts';

const NOW = 1_800_000_000;
const ISSUER = 'https://api.fisca.ma';
const AUDIENCE = 'fisca-api';

async function setup() {
  const keys = await loadSessionSigningKeys(await generateEd25519PrivateJwkJson());
  const issue = async (overrides: { nowEpochSec?: number; mfaVerifiedAtEpochSec?: number | null } = {}) =>
    issueAccessToken({
      keys,
      issuer: ISSUER,
      audience: AUDIENCE,
      userId: 'user-1',
      sessionId: 'sid-1',
      amr: ['pwd', 'otp'],
      mfaVerifiedAtEpochSec: overrides.mfaVerifiedAtEpochSec === undefined ? NOW : overrides.mfaVerifiedAtEpochSec,
      nowEpochSec: overrides.nowEpochSec ?? NOW,
    });
  const verify = async (token: string, nowEpochSec = NOW) =>
    verifyAccessToken({ token, keys, issuer: ISSUER, audience: AUDIENCE, nowEpochSec });
  return { keys, issue, verify };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SessionJwtError) {
      return error.code;
    }
    throw error;
  }
  return 'AUCUNE_ERREUR';
}

describe('session JWT EdDSA 15 minutes', () => {
  it('fixe la durée à 900 secondes et émet un JWT EdDSA vérifiable', async () => {
    const { issue, verify } = await setup();
    expect(ACCESS_TOKEN_TTL_SEC).toBe(900);
    const { token, claims } = await issue();
    const header = JSON.parse(atob(token.split('.')[0]?.replace(/-/g, '+').replace(/_/g, '/') ?? '')) as Record<string, unknown>;
    expect(header['alg']).toBe('EdDSA');
    expect(header['typ']).toBe('JWT');
    expect(claims.exp - claims.iat).toBe(900);
    expect(claims.nbf).toBe(NOW);
    const verified = await verify(token);
    expect(verified).toEqual(claims);
    expect(verified.sub).toBe('user-1');
    expect(verified.mfaVerifiedAtEpochSec).toBe(NOW);
    expect(verified.jti.length).toBeGreaterThanOrEqual(16);
  });

  it('émet un jti différent à chaque jeton', async () => {
    const { issue } = await setup();
    expect((await issue()).claims.jti).not.toBe((await issue()).claims.jti);
  });

  it('refuse un jeton expiré à exp et accepte la dernière seconde', async () => {
    const { issue, verify } = await setup();
    const { token } = await issue();
    await expect(verify(token, NOW + 899)).resolves.toBeDefined();
    expect(await codeOf(verify(token, NOW + 900))).toBe('JWT_EXPIRED');
  });

  it('refuse un jeton pas encore valide (nbf)', async () => {
    const { issue, verify } = await setup();
    const { token } = await issue({ nowEpochSec: NOW + 60 });
    expect(await codeOf(verify(token, NOW))).toBe('JWT_NOT_YET_VALID');
  });

  it('refuse un mauvais émetteur et une mauvaise audience', async () => {
    const { issue, keys } = await setup();
    const { token } = await issue();
    expect(
      await codeOf(verifyAccessToken({ token, keys, issuer: 'https://autre', audience: AUDIENCE, nowEpochSec: NOW })),
    ).toBe('JWT_ISSUER_INVALID');
    expect(
      await codeOf(verifyAccessToken({ token, keys, issuer: ISSUER, audience: 'autre', nowEpochSec: NOW })),
    ).toBe('JWT_AUDIENCE_INVALID');
  });

  it('refuse un jeton signé par une autre clé ou dont la charge utile est altérée', async () => {
    const { issue, verify } = await setup();
    const other = await setup();
    expect(await codeOf(verify((await other.issue()).token))).toBe('JWT_SIGNATURE_INVALID');
    const [head, , signature] = (await issue()).token.split('.');
    const forged = encodeSegment({ iss: ISSUER, aud: AUDIENCE, sub: 'admin', jti: 'x'.repeat(22), iat: NOW, nbf: NOW, exp: NOW + 900, sid: 's', amr: [] });
    expect(await codeOf(verify(`${head}.${forged}.${signature}`))).toBe('JWT_SIGNATURE_INVALID');
  });

  it('refuse alg none, HS256, minuscule et tout algorithme autre que EdDSA', async () => {
    const { issue, verify } = await setup();
    const { token } = await issue();
    const payload = token.split('.')[1] ?? '';
    for (const alg of ['none', 'None', 'HS256', 'HS512', 'RS256', 'ES256', 'eddsa']) {
      const forged = `${encodeSegment({ alg, typ: 'JWT' })}.${payload}.${token.split('.')[2] ?? ''}`;
      expect(await codeOf(verify(forged))).toBe('JWT_ALG_FORBIDDEN');
    }
    expect(await codeOf(verify(`${encodeSegment({ alg: 'none', typ: 'JWT' })}.${payload}.`))).toBe('JWT_ALG_FORBIDDEN');
  });

  it('refuse un en-tête crit, jwk ou un jeton mal formé', async () => {
    const { issue, verify } = await setup();
    const { token } = await issue();
    const [, payload, signature] = token.split('.');
    const withCrit = `${encodeSegment({ alg: 'EdDSA', typ: 'JWT', crit: ['x'] })}.${payload}.${signature}`;
    expect(await codeOf(verify(withCrit))).toBe('JWT_MALFORMED');
    expect(await codeOf(verify('abc'))).toBe('JWT_MALFORMED');
    expect(await codeOf(verify('a.b.c.d'))).toBe('JWT_MALFORMED');
    expect(await codeOf(verify(`${token}!`))).toBe('JWT_MALFORMED');
  });

  it('refuse un mfa_challenge_token (jeton HMAC) présenté comme session', async () => {
    const { verify } = await setup();
    expect(await codeOf(verify('fmc1.eyJ0eXAiOiJtZmFfY2hhbGxlbmdlIn0.AAAA'))).toBe('JWT_MALFORMED');
  });

  it('conserve mfa_verified_at nul pour une session sans second facteur', async () => {
    const { issue, verify } = await setup();
    const verified = await verify((await issue({ mfaVerifiedAtEpochSec: null })).token);
    expect(verified.mfaVerifiedAtEpochSec).toBeNull();
  });

  it('refuse une clé JWK absente, mal formée, publique seule ou d’un autre type', async () => {
    await expect(loadSessionSigningKeys('')).rejects.toMatchObject({ code: 'JWT_KEY_INVALID' });
    await expect(loadSessionSigningKeys('{pas du json')).rejects.toMatchObject({ code: 'JWT_KEY_INVALID' });
    const jwk = JSON.parse(await generateEd25519PrivateJwkJson()) as Record<string, unknown>;
    const publicOnly = Object.fromEntries(Object.entries(jwk).filter(([name]) => name !== 'd'));
    await expect(loadSessionSigningKeys(JSON.stringify(publicOnly))).rejects.toMatchObject({ code: 'JWT_KEY_INVALID' });
    await expect(loadSessionSigningKeys(JSON.stringify({ ...jwk, crv: 'P-256' }))).rejects.toMatchObject({ code: 'JWT_KEY_INVALID' });
  });

  it('refuse un JWK dont la partie publique x ne correspond pas à d', async () => {
    const first = JSON.parse(await generateEd25519PrivateJwkJson()) as Record<string, unknown>;
    const second = JSON.parse(await generateEd25519PrivateJwkJson()) as Record<string, unknown>;
    await expect(loadSessionSigningKeys(JSON.stringify({ ...first, x: second['x'] }))).rejects.toMatchObject({
      code: 'JWT_KEY_INVALID',
    });
  });

  it('dérive la clé publique : la clé de vérification ne peut pas signer', async () => {
    const { keys } = await setup();
    expect(keys.publicKey.usages).toEqual(['verify']);
    expect(keys.privateKey.extractable).toBe(false);
  });
});
