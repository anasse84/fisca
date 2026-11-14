import { describe, expect, it } from 'vitest';
import {
  ICE_ONBOARDING_BUDGET_MS,
  ICE_ONBOARDING_STEPS,
  elapsedMs,
  iceOnboardingReducer,
  initialIceOnboarding,
  isOverBudget,
} from './ice-onboarding-machine.ts';
import type { IceOnboardingEvent, IceOnboardingState } from './ice-onboarding-machine.ts';
import type { ApiProblem, IceDossier } from './api-client.ts';

const dossier: IceDossier = {
  ice: '001234567000089', identifiantFiscal: '12345678', rcNumber: '45678', rcTribunal: 'Rabat', raisonSocialeFr: 'Société Test SARL',
  raisonSocialeAr: null, legalForm: 'SARL', shareCapitalCents: 10000000, addressAdc450: '12 avenue Mohammed V, Rabat', verifiedCount: 3,
};
const problem = (errorCode: string, status: number, extra: Partial<ApiProblem> = {}): ApiProblem => ({ status, errorCode, retryAfterSec: null, fieldErrors: {}, ...extra });
const run = (events: readonly IceOnboardingEvent[], from: IceOnboardingState = initialIceOnboarding(0)): IceOnboardingState => events.reduce(iceOnboardingReducer, from);

describe('onboarding ICE en 90 s : machine pure', () => {
  it('deux étapes visibles seulement (ICE, vérification) et un seul champ de saisie', () => {
    expect(ICE_ONBOARDING_STEPS).toEqual(['ice', 'review']);
    expect(ICE_ONBOARDING_BUDGET_MS).toBe(90_000);
  });

  it('parcours complet : 3 interactions (saisie, recherche, confirmation) et chronomètre simulé sous 90 s', () => {
    let clock = 0;
    let s = initialIceOnboarding(clock);
    let interactions = 0;
    const step = (ms: number, event: IceOnboardingEvent) => {
      clock += ms;
      interactions += 1;
      s = iceOnboardingReducer(s, event);
    };
    step(9_000, { type: 'ICE_CHANGED', value: '001234567000089' }); // frappe de 15 chiffres
    step(1_000, { type: 'SEARCH', nowMs: clock + 1_000 });
    expect(s.step).toBe('searching');
    step(1_500, { type: 'FOUND', dossier });
    expect(s).toMatchObject({ step: 'review', dossier: { ice: '001234567000089' } });
    step(6_000, { type: 'CONFIRM', nowMs: clock + 6_000 });
    expect(s.step).toBe('done');
    expect(interactions).toBe(4); // 3 actions humaines + la réponse de l’annuaire
    expect(elapsedMs(s, clock)).toBe(17_500);
    expect(isOverBudget(s, clock)).toBe(false);
  });

  it('le chronomètre démarre à la création et se fige à la fin', () => {
    const s = run([{ type: 'ICE_CHANGED', value: '001234567000089' }, { type: 'SEARCH', nowMs: 10 }, { type: 'FOUND', dossier }, { type: 'CONFIRM', nowMs: 30_000 }], initialIceOnboarding(5_000));
    expect(elapsedMs(s, 1_000_000)).toBe(25_000);
  });

  it('dépassement du budget : signalé, jamais bloquant', () => {
    const s = initialIceOnboarding(0);
    expect(isOverBudget(s, 90_000)).toBe(false);
    expect(isOverBudget(s, 90_001)).toBe(true);
    expect(run([{ type: 'ICE_CHANGED', value: '001234567000089' }, { type: 'SEARCH', nowMs: 200_000 }], s).step).toBe('searching');
  });

  it('forme invalide : aucune recherche lancée, erreur de champ ice', () => {
    const s = run([{ type: 'ICE_CHANGED', value: '123' }, { type: 'SEARCH', nowMs: 1 }]);
    expect(s).toMatchObject({ step: 'ice', errorKey: 'errors.iceShape', fieldError: true });
  });

  it('saisie normalisée : espaces, tirets et chiffres arabo-indiens', () => {
    expect(run([{ type: 'ICE_CHANGED', value: '٠٠١ 234-567 000 089' }]).ice).toBe('001234567000089');
  });

  it('ICE introuvable (404) : reste sur ice, valeur conservée, ne compte pas pour le verrou comme un abus', () => {
    const s = run([{ type: 'ICE_CHANGED', value: '001234567000089' }, { type: 'SEARCH', nowMs: 1 }, { type: 'FAILED', problem: problem('DIRECTORY_ICE_NOT_FOUND', 404), nowMs: 2 }]);
    expect(s).toMatchObject({ step: 'ice', ice: '001234567000089', errorKey: 'errors.iceNotFound' });
  });

  it('rejet 400 sur le champ ice (clé officielle côté serveur) : message de rejet, jamais « existe »', () => {
    const s = run([
      { type: 'ICE_CHANGED', value: '123456789012345' },
      { type: 'SEARCH', nowMs: 1 },
      { type: 'FAILED', problem: problem('REQUEST_VALIDATION_FAILED', 400, { fieldErrors: { ice: [{ code: 'custom' }] } }), nowMs: 2 },
    ]);
    expect(s).toMatchObject({ step: 'ice', errorKey: 'errors.iceRejected', fieldError: true });
  });

  it('429 : verrou avec Retry-After ; recherche bloquée puis reprise après TICK', () => {
    let s = run([{ type: 'ICE_CHANGED', value: '001234567000089' }, { type: 'SEARCH', nowMs: 0 }, { type: 'FAILED', problem: problem('RATE_LIMITED', 429, { retryAfterSec: 30 }), nowMs: 0 }]);
    expect(s.lockedUntilMs).toBe(30_000);
    expect(run([{ type: 'SEARCH', nowMs: 10_000 }], s).step).toBe('ice');
    s = run([{ type: 'TICK', nowMs: 30_000 }], s);
    expect(run([{ type: 'SEARCH', nowMs: 30_001 }], s).step).toBe('searching');
  });

  it('session absente (401) : AUTH_REQUIRED expose errors.sessionRequired', () => {
    const s = run([{ type: 'ICE_CHANGED', value: '001234567000089' }, { type: 'SEARCH', nowMs: 0 }, { type: 'FAILED', problem: problem('AUTH_REQUIRED', 401), nowMs: 0 }]);
    expect(s.errorKey).toBe('errors.sessionRequired');
  });

  it('retour arrière : review → ice conserve la saisie et efface le dossier', () => {
    const s = run([{ type: 'ICE_CHANGED', value: '001234567000089' }, { type: 'SEARCH', nowMs: 0 }, { type: 'FOUND', dossier }, { type: 'BACK' }]);
    expect(s).toMatchObject({ step: 'ice', ice: '001234567000089', dossier: null });
    expect(run([{ type: 'BACK' }]).step).toBe('ice');
  });

  it('ignore FOUND hors recherche et CONFIRM hors vérification', () => {
    expect(run([{ type: 'FOUND', dossier }]).step).toBe('ice');
    expect(run([{ type: 'CONFIRM', nowMs: 1 }]).step).toBe('ice');
  });

  it('le dossier pré-rempli ne contient que des champs de l’annuaire : aucun identifiant de société choisi par l’utilisateur', () => {
    const s = run([{ type: 'ICE_CHANGED', value: '001234567000089' }, { type: 'SEARCH', nowMs: 0 }, { type: 'FOUND', dossier }]);
    expect(Object.keys(s)).not.toEqual(expect.arrayContaining(['companyId', 'tenantId']));
    expect(JSON.stringify(s)).not.toMatch(/companyId|tenantId|company_id/);
  });
});
