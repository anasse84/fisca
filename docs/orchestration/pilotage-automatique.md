# Pilotage automatique de l'usine Fisca (2026-11-13)

Un seul message du propriétaire lance la construction des vagues 0 à 4 (128 tickets), barrières et fusions comprises. Ce fichier est la procédure du **pilote** : Fisca-Lead-Orchestrator, dans le fil où le propriétaire a tapé le message de lancement. Il prime sur les skills s'ils diffèrent. Les raisons sont dans `docs/specs/ERRATA.md` (B-15).

## 1. Principe

- **Un pilote, des voies.** Le pilote ne construit que S0 et sa part de S5. Tout le reste est confié à des **voies** : un fil Hyperagent par voie, ouvert une fois par le pilote, puis réutilisé d'une session à l'autre (le clone et l'accord npm y restent).
- **Le pilote relance.** Une voie ne peut ni programmer de rappel ni ouvrir de fil (plafond de délégation : un fil ouvert par un autre fil ne délègue plus). Quand son tour s'achève, c'est le pilote qui lui envoie le message de relais.
- **L'état est dans les tables et dans git, jamais dans la mémoire du pilote.** À chaque **tick**, le pilote relit `fisca_master_backlog`, demande à `pilot-status.mjs` ce qu'il faut faire, et exécute les actions imprimées. Un tick peut être rejoué sans risque.
- **Le pilote ne décide pas l'ordre.** `docs/orchestration/reference/pilot-status.mjs` le calcule (14 tests, dont une simulation complète des 132 tickets : `node --test docs/orchestration/reference/pilot-status.test.mjs`).

## 2. Voies

| Voie | Agent | Sessions |
|---|---|---|
| **PILOTE** | Fisca-Lead-Orchestrator | S0, part de S5 (T-S5-01, T-S5-03) |
| **BACK-1** | Fisca-Core-Backend-Fiscal | S1A, S1B, P3-B, P4-B |
| **BACK-2** | Fisca-Core-Backend-Fiscal | P4-C |
| **EDI-1** | Fisca-Containers-EDI-ERP | P2-A, P3-A |
| **EDI-2** | Fisca-Containers-EDI-ERP | P3-C |
| **FRONT-1** | Fisca-Frontend-Mobile-Growth | P2-B, P4-A |
| **FRONT-2** | Fisca-Frontend-Mobile-Growth | P2-C |
| **AUDIT** | Fisca-QA-Security-Auditor | pont S0, G1 à G4, part de S5 (T-S5-02, T-S5-04) |

La répartition se lit dans `.meta/session-scopes.json` (`lanes`, et `lane` de chaque session). Deux sessions parallèles du même agent ont chacune leur voie.

## 3. Amorçage (premier tour, une seule fois)

1. Accès npm du fil pilote : `curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/zod`. Si ce n'est pas 200 : RequestNetworkAccess pour `registry.npmjs.org`.
2. Clone du dépôt par le skill `fisca-github-repo-access`, sur `origin/main`. Vérifie `node --test docs/orchestration/reference/pilot-status.test.mjs` (tout vert), puis lis `docs/specs/ERRATA.md`.
3. Ouvre les 7 voies tout de suite, pour que le propriétaire donne tous les accords npm en une seule fois : un CreateAgentThread par voie (waitSeconds 0), avec le message de préparation ci-dessous. Note chaque identifiant de fil dans `02_Active_Branches_And_Scopes`, bloc « Voies » (une ligne par voie : nom, agent, identifiant du fil).

```text
PRÉPARATION DE LA VOIE <VOIE> — projet Fisca, dépôt anasse84/fisca. Ce fil servira aux sessions <liste>.
Aucun ticket pour l'instant, aucune écriture dans les tables ni dans le dépôt.
1. Teste npm : curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/zod. Si ce n'est pas 200,
   appelle RequestNetworkAccess pour registry.npmjs.org et attends l'accord du propriétaire.
2. Clone le dépôt par le skill fisca-github-repo-access et lis docs/specs/ERRATA.md et
   docs/orchestration/protocole-boucle.md.
3. Réponds par une seule ligne : « VOIE <VOIE> PRÊTE » (npm 200 et clone faits), ou « VOIE <VOIE> ATTENTE-NPM ».
Ce fil est piloté : tu n'y programmes aucun rappel et tu n'ouvres aucun autre fil.
```

4. Si l'outil de rappel est appelable sur ce tour, pose l'échelle de rappels (section 6).
5. Passe au premier tick.

## 4. Le tick

```bash
# 1. Backlog : appelle GetTable (mode full) sur fisca_master_backlog et enregistre le résultat tel quel
#    dans /agent/workspace/backlog.json (si le résultat a été écrit dans un fichier, donne ce chemin).
# 2. Branches réellement fusionnées (la vérité vient de git, pas des statuts) :
git fetch --prune origin   # par le skill fisca-github-repo-access
MERGED=$(git branch -r --merged origin/main | sed 's# *origin/##' | grep '^feat/' | paste -sd, -)
# 3. Plan :
node docs/orchestration/reference/pilot-status.mjs --backlog /agent/workspace/backlog.json \
  --scopes .meta/session-scopes.json --merged-branches "$MERGED" \
  --running "<sessions dont la voie travaille encore>" --completed "<sessions dont la voie vient de finir un tour>" \
  --state /agent/workspace/.fisca-pilot-state.json   # ajoute --s5 seulement si le lancement dit RELEASE S5 : OUI
```

- `--running` : pour chaque voie à qui tu as envoyé un message, WaitForAgentThread (1 seconde) dit si elle travaille encore. Une voie qui a répondu `ATTENTE-NPM` compte comme en cours : elle reprendra seule dès l'accord du propriétaire.
- `--completed` : ne cite une session qu'une fois, au tick qui suit la fin de son tour. C'est ce qui permet de détecter une voie qui tourne sans avancer.
- Avant chaque tick, remets ton clone sur `origin/main` à jour (`git checkout main && git merge --ff-only origin/main`) : le script et la matrice se lisent toujours sur `main`.

Exécute ensuite chaque ligne `ACTION`, dans l'ordre :

| Action | Ce que fait le pilote |
|---|---|
| `PILOT_SESSION session=S0` | Construit S0 dans ce fil avec `protocole-boucle.md` (mode orchestrateur, un ticket par sous-agent). Après la clôture de S0 : nouveau tick. |
| `DISPATCH session=… lane=…` | Envoie à la voie le bloc `MESSAGE POUR LA VOIE`, tel quel : SendThreadMessage vers le fil de la voie (CreateAgentThread si la voie n'a pas encore de fil, puis note son identifiant). |
| `GATE gate=…` | Envoie le bloc `MESSAGE POUR LA VOIE AUDIT` au fil de la voie AUDIT. |
| `MERGE gate=… branches=…` | Vérifie le verdict favorable daté dans `05_QA_Gate_Verdicts`, puis applique la procédure de fusion (`README.md` § 5) aux branches listées, dans l'ordre. Ensuite : tickets de la barrière à `DONE`, section `01_Current_Wave_Status`, nouveau tick. |
| `UNBLOCK tickets=…` | Applique la section 5 à chaque ticket. |
| `PILOT_TICKET` / `AUDIT_TICKET` | Release S5, ticket par ticket : le tien dans ce fil, celui de l'auditeur par message à la voie AUDIT (scénarios dans `barrieres-qa.md` § 6). |
| `WAIT` | Rien à envoyer : attends une voie (ci-dessous). |
| `STOP_OWNER reason=…` | Section 7. |
| `COMPLETE` | Rapport final (section 7). |

**Attendre.** Après les envois, attends les voies avec WaitForAgentThread, par appels répétés, tant que ton tour a moins de 40 minutes (`date +%s` noté au début du tour). Dès qu'une voie rend son tour, lis sa dernière ligne (`ETAT …` ou `VERDICT …`) et fais un nouveau tick en la citant dans `--completed`. À 40 minutes : complète l'échelle de rappels si l'outil est appelable, écris l'état dans `01_Current_Wave_Status`, et termine ton tour par la ligne `ETAT PILOTE` (section 7). Le tour suivant commence par un tick.

**Ne fais jamais à la place d'une voie.** Si une voie échoue, relance-la ou arrête-toi ; ne code pas ses tickets et ne modifie pas ses verdicts.

## 5. Tickets `BLOCKED`

Lis l'entrée du ticket dans `04_Circuit_Breaker_Blockers`, puis :

| Cause | Décision du pilote |
|---|---|
| `SEAM_REQUEST` (besoin d'un fichier de jonction hors périmètre) | Fais le changement toi-même, en mode orchestrateur, sur une branche `fix/seam-<task_id>` depuis `origin/main` ; `pnpm verify:fast` vert ; Pull Request ; fusion. Puis ticket à `TODO`, `retry_count` 0, et dans `review_notes` : « jonction livrée sur main (PR n° …) : fusionne origin/main dans ta branche ». |
| `SPEC_AMBIGUITY` tranchée par `ERRATA.md` | Ticket à `TODO`, `retry_count` 0, avec la référence de l'errata dans `review_notes`. |
| Schéma officiel DGI ou xHub absent | Ce n'est pas un blocage (ERRATA B-13) : ticket à `TODO` avec le rappel du régime provisoire. |
| Trois échecs de vérification | Une seule réouverture automatique par ticket : lis la trace, écris dans `review_notes` une piste précise précédée de `[RÉOUVERT-PILOTE]`, ticket à `TODO`, `retry_count` 0. Si le ticket porte déjà cette marque : décision du propriétaire. |
| `MAIN_RED` | Répare `main` toi-même par une Pull Request `fix/main-red-<date>` en mode orchestrateur, puis relance les voies. |
| Secret, accès, permission, ou ambiguïté que l'errata ne tranche pas | Décision du propriétaire : laisse le ticket `BLOCKED`, ajoute la question précise à la liste « À trancher » de `01_Current_Wave_Status`. Les autres tickets continuent. |

## 6. Continuité du pilote

Le pilote reprend de trois façons, de la plus automatique à la plus manuelle. Toutes mènent au même tick.

1. **Dans le tour** : l'attente de la section 4.
2. **Rappels programmés** : quand l'outil de rappel est appelable (c'est le cas sur un tour ouvert par un message du propriétaire), garde une échelle de rappels dans ce fil : dans 1 h, 2 h, 3 h, 4 h, 6 h, 8 h, 12 h, 16 h, 20 h et 24 h (10 au plus), tous avec la note « TICK PILOTE FISCA : reprends docs/orchestration/pilotage-automatique.md à la section 4. ». À chaque tour où l'outil est appelable, annule les rappels en attente et repose l'échelle entière. S'il n'est pas appelable, n'insiste pas.
3. **Message du propriétaire** : le mot `CONTINUE` dans ce fil relance un tick et repose l'échelle.

Ne crée ni Schedule ni mode Live pour le pilotage : leurs exécutions sont limitées en écriture.

## 7. Arrêts et comptes rendus

- **Ligne de fin de tour** : `ETAT PILOTE : <n>/132 DONE — vague <w> — voies en cours : <liste> — à trancher : <k>`.
- **`STOP_OWNER`** : écris dans `01_Current_Wave_Status` la raison, l'état de chaque session et la liste « À trancher », puis réponds au propriétaire en trois parties : ce qui est fait, ce qui bloque (question précise, ticket, trace), ce qu'il doit faire. Raisons possibles : `SESSION_STALLED` (3 tours de voie sans changement d'état), `GATE_NOT_CONVERGING` (3 tours d'audit sans verdict favorable), `BACKLOG_INCOHERENT`, `NO_ACTION` (il ne reste que des tickets à trancher), `READY_FOR_S5`.
- **`READY_FOR_S5`** : les vagues 0 à 4 sont fusionnées. La release S5 déploie en pré-production sur le compte Cloudflare du propriétaire : elle ne part que si le lancement dit `RELEASE S5 : OUI`. Le tag `v1.0.0` reste dans tous les cas une décision du propriétaire.
- **Jamais** : fusion sans verdict favorable daté, force-push, écriture directe sur `main`, modification d'un verdict ou d'un score, déblocage d'un ticket qui attend un secret.

## 8. Message de lancement (propriétaire → Fisca-Lead-Orchestrator)

```text
PILOTAGE AUTOMATIQUE FISCA — DÉMARRAGE.
Tu es le pilote. Clone anasse84/fisca (skill fisca-github-repo-access) et applique
docs/orchestration/pilotage-automatique.md de la section 3 à la fin, sans t'arrêter entre deux actions.
Ce fichier et docs/specs/ERRATA.md priment sur tes skills s'ils diffèrent.
RELEASE S5 : NON.
Ne me réponds qu'à un arrêt STOP_OWNER, à la fin (COMPLETE), ou par la ligne ETAT PILOTE en fin de tour.
```

Pour reprendre après un arrêt ou une longue pause : `CONTINUE`.
