---
id_source: cmwegzl88023706adf92snrso
category: project_context
importance: 5
tags: ["fisca", "sessions", "agents", "branches", "fusion", "referentiel-v2"]
whenToUse: "Projet Fisca : quand on lance, briefe ou audite une session, quand un document cite un nom d'agent ou de branche qui ne correspond pas à l'existant, ou quand une règle de dépendance, de statut ou de fusion est en question."
date_creation: 2026-11-13T04:21:45Z
date_maj: 2026-11-13T06:41:11Z
titre: "Référentiel v2 : sessions, agents réels, branches, fusion"
---
# Référentiel v2 : sessions, agents réels, branches, fusion

## Contenu intégral (inchangé)

Projet Fisca, référentiel v2 du 2026-11-13 : les documents de spécification nomment les agents Fisca-Backend-Core-Builder, Fisca-EDI-ERP-Specialist et Fisca-Frontend-POS-Builder ; les agents réels sont Fisca-Core-Backend-Fiscal, Fisca-Containers-EDI-ERP et Fisca-Frontend-Mobile-Growth. L'usine compte 17 sessions et 132 tickets (S0, S1A, S1B, G1, P2-A/B/C, G2, P3-A/B/C, G3, P4-A/B/C, G4, S5). Écarts validés : S0 sur feat/w0-foundation (pas feat/w0-bootstrap) ; S5 sur feat/w5-release-v1.0.0 (pas release/v1.0.0) ; les branches audit/gate-N sont locales à l'auditeur ; l'auditeur est en lecture seule sur GitHub, ne délègue rien et termine son rapport par la ligne VERDICT, que Fisca-Lead-Orchestrator (le pilote) lit avant de fusionner lui-même ; P4-C est construit par Fisca-Core-Backend-Fiscal ; un refus d'audit remet le ticket à TODO avec review_notes (pas de statut CHANGES_REQUESTED) ; S1B est une branche empilée sur celle de S1A ; une dépendance est satisfaite si elle est DONE, ou IN_REVIEW avec son commit dans la branche. L'ancienne « cartographie des 6 vagues » est périmée.
