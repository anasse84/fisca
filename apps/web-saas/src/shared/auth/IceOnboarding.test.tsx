// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatCentimesMad } from '@fisca/ui-mercury';
import { translate } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { IceOnboarding } from './IceOnboarding.tsx';
import { createAuthApi } from './api-client.ts';
import { fakeFetch, problemBody } from './auth-test-kit.ts';
import type { FakeRoutes } from './auth-test-kit.ts';

afterEach(cleanup);

const ICE = '001234567000089';
const t = (locale: FiscaLocale, key: string) => translate(locale, 'common', `ui.auth.${key}`);
const DOSSIER = {
  ice: ICE, identifiantFiscal: '12345678', rcNumber: '45678', rcTribunal: 'Rabat', raisonSocialeFr: 'Société Test SARL',
  raisonSocialeAr: 'شركة الاختبار', legalForm: 'SARL', shareCapitalCents: 10000000, addressAdc450: '12 avenue Mohammed V, Rabat', verifiedCount: 3,
};

function setup(routes: FakeRoutes, locale: FiscaLocale = 'fr') {
  const { fetch, calls } = fakeFetch(routes);
  const onConfirmed = vi.fn();
  let clock = 1_000;
  const api = createAuthApi({ fetch, getAccessToken: () => 'jwt-mem' });
  const view = render(<IceOnboarding locale={locale} api={api} now={() => clock} onConfirmed={onConfirmed} />);
  return { calls, onConfirmed, view, advance: (ms: number) => void (clock += ms) };
}

describe('Onboarding ICE', () => {
  it('un seul champ de saisie, mention « contrôle de forme seulement », ICE isolé en LTR', () => {
    const { view } = setup({});
    const inputs = view.container.querySelectorAll('input');
    expect(inputs).toHaveLength(1);
    const ice = screen.getByLabelText(t('fr', 'field.ice')) as HTMLInputElement;
    expect(ice.getAttribute('dir')).toBe('ltr');
    expect(ice.inputMode).toBe('numeric');
    expect(ice.maxLength).toBeGreaterThanOrEqual(15);
    expect(screen.getByText(t('fr', 'ice.shapeNote'))).toBeTruthy();
    expect(view.container.querySelector('.fisca-tabular-num, .tabular-nums')).not.toBeNull();
  });

  it('compteur de chiffres annoncé, saisie normalisée', () => {
    setup({});
    const ice = screen.getByLabelText(t('fr', 'field.ice')) as HTMLInputElement;
    fireEvent.change(ice, { target: { value: '001 234-567' } });
    expect(ice.value).toBe('001234567');
    expect(screen.getByText(t('fr', 'ice.counter').replace('{count}', '9'))).toBeTruthy();
  });

  it('forme invalide : aucune requête, erreur liée au champ', async () => {
    const { calls } = setup({});
    fireEvent.change(screen.getByLabelText(t('fr', 'field.ice')), { target: { value: '123' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('fr', 'action.lookup') }));
    });
    expect(calls).toHaveLength(0);
    const ice = screen.getByLabelText(t('fr', 'field.ice'));
    expect(ice.getAttribute('aria-invalid')).toBe('true');
    expect((await screen.findByRole('alert')).textContent).toContain(t('fr', 'errors.iceShape'));
  });

  it('parcours complet : recherche GET /api/v1/directory/ice/:ice, pré-remplissage, confirmation', async () => {
    const { calls, onConfirmed } = setup({ [`GET /api/v1/directory/ice/${ICE}`]: { status: 200, body: DOSSIER } });
    fireEvent.change(screen.getByLabelText(t('fr', 'field.ice')), { target: { value: ICE } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('fr', 'action.lookup') }));
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers['authorization']).toBe('Bearer jwt-mem');
    const heading = await screen.findByRole('heading', { name: t('fr', 'title.iceReview') });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText('Société Test SARL')).toBeTruthy();
    expect(screen.getByText('شركة الاختبار')).toBeTruthy();
    expect(screen.getByText(formatCentimesMad(10000000))).toBeTruthy();
    expect(screen.getByText(t('fr', 'ice.review.notice'))).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('fr', 'action.confirmDossier') }));
    });
    expect(onConfirmed).toHaveBeenCalledWith(DOSSIER);
    expect(await screen.findByRole('heading', { name: t('fr', 'title.iceDone') })).toBeTruthy();
  });

  it('texte français du dossier (raison sociale, adresse) en dir=auto pour ne pas s’inverser en page RTL', async () => {
    setup({ [`GET /api/v1/directory/ice/${ICE}`]: { status: 200, body: DOSSIER } }, 'ar');
    fireEvent.change(screen.getByLabelText(t('ar', 'field.ice')), { target: { value: ICE } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('ar', 'action.lookup') }));
    });
    await screen.findByText('Société Test SARL');
    expect(screen.getByText('Société Test SARL').getAttribute('dir')).toBe('auto');
    expect(screen.getByText('12 avenue Mohammed V, Rabat').getAttribute('dir')).toBe('auto');
  });

  it('ICE introuvable : message dédié, saisie conservée', async () => {
    setup({ [`GET /api/v1/directory/ice/${ICE}`]: { status: 404, body: problemBody(404, 'DIRECTORY_ICE_NOT_FOUND') } });
    fireEvent.change(screen.getByLabelText(t('fr', 'field.ice')), { target: { value: ICE } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('fr', 'action.lookup') }));
    });
    expect((await screen.findByRole('alert')).textContent).toContain(t('fr', 'errors.iceNotFound'));
    expect((screen.getByLabelText(t('fr', 'field.ice')) as HTMLInputElement).value).toBe(ICE);
  });

  it('retour depuis la vérification : modifier l’ICE', async () => {
    setup({ [`GET /api/v1/directory/ice/${ICE}`]: { status: 200, body: DOSSIER } });
    fireEvent.change(screen.getByLabelText(t('fr', 'field.ice')), { target: { value: ICE } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('fr', 'action.lookup') }));
    });
    await screen.findByRole('heading', { name: t('fr', 'title.iceReview') });
    fireEvent.click(screen.getByRole('button', { name: t('fr', 'action.editIce') }));
    expect((screen.getByLabelText(t('fr', 'field.ice')) as HTMLInputElement).value).toBe(ICE);
  });

  it('progression « étape x sur 2 » en texte, chronomètre informatif masqué aux lecteurs d’écran', () => {
    const { view } = setup({});
    expect(screen.getByText(t('fr', 'ice.progress').replace('{current}', '1').replace('{total}', '2'))).toBeTruthy();
    expect(view.container.querySelector('[data-testid="ice-elapsed"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it.each(['ar', 'ary', 'zgh-Tfng', 'en'] as const)('%s : titre traduit, dir cohérent', (locale) => {
    const { view } = setup({}, locale);
    expect(screen.getByRole('heading', { name: t(locale, 'title.ice') })).toBeTruthy();
    expect(view.container.querySelector('.fisca-auth')?.getAttribute('dir')).toBe(locale === 'ar' || locale === 'ary' ? 'rtl' : 'ltr');
  });
});
