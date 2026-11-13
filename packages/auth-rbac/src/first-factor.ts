/**
 * Raccordement du premier facteur au second (Doc_09 § 02 ; barrière QA « étanchéité du mfa_challenge_token »).
 *
 * Règle unique, partagée par la connexion par mot de passe (CTR-API-03) et le callback Google (CTR-API-05) :
 * - second facteur actif (ou imposé par la politique) : AUCUNE session, seulement un mfa_challenge_token ;
 * - la session n'existe qu'après `completeMfaChallenge` (route CTR-API-09) ;
 * - compte sans second facteur et sans obligation : session directe.
 */

import type { MfaFirstFactor } from './auth-2fa.ts';
import { startMfaChallenge } from './mfa-engine.ts';
import type { IssuedMfaSession, MfaEngineDeps, SecondFactorMethod } from './mfa-engine.ts';
import type { FirstFactorSessionIssuer } from './session-service.ts';

/** Politique d'obligation du 2FA par rôle (Doc_09 § 02) : fournie par l'appelant, les rôles viennent de S1B. */
export interface MfaRequirementPolicy {
  isSecondFactorRequired(userId: string): Promise<boolean>;
}

export interface FirstFactorDeps {
  readonly mfa: MfaEngineDeps;
  readonly sessions: FirstFactorSessionIssuer;
  /** Absent : aucun rôle n'impose le second facteur au-delà de l'inscription du compte. */
  readonly policy?: MfaRequirementPolicy;
}

export type FirstFactorOutcome =
  | {
      readonly kind: 'MFA_REQUIRED';
      readonly mfaChallengeToken: string;
      readonly expiresAtEpochSec: number;
      readonly methods: readonly SecondFactorMethod[];
    }
  | { readonly kind: 'SESSION'; readonly session: IssuedMfaSession }
  /** Second facteur obligatoire mais non inscrit : aucune session, l'enrôlement doit précéder. */
  | { readonly kind: 'MFA_ENROLLMENT_REQUIRED' };

export async function completeFirstFactor(
  deps: FirstFactorDeps,
  input: { readonly userId: string; readonly firstFactor: MfaFirstFactor },
): Promise<FirstFactorOutcome> {
  const challenge = await startMfaChallenge(deps.mfa, input);
  if (challenge.status === 'MFA_REQUIRED') {
    return {
      kind: 'MFA_REQUIRED',
      mfaChallengeToken: challenge.mfaChallengeToken,
      expiresAtEpochSec: challenge.expiresAtEpochSec,
      methods: challenge.methods,
    };
  }
  if (deps.policy !== undefined && (await deps.policy.isSecondFactorRequired(input.userId))) {
    return { kind: 'MFA_ENROLLMENT_REQUIRED' };
  }
  return { kind: 'SESSION', session: await deps.sessions.issueFirstFactorSession(input) };
}
