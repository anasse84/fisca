---
id_source: cmwegzlox02il07ad2y9nb0vc
category: tools_and_workflows
importance: 5
tags: ["fisca", "hyperagent", "boucle-autonome", "sous-agent", "sandbox", "schedule", "tables"]
whenToUse: "Projet Fisca : quand on conçoit ou dépanne une boucle de codage autonome, un relais, une délégation, une écriture de table depuis un autre fil, ou l'installation d'outils dans le bac à sable."
date_creation: 2026-11-13T04:21:46Z
date_maj: 2026-11-13T06:40:43Z
titre: "Mécanique d'exécution Hyperagent (spawn depth, voies, VERDICT, fusion vérifiée dans git)"
applicabilite: non applicable à Antigravity
---
# Mécanique d'exécution Hyperagent (spawn depth, voies, VERDICT, fusion vérifiée dans git)

> **Non applicable à Antigravity** — mémoire propre à Hyperagent, conservée pour historique uniquement. Ne pas appliquer ces règles.

## Contenu intégral (inchangé)

Fisca — mécanique d'exécution vérifiée sur Hyperagent (essais du 2026-11-13). Un fil ouvert par un autre fil ne peut ni ouvrir de fil (« Spawn depth cap reached ») ni programmer de rappel ; l'auditeur ne voit pas l'orchestrateur parmi ses agents appelables. Donc : Fisca-Lead-Orchestrator pilote depuis un fil ouvert par le propriétaire (`docs/orchestration/pilotage-automatique.md`, ERRATA B-15), ouvre 7 voies (BACK-1, BACK-2, EDI-1, EDI-2, FRONT-1, FRONT-2, AUDIT), les relance par SendThreadMessage à chaque fin de tour, lit la ligne VERDICT de l'auditeur et fusionne lui-même. L'ordre des actions est calculé par `docs/orchestration/reference/pilot-status.mjs` (14 tests, simulation des 132 tickets). Dans un fil : contexte neuf par sous-agent `task` (même système de fichiers, même filtre réseau, vérifié) ; fichiers et accord npm persistants d'un tour à l'autre ; un tour délégué dure environ une heure (« Run time limit » réglable dans les limites de l'agent). La fusion se constate dans git (branches ancêtres de origin/main, B-16), jamais par le seul statut des tickets.
