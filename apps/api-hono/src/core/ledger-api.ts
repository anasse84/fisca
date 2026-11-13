/**
 * Logique des routes du grand livre (ticket T-S1B-12 ; ERRATA B-02 : les routes sont de la colle, la logique vit ici).
 *
 * Construit, pour chaque requête, un `ImmutableCgncLedgerEngine` sur la base du dossier RÉSOLUE par le TenantRouter, et l'acteur
 * à partir de l'identité authentifiée (D-16) : rôle et dossier viennent du contexte serveur, jamais du corps. La Step-Up vient du
 * claim `mfa_verified_at` du jeton. L'état « lecture seule » vient de l'EntitlementGuard (échec fermé s'il manque).
 */
import { evaluateAccessPolicy, type AuthorizationContext, type OrgPlanSegment, type PermissionAction } from '@fisca/auth-rbac';
import { assertPermissionWithinMandateCeiling } from './mandate-permission-ceiling.ts';
import {
  ImmutableCgncLedgerEngine,
  type LedgerActor,
  type LedgerClock,
  type LedgerFieldCipher,
  type LedgerHasher,
  type LedgerIdSource,
  type PreCloseControls,
} from './immutable-cgnc-ledger-engine.ts';
import { reconcileBankTransaction } from './bank-reconciliation.ts';
import { LedgerError } from './ledger-errors.ts';
import type { PostEntryRequest, PostEntryResponse, ReconcileRequest, ReconcileResponse } from './api-v1-schemas.ts';
import type { AuthenticatedActor, TenantContext } from './tenant-router.ts';

/** Attributs d'organisation lus au plan de contrôle (hors du jeton) : segment de plan, effectif, ABAC paie. */
export interface LedgerActorProfile {
  readonly orgPlanSegment: OrgPlanSegment;
  readonly activeHumanMembersCount: number;
  readonly canAccessPayrollPii: boolean;
}

/**
 * Habilitation paie effective (Doc_09 § 07) : le chemin d'accès l'autorise (`TenantContext.canAccessPayrollPii` : mandat
 * `can_access_payroll_pii` pour un cabinet, vrai pour une appartenance directe) ET l'utilisateur porte l'attribut. Jamais un OU.
 */
export function effectivePayrollPiiClearance(accessPathAllows: boolean, userAttribute: boolean): boolean {
  return accessPathAllows && userAttribute;
}

export interface LedgerActorProfileSource {
  resolve(tenant: TenantContext): Promise<LedgerActorProfile>;
}

export interface LedgerApiDeps {
  readonly clock: LedgerClock;
  readonly ids: LedgerIdSource;
  readonly hasher?: LedgerHasher;
  readonly cipher: LedgerFieldCipher;
  readonly preCloseControls: PreCloseControls;
  readonly actorProfiles: LedgerActorProfileSource;
}

/** Ce que la colle transmet : uniquement des valeurs posées par le pipeline, jamais des entrées du client. */
export interface LedgerCall {
  readonly tenant: TenantContext;
  readonly auth: AuthenticatedActor;
  /** `EntitlementView.readOnly` ; true si l'EntitlementGuard n'a rien posé (échec fermé). */
  readonly subscriptionReadOnly: boolean;
}

export interface LedgerApi {
  postEntry(call: LedgerCall, input: { readonly entryId: string; readonly body: PostEntryRequest; readonly idempotencyKey: string }): Promise<PostEntryResponse>;
  reconcile(call: LedgerCall, body: ReconcileRequest): Promise<ReconcileResponse>;
}

