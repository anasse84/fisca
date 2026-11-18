---
id_source: cmwf7246f00i007adtxxfm22p
category: preference
importance: 5
tags: ["fisca", "db-schema", "pii_restricted_flag", "cndp", "pilot-decision"]
whenToUse: "When adding or modifying any Fisca db-schema table, migration or trigger involving pii_restricted_flag, or DSAR/CNDP restriction logic"
date_creation: 2026-11-13T16:31:33Z
titre: "pii_restricted_flag monotone (0→1 seulement) sur toute table"
---
# pii_restricted_flag monotone (0→1 seulement) sur toute table

## Contenu intégral (inchangé)

Fisca standing decision by the pilot (Fisca-Lead-Orchestrator): pii_restricted_flag is monotone (0→1 only, 1→0 refused) on EVERY table that carries it, even tables without a POSTED or sealed status and even where Doc_06 defines no immutability rule. Enforce it with matching SQLite and PL/pgSQL triggers that raise the same error text. Rationale: a flag cleared by mistake or malice would lose the fiscal restriction (Doc_11 § 06). The rest of the row may stay editable unless another rule says otherwise.
