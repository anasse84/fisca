import { defineConfig } from '@playwright/test';

/**
 * Preuve OPFS dans un vrai Chromium (T-P2B-09). Exige un navigateur Playwright installé : ce lot n'est PAS inclus dans
 * `test:unit` ni dans `pnpm verify:fast` (CI sans navigateur). Lancement : `pnpm --filter @fisca/pos-pwa test:e2e`.
 * `FISCA_CHROMIUM_PATH` désigne au besoin un exécutable explicite (chromium complet ou headless-shell).
 */
const executablePath = process.env['FISCA_CHROMIUM_PATH'];

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.e2e.ts',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: executablePath === undefined ? {} : { executablePath },
  },
  webServer: {
    command: 'vite --config e2e/vite.config.ts',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
