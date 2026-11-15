# Préparation de la session finale S5 (release v1.0.0)

Rédigé par le pilote le 2026-11-14, à partir de `main` `3496824`, de l'ERRATA révision e, du backlog, de Doc_14 § 12 et de Doc_16 § 12. Même convention que `preparation-vague-3.md` : **PROPOSITION DU PILOTE (à valider)** ou **À TRANCHER PAR LE PROPRIÉTAIRE** (question exacte, option par défaut). Branche : `feat/w5-release-v1.0.0` (ERRATA A-02). Voies : PILOTE (S5-A) et AUDIT (S5-B). La release ne part que si le message de lancement dit `RELEASE S5 : OUI` (aujourd'hui : NON).

## 1. Principe

S5 ne construit rien : elle déploie une release candidate sur **staging**, la teste, valide huit points matériels, et émet un certificat. Elle suppose les vagues 0 à 4 fusionnées et G4 favorable. Trois limites structurelles du bac à sable en font une session où **le propriétaire fait ou atteste** plusieurs vérifications : pas de Docker, pas de matériel réel, aucun compte tiers réel.

## 2. Les quatre tickets

| Ticket | Objectif | Entrées nécessaires | Critère de sortie vérifiable | Manques et incohérences détectés | Proposition ou question |
|---|---|---|---|---|---|
| T-S5-01 | Déployer la release candidate sur `staging.fisca.ma`, générer le SBOM CycloneDX signé, vérifier les verrous CNDP UE et DGSSI | Compte Cloudflare, jetons, ressources `fisca-staging-*` (compétence `fisca-cloudflare-staging-deploy`), workflows P4-C | Déploiement répondant 200 sur la santé profonde ; SBOM présent avec empreinte ; verrous CNDP vérifiés par API | « SBOM signé » : **outil de signature et clé non spécifiés** (Doc_16 § 11 ne montre que `npx @cyclonedx/cyclonedx-npm`) ; l'outil `execute` de Cloudflare MCP est interdit aux agents (cartographie) | **À TRANCHER PAR LE PROPRIÉTAIRE** : outil et clé de signature (par exemple cosign avec clé du propriétaire). **Option par défaut** : SBOM non signé avec empreinte SHA-256 consignée, signature faite par le propriétaire |
| T-S5-02 | Test de fumée E2E sur staging, tir de charge de 500 pièces, déclenchement automatique de `wrangler rollback` | Staging déployé, `verify:gate --browser` | Tir de charge sans erreur ; rollback exécuté automatiquement sur un endpoint de santé défaillant simulé, en moins de 30 s (Doc_16 § 12) | Les 500 pièces : contenu non défini (factures, tickets, écritures ?) ; limites d'écriture D1 et quotas Cloudflare inconnus | **PROPOSITION** : 500 écritures de grand livre et 100 factures simulées via les routes réelles ; mesures consignées |
| T-S5-03 | Valider les 8 points Go-Live | Voir section 3 | Les huit cases cochées, chacune avec preuve | Quatre points exigent du matériel ou des comptes **réels** (voir section 3) | Le propriétaire exécute ou atteste ces points ; l'auditeur vérifie la preuve fournie |
| T-S5-04 | Certificat final Go-Live (R1, R2, R3 à 95 sur 100), tag Git signé `v1.0.0`, clôture du document d'état | G4 favorable, T-S5-03 terminé | Certificat émis par l'auditeur ; tag posé ; document d'état clôturé | **Qui signe le tag ?** L'auditeur est en lecture seule (A-03) ; le pilote n'a pas de clé de signature ; Doc_16 (workflow `cd-production.yml`) se déclenche sur un tag signé `v*.*.*` ; le tag reste une décision du propriétaire (pilotage automatique § 7) | **À TRANCHER PAR LE PROPRIÉTAIRE** : clé de signature (GPG ou SSH). **Option par défaut** : le pilote prépare le commit de release, le propriétaire pose le tag signé localement (`git tag -s v1.0.0`) ; l'auditeur vérifie la signature |

## 3. Les huit points Go-Live (Doc_16 § 12) : qui peut les faire

