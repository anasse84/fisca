# Préparation de la vague 4 (P4-A, P4-B, P4-C, barrière G4)

Rédigé par le pilote le 2026-11-14, à partir de `main` `3496824`, de l'ERRATA révision e, du backlog et de la section 04 du document d'état. Même convention que `preparation-vague-3.md` : **PROPOSITION DU PILOTE (à valider)** ou **À TRANCHER PAR LE PROPRIÉTAIRE** (question exacte, option par défaut). Les entrées externes sont aussi dans `prerequis-proprietaire.md`.

## 0. Quatre trous de périmètre et d'architecture à combler avant la vague 4

Ces points ne sont portés par aucun ticket du backlog ; sans décision, une voie se bloque.

| N° | Trou | Pourquoi c'est un blocage | Proposition ou question |
|---|---|---|---|
| T-1 | **Ouverture d'une base D1 de société à l'exécution.** `createD1TenantDriver(tenantId, db)` prend un `D1Database` déjà ouvert, mais une liaison D1 de Workers est déclarée à l'avance dans `wrangler.toml` ; rien dans le dépôt n'explique comment un Worker obtient la base d'une société créée plus tard. Le gestionnaire `fetch` de production d'`apps/api-hono/src/index.ts` n'existe pas (ADR-19) et aucune session n'a `apps/api-hono/src` dans son périmètre en vague 4 | La spécification suppose « une base par société » (ADR-02) ; si la technique retenue change, ADR-02 et le provisionnement (T-P4C-05) changent | **À TRANCHER PAR LE PROPRIÉTAIRE, après un spike technique (une demi-journée) en tête de P4-C** : (a) API REST de D1 (une requête par appel, latence et quotas à mesurer), (b) Workers for Platforms (un script par société avec sa liaison), (c) SQLite de Durable Object par société (révision d'ADR-02). **Option par défaut** : (a) derrière `createD1TenantDriver`, en mesurant ; le gestionnaire `fetch` est écrit par un ticket de jonction « J3 » (BACK-1 ou BACK-2) |
| T-2 | **Tables d'entitlements et de metering** (Doc_03 § 10) | Absentes de `packages/db-schema` (gelé) ; le périmètre de P4-B ne contient pas `db-schema` | **PROPOSITION** : étendre le périmètre de T-P4B-01 à `packages/db-schema` (migration du plan de contrôle) avec audit par G4 ; l'édition de `.meta/session-scopes.json` est faite par le pilote en mode orchestrateur |
| T-3 | **Routes PME sans propriétaire** : création de dossier (`POST /api/v1/companies`), `GET /api/v1/dashboard/cashflow-vat-90d`, taux de TVA datés, règles CGI par surface, profil émetteur, création de brouillon de facture, relevé bancaire et suggestions, radar de retard Loi 69-21, preuves de litige ; invitation et révocation de cabinet (mandats : aucune route au registre, seulement les tables `company_cpa_mandates` et `tenant_key_grants`) ; routes d'appairage POS | Le client (`apps/web-saas/src/pme/pme-api.ts`, `PairingGateway`) attend des ports ; aucun ticket du backlog ne monte ces routes ; le propriétaire a décidé que les routes restent des ports pour G2 et se montent en vague 3 ou 4 | **À TRANCHER PAR LE PROPRIÉTAIRE** : créer une session « P4-D » (routes PME, voie BACK-1 après P4-B) avec ses tickets, ou accepter que la v1.0.0 sorte avec ces routes en ports. **Option par défaut** : P4-D, rédigée par le pilote, un ticket par route, corps à spécifier par le propriétaire pour celles qui n'ont pas de spécification (appairage, création de dossier, mandats) |
| T-4 | **Réserves de la caisse sans propriétaire** : montant attendu persisté en clair dans l'OPFS ; largeur 1024 px non capturée ; `apps/pos-pwa` n'est dans le périmètre d'aucune session de la vague 4 | Réserve ouverte à traiter avant G4 | **PROPOSITION** : ticket de jonction front « J4 » (FRONT-1, périmètre `apps/pos-pwa`) : ne pas persister `expected_closing_cash_cents` avant le dépôt du comptage (ou le chiffrer) ; décision du propriétaire attendue car cela change l'échange avec le serveur |

## 1. Socle disponible sur `main` à réutiliser

Voir `preparation-vague-3.md` § 1. S'y ajoutent : `packages/ui-mercury` et `packages/i18n` (6 langues, `resolveSafeLocale`), `apps/web-saas/src/shared` (palette Cmd+K, tiroir de revue), `apps/pos-pwa` (OPFS, ticket, clôture Z), routes `pos` et `invoices`, `packages/vault-merkle`, ports de `apps/web-saas/src/pme/pme-api.ts`.

## 2. Décisions déjà prises qui s'appliquent

- Prorata fiduciaire **journalier**, plancher d'un jour, sans mois minimum ; arithmétique `divRoundHalfUpBigInt` (D-09) ; relances J0, J+3, J+7, J+12, J+15 (lecture et export Art. 211 sanctuarisés).
- Visa du gérant et du DAF ; visa de lot spécifié en D-23 (corps, 409 `CYCLE_ENTRIES_DRIFT`, 409 `NO_ELIGIBLE_DRAFT_IN_CYCLE`, tri, lot atomique avec une ligne d'audit par pièce) ; **le routeur de cette route est à écrire dans `apps/api-hono` (périmètre non couvert en vague 4 : ticket de jonction « J3 », voir plus haut)**.
- Appairage POS : `POST /api/v1/pos/terminals/pair` (corps à spécifier). Callback Google : 302 avec cookie de refresh vers `/auth/callback` ou `/auth/2fa#mfa_challenge_token=…`.
- Caisse : fuseau du Z paramétrable (UTC par défaut), `ESC_POS_TCP_IP` au CHECK, timbre 25 bps, coupures BAM, seuil d'écart de 2000 centimes, fenêtre de 72 h conditionnelle.
- Prix HT seulement ; durées de conservation T-01 à T-04 ; références CNDP à `null`.
- Régime provisoire DGI/xHub ; `LIVE` de la passerelle seulement à partir de la spécification d'API publiée, dans un ticket distinct.
- Lois : pas d'encaissement pour compte de tiers ni de crédit sur bilan propre (loi 103-12) : FactorFlow reste une mise en relation (subrogation conventionnelle), jamais un financement par Fisca.

## 3. Session P4-A (voie FRONT-1) : interfaces fiduciaire, entreprise, mobile

Branche `feat/w4-oec-corp-mobile`. Périmètre : `apps/web-saas/src/fiduciary`, `apps/web-saas/src/enterprise`, `apps/mobile-capacitor`.

| Ticket | À réutiliser | Manques et incohérences détectés | Proposition ou question |
|---|---|---|---|
| T-P4A-01 : cockpit OEC | `FiscaCommandPalette`, grille virtuelle, `resolveSafeLocale` (fr, ar, en seulement) | La liste des dossiers d'un cabinet et le basculement de dossier n'ont aucune route (voir T-3) ; « switch Cmd+K en moins de 150 ms » à mesurer dans Chromium | Port injectable + mesure réelle |
| T-P4A-02 : atelier des 5 cycles | route de visa unitaire (réalisée) ; route de lot (D-23) | La route de lot n'existe pas (voir 0 et J3) ; visa hiérarchique Aide → Chef → Expert déjà dans le moteur | L'atelier appelle le visa unitaire ; le lot attend J3 |
| T-P4A-03 : console EDI groupée et marque blanche | route `/api/v1/edi/:declarationType` (P3-A) ; `EDI_EXPORT` (permission proposée par J2) | Marque blanche = Cloudflare for SaaS (P4-C) ; 9421 protégé par `can_access_payroll_pii` | Dépend de P3-A fusionné |
| T-P4A-04 : gouvernance E2EE | tables `company_cpa_mandates`, `tenant_key_grants`, `crypto-e2ee` | **Aucune route d'invitation ni de révocation** ; cérémonie Shamir 2 sur 3 : outils présents, parcours non spécifié ; « Kit CNDP client » : contenu non défini | **À TRANCHER PAR LE PROPRIÉTAIRE** : routes de mandat (corps) et contenu du Kit CNDP. **Option par défaut** : écran sur ports, Kit CNDP = les mentions et durées de Doc_11 |
| T-P4A-05 à T-P4A-07 : portail entreprise, 3-way matching, signataire `pain.001`, FactorFlow | permissions `PAYMENT_PREPARE_PAIN001`, `PAYMENT_SIGN_PAIN001` (step-up 300 s) ; agents de P3-B | SSO SAML, OIDC, SCIM : **aucune spécification de route** ; BI : vues OData de P3-C ; les routes de paiement n'ont aucun contrat au registre | **À TRANCHER** : routes `payments/*` et SSO (corps). **Option par défaut** : ports et écrans, sans appel réel |
| T-P4A-08, T-P4A-09 : application Capacitor | — | Builds iOS et Android **impossibles** dans le bac à sable (Xcode, SDK Android) ; biométrie et caméra non testables | **PROPOSITION** : tests d'interface en Chromium émulé, plugins derrière des ports, builds natifs consignés « non vérifiés » |

## 4. Session P4-B (voie BACK-1) : facturation, FactorFlow, PRA, réversibilité

Branche `feat/w4-billing-factor-pra`. Périmètre : `packages/billing-metering`, `packages/factorflow`, `packages/pra-reversibility`, `apps/api-hono/src/routes/billing`, `apps/api-hono/src/routes/factorflow`.

| Ticket | À réutiliser | Manques et incohérences détectés | Proposition ou question |
|---|---|---|---|
| T-P4B-01 : moteur d'abonnements | Doc_03 §§ 02, 05, 10, 11 ; code de référence (non maintenu) | Tables de Doc_03 § 10 absentes (trou T-2) ; « inspiré Kill Bill » : aucune dépendance imposée ; essai de 14 jours et packs Mowakaba : montants de Doc_03 | Voir T-2 ; arithmétique BigInt ; plans issus de l'AST ou de tables, jamais en dur |
| T-P4B-02 : compteur fiduciaire | `billing-policy.ts` du site (règle d'affichage) | Doublon de règle entre site et moteur | **PROPOSITION** : le moteur est la référence ; un test compare avec la fonction du site ; vecteur « 16 novembre » : 7450 et 12450 centimes |
| T-P4B-03 : KYB_WALLET et auto-facturation | `ubl-xades`, passerelle simulée | Prix de 15 MAD HT du scoring : Doc_03, non recoupé ; Payzone réel absent | Doubles de test |
| T-P4B-04 : dunning | `pra-reversibility` pour la sanctuarisation | Aucun | Tests de calendrier J0 à J+15 |
| T-P4B-05 : FactorFlow 48 h | `invoices` (états `APPROUVEE`) ; loi 103-12 | Aucun partenaire factor réel ; « scoring xHub » dépend d'un xHub simulé | Ports et doubles ; jamais de crédit propre |
| T-P4B-06 : `pain.001.001.03` et lettrage SIMT | XSD ISO 20022 (`docs.oasis-open.org` accessible ; ISO 20022 à vendoriser) | Le XSD `pain.001.001.03` n'est pas vendorisé dans le dépôt | **PROPOSITION** : télécharger et vendoriser avec `SOURCE.md` et empreinte |
| T-P4B-07 à T-P4B-09 : SLA, réplication signée, failback, export décennal, `verify-archive-offline.mjs` | `vault-merkle`, `invoices` | Aucune infrastructure réelle (Cloudflare, VPS) en bac à sable ; export décennal ISO 14641 : format du DIP détaillé en Doc_12 § 08 | Tests par processus locaux ; épreuve de chaos à G4 sur doubles |

## 5. Session P4-C (voie BACK-2) : souverain, CI/CD, provisionnement

Branche `feat/w4-sovereign-cicd`. Périmètre : `apps/standby-vps`, `ops`, `scripts/provision-cloudflare-prod.sh`, `.github/workflows`.

| Ticket | Manques et incohérences détectés | Proposition ou question |
|---|---|---|
| T-P4C-01 : `standby-vps` (Node 22, Hono, PostgreSQL 16, MinIO, BullMQ) | Pas de Docker ; MinIO et Redis testables nativement (`--postgres`, `--redis`) | Tests sur PostgreSQL et Redis natifs ; MinIO Object Lock : pilote mémoire (contrat `WormVaultDriver`) |
| T-P4C-02, T-P4C-03 : compose souverain, Caddy mTLS, Object Lock 3 653 jours, vLLM zéro-egress, Syslog MACERT | Non exécutables ici ; GPU et vLLM absents | Fichiers vérifiés par lint et tests de structure ; « non vérifié en exécution » consigné |
| T-P4C-04 : quorum multi-DNS (3 sondes) | Aucun domaine ANRT ; sondes réelles impossibles | Simulation de sondes |
| T-P4C-05 : `provision-cloudflare-prod.sh` | Compte Cloudflare, jetons et noms de ressources du propriétaire ; **trou T-1** | Script écrit et testé à blanc (`--dry-run`) ; exécution réelle seulement avec les jetons |
| T-P4C-06, T-P4C-07 : workflows GitHub Actions | **Le jeton GitHub actuel n'a pas la permission Workflows et expire le 2026-12-12 (ERRATA B-12)** : le push est refusé | **À FAIRE PAR LE PROPRIÉTAIRE avant T-P4C-06** : renouveler le jeton avec « Workflows : lecture et écriture ». Sans cela : ticket `BLOCKED` (`MISSING_INPUT`), pas de contournement |

Le texte des tickets cite « 520 tests » : cible d'origine, sans effet (ERRATA B-08) ; le workflow `ci-pr-gate.yml` exécute `pnpm verify:gate`.

## 6. Barrière G4 (voie AUDIT)

- `pnpm verify:gate --browser` (Java 21, `--playwright`, `--postgres`, `--redis`, `--python`) ; rubrics R1, R2, R3 à 95.
- À vérifier en plus : cinq parcours E2E sur trois largeurs (375, **1024**, 1440 px : la largeur 1024 n'a pas été capturée à G2), clair et sombre, verrou 3 langues OEC et entreprise, SoD sur RIB, prorata et J+15 ; épreuve de chaos du PRA (failover, écritures et Z, failback à perte nulle) ; `verify-archive-offline.mjs` hors réseau ; **réserves obligatoirement levées avant G4** : montant attendu de la caisse, chiffrement des réponses d'idempotence (avant G3), scrubber d'ICE ; le « Journal des amendements » des spécifications 03, 12, 13, 16 complété (ERRATA F).

## 7. Questions numérotées pour le propriétaire

1. Spike D1 par société (trou T-1) : accord pour l'option par défaut (API REST de D1 derrière `createD1TenantDriver`) après mesure.
2. Création d'une session P4-D pour les routes PME et de mandat, et tickets de jonction J3 (fetch de production, route de visa de lot) et J4 (caisse) ; corps des routes d'appairage, de création de dossier et de mandat.
3. Routes SSO, SCIM, `payments/*` : corps ou accord pour des ports sans appel réel.
4. Contenu du « Kit CNDP client » (T-P4A-04).
5. Décision sur `expected_closing_cash_cents`.
6. Renouvellement du jeton GitHub avec la permission Workflows ; jetons Cloudflare ; noms de ressources.
