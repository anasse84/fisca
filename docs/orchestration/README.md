# Usine logicielle Fisca — guide d'exécution (v2.1, 2026-11-13)

Ce dossier décrit comment les agents Hyperagent construisent Fisca sans intervention entre deux barrières. Il remplace `cartographie-6-vagues.md` (périmée). Les écarts par rapport aux documents d'origine sont justifiés dans `docs/specs/ERRATA.md`.

| Fichier | Contenu |
|---|---|
| `README.md` | Matrice des 17 sessions, périmètres, messages de lancement, barrières QA, fusion |
| `pilotage-automatique.md` | **Lancement unique** : procédure du pilote qui enchaîne sessions, barrières et fusions |
| `protocole-boucle.md` | Protocole de boucle des sessions de construction |
| `sandbox.md` | Bac à sable : outils, réseau, ce qui ne peut pas y être testé |
| `reference/` | Scripts de garde corrigés et testés, à installer par S0 (T-S0-03), et `pilot-status.mjs` (calcul des actions du pilote) |
| `../../.meta/session-scopes.json` | La matrice, lisible par les scripts |

## 1. Matrice des sessions (132 tickets)

| Session | Vague | Mode | Agent Hyperagent | Branche | Base | Tickets | Rubrics | Spécifications à lire (docs/specs/) | Préalable |
|---|---|---|---|---|---|---|---|---|---|
| **S0** | 0 | séquentiel | Lead-Orchestrator | `feat/w0-foundation` | origin/main | 8 | R1+R2 | 01, 04, 05, 14, 15 | PR des spécifications fusionnée sur main |
| **S1A** | 1 | séquentiel | Core-Backend-Fiscal | `feat/w1-auth-crypto-cndp` | origin/main | 10 | R2 | 09, 10, 11, 15 | Pont S0 certifié et fusionné |
| **S1B** | 1 | séquentiel | Core-Backend-Fiscal | `feat/w1-erd-ast-cgnc` | origin/feat/w1-auth-crypto-cndp (branche empilée sur S1A) | 12 | R1+R2 | 02, 04, 06, 07, 15 | Tous les tickets S1A en IN_REVIEW |
| **G1** | 1 | barrière QA | QA-Security-Auditor | `audit/gate-1` (locale) | local uniquement | 3 | R1+R2 | 06, 09, 10, 14 | Tous les tickets S1A et S1B en IN_REVIEW |
| **P2-A** | 2 | parallèle | Containers-EDI-ERP | `feat/w2-xhub-4320-merkle` | origin/main | 10 | R1+R2 | 02, 05, 07, 10, 17 | G1 fusionnée (profil xHub non publié : profil provisoire, ERRATA B-13) |
| **P2-B** | 2 | parallèle | Frontend-Mobile-Growth | `feat/w2-ui-pme-pos` | origin/main | 12 | R3 | 01, 02, 07, 08 | G1 fusionnée |
| **P2-C** | 2 | parallèle | Frontend-Mobile-Growth | `feat/w2-astro-growth` | origin/main | 8 | R3 | 03, 08, 11, 18 | G1 fusionnée |
| **G2** | 2 | barrière QA | QA-Security-Auditor | `audit/gate-2` (locale) | local uniquement | 3 | R1+R3 | 02, 08, 14, 18 | Tous les tickets P2-A/B/C en IN_REVIEW |
| **P3-A** | 3 | parallèle | Containers-EDI-ERP | `feat/w3-edi-simpl-fec` | origin/main | 12 | R1 | 02, 06, 07, 14 | G2 fusionnée (XSD officiels DGI s'ils sont déposés, sinon XSD provisoires : ERRATA B-13) |
| **P3-B** | 3 | parallèle | Core-Backend-Fiscal | `feat/w3-ai-agents-mcp` | origin/main | 10 | R1+R2 | 04, 07, 10, 13 | G2 fusionnée |
| **P3-C** | 3 | parallèle | Containers-EDI-ERP | `feat/w3-erp-third-party` | origin/main | 9 | R1+R2 | 05, 07, 14, 17 | G2 fusionnée |
| **G3** | 3 | barrière QA | QA-Security-Auditor | `audit/gate-3` (locale) | local uniquement | 3 | R1+R2 | 07, 13, 14, 17 | Tous les tickets P3-A/B/C en IN_REVIEW |
| **P4-A** | 4 | parallèle | Frontend-Mobile-Growth | `feat/w4-oec-corp-mobile` | origin/main | 9 | R2+R3 | 01, 08, 09 | G3 fusionnée |
| **P4-B** | 4 | parallèle | Core-Backend-Fiscal | `feat/w4-billing-factor-pra` | origin/main | 9 | R1+R2 | 02, 03, 12, 13, 17 | G3 fusionnée |
| **P4-C** | 4 | parallèle | Core-Backend-Fiscal | `feat/w4-sovereign-cicd` | origin/main | 7 | R2 | 04, 11, 12, 16 | G3 fusionnée + permission Workflows sur le jeton GitHub |
| **G4** | 4 | barrière QA | QA-Security-Auditor | `audit/gate-4` (locale) | local uniquement | 3 | R1+R2+R3 | 03, 09, 12, 14 | Tous les tickets P4-A/B/C en IN_REVIEW |
| **S5** | 5 | release | Lead-Orchestrator + QA-Security-Auditor | `feat/w5-release-v1.0.0` | origin/main | 4 | R1+R2+R3 | 11, 12, 14, 16 | G4 fusionnée |

Ordre : S0 → pont S0 → S1A → S1B → G1 → (P2-A, P2-B, P2-C en parallèle) → G2 → (P3-A, P3-B, P3-C) → G3 → (P4-A, P4-B, P4-C) → G4 → S5. Une vague ne démarre que lorsque la barrière précédente est fusionnée sur `main`.

## 2. Périmètres d'écriture

| Session | Dossiers autorisés en écriture (FISCA_SCOPE_DIRS) |
|---|---|
| **S0** | (racine du dépôt : mode orchestrateur FISCA_ORCHESTRATOR_MODE=1) |
| **S1A** | `packages/auth-rbac`, `apps/api-hono/src/routes/auth`, `packages/crypto-e2ee`, `packages/compliance-cndp` |
| **S1B** | `packages/db-schema`, `apps/api-hono/src/core`, `packages/fiscal-ast`, `apps/api-hono/src/routes/ledger` |
| **G1** | `packages/qa-harness`, `.meta` |
| **P2-A** | `containers/fiscal-java`, `packages/ubl-xades`, `packages/vault-merkle`, `apps/api-hono/src/routes/invoices`, `apps/api-hono/src/routes/pos` |
| **P2-B** | `packages/ui-mercury`, `packages/i18n`, `apps/web-saas/src/shared`, `apps/web-saas/src/pme`, `apps/pos-pwa` |
| **P2-C** | `apps/marketing-astro` |
| **G2** | `packages/qa-harness`, `.meta` |
| **P3-A** | `packages/edi-simpl`, `packages/fec-auditor`, `apps/api-hono/src/routes/edi` |
| **P3-B** | `containers/docling-python`, `packages/ai-agents`, `apps/api-hono/src/routes/purchases`, `apps/api-hono/src/routes/mcp` |
| **P3-C** | `packages/external-integrations`, `apps/api-hono/src/routes/webhooks`, `connectors/odoo-l10n-ma`, `connectors/sage100-dotnet`, `apps/api-hono/src/routes/erp`, `containers/camel-bridge` |
| **G3** | `packages/qa-harness`, `.meta` |
| **P4-A** | `apps/web-saas/src/fiduciary`, `apps/web-saas/src/enterprise`, `apps/mobile-capacitor` |
| **P4-B** | `packages/billing-metering`, `apps/api-hono/src/routes/billing`, `packages/factorflow`, `apps/api-hono/src/routes/factorflow`, `packages/pra-reversibility` |
| **P4-C** | `apps/standby-vps`, `ops`, `scripts/provision-cloudflare-prod.sh`, `.github/workflows` |
| **G4** | `packages/qa-harness`, `.meta` |
| **S5** | `ops`, `.meta`, `packages/qa-harness` |

S'ajoutent pour toute session : `pnpm-lock.yaml`, `.meta/`, et l'ajout de dépendances au `package.json` du paquet englobant un périmètre partiel. Les dossiers du socle (`packages/shared-types`, `db-schema`, `auth-rbac`, `crypto-e2ee`, `compliance-cndp`, `qa-harness`) sont en lecture seule après la vague 1, sauf ticket d'orchestration.

## 3. Messages de lancement

**Lancement unique (recommandé).** Un seul message à Fisca-Lead-Orchestrator, dans un fil ouvert par le propriétaire : il est dans `pilotage-automatique.md` § 8. Le pilote ouvre lui-même les voies, envoie les messages de session et de barrière calculés par `reference/pilot-status.mjs`, fusionne après chaque verdict favorable et s'arrête avant S5.

**Lancement manuel, session par session (secours).** Un fil par session, avec l'agent de la matrice, ouvert par le propriétaire. Le message tient en quelques lignes : la méthode est dans `protocole-boucle.md` (et le skill `fisca-harness-gatekeeper`).

**Session de construction (S0, S1A à P4-C)**

```text
SESSION <ID>. Applique le skill fisca-harness-gatekeeper (protocole de boucle v2) du début à la clôture,
sans t'arrêter entre les tickets. Ta ligne de la matrice est dans le skill fisca-factory-runbook
(branche, base, périmètre, spécifications). Rends compte uniquement à la clôture ou sur blocage général.
```

Pour S0, ajoute : `Mode orchestrateur : exporte FISCA_ORCHESTRATOR_MODE=1. Respecte le contrat d'échafaudage (ERRATA B-02) et installe les scripts de docs/orchestration/reference/.`

**Barrière QA (pont S0, G1 à G4)**

```text
BARRIÈRE <ID>. Applique la procédure de barrière du skill fisca-factory-runbook sur les branches de la
vague. Rends ton verdict par rubric, consigne-le, et termine par la ligne VERDICT <ID> : FAVORABLE ou DÉFAVORABLE.
```

**Fusion (orchestrateur, après un verdict favorable)** : en pilotage automatique, le pilote la déclenche lui-même. En lancement manuel : `FUSION <ID> : applique la procédure de fusion de docs/orchestration/README.md § 5.` L'auditeur ne peut pas la demander lui-même : un fil ouvert par un autre fil ne délègue plus (ERRATA B-15).

**Release S5** : `S5-A` à l'orchestrateur (T-S5-01, puis T-S5-03 après T-S5-02), `S5-B` à l'auditeur (T-S5-02 puis T-S5-04).

## 4. Procédure de barrière (auditeur, lecture seule sur GitHub)

1. Préalable : tous les tickets des sessions auditées sont `IN_REVIEW`. S'il reste un `TODO`, un `IN_PROGRESS` ou un `BLOCKED`, la barrière ne s'ouvre pas : dis-le dans ton rapport et termine par `VERDICT <ID> : DÉFAVORABLE (barrière non ouverte)`.
2. Clone, `bash scripts/bootstrap-sandbox.sh` avec les options de la vague, puis branche locale `audit/gate-N` depuis `origin/main`. Fusionne-y sans avance rapide les branches candidates, dans l'ordre de la matrice (S1A avant S1B). Sur conflit de `pnpm-lock.yaml` : `git checkout --theirs pnpm-lock.yaml && pnpm install`. Tout autre conflit est un défaut de périmètre : refus.
3. Intégrité : `git diff origin/main -- AGENTS.md CLAUDE.md scripts/ docs/specs/ packages/qa-harness/src/fiscal-golden-suite.ts` ne montre aucun changement venu d'une branche de construction, et `node scripts/enforce-constitution.ts --range origin/main`, lancé sur chaque branche candidate avec son périmètre, ne signale rien.
4. Harnais complet : `pnpm verify:gate` (et `pnpm test:xsd`). Puis les tickets de barrière T-Gx-01 et T-Gx-02 du backlog, avec les scénarios détaillés dans `docs/orchestration/barrieres-qa.md`. Tes tests adverses vont dans `packages/qa-harness/src/adversarial/`, sur ta branche locale.
5. Note chaque rubric engagée, critère par critère, sur preuve observée (fichier et ligne, sortie de commande, capture). Une clause éliminatoire met la rubric à 0. Seuil : 95/100 sur chaque rubric.
6. Verdict favorable : pour chaque ticket audité, `status = DONE`, `tests_green = true`, `rubric_score` ; verdict daté dans `05_QA_Gate_Verdicts` ; contrats de la vague passés à `LOCKED` dans le registre (un contrat `PROVISIONAL` garde ce statut : ERRATA B-13). Ton rapport final porte les branches, les PR, les scores, les sorties du harnais et, s'il y en a, le correctif de tes tests adverses (`git format-patch --stdout`), puis la ligne `VERDICT <ID> : FAVORABLE`. Tu ne délègues rien : le pilote lit ce rapport et fusionne.
7. Verdict défavorable : chaque ticket fautif repasse à `TODO`, `retry_count = 0`, avec dans `review_notes` l'écart précis, la sortie de commande et ce qui manque pour atteindre 95. Les autres tickets restent `IN_REVIEW`. Aucune fusion. La session concernée reprend, puis la barrière se rejoue.

## 5. Procédure de fusion (orchestrateur)

1. Vérifie le verdict dans `05_QA_Gate_Verdicts` et que tous les tickets de la vague sont `DONE`.
2. Pour chaque PR, dans l'ordre de la matrice : mets la branche à jour sur `origin/main` par une fusion (jamais de rebase forcé), résous `pnpm-lock.yaml` par `pnpm install`, relance `pnpm verify:fast`, pousse, puis fusionne la PR (commit de fusion).
3. Applique le correctif des tests adverses sur une branche `feat/wN-gate-vectors` en mode orchestrateur, PR, fusion.
4. Sur `main` à jour : `pnpm verify:fast` vert. Sinon, annule la dernière fusion par une PR de retour et rouvre le ticket en cause.
5. Passe les tickets de la barrière (T-Gx-01 à T-Gx-03) à `DONE`, mets à jour `01_Current_Wave_Status` (vague suivante autorisée, compteur de tickets `DONE`), puis commite par PR `.meta/backlog-snapshot-main.json` et `.meta/openapi.snapshot.json` régénéré.

## 6. À la charge du propriétaire du projet

Avant le lancement :

- Poser la protection de `main` (PR obligatoire, 0 approbation, force-push et suppression bloqués).
- Renouveler le jeton GitHub (il expire le 2026-12-12) en lui ajoutant la permission « Workflows : lecture et écriture », exigée par P4-C (ERRATA B-12).
- Dans les limites de chaque agent (onglet Permissions, section Limits), donner à « Run time limit » la valeur la plus haute proposée.

Au lancement :

- Accorder l'accès npm aux 8 fils (le pilote et ses 7 voies) : chaque demande apparaît dans la boîte de réception, bouton Allow. L'accord vaut pour le fil, une fois pour toutes.

Pendant la construction :

- Trancher ce que le pilote liste sous « À trancher » dans `01_Current_Wave_Status`, puis lui écrire `CONTINUE`.
- Dès que la DGI ou xHub publie un schéma ou un profil officiel : le déposer dans `docs/reference/dgi/` par une Pull Request (procédure dans `docs/reference/dgi/README.md`). Rien n'attend ces fichiers (ERRATA B-13).
- Après la fusion de G4 : décider la release S5, puis le tag `v1.0.0`.
