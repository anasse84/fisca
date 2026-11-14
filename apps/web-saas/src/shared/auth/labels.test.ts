import { describe, expect, it } from 'vitest';
import { FISCA_LOCALES, flattenKeys, getDictionary } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { AUTH_LABEL_KEYS, fillTemplate, resolveAuthLabels } from './labels.ts';
import { problemMessageKey } from './error-keys.ts';

const own = (locale: FiscaLocale) => new Map(flattenKeys(getDictionary(locale, 'common')));
const ACRONYMS = /\b(ICE|IF|RC)\b/gu;
const SAME_AS_FRENCH_OK = new Set(['field.ice', 'ice.review.if', 'ice.review.rc']);

describe('libellés ui.auth.* : 6 langues, aucune chaîne en dur', () => {
  it('chaque clé existe dans le dictionnaire propre de chaque langue (pas par repli)', () => {
    expect(AUTH_LABEL_KEYS.length).toBeGreaterThan(60);
    for (const locale of FISCA_LOCALES) {
      const entries = own(locale);
      for (const key of AUTH_LABEL_KEYS) {
        expect(entries.get(`ui.auth.${key}`)?.trim().length ?? 0, `${locale}/${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('aucune clé ui.auth.* orpheline dans les dictionnaires', () => {
    const declared = new Set(AUTH_LABEL_KEYS.map((k) => `ui.auth.${k}`));
    for (const locale of FISCA_LOCALES) {
      for (const [key] of own(locale)) {
        if (key.startsWith('ui.auth.')) {
          expect(declared.has(key), `${locale}/${key}`).toBe(true);
        }
      }
    }
  });

  it('traductions réelles : hors français, le texte diffère du français', () => {
    const fr = own('fr');
    for (const locale of FISCA_LOCALES.filter((l) => l !== 'fr')) {
      for (const key of AUTH_LABEL_KEYS.filter((k) => !SAME_AS_FRENCH_OK.has(k))) {
        expect(own(locale).get(`ui.auth.${key}`), `${locale}/${key}`).not.toBe(fr.get(`ui.auth.${key}`));
      }
    }
  });

  it('scripts : arabe et darija en arabe, tifinagh sans lettre latine hors sigles ICE, IF, RC', () => {
    for (const locale of ['ar', 'ary'] as const) {
      for (const key of AUTH_LABEL_KEYS.filter((k) => !SAME_AS_FRENCH_OK.has(k))) {
        expect(own(locale).get(`ui.auth.${key}`), `${locale}/${key}`).toMatch(/\p{Script=Arabic}/u);
      }
    }
    for (const key of AUTH_LABEL_KEYS.filter((k) => !SAME_AS_FRENCH_OK.has(k))) {
      const value = (own('zgh-Tfng').get(`ui.auth.${key}`) ?? '').replace(/\{[a-z]+\}/gu, '').replace(ACRONYMS, '');
      expect(value, key).toMatch(/\p{Script=Tfng}/u);
      expect(value, key).not.toMatch(/\p{Script=Latin}/u);
    }
  });

  it('jamais « conforme », « homologué » ni « certifié », ni promesse de preuve d’existence de l’ICE', () => {
    const banned = /conforme|conformité|homologu|certifi|معتمد|مطابق|مصادق\s+عليه|certified|approved by|compliant|homologated/iu;
    for (const locale of FISCA_LOCALES) {
      for (const key of AUTH_LABEL_KEYS) {
        expect(own(locale).get(`ui.auth.${key}`) ?? '', `${locale}/${key}`).not.toMatch(banned);
      }
    }
  });

  it('les gabarits portent leurs variables dans les 6 langues', () => {
    for (const locale of FISCA_LOCALES) {
      const entries = own(locale);
      expect(entries.get('ui.auth.status.locked')).toContain('{seconds}');
      expect(entries.get('ui.auth.ice.counter')).toContain('{count}');
      expect(entries.get('ui.auth.ice.progress')).toContain('{current}');
      expect(entries.get('ui.auth.ice.progress')).toContain('{total}');
      expect(entries.get('ui.auth.ice.elapsed')).toContain('{seconds}');
      expect(entries.get('ui.auth.body.verifyEmail')).toContain('{email}');
    }
  });

  it('resolveAuthLabels lève I18N_KEY_MISSING sur une clé absente (aucun repli, aucune clé brute)', () => {
    expect(() => resolveAuthLabels('fr', () => {
      throw new Error('I18N_KEY_MISSING: fr/common/ui.auth.title.login');
    })).toThrow('I18N_KEY_MISSING');
    const fr = resolveAuthLabels('fr');
    expect(fr['title.login']).not.toMatch(/^ui\.auth/);
    expect(resolveAuthLabels('ar')['title.login']).not.toBe(fr['title.login']);
  });

  it('fillTemplate remplace les variables, sans toucher au reste', () => {
    expect(fillTemplate('Réessayez dans {seconds} s', { seconds: 12 })).toBe('Réessayez dans 12 s');
    expect(fillTemplate('{a}-{a}-{b}', { a: 'x', b: 2 })).toBe('x-x-2');
  });
});

describe('codes d’erreur du registre → clés de libellé', () => {
  const base = { retryAfterSec: null, fieldErrors: {} } as const;
  it('codes connus', () => {
    const cases: readonly [string, number, string][] = [
      ['LOGIN_INVALID_CREDENTIALS', 401, 'errors.invalidCredentials'],
      ['LOGIN_ACCOUNT_LOCKED', 429, 'errors.accountLocked'],
      ['RATE_LIMITED', 429, 'errors.rateLimited'],
      ['TURNSTILE_REQUIRED', 403, 'errors.turnstile'],
      ['REGISTRATION_INPUT_INVALID', 400, 'errors.registrationInvalid'],
      ['VERIFICATION_TOKEN_INVALID', 400, 'errors.tokenInvalid'],
      ['VERIFICATION_TOKEN_EXPIRED', 400, 'errors.tokenExpired'],
      ['PASSWORD_RESET_TOKEN_INVALID', 400, 'errors.tokenInvalid'],
      ['PASSWORD_RESET_INPUT_INVALID', 400, 'errors.registrationInvalid'],
      ['TOTP_CODE_INVALID', 401, 'errors.mfaCodeInvalid'],
      ['MFA_CODE_INVALID', 401, 'errors.mfaCodeInvalid'],
      ['MFA_METHOD_UNAVAILABLE', 400, 'errors.methodUnavailable'],
      ['MFA_ENROLLMENT_REQUIRED', 409, 'errors.enrollmentRequired'],
      ['PASSKEY_AUTHENTICATION_FAILED', 401, 'errors.passkeyFailed'],
      ['DIRECTORY_ICE_NOT_FOUND', 404, 'errors.iceNotFound'],
      ['AUTH_REQUIRED', 401, 'errors.sessionRequired'],
      ['NETWORK_ERROR', 0, 'errors.network'],
    ];
    for (const [errorCode, status, key] of cases) {
      expect(problemMessageKey({ ...base, status, errorCode }), errorCode).toBe(key);
    }
  });
  it('code inconnu : repli par classe de statut, jamais le texte serveur', () => {
    expect(problemMessageKey({ ...base, status: 503, errorCode: 'UNKNOWN_ERROR' })).toBe('errors.server');
    expect(problemMessageKey({ ...base, status: 429, errorCode: 'AUTRE' })).toBe('errors.rateLimited');
    expect(problemMessageKey({ ...base, status: 418, errorCode: 'AUTRE' })).toBe('errors.generic');
  });
});
