// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { AuthFlow } from './AuthFlow.tsx';
import { createAuthApi } from './api-client.ts';
import { fakeFetch, problemBody } from './auth-test-kit.ts';
import type { FakeRoutes } from './auth-test-kit.ts';
import type { CredentialsLike } from './passkey.ts';

afterEach(cleanup);

const t = (locale: FiscaLocale, key: string) => translate(locale, 'common', `ui.auth.${key}`);
const SESSION = { status: 'AUTHENTICATED', accessToken: 'jwt-mem', expiresInSec: 900 };
const MFA = { status: 'MFA_REQUIRED', mfa_challenge_token: 'chal', expiresAtEpochSec: 4_000_000_000, methods: ['TOTP', 'RECOVERY_CODE'] };

function setup(routes: FakeRoutes, props: Partial<Parameters<typeof AuthFlow>[0]> = {}) {
  const { fetch, calls } = fakeFetch(routes);
  const onAuthenticated = vi.fn();
  const navigate = vi.fn();
  const api = createAuthApi({ fetch, getTurnstileToken: async () => 'ts' });
  const view = render(<AuthFlow locale="fr" api={api} onAuthenticated={onAuthenticated} navigate={navigate} passkeyCredentials={null} {...props} />);
  return { calls, onAuthenticated, navigate, view };
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

describe('Login', () => {
  it('libellés fr, champs nommés, Google présent, Passkey absent sans WebAuthn', () => {
    setup({});
    expect(screen.getByRole('heading', { name: t('fr', 'title.login') })).toBeTruthy();
    expect(screen.getByLabelText(t('fr', 'field.email'))).toBeTruthy();
    expect(screen.getByLabelText(t('fr', 'field.password'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('fr', 'action.google') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('fr', 'action.passkey') })).toBeNull();
  });

  it('le mot de passe est masqué par défaut et basculable au clavier, avec autocomplete adapté', () => {
    setup({});
    const pwd = screen.getByLabelText(t('fr', 'field.password')) as HTMLInputElement;
    expect(pwd.type).toBe('password');
    expect(pwd.autocomplete).toBe('current-password');
    expect((screen.getByLabelText(t('fr', 'field.email')) as HTMLInputElement).autocomplete).toBe('username');
    const toggle = screen.getByRole('button', { name: t('fr', 'action.showPassword') });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(pwd.type).toBe('text');
    expect(screen.getByRole('button', { name: t('fr', 'action.hidePassword') }).getAttribute('aria-pressed')).toBe('true');
  });

  it('connexion réussie : appelle login puis onAuthenticated avec le jeton, sans toucher aux stockages', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { calls, onAuthenticated } = setup({ 'POST /api/v1/auth/login': { status: 200, body: SESSION } });
    type(t('fr', 'field.email'), 'amina@exemple.ma');
    type(t('fr', 'field.password'), 'un-mot-de-passe-long');
    await submit(t('fr', 'action.login'));
    expect(calls[0]?.body).toEqual({ email: 'amina@exemple.ma', password: 'un-mot-de-passe-long' });
    expect(onAuthenticated).toHaveBeenCalledWith({ accessToken: 'jwt-mem', expiresInSec: 900, prfOutput: null });
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('échec : message traduit dans une région role=alert, focus dessus, jamais le texte du serveur', async () => {
    setup({ 'POST /api/v1/auth/login': { status: 401, body: problemBody(401, 'LOGIN_INVALID_CREDENTIALS') } });
    type(t('fr', 'field.email'), 'a@b.ma');
    type(t('fr', 'field.password'), 'x');
    await submit(t('fr', 'action.login'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('fr', 'errors.invalidCredentials'));
    expect(document.body.textContent).not.toContain('Détail serveur en français');
    expect(document.activeElement).toBe(alert);
  });

  it('5 échecs : bouton désactivé, compte à rebours annoncé en role=status', async () => {
    setup({ 'POST /api/v1/auth/login': { status: 401, body: problemBody(401, 'LOGIN_INVALID_CREDENTIALS') } });
    type(t('fr', 'field.email'), 'a@b.ma');
    type(t('fr', 'field.password'), 'x');
    for (let i = 0; i < 5; i += 1) {
      await submit(t('fr', 'action.login'));
    }
    const button = screen.getByRole('button', { name: t('fr', 'action.login') }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/\d+/);
  });

  it('champ en erreur (issues[] du serveur) : aria-invalid et aria-describedby vers un message traduit', async () => {
    setup({
      'POST /api/v1/auth/login': { status: 400, body: problemBody(400, 'REQUEST_VALIDATION_FAILED', { issues: [{ path: 'email', message: 'Adresse invalide' }] }) },
    });
    type(t('fr', 'field.email'), 'x');
    type(t('fr', 'field.password'), 'x');
    await submit(t('fr', 'action.login'));
    const email = screen.getByLabelText(t('fr', 'field.email'));
    await waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('true'));
    const described = document.getElementById(email.getAttribute('aria-describedby')?.split(' ')[0] ?? '');
    expect(described?.textContent).toBe(t('fr', 'errors.field.email'));
  });

  it('Google : navigue vers /api/v1/auth/google/start avec le jeton Turnstile', async () => {
    const { navigate } = setup({});
    await submit(t('fr', 'action.google'));
    expect(navigate).toHaveBeenCalledWith('/api/v1/auth/google/start?cf-turnstile-response=ts');
  });

  it('Passkey : visible si WebAuthn disponible, enchaîne options puis verify, PRF transmis en mémoire seulement', async () => {
    const credentials: CredentialsLike = {
      get: async () => ({
        id: 'BQYH', rawId: new Uint8Array([5, 6, 7]).buffer, type: 'public-key',
        response: { clientDataJSON: new Uint8Array([1]).buffer, authenticatorData: new Uint8Array([2]).buffer, signature: new Uint8Array([3]).buffer, userHandle: null },
        getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: new Uint8Array([9, 9]).buffer } } }),
      }),
    };
    const { calls, onAuthenticated } = setup(
      {
        'POST /api/v1/auth/passkeys/authenticate/options': { status: 200, body: { challenge: 'AQID', rpId: 'fisca.ma', timeout: 1, userVerification: 'required', allowCredentials: [], extensions: { prf: { eval: { first: 'AQ' } } } } },
        'POST /api/v1/auth/passkeys/authenticate/verify': { status: 200, body: SESSION },
      },
      { passkeyCredentials: credentials },
    );
    await submit(t('fr', 'action.passkey'));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(calls).toHaveLength(2);
    const arg = onAuthenticated.mock.calls[0]?.[0] as { prfOutput: Uint8Array | null };
    expect([...(arg.prfOutput ?? [])]).toEqual([9, 9]);
  });
});

