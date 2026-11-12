# Cartographie des 6 vagues (séquentielles et parallèles)

> Source : DOCX « Cartographie des 6 Vagues (Séquentielles & Parallèles) », converti en Markdown le 2026-11-12.
>
> **Écarts validés depuis le DOCX (ils priment sur le texte ci-dessous) :**
> - S0 travaille sur la branche `feat/w0-foundation` et livre par Pull Request (le tableau indique `main`).
> - Cloudflare : intégration officielle `mcp.cloudflare.com` (le serveur `docs.mcp.cloudflare.com` ne peut pas être connecté). L'outil `execute` est interdit aux agents ; les déploiements de pré-production passent par le skill `fisca-cloudflare-staging-deploy`.
> - Les spécifications se lisent dans `docs/specs/` de ce dépôt ; chaque session n'en reçoit que 3 à 5.
> - Accès réseau : `registry.npmjs.org` doit être autorisé une fois dans chaque fil de session (outil RequestNetworkAccess, accord de l'utilisateur). PyPI, Maven Central, NuGet et nodejs.org sont accessibles sans accord.

L’orchestration industrielle de **Fisca** (fisca.ma) dans **Hyperagent.com** repose sur une **topologie en diamant (Épine Séquentielle → Vagues Parallèles Isolées → Barrières QA)** qui permet de faire coder jusqu’à trois sandboxes Linux simultanément sans jamais provoquer de conflit Git ni de dérive architecturale.

## 1. Cartographie des 6 Vagues (Séquentielles & Parallèles)

Pourquoi ne jamais lancer dix sessions parallèles dès la première minute ? Parce que chaque Thread Hyperagent travaille dans sa propre machine virtuelle isolée : si les types TypeScript partagés, les contrats Zod et le fichier pnpm-lock.yaml n'existent pas encore sur la branche main de votre dépôt GitHub privé fisca, trois agents parallèles créeront trois structures incompatibles.

La construction suit donc **6 vagues verrouillées** où deux sessions parallèles ne touchent **jamais** au même sous-dossier du Monorepo :

| Session & Vague | Mode d'Exécution | Agent Hyperagent | Branche Git Dédiée | Dossiers Verrouillés Exclusifs |
|----|----|----|----|----|
| **S0 (Vague 0)** | Séquentiel seul | Fisca-Lead-Orchestrator | main | Racine, scripts/, packages/shared-types |
| **S1A (Vague 1)** | Séquentiel 1/2 | Fisca-Core-Backend-Fiscal | feat/w1-ledger-e2ee | packages/db-schema, packages/crypto-e2ee |
| **S1B (Vague 1)** | Séquentiel 2/2 | Fisca-Core-Backend-Fiscal | feat/w1-cgi-ast-seq | packages/fiscal-ast, apps/api-hono |
| **P2-A (Vague 2)** | **Parallèle 1/3** | Fisca-Containers-EDI-ERP | feat/w2-clearance-vault | containers/fiscal-java, packages/vault-merkle |
| **P2-B (Vague 2)** | **Parallèle 2/3** | Fisca-Frontend-Mobile-Growth | feat/w2-ui-pme | packages/ui-mercury, packages/i18n, apps/web-saas/src/pme |
| **P2-C (Vague 2)** | **Parallèle 3/3** | Fisca-Frontend-Mobile-Growth | feat/w2-astro-growth | apps/marketing-astro |
| **P3-A (Vague 3)** | **Parallèle 1/3** | Fisca-Containers-EDI-ERP | feat/w3-simpl-edi | packages/edi-simpl, packages/fec-auditor |
| **P3-B (Vague 3)** | **Parallèle 2/3** | Fisca-Core-Backend-Fiscal | feat/w3-ai-agents-mcp | containers/docling-python, packages/ai-agents |
| **P3-C (Vague 3)** | **Parallèle 3/3** | Fisca-Containers-EDI-ERP | feat/w3-erp-connectors | connectors/odoo-l10n-ma, connectors/sage100-dotnet |
| **P4-A (Vague 4)** | **Parallèle 1/2** | Fisca-Frontend-Mobile-Growth | feat/w4-portals-mobile | apps/web-saas/src/fiduciary, enterprise, apps/mobile-capacitor |
| **P4-B (Vague 4)** | **Parallèle 2/2** | Fisca-Core-Backend-Fiscal | feat/w4-fintech-failover | packages/billing-metering, packages/factorflow, apps/standby-vps |
| **G1–G4 (Gates)** | Barrière fin vague | Fisca-QA-Security-Auditor | Revue PR → main | Lecture seule + exécution harnais de tests |
| **S5 (Vague 5)** | Séquentiel final | Fisca-QA-Security-Auditor | release/v1.0.0 | tests/e2e, tests/chaos, .github/workflows |

## 2. Procédures Opératoires Exactes (Pas à Pas dans Hyperagent)

Suivez ces **5 procédures** dans l'ordre exact sur l'interface web de hyperagent.com :

### Procédure A — Mise en place initiale du Projet (Une seule fois, 15 minutes)

1.  Ouvrez **Workspaces / Projects** dans la barre latérale de Hyperagent et créez un nouveau projet nommé **Fisca (fisca.ma)**.

2.  Allez dans **Settings → Integrations**, vérifiez que votre compte **GitHub** autorise l'accès en lecture/écriture au dépôt privé fisca, et ajoutez les deux serveurs **Custom MCP** (\[https://docs.mcp.cloudflare.com/mcp\](https://docs.mcp.cloudflare.com/mcp) et \[https://mcp.context7.com/mcp\](https://mcp.context7.com/mcp)).

3.  Dans **Knowledge → Memories**, créez les **10 Mémoires fixes** (M01 à M10 de l'Étape 2) et épinglez uniquement M01 à M04.

4.  Dans **Knowledge → Skills**, créez les **8 Skills** (S01 à S08), épinglez S01 et S05, et activez **Skill Discovery**.

5.  Dans **Knowledge → Documents and tables**, créez les deux tables typées globales fisca_master_backlog et fisca_contracts_registry, le document de projet FISCA_STATE_AND_HANDOFF (avec ses 5 sections nommées), puis importez nos **18 Documents de spécification** (au fur et à mesure que nous les rédigerons à la Phase B) avec la portée **Project**.

6.  Dans **Knowledge → Autowiki**, activez **Daily dreaming** et cliquez sur **Give agents access**.

7.  Dans **Learning → Rubrics**, enregistrez les **3 Rubrics** (R1, R2, R3) et épinglez-les aux agents via **Save & Pin to Agent**.

8.  Dans **Agents**, créez les **6 Agents** de l'Étape 2 avec Autonomy = Auto et Self-delegation = ON sur les trois agents constructeurs.

### Procédure B — Lancer une Session de Codage en Boucle Autonome (Pendant des heures)

1.  Dans le projet **Fisca (fisca.ma)**, cliquez sur **New Thread** et sélectionnez l'agent correspondant à la session (ex. Fisca-Core-Backend-Fiscal pour S1A).

2.  Vérifiez dans **Thread settings** que le modèle manuel et le Subagent model sont bien verrouillés selon notre matrice, et que When you're in conversation est réglé sur **Auto**.

3.  Attachez par @mention dans votre message uniquement les documents requis pour cette session (la table exacte d'attachement vous sera remise en Phase C) ainsi que @fisca_master_backlog, @fisca_contracts_registry et @FISCA_STATE_AND_HANDOFF.

4.  Collez le **Prompt Maître** correspondant (fourni en Section 3 ci-dessous) et lancez l'exécution.

5.  **Comment la boucle tourne toute seule pendant des heures :** L'agent traite un lot de **5 tâches atomiques** (test → code → pnpm verify:fast → commit → push → mise à jour de @fisca_master_backlog), puis invoque automatiquement sa propre **Self-delegation** pour démarrer une instance neuve de lui-même avec 0 % d'usure de contexte sur les 5 tâches suivantes, jusqu'à ce que tous les tickets de sa branche soient au statut IN_REVIEW !

6.  **Filet de sécurité nocturne (Schedule de reprise automatique) :** Si vous laissez tourner une grosse vague toute la nuit, ouvrez l'onglet **Invocations → Schedules** de l'agent actif et activez un déclencheur toutes les **2 heures** avec le *Prompt de Reprise Automatique* (Prompt 4 ci-dessous). Si une boucle s'est arrêtée sur une limite de durée (Turn timeout), le Schedule la relance tout seul depuis le dernier commit GitHub ! *(Pensez à mettre ce Schedule sur Pause dès que la vague est terminée).*

### Procédure C — Exécuter une Vague Parallèle (Vagues 2, 3 et 4)

1.  Assurez-vous d'abord que la **Barrière QA** de la vague précédente a bien fusionné tout son travail sur la branche main du dépôt GitHub fisca.

2.  Ouvrez **3 onglets** dans votre navigateur sur le projet Fisca (fisca.ma) et créez **3 nouveaux Threads distincts** (ex. un Thread pour P2-A, un pour P2-B, un pour P2-C).

3.  Chaque Thread démarre dans son propre sandbox Linux isolé, clone main, crée sa propre branche (feat/w2-clearance-vault, feat/w2-ui-pme, feat/w2-astro-growth) et ne modifie **que** ses dossiers assignés.

4.  Si l'agent Frontend (P2-B) a besoin d'une route API pas encore fusionnée, il lit sa signature exacte dans la table partagée @fisca_contracts_registry sans jamais toucher au dossier apps/api-hono.

### Procédure D — Franchir une Barrière QA (Maker-Checker Gate) et Gérer un Blocage

1.  Dès que les Threads d'une vague annoncent que leurs tickets sont au statut IN_REVIEW et que leurs Pull Requests sont ouvertes sur GitHub, ouvrez un Thread avec **Fisca-QA-Security-Auditor**.

2.  Lancez le **Prompt Maître de Barrière QA** (Prompt 3). L'auditeur tire la branche dans son sandbox vierge, lance pnpm verify:fast, xmllint et Playwright, puis vous utilisez **Actions → Run evaluation** avec le juge croisé sur les Rubrics R1, R2 ou R3.

3.  Si une tâche est tombée en disjoncteur (status = BLOCKED après 3 échecs dans @fisca_master_backlog), lisez le diagnostic dans la section 04_Circuit_Breaker_Blockers de @FISCA_STATE_AND_HANDOFF, tranchez ou ajustez la règle dans un fil dédié, remettez retry_count à 0 et status à TODO.

### Procédure E — Piloter Hyperagent en MCP depuis Votre Terminal Local (Plus tard)

Une fois les premières vagues en place sur GitHub, vous pourrez cloner fisca sur votre machine locale et connecter **Claude Code / ZCode** au serveur MCP distant de Hyperagent : vos agents Hyperagent ayant Autonomy = Auto, vous pourrez déclencher une vague d'audit ou consulter @fisca_master_backlog directement depuis votre terminal local tout en testant le connecteur Windows Sage 100 ou l'application mobile sur vos appareils physiques.

## 3. Les 4 Prompts Maîtres Prêts à Copier-Coller

### Prompt 1 — Session Zéro (S0 : Initialisation du Monorepo fisca, Harnais & Backlog)

*À lancer dans un nouveau Thread avec l'agent **Fisca-Lead-Orchestrator** (Claude Fable 5.2 ou Opus 5.5, Effort Max).*

MISSION SESSION S0 (FONDATION & HARNAIS DÉTERMINISTE DU PROJET FISCA)\
\
Contexte & Référentiels à lire impérativement avant toute action :\
- Consulte nos mémoires épinglées, @fisca-harness-gatekeeper, @fisca-zero-trust-e2ee-guard, ainsi que les documents de spécification attachés (@Doc_01_PRD, @Doc_04_TDD, @Doc_06_ERD, @Doc_14_QA, @Doc_15_AGENTS_MD).\
- Cible Git : dépôt privé GitHub connecté \`fisca\`, branche \`main\`.\
\
Exécute séquentiellement et intégralement les 6 étapes suivantes sans aucun code factice ni placeholder :\
\
1. CLONAGE & ARCHITECTURE MONOREPO :\
- Clone le dépôt privé \`fisca\` dans le sandbox.\
- Initialise un Monorepo strict \`pnpm\` + \`Turborepo\` (\`pnpm-workspace.yaml\`, \`turbo.json\`, \`tsconfig.base.json\` avec \`strict: true\`, \`noUncheckedIndexedAccess: true\`, \`noImplicitAny: true\`).\
- Crée l'arborescence normalisée des workspaces :\
\* \`apps/marketing-astro\` (Site public SEO/GEO/AEO 6 langues)\
\* \`apps/web-saas\` (Application React 19 + Vite + Tailwind v4)\
\* \`apps/mobile-capacitor\` (Coque native iOS/Android Capacitor)\
\* \`apps/api-hono\` (Cloudflare Workers + Durable Objects + Workflows + Queues)\
\* \`apps/standby-vps\` (Serveur miroir Node/Hono + BullMQ + Pont HTTP Failback)\
\* \`packages/shared-types\` (Schémas Zod monétaires en centimes entiers, BPS, ICE Modulo 97, interfaces \`StorageAdapter\`)\
\* \`packages/db-schema\`, \`packages/crypto-e2ee\`, \`packages/fiscal-ast\`, \`packages/ubl-xades\`, \`packages/vault-merkle\`, \`packages/edi-simpl\`, \`packages/fec-auditor\`, \`packages/ai-agents\`, \`packages/billing-metering\`, \`packages/factorflow\`, \`packages/ui-mercury\`, \`packages/i18n\`\
\* \`containers/fiscal-java\`, \`containers/docling-python\`, \`containers/camel-bridge\`\
\* \`connectors/odoo-l10n-ma\`, \`connectors/sage100-dotnet\`\
\
2. HARNAIS DE SÉCURITÉ & SCRIPTS SANDBOX :\
- Écris \`AGENTS.md\` à la racine conformément à @Doc_15_AGENTS_MD.\
- Crée \`scripts/bootstrap-sandbox.sh\` (installation idempotente des outils CLI requis : pnpm, wrangler, xmllint, playwright) et \`scripts/harness-check.sh\` câblé sur \`pnpm verify:fast\`.\
- Configure ESLint pour rejeter tout type \`any\`, tout \`TODO\`/\`FIXME\`, tout test \`.skip\` et toute opération flottante sur un champ terminé par \`Cents\`, \`Centimes\` ou \`Bps\`.\
\
3. CONTRATS PARTAGÉS (\`packages/shared-types\`) :\
- Implémente les types monétaires entiers (\`Brand\<number, 'Centimes'\>\`, \`Brand\<number, 'Bps'\>\`), le validateur mathématique ICE 15 chiffres et RIB marocain 24 chiffres (Modulo 97), ainsi que l'interface complète \`StorageAdapter\` (\`cloudflare\` vs \`standby_vps\`) avec leurs tests unitaires Vitest.\
\
4. PEUPLEMENT DES TABLES DE MÉMOIRE ÉVOLUTIVE :\
- Remplis \`@fisca_master_backlog\` avec la liste complète et atomique des tickets des Vagues 1 à 5 (chaque ticket réalisable en 15-25 min, statut \`TODO\`, \`retry_count = 0\`).\
- Enregistre dans \`@fisca_contracts_registry\` tous les bindings \`wrangler.toml\` de référence (\`CONTROL_PLANE_DB\`, \`R2_LEGAL_VAULT\`, \`INVOICE_SEQUENCER\`, etc.) et les contrats initiaux.\
\
5. VÉRIFICATION DU HARNAIS :\
- Exécute \`pnpm install\` puis \`pnpm verify:fast\` dans le terminal et corrige toute anomalie jusqu'à obtenir 0 erreur et 100 % des tests verts en moins de 5 secondes.\
\
6. PUBLICATION & HANDOFF :\
- Effectue un commit propre (\`chore(foundation): bootstrap fisca monorepo, deterministic harness and shared contracts\`), pousse sur \`origin main\`, exporte une sauvegarde JSON de \`@fisca_master_backlog\` dans \`.meta/backlog-snapshot.json\` (commitée), et mets à jour la section \`01_Executive_Progress\` de \`@FISCA_STATE_AND_HANDOFF\`.

### Prompt 2 — Prompt Maître Universel de Boucle Autonome (S1A à P4-B)

*Ce prompt unique pilote toutes vos sessions de codage en boucle. Remplacez simplement les 4 balises entre crochets par la ligne correspondante du tableau juste en dessous.*

BOUCLE D'INGÉNIERIE AUTONOME FISCA — SESSION \[SESSION_ID\]\
\
1. PÉRIMÈTRE & VERROUILLAGE STRICT :\
- Branche Git dédiée : \`\[BRANCH\]\` (créée depuis \`origin/main\` à jour).\
- Périmètre exclusif autorisé en écriture : \`\[SCOPE_DIRS\]\`.\
- INTERDICTION ABSOLUE de modifier tout fichier situé hors de \`\[SCOPE_DIRS\]\` afin de garantir zéro conflit avec les sessions parallèles.\
- Documents de référence de cette session : \[SESSION_DOCS\] + \`@fisca_master_backlog\` + \`@fisca_contracts_registry\` + \`@FISCA_STATE_AND_HANDOFF\`.\
\
2. INITIALISATION DU SANDBOX :\
- Clone le dépôt \`fisca\` (ou fais \`git fetch origin && git checkout -B \[BRANCH\] origin/main\` si la branche n'existe pas encore, sinon \`git pull origin \[BRANCH\]\`).\
- Exécute \`bash scripts/bootstrap-sandbox.sh\` et vérifie que \`pnpm verify:fast\` passe au vert avant d'écrire la moindre ligne.\
\
3. ALGORITHME DE BOUCLE (LOT DE 5 TÂCHES MAXIMUM PAR INSTANCE) :\
Répète ce cycle exact pour un maximum de 5 tickets consécutifs :\
a) SÉLECTION : Lis \`@fisca_master_backlog\` et sélectionne le prochain ticket \`status == "TODO"\` appartenant à \`\[SESSION_ID\]\` dont les dépendances sont \`DONE\`. S'il n'en reste aucun, passe à l'étape 5.\
b) VERROU : Mets immédiatement la ligne à jour dans \`@fisca_master_backlog\` (\`status = "IN_PROGRESS"\`, \`locked_by_branch = "\[BRANCH\]"\`).\
c) CONSULTATION MCP & SKILLS : Charge le Skill métier requis via Skill Discovery et interroge les serveurs MCP \`Cloudflare Docs\` / \`Context7\` au moindre doute sur une API récente.\
d) TDD & IMPLÉMENTATION COMPLÈTE : Écris d'abord les tests unitaires/fiscaux attendus (en centimes entiers et \`bps\`, zéro règle fiscale codée en dur), puis écris l'implémentation complète de production (zéro stub, zéro \`TODO\`, zéro \`any\`).\
e) HARNAIS DE VALIDATION : Exécute \`pnpm verify:fast\` (et \`xmllint\` ou Playwright si applicable au périmètre).\
- Si ÉCHEC et \`retry_count \< 3\` : incrémente \`retry_count\`, analyse la trace console réelle et corrige le code (interdiction formelle d'affaiblir ou de supprimer un test).\
- Si ÉCHEC atteint 3 tentatives (CIRCUIT BREAKER) : exécute \`git checkout -- . && git clean -fd\`, passe le ticket à \`status = "BLOCKED"\` dans \`@fisca_master_backlog\`, documente la cause exacte dans la section \`04_Circuit_Breaker_Blockers\` de \`@FISCA_STATE_AND_HANDOFF\`, et passe au ticket indépendant suivant.\
f) COMMIT ATOMIQUE & CONTRATS : Dès que le harnais est 100 % vert, ajoute toute nouvelle route API, table D1 ou binding dans \`@fisca_contracts_registry\`, fais un \`git commit\` atomique référençant le \`task_id\`, exécute \`git push -u origin \[BRANCH\]\`, et passe le ticket à \`status = "IN_REVIEW"\` (\`tests_green = true\`, \`commit_url\` renseigné).\
\
4. AUTO-DÉLÉGATION À CONTEXTE FRAIS (CONTINUATION DE LA BOUCLE) :\
- Après avoir validé et poussé 5 tickets, mets à jour \`@FISCA_STATE_AND_HANDOFF\`.\
- S'il reste des tickets \`TODO\` pour \`\[SESSION_ID\]\` dans \`@fisca_master_backlog\`, déclenche immédiatement une \*\*Self-delegation\*\* vers une nouvelle instance fraîche de toi-même en lui transmettant ce même mandat pour traiter le lot des 5 tickets suivants sans aucune dégradation de contexte.\
\
5. CLÔTURE DE SESSION :\
- Lorsque 100 % des tickets de \`\[SESSION_ID\]\` sont \`IN_REVIEW\` (ou \`BLOCKED\`), ouvre ou mets à jour la Pull Request de \`\[BRANCH\]\` vers \`main\` sur GitHub avec le récapitulatif complet des tests exécutés, exporte \`.meta/backlog-snapshot.json\`, mets à jour \`@FISCA_STATE_AND_HANDOFF\` et arrête la boucle.

**Tableau des valeurs exactes à injecter dans le Prompt 2 pour chaque session :**

| ID Session | Agent à Sélectionner | Valeur \[BRANCH\] | Valeur \[SCOPE_DIRS\] | Rubric Cible |
|----|----|----|----|----|
| **S1A** | Fisca-Core-Backend-Fiscal | feat/w1-ledger-e2ee | packages/db-schema, packages/crypto-e2ee, apps/api-hono/src/auth | R1 + R2 |
| **S1B** | Fisca-Core-Backend-Fiscal | feat/w1-cgi-ast-seq | packages/fiscal-ast, apps/api-hono/src/durable-objects, apps/api-hono/src/routes | R1 + R2 |
| **P2-A** | Fisca-Containers-EDI-ERP | feat/w2-clearance-vault | containers/fiscal-java, packages/ubl-xades, packages/vault-merkle | R1 + R2 |
| **P2-B** | Fisca-Frontend-Mobile-Growth | feat/w2-ui-pme | packages/ui-mercury, packages/i18n, apps/web-saas/src/pme, apps/web-saas/src/shared | R3 |
| **P2-C** | Fisca-Frontend-Mobile-Growth | feat/w2-astro-growth | apps/marketing-astro | R3 |
| **P3-A** | Fisca-Containers-EDI-ERP | feat/w3-simpl-edi | packages/edi-simpl, packages/fec-auditor | R1 |
| **P3-B** | Fisca-Core-Backend-Fiscal | feat/w3-ai-agents-mcp | containers/docling-python, packages/ai-agents, apps/api-hono/src/mcp | R1 + R2 |
| **P3-C** | Fisca-Containers-EDI-ERP | feat/w3-erp-connectors | connectors/odoo-l10n-ma, connectors/sage100-dotnet, containers/camel-bridge | R1 + R2 |
| **P4-A** | Fisca-Frontend-Mobile-Growth | feat/w4-portals-mobile | apps/web-saas/src/fiduciary, apps/web-saas/src/enterprise, apps/mobile-capacitor | R2 + R3 |
| **P4-B** | Fisca-Core-Backend-Fiscal | feat/w4-fintech-failover | packages/billing-metering, packages/factorflow, apps/standby-vps | R1 + R2 |

### Prompt 3 — Barrière Qualité & Fusion (Gates G1 à G4 et S5)

*À lancer à la fin de chaque vague avec l'agent **Fisca-QA-Security-Auditor** (GPT-6 Astra, Effort High).*

AUDIT INDÉPENDANT MAKER-CHECKER — BARRIÈRE QUALITÉ \[NOM_VAGUE\]\
\
Branches Pull Requests à auditer : \`\[LISTE_BRANCHES_VAGUE\]\`\
Tables & Référentiels : \`@fisca_master_backlog\`, \`@fisca_contracts_registry\`, \`@FISCA_STATE_AND_HANDOFF\`.\
\
Tu es l'Auditeur Indépendant. Tu n'as PAS écrit ce code. Ta mission est de chercher impitoyablement toute faille avant d'autoriser la fusion sur \`main\` :\
\
1. Pour chaque branche listée, fais un \`git checkout\` propre dans le sandbox et teste sa fusion à blanc avec \`origin/main\` (\`git merge --no-commit --no-ff origin/main\`) pour vérifier l'absence totale de conflit.\
2. Exécute l'intégralité du harnais :\
- \`pnpm verify:fast\` (0 erreur TypeScript, 0 warning ESLint, 0 stub/TODO, 100 % des tests Vitest).\
- Si la branche touche aux flux XML/EDI : valide chaque sortie générée contre son schéma \`.xsd\` avec \`xmllint --noout --schema\`.\
- Si la branche touche au Frontend/Astro : démarre le serveur local et vérifie avec le navigateur headless Playwright l'affichage Desktop (\`1440px\`) et Mobile (\`375px\`), le mode clair/sombre, l'alignement \`tabular-nums\`, le RTL Arabe/Darija et la séparation stricte 6 langues (Astro/PME) vs 3 langues (Fiduciaire/Corporate).\
- Vérifie qu'aucune requête SQL Drizzle ne lit ou n'écrit dans \`TENANT_DB\` sans isolation stricte et qu'aucun outil IA n'accepte \`tenant_id\` depuis le LLM.\
3. Pour chaque ticket en statut \`IN_REVIEW\` de cette branche :\
- Si 100 % conforme : passe son statut à \`DONE\` dans \`@fisca_master_backlog\`.\
- À la moindre anomalie : repasse le ticket à \`TODO\` avec la consigne précise de correction dans la PR et refuse la fusion.\
4. Génère ton rapport d'audit structuré pour évaluation par les Rubrics épinglées (score exigé : 95/100 minimum). Si et seulement si tous les contrôles sont au vert, délègue à \`@Fisca-Lead-Orchestrator\` la fusion propre de la PR sur \`main\`.

### Prompt 4 — Relais Nocturne Automatique (Schedule toutes les 2h & Consolidation 04h00)

*À placer dans **Invocations → Schedules** de l'agent constructeur actif pendant une nuit de codage :*

REPRISE AUTOMATIQUE DE BOUCLE PLANIFIÉE :\
1. Consulte \`@fisca_master_backlog\` pour la session active \`\[SESSION_ID\]\` sur la branche \`\[BRANCH\]\`.\
2. Si tous les tickets de \`\[SESSION_ID\]\` sont déjà à \`IN_REVIEW\` ou \`DONE\`, termine immédiatement sans aucune action.\
3. Si un ticket est resté figé à \`IN_PROGRESS\` suite à une expiration de tour précédente, vérifie \`git log -n 3 origin/\[BRANCH\]\` : reprends proprement depuis le dernier commit valide et relance l'algorithme du Prompt Universel de Boucle pour un nouveau lot de 5 tickets.

*(Et sur l'agent **Fisca-Wiki-Memory-Curator**, programmez un Schedule quotidien à 04h00 avec la consigne : « Exporte @fisca_master_backlog et @fisca_contracts_registry en JSON dans .meta/ sur GitHub, archive les mémoires doublons éventuelles et mets à jour la synthèse d'architecture dans l'Autowiki »).*

La **Phase A (Préparation complète de Hyperagent, Skills, Mémoires, Agents, MCP, Vagues parallèles et Prompts de boucle)** est désormais intégralement bouclée. Conformément à notre plan séquentiel, donnez-moi votre autorisation explicite pour passer à la **Phase B** et rédiger dans le prochain message le **Document 01 : PRD Maître Fisca (Product Requirements Document)**.

**LES 18 DOCUMENTS DU PROJET**

Je vais te donner Les Documents 01 à 18 qui constituent la base de connaissances de référence de votre projet dans **Hyperagent.com**, mais ils ne doivent jamais être injectés tous ensemble dans une même conversation sous peine de saturer la mémoire des modèles.

**Injection ciblée par session de codage :** Lorsque vous lancez une session avec le Prompt Maître Universel, mentionnez dans la variable des documents de session uniquement les **3 à 5 documents** utiles à cette branche:

| **Surface ou Session** | **Rôle vis-à-vis des Documents** | **Documents Attachés (Aperçu Actuel)** | **Raison Technique** |
|----|----|----|----|
| **Knowledge Projet** | Coffre central versionné | Tous les Documents 01 à 18 | Édition par section avec historique |
| **Session S0 (Amorçage)** | Architecture et Backlog | Doc 01, Doc 04, Doc 06, Doc 14, Doc 15 | Crée l'arborescence et les tickets |
| **Sessions Backend / SQL** | Moteurs CGI, CGNC et E2EE | Doc 02, Doc 04, Doc 06, Doc 10 | Transitions, triggers et crypto |
| **Sessions Frontend / POS** | Interfaces Web, Mobile et Caisse | Doc 01, Doc 02, Doc 08 | Parcours métiers, états et design |
| **Barrières QA (Auditeur)** | Vérification Maker-Checker | Documents de la branche auditée | Contrôle la conformité sans biais |
