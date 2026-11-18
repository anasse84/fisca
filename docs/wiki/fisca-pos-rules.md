---
id: cmwh0niq900bx07ad8x0vhajx
slug: fisca-pos-rules
title: Fisca POS rules
pageType: policy / compliance
version: 1
updatedAt: 2026-11-14T23:07:47.219Z
url: https://hyperagent.com/wiki/fisca-pos-rules
---

# Fisca POS rules

**Résumé.** The hashing and business rules owner-decided for Fisca's point-of-sale (caisse) tickets, Z closures and terminal pairing.

## Texte complet

Rules for the POS (caisse) of [[fisca]], built in `apps/pos-pwa` and the server code in `packages/ubl-xades`. Decided by the owner ([[anasse-el-haji]]) in the build's arbitrations; they refine the specs and ERRATA D-23.

## Hash chain
- The chain starts from `"0".repeat(64)`: the DDL v4 CHECK on 64 lowercase hex wins over the 45-character genesis used by the ledger and invoices. [1]
- Golden vectors with this seed: POS ticket `a9677d45d9429b948d9d36c01641db05086575926ef658879d61c8e57d32c7fe`, Z closure `da7c65662e8e03d044f41f6f91957b6c850e9bc8a54195f36cea8b382691d7c2`. The invoice PIH genesis stays 45 characters because `invoices.sha256_hash` has no 64-char CHECK. [1]
- Ticket fingerprint: SHA-256 of the positional JSON tuple (`FISCA_POS_TKT_V1`; Z closure `FISCA_POS_Z_V1`). The ticket kind is hashed as `SALE` for stored `SALE_B2C` and `RETURN_REFUND` for `RETURN_REFUND` (table `POS_TICKET_KIND_TUPLE_LABEL`); client and server must share this mapping. The `RETURN_REFUND` label is a server hypothesis, no owner vector exists. [2] [3]

## Business rules
- Z aggregation excludes tickets in state `CONVERTI_B2B_AVANT_Z` and subtracts `RETURN_REFUND`. [4]
- Ticket QR is a URL `https://fisca.ma/q/{token}`. [4]
- Cash stamp duty is 25 bps on `paid_cash_cents`. [4]
- MAD denominations (cents): 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10. [4]
- Supervisor gap threshold: 2000 cents. [4]
- Offline window is 72 h, counted only while at least one ticket is unsynced. [4]
- Terminal pairing route: `POST /api/v1/pos/terminals/pair`. [4]

## Frozen contracts
- Frontend and growth work must treat existing routes as frozen contracts, the pairing route above in particular: no renaming, moving, re-parametrising or duplicating; growth flows navigate to the existing route behind a feature flag, and diffs stay inside the files the task names. [5]

## Open items
- Anasse: `expected_closing_cash_cents` stays in clear in the local OPFS after the count is locked; decide before gate G4. [6]
- Anasse: confirm the `RETURN_REFUND` tuple label. [6]

## Related
- [[fisca-engineering-rules]]: general hashing and ledger rules.
- [[fisca-monorepo]]: where `pos-pwa` lives.
- [[fisca-software-factory]]: the build that produced these rules.

## Sources

| N | Type | Nom | Identifiants |
|---|---|---|---|
| 1 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 14 12:28 AM | threadId cmweubtfn067107ad0etaab1o, message cmwfo3btj00gi08adnv3de9ir |
| 2 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 14 9:07 AM | threadId cmweubtfn067107ad0etaab1o, message cmwg6n3vv017m08ad4bxcvazz |
| 3 | memory | Saved memory by Anasse El Haji, Nov 13 | memoryId cmwfl16r4004b07adtwvjpwb3 |
| 4 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 14 7:37 AM | threadId cmweubtfn067107ad0etaab1o, message cmwg3f35j013h07adxecnpqf8 |
| 5 | memory | Saved memory by Anasse El Haji, Nov 14 | memoryId cmwfnzfqx01bv07ad45m7mkti |
| 6 | document | "FISCA_STATE_AND_HANDOFF" by Anasse El Haji, v166, Nov 12 | documentId cmwczkgbj01nc07ad7i2cqcee, version cmwg7roxh026n07adbetdxa1d |
