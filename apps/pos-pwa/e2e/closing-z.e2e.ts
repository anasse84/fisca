import { expect, test } from '@playwright/test';

interface ClosureRead {
  zRow: Record<string, unknown>;
  publicKeySpkiB64: string;
  chain: unknown;
  aggregates: unknown;
  sessionStatus: string;
  pending: { tickets: number; closures: number };
}
interface ClosingApi {
  initialise(): Promise<{ secureContext: boolean; appliedMigrations: number[] }>;
  closeSessionWithTwoTickets(): Promise<ClosureRead>;
  readClosure(): Promise<ClosureRead>;
}
/** Même objet `window.fiscaPosE2E` que le premier scénario ; vue typée locale pour éviter une seconde déclaration globale incompatible. */

test('OPFS : deux tickets, comptage verrouillé, clôture Z scellée, rechargement, relecture de la clôture (code réel opfs-sahpool)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { fiscaPosE2E?: unknown }).fiscaPosE2E !== undefined);
  const init = await page.evaluate(() => (window as unknown as { fiscaPosE2E: ClosingApi }).fiscaPosE2E.initialise());
  expect(init.appliedMigrations).toEqual([1, 2, 3]);

  const closed = await page.evaluate(() => (window as unknown as { fiscaPosE2E: ClosingApi }).fiscaPosE2E.closeSessionWithTwoTickets());
  process.stdout.write(`clôture écrite : ${JSON.stringify(closed.zRow)}\n`);
  expect(closed.zRow['closure_number']).toBe(1);
  expect(closed.zRow['net_b2c_ht_20_cents']).toBe(10000);
  expect(closed.zRow['net_b2c_ht_10_cents']).toBe(5000);
  expect(closed.zRow['total_stamp_duty_cents']).toBe(30);
  expect(closed.zRow['tpe_gross_cents']).toBe(5500);
  expect(closed.zRow['prev_z_sha256']).toBe('0'.repeat(64));
  expect(closed.sessionStatus).toBe('CLOTURE_TICKET_Z_SCELLEE');
  expect(closed.pending).toEqual({ tickets: 2, closures: 1 });

  await page.reload();
  await page.waitForFunction(() => (window as unknown as { fiscaPosE2E?: unknown }).fiscaPosE2E !== undefined);
  const reinit = await page.evaluate(() => (window as unknown as { fiscaPosE2E: ClosingApi }).fiscaPosE2E.initialise());
  expect(reinit.appliedMigrations).toEqual([]);
  const reread = await page.evaluate(() => (window as unknown as { fiscaPosE2E: ClosingApi }).fiscaPosE2E.readClosure());
  process.stdout.write(`clôture relue  : ${JSON.stringify(reread.zRow)}\nchaîne Z : ${JSON.stringify(reread.chain)} ; recoupement tickets : ${JSON.stringify(reread.aggregates)}\n`);
  expect(reread.zRow).toEqual(closed.zRow);
  expect(reread.publicKeySpkiB64).toBe(closed.publicKeySpkiB64);
  expect(reread.chain).toEqual({ ok: true, count: 1 });
  expect(reread.aggregates).toEqual({ ok: true, count: 1 });
  expect(reread.sessionStatus).toBe('CLOTURE_TICKET_Z_SCELLEE');
  expect(reread.pending).toEqual({ tickets: 2, closures: 1 });
});
