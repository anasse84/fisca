---
name: fisca-morocco-cgi-dynamic-ast
description: Moteur fiscal marocain déclaratif Fisca : règles AST en D1 (dynamic_fiscal_rules), arithmétique BigInt, TVA 2026, vecteurs d'or (espèces Art. 11-II, Loi 69-21, RAS-TVA, auto-entrepreneur, BTP) et emplacement des nouveaux vecteurs. À utiliser pour tout calcul ou règle fiscale.
---

# fisca-morocco-cgi-dynamic-ast

Méthode du moteur fiscal marocain de Fisca. Sources : `docs/specs/05-adr.md` § 05, `06-erd-data-lifecycle.md` § 02, `14-qa-harness.md` § 03 et § 11, `02-state-machines.md` § 10. Session : S1B (`packages/fiscal-ast`) ; barrière G1 ; rubric R1.

## 1. Zéro règle codée en dur

Taux, seuils, plafonds, modèles d'écritures et cellules SIMPL vivent dans `CONTROL_PLANE_DB` : table `dynamic_fiscal_rules` (`rule_ast_json` validé par Zod, `effective_from`, `effective_to`, statut) et `simpl_is_cell_rules`. Il n'existe pas de table `tax_regimes_catalog`. Le code ne contient que l'interpréteur d'arbres AST, déterministe. Les constantes du fichier de référence `fiscal-golden-suite.ts` servent de juge de test, pas de source en production.

Cycle d'une règle : `RAW_PDF_UPLOADED → WIKI_DIFF_EXTRACTED → CANDIDATE_AST_COMPILED → VITEST_SANDBOX_PASSED → SHADOW_OBSERVE_MODE → ACTIVE_RULE_IN_D1 → SUPERSEDED_ARCHIVED`. Toute règle compilée arrive avec 3 tests contradictoires et tourne en observation avant d'être activée par un administrateur. Une règle remplacée reste lisible pour les exercices antérieurs.

## 2. Arithmétique

Centimes entiers, taux en points de base. Toute division par `divRoundHalfUpBigInt(numérateur, dénominateur)` : `(n × 2 + d) / (d × 2)` en `BigInt`. `Math.round((a * b) / c)` est interdit, y compris quand un document le montre.

## 3. TVA 2026

Seuls 2000, 1000 et 0 bps. Une ligne à 0 hors débours exige un motif légal (Art. 91 ou 92). `assertValidVatRateForIssueYear` rejette tout autre taux à partir de 2026 avec `ADR_04_LF2026_VAT_VIOLATION`. Une pièce importée à 7 % ou 14 % est convertie avant enregistrement.

## 4. Vecteurs d'or de référence

| Vecteur | Entrée | Sortie attendue |
|---|---|---|
| VEC-CGI-01, espèces Art. 11-II | 720 000 TTC (600 000 HT, TVA 20 %), plafond de 500 000 par jour | HT déductible 416 667 ; TVA récupérable 83 333 ; HT réintégré 183 333 ; TVA perdue 36 667 |
| VEC-CGI-02, Loi 69-21 | 1 234 500 TTC, 2 mois entamés, 275 + 85 bps | amende de 44 500 (arrondi au dirham supérieur) |
| VEC-CGI-03, RAS-TVA Art. 117 | TTC 1 200 000, TVA 200 000 | attestation de moins de 6 mois : 150 000 (75 %) ; sinon 200 000 (100 %) |
| VEC-CGI-04, auto-entrepreneur | cumul 7 500 000 + 1 200 000, seuil de 8 000 000 par client | surplus 700 000 ; RAS IR 30 % : 210 000 ; net 990 000 |
| VEC-CGI-05 | facture 2026 à 1400 bps | rejet `ADR_04_LF2026_VAT_VIOLATION` |
| VEC-CGI-06, BTP | 10 000 000 HT, 500 000 de débours, retenue de 10 % | débours sans TVA ; TVA de la retenue exigible à la libération |

Règles : plafond d'espèces de 5 000 MAD TTC par jour et 50 000 par mois et par fournisseur ; RAS-TVA à partir de 5 000 MAD TTC, validité de l'attestation appréciée au jour du paiement ; Loi 69-21 calculée depuis `service_delivery_date` (60 jours, 120 par contrat, 180 par décret), taux directeur le premier mois puis 85 bps par mois entamé, zéro si litige documenté ; arrondi : `(montant × bps + 999 999) / 1 000 000` dirhams entiers.

## 5. Autres cas à couvrir

Régularisation du prorata de TVA par cinquième si variation de plus de 5 points (Art. 104) ; forclusion de la déduction 12 mois après le paiement, alerte à 10 mois (Art. 204 bis) ; plafond d'amortissement de 400 000 MAD TTC des véhicules de tourisme ; prestations étrangères : autoliquidation de la TVA et RAS IS de 10 % (Art. 15 et 115) ; cotisation minimale hors comptes 713, 714 et 719 (Art. 144) ; débours hors TVA en 3488 et 4488 ; timbre de 25 bps sur les règlements en espèces ; paiement partiel multi-taux ventilé au prorata de chaque base, le centime résiduel allant sur la ligne majeure.

## 6. Où écrire les vecteurs

Chaque règle livrée ajoute ses vecteurs dans `packages/fiscal-ast/tests/golden/*.vectors.json` : article de loi, entrées, sorties en centimes, calcul détaillé. L'auditeur les recalcule à la barrière. `packages/qa-harness/src/fiscal-golden-suite.ts` est protégé : n'y touche pas.



## Mise à jour du 2026-11-15 : état des vecteurs et arbitrages (prime sur ce qui précède)

- **Aucune valeur fiscale en dur** : taux, plafonds et seuils viennent des règles datées de l'AST (`packages/fiscal-ast`, `FISCAL_RULE_CODES`) ; les vecteurs d'or portent l'article, la date et l'état `RECOUPÉ`, `NON RECOUPÉ` ou `PROVISOIRE`. Les vecteurs de la TVA 2026, de la RAS-TVA (art. 117), de l'auto-entrepreneur (80 000 DH par client, retenue de 30 %) et du BTP sont `NON RECOUPÉ` : ils alimentent la liste de l'expert-comptable (T-S5-03).
- **Arrondi au dirham supérieur (Loi 69-21)** : `Math.ceil` sur un montant en dirhams est une arithmétique décimale interdite par la loi 1 ; utiliser la division entière de centimes arrondie par excès (BigInt) avec les cas limites en test.
- **Prorata fiduciaire (D-23)** : journalier exact en centimes, plancher d'un jour si activé et désactivé le même jour, sans mois minimum (`computeDailyProrataCents`, `apps/marketing-astro/src/content/billing-policy.ts` pour l'affichage ; le moteur réel `packages/billing-metering` est prévu en P4-B) ; vecteur « 16 novembre » : 7450 centimes (TPE) et 12450 centimes (PME complet).
- **TVA récupérable** : `34551` = sur immobilisations, `34552` = sur charges ; le compte se choisit par rôle de plan (`vat_regime_role`), jamais par numéro.
- **Conventions des outils du site (provisoires)** : mois entamés, retenue sur la part au-delà du seuil, taux IR de 0,5 % et 1 % sans activité ; seul l'article 117 du CGI est nommé, le reste est « à confirmer par l'expert-comptable ».
- **Timbre espèces** : 25 bps sur `paid_cash_cents` (injecté ou AST), jamais codé en dur.
