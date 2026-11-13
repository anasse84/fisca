import { describe, expect, it } from 'vitest';
import {
  PERMISSION_ACTIONS,
  ROLE_CODES,
  STEP_UP_MAX_AGE_SEC,
  evaluateAccessPolicy,
  type AuthorizationContext,
  type PermissionAction,
  type RoleCode,
} from '../src/index.ts';

const NOW = 1_800_000_000;

function ctx(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    actorId: 'user-actor',
    role: 'OWNER_GERANT',
    companyId: 'co-1',
    assignedCompanyIds: ['co-1'],
    orgPlanSegment: 'ENTERPRISE',
    activeHumanMembersCount: 5,
    subscriptionReadOnly: false,
    fiscalYearClosed: false,
    canAccessPayrollPii: true,
    mfaVerifiedAtEpochSec: NOW - 10,
    nowEpochSec: NOW,
    ...overrides,
  };
}

const PLAIN_ACTIONS_BY_ROLE: Readonly<Record<RoleCode, readonly PermissionAction[]>> = {
  OWNER_GERANT: [
    'INVOICE_CREATE_DRAFT', 'INVOICE_CERTIFY_XHUB', 'POS_ENCASH_TICKET', 'POS_VIEW_EXPECTED_CASH',
    'PO_CREATE', 'BL_CONFIRM_RECEIPT', 'PARTNER_PROPOSE_RIB_CHANGE', 'PARTNER_APPROVE_RIB_CHANGE',
    'PAYMENT_PREPARE_PAIN001', 'PAYMENT_SIGN_PAIN001', 'LEDGER_SAVE_DRAFT', 'LEDGER_POST_IMMUTABLE',
    'PAYROLL_9421_READ_EXPORT', 'REVERSIBILITY_EXPORT_10Y', 'E2EE_REVOKE_CPA_GRANT',
  ],
  COMMERCIAL_FACTURATION: ['INVOICE_CREATE_DRAFT', 'INVOICE_CERTIFY_XHUB'],
  CAISSIER_POS: ['POS_ENCASH_TICKET'],
  ACHATS_BUYER: ['PO_CREATE', 'PARTNER_PROPOSE_RIB_CHANGE'],
  MAGASINIER_BL: ['BL_CONFIRM_RECEIPT'],
  DAF_TRESORIER: [
    'INVOICE_CREATE_DRAFT', 'INVOICE_CERTIFY_XHUB', 'POS_VIEW_EXPECTED_CASH',
    'PARTNER_APPROVE_RIB_CHANGE', 'PAYMENT_PREPARE_PAIN001', 'PAYMENT_SIGN_PAIN001',
    'PAYROLL_9421_READ_EXPORT', 'REVERSIBILITY_EXPORT_10Y',
  ],
  // Doc_09 §06B : 9421 « Si attribut PII » (la matrice teste ici le RBAC, l'ABAC est testé plus bas).
  AIDE_COMPTABLE: ['INVOICE_CREATE_DRAFT', 'LEDGER_SAVE_DRAFT', 'PAYROLL_9421_READ_EXPORT'],
  CHEF_MISSION: ['LEDGER_SAVE_DRAFT', 'LEDGER_VISA_CYCLE', 'PAYROLL_9421_READ_EXPORT'],
  EXPERT_COMPTABLE_OEC: [
    'LEDGER_SAVE_DRAFT', 'LEDGER_VISA_CYCLE', 'LEDGER_POST_IMMUTABLE',
    'PAYROLL_9421_READ_EXPORT', 'REVERSIBILITY_EXPORT_10Y',
  ],
  AUDITEUR_CAC_DGI: ['REVERSIBILITY_EXPORT_10Y'],
  ERP_CONNECTOR_AGENT: ['INVOICE_CREATE_DRAFT', 'LEDGER_SAVE_DRAFT'],
  AI_MCP_ACTOR: ['INVOICE_CREATE_DRAFT'],
};

/** Contexte satisfaisant les contrôles SoD pour que seule la matrice RBAC soit testée. */
function matrixCtx(role: RoleCode, action: PermissionAction): AuthorizationContext {
  const technical = role === 'ERP_CONNECTOR_AGENT' || role === 'AI_MCP_ACTOR';
  return ctx({
    role,
    sodMakerActorId: 'someone-else',
    mcpScopes: technical ? ['mcp:draft'] : undefined,
    ...(action === 'PAYMENT_SIGN_PAIN001' ? { sodRibModifierActorId: 'rib-editor' } : {}),
  });
}

