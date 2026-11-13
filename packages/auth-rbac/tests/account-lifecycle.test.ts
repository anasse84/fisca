import { describe, expect, it } from 'vitest';
import {
  AccountLifecycleError,
  PASSWORD_RESET_TTL_SEC,
  hashEmailForRateKey,
  registerAccount,
  requestPasswordReset,
  verifyEmailToken,
} from '../src/index.ts';
import type { AccountLifecycleDeps, OneTimeTokenRecord } from '../src/index.ts';

function build(randomByte = 7) {
  const tokens = new Map<string, OneTimeTokenRecord>();
  const resets = new Map<string, OneTimeTokenRecord>();
  const sent: string[] = [];
  const verified: string[] = [];
  const deps: AccountLifecycleDeps = {
    accounts: {
      createUnverifiedAccount: async () => ({ kind: 'CREATED' }),
      findByEmailNormalized: async (email) => (email === 'known@example.ma' ? { userId: 'u-1', emailVerified: true } : null),
      markEmailVerified: async (userId) => {
        verified.push(userId);
        return true;
      },
    },
    verificationTokens: {
      save: async (record) => {
        tokens.set(record.tokenHash, record);
      },
      consume: async (hash) => {
        const row = tokens.get(hash) ?? null;
        tokens.delete(hash);
        return row;
      },
    },
    resetTokens: {
      save: async (record) => {
        resets.set(record.tokenHash, record);
      },
      consume: async () => null,
    },
    email: {
      sendLinkProof: async () => undefined,
      sendVerificationEmail: async (m) => {
        sent.push(`verif:${m.token}`);
      },
      sendPasswordResetEmail: async (m) => {
        sent.push(`reset:${m.token}`);
      },
    },
    pepper: 'pepper-factice-de-test',
    nowEpochSec: () => 1000,
    randomBytes: (length) => new Uint8Array(length).fill(randomByte),
    newUserId: () => 'u-new',
  };
  return { deps, tokens, resets, sent, verified };
}

describe('account-lifecycle (moteur)', () => {
  it('jeton déterministe avec source aléatoire injectée, haché, consommé une seule fois', async () => {
    const { deps, sent, verified } = build();
    await registerAccount(deps, { email: 'new@example.ma', password: 'mot-de-passe-factice-12' });
    expect(sent).toHaveLength(1);
    const token = (sent[0] ?? '').replace('verif:', '');
    await verifyEmailToken(deps, token);
    expect(verified).toEqual(['u-new']);
    await expect(verifyEmailToken(deps, token)).rejects.toMatchObject({ code: 'VERIFICATION_TOKEN_INVALID' });
  });

  it('refuse les jetons vides ou démesurés avant tout accès au stockage', async () => {
    const { deps } = build();
    await expect(verifyEmailToken(deps, '')).rejects.toBeInstanceOf(AccountLifecycleError);
    await expect(verifyEmailToken(deps, 'a'.repeat(257))).rejects.toMatchObject({ code: 'VERIFICATION_TOKEN_INVALID' });
  });

  it('réinitialisation : 900 s pour un compte connu, rien pour un inconnu ou une demande limitée', async () => {
    const { deps, resets, sent } = build();
    await requestPasswordReset(deps, { email: 'unknown@example.ma', throttled: false });
    await requestPasswordReset(deps, { email: 'known@example.ma', throttled: true });
    expect(sent).toHaveLength(0);
    await requestPasswordReset(deps, { email: ' Known@Example.ma ', throttled: false });
    expect(sent).toHaveLength(1);
    expect([...resets.values()][0]?.expiresAtEpochSec).toBe(1000 + PASSWORD_RESET_TTL_SEC);
  });

  it('l’empreinte de clé de débit est stable et ne contient pas l’adresse', async () => {
    const a = await hashEmailForRateKey('known@example.ma');
    expect(a).toBe(await hashEmailForRateKey('known@example.ma'));
    expect(a).not.toContain('known');
    expect(a).not.toBe(await hashEmailForRateKey('other@example.ma'));
  });
});
