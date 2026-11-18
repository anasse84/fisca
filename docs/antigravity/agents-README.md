# Agents Fisca (sous-agents Antigravity)

| Agent | Rôle | Écrit où | Fusionne ? | Modèle |
|---|---|---|---|---|
| fisca-lead-orchestrator | pilote : backlog, voies, arbitrage, fusion, état | clone principal (sur main), docs/state, ops/state, PR | **seul** à fusionner (commit de fusion) | pro |
| fisca-core-backend-fiscal | apps/api-hono, standby-vps, db-schema, crypto-e2ee, fiscal-ast, ai-agents, billing-metering, factorflow, docling-python | périmètre de sa session | non | pro |
| fisca-containers-edi-erp | fiscal-java, camel-bridge, ubl-xades, vault-merkle, edi-simpl, fec-auditor, connectors/ | périmètre de sa session | non | pro |
| fisca-frontend-mobile-growth | marketing-astro, web-saas, pos-pwa, mobile-capacitor, ui-mercury, i18n | périmètre de sa session | non | pro |
| fisca-qa-security-auditor | audit R1/R2/R3, seuil 95, `VERDICT <barrière> : FAVORABLE/DÉFAVORABLE` | lecture seule + tests adverses locaux | non | pro (le plus fort) |
| fisca-wiki-memory-curator | cohérence nocturne, wiki, mémoire, boîte d'apprentissage | docs/wiki, docs/memoire, docs/state, ops/state (PR) | non | flash |

Voies (`ops/antigravity/lanes.json`) : BACK-1, BACK-2 (backend) · EDI-1, EDI-2 · FRONT-1, FRONT-2 · AUDIT. Détails : `docs/antigravity/09-orchestration-parallele.md`.
Les configurations d'origine (modèle, intégrations, politique d'accès) sont dans `docs/hyperagent-origine/agents/`.