describe('catalogue : 12 rôles (ERRATA D-02)', () => {
  it('compte 10 humains + 2 techniques, COMMERCIAL_FACTURATION inclus', () => {
    expect(ROLE_CODES).toHaveLength(12);
    expect(new Set(ROLE_CODES).size).toBe(12);
    expect(ROLE_CODES).toContain('COMMERCIAL_FACTURATION');
    expect(ROLE_CODES).toContain('ERP_CONNECTOR_AGENT');
    expect(ROLE_CODES).toContain('AI_MCP_ACTOR');
  });
});

describe('matrice rôle x action', () => {
  for (const role of ROLE_CODES) {
    for (const action of PERMISSION_ACTIONS) {
      const expected = PLAIN_ACTIONS_BY_ROLE[role].includes(action);
      it(`${role} x ${action} -> ${expected ? 'permis' : 'refusé'}`, () => {
        const decision = evaluateAccessPolicy(action, matrixCtx(role, action));
        expect(decision.allowed).toBe(expected);
        if (!decision.allowed) {
          expect(decision.denialCode).toBe(`RBAC_FORBIDDEN_FOR_${role}`);
          expect(decision.denialMessage.length).toBeGreaterThan(10);
        }
      });
    }
  }

  it('CAISSIER_POS ne voit jamais le cash attendu (comptage aveugle)', () => {
    const d = evaluateAccessPolicy('POS_VIEW_EXPECTED_CASH', ctx({ role: 'CAISSIER_POS' }));
    expect(d.allowed).toBe(false);
  });
});

describe('deny-by-default', () => {
  it('refuse une action inconnue', () => {
    const d = evaluateAccessPolicy('LEDGER_DELETE_EVERYTHING' as PermissionAction, ctx());
    expect(d).toMatchObject({ allowed: false, denialCode: 'RBAC_UNKNOWN_ACTION' });
  });
  it('refuse un rôle inconnu', () => {
    const d = evaluateAccessPolicy('PO_CREATE', ctx({ role: 'SUPER_ADMIN' as RoleCode }));
    expect(d).toMatchObject({ allowed: false, denialCode: 'RBAC_UNKNOWN_ROLE' });
  });
  it('refuse un rôle qui hérite de Object.prototype', () => {
    const d = evaluateAccessPolicy('PO_CREATE', ctx({ role: 'constructor' as RoleCode }));
    expect(d).toMatchObject({ allowed: false, denialCode: 'RBAC_UNKNOWN_ROLE' });
  });
  it('refuse un acteur sans identifiant', () => {
    const d = evaluateAccessPolicy('PO_CREATE', ctx({ actorId: '' }));
    expect(d).toMatchObject({ allowed: false, denialCode: 'CONTEXT_INVALID' });
  });
  it('refuse un dossier hors portefeuille', () => {
    const d = evaluateAccessPolicy('PO_CREATE', ctx({ assignedCompanyIds: ['co-2'] }));
    expect(d).toMatchObject({ allowed: false, denialCode: 'ABAC_TENANT_OUT_OF_SCOPE' });
  });
  it('refuse un portefeuille vide', () => {
    const d = evaluateAccessPolicy('PO_CREATE', ctx({ assignedCompanyIds: [] }));
    expect(d.allowed).toBe(false);
  });
  it('est déterministe et ne mute pas le contexte', () => {
    const c = ctx();
    const snapshot = JSON.stringify(c);
    const a = evaluateAccessPolicy('PO_CREATE', c);
    const b = evaluateAccessPolicy('PO_CREATE', c);
    expect(a).toEqual(b);
    expect(JSON.stringify(c)).toBe(snapshot);
  });
});

describe('sanctuarisation impayé (RESTRICTED_READ_ONLY)', () => {
  it('bloque les mutations mais laisse l’export décennal ouvert', () => {
    const base = { subscriptionReadOnly: true };
    expect(evaluateAccessPolicy('LEDGER_SAVE_DRAFT', ctx({ ...base, role: 'AIDE_COMPTABLE' }))).toMatchObject({
      allowed: false,
      denialCode: 'ABAC_SUBSCRIPTION_READ_ONLY',
    });
    expect(evaluateAccessPolicy('REVERSIBILITY_EXPORT_10Y', ctx({ ...base, role: 'AUDITEUR_CAC_DGI' })).allowed).toBe(true);
  });
});

