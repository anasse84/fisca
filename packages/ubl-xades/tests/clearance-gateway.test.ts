import { describe, expect, it } from 'vitest';
import { ClearanceGatewayError, SIMULATED_DISPLAY_STATE, createSimulatedClearanceGateway, displayStateOfGateway, simulated } from '../src/index.ts';

const meta = { invoiceId: 'inv-1', xmlSha256: 'a'.repeat(64), idempotencyKey: 'clearance:inv-1:aaa' };
const nowIso = (): string => '2026-11-13T10:00:00.000Z';

describe('SimulatedClearanceGateway (pilote simulated, B-13)', () => {
  it("affiche « Validation simulée » et jamais « certifiée DGI »", () => {
    const gateway = createSimulatedClearanceGateway({ nowIso });
    expect(gateway.mode).toBe('simulated');
    expect(simulated.mode).toBe('simulated');
    expect(displayStateOfGateway(gateway.mode)).toBe('Validation simulée');
    expect(SIMULATED_DISPLAY_STATE).not.toMatch(/certifi|homologu|conforme/i);
  });

  it('succès déterministe puis getStatus', async () => {
    const gateway = createSimulatedClearanceGateway({ nowIso });
    const receipt = await gateway.submit('<x/>', meta);
    expect(receipt).toEqual({ xhubUuid: '00000000-0000-4000-8000-000000000001', receivedAt: nowIso() });
    expect(await gateway.getStatus(receipt.xhubUuid)).toEqual({ state: 'RECEIVED', xhubUuid: receipt.xhubUuid });
    expect(await gateway.getStatus('inconnu')).toEqual({ state: 'UNKNOWN' });
  });

  it('panne transitoire N fois puis succès ; rejet permanent typé', async () => {
    const gateway = createSimulatedClearanceGateway({ nowIso, script: [{ kind: 'transient' }, { kind: 'transient', code: 'HTTP_503' }, { kind: 'success' }] });
    await expect(gateway.submit('<x/>', meta)).rejects.toMatchObject({ kind: 'transient', code: 'SIMULATED_TRANSIENT' });
    await expect(gateway.submit('<x/>', meta)).rejects.toMatchObject({ kind: 'transient', code: 'HTTP_503' });
    await expect(gateway.submit('<x/>', meta)).resolves.toMatchObject({ xhubUuid: expect.any(String) });
    expect(gateway.acceptedCount).toBe(1);
    const rejecting = createSimulatedClearanceGateway({ nowIso, script: [{ kind: 'reject', code: 'REJ_METIER' }] });
    const error = await rejecting.submit('<x/>', meta).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClearanceGatewayError);
    expect(error).toMatchObject({ kind: 'permanent', code: 'REJ_METIER' });
  });

  it('une soumission rejouée avec la même clé ne crée pas de seconde soumission', async () => {
    const gateway = createSimulatedClearanceGateway({ nowIso });
    const first = await gateway.submit('<x/>', meta);
    const second = await gateway.submit('<x/>', meta);
    expect(second).toEqual(first);
    expect(gateway.callCount).toBe(2);
    expect(gateway.acceptedCount).toBe(1);
  });

  it('refuse un code de script hors motif (aucune donnée libre)', () => {
    expect(() => createSimulatedClearanceGateway({ nowIso, script: [{ kind: 'reject', code: 'avec espace@x.ma' }] })).toThrow(/SCRIPT_INVALID/);
  });
});
