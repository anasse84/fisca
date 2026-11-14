import { defineConfig } from 'vitest/config';

// Les tests de contrôle croisé lancent des JVM (PHIVE, Mustang, veraPDF) et des outils externes : sous la charge de
// `turbo run` en parallèle, le délai par défaut de 5 s expire sans signaler un défaut du code (ERRATA B-08 : les budgets de temps sont des cibles).
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
