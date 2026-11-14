import { applyTransition, type FsmDefinition } from '@fisca/shared-types';
import { describe, expect, it } from 'vitest';
import { buildCdvLifecycleFsm, CDV_DIAGRAM_TRANSITIONS, CDV_HYPOTHETICAL_TRANSITIONS, CDV_LIFECYCLE_FSM, CDV_STATUSES, type CdvStatus } from '../src/index.ts';

function allowedPairs(fsm: FsmDefinition<CdvStatus>): ReadonlySet<string> {
  const allowed = new Set<string>();
  for (const from of CDV_STATUSES) {
    for (const to of CDV_STATUSES) {
      try {
        applyTransition(
          fsm,
          { entityTable: 'invoices', entityId: 'inv-1', state: from, version: 0, appliedIdempotencyKeys: [] },
          { entityTable: 'invoices', entityId: 'inv-1', expectedFromState: from, targetState: to, actorKind: 'EXTERNAL_WEBHOOK', actorId: 'test', idempotencyKey: `k:${from}:${to}`, reasonOrProofRef: 'preuve' },
          [],
          { nowIso: '2026-11-13T10:00:00.000Z', auditId: 'audit-1' },
        );
        allowed.add(`${from}>${to}`);
      } catch {
        // transition refusée : absente de l'ensemble.
      }
    }
  }
  return allowed;
}

const keyOf = (edge: { readonly from: CdvStatus; readonly to: CdvStatus }): string => `${edge.from}>${edge.to}`;

describe('CDV_HYPOTHETICAL_TRANSITIONS : source unique des arêtes par hypothèse', () => {
  it('compte exactement 10 arêtes hypothétiques et 7 arêtes du diagramme, sans recouvrement ni doublon', () => {
    expect(CDV_HYPOTHETICAL_TRANSITIONS).toHaveLength(10);
    expect(CDV_DIAGRAM_TRANSITIONS).toHaveLength(7);
    const all = [...CDV_DIAGRAM_TRANSITIONS, ...CDV_HYPOTHETICAL_TRANSITIONS].map(keyOf);
    expect(new Set(all).size).toBe(17);
    expect(CDV_LIFECYCLE_FSM.rules).toHaveLength(17);
  });

  it('le FSM exporté autorise exactement diagramme + hypothèses', () => {
    const expected = new Set([...CDV_DIAGRAM_TRANSITIONS, ...CDV_HYPOTHETICAL_TRANSITIONS].map(keyOf));
    expect(allowedPairs(CDV_LIFECYCLE_FSM)).toEqual(expected);
  });

  it('retirer la constante retire exactement ces 10 arêtes et aucune autre', () => {
    const withoutHypotheses = allowedPairs(buildCdvLifecycleFsm([]));
    expect(withoutHypotheses).toEqual(new Set(CDV_DIAGRAM_TRANSITIONS.map(keyOf)));
    const removed = [...allowedPairs(CDV_LIFECYCLE_FSM)].filter((pair) => !withoutHypotheses.has(pair)).sort();
    expect(removed).toEqual(CDV_HYPOTHETICAL_TRANSITIONS.map(keyOf).sort());
  });
});
