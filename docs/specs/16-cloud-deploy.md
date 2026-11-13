<!--
ID canonique : Doc_16_Cloud_Deploy   |   Fichier : docs/specs/16-cloud-deploy.md
Source : « Document 16 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_16_Cloud_Deploy#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_16_Cloud_Deploy »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 16 — Guide de Déploiement Cloud & Infrastructure
Ce document constitue le manuel d'ingénierie cloud, de déploiement Cloudflare Edge, de configuration Multi-DNS, d'installation du serveur miroir souverain au Maroc et d'automatisation GitHub Actions de Fisca (fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Ses 12 sections nommées sont prêtes à être importées dans Hyperagent avec la portée Projet (Doc_16_Cloud_Deploy).

## Section 01 — Topologie des 4 Environnements & Sous-Domaines ANRT
L'infrastructure de Fisca sépare hermétiquement quatre environnements d'exécution afin qu'aucun test automatisé d'agent ni déploiement intermédiaire ne touche aux bases fiscales de production :

| Environnement | Domaine Racine | Juridiction Stockage | Usage Opérationnel | Déclencheur |
|---|---|---|---|---|
| 1. Local Sandbox | localhost | RAM / Disque éphémère | Boucles TDD Hyperagent et dev local | pnpm verify:fast |
| 2. Staging QA | staging.fisca.ma | Cloudflare UE isolé | Validation E2E et API Skill Hyperagent | Push sur branche staging |
| 3. Production Edge | fisca.ma | Cloudflare UE + Maroc | Exploitation nominale PME, OEC et POS | Tag Git signé vX.Y.Z |
| 4. Souverain Maroc | souverain.fisca.ma | 100 % Maroc (Casa/Rabat) | Miroir PRA chaud et clients OIV Loi 05-20 | Réplication continue mTLS |

L'architecture DNS du domaine national fisca.ma (enregistré auprès d'un bureau d'enregistrement agréé par l'ANRT) répartit les surfaces sur huit sous-domaines spécialisés :

- fisca.ma et www.fisca.ma : Site vitrine apps/marketing-astro en 6 langues servi en SSR Edge depuis Casablanca et Rabat.

- app.fisca.ma : Application métier apps/web-saas (6 langues PME contre 3 langues Fiduciaire et Corporate).

- pos.fisca.ma : Caisse tactile apps/pos-pwa dotée d'un Service Worker hors-ligne 72 heures et stockage SQLite OPFS.

- api.fisca.ma : Cœur métier apps/api-hono, webhooks entrants et synchronisation mTLS des agents ERP.

- auth.fisca.ma : Courtier central OAuth 2.0 / OIDC Google et SSO SAML pour les domaines personnalisés fiduciaires.

- mcp.fisca.ma : Serveur Model Context Protocol sans état protégé par OAuth 2.1 + PKCE.

- ingest.fisca.ma : Enregistrements MX routant les factures fournisseurs par email vers le pipeline d'extraction.

- status.fisca.ma : Page de transparence SLA externe hébergée hors de l'infrastructure primaire.

## Section 02 — Ouverture & Paramétrage Pas à Pas des Services Cloudflare
Suivez cette séquence exacte lors de l'initialisation du compte de production Cloudflare de SYNAPTIC SYSTEMS SARL AU afin de verrouiller dès la première minute la résidence Union Européenne exigée par le Document 11 (Article 43 de la Loi n° 09-08 CNDP) :

- Activation du plan et placement intelligent : Souscrivez au plan Workers Paid, activez Smart Placement pour rapprocher les exécutions intensives des bases UE tout en gardant le cache et la terminaison TLS dans les points de présence de Casablanca et Rabat, et désactivez la rétention de corps de requêtes dans les journaux HTTP.

