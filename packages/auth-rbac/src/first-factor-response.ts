/**
 * Traduction HTTP commune d'un FirstFactorOutcome (login CTR-API-03, callback Google CTR-API-05).
 * Jamais d'accessToken ni de cookie de refresh dans une réponse MFA_REQUIRED ou MFA_ENROLLMENT_REQUIRED.
 */

import type { Context } from 'hono';
import type { ProblemDetails } from '@fisca/shared-types';
import type { FirstFactorOutcome } from './first-factor.ts';

export interface ProblemSpec {
  readonly status: 400 | 401 | 403 | 409 | 429 | 500;
  readonly title: string;
  readonly detail: string;
}

export function problemResponse(errorCode: string, spec: ProblemSpec, extraHeaders: Readonly<Record<string, string>> = {}): Response {
  const body: ProblemDetails = {
    type: 'about:blank',
    title: spec.title,
    status: spec.status,
    errorCode,
    traceId: crypto.randomUUID(),
    detail: spec.detail,
  };
  return new Response(JSON.stringify(body), {
    status: spec.status,
    headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

export const MFA_ENROLLMENT_REQUIRED: ProblemSpec = {
  status: 409,
  title: 'Second facteur à activer',
  detail: 'Ce compte doit activer un second facteur avant de pouvoir ouvrir une session.',
};

export function firstFactorResponse(
  c: Context,
  outcome: FirstFactorOutcome,
  sessionExtras: Readonly<Record<string, string | boolean>> = {},
): Response {
  c.header('Cache-Control', 'no-store');
  if (outcome.kind === 'MFA_REQUIRED') {
    return c.json(
      {
        status: 'MFA_REQUIRED',
        mfa_challenge_token: outcome.mfaChallengeToken,
        expiresAtEpochSec: outcome.expiresAtEpochSec,
        methods: outcome.methods,
      },
      200,
    );
  }
  if (outcome.kind === 'MFA_ENROLLMENT_REQUIRED') {
    return problemResponse('MFA_ENROLLMENT_REQUIRED', MFA_ENROLLMENT_REQUIRED);
  }
  if (outcome.session.setCookie !== null) {
    c.header('Set-Cookie', outcome.session.setCookie);
  }
  return c.json(
    {
      status: 'AUTHENTICATED',
      ...sessionExtras,
      accessToken: outcome.session.accessToken,
      expiresInSec: outcome.session.expiresInSec,
    },
    200,
  );
}
