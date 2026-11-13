/**
 * Moteur 2FA (Doc_09 § 02 ; ticket T-S1A-03 ; contrat CTR-COD-07).
 *
 * Étanchéité : après un premier facteur réussi (mot de passe ou Google), seul un mfa_challenge_token est émis.
 * Une session n'existe qu'à la fin de `completeMfaChallenge`, après validation du second facteur (TOTP anti-rejeu,
 * code de secours à usage unique ou OTP Infobip) ET consommation atomique du jeton.
 *
 * Tout l'état passe par des ports injectables : les tables (user_mfa_factors, CTR-SQL-10) viennent de S1B, le
 * chiffrement du secret TOTP au repos de crypto-e2ee, l'envoi/vérification de l'OTP d'Infobip de external-integrations,
 * le JWT EdDSA d'un autre ticket. Ce module ne lit ni horloge globale, ni environnement, ni secret.
 */

import {
  MFA_CHALLENGE_MAX_FAILED_ATTEMPTS,
  MfaError,
  buildOtpauthUri,
  findMatchingRecoveryCodeHash,
  generateRecoveryCodes,
  generateTotpSecretBase32,
  issueMfaChallengeToken,
  verifyMfaChallengeToken,
  verifyTotpWithReplayGuard,
} from './auth-2fa.ts';
import type { MfaFirstFactor, MfaRandomBytes, TotpReplayStore } from './auth-2fa.ts';

export type SecondFactorMethod = 'TOTP' | 'RECOVERY_CODE' | 'INFOBIP_OTP';
export const SECOND_FACTOR_METHODS: readonly SecondFactorMethod[] = ['TOTP', 'RECOVERY_CODE', 'INFOBIP_OTP'];

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** Vue applicative de user_mfa_factors (CTR-SQL-10, S1B). Le secret n'y est jamais en clair. */
export interface MfaFactorRecord {
  /** Secret base32 scellé par le port TotpSecretVault (totp_secret_aes_gcm) ; null si aucun setup. */
  readonly sealedTotpSecret: string | null;
  /** Date de vérification du TOTP (totp_verified_at) ; null tant que `enable` n'a pas réussi. */
  readonly totpVerifiedAtEpochSec: number | null;
  /** Empreintes salées des codes de secours restants (recovery_codes_hashes_json). */
  readonly recoveryCodeHashes: readonly string[];
}

export interface MfaFactorStore {
  getFactor(userId: string): Promise<MfaFactorRecord | null>;
  /** Enregistre un secret en attente de vérification (écrase tout secret non vérifié précédent). */
  savePendingTotpSecret(userId: string, sealedSecret: string, nowEpochSec: number): Promise<void>;
  /** Marque le TOTP vérifié et remplace les empreintes de codes de secours, en une seule opération. */
  activateTotp(
    userId: string,
    input: { readonly recoveryCodeHashes: readonly string[]; readonly verifiedAtEpochSec: number },
  ): Promise<void>;
  /** Retire atomiquement une empreinte ; true seulement si elle était encore présente (usage unique). */
  consumeRecoveryCodeHash(userId: string, hash: string): Promise<boolean>;
}

/** Scellement du secret TOTP au repos : l'implémentation réelle vient de crypto-e2ee (AES-256-GCM, AAD). */
export interface TotpSecretVault {
  seal(userId: string, base32Secret: string): Promise<string>;
  open(userId: string, sealedSecret: string): Promise<string>;
}

/** État d'usage unique et d'essais d'un mfa_challenge_token, indexé par son identifiant `jti`. */
export interface MfaChallengeStore {
  isConsumed(jti: string): Promise<boolean>;
  /** Marque le jeton consommé ; true seulement au premier appel (atomique). */
  consume(jti: string, expiresAtEpochSec: number): Promise<boolean>;
  failureCount(jti: string): Promise<number>;
  /** Compte un échec de second facteur et renvoie le total. */
  recordFailure(jti: string, expiresAtEpochSec: number): Promise<number>;
}

export interface InfobipOtpVerifier {
  /** Vrai si le code OTP (WhatsApp ou SMS) est valide pour cet utilisateur. */
  verify(input: { readonly userId: string; readonly code: string }): Promise<boolean>;
}

export interface IssuedMfaSession {
  readonly accessToken: string;
  readonly expiresInSec: number;
  /** Valeur complète d'un en-tête Set-Cookie (refresh HttpOnly) construite par l'émetteur, ou null. */
  readonly setCookie: string | null;
}

export interface MfaSessionGrant {
  readonly userId: string;
  readonly firstFactor: MfaFirstFactor;
  readonly secondFactor: SecondFactorMethod;
  /** Alimente le claim mfa_verified_at (Step-Up < 300 s). */
  readonly mfaVerifiedAtEpochSec: number;
}