describe('verrou d’exercice clôturé', () => {
  it('refuse toute écriture comptable quel que soit le rôle', () => {
    for (const action of ['LEDGER_SAVE_DRAFT', 'LEDGER_VISA_CYCLE', 'LEDGER_POST_IMMUTABLE'] as const) {
      const d = evaluateAccessPolicy(action, ctx({ role: 'EXPERT_COMPTABLE_OEC', fiscalYearClosed: true }));
      expect(d).toMatchObject({ allowed: false, denialCode: 'ABAC_FISCAL_YEAR_CLOSED' });
    }
  });
});

describe('ABAC PII — État 9421', () => {
  for (const role of ['OWNER_GERANT', 'DAF_TRESORIER', 'EXPERT_COMPTABLE_OEC', 'AIDE_COMPTABLE', 'CHEF_MISSION'] as const) {
    it(`${role} sans habilitation can_access_payroll_pii est refusé`, () => {
      const d = evaluateAccessPolicy('PAYROLL_9421_READ_EXPORT', ctx({ role, canAccessPayrollPii: false }));
      expect(d).toMatchObject({ allowed: false, denialCode: 'ABAC_PAYROLL_PII_CLEARANCE_MISSING' });
    });
    it(`${role} avec habilitation est permis`, () => {
      expect(evaluateAccessPolicy('PAYROLL_9421_READ_EXPORT', ctx({ role, canAccessPayrollPii: true })).allowed).toBe(true);
    });
  }
  it('l’habilitation PII n’élargit jamais le RBAC', () => {
    const d = evaluateAccessPolicy('PAYROLL_9421_READ_EXPORT', ctx({ role: 'CAISSIER_POS', canAccessPayrollPii: true }));
    expect(d).toMatchObject({ allowed: false, denialCode: 'RBAC_FORBIDDEN_FOR_CAISSIER_POS' });
  });
  it('une habilitation non booléenne stricte est refusée', () => {
    const d = evaluateAccessPolicy(
      'PAYROLL_9421_READ_EXPORT',
      ctx({ canAccessPayrollPii: 'true' as unknown as boolean }),
    );
    expect(d.allowed).toBe(false);
  });
});

describe('Step-Up MFA 300 s', () => {
  const action = 'LEDGER_POST_IMMUTABLE';
  const make = (ageSec: number | undefined): AuthorizationContext =>
    ctx({
      role: 'EXPERT_COMPTABLE_OEC',
      mfaVerifiedAtEpochSec: ageSec === undefined ? undefined : NOW - ageSec,
    });

  it('expose une durée de 300 s', () => {
    expect(STEP_UP_MAX_AGE_SEC).toBe(300);
  });
  it('accepte 299 s', () => {
    expect(evaluateAccessPolicy(action, make(299)).allowed).toBe(true);
  });
  it('refuse 301 s', () => {
    expect(evaluateAccessPolicy(action, make(301))).toMatchObject({
      allowed: false,
      denialCode: 'ABAC_STEP_UP_MFA_REQUIRED',
    });
  });
  it('accepte 0 s', () => {
    expect(evaluateAccessPolicy(action, make(0)).allowed).toBe(true);
  });
  it('refuse une preuve absente', () => {
    expect(evaluateAccessPolicy(action, make(undefined)).allowed).toBe(false);
  });
  it('refuse une preuve datée du futur', () => {
    expect(evaluateAccessPolicy(action, make(-1)).allowed).toBe(false);
  });
  it('refuse une valeur non finie', () => {
    expect(evaluateAccessPolicy(action, ctx({ role: 'EXPERT_COMPTABLE_OEC', mfaVerifiedAtEpochSec: Number.NaN })).allowed).toBe(false);
  });
  it('utilise l’horloge du paramètre, pas l’heure globale', () => {
    const c = ctx({ role: 'EXPERT_COMPTABLE_OEC', mfaVerifiedAtEpochSec: 1000, nowEpochSec: 1299 });
    expect(evaluateAccessPolicy(action, c).allowed).toBe(true);
    expect(evaluateAccessPolicy(action, { ...c, nowEpochSec: 1301 }).allowed).toBe(false);
  });
  it('s’applique à chaque action critique', () => {
    const cases: readonly (readonly [PermissionAction, RoleCode])[] = [
      ['INVOICE_CERTIFY_XHUB', 'COMMERCIAL_FACTURATION'],
      ['E2EE_REVOKE_CPA_GRANT', 'OWNER_GERANT'],
      ['PARTNER_APPROVE_RIB_CHANGE', 'DAF_TRESORIER'],
      ['PAYMENT_SIGN_PAIN001', 'DAF_TRESORIER'],
    ];
    for (const [a, role] of cases) {
      const stale = ctx({ role, mfaVerifiedAtEpochSec: NOW - 301, sodMakerActorId: 'other', sodRibModifierActorId: 'other-2' });
      expect(evaluateAccessPolicy(a, stale)).toMatchObject({ allowed: false, denialCode: 'ABAC_STEP_UP_MFA_REQUIRED' });
    }
  });
  it('ne l’exige pas pour une action non critique', () => {
    expect(evaluateAccessPolicy('PO_CREATE', ctx({ role: 'ACHATS_BUYER', mfaVerifiedAtEpochSec: undefined })).allowed).toBe(true);
  });
});