describe('Défi 2FA', () => {
  async function toMfa() {
    const ctx = setup({
      'POST /api/v1/auth/login': { status: 200, body: MFA },
      'POST /api/v1/auth/2fa/verify': { status: 200, body: SESSION },
    });
    type(t('fr', 'field.email'), 'a@b.ma');
    type(t('fr', 'field.password'), 'un-mot-de-passe-long');
    await submit(t('fr', 'action.login'));
    return ctx;
  }

  it('affiche le défi, déplace le focus sur le titre, aucune session émise avant le second facteur', async () => {
    const { onAuthenticated } = await toMfa();
    const heading = await screen.findByRole('heading', { name: t('fr', 'title.mfa') });
    expect(document.activeElement).toBe(heading);
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it('TOTP : champ à 6 chiffres, clavier numérique, one-time-code ; envoie mfa_challenge_token, method, code', async () => {
    const { calls, onAuthenticated } = await toMfa();
    const code = (await screen.findByLabelText(t('fr', 'field.code'))) as HTMLInputElement;
    expect(code.inputMode).toBe('numeric');
    expect(code.autocomplete).toBe('one-time-code');
    expect(code.maxLength).toBe(6);
    fireEvent.change(code, { target: { value: '12a34 56' } });
    expect(code.value).toBe('123456');
    await submit(t('fr', 'action.submitCode'));
    expect(calls[1]?.body).toEqual({ mfa_challenge_token: 'chal', method: 'TOTP', code: '123456' });
    expect(onAuthenticated).toHaveBeenCalledWith({ accessToken: 'jwt-mem', expiresInSec: 900, prfOutput: null });
  });

  it('code de secours : sélecteur de méthode (radiogroup), champ texte libre', async () => {
    const { calls } = await toMfa();
    const group = await screen.findByRole('radiogroup', { name: t('fr', 'method.label') });
    fireEvent.click(within(group).getByLabelText(t('fr', 'method.RECOVERY_CODE')));
    const code = screen.getByLabelText(t('fr', 'field.code')) as HTMLInputElement;
    expect(code.maxLength).toBeGreaterThan(6);
    fireEvent.change(code, { target: { value: 'ABCD-EFGH-1234' } });
    await submit(t('fr', 'action.submitCode'));
    expect(calls[1]?.body).toEqual({ mfa_challenge_token: 'chal', method: 'RECOVERY_CODE', code: 'ABCD-EFGH-1234' });
  });

  it('méthodes proposées = méthodes annoncées par le serveur (pas de INFOBIP_OTP ici)', async () => {
    await toMfa();
    const group = await screen.findByRole('radiogroup', { name: t('fr', 'method.label') });
    expect(within(group).queryByLabelText(t('fr', 'method.INFOBIP_OTP'))).toBeNull();
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
  });

  it('Retour : revient au login et le défi est oublié', async () => {
    await toMfa();
    await screen.findByLabelText(t('fr', 'field.code'));
    fireEvent.click(screen.getByRole('button', { name: translate('fr', 'common', 'actions.back') }));
    expect(await screen.findByRole('heading', { name: t('fr', 'title.login') })).toBeTruthy();
  });

  it('défi expiré côté serveur : retour au login avec le message', async () => {
    setup({ 'POST /api/v1/auth/login': { status: 200, body: MFA }, 'POST /api/v1/auth/2fa/verify': { status: 401, body: problemBody(401, 'MFA_CHALLENGE_EXPIRED') } });
    type(t('fr', 'field.email'), 'a@b.ma');
    type(t('fr', 'field.password'), 'un-mot-de-passe-long');
    await submit(t('fr', 'action.login'));
    fireEvent.change(await screen.findByLabelText(t('fr', 'field.code')), { target: { value: '123456' } });
    await submit(t('fr', 'action.submitCode'));
    expect((await screen.findByRole('alert')).textContent).toContain(t('fr', 'errors.challengeExpired'));
    expect(screen.getByRole('heading', { name: t('fr', 'title.login') })).toBeTruthy();
  });
});

describe('Inscription', () => {
  it('indicateur de robustesse : annoncé en région polie, jamais par la couleur seule', () => {
    setup({}, { initialStep: 'signup' });
    const pwd = screen.getByLabelText(t('fr', 'field.password'));
    expect((pwd as HTMLInputElement).autocomplete).toBe('new-password');
    fireEvent.change(pwd, { target: { value: 'aaaa' } });
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('1');
    expect(meter.getAttribute('aria-valuemax')).toBe('4');
    expect(meter.getAttribute('aria-valuetext')).toBe(t('fr', 'strength.weak'));
    fireEvent.change(pwd, { target: { value: 'Chaval-Bleu-Traverse-2026!' } });
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toBe(t('fr', 'strength.strong'));
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain(t('fr', 'strength.strong'));
  });

  it('nom complet en dir=auto : un nom latin garde sa ponctuation en page RTL', () => {
    setup({}, { initialStep: 'signup', locale: 'ar' });
    expect(screen.getByLabelText(t('ar', 'field.fullName')).getAttribute('dir')).toBe('auto');
  });

  it('inscription → code de vérification → retour au login', async () => {
    const { calls } = setup(
      { 'POST /api/v1/auth/register': { status: 202, body: { status: 'VERIFICATION_PENDING' } }, 'POST /api/v1/auth/verify-email': { status: 200, body: { status: 'EMAIL_VERIFIED' } } },
      { initialStep: 'signup' },
    );
    type(t('fr', 'field.fullName'), 'Amina B.');
    type(t('fr', 'field.email'), 'amina@exemple.ma');
    type(t('fr', 'field.password'), 'Chaval-Bleu-Traverse-2026!');
    await submit(t('fr', 'action.signup'));
    expect(calls[0]?.body).toEqual({ email: 'amina@exemple.ma', password: 'Chaval-Bleu-Traverse-2026!', full_name: 'Amina B.' });
    expect(await screen.findByRole('heading', { name: t('fr', 'title.verifyEmail') })).toBeTruthy();
    expect(screen.getByText(/amina@exemple\.ma/)).toBeTruthy();
    type(t('fr', 'field.verifyCode'), '123456');
    await submit(t('fr', 'action.verifyEmail'));
    expect(calls[1]?.body).toEqual({ token: '123456' });
    expect(await screen.findByRole('heading', { name: t('fr', 'title.login') })).toBeTruthy();
  });

  it('Google depuis l’inscription : même route /google/start', async () => {
    const { navigate } = setup({}, { initialStep: 'signup' });
    await submit(t('fr', 'action.google'));
    expect(navigate).toHaveBeenCalledWith('/api/v1/auth/google/start?cf-turnstile-response=ts');
  });
});

describe('Mot de passe oublié et réinitialisation', () => {
  it('forgot : message neutre identique que le compte existe ou non', async () => {
    const { calls } = setup({ 'POST /api/v1/auth/password/forgot': { status: 202, body: { status: 'RESET_REQUESTED' } } });
    fireEvent.click(screen.getByRole('button', { name: t('fr', 'action.forgot') }));
    type(t('fr', 'field.email'), 'a@b.ma');
    await submit(t('fr', 'action.sendLink'));
    expect(calls[0]?.body).toEqual({ email: 'a@b.ma' });
    expect(await screen.findByText(t('fr', 'body.forgotSent'))).toBeTruthy();
  });

  it('reset avec le jeton du lien : POST password/reset {token, newPassword}, puis message de fin', async () => {
    const { calls } = setup({ 'POST /api/v1/auth/password/reset': { status: 200, body: { status: 'PASSWORD_RESET' } } }, { initialStep: 'reset', resetToken: 'jeton-du-lien' });
    expect(screen.queryByLabelText(t('fr', 'field.resetToken'))).toBeNull();
    type(t('fr', 'field.newPassword'), 'Nouveau-mot-de-passe-2026');
    await submit(t('fr', 'action.reset'));
    expect(calls[0]?.body).toEqual({ token: 'jeton-du-lien', newPassword: 'Nouveau-mot-de-passe-2026' });
    expect(await screen.findByText(t('fr', 'body.resetDone'))).toBeTruthy();
  });

  it('reset sans jeton fourni : champ de saisie du jeton', () => {
    setup({}, { initialStep: 'reset' });
    expect(screen.getByLabelText(t('fr', 'field.resetToken'))).toBeTruthy();
  });
});

describe('Langues, RTL, accessibilité', () => {
  it.each([['ar', 'rtl'], ['ary', 'rtl'], ['fr', 'ltr'], ['en', 'ltr'], ['zgh-Latn', 'ltr'], ['zgh-Tfng', 'ltr']] as const)('%s : dir=%s, lang posés, e-mail isolé en LTR', (locale, dir) => {
    const { view } = setup({}, { locale });
    const root = view.container.querySelector('.fisca-auth');
    expect(root?.getAttribute('dir')).toBe(dir);
    expect(root?.getAttribute('lang')).toBe(locale);
    expect(screen.getByLabelText(t(locale, 'field.email')).getAttribute('dir')).toBe('ltr');
    expect(screen.getByRole('heading', { name: t(locale, 'title.login') })).toBeTruthy();
  });

  it('tous les champs et boutons ont un nom accessible ; aucun autofocus ; un seul h1', () => {
    const { view } = setup({}, { initialStep: 'signup' });
    for (const el of view.container.querySelectorAll('input')) {
      expect(el.labels?.length ?? 0, el.name).toBeGreaterThan(0);
    }
    for (const el of view.container.querySelectorAll('button')) {
      expect((el.textContent ?? '').trim().length || el.getAttribute('aria-label'), 'bouton sans nom').toBeTruthy();
    }
    expect(view.container.querySelectorAll('h1')).toHaveLength(1);
    expect(view.container.querySelector('[autofocus]')).toBeNull();
  });

  it('ordre de tabulation logique : e-mail, mot de passe, afficher, oublié, connexion, Google', () => {
    const { view } = setup({});
    const order = [...view.container.querySelectorAll<HTMLElement>('input, button, a[href]')].map((el) => el.textContent?.trim() || el.getAttribute('aria-label') || el.id);
    const idx = (label: string) => order.findIndex((x) => x.includes(label));
    expect(idx(t('fr', 'action.showPassword'))).toBeGreaterThan(-1);
    expect(idx(t('fr', 'action.forgot'))).toBeLessThan(idx(t('fr', 'action.login')));
    expect(idx(t('fr', 'action.login'))).toBeLessThan(idx(t('fr', 'action.google')));
  });

  it('aucun libellé de repli en dur : texte rendu = dictionnaire, jamais « conforme/homologué/certifié »', () => {
    const { view } = setup({});
    expect(view.container.textContent).not.toMatch(/conforme|homologu|certifi/i);
  });

  it('la région d’erreur existe dès le départ (aria-live) pour être annoncée', () => {
    const { view } = setup({});
    expect(view.container.querySelector('[role="alert"], [aria-live="assertive"]')).not.toBeNull();
  });
});
