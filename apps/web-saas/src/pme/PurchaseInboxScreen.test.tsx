// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FISCA_LOCALES, directionOf, translate } from '@fisca/i18n';
import { PurchaseInboxScreen } from './PurchaseInboxScreen.tsx';
import { createPmeApi } from './pme-api.ts';
import { UUID_V7_PATTERN } from './uuid-v7.ts';
import { E1, fakeEventSourceFactory, jsonResponse, recordingFetch, row, PROPOSAL } from './ops-test-kit.ts';
import type { Call } from './ops-test-kit.ts';

const L = (key: string): string => translate('fr', 'common', `ui.pme.${key}`);

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 440 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 440 });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

function ledgerResponder(call: Call): Response {
  if (call.url === '/api/v1/ledger/entries') return jsonResponse(201, { entryId: E1, entryReference: 'ACH-1', sequenceNumber: 1, status: 'IA_PROPOSITION' });
  if (call.url.endsWith('/submit')) return jsonResponse(200, { entryId: E1, fromState: 'IA_PROPOSITION', toState: 'DRAFT', replayed: false });
  return jsonResponse(200, { entryId: E1, fromState: 'DRAFT', toState: 'REVISEE_CYCLE', replayed: false });
}

function setup(rows = [row('r1')], respond: (c: Call) => Response = ledgerResponder, locale: 'fr' | 'ar' = 'fr') {
  const es = fakeEventSourceFactory();
  const rec = recordingFetch(respond);
  const api = createPmeApi({ fetch: rec.fetch, baseUrl: '', getAccessToken: () => 'jwt', getCompanyId: () => 'dossier_1' });
  const utils = render(<PurchaseInboxScreen locale={locale} api={api} streamUrl="/api/v1/purchases/stream" eventSourceFactory={es.factory} initialRows={rows} viewportHeight={440} />);
  return { ...utils, es, rec };
}

