// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FISCA_LOCALES, directionOf, translate } from '@fisca/i18n';
import { BankReconciliationScreen } from './BankReconciliationScreen.tsx';
import { createPmeApi } from './pme-api.ts';
import { UUID_V7_PATTERN } from './uuid-v7.ts';
import { BANK_WORKSPACE, E1, E2, E3, bankSource, jsonResponse, recordingFetch } from './ops-test-kit.ts';
import type { Call } from './ops-test-kit.ts';
import type { BankWorkspace } from './ports-ops.ts';

afterEach(cleanup);
const L = (key: string): string => translate('fr', 'common', `ui.pme.${key}`);

function setup(respond: (c: Call) => Response, ws: BankWorkspace = BANK_WORKSPACE, locale: 'fr' | 'ar' = 'fr') {
  const rec = recordingFetch(respond);
  const api = createPmeApi({ fetch: rec.fetch, baseUrl: '', getAccessToken: () => 'jwt', getCompanyId: () => 'dossier_1' });
  const utils = render(<BankReconciliationScreen locale={locale} source={bankSource(ws)} api={api} />);
  return { ...utils, rec };
}

const matchedFull = (c: Call): Response =>
  jsonResponse(201, { outcome: 'MATCHED_FULL', bankTransactionId: (c.body as { bankTransactionId: string }).bankTransactionId, reconciliationCode: 'LTR-a', invoiceEntryId: E1, clearingEntryId: 'c1', clearedCents: 12000 });

async function select(id: string): Promise<void> {
  const el = await screen.findByTestId(`bank-line-${id}`);
  fireEvent.click(within(el).getByRole('button'));
}

