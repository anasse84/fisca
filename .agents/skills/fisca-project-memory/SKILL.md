---
name: fisca-project-memory
description: Mémoire de projet Fisca exportée d'Hyperagent. À utiliser pour retrouver une décision, un invariant, une règle du pilote, une décision du propriétaire, l'état du dépôt, une grille tarifaire ou une règle comptable CGNC dans docs/memoire/ avant d'agir sur le dépôt anasse84/fisca.
---

# Mémoire de projet Fisca

Les règles toujours actives sont dans `AGENTS.md` (racine). Ce skill sert à retrouver le **détail** : une fiche par mémoire dans `docs/memoire/<categorie>/<slug>.md` (en-tête YAML : id_source, category, importance, tags, whenToUse, dates ; puis contenu intégral).

## Procédure
1. Lire `docs/memoire/INDEX.md` (table id_source / titre / catégorie / importance / quand l'utiliser / chemin) ou chercher un mot-clé : `grep -ril "<mot>" docs/memoire/`.
2. Ouvrir la fiche ; lire d'abord `whenToUse` et la date. Une mémoire est un instantané : revérifier dans git et `FISCA_STATE_AND_HANDOFF` avant d'agir.
3. Préséance en cas de conflit : `docs/specs/ERRATA.md` > documents d'arbitrage du propriétaire, spécifications, skills ; `docs/orchestration/pilotage-automatique.md` > skills.
4. `docs/memoire/_historique-hyperagent/` = mémoires propres à Hyperagent, **non applicables à Antigravity** : ne pas les appliquer.

## Mots-clés → fiches
- centimes, bps, flottant, règle en dur, D1, LLM Wiki → `m04-invariants-math-loi`, `m03-isolation-portabilite-d1`
- ERRATA, préséance, arbitrage, A-03, B-04, B-08 → `preseance-pilotage-errata`, `errata-prime-sur-arbitrages-proprietaire-a|b`
- pilote, fusion, auditeur, VERDICT, sessions, S0…S5, G1…G4, branches → `referentiel-v2-sessions-agents-branches`, `etat-depot-2026-11-15`
- audit, régression, red-first, IN_REVIEW, migration → `protocole-reprise-apres-audit`
- test lent, flaky, vitest, Math.random, verify:fast, TURBO_FORCE → `test-lent-corrige-a-la-racine`, `verify-fast-sans-cache-turbo-force`
- ambiguïté, SPEC_AMBIGUITY, section 04, questions au pilote → `format-escalade-ambiguite-spec`
- pii_restricted_flag, CNDP, DSAR → `pii-restricted-flag-monotone`
- grand livre, trigger, POSTED, CLOSED, 5161 → `ledger-immutabilite-tous-chemins-ecriture`
- hash, PIH, genèse, ticket Z, POS → `empreintes-chainees-h1`
- idempotency, TENANT_DB, migration v7 → `idempotency-key-table-tenant-db`
- CGNC, 34551, 34552, 34558, 44558 → `cgnc-tva-recuperable-34551-34552`, `cgnc-sous-comptes-analytiques-tva-encaissement`
- RIB, IBAN, modulo 97, Sage, NOLOCK → `rib-marocain-decision-proprietaire-a|b-livre`, `garde-sql-sage100-adr-11`
- mandat, OEC, TenantRouter, company_cpa_mandates, AST → `mandats-cpa-et-vecteurs-ast-h2-h3`, `tenant-router-membership-mandate-resolver`
- X-Fisca-Company-Id, UUIDv7, RFC 9457, SEAM_REQUEST → `header-company-id-format-proprietaire`, `rulings-pilote-company-id-uuid-problem-details`
- i18n, ui-mercury, label, brand-indigo, contraste → `i18n-ui-mercury-zero-label-par-defaut`, `ui-mercury-brand-indigo-contraste`, `m09-politique-des-langues`
- ticket, in_review, handoff, pairing, État pilote → `ticket-in-review-gate-handoff-a|b`, `routes-gelees-pairing-frontend-mobile`, `etat-pilote-ligne-handoff-session`
- tarif, prix, Mowakaba, fiduciaire, Grands Comptes → `m05`, `m06`, `m07`
- paiement, Payzone, OTP, Infobip, SES → `m08-fournisseurs-tiers`
- monorepo, arborescence, specs, matrice des documents → `m02-topologie-monorepo`, `specs-18-documents-emplacement`, `matrice-sessions-specs-a-lire`
- DGI, XSD, jeton GitHub, protection de main → `prerequis-externes-2026-11-13`, `github-protection-main-0-approbation`, `autonomie-sans-approbation`
- curation wiki/mémoire → `curateur-*`

## Index par thème
### Historique Hyperagent (non applicable)
- `docs/memoire/_historique-hyperagent/curateur-rapport-execution-en-anglais.md` — Curateur wiki : rapport d'exécution en anglais (règle Hyperagent / juges)
- `docs/memoire/_historique-hyperagent/hyperagent-mecanique-execution-boucle-autonome.md` — Mécanique d'exécution Hyperagent (spawn depth, voies, VERDICT, fusion vérifiée dans git)
- `docs/memoire/_historique-hyperagent/hyperagent-tables-sandbox-schedule.md` — Tables en lecture seule, bac à sable Hyperagent, Schedule limité
- `docs/memoire/_historique-hyperagent/m11-reseau-npm-bloque-sandbox-hyperagent.md` — M11 — Accès réseau du sandbox Hyperagent (npm bloqué, RequestNetworkAccess)
- `docs/memoire/_historique-hyperagent/modele-agents-sonnet-5-5-manuel.md` — Modèle des agents : Claude Sonnet 5.5, mode Manuel (propre à Hyperagent)

### Gouvernance, pilotage, tickets, état du dépôt
- `docs/memoire/active_work/prerequis-externes-2026-11-13.md` — Prérequis externes (état au 2026-11-13) : XSD DGI provisoires, jeton GitHub, protection main
- `docs/memoire/domain_knowledge/ticket-in-review-gate-handoff-a.md` — Ticket → in_review : handoff avec preuves (version A, 6 éléments)
- `docs/memoire/domain_knowledge/ticket-in-review-gate-handoff-b.md` — Ticket → in_review : contrat de handoff (version B, relecteur nommé)
- `docs/memoire/preference/autonomie-sans-approbation.md` — Autonomie complète des agents de l'usine, limites de sécurité
- `docs/memoire/preference/errata-prime-sur-arbitrages-proprietaire-a.md` — ERRATA prime sur les arbitrages du propriétaire (version A)
- `docs/memoire/preference/format-escalade-ambiguite-spec.md` — Format d'escalade d'une ambiguïté de spécification (section 04)
- `docs/memoire/preference/matrice-sessions-specs-a-lire.md` — Matrice sessions → documents de spécification à lire (3 à 5 par session)
- `docs/memoire/preference/preference-langue-francais.md` — Préférence : échanger et livrer en français
- `docs/memoire/project_context/etat-depot-2026-11-15.md` — État du dépôt au 2026-11-15 (vagues 0-2 fusionnées, pilotage arrêté)
- `docs/memoire/project_context/etat-pilote-ligne-handoff-session.md` — Handoff de session : ligne « État pilote » réécrite à chaque fin de session
- `docs/memoire/project_context/github-protection-main-0-approbation.md` — Protection de main : PR avec 0 approbation, fusion réservée au pilote
- `docs/memoire/project_context/preseance-pilotage-errata.md` — Préséance dépôt > skills ; lancement du pilotage automatique
- `docs/memoire/project_context/referentiel-v2-sessions-agents-branches.md` — Référentiel v2 : sessions, agents réels, branches, fusion
- `docs/memoire/project_context/specs-18-documents-emplacement.md` — Les 18 spécifications : emplacement docs/specs/
- `docs/memoire/tools_and_workflows/errata-prime-sur-arbitrages-proprietaire-b.md` — ERRATA prime sur les arbitrages du propriétaire (version B, cas connus)
- `docs/memoire/tools_and_workflows/protocole-reprise-apres-audit.md` — Protocole de reprise après refus d'audit (red-first, migrations versionnées)

### Invariants techniques, données, comptabilité
- `docs/memoire/domain_knowledge/cgnc-tva-recuperable-34551-34552.md` — PCGE/CGNC : TVA récupérable 34551 (immobilisations) / 34552 (charges)
- `docs/memoire/domain_knowledge/garde-sql-sage100-adr-11.md` — Garde SQL Sage 100 (ADR-11) : lecture seule, WITH (NOLOCK) par table
- `docs/memoire/domain_knowledge/ledger-immutabilite-tous-chemins-ecriture.md` — Grand livre : gardes d'immutabilité sur tous les chemins d'écriture
- `docs/memoire/domain_knowledge/rib-marocain-decision-proprietaire-b-livre.md` — RIB & Sage : validateur livré (rib.ts), garde NOLOCK (version B)
- `docs/memoire/preference/fail-closed-regle-la-plus-stricte.md` — Fail-closed : la règle la plus stricte l'emporte sur une spec plus lâche
- `docs/memoire/preference/m04-invariants-math-loi.md` — M04 — Invariants math & loi (centimes entiers, bps, zéro règle en dur)
- `docs/memoire/preference/pii-restricted-flag-monotone.md` — pii_restricted_flag monotone (0→1 seulement) sur toute table
- `docs/memoire/project_context/cgnc-sous-comptes-analytiques-tva-encaissement.md` — CGNC : comptes 34558/44551/44558 = subdivisions analytiques Fisca
- `docs/memoire/project_context/empreintes-chainees-h1.md` — Décision propriétaire H1 : empreintes chaînées SHA-256 (JSON.stringify, genèse)
- `docs/memoire/project_context/header-company-id-format-proprietaire.md` — Décision propriétaire : format X-Fisca-Company-Id (regex, pas UUIDv7)
- `docs/memoire/project_context/idempotency-key-table-tenant-db.md` — Idempotency-Key 72 h dans TENANT_DB (migration v7), pas en KV
- `docs/memoire/project_context/m02-topologie-monorepo.md` — M02 — Topologie du monorepo
- `docs/memoire/project_context/m03-isolation-portabilite-d1.md` — M03 — Isolation & portabilité (1 base D1 par société, StorageAdapter)
- `docs/memoire/project_context/mandats-cpa-et-vecteurs-ast-h2-h3.md` — Décisions propriétaire H2/H3 : company_cpa_mandates, vecteurs AST
- `docs/memoire/project_context/rib-marocain-decision-proprietaire-a.md` — RIB marocain 24 chiffres, Modulo 97 (décision propriétaire, version A)
- `docs/memoire/project_context/rulings-pilote-company-id-uuid-problem-details.md` — Décisions du pilote : company-id UUID à la frontière HTTP, RFC 9457, SEAM_REQUEST
- `docs/memoire/project_context/tenant-router-membership-mandate-resolver.md` — TenantRouter : appartenance directe + MandateResolver, fail-closed

### Curation du wiki (agent curateur)
- `docs/memoire/domain_knowledge/curateur-controle-de-perimetre-4-etapes.md` — Curation wiki : contrôle de périmètre en 4 étapes avant toute correction
- `docs/memoire/domain_knowledge/curateur-flags-ambiguite-actionnables.md` — Curation wiki : un flag d'ambiguïté doit contenir six éléments
- `docs/memoire/domain_knowledge/curateur-reconciliation-repo-memoire.md` — Curation wiki : réconcilier dépôt et mémoire par vérification des affirmations

### Identité, offres commerciales, fournisseurs
- `docs/memoire/domain_knowledge/m05-grille-tarifaire-pme.md` — M05 — Grille tarifaire PME
- `docs/memoire/domain_knowledge/m06-grille-fiduciaire.md` — M06 — Grille fiduciaire
- `docs/memoire/domain_knowledge/m07-offres-grands-comptes.md` — M07 — Offres Grands Comptes
- `docs/memoire/domain_knowledge/m10-reforme-fiscale-2026.md` — M10 — Réforme fiscale 2026 (TVA 20/10/0, Loi 43-20, RFC 3161)
- `docs/memoire/organization/m01-identite-legale.md` — M01 — Identité légale (SYNAPTIC SYSTEMS SARL AU, Rabat)
- `docs/memoire/preference/m09-politique-des-langues.md` — M09 — Politique des langues du produit
- `docs/memoire/tools_and_workflows/m08-fournisseurs-tiers.md` — M08 — Fournisseurs tiers (Payzone, Infobip, SES)

### UI, i18n, frontend/mobile
- `docs/memoire/domain_knowledge/routes-gelees-pairing-frontend-mobile.md` — Routes existantes = contrats gelés (route de pairing) en frontend/mobile growth
- `docs/memoire/preference/i18n-ui-mercury-zero-label-par-defaut.md` — UI : aucun libellé de repli ni texte français par défaut (ui-mercury)
- `docs/memoire/preference/ui-mercury-brand-indigo-contraste.md` — Mercury : --brand-indigo jamais pour du texte (contraste 4,3:1 en sombre)

### Tests, outillage du dépôt
- `docs/memoire/preference/test-lent-corrige-a-la-racine.md` — Test lent ou instable : corriger à la racine, jamais masquer
- `docs/memoire/tools_and_workflows/scope-guard-tests-routes.md` — Scope guard : emplacement des tests de routes api-hono
- `docs/memoire/tools_and_workflows/verify-fast-sans-cache-turbo-force.md` — verify:fast sans cache : TURBO_FORCE=true