describe('boîte d’achats SSE', () => {
  it('titre, grille nommée, connexion au flux du registre', () => {
    const { es } = setup();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(L('purchases.title'));
    expect(screen.getByRole('grid', { name: L('purchases.gridLabel') })).toBeTruthy();
    expect(es.sources[0]?.request).toEqual({ url: '/api/v1/purchases/stream', lastEventId: null });
  });
  it('liste vide : la première ligne reçue apparaît tout de suite avec son statut d’extraction', () => {
    const { es } = setup([]);
    act(() => es.sources[0]?.emit('ingestion.queued', { rowId: 'n1', sourceLabel: 'ticket.jpg' }, 'e1'));
    const grid = screen.getByRole('grid');
    expect(within(grid).getByText('ticket.jpg')).toBeTruthy();
    expect(within(grid).getByText(L('purchases.status.queued'))).toBeTruthy();
  });
  it('le statut de la même ligne évolue sans nouvelle ligne : extrait puis proposé', () => {
    const { es } = setup([]);
    act(() => es.sources[0]?.emit('ingestion.queued', { rowId: 'n1', sourceLabel: 'ticket.jpg' }, 'e1'));
    act(() => es.sources[0]?.emit('ocr.fields_extracted', { rowId: 'n1', supplierName: 'Atlas SARL', documentDate: '2027-02-01', totalTtcCents: 12345, confidenceBps: 8000 }, 'e2'));
    expect(screen.getByText('Atlas SARL')).toBeTruthy();
    expect(screen.getByText(L('purchases.status.extracted'))).toBeTruthy();
    expect(screen.getByText('123,45 MAD')).toBeTruthy();
    act(() => es.sources[0]?.emit('pcge.account_proposed', { rowId: 'n1', proposal: PROPOSAL }, 'e3'));
    expect(screen.getByText(L('purchases.status.proposed'))).toBeTruthy();
    expect(screen.getAllByRole('row').filter((r) => r.hasAttribute('data-row-id'))).toHaveLength(1);
  });
  it('lignes arrivées pendant la lecture : pastille « N nouvelles lignes », rien n’est inséré avant le clic', () => {
    const { es } = setup([row('r1'), row('r2')]);
    act(() => es.sources[0]?.emit('ingestion.queued', { rowId: 'n1', sourceLabel: 'a.pdf' }, 'e1'));
    act(() => es.sources[0]?.emit('ingestion.queued', { rowId: 'n2', sourceLabel: 'b.pdf' }, 'e2'));
    const pill = screen.getByRole('button', { name: L('purchases.newRows').replace('{count}', '2') });
    expect(screen.queryByText('a.pdf')).toBeNull();
    fireEvent.click(pill);
    expect(screen.getByText('a.pdf')).toBeTruthy();
  });
  it('rejeu après reconnexion : aucun doublon de ligne', () => {
    const { es } = setup([row('r1')]);
    act(() => es.sources[0]?.emit('ingestion.queued', { rowId: 'r1', sourceLabel: 'x.pdf' }, 'e1'));
    expect(screen.queryByRole('button', { name: /2/ })).toBeNull();
  });
  it('alerte de scission espèces et montant illisible : icône + libellé, jamais la couleur seule', () => {
    setup([row('r1', { cashSplitAlert: true }), row('r2', { totalTtcCents: null, amountIllegible: true, proposal: null, status: 'extracted' })]);
    const alert = screen.getByText(L('purchases.alert.cashSplit'));
    expect(alert.closest('[data-alert]')?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText(L('purchases.illegible'))).toBeTruthy();
  });
  it('le flux est fermé au démontage', () => {
    const { es, unmount } = setup();
    unmount();
    expect(es.sources[0]?.closed).toBe(true);
  });
  for (const locale of FISCA_LOCALES) {
    it(`${locale} : sens ${directionOf(locale)} sur la racine, montants isolés en LTR`, () => {
      const es = fakeEventSourceFactory();
      const rec = recordingFetch(ledgerResponder);
      const api = createPmeApi({ fetch: rec.fetch, baseUrl: '', getAccessToken: () => 'jwt', getCompanyId: () => 'd' });
      const { container } = render(<PurchaseInboxScreen locale={locale} api={api} streamUrl="/s" eventSourceFactory={es.factory} initialRows={[row('r1')]} viewportHeight={440} />);
      expect(container.querySelector('.fisca-pme')?.getAttribute('dir')).toBe(directionOf(locale));
      expect(container.querySelector('[role="gridcell"] span[dir="ltr"]')).not.toBeNull();
      expect(container.textContent ?? '').not.toMatch(/conforme|homologu|certifi/i);
    });
  }
});

