# fiscal-java

Conteneur Java 21 de Fisca (ADR-09), isolé et sans accès réseau à l'exécution. Il valide les factures UBL 2.1 contre les règles EN 16931 (ph-ubl et PHIVE) et prépare l'assemblage Factur-X (Mustangproject, ticket P2A-06).

## Régime provisoire (ERRATA B-13)

Aucun schéma technique officiel de la facturation électronique marocaine n'est publié. Le jeu de règles appliqué est nommé dans chaque rapport :
`OASIS UBL 2.1 + EN 16931 (PHIVE), profil CIUS-MA : cius-ma-provisional, non publié par la DGI`.
Le profil `cius-ma-provisional` (interface `ValidationProfile`, choisi par `ValidationProfiles.resolveProfile(name)`) est le seul point où vivront les règles marocaines (ticket P2A-02) ; il est remplaçable et n'est jamais mêlé au validateur. La conformité officielle n'est pas vérifiée.

## Interface HTTP interne (port `FISCAL_JAVA_PORT`, 8080 par défaut)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/health` | `{"status":"ok","service":"fiscal-java"}` |
| `POST` | `/validate` | Corps : XML UBL (10 Mio max). Réponse JSON : `valid`, `ruleSet`, `profile`, `profileStatus`, `errorCount`, `warningCount`, `issues[]` (`rule`, `location`, `severity`, `message`). `?profile=<nom>` choisit le profil (400 si inconnu). Un XML mal formé donne un rapport (`XML-NOT-WELL-FORMED`), pas une erreur serveur. |

Aucun contenu de facture n'est journalisé. Les XSD et Schematron viennent des jars Maven : aucune URL n'est résolue à l'exécution (un test le vérifie), les DOCTYPE sont refusés.

## Dépendances (versions exactes dans `pom.xml`)

`com.helger.phive:phive-api` et `phive-xml` 12.2.0 ; `com.helger.phive.rules:phive-rules-en16931` 4.6.4 (règles EN 16931 v1.3.17 pour UBL, XSD UBL 2.1 via `ph-ubl21`) ; `org.glassfish.jaxb:jaxb-runtime` 4.0.9 (lecture des rapports SVRL) ; `org.mustangproject:library` 2.26.0.

## Tests

Maven doit tourner sous Java 21 :

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-amazon-corretto.x86_64   # selon la machine
mvn -q -B test
```

Les fixtures de `src/test/resources/fixtures/` sont écrites pour les tests. Un test interdit `double`, `float` et `BigDecimal` dans `src/main` (montants en entiers uniquement), ainsi que les URL distantes et les marqueurs de code factice.

## Image

Le `Dockerfile` (non construit dans le bac à sable, qui n'a pas Docker) est en trois étapes : polices, construction Maven, exécution non-root (uid 10001). Le registre est le paramètre obligatoire `FISCA_IMAGE_REGISTRY` (ERRATA D-15) :

```bash
docker build --build-arg FISCA_IMAGE_REGISTRY=<registre>/<espace> -t <registre>/<espace>/fiscal-java:<tag> .
```

Polices OFL (Geist v1.9.2, IBM Plex Sans Arabic 1.1.0) téléchargées à la construction ; l'empreinte SHA-256 de chaque archive est épinglée dans `fonts/SHA256SUMS`, sources dans `fonts/SOURCES.md`.
