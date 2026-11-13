# Barrières QA et release — scénarios détaillés (adaptés le 2026-11-13, v2.1)

> Source : « prompts pour piloter Fisca-QA-Security-Auditor (G1 à G4, S5) ». Adaptations appliquées (voir `docs/specs/ERRATA.md`, A-01 à A-05 et B-08, B-10) : noms d'agents et de branches réels ; l'auditeur est en lecture seule sur GitHub et **ne fusionne ni ne délègue : il termine son rapport par la ligne `VERDICT`, que le pilote (Fisca-Lead-Orchestrator) lit avant de fusionner** (ERRATA B-15) ; `audit/gate-N` est une branche locale ; un ticket refusé repasse à `TODO` avec `review_notes` ; les décomptes (520 tests, 120 vecteurs) et budgets de temps sont des cibles. La procédure générale est dans `README.md` (§ 4 et § 5) : ce fichier ne donne que le contenu de chaque barrière. Les lignes « DOCUMENTS ATTACHÉS » désignent des fichiers de `docs/specs/`.

Les quatre barrières d'audit indépendant (G1 à G4) et la session finale de mise en production (S5) couvrent 16 tickets de contrôle et 13 fusions de branches vers la branche principale auditées par Fisca-QA-Security-Auditor et fusionnées par Fisca-Lead-Orchestrator.
> Schémas (ERRATA B-13 révisé) : `pnpm test:xsd` valide contre le schéma présent, officiel s'il est déposé dans `docs/reference/dgi/`, provisoire sinon. Un schéma provisoire n'est pas une clause éliminatoire ; l'auditeur vérifie qu'il dérive strictement de Doc_07, qu'il est marqué provisoire, que son contrat est `PROVISIONAL` (et le reste), et qu'aucun écran ni texte ne prétend à une conformité officielle.

## 1. Synthèse Opérationnelle des Barrières QA et de la Release S5
Chaque barrière s'ouvre dans un fil Hyperagent neuf en mode Auto uniquement lorsque tous les tickets constructeurs de la vague correspondante affichent le statut de revue dans fisca_master_backlog.

| Étape | Agent Actif | Branches Auditées | Rubrics Exigées | Tickets |
|---|---|---|---|---|
| Pré-G1 (S0) | QA-Security-Auditor | feat/w0-foundation | R1 et R2 | Pont S0 |
| Gate G1 | QA-Security-Auditor | S1A et S1B (2 branches) | R1 et R2 | 3 |
| Gate G2 | QA-Security-Auditor | P2-A, P2-B, P2-C (3 branches) | R1 et R3 | 3 |
| Gate G3 | QA-Security-Auditor | P3-A, P3-B, P3-C (3 branches) | R1 et R2 | 3 |
| Gate G4 | QA-Security-Auditor | P4-A, P4-B, P4-C (3 branches) | R1, R2 et R3 | 3 |
| Release S5 | Orchestrateur puis auditeur | feat/w5-release-v1.0.0 | R1, R2 et R3 | 4 |

Quatre règles d'exécution gouvernent l'ensemble de ces fils d'audit dans Hyperagent :
- Sandbox d'intégration éphémère : L'auditeur crée toujours une branche d'audit dédiée à partir de la branche principale et y fusionne les branches candidates avant de lancer pnpm verify:gate.
- Impartialité stricte : Si un test ou un critère échoue sous 95 points sur 100, l'auditeur ne corrige jamais le code métier lui-même et renvoie le ticket précis au constructeur.
- Intégrité constitutionnelle : Avant d'exécuter le moindre test, l'auditeur vérifie par diff Git qu'aucune branche constructeur n'a altéré AGENTS.md ni les assertions existantes du harnais.
- Verrouillage de S0 avant S1A : À la fin de la Session S0, demandez d'abord à Fisca-QA-Security-Auditor de vérifier pnpm verify:fast sur la branche d'amorçage et de rendre son verdict ; l'orchestrateur la fusionne ensuite, avant de lancer S1A.
## 2. Prompt Prêt à Copier-Coller — Barrière QA G1 (Fin de Vague 1)
Ouvrez un nouveau fil avec Fisca-QA-Security-Auditor dès que les 22 tickets des sessions S1A et S1B sont en attente de revue :

