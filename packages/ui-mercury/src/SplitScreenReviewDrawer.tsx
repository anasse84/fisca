import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from 'react';
import { AiCrafterConfidence } from './AiCrafterCards.tsx';
import './review-drawer.css';

export interface SplitScreenReviewDrawerLabels {
  /** Nom accessible du tiroir. */
  readonly drawer: string;
  readonly sourcePane: string;
  readonly entryPane: string;
  readonly close: string;
  readonly aiBadge: string;
  /** « Point à examiner » : jamais « Anomalie confirmée » avant visa humain. */
  readonly reviewBadge: string;
  /** Bouton final : rappelle l'approbation humaine. */
  readonly approve: string;
  readonly reject: string;
  readonly humanApprovalNotice: string;
  readonly illegibleAmountNotice: string;
}

export interface ReviewAiProposal {
  readonly id: string;
  /** Confiance en points de base entiers, 0..10000. */
  readonly confidenceBps: number;
  /** Un montant illisible reste vide : la validation est bloquée tant qu'un humain ne l'a pas saisi. */
  readonly hasIllegibleAmount?: boolean;
}

export interface SplitScreenReviewDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly labels: SplitScreenReviewDrawerLabels;
  /** Volet document source (PDF, photo) : à l'inline-start. */
  readonly source: ReactNode;
  /** Volet saisie / écriture proposée : à l'inline-end. */
  readonly entry: ReactNode;
  /** Présente : le tiroir expose les garde-fous IA (badges, confiance, validation humaine explicite). */
  readonly aiProposal?: ReviewAiProposal;
  readonly onApprove?: (proposalId: string) => void;
  readonly onReject?: (proposalId: string) => void;
  readonly dir?: 'ltr' | 'rtl';
}

/**
 * Tiroir latéral côté inline-end, deux volets. Non modal : la liste reste utilisable. Aucune proposition IA
 * n'est validée sans un geste humain explicite (clic sur le bouton ou Mod+Entrée) ; rien ne se déclenche
 * au rendu, à l'ouverture ni à la fermeture (aucun auto-posting).
 */
export function SplitScreenReviewDrawer({
  open,
  onClose,
  title,
  labels,
  source,
  entry,
  aiProposal,
  onApprove,
  onReject,
  dir,
}: SplitScreenReviewDrawerProps): ReactElement | null {
  const uid = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }
    const previous = document.activeElement;
    returnFocusRef.current = previous instanceof HTMLElement ? previous : null;
    drawerRef.current?.focus();
    return () => {
      const target = returnFocusRef.current;
      if (target !== null && target.isConnected) {
        target.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) {
    return null;
  }

  const canApprove = aiProposal !== undefined && onApprove !== undefined && aiProposal.hasIllegibleAmount !== true;

  const approve = (): void => {
    if (canApprove) {
      onApprove(aiProposal.id);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      approve();
    }
  };

  const titleId = `${uid}-title`;
  return (
    <aside
      ref={drawerRef}
      role="dialog"
      aria-modal="false"
      aria-label={labels.drawer}
      dir={dir}
      tabIndex={-1}
      className="fisca-drawer"
      onKeyDown={onKeyDown}
    >
      <header className="fisca-drawer__header">
        <h2 id={titleId} className="fisca-drawer__title">
          {title}
        </h2>
        {aiProposal === undefined ? null : (
          <>
            <span className="fisca-drawer__badge fisca-drawer__badge--ai">{labels.aiBadge}</span>
            <span className="fisca-drawer__badge fisca-drawer__badge--review">{labels.reviewBadge}</span>
            <AiCrafterConfidence confidenceBps={aiProposal.confidenceBps} />
          </>
        )}
        <button type="button" className="fisca-drawer__close" onClick={onClose}>
          {labels.close}
        </button>
      </header>
      <div className="fisca-drawer__panes">
        <section role="region" aria-label={labels.sourcePane} className="fisca-drawer__pane">
          {source}
        </section>
        <section role="region" aria-label={labels.entryPane} className="fisca-drawer__pane">
          {entry}
        </section>
      </div>
      {aiProposal === undefined ? null : (
        <footer className="fisca-drawer__footer">
          <p className="fisca-drawer__notice">{labels.humanApprovalNotice}</p>
          {aiProposal.hasIllegibleAmount === true ? (
            <p className="fisca-drawer__notice fisca-drawer__notice--illegible">{labels.illegibleAmountNotice}</p>
          ) : null}
          <button type="button" className="fisca-drawer__approve" disabled={!canApprove} onClick={approve}>
            {labels.approve}
          </button>
          <button type="button" className="fisca-drawer__reject" onClick={() => onReject?.(aiProposal.id)}>
            {labels.reject}
          </button>
        </footer>
      )}
    </aside>
  );
}
