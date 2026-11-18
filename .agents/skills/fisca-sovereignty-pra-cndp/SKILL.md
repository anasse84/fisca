---
name: fisca-sovereignty-pra-cndp
description: Conformité et continuité Fisca : Loi 09-08 CNDP (résidence UE, DSAR vs Art. 211 CGI), Loi 05-20 DGSSI zéro-egress, miroir Maroc, bascule Multi-DNS, failback, réversibilité ISO 14641, avoirs SLA, CI/CD. À utiliser pour résidence des données, PRA, export décennal, workflows.
---

# fisca-sovereignty-pra-cndp — souveraineté, continuité et réversibilité

Sources : `11-cndp-sovereignty.md`, `12-sla-dpa-pra-reversibility.md`, `16-cloud-deploy.md`, `04-tdd-architecture.md` § 10. Sessions : S1A (`packages/compliance-cndp`), P4-B (`packages/pra-reversibility`), P4-C (`apps/standby-vps`, `ops`, CI/CD), G4 et S5.

## 1. Résidence et sorties réseau

- Stockage standard : D1 en `--location=weur`, R2 en `jurisdiction = "eu"`, SES en `eu-west-3`. Un bucket R2 de production sans `jurisdiction = "eu"` est une clause éliminatoire de R2.
- Tout appel sortant passe par `assertSovereignEgressAllowed(policy, target)` avant le `fetch`. Aucune route métier n'appelle `fetch` directement : les connecteurs vivent dans `packages/external-integrations`.
- Politique `STANDARD_CNDP_EU_ADEQUACY` : une donnée personnelle ou fiscale ne sort que vers le Maroc, un pays adéquat (liste de la délibération CNDP 236-2015) ou une cible couverte par l'autorisation F118 ; sinon `CNDP_ART_43_44_TRANSFER_BLOCKED`.
- Politique `STRICT_DGSSI_LAW_05_20_MOROCCO` (offre souveraine) : toute destination autre que `MA` lève `DGSSI_LAW_05_20_EGRESS_BLOCKED`. Aucun appel à Workers AI ; inférence locale ; Google OAuth, Teams et SES remplacés par des équivalents nationaux.
- Aucun traceur tiers ni police distante sur `fisca.ma` et `app.fisca.ma`. Mentions Loi 09-08 et `dpo@fisca.ma` présentes et non vides dans toutes les langues de chaque surface.

## 2. Droit à l'effacement contre conservation de 10 ans

`evaluateCndpErasureAgainstCgiArt211` : préférences, marketing et brouillons non numérotés sont supprimés tout de suite ; écritures `POSTED`, factures, État 9421 et DRVT sont restreints et scellés (`pii_restricted_flag`) jusqu'à la clôture de l'exercice + 10 ans + 1 jour, puis détruits par effacement de la clé. La rectification vaut pour l'avenir : une pièce `POSTED` ne se réécrit pas.

## 3. Coffre et continuité légale

- Rétention WORM : Object Lock en mode Compliance, 3 653 jours, sur R2 (UE) et sur MinIO (Maroc). Trigger SQLite refusant la suppression d'un `archival_packages` avant `retention_until`.
- `GET /api/v1/reversibility/export-10y` et la réception xHub restent ouverts en `RESTRICTED_READ_ONLY` (impayé à J+15) : `assertFeatureAuthorized` laisse toujours passer `READ_OR_LEGAL_EXPORT`.
- Aucune migration marquée `[BREAKING_MIGRATION]` du 15 au 21 de chaque mois ni du 15 février au 31 mars. Avant la v1.0.0, aucune migration ne porte ce marqueur.

## 4. Miroir Maroc, bascule et retour

- Tout le code métier passe par `FiscaInfrastructureAdapter` (`CLOUDFLARE_EDGE` ou `SOVEREIGN_MOROCCO_VPS` : PostgreSQL 16, MinIO, BullMQ). Aucune extension SQL non portable.
- Réplication : `SignedReplicationDelta` chiffré, signé HMAC, numéroté, sur la file `fisca-sovereign-mirror`.
- Bascule : 3 sondes (Casablanca, Paris, Francfort) toutes les 15 s sur `/api/v1/health/deep` ; 2 sondes sur 3 avec 3 échecs de suite (45 s) ; DNS à TTL de 30 s.
- Retour : observation de 10 minutes, rattrapage des deltas, gel en lecture seule de 5 s au plus, puis `verifyFailbackCryptographicParity` : égalité des 6 `last_entry_hash` (AN, ACH, VTE, BNQ, CAI, OD), du compteur ICV et du nombre d'archives, aucun delta en attente. Un seul écart (`JOURNAL_HASH_DRIFT_<journal>`) annule le retour.
- Critère de parité : le même jeu de 50 écritures et de scellements produit les mêmes empreintes SHA-256 sur les deux pilotes.

