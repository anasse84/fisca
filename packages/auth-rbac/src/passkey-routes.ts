/**
 * Routeur Hono des passkeys WebAuthn (CTR-API-37 à CTR-API-40 ; Doc_09 § 02, annexe passkeys) :
 * - POST /api/v1/auth/passkeys/register/options et /register/verify : session JWT valide exigée ;
 * - POST /api/v1/auth/passkeys/authenticate/options et /authenticate/verify : sans session. L'authentification par
 *   passkey (vérification utilisateur exigée par le moteur) vaut second facteur : la session est émise par
 *   SessionService.issuePasskeySession, qui pose mfa_verified_at. Cette route n'accepte ni mot de passe, ni jeton
 *   Google, ni mfa_challenge_token : elle ne peut donc jamais servir à contourner « aucune session avant second facteur ».
 * Les options d'authentification sont sans identifiant (passkeys découvrables) : aucune énumération des passkeys d'un compte.
 * Ordre : limitation de débit, Turnstile, authentification (enregistrement), corps, moteur.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { problemResponse } from './first-factor-response.ts';
import type { ProblemSpec } from './first-factor-response.ts';
import type { AuthenticatedUser, MfaSessionAuthenticator } from './mfa-engine.ts';
import {
  PasskeyError,
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
} from './passkeys.ts';
import type { PasskeyDeps, PasskeyErrorCode } from './passkeys.ts';
import { AUTH_REQUIRED, REQUEST_INVALID, guardRequest, internalErrorResponse, readJsonObject } from './route-guard.ts';
import type { EdgeGuardDeps } from './route-guard.ts';
import type { SessionService } from './session-service.ts';

export const PASSKEY_REGISTER_OPTIONS_PATH = '/api/v1/auth/passkeys/register/options' as const;
export const PASSKEY_REGISTER_VERIFY_PATH = '/api/v1/auth/passkeys/register/verify' as const;
export const PASSKEY_AUTHENTICATE_OPTIONS_PATH = '/api/v1/auth/passkeys/authenticate/options' as const;
export const PASSKEY_AUTHENTICATE_VERIFY_PATH = '/api/v1/auth/passkeys/authenticate/verify' as const;

export interface PasskeyRouterDeps extends EdgeGuardDeps {
  readonly passkeys: PasskeyDeps;
  readonly sessions: Pick<SessionService, 'issuePasskeySession'>;
  readonly authenticator: MfaSessionAuthenticator;
}

const REGISTRATION_PROBLEMS: Readonly<Record<PasskeyErrorCode, ProblemSpec>> = {
  PASSKEY_REQUEST_MALFORMED: { status: 400, title: 'Passkey mal formée', detail: 'La réponse WebAuthn est mal formée.' },
  PASSKEY_CHALLENGE_UNKNOWN: { status: 401, title: 'Challenge invalide', detail: 'Le challenge est inconnu, expiré ou déjà utilisé.' },
  PASSKEY_CLIENT_DATA_INVALID: { status: 400, title: 'Passkey mal formée', detail: 'Les données client WebAuthn sont invalides.' },
  PASSKEY_ORIGIN_INVALID: { status: 403, title: 'Origine refusée', detail: 'L’origine de la requête WebAuthn n’est pas autorisée.' },
  PASSKEY_RP_ID_MISMATCH: { status: 403, title: 'Domaine refusé', detail: 'Le domaine de la passkey ne correspond pas.' },
  PASSKEY_USER_PRESENCE_REQUIRED: { status: 401, title: 'Présence requise', detail: 'La présence de l’utilisateur est requise.' },
  PASSKEY_USER_VERIFICATION_REQUIRED: { status: 401, title: 'Vérification requise', detail: 'La vérification de l’utilisateur est requise.' },
  PASSKEY_ATTESTATION_UNSUPPORTED: { status: 400, title: 'Attestation refusée', detail: 'Seule l’attestation « none » est acceptée.' },
  PASSKEY_ALGORITHM_UNSUPPORTED: { status: 400, title: 'Algorithme refusé', detail: 'L’algorithme de la passkey n’est pas pris en charge.' },
  PASSKEY_CREDENTIAL_EXISTS: { status: 409, title: 'Passkey déjà enregistrée', detail: 'Cette passkey est déjà enregistrée.' },
  PASSKEY_CREDENTIAL_UNKNOWN: { status: 401, title: 'Passkey inconnue', detail: 'Cette passkey est inconnue.' },
  PASSKEY_SIGNATURE_INVALID: { status: 401, title: 'Signature invalide', detail: 'La signature de la passkey est invalide.' },
  PASSKEY_SIGNCOUNT_REPLAY: { status: 401, title: 'Passkey refusée', detail: 'Le compteur de la passkey est incohérent.' },
  PASSKEY_USER_MISMATCH: { status: 403, title: 'Passkey refusée', detail: 'Ce challenge n’appartient pas à cet utilisateur.' },
};

/** À la connexion, toute erreur de preuve répond de façon uniforme : aucun oracle sur les comptes ni les passkeys. */
const AUTHENTICATION_FAILED: ProblemSpec = {
  status: 401,
  title: 'Authentification refusée',
  detail: 'L’authentification par passkey a échoué.',
};

