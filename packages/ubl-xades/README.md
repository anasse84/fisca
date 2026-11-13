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
| `pnpm --filter @fisca/ubl-xades test:xsd` ou `pnpm test:xsd` (racine) | Validation XSD (xmllint, schémas OASIS UBL 2.1 vendorisés) de 10 documents générés et de 10 documents signés (clés de test) |
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

## Signature Loi 43-20 (XAdES-Baseline-T / PAdES-Baseline-T)

**Profil provisoire ; signature de TEST dans les tests ; jamais « qualifiée » sans HSM Barid eSign réel.** Aucune spécification officielle (DGI, xHub, DGSSI) n'est vérifiée ici (ERRATA B-13) : le module n'affirme aucune conformité ni homologation.

Tout est en TypeScript pur, WebCrypto (`crypto.subtle`) seulement dans `src/` (aucun `node:*`, aucun DOM : compatible Cloudflare Workers). Aucune clé privée dans le paquet, aucun appel réseau, pas de client CSC (ticket P2A-05).

| Export | Rôle |
|---|---|
| `canonicalizeC14n11(xml)` | Canonical XML 1.1 sans commentaires (`http://www.w3.org/2006/12/xml-c14n11`) ; `canonicalizeExclusive` pour exc-c14n 1.0 |
| `parseXml(xml)` | Analyseur XML strict : refuse DOCTYPE et entités non prédéfinies (anti-XXE), attributs en double, préfixes non liés |
| `signUblXades(xml, options)` | Enveloppe XAdES-Baseline-T (XML-DSig enveloped) dans `UBLExtensions/UBLExtension/ExtensionContent`, avant `cbc:UBLVersionID` |
| `verifyUblXades(xml)` | Recalcule les condensés canonisés, `crypto.subtle.verify`, cohérence du certificat, empreinte du jeton RFC 3161 ; ne lève pas, retourne `{ valid, failure }` |
| `buildTimeStampRequest(imprint)` / `parseTimeStampToken(token)` | TimeStampReq DER (SHA-256, nonce, certReq) ; lecture/contrôle basique du TimeStampToken (empreinte, genTime) |
| `preparePadesSignature` / `finalizePadesSignature` / `signPades` | Incrément PDF (champ `/Sig`, `/ByteRange`, `/Contents` réservé), CMS détaché CAdES-T |
| `DigestSigner`, `TimestampProvider` | Interfaces injectables : le HSM (CSC `signHash`) et la TSA arrivent avec P2A-05 |

`DigestSigner.signDigest(digestSha256, algorithm)` reçoit uniquement le condensé SHA-256 de 32 octets (SignedInfo canonisé pour XAdES, attributs signés DER pour PAdES). Retour : RSA PKCS#1 v1.5 = octets bruts ; ECDSA P-256 = `r||s` (IEEE P1363). `TimestampProvider.timestamp(imprint)` retourne un TimeStampToken DER.

### Hypothèses et limites (non vérifiées contre Barid eSign)

- **Algorithmes** : ECDSA P-256 et RSA PKCS#1 v1.5, SHA-256. Doc_17 § 06 cite `signAlgo` `1.2.840.113549.1.1.11` « sha256WithRSAEncryption / ECDSA » sans trancher ; RSA-PSS n'est pas implémenté. Format de retour du HSM (brut ou DER pour ECDSA) à confirmer en P2A-05.
- **SigningCertificate** : par défaut `xades:SigningCertificate` (condensé SHA-256, `ds:X509IssuerSerial`), seule forme acceptée par le XSD OASIS UBL 2.1 vendorisé (`UBL-XAdESv132-2.1.xsd` ne définit pas `SigningCertificateV2`). L'option `signingCertificateElement: 'SigningCertificateV2'` produit la forme EN 319 132-1 (`IssuerSerialV2`), valide en XML-DSig mais refusée par ce XSD. Limite de `xmllint` : un numéro de série de certificat de plus d'environ 20 chiffres décimaux est refusé comme `xs:integer` (libxml2) dans la forme par défaut.
- **Politique de signature** : `signaturePolicy` est facultative et **hypothèse** (aucune politique marocaine publiée) ; absente par défaut.
- **Jeton RFC 3161** : le contrôle est basique (structure, empreinte, genTime). La signature CMS de la TSA, la chaîne de certification, la révocation et l'OID de politique ne sont pas évalués (`trust: 'NOT_EVALUATED'`). Le profil de timestamp (politique, algorithmes de la TSA Barid eSign) est à confirmer.
- **PDF** : xref classique seulement (échec fermé sur flux xref/flux d'objets pour le catalogue ou la première page, `/AcroForm` préexistant, `/Annots` indirect). Un PDF/A-3b Factur-X à flux xref n'est pas pris en charge ici.
- **Fins de ligne** : `signUblXades` normalise CRLF/CR en LF (XML 1.0 § 2.11) ; sans effet sur la canonisation.
- Contrôle d'OID 2.5.4.97 / 2.5.4.5 du certificat et appel CSC/mTLS : ticket P2A-05 (non fait ici).

### Tests de signature

Les tests utilisent des clés éphémères générées par WebCrypto, un certificat auto-signé fabriqué dans le test et une « TSA de test, non qualifiée » (`tests/support/test-pki.ts`, jamais exportée depuis `src/`). Vérifications indépendantes : canonisation comparée octet pour octet au JDK (`tests/java-verifier/C14nReference.java`), signature XML-DSig validée par `javax.xml.crypto.dsig` (`XmlDsigVerifier.java`), CMS PAdES et jeton RFC 3161 vérifiés par BouncyCastle (`PadesVerifier.java`, dépendance résolue par `tests/java-verifier/pom.xml` sur Maven Central), `openssl cms -verify -noverify`, `openssl ts -query/-reply`, `pdfsig`. La convention `FISCA_REQUIRE_PHIVE=1` (ou `CI`) s'applique : JDK 21, Maven ou OpenSSL manquants font échouer la suite au lieu de la sauter ; hors CI, l'absence est journalisée sur stderr.

## Empreinte PIH et base de données

`buildPihFieldsFromInvoiceRow(row, parties)` construit les champs du tuple depuis une ligne `invoices` (colonnes `total_ht_cents` hors débours, `total_vat_cents`, `stamp_duty_cents`, `total_ttc_cents`, `previous_pi_hash`, `icv_counter`, `sequential_number`, `ubl_type_code`, `issue_date`, `currency_code`) ; `pihFieldsOfInvoice(input)` donne les mêmes valeurs depuis le modèle UBL. L'ICE de l'émetteur et l'identifiant de l'acheteur sont fournis par l'appelant (ils ne sont pas en clair dans `invoices`).
