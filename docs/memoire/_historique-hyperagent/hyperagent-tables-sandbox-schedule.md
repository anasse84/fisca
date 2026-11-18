---
id_source: cmwelyxle03nl06adpl4kmafz
category: tools_and_workflows
importance: 4
tags: ["fisca", "tables", "sandbox", "schedule", "database", "postgresql", "redis", "permissions", "read-only", "amazon linux 2023", "dnf", "sudo", "environment", "runtime", "node24", "python3.12", "java21", "dotnet8", "maven", "fisca_master_backlog", "fisca_contracts_registry", "automation", "cron"]
whenToUse: "Projet Fisca : quand il faut écrire dans une table Fisca depuis un autre fil, installer un outil dans le bac à sable, ou choisir entre rappel, Schedule et relais."
date_creation: 2026-11-13T06:41:13Z
date_maj: 2026-11-13T06:41:16Z
titre: "Tables en lecture seule, bac à sable Hyperagent, Schedule limité"
applicabilite: non applicable à Antigravity
---
# Tables en lecture seule, bac à sable Hyperagent, Schedule limité

> **Non applicable à Antigravity** — mémoire propre à Hyperagent, conservée pour historique uniquement. Ne pas appliquer ces règles.

## Contenu intégral (inchangé)

Fisca — tables et bac à sable (vérifié le 2026-11-13). Une table créée dans un autre fil est en lecture seule ailleurs : seuls les agents auxquels elle est liée y écrivent (`fisca_master_backlog` et `fisca_contracts_registry` sont liées aux 6 agents Fisca) ; depuis un fil généraliste, une écriture passe par un message à l'un de ces agents. Bac à sable : Amazon Linux 2023, `dnf` et `sudo` sans mot de passe, pas de Docker, Node 24 ; Java 21, Maven, .NET 8, Python 3.12, PostgreSQL 16 et Redis 6 s'installent par `dnf`. Les exécutions planifiées (Schedule, mode Live) des agents constructeurs sont limitées en écriture : ne pas s'en servir pour faire avancer une session.
