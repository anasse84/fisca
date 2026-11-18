---
id_source: cmwelyx5e02j107ad4lsvws99
category: project_context
importance: 5
tags: ["fisca", "depot", "referentiel-v2.1", "annexe-v", "pilotage-automatique"]
whenToUse: "Projet Fisca : pour situer l'avancement du dépôt (vagues fusionnées, sha de main, compteur de tickets), retrouver où reprendre le pilotage ou le code de vérification des spécifications ; toujours revérifier dans git avant d'agir."
date_creation: 2026-11-13T06:41:12Z
date_maj: 2026-11-15T01:40:24Z
titre: "État du dépôt au 2026-11-15 (vagues 0-2 fusionnées, pilotage arrêté)"
---
# État du dépôt au 2026-11-15 (vagues 0-2 fusionnées, pilotage arrêté)

## Contenu intégral (inchangé)

Fisca — état du dépôt au 2026-11-15 (ERRATA révision e). `anasse84/fisca`, `main` à `0dfd3cc`. Vagues 0, 1 et 2 terminées, auditées (pont S0, G1, G2 favorables, G1 et G2 au tour 2) et fusionnées par commit de fusion : 66 tickets sur 132 DONE. PR : n° 1 à 3 (spécifications, ERRATA, pilotage), n° 4 (S0), n° 5 (S1A), n° 9 puis 11 (S1B), n° 6, 7, 8, 10, 12, 15, 16, 18 (correctifs et jonctions), n° 17, 13, 14 (vague 2 : P2-A, P2-B, P2-C), n° 19 à 25 (jonctions et décisions : tsconfig, test:xsd, bootstrap playwright, visa du gérant, ERRATA D-23, test TVA 34551/34552, tests adverses Merkle), n° 26 (alignement de la documentation). Le pilotage est ARRÊTÉ sur consigne du propriétaire : la vague 3 et le ticket de jonction J2 ne démarrent que sur son autorisation expresse. Reprise : lire `docs/orchestration/prerequis-proprietaire.md` et `preparation-vague-3.md`, puis message `CONTINUE` avec la décision. Les Annexes V des documents 03, 10, 12, 13, 14, 17 et 18 restent réexécutables par `python3 docs/specs/verification/verify-annexes.py` (13 blocs identiques). `pnpm verify:gate` est défini par `scripts/verify-gate.sh` (à valider à G3). Le dépôt prime sur les skills ; l'état courant se relit dans git et dans FISCA_STATE_AND_HANDOFF (section 01).
