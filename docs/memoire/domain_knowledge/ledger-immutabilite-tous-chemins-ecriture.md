---
id_source: cmwfo0hpx00ne07adtnmqfayk
category: domain_knowledge
importance: 5
tags: ["fisca", "ledger", "triggers", "postgresql", "immutability"]
whenToUse: "When writing or reviewing Fisca db-schema triggers, migrations or ledger engine code touching POSTED entries, fiscal years, cash 5161, reversals or concurrency"
date_creation: 2026-11-14T00:26:11Z
titre: "Grand livre : gardes d'immutabilité sur tous les chemins d'écriture"
---
# Grand livre : gardes d'immutabilité sur tous les chemins d'écriture

## Contenu intégral (inchangé)

Fisca ledger immutability rule, set after the G1 audit: any guard on a POSTED entry or a CLOSED fiscal year must cover every write path, not just INSERT. Line UPDATEs are refused if the OLD or the NEW entry_id points to a POSTED entry. Sealing (the transition to POSTED) is refused for a draft in a CLOSED year. Any change to journal_entries.fiscal_year_id is refused, while the AN opening journal is still inserted into the new year. SQLite and PL/pgSQL must raise the same error text. PostgreSQL is not single-writer like D1, so cash 5161 and hash-chain checks need serialization, such as pg_advisory_xact_lock taken before reading the balance. Uniqueness invariants, such as one reversal per entry, are enforced by a UNIQUE index and not by SELECT-then-INSERT.
