---
id_source: cmwg41yqs00ow08ad1henfd3y
category: domain_knowledge
importance: 5
tags: ["cgnc", "pcge", "tva", "34551", "34552", "vat_clearing", "ledger", "fisca"]
whenToUse: "When writing, reviewing or auditing Fisca chart-of-accounts data, ledger sample entries, golden vectors, CGNC datasets (e.g. cgnc_core_60_accounts), and any VAT recovery or VAT_CLEARING engine code (apps/api-hono/src/core ledger and bank reconciliation, S1B / P3-A). Deductible VAT on charges must clear to 34552 and VAT on fixed assets (immobilisations) to 34551."
date_creation: 2026-11-14T07:55:13Z
date_maj: 2026-11-14T19:17:34Z
titre: "PCGE/CGNC : TVA récupérable 34551 (immobilisations) / 34552 (charges)"
---
# PCGE/CGNC : TVA récupérable 34551 (immobilisations) / 34552 (charges)

## Contenu intégral (inchangé)

PCGE Maroc (CGNC, loi n° 9-88), official mapping confirmed by the user: 34551 = « État - TVA récupérable sur immobilisations » (rule RECOVERABLE_IMMOB_34551); 34552 = « État - TVA récupérable sur charges » (rule RECOVERABLE_CHARGES_34552). Charge-type entries (e.g. 6125, 61473, 6311) post their recoverable VAT to 34552, not 34551. Other official labels: 1181 = « Résultats nets en instance d'affectation (solde créditeur) »; 1161 = « Report à nouveau (solde créditeur) »; 44525 keeps its historical official label « État, IGR ».
