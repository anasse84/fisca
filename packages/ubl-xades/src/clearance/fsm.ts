/**
 * Machines à états de la facture émise (Doc_02 § 02 « FSM 01 : Facture Émise, Clearance xHub DGI & Cycle CDV »), bâties sur
 * `defineFsm` / `applyTransition` de @fisca/shared-types (jamais modifiés ici).
 *
 * 1. `INVOICE_CLEARANCE_FSM` : colonne `invoices.clearance_state` (CHECK `invoices_clearance_state_check`, 8 valeurs).
 * 2. `CDV_LIFECYCLE_FSM` : les 8 statuts normalisés du cycle CDV (Doc_07 § 01 ; Doc_17 § 07 « 8 statuts du cycle de vie »).
 *
 * Les documents ne LISTENT pas les 8 statuts CDV d'un bloc (SPEC_AMBIGUITY signalée). Reconstitution à partir de Doc_02 § 02 :
 * DEPOSEE_CERTIFIEE_DGI (point d'entrée), MISE_A_DISPOSITION, PRISE_EN_CHARGE, APPROUVEE, APPROUVEE_PARTIELLEMENT,
 * EN_LITIGE_SUSPENDUE, REFUSEE et ENCAISSEE (Doc_07 cite APPROUVEE, EN_LITIGE_SUSPENDUE, ENCAISSEE parmi les 8).
 * Les arêtes du diagramme sont reprises telles quelles ; celles marquées « hypothèse » sont déduites du texte de Doc_02 § 02 et
 * remplaçables. Projection en base : APPROUVEE et ENCAISSEE vivent dans `clearance_state` ; les autres dans
 * `cdv_lifecycle_status` (CHECK : NONE, MISE_A_DISPOSITION, PRISE_EN_CHARGE, APPROUVEE_PARTIELLEMENT, EN_LITIGE_SUSPENDUE, REFUSEE).
 */
import { defineFsm, type ActorKind, type FsmDefinition, type TransitionRule } from '@fisca/shared-types';

export const CLEARANCE_STATES = [
  'BROUILLON',
  'NUMEROTEE_VERROUILLEE',
  'SIGNEE_LOI_43_20',
  'DEPOSEE_CERTIFIEE_DGI',
  'REJETEE_XHUB',
  'APPROUVEE',
  'ANNULEE_BROUILLON',
  'ENCAISSEE',
] as const;
export type ClearanceState = (typeof CLEARANCE_STATES)[number];

export const CDV_COLUMN_VALUES = [
  'NONE',
  'MISE_A_DISPOSITION',
  'PRISE_EN_CHARGE',
  'APPROUVEE_PARTIELLEMENT',
  'EN_LITIGE_SUSPENDUE',
  'REFUSEE',
] as const;
export type CdvColumnValue = (typeof CDV_COLUMN_VALUES)[number];

export const CDV_STATUSES = [
  'DEPOSEE_CERTIFIEE_DGI',
  'MISE_A_DISPOSITION',
  'PRISE_EN_CHARGE',
  'APPROUVEE',
  'APPROUVEE_PARTIELLEMENT',
  'EN_LITIGE_SUSPENDUE',
  'REFUSEE',
  'ENCAISSEE',
] as const;
export type CdvStatus = (typeof CDV_STATUSES)[number];

const SYSTEM: readonly ActorKind[] = ['DETERMINISTIC_SYSTEM'];
const SYSTEM_OR_WEBHOOK: readonly ActorKind[] = ['DETERMINISTIC_SYSTEM', 'EXTERNAL_WEBHOOK'];

function rule<TState extends string>(from: readonly TState[], to: TState, allowedActors: readonly ActorKind[]): TransitionRule<TState> {
  return { from, to, allowedActors };
}

/** Tableau de Doc_02 § 02 et diagramme ; BROUILLON → NUMEROTEE_VERROUILLEE et l'abandon appartiennent à d'autres tickets. */
export const INVOICE_CLEARANCE_FSM: FsmDefinition<ClearanceState> = defineFsm<ClearanceState>({
  name: 'invoice-clearance',
  states: CLEARANCE_STATES,
  initialStates: ['BROUILLON'],
  terminalStates: ['ANNULEE_BROUILLON', 'REJETEE_XHUB', 'ENCAISSEE'],
  rules: [
    rule(['BROUILLON'], 'NUMEROTEE_VERROUILLEE', ['HUMAN_USER', 'DETERMINISTIC_SYSTEM']),
    rule(['BROUILLON'], 'ANNULEE_BROUILLON', ['HUMAN_USER']),
    rule(['NUMEROTEE_VERROUILLEE'], 'SIGNEE_LOI_43_20', SYSTEM),
    rule(['SIGNEE_LOI_43_20'], 'DEPOSEE_CERTIFIEE_DGI', SYSTEM),
    rule(['SIGNEE_LOI_43_20'], 'REJETEE_XHUB', SYSTEM),
    rule(['DEPOSEE_CERTIFIEE_DGI'], 'APPROUVEE', SYSTEM_OR_WEBHOOK),
    rule(['APPROUVEE'], 'ENCAISSEE', SYSTEM_OR_WEBHOOK),
  ],
});

export interface CdvEdge {
  readonly from: CdvStatus;
  readonly to: CdvStatus;
}

