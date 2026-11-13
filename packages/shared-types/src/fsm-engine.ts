/**
 * Moteur générique de machines à états (Doc_02 § 11, ERRATA D-07 : fichier fsm-engine.ts).
 *
 * Écarts assumés par rapport au code de référence de Doc_02 § 11 :
 * - pas de dépendance à zod (aucune dépendance tierce dans ce paquet) : les acteurs sont une union littérale ;
 * - l'exécution D1 (`executeAtomicD1Transition`) n'est pas ici : `applyTransition` est pure, l'écriture
 *   atomique (UPDATE ... WHERE état = attendu + INSERT d'audit) passe par `TenantSqlDriver.executeBatchAtomically`
 *   de l'adaptateur d'infrastructure ;
 * - ERRATA D-03 : une pièce POSTED n'est jamais modifiée ; la contre-passation est une nouvelle écriture.
 */

export const ACTOR_KINDS = [
  'HUMAN_USER',
  'DETERMINISTIC_SYSTEM',
  'AI_AGENT_PROPOSAL',
  'EXTERNAL_WEBHOOK',
] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export type FsmEntityTable = 'invoices' | 'journal_entries' | 'fiscal_years' | 'pledged_invoices_registry';

export type FsmErrorCode =
  | 'FSM_ILLEGAL_TRANSITION'
  | 'FSM_FORBIDDEN_ACTOR'
  | 'FSM_MISSING_PROOF'
  | 'FSM_CONCURRENCY_CONFLICT'
  | 'FSM_DUPLICATE_APPLICATION'
  | 'FSM_TERMINAL_STATE'
  | 'FSM_ENTITY_MISMATCH'
  | 'FSM_GUARD_FAILED'
  | 'FSM_POSTED_IMMUTABLE'
  | 'FSM_INVALID_INITIAL_STATE'
  | 'FSM_INVALID_DEFINITION'
  | 'FSM_INVALID_OPTIONS'
  | 'FSM_REVERSAL_REQUIRES_POSTED'
  | 'FSM_REVERSAL_SELF_REFERENCE';

/** Erreur typée du moteur : le message commence toujours par le code. */
export class FsmTransitionError extends Error {
  readonly code: FsmErrorCode;

  constructor(code: FsmErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'FsmTransitionError';
    this.code = code;
  }
}

export interface TransitionRule<TState extends string> {
  readonly from: readonly TState[];
  readonly to: TState;
  readonly allowedActors: readonly ActorKind[];
  readonly requiresHumanApprovalNote?: boolean;
}

export interface TransitionRequest<TState extends string> {
  readonly entityTable: FsmEntityTable;
  readonly entityId: string;
  readonly expectedFromState: TState;
  readonly targetState: TState;
  readonly actorKind: ActorKind;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly reasonOrProofRef?: string;
}

/** Valeurs du grand livre (Doc_02 § 04, ADR-05). */
export const LEDGER_JOURNAL_TABLE: FsmEntityTable = 'journal_entries';
export const LEDGER_POSTED_STATE = 'POSTED';
/** Seul état source autorisé vers POSTED. */
export const LEDGER_PRE_POSTED_STATE = 'REVISEE_CYCLE';

function fail(code: FsmErrorCode, detail: string): never {
  throw new FsmTransitionError(code, detail);
}

function label(req: { readonly entityTable: string; readonly entityId: string }): string {
  return `[${req.entityTable}:${req.entityId}]`;
}

/**
 * Vérifie une requête contre la table de transitions. Ne lève rien si elle est valide.
 * Pour `journal_entries` : aucune sortie de POSTED (D-03) et entrée dans POSTED uniquement depuis REVISEE_CYCLE.
 */