/** Émetteur de session (JWT EdDSA 15 min, autre ticket) : appelé uniquement après un second facteur validé. */
export interface MfaSessionIssuer {
  issueSession(grant: MfaSessionGrant): Promise<IssuedMfaSession>;
}

export interface MfaSessionRequest {
  readonly authorization: string | null;
  readonly cookie: string | null;
}

export interface AuthenticatedUser {
  readonly userId: string;
  /** Libellé de compte affiché dans l'application d'authentification (e-mail). */
  readonly accountLabel: string;
}

/** Vérifie un JWT de session actif. Un mfa_challenge_token n'est jamais une session et doit être refusé ici. */
export interface MfaSessionAuthenticator {
  authenticate(request: MfaSessionRequest): Promise<AuthenticatedUser | null>;
}

export interface MfaEngineDeps {
  readonly factors: MfaFactorStore;
  readonly secretVault: TotpSecretVault;
  readonly replay: TotpReplayStore;
  readonly challenges: MfaChallengeStore;
  readonly sessions: MfaSessionIssuer;
  /** Absent : la méthode INFOBIP_OTP est indisponible. */
  readonly infobip?: InfobipOtpVerifier;
  /** Clé HMAC du mfa_challenge_token, fournie par l'appelant (≥ 32 octets). */
  readonly signingKey: string;
  /** Nom d'émetteur affiché dans l'application TOTP. */
  readonly issuerName: string;
  readonly nowEpochSec: () => number;
  readonly randomBytes?: MfaRandomBytes;
}

// ---------------------------------------------------------------------------
// Enrôlement TOTP
// ---------------------------------------------------------------------------

export interface TotpSetupResult {
  readonly secret: string;
  readonly otpauthUri: string;
}

export async function setupTotp(
  deps: MfaEngineDeps,
  input: { readonly userId: string; readonly accountLabel: string },
): Promise<TotpSetupResult> {
  const existing = await deps.factors.getFactor(input.userId);
  if (existing !== null && existing.totpVerifiedAtEpochSec !== null) {
    throw new MfaError('TOTP_ALREADY_ENABLED', 'Le 2FA TOTP est déjà actif pour ce compte.');
  }
  const secret = generateTotpSecretBase32(deps.randomBytes);
  const sealed = await deps.secretVault.seal(input.userId, secret);
  await deps.factors.savePendingTotpSecret(input.userId, sealed, deps.nowEpochSec());
  return {
    secret,
    otpauthUri: buildOtpauthUri({ issuer: deps.issuerName, accountName: input.accountLabel, base32Secret: secret }),
  };
}

export interface TotpEnableResult {
  /** Codes de secours en clair : affichés une seule fois, seules leurs empreintes sont stockées. */
  readonly recoveryCodes: readonly string[];
}

export async function enableTotp(
  deps: MfaEngineDeps,
  input: { readonly userId: string; readonly code: string },
): Promise<TotpEnableResult> {
  const factor = await deps.factors.getFactor(input.userId);
  if (factor === null || factor.sealedTotpSecret === null) {
    throw new MfaError('TOTP_SETUP_REQUIRED', 'Aucun secret TOTP en attente : appelez d’abord le setup.');
  }
  if (factor.totpVerifiedAtEpochSec !== null) {
    throw new MfaError('TOTP_ALREADY_ENABLED', 'Le 2FA TOTP est déjà actif pour ce compte.');
  }
  const secret = await deps.secretVault.open(input.userId, factor.sealedTotpSecret);
  const nowEpochSec = deps.nowEpochSec();
  const accepted = await verifyTotpWithReplayGuard({
    userId: input.userId,
    base32Secret: secret,
    sixDigitCode: input.code,
    nowEpochSec,
    store: deps.replay,
  });
  if (!accepted) {
    throw new MfaError('TOTP_CODE_INVALID', 'Le code TOTP est invalide.');
  }
  const batch = await generateRecoveryCodes(deps.randomBytes);
  await deps.factors.activateTotp(input.userId, { recoveryCodeHashes: batch.hashes, verifiedAtEpochSec: nowEpochSec });
  return { recoveryCodes: batch.codes };
}

// ---------------------------------------------------------------------------
// Défi après premier facteur
// ---------------------------------------------------------------------------

export type StartMfaChallengeResult =
  | { readonly status: 'MFA_NOT_ENROLLED' }
  | {
      readonly status: 'MFA_REQUIRED';
      readonly mfaChallengeToken: string;
      readonly expiresAtEpochSec: number;
      readonly methods: readonly SecondFactorMethod[];
    };

/**
 * À appeler après un premier facteur réussi (mot de passe ou Google). Si le TOTP est actif, émet un
 * mfa_challenge_token et AUCUNE session ; sinon signale que le flux sans 2FA reste de la responsabilité de l'appelant
 * (la politique d'obligation par rôle n'est pas décidée ici).
 */
