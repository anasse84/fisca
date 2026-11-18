---
id: cmwh0nj5900cl07adht2hg7u4
slug: fisca-chart-of-accounts
title: Fisca chart of accounts
pageType: policy / compliance
version: 1
updatedAt: 2026-11-14T23:07:47.758Z
url: https://hyperagent.com/wiki/fisca-chart-of-accounts
---

# Fisca chart of accounts

**Résumé.** How Fisca models the Moroccan CGNC/PCGE chart of accounts, its VAT accounts and the owner-supplied dataset shown on the marketing site.

## Texte complet

Rules for the accounts used by the [[fisca]] ledger and shown on its public site. The dataset is supplied by the owner and not cross-checked with the official CGNC text.

## Account rules
- Official PCGE mapping: 34551 = État - TVA récupérable sur immobilisations (rule `RECOVERABLE_IMMOB_34551`); 34552 = État - TVA récupérable sur charges (`RECOVERABLE_CHARGES_34552`). Charge entries (6125, 61473, 6311) post recoverable VAT to 34552. [1]
- 1181 = Résultats nets en instance d'affectation (solde créditeur); 1161 = Report à nouveau (solde créditeur); 44525 keeps its historical label « État, IGR ». [1]
- 34558, 44551 and 44558 are Fisca's own 5-digit analytical subdivisions for VAT on encaissement, not official CGNC accounts: `is_official_cgnc_base=false` with `parent_cgnc_account` 3455 (34558) or 4455 (44551, 44558); accounts taken directly from the CGNC are `true`. [2]
- The VAT_CLEARING engine chooses the recoverable-VAT account by chart role (`VAT_RECOVERABLE_CHARGES` or `VAT_RECOVERABLE_IMMOB`), never by a hard-coded number; a test locks fixed assets to 34551 and charges to 34552. [3]
- No production chart of accounts is seeded yet; when it is (wave 3 or 4), `vat_regime_role` must be 34551 = `VAT_RECOVERABLE_IMMOB` and 34552 = `VAT_RECOVERABLE_CHARGES`. [3]

## Marketing-site dataset
- The site's CGNC pages come from an owner-supplied dataset of 61 accounts (58 official + 3 analytical), 183 URLs in fr/ar/en. [4]
- `codeEdi` SIMPL-IS stays null with status `PENDING_OFFICIAL_DGI_SIMPL_IS_XSD`; the dataset is shown as supplied by the owner, never as « officiel » or « certifié ». The remaining ~190 sector sub-accounts and codeEdi integers are post-G4 enrichment. [4] [2]
- Six accounts cited in example entries have no page and display as bare numbers: 4481, 6114, 6193, 6195, 6701, 8600. [5]

## Open items
- Anasse: validate the 61-account count (he announced 60) and have the translations and amounts in words reviewed by native speakers or an accountant. [5]

## Related
- [[fisca-engineering-rules]]: ledger hashing and access rules.
- [[fisca-software-factory]]: wave 2 built the site pages.
- [[fisca-monorepo]]: `apps/marketing-astro` holds the dataset.

## Sources

| N | Type | Nom | Identifiants |
|---|---|---|---|
| 1 | memory | Saved memory by Anasse El Haji, Nov 14 | memoryId cmwg41yqs00ow08ad1henfd3y |
| 2 | memory | Saved memory by Anasse El Haji, Nov 14 | memoryId cmwg41wn801dw06ad1r2kvq3c |
| 3 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 14 7:59 AM | threadId cmweubtfn067107ad0etaab1o, message cmwg47fja00r407ad2vr8860w |
| 4 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 14 7:43 AM | threadId cmweubtfn067107ad0etaab1o, message cmwg3mlhy00tz07ad5cmluyid |
| 5 | document | "FISCA_STATE_AND_HANDOFF" by Anasse El Haji, v166, Nov 12 | documentId cmwczkgbj01nc07ad7i2cqcee, version cmwg7roxh026n07adbetdxa1d |