describe('rapprochement bancaire assisté', () => {
  it('deux colonnes nommées : relevé et écritures, montants en centimes formatés', async () => {
    setup(matchedFull);
    expect(await screen.findByRole('region', { name: L('bank.statementTitle') })).toBeTruthy();
    expect(screen.getByRole('region', { name: L('bank.entriesTitle') })).toBeTruthy();
    expect(screen.getAllByText('120,00 MAD').length).toBeGreaterThan(0);
  });
  it('aucun appel réseau avant la décision humaine', async () => {
    const { rec } = setup(matchedFull);
    await select('b-unique');
    expect(rec.calls).toHaveLength(0);
  });
  it('suggestion unique : score en bps affiché, validation explicite → CTR-API-12 au corps exact', async () => {
    const { rec } = setup(matchedFull);
    await select('b-unique');
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('94');
    expect(screen.getByText(L('bank.notice.humanValidation'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: L('bank.actions.validate') }));
    await waitFor(() => expect(rec.calls).toHaveLength(1));
    expect(rec.calls[0]?.url).toBe('/api/v1/banking/reconcile');
    expect(rec.calls[0]?.body).toEqual({
      bankTransactionId: 'b-unique',
      journalId: 'JRN-BQ',
      fiscalYearId: 'FY-1',
      entryDate: '2027-02-05',
      paymentMethodCode: '30_VIREMENT',
      candidates: [{ invoiceEntryId: E1, settledBeforeCents: 0 }],
    });
    expect(rec.calls[0]?.headers['Idempotency-Key']).toMatch(UUID_V7_PATTERN);
    expect(rec.calls[0]?.headers['X-Fisca-Company-Id']).toBe('dossier_1');
    expect(await screen.findByText(L('bank.state.matched'))).toBeTruthy();
  });
  it('rapprochement ambigu : AUCUN bouton valider ; le choix explicite « mettre en suspens » est imposé', async () => {
    const { rec } = setup((c) =>
      jsonResponse(200, { outcome: 'SUSPENS_AMBIGU_3497_4497', bankTransactionId: (c.body as { bankTransactionId: string }).bankTransactionId, reconciliationCode: 'LTR-s', candidateCount: 2 }),
    );
    await select('b-ambig');
    expect(screen.queryByRole('button', { name: L('bank.actions.validate') })).toBeNull();
    expect(screen.getByText(L('bank.suggestion.ambiguous'))).toBeTruthy();
    const suspend = screen.getByRole('button', { name: L('bank.actions.suspend') });
    expect(rec.calls).toHaveLength(0);
    fireEvent.click(suspend);
    await waitFor(() => expect(rec.calls).toHaveLength(1));
    expect((rec.calls[0]?.body as { candidates: { invoiceEntryId: string }[] }).candidates.map((x) => x.invoiceEntryId)).toEqual([E2, E3]);
    expect(await screen.findByText(L('bank.state.suspense'))).toBeTruthy();
  });
  it('aucune candidate : ni validation ni suspens, message explicite', async () => {
    setup(matchedFull);
    await select('b-none');
    expect(screen.getByText(L('bank.suggestion.none'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: L('bank.actions.validate') })).toBeNull();
    expect(screen.queryByRole('button', { name: L('bank.actions.suspend') })).toBeNull();
  });
  it('ligne déjà traitée (409) : libellé par errorCode, jamais le texte serveur ; la clé est conservée pour une reprise', async () => {
    const { rec } = setup(() => jsonResponse(409, { type: 'about:blank', title: 'TITRE SERVEUR', status: 409, errorCode: 'BANK_TRANSACTION_ALREADY_RECONCILED', traceId: 't', detail: 'DETAIL SERVEUR' }));
    await select('b-unique');
    fireEvent.click(screen.getByRole('button', { name: L('bank.actions.validate') }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(L('bank.errors.alreadyReconciled'));
    expect(alert.textContent).not.toMatch(/SERVEUR/);
    fireEvent.click(screen.getByRole('button', { name: L('bank.actions.validate') }));
    await waitFor(() => expect(rec.calls).toHaveLength(2));
    expect(rec.calls[0]?.headers['Idempotency-Key']).toBe(rec.calls[1]?.headers['Idempotency-Key']);
  });
  it('NO_MATCH serveur : « non rapproché », rien n’est écrit', async () => {
    setup((c) => jsonResponse(200, { outcome: 'NO_MATCH', bankTransactionId: (c.body as { bankTransactionId: string }).bankTransactionId }));
    await select('b-unique');
    fireEvent.click(screen.getByRole('button', { name: L('bank.actions.validate') }));
    expect(await screen.findByText(L('bank.state.noMatch'))).toBeTruthy();
  });
  it('mode de règlement absent sur la ligne : l’utilisateur doit choisir parmi la liste du port avant de valider', async () => {
    const ws: BankWorkspace = { ...BANK_WORKSPACE, lines: [{ id: 'b-unique', valueDate: '2027-02-05', label: 'VIR ATLAS', amountCents: 12000 }, ...BANK_WORKSPACE.lines.slice(1)] };
    const { rec } = setup(matchedFull, ws);
    await select('b-unique');
    const validate = screen.getByRole('button', { name: L('bank.actions.validate') }) as HTMLButtonElement;
    expect(validate.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(L('bank.method.label')), { target: { value: '20_CHEQUE' } });
    expect(validate.disabled).toBe(false);
    fireEvent.click(validate);
    await waitFor(() => expect(rec.calls).toHaveLength(1));
    expect((rec.calls[0]?.body as { paymentMethodCode: string }).paymentMethodCode).toBe('20_CHEQUE');
  });
  it('échec de chargement du port : alerte et bouton Réessayer', async () => {
    const rec = recordingFetch(matchedFull);
    const api = createPmeApi({ fetch: rec.fetch, baseUrl: '', getAccessToken: () => 'jwt', getCompanyId: () => 'd' });
    render(<BankReconciliationScreen locale="fr" source={{ loadWorkspace: async () => Promise.reject(new Error('x')) }} api={api} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: translate('fr', 'common', 'actions.retry') })).toBeTruthy();
  });
  for (const locale of FISCA_LOCALES) {
    it(`${locale} : sens ${directionOf(locale)}, montants et dates en LTR isolé`, async () => {
      const { container } = setup(matchedFull, BANK_WORKSPACE, locale as 'fr');
      await screen.findByTestId('bank-line-b-unique');
      expect(container.querySelector('.fisca-pme')?.getAttribute('dir')).toBe(directionOf(locale));
      expect(container.querySelector('span[dir="ltr"].fisca-tabular-num')).not.toBeNull();
      expect(container.querySelector('time[dir="ltr"]')).not.toBeNull();
    });
  }
});
