---
name: fisca-factory-runbook
description: Guide d'exécution de l'usine logicielle Fisca : pilotage automatique (un pilote, 7 voies), matrice des 17 sessions et 132 tickets, périmètres d'écriture, messages de lancement, procédure de barrière QA et de fusion. À utiliser pour lancer, piloter, auditer ou fusionner une session.
---

# fisca-factory-runbook — guide d'exécution de l'usine (v2.1, 2026-11-13)

Le même contenu est dans `docs/orchestration/` du dépôt (`README.md`, `pilotage-automatique.md`, `barrieres-qa.md`), qui prime s'il diffère. La méthode de travail d'une session est dans le skill `fisca-harness-gatekeeper` ; les corrections et arbitrages dans `fisca-spec-errata-and-arbitrages` et `docs/specs/ERRATA.md`.

## 0. Pilotage automatique (lancement unique)

- **Un pilote, des voies.** Fisca-Lead-Orchestrator pilote depuis le fil où le propriétaire a tapé le message de lancement. Il ne construit que S0 et sa part de S5. Tout le reste part dans des voies : un fil par voie, ouvert une fois par le pilote, réutilisé d'une session à l'autre (le clone et l'accord npm y restent).
- **Pourquoi.** Un fil ouvert par un autre fil ne peut ni ouvrir de fil ni programmer de rappel (constat d'essai, ERRATA B-15). Une voie ne se relance donc pas seule, et l'auditeur ne peut pas demander la fusion : le pilote relance chaque voie à la fin de son tour, lit la ligne `VERDICT` de l'auditeur et fusionne lui-même.
- **Voies.** PILOTE (S0, T-S5-01, T-S5-03) ; BACK-1 (S1A, S1B, P3-B, P4-B) et BACK-2 (P4-C) : Fisca-Core-Backend-Fiscal ; EDI-1 (P2-A, P3-A) et EDI-2 (P3-C) : Fisca-Containers-EDI-ERP ; FRONT-1 (P2-B, P4-A) et FRONT-2 (P2-C) : Fisca-Frontend-Mobile-Growth ; AUDIT (pont S0, G1 à G4, T-S5-02, T-S5-04) : Fisca-QA-Security-Auditor.
- **Le tick.** À chaque tour, le pilote relit `ops/state/backlog.json`, calcule les branches fusionnées avec git, lance `node docs/orchestration/reference/pilot-status.mjs` et exécute les lignes `ACTION` imprimées (`PILOT_SESSION`, `DISPATCH`, `GATE`, `MERGE`, `UNBLOCK`, `WAIT`, `STOP_OWNER`, `COMPLETE`). Le script imprime aussi le message exact à envoyer à chaque voie. Il ne décide jamais l'ordre de tête.
- **Procédure complète.** `docs/orchestration/pilotage-automatique.md` (attaché à ce skill, dans `scripts/`) : amorçage, tick, tickets `BLOCKED`, continuité du pilote (attente dans le tour, échelle de rappels, mot `CONTINUE`), arrêts. Lis-la en entier avant de piloter.
- **Arrêt avant S5.** Après la fusion de G4, le pilote s'arrête (`READY_FOR_S5`) sauf si le lancement dit `RELEASE S5 : OUI`. Le propriétaire peut aussi donner ce feu vert plus tard, en écrivant `CONTINUE. RELEASE S5 : OUI` dans le fil du pilote : le pilote relance alors le script avec `--s5`. Le tag `v1.0.0` reste une décision du propriétaire.

## 1. Matrice des sessions (132 tickets)

| Session | Vague | Voie | Agent | Branche | Base | Tickets | Rubrics | Spécifications (docs/specs/) | Préalable |
|---|---|---|---|---|---|---|---|---|---|
| **S0** | 0 | PILOTE | Fisca-Lead-Orchestrator | `feat/w0-foundation` | origin/main | 8 | R1+R2 | 01, 04, 05, 14, 15 | PR des spécifications fusionnées (fait) |
| **S1A** | 1 | BACK-1 | Fisca-Core-Backend-Fiscal | `feat/w1-auth-crypto-cndp` | origin/main | 10 | R2 | 09, 10, 11, 15 | Pont S0 certifié et fusionné |
| **S1B** | 1 | BACK-1 | Fisca-Core-Backend-Fiscal | `feat/w1-erd-ast-cgnc` | origin/feat/w1-auth-crypto-cndp (empilée) | 12 | R1+R2 | 02, 04, 06, 07, 15 | Tous les tickets S1A en IN_REVIEW |
| **G1** | 1 | AUDIT | Fisca-QA-Security-Auditor | `audit/gate-1` (locale) | — | 3 | R1+R2 | 06, 09, 10, 14 | S1A et S1B en IN_REVIEW |
| **P2-A** | 2 | EDI-1 | Fisca-Containers-EDI-ERP | `feat/w2-xhub-4320-merkle` | origin/main | 10 | R1+R2 | 02, 05, 07, 10, 17 | G1 fusionnée (profil provisoire, B-13) |
| **P2-B** | 2 | FRONT-1 | Fisca-Frontend-Mobile-Growth | `feat/w2-ui-pme-pos` | origin/main | 12 | R3 | 01, 02, 07, 08 | G1 fusionnée |
| **P2-C** | 2 | FRONT-2 | Fisca-Frontend-Mobile-Growth | `feat/w2-astro-growth` | origin/main | 8 | R3 | 03, 08, 11, 18 | G1 fusionnée |
| **G2** | 2 | AUDIT | Fisca-QA-Security-Auditor | `audit/gate-2` (locale) | — | 3 | R1+R3 | 02, 08, 14, 18 | P2-A, P2-B, P2-C en IN_REVIEW |
| **P3-A** | 3 | EDI-1 | Fisca-Containers-EDI-ERP | `feat/w3-edi-simpl-fec` | origin/main | 12 | R1 | 02, 06, 07, 14 | G2 fusionnée (XSD officiels s'ils sont déposés, sinon provisoires, B-13) |
| **P3-B** | 3 | BACK-1 | Fisca-Core-Backend-Fiscal | `feat/w3-ai-agents-mcp` | origin/main | 10 | R1+R2 | 04, 07, 10, 13 | G2 fusionnée |
| **P3-C** | 3 | EDI-2 | Fisca-Containers-EDI-ERP | `feat/w3-erp-third-party` | origin/main | 9 | R1+R2 | 05, 07, 14, 17 | G2 fusionnée |
| **G3** | 3 | AUDIT | Fisca-QA-Security-Auditor | `audit/gate-3` (locale) | — | 3 | R1+R2 | 07, 13, 14, 17 | P3-A, P3-B, P3-C en IN_REVIEW |
| **P4-A** | 4 | FRONT-1 | Fisca-Frontend-Mobile-Growth | `feat/w4-oec-corp-mobile` | origin/main | 9 | R2+R3 | 01, 08, 09 | G3 fusionnée |
| **P4-B** | 4 | BACK-1 | Fisca-Core-Backend-Fiscal | `feat/w4-billing-factor-pra` | origin/main | 9 | R1+R2 | 02, 03, 12, 13, 17 | G3 fusionnée |
| **P4-C** | 4 | BACK-2 | Fisca-Core-Backend-Fiscal | `feat/w4-sovereign-cicd` | origin/main | 7 | R2 | 04, 11, 12, 16 | G3 fusionnée ; permission Workflows sur le jeton GitHub |
| **G4** | 4 | AUDIT | Fisca-QA-Security-Auditor | `audit/gate-4` (locale) | — | 3 | R1+R2+R3 | 03, 09, 12, 14 | P4-A, P4-B, P4-C en IN_REVIEW |
| **S5** | 5 | PILOTE + AUDIT | Orchestrateur (T-S5-01, 03) et auditeur (T-S5-02, 04) | `feat/w5-release-v1.0.0` | origin/main | 4 | R1+R2+R3 | 11, 12, 14, 16 | G4 fusionnée et feu vert du propriétaire |

Ordre : S0 → pont S0 → S1A → S1B → G1 → (P2-A, P2-B, P2-C) → G2 → (P3-A, P3-B, P3-C) → G3 → (P4-A, P4-B, P4-C) → G4 → S5. Une vague ne démarre que lorsque les branches de la précédente sont fusionnées sur `main`, ce qui se constate dans git (ERRATA B-16). Fichiers des spécifications : `01-prd`, `02-state-machines`, `03-entitlements-pricing`, `04-tdd-architecture`, `05-adr`, `06-erd-data-lifecycle`, `07-api-edi-contracts`, `08-design-system-i18n`, `09-auth-rbac-sod`, `10-stride-crypto`, `11-cndp-sovereignty`, `12-sla-dpa-pra-reversibility`, `13-finops`, `14-qa-harness`, `15-agents-md-constitution`, `16-cloud-deploy`, `17-third-party-integrations`, `18-seo-geo-aeo` (`.md`). Une session ne lit que ses 3 à 5 documents, section par section, plus `ERRATA.md`. Les « Annexe V » en fin de document (code de vérification numérique) sont des pièces justificatives : une session n'a pas à les lire.

## 2. Périmètres d'écriture (FISCA_SCOPE_DIRS)

| Session | Dossiers |
|---|---|
| **S0** | racine du dépôt, en mode orchestrateur (`FISCA_ORCHESTRATOR_MODE=1`) |
| **S1A** | `packages/auth-rbac`, `packages/crypto-e2ee`, `packages/compliance-cndp`, `apps/api-hono/src/routes/auth` |
| **S1B** | `packages/db-schema`, `packages/fiscal-ast`, `apps/api-hono/src/core`, `apps/api-hono/src/routes/ledger` |
| **P2-A** | `containers/fiscal-java`, `packages/ubl-xades`, `packages/vault-merkle`, `apps/api-hono/src/routes/invoices`, `apps/api-hono/src/routes/pos` |
| **P2-B** | `packages/ui-mercury`, `packages/i18n`, `apps/web-saas/src/shared`, `apps/web-saas/src/pme`, `apps/pos-pwa` |
| **P2-C** | `apps/marketing-astro` |
| **P3-A** | `packages/edi-simpl`, `packages/fec-auditor`, `apps/api-hono/src/routes/edi` |
| **P3-B** | `containers/docling-python`, `packages/ai-agents`, `apps/api-hono/src/routes/purchases`, `apps/api-hono/src/routes/mcp` |
| **P3-C** | `packages/external-integrations`, `connectors/odoo-l10n-ma`, `connectors/sage100-dotnet`, `containers/camel-bridge`, `apps/api-hono/src/routes/erp`, `apps/api-hono/src/routes/webhooks` |
| **P4-A** | `apps/web-saas/src/fiduciary`, `apps/web-saas/src/enterprise`, `apps/mobile-capacitor` |
| **P4-B** | `packages/billing-metering`, `packages/factorflow`, `packages/pra-reversibility`, `apps/api-hono/src/routes/billing`, `apps/api-hono/src/routes/factorflow` |
| **P4-C** | `apps/standby-vps`, `ops`, `scripts/provision-cloudflare-prod.sh`, `.github/workflows` |
| **G1 à G4** | `packages/qa-harness/src/adversarial`, `.meta` (branche locale seulement) |
| **S5** | `ops`, `.meta`, `packages/qa-harness` |

S'ajoutent pour toute session : `pnpm-lock.yaml`, `.meta/`, et l'ajout de dépendances au `package.json` du paquet englobant un périmètre partiel. Les dossiers du socle (`packages/shared-types`, `db-schema`, `auth-rbac`, `crypto-e2ee`, `compliance-cndp`, `qa-harness`) sont en lecture seule après la vague 1, sauf ticket d'orchestration.

## 3. Messages de lancement

**Lancement unique (recommandé)**, du propriétaire à Fisca-Lead-Orchestrator, dans un fil du projet Fisca :

```text
PILOTAGE AUTOMATIQUE FISCA — DÉMARRAGE.
Tu es le pilote. Clone anasse84/fisca (skill fisca-github-repo-access) et applique
docs/orchestration/pilotage-automatique.md de la section 3 à la fin, sans t'arrêter entre deux actions.
Ce fichier et docs/specs/ERRATA.md priment sur tes skills s'ils diffèrent.
RELEASE S5 : NON.
Ne me réponds qu'à un arrêt STOP_OWNER, à la fin (COMPLETE), ou par la ligne ETAT PILOTE en fin de tour.
```

Reprise après un arrêt ou une pause : `CONTINUE`, dans le même fil.

**Lancement manuel d'une session (secours)**, dans un fil ouvert par le propriétaire avec l'agent de la matrice : `SESSION <ID>. Applique le skill fisca-harness-gatekeeper (protocole de boucle v2.1) du début à la clôture, sans t'arrêter entre les tickets. Ta ligne de la matrice est dans le skill fisca-factory-runbook.` Pour S0, ajouter : `Mode orchestrateur : exporte FISCA_ORCHESTRATOR_MODE=1. Respecte le contrat d'échafaudage (ERRATA B-02) et installe dans scripts/ les fichiers de docs/orchestration/reference/.`

**Barrière et fusion manuelles (secours)** : `BARRIÈRE <ID>. Applique la procédure de barrière du skill fisca-factory-runbook. Termine par la ligne VERDICT <ID> : FAVORABLE ou DÉFAVORABLE.` à l'auditeur ; puis `FUSION <ID> : applique la procédure de fusion du skill fisca-factory-runbook.` à l'orchestrateur.

## 4. Procédure de barrière (auditeur, lecture seule sur GitHub)

1. Préalable : tous les tickets des sessions auditées sont `IN_REVIEW`. S'il reste un `TODO`, un `IN_PROGRESS` ou un `BLOCKED`, la barrière ne s'ouvre pas : dis-le et termine par `VERDICT <ID> : DÉFAVORABLE (barrière non ouverte)`.
2. Clone, `bash scripts/bootstrap-sandbox.sh` avec les options de la vague, puis branche locale `audit/gate-N` depuis `origin/main`. Fusionne-y sans avance rapide les branches candidates, dans l'ordre de la matrice (S1A avant S1B). Sur conflit de `pnpm-lock.yaml` : `git checkout --theirs pnpm-lock.yaml && pnpm install`. Tout autre conflit est un défaut de périmètre : refus. Cette branche n'est jamais poussée.
3. Intégrité : `git diff origin/main -- AGENTS.md CLAUDE.md scripts/ docs/specs/ packages/qa-harness/src/fiscal-golden-suite.ts` ne montre aucun changement venu d'une branche de construction, et `node scripts/enforce-constitution.ts --range origin/main`, lancé sur chaque branche candidate avec son périmètre, ne signale rien.
4. Harnais complet : `pnpm verify:gate` et `pnpm test:xsd`. Puis les tickets T-Gx-01 et T-Gx-02 du backlog, avec les scénarios du fichier attaché `barrieres-qa.md` (aussi dans `docs/orchestration/`). Tes tests adverses vont dans `packages/qa-harness/src/adversarial/`. Recalcule toi-même les valeurs attendues des vecteurs d'or ajoutés par la vague.
5. Note chaque rubric engagée (versions v2, 5 critères), critère par critère, sur preuve observée par toi (fichier et ligne, sortie de commande, capture). Une clause éliminatoire met la rubric à 0. Seuil : 95/100 sur chaque rubric. Ce que tu n'as pas pu vérifier dans le bac à sable se dit et ne compte pas comme acquis. Un schéma provisoire n'est pas une clause éliminatoire s'il respecte ERRATA B-13 ; le verdict porte alors la mention « conformité officielle non vérifiée ».
6. Verdict favorable : pour chaque ticket audité, `status = DONE`, `tests_green = true`, `rubric_score` ; verdict daté dans `05_QA_Gate_Verdicts` ; contrats de la vague passés à `LOCKED` dans le registre (un contrat `PROVISIONAL` garde ce statut). Ton rapport final porte les branches, les PR, les scores, les sorties du harnais et le correctif de tes tests adverses (`git format-patch --stdout`), puis la ligne `VERDICT <ID> : FAVORABLE`. Tu ne délègues rien : le pilote lit ce rapport et fusionne.
7. Verdict défavorable : chaque ticket fautif repasse à `TODO`, `retry_count = 0`, avec dans `review_notes` l'écart précis, la sortie de commande et ce qui manque pour atteindre 95. Les autres tickets restent `IN_REVIEW`. Aucune fusion. Termine par `VERDICT <ID> : DÉFAVORABLE`. La session concernée reprend, puis la barrière se rejoue (3 tours au plus avant arrêt du pilote).

## 5. Procédure de fusion (orchestrateur)

1. Vérifie le verdict favorable daté dans `05_QA_Gate_Verdicts` et que tous les tickets des sessions de la vague sont `DONE`.
2. Pour chaque PR, dans l'ordre de la matrice : mets la branche à jour sur `origin/main` par une fusion (jamais de rebase forcé), résous `pnpm-lock.yaml` par `pnpm install`, relance `pnpm verify:fast`, pousse, puis fusionne la PR par commit de fusion (jamais de squash : ERRATA B-16).
3. Applique le correctif des tests adverses sur une branche `feat/wN-gate-vectors` en mode orchestrateur, PR, fusion.
4. Sur `main` à jour : `pnpm verify:fast` vert. Sinon, annule la dernière fusion par une PR de retour et rouvre le ticket en cause.
5. Passe les tickets de la barrière (T-Gx-01 à T-Gx-03) à `DONE`, mets à jour `01_Current_Wave_Status` (vague suivante autorisée, compteur de tickets `DONE`), puis commite par PR `.meta/backlog-snapshot-main.json` et `.meta/openapi.snapshot.json` régénéré.
6. Tickets `BLOCKED` : table de décision de `docs/orchestration/pilotage-automatique.md` § 5 (jonction, errata, schéma absent, trois échecs, `MAIN_RED`, décision du propriétaire).

## 6. À la charge du propriétaire du projet

- Avant le lancement : protéger `main` (PR obligatoire, 0 approbation, force-push et suppression bloqués) ; renouveler le jeton GitHub (il expire le 2026-12-12) en lui ajoutant la permission « Workflows : lecture et écriture » ; donner à « Run time limit » de chaque agent la valeur la plus haute.
- Au lancement : accorder l'accès npm aux 8 fils (pilote et 7 voies), depuis la boîte de réception.
- Pendant la construction : trancher la liste « À trancher » de `01_Current_Wave_Status`, puis écrire `CONTINUE` au pilote. Déposer dans `docs/reference/dgi/` tout schéma officiel dès sa publication ; rien ne l'attend.
- Après G4 : décider la release S5 (`CONTINUE. RELEASE S5 : OUI` dans le fil du pilote), puis le tag `v1.0.0`.

## Fichiers attachés

Ils sont dans le dossier `scripts/` de ce skill : `session-scopes.json` (matrice et voies, lisible par les scripts), `barrieres-qa.md` (scénarios du pont S0, de G1 à G4 et de S5), `pilotage-automatique.md` (procédure du pilote) et `pilot-status.mjs` (calcul des actions du pilote). Ce sont des copies de `docs/orchestration/` et de `.meta/` : sur `main`, ce sont les fichiers du dépôt qui font foi.

## Adaptation Antigravity

- « fisca_master_backlog » → fichier `ops/state/backlog.json` du dépôt (le texte d'origine de ce skill ne référence pas les tables par nom ailleurs).
- « Récupère-les avec FetchSkillScripts » → « ils sont dans le dossier scripts/ de ce skill ».
- Les « fils » / « voies » (un fil Hyperagent par voie, CreateAgentThread/SendThreadMessage) correspondent, sous Antigravity, à un sous-agent Antigravity (`.agents/agents/`) ou à une session agy parallèle (`docs/antigravity/`). Le texte d'origine est conservé tel quel ; seule cette équivalence est ajoutée.
- Les tables `05_QA_Gate_Verdicts` et `01_Current_Wave_Status` (Hyperagent) n'ont pas d'équivalent fichier défini par la consigne d'export : à rapprocher de `docs/state/FISCA_STATE_AND_HANDOFF.md` et `ops/state/` (à confirmer par le propriétaire).
- Les fichiers de `scripts/` sont copiés tels quels depuis Hyperagent (références Hyperagent éventuelles à l'intérieur de `barrieres-qa.md`, `pilotage-automatique.md`, `pilot-status.mjs` non réécrites : le dépôt `docs/orchestration/` fait foi).
