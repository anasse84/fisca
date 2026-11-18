# Planifications Hyperagent d'origine

## fisca-wiki-memory-curator — Curation nocturne 04h00
- RRULE : `FREQ=DAILY;BYHOUR=4;BYMINUTE=0` (fuseau Africa/Casablanca) → cron équivalent : `0 4 * * *` avec `CRON_TZ=Africa/Casablanca`
- Mode lecture seule d'origine : true
- Prompt d'origine :

> Passe nocturne quotidienne de curation : traite ce qui a changé depuis la passe précédente dans fisca_master_backlog, fisca_contracts_registry, FISCA_STATE_AND_HANDOFF et le dépôt, puis rends ton compte rendu.

Sur Antigravity : `ops/antigravity/curate.sh` (prompt M5) lancé par cron (voir docs/antigravity/05-planification-automatique.md). Aucune autre planification n'existait ; le pilotage automatique reposait sur des rappels du pilote (échelle de 10 rappels à 1, 2, 3, 4, 6, 8, 12, 16, 20, 24 h) remplacés par pilot-loop.sh.