/**
 * Arêtes du diagramme de Doc_02 § 02 (7 arêtes) : DEPOSEE → {MISE_A_DISPOSITION, PRISE_EN_CHARGE, APPROUVEE, EN_LITIGE_SUSPENDUE},
 * MISE_A_DISPOSITION → PRISE_EN_CHARGE → APPROUVEE → ENCAISSEE.
 */
export const CDV_DIAGRAM_TRANSITIONS: readonly CdvEdge[] = [
  { from: 'DEPOSEE_CERTIFIEE_DGI', to: 'MISE_A_DISPOSITION' },
  { from: 'DEPOSEE_CERTIFIEE_DGI', to: 'PRISE_EN_CHARGE' },
  { from: 'DEPOSEE_CERTIFIEE_DGI', to: 'APPROUVEE' },
  { from: 'DEPOSEE_CERTIFIEE_DGI', to: 'EN_LITIGE_SUSPENDUE' },
  { from: 'MISE_A_DISPOSITION', to: 'PRISE_EN_CHARGE' },
  { from: 'PRISE_EN_CHARGE', to: 'APPROUVEE' },
  { from: 'APPROUVEE', to: 'ENCAISSEE' },
];

/**
 * HYPOTHÈSE À VALIDER (décision du pilote) : les 10 arêtes absentes du diagramme, déduites du texte de Doc_02 § 02 (« traverse
 * … APPROUVEE_PARTIELLEMENT, EN_LITIGE_SUSPENDUE ou REFUSEE »). Source unique : le FSM est construit depuis
 * `CDV_DIAGRAM_TRANSITIONS` + cette constante (`buildCdvLifecycleFsm`). APPROUVEE_PARTIELLEMENT, REFUSEE et ENCAISSEE restent
 * terminaux ; APPROUVEE ne revient jamais en arrière. Retirer une arête ici la retire du FSM, rien d'autre.
 */
export const CDV_HYPOTHETICAL_TRANSITIONS: readonly CdvEdge[] = [
  { from: 'EN_LITIGE_SUSPENDUE', to: 'APPROUVEE' },
  { from: 'MISE_A_DISPOSITION', to: 'EN_LITIGE_SUSPENDUE' },
  { from: 'PRISE_EN_CHARGE', to: 'EN_LITIGE_SUSPENDUE' },
  { from: 'DEPOSEE_CERTIFIEE_DGI', to: 'REFUSEE' },
  { from: 'MISE_A_DISPOSITION', to: 'REFUSEE' },
  { from: 'PRISE_EN_CHARGE', to: 'REFUSEE' },
  { from: 'EN_LITIGE_SUSPENDUE', to: 'REFUSEE' },
  { from: 'PRISE_EN_CHARGE', to: 'APPROUVEE_PARTIELLEMENT' },
  { from: 'EN_LITIGE_SUSPENDUE', to: 'APPROUVEE_PARTIELLEMENT' },
  { from: 'EN_LITIGE_SUSPENDUE', to: 'PRISE_EN_CHARGE' },
];

/** FSM du cycle CDV : une règle par arête, sans doublon ; `hypothetical` permet de mesurer l'effet de la constante. */
export function buildCdvLifecycleFsm(hypothetical: readonly CdvEdge[] = CDV_HYPOTHETICAL_TRANSITIONS): FsmDefinition<CdvStatus> {
  return defineFsm<CdvStatus>({
    name: 'invoice-cdv-lifecycle',
    states: CDV_STATUSES,
    initialStates: ['DEPOSEE_CERTIFIEE_DGI'],
    terminalStates: ['APPROUVEE_PARTIELLEMENT', 'REFUSEE', 'ENCAISSEE'],
    rules: [...CDV_DIAGRAM_TRANSITIONS, ...hypothetical].map((edge) => rule([edge.from], edge.to, SYSTEM_OR_WEBHOOK)),
  });
}

export const CDV_LIFECYCLE_FSM: FsmDefinition<CdvStatus> = buildCdvLifecycleFsm();

/** Statut CDV effectif d'une facture, relu depuis ses deux colonnes ; `null` hors du cycle CDV (avant le dépôt, rejet, annulation). */
export function deriveCdvStatus(clearanceState: string, cdvColumn: string): CdvStatus | null {
  if (clearanceState === 'ENCAISSEE') return 'ENCAISSEE';
  if (clearanceState === 'APPROUVEE') return 'APPROUVEE';
  if (clearanceState !== 'DEPOSEE_CERTIFIEE_DGI') return null;
  if (cdvColumn === 'NONE') return 'DEPOSEE_CERTIFIEE_DGI';
  return (CDV_COLUMN_VALUES as readonly string[]).includes(cdvColumn) ? (cdvColumn as CdvStatus) : null;
}

/** Valeurs de colonnes pour un statut CDV cible : APPROUVEE et ENCAISSEE n'écrivent que `clearance_state`. */
export function projectCdvStatus(status: CdvStatus): { readonly clearanceState: ClearanceState | null; readonly cdvColumn: CdvColumnValue | null } {
  switch (status) {
    case 'DEPOSEE_CERTIFIEE_DGI':
      return { clearanceState: 'DEPOSEE_CERTIFIEE_DGI', cdvColumn: 'NONE' };
    case 'APPROUVEE':
    case 'ENCAISSEE':
      return { clearanceState: status, cdvColumn: null };
    default:
      return { clearanceState: null, cdvColumn: status };
  }
}
