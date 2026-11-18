# 10 — Prompts pour construire automatiquement de la vague 3 jusqu'à la fin

**Avant tout** : M0 à M8 terminés (`03`), prérequis 🔴 de `04` levés, pilote non lancé. Ces prompts valent **autorisation expresse** : en les lançant, tu autorises J2 et la vague 3 (et la vague 4 pour L1). Ne les lance pas avant d'être prêt.

## L0 — Contrôle avant lancement (à passer d'abord, dans `agy`, agent orchestrateur)
```text
CONTRÔLE AVANT LANCEMENT — ne démarre aucune voie. Vérifie et réponds par un tableau OK/KO avec la preuve : (1) git : clone principal sur main, à jour avec origin/main, `git rev-parse origin/main` ; (2) `pnpm verify:fast` exit 0 (sortie dans un fichier, code lu avant tout filtre) ; (3) `pnpm verify:gate` : parties disponibles sur cette machine (Java 21, Docker) ; (4) `node --test docs/orchestration/reference/pilot-status.test.mjs` vert ; (5) `node ops/antigravity/backlog.mjs count` = 66 DONE sur 132 ; (6) `bash ops/antigravity/pilot-tick.sh` imprime un plan (sans lancer) ; (7) `agy models` et `/usage` : modèle du pilote, des voies, de l'auditeur, quota restant ; (8) variables d'environnement présentes (noms seulement) : GITHUB via gh auth status, CLOUDFLARE_* (facultatif avant la vague 4) ; (9) docs/reference/dgi/ : liste des documents déposés ou « absents → XSD provisoires » ; (10) liste « À trancher » de docs/state section 01 avec, pour chaque point, bloquant ou non. Conclus : PRÊT ou NON PRÊT et la liste des actions du propriétaire.
```

## L1 — Lancement automatique : J2 → vague 3 → G3 → vague 4 → G4 (s'arrête avant S5)
À coller **dans le premier tour du pilote** ; ensuite la boucle prend le relais. Mise en route :

```bash
cd ~/fisca-factory/fisca
mkdir -p ~/.fisca-runtime/briefs
cat > ~/.fisca-runtime/LAUNCH.md <<'LAUNCH'
LANCEMENT AUTOMATIQUE FISCA — <date du jour>
AUTORISATIONS DU PROPRIÉTAIRE : J2 AUTORISÉ : OUI. VAGUE 3 AUTORISÉE : OUI. VAGUE 4 AUTORISÉE : OUI. RELEASE S5 : NON.
DÉCISIONS : jeu de 61 comptes ; une base D1 par société (API REST de D1 derrière createD1TenantDriver, spike avant câblage de production, repli en ports).
LAUNCH
tmux new -d -s fisca-pilot 'cd ~/fisca-factory/fisca && bash ops/antigravity/pilot-loop.sh 8'
```

Le premier tour exécute ce prompt d'amorçage (à placer dans `ops/antigravity/prompts/amorcage.md`, passé une fois par `agy -p "$(cat …)" --agent fisca-lead-orchestrator`) :

