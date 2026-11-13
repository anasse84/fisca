# fiscal-java : conteneur Java 21 de validation UBL 2.1 + EN 16931 (PHIVE) et socle Factur-X (Mustangproject).
#
# Registre d'images (ERRATA D-15) : aucun registre n'est écrit en dur. L'ARG est obligatoire et désigne le
# registre (ou miroir) qui héberge les images de base, par exemple :
#   docker build --build-arg FISCA_IMAGE_REGISTRY=<registre>/<espace> -t <registre>/<espace>/fiscal-java:<tag> .
ARG FISCA_IMAGE_REGISTRY
ARG MAVEN_IMAGE=maven:3.9.9-eclipse-temurin-21
ARG RUNTIME_IMAGE=eclipse-temurin:21-jre

# --- Étape 1 : polices (téléchargées depuis les dépôts officiels, empreinte SHA-256 épinglée) ---
FROM ${FISCA_IMAGE_REGISTRY}/${MAVEN_IMAGE} AS fonts
ARG GEIST_VERSION=v1.9.2
ARG PLEX_ARABIC_VERSION=1.1.0
WORKDIR /fonts-work
COPY fonts/SHA256SUMS ./SHA256SUMS
RUN curl --fail --silent --show-error --location \
      --output geist-font-${GEIST_VERSION}.zip \
      "https://github.com/vercel/geist-font/releases/download/${GEIST_VERSION}/geist-font-${GEIST_VERSION}.zip" \
 && curl --fail --silent --show-error --location \
      --output ibm-plex-sans-arabic-${PLEX_ARABIC_VERSION}.zip \
      "https://github.com/IBM/plex/releases/download/%40ibm/plex-sans-arabic%40${PLEX_ARABIC_VERSION}/ibm-plex-sans-arabic.zip" \
 && sha256sum --check SHA256SUMS \
 && mkdir geist plex \
 && (cd geist && jar xf ../geist-font-${GEIST_VERSION}.zip) \
 && (cd plex && jar xf ../ibm-plex-sans-arabic-${PLEX_ARABIC_VERSION}.zip) \
 && mkdir -p /out/geist /out/ibm-plex-sans-arabic \
 && cp geist/geist-font/Geist/ttf/*.ttf /out/geist/ \
 && cp geist/geist-font/OFL.txt /out/geist/ \
 && cp plex/ibm-plex-sans-arabic/fonts/complete/ttf/*.ttf /out/ibm-plex-sans-arabic/ \
 && cp plex/ibm-plex-sans-arabic/LICENSE.txt /out/ibm-plex-sans-arabic/

# --- Étape 2 : construction Maven (dépendances résolues ici, jamais à l'exécution) ---
FROM ${FISCA_IMAGE_REGISTRY}/${MAVEN_IMAGE} AS build
WORKDIR /build
COPY pom.xml ./
RUN mvn --batch-mode --quiet dependency:go-offline
COPY src ./src
RUN mvn --batch-mode --quiet package

# --- Étape 3 : image d'exécution, utilisateur non-root, sans Maven ni accès réseau requis ---
FROM ${FISCA_IMAGE_REGISTRY}/${RUNTIME_IMAGE} AS runtime
RUN groupadd --system --gid 10001 fisca \
 && useradd --system --uid 10001 --gid fisca --no-create-home --shell /usr/sbin/nologin fisca
WORKDIR /app
COPY --from=build /build/target/fiscal-java.jar /app/fiscal-java.jar
COPY --from=fonts /out /usr/local/share/fonts/fisca
ENV FISCAL_JAVA_PORT=8080 \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -Djava.net.preferIPv4Stack=true -Dfile.encoding=UTF-8"
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["java", "-cp", "/app/fiscal-java.jar", "ma.fisca.fiscaljava.HealthCheck"]
ENTRYPOINT ["java", "-jar", "/app/fiscal-java.jar"]
