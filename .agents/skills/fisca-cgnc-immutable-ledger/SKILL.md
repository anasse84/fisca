---
name: fisca-cgnc-immutable-ledger
description: Construction du Grand Livre électronique Fisca en partie double conforme au CGNC marocain et aux art. 145-I et 211 du CGI. À utiliser pour schéma comptable, écritures, triggers d'inaltérabilité, chaînage SHA-256, TVA sur encaissement, visa de cycle, contre-passation.
---

# fisca-cgnc-immutable-ledger

Méthode de construction du Grand Livre électronique en partie double de Fisca. Les trois règles ci-dessous s'appliquent à tout schéma comptable et à toute écriture.

## 1. Inaltérabilité SQL

Crée systématiquement les triggers SQLite `prevent_posted_entry_update` et `prevent_posted_entry_delete` levant `VIOLATION_PAF_CGI_ART_145` sur toute pièce `POSTED`. Toute correction exige une écriture de contre-passation (`reversal_of_entry_id`).

## 2. Chaînage et Équilibre

Garantir `total_debit_cents == total_credit_cents` par contrainte SQL CHECK et chaîner chaque écriture par journal avec SHA-256 depuis `GENESIS_HASH`.

## 3. TVA sur encaissement et Contrôles

- Loger la TVA non encaissée en 44558 / 34558 et ne virer vers 44551 / 34551 / 34552 qu'au lettrage bancaire effectif (`VAT_CLEARING`).
- Bloquer toute saisie rendant la caisse 5161 créditrice.
- Alerter sur tout compte courant d'associé 3463 débiteur.
- Utiliser les comptes à terminaison 9 (7119/6119) sur avoirs et 6386/7386 sur escomptes.
- Imposer des attributs SQL certifiés (style Auto-Ontology) pour le Cadrage de TVA.



## Mise à jour du 2026-11-15 : décisions et réalisations des vagues 1 et 2 (prime sur ce qui précède)

- **Comptes de TVA (propriétaire, 2026-11-14)** : `34551` = TVA récupérable sur **immobilisations** (`VAT_RECOVERABLE_IMMOB`), `34552` = sur **charges** (`VAT_RECOVERABLE_CHARGES`), `34558` = en attente de décaissement, `44558` = facturée en attente d'encaissement, `44551` = facturée exigible. `34558`, `44551`, `44558` sont des subdivisions analytiques Fisca des comptes 3455 et 4455. Le moteur de lettrage choisit le compte par rôle du plan (`vat_regime_role`), jamais par numéro ; l'amorce du plan de production doit poser les rôles (test de non-croisement, PR n° 24). `1181` = « Résultats nets en instance d'affectation », `1161` = « Report à nouveau ».
- **Visa** : `OWNER_GERANT` et `DAF_TRESORIER` détiennent `LEDGER_VISA_CYCLE` (PR n° 22) ; `DRAFT` → `REVISEE_CYCLE` → `POSTED` (le déclencheur v11 n'admet que `REVISEE_CYCLE` → `POSTED`) ; visa implicite du mode direct : scellement depuis `DRAFT` en deux transitions et deux lignes d'audit dans un seul lot atomique, sans mandat cabinet actif ; visa unitaire `POST /api/v1/ledger/entries/:id/visa` réalisé ; visa de lot `POST /api/v1/ledger/cycles/:cycleCode/visa` spécifié en D-23 (409 `CYCLE_ENTRIES_DRIFT`, 409 `NO_ELIGIBLE_DRAFT_IN_CYCLE`, tri, lot atomique avec une ligne d'audit par pièce), non construit.
- **Empreintes** : `entry_hash` = SHA-256 de `JSON.stringify` du tuple `FISCA_GL_ENTRY_V1` (colonnes `_enc` exclues), clôture `FISCA_GL_CLOSE_V1` ; genèse du journal de 45 caractères (`GENESIS_HASH_` + 32 zéros).
- **Autres décisions de G1** : `pii_restricted_flag` monotone 0 → 1 y compris sur un exercice CLOSED ; exercice CLOSED étanche ; caisse 5161 jamais négative ; contre-passation unique par pièce ; extourne partielle B2C vers B2B (`B2C_TO_B2B_REVERSAL`) liée par `invoice_id` ; rejeu d'un lettrage déjà lettré : 409 ; idempotence 72 h (`idempotency_records`).
- **Réserves ouvertes** : réponses d'idempotence en base64 non chiffré (avant G3) ; suppression d'un exercice CLOSED vide acceptée.