export function createLedgerApi(deps: LedgerApiDeps): LedgerApi {
  async function prepare(call: LedgerCall): Promise<{ engine: ImmutableCgncLedgerEngine; actor: LedgerActor }> {
    const profile = await deps.actorProfiles.resolve(call.tenant);
    const mfa = call.auth.mfaVerifiedAtEpochSec;
    const actor: LedgerActor = {
      actorId: call.tenant.userId,
      role: call.tenant.role,
      permissionCeiling: call.tenant.permissionCeiling,
      ...(call.tenant.activeCpaMandate === null ? {} : { activeCpaMandate: call.tenant.activeCpaMandate }),
      assignedCompanyIds: [call.tenant.companyId],
      orgPlanSegment: profile.orgPlanSegment,
      activeHumanMembersCount: profile.activeHumanMembersCount,
      subscriptionReadOnly: call.subscriptionReadOnly,
      canAccessPayrollPii: effectivePayrollPiiClearance(call.tenant.canAccessPayrollPii, profile.canAccessPayrollPii),
      ...(mfa === null || mfa === undefined ? {} : { mfaVerifiedAtEpochSec: mfa }),
    };
    const engine = new ImmutableCgncLedgerEngine({
      db: call.tenant.tenantDb,
      companyId: call.tenant.companyId,
      clock: deps.clock,
      ids: deps.ids,
      ...(deps.hasher === undefined ? {} : { hasher: deps.hasher }),
      cipher: deps.cipher,
      preCloseControls: deps.preCloseControls,
    });
    return { engine, actor };
  }

  function authorize(actor: LedgerActor, companyId: string, action: PermissionAction): void {
    assertPermissionWithinMandateCeiling(action, actor);
    const context: AuthorizationContext = {
      actorId: actor.actorId,
      role: actor.role,
      companyId,
      assignedCompanyIds: actor.assignedCompanyIds,
      orgPlanSegment: actor.orgPlanSegment,
      activeHumanMembersCount: actor.activeHumanMembersCount,
      subscriptionReadOnly: actor.subscriptionReadOnly,
      fiscalYearClosed: false,
      canAccessPayrollPii: actor.canAccessPayrollPii,
      mfaVerifiedAtEpochSec: actor.mfaVerifiedAtEpochSec,
      nowEpochSec: Math.floor(Date.parse(deps.clock.nowIso()) / 1000),
    };
    const decision = evaluateAccessPolicy(action, context);
    if (!decision.allowed) {
      throw new LedgerError('LEDGER_ACCESS_DENIED', `${decision.denialCode} : ${decision.denialMessage}`, { denialCode: decision.denialCode });
    }
  }

  return {
    postEntry: async (call, input) => {
      const { engine, actor } = await prepare(call);
      if (input.body.action === 'SEAL') {
        const sealed = await engine.sealEntry(actor, { entryId: input.entryId, idempotencyKey: input.idempotencyKey });
        return {
          action: 'SEAL',
          entryId: sealed.entryId,
          fromState: sealed.fromState,
          toState: sealed.toState,
          replayed: sealed.replayed,
          ...(sealed.entryHash === undefined ? {} : { entryHash: sealed.entryHash }),
          ...(sealed.previousEntryHash === undefined ? {} : { previousEntryHash: sealed.previousEntryHash }),
        };
      }
      const reversal = await engine.createReversalDraft(actor, {
        originalEntryId: input.entryId,
        entryDate: input.body.entryDate,
        reasonText: input.body.reasonText,
        ...(input.body.fiscalYearId === undefined ? {} : { fiscalYearId: input.body.fiscalYearId }),
        ...(input.body.journalId === undefined ? {} : { journalId: input.body.journalId }),
      });
      return {
        action: 'REVERSE',
        reversalEntryId: reversal.entryId,
        reversalOfEntryId: input.entryId,
        entryReference: reversal.entryReference,
        sequenceNumber: reversal.sequenceNumber,
        status: reversal.status,
      };
    },
    reconcile: async (call, body) => {
      const { engine, actor } = await prepare(call);
      return reconcileBankTransaction(
        {
          db: call.tenant.tenantDb,
          engine,
          authorize: () => authorize(actor, call.tenant.companyId, 'LEDGER_SAVE_DRAFT'),
        },
        actor,
        body,
      );
    },
  };
}