describe('SoD-01 commande / réception', () => {
  it('refuse le magasinier qui a émis le bon de commande', () => {
    const d = evaluateAccessPolicy('BL_CONFIRM_RECEIPT', ctx({ role: 'MAGASINIER_BL', sodMakerActorId: 'user-actor' }));
    expect(d).toMatchObject({ allowed: false, denialCode: 'SOD_01_ORDER_RECEIPT_CONFLICT' });
  });
  it('refuse si l’acteur figure parmi les autres intervenants du rapprochement', () => {
    const d = evaluateAccessPolicy(
      'BL_CONFIRM_RECEIPT',
      ctx({ role: 'MAGASINIER_BL', sodMakerActorId: 'buyer', sodPriorActorIds: ['x', 'user-actor'] }),
    );
    expect(d).toMatchObject({ allowed: false, denialCode: 'SOD_01_ORDER_RECEIPT_CONFLICT' });
  });
  it('accepte un acteur distinct', () => {
    expect(evaluateAccessPolicy('BL_CONFIRM_RECEIPT', ctx({ role: 'MAGASINIER_BL', sodMakerActorId: 'buyer' })).allowed).toBe(true);
  });
  it('refuse si l’émetteur du bon de commande n’est pas renseigné', () => {
    expect(evaluateAccessPolicy('BL_CONFIRM_RECEIPT', ctx({ role: 'MAGASINIER_BL' }))).toMatchObject({
      allowed: false,
      denialCode: 'SOD_MAKER_UNRESOLVED',
    });
  });
});

describe('SoD-02 double signature RIB', () => {
  it('refuse l’auteur de la modification qui approuve', () => {
    const d = evaluateAccessPolicy('PARTNER_APPROVE_RIB_CHANGE', ctx({ role: 'DAF_TRESORIER', sodMakerActorId: 'user-actor' }));
    expect(d).toMatchObject({ allowed: false, denialCode: 'SOD_02_RIB_DUAL_CONTROL' });
  });
  it('accepte un approbateur distinct avec Step-Up frais', () => {
    expect(evaluateAccessPolicy('PARTNER_APPROVE_RIB_CHANGE', ctx({ role: 'DAF_TRESORIER', sodMakerActorId: 'buyer' })).allowed).toBe(true);
  });
  it('refuse sans Step-Up frais même si l’approbateur est distinct', () => {
    const d = evaluateAccessPolicy(
      'PARTNER_APPROVE_RIB_CHANGE',
      ctx({ role: 'DAF_TRESORIER', sodMakerActorId: 'buyer', mfaVerifiedAtEpochSec: NOW - 400 }),
    );
    expect(d).toMatchObject({ allowed: false, denialCode: 'ABAC_STEP_UP_MFA_REQUIRED' });
  });
});