export function assertValidTransition<TState extends string>(
  rules: readonly TransitionRule<TState>[],
  req: TransitionRequest<TState>,
): void {
  if (req.entityTable === LEDGER_JOURNAL_TABLE && req.expectedFromState === LEDGER_POSTED_STATE) {
    fail(
      'FSM_POSTED_IMMUTABLE',
      `${label(req)} une pièce POSTED ne change jamais d'état ; la correction est une nouvelle écriture liée par reversal_of_entry_id (D-03).`,
    );
  }

  const matched = rules.find((r) => r.to === req.targetState && r.from.includes(req.expectedFromState));

  if (!matched) {
    fail(
      'FSM_ILLEGAL_TRANSITION',
      `${label(req)} ${req.expectedFromState} -> ${req.targetState}`,
    );
  }

  if (
    req.entityTable === LEDGER_JOURNAL_TABLE &&
    req.targetState === LEDGER_POSTED_STATE &&
    req.expectedFromState !== LEDGER_PRE_POSTED_STATE
  ) {
    fail(
      'FSM_ILLEGAL_TRANSITION',
      `${label(req)} ${req.expectedFromState} -> ${req.targetState} (POSTED n'est atteignable que depuis ${LEDGER_PRE_POSTED_STATE})`,
    );
  }

  if (!matched.allowedActors.includes(req.actorKind)) {
    fail(
      'FSM_FORBIDDEN_ACTOR',
      `Actor ${req.actorKind} cannot trigger ${req.expectedFromState} -> ${req.targetState}`,
    );
  }

  if (matched.requiresHumanApprovalNote && (!req.reasonOrProofRef || req.reasonOrProofRef.trim().length < 5)) {
    fail(
      'FSM_MISSING_PROOF',
      `Transition to ${req.targetState} requires a documented reason or R2 proof reference.`,
    );
  }
}

export interface FsmDefinition<TState extends string> {
  readonly name: string;
  readonly states: readonly TState[];
  readonly initialStates: readonly TState[];
  readonly terminalStates: readonly TState[];
  readonly rules: readonly TransitionRule<TState>[];
  /** Active les contrôles d'immutabilité POSTED du grand livre à la définition. */
  readonly ledgerPostedGuard?: boolean;
}

/** Valide et fige une définition de machine à états. */
export function defineFsm<TState extends string>(definition: FsmDefinition<TState>): FsmDefinition<TState> {
  const known = new Set<string>(definition.states);
  const terminal = new Set<string>(definition.terminalStates);
  const invalid = (detail: string): never => fail('FSM_INVALID_DEFINITION', `[${definition.name}] ${detail}`);

  for (const state of [...definition.initialStates, ...definition.terminalStates]) {
    if (!known.has(state)) invalid(`état inconnu : ${state}`);
  }
  const edges = new Set<string>();
  for (const rule of definition.rules) {
    if (!known.has(rule.to)) invalid(`état cible inconnu : ${rule.to}`);
    if (rule.allowedActors.length === 0) invalid(`aucun acteur habilité pour -> ${rule.to}`);
    for (const from of rule.from) {
      if (!known.has(from)) invalid(`état source inconnu : ${from}`);
      if (terminal.has(from)) invalid(`transition déclarée depuis l'état terminal ${from}`);
      const edge = `${from}->${rule.to}`;
      if (edges.has(edge)) invalid(`arête déclarée deux fois : ${edge}`);
      edges.add(edge);
      if (definition.ledgerPostedGuard === true) {
        if (from === LEDGER_POSTED_STATE) invalid(`sortie de ${LEDGER_POSTED_STATE} interdite (D-03)`);
        if (rule.to === LEDGER_POSTED_STATE && from !== LEDGER_PRE_POSTED_STATE) {
          invalid(`${LEDGER_POSTED_STATE} n'est atteignable que depuis ${LEDGER_PRE_POSTED_STATE} (reçu : ${from})`);
        }
      }
    }
  }
  if (definition.ledgerPostedGuard === true) {
    if (definition.initialStates.some((s) => s === LEDGER_POSTED_STATE)) {
      invalid(`${LEDGER_POSTED_STATE} ne peut pas être un état initial (D-03)`);
    }
    if (known.has(LEDGER_POSTED_STATE) && !terminal.has(LEDGER_POSTED_STATE)) {
      invalid(`${LEDGER_POSTED_STATE} doit être un état terminal`);
    }
  }
  return definition;
}

