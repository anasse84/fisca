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

## Hors de ce profil à ce stade

PIH et ICV, WithholdingTaxTotal (retenue de garantie BTP, RAS-TVA), droit de timbre, enveloppe XAdES : non implémentés par ce ticket.

`profile.json` est la version lisible par machine ; un test vérifie qu'il reste identique aux constantes de `src/profile.ts`.
