import { applyTransition, FsmTransitionError, type ActorKind, type FsmDefinition } from '@fisca/shared-types';
import { describe, expect, it } from 'vitest';
import { CDV_LIFECYCLE_FSM, CDV_STATUSES, CLEARANCE_STATES, INVOICE_CLEARANCE_FSM, deriveCdvStatus, projectCdvStatus, type CdvStatus } from '../src/index.ts';

function attempt<T extends string>(fsm: FsmDefinition<T>, from: T, to: T, actorKind: ActorKind = 'DETERMINISTIC_SYSTEM'): void {
  applyTransition(
    fsm,
    { entityTable: 'invoices', entityId: 'inv-1', state: from, version: 0, appliedIdempotencyKeys: [] },
    { entityTable: 'invoices', entityId: 'inv-1', expectedFromState: from, targetState: to, actorKind, actorId: 'test', idempotencyKey: `k:${from}:${to}`, reasonOrProofRef: 'preuve-de-test' },
    [],
    { nowIso: '2026-11-13T10:00:00.000Z', auditId: 'audit-1' },
  );
}

const CDV_VALID: ReadonlyArray<readonly [CdvStatus, CdvStatus]> = [
  ['DEPOSEE_CERTIFIEE_DGI', 'MISE_A_DISPOSITION'],
  ['DEPOSEE_CERTIFIEE_DGI', 'PRISE_EN_CHARGE'],
  ['DEPOSEE_CERTIFIEE_DGI', 'APPROUVEE'],
  ['DEPOSEE_CERTIFIEE_DGI', 'EN_LITIGE_SUSPENDUE'],
  ['DEPOSEE_CERTIFIEE_DGI', 'REFUSEE'],
  ['MISE_A_DISPOSITION', 'PRISE_EN_CHARGE'],
  ['MISE_A_DISPOSITION', 'EN_LITIGE_SUSPENDUE'],
  ['MISE_A_DISPOSITION', 'REFUSEE'],
  ['PRISE_EN_CHARGE', 'APPROUVEE'],
  ['PRISE_EN_CHARGE', 'APPROUVEE_PARTIELLEMENT'],
  ['PRISE_EN_CHARGE', 'EN_LITIGE_SUSPENDUE'],
  ['PRISE_EN_CHARGE', 'REFUSEE'],
  ['EN_LITIGE_SUSPENDUE', 'PRISE_EN_CHARGE'],
  ['EN_LITIGE_SUSPENDUE', 'APPROUVEE'],
  ['EN_LITIGE_SUSPENDUE', 'APPROUVEE_PARTIELLEMENT'],
  ['EN_LITIGE_SUSPENDUE', 'REFUSEE'],
  ['APPROUVEE', 'ENCAISSEE'],
];

describe('8 statuts CDV : transitions', () => {
  it('liste exactement 8 statuts', () => {
    expect(CDV_STATUSES).toHaveLength(8);
  });

  it.each(CDV_VALID)('transition valide %s -> %s', (from, to) => {
    expect(() => attempt(CDV_LIFECYCLE_FSM, from, to, 'EXTERNAL_WEBHOOK')).not.toThrow();
  });

  const valid = new Set(CDV_VALID.map(([from, to]) => `${from}>${to}`));
  const invalid = CDV_STATUSES.flatMap((from) => CDV_STATUSES.filter((to) => !valid.has(`${from}>${to}`)).map((to) => [from, to] as const));
  it('toutes les autres paires sont refusées (y compris auto-transition, retour arrière, sortie d\'un état terminal)', () => {
    expect(invalid.length).toBe(64 - CDV_VALID.length);
    for (const [from, to] of invalid) {
      expect(() => attempt(CDV_LIFECYCLE_FSM, from, to, 'EXTERNAL_WEBHOOK'), `${from} -> ${to}`).toThrow(FsmTransitionError);
    }
  });

  it('un acteur humain ou IA ne peut pas poser un statut CDV', () => {
    expect(() => attempt(CDV_LIFECYCLE_FSM, 'DEPOSEE_CERTIFIEE_DGI', 'APPROUVEE', 'AI_AGENT_PROPOSAL')).toThrow(/FSM_FORBIDDEN_ACTOR/);
    expect(() => attempt(CDV_LIFECYCLE_FSM, 'DEPOSEE_CERTIFIEE_DGI', 'APPROUVEE', 'HUMAN_USER')).toThrow(/FSM_FORBIDDEN_ACTOR/);
  });
});

describe('FSM clearance_state', () => {
  it('SIGNEE -> DEPOSEE et SIGNEE -> REJETEE_XHUB valides ; DEPOSEE -> REJETEE_XHUB et BROUILLON -> DEPOSEE refusés', () => {
    expect(() => attempt(INVOICE_CLEARANCE_FSM, 'SIGNEE_LOI_43_20', 'DEPOSEE_CERTIFIEE_DGI')).not.toThrow();
    expect(() => attempt(INVOICE_CLEARANCE_FSM, 'SIGNEE_LOI_43_20', 'REJETEE_XHUB')).not.toThrow();
    expect(() => attempt(INVOICE_CLEARANCE_FSM, 'DEPOSEE_CERTIFIEE_DGI', 'REJETEE_XHUB')).toThrow(FsmTransitionError);
    expect(() => attempt(INVOICE_CLEARANCE_FSM, 'BROUILLON', 'DEPOSEE_CERTIFIEE_DGI')).toThrow(FsmTransitionError);
    expect(() => attempt(INVOICE_CLEARANCE_FSM, 'NUMEROTEE_VERROUILLEE', 'DEPOSEE_CERTIFIEE_DGI')).toThrow(FsmTransitionError);
  });
  it('REJETEE_XHUB et ENCAISSEE sont terminaux', () => {
    for (const to of CLEARANCE_STATES) {
      expect(() => attempt(INVOICE_CLEARANCE_FSM, 'REJETEE_XHUB', to)).toThrow(FsmTransitionError);
    }
  });
});

describe('projection CDV <-> colonnes', () => {
  it('relit le statut effectif depuis les deux colonnes', () => {
    expect(deriveCdvStatus('SIGNEE_LOI_43_20', 'NONE')).toBeNull();
    expect(deriveCdvStatus('REJETEE_XHUB', 'NONE')).toBeNull();
    expect(deriveCdvStatus('DEPOSEE_CERTIFIEE_DGI', 'NONE')).toBe('DEPOSEE_CERTIFIEE_DGI');
    expect(deriveCdvStatus('DEPOSEE_CERTIFIEE_DGI', 'EN_LITIGE_SUSPENDUE')).toBe('EN_LITIGE_SUSPENDUE');
    expect(deriveCdvStatus('APPROUVEE', 'EN_LITIGE_SUSPENDUE')).toBe('APPROUVEE');
    expect(deriveCdvStatus('ENCAISSEE', 'NONE')).toBe('ENCAISSEE');
    expect(deriveCdvStatus('DEPOSEE_CERTIFIEE_DGI', 'VALEUR_INCONNUE')).toBeNull();
  });
  it('APPROUVEE et ENCAISSEE n\'écrivent que clearance_state', () => {
    expect(projectCdvStatus('APPROUVEE')).toEqual({ clearanceState: 'APPROUVEE', cdvColumn: null });
    expect(projectCdvStatus('REFUSEE')).toEqual({ clearanceState: null, cdvColumn: 'REFUSEE' });
  });
});
