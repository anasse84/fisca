import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import * as publicIndex from '../src/index.ts';
import {
  PASSWORD_PBKDF2_ITERATIONS,
  PRODUCTION_PASSWORD_SERVICE,
  authenticatePassword,
  initialLockoutState,
  verifyPasswordWorkerSafe,
} from '../src/index.ts';
import { TEST_PASSWORD_ITERATIONS, createLowCostPasswordService } from '../src/testing.ts';

const PASSWORD = 'mot-de-passe-factice-12';
const PEPPER = 'pepper-factice-de-test';

describe('service de mots de passe : coût PBKDF2 (ERRATA D-01)', () => {
  it('la configuration de production fabrique des hash à 100 000 itérations (paramètres, sans dérivation)', () => {
    expect(PASSWORD_PBKDF2_ITERATIONS).toBe(100000);
    expect(PRODUCTION_PASSWORD_SERVICE.iterations).toBe(100000);
    expect(PRODUCTION_PASSWORD_SERVICE.minIterations).toBe(100000);
  });

  it('la configuration de production REFUSE un hash à faible coût, même avec le bon mot de passe', async () => {
    const low = createLowCostPasswordService();
    const lowHash = await low.hash(PASSWORD, PEPPER);
    expect(lowHash.split('$')[1]).toBe(String(TEST_PASSWORD_ITERATIONS));
    expect(TEST_PASSWORD_ITERATIONS).toBeLessThan(100000);
    await expect(low.verify(PASSWORD, PEPPER, lowHash)).resolves.toBe(true);
    await expect(PRODUCTION_PASSWORD_SERVICE.verify(PASSWORD, PEPPER, lowHash)).resolves.toBe(false);
    await expect(verifyPasswordWorkerSafe(PASSWORD, PEPPER, lowHash)).resolves.toBe(false);
    const attempt = await authenticatePassword({
      plainPassword: PASSWORD,
      pepper: PEPPER,
      storedHash: lowHash,
      state: initialLockoutState(),
      nowEpochMs: 1_800_000_000_000,
    });
    expect(attempt.outcome).toBe('FAILURE');
    expect(attempt.state.consecutiveFailures).toBe(1);
  });

  it('la fabrique de test abaisse le coût ET la borne ensemble', () => {
    const low = createLowCostPasswordService();
    expect(low.iterations).toBe(TEST_PASSWORD_ITERATIONS);
    expect(low.minIterations).toBe(TEST_PASSWORD_ITERATIONS);
  });

  it("l'index public n'exporte pas la fabrique de test, et le sous-chemin ./testing est déclaré à part", () => {
    expect(Object.keys(publicIndex)).not.toContain('createLowCostPasswordService');
    expect(Object.keys(publicIndex)).not.toContain('createPasswordService');
    expect(Object.keys(publicIndex)).not.toContain('TEST_PASSWORD_ITERATIONS');
    expect(pkg.exports['./testing'].default).toBe('./src/testing.ts');
    expect(pkg.exports['.'].default).toBe('./src/index.ts');
  });
});
