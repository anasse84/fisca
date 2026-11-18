---
id_source: cmwg41wn801dw06ad1r2kvq3c
category: project_context
importance: 4
tags: ["fisca", "cgnc", "tva-encaissement", "plan-comptable", "accounting", "morocco", "moroccan-accounting", "analytical-subdivisions", "custom-accounts", "is_official_cgnc_base", "parent_cgnc_account", "34558", "44551", "44558", "3455", "4455", "vat-tracking", "chart-of-accounts", "mapping", "hierarchy"]
whenToUse: "When building or auditing Fisca chart-of-accounts tables, CGNC seed data, or VAT-on-encaissement accounts (34558/44558)"
date_creation: 2026-11-14T07:55:11Z
date_maj: 2026-11-14T07:55:13Z
titre: "CGNC : comptes 34558/44551/44558 = subdivisions analytiques Fisca"
---
# CGNC : comptes 34558/44551/44558 = subdivisions analytiques Fisca

## Contenu intégral (inchangé)

In Fisca's CGNC account data, the accounts 34558, 44551 and 44558 are not official CGNC base accounts. They are Fisca's own 5-digit analytical subdivisions, allowed by the CGNC for tracking VAT on encaissement. Flag them is_official_cgnc_base = false with parent_cgnc_account "3455" (for 34558) or "4455" (for 44551 and 44558). All accounts taken directly from the CGNC nomenclature are flagged is_official_cgnc_base = true.