/** État courant d'une entité, tel que relu avant la transition. */
export interface FsmEntityState<TState extends string> {
  readonly entityTable: FsmEntityTable;
  readonly entityId: string;
  readonly state: TState;
  /** Compteur de transitions appliquées (verrou optimiste). */
  readonly version: number;
  /** Clés d'idempotence déjà appliquées à cette entité. */
  readonly appliedIdempotencyKeys: readonly string[];
}

export interface FsmGuardContext<TState extends string> {
  readonly entity: FsmEntityState<TState>;
  readonly request: TransitionRequest<TState>;
}

export type FsmGuardResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Garde pure et synchrone : aucun accès réseau, base ou horloge. */
export type FsmGuard<TState extends string> = (context: FsmGuardContext<TState>) => FsmGuardResult;

export interface StateTransitionAuditEvent<TState extends string> {
  readonly id: string;
  readonly entityTable: FsmEntityTable;
  readonly entityId: string;
  readonly fromState: TState;
  readonly toState: TState;
  readonly actorKind: ActorKind;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly proofRef: string;
  readonly createdAtIso: string;
}

export interface ApplyTransitionOptions {
  /** Horodatage ISO 8601 fourni par l'appelant (la fonction ne lit pas l'horloge). */
  readonly nowIso: string;
  /** Identifiant de la ligne d'audit, fourni par l'appelant. */
  readonly auditId: string;
}

