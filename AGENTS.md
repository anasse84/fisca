# AGENTS.md — Constitution du monorepo Fisca (fisca.ma)

Éditeur : **SYNAPTIC SYSTEMS SARL AU** (Rabat, Maroc). Ce fichier gouverne tous les agents IA (Hyperagent, Claude Code, ZCode) qui travaillent sur ce dépôt. Il est protégé : seul Fisca-Lead-Orchestrator le modifie (mode `FISCA_ORCHESTRATOR_MODE=1`), sur décision du propriétaire.

## 1. Rôle et hiérarchie de lecture

- Cette constitution est lue avant toute lecture ou écriture de code. `CLAUDE.md` renvoie ici : un seul texte pour tous les harnais.
- Préséance des sources (la plus haute l'emporte) : 1) `docs/specs/ERRATA.md` ; 2) tables `fisca_master_backlog` et `fisca_contracts_registry`, et `.meta/session-scopes.json` ; 3) `docs/orchestration/` ; 4) `docs/specs/01` à `18` ; 5) tout document antérieur (périmé là où il diffère).
- Une contradiction que l'ERRATA ne tranche pas ne se devine pas : ticket `BLOCKED` (`SPEC_AMBIGUITY`), question précise dans `04_Circuit_Breaker_Blockers`, passage au ticket indépendant suivant.
- Niveaux d'instruction : cette racine (lois globales, commandes, sécurité), puis un satellite par sous-système, lu en entrant dans le dossier : `packages/db-schema/AGENTS.md`, `containers/AGENTS.md`, `apps/web-saas/AGENTS.md`. Un satellite précise, il n'assouplit jamais une interdiction d'ici.
- La preuve console prime sur le prompt : on interroge les tables et on lance `pnpm verify:fast` au lieu de deviner une signature ou un comportement métier.
- Les spécifications se lisent dans `docs/specs/`, section par section, seulement celles de ta session (matrice de `docs/orchestration/README.md`).

## 2. Agents réels

`Fisca-Lead-Orchestrator` (pilote, seul à fusionner), `Fisca-Core-Backend-Fiscal`, `Fisca-Containers-EDI-ERP`, `Fisca-Frontend-Mobile-Growth`, `Fisca-QA-Security-Auditor` (lecture seule sur GitHub, rend un verdict), `Fisca-Wiki-Memory-Curator` (recoupe l'état chaque nuit). Les anciens noms des documents sont des alias (`.meta/session-scopes.json`, `agent_aliases`).

## 3. Topologie verrouillée

Chaque session n'écrit que dans le `scope_dirs` de sa ligne de `.meta/session-scopes.json`, plus `pnpm-lock.yaml` et `.meta/`. Le garde de périmètre échoue sur une branche inconnue (`ERR_SCOPE_UNDEFINED`).

- **Socle** (S0, vague 1, gelé ensuite sauf ticket d'orchestration) : `packages/shared-types`, `packages/db-schema`, `packages/auth-rbac`, `packages/crypto-e2ee`, `packages/compliance-cndp`, `packages/qa-harness`.
- **Backend edge, IA, fintech** : `apps/api-hono`, `apps/standby-vps`, `packages/fiscal-ast`, `packages/ai-agents`, `packages/billing-metering`, `packages/factorflow`, `packages/pra-reversibility`, `packages/external-integrations`, `ops/`.
- **Clearance, EDI, ERP** : `containers/fiscal-java`, `containers/docling-python`, `containers/camel-bridge`, `packages/ubl-xades`, `packages/vault-merkle`, `packages/edi-simpl`, `packages/fec-auditor`, `connectors/odoo-l10n-ma`, `connectors/sage100-dotnet`.
- **Acquisition, SaaS, mobile, caisse** : `apps/marketing-astro`, `apps/web-saas`, `apps/pos-pwa`, `apps/mobile-capacitor`, `packages/ui-mercury`, `packages/i18n`.
- **Socle partagé (D-07)** : `packages/shared-types/src/fsm-engine.ts`, `infra-adapter.ts` (interface `FiscaInfrastructureAdapter`), `invariants.ts`, `api-contracts.ts`.
- **Branches** : S0 sur `feat/w0-foundation` ; S5 sur `feat/w5-release-v1.0.0` ; les autres sessions sur leur branche `feat/*` de `.meta/session-scopes.json`. Seules les branches `feat/*` et `fix/*` sont poussées. `audit/gate-N` est locale à l'auditeur, jamais poussée.
- **Jonctions (B-02)** : `apps/web-saas` charge ses surfaces par `import.meta.glob` ; `apps/api-hono` monte ses routes par le manifeste généré (`pnpm gen:routes`, fichier ignoré par Git). Une route ne contient que de la colle : logique et dépendances tierces vivent dans un paquet du périmètre. Une session au périmètre partiel peut ajouter des dépendances au `package.json` englobant, rien d'autre.
- Besoin d'écrire hors périmètre : `SEAM_REQUEST` (nomme le fichier et le changement), sans écrire.

## 4. Les 10 lois inviolables

1. **Zéro flottant monétaire (ADR-03).** Centimes entiers (`_cents`), points de base (`_bps`), milli-unités (`_milli`), micro-unités BAM (`_micro`). Toute division passe par `divRoundHalfUpBigInt` (D-09). `Math.trunc(x / 100)` et `%` ne sont admis que pour l'affichage.
2. **Zéro règle fiscale codée en dur (ADR-04).** Taux, plafonds (espèces, RAS-TVA art. 117, loi 69-21) et cellules SIMPL viennent des tables AST en D1, règles datées. Dès 2026, `vat_rate_bps` ∈ {2000, 1000, 0} ; un taux antérieur est converti avant enregistrement (D-04). Aucune date d'obligation ni seuil de la réforme de facturation électronique n'est codé en dur (B-13).
3. **Grand livre CGNC immuable (ADR-05).** Aucun contournement des triggers qui interdisent l'UPDATE et le DELETE d'une pièce `POSTED`. La correction est une contre-passation, nouvelle écriture liée par `reversal_of_entry_id`, jamais un changement de statut (D-03). Caisse `5161` jamais négative ; TVA sur encaissement par `44558` / `34558` jusqu'au lettrage.
4. **Isolation D1 par société et auth 2FA (ADR-02, Doc_09).** Une base par société, résolue côté serveur après authentification, contrôle RBAC/ABAC et séparation des tâches. `X-Fisca-Company-Id` sélectionne un dossier parmi ceux de l'utilisateur, le serveur le vérifie puis résout la base (D-16). Jamais de `tenantId` ni `companyId` dans un schéma d'outil IA ou MCP. Mots de passe : PBKDF2-HMAC-SHA512 (D-01).
5. **Cryptographie, E2EE, souveraineté (Doc_10, Doc_11).** WebCrypto pur ; AAD `companyId|tableName|recordId|columnName` sur chaque champ `_enc` ; index aveugle HMAC-SHA256 sur `_bidx` ; une racine de Merkle par jour sur R2 UE ; séquestre de Shamir 2-sur-3 ; anonymisation en RAM avant tout appel IA de niveau 2 ; zéro sortie hors Maroc en mode `STRICT_DGSSI_LAW_05_20_MOROCCO`.
6. **Gouvernance IA (ADR-10, Doc_13).** `canMutateLedgerDirectly = false`. Paliers de coût (code pur, vision rapide, escalade). Jamais de montant illisible deviné, tout lettrage ambigu isolé en `3497` / `4497`, jamais de cause d'écart inventée, dernier échange vérifié avant relance.
7. **Portabilité et continuité (ADR-12, Doc_11, Doc_12).** Accès infra par `FiscaInfrastructureAdapter`. L'export décennal ISO 14641 reste ouvert même en lecture seule à J+15 (calendrier de relance J0, J+3, J+7, J+12, D-05).
8. **Design Mercury et langues (Doc_08).** Variables CSS clair/sombre, classes logiques RTL/LTR, `tabular-nums` et `dir="ltr"` sur montants, ICE et RIB. 6 langues sur Astro, PME et POS ; 3 (`fr`, `ar`, `en`) sur Fiduciaire et Corporate.
9. **ERP et POS (ADR-01, ADR-11).** Sage 100 : lecture `WITH (NOLOCK)`, écriture par `IPMEncoder` ou fichier `.PNM` de 108 caractères, jamais de SQL d'écriture direct ; `Objets100cLib` reste derrière `ISageWriter` (B-14). POS : ticket signé hors ligne en ECDSA P-256 non extractible, comptage aveugle, extourne B2C atomique sur conversion QR après Ticket Z.
10. **Zéro code factice, périmètre exclusif (Doc_14).** Ni `TODO`, `FIXME`, `HACK`, `PLACEHOLDER`, `any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, test `.skip` ou `.only`, ni valeur simulée en production. Le test s'écrit avant le code et ne s'affaiblit jamais pour passer au vert. Aucune écriture hors périmètre ; aucune modification des fichiers protégés (§ 8).

**Frontières légales (Doc_01)** : aucun encaissement pour compte de tiers ni crédit sur bilan propre (loi 103-12), aucun visa relevant du monopole OEC (loi 15-89), aucune revente des PDF OMPIC. Interdit d'écrire, dans l'interface, le site ou la documentation, que Fisca est « conforme », « homologué » ou « certifié » par la DGI ou xHub ; tant que seul le pilote `simulated` existe, l'état affiché est « Validation simulée » (B-13).

## 5. Commandes canoniques

Les budgets de temps et les décomptes de tests sont des **cibles** (B-08) : la condition de passage est code de sortie 0, tous les tests verts, tous les scénarios nommés couverts. Un dépassement se note, il ne bloque pas.

| Commande | Usage |
|---|---|
| `pnpm install` | Dépendances ; seule façon de résoudre un conflit de `pnpm-lock.yaml` (B-01) |
| `pnpm verify:fast` | Avant chaque commit : typecheck, lint, tests unitaires (cible : moins de 5 s) |
| `pnpm -r typecheck` | Typage de tous les workspaces |
| `pnpm --filter @fisca/<nom> test` | Tests d'un paquet, avant chaque push |
| `pnpm test` | Tests de tous les workspaces |
| `pnpm gen:routes` | Régénère le manifeste de routes de `apps/api-hono` |
| `bash scripts/harness-check.sh` | Vérification de gouvernance (écrit par un autre ticket) |

Commandes citées par les spécifications et **pas encore présentes** dans `package.json` ou `scripts/` (autres tickets) : `bash scripts/bootstrap-sandbox.sh`, `pnpm test:xsd`, `pnpm verify:gate`, `scripts/enforce-constitution.ts`. Ne pas en inventer la sortie ; si l'une manque encore à l'exécution, note-le au lieu de la simuler.

Sandbox (B-07) : Amazon Linux 2023, `dnf` et non `apt-get`, pas de Docker. Les conteneurs se testent par leur code (Maven, pytest, xUnit), pas par `docker build`.

## 6. Protocole de boucle et disjoncteur

Détail dans `docs/orchestration/protocole-boucle.md`. Cycle d'un ticket :

1. Prendre le ticket `TODO` de ta session, de plus petit `task_id`, dont les dépendances sont satisfaites : `DONE`, ou `IN_REVIEW` avec commit ancêtre de ta branche (B-04). Passer à `IN_PROGRESS`, verrou `locked_by_branch`.
2. Lire seulement les sections de spécification du ticket et les `review_notes`.
3. Test d'abord, implémentation complète, puis `pnpm verify:fast` et le `verify_cmd` du ticket. Ton propre rerun fait preuve, pas le rapport d'un sous-agent.
4. Inscrire chaque contrat créé (route, table, binding, file) dans `fisca_contracts_registry` ; lire les noms existants au registre, jamais les deviner. `openapi.json` n'est pas commité (D-18).
5. Commit `<type>(<paquet>): <résumé> [<task_id>]`, push sur ta branche, ticket `IN_REVIEW`.

**Disjoncteur** : au troisième échec de vérification sur le même ticket, `git checkout -- . && git clean -fd`, statut `BLOCKED`, verrou vidé, trace (commande, 20 dernières lignes, essais, hypothèse) dans `04_Circuit_Breaker_Blockers`, puis ticket indépendant suivant. Blocage immédiat sans consommer d'essai : `SPEC_AMBIGUITY`, `MISSING_INPUT` (secret, accès), `SEAM_REQUEST`. L'absence d'un schéma officiel DGI ou xHub n'est **pas** un blocage : régime provisoire de B-13 (contrat `PROVISIONAL`, mention « conformité officielle non vérifiée »).

Continuité : le pilote relance les fils (B-15) ; ne programme aucun rappel dans un fil piloté, n'ouvre aucun fil neuf, ne compte pas sur un Schedule (B-05, B-06). Termine le tour par `ETAT <SESSION_ID> : <n> IN_REVIEW, <m> BLOCKED, <k> TODO`. Chaque vecteur d'or porte l'article de loi, la date et l'état `RECOUPÉ`, `NON RECOUPÉ` ou `PROVISOIRE` ; l'auteur des vecteurs est la session qui écrit la règle, dans `<paquet>/tests/golden/*.vectors.json` (B-09).

## 7. Liste noire anti-hallucination

- Inventer une balise XML absente du schéma (officiel, ou provisoire du dépôt), un endpoint, un en-tête, un code retour ou un nom de table, file ou binding absent du registre. Présenter un schéma provisoire comme officiel.
- Modifier dans `packages/qa-harness` la valeur attendue d'un vecteur fiscal ; affaiblir un test ; caster en `any`.
- Écrire du code « de référence » des spécifications sans appliquer leurs errata (D-09, D-12, section C).
- Coder en dur une date d'obligation, un taux directeur ou un seuil de la réforme.
- Fabriquer une sortie de commande ou déclarer « vert » sans l'avoir exécutée.
- Marquer `DONE` un ticket de barrière : la fusion se constate dans git (B-16).

## 8. Sécurité Git

- Jamais de `git push --force` ni `--force-with-lease`, jamais de suppression de dépôt ni de branche distante, jamais de `git reset --hard` sur une branche partagée.
- Jamais d'écriture directe sur `main` : tout passe par Pull Request depuis une branche `feat/*` ou `fix/*`. Premier push de session : Pull Request en brouillon.
- **Seul `Fisca-Lead-Orchestrator` fusionne**, par commit de fusion et jamais par squash (B-16), après lecture du verdict de l'auditeur (dernière ligne : `VERDICT <barrière> : FAVORABLE` ou `DÉFAVORABLE`, A-03). L'auditeur ne fusionne ni ne pose de tag ; `v1.0.0` est posé par l'orchestrateur après le certificat final.
- Jamais de secret, de `.env` ni de clé dans le dépôt. Aucun fichier sous `.github/workflows/` hors ticket P4-C (B-12).
- **Fichiers protégés** (liste de `.meta/session-scopes.json` ; hors mode orchestrateur, aucune modification ; les satellites suivent la même règle) : `AGENTS.md`, `CLAUDE.md`, `scripts/harness-check.sh`, `scripts/enforce-constitution.ts`, `packages/qa-harness/src/fiscal-golden-suite.ts`, `.meta/session-scopes.json`, `docs/specs/`. Après une barrière, changer une valeur attendue d'un vecteur exige le mode orchestrateur.
- Avant la mise en production (v1.0.0), aucune donnée de production n'existe : aucune migration ne porte `[BREAKING_MIGRATION]` (B-11).
