# Profil cius-ma-provisional

**PROVISOIRE — règles marocaines dérivées de Doc_07, non publiées par la DGI, conformité officielle non vérifiée**

Au 2026-11-13, ni la DGI ni xHub n'ont publié de spécification technique de la facturation électronique (ERRATA B-13). Ce profil est le point de remplacement unique des règles marocaines du générateur ; il se supprime ou se remplace à la parution des textes. Le schéma XSD utilisé est le schéma officiel OASIS UBL 2.1 (`../../xsd/`, résolu par `resolveSchema`), pas un schéma marocain.

## Mapping (source : `docs/specs/07-api-edi-contracts.md`, « Section 07 »)

| Donnée | Emplacement UBL | Remarque |
|---|---|---|
| ICE (15 chiffres) | `cac:PartyLegalEntity/cbc:CompanyID schemeID="MA:ICE"` | contrôle de cohérence modulo 97 (`Ice15Schema`), pas une preuve d'existence |
| Identifiant Fiscal | `cac:PartyTaxScheme/cbc:CompanyID schemeID="MA:IF"` | `cac:TaxScheme/cbc:ID` = `VAT` |
| Forme juridique, capital social | `cac:PartyLegalEntity/cbc:CompanyLegalForm` | ex. « SARL AU, capital 100000.00 MAD » |
| RC, Taxe Professionnelle, CNSS | `cac:PartyIdentification/cbc:ID schemeID="MA:RC"`, `"MA:TP"`, `"MA:CNSS"` | « AdditionalPartyIdentification » (Doc_07) n'existe pas dans OASIS UBL 2.1 ; schemeID RC/TP/CNSS = hypothèses de nommage |
| Version UBL | `cbc:UBLVersionID` = `2.1` | |
| Personnalisation, profil | `cbc:CustomizationID` et `cbc:ProfileID` = `ma:cius-ma-provisional:1.0` | **hypothèse** : aucun identifiant publié, aucun identifiant xHub inventé |

Types : 380 `Invoice`, 381 `CreditNote` (BillingReference vers l'UUID xHub initial obligatoire), 383 `DebitNote`, 386 et 389 `Invoice`. Numéro : `{FAC|AVO|NDB|ACO|AUT}-{AAAA}-{SEQ6}`. Taux de TVA : 2000, 1000 ou 0 points de base (ERRATA D-04).

## Cas métiers (T-P2A-03, tous PROVISOIRES)

| Donnée | Emplacement UBL | Remarque |
|---|---|---|
| Débours | ligne en catégorie TVA `O`, sans `cbc:Percent` | hors base de TVA, compté dans le TTC et `PayableAmount` ; mélange avec lignes taxées : BR-O-11/BR-O-12 d'EN 16931 (contrôle PHIVE, non contourné) |
| Retenue de garantie BTP | `cac:WithholdingTaxTotal` (racine `Invoice` seulement) | absent de `CreditNote` et `DebitNote` dans OASIS UBL 2.1 : refus explicite ; `TaxScheme/ID` `RETENUE_GARANTIE` = hypothèse ; réduit `PayableAmount` (BR-CO-16 d'EN 16931 violée, consigné) |
| Droit de timbre sur espèces | `cac:AllowanceCharge`, `ChargeIndicator` true, raison « Droit de timbre », catégorie `O` | taux (bps) fourni par l'appelant |
| PIH | `cac:AdditionalDocumentReference` ID `PIH`, `EmbeddedDocumentBinaryObject` (Base64 du texte de l'empreinte précédente, `text/plain`) | `text/plain` hors liste MIME d'EN 16931 (BR-CL-24, consigné) |
| ICV | `cac:AdditionalDocumentReference` ID `ICV`, `cbc:UUID` = compteur | hypothèse de nommage |

Taux de retenue et de timbre : paramètres d'entrée (règle datée résolue par l'appelant via fiscal-ast), validés contre un ensemble fourni par l'appelant ; aucune constante dans le paquet. Vecteurs : `tests/golden/*.vectors.json`.

## Hors de ce profil à ce stade

RAS-TVA (WithholdingTaxTotal) et enveloppe XAdES : non implémentés.

`profile.json` est la version lisible par machine ; un test vérifie qu'il reste identique aux constantes de `src/profile.ts`.
