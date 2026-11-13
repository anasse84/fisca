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

Tout est en TypeScript pur, WebCrypto (`crypto.subtle`) seulement dans `src/` (aucun `node:*`, aucun DOM : compatible Cloudflare Workers). Aucune clé privée dans le paquet, aucun appel réseau direct (le client HTTP du client CSC est injecté).

| Export | Rôle |
|---|---|
| `canonicalizeC14n11(xml)` | Canonical XML 1.1 sans commentaires (`http://www.w3.org/2006/12/xml-c14n11`) ; `canonicalizeExclusive` pour exc-c14n 1.0 |
| `parseXml(xml)` | Analyseur XML strict : refuse DOCTYPE et entités non prédéfinies (anti-XXE), attributs en double, préfixes non liés |
| `signUblXades(xml, options)` | Enveloppe XAdES-Baseline-T (XML-DSig enveloped) dans `UBLExtensions/UBLExtension/ExtensionContent`, avant `cbc:UBLVersionID` |
| `verifyUblXades(xml)` | Recalcule les condensés canonisés, `crypto.subtle.verify`, cohérence du certificat, empreinte du jeton RFC 3161 ; ne lève pas, retourne `{ valid, failure }` |
| `buildTimeStampRequest(imprint)` / `parseTimeStampToken(token)` | TimeStampReq DER (SHA-256, nonce, certReq) ; lecture/contrôle basique du TimeStampToken (empreinte, genTime) |
| `preparePadesSignature` / `finalizePadesSignature` / `signPades` | Incrément PDF (champ `/Sig`, `/ByteRange`, `/Contents` réservé), CMS détaché CAdES-T |
| `DigestSigner`, `TimestampProvider` | Interfaces injectables : le HSM (CSC `signHash`, voir « Barid eSign CSC v2 ») et la TSA |
| `signDigestViaBaridEsignCscV2(config)` | Fabrique d'un `DigestSigner` adossé à l'API CSC v2.0 (voir ci-dessous) |

`DigestSigner.signDigest(digestSha256, algorithm)` reçoit uniquement le condensé SHA-256 de 32 octets (SignedInfo canonisé pour XAdES, attributs signés DER pour PAdES). Retour : RSA PKCS#1 v1.5 = octets bruts ; ECDSA P-256 = `r||s` (IEEE P1363). `TimestampProvider.timestamp(imprint)` retourne un TimeStampToken DER.

### Hypothèses et limites (non vérifiées contre Barid eSign)

