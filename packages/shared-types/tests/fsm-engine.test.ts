import { describe, expect, it } from 'vitest';
import {
  FsmTransitionError,
  JOURNAL_ENTRY_FSM,
  applyTransition,
  assertValidInitialState,
  assertValidTransition,
  buildReversalEntryDraft,
  defineFsm,
  type FsmEntityState,
  type FsmGuard,
  type TransitionRequest,
  type TransitionRule,
} from '../src/index.ts';

type Clearance = 'DRAFT' | 'SENT' | 'CLEARED' | 'REJECTED';

const rules: readonly TransitionRule<Clearance>[] = [
  { from: ['DRAFT'], to: 'SENT', allowedActors: ['HUMAN_USER', 'DETERMINISTIC_SYSTEM'] },
  { from: ['SENT'], to: 'CLEARED', allowedActors: ['EXTERNAL_WEBHOOK'] },
  { from: ['SENT'], to: 'REJECTED', allowedActors: ['EXTERNAL_WEBHOOK'], requiresHumanApprovalNote: true },
];

const fsm = defineFsm<Clearance>({
  name: 'clearance',
  states: ['DRAFT', 'SENT', 'CLEARED', 'REJECTED'],
  initialStates: ['DRAFT'],
  terminalStates: ['CLEARED', 'REJECTED'],
  rules,
});

const options = { nowIso: '2026-11-14T10:00:00.000Z', auditId: 'audit-1' } as const;