```text
AMORÇAGE DU PILOTAGE AUTOMATIQUE FISCA (Antigravity). Tu es Fisca-Lead-Orchestrator. Lis ~/.fisca-runtime/LAUNCH.md : ce sont les seules autorisations en vigueur. Lis aussi AGENTS.md, docs/specs/ERRATA.md, docs/orchestration/pilotage-automatique.md, docs/antigravity/09-orchestration-parallele.md, docs/orchestration/prerequis-proprietaire.md, preparation-vague-3.md et preparation-vague-4.md.
1. Inscris les décisions du LAUNCH dans docs/specs/ERRATA.md (D-25, source : propriétaire, RECOUPÉ) par une PR fix/errata-owner-<date> que tu fusionnes (commit de fusion, expectedHeadSha de 40 caractères).
2. Crée dans le backlog le ticket de jonction J2 (session J2, branche fix/w2-junctions, voie BACK-1, agent fisca-core-backend-fiscal, depends_on : G2) avec pour critères d'acceptation, dans review_notes : migration v12 (EN_ATTENTE_XHUB et ECHEC_TECHNIQUE_XHUB dans clearance_state) ; ESC_POS_TCP_IP dans pos_paired_peripherals ; InvoiceSequencerDO aligné sur la genèse de 45 caractères (sealInvoiceHash puis public_invoice_index en deux temps) ; SEAM_REQUESTS de P2-A (ré-export DgiClearanceWorkflow, env.resolveClearancePorts, file fisca-xhub-clearance) ; chiffrement des réponses d'idempotence (réserve avant G3) ; permission EDI_EXPORT ; amorce du plan comptable avec vat_regime_role ; mise à jour du registre des contrats. Fais dépendre P3-A, P3-B et P3-C de J2 dans pilot-status (ajoute J2 à .meta/session-scopes.json par PR fix/ si nécessaire, avec ses tests).
3. Lance `bash ops/antigravity/pilot-tick.sh` et exécute les ACTION. Pour chaque DISPATCH, écris le brief autosuffisant (task_id, session, objectif, chemins des spécifications dans docs/specs/ selon la matrice des sessions du référentiel v2 du 2026-11-13 plus ERRATA.md, critères d'acceptation, contrats du registre à livrer sous leur nom exact, branche et tête attendues). Ne démarre aucune vague avant que la barrière de la précédente soit fusionnée.
4. Avant de lancer P3-B : le brief impose le durcissement de EphemeralRamPiiScrubber et du filtre d'injection (réserves de G2). Avant G4 : expected_closing_cash_cents selon la décision du propriétaire ou réserve consignée, largeur 1024 px à capturer.
5. Termine par la ligne ETAT PILOTE. Ne pose aucune question au propriétaire sauf STOP_OWNER.
```

Ensuite le pilote suit `tick.md` à chaque tour : il s'arrête sur `STOP_OWNER` (point bloquant, avec la raison et ce qu'il faut fournir) ou après la fusion de G4 (`READY_FOR_S5`).

## L2 — Reprise après un arrêt `STOP_OWNER`
```text
REPRISE. Le propriétaire a traité : <liste précise : fichiers déposés avec chemins, variables d'environnement définies (noms), décisions avec leur texte>. Intègre ces éléments (ERRATA par PR fix/errata-owner-<date> si ce sont des décisions), débloque les tickets BLOCKED concernés dans le backlog, relance les voies à l'arrêt, puis fais un tick complet. Termine par ETAT PILOTE.
```
Puis : `rm ~/.fisca-runtime/STOP; tmux new -d -s fisca-pilot 'bash ops/antigravity/pilot-loop.sh 8'`.

## L3 — Release S5 (à ne lancer qu'avec les prérequis 🔴 de la section C et D de `04`)
```bash
cat > ~/.fisca-runtime/LAUNCH.md <<'LAUNCH'
AUTORISATIONS DU PROPRIÉTAIRE : VAGUE 4 FUSIONNÉE. RELEASE S5 : OUI.
Pré-production : Cloudflare (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID présents dans l'environnement), comptes réels listés dans docs/antigravity/04 section C présents ; relecture de l'expert-comptable : <date> ; tag v1.0.0 signé par le propriétaire localement.
LAUNCH
tmux new -d -s fisca-pilot 'cd ~/fisca-factory/fisca && bash ops/antigravity/pilot-loop.sh 8'
```
Le pilote ajoute `--s5` à `pilot-tick.sh`, exécute T-S5-01 à T-S5-04 (voie AUDIT pour 02 et 04), n'écrit jamais « conforme DGI » (régime B-13 : « Validation simulée »), et ne pose pas le tag : il prépare la release, tu la signes.

## L4 — Variante « tout d'un coup » avec S5 (si tu assumes les prérequis)
Mets `RELEASE S5 : OUI` dès le premier LAUNCH. Le pilote bloquera sur `STOP_OWNER` à chaque secret ou compte manquant ; ne fournis les accès réels qu'en vérifiant le périmètre : un agent ne doit jamais déployer en production de lui-même (staging seulement, `fisca-staging-`).

## Suivi sans perturber
`tmux attach -t fisca-pilot` ; `bash ops/antigravity/lanes-status.sh` ; `node ops/antigravity/backlog.mjs count` ; `tail ~/.fisca-runtime/tick/*.md | less`.
