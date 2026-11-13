/**
 * Outillage RÉSERVÉ AUX TESTS (sous-chemin d'export `@fisca/auth-rbac/testing`). Volontairement absent de
 * l'index public : le code de production ne peut pas abaisser le coût PBKDF2 (ERRATA D-01).
 * Une seule fabrique abaisse le coût ET la borne ensemble.
 */
import { createPasswordService } from './password-service.ts';
import type { PasswordService } from './password-service.ts';

/** Coût PBKDF2 des tests : très inférieur à 100 000, seulement dérivé pour la rapidité des suites. */
export const TEST_PASSWORD_ITERATIONS = 1000;

export function createLowCostPasswordService(): PasswordService {
  return createPasswordService({ iterations: TEST_PASSWORD_ITERATIONS, minIterations: TEST_PASSWORD_ITERATIONS });
}
