# Règles actives issues des mémoires Hyperagent (migration 2026-11-18)

Complète `AGENTS.md` (constitution, qui prime). Toujours chargé par Antigravity (`.agents/rules/`). Détail : `docs/memoire/INDEX.md`.

Langue : répondre et livrer en français (docs, prompts, rapports). Les identifiants de code restent en anglais.
Détail de chaque règle : fiches dans `docs/memoire/` (index : `docs/memoire/INDEX.md`; skill `fisca-project-memory`).

## 1. Identité
- Fisca (fisca.ma) : SaaS marocain de facturation électronique, édité par **SYNAPTIC SYSTEMS SARL AU**, siège social et Tribunal de Commerce de **Rabat**, assujettie TVA 20 %. → `docs/memoire/organization/m01-identite-legale.md`
- Dépôt privé `anasse84/fisca`, branche `main`, pnpm + Turborepo. Topologie : `docs/memoire/project_context/m02-topologie-monorepo.md`.
- Taux de TVA depuis 2026 : 20 %, 10 %, 0 % seulement (7 % et 14 % supprimés). → fiche M10.

## 2. Invariants (jamais enfreindre)
- Montants en **centimes entiers** (integer), taux en **bps**. **Zéro flottant monétaire.** Calculs sensibles (ex. clé RIB) en **BigInt**.
- **Zéro règle fiscale codée en dur** : tout vient des tables D1 alimentées par le LLM Wiki ; ne jamais coder une date ou un seuil de la réforme. → `preference/m04-invariants-math-loi.md`
- **Isolation : une base Cloudflare D1 par société cliente**, dès le plan Solo (jurisdiction eu sur R2/D1) ; toute écriture passe par `StorageAdapter`. → `project_context/m03-isolation-portabilite-d1.md`
- **Fail-closed** : si une spec est plus lâche qu'une exigence d'intégrité/immutabilité du pilote, implémenter la règle la plus stricte et consigner l'écart dans `FISCA_STATE_AND_HANDOFF` section 04. Sans `MandateResolver`, l'accès cabinet est refusé. → `preference/fail-closed-regle-la-plus-stricte.md`, `project_context/tenant-router-membership-mandate-resolver.md`
- Grand livre : tout garde sur écriture POSTED / exercice CLOSED couvre **tous** les chemins d'écriture (pas seulement INSERT), mêmes messages d'erreur SQLite et PL/pgSQL ; unicité par index UNIQUE ; sérialisation (advisory lock) sur PostgreSQL. → `domain_knowledge/ledger-immutabilite-tous-chemins-ecriture.md`
- `pii_restricted_flag` est **monotone** (0→1 seulement, 1→0 refusé) sur TOUTE table qui le porte, par triggers SQLite et PL/pgSQL au même texte d'erreur. → `preference/pii-restricted-flag-monotone.md`
- Idempotency-Key 72 h : table `idempotency_keys` dans TENANT_DB (pas en KV), même lot atomique que l'écriture comptable ; même clé + empreinte différente → 422. → `project_context/idempotency-key-table-tenant-db.md`
- Empreintes chaînées (SHA-256 de `JSON.stringify([...])`, genèse, vecteur d'or) : `project_context/empreintes-chainees-h1.md`.
- CGNC : TVA récupérable sur charges → **34552**, sur immobilisations → **34551** ; 34558/44551/44558 = subdivisions analytiques Fisca (`is_official_cgnc_base=false`). → `domain_knowledge/cgnc-tva-recuperable-34551-34552.md`, `project_context/cgnc-sous-comptes-analytiques-tva-encaissement.md`
- Mandats cabinets : table `company_cpa_mandates` (CONTROL_PLANE_DB) ; vecteurs AST POSITIVE_NOMINAL / NEGATIVE_COUNTEREXAMPLE / BOUNDARY_LIMIT. → `project_context/mandats-cpa-et-vecteurs-ast-h2-h3.md`
- En-tête `X-Fisca-Company-Id` : voir §6 (point à trancher). RIB marocain (Modulo 97, BigInt) : `project_context/rib-marocain-decision-proprietaire-a.md` et `domain_knowledge/rib-marocain-decision-proprietaire-b-livre.md`. Garde SQL Sage 100 (WITH (NOLOCK) par table, lecture seule) : `domain_knowledge/garde-sql-sage100-adr-11.md`.
- Facturation électronique : schémas DGI non publiés ; contrats `PROVISIONAL`, profil `cius-ma-provisional`, `ClearanceGateway` simulée ; ne jamais présenter un schéma provisoire comme officiel ni écrire « conforme/homologué DGI ». → `active_work/prerequis-externes-2026-11-13.md`

## 3. Ordre de préséance
1. `docs/specs/ERRATA.md` (sur `main`) prime sur les documents d'arbitrage du propriétaire, sur les 18 spécifications et sur les skills.
2. `docs/orchestration/pilotage-automatique.md` prime sur les skills (`fisca-factory-runbook`, `fisca-harness-gatekeeper`).
3. En cas de divergence entre relais du pilote, le plus récent l'emporte. Le dépôt (git, `FISCA_STATE_AND_HANDOFF` section 01) prime sur toute mémoire : revérifier dans git avant d'agir.
→ `project_context/preseance-pilotage-errata.md`, `preference/errata-prime-sur-arbitrages-proprietaire-a.md`, `tools_and_workflows/errata-prime-sur-arbitrages-proprietaire-b.md`
Cas connus : l'auditeur ne fusionne jamais (seul `Fisca-Lead-Orchestrator` fusionne, A-03) ; S1B est empilée sur S1A, pas de remédiation parallèle (B-04) ; « verify:fast < 5 s » est une cible, pas un critère (B-08) ; noms d'agents réels (A-01) : Fisca-Core-Backend-Fiscal, Fisca-Containers-EDI-ERP, Fisca-Frontend-Mobile-Growth (détail : `project_context/referentiel-v2-sessions-agents-branches.md`).

## 4. Décisions permanentes du pilote
- **Test lent ou instable : corriger à la racine**, jamais relever un timeout vitest ; preuve déterministe exhaustive plutôt qu'échantillonnage ; générateur injecté à graine fixe, jamais `Math.random` ; prod : `crypto.getRandomValues`. → `preference/test-lent-corrige-a-la-racine.md`
- **Reprise après audit** : ticket refusé → test de régression red-first reproduisant le cas de l'auditeur ; retour `IN_REVIEW` seulement si `review_notes` citent ce test et son échec initial ; ne jamais écrire dans `packages/qa-harness/src/adversarial` ; migrations livrées jamais modifiées (nouvelle version) ; 3 passes `pnpm verify:fast` complètes (exit 0) avant clôture. Refus d'audit = ticket remis à TODO avec `review_notes`. → `tools_and_workflows/protocole-reprise-apres-audit.md`
- **Run sans cache** : `TURBO_FORCE=true pnpm verify:fast` (et non `-- --force`). → `tools_and_workflows/verify-fast-sans-cache-turbo-force.md`
- **Escalade d'ambiguïté de spec** (section 04 de `FISCA_STATE_AND_HANDOFF`) : (1) question précise, (2) les deux lectures avec citation exacte de la spec ; garder l'implémentation actuelle marquée provisoire ; les contradictions de spec vont au propriétaire ; question vague = « mal posée ». Alias : `SPEC_AMBIGUITY`. → `preference/format-escalade-ambiguite-spec.md`
- **SEAM_REQUEST** : si un contrat gelé de `packages/shared-types` bloque, déposer une demande précise (fichier + changement), sans contournement. → `project_context/rulings-pilote-company-id-uuid-problem-details.md`
- Tests de routes `api-hono` : à côté du code (`apps/api-hono/src/routes/<nom>/*.test.ts`), pas dans `apps/api-hono/tests/` (scope guard). → `tools_and_workflows/scope-guard-tests-routes.md`
- UI : **aucun libellé de repli ni texte français par défaut** ; props de libellés typées obligatoires ; clé i18n manquante = échec build/test (6 langues fr, ar, ary, zgh-Latn, zgh-Tfng, en). `--brand-indigo` jamais pour du texte (contraste ~4,3:1 en sombre) : icônes, bordures, focus seulement. → `preference/i18n-ui-mercury-zero-label-par-defaut.md`, `preference/ui-mercury-brand-indigo-contraste.md`, `preference/m09-politique-des-langues.md`
- Frontend/mobile : routes existantes = contrats gelés (surtout la route de pairing appareil/compte) ; diff limité aux fichiers nommés. → `domain_knowledge/routes-gelees-pairing-frontend-mobile.md`
- Session : réécrire la ligne **« État pilote: »** (date, phase, états, bloqueurs, prochaine action + responsable) à chaque fin de session ; la lire au début. → `project_context/etat-pilote-ligne-handoff-session.md`
- Les sessions ne lisent que 3 à 5 spécifications (matrice) + ERRATA ; spécifications dans `docs/specs/`. → `preference/matrice-sessions-specs-a-lire.md`, `project_context/specs-18-documents-emplacement.md`

## 5. Règles de ticket `in_review` (frontend/mobile/growth)
Passer en `in_review` est un handoff, pas un changement de statut : lien PR/branche/commit ; correspondance critère par critère ; preuves (tests, captures web/iOS/Android, événements analytics) ; limites connues ; instructions de relecture (étapes, flags, rollback) ; relecteur nommé ; commentaire posté dans la même action que le changement ; relire le ticket après. Cycle `todo → in_progress → in_review → done`, jamais d'auto-approbation. Travail incomplet ou bloqué : `in_progress`/`blocked` avec commentaire. Refus de relecture : retour `in_progress`, nouveau handoff. → `domain_knowledge/ticket-in-review-gate-handoff-a.md`, `…-b.md`

## 6. Sécurité Git et autonomie
Opérer en autonomie, sans demander d'approbation, dans ces limites dures : fusion sur `main` réservée à `Fisca-Lead-Orchestrator` (via Pull Request, 0 approbation requise car un seul compte `anasse84`, barrière = note d'audit ≥ 95/100) ; **jamais de force-push, jamais de suppression de dépôt** ; l'auditeur est en lecture seule et se termine par la ligne `VERDICT`. La fusion se constate dans git (branche ancêtre de `origin/main`), jamais par le seul statut d'un ticket. → `preference/autonomie-sans-approbation.md`, `project_context/github-protection-main-0-approbation.md`
État du dépôt au 2026-11-15 : vagues 0-2 fusionnées (66/132 tickets DONE), pilotage ARRÊTÉ, vague 3 et jonction J2 seulement sur autorisation expresse du propriétaire ; reprise = lire `docs/orchestration/prerequis-proprietaire.md`, `preparation-vague-3.md`, puis `CONTINUE`. À revérifier dans git. → `project_context/etat-depot-2026-11-15.md`

