# @fisca/ubl-xades

Générateur UBL 2.1 (mode de secours TypeScript, ADR-09) du profil provisoire `cius-ma-provisional`, avec chaînage PIH/ICV.

**Régime provisoire (ERRATA B-13).** Au 2026-11-13, ni la DGI ni xHub n'ont publié de spécification technique de la facturation électronique. Profil provisoire, écarts PHIVE connus : BR-CL-10, BR-CL-11, BR-CO-09, BR-CL-24. La liste unique est `src/known-phive-deviations.ts` (`KNOWN_PHIVE_DEVIATIONS`) ; elle se retire à la parution du profil officiel. Détail du profil : `profiles/cius-ma-provisional/README.md`.

## Hypothèses non officielles

- ICV porté par `cbc:UUID` d'une `cac:AdditionalDocumentReference` : hypothèse non officielle (convention reprise de ZATCA).
- PIH joint en `text/plain` (base64 du texte de l'empreinte précédente) : cause de BR-CL-24, écart connu.
- Le type 383 est émis en racine `Invoice` (`InvoiceTypeCode` 383, `UBL-Invoice-2.1.xsd`). La retenue de garantie est refusée sur 381 seulement (échec fermé).

## Commandes

| Commande | Usage |
|---|---|
| `pnpm --filter @fisca/ubl-xades test` | Tests unitaires (vitest) ; le contrôle croisé PHIVE s'exécute si le jar et Java 21 sont présents |
| `pnpm --filter @fisca/ubl-xades test:xsd` ou `pnpm test:xsd` (racine) | Validation XSD (xmllint, schémas OASIS UBL 2.1 vendorisés) de 10 documents générés |
| `pnpm --filter @fisca/ubl-xades typecheck` / `lint` | Typage et lint |

## Contrôle croisé PHIVE et barrière G2

La barrière G2 s'exécute avec `FISCA_REQUIRE_PHIVE=1` : le contrôle croisé (`tests/phive-crosscheck.test.ts`) échoue avec un message clair, au lieu de se sauter, si le jar ou Java 21 sont indisponibles. La variable d'environnement `CI`, dès qu'elle est posée, a le même effet.

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-amazon-corretto.x86_64
(cd containers/fiscal-java && mvn -q -B package -DskipTests)
FISCA_REQUIRE_PHIVE=1 pnpm --filter @fisca/ubl-xades test
```

`JAVA_HOME=/usr/lib/jvm/java-21-amazon-corretto.x86_64` est requis pour `mvn` dans le bac à sable : Maven démarre sinon sous Java 17.

Le test affirme EXACTEMENT la liste `KNOWN_PHIVE_DEVIATIONS` sur la facture standard : une règle PHIVE supplémentaire fait échouer le test, et une règle de la liste qui ne se produit plus aussi. Les avertissements `UBL-CR-*` sont tolérés mais listés dans le test. Les comportements du mélange débours/timbre/retenue (BR-O-02, BR-O-04, BR-O-11, BR-O-12, BR-CO-16) sont testés à part.

## Empreinte PIH et base de données

`buildPihFieldsFromInvoiceRow(row, parties)` construit les champs du tuple depuis une ligne `invoices` (colonnes `total_ht_cents` hors débours, `total_vat_cents`, `stamp_duty_cents`, `total_ttc_cents`, `previous_pi_hash`, `icv_counter`, `sequential_number`, `ubl_type_code`, `issue_date`, `currency_code`) ; `pihFieldsOfInvoice(input)` donne les mêmes valeurs depuis le modèle UBL. L'ICE de l'émetteur et l'identifiant de l'acheteur sont fournis par l'appelant (ils ne sont pas en clair dans `invoices`).
