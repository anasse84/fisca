import { DEFAULT_LOCALE, LOCALE_URL_PREFIX } from './locales.ts';

export interface RedirectTarget {
  readonly status: 302;
  readonly location: string;
}

/** `/` renvoie vers la langue par défaut. 302 : aucune négociation ni cookie, la cible reste révisable. */
export function resolveRootRedirect(): RedirectTarget {
  return { status: 302, location: `/${LOCALE_URL_PREFIX[DEFAULT_LOCALE]}/` };
}