**Point ouvert (contradiction entre mémoires)** : `X-Fisca-Company-Id` — décision propriétaire = regex `[A-Za-z0-9_-]{1,64}`, écart à Doc_07 §01 à consigner section 04 (`project_context/header-company-id-format-proprietaire.md`) ; règle du pilote = UUID (UUIDv7) à la frontière HTTP, regex large conservée pour les couches internes (`project_context/rulings-pilote-company-id-uuid-problem-details.md`). Appliquer le rôle des deux : UUID en frontière HTTP, regex en interne, et faire confirmer par le propriétaire.

## 7. À NE PAS reprendre (propre à Hyperagent)
Non applicable à Antigravity (fiches dans `docs/memoire/_historique-hyperagent/`) : modèle imposé Claude Sonnet 5.5 / mode Manuel ; rapport d'exécution du curateur obligatoirement en anglais (règle des juges Hyperagent) ; blocage réseau npm et `RequestNetworkAccess` ; limite « Spawn depth cap » (un fil ne peut ni ouvrir de fil ni programmer de rappel), sous-agents `task`, `SendThreadMessage`, tours d'une heure ; tables Hyperagent en lecture seule hors fil propriétaire ; Schedule/mode Live limités en écriture ; politique d'accès/approbations Hyperagent. Ne pas en déduire de contraintes pour agy.

## 8. Secrets
Aucun secret ni jeton dans ce dépôt ni dans les fiches. Le jeton GitHub (expire le 2026-12-12, sans permission Workflows, requise par P4-C) se configure hors dépôt.
