// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createClosingPorts } from '../src/closing/closing-ports.ts';
import { generateSigningKeyPair } from '../src/ticketing/ticket-signing.ts';
import { ClosingFlow } from '../src/ui/ClosingFlow.tsx';
import type { ClosingFlowProps } from '../src/ui/ClosingFlow.tsx';
import { resolvePosLabels } from '../src/ui/labels.ts';
import { NOW, TEST_GRID_PORT, closingHarness, sellThree } from './helpers-closing.ts';
import type { ClosingHarness } from './helpers-closing.ts';

let keyPair: CryptoKeyPair;
beforeAll(async () => {
  keyPair = await generateSigningKeyPair();
});
const open: ClosingHarness[] = [];
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  for (const h of open.splice(0)) await h.storage.close();
});

const EXPECTED_MARKERS = ['170,30', '17030', '17 030', '-10,00'];
const labels = resolvePosLabels('fr');

async function ports(actorUserId: string, h?: ClosingHarness) {
  const harness = h ?? (await closingHarness(keyPair));
  if (h === undefined) {
    open.push(harness);
    await sellThree(harness);
  }
  let n = 0;
  const p = await createClosingPorts({
    storage: harness.storage,
    grid: TEST_GRID_PORT,
    keyPair,
    now: () => NOW,
    newId: () => `z-${String((n += 1))}`,
    authorization: { canViewExpectedCash: async (id) => id === 'u-supervisor' },
    actorUserId,
    sessionId: 'sess-1',
  });
  return { harness, p };
}
const flowProps = (p: Awaited<ReturnType<typeof ports>>['p'], extra: Partial<ClosingFlowProps> = {}): ClosingFlowProps => ({ locale: 'fr', ...p, ...extra });

/** Compte 160,30 MAD : 100 + 50 + 2 × 5 + 3 × 0,10. */
async function countAndLock(): Promise<void> {
  for (const [id, qty] of [['note-10000', 1], ['note-5000', 1], ['coin-500', 2], ['coin-10', 3]] as const) {
    for (let i = 0; i < qty; i += 1) fireEvent.click(await screen.findByTestId(`count-increase-${id}`));
  }
  await waitFor(() => expect(screen.getByTestId('count-total').textContent).toContain('160,30'));
  fireEvent.click(screen.getByTestId('count-lock'));
}

describe('comptage aveugle côté caissier : le montant attendu est absent de tout le rendu', () => {
  it('avant verrouillage : ni texte, ni attribut, ni ARIA, ni titre, ni journal ne contient l’attendu', async () => {
    const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const { p } = await ports('u-cashier');
    const { container } = render(<ClosingFlow {...flowProps(p)} />);
    await screen.findByTestId('count-lock');
    assertNoExpected(container);
    consoles.forEach((c) => expect(JSON.stringify(c.mock.calls)).not.toMatch(markersRegex()));
  });

  it('après verrouillage : le caissier voit son compté et « en attente du superviseur », jamais l’attendu ni l’écart', async () => {
    const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const { harness, p } = await ports('u-cashier');
    const { container } = render(<ClosingFlow {...flowProps(p)} />);
    await countAndLock();
    await screen.findByTestId('count-locked');
    expect(container.textContent).toContain(labels.count.locked);
    expect(container.textContent).toContain('160,30');
    assertNoExpected(container);
    expect(screen.queryByTestId('variance-panel')).toBeNull();
    consoles.forEach((c) => expect(JSON.stringify(c.mock.calls)).not.toMatch(markersRegex()));
    const row = (await harness.storage.all('SELECT status FROM pos_sessions'))[0];
    expect(row?.['status']).toBe('COMPTAGE_AVEUGLE_PRE_Z');
  });

  it('le port caissier n’expose aucune capacité de révélation et la révélation n’est jamais appelée', async () => {
    const { p } = await ports('u-cashier');
    expect(p.supervisor).toBeUndefined();
    expect(Object.keys(p).sort()).toEqual(['denominations', 'lockCount', 'lockedCountedCents', 'previewZ', 'sealZ', 'sealedClosure']);
  });

  it('le composant caissier ne reçoit aucune propriété de montant attendu (code source)', () => {
    for (const name of ['BlindCountScreen.tsx']) {
      const code = readFileSync(join(import.meta.dirname, '../src/ui', name), 'utf8');
      expect(code, name).not.toMatch(/expected|attendu|variance|ecart|écart|theoretical/i);
    }
    const props = readFileSync(join(import.meta.dirname, '../src/closing/closing-ports.ts'), 'utf8');
    expect(props).toMatch(/supervisor/);
  });

  it('un caissier ne peut pas obtenir de port superviseur même en le demandant', async () => {
    const { p } = await ports('u-cashier');
    expect(p.supervisor).toBeUndefined();
  });
});

