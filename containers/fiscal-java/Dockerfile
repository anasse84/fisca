# fiscal-java : conteneur Java 21 de validation UBL 2.1 + EN 16931 (PHIVE) et assemblage PDF/A-3b avec facture UBL embarquée (Mustangproject, profil provisoire).
#
# Registre d'images (ERRATA D-15) : aucun registre n'est écrit en dur. L'ARG est obligatoire et désigne le
# registre (ou miroir) qui héberge les images de base, par exemple :
#   docker build --build-arg FISCA_IMAGE_REGISTRY=<registre>/<espace> -t <registre>/<espace>/fiscal-java:<tag> .
ARG FISCA_IMAGE_REGISTRY
ARG MAVEN_IMAGE=maven:3.9.9-eclipse-temurin-21
ARG RUNTIME_IMAGE=eclipse-temurin:21-jre

# --- Polices vendorisées (pas d’étape de construction dédiée) ---
# Geist (latin) et IBM Plex Sans Arabic (arabe), SIL OFL 1.1, sont commitées dans fonts/ (Regular et Bold + licences) avec leurs
# empreintes SHA-256 (fonts/FILES.sha256, vérifiées par VendoredFontsTest) ; provenance des archives : fonts/SOURCES.md et
# fonts/SHA256SUMS. Elles sont embarquées dans le jar (resources) puis intégrées dans chaque PDF : aucune police système,
# aucun téléchargement à la construction ni à l'exécution.

# --- Étape 1 : construction Maven (dépendances résolues ici, jamais à l'exécution) ---
FROM ${FISCA_IMAGE_REGISTRY}/${MAVEN_IMAGE} AS build
WORKDIR /build
COPY pom.xml ./
RUN mvn --batch-mode --quiet dependency:go-offline
COPY fonts ./fonts
COPY src ./src
# Les tests (dont AmountInWordsTest) relisent les vecteurs d'or de packages/ubl-xades, absents du contexte de construction :
# ils s'exécutent en CI avant la construction de l'image (`mvn -q -B test`), pas dans l'image.
RUN mvn --batch-mode --quiet package -DskipTests

# --- Étape 2 : image d'exécution, utilisateur non-root, sans Maven ni accès réseau requis ---
FROM ${FISCA_IMAGE_REGISTRY}/${RUNTIME_IMAGE} AS runtime
RUN groupadd --system --gid 10001 fisca \
 && useradd --system --uid 10001 --gid fisca --no-create-home --shell /usr/sbin/nologin fisca
WORKDIR /app
COPY --from=build /build/target/fiscal-java.jar /app/fiscal-java.jar
ENV FISCAL_JAVA_PORT=8080 \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -Djava.net.preferIPv4Stack=true -Djava.awt.headless=true -Dfile.encoding=UTF-8"
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["java", "-cp", "/app/fiscal-java.jar", "ma.fisca.fiscaljava.HealthCheck"]
ENTRYPOINT ["java", "-jar", "/app/fiscal-java.jar"]