export async function startMfaChallenge(
  deps: MfaEngineDeps,
  input: { readonly userId: string; readonly firstFactor: MfaFirstFactor },
): Promise<StartMfaChallengeResult> {
  const factor = await deps.factors.getFactor(input.userId);
  if (factor === null || factor.totpVerifiedAtEpochSec === null) {
    return { status: 'MFA_NOT_ENROLLED' };
  }
  const issued = await issueMfaChallengeToken({
    userId: input.userId,
    firstFactor: input.firstFactor,
    signingKey: deps.signingKey,
    nowEpochSec: deps.nowEpochSec(),
    ...(deps.randomBytes === undefined ? {} : { randomBytes: deps.randomBytes }),
  });
  const methods: SecondFactorMethod[] = ['TOTP', 'RECOVERY_CODE'];
  if (deps.infobip !== undefined) {
    methods.push('INFOBIP_OTP');
  }
  return {
    status: 'MFA_REQUIRED',
    mfaChallengeToken: issued.token,
    expiresAtEpochSec: issued.expiresAtEpochSec,
    methods,
  };
}

export interface CompleteMfaChallengeInput {
  readonly token: string;
  readonly method: SecondFactorMethod;
  readonly code: string;
  /** Si fourni, le jeton doit appartenir à cet utilisateur. */
  readonly expectedUserId?: string;
}

export interface CompleteMfaChallengeResult {
  readonly userId: string;
  readonly session: IssuedMfaSession;
}

async function validateSecondFactor(
  deps: MfaEngineDeps,
  userId: string,
  factor: MfaFactorRecord,
  method: SecondFactorMethod,
  code: string,
  nowEpochSec: number,
): Promise<boolean> {
  if (method === 'TOTP') {
    if (factor.sealedTotpSecret === null) {
      return false;
    }
    const secret = await deps.secretVault.open(userId, factor.sealedTotpSecret);
    return verifyTotpWithReplayGuard({
      userId,
      base32Secret: secret,
      sixDigitCode: code,
      nowEpochSec,
      store: deps.replay,
    });
  }
  if (method === 'RECOVERY_CODE') {
    const hash = await findMatchingRecoveryCodeHash(code, factor.recoveryCodeHashes);
    return hash !== null && (await deps.factors.consumeRecoveryCodeHash(userId, hash));
  }
  if (deps.infobip === undefined) {
    throw new MfaError('MFA_METHOD_UNAVAILABLE', 'La méthode OTP Infobip n’est pas disponible.');
  }
  return deps.infobip.verify({ userId, code });
}

/**
 * Échange un mfa_challenge_token contre une session après validation du second facteur.
 * Refus (sans session) : jeton falsifié, expiré, d'un autre utilisateur, déjà consommé, verrouillé, facteur non
 * inscrit, code invalide. La session n'est émise qu'après consommation atomique du jeton.
 */
export async function completeMfaChallenge(
  deps: MfaEngineDeps,
  input: CompleteMfaChallengeInput,
): Promise<CompleteMfaChallengeResult> {
  const nowEpochSec = deps.nowEpochSec();
  const claims = await verifyMfaChallengeToken({
    token: input.token,
    signingKey: deps.signingKey,
    nowEpochSec,
    ...(input.expectedUserId === undefined ? {} : { expectedUserId: input.expectedUserId }),
  });
  if (await deps.challenges.isConsumed(claims.jti)) {
    throw new MfaError('MFA_CHALLENGE_REPLAYED', 'Ce jeton de défi MFA a déjà été utilisé.');
  }
  if ((await deps.challenges.failureCount(claims.jti)) >= MFA_CHALLENGE_MAX_FAILED_ATTEMPTS) {
    throw new MfaError('MFA_CHALLENGE_ATTEMPTS_EXHAUSTED', 'Trop d’essais : recommencez la connexion.');
  }
  const factor = await deps.factors.getFactor(claims.userId);
  if (factor === null || factor.totpVerifiedAtEpochSec === null) {
    throw new MfaError('MFA_FACTOR_NOT_ENROLLED', 'Aucun second facteur actif pour ce compte.');
  }
  const accepted = await validateSecondFactor(deps, claims.userId, factor, input.method, input.code, nowEpochSec);
  if (!accepted) {
    await deps.challenges.recordFailure(claims.jti, claims.expiresAtEpochSec);
    throw new MfaError('MFA_CODE_INVALID', 'Le code de second facteur est invalide.');
  }
  if (!(await deps.challenges.consume(claims.jti, claims.expiresAtEpochSec))) {
    throw new MfaError('MFA_CHALLENGE_REPLAYED', 'Ce jeton de défi MFA a déjà été utilisé.');
  }
  const session = await deps.sessions.issueSession({
    userId: claims.userId,
    firstFactor: claims.firstFactor,
    secondFactor: input.method,
    mfaVerifiedAtEpochSec: nowEpochSec,
  });
  return { userId: claims.userId, session };
}