- **Algorithmes** : ECDSA P-256 et RSA PKCS#1 v1.5, SHA-256. Doc_17 § 06 cite `signAlgo` `1.2.840.113549.1.1.11` « sha256WithRSAEncryption / ECDSA » sans trancher ; RSA-PSS n'est pas implémenté. Le format de retour du HSM (brut ou DER pour ECDSA) est normalisé par le client CSC (voir « Barid eSign CSC v2 ») ; le format réel de Barid eSign reste à confirmer.
- **SigningCertificate** : par défaut `xades:SigningCertificate` (condensé SHA-256, `ds:X509IssuerSerial`), seule forme acceptée par le XSD OASIS UBL 2.1 vendorisé (`UBL-XAdESv132-2.1.xsd` ne définit pas `SigningCertificateV2`). L'option `signingCertificateElement: 'SigningCertificateV2'` produit la forme EN 319 132-1 (`IssuerSerialV2`), valide en XML-DSig mais refusée par ce XSD. Limite de `xmllint` : un numéro de série de certificat de plus d'environ 20 chiffres décimaux est refusé comme `xs:integer` (libxml2) dans la forme par défaut.
- **Politique de signature** : `signaturePolicy` est facultative et **hypothèse** (aucune politique marocaine publiée) ; absente par défaut.
- **Jeton RFC 3161** : **contrôle RFC 3161 partiel : signature TSA, chaîne et révocation non évaluées.** Le contrôle porte sur la structure, l'empreinte, le nonce et genTime ; l'OID de politique n'est pas évalué non plus (`trust: 'NOT_EVALUATED'`). Ce n'est pas un contrôle d'horodatage qualifié et aucun horodatage n'est présenté comme tel. Le profil de timestamp (politique, algorithmes de la TSA Barid eSign) est à confirmer.
- **PDF** : xref classique seulement (échec fermé sur flux xref/flux d'objets pour le catalogue ou la première page, `/AcroForm` préexistant, `/Annots` indirect). Un PDF/A-3b Factur-X à flux xref n'est pas pris en charge ici.
- **Fins de ligne** : `signUblXades` normalise CRLF/CR en LF (XML 1.0 § 2.11) ; sans effet sur la canonisation.
- Contrôle d'OID 2.5.4.97 / 2.5.4.5 du certificat et appel CSC/mTLS : voir « Barid eSign CSC v2 » (P2A-05).
- Les limites ci-dessus (SigningCertificateV2, numéro de série de plus de 24 chiffres, xref classique, contrôle RFC 3161 partiel) sont aussi listées dans la constante exportée `KNOWN_PROFILE_LIMITATIONS` (`src/known-phive-deviations.ts`) ; aucune n'est un écart PHIVE.
- **Numéro de série de certificat** : `signUblXades` refuse (échec fermé `UBL_SIGNATURE_SERIAL_UNSUPPORTED`) un numéro de plus de `XMLLINT_MAX_SERIAL_DIGITS` = 24 chiffres décimaux dans `xades:SigningCertificate`, car xmllint (libxml2 2.10.x, mesuré : 24 chiffres acceptés, 25 refusés) refuse alors `ds:X509SerialNumber` (`xs:integer`, non borné dans le schéma). Un serial de 20 octets (jusqu'à 48 chiffres) est pourtant valide en RFC 5280 : l'option explicite `allowLongSerialNumber: true` émet le XML malgré tout (vérifié par `verifyUblXades`, mais refusé par xmllint). Aucune alternative qui fasse passer le XSD : `X509SerialNumber` est obligatoire et `xs:integer` ; `SigningCertificateV2` n'existe pas dans le XSD OASIS vendorisé. Comportement exact testé dans `tests/serial-number.test.ts`.

## Barid eSign CSC v2

`signDigestViaBaridEsignCscV2(config): DigestSigner` (`src/signature/csc-client.ts`) signe à distance le condensé SHA-256 de 32 octets sur le HSM Barid eSign par l'API **CSC v2.0** (Cloud Signature Consortium), sur liaison mTLS. **Signature de TEST dans les tests, jamais qualifiée sans HSM Barid eSign réel** : rien n'est vérifié contre un serveur Barid eSign, et ce module n'affirme aucune conformité, homologation ni certification.

> Emplacement : CTR-COD-15 prévoit `packages/external-integrations/src/providers.ts` (session P3-C) ; le contrat est livré ici sous le nom exact `signDigestViaBaridEsignCscV2` et pourra y être réexporté. La signature diffère de l'exemple de Doc_17 § 11 (fabrique d'un `DigestSigner` au lieu d'une fonction à un appel).

**mTLS par binding.** En Cloudflare Workers, le certificat client est un *binding* de certificat mTLS : l'appelant injecte `config.http` (`CscHttpClient`, `{ fetch(url, init) }`), en production le `fetch` du binding. Le paquet ne contient aucune clé privée, aucun certificat client et aucun secret. Le secret `BARID_ESIGN_CSC_SECRET` arrive par `config.auth.clientSecret` ; il n'est ni journalisé ni copié dans une erreur (messages constants, pas de `cause`).

**Enchaînement (une signature = un cycle complet).** `auth/login` → `credentials/info` → **contrôle bloquant** → `credentials/authorize` → `signatures/signHash`.

| Appel | Point d'accès | Paramètres envoyés | Réponse lue |
|---|---|---|---|
| Authentification | `POST /csc/v2/auth/login` | en-tête `Authorization: Basic …` ; corps `{ rememberMe: false }` | `access_token` |
| Certificat | `POST /csc/v2/credentials/info` | `credentialID`, `certificates: "single"`, `certInfo: false`, `authInfo: false` | `key.status`, `key.algo[]`, `cert.status`, `cert.certificates[0]` (base64 DER) |
| Autorisation | `POST /csc/v2/credentials/authorize` | `credentialID`, `numSignatures: 1`, `hashes[]` (base64), `hashAlgorithmOID` (SHA-256), `authData[]` (`{ id, value }`) | `SAD` ; HTTP 202 (hors bande) refusé |
| Signature | `POST /csc/v2/signatures/signHash` | `credentialID`, `SAD`, `hashes[]` (un seul condensé, base64), `hashAlgorithmOID`, `signAlgo` | `signatures[]` (un élément, base64) |

Source : spécification CSC *Architectures and protocols for remote signature applications* v2.0.0.2 (20 avril 2023, Cloud Signature Consortium), § 11.2, 11.5, 11.6 et 11.10. Les noms de paramètres sont ceux de la spécification : **`hashes`** et **`hashAlgorithmOID`** (et non `hash`/`hashAlgo`, qu'emploient certaines implémentations). `clientData` n'est jamais envoyé (il peut exposer des données au service). `signAlgo` : `1.2.840.10045.4.3.2` (ECDSA SHA-256) ou `1.2.840.113549.1.1.11` (RSA PKCS#1 v1.5 SHA-256), ou `1.2.840.113549.1.1.1` si le credential n'annonce que celui-là dans `key.algo` ; aucun OID annoncé compatible → échec fermé avant `signHash`.

**Contrôle bloquant avant toute signature.** Le Subject DN du certificat rendu par `credentials/info` est extrait du DER X.509 (`subjectDistinguishedNameForEmitterCheck` : attributs 2.5.4.97 `organizationIdentifier` et 2.5.4.5 `serialNumber`, valeurs échappées pour qu'une valeur ne fabrique jamais un second attribut) puis confronté par `assertCertificateMatchesEmitter(subjectDn, emitterIce, emitterIf)` de `@fisca/shared-types` (préfixes `NTRMA-`/`ICEMA-` pour l'ICE, `VATMA-`/`IFMA-` pour l'IF ; le CN n'est jamais lu). Échec : `AdrInvariantError` `ADR_06_LOI4320_CERT_MISMATCH`, levée **avant** `credentials/authorize` et `signHash` (le PIN n'est même pas demandé). `fetchBaridEsignCscV2Certificate(config)` rend le certificat après le même contrôle, pour `signUblXades` ; `expectedCertificateDer` fait échouer fermé (`CSC_CERTIFICATE_CHANGED`) un certificat qui changerait entre-temps.

**Conversion de format (décision du pilote).** `normalizeCscSignature` rend, sans jamais deviner : ECDSA → `r‖s` de 64 octets (DER `SEQUENCE { r, s }` strict converti, entiers complétés ou rognés ; 64 octets déjà bruts conservés) ; RSA → octets bruts d'exactement la longueur du module du certificat. Longueur inattendue, DER invalide (négatif, zéro de tête superflu, octets en trop, entier trop long, nul), enveloppe DER autour d'un RSA ou algorithme non supporté : échec fermé `CSC_SIGNATURE_FORMAT_UNSUPPORTED` / `CSC_ALGORITHM_UNSUPPORTED`.

**Erreurs (`CscSignerError`, code + phase, message constant).** `CSC_AUTH_FAILED`, `CSC_AUTHORIZATION_REFUSED`, `CSC_SAD_EXPIRED`, `CSC_CREDENTIAL_UNAVAILABLE`, `CSC_REQUEST_REJECTED` (4xx), `CSC_SERVER_ERROR` (5xx), `CSC_TIMEOUT`, `CSC_NETWORK_ERROR`, `CSC_RESPONSE_INVALID`, etc. Le message ne contient ni DN, ni ICE, ni identifiant de credential, ni jeton, ni SAD, ni PIN, ni secret, ni description d'erreur du serveur (seul un code CSC court normalisé est conservé). Délai par appel : 8 s par défaut (`timeoutMs`, Doc_17 § 06). **Aucun retry silencieux sur `signHash`** (idempotence) : après `CSC_TIMEOUT` ou `CSC_NETWORK_ERROR` sur `signHash`, l'issue est inconnue et l'appelant décide. Seul `auth/login` peut être rejoué, explicitement (`loginRetries`, 0 par défaut, 2 au plus ; erreurs réseau, délai et 5xx seulement, jamais un refus 400/401).

**Hypothèses (non vérifiées contre Barid eSign).**
- Service authorization par `auth/login` en HTTP Basic (identifiant client + secret) : Doc_17 § 11 parle d'un `oauthAccessToken` sans préciser le mécanisme.
- Mode d'autorisation explicite (`credentials/authorize` avec PIN/OTP fournis par `config.authorizationData`) et SAD lié au condensé (SCAL 2) ; l'autorisation OAuth 2.0 (`oauth2code`) et la réponse différée (HTTP 202, `authorizeCheck`) ne sont pas gérées.
- Format réel de la signature rendue par le HSM (brut ou DER), `signAlgo` et présence de `hashAlgorithmOID` avec `1.2.840.113549.1.1.11` (la spécification dit « omis ou ignoré » si le hachage est implicite).
- Un cycle `login`/`info`/`authorize` par signature : la durée de vie du jeton et du SAD, les quotas et le mode multi-signature ne sont pas exploités.
- Aucun OID de politique de signature ni jeton TSA Barid eSign : le client d'horodatage RFC 3161 n'est pas dans ce paquet.

### Tests de signature

Le client CSC est testé contre un faux serveur CSC local (`tests/support/fake-csc-server.ts`, aucun réseau) qui signe avec une clé éphémère de test ; `tests/csc-e2e.test.ts` enchaîne `signUblXades` + ce signataire (XSD, vérification WebCrypto, JDK). Les tests utilisent des clés éphémères générées par WebCrypto, un certificat auto-signé fabriqué dans le test et une « TSA de test, non qualifiée » (`tests/support/test-pki.ts`, jamais exportée depuis `src/`). Vérifications indépendantes : canonisation comparée octet pour octet au JDK (`tests/java-verifier/C14nReference.java`), signature XML-DSig validée par `javax.xml.crypto.dsig` (`XmlDsigVerifier.java`), CMS PAdES et jeton RFC 3161 vérifiés par BouncyCastle (`PadesVerifier.java`, dépendance résolue par `tests/java-verifier/pom.xml` sur Maven Central), `openssl cms -verify -noverify`, `openssl ts -query/-reply`, `pdfsig`. La convention `FISCA_REQUIRE_PHIVE=1` (ou `CI`) s'applique : JDK 21, Maven ou OpenSSL manquants font échouer la suite au lieu de la sauter ; hors CI, l'absence est journalisée sur stderr.

## Empreinte PIH et base de données

`buildPihFieldsFromInvoiceRow(row, parties)` construit les champs du tuple depuis une ligne `invoices` (colonnes `total_ht_cents` hors débours, `total_vat_cents`, `stamp_duty_cents`, `total_ttc_cents`, `previous_pi_hash`, `icv_counter`, `sequential_number`, `ubl_type_code`, `issue_date`, `currency_code`) ; `pihFieldsOfInvoice(input)` donne les mêmes valeurs depuis le modèle UBL. L'ICE de l'émetteur et l'identifiant de l'acheteur sont fournis par l'appelant (ils ne sont pas en clair dans `invoices`).
