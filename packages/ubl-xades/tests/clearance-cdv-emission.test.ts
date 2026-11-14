import { describe, expect, it } from 'vitest';
import { CDV_EMITTABLE_STATUSES, ClearanceGatewayError, createSimulatedClearanceGateway } from '../src/clearance/index.ts';

const meta = (status: (typeof CDV_EMITTABLE_STATUSES)[number]) => ({ invoiceId: 'inv-1', xhubUuid: '00000000-0000-4000-8000-000000000001', status, idempotencyKey: `cdv:inv-1:${status}` });

describe('ClearanceGateway.emitCdv (pilote simulé, HYPOTHÈSE : aucune méthode xHub publiée)', () => {
  it('liste exactement les trois statuts émis par Fisca', () => {
    expect([...CDV_EMITTABLE_STATUSES]).toEqual(['APPROUVEE', 'EN_LITIGE_SUSPENDUE', 'ENCAISSEE']);
  });

  it('émet puis rejoue la même clé sans seconde émission', async () => {
    const gateway = createSimulatedClearanceGateway({ nowIso: () => '2026-11-13T10:00:00.000Z' });
    const first = await gateway.emitCdv(meta('APPROUVEE'));
    const again = await gateway.emitCdv(meta('APPROUVEE'));
    expect(again).toEqual(first);
    expect(gateway.emittedCdv).toHaveLength(1);
    await gateway.emitCdv(meta('ENCAISSEE'));
    expect(gateway.emittedCdv.map((m) => m.status)).toEqual(['APPROUVEE', 'ENCAISSEE']);
  });

  it('script : rejet permanent et panne transitoire typés, puis succès ; un échec n’est pas mémorisé', async () => {
    const gateway = createSimulatedClearanceGateway({ nowIso: () => '2026-11-13T10:00:00.000Z', cdvScript: [{ kind: 'reject', code: 'REFUSED' }, { kind: 'transient' }] });
    await expect(gateway.emitCdv(meta('APPROUVEE'))).rejects.toMatchObject({ kind: 'permanent', code: 'REFUSED' });
    await expect(gateway.emitCdv(meta('APPROUVEE'))).rejects.toBeInstanceOf(ClearanceGatewayError);
    expect(gateway.emittedCdv).toEqual([]);
    await gateway.emitCdv(meta('APPROUVEE'));
    expect(gateway.emittedCdv).toHaveLength(1);
  });

  it('une émission n’altère pas le compteur de soumissions', async () => {
    const gateway = createSimulatedClearanceGateway({ nowIso: () => '2026-11-13T10:00:00.000Z' });
    await gateway.emitCdv(meta('APPROUVEE'));
    expect(gateway.callCount).toBe(0);
    expect(gateway.acceptedCount).toBe(0);
  });
});
