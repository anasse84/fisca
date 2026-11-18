---
id_source: cmwemxq8p028f07adlb1en630
category: project_context
importance: 4
tags: ["fisca", "pilotage", "preseance", "errata", "orchestration"]
whenToUse: "Projet Fisca : au lancement ou à la reprise du pilotage automatique, et quand un skill Fisca contredit un document de docs/orchestration/ ou ERRATA.md."
date_creation: 2026-11-13T07:08:16Z
titre: "Préséance dépôt > skills ; lancement du pilotage automatique"
---
# Préséance dépôt > skills ; lancement du pilotage automatique

## Contenu intégral (inchangé)

Projet Fisca : quand docs/orchestration/pilotage-automatique.md ou docs/specs/ERRATA.md (sur main) diffèrent des skills fisca-factory-runbook ou fisca-harness-gatekeeper, ces fichiers du dépôt priment. Le pilotage automatique se lance par le message « PILOTAGE AUTOMATIQUE FISCA — DÉMARRAGE » adressé à Fisca-Lead-Orchestrator, qui devient le pilote des voies. Il se relance par « CONTINUE ».
