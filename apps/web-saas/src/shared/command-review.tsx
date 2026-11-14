import type { ReactElement } from 'react';
import { directionOf, flattenKeys, getDictionary } from '@fisca/i18n';
import type { FiscaLocale, FiscaNamespace } from '@fisca/i18n';
import { AiCrafterCard, CommandPalette, SplitScreenReviewDrawer } from '@fisca/ui-mercury';
import type {
  AiCrafterCardLabels,
  AiCrafterCardProps,
  CommandPaletteLabels,
  CommandPaletteProps,
  SplitScreenReviewDrawerLabels,
  SplitScreenReviewDrawerProps,
} from '@fisca/ui-mercury';

/** Résolveur de libellé : renvoie le texte ou lève `I18N_KEY_MISSING` (jamais la clé brute ni un repli). */
export type TranslateStrict = (locale: FiscaLocale, namespace: FiscaNamespace, key: string) => string;

const tables = new Map<string, ReadonlyMap<string, string>>();

function tableOf(locale: FiscaLocale, namespace: FiscaNamespace): ReadonlyMap<string, string> {
  const id = `${locale}/${namespace}`;
  let table = tables.get(id);
  if (table === undefined) {
    table = new Map(flattenKeys(getDictionary(locale, namespace)));
    tables.set(id, table);
  }
  return table;
}

/**
 * Lit la clé dans le dictionnaire PROPRE de la langue : pas de chaîne de repli (fr, ar), pas de renvoi de la clé.
 * La parité des 6 langues est garantie par les tests de @fisca/i18n ; une clé absente est une erreur de build.
 */
export const translateStrict: TranslateStrict = (locale, namespace, key) => {
  const text = tableOf(locale, namespace).get(key);
  if (text === undefined || text.trim() === '') {
    throw new Error(`I18N_KEY_MISSING: ${locale}/${namespace}/${key}`);
  }
  return text;
};

export interface CommandReviewLabels {
  readonly palette: CommandPaletteLabels;
  readonly drawer: SplitScreenReviewDrawerLabels;
}

export function resolveCommandReviewLabels(locale: FiscaLocale, t: TranslateStrict = translateStrict): CommandReviewLabels {
  const close = t(locale, 'common', 'actions.close');
  const resultsTemplate = t(locale, 'common', 'ui.palette.results');
  return {
    palette: {
      dialog: t(locale, 'common', 'ui.palette.title'),
      input: t(locale, 'common', 'actions.search'),
      placeholder: t(locale, 'common', 'ui.palette.placeholder'),
      empty: t(locale, 'common', 'states.empty'),
      results: (count) => resultsTemplate.replace('{count}', String(count)),
      close,
    },
    drawer: {
      drawer: t(locale, 'common', 'ui.review.title'),
      sourcePane: t(locale, 'common', 'ui.review.sourcePane'),
      entryPane: t(locale, 'common', 'ui.review.entryPane'),
      close,
      aiBadge: t(locale, 'common', 'ui.review.aiBadge'),
      reviewBadge: t(locale, 'common', 'ui.review.reviewBadge'),
      approve: t(locale, 'common', 'ui.review.approve'),
      reject: t(locale, 'common', 'ui.review.reject'),
      humanApprovalNotice: t(locale, 'common', 'ui.review.humanApprovalNotice'),
      illegibleAmountNotice: t(locale, 'common', 'ui.review.illegibleAmountNotice'),
      confidence: t(locale, 'common', 'ui.ai.confidence'),
    },
  };
}

export function resolveAiCrafterCardLabels(locale: FiscaLocale, t: TranslateStrict = translateStrict): AiCrafterCardLabels {
  return {
    aiBadge: t(locale, 'common', 'ui.review.aiBadge'),
    reviewBadge: t(locale, 'common', 'ui.review.reviewBadge'),
    validate: t(locale, 'common', 'ui.review.approve'),
    reject: t(locale, 'common', 'ui.review.reject'),
    validatedByHuman: t(locale, 'common', 'ui.ai.validatedByHuman'),
    rejectedByHuman: t(locale, 'common', 'ui.ai.rejectedByHuman'),
    confidence: { meter: t(locale, 'common', 'ui.ai.confidence') },
    amount: {
      illegibleGroup: t(locale, 'common', 'ui.ai.illegibleAmountGroup'),
      illegibleText: t(locale, 'common', 'ui.ai.illegibleAmountText'),
    },
  };
}

export interface FiscaCommandPaletteProps extends Omit<CommandPaletteProps, 'labels' | 'dir'> {
  readonly locale: FiscaLocale;
}

/** Palette Cmd+K de Fisca : libellés et sens d'écriture dérivés de la langue. */
export function FiscaCommandPalette({ locale, ...rest }: FiscaCommandPaletteProps): ReactElement {
  return <CommandPalette {...rest} labels={resolveCommandReviewLabels(locale).palette} dir={directionOf(locale)} />;
}

export interface FiscaReviewDrawerProps extends Omit<SplitScreenReviewDrawerProps, 'labels' | 'dir'> {
  readonly locale: FiscaLocale;
}

/** Tiroir Split-Screen de Fisca : libellés et sens d'écriture dérivés de la langue. */
export function FiscaReviewDrawer({ locale, ...rest }: FiscaReviewDrawerProps): ReactElement {
  return <SplitScreenReviewDrawer {...rest} labels={resolveCommandReviewLabels(locale).drawer} dir={directionOf(locale)} />;
}

export interface FiscaAiCrafterCardProps extends Omit<AiCrafterCardProps, 'labels'> {
  readonly locale: FiscaLocale;
}

/** Carte de détection IA de Fisca : libellés dérivés de la langue. */
export function FiscaAiCrafterCard({ locale, ...rest }: FiscaAiCrafterCardProps): ReactElement {
  return <AiCrafterCard {...rest} labels={resolveAiCrafterCardLabels(locale)} />;
}
