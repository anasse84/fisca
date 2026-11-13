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