## 5. Réversibilité (ISO 14641)

Archive ZIP : `/01_DATABASE/`, `/02_FEC_AND_SAFT/`, `/03_INVOICES_XHUB/`, `/04_EDI_SIMPL_POS/`, `/05_CRYPTO_PROOFS/` (manifeste, jetons, `verify-archive-offline.mjs`). Le vérificateur n'utilise que `node:crypto`, sans paquet npm, et doit rendre 0 dans un répertoire sans réseau. Manifeste : ligne `${relativePath}|${sizeBytes}|${sha256Hex}`, en-tête `${companyIce}|${companyIf}|${exportedAtIso}`.

## 6. Avoirs SLA

Cibles : 9 990 bps (PME, fiduciaire) ou 9 995 bps (Corporate, Souverain). Avoir : 1 000 bps jusqu'à 9 950, 2 500 bps de 9 900 à 9 949, 5 000 bps en dessous. Calcul en `divRoundHalfUpBigInt`. Vecteur : 1 013 000 centimes, 260 minutes d'arrêt sur 43 200 → 9 939 bps → avoir de 253 250 centimes.

## 7. CI/CD (P4-C)

Quatre workflows : `ci-pr-gate.yml`, `cd-staging.yml`, `cd-production.yml` (garde du calendrier fiscal, SBOM CycloneDX, canari 10 % puis 100 %, retour arrière automatique sur échec de `/api/v1/health/deep`), `cron-dr-drill.yml`. Pousser sous `.github/workflows/` exige la permission Workflows sur le jeton GitHub : sans elle, ticket `BLOCKED`, classe `MISSING_INPUT`. Aucun secret dans le dépôt ni dans `wrangler.toml`. Le registre d'images est un paramètre (`FISCA_IMAGE_REGISTRY`). Dans le bac à sable, pas de Docker : PostgreSQL 16 et Redis natifs, MinIO non simulé (skill `fisca-sandbox-toolchain`).



## Mise à jour du 2026-11-15 : arbitrages D-22 et D-23 (prime sur ce qui précède)

- **CNDP (propriétaire, D-23)** : références de récépissé F115, F211, F112, F118 à `null` (jamais inventées), avec la mention « Dossiers F115, F211, F112 et F118 en cours d'enregistrement auprès de la CNDP par SYNAPTIC SYSTEMS SARL AU (dpo@fisca.ma) ». Durées : T-01 (comptes, OAuth, 2FA, journaux) = contrat actif + 12 mois, logs de sécurité 12 mois glissants, défis OTP/MFA 10 minutes ; T-02 (KYB dirigeants, CNIE, Loi 43-20) = contrat + 10 ans après clôture du dernier exercice (Art. 211 CGI, Loi 9-88) ; T-03 (facturation SaaS et paiement) = factures 10 ans après clôture, jeton Payzone purgé dès résiliation soldée ; T-04 (scoring IA KYB) = cache 30 jours + archive restreinte d'audit et de contestation 12 mois.
- **Droits Loi 09-08 contre Art. 211 CGI** : `pii_restricted_flag` ne monte que de 0 à 1, y compris sur une pièce `POSTED` d'un exercice `CLOSED` ; l'opposition n'altère ni les montants ni `entry_hash` (l'empreinte exclut les colonnes `_enc`).
- **Liste des États adéquats** (UE/EEE + Maroc, Délibération 236-2015) : NON RECOUPÉE avec le texte, à valider.
- **Coffre et continuité** : réalisé (P2-A) : coffre OAIS, racine de Merkle quotidienne globale (pas de colonne société, preuve d'inclusion par pièce), ancrage RFC 3161, un seul appel TSA pour 500 archives ; non testé contre des ressources réelles (R2, Object Lock, Workflows). Prévu en vague 4 (P4-B, P4-C) : PRA, failover multi-DNS, failback à perte nulle, export décennal ISO 14641, avoirs SLA, nœud souverain.
- **Site** : télémétrie agrégée sans cookie ni pixel tiers, CSP stricte sans hôte tiers ; durées et références ci-dessus affichées « à renseigner » tant qu'elles ne sont pas fournies.
