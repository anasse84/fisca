import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProblemError } from './problem-details.ts';
import { parseWithSchema, readJsonBody } from './request-validation.ts';
import { resolveV1RoutePolicy } from './v1-route-policies.ts';
import { createAccessTokenAuthenticator } from './tenant-router.ts';
import { T0_MS, USER_1, createTestJwt } from './pipeline-test-support.ts';

describe('parseWithSchema', () => {
  const schema = z.strictObject({ a: z.number().int(), nested: z.strictObject({ b: z.string() }) });

  it('renvoie la valeur validée', () => {
    expect(parseWithSchema(schema, { a: 1, nested: { b: 'x' } })).toEqual({ a: 1, nested: { b: 'x' } });
  });

  it('lève un ProblemError 400 avec des issues[] aux chemins pointés, sans recopier la valeur reçue', () => {
    try {
      parseWithSchema(schema, { a: 1.5, nested: { b: 7 }, secret: 'hunter2' });
      throw new Error('échec attendu');
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemError);
      if (!(error instanceof ProblemError)) throw error;
      expect(error.problem.status).toBe(400);
      expect(error.problem.errorCode).toBe('REQUEST_VALIDATION_FAILED');
      const paths = (error.problem.issues ?? []).map((issue) => issue.path);
      expect(paths).toEqual(expect.arrayContaining(['a', 'nested.b', '(racine)']));
      expect(JSON.stringify(error.problem)).not.toContain('hunter2');
    }
  });
});

describe('readJsonBody', () => {
  it('corps vide : undefined ; JSON valide : la valeur ; JSON illisible : ProblemError REQUEST_BODY_INVALID', async () => {
    expect(await readJsonBody(async () => '  ')).toBeUndefined();
    expect(await readJsonBody(async () => '{"a":1}')).toEqual({ a: 1 });
    await expect(readJsonBody(async () => '{oups')).rejects.toMatchObject({ problem: { errorCode: 'REQUEST_BODY_INVALID' } });
  });
});

describe('resolveV1RoutePolicy', () => {
  it("l'ICE est hors dossier ; tout le reste exige un dossier (échec fermé), sans clé de plan codée", () => {
    expect(resolveV1RoutePolicy({ method: 'GET', path: '/api/v1/directory/ice/000000000000097' }).tenantScope).toBe('NONE');
    for (const path of ['/api/v1/ledger/entries/x/post', '/api/v1/banking/reconcile', '/api/v1/inconnue']) {
      const policy = resolveV1RoutePolicy({ method: 'POST', path });
      expect(policy).toEqual({ audience: 'HUMAN_API', tenantScope: 'COMPANY', featureKey: null, legalExport: false });
    }
    expect(resolveV1RoutePolicy({ method: 'POST', path: '/api/v1/directory/ice/000000000000097' }).tenantScope).toBe('COMPANY');
  });
});

describe("createAccessTokenAuthenticator : preuve Step-Up", () => {
  it("transmet le claim mfa_verified_at à l'acteur authentifié", async () => {
    const jwt = await createTestJwt();
    const nowSec = Math.floor(T0_MS / 1000);
    const authenticator = createAccessTokenAuthenticator({ verify: (token) => jwt.verify(token, nowSec) });
    const actor = await authenticator.authenticate({ authorization: `Bearer ${await jwt.issue(USER_1, nowSec)}` });
    expect(actor).toMatchObject({ userId: USER_1, mfaVerifiedAtEpochSec: nowSec });
  });
});
