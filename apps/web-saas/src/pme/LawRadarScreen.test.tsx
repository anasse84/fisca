// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FISCA_LOCALES, directionOf, translate } from '@fisca/i18n';
import { LawRadarScreen } from './LawRadarScreen.tsx';
import { RADAR, evidencePort, radarSource } from './ops-test-kit.ts';
import type { LateInvoiceRadar } from './ports-ops.ts';

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

const pdf = (name: string, content = 'preuve', type = 'application/pdf') => new File([content], name, { type });

function setup(data: LateInvoiceRadar = RADAR, port = evidencePort(), locale: 'fr' | 'ar' = 'fr') {
  const utils = render(<LawRadarScreen locale={locale} source={radarSource(data)} evidence={port} viewportHeight={440} />);
  return { ...utils, port };
}

describe('radar Loi 69-21', () => {
  it('liste les factures avec jours de retard et pénalité fournis par le port, sans aucun calcul local', async () => {
    setup();
    const grid = await screen.findByRole('grid', { name: L('radar.gridLabel') });
    expect(within(grid).getByText('FAC-101')).toBeTruthy();
    expect(within(grid).getByText('46')).toBeTruthy();
    expect(within(grid).getByText('445,00 MAD')).toBeTruthy();
    expect(within(grid).getByText('12 000,00 MAD')).toBeTruthy();
  });
  it('une autre valeur du port change l’affichage : aucune règle de pénalité ici', async () => {
    setup({ ...RADAR, invoices: [{ ...(RADAR.invoices[0] ?? (() => { throw new Error('fixture'); })()), daysLate: 3, penaltyCents: 999 }] });
    const grid = await screen.findByRole('grid');
    expect(within(grid).getByText('3')).toBeTruthy();
    expect(within(grid).getByText('9,99 MAD')).toBeTruthy();
  });
  it('gel de pénalité : seul l’indicateur du port compte (icône + libellé)', async () => {
    setup();
    await screen.findByRole('grid');
    const frozen = screen.getAllByText(L('radar.penalty.frozen'));
    expect(frozen).toHaveLength(1);
    expect(frozen[0]?.closest('[data-frozen]')?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getAllByText(L('radar.penalty.active'))).toHaveLength(1);
  });
  it('un litige non gelé par le port reste « en cours » : aucune logique de gel locale', async () => {
    setup({ ...RADAR, invoices: [{ ...(RADAR.invoices[1] ?? (() => { throw new Error('fixture'); })()), penaltyFrozen: false }] });
    await screen.findByRole('grid');
    expect(screen.queryByText(L('radar.penalty.frozen'))).toBeNull();
  });
  it('liste vide : message d’état', async () => {
    setup({ asOfDate: '2027-04-10', invoices: [] });
    expect(await screen.findByText(translate('fr', 'common', 'states.empty'))).toBeTruthy();
  });
});

describe('dépôt de preuves de litige', () => {
  const openPanel = async () => {
    const buttons = await screen.findAllByRole('button', { name: new RegExp(L('radar.evidence.open')) });
    fireEvent.click(buttons[0] as HTMLElement);
    return screen.findByRole('region', { name: new RegExp(L('radar.evidence.title').split('{')[0] ?? '') });
  };
  const pick = (input: HTMLElement, files: File[]) => fireEvent.change(input, { target: { files } });

  it('affiche la politique du port (taille, types, nombre)', async () => {
    setup();
    const panel = await openPanel();
    expect(panel.textContent).toContain(`2 ${L('radar.evidence.unit.mb')}`);
    expect(panel.textContent).toContain('application/pdf');
    expect(panel.textContent).toContain('3');
  });
  it('fichier trop gros ou type refusé : erreur par fichier, dépôt impossible, aucune émission', async () => {
    const { port } = setup(RADAR, evidencePort({ loadPolicy: async () => ({ maxFileBytes: 4, maxFiles: 3, allowedMimeTypes: ['application/pdf'] }) }));
    const panel = await openPanel();
    pick(within(panel).getByLabelText(L('radar.evidence.pick')), [pdf('gros.pdf', 'plus de quatre octets'), pdf('x.exe', 'ab', 'application/x-msdownload')]);
    const alerts = await within(panel).findAllByRole('alert');
    expect(alerts.map((a) => a.textContent).join(' ')).toContain('gros.pdf');
    expect(alerts.map((a) => a.textContent).join(' ')).toContain('x.exe');
    const submit = within(panel).getByRole('button', { name: L('radar.evidence.submit') }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(port.submissions).toHaveLength(0);
  });
  it('empreinte SHA-256 calculée côté client, affichée, puis envoyée avec le fichier', async () => {
    const { port } = setup();
    const panel = await openPanel();
    pick(within(panel).getByLabelText(L('radar.evidence.pick')), [pdf('mise-en-demeure.pdf', 'abc')]);
    expect(await within(panel).findByText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).toBeTruthy();
    const submit = within(panel).getByRole('button', { name: L('radar.evidence.submit') }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(port.submissions).toHaveLength(1));
    expect(port.submissions[0]).toEqual({ invoiceId: 'inv-1', names: ['mise-en-demeure.pdf'], hashes: ['ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'] });
    expect(await within(panel).findByText(L('radar.evidence.sent'))).toBeTruthy();
  });
  it('après dépôt : le statut et le gel affichés viennent de la réponse du port', async () => {
    setup();
    const panel = await openPanel();
    pick(within(panel).getByLabelText(L('radar.evidence.pick')), [pdf('a.pdf', 'abc')]);
    const submit = within(panel).getByRole('button', { name: L('radar.evidence.submit') }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await within(panel).findByText(L('radar.evidence.sent'));
    await waitFor(() => expect(screen.getAllByText(L('radar.penalty.frozen')).length).toBe(2));
  });
  it('refus du port : libellé par errorCode, jamais de texte serveur', async () => {
    setup(RADAR, evidencePort({ submitEvidence: async () => ({ ok: false, errorCode: 'IDEMPOTENCY_KEY_REUSED' }) }));
    const panel = await openPanel();
    pick(within(panel).getByLabelText(L('radar.evidence.pick')), [pdf('a.pdf', 'abc')]);
    const submit = within(panel).getByRole('button', { name: L('radar.evidence.submit') }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    const alert = await within(panel).findByRole('alert');
    expect(alert.textContent).toContain(L('radar.errors.idempotency'));
  });
  it('le port de dépôt sans politique : erreur de chargement, pas de valeur par défaut codée', async () => {
    setup(RADAR, evidencePort({ loadPolicy: async () => Promise.reject(new Error('x')) }));
    const buttons = await screen.findAllByRole('button', { name: new RegExp(L('radar.evidence.open')) });
    fireEvent.click(buttons[0] as HTMLElement);
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  });
  for (const locale of FISCA_LOCALES) {
    it(`${locale} : sens ${directionOf(locale)}, montants en LTR isolé`, async () => {
      const { container } = setup(RADAR, evidencePort(), locale as 'fr');
      await screen.findByRole('grid');
      expect(container.querySelector('.fisca-pme')?.getAttribute('dir')).toBe(directionOf(locale));
      expect(container.querySelector('[role="gridcell"] span[dir="ltr"]')).not.toBeNull();
      expect(container.textContent ?? '').not.toMatch(/conforme|homologu|certifi/i);
    });
  }
});
