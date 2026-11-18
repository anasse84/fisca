---
name: fisca-sandbox-toolchain
description: État vérifié du bac à sable des sessions Fisca (Amazon Linux 2023, dnf, pas de Docker) : Java 21, Maven, .NET 8, Python 3.12, PostgreSQL 16, Redis, Chromium, accès réseau et limites de test. À utiliser pour préparer l'environnement ou diagnostiquer mvn, mémoire, PHIVE, Lighthouse.
---

# fisca-sandbox-toolchain — bac à sable des sessions (vérifié le 2026-11-13)

Tout ce qui suit a été exécuté dans un bac à sable Hyperagent le 2026-11-13. Le script attaché `bootstrap-sandbox.sh` (dans `scripts/` de ce skill, et dans `scripts/` du dépôt après S0) applique ces constats. Sous Antigravity, ces constats restent des repères à revérifier dans le nouvel environnement.

## Constats

| Sujet | Constat | Conséquence |
|---|---|---|
| Système | Amazon Linux 2023, 2 vCPU, 4 Go de RAM, `sudo` sans mot de passe | Paquets par `sudo dnf install -y`, jamais `apt-get` |
| Préinstallé | Node 24, pnpm 10, npm, git, xmllint, jq, zip, python 3.9, bibliothèques système de Chromium | `node fichier.ts` exécute du TypeScript sans dépendance |
| Par `dnf` (31 s pour l'ensemble) | `java-21-amazon-corretto-headless`, `maven` (3.8), `dotnet-sdk-8.0`, `python3.12`, `postgresql16-server`, `redis6` | Voir les commandes ci-dessous |
| Absent | Docker, Podman | Ni `docker build`, ni `docker compose` |
| Réseau ouvert | GitHub, Maven Central, NuGet, PyPI, nodejs.org, Adoptium, astral.sh, dl.min.io, docs.oasis-open.org, CDN Playwright | Aucun accord à demander |
| Réseau fermé par défaut | `registry.npmjs.org` répond 403 | RequestNetworkAccess une fois par fil ; jamais de miroir |
| Réseau refusé | `tax.gov.ma` répond 403 | Les XSD officiels viennent de `docs/reference/dgi/` |
| Sous-agents du fil | Même système de fichiers et même filtre réseau que le fil ; accès aux tables et documents | Un ticket par sous-agent : contexte neuf sans perdre le clone ni npm |
| Persistance | Le clone survit entre deux tours « au mieux » | Pousser après chaque ticket ; recloner si besoin |
| Durée | Un tour délégué dure au plus une heure environ | Rappel de continuité à 60 minutes |

## Commandes vérifiées

```bash
sudo dnf install -y -q java-21-amazon-corretto-headless maven   # java 21.0.12, mvn 3.8.4
sudo dnf install -y -q dotnet-sdk-8.0                            # dotnet 8.0.131
sudo dnf install -y -q python3.12                                # python3.12 -m venv .venv
sudo dnf install -y -q postgresql16-server redis6
initdb -D ~/.fisca-pg16 -U fisca --auth=trust
pg_ctl -D ~/.fisca-pg16 -o "-p 54329 -k /tmp" -l ~/.fisca-pg16/server.log start   # postgres://fisca@127.0.0.1:54329/postgres
redis6-server --port 63799 --daemonize yes                       # redis6-cli -p 63799 ping
pnpm exec playwright install chromium                            # sans --with-deps : les bibliothèques sont déjà là
```

Options de `bootstrap-sandbox.sh` par session : `--java` (P2-A, P3-C, G2, G3), `--dotnet` (P3-C, G3), `--python` (P3-B, P3-C, G3), `--postgres` (S1B, P4-B, P4-C, G1, G4), `--redis` (P4-C, G4), `--playwright` (P2-B, P2-C, P4-A, G2, G4). Sortie 20 : npm bloqué, demander l'accès puis relancer.

## Tester sans Docker

- Conteneurs `fiscal-java`, `docling-python`, `camel-bridge` : tester le code (`mvn -q test`, `pytest`), écrire le Dockerfile, et consigner que l'image n'a pas été construite.
- Parité D1 et PostgreSQL 16 : Miniflare pour D1, PostgreSQL natif sur le port 54329.
- BullMQ : Redis natif sur le port 63799.
- Coffre WORM : contrat `WormVaultDriver` testé sur un pilote mémoire qui refuse l'écrasement et la suppression avant échéance ; le verrou Object Lock réel de MinIO et de R2 se vérifie en S5.
- Sage 100 : générateur `.PNM` et garde SQL sous Linux ; `Objets100cLib` est une bibliothèque Windows, hors solution Linux.
- Services tiers (xHub, Barid eSign, Payzone, Infobip, Meta, SES) : toujours simulés hors ligne.

## Ne jamais compter comme acquis

Construction d'images Docker, Object Lock réel, builds iOS et Android, appels réels aux services tiers, score Lighthouse mesuré une seule fois (prendre la médiane de 3 passes). Ce qui n'a pas pu être vérifié s'écrit tel quel dans le compte rendu et dans la Pull Request.

## Java 21 et Maven (vérifié le 2026-11-13, session P2-A)
- Après `bootstrap-sandbox.sh --java`, `java -version` affiche bien 21, mais Maven 3.8.4 (dnf) démarre sous Corretto 17. Le build échoue alors avec « release version 21 not supported ». Avant tout `mvn`, lancer `export JAVA_HOME=/usr/lib/jvm/java-21-amazon-corretto.x86_64`. Les tests Node qui lancent `java -jar` doivent aussi lire JAVA_HOME.
- Sans `maven-compiler-plugin` épinglé (3.13.0), Maven prend le compilateur 3.1, qui cible Java 5 et échoue. Il faut aussi épingler clean (3.4.0), resources (3.3.1), jar (3.4.2), surefire (3.5.2) et shade (3.6.0).
- `mvn dependency:go-offline` ne résout pas tous les composants des plugins sous Maven 3.8.4 : un `mvn -o package` lancé ensuite échoue. Dans un Dockerfile, lancer `go-offline` puis un `mvn package` normal à l'étape de build.
- Joignables sans accord réseau : `docs.oasis-open.org` (UBL-2.1.zip), Maven Central, github.com et api.github.com (releases des polices). Les releases GitHub de Noto Naskh Arabic répondent 404 ; IBM Plex Sans Arabic fonctionne.
- `xmllint` est présent (`/usr/bin/xmllint`).

## Constats vérifiés à la barrière G2 (2026-11-14)
- Mémoire : le bac à sable est limité à 4 Go. `pnpm verify:fast` lancé en parallèle (turbo par défaut) peut tuer un processus, par exemple `@fisca/marketing-astro:typecheck` en exit 137. Il ne s'agit pas d'un défaut du code. Remède : `pnpm turbo run typecheck lint --concurrency=1`, puis `pnpm turbo run test:unit --concurrency=1`, puis les étapes racine (`pnpm exec tsc -p scripts/tsconfig.json`, `pnpm exec eslint scripts`, `pnpm exec vitest run scripts`, `pnpm enforce`). Ne pas lancer plusieurs suites lourdes (Lighthouse, Playwright, vitest) en même temps.
- Java : Java 21 et 17 sont installés tous les deux, et `mvn` utilise Java 17 par défaut (erreur « release version 21 not supported »). Exporter `JAVA_HOME=/usr/lib/jvm/java-21-amazon-corretto.x86_64` et placer `$JAVA_HOME/bin` en tête du PATH.
- PHIVE : `tests/phive-crosscheck.test.ts` est ignoré en silence (32 tests) si le jar est absent. Le construire avec `cd containers/fiscal-java && mvn -q -B package -DskipTests`, puis lancer les tests avec `FISCA_REQUIRE_PHIVE=1` pour qu'une absence de PHIVE fasse échouer le test.
- veraPDF, qpdf et mutool sont absents : le PDF/A n'est validé que par le `PdfaValidator` du conteneur Java.
- Lighthouse : construire avec `pnpm build` dans apps/marketing-astro, servir avec `npx wrangler pages dev dist --port 4400 --ip 127.0.0.1`, puis lancer `CHROME_PATH=/agent/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome node e2e/lighthouse-check.ts http://127.0.0.1:4400 <pages>`.
- Scripts Playwright ad hoc : les exécuter depuis apps/marketing-astro, où le paquet `playwright` se résout.

## Adaptation Antigravity

- « Le script attaché … (aussi dans scripts/ du dépôt après S0) » → script dans le dossier `scripts/` de ce skill.
- Constats propres au bac à sable Hyperagent (RequestNetworkAccess, « sous-agents du fil », « rappel de continuité à 60 minutes », chemins `/agent/…`) conservés tels quels : à revérifier sur la machine Antigravity ; pour les sous-agents, lire « sous-agent Antigravity (`.agents/agents/`) ou session agy parallèle (`docs/antigravity/`) ». Les commentaires de `scripts/bootstrap-sandbox.sh` mentionnant Hyperagent ne sont pas modifiés.
