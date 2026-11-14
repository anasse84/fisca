import type { ReactElement } from 'react';
import type { OfflineIndicatorModel } from '../offline/offline-indicator.ts';

export interface OfflineBannerProps {
  readonly model: OfflineIndicatorModel;
  readonly regionLabel: string;
}

const ICON: Readonly<Record<OfflineIndicatorModel['tone'], string>> = { OK: '✓', WARNING: '⚠', CRITICAL: '⛔' };

/** Indicateur permanent d'état réseau (Doc_08 § 06) : l'état n'est jamais porté par la couleur seule (icône, bordure, libellé). */
export function OfflineBanner({ model, regionLabel }: OfflineBannerProps): ReactElement {
  return (
    <div className="pos-banner" data-testid="offline-banner" data-tone={model.tone} role="status" aria-label={regionLabel}>
      <span className="pos-banner__icon" aria-hidden="true">
        {ICON[model.tone]}
      </span>
      <span className="pos-banner__title">{model.title}</span>
      <span className="pos-banner__pending">{model.pendingText}</span>
      {model.countdownText === null ? null : <span className="pos-banner__countdown">{model.countdownText}</span>}
    </div>
  );
}