```text
SESSION_ID: G1 (Barrière QA 1 — Audit Socle Sécurité, E2EE, CNDP, ERD D1 & AST CGI)
GIT_BRANCH: audit/gate-1
CANDIDATE_BRANCHES: feat/w1-auth-crypto-cndp, feat/w1-erd-ast-cgnc
DOCUMENTS ATTACHÉS : @Doc_06_ERD @Doc_09_RBAC_SoD @Doc_10_STRIDE_Crypto @Doc_14_QA
RUBRICS ENGAGÉES : @Rubric_R1_Fiscal_CGNC_XSD @Rubric_R2_Cyber_E2EE_CNDP_DGSSI (Seuil >= 95/100 chacune, 0 Kill-Switch)
COORDINATION : @fisca_master_backlog @fisca_contracts_registry @FISCA_STATE_AND_HANDOFF

PROTOCOLE D'AUDIT DÉTERMINISTE (TICKETS T-G1-01 À T-G1-03) :
1. Préparation Sandbox : exécute `bash scripts/bootstrap-sandbox.sh`, crée la branche locale `audit/gate-1` depuis `origin/main` et fusionne sans avance rapide (`git merge --no-ff`) `origin/feat/w1-auth-crypto-cndp` puis `origin/feat/w1-erd-ast-cgnc`. Vérifie par `git diff origin/main -- AGENTS.md scripts/enforce-constitution.ts` qu'aucun fichier constitutionnel n'a été altéré.
2. Ticket T-G1-01 (Audit Offensif Rubric R2) : verrouille T-G1-01 en `IN_PROGRESS`. Ajoute si nécessaire tes vecteurs adverses dans `packages/qa-harness` et vérifie :
   - Rejet HTTP 403 `ABAC_TENANT_OUT_OF_SCOPE` sur toute tentative IDOR inter-sociétés D1.
   - Étanchéité du `mfa_challenge_token` après login Email ou Google OAuth (0 accès API métier tant que le code TOTP RFC 6238 ou OTP Infobip n'est pas validé) et blocage anti-rejeu du même pas de 30s.
   - Blocage `SOD_DUAL_CONTROL_VIOLATION` si un même utilisateur Corporate saisit et approuve un changement de RIB 24 chiffres ou un lot `pain.001`.
   - Exception cryptographique immédiate lors d'une permutation de cellule chiffrée `AES-256-GCM` entre deux tiers (`AAD` mismatch) et restitution exacte 2-sur-3 de Shamir sur `GF(256)` (0 fuite sur 1 part isolée).
   - Zéro fuite d'ICE, RIB, CIN ou téléphone `+212` hors de `EphemeralRamPiiScrubber`, arbitrage DSAR Loi 09-08 vs Art. 211 CGI (10 ans) et blocage `DGSSI_LAW_05_20_EGRESS_BLOCKED` hors Maroc en mode Souverain.
3. Ticket T-G1-02 (Audit Fiscal & PAF Rubric R1) : verrouille T-G1-02 en `IN_PROGRESS` et vérifie :
   - Passage à 100 % des 120 vecteurs `fiscal-golden-suite` en centimes entiers `BigInt` (réforme TVA 2026 limitant aux taux 2000, 1000 et 0 bps motivé, scission espèces 5 000 / 50 000 MAD TTC Art. 11-II, RAS-TVA 75 % vs 100 % selon attestation < 6 mois, seuil 80k Auto-Entrepreneur RAS 30 %, amendes Loi 69-21 arrondies au MAD supérieur).
   - Déclenchement effectif des triggers SQLite `VIOLATION_PAF_CGI_ART_145` sur tentative d'`UPDATE`/`DELETE` d'une pièce `POSTED` et `CGNC_NEGATIVE_CASH_5161` sur caisse créditrice.
   - Tir parallèle `Promise.all` de 50 certifications sur `InvoiceSequencerDO` produisant une séquence continue sans trou ni doublon et parité SQL entre pilotes D1 et PostgreSQL 16.
4. Ticket T-G1-03 (Verdict & Verrouillage Contrats) : exécute `pnpm verify:gate` et soumets les preuves aux évaluateurs `@Rubric_R1_Fiscal_CGNC_XSD` et `@Rubric_R2_Cyber_E2EE_CNDP_DGSSI`.
   - Si R1 >= 95 ET R2 >= 95 sans Kill-Switch : passe les contrats socle (`openapi.json` et tables D1) au statut `LOCKED` dans `@fisca_contracts_registry`, marque tous les tickets S1A, S1B et G1 à `DONE`, consigne les scores dans `05_QA_Gate_Verdicts` et `01_Current_Wave_Status` de `@FISCA_STATE_AND_HANDOFF` (déverrouillant P2-A, P2-B et P2-C), puis termine ton rapport par la ligne `VERDICT <barrière> : FAVORABLE` (le pilote, Fisca-Lead-Orchestrator, fusionne).
   - En cas d'échec : n'édite aucun code métier, passe uniquement les tickets fautifs à `TODO` (consignes dans `review_notes`) avec la trace console exacte et avorte la fusion.
```