describe('SoD-03 préparation / signature pain.001 et RIB', () => {
  const sign = (o: Partial<AuthorizationContext>): AuthorizationContext =>
    ctx({ role: 'DAF_TRESORIER', sodMakerActorId: 'preparer', sodRibModifierActorId: 'rib-editor', ...o });

  it('refuse le préparateur du lot qui le signe', () => {
    expect(evaluateAccessPolicy('PAYMENT_SIGN_PAIN001', sign({ sodMakerActorId: 'user-actor' }))).toMatchObject({
      allowed: false,
      denialCode: 'SOD_03_PAIN001_PREPARE_SIGN_CONFLICT',
    });
  });
  it('refuse celui qui a modifié le RIB fournisseur du virement', () => {
    expect(evaluateAccessPolicy('PAYMENT_SIGN_PAIN001', sign({ sodRibModifierActorId: 'user-actor' }))).toMatchObject({
      allowed: false,
      denialCode: 'SOD_RIB_MODIFIER_CANNOT_APPROVE_PAYMENT',
    });
  });
  it('refuse le paiement tant que le RIB est en ALERTE_RIB_DAF', () => {
    expect(evaluateAccessPolicy('PAYMENT_SIGN_PAIN001', sign({ supplierRibStatus: 'ALERTE_RIB_DAF' }))).toMatchObject({
      allowed: false,
      denialCode: 'SOD_02_RIB_ALERT_PENDING',
    });
  });
  it('accepte avec acteurs distincts et RIB vérifié', () => {
    expect(evaluateAccessPolicy('PAYMENT_SIGN_PAIN001', sign({ supplierRibStatus: 'VERIFIED' })).allowed).toBe(true);
  });
  it('refuse si l’auteur du RIB n’est pas renseigné', () => {
    expect(evaluateAccessPolicy('PAYMENT_SIGN_PAIN001', sign({ sodRibModifierActorId: undefined }))).toMatchObject({
      allowed: false,
      denialCode: 'SOD_MAKER_UNRESOLVED',
    });
  });
});

describe('exception TPE mono-utilisateur', () => {
  const solo = (o: Partial<AuthorizationContext> = {}): AuthorizationContext =>
    ctx({
      role: 'OWNER_GERANT',
      orgPlanSegment: 'DIRECT_PME',
      activeHumanMembersCount: 1,
      sodMakerActorId: 'user-actor',
      sodRibModifierActorId: 'user-actor',
      ...o,
    });
  it('autorise l’auto-approbation et inscrit SINGLE_OWNER_SOD_WAIVER', () => {
    const d = evaluateAccessPolicy('PAYMENT_SIGN_PAIN001', solo());
    expect(d.allowed).toBe(true);
    expect(d.auditFlags).toContain('SINGLE_OWNER_SOD_WAIVER');
  });
  it('exige un Step-Up frais pour la dispense', () => {
    const d = evaluateAccessPolicy('BL_CONFIRM_RECEIPT', solo({ mfaVerifiedAtEpochSec: NOW - 301 }));
    expect(d).toMatchObject({ allowed: false, denialCode: 'ABAC_STEP_UP_MFA_REQUIRED' });
  });
  it('est refusée avec deux membres actifs', () => {
    expect(evaluateAccessPolicy('PARTNER_APPROVE_RIB_CHANGE', solo({ activeHumanMembersCount: 2 })).allowed).toBe(false);
  });
  it('est refusée hors segment DIRECT_PME', () => {
    expect(evaluateAccessPolicy('PARTNER_APPROVE_RIB_CHANGE', solo({ orgPlanSegment: 'ENTERPRISE' })).allowed).toBe(false);
  });
  it('est refusée à un DAF', () => {
    expect(evaluateAccessPolicy('PARTNER_APPROVE_RIB_CHANGE', solo({ role: 'DAF_TRESORIER' })).allowed).toBe(false);
  });
  it('ne produit aucun drapeau quand aucune SoD n’est violée', () => {
    const d = evaluateAccessPolicy('PAYMENT_SIGN_PAIN001', solo({ sodMakerActorId: 'a', sodRibModifierActorId: 'b' }));
    expect(d.auditFlags).toEqual([]);
  });
});

