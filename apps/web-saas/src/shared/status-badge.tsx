import type { ReactElement } from 'react';
import { translateStrict } from './command-review.tsx';
import { FiscalStatusBadge } from '@fisca/ui-mercury';
import type { FiscaLocale } from '@fisca/i18n';

export interface FiscaClearedBadgeProps {
  readonly locale: FiscaLocale;
}

/** Badge de l'état `cleared` : libellé lu dans `states.cleared` de la langue (pilote simulé, B-13). */
export function FiscaClearedBadge({ locale }: FiscaClearedBadgeProps): ReactElement {
  return <FiscalStatusBadge status="cleared" label={translateStrict(locale, 'common', 'states.cleared')} />;
}