## 3. Prompt Prêt à Copier-Coller — Barrière QA G2 (Fin de Vague 2 Parallèle)
Lancez ce fil lorsque les trois branches parallèles P2-A (10 tickets), P2-B (12 tickets) et P2-C (8 tickets) ont terminé leurs livrables :

```text
SESSION_ID: G2 (Barrière QA 2 — Audit Clearance xHub, Loi 43-20, Merkle, App PME, POS Offline 72h & Astro 6 Langues)
GIT_BRANCH: audit/gate-2
CANDIDATE_BRANCHES: feat/w2-xhub-4320-merkle, feat/w2-ui-pme-pos, feat/w2-astro-growth
DOCUMENTS ATTACHÉS : @Doc_02_State_Machines @Doc_08_Design_i18n @Doc_14_QA @Doc_18_SEO_GEO_AEO
RUBRICS ENGAGÉES : @Rubric_R1_Fiscal_CGNC_XSD @Rubric_R3_Mercury_i18n_POS_SEO (Seuil >= 95/100 chacune, 0 Kill-Switch)
COORDINATION : @fisca_master_backlog @fisca_contracts_registry @FISCA_STATE_AND_HANDOFF

PROTOCOLE D'AUDIT DÉTERMINISTE (TICKETS T-G2-01 À T-G2-03) :
1. Assemblage des 3 Flux Parallèles : crée `audit/gate-2` depuis `origin/main` et fusionne séquentiellement `origin/feat/w2-xhub-4320-merkle`, `origin/feat/w2-ui-pme-pos` puis `origin/feat/w2-astro-growth`. Vérifie l'absence totale de conflit Git et le respect strict des `FISCA_SCOPE_DIRS` de chaque branche.
2. Ticket T-G2-01 (Audit Clearance, Merkle & Extourne POS — Rubric R1) :
   - Exécute `pnpm test:xsd` et le conteneur Java `PHIVE` : exige 0 erreur XSD/Schematron EN 16931 sur les 5 types UBL (`380`, `381`, `383`, `386`, `389`), y compris débours hors TVA, retenue garantie BTP et timbre espèces 25 bps.
   - Vérifie le PDF/A-3b Factur-X bilingue FR/AR (double arrêté en lettres déterministe, polices `Geist` et `Noto Sans Arabic` embarquées sans arabe disjoint) et le rejet immédiat `ADR_06_LOI4320_CERT_MISMATCH` si l'`OID` du certificat Barid eSign diffère de l'ICE/IF émetteur.
   - Vérifie que 500 archives `archival_packages` sur une même journée ne déclenchent qu'un seul appel TSA `RFC 3161` sur la racine quotidienne de Merkle, et que la conversion QR d'un ticket POS post-clôture Z génère dans la même transaction atomique la facture B2B xHub et l'écriture d'extourne B2C (`UNIQUE(pos_ticket_id)`).
3. Ticket T-G2-02 (Audit Design Mercury, POS 72h & Astro SEO/GEO — Rubric R3) :
   - Vérifie 0 classe CSS physique gauche/droite, 0 hexadécimal hors `tokens.css`, alignement `tabular-nums` en `dir="ltr"` en modes clair et sombre, et `CLS == 0` lors de l'injection SSE de 100 lignes en densités `44px` et `28px`.
   - Simule sous SQLite WASM OPFS 3 tablettes Fisca POS hors-ligne pendant 72h (600 tickets cumulés) : exige 0 collision de séquence, rejet serveur immédiat d'un ticket dont 1 centime a été modifié localement (échec signature `ECDSA P-256` `extractable: false`) et masquage total de `expected_closing_cash_cents` au rôle `CAISSIER_POS` durant le comptage aveugle.
   - Exécute Lighthouse CI et Playwright sur `apps/marketing-astro` : exige un score >= 98/100, réciprocité `hreflang` des 6 langues (`/fr`, `/ar` RTL, `/ary` RTL, `/zgh`, `/zgh-tfng` avec infobulle IRCAM, `/en`), validité de `/llms.txt`, des miroirs `/*.md` et du JSON-LD, exactitude mathématique du réparateur Excel d'ICE Modulo 97 et 0 pixel/tracker tiers (Loi 09-08 CNDP).
4. Ticket T-G2-03 (Verdict & Fusion Vague 2) : exécute `pnpm verify:gate`, évalue R1 et R3, publie le certificat dans `05_QA_Gate_Verdicts` si R1 >= 95 et R3 >= 95, marque P2-A/P2-B/P2-C/G2 à `DONE`, termine ton rapport par la ligne `VERDICT <barrière> : FAVORABLE` (le pilote, Fisca-Lead-Orchestrator, fusionne), ce qui débloque la Vague 3 parallèle (`P3-A`, `P3-B`, `P3-C`). Sinon, renvoie les tickets en échec à `TODO` (consignes dans `review_notes`).
```

## 4. Prompt Prêt à Copier-Coller — Barrière QA G3 (Fin de Vague 3 Parallèle)
Lancez ce fil lorsque les trois branches P3-A (12 tickets), P3-B (10 tickets) et P3-C (9 tickets) sont en revue :

```text
SESSION_ID: G3 (Barrière QA 3 — Audit Usine XSD SIMPL, FEC-MA 24 col., 11 Agents IA, MCP, ERP & Services Tiers)
GIT_BRANCH: audit/gate-3
CANDIDATE_BRANCHES: feat/w3-edi-simpl-fec, feat/w3-ai-agents-mcp, feat/w3-erp-third-party
DOCUMENTS ATTACHÉS : @Doc_07_API_EDI @Doc_13_FinOps @Doc_14_QA @Doc_17_Third_Party_Integrations
RUBRICS ENGAGÉES : @Rubric_R1_Fiscal_CGNC_XSD @Rubric_R2_Cyber_E2EE_CNDP_DGSSI (Seuil >= 95/100 chacune, 0 Kill-Switch)
COORDINATION : @fisca_master_backlog @fisca_contracts_registry @FISCA_STATE_AND_HANDOFF

PROTOCOLE D'AUDIT DÉTERMINISTE (TICKETS T-G3-01 À T-G3-03) :
1. Assemblage des 3 Flux Parallèles : crée `audit/gate-3` depuis `origin/main` et fusionne `origin/feat/w3-edi-simpl-fec`, `origin/feat/w3-ai-agents-mcp` et `origin/feat/w3-erp-third-party`. Contrôle l'étanchéité des périmètres `FISCA_SCOPE_DIRS`.
2. Ticket T-G3-01 (Audit Binaire XSD DGI, FEC-MA & Connecteurs ERP — Rubric R1) :
   - Exécute `pnpm test:xsd` (`xmllint --noout --schema`) sur 100 % des générateurs EDI : SIMPL-TVA v4.0 (`<prorata>` placé strictement entre `<tx>` et `<mp>`), double flux RAS-TVA, Loi 69-21 `ADC500B-23I` (isolation litiges R2 sans amende), SIMPL-IS v2.0.3 (`Total Actif Net == Total Passif` sur balance 6 colonnes, totaux Tableaux 3/4/8 présents, codes obsolètes `11501-11504` absents), État des Ventes Art. 20-I (`B2B + POS B2C == Classe 71 CPC`), les 3 fichiers DRVT v2.0.3 (incluant loyers `TSC`), et l'État 9421 `.xml` non zippé (`<numPPR/>` entre `<numCE/>` et `<numCNSS>`, `<listSalariesCFC/>` dans la racine, codes `ES`/`CH`/`SIR`).
   - Valide le `FEC-MA` `{IF}FEC{YYYYMMDD}.txt` (exactement 24 colonnes séparées par pipe, fins de ligne `CRLF`, journal `AN` équilibré en tête et chaîne `SHA-256` continue) ainsi que le `SAF-T` CGNC v2.0.
   - Exécute `pytest` sur le module Odoo `l10n_ma_edi_clearance` et `xUnit` sur `Sage100EdgeAgent` (.NET 8) : exige 0 requête SQL d'écriture vers Sage (`WITH (NOLOCK)` seul) et 100 % des lignes `.PNM` mesurant exactement 108 caractères ASCII imprimables + `CRLF`.
3. Ticket T-G3-02 (Audit Agents IA SAFE, MCP, FinOps & Connecteurs Tiers — Rubric R2) :
   - Vérifie `canMutateLedgerDirectly === false` sur les 11 agents et 0 paramètre `tenantId`/`companyId` sur l'ensemble des outils exposés par `mcp.fisca.ma/mcp` (OAuth 2.1 + PKCE, aucun outil `POSTED` ni virement).
   - Éprouve les 4 règles d'arrêt AI Crafters (scan illisible -> `PIECE_A_CONTROLER` sans montant deviné ; doublon montant bancaire -> `SUSPENS_AMBIGU_3497_4497` ; variation N/N-1 sans pièce -> 0 cause inventée ; litige email récent -> blocage relance auto) et rejoue le pentest Canary Prompt Injection PDF (RIB fournisseur intact).
   - Vérifie le gouverneur FinOps : 0 appel IA sur 50 Factur-X et 10 relevés `CAMT.053`/`MT940`, cache `SHA-256` actif sur doublon WhatsApp/Email, repli Niveau 2 -> Niveau 1 au plafond doux de 1500 déci-centimes et alerte anomalie > 2x.
   - Vérifie les connecteurs tiers : cascade Infobip WhatsApp 15s vers SMS expéditeur `FISCA`, pause auto anti-ban Meta sur `YELLOW`/`RED`, refus courtois vocal Tamazight V1, séparation stricte Payzone `BYO-MID` (Loi 103-12 BAM) et absence de revente des PDF officiels OMPIC.
4. Ticket T-G3-03 (Verdict & Fusion Vague 3) : exécute `pnpm verify:gate`, évalue R1 et R2, publie le certificat dans `05_QA_Gate_Verdicts` si R1 >= 95 et R2 >= 95, marque P3-A/P3-B/P3-C/G3 à `DONE`, termine ton rapport par la ligne `VERDICT <barrière> : FAVORABLE` (le pilote, Fisca-Lead-Orchestrator, fusionne), ce qui débloque la Vague 4 parallèle (`P4-A`, `P4-B`, `P4-C`).
```

## 5. Prompt Prêt à Copier-Coller — Barrière QA G4 (Fin de Vague 4 Parallèle)
Lancez ce fil lorsque P4-A (9 tickets), P4-B (9 tickets) et P4-C (7 tickets) sont en revue ; les trois Rubrics sont engagées simultanément :

```text
SESSION_ID: G4 (Barrière QA 4 — Audit Intégral E2E Portails OEC/Corporate, Metering, FactorFlow 48h, Chaos PRA & DIP 2036)
GIT_BRANCH: audit/gate-4
CANDIDATE_BRANCHES: feat/w4-oec-corp-mobile, feat/w4-billing-factor-pra, feat/w4-sovereign-cicd
DOCUMENTS ATTACHÉS : @Doc_03_Entitlements_Pricing @Doc_09_RBAC_SoD @Doc_12_SLA_DPA_PRA_Reversibilite @Doc_14_QA
RUBRICS ENGAGÉES : @Rubric_R1_Fiscal_CGNC_XSD @Rubric_R2_Cyber_E2EE_CNDP_DGSSI @Rubric_R3_Mercury_i18n_POS_SEO (Seuil >= 95/100 sur les 3)
COORDINATION : @fisca_master_backlog @fisca_contracts_registry @FISCA_STATE_AND_HANDOFF

PROTOCOLE D'AUDIT DÉTERMINISTE (TICKETS T-G4-01 À T-G4-03) :
1. Assemblage Complet de la Plateforme : crée `audit/gate-4` depuis `origin/main` et fusionne `origin/feat/w4-oec-corp-mobile`, `origin/feat/w4-billing-factor-pra` et `origin/feat/w4-sovereign-cicd`.
2. Ticket T-G4-01 (5 Parcours E2E Playwright Multi-Viewports, Verrou 3 Langues & Billing/FactorFlow) :
   - Exécute Playwright sur `375x812` (Mobile), `1024x768` (Tablette POS) et `1440x900` (Desktop) en modes clair et sombre (`scrollWidth <= clientWidth` partout).
   - Vérifie que `/fiduciary` (et domaines marque blanche) ainsi que `/enterprise` rejettent matériellement `ary`, `zgh-Latn` et `zgh-Tfng` au profit exclusif de `fr`, `ar` et `en`.
   - Vérifie le switch `Cmd+K` < 150ms, le visa hiérarchique des 5 cycles OEC (`AIDE_COMPTABLE` -> `CHEF_MISSION` -> `EXPERT_COMPTABLE_OEC`), la révocation E2EE instantanée en 1 clic d'un cabinet dans `tenant_key_grants` et le cloisonnement `can_access_payroll_pii` sur l'État 9421.
   - Vérifie le rapprochement `3-Way Matching` multi-BL (`N-to-1`), le double visa `SoD-02` sur RIB suspect, l'exclusion de tout tiers `ALERTE_RIB_DAF` d'un lot `pain.001`, le verrou anti-double mobilisation `pledged_invoices_registry` de FactorFlow 48h, le prorata temporis journalier exact en centimes d'un dossier fiduciaire ajouté en cours de mois (-15 % dès 100 dossiers), le calcul d'avoirs SLA (ex: 253 250 centimes à 99,39 % sur 1 013 000 centimes) et la sanctuarisation de `/api/v1/reversibility/export-10y` même en impayé J+15 `RESTRICTED_READ_ONLY` (Art. 211 CGI).
3. Ticket T-G4-02 (Chaos Engineering PRA RPO=0, Réversibilité Hors-Ligne & Garde CI/CD) :
   - Simule la perte du primaire `CLOUDFLARE_EDGE` et la bascule Quorum Multi-DNS (2/3 sondes x 3 échecs = 45s) vers `apps/standby-vps` (`SOVEREIGN_MOROCCO_VPS`) : enregistre 15 factures xHub, 1 clôture Ticket Z POS et 20 écritures `POSTED`, exécute le pont HTTP mTLS de `Failback` (gel lecture seule <= 5s) et vérifie `readyForDnsCutover === true` avec 0 écart sur les 6 `last_entry_hash` CGNC et `icv_counter` (`RPO == 0`). Vérifie aussi qu'une altération d'un seul octet d'empreinte avorte immédiatement le Failback (`JOURNAL_HASH_DRIFT`).
   - Exporte l'archive décennale ZIP `OAIS DIP` ISO 14641 d'un dossier complet, extrais-la dans un conteneur sans aucune interface réseau et exige le code retour `0` de `node verify-archive-offline.mjs`.
   - Vérifie que `ops/docker-compose.sovereign.yml` isole PostgreSQL/MinIO/Redis/Java/Python sur `internal: true`, configure WORM Compliance `3653d`, et que `cd-production.yml` bloque toute migration `[BREAKING_MIGRATION]` entre le 15 et le 21 du mois et du 15/02 au 31/03.
4. Ticket T-G4-03 (Certification Globale des 520 Tests & Fusion Vague 4) : exécute `pnpm verify:gate` complet (tous les tests verts ; 75 s et 520 tests sont des cibles), soumets la plateforme aux 3 Rubrics R1, R2 et R3 (exigeant >= 95/100 sur chacune), consigne le certificat dans `05_QA_Gate_Verdicts`, passe tous les tickets Vague 4 à `DONE`, termine ton rapport par la ligne `VERDICT <barrière> : FAVORABLE` (le pilote, Fisca-Lead-Orchestrator, fusionne), ce qui débloque la Session finale `S5`.
```

## 6. Prompts Bi-Agents Prêts à Copier-Coller — Session Finale S5 (Release v1.0.0)
La Vague 5 respecte jusqu'à la dernière seconde la séparation Maker-Checker : Fisca-Lead-Orchestrator prépare la release candidate et l'environnement Staging (tickets T-S5-01 et T-S5-03), tandis que Fisca-QA-Security-Auditor exécute le tir de charge, vérifie le rollback automatique et appose le sceau final v1.0.0 (tickets T-S5-02 et T-S5-04).
### Étape S5-A — Préparation Staging, SBOM & Pré-Vol Go-Live (Agent : Fisca-Lead-Orchestrator)

```text
SESSION_ID: S5 (Étape A — Préparation Release Candidate, Staging & Checklist Souveraine)
GIT_BRANCH: feat/w5-release-v1.0.0
FISCA_ORCHESTRATOR_MODE: 1
DOCUMENTS ATTACHÉS : @Doc_11_CNDP_Souverainete @Doc_12_SLA_DPA_PRA_Reversibilite @Doc_14_QA @Doc_16_Cloud_Deploy
COORDINATION : @fisca_master_backlog @fisca_contracts_registry @FISCA_STATE_AND_HANDOFF

EXÉCUTION DES TICKETS T-S5-01 ET PRÉ-VOL T-S5-03 :
1. Crée la branche `feat/w5-release-v1.0.0` depuis `origin/main` (certifiée Gate G4).
2. Verrouille et exécute `T-S5-01` : génère la nomenclature logicielle signée `sbom-fisca-v1.0.0.json` (CycloneDX pour homologation DGSSI / PASSI), vérifie par Trivy l'absence de CVE critique sur le Monorepo et les 3 Dockerfiles (`fiscal-java`, `docling-python`, `standby-vps`), vérifie statiquement `jurisdiction = "eu"` sur R2 et `--location=weur` sur D1, déploie sur `staging.fisca.ma` et passe `T-S5-01` à `IN_REVIEW`.
3. Après validation du tir Staging `T-S5-02` par l'auditeur, verrouille et exécute `T-S5-03` : valide les 8 contrôles pré-vol de @Doc_16_Cloud_Deploy (Section 12 : Object Lock Compliance 3 653 jours sur R2 UE et MinIO Maroc, chaîne DNSSEC ANRT, migration Canary sur le Dossier 0 interne SYNAPTIC SYSTEMS SARL AU) et passe `T-S5-03` à `IN_REVIEW` pour signature finale.
```

### Étape S5-B — Tir de Charge Staging, Rollback Test & Signature Finale v1.0.0 (Agent : Fisca-QA-Security-Auditor)

```text
SESSION_ID: S5 (Étape B — Certification Finale de Production, Auto-Rollback & Scellement v1.0.0)
GIT_BRANCH: feat/w5-release-v1.0.0
DOCUMENTS ATTACHÉS : @Doc_11_CNDP_Souverainete @Doc_12_SLA_DPA_PRA_Reversibilite @Doc_14_QA @Doc_16_Cloud_Deploy
RUBRICS ENGAGÉES : @Rubric_R1_Fiscal_CGNC_XSD @Rubric_R2_Cyber_E2EE_CNDP_DGSSI @Rubric_R3_Mercury_i18n_POS_SEO (Seuil >= 95/100 sur les 3)
COORDINATION : @fisca_master_backlog @fisca_contracts_registry @FISCA_STATE_AND_HANDOFF

EXÉCUTION DES TICKETS T-S5-02 ET T-S5-04 :
1. Verrouille `T-S5-02` : sur la branche `feat/w5-release-v1.0.0` déployée en Staging, exécute le test de fumée E2E complet (login Google/Email + 2FA, certification facture UBL/Factur-X, sync POS, export EDI SIMPL), lance le stress d'ingestion simultanée de 500 pièces mixtes dans `INVOICE_QUEUE` (mémoire Worker < 128 Mo, 0 perte), puis simule une sonde `/api/v1/health/deep` en échec HTTP 503 pendant le déploiement Canary 10 % pour prouver le déclenchement automatique de `wrangler rollback` en moins de 30 secondes. Valide `T-S5-01` et `T-S5-02` à `DONE`.
2. Une fois `T-S5-03` soumis par l'orchestrateur, verrouille `T-S5-04` : ré-exécute une dernière fois `pnpm verify:gate` (tous les tests verts, 0 stub/TODO/skip, 0 secret hors Secrets Store), vérifie la présence du SBOM CycloneDX et évalue une ultime fois les 3 Rubrics R1, R2 et R3.
3. Si R1 >= 95, R2 >= 95 et R3 >= 95 sans aucun Kill-Switch : passe `T-S5-03` et `T-S5-04` à `DONE` (portant `@fisca_master_backlog` à 132 / 132 `DONE`), rédige le Certificat Final de Mise en Production dans `05_QA_Gate_Verdicts` de `@FISCA_STATE_AND_HANDOFF`, termine ton rapport par la ligne `VERDICT S5 : FAVORABLE` ; Fisca-Lead-Orchestrator fusionne alors `feat/w5-release-v1.0.0` sur `main`, et le tag Git annoté `v1.0.0` se pose sur décision du propriétaire, ce qui déclenche le déploiement graduel Canary 10 % -> 100 % sur `fisca.ma`.
```

## 7. Pont S0 — certification de la fondation (avant S1A)

```text
SESSION_ID: PONT_S0 (Certification de la Fondation Monorepo & Fusion sur main)
GIT_BRANCH: audit/gate-0
CANDIDATE_BRANCH: feat/w0-foundation
DOCUMENTS ATTACHÉS : @Doc_05_ADR @Doc_14_QA @Doc_15_AGENTS_MD
RUBRICS ENGAGÉES : @Rubric_R1_Fiscal_CGNC_XSD @Rubric_R2_Cyber_E2EE_CNDP_DGSSI (Seuil >= 95/100 chacune)
COORDINATION : @fisca_master_backlog @fisca_contracts_registry @FISCA_STATE_AND_HANDOFF

PROTOCOLE D'AUDIT PONT S0 :
1. Récupère `origin/feat/w0-foundation` dans un sandbox propre, exécute `bash scripts/bootstrap-sandbox.sh` puis `pnpm verify:fast`.
2. Vérifie matériellement les 4 tests d'auto-défense de @Doc_15_AGENTS_MD (Section 12) :
   - Présence non vide de `AGENTS.md`, `CLAUDE.md`, des 3 fichiers satellites `AGENTS.md`, de `.githooks/pre-commit` et des 18 fichiers dans `docs/specs/`.
   - Simulation de `FISCA_SCOPE_DIRS="apps/marketing-astro"` rejetant avec `ERR_OUT_OF_SCOPE` un fichier hors périmètre.
   - Simulation d'une branche constructeur tentant d'altérer `AGENTS.md` rejetée avec `ERR_TAMPERED_QA`.
   - Simulation d'un commit `[BREAKING_MIGRATION]` aux dates `2026-11-19` et `2027-03-28` rejeté avec `ERR_TAX_FREEZE_WINDOW`.
3. Vérifie que `fiscal-golden-suite` valide les vecteurs `VEC-CGI-01` à `VEC-CGI-06` en arithmétique entière `BigInt` pure et que `fisca_master_backlog` compte exactement 132 tickets sans doublon.
4. Évalue `@Rubric_R1_Fiscal_CGNC_XSD` et `@Rubric_R2_Cyber_E2EE_CNDP_DGSSI` :
   - Si R1 >= 95 ET R2 >= 95 (0 Kill-Switch) : passe `T-S0-01` à `T-S0-08` au statut `DONE` dans `@fisca_master_backlog`, inscris le verdict `Pont S0 : CERTIFIÉ` dans `05_QA_Gate_Verdicts` et mets à jour `01_Current_Wave_Status` de `@FISCA_STATE_AND_HANDOFF` (autorisant `S1A` sur `feat/w1-auth-crypto-cndp`), puis termine ton rapport par la ligne `VERDICT PONT_S0 : FAVORABLE` (le pilote fusionne la PR `feat/w0-foundation`).
   - Sinon : refuse la fusion et passe les tickets fautifs à `TODO` (consignes dans `review_notes`) avec la trace console exacte.


```
