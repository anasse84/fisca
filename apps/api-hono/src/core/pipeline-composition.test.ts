/** Composition du pipeline (S1B point 3) : `createPipelineDeps` branche `createSqlCpaMandatePresence(controlPlane)`. */
import { describe, expect, it } from 'vitest';
import { openControlPlaneBackend, seedCpaWorld, seedMandate, CO_CLOUD, CO_E2EE } from './cpa-test-support.ts';
import { createPipelineDeps } from './pipeline-composition.ts';
import { createFakeEntitlements, createFakeKv, createFakeMandates, createFakeMemberships, createFakeTenants, createTestClock, activeRows } from './pipeline-test-support.ts';
import { createAccessTokenAuthenticator } from './tenant-router.ts';

describe('createPipelineDeps', () => {
  it('fournit une présence de mandat SQL réellement branchée sur le plan de contrôle', async () => {
    const control = await openControlPlaneBackend('sqlite');
    await seedCpaWorld(control.driver);
    const clock = createTestClock();
    const memberships = createFakeMemberships();
    const mandates = createFakeMandates();
    const deps = createPipelineDeps({
      controlPlane: control.driver,
      authenticator: createAccessTokenAuthenticator({ verify: async () => { throw new Error('non utilisé'); } }),
      memberships,
      mandates,
      tenants: createFakeTenants([CO_CLOUD]),
      entitlements: { source: createFakeEntitlements(activeRows([])), kv: createFakeKv(clock), cacheTtlSec: 120 },
      idempotencyStore: { reserve: async () => { throw new Error('non utilisé'); }, complete: async () => undefined, release: async () => undefined },
      nowMs: clock.nowMs,
    });
    expect(deps.cpaMandatePresence).toBeDefined();
    expect(deps.memberships).toBe(memberships);
    expect(deps.mandates).toBe(mandates);
    expect(await deps.cpaMandatePresence?.hasActiveMandate(CO_CLOUD)).toBe(false);
    await seedMandate(control.driver, { companyId: CO_CLOUD });
    expect(await deps.cpaMandatePresence?.hasActiveMandate(CO_CLOUD)).toBe(true);
    expect(await deps.cpaMandatePresence?.hasActiveMandate(CO_E2EE)).toBe(false);
  });
});
