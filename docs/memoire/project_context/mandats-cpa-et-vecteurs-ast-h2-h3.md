---
id_source: cmwfl13ma006808ad22ipfwsy
category: project_context
importance: 4
tags: ["fisca", "mandats", "company_cpa_mandates", "ast", "tenant-router", "decision-proprietaire"]
whenToUse: "Projet Fisca : routage des tenants et mandats de cabinet OEC, schémas db-schema, règles AST du moteur fiscal et leurs vecteurs de test."
date_creation: 2026-11-13T23:02:40Z
titre: "Décisions propriétaire H2/H3 : company_cpa_mandates, vecteurs AST"
---
# Décisions propriétaire H2/H3 : company_cpa_mandates, vecteurs AST

## Contenu intégral (inchangé)

Projet Fisca — décisions du propriétaire du 2026-11-13 (H2, H3). (H2) Les mandats des cabinets fiduciaires vivent dans la table company_cpa_mandates de CONTROL_PLANE_DB. Le nom company_external_mandates est abandonné. Colonnes : mandate_id, company_id, fiduciary_org_id, status ACTIVE/REVOKED, max_delegated_role (EXPERT_COMPTABLE_OEC, CHEF_MISSION, AIDE_COMPTABLE, AUDITEUR_CAC_DGI), can_access_payroll_pii 0/1, scoped_user_ids_json, granted_by_user_id, granted_at, revoked_at. Contrainte UNIQUE(company_id, fiduciary_org_id). Le rôle effectif est le plus restrictif entre celui du cabinet et max_delegated_role. (H3) Les trois cas contradictoires de chaque règle AST s'appellent POSITIVE_NOMINAL, NEGATIVE_COUNTEREXAMPLE et BOUNDARY_LIMIT.