describe('comptage aveugle côté superviseur : écart révélé après verrouillage seulement', () => {
  it('le superviseur ne voit l’écart qu’une fois le comptage verrouillé (composant distinct)', async () => {
    const { p } = await ports('u-supervisor');
    expect(p.supervisor).toBeDefined();
    render(<ClosingFlow {...flowProps(p)} />);
    expect(screen.queryByTestId('variance-panel')).toBeNull();
    await countAndLock();
    const panel = await screen.findByTestId('variance-panel');
    expect(panel.textContent).toContain('160,30');
    expect(panel.textContent).toContain('170,30');
    expect(screen.getByTestId('variance-amount').textContent).toContain('-10,00');
    expect(screen.getByTestId('variance-kind').textContent).toBe(labels.variance.shortage);
  });

  it('reprise : un superviseur ouvrant la session déjà verrouillée voit l’écart sans recompter', async () => {
    const first = await ports('u-cashier');
    const { unmount } = render(<ClosingFlow {...flowProps(first.p)} />);
    await countAndLock();
    await screen.findByTestId('count-locked');
    unmount();
    const second = await ports('u-supervisor', first.harness);
    render(<ClosingFlow {...flowProps(second.p)} />);
    expect(await screen.findByTestId('variance-panel')).toBeTruthy();
    expect(screen.queryByTestId('count-lock')).toBeNull();
  });
});

describe('clôture Ticket Z : aperçu, scellement, impression', () => {
  it('aperçu par taux avant scellement ; scellement unique ; impression via la file', async () => {
    const printZ = vi.fn(async () => undefined);
    const { harness, p } = await ports('u-cashier');
    render(<ClosingFlow {...flowProps(p, { printZ })} />);
    await countAndLock();
    const preview = await screen.findByTestId('z-preview');
    expect(preview.textContent).toContain('100,00 MAD');
    expect(preview.textContent).toContain('55,00 MAD');
    expect(screen.queryByTestId('z-print')).toBeNull();
    fireEvent.click(screen.getByTestId('z-seal'));
    await screen.findByTestId('z-sealed');
    expect(screen.getByTestId('z-hash').textContent).toMatch(/[0-9a-f]{16}/);
    expect(screen.queryByTestId('z-seal')).toBeNull();
    fireEvent.click(screen.getByTestId('z-print'));
    await waitFor(() => expect(printZ).toHaveBeenCalledTimes(1));
    expect(await harness.storage.all('SELECT id FROM pos_z_closures')).toHaveLength(1);
    const text = document.body.textContent ?? '';
    for (const marker of EXPECTED_MARKERS) expect(text).not.toContain(marker);
  });
});

function markersRegex(): RegExp {
  return new RegExp(EXPECTED_MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
}

/** Cherche l’attendu dans le texte, dans TOUS les attributs, dans le HTML brut et dans le titre du document. */
function assertNoExpected(container: HTMLElement): void {
  const re = markersRegex();
  expect(container.innerHTML).not.toMatch(re);
  expect(container.textContent ?? '').not.toMatch(re);
  expect(container.textContent ?? '').not.toMatch(/attendu|expected|théorique/i);
  for (const el of [container, ...container.querySelectorAll('*')]) {
    for (const attr of Array.from(el.attributes)) {
      expect(`${attr.name}=${attr.value}`, el.tagName).not.toMatch(re);
      expect(attr.value, el.tagName).not.toMatch(/attendu|expected|théorique/i);
    }
  }
  expect(document.title).not.toMatch(re);
}