| N° | Point | Exécutable par un agent ? | Ce qu'il faut |
|---|---|---|---|
| 1 | Résidence UE et verrou WORM (R2 `jurisdiction: "eu"`, Object Lock Compliance 3 653 jours, MinIO Maroc de même rétention) | Oui, par API, avec jetons | Compte Cloudflare ; nœud MinIO Maroc (hébergeur) |
| 2 | DNSSEC et double DNS (chaîne AD valide chez l'ANRT, zone secondaire à TTL 30 s) | Vérification oui ; **configuration par le propriétaire** | Registre ANRT, fournisseur DNS secondaire |
| 3 | Authentification complète (Google OAuth, e-mail et mot de passe, TOTP, OTP Infobip puis SMS FISCA) | **Non** sans comptes réels | Application Google OAuth, compte Infobip, expéditeur FISCA enregistré |
| 4 | Certificat qualifié Barid eSign : signature réelle d'une facture de SYNAPTIC SYSTEMS, premier lot Merkle à 23 h 59 | **Non** | Certificat qualifié, accès HSM (CSC v2.0), fournisseur d'horodatage RFC 3161 |
| 5 | Marque blanche fiduciaire : domaine `compta-test.fisca.ma`, TLS en moins de 60 s | Oui, avec Cloudflare for SaaS | Plan Cloudflare for SaaS |
| 6 | Autonomie de la caisse sur tablette réelle (10 tickets signés en mode avion, clôture Z) | **Non** | Tablette réelle (action du propriétaire) |
| 7 | Canary et rollback automatique en moins de 30 s | Oui, sur staging | Workflows P4-C |
| 8 | Répétition générale failover et failback (`readyForDnsCutover === true`) | Oui, sur doubles ; réel : serveur Maroc | Serveur miroir au Maroc |

## 4. Liste de l'expert-comptable (à remettre avant S5)

Tout ce que le code affirme sans recoupement externe. Source : ERRATA section E, section 04 du document d'état, code. Chaque ligne est `NON RECOUPÉ` ou « à confirmer par l'expert-comptable ».

| Domaine | Point à confirmer |
|---|---|
| TVA | Taux 2026 (20, 10, 0 %) et calendrier de convergence (VEC-CGI-05) ; taux bancaire de 10 % sur commissions et intérêts ; TVA récupérable sur immobilisations (34551) contre charges (34552) ; régularisation du prorata |
| Retenues | RAS-TVA art. 117 : 75 % avec attestation de moins de 6 mois, 100 % sinon, seuil de 5 000 MAD TTC, champ d'application (VEC-CGI-03) ; RAS honoraires 5 % et 10 %, loyers 10 % et 15 % dès 120 000 MAD (DRVT) ; auto-entrepreneur : seuil de 80 000 DH par client, retenue de 30 % sur la part au-delà (VEC-CGI-04), taux IR 0,5 % et 1 % sans activité |
| Espèces et timbre | Plafond d'espèces art. 11-II et 106-II, 720 000 c TTC (VEC-CGI-01) ; droit de timbre sur espèces 25 bps et son assiette (`paid_cash_cents`) |
| Délais de paiement | Loi 69-21 : 46 jours, 2 mois entamés, 360 bps, 44 500 c (VEC-CGI-02) ; seuils 60, 120 et 180 jours |
| Débours, retenue de garantie | Débours hors base de TVA et hors HT du tuple PIH ; retenue de garantie BTP (7 % ou 10 %) : article et traitement ; refus sur avoir 381 |
| Plan comptable | Jeu de 61 comptes (source propriétaire, non recoupée) ; 190 sous-comptes sectoriels ; libellés arabes et anglais ; comptes cités sans fiche (4481, 6114, 6193, 6195, 6701, 8600) ; subdivisions analytiques 34558, 44551, 44558 |
| FEC et SAF-T | Les 18 colonnes standard du FEC marocain (ordre confirmé par le propriétaire, non recoupé avec le texte marocain) ; structure SAF-T « CGNC v2.0 » ; descriptif Art. 211 |
| XSD et liasse | XSD SIMPL et `codeEdi` SIMPL-IS : dépôt officiel attendu ; les XSD structurels provisoires ne valent pas conformité |
| Conventions de calcul des outils | Mois entamés, retenue sur la part au-delà du seuil ; seul l'article 117 du CGI est nommé, le reste est « à confirmer » |
| Arrêtés en lettres | 70 vecteurs FR et AR PROVISOIRES : relecture par un arabisant comptable (aussi les 23 vecteurs écrits à la main de l'éditeur de facture) |
| Statuts CDV | 8 statuts reconstitués, 9 transitions par hypothèse ; barème 1 + 8 réessais (Doc_17 écrit « 8 tentatives ») |

## 5. Relecture native des traductions

`ar` et `ary` (Darija) : relecture par des locuteurs natifs ; `zgh-Latn` : repli en français avec avis bilingue ; `zgh-Tfng` : translittération mécanique du latin, à refaire par un locuteur de l'IRCAM ; le Tifinagh s'affiche en LTR. Surfaces : site (183 + 438 pages), interface PME, caisse, arrêtés en lettres.

## 6. Pack de livraison proposé (T-S5-04)

Certificat de l'auditeur (scores R1, R2, R3 et clauses éliminatoires), SBOM, rapport de tir de charge, preuves des 8 points, liste de l'expert-comptable signée par lui, liste des réserves ouvertes acceptées (idempotence, montant attendu de la caisse, `RETURN_REFUND`, profils provisoires DGI/xHub), tag, document d'état clôturé, et la mention explicite que la facturation électronique reste sous **régime provisoire** tant que la DGI et xHub n'ont pas publié leurs spécifications (jamais « conforme DGI »).

## 7. Questions numérotées pour le propriétaire

1. Outil et clé de signature du SBOM.
2. Clé de signature du tag `v1.0.0` ; qui le pose.
3. Contenu des 500 pièces du tir de charge (ou accord pour la proposition).
4. Qui exécute les points Go-Live 3, 4 et 6 (comptes et matériel réels).
5. Remise de la liste de l'expert-comptable, avec le nom de l'expert.
6. Réviseurs natifs (ar, ary, zgh) et leur échéance.
7. Décision `RELEASE S5 : OUI` ou `NON`.