function request(overrides: Partial<TransitionRequest<Clearance>> = {}): TransitionRequest<Clearance> {
  return {
    entityTable: 'invoices',
    entityId: 'inv-1',
    expectedFromState: 'DRAFT',
    targetState: 'SENT',
    actorKind: 'HUMAN_USER',
    actorId: 'user-1',
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}

function current(state: Clearance, keys: readonly string[] = []): FsmEntityState<Clearance> {
  return { entityTable: 'invoices', entityId: 'inv-1', state, version: 0, appliedIdempotencyKeys: keys };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof FsmTransitionError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

describe('assertValidTransition (Doc_02 § 11 + ERRATA section C)', () => {
  it('accepte une transition déclarée', () => {
    expect(() => assertValidTransition(rules, request())).not.toThrow();
  });

  it('rejette une transition non déclarée avec le message corrigé [table:id]', () => {
    const req = request({ expectedFromState: 'DRAFT', targetState: 'CLEARED' });
    expect(codeOf(() => assertValidTransition(rules, req))).toBe('FSM_ILLEGAL_TRANSITION');
    expect(() => assertValidTransition(rules, req)).toThrow(
      'FSM_ILLEGAL_TRANSITION: [invoices:inv-1] DRAFT -> CLEARED',
    );
  });

  it('rejette un acteur non habilité', () => {
    const req = request({ actorKind: 'AI_AGENT_PROPOSAL' });
    expect(codeOf(() => assertValidTransition(rules, req))).toBe('FSM_FORBIDDEN_ACTOR');
  });

  it('exige une preuve de 5 caractères minimum quand la règle le demande', () => {
    const base = { expectedFromState: 'SENT', targetState: 'REJECTED', actorKind: 'EXTERNAL_WEBHOOK' } as const;
    expect(codeOf(() => assertValidTransition(rules, request(base)))).toBe('FSM_MISSING_PROOF');
    expect(codeOf(() => assertValidTransition(rules, request({ ...base, reasonOrProofRef: '  ab ' })))).toBe(
      'FSM_MISSING_PROOF',
    );
    expect(() => assertValidTransition(rules, request({ ...base, reasonOrProofRef: 'r2://proof/1' }))).not.toThrow();
  });
});

describe('applyTransition : transition pure et atomique', () => {
  it('renvoie le nouvel état et l\'événement d\'audit sans muter l\'entrée', () => {
    const before = current('DRAFT');
    const result = applyTransition(fsm, before, request(), [], options);
    expect(result.entity.state).toBe('SENT');
    expect(result.entity.version).toBe(1);
    expect(result.entity.appliedIdempotencyKeys).toEqual(['idem-1']);
    expect(result.audit).toEqual({
      id: 'audit-1',
      entityTable: 'invoices',
      entityId: 'inv-1',
      fromState: 'DRAFT',
      toState: 'SENT',
      actorKind: 'HUMAN_USER',
      actorId: 'user-1',
      idempotencyKey: 'idem-1',
      proofRef: '',
      createdAtIso: '2026-11-14T10:00:00.000Z',
    });
    expect(before.state).toBe('DRAFT');
    expect(before.version).toBe(0);
    expect(before.appliedIdempotencyKeys).toEqual([]);
  });

  it('rejette un état courant différent de l\'état attendu (verrou optimiste)', () => {
    const req = request({ expectedFromState: 'DRAFT' });
    expect(codeOf(() => applyTransition(fsm, current('SENT'), req, [], options))).toBe('FSM_CONCURRENCY_CONFLICT');
    expect(() => applyTransition(fsm, current('SENT'), req, [], options)).toThrow(
      'FSM_CONCURRENCY_CONFLICT: State of [invoices:inv-1] changed concurrently.',
    );
  });

  it('rejette toute double application de la même clé d\'idempotence', () => {
    const first = applyTransition(fsm, current('DRAFT'), request(), [], options);
    expect(codeOf(() => applyTransition(fsm, first.entity, request(), [], options))).toBe(
      'FSM_DUPLICATE_APPLICATION',
    );
  });

  it('rejette une rejouée dont la clé est connue même si l\'état attendu correspond encore', () => {
    expect(codeOf(() => applyTransition(fsm, current('DRAFT', ['idem-1']), request(), [], options))).toBe(
      'FSM_DUPLICATE_APPLICATION',
    );
  });

  it('rejette toute sortie d\'un état terminal', () => {
    const req = request({ expectedFromState: 'CLEARED', targetState: 'SENT' });
    expect(codeOf(() => applyTransition(fsm, current('CLEARED'), req, [], options))).toBe('FSM_TERMINAL_STATE');
  });

  it('rejette une transition non déclarée', () => {
    const req = request({ targetState: 'CLEARED' });
    expect(codeOf(() => applyTransition(fsm, current('DRAFT'), req, [], options))).toBe('FSM_ILLEGAL_TRANSITION');
  });

  it('rejette une requête portant sur une autre entité que l\'état courant', () => {
    expect(codeOf(() => applyTransition(fsm, current('DRAFT'), request({ entityId: 'inv-2' }), [], options))).toBe(
      'FSM_ENTITY_MISMATCH',
    );
    expect(
      codeOf(() => applyTransition(fsm, current('DRAFT'), request({ entityTable: 'fiscal_years' }), [], options)),
    ).toBe('FSM_ENTITY_MISMATCH');
  });

  it('exécute les gardes dans l\'ordre et s\'arrête au premier refus', () => {
    const calls: string[] = [];
    const ok: FsmGuard<Clearance> = () => {
      calls.push('ok');
      return { ok: true };
    };
    const ko: FsmGuard<Clearance> = () => {
      calls.push('ko');
      return { ok: false, reason: 'montant déséquilibré' };
    };
    const never: FsmGuard<Clearance> = () => {
      calls.push('never');
      return { ok: true };
    };
    expect(codeOf(() => applyTransition(fsm, current('DRAFT'), request(), [ok, ko, never], options))).toBe(
      'FSM_GUARD_FAILED',
    );
    expect(calls).toEqual(['ok', 'ko']);
    expect(() => applyTransition(fsm, current('DRAFT'), request(), [ko], options)).toThrow(
      'FSM_GUARD_FAILED: [invoices:inv-1] DRAFT -> SENT : montant déséquilibré',
    );
  });

  it('transmet l\'état courant et la requête aux gardes', () => {
    let seen = '';
    const spy: FsmGuard<Clearance> = (ctx) => {
      seen = `${ctx.entity.state}>${ctx.request.targetState}`;
      return { ok: true };
    };
    applyTransition(fsm, current('DRAFT'), request(), [spy], options);
    expect(seen).toBe('DRAFT>SENT');
  });

  it('rejette un horodatage ou un identifiant d\'audit invalide', () => {
    expect(codeOf(() => applyTransition(fsm, current('DRAFT'), request(), [], { ...options, nowIso: 'hier' }))).toBe(
      'FSM_INVALID_OPTIONS',
    );
    expect(codeOf(() => applyTransition(fsm, current('DRAFT'), request(), [], { ...options, auditId: ' ' }))).toBe(
      'FSM_INVALID_OPTIONS',
    );
  });

  it('conserve la preuve dans l\'audit', () => {
    const req = request({ expectedFromState: 'SENT', targetState: 'REJECTED', actorKind: 'EXTERNAL_WEBHOOK', reasonOrProofRef: 'r2://proof/9' });
    const result = applyTransition(fsm, current('SENT'), req, [], options);
    expect(result.audit.proofRef).toBe('r2://proof/9');
    expect(result.entity.state).toBe('REJECTED');
  });
});

describe('defineFsm : validation de la définition', () => {
  it('refuse une règle qui part d\'un état terminal', () => {
    expect(() =>
      defineFsm<Clearance>({
        name: 'bad',
        states: ['DRAFT', 'SENT', 'CLEARED', 'REJECTED'],
        initialStates: ['DRAFT'],
        terminalStates: ['CLEARED'],
        rules: [{ from: ['CLEARED'], to: 'SENT', allowedActors: ['HUMAN_USER'] }],
      }),
    ).toThrow(/FSM_INVALID_DEFINITION/);
  });

  it('refuse une règle qui cite un état inconnu', () => {
    expect(() =>
      defineFsm<Clearance>({
        name: 'bad',
        states: ['DRAFT', 'SENT'],
        initialStates: ['DRAFT'],
        terminalStates: [],
        rules: [{ from: ['DRAFT'], to: 'CLEARED', allowedActors: ['HUMAN_USER'] }],
      }),
    ).toThrow(/FSM_INVALID_DEFINITION/);
  });

  it('refuse deux règles portant sur la même arête', () => {
    expect(() =>
      defineFsm<Clearance>({
        name: 'bad',
        states: ['DRAFT', 'SENT'],
        initialStates: ['DRAFT'],
        terminalStates: [],
        rules: [
          { from: ['DRAFT'], to: 'SENT', allowedActors: ['HUMAN_USER'] },
          { from: ['DRAFT'], to: 'SENT', allowedActors: ['DETERMINISTIC_SYSTEM'] },
        ],
      }),
    ).toThrow(/FSM_INVALID_DEFINITION/);
  });
});

type LedgerState = 'IA_PROPOSITION' | 'DRAFT' | 'REVISEE_CYCLE' | 'POSTED';

describe('Grand livre : POSTED immuable (ADR-05, D-03)', () => {
  const entryRequest = (
    from: LedgerState,
    to: LedgerState,
    overrides: Partial<TransitionRequest<LedgerState>> = {},
  ): TransitionRequest<LedgerState> => ({
    entityTable: 'journal_entries',
    entityId: 'je-1',
    expectedFromState: from,
    targetState: to,
    actorKind: 'HUMAN_USER',
    actorId: 'expert-1',
    idempotencyKey: `k-${from}-${to}`,
    ...overrides,
  });

  it('parcourt le chemin autorisé IA_PROPOSITION → DRAFT → REVISEE_CYCLE → POSTED', () => {
    let entity: FsmEntityState<LedgerState> = {
      entityTable: 'journal_entries',
      entityId: 'je-1',
      state: 'IA_PROPOSITION',
      version: 0,
      appliedIdempotencyKeys: [],
    };
    const path = ['DRAFT', 'REVISEE_CYCLE', 'POSTED'] as const;
    let from: 'IA_PROPOSITION' | 'DRAFT' | 'REVISEE_CYCLE' = 'IA_PROPOSITION';
    for (const to of path) {
      entity = applyTransition(JOURNAL_ENTRY_FSM, entity, entryRequest(from, to), [], options).entity;
      if (to !== 'POSTED') from = to;
    }
    expect(entity.state).toBe('POSTED');
  });

  it('interdit tout passage direct à POSTED', () => {
    for (const from of ['IA_PROPOSITION', 'DRAFT'] as const) {
      expect(codeOf(() => assertValidTransition(JOURNAL_ENTRY_FSM.rules, entryRequest(from, 'POSTED')))).toBe(
        'FSM_ILLEGAL_TRANSITION',
      );
    }
  });

  it('interdit toute écriture sur une pièce POSTED, y compris POSTED → CONTRE_PASSEE (D-03)', () => {
    const posted: FsmEntityState<LedgerState> = {
      entityTable: 'journal_entries',
      entityId: 'je-1',
      state: 'POSTED',
      version: 3,
      appliedIdempotencyKeys: [],
    };
    for (const to of ['DRAFT', 'REVISEE_CYCLE', 'IA_PROPOSITION', 'POSTED'] as const) {
      expect(codeOf(() => applyTransition(JOURNAL_ENTRY_FSM, posted, entryRequest('POSTED', to), [], options))).toBe(
        'FSM_POSTED_IMMUTABLE',
      );
    }
    const loose: readonly TransitionRule<LedgerState>[] = [{ from: ['POSTED'], to: 'DRAFT', allowedActors: ['HUMAN_USER'] }];
    expect(codeOf(() => assertValidTransition(loose, entryRequest('POSTED', 'DRAFT')))).toBe('FSM_POSTED_IMMUTABLE');
  });

  it('refuse qu\'une table de règles déclare une sortie de POSTED ou une entrée hors REVISEE_CYCLE', () => {
    expect(() =>
      defineFsm({
        name: 'bad-ledger',
        states: ['DRAFT', 'POSTED'],
        initialStates: ['DRAFT'],
        terminalStates: [],
        rules: [{ from: ['POSTED'], to: 'DRAFT', allowedActors: ['HUMAN_USER'] }],
        ledgerPostedGuard: true,
      }),
    ).toThrow(/FSM_INVALID_DEFINITION/);
    expect(() =>
      defineFsm({
        name: 'bad-ledger',
        states: ['DRAFT', 'REVISEE_CYCLE', 'POSTED'],
        initialStates: ['DRAFT'],
        terminalStates: ['POSTED'],
        rules: [{ from: ['DRAFT'], to: 'POSTED', allowedActors: ['HUMAN_USER'] }],
        ledgerPostedGuard: true,
      }),
    ).toThrow(/FSM_INVALID_DEFINITION/);
  });

  it('refuse l\'insertion directe d\'une écriture au statut POSTED (trigger BEFORE INSERT, D-03)', () => {
    expect(codeOf(() => assertValidInitialState(JOURNAL_ENTRY_FSM, 'journal_entries', 'POSTED'))).toBe(
      'FSM_POSTED_IMMUTABLE',
    );
    expect(codeOf(() => assertValidInitialState(JOURNAL_ENTRY_FSM, 'journal_entries', 'REVISEE_CYCLE'))).toBe(
      'FSM_INVALID_INITIAL_STATE',
    );
    expect(() => assertValidInitialState(JOURNAL_ENTRY_FSM, 'journal_entries', 'IA_PROPOSITION')).not.toThrow();
    expect(() => assertValidInitialState(JOURNAL_ENTRY_FSM, 'journal_entries', 'DRAFT')).not.toThrow();
  });

  it('la contre-passation est une nouvelle écriture liée par reversal_of_entry_id', () => {
    const draft = buildReversalEntryDraft({ reversedEntryId: 'je-1', reversalEntryId: 'je-2', reversedEntryState: 'POSTED' });
    expect(draft).toEqual({ entryId: 'je-2', status: 'DRAFT', reversal_of_entry_id: 'je-1' });
    expect(codeOf(() => buildReversalEntryDraft({ reversedEntryId: 'je-1', reversalEntryId: 'je-2', reversedEntryState: 'DRAFT' }))).toBe(
      'FSM_REVERSAL_REQUIRES_POSTED',
    );
    expect(codeOf(() => buildReversalEntryDraft({ reversedEntryId: 'je-1', reversalEntryId: 'je-1', reversedEntryState: 'POSTED' }))).toBe(
      'FSM_REVERSAL_SELF_REFERENCE',
    );
  });
});
