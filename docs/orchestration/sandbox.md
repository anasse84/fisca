# Bac à sable des sessions (vérifié le 2026-11-13)

| Sujet | Constat | Conséquence |
|---|---|---|
| Système | Amazon Linux 2023, 2 vCPU, 4 Go de RAM, `sudo` sans mot de passe | Paquets par `dnf`, pas `apt-get` |
| Préinstallé | Node 24, pnpm 10, git, xmllint, jq, python 3.9, bibliothèques de Chromium | `node` exécute directement les `.ts` sans dépendance |
| Par `dnf` (31 s pour l'ensemble) | `java-21-amazon-corretto-headless`, `maven`, `dotnet-sdk-8.0`, `python3.12`, `postgresql16-server`, `redis6` | PostgreSQL et Redis démarrent sans droits root (`initdb`, `pg_ctl`, `redis6-server`) |
| Absent | Docker, Podman | Pas de `docker build` ni de `docker compose` : tester le code des conteneurs, pas l'image |
| Réseau ouvert | GitHub, Maven Central, NuGet, PyPI, nodejs.org, Adoptium, astral.sh, dl.min.io, docs.oasis-open.org, CDN Playwright | Aucun accord à demander |
| Réseau fermé par défaut | `registry.npmjs.org` (403) | RequestNetworkAccess une fois par fil, accord du propriétaire |
| Réseau refusé | `tax.gov.ma` (403) | Les XSD officiels sont déposés dans `docs/reference/dgi/` par le propriétaire |
| Sous-agents du fil | Même système de fichiers, même filtre réseau, tables et documents accessibles | Un ticket par sous-agent : contexte neuf sans perdre le clone ni npm |
| Persistance | Le clone survit entre deux tours « au mieux » | Pousser après chaque ticket ; reprendre par un nouveau clone si besoin |

`scripts/bootstrap-sandbox.sh` installe ce qu'il faut : `--java` (P2-A, P3-C, G2, G3), `--dotnet` (P3-C, G3), `--python` (P3-B, P3-C, G3), `--postgres` (S1B, P4-B, P4-C, G1, G4), `--redis` (P4-C, G4), `--playwright` (P2-B, P2-C, P4-A, G2, G4).

Non vérifiable dans le bac à sable, à consigner comme tel et jamais comme acquis : construction d'images Docker, MinIO Object Lock réel, `Objets100cLib` (Windows), builds iOS et Android, appels réels à xHub, Barid eSign, Payzone, Infobip et Meta (simulés hors ligne, Doc 17 § 12).

## PostgreSQL et `pnpm verify:fast` (ajout du 2026-11-13, MAIN_RED corrigé)

Depuis la fusion de S1B, les tests de parité SQL de `packages/db-schema` et `apps/api-hono` exigent un PostgreSQL 16 sur `127.0.0.1:54329` (`postgres://fisca@127.0.0.1:54329/postgres`, ou l'URL de `FISCA_TEST_PG_URL`). Leur `globalSetup` de vitest appelle `scripts/ensure-postgres.sh` :

- serveur déjà joignable (conteneur de CI, instance locale) : rien à faire ;
- URL par défaut injoignable : le script démarre le serveur du bac à sable (`bootstrap-sandbox.sh --postgres`, idempotent, un seul démarrage sous turbo grâce à un verrou) ;
- `FISCA_TEST_PG_URL` fournie mais injoignable : échec franc.

Aucun test n'est ignoré : si PostgreSQL ne peut pas être joint, la suite échoue. Une session qui lançait `verify:fast` sans `--postgres` n'a donc plus besoin de l'option. En CI (P4-C), déclarer un service PostgreSQL 16 et exporter `FISCA_TEST_PG_URL`.