describe('tiroir de revue : validation humaine explicite, jamais d’auto-validation', () => {
  const openRow = () => {
    const grid = screen.getByRole('grid');
    const rowEl = grid.querySelector('[data-row-id="r1"]') as HTMLElement;
    rowEl.focus();
    fireEvent.keyDown(grid.querySelector('[data-grid-scroller]') as HTMLElement, { key: 'Enter' });
  };
  it('Entrée ouvre le tiroir avec la proposition IA ; aucun appel réseau à l’ouverture', () => {
    const { rec } = setup();
    openRow();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('6111')).toBeTruthy();
    expect(within(dialog).getByText(translate('fr', 'common', 'ui.review.reviewBadge'))).toBeTruthy();
    expect(rec.calls).toHaveLength(0);
  });
  it('le bouton d’ouverture de la ligne fonctionne aussi à la souris', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(L('purchases.open')) }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('valider = créer IA_PROPOSITION (CTR-API-45) puis soumettre (CTR-API-46) ; le visa reste un second geste (CTR-API-48)', async () => {
    const { rec } = setup();
    openRow();
    fireEvent.click(screen.getByRole('button', { name: translate('fr', 'common', 'ui.review.approve') }));
    await waitFor(() => expect(rec.calls).toHaveLength(2));
    expect(rec.calls[0]?.url).toBe('/api/v1/ledger/entries');
    expect(rec.calls[0]?.body).toMatchObject({ initialState: 'IA_PROPOSITION', journalId: 'JRN-ACH', fiscalYearId: 'FY-1', reviewCycle: 'ACHATS', sourceDocumentType: 'INVOICE', entryDate: '2027-02-03' });
    expect((rec.calls[0]?.body as { lines: unknown[] }).lines).toHaveLength(3);
    expect(rec.calls[1]?.url).toBe(`/api/v1/ledger/entries/${E1}/submit`);
    expect(rec.calls[0]?.headers['Idempotency-Key']).toMatch(UUID_V7_PATTERN);
    expect(rec.calls[0]?.headers['Idempotency-Key']).not.toBe(rec.calls[1]?.headers['Idempotency-Key']);
    expect(rec.calls[0]?.headers['X-Fisca-Company-Id']).toBe('dossier_1');
    const visa = await screen.findByRole('button', { name: L('purchases.visa.action') });
    expect(rec.calls).toHaveLength(2);
    fireEvent.click(visa);
    await waitFor(() => expect(rec.calls).toHaveLength(3));
    expect(rec.calls[2]?.url).toBe(`/api/v1/ledger/entries/${E1}/visa`);
    expect(await screen.findByText(L('purchases.stage.visaed'))).toBeTruthy();
  });
  it('proposition déjà créée côté serveur (entryId) : on ne recrée pas, on soumet directement', async () => {
    const r = row('r1');
    const { rec } = setup([{ ...r, proposal: r.proposal === null ? null : { ...r.proposal, entryId: E1 } }]);
    openRow();
    fireEvent.click(screen.getByRole('button', { name: translate('fr', 'common', 'ui.review.approve') }));
    await waitFor(() => expect(rec.calls).toHaveLength(1));
    expect(rec.calls[0]?.url).toBe(`/api/v1/ledger/entries/${E1}/submit`);
  });
  it('montant illisible : validation bloquée, aucun appel', () => {
    const { rec } = setup([row('r1', { totalTtcCents: null, amountIllegible: true })]);
    openRow();
    const approve = screen.getByRole('button', { name: translate('fr', 'common', 'ui.review.approve') }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(rec.calls).toHaveLength(0);
  });
  it('erreur serveur : libellé par errorCode (jamais title/detail), reprise avec la MÊME clé d’idempotence', async () => {
    let attempt = 0;
    const { rec } = setup([row('r1')], (call) => {
      if (call.url === '/api/v1/ledger/entries') return jsonResponse(201, { entryId: E1, entryReference: 'A', sequenceNumber: 1, status: 'IA_PROPOSITION' });
      attempt += 1;
      return attempt === 1
        ? jsonResponse(409, { type: 'about:blank', title: 'TITRE SERVEUR', status: 409, errorCode: 'LEDGER_ENTRY_NOT_IN_EXPECTED_STATE', traceId: 't', detail: 'DETAIL SERVEUR' })
        : jsonResponse(200, { entryId: E1, fromState: 'IA_PROPOSITION', toState: 'DRAFT', replayed: false });
    });
    openRow();
    fireEvent.click(screen.getByRole('button', { name: translate('fr', 'common', 'ui.review.approve') }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(L('purchases.errors.conflict'));
    expect(alert.textContent).not.toMatch(/SERVEUR/);
    fireEvent.click(screen.getByRole('button', { name: translate('fr', 'common', 'actions.retry') }));
    await screen.findByRole('button', { name: L('purchases.visa.action') });
    const submits = rec.calls.filter((c) => c.url.endsWith('/submit'));
    expect(submits).toHaveLength(2);
    expect(submits[0]?.headers['Idempotency-Key']).toBe(submits[1]?.headers['Idempotency-Key']);
    expect(rec.calls.filter((c) => c.url === '/api/v1/ledger/entries')).toHaveLength(1);
  });
  it('Escape ferme le tiroir et rend le focus', () => {
    setup();
    openRow();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
