import type { ReactNode } from 'react';
import { Fragment } from 'react';
import type { FiscaLocale } from '@fisca/i18n';
import { translateStrict } from '../shared/command-review.tsx';

/** Libellé `ui.pme.<clé>` de la langue : lève `I18N_KEY_MISSING` si absent (aucun repli, aucune clé brute affichée). */
export function pmeText(locale: FiscaLocale, key: string): string {
  return translateStrict(locale, 'common', `ui.pme.${key}`);
}

/** Libellé par clé complète (clé de message fournie par le port de règles). */
export function commonText(locale: FiscaLocale, key: string): string {
  return translateStrict(locale, 'common', key);
}

const PARAM_PATTERN = /\{(\w+)\}/g;

/** Gabarit texte ; chaque valeur est isolée en LTR (U+2066 … U+2069) pour que montants et dates ne s'inversent pas en RTL. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PARAM_PATTERN, (_, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`I18N_PARAM_MISSING: ${name}`);
    }
    return `\u2066${value}\u2069`;
  });
}

/** Gabarit à nœuds React (montants rendus par FiscalAmount, dates par <time dir="ltr">). */
export function renderTemplate(template: string, values: Readonly<Record<string, ReactNode>>): ReactNode[] {
  const out: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of template.matchAll(PARAM_PATTERN)) {
    const name = match[1] ?? '';
    const value = values[name];
    if (value === undefined) {
      throw new Error(`I18N_PARAM_MISSING: ${name}`);
    }
    out.push(<Fragment key={`t${index}`}>{template.slice(cursor, match.index)}</Fragment>);
    out.push(<Fragment key={`v${index}`}>{value}</Fragment>);
    cursor = (match.index ?? 0) + match[0].length;
    index += 1;
  }
  out.push(<Fragment key="end">{template.slice(cursor)}</Fragment>);
  return out;
}
