/**
 * Port `MandateResolver` (ticket T-S1B-12, décision du pilote n° 1).
 *
 * Le TenantRouter ne résout que l'appartenance DIRECTE (`organization_memberships` du plan de contrôle, port
 * `MembershipResolver`). Le mandat d'un cabinet OEC sur le dossier d'un client (Doc_04 § 04 : « mandat actif du cabinet OEC
 * dans tenant_key_grants ») passe par ce port distinct. Échec fermé : sans résolveur de mandat, tout accès qui n'est pas une
 * appartenance directe est refusé (même réponse 403 que « dossier inconnu », aucune énumération).
 *
 * Question ouverte (voir le rapport) : où vit la source de vérité des mandats actifs lisible par le Worker : miroir des mandats
 * actifs dans le plan de contrôle, ou autre ? Le port n'impose aucune réponse.
 */
import type { RoleCode } from '@fisca/auth-rbac';

export interface MandateAccess {
  /** Organisation propriétaire du dossier (le client), dont dépend l'abonnement. */
  readonly organizationId: string;
  /** Rôle que le mandat confère sur ce dossier. */
  readonly role: RoleCode;
  /** `subscriptions.plan_code` de l'organisation propriétaire du dossier. */
  readonly planCode: string;
}

export interface MandateResolver {
  /** Mandat ACTIF (révoqué ou expiré exclu) de l'utilisateur sur le dossier ; null sinon, que le dossier existe ou non. */
  resolveMandate(query: { readonly userId: string; readonly companyId: string }): Promise<MandateAccess | null>;
}
