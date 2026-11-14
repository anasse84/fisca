import { expect, test } from '@playwright/test';

interface E2eApi {
  initialise(): Promise<{ secureContext: boolean; appliedMigrations: number[] }>;
  writeTicket(): Promise<Record<string, unknown>>;
  readTickets(): Promise<{ rows: Record<string, unknown>[]; chain: unknown; publicKeySpkiB64: string; privateKeyExtractable: boolean }>;
}
declare global {
  interface Window {
    fiscaPosE2E: E2eApi;
  }
}

test('OPFS : écrire un ticket signé, recharger la page, relire la ligne identique (code réel opfs-sahpool)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.fiscaPosE2E !== undefined);

  const init = await page.evaluate(() => window.fiscaPosE2E.initialise());
  expect(init.secureContext).toBe(true);
  expect(init.appliedMigrations).toEqual([1, 2, 3]);

  const written = await page.evaluate(() => window.fiscaPosE2E.writeTicket());
  expect(written['terminal_seq_number']).toBe('POS-M01-C01-2026-000001');
  expect(written['stamp_duty_cents']).toBe(30);
  process.stdout.write(`écrit    : ${JSON.stringify(written)}\n`);

  await page.reload();
  await page.waitForFunction(() => window.fiscaPosE2E !== undefined);
  const reinit = await page.evaluate(() => window.fiscaPosE2E.initialise());
  expect(reinit.appliedMigrations).toEqual([]);

  const reread = await page.evaluate(() => window.fiscaPosE2E.readTickets());
  process.stdout.write(`relu     : ${JSON.stringify(reread.rows[0])}\n`);
  process.stdout.write(`chaîne   : ${JSON.stringify(reread.chain)} ; clé privée extractable = ${String(reread.privateKeyExtractable)}\n`);

  const { publicKeySpkiB64, ...writtenRow } = written;
  expect(reread.rows).toHaveLength(1);
  expect(reread.rows[0]).toEqual(writtenRow);
  expect(reread.publicKeySpkiB64).toBe(publicKeySpkiB64);
  expect(reread.privateKeyExtractable).toBe(false);
  expect(reread.chain).toEqual({ ok: true, count: 1 });
});