async function authenticate(deps: PasskeyRouterDeps, c: Context): Promise<AuthenticatedUser | null> {
  return deps.authenticator.authenticate({
    authorization: c.req.header('Authorization') ?? null,
    cookie: c.req.header('Cookie') ?? null,
  });
}

export function createPasskeyRouter(deps: PasskeyRouterDeps): Hono {
  const app = new Hono();
  app.onError(() => internalErrorResponse());

  app.post(PASSKEY_REGISTER_OPTIONS_PATH, async (c) => {
    const blocked = await guardRequest(deps, c, 'passkey-register-options');
    if (blocked !== null) {
      return blocked;
    }
    const user = await authenticate(deps, c);
    if (user === null) {
      return problemResponse('AUTH_REQUIRED', AUTH_REQUIRED);
    }
    const options = await beginPasskeyRegistration(deps.passkeys, {
      userId: user.userId,
      userName: user.accountLabel,
      displayName: user.accountLabel,
    });
    c.header('Cache-Control', 'no-store');
    return c.json(options, 200);
  });

  app.post(PASSKEY_REGISTER_VERIFY_PATH, async (c) => {
    const blocked = await guardRequest(deps, c, 'passkey-register-verify');
    if (blocked !== null) {
      return blocked;
    }
    const user = await authenticate(deps, c);
    if (user === null) {
      return problemResponse('AUTH_REQUIRED', AUTH_REQUIRED);
    }
    const body = await readJsonObject(c);
    const credential = body?.['credential'];
    if (credential === undefined) {
      return problemResponse('REQUEST_INVALID', REQUEST_INVALID);
    }
    try {
      const result = await finishPasskeyRegistration(deps.passkeys, { userId: user.userId, credential });
      c.header('Cache-Control', 'no-store');
      return c.json(
        { status: 'REGISTERED', credentialId: result.credentialId, algorithm: result.algorithm, prfEnabled: result.prfEnabled },
        200,
      );
    } catch (error) {
      if (error instanceof PasskeyError) {
        return problemResponse(error.code, REGISTRATION_PROBLEMS[error.code]);
      }
      throw error;
    }
  });

  app.post(PASSKEY_AUTHENTICATE_OPTIONS_PATH, async (c) => {
    const blocked = await guardRequest(deps, c, 'passkey-authenticate-options');
    if (blocked !== null) {
      return blocked;
    }
    const options = await beginPasskeyAuthentication(deps.passkeys, {});
    c.header('Cache-Control', 'no-store');
    return c.json(options, 200);
  });

  app.post(PASSKEY_AUTHENTICATE_VERIFY_PATH, async (c) => {
    const blocked = await guardRequest(deps, c, 'passkey-authenticate-verify');
    if (blocked !== null) {
      return blocked;
    }
    const body = await readJsonObject(c);
    const credential = body?.['credential'];
    if (credential === undefined) {
      return problemResponse('REQUEST_INVALID', REQUEST_INVALID);
    }
    try {
      const result = await finishPasskeyAuthentication(deps.passkeys, { credential });
      const session = await deps.sessions.issuePasskeySession({ userId: result.userId });
      c.header('Cache-Control', 'no-store');
      if (session.setCookie !== null) {
        c.header('Set-Cookie', session.setCookie);
      }
      return c.json({ status: 'AUTHENTICATED', accessToken: session.accessToken, expiresInSec: session.expiresInSec }, 200);
    } catch (error) {
      if (error instanceof PasskeyError) {
        return error.code === 'PASSKEY_REQUEST_MALFORMED' || error.code === 'PASSKEY_CLIENT_DATA_INVALID'
          ? problemResponse(error.code, REGISTRATION_PROBLEMS[error.code])
          : problemResponse('PASSKEY_AUTHENTICATION_FAILED', AUTHENTICATION_FAILED);
      }
      throw error;
    }
  });

  return app;
}
