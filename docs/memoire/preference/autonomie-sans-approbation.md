---
id_source: cmwfnxvs001bg07ad06hwyn4v
category: preference
importance: 4
tags: ["fisca", "autonomy", "approval", "delegation", "access-policy"]
whenToUse: "When creating or editing Fisca agents, their delegation settings, access policies, schedules or execution mode, or when deciding whether an action should wait for user approval."
date_creation: 2026-11-14T00:24:09Z
titre: "Autonomie complète des agents de l'usine, limites de sécurité"
---
# Autonomie complète des agents de l'usine, limites de sécurité

> Remarque d'export : la partie « pas d'approbation » décrit la politique d'accès Hyperagent ; les limites dures (pas de merge sur main hors orchestrateur, pas de force-push, pas de suppression de dépôt, auditeur en lecture seule) restent valables.

## Contenu intégral (inchangé)

For the Fisca software-factory agents (Fisca-Lead-Orchestrator, Backend, Containers-EDI-ERP, Frontend, QA-Auditor, Wiki-Curator), the user wants fully autonomous operation with no approval from them: no handoff approvals and no write approvals. Hard safety limits still apply: no merge to main except by the orchestrator, no force-push, no repository deletion, and the auditor stays read-only.
