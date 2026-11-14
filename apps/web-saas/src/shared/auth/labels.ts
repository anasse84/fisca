import type { FiscaLocale } from '@fisca/i18n';
import { translateStrict } from '../command-review.tsx';
import type { TranslateStrict } from '../command-review.tsx';

/** Clés de l'espace `common`, sous `ui.auth.` : la liste fait foi pour le test de parité des 6 langues. */
export const AUTH_LABEL_KEYS = [
  'title.login',
  'title.signup',
  'title.mfa',
  'title.forgot',
  'title.forgotSent',
  'title.reset',
  'title.resetDone',
  'title.verifyEmail',
  'title.ice',
  'title.iceReview',
  'title.iceDone',
  'subtitle.mfa',
  'subtitle.forgot',
  'subtitle.ice',
  'field.email',
  'field.password',
  'field.newPassword',
  'field.fullName',
  'field.code',
  'field.resetToken',
  'field.verifyCode',
  'field.ice',
  'action.login',
  'action.signup',
  'action.google',
  'action.passkey',
  'action.verifyEmail',
  'action.forgot',
  'action.sendLink',
  'action.reset',
  'action.toSignup',
  'action.toLogin',
  'action.backToLogin',
  'action.showPassword',
  'action.hidePassword',
  'action.submitCode',
  'action.lookup',
  'action.confirmDossier',
  'action.editIce',
  'divider.or',
  'method.label',
  'method.TOTP',
  'method.RECOVERY_CODE',
  'method.INFOBIP_OTP',
  'hint.TOTP',
  'hint.RECOVERY_CODE',
  'hint.INFOBIP_OTP',
  'strength.label',
  'strength.weak',
  'strength.fair',
  'strength.good',
  'strength.strong',
  'strength.hint',
  'ice.shapeNote',
  'ice.counter',
  'ice.progress',
  'ice.elapsed',
  'ice.review.legalName',
  'ice.review.legalNameAr',
  'ice.review.if',
  'ice.review.rc',
  'ice.review.legalForm',
  'ice.review.capital',
  'ice.review.address',
  'ice.review.notice',
  'ice.done.body',
  'body.forgotSent',
  'body.resetDone',
  'body.verifyEmail',
  'status.busy',
  'status.locked',
  'status.passkeyWaiting',
  'errors.generic',
  'errors.network',
  'errors.invalidCredentials',
  'errors.accountLocked',
  'errors.rateLimited',
  'errors.turnstile',
  'errors.requestInvalid',
  'errors.registrationInvalid',
  'errors.tokenInvalid',
  'errors.tokenExpired',
  'errors.mfaCodeInvalid',
  'errors.challengeExpired',
  'errors.attemptsExhausted',
  'errors.methodUnavailable',
  'errors.enrollmentRequired',
  'errors.passkeyFailed',
  'errors.passkeyCancelled',
  'errors.sessionRequired',
  'errors.iceNotFound',
  'errors.iceRejected',
  'errors.iceShape',
  'errors.server',
  'errors.googleFailed',
  'errors.field.email',
  'errors.field.password',
  'errors.field.generic',
] as const;

export type AuthLabelKey = (typeof AUTH_LABEL_KEYS)[number];
export type AuthLabels = Readonly<Record<AuthLabelKey, string>>;

/** Résout tous les libellés dans la langue ; lève I18N_KEY_MISSING sur une clé absente (aucun repli, aucune clé brute). */
export function resolveAuthLabels(locale: FiscaLocale, t: TranslateStrict = translateStrict): AuthLabels {
  const entries = AUTH_LABEL_KEYS.map((key) => [key, t(locale, 'common', `ui.auth.${key}`)] as const);
  // Les clés sont toutes énumérées ci-dessus : l'objet obtenu couvre exactement AuthLabelKey.
  return Object.fromEntries(entries) as AuthLabels;
}

export function fillTemplate(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z]+)\}/gu, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}
