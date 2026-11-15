<!--
ID canonique : Doc_07_API_EDI   |   Fichier : docs/specs/07-api-edi-contracts.md
Source : « Document 07 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_07_API_EDI#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_07_API_EDI »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 07 — Contrats d'API & Spécifications des Flux EDI

### Journal des amendements

| Date | Section | Amendement | Source |
|---|---|---|---|
| 2026-11-14 | 01 | `X-Fisca-Company-Id` au format `[A-Za-z0-9_-]{1,64}` (et non UUIDv7) ; `Idempotency-Key` UUIDv7 conservée 72 h dans `idempotency_records` ; `Accept-Language` et `X-Fisca-HPKE-Dek` marqués « Prévu » ; `ProblemDetails` réel (`instance`, `issues[]`, `application/problem+json`) ; OpenAPI généré sans `@hono/zod-openapi` | ERRATA D-16, D-18, D-22 ; `apps/api-hono/src/core/{problem-details,idempotency,openapi-document}.ts` ; `packages/shared-types/src/api-contracts.ts` |
| 2026-11-14 | 02 | Colonne « État » ajoutée au catalogue ; sous-section « Routes construites » (CTR-API-10 à 18, 45 à 48, 01 à 09, 35 à 42) avec corps, réponses et codes d'erreur ; routes hors document ; routes décidées mais non construites (visa par lot D-23, appairage POS, routes PME) ; callback Google 302 à fragment | `apps/api-hono/src/routes/*`, `src/core/api-v1-contracts.ts`, `packages/auth-rbac/src/*-routes.ts`, `registre-contrats.json`, ERRATA D-22 et D-23 |
| 2026-11-14 | 03 | Contrat réel de `POST /api/v1/pos/sync-batch` (200/207, amorce 64 zéros, `SALE_B2C` → « SALE » dans le tuple, signature ECDSA P-256) et de `convert-b2b` (extourne `B2C_TO_B2B_REVERSAL`) ; QR `https://fisca.ma/q/{token}` ; flux SSE d'achats « Prévu » | `apps/api-hono/src/routes/pos/*`, ERRATA D-22 et D-23, CTR-API-16, 17, 22 |
| 2026-11-14 | 04 à 06 | Marqués « Prévu : vague 3 » (aucun code : `packages/edi-simpl`, `external-integrations`, `ai-agents` ne contiennent que leur point d'entrée) ; `NOLOCK` par table, `.PNM` et certificat selon D-22 | `backlog.json` (T-P3B-10, T-P3C-02 à 09), ERRATA D-22, `main` `3496824` |
| 2026-11-14 | 07 | Profil provisoire `cius-ma-provisional`, `KNOWN_PHIVE_DEVIATIONS`, 383 émis comme `Invoice`, PIH à 13 éléments, genèse de 45 caractères, Factur-X `UBL21-PROVISIONAL`, validation simulée, clearance 1 + 8 réessais | ERRATA B-13, D-22, D-23 ; `packages/ubl-xades/src/{known-phive-deviations,generator/*}.ts`, `profiles/cius-ma-provisional/profile.json`, CTR-API-P2A-01 à 03, CTR-COD-P2A-03 à 14 |
| 2026-11-14 | 08 à 10 | Marqués « Prévu : vague 3, P3-A » ; directive T-P3A-01 (XSD structurels provisoires `PROVISIONAL_STRUCTURAL_XSD_PENDING_OFFICIAL_DGI_PACK`) ; 18 colonnes FEC standard + 6 extensions | ERRATA B-13, D-23 ; `docs/reference/dgi/README.md` |
| 2026-11-14 | 11 | Code de référence : écarts du code réel (`Ice15Schema` avec clé modulo 97, `z.strictObject`, Zod 4, `ProblemDetailsSchema` avec `instance` et `issues`) | `packages/shared-types/src/api-contracts.ts` |
| 2026-11-14 | 12 | `openapi.json` non commité, `.meta/openapi.snapshot.json` (état G1 : 8 routes seulement) ; `pnpm test:xsd` ; statuts LOCKED/PROVISIONAL/DRAFT du registre | ERRATA D-18, B-13 ; `package.json` racine ; `.meta/openapi.snapshot.json` |
Ce document définit selon une approche Design-First l'ensemble des contrats d'interfaces REST OpenAPI, des flux temps réel SSE, de la synchronisation hors-ligne Fisca POS, des webhooks signés, du serveur MCP et des schémas XML/XSD de la DGI (provisoires tant que les schémas officiels ne sont pas publiés, ERRATA B-13) pour Fisca (fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Ses 12 sections nommées sont prêtes pour Hyperagent avec la portée Projet (Doc_07_API_EDI).

**État au 2026-11-14 (vagues 0 à 2 fusionnées, `main` `3496824`).** Construit : les routes d'authentification, d'annuaire ICE, de grand livre, de rapprochement bancaire, de santé, de clearance de facture, de vérification publique et de caisse POS (section 02), sous forme de routeurs Hono à ports injectables (`createLedgerRoutes`, `createInvoicesRoutes`, `createPosRoutes`, `createAuthRoutes`). Il n'existe pas encore de gestionnaire `fetch` de production dans `apps/api-hono/src/index.ts` : l'ouverture d'une base D1 par identifiant dépend de P4-C. Non construit : les flux d'import EDI DGI, les connecteurs ERP, les webhooks, le serveur MCP, le flux SSE d'achats et les routes PME (vagues 3 et 4). Chaque ligne ci-dessous porte la mention « Réalisé », « Port » (route décidée, aucun code) ou « Prévu : vague N, ticket T-… ».
## Section 01 — Gouvernance Design-First, En-têtes HTTP & Loi d'Échange
Toutes les routes de apps/api-hono sont définies par contrat avant toute implémentation métier afin de générer le schéma OpenAPI et le client typé partagé avec React, Capacitor et la caisse tactile. **Réalisé autrement :** pas de `@hono/zod-openapi` ; les contrats sont des objets `ApiRouteContract` (schémas Zod 4) dans `apps/api-hono/src/core/api-v1-contracts.ts` (routes du socle) et `src/routes/{invoices,pos}/*-route-schemas.ts` ; le document OpenAPI 3.1 est produit par `src/core/openapi-document.ts` (`pnpm --filter @fisca/api-hono openapi:gen`), artefact généré non commité (ERRATA D-18).

| En-tête HTTP | Caractère | Format Attendu | Rôle Sécuritaire et Transactionnel |
|---|---|---|---|
| Authorization | Requis | Bearer JWT ou OAuth 2.1 | Identifie l'acteur humain, l'agent ERP ou le client MCP |
| X-Fisca-Company-Id | Requis sur toute route de dossier (absent de l'annuaire ICE, de la santé et des routes publiques) | `[A-Za-z0-9_-]{1,64}` (décision du propriétaire, écart assumé avec l'UUIDv7 d'origine ; validé une seule fois par `assertValidCompanyId`, `packages/shared-types/src/infra-adapter.ts`) | Sélectionne un dossier parmi ceux de l'utilisateur ; vérifié côté serveur contre les appartenances et les mandats (`company_cpa_mandates`), qui résout lui-même la base ; jamais un argument d'outil IA ou MCP (ERRATA D-16, D-22) |
| Idempotency-Key | Requis en écriture (POST, PUT, PATCH, DELETE) | UUIDv7 unique (refusée sinon) | Réponses 2xx conservées 72 h (259 200 s) dans la table `idempotency_records` de `TENANT_DB` ; rejeu au corps identique : réponse mémorisée avec l'en-tête `Idempotent-Replayed: true` ; même clé et corps différent : 422 `LEDGER_IDEMPOTENCY_KEY_REUSED` ; requête concurrente : 409. Réserve : les réponses sont stockées en base64 non chiffré (à traiter avant G3). `apps/api-hono/src/core/idempotency.ts`, `packages/db-schema` migration v10 |
| X-Fisca-HPKE-Dek | Optionnel E2EE | Base64 RFC 9180 | Transmet la clé E2EE chiffrée pour la RAM de l'isolat V8. Prévu : aucun code dans `apps/api-hono` au 2026-11-14 (NON RECOUPÉ avec `packages/crypto-e2ee`) |
| Accept-Language | Optionnel | Code BCP-47 | Applique 6 langues PME/POS ou 3 langues Fiduciaire/Corporate. Prévu : l'API ne lit pas cet en-tête ; la langue est résolue côté client (`packages/i18n`, `resolveSafeLocale`). Les textes d'erreur de l'API sont en français fixe |

Quatre règles de sérialisation gouvernent 100 % des payloads JSON entrants et sortants :
- Zéro nombre flottant sur le réseau : Tous les montants transitent en centimes entiers (_cents), les taux en points de base (_bps), les quantités en milli-unités (_milli) et les cours BAM en micro-unités (_micro).
- Enveloppe d'erreur normalisée RFC 9457 : Tout rejet retourne un statut HTTP précis, en `application/problem+json`. **Réalisé** (`ProblemDetailsSchema`, `packages/shared-types/src/api-contracts.ts` ; `apps/api-hono/src/core/problem-details.ts`) : champs `type` (`about:blank` quand il n'ajoute rien), `title`, `status`, `errorCode`, `legalRef` (optionnel), `traceId` (repris de `traceparent` W3C s'il est valide, sinon tiré au hasard), `detail`, et les extensions `instance` (chemin) et `issues[]` (au plus 20 entrées `{path, message, code?}`). Les noms sont en camelCase (`errorCode`, `traceId`, `legalRef`), pas en snake_case. `detail` est un texte fixe : jamais le message d'une exception, ni pile, ni requête SQL ; toute erreur inconnue donne le 500 constant `INTERNAL_ERROR`. Un montant décimal donne 400 `ADR_03_FLOAT_FORBIDDEN`.
- Résolution hermétique du locataire : L'instance SQLite TENANT_DB est attachée par le middleware d'authentification ; aucun corps JSON ni outil IA n'est autorisé à cibler une autre base.
- Validation XSD pré-sortie obligatoire : Aucun fichier XML destiné à xHub ou au portail SIMPL n'est livré au client sans avoir franchi sans erreur le validateur binaire XSD / Schematron. **Réalisé pour l'UBL** (XSD OASIS UBL 2.1 vendorisés, `pnpm test:xsd`, validateur PHIVE du conteneur `fiscal-java`) ; **Prévu : vague 3, T-P3A-01 et T-P3A-12** pour les télédéclarations SIMPL. La validation est faite contre un schéma provisoire tant que les schémas officiels de la DGI ne sont pas déposés (ERRATA B-13) : elle ne vaut pas conformité DGI.
## Section 02 — Catalogue des Routes REST Hono v1 (/api/v1/*)
Le routeur principal regroupe les opérations synchrones en sept domaines métiers protégés par le middleware d'entitlements défini au Document 03 :

| Domaine Métier | Route Principale | Méthodes | Rôle Minimum | Livrable Déterministe | État au 2026-11-14 |
|---|---|---|---|---|---|
| Identité & ICE | /api/v1/directory/ice/:ice | GET | Tout connecté | Enrichissement ICE 15 chiffres, IF, RC, ADC450 | Réalisé (CTR-API-10, LOCKED) ; sans `X-Fisca-Company-Id` |
| Clearance xHub | /api/v1/invoices/:id/certify | POST | Gérant / Commercial facturation, Step-Up 300 s (`INVOICE_CERTIFY_XHUB`) | Numéro `{FAC\|AVO\|NDB\|ACO\|AUT}-{YYYY}-{SEQ6}`, UBL 2.1, XAdES Loi 43-20, Factur-X ; réponse 202 `Validation simulée` | Réalisé en routeur à ports (CTR-API-14, PROVISIONAL) ; câblage de production après G2 (jonction non faite) |
| Fisca POS | /api/v1/pos/sync-batch | POST | Terminal POS (permission `POS_ENCASH_TICKET`) | Ingestion hors-ligne, Ticket Z et lettrage TPE | Réalisé en routeur à ports (CTR-API-16, PROVISIONAL) ; lettrage TPE : NON RECOUPÉ dans la route |
| Achats & Banque | /api/v1/banking/reconcile | POST | Aide-Comptable | Lettrage, suspens 3497/4497 et VAT_CLEARING | Réalisé (CTR-API-12, LOCKED) ; exige au moins une candidate : une ligne sans candidate ne peut pas être mise en suspens par cette route (arbitrage D-23, CTR-API-12 acceptera 0 candidate en vague 3 ou 4) |
| Grand Livre | /api/v1/ledger/entries/:id/post | POST | Expert-Comptable | Scellement SHA-256 immuable ou contre-passation | Réalisé (CTR-API-11, LOCKED) ; 200 pièce scellée, 201 brouillon de contre-passation |
| Usine EDI DGI | /api/v1/edi/:declarationType | POST | Chef de Mission | Archives XML/ZIP validées XSD + FEC-MA 24 col. | Prévu : vague 3, T-P3A-12 (CTR-API-19, DRAFT) |
| Corporate & 48h | /api/v1/factorflow/pledge | POST | DAF / Gérant | Verrou anti-doublon, escompte 48h et pain.001 | Prévu : vague 4, T-P4B-05 (CTR-API-33, DRAFT) |

- Routes additionnelles cycle de vie : POST /api/v1/invoices/:id/cdv-response émet l'un des statuts CDV vers xHub (pilote `simulated` seul livré). **Réalisé** (CTR-API-15, PROVISIONAL) : corps `{status: APPROUVEE\|EN_LITIGE_SUSPENDUE\|ENCAISSEE, reason? ≤ 500}`, Step-Up 300 s sous la permission `INVOICE_CERTIFY_XHUB` (pas de permission CDV propre). Les 8 statuts ne sont listés d'un bloc par aucun document : ils ont été reconstitués (DEPOSEE_CERTIFIEE_DGI, MISE_A_DISPOSITION, PRISE_EN_CHARGE, APPROUVEE, APPROUVEE_PARTIELLEMENT, EN_LITIGE_SUSPENDUE, REFUSEE, ENCAISSEE) ; 9 transitions sont ajoutées par hypothèse et restent à valider (`packages/ubl-xades/src/clearance/fsm.ts`). POST /api/v1/compliance/ras-tva/:id/certificate (certificat PDF de retenue 75 % ou 100 %) : Prévu (CTR-API-20, DRAFT ; ticket NON IDENTIFIÉ au backlog, à rattacher à T-P3A-03 ou T-P3A-12 par le pilote).
- Sanctuarisation de la réversibilité : La route GET /api/v1/reversibility/export-10y (Prévu : vague 4, T-P4B-09, CTR-API-34 DRAFT) et la route de vérification publique GET /api/v1/public/verify/:xhubUuid (Réalisé, CTR-API-18, PROVISIONAL : la route ne lit jamais l'abonnement) ignorent tout blocage commercial en cas d'abonnement impayé.

**Routes construites (état de `main` `3496824`, vérifié dans `apps/api-hono/src/routes` et `src/core/api-v1-contracts.ts`).** Toutes les routes de dossier exigent `Authorization`, `X-Fisca-Company-Id` et, en écriture, `Idempotency-Key`. Les erreurs sont des `ProblemDetails` (section 01). Les codes de réponse listés sont ceux des contrats ; `errorCode` est le code stable de la réponse.

| Route (registre) | Corps et réponse de succès | Codes d'erreur (statut : `errorCode`) | Statut registre |
|---|---|---|---|
| GET /api/v1/directory/ice/:ice (CTR-API-10) | Réponse 200 : fiche ICE | 400, 401, 404 `ICE_NOT_FOUND`, 500 | LOCKED |
| POST /api/v1/ledger/entries (CTR-API-45) | Corps strict : `journalId, fiscalYearId, entryDate, reviewCycle, sourceDocumentType, initialState` (`IA_PROPOSITION` ou `DRAFT`, défaut `DRAFT`), `lines[1..500]` en centimes entiers ; 201 `{entryId, entryReference, sequenceNumber, status}` | 400 `LEDGER_INVALID_INPUT` ou `ADR_03_FLOAT_FORBIDDEN`, 401 `AUTH_REQUIRED`, 403 `LEDGER_ACCESS_DENIED`, 404 `LEDGER_UNKNOWN_*`, 409, 422 (`LEDGER_UNBALANCED`, `LEDGER_INVALID_LINE`), 503 `LEDGER_STORAGE_FAILURE` | LOCKED |
| POST /api/v1/ledger/entries/:id/submit (CTR-API-46) | Corps `{}` strict ; 200 `{entryId, fromState, toState, replayed}` ; `IA_PROPOSITION` → `DRAFT` | 400, 401, 403, 404, 409 `LEDGER_ENTRY_NOT_IN_EXPECTED_STATE`, 422, 503 | LOCKED |
| POST /api/v1/ledger/entries/:id/visa (CTR-API-48) | Corps `{}` strict ; 200 `{entryId, fromState, toState, replayed}` ; `DRAFT` → `REVISEE_CYCLE` par `engine.visaCycle` (permission `LEDGER_VISA_CYCLE`, plafond du mandat). **Route de visa unitaire** : une pièce à la fois. Visa implicite du mode direct : voir Doc_09 § 06B | 400, 401, 403 (`LEDGER_ACCESS_DENIED`, Step-Up), 404, 409, 422, 503 | LOCKED |
| POST /api/v1/ledger/entries/:id/post (CTR-API-11) | Corps `PostEntryRequestSchema` ; 200 pièce scellée (`POSTED`, seulement depuis `REVISEE_CYCLE`, migration v11) ou 201 brouillon de contre-passation (une seule par pièce, `reversal_of_entry_id`) | 400, 401, 403, 404, 409 (`LEDGER_ALREADY_REVERSED`, `LEDGER_ENTRY_NOT_IN_EXPECTED_STATE`, `LEDGER_NEGATIVE_CASH`), 422, 503 | LOCKED |
| GET /api/v1/ledger/verify-chain?journalId= (CTR-API-47) | 200 `{journalId, valid, length, brokenAtEntryId\|null}` ; une chaîne altérée est un résultat `valid:false`, pas une erreur ; ouverte à tout membre authentifié du dossier | 400, 401, 403, 404, 503 | LOCKED |
| POST /api/v1/banking/reconcile (CTR-API-12) | Corps `ReconcileRequestSchema` ; 200 (suspens ambigu ou aucun rapprochement), 201 (lettrage et brouillon `VAT_CLEARING`) | 400, 401, 403, 404, 409, 422, 503 | LOCKED |
| GET /api/v1/health/deep (CTR-API-13) | Publique (sondes) ; 200 ou 503 `HealthDeepResponseSchema` | — | LOCKED |
| POST /api/v1/invoices/:id/certify (CTR-API-14) | Corps `{}` strict ; 202 `{invoiceId, clearanceState:'SIGNEE_LOI_43_20', workflowInstanceId, displayState:'Validation simulée'}` | 404 `INVOICE_NOT_FOUND` ; 409 `INVOICE_STATE_INVALID`, `INVOICE_CONCURRENT_UPDATE` ; 422 `INVOICE_DATA_INVALID`, `EMITTER_CERTIFICATE_MISMATCH` ; 503 `INVOICE_SOURCE_UNAVAILABLE`, `NUMBERING_UNAVAILABLE`, `SIGNATURE_UNAVAILABLE`, `FACTURX_UNAVAILABLE`, `ARCHIVE_UNAVAILABLE`, `CLEARANCE_WORKFLOW_UNAVAILABLE` ; plus 400, 401, 403 | PROVISIONAL |
| POST /api/v1/invoices/:id/cdv-response (CTR-API-15) | Corps `{status, reason?}` ; 200 `{invoiceId, previousStatus, status, applied, displayState}` | 404 `INVOICE_NOT_FOUND` ; 409 `INVOICE_NOT_SUBMITTED`, `CDV_TRANSITION_INVALID` ; 422 `CDV_GATEWAY_REJECTED` ; 503 `CDV_GATEWAY_UNAVAILABLE` ; plus 400, 401, 403 | PROVISIONAL |
| GET /api/v1/public/verify/:xhubUuid (CTR-API-18) | Publique (limitation de débit puis Turnstile) ; UUID v4 ou v7 strict ; 200 `{invoiceNumber, issueDate, displayState, xmlSha256, emitterIce}`, réduit à `{displayState, xmlSha256}` si `pii_restricted_flag = 1` ; `Cache-Control: no-store` | 400, 403, 404 uniforme (inconnu ou non vérifiable), 429 `RATE_LIMITED` | PROVISIONAL |
| POST /api/v1/pos/sync-batch (CTR-API-16) | Corps strict `{terminalId, tickets[1..200]}` (la limite est le paramètre `maxBatchSize`, 200 en production) ; chaque ticket : `ticketId, sessionId, terminalSeqNumber, issuedAtIso, ticketKind` (`SALE_B2C` ou `RETURN_REFUND`), `originTicketId`, `ht20Cents, vat20Cents, ht10Cents, vat10Cents, ht0Cents, stampDutyCents, totalTtcCents, paidCashCents, paidCardTpeCents, paidDeliveryAppCents, qrConversionToken, prevTicketSha256, ticketSha256, ecdsaSignatureB64` ; réponse `{terminalId, syncedAt, accepted, replayed, rejected, results[{ticketId, terminalSeqNumber, outcome: ACCEPTED\|REPLAYED\|REJECTED, code?}]}` ; **200 si tous les tickets sont acquittés, 207 si au moins un est rejeté** (le code 207 est un choix de P2-A que Doc_07 ne fixait pas) | 400, 401, 403 `POS_TERMINAL_UNKNOWN`, `POS_TERMINAL_INACTIVE` ; 409 `POS_BATCH_CONFLICT` ; 422 `POS_FIELDS_INVALID`, `POS_SIGNATURE_FORMAT_UNKNOWN` ; 429 ; 503 `POS_SYNC_UNAVAILABLE`, `POS_TERMINAL_KEY_INVALID` ; rejet par ticket : `HASH_MISMATCH` et autres codes de `results[].code` | PROVISIONAL |
| POST /api/v1/public/pos-qr/:qrToken/convert-b2b (CTR-API-17) | Publique ; Turnstile et limitation de débit par IP et par jeton ; `Idempotency-Key` ; corps strict `{clientIce (15 chiffres), clientLegalName?}` ; 200 `{conversionState: CONVERTI_B2B_AVANT_Z\|CONVERTI_B2B_POST_Z_NEUTRALISE, invoiceRef, certificationPending}` | 400, 403, 404 `POS_QR_NOT_FOUND` (uniforme), 409 `POS_TICKET_ALREADY_CONVERTED`, `POS_Z_ENTRY_PENDING` ; 422 `POS_CLIENT_ICE_INVALID`, `POS_TICKET_NOT_CONVERTIBLE` ; 429 ; 503 `POS_CONVERSION_FAILED` | PROVISIONAL |

Routes d'authentification (colle `apps/api-hono/src/routes/auth/index.ts`, logique dans `packages/auth-rbac`) : les neuf routes de la table ci-dessous sont **Réalisées** (CTR-API-01 à 09, LOCKED) ; s'y ajoutent, **hors du document d'origine** (noms proposés par S1A ou le pilote, LOCKED à G1) : POST /api/v1/auth/refresh (CTR-API-35, refresh rotatif à usage unique, sans Turnstile), POST /api/v1/auth/logout (36), POST /api/v1/auth/passkeys/register/options (37), /register/verify (38), /authenticate/options (39), /authenticate/verify (40), POST /api/v1/auth/password/reset (41) et POST /api/v1/auth/google/link/confirm (42, passe par `completeFirstFactor` : jamais de session avant le second facteur). Corps réels : login `{email, password}` ; 2fa/verify `{mfa_challenge_token, method, code}`. Turnstile : paramètre `cf-turnstile-response` sur `/google/start` seulement ; `/google/callback` n'accepte que le `state` à usage unique.

**Callback Google (décision du propriétaire, D-23).** Cible : `GET /api/v1/auth/google/callback` répond par une redirection 302 qui pose le cookie de refresh et mène à `/auth/callback`, ou à `/auth/2fa#mfa_challenge_token=…` (jeton en fragment, jamais en paramètre de requête) quand un second facteur est requis ; la réponse JSON reste servie si l'en-tête `Accept: application/json` est présent. **État du code : non réalisé** (`packages/auth-rbac/src/oauth-google-routes.ts` répond encore en JSON : `MFA_REQUIRED`, `LINK_PROOF_REQUIRED` 409, `AUTHENTICATED`). Prévu : vague 3 ou 4, ticket non identifié au backlog.

**Routes décidées par le propriétaire, non construites (« Port »).**

| Route | Spécification retenue | Où elle vit aujourd'hui | Échéance |
|---|---|---|---|
| POST /api/v1/ledger/cycles/:cycleCode/visa (visa de lot) | D-23 : corps `{ fiscalYearId, entryDateUpTo?, expectedEntryIds? }` ; sélectionne les pièces `DRAFT` du cycle et de l'exercice (filtre `entry_date <= entryDateUpTo`) ; `expectedEntryIds` différent de l'ensemble trouvé : 409 `CYCLE_ENTRIES_DRIFT` ; aucune pièce : 409 `NO_ELIGIBLE_DRAFT_IN_CYCLE` ; tri `(entry_date, journal_id, sequence_number, id)` ; passage en `REVISEE_CYCLE` en un seul lot atomique avec une ligne d'audit par pièce. La route unitaire reste | Aucun code, absente du registre | À câbler en jonction ou en P4-A (T-P4A-02) |
| POST /api/v1/pos/terminals/pair (appairage POS) | D-23 : route retenue ; corps et réponse non fixés par D-23 (NON RECOUPÉ) | `PairingGateway`, port injectable de `apps/pos-pwa` (T-P2B-09) ; aucune route serveur | Vague 3 ou 4 ; corps à spécifier par le propriétaire |
| POST /api/v1/companies (création de dossier après onboarding ICE) et GET /api/v1/dashboard/cashflow-vat-90d | D-23 : restent des ports injectables de `apps/web-saas` pour G2, à monter en vague 3 ou 4 | Ports de `apps/web-saas/src/pme/pme-api.ts` | Vague 3 ou 4 |
| Autres routes PME appelées par l'interface (taux de TVA datés, règles CGI par surface, profil émetteur, création de brouillon de facture, relevé bancaire et suggestions de rapprochement, radar de retard Loi 69-21, preuves de litige) | Aucune spécification ; tenues en ports injectables | `apps/web-saas/src/pme/pme-api.ts` | Vague 3 ou 4 ; à spécifier par le propriétaire |

Route interne du conteneur `fiscal-java` (jamais exposée, appel RPC) : POST /validate (CTR-API-P2A-01), GET /health (CTR-API-P2A-02), POST /facturx (CTR-API-P2A-03) ; voir section 07.

**Instantané OpenAPI.** `.meta/openapi.snapshot.json` date de G1 : il ne contient que 8 routes (CTR-API-10, 11, 12, 13, 45, 46, 47, 48). Les routes de `invoices` et de `pos` y sont absentes car elles sont définies dans leurs propres fichiers de schémas (SEAM_REQUEST : à fusionner dans `API_V1_ROUTE_CONTRACTS` par le propriétaire du core) ; les routes d'authentification n'y sont pas non plus (`packages/auth-rbac`). L'instantané est à regénérer par le pilote.

Bloc de routes d'authentification publiques et protégées du registre @fisca_contracts_registry (CTR-API-01 à 09, Réalisé) :

| Endpoint REST Hono | Méthode | Protection | Rôle Exact |
|---|---|---|---|
| /api/v1/auth/register | POST | Turnstile + Rate Limit | Crée le compte Email/Mot de passe et envoie le code SES |
| /api/v1/auth/verify-email | POST | Jeton / Code 6 chiffres | Passe is_email_verified = 1 et ouvre le flux KYB-1 |
| /api/v1/auth/login | POST | Turnstile + Anti-Bruteforce | Vérifie Email/Mot de passe et renvoie JWT ou défi 2FA |
| /api/v1/auth/google/start | GET | PKCE S256 + state KV | Redirige vers Google OAuth 2.0 (openid email profile) |
| /api/v1/auth/google/callback | GET | Vérif JWKS id_token | Lie ou connecte le profil Google puis vérifie le 2FA. Réponse JSON aujourd'hui ; 302 à fragment décidé (D-23), non réalisé |
| /api/v1/auth/password/forgot | POST | Temps constant + SES | Envoie un lien de réinitialisation valable 15 minutes |
| /api/v1/auth/2fa/totp/setup | POST | JWT Actif | Génère le secret TOTP et l'URI QR otpauth:// |
| /api/v1/auth/2fa/totp/enable | POST | Code TOTP valide | Active le 2FA et retourne les 10 codes de secours |
| /api/v1/auth/2fa/verify | POST | mfa_challenge_token | Valide TOTP, OTP Infobip ou code secours et émet le JWT |

## Section 03 — Flux Temps Réel (SSE) & Protocole Offline Fisca POS
Pour offrir une fluidité de tableur sans rechargement lors du dépôt massif de jusqu'à 500 pièces d'achat, le backend diffuse l'avancement via Server-Sent Events :
- Flux GET /api/v1/purchases/stream (Prévu : vague 3, T-P3B-09, CTR-API-22 DRAFT, aucun code serveur ; le client `apps/web-saas/src/pme/sse-fetch.ts` consomme un format provisoire, à valider ou remplacer) : Émet quatre types d'événements typés (ingestion.queued, ocr.fields_extracted, cgi.cash_split_alert, pcge.account_proposed) contenant l'identifiant de ligne fixe pour remplir les rangées de 44px ou 28px sans aucun saut de mise en page.
- Contrat POST /api/v1/pos/sync-batch (Caisse Hors-Ligne) : Reçoit par lots jusqu'à 200 tickets signés localement sur SQLite WASM (terminal_seq_number préfixé par caisse, prev_ticket_sha256, ticket_sha256, ventilation TVA 20 %, 10 %, 0 % et droit de timbre espèces 25 bps). Le Worker vérifie la continuité mathématique de la chaîne SHA-256 avant d'acquitter chaque ticket_id. **Réalisé** (CTR-API-16, voir la table de la section 02) avec ces précisions arbitrées : empreinte = SHA-256 de `JSON.stringify(["FISCA_POS_TKT_V1", …])` (ERRATA D-22) ; **amorce de chaîne = 64 zéros** (CHECK de 64 hexadécimaux, migration v4), et non la genèse de 45 caractères ; `ticketKind` stocké `SALE_B2C` entre dans le tuple sous le libellé « SALE » (table `POS_TICKET_KIND_TUPLE_LABEL`, `RETURN_REFUND` reste « RETURN_REFUND », hypothèse du serveur sans vecteur d'or) ; `terminalSeqNumber` entier dans le tuple et `{terminalId}-{9 chiffres}` en colonne ; empreintes d'or `a9677d45…c7fe` (ticket) et `da7c6566…d7c2` (clôture Z) ; signature ECDSA P-256 par ticket (objet signé : les 64 hexadécimaux de `ticket_sha256` en UTF-8, format `r‖s` en base64 de 64 octets, DER converti : hypothèses à confirmer avec `apps/pos-pwa`) ; timbre espèces 25 bps sur `paid_cash_cents` ; le Ticket Z exclut `CONVERTI_B2B_AVANT_Z`, soustrait `RETURN_REFUND` et compte en date UTC (fuseau paramétrable ensuite) ; la fenêtre hors ligne de 72 h ne se décompte que s'il reste un ticket non synchronisé. Le serveur a refusé 600 tickets sur 600 au tour 1 de G2 (client avec `SALE_B2C`), corrigé par T-P2B-10 (`apps/pos-pwa/src/ticketing/ticket-hash.ts`).
- Contrat POST /api/v1/public/pos-qr/:qrToken/convert-b2b : Appelé lorsqu'un client professionnel scanne le QR Code de son ticket et saisit son ICE à 15 chiffres. Si le Ticket Z associé est déjà comptabilisé, l'endpoint exécute en une seule transaction atomique la création de la facture B2B xHub et l'écriture d'extourne B2C du jour afin d'interdire tout doublon de chiffre d'affaires sur le CPC et SIMPL-TVA. **Réalisé** (CTR-API-17) avec un écart arbitré (D-23) : l'extourne partielle est une écriture de type `B2C_TO_B2B_REVERSAL` liée à la facture par `invoice_id`, sans `reversal_of_entry_id` (l'index unique `uq_journal_entries_reversal_of` n'autorise qu'une contre-passation par pièce). Le QR du ticket est une URL `https://fisca.ma/q/{token}` (base injectée côté caisse, `apps/pos-pwa/src/b2b/qr-conversion.ts`), et non le TLV de Doc_04 ; le segment final est le `qr_conversion_token`. La route publique ne lit aucun abonnement et répond 404 uniforme.
- Appairage d'un terminal : `POST /api/v1/pos/terminals/pair` (décidé en D-23, non construite, voir la table « Routes décidées » de la section 02). Le CHECK de `pos_paired_peripherals` doit recevoir `ESC_POS_TCP_IP` (jonction post-G2, non faite : la valeur est absente du code au 2026-11-14).
## Section 04 — Contrats des Connecteurs ERP (Odoo, Sage 100 & Apache Camel)
**Prévu : vague 3, tickets T-P3C-06 à T-P3C-09 (CTR-API-23 à 28, DRAFT). Aucun code n'existe au 2026-11-14 sur `main` ; les constats de D-22 s'appliquent aux futurs développements.** L'interopérabilité bidirectionnelle avec le parc ERP installé au Maroc repose sur quatre protocoles verrouillés :
- Connecteur Python Odoo (l10n_ma_edi_clearance v17 à v20 ; `X-SaaS-Signature` : en-tête propre à ce connecteur, distinct de `verifySignedWebhookPayload`) : Appelle POST /api/v1/erp/odoo/clearance-entries signé par X-SaaS-Signature (HMAC-SHA256 du corps JSON trié) et Idempotency-Key pour certifier la facture et recevoir en retour dgi_clearance_uuid, ledger_entry_hash et qr_code_payload. Le hook sur account.partial.reconcile appelle POST /api/v1/erp/odoo/reconcile dès qu'un paiement est lettré afin de basculer la TVA sur encaissement et calculer la Loi 69-21.
- Connecteur Hybride Sage 100 (Sage100EdgeAgent en C# .NET 8) : Se connecte par tunnel sortant mTLS pour pousser les écritures extraites de SQL Server (WITH (NOLOCK) via le curseur cbMarq ; le garde SQL impose `NOLOCK` par table, PR n° 8) sur POST /api/v1/erp/sage100/ingest-gl et consommer la file GET /api/v1/erp/sage100/outbound-entries injectée localement via le processus officiel IPMEncoder (Objets100cLib).
- Format Fallback universel .PNM Sage 100 (GET /api/v1/erp/sage100/export-pnm) : Pour les cabinets sans licence Objets Métiers, génère un fichier texte à largeur fixe stricte de 108 caractères par ligne (CRLF ; décision D-22 : montant positif cadré à droite sur les positions 85 à 104, `N` en 105, trois espaces en 106 à 108, somme des débits égale à la somme des crédits, strictement positive, par pièce — journal, date, référence ; générateur testé sous Linux, `Objets100cLib` isolée derrière `ISageWriter` dans un projet `net8.0-windows`, ERRATA B-14) : Code Journal (pos. 1 à 3), Date JJMMAA (4 à 9), Type pièce (10 à 11), Compte CGNC (12 à 24), Type G/X (25), Compte Tiers (26 à 38), Référence facture (39 à 51), Libellé nettoyé (52 à 76), Mode règlement (77), Échéance JJMMAA (78 à 83), Sens D/C (84), Montant formaté (85 à 104) et Type N (105).
- Grands Comptes Apache Camel & OData BI : Le conteneur camel-bridge expose AS4/SFTP/IDoc vers SAP, Oracle et Sage X3 pour synchroniser commandes et bons de réception multi-BL, tandis que GET /api/v1/bi/odata/$metadata livre en lecture seule les vues analytiques agrégées vers Power BI et Apache Superset.
## Section 05 — Webhooks Entrants & Sortants (Payzone, Infobip, SES & xHub)
**Prévu : vague 3, tickets T-P3C-02 à T-P3C-04 (CTR-API-29 à 32, DRAFT). Aucun code de route au 2026-11-14.** Le vérificateur `verifySignedWebhookPayload` est réalisé (`packages/shared-types/src/api-contracts.ts`). Tous les webhooks entrants vérifient la signature cryptographique du fournisseur en temps constant et rejettent tout horodatage décalé de plus de 300 secondes :
- Webhook Payzone (POST /api/v1/webhooks/payzone) : Traite à la fois les renouvellements d'abonnements SaaS et le paiement direct d'une facture client ; dès réception d'un événement PAYMENT_CAPTURED sur une facture B2B, le Worker passe la facture à ENCAISSEE, fige le compteur Loi 69-21 et inscrit la ligne dans le sous-livre SIMPL-TVA du mois.
- Webhook Infobip (POST /api/v1/webhooks/infobip) : Gère d'une part les accusés de livraison OTP (déclenchant le SMS de secours expéditeur FISCA si le message WhatsApp n'est pas remis en 15 secondes), et d'autre part les photos de factures et messages vocaux envoyés au bot WhatsApp (avec message courtois de repli texte/photo si une note vocale Tamazight est détectée en V1).
- Collecteur Email (@ingest.fisca.ma via Cloudflare Email Routing + Amazon SES) : Vérifie SPF/DKIM, identifie le dossier via l'alias unique tenant_databases.ingest_email_alias, extrait les pièces jointes PDF/XML vers INVOICE_QUEUE et reconnaît nativement les grands facturiers marocains (IAM, Orange, inwi, SRM, Jawaz, Afriquia).
## Section 06 — Serveur MCP (mcp.fisca.ma/mcp) & Connecteur Meta Muse
**Prévu : vague 3, T-P3B-10 (7 outils au registre en statut DRAFT ; `packages/ai-agents` ne contient que son point d'entrée).** Le serveur Model Context Protocol tourne sans état sur Cloudflare Workers via createMcpHandler derrière OAuth 2.1 + PKCE. Conformément aux ADR-02 et ADR-10, aucun outil MCP n'accepte d'identifiant de société en paramètre et tous les outils sont répartis en trois classes de sécurité :

| Classe d'Outil MCP | Outils Exposés | Mutation SQL | Validation Humaine Requise |
|---|---|---|---|
| 1. Lecture Certifiée | check_answerable, get_vat_forecast, search_cgi_wiki | Aucune | Non (lecture isolée du dossier) |
| 2. Audit & Contrôle | list_law6921_risks, inspect_fec_exceptions | Aucune | Non (calculs SQL déterministes) |
| 3. Brouillon Préparatoire | create_draft_invoice, propose_od_draft | Brouillon seul | Oui avant toute validation fiscale |

- Interdiction matérielle des actions irréversibles : Aucun outil MCP ne permet de passer une écriture au statut POSTED, de transmettre un fichier définitif à la DGI ni d'émettre un virement bancaire pain.001.
## Section 07 — Contrat XML OASIS UBL 2.1 (CIUS-MA), Factur-X & Signature Loi 43-20
**Réalisé (vague 2, P2-A, PR n° 17) sous régime PROVISOIRE (ERRATA B-13).** Le générateur est `packages/ubl-xades/src/generator` ; les règles marocaines vivent dans le profil remplaçable `packages/ubl-xades/profiles/cius-ma-provisional/` (README et `profile.json` : mapping, hypothèses de nommage). Le fichier est validé par les XSD OASIS UBL 2.1 vendorisés (`packages/ubl-xades/xsd/`, `pnpm test:xsd`) et par PHIVE (conteneur `fiscal-java`) ; il **n'est pas déclaré conforme EN 16931** : le contrôle croisé `tests/phive-crosscheck.test.ts` affirme exactement les écarts connus `KNOWN_PHIVE_DEVIATIONS` (BR-CL-10, BR-CL-11, BR-CO-09, BR-CL-24 ; `packages/ubl-xades/src/known-phive-deviations.ts`) et échoue sur toute autre règle. Le texte d'origine ci-dessous reste l'intention.
Chaque facture électronique émise génère un fichier XML OASIS UBL 2.1 (cible : conformité à la norme EN 16931, validé par ph-ubl et PHIVE ; réalisé : profil provisoire à écarts PHIVE connus) et embarqué dans un PDF/A-3b Factur-X bilingue Français/Arabe via Mustangproject (réalisé : voir « Factur-X » ci-dessous) :
- Codes de types UBL supportés : 380 (Facture commerciale ou décompte BTP), 381 (Avoir référençant obligatoirement l'UUID xHub initial dans BillingReference), 383 (Note de débit), 386 (Facture d'acompte) et 389 (Autofacturation mandatée). **Réalisé :** 380, 383, 386 et 389 sont émis en racine `Invoice` (la note de débit 383 est une `Invoice` de `InvoiceTypeCode` 383, car PHIVE rejette l'élément `DebitNote`, décision du pilote, D-23) ; 381 est émis en `CreditNote`. Numéro de facture `{FAC|AVO|NDB|ACO|AUT}-{AAAA}-{SEQ6}`. Taux de TVA : 2000, 1000 ou 0 points de base.
- Mapping des identifiants légaux marocains (Art. 145 CGI & Lois 5-96 / 17-95) : L'ICE à 15 chiffres occupe PartyLegalEntity/CompanyID (schemeID="MA:ICE"), l'Identifiant Fiscal occupe PartyTaxScheme/CompanyID (schemeID="MA:IF"), la forme juridique et le capital social occupent CompanyLegalForm, et les numéros RC, Taxe Professionnelle et CNSS sont sérialisés dans AdditionalPartyIdentification.
- Chaînage et cas métiers Maroc : Le hash SHA-256 de la facture validée précédente (PIH) et le compteur monotone ICV sont inscrits dans AdditionalDocumentReference (**réalisé :** l'ICV est porté par `cbc:UUID`, convention ZATCA, hypothèse non officielle marquée dans le profil ; le PIH est joint en `text/plain`, écart BR-CL-24 connu ; empreinte = SHA-256 de `JSON.stringify` du tuple de 13 éléments `FISCA_INV_PIH_V1`, `totalHtCents` = `invoices.total_ht_cents` hors débours, `totalTtcCents` engage les débours ; genèse de 45 caractères `GENESIS_HASH_` + 32 zéros, empreinte d'or `0ec5abda…a797`, ERRATA D-22 et D-23) ; les lignes de Débours utilisent la catégorie hors champ O sans TVA, la Retenue de garantie BTP (7 % ou 10 %) et la RAS-TVA (75 % ou 100 %) sont portées en WithholdingTaxTotal (**réalisé :** `WithholdingTaxTotal` n'existe que dans `Invoice` ; la retenue de garantie est donc refusée explicitement sur l'avoir 381, échec fermé ; les vecteurs débours, retenue et timbre sont NON RECOUPÉS, article de loi à confirmer par l'expert-comptable), et le droit de timbre espèces (0,25 %) en AllowanceCharge.
- Enveloppe de signature XAdES-Baseline-T (Loi 43-20) : **Réalisé avec des clés de test seulement** (`packages/ubl-xades/src/signature`) : `xades:SigningCertificate` (forme V1 par défaut ; `SigningCertificateV2` n'existe pas dans le XSD OASIS vendorisé), client CSC v2.0 mTLS avec conversion explicite des formats de retour du HSM (DER vers `r‖s`, RSA PKCS#1 v1.5) et échec fermé sur format inconnu, contrôle OID == ICE/IF par `assertCertificateMatchesEmitter` (préfixes eIDAS `NTRMA-`, `ICEMA-`, `VATMA-`, `IFMA-`, CN exclu), jeton RFC 3161 au contrôle PARTIEL (empreinte, `genTime`, nonce ; signature de la TSA, chaîne et révocation non évaluées : jamais « horodatage qualifié »). Les numéros de série de certificat de plus de 20 chiffres décimaux sont à surveiller avec xmllint (Barid eSign en émet jusqu'à 48). Aucune signature « qualifiée » n'est produite. Injectée dans UBLExtensions avec canonisation xml-c14n11, vérification préalable que l'OID 2.5.4.97 ou 2.5.4.5 du certificat Barid eSign correspond à l'ICE/IF émetteur, signature HSM distante /csc/v2/signatures/signHash et jeton EncapsulatedTimeStamp RFC 3161.
- **Factur-X (réalisé, PROVISOIRE) :** `POST /facturx` du conteneur `fiscal-java` (CTR-API-P2A-03, interne, jamais exposé) produit un PDF/A-3b bilingue FR/AR. Mustang refuse l'UBL (`setXML` exige du CII) : la facture est embarquée en `ubl-invoice.xml` avec `fx:ConformanceLevel=UBL21-PROVISIONAL` (valeur non standard ; écart documenté dans `FACTURX-NOTES.md`) ; ne jamais écrire « Factur-X conforme ». Le PDF/A-3b n'est validé que par veraPDF 1.30.4 dans le conteneur (second validateur non fait, veraPDF absent du bac à sable de l'auditeur) ; le Dockerfile n'a jamais été construit (pas de Docker dans le bac à sable). Polices : IBM Plex Sans Arabic pour le PDF (D-23). Montants en lettres FR et AR : 70 vecteurs PROVISOIRES, relecture native requise. QR du ticket et du PDF : URL de vérification Fisca « QR provisoire, non publié par la DGI/xHub ». Aperçu filigrané avant clearance, PDF/A-3b scellé après attribution de `xhubUuid` (D-23).
- **Télétransmission xHub (réalisé en passerelle `simulated`) :** `DgiClearanceWorkflow` (`packages/ubl-xades/src/clearance`) : départ depuis `SIGNEE_LOI_43_20`, un envoi puis 8 réessais (9 tentatives, 8 attentes de 84 à 10 752 s, 21 420 s au plus, soit au plus 6 h), 8 statuts CDV reconstitués avec 9 transitions ajoutées par hypothèse. L'affichage dit « Validation simulée ». Câblage de production : jonction après G2 non faite (ré-export de `DgiClearanceWorkflow`, `env.resolveClearancePorts`, file `fisca-xhub-clearance`). Migration prévue (v12) : états `EN_ATTENTE_XHUB` et `ECHEC_TECHNIQUE_XHUB` dans le CHECK de `clearance_state` ; en attendant, l'échec définitif est une ligne d'audit.
## Section 08 — Contrats XSD DGI Lot 1 : SIMPL-TVA v4.0, RAS-TVA & Loi 69-21
**Prévu : vague 3, P3-A (T-P3A-02 et suivants).** Aucun code au 2026-11-14 (`packages/edi-simpl` ne contient que son point d'entrée). Les schémas officiels DGI ne sont pas publiés (ERRATA B-13) : si les `.xsd` officiels sont absents au démarrage de P3-A, la session n'est pas bloquée (`MISSING_INPUT` exclu) ; elle écrit des XSD structurels stricts dérivés exclusivement de Doc_07 §§ 08 à 10, validés par xmllint et marqués `PROVISIONAL_STRUCTURAL_XSD_PENDING_OFFICIAL_DGI_PACK`, sans jamais revendiquer d'homologation DGI (D-23). Ces quatre flux sont encodés en UTF-8, validés contre leurs schémas .xsd (cible : officiels ; provisoires structurels tant que le pack DGI n'est pas déposé dans `docs/reference/dgi/`) et compressés en archive .zip avant téléchargement :
- Relevé de Déductions SIMPL-TVA Annexe v4.0 (DeclarationReleveDeduction) : Impose un ordre séquentiel strict où la balise prorata (entier de 0 à 100) doit impérativement figurer entre tx et mp sous peine de rejet immédiat. Le code moyen de paiement mp/id est un entier de 1 à 7, l'unicité (if_fournisseur + num_facture) est garantie et l'égalité mht + tva == ttc est vérifiée au centime près.
- RAS-TVA Flux Fournisseur (DeclarationReleveRetenueSource — Annexe RDRS v1.0) : Permet au fournisseur d'imputer la TVA retenue à la source ; contrôle typeClient (1 à 4 public, 5 privé rendant refClient/if obligatoire), natureOperation (4 équipement, 5 travaux, 6 services), tauxTva limité à 20 ou 10 à compter de 2026, et tauxRetenue égal à 75 ou 100.
- RAS-TVA Flux Client Payeur (DeclarationVersementRASTVA) : Toujours mensuel (mois de 1 à 12), déclare pour chaque facture payée supérieure à 5 000 MAD TTC la base, le taux de retenue (75 % si attestation fiscale valide de moins de 6 mois au jour du décaissement, sinon 100 %) et le montant reversé.
- Délais de Paiement Loi 69-21 (DeclarationDelaisPaiement — Modèle ADC500B-23I v1.0) : Déclaration trimestrielle calculant l'échéance à partir de dateLivraisonMarchandise (60j légal, 120j contractuel ou 180j sectoriel), isolant sans pénalité les factures en montantFactureObjetLitige documentées dans R2, et arrondissant amendePecuniaire au dirham supérieur via Math.ceil.
## Section 09 — Contrats XSD DGI Lot 2 : SIMPL-IS v2.0.3, État des Ventes & DRVT
**Prévu : vague 3, P3-A (T-P3A-04 et suivants).** Aucun code au 2026-11-14. Les codes `codeEdi` SIMPL-IS officiels ne sont pas dans le dépôt : le site marketing affiche `simpl_is_code_edi` à null (« en attente d'import du référentiel XSD officiel DGI »), et P3-A suit la directive des XSD structurels provisoires (D-23). Le moteur packages/edi-simpl couvre la liasse fiscale complète et les quatre annexes de recoupement croisé de SIMPL-IS v2.0.3 :
- Liasse Fiscale SIMPL-IS v2.0.3 (Liasse en .zip, taille XML inférieure à 1 Mo) : Identifie le modèle comptable (1 Normal, 2 Simplifié, 3 Crédit, 4 Assurance), sérialise les cellules statiques ValeurCellule/cellule/codeEdi, les lignes répétables numeroLigne (Tableaux 3, 16, 18) et extraFieldvaleurs. Conformément à la v2.0.3, l'exporteur émet obligatoirement les lignes TOTAL GENERAL des Tableaux 4 (14045 à 14052) et 8 (14061 à 14064), les sous-totaux du Tableau 3 (18009, 18010, 18012, 18013), exclut les anciennes cellules 11501 à 11504 et omet les cellules nulles non obligatoires.
- État des Ventes par Client (EtatVentesParClient — Art. 20-I CGI) : Agrège par client B2B marocain (doté d'un ICE à 15 chiffres et d'un IF) les ventes HT/TTC, les rabais sur avoirs (comptes 7119/7129), le net, les encaissements TTC et le solde final 3421, après contrôle bloquant vérifiant que le CA domestique du CPC égale la somme de cet état B2B et des ventes B2C.
- Galaxie DRVT v2.0.3 (3 archives XML distinctes) :
- DeclarationRemunerationTiers (annuelle) : sépare honoraires et commissions soumis à la RAS (5 % pour personne morale IS, 10 % pour personne physique IR) et génère le nouveau bloc produitsLocationImmeubles incluant numArticleTaxeServicesCommunaux et la RAS sur loyers (10 % ou 15 % dès 120 000 MAD bruts/an).
- VersementRASRemunerationTiers (mensuelle) : prépare le brouillon de télépaiement mensuel de la retenue opérée.
- ImputationRASRemunerationTiers : inclut la balise obligatoire exercicePrelevement et la référence de quittance DGI pour déduire la RAS de 5 % subie des acomptes d'IS (typeVersementIS de 1 à 6).
## Section 10 — Contrats XSD DGI Lot 3 : État 9421, FEC-MA 24 Colonnes, SAF-T & ISO 20022
- **Prévu : vague 3, P3-A.** Aucun code au 2026-11-14. Le fichier FEC reprend 18 colonnes standard (ordre confirmé par le propriétaire, D-23 : JournalCode, JournalLib, EcritureNum, EcritureDate, CompteNum, CompteLib, CompAuxNum, CompAuxLib, PieceRef, PieceDate, EcritureLib, Debit, Credit, EcritureLet, DateLet, ValidDate, Montantdevise, Idevise ; mention « Profil Fisca Art. 211 CGI en attente d'arrêté technique DGI ») suivies des 6 extensions marocaines ; le validateur du site marketing en porte une copie provisoire (`FEC_MA_PROVISIONAL_PROFILE`). État 9421 des Traitements et Salaires (TraitementEtSalaire — SIMPL-IR) : Livré en fichier .xml non compressé couvrant impérativement l'année civile du 1er janvier au 31 décembre. Contient les 38 balises d'en-tête suivies des 10 collections dans leur ordre exact, en corrigeant les divergences du parseur réel de la DGI : numPPR placé entre numCE et numCNSS, listSalariesCFC placée à l'intérieur de la racine juste après listPersonnelOccasionnel, balises d'identité vides auto-fermées, codes de paiement limités à ES, CH ou SIR, charges de famille plafonnées à 6, et cadrage préalable avec les comptes CGNC 6171 et 44525.
- Pack Contrôle Fiscal Informatisé Art. 211 CGI : Génère trois fichiers scellés ensemble :
- Le fichier plat {IF}FEC{YYYYMMDD}.txt à 24 colonnes séparées par pipe (|), encodé en UTF-8 avec fins de ligne CRLF, plaçant le journal d'ouverture AN équilibré en tête et ajoutant aux 18 colonnes standard les 6 extensions marocaines (TiersIF, TiersICE, ClearanceUUID, ModePaiementDGI, EntryHashSHA256, PrevHashSHA256).
- Le fichier XML SAF-T CGNC v2.0 (AuditFile OCDE v2.00 adapté Maroc).
- La notice descriptive réglementaire DESCRIPTIF_COMPTABILITE_ART211.json (et son PDF signé Loi 43-20) certifiant l'absence de trou de séquence et l'empreinte SHA-256 globale.
- Contrats Bancaires ISO 20022 : Génération du fichier XML de virement groupé pain.001.001.03 (refusant d'inclure toute facture dont le fournisseur a le statut ALERTE_RIB_DAF) et ingestion normalisée des relevés camt.053, SWIFT MT940 et CFONB 120.
## Section 11 — Code de Référence : Schémas OpenAPI Zod & Vérificateur Webhook
**Le code réel de `packages/shared-types/src/api-contracts.ts` prime sur l'illustration ci-dessous** (Zod 4, `z.strictObject`, `Ice15Schema` avec clé de contrôle modulo 97, `ProblemDetailsSchema` avec `instance` et `issues[]` en camelCase, `verifySignedWebhookPayload`). Ce module TypeScript sans aucun type any (packages/shared-types/src/api-contracts.ts) sert de contrat canonique entre le backend Hono, les frontends React/POS et les partenaires externes (le code ci-dessous est le code de référence d'origine, non maintenu) :

```ts
import { z } from "zod";

// 1. Primitives Monétaires Entières & Identifiants Fiscaux Marocains (Zéro Float)
export const CentimesIntSchema = z.number().int().safe();
export const BpsIntSchema = z.number().int().min(0).max(10000);
export const MilliIntSchema = z.number().int().positive();
export const Ice15Schema = z.string().regex(/^\d{15}$/, "L'ICE doit comporter exactement 15 chiffres.");
export const VatRate2026BpsSchema = z.union([
  z.literal(2000),
  z.literal(1000),
  z.literal(0),
]);

// 2. Contrat d'Émission de Facture Électronique UBL 2.1 / Clearance xHub
export const CreateInvoiceRequestSchema = z.object({
  ublTypeCode: z.enum([
    "380_FACTURE",
    "381_AVOIR",
    "383_NOTE_DEBIT",
    "386_ACOMPTE",
    "389_AUTOFACTURATION",
  ]),
  originInvoiceId: z.string().uuid().optional(),
  isBtpProgressStatement: z.boolean().default(false),
  btpRetentionRateBps: z.union([z.literal(0), z.literal(700), z.literal(1000)]).default(0),
  partnerId: z.string().min(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  serviceDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ublPaymentCode: z.enum([
    "10_ESPECES",
    "20_CHEQUE",
    "30_VIREMENT",
    "42_EFFET_LCN",
    "48_CARTE",
    "97_COMPENSATION",
  ]),
  lines: z.array(
    z.object({
      isDisbursementDebours: z.boolean().default(false),
      descriptionFr: z.string().min(2).max(500),
      descriptionAr: z.string().max(500).optional(),
      quantityMilli: MilliIntSchema,
      unitPriceCents: CentimesIntSchema.nonnegative(),
      discountBps: BpsIntSchema.default(0),
      vatRateBps: VatRate2026BpsSchema,
      vatExemptionReasonCode: z.string().optional(),
      pcgeAccountNumber: z.string().regex(/^\d{4,8}$/),
    })
  ).min(1),
}).superRefine((val, ctx) => {
  if ((val.ublTypeCode === "381_AVOIR" || val.ublTypeCode === "383_NOTE_DEBIT") && !val.originInvoiceId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "originInvoiceId est obligatoire pour un Avoir (381) ou une Note de Débit (383).",
      path: ["originInvoiceId"],
    });
  }
  val.lines.forEach((line, idx) => {
    if (line.vatRateBps === 0 && !line.isDisbursementDebours && !line.vatExemptionReasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Motif légal d'exonération (Art. 91 ou 92 CGI) obligatoire pour une ligne à 0 % hors débours.",
        path: ["lines", idx, "vatExemptionReasonCode"],
      });
    }
  });
});

// 3. Enveloppe d'Erreur Déterministe Conforme RFC 9457
export const ProblemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int(),
  errorCode: z.string(),
  legalRef: z.string().optional(),
  traceId: z.string(),
  detail: z.string(),
});

// 4. Vérificateur Cryptographique de Webhooks (HMAC-SHA256 Temps Constant + Anti-Rejeu 300s)
export async function verifySignedWebhookPayload(params: {
  readonly rawBodyText: string;
  readonly signatureHexHeader: string;
  readonly timestampSecHeader: string;
  readonly sharedSecret: string;
  readonly maxSkewSeconds?: number;
}): Promise<boolean> {
  const maxSkew = params.maxSkewSeconds ?? 300;
  const ts = Number.parseInt(params.timestampSecHeader, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(ts) || Math.abs(nowSec - ts) > maxSkew) {
    return false;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(params.sharedSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signedMessage = `${params.timestampSecHeader}.${params.rawBodyText}`;
  const macBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(signedMessage));
  const expectedBytes = new Uint8Array(macBuffer);

  if (params.signatureHexHeader.length !== expectedBytes.length * 2) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    const providedByte = Number.parseInt(params.signatureHexHeader.slice(i * 2, i * 2 + 2), 16);
    diff |= (expectedBytes[i] ?? 0) ^ providedByte;
  }
  return diff === 0;
}
```

## Section 12 — Protocole @fisca_contracts_registry & Harnais de Tests QA
Pour que trois sessions parallèles Hyperagent construisent simultanément le backend, l'interface React/POS et les connecteurs ERP sans aucun décalage :
- Publication automatique OpenAPI : Toute modification d'une route dans apps/api-hono régénère packages/shared-types/openapi.json et met à jour la ligne correspondante dans la table globale @fisca_contracts_registry. **Réalisé autrement :** `pnpm --filter @fisca/api-hono openapi:gen` produit le document (artefact non commité, ERRATA D-18) ; l'instantané commité est `.meta/openapi.snapshot.json` (état de G1 : 8 chemins seulement, à régénérer par le pilote) ; le registre est la table `fisca_contracts_registry` (statuts LOCKED, PROVISIONAL, DRAFT ; les contrats PROVISIONAL gardent ce statut, B-13), mise à jour par les voies et par l'auditeur, pas automatiquement.
- Suite de validation XSD hors-ligne (pnpm test:xsd ; **réalisé** : script racine `pnpm test:xsd` qui lance `@fisca/ubl-xades test:xsd`, 32 documents dont 7 CDV valides à G2 ; les XSD OASIS UBL 2.1 sont dans `packages/ubl-xades/xsd/`, pas dans `packages/edi-simpl/xsd/`, qui n'existe pas ; les autres schémas : prévu en vague 3) : Stocke dans packages/edi-simpl/xsd/ les schémas officiels OASIS UBL 2.1, SIMPL-TVA v4.0, SIMPL-IS v2.0.3, État 9421, DRVT v2.0.3, ADC500B-23I et ISO 20022 pain.001, et valide chaque XML généré avec xmllint --noout --schema lors des Barrières QA.
- Tests d'intrusion contractuels obligatoires : L'agent Fisca-QA-Security-Auditor vérifie le rejet HTTP 400 de tout montant décimal flottant, le rejet HTTP 401 d'un webhook rejoué à t + 301s, l'idempotence exacte d'un double appel certify portant la même Idempotency-Key, et l'absence totale de paramètre tenant_id sur l'ensemble des outils exposés par mcp.fisca.ma/mcp.