- Création de la base maîtresse D1 en Europe de l'Ouest : Exécutez wrangler d1 create fisca-control-plane-eu --location=weur puis reportez l'identifiant généré dans wrangler.toml. Créez un jeton API interne à portée minimale (D1:Edit) stocké dans Cloudflare Secrets Store permettant au Worker d'orchestration de provisionner à la volée une base D1 isolée (--location=weur) à chaque nouvelle société créée.

- Création du coffre-fort R2 WORM 10 ans en juridiction UE : Exécutez wrangler r2 bucket create fisca-worm-vault-10y-eu --jurisdiction=eu, puis activez la règle Object Lock en mode strict Compliance avec une durée minimale de rétention de 3 653 jours (10 années incluant les années bissextiles plus 1 jour de sécurité, conformément à l'Article 211 du CGI).

- Provisionnement KV, Files Queues et DLQ : Créez l'espace FISCA_FAST_KV, puis créez les cinq files principales (fisca-invoice-ingestion, fisca-xhub-clearance, fisca-erp-sync-outbound, fisca-sovereign-mirror, fisca-notifications) associées chacune à sa Dead-Letter Queue (dlq-*) avec une rétention des messages non traités portée à 14 jours.

- Création de l'index Vectorize et de la passerelle AI Gateway : Exécutez wrangler vectorize create fisca-maroc-cgnc-cgi-v1 --dimensions=1024 --metric=cosine pour l'indexation sémantique du PCGE et du CGI. Dans AI Gateway, créez la passerelle fisca-neuro-gateway avec Log Prompts & Responses = OFF (Zero Data Retention), cache déterministe activé et limites budgétaires par dossier.

- Activation du routage entrant @ingest.fisca.ma : Dans Cloudflare Email Routing, configurez la sous-zone ingest.fisca.ma avec une règle Catch-All dirigée vers le Worker d'ingestion documentaire qui vérifie SPF/DKIM avant d'extraire les pièces jointes PDF et Factur-X.

## Section 03 — Marque Blanche Fiduciaire (Cloudflare for SaaS), WAF & Secrets Store
- Configuration Cloudflare for SaaS pour les cabinets OEC : Activez Custom Hostnames sur la zone fisca.ma avec l'origine de repli customers.fisca.ma. Lorsqu'une fiduciaire renseigne son sous-domaine personnalisé (ex. compta.cabinet-atlas.ma) et pointe son CNAME vers customers.fisca.ma, l'API provisionne automatiquement un certificat TLS 1.3 géré (validation HTTP DCV sans intervention manuelle) et verrouille ce domaine sur les 3 langues institutionnelles (fr, ar, en).

- Durcissement périmétrique WAF, Rate Limiting & Turnstile :

- Activez le jeu de règles Cloudflare Managed Ruleset et OWASP Core Ruleset en bloquant les injections SQL/XSS tout en autorisant les payloads légitimes XML UBL 2.1 sur /api/v1/erp/* et /api/v1/webhooks/xhub-cdv.

- Créez trois widgets Cloudflare Turnstile (mode invisible sans puzzle visuel intrusif) pour protéger /api/v1/auth/*, le portail public de conversion QR Fisca POS et les simulateurs SEO gratuits.

- Injection zéro-clair dans Cloudflare Secrets Store : Aucun secret ne figure jamais dans wrangler.toml ni dans GitHub. Injectez chaque clé sensible via wrangler secret put : AUTH_PEPPER, JWT_EDDSA_PRIVATE_JWK, GOOGLE_OAUTH_CLIENT_SECRET, CF_D1_PROVISIONER_TOKEN, BARID_ESIGN_CSC_SECRET, PAYZONE_WEBHOOK_SECRET, INFOBIP_API_KEY, AWS_SES_SMTP_SECRET et SOVEREIGN_MIRROR_HMAC_KEY.

## Section 04 — Architecture Multi-DNS ANRT, Quorum Externe & Bascule 60 Secondes
Pour honorer l'objectif RTO inférieur à 60 secondes du Document 12 même en cas d'incident affectant le réseau primaire :

- Sécurisation DNSSEC auprès du registre ANRT : Activez DNSSEC (algorithme ECDSAP256SHA256, type de condensat 2) et enregistrez l'empreinte DS auprès de votre prestataire agréé ANRT pour protéger fisca.ma contre tout empoisonnement de cache DNS sur les réseaux télécoms marocains.

- Double autorité DNS synchronisée : Configurez un fournisseur DNS secondaire indépendant en mode autoritaire secondaire synchronisé en continu, avec un TTL de 30 secondes sur les enregistrements A/AAAA/CNAME de api.fisca.ma et app.fisca.ma.

- Orchestration du Quorum de Bascule : Trois sondes externes indépendantes (situées à Casablanca, Paris et Francfort) appellent /api/v1/health/deep toutes les 15 secondes. Dès que 2 sondes sur 3 constatent 3 échecs consécutifs (45 secondes), l'API du DNS secondaire bascule les enregistrements vers l'adresse IP marocaine du cluster miroir et déclenche une alerte P1 Infobip vers votre téléphone.

## Section 05 — Construction & Cycle de Vie des MicroVMs (Cloudflare Containers)
Les trois conteneurs Linux isolés (fiscal-java, docling-python et camel-bridge) obéissent à des règles d'assemblage strictes garantissant rapidité, reproductibilité et sécurité :

- Images autonomes sans téléchargement externe au démarrage (Air-Gapped Ready) : Le fichier Dockerfile de containers/docling-python pré-télécharge et vérifie par empreinte SHA-256 les poids des modèles de lecture de tableaux (TableFormer) lors du docker build, et containers/fiscal-java embarque tous les artefacts Schematron PHIVE, ph-ubl, Mustangproject et les polices Geist + Noto Sans Arabic. Aucun conteneur n'effectue d'appel réseau sortant vers Maven Central ou HuggingFace en production.

- Utilisateur non-privilégié et système de fichiers en lecture seule : Les trois images s'exécutent sous un utilisateur Linux non-root (UID 10001) avec système de fichiers racine en lecture seule et un seul volume temporaire en RAM (/tmp limité à 256 Mo) purgé après chaque traitement.

- Ordonnancement énergétique adapté aux horaires marocains : Un Cron Worker maintient une instance pré-chauffée de fiscal-java du lundi au samedi entre 08h00 et 19h00 (Africa/Casablanca) — et 2 instances du 15 au 21 du mois — puis laisse les conteneurs redescendre à 0 instance la nuit.

## Section 06 — Serveur Miroir Chaud & Nœud Souverain Maroc (Casablanca / Rabat)
Cette infrastructure physique localisée sur le territoire marocain remplit simultanément deux missions : servir de cible de reprise instantanée (standby-vps) pour le parc standard, et héberger en primaire 100 % national les clients de l'offre Fisca Souverain (ENT_SOUVERAIN, Loi n° 05-20 de la DGSSI) :

| Profil de Déploiement Maroc | Dimensionnement Minimal | Stockage & Chiffrement Disque | Connectivité & Pare-Feu |
|---|---|---|---|
| Miroir Chaud PRA Parc PME | 8 vCPU, 32 Go RAM | 2 x 1 To NVMe RAID1 + LUKS2 | 1 Gbps, ports 443 HTTPS/mTLS seuls |
| Nœud Primaire OIV Loi 05-20 | 16 vCPU, 64 Go RAM (HA) | 2 x 2 To NVMe RAID10 + HSM | Liaison privée IPsec + Zéro-Egress |
| Nœud GPU IA Souverain Maroc | GPU 24 Go VRAM minimum | 500 Go NVMe chiffré LUKS2 | Réseau interne isolé sans sortie WAN |

- Durcissement système (Conformité DNSSI) : Installation sous Ubuntu Server 24.04 LTS minimal, mises à jour de sécurité noyau sans redémarrage, accès d'administration SSH exclusivement via tunnel privé WireGuard avec clé matérielle Ed25519 (mot de passe SSH désactivé), détection d'intrusion CrowdSec et export temps réel des journaux vers un collecteur externe.

## Section 07 — Stack Conteneurisée Souveraine : docker-compose.sovereign.yml
Ce manifeste complet prêt pour la production déploie sur le serveur marocain l'intégralité de l'écosystème autonome (Caddy mTLS, Standby API Hono, PostgreSQL 16, MinIO WORM 10 ans, Redis BullMQ et les conteneurs locaux PHIVE et Docling) :

```yaml
name: fisca-sovereign-maroc

services:
  caddy-gateway:
    image: caddy:2.8-alpine
    restart: unless-stopped
    ports:
      - "443:443"
    volumes:
      - ./ops/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./ops/certs:/etc/caddy/certs:ro
      - caddy_data:/data
    networks:
      - dmz_net
      - internal_app_net

  fisca-standby-api:
    image: ghcr.io/synaptic-systems-ma/fisca-standby-vps:${FISCA_VERSION}
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp:size=128M
    environment:
      NODE_ENV: production
      INFRA_PROVIDER_MODE: SOVEREIGN_MOROCCO_VPS
      SOVEREIGNTY_POLICY: ${SOVEREIGNTY_POLICY:-STANDARD_CNDP_EU_ADEQUACY}
      DATABASE_URL: postgres://fisca_app:${PG_PASSWORD}@postgres-primary:5432/fisca_sovereign
      MINIO_ENDPOINT: http://minio-worm:9000
      MINIO_BUCKET_WORM: fisca-worm-vault-10y-ma
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis-bullmq:6379/0
      FISCAL_JAVA_RPC_URL: http://fiscal-java-local:8080
      DOCLING_PYTHON_RPC_URL: http://docling-python-local:8000
    env_file:
      - /etc/fisca/secrets.env
    depends_on:
      postgres-primary:
        condition: service_healthy
      minio-worm:
        condition: service_healthy
      redis-bullmq:
        condition: service_healthy
    networks:
      - internal_app_net

  postgres-primary:
    image: postgres:16.4-alpine
    restart: unless-stopped
    command: >
      postgres -c shared_buffers=4GB -c work_mem=16MB
      -c wal_level=replica -c archive_mode=on
      -c archive_command='cp %p /var/lib/postgresql/wal_archive/%f'
    environment:
      POSTGRES_DB: fisca_sovereign
      POSTGRES_USER: fisca_app
      POSTGRES_PASSWORD: ${PG_PASSWORD}
    volumes:
      - pg_data:/var/lib/postgresql/data
      - pg_wal_archive:/var/lib/postgresql/wal_archive
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fisca_app -d fisca_sovereign"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - internal_app_net

  minio-worm:
    image: minio/minio:RELEASE.2026-09-01T00-00-00Z
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes:
      - minio_worm_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - internal_app_net

  redis-bullmq:
    image: redis:7.4-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_aof_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
    networks:
      - internal_app_net

  fiscal-java-local:
    image: ghcr.io/synaptic-systems-ma/fisca-java-phive:${FISCA_VERSION}
    restart: unless-stopped
    user: "10001:10001"
    read_only: true
    tmpfs:
      - /tmp:size=256M
    networks:
      - internal_app_net

  docling-python-local:
    image: ghcr.io/synaptic-systems-ma/fisca-docling-ocr:${FISCA_VERSION}
    restart: unless-stopped
    user: "10001:10001"
    read_only: true
    tmpfs:
      - /tmp:size=512M
    networks:
      - internal_app_net

networks:
  dmz_net:
  internal_app_net:
    internal: true

volumes:
  caddy_data:
  pg_data:
  pg_wal_archive:
  minio_worm_data:
  redis_aof_data:
```

- Verrouillage WORM décennal sur MinIO à l'initialisation : Dès le premier démarrage du cluster marocain, exécutez une seule fois mc mb --with-lock local/fisca-worm-vault-10y-ma suivi de mc retention set --default COMPLIANCE 3653d local/fisca-worm-vault-10y-ma afin que même l'administrateur Linux root ne puisse altérer une pièce scellée via l'API S3 avant 10 ans et 1 jour.

- Isolation réseau stricte (internal: true) : Le réseau internal_app_net coupe matériellement tout accès Internet sortant pour PostgreSQL, MinIO, Redis et les conteneurs Java/Python, réalisant par construction le coupe-circuit Zéro-Egress de la Loi n° 05-20.

## Section 08 — Stratégie de Migration Multi-Tenant par Vagues (Zero-Downtime)
Comme Fisca opère une base SQLite D1 dédiée par entreprise cliente, toute évolution de schéma suit la discipline Expand-and-Contract (ajout de colonnes optionnelles ou nouvelles tables sans renommage destructif) déployée en quatre étapes sûres :

- Étape Canary Interne (Dossier 0) : La migration s'applique d'abord exclusivement sur la base TENANT_DB interne de SYNAPTIC SYSTEMS SARL AU suivie de l'exécution d'une facture test et d'un contrôle d'équilibre CGNC.

- Déploiement du code rétrocompatible : Le nouveau Worker Hono (capable de lire l'ancienne et la nouvelle version de schéma) est déployé progressivement.

- Migration asynchrone par vagues de 50 bases : Le producteur RollingSchemaMigrator découpe tenant_databases en lots de 50 identifiants poussés sur une file dédiée ; chaque lot vérifie la somme de contrôle SHA-256 du SQL via ensureTenantSchemaUpToDate (Document 06).

- Filet Just-in-Time et Arrêt d'Urgence : Si un utilisateur ouvre son dossier avant le passage de sa vague, le middleware Hono applique sa migration en moins de 40 ms à la volée ; si une seule base lève une exception SQL, le consommateur suspend immédiatement la vague et alerte l'équipe technique sans avoir impacté le reste du parc.

## Section 09 — Architecture CI/CD GitHub Actions (4 Workflows Automatisés)
Le dépôt GitHub privé fisca est gouverné par quatre workflows dans .github/workflows/ protégeant la branche main :

| Fichier Workflow | Événement Déclencheur | Contrôles Exécutés | Cible Déployée |
|---|---|---|---|
| ci-pr-gate.yml | Toute Pull Request vers main | Constitution + 520 tests + XSD + Trivy | Aucune (Feu vert merge) |
| cd-staging.yml | Fusion sur branche staging | Migration Staging + Tests fumée E2E | *.staging.fisca.ma |
| cd-production.yml | Tag Git signé v*.*.* | Garde calendrier DGI + SBOM + Canary 10 % | Production Cloudflare + Maroc |
| cron-dr-drill.yml | Le 5 de chaque mois à 03h00 | Restauration D1/R2 + verify-archive-offline | Sandbox d'audit PRA |

- Protection matérielle de la branche main sur GitHub : Activez dans les paramètres du dépôt GitHub Require pull request before merging, Require status checks to pass (ci-pr-gate), Do not allow bypassing the above settings et Block force pushes, rendant techniquement impossible tout écrasement accidentel par un agent.

## Section 10 — Observabilité OpenTelemetry, Alerting P1 & Page de Statut
- Télémétrie unifiée sans donnée personnelle : Les Workers Hono, conteneurs Linux et le serveur miroir Maroc exportent des traces structurées OpenTelemetry portant trace_id, company_id opaque, la latence par étape, le palier FinOps (TIER_0, TIER_1, TIER_2) et les codes d'erreurs RFC 9457, sans jamais journaliser d'ICE, de RIB, de CIN ni de corps de facture.

- Seuils d'alerte automatique vers Astreinte Infobip :

- Taux d'erreur HTTP 5xx supérieur à 0,5 % sur 3 minutes consécutives.

- Profondeur d'une Dead-Letter Queue (dlq-xhub, dlq-ingestion, dlq-mirror) supérieure à 0 message.

- Latence de réplication vers le serveur miroir Maroc supérieure à 15 secondes.

- Échec du Cron quotidien d'horodatage de l'Arbre de Merkle à 23h59 (alerte immédiate à 00h05).

## Section 11 — Configurations de Référence : Pipeline Production & Script Provisioning
Ce premier fichier (.github/workflows/cd-production.yml) orchestre la vérification du calendrier fiscal marocain, la génération de la nomenclature de sécurité SBOM CycloneDX, le déploiement graduel Canary à 10 % puis 100 % et le retour arrière automatique en cas d'anomalie :

```yaml
name: CD Production Release (Fisca Edge & Sovereign Mirror)

on:
  push:
    tags:
      - "v[0-9]+.[0-9]+.[0-9]+"

permissions:
  contents: read
  packages: write
  id-token: write

jobs:
  release-gate-and-deploy:
    runs-on: ubuntu-24.04
    environment: production
    steps:
      - name: Checkout signed release tag
        uses: actions/checkout@v4

      - name: Setup Node 22 & pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"

      - name: Install dependencies & CLI validators (xmllint)
        run: |
          sudo apt-get update && sudo apt-get install -y libxml2-utils
          pnpm install --frozen-lockfile

      - name: Enforce Moroccan Tax Freeze Window & Full 520-Test Gate
        env:
          FISCA_COMMIT_MSG: ${{ github.event.head_commit.message }}
        run: |
          pnpm tsx scripts/enforce-constitution.ts
          pnpm verify:gate

      - name: Generate Signed CycloneDX SBOM (DGSSI / PASSI Audit Artifact)
        run: npx @cyclonedx/cyclonedx-npm --output-file sbom-fisca-${{ github.ref_name }}.json

      - name: Run Canary Schema Migration on SYNAPTIC Internal D1
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_PROD_DEPLOY_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
        run: pnpm --filter @fisca/db-schema run migrate:canary-prod

      - name: Upload New Worker Version & Route 10% Canary Traffic
        id: canary_deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_PROD_DEPLOY_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
        run: |
          cd apps/api-hono
          VERSION_ID=$(pnpm wrangler versions upload --output-json | jq -r '.id')
          echo "version_id=$VERSION_ID" >> $GITHUB_OUTPUT
          pnpm wrangler versions deploy "${VERSION_ID}@10%" --yes --message "Canary 10% ${{ github.ref_name }}"

      - name: Monitor Canary Deep Health for 180 Seconds & Promote or Auto-Rollback
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_PROD_DEPLOY_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
        run: |
          cd apps/api-hono
          for i in {1..12}; do
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://api.fisca.ma/api/v1/health/deep)
            if [ "$STATUS" != "200" ]; then
              echo "ERREUR CANARY HTTP $STATUS — Rollback immédiat !"
              pnpm wrangler rollback --yes --message "Auto-rollback on Canary failure ${{ github.ref_name }}"
              exit 1
            fi
            sleep 15
          done
          pnpm wrangler versions deploy "${{ steps.canary_deploy.outputs.version_id }}@100%" --yes --message "Release 100% ${{ github.ref_name }}"

      - name: Deploy Astro Marketing SSR, Web SaaS & Offline POS PWA
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_PROD_DEPLOY_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
        run: pnpm turbo run deploy:prod --filter=@fisca/marketing-astro --filter=@fisca/web-saas --filter=@fisca/pos-pwa
```

Ce second script (scripts/provision-cloudflare-prod.sh) provisionne de manière idempotente toutes les ressources Cloudflare de production avec verrouillage explicite de la juridiction européenne :

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== [1/5] Création de la Base Maîtresse D1 en Juridiction Europe Ouest (weur) ==="
pnpm wrangler d1 create fisca-control-plane-eu --location=weur || true

echo "=== [2/5] Création du Coffre-Fort R2 WORM 10 Ans en Juridiction UE (Art. 211 CGI & Loi 09-08) ==="
pnpm wrangler r2 bucket create fisca-worm-vault-10y-eu --jurisdiction=eu || true

echo "=== [3/5] Création du Cache Haute Vitesse KV & de l'Index Vectorize CGNC/CGI ==="
pnpm wrangler kv namespace create FISCA_FAST_KV || true
pnpm wrangler vectorize create fisca-maroc-cgnc-cgi-v1 --dimensions=1024 --metric=cosine || true

echo "=== [4/5] Création des 5 Files Cloudflare Queues & de leurs Dead-Letter Queues (DLQ) ==="
for q in invoice-ingestion xhub-clearance erp-sync-outbound sovereign-mirror notifications; do
  pnpm wrangler queues create "dlq-fisca-${q}" || true
  pnpm wrangler queues create "fisca-${q}" --delivery-delay-secs=0 || true
done

echo "=== [5/5] Vérification interactive des Secrets Critiques (Zéro secret en clair) ==="
REQUIRED_SECRETS=(
  "AUTH_PEPPER"
  "JWT_EDDSA_PRIVATE_JWK"
  "GOOGLE_OAUTH_CLIENT_SECRET"
  "CF_D1_PROVISIONER_TOKEN"
  "BARID_ESIGN_CSC_SECRET"
  "PAYZONE_WEBHOOK_SECRET"
  "INFOBIP_API_KEY"
  "AWS_SES_SMTP_SECRET"
  "SOVEREIGN_MIRROR_HMAC_KEY"
)
for sec in "${REQUIRED_SECRETS[@]}"; do
  echo " -> Renseignez le secret chiffré : ${sec}"
  pnpm wrangler secret put "${sec}" --name fisca-core-api
done

echo "Provisionnement Cloudflare Edge UE terminé avec succès."
```

## Section 12 — Checklist Go-Live (v1.0.0) & Harnais de Validation Infra (Session S5)
Avant d'ouvrir le trafic commercial sur fisca.ma, SYNAPTIC SYSTEMS SARL AU et l'agent Fisca-QA-Security-Auditor cochent ces huit vérifications matérielles :

- Résidence UE et Verrou WORM : Confirmation API que fisca-worm-vault-10y-eu porte jurisdiction: "eu" et un verrou Object Lock Compliance de 3 653 jours, et que MinIO Maroc applique la même rétention.

- Validation DNSSEC & Double DNS : Vérification externe (dig +dnssec fisca.ma) confirmant la chaîne AD valide auprès du registre ANRT et la synchronisation de la zone secondaire à TTL 30 secondes.

- Enchaînement complet Auth & 2FA : Test réel sur auth.fisca.ma d'une connexion Google OAuth et Email/Mot de passe suivie d'un défi 2FA TOTP et d'un OTP Infobip basculant vers le SMS expéditeur FISCA.

- Certificat Qualifié Barid eSign & Jeton Merkle : Signature réelle d'une facture de SYNAPTIC SYSTEMS SARL AU via CSC API v2.0 et validation du premier lot quotidien d'Arbre de Merkle à 23h59.

- Test Marque Blanche Fiduciaire : Création d'un domaine test compta-test.fisca.ma via Cloudflare for SaaS, émission TLS automatique en moins de 60 secondes et vérification du verrouillage strict sur les 3 langues institutionnelles.

- Autonomie Caisse Fisca POS : Installation PWA sur tablette réelle, passage en mode avion, encaissement de 10 tickets signés ECDSA P-256, reconnexion et validation de la clôture Ticket Z sans perte.

- Test Canary & Auto-Rollback CI/CD : Simulation d'un endpoint de santé défaillant en environnement Staging confirmant l'exécution automatique de wrangler rollback en moins de 30 secondes.

- Répétition Générale Failover & Failback : Exécution validée de bout en bout d'une bascule vers le serveur miroir au Maroc puis retour vers Cloudflare Edge avec readyForDnsCutover === true.