export interface ApplyTransitionResult<TState extends string> {
  readonly entity: FsmEntityState<TState>;
  readonly audit: StateTransitionAuditEvent<TState>;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Transition atomique pure : renvoie le nouvel état et l'événement d'audit à persister dans la
 * même transaction. Aucune écriture, aucune horloge, aucune génération d'identifiant.
 */
export function applyTransition<TState extends string>(
  definition: FsmDefinition<TState>,
  current: FsmEntityState<TState>,
  req: TransitionRequest<TState>,
  guards: readonly FsmGuard<TState>[],
  options: ApplyTransitionOptions,
): ApplyTransitionResult<TState> {
  if (!ISO_INSTANT.test(options.nowIso) || Number.isNaN(Date.parse(options.nowIso))) {
    fail('FSM_INVALID_OPTIONS', `${label(req)} nowIso doit être un instant ISO 8601 UTC (reçu : ${options.nowIso}).`);
  }
  if (options.auditId.trim().length === 0) {
    fail('FSM_INVALID_OPTIONS', `${label(req)} auditId ne peut pas être vide.`);
  }
  if (req.idempotencyKey.trim().length === 0) {
    fail('FSM_INVALID_OPTIONS', `${label(req)} idempotencyKey ne peut pas être vide.`);
  }
  if (current.entityTable !== req.entityTable || current.entityId !== req.entityId) {
    fail(
      'FSM_ENTITY_MISMATCH',
      `${label(req)} la requête ne porte pas sur l'entité courante [${current.entityTable}:${current.entityId}].`,
    );
  }
  if (current.appliedIdempotencyKeys.includes(req.idempotencyKey)) {
    fail('FSM_DUPLICATE_APPLICATION', `${label(req)} la clé ${req.idempotencyKey} a déjà été appliquée.`);
  }
  if (req.entityTable === LEDGER_JOURNAL_TABLE && current.state === LEDGER_POSTED_STATE) {
    fail(
      'FSM_POSTED_IMMUTABLE',
      `${label(req)} une pièce POSTED ne change jamais d'état ; la correction est une nouvelle écriture liée par reversal_of_entry_id (D-03).`,
    );
  }
  if (definition.terminalStates.includes(current.state)) {
    fail('FSM_TERMINAL_STATE', `${label(req)} ${current.state} est un état terminal de [${definition.name}].`);
  }
  if (current.state !== req.expectedFromState) {
    fail('FSM_CONCURRENCY_CONFLICT', `State of ${label(req)} changed concurrently.`);
  }

  assertValidTransition(definition.rules, req);

  for (const guard of guards) {
    const verdict = guard({ entity: current, request: req });
    if (!verdict.ok) {
      fail('FSM_GUARD_FAILED', `${label(req)} ${req.expectedFromState} -> ${req.targetState} : ${verdict.reason}`);
    }
  }

  return {
    entity: {
      entityTable: current.entityTable,
      entityId: current.entityId,
      state: req.targetState,
      version: current.version + 1,
      appliedIdempotencyKeys: [...current.appliedIdempotencyKeys, req.idempotencyKey],
    },
    audit: {
      id: options.auditId,
      entityTable: req.entityTable,
      entityId: req.entityId,
      fromState: req.expectedFromState,
      toState: req.targetState,
      actorKind: req.actorKind,
      actorId: req.actorId,
      idempotencyKey: req.idempotencyKey,
      proofRef: req.reasonOrProofRef ?? '',
      createdAtIso: options.nowIso,
    },
  };
}

/** Contrôle d'insertion : miroir applicatif du trigger BEFORE INSERT de D-03. */
export function assertValidInitialState<TState extends string>(
  definition: FsmDefinition<TState>,
  entityTable: FsmEntityTable,
  state: TState,
): void {
  if (entityTable === LEDGER_JOURNAL_TABLE && state === LEDGER_POSTED_STATE) {
    fail(
      'FSM_POSTED_IMMUTABLE',
      `[${entityTable}] insertion directe au statut ${LEDGER_POSTED_STATE} interdite : POSTED s'atteint depuis ${LEDGER_PRE_POSTED_STATE} (D-03).`,
    );
  }
  if (!definition.initialStates.includes(state)) {
    fail('FSM_INVALID_INITIAL_STATE', `[${entityTable}] ${state} n'est pas un état initial de [${definition.name}].`);
  }
}

export type JournalEntryState = 'IA_PROPOSITION' | 'DRAFT' | 'REVISEE_CYCLE' | 'POSTED';

/** FSM 03 de Doc_02 § 04, sans POSTED → CONTRE_PASSEE (D-03). */
export const JOURNAL_ENTRY_FSM: FsmDefinition<JournalEntryState> = defineFsm<JournalEntryState>({
  name: 'journal_entry',
  states: ['IA_PROPOSITION', 'DRAFT', 'REVISEE_CYCLE', 'POSTED'],
  initialStates: ['IA_PROPOSITION', 'DRAFT'],
  terminalStates: ['POSTED'],
  ledgerPostedGuard: true,
  rules: [
    { from: ['IA_PROPOSITION'], to: 'DRAFT', allowedActors: ['HUMAN_USER'] },
    { from: ['DRAFT'], to: 'REVISEE_CYCLE', allowedActors: ['HUMAN_USER'] },
    { from: ['REVISEE_CYCLE'], to: 'POSTED', allowedActors: ['HUMAN_USER'] },
  ],
});

export interface ReversalEntryDraft {
  readonly entryId: string;
  readonly status: 'DRAFT';
  readonly reversal_of_entry_id: string;
}

/**
 * D-03 : la contre-passation d'une pièce POSTED est une NOUVELLE écriture, liée par
 * reversal_of_entry_id ; elle naît en DRAFT et suit ensuite le chemin normal jusqu'à POSTED.
 */
export function buildReversalEntryDraft(input: {
  readonly reversedEntryId: string;
  readonly reversalEntryId: string;
  readonly reversedEntryState: JournalEntryState;
}): ReversalEntryDraft {
  if (input.reversedEntryState !== LEDGER_POSTED_STATE) {
    fail(
      'FSM_REVERSAL_REQUIRES_POSTED',
      `[${LEDGER_JOURNAL_TABLE}:${input.reversedEntryId}] seule une pièce POSTED se contre-passe (état : ${input.reversedEntryState}).`,
    );
  }
  if (input.reversalEntryId === input.reversedEntryId) {
    fail(
      'FSM_REVERSAL_SELF_REFERENCE',
      `[${LEDGER_JOURNAL_TABLE}:${input.reversedEntryId}] la contre-passation doit être une écriture distincte.`,
    );
  }
  return { entryId: input.reversalEntryId, status: 'DRAFT', reversal_of_entry_id: input.reversedEntryId };
}