describe('rôles techniques', () => {
  const technical = ['ERP_CONNECTOR_AGENT', 'AI_MCP_ACTOR'] as const;
  const humanOnly: readonly PermissionAction[] = [
    'INVOICE_CERTIFY_XHUB', 'PARTNER_APPROVE_RIB_CHANGE', 'PAYMENT_PREPARE_PAIN001', 'PAYMENT_SIGN_PAIN001',
    'LEDGER_POST_IMMUTABLE', 'PAYROLL_9421_READ_EXPORT', 'E2EE_REVOKE_CPA_GRANT', 'REVERSIBILITY_EXPORT_10Y',
    'POS_ENCASH_TICKET', 'POS_VIEW_EXPECTED_CASH', 'LEDGER_VISA_CYCLE',
  ];
  for (const role of technical) {
    it(`${role} n’a aucun accès aux actions humaines, même avec MFA et PII`, () => {
      for (const action of humanOnly) {
        const d = evaluateAccessPolicy(
          action,
          ctx({ role, canAccessPayrollPii: true, mcpScopes: ['mcp:draft'], sodMakerActorId: 'other', sodRibModifierActorId: 'other' }),
        );
        expect(d.allowed).toBe(false);
      }
    });
    it(`${role} est borné à un seul dossier`, () => {
      const d = evaluateAccessPolicy('INVOICE_CREATE_DRAFT', ctx({ role, assignedCompanyIds: ['co-1', 'co-2'], mcpScopes: ['mcp:draft'] }));
      expect(d).toMatchObject({ allowed: false, denialCode: 'ABAC_TECHNICAL_SINGLE_TENANT' });
    });
    it(`${role} n’obtient jamais la dispense SoD`, () => {
      const d = evaluateAccessPolicy(
        'INVOICE_CREATE_DRAFT',
        ctx({ role, orgPlanSegment: 'DIRECT_PME', activeHumanMembersCount: 1, mcpScopes: ['mcp:draft'] }),
      );
      expect(d.auditFlags).toEqual([]);
    });
  }
  it('ERP_CONNECTOR_AGENT crée brouillons de facture et d’écriture', () => {
    expect(evaluateAccessPolicy('LEDGER_SAVE_DRAFT', ctx({ role: 'ERP_CONNECTOR_AGENT' })).allowed).toBe(true);
  });
  it('ERP_CONNECTOR_AGENT ne peut pas écrire sur exercice clôturé', () => {
    expect(evaluateAccessPolicy('LEDGER_SAVE_DRAFT', ctx({ role: 'ERP_CONNECTOR_AGENT', fiscalYearClosed: true })).allowed).toBe(false);
  });
});

describe('AI_MCP_ACTOR borné (D-16)', () => {
  const ai = (o: Partial<AuthorizationContext> = {}): AuthorizationContext =>
    ctx({ role: 'AI_MCP_ACTOR', mcpScopes: ['mcp:draft'], ...o });

  it('dépose un brouillon avec la portée mcp:draft', () => {
    expect(evaluateAccessPolicy('INVOICE_CREATE_DRAFT', ai()).allowed).toBe(true);
  });
  it('est refusé sans portée mcp:draft', () => {
    expect(evaluateAccessPolicy('INVOICE_CREATE_DRAFT', ai({ mcpScopes: [] }))).toMatchObject({
      allowed: false,
      denialCode: 'MCP_SCOPE_MISSING',
    });
    expect(evaluateAccessPolicy('INVOICE_CREATE_DRAFT', ai({ mcpScopes: undefined })).allowed).toBe(false);
  });
  it('refuse toute portée qui ne serait pas mcp:draft', () => {
    expect(evaluateAccessPolicy('INVOICE_CREATE_DRAFT', ai({ mcpScopes: ['mcp:seal', 'mcp:transfer'] })).allowed).toBe(false);
  });
  it('refuse un outil dont les arguments portent un identifiant de dossier', () => {
    for (const key of ['tenant_id', 'companyId', 'X-Fisca-Company-Id', 'company.id']) {
      const d = evaluateAccessPolicy('INVOICE_CREATE_DRAFT', ai({ toolArgumentKeys: ['amount_cents', key] }));
      expect(d, key).toMatchObject({ allowed: false, denialCode: 'MCP_TENANT_ARGUMENT_FORBIDDEN' });
    }
  });
  it('accepte des arguments d’outil sans identifiant de dossier', () => {
    expect(evaluateAccessPolicy('INVOICE_CREATE_DRAFT', ai({ toolArgumentKeys: ['amount_cents', 'label'] })).allowed).toBe(true);
  });
  it('ne peut valider un RIB, signer un virement ni sceller le grand livre', () => {
    for (const action of ['PARTNER_APPROVE_RIB_CHANGE', 'PAYMENT_SIGN_PAIN001', 'PAYMENT_PREPARE_PAIN001', 'LEDGER_POST_IMMUTABLE'] as const) {
      expect(evaluateAccessPolicy(action, ai()).allowed).toBe(false);
    }
  });
});
