# fiscal-java

Conteneur Java 21 de Fisca (ADR-09), isolé et sans accès réseau à l'exécution. Il valide les factures UBL 2.1 contre les règles EN 16931 (ph-ubl et PHIVE) et assemble un PDF/A-3b bilingue FR/AR portant la facture UBL embarquée (Mustangproject, ticket P2A-06) : « PDF/A-3b avec facture UBL embarquée, profil provisoire », jamais « Factur-X conforme » (voir `FACTURX-NOTES.md`).

## Régime provisoire (ERRATA B-13)

Aucun schéma technique officiel de la facturation électronique marocaine n'est publié. Le jeu de règles appliqué est nommé dans chaque rapport :
`OASIS UBL 2.1 + EN 16931 (PHIVE), profil CIUS-MA : cius-ma-provisional, non publié par la DGI`.
Le profil `cius-ma-provisional` (interface `ValidationProfile`, choisi par `ValidationProfiles.resolveProfile(name)`) est le seul point où vivront les règles marocaines (ticket P2A-02) ; il est remplaçable et n'est jamais mêlé au validateur. La conformité officielle n'est pas vérifiée.

## Interface HTTP interne (port `FISCAL_JAVA_PORT`, 8080 par défaut)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/health` | `{"status":"ok","service":"fiscal-java"}` |
| `POST` | `/validate` | Corps : XML UBL (10 Mio max). Réponse JSON : `valid`, `ruleSet`, `profile`, `profileStatus`, `errorCount`, `warningCount`, `issues[]` (`rule`, `location`, `severity`, `message`). `?profile=<nom>` choisit le profil (400 si inconnu). Un XML mal formé donne un rapport (`XML-NOT-WELL-FORMED`), pas une erreur serveur. |

| `POST` | `/facturx` | Corps JSON (ci-dessous) → `application/pdf` : PDF/A-3b A4 bilingue avec le XML UBL embarqué, QR de vérification provisoire, double arrêté en toutes lettres. |

### `POST /facturx`

Corps JSON strict (clé inconnue refusée ; nombres **entiers** uniquement, une fraction est refusée à la lecture ; erreurs : code et chemin du champ, jamais la valeur). Le schéma Zod miroir est `FacturXRequestSchema` dans `@fisca/ubl-xades`.

```json
{
  "xmlBase64": "<XML UBL 2.1, UTF-8, base64>",
  "attachmentRelationship": "Alternative",
  "presentation": {
    "typeCode": "380", "invoiceNumber": "FAC-2026-000001", "issueDate": "2026-11-13", "dueDate": "2026-12-13", "currencyCode": "MAD",
    "supplier": { "name": "…", "nameAr": "…", "ice": "15 chiffres", "identifiantFiscal": "…", "rc": "…", "taxeProfessionnelle": "…", "cnss": "…", "legalForm": "…", "shareCapitalCents": 0, "addressLines": ["…"] },
    "customer": { "name": "…", "addressLines": ["…"] },
    "lines": [{ "descriptionFr": "…", "descriptionAr": "…", "quantityMilli": 1000, "unitCode": "C62", "unitPriceCents": 0, "discountBps": 0, "vatRateBps": 2000, "lineTotalCents": 0 }],
    "vatBreakdown": [{ "vatRateBps": 2000, "taxableCents": 0, "taxCents": 0 }],
    "totals": { "lineExtensionCents": 0, "taxTotalCents": 0, "stampDutyCents": 0, "taxExclusiveCents": 0, "taxInclusiveCents": 0, "retentionCents": 0, "payableCents": 0 },
    "legalMentionsFr": ["…"], "legalMentionsAr": ["…"]
  },
  "verification": { "baseUrl": "https://<domaine fourni par la configuration>", "xhubUuid": "<uuid>" },
  "expectedAmountInWords": { "fr": "…", "ar": "…" }
}
```

Réponses : `200 application/pdf` ; `400 INVALID_JSON` / `INVALID_REQUEST` (+ `path`) ; `405` ; `413` (10 Mio) ; `422 XML_INVALID` (XML mal formé, DOCTYPE refusé, racine ni `Invoice` ni `CreditNote`), `PRESENTATION_XML_MISMATCH` (numéro ou TTC différent du XML, `path` du champ), `AMOUNT_IN_WORDS_MISMATCH` ; `500 PDF_BUILD_FAILED` (message constant). Les arrêtés (FR et AR) sont **toujours recalculés** par le conteneur à partir de `totals.taxInclusiveCents` ; `expectedAmountInWords` est un garde-fou facultatif. Le QR encode `<baseUrl>/api/v1/public/verify/<xhubUuid>` et n'est jamais appelé.

Aucun contenu de facture n'est journalisé. Les XSD et Schematron viennent des jars Maven : aucune URL n'est résolue à l'exécution (un test le vérifie), les DOCTYPE sont refusés.

## Dépendances (versions exactes dans `pom.xml`)

`com.helger.phive:phive-api` et `phive-xml` 12.2.0 ; `com.helger.phive.rules:phive-rules-en16931` 4.6.4 (règles EN 16931 v1.3.17 pour UBL, XSD UBL 2.1 via `ph-ubl21`) ; `org.glassfish.jaxb:jaxb-runtime` 4.0.9 (lecture des rapports SVRL) ; `org.mustangproject:library` 2.26.0 (PDFBox 3.0.8 transitif) ; `com.google.zxing:core` 3.5.4 (QR, Apache-2.0) ; `com.ibm.icu:icu4j` 79.1 (mise en forme arabe, licence Unicode) ; test : `org.verapdf:validation-model` 1.30.4 (veraPDF, validation PDF/A-3B).

## Tests

Maven doit tourner sous Java 21 :

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-amazon-corretto.x86_64   # selon la machine
mvn -q -B test
```

Les fixtures de `src/test/resources/fixtures/` sont écrites pour les tests. Un test interdit `double`, `float` et `BigDecimal` dans `src/main` (montants en entiers uniquement), ainsi que les URL distantes et les marqueurs de code factice. `AmountInWordsTest` relit `../../packages/ubl-xades/tests/golden/amount-in-words.vectors.json` (échec si absent) : lancer `mvn` depuis le dépôt complet. La géométrie PDF (dixièmes de point, entiers) ne convertit en flottants qu'à la frontière de l'API PDFBox, sans montant.

## Image

Le `Dockerfile` (non construit dans le bac à sable, qui n'a pas Docker) est en trois étapes : polices, construction Maven, exécution non-root (uid 10001). Le registre est le paramètre obligatoire `FISCA_IMAGE_REGISTRY` (ERRATA D-15) :

```bash
docker build --build-arg FISCA_IMAGE_REGISTRY=<registre>/<espace> -t <registre>/<espace>/fiscal-java:<tag> .
```

Polices OFL (Geist v1.9.2, IBM Plex Sans Arabic 1.1.0) vendorisées dans `fonts/` (Regular, Bold, licences ; empreintes dans `fonts/FILES.sha256`, archives d'origine dans `fonts/SHA256SUMS`, sources dans `fonts/SOURCES.md`), embarquées dans le jar. La construction de l'image passe `-DskipTests` (les tests relisent un fichier hors du contexte Docker) : `mvn -q -B test` s'exécute en CI avant. Non construite ici (pas de Docker).
