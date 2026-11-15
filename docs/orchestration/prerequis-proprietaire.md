# Prérequis du propriétaire : tout ce qu'il doit fournir ou décider

Rédigé par le pilote le 2026-11-14 (état : vagues 0 à 2 fusionnées, `main` `3496824`). Un seul tableau pour ne rien oublier. « Si absent » dit ce qui se passe : **BLOCAGE DUR** (le ticket reste `BLOCKED`, le pilote s'arrête en `STOP_OWNER` si plus rien n'est exécutable), **REPLI** (la voie continue avec le repli documenté) ou **TOLÉRÉ** (n'empêche rien avant l'échéance). Détails par session : `preparation-vague-3.md`, `preparation-vague-4.md`, `preparation-s5-release.md`.

## 1. Avant de lancer la vague 3

| N° | Quoi | Nature | Pourquoi | Si absent | Option par défaut | Source |
|---|---|---|---|---|---|---|
| 1 | **Autoriser** le ticket de jonction « J2 » puis la vague 3 | Décision | Le propriétaire a demandé l'arrêt après la vague 2 | BLOCAGE DUR (rien ne démarre) | — | `preparation-vague-3.md` § 7 |
| 2 | Cahiers des charges EDI de la DGI (SIMPL-TVA, SIMPL-IS, 9421, DRVT, Loi 69-21) à déposer dans `docs/reference/dgi/<sujet>/` avec `SOURCE.md` | Fichiers | T-P3A-01 à 09. Annoncés par le propriétaire le 2026-11-14 ; **non reçus** dans le fil du pilote | REPLI : XSD structurels provisoires (D-23) | XSD dérivés de Doc_07 §§ 08 à 10, marqués provisoires | ERRATA B-13, D-23 |
| 3 | Table des cellules SIMPL-IS (cellule, `codeEdi`, règle, tableau) et les **5 opérateurs** du DSL | Jeu de données | T-P3A-05 et T-P3A-06 : plus de 1 500 cellules, aucune table dans le dépôt | REPLI | Sous-ensemble : cellules citées par Doc_07 § 09 | `preparation-vague-3.md` |
| 4 | Spécification du SAF-T « CGNC v2.0 » | Texte | T-P3A-10 | REPLI | Structure provisoire dérivée de l'OCDE v2.00 | idem |
| 5 | Poids de modèles (TableFormer, OCR) et leurs empreintes SHA-256, ou autorisation de téléchargement ; fournisseur d'inférence (Workers AI) | Fichiers, accès | T-P3B-01 et T-P3B-03 | REPLI | Chemin de poids monté, vérification par fichier d'empreintes, faux poids dans les tests | idem |
| 6 | Liste des vues OData BI | Décision | T-P3C-09 | REPLI | Vue de balance et vue de TVA en lecture seule | idem |
| 7 | Accord npm (`registry.npmjs.org`) pour chaque fil | Accord | Tout `pnpm install` | BLOCAGE DUR de la voie | Bouton Allow de la boîte de réception | `docs/orchestration/sandbox.md` |
| 8 | Protection de `main` (PR obligatoire, 0 approbation, force-push et suppression bloqués) | Réglage GitHub | Sécurité | TOLÉRÉ (le pilote s'interdit déjà ces actes) | — | `README.md` § 6 |

## 2. Avant la vague 4

| N° | Quoi | Nature | Pourquoi | Si absent | Option par défaut | Source |
|---|---|---|---|---|---|---|
| 9 | **Jeton GitHub** renouvelé avec la permission « Workflows : lecture et écriture » (le jeton actuel expire le **2026-12-12** et n'a pas cette permission) | Secret | T-P4C-06 et T-P4C-07 : sans elle le push de `.github/workflows` est refusé | BLOCAGE DUR de ces deux tickets (`MISSING_INPUT`) | — | ERRATA B-12 |
| 10 | Comptes et jetons **Cloudflare** (D1, R2, Queues, Vectorize, Secrets Store, Containers, for SaaS), noms de ressources, zone `fisca.ma` | Secrets, accès | T-P4C-05, staging, S5 | REPLI jusqu'à S5 (scripts écrits et testés à blanc) | `--dry-run` | `preparation-vague-4.md` |
| 11 | **Ouverture d'une D1 par société** : accord pour l'option par défaut (API REST de D1) après un spike | Décision | Trou T-1 de `preparation-vague-4.md` | BLOCAGE DUR du câblage de production | API REST derrière `createD1TenantDriver`, à mesurer | idem |
| 12 | Session **P4-D** pour les routes PME et de mandat, et tickets de jonction J3 (fetch de production, route de visa de lot) et J4 (caisse) | Décision | Trou T-3 et T-4 | REPLI : routes en ports jusqu'à la v1.0.0 | P4-D rédigée par le pilote | idem |
| 13 | Corps des routes **d'appairage POS** (`POST /api/v1/pos/terminals/pair`), **de création de dossier** (`POST /api/v1/companies`) et **de mandat** (invitation, révocation) | Spécification | Aucune spécification | REPLI : ports | — | ERRATA D-23 |
| 14 | Routes SSO (SAML, OIDC, SCIM) et `payments/*` ; contenu du **Kit CNDP client** | Spécification | T-P4A-04 à 07 | REPLI : écrans sur ports | Kit = mentions et durées de Doc_11 | `preparation-vague-4.md` |
| 15 | Décision sur **`expected_closing_cash_cents`** (ne pas persister avant le dépôt du comptage, ou chiffrer) | Décision | Réserve à lever avant G4 ; change l'échange avec le serveur | Réserve ouverte à G4 | Ne pas persister avant le dépôt | rapport G2 |
| 16 | Hébergeur du **serveur miroir au Maroc** (Casablanca ou Rabat), stockage MinIO, GPU éventuel (mode souverain) | Compte, matériel | T-P4C-01 à 03 en exécution réelle | REPLI : tests sur PostgreSQL et Redis natifs, doubles | — | Doc_16 § 06 |
| 17 | **ANRT** : enregistrement DNS, DNSSEC, second fournisseur DNS | Réglage | Quorum multi-DNS, Go-Live 2 | TOLÉRÉ jusqu'à S5 | Simulation de sondes | Doc_16 § 04 |

## 3. Avant S5 (release)

| N° | Quoi | Nature | Pourquoi | Si absent | Option par défaut | Source |
|---|---|---|---|---|---|---|
| 18 | **Barid eSign** : certificat qualifié, accès HSM (CSC v2.0), fournisseur d'horodatage RFC 3161 | Secrets, certificat | Go-Live 4 ; signatures de test seulement avant | BLOCAGE DUR de S5 | — | Doc_17 § 06 |
| 19 | Comptes réels : **Infobip** (expéditeur FISCA, WhatsApp Business Meta), **Amazon SES** (eu-west-3), **Payzone** et SIMT, **DirectInfo OMPIC**, application **Google OAuth** | Comptes | Go-Live 3 ; tests simulés avant | BLOCAGE DUR de S5 pour les points concernés | — | Doc_17 |
| 20 | **DGI et xHub** : spécifications publiées (profil UBL, XSD, Schematron, API), accès sandbox | Texte, accès | Remplacer le profil provisoire, activer la passerelle `live` | TOLÉRÉ : la v1.0.0 sort en « Validation simulée » | Profil provisoire | ERRATA B-13 |
| 21 | Tablette réelle pour le test d'autonomie de la caisse (10 tickets en mode avion) | Matériel | Go-Live 6 | BLOCAGE DUR du point | — | Doc_16 § 12 |
| 22 | **Expert-comptable** : relecture de la liste de `preparation-s5-release.md` § 4 | Validation | T-S5-03 | BLOCAGE DUR de la certification fiscale | — | ERRATA E |
| 23 | **Relecteurs natifs** : `ar`, `ary`, `zgh-Latn`, `zgh-Tfng`, arrêtés en lettres FR et AR | Validation | T-S5-03 | TOLÉRÉ avec marqueur de relecture | Marqueur « à relire » affiché | `preparation-s5-release.md` § 5 |
| 24 | **Clé de signature** du tag `v1.0.0` et du SBOM | Secret | T-S5-01 et T-S5-04 | REPLI : SBOM non signé avec empreinte ; le tag est posé par le propriétaire | Le propriétaire signe localement | idem |
| 25 | Récépissés **CNDP** (F115, F211, F112, F118) et DPO | Documents | Mentions du site (aujourd'hui `null`) | TOLÉRÉ | « En cours d'enregistrement » | ERRATA D-23 |
| 26 | Message de lancement `RELEASE S5 : OUI` | Décision | Garde de S5 | BLOCAGE DUR | — | `pilotage-automatique.md` § 7 |

## 4. Décisions déjà prises (rappel, rien à faire)

Jeu de 61 comptes (écart de comptage signalé), visa du gérant et du DAF, prorata journalier, polices (Noto Web, IBM Plex PDF), `zgh-Tfng` en LTR, 20 routes en `noindex`, 18 colonnes FEC, durée de la fenêtre hors ligne, seuil d'écart de la caisse, QR en URL, `RETURN_REFUND` → « RETURN_REFUND » (hypothèse du serveur, aucun vecteur fourni), barème 1 + 8 réessais, migration v12 et `ESC_POS_TCP_IP` (à faire dans J2), route de visa de lot (spécifiée). Toutes dans `docs/specs/ERRATA.md` D-22 et D-23.

## 5. Calendrier de blocage

| Moment | Bloque dur | Tolère un repli |
|---|---|---|
| Lancement de J2 et de la vague 3 | N° 1 (autorisation), n° 7 (npm) | N° 2 à 6 : XSD provisoires, sous-ensemble de cellules, poids montés, vues OData minimales |
| Milieu de la vague 3 | — | Réserves à lever avant G3 : chiffrement des réponses d'idempotence, durcissement du scrubber et du filtre d'injection |
| Lancement de la vague 4 | N° 11 (D1 par société) avant le câblage de production | N° 12 à 14, 16, 17 : ports et doubles |
| T-P4C-06 | **N° 9 (jeton avec Workflows)** | — |
| G4 | N° 15 (décision sur le montant attendu) ou réserve ouverte consignée | — |
| S5 | N° 18, 19 (comptes réels), 21, 22, 26 | N° 20, 23, 24, 25 |
