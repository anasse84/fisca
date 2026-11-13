/** Adaptateur SQL `createSqlCpaMandatePresence` : seul un mandat ACTIVE non révoqué compte, sur SQLite et PostgreSQL. */
import { afterAll, describe, expect, it } from 'vitest';
import { CO_CLOUD, CO_E2EE, openControlPlaneBackend, seedCpaWorld, seedMandate, type ControlPlaneBackend } from './cpa-test-support.ts';
import { createSqlCpaMandatePresence } from './mandate-resolver.ts';

const opened: ControlPlaneBackend[] = [];
afterAll(async () => {
  for (const backend of opened) await backend.close();
});

describe.each(['sqlite', 'postgres'] as const)('createSqlCpaMandatePresence sur %s', (name) => {
  it('aucun mandat → false ; mandat ACTIVE → true ; mandat REVOKED seul → false ; autre dossier non concerné', async () => {
    const control = await openControlPlaneBackend(name);
    opened.push(control);
    await seedCpaWorld(control.driver);
    const presence = createSqlCpaMandatePresence(control.driver);
    expect(await presence.hasActiveMandate(CO_CLOUD)).toBe(false);
    await seedMandate(control.driver, { mandateId: 'm-revoked', companyId: CO_E2EE, status: 'REVOKED' });
    expect(await presence.hasActiveMandate(CO_E2EE)).toBe(false);
    await seedMandate(control.driver, { mandateId: 'm-active', companyId: CO_CLOUD });
    expect(await presence.hasActiveMandate(CO_CLOUD)).toBe(true);
    expect(await presence.hasActiveMandate(CO_E2EE)).toBe(false);
  });
});
