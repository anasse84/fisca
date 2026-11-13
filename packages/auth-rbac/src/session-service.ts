/**
 * Service de session : assemble le JWT EdDSA de 15 minutes et le refresh cookie rotatif (ticket T-S1A-04).
 * Il implémente le port MfaSessionIssuer du moteur 2FA (session émise uniquement après second facteur) et le port
 * FirstFactorSessionIssuer (session directe, uniquement pour un compte sans second facteur).
 */

import type { IssuedMfaSession, MfaSessionGrant, MfaSessionIssuer, MfaSessionAuthenticator, MfaSessionRequest, AuthenticatedUser, SecondFactorMethod } from './mfa-engine.ts';
import type { MfaFirstFactor } from './auth-2fa.ts';
import { RefreshError, readRefreshCookie, rotateRefreshToken, revokeRefreshFamily, startRefreshFamily } from './refresh-session.ts';
import type { RefreshDeps } from './refresh-session.ts';
import {
  ACCESS_TOKEN_TTL_SEC,
  SessionJwtError,
  issueAccessToken,
  loadSessionSigningKeys,
  verifyAccessToken,
} from './session-jwt.ts';
import type { AccessTokenClaims } from './session-jwt.ts';

export interface FirstFactorSessionIssuer {
  /** Session sans second facteur : à n'appeler que si le compte n'a aucun second facteur actif ni obligatoire. */
  issueFirstFactorSession(input: { readonly userId: string; readonly firstFactor: MfaFirstFactor }): Promise<IssuedMfaSession>;
}

export interface SessionServiceConfig {
  /** Valeur du secret JWT_EDDSA_PRIVATE_JWK (CTR-SEC-02), fournie par l'appelant. */
  readonly privateJwk: string;
  readonly issuer: string;
  readonly audience: string;
  readonly refresh: RefreshDeps;
  readonly nowEpochSec: () => number;
}

export interface RefreshedSession extends IssuedMfaSession {
  readonly userId: string;
}

export interface SessionService extends MfaSessionIssuer, FirstFactorSessionIssuer {
  /** Session après authentification par passkey avec vérification utilisateur (facteur résistant à l'hameçonnage). */
  issuePasskeySession(input: { readonly userId: string }): Promise<IssuedMfaSession>;
  verify(token: string): Promise<AccessTokenClaims>;
  /** `cookie` : en-tête Cookie complet ou paire `nom=valeur` du cookie de refresh. */
  refresh(input: { readonly cookie: string | null }): Promise<RefreshedSession>;
  /** Révoque la famille du refresh présenté (déconnexion). */
  revoke(input: { readonly cookie: string | null }): Promise<void>;
}

const FIRST_FACTOR_AMR: Readonly<Record<MfaFirstFactor, string>> = { PASSWORD: 'pwd', GOOGLE_OAUTH: 'google' };
const SECOND_FACTOR_AMR: Readonly<Record<SecondFactorMethod, string>> = {
  TOTP: 'otp',
  RECOVERY_CODE: 'rec',
  INFOBIP_OTP: 'sms',
};
const PASSKEY_AMR = 'passkey';

export async function createSessionService(config: SessionServiceConfig): Promise<SessionService> {
  const keys = await loadSessionSigningKeys(config.privateJwk);

  async function open(userId: string, amr: readonly string[], mfaVerifiedAtEpochSec: number | null): Promise<IssuedMfaSession> {
    const refresh = await startRefreshFamily(config.refresh, { userId, amr, mfaVerifiedAtEpochSec });
    const access = await issueAccessToken({
      keys,
      issuer: config.issuer,
      audience: config.audience,
      userId,
      sessionId: refresh.familyId,
      amr,
      mfaVerifiedAtEpochSec,
      nowEpochSec: config.nowEpochSec(),
    });
    return { accessToken: access.token, expiresInSec: ACCESS_TOKEN_TTL_SEC, setCookie: refresh.cookie };
  }

  function cookieToken(cookie: string | null): string {
    const token = readRefreshCookie(cookie);
    if (token === null) {
      throw new RefreshError('REFRESH_TOKEN_MISSING', 'cookie de refresh absent.');
    }
    return token;
  }

  return {
    issueSession: (grant: MfaSessionGrant) =>
      open(
        grant.userId,
        [FIRST_FACTOR_AMR[grant.firstFactor], SECOND_FACTOR_AMR[grant.secondFactor]],
        grant.mfaVerifiedAtEpochSec,
      ),
    issueFirstFactorSession: (input) => open(input.userId, [FIRST_FACTOR_AMR[input.firstFactor]], null),
    issuePasskeySession: (input) => open(input.userId, [PASSKEY_AMR], config.nowEpochSec()),
    verify: (token) =>
      verifyAccessToken({
        token,
        keys,
        issuer: config.issuer,
        audience: config.audience,
        nowEpochSec: config.nowEpochSec(),
      }),
    refresh: async (input) => {
      const rotated = await rotateRefreshToken(config.refresh, { token: cookieToken(input.cookie) });
      const access = await issueAccessToken({
        keys,
        issuer: config.issuer,
        audience: config.audience,
        userId: rotated.userId,
        sessionId: rotated.familyId,
        amr: rotated.amr,
        mfaVerifiedAtEpochSec: rotated.mfaVerifiedAtEpochSec,
        nowEpochSec: config.nowEpochSec(),
      });
      return { userId: rotated.userId, accessToken: access.token, expiresInSec: ACCESS_TOKEN_TTL_SEC, setCookie: rotated.cookie };
    },
    revoke: (input) => revokeRefreshFamily(config.refresh, { token: cookieToken(input.cookie) }),
  };
}

const BEARER_PREFIX = 'Bearer ';

export interface JwtSessionAuthenticatorDeps {
  readonly sessions: Pick<SessionService, 'verify'>;
  /** Libellé affiché dans l'application TOTP (e-mail) ; null si le compte n'existe plus. */
  readonly resolveAccountLabel: (userId: string) => Promise<string | null>;
}

/**
 * Implémente MfaSessionAuthenticator : un JWT de session valide donne l'utilisateur. Un mfa_challenge_token
 * (jeton HMAC préfixé fmc1) n'est pas un JWT EdDSA et est donc toujours refusé ici.
 */
export function createJwtSessionAuthenticator(deps: JwtSessionAuthenticatorDeps): MfaSessionAuthenticator {
  return {
    authenticate: async (request: MfaSessionRequest): Promise<AuthenticatedUser | null> => {
      const header = request.authorization;
      if (header === null || !header.startsWith(BEARER_PREFIX)) {
        return null;
      }
      try {
        const claims = await deps.sessions.verify(header.slice(BEARER_PREFIX.length).trim());
        const accountLabel = await deps.resolveAccountLabel(claims.sub);
        return accountLabel === null ? null : { userId: claims.sub, accountLabel };
      } catch (error) {
        if (error instanceof SessionJwtError) {
          return null;
        }
        throw error;
      }
    },
  };
}
