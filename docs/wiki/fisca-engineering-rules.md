---
id: cmwfl2qlf008w07add8bv9sww
slug: fisca-engineering-rules
title: Fisca engineering rules
pageType: policy / compliance
version: 3
updatedAt: 2026-11-14T23:08:19.170Z
url: https://hyperagent.com/wiki/fisca-engineering-rules
---

# Fisca engineering rules

**Résumé.** The standing integrity, security and validation rules the Fisca code must follow, mostly set by the owner's arbitrations during the build.

## Texte complet

Rules decided while building [[fisca]] in the [[fisca-monorepo]]. They refine the specs; when a spec (Doc_06 etc.) is looser than a pilot requirement on immutability or integrity, the stricter fail-closed implementation is preferred (for example the WORM UPDATE trigger on sealed archival_packages). Each such deviation must be recorded for the auditor in FISCA_STATE_AND_HANDOFF section 04. [1]

## Ledger and hashing
- Every chained fingerprint (ledger entry_hash `FISCA_GL_ENTRY_V1`, closing_hash `FISCA_GL_CLOSE_V1`, invoice PIH `FISCA_INV_PIH_V1`, POS ticket, Z closure) is SHA-256, as 64 lowercase hex, of the UTF-8 of `JSON.stringify` of a positional tuple (no spaces, undefined→null, -0→0, `_enc` columns excluded). The `|` separator is abandoned. Entry lines are sorted by lineNumber, closing journals by ASCII journalCode. [2]
- The ledger and invoice genesis is `GENESIS_HASH_` + 32 zeros (45 chars, Doc_06), unless a delivered DDL column forces 64 hex; golden entry_hash `821ebcb40a0d4574e3c5ade8d72032d93b73f41bb99041d19fc29322f0c580c5`. defaultSha256LedgerHasher is the engine default so POSTED sealing works in production (ERRATA D-22). [2] [3]
- POS chain seed and golden hashes: see [[fisca-pos-rules]]. [4]
- pii_restricted_flag is monotone (0→1 only, 1→0 refused) on every table that carries it, with matching SQLite and PL/pgSQL triggers; 0→1 stays allowed on POSTED entries of CLOSED fiscal years (DSAR). Migrations v3–v8 are not rewritten. [5] [6]
- Idempotency-Key (72 h) lives in the dossier's own TENANT_DB (table `idempotency_records`, replacing `idempotency_keys`), so key and accounting write commit atomically; same key with a different request fingerprint returns 422, same key and fingerprint replays the stored response. Re-lettering an already-lettered entry returns 409 Conflict unless the same key and request_sha256 replay within the window. [7] [8] [6]

## Access and sealing
- Access by mandate gets the strict intersection of the role's rights in the firm and the ceiling role. [4]
- OWNER_GERANT and DAF_TRESORIER hold LEDGER_VISA_CYCLE (the owner's "DAF_INTERNE" does not exist in code); the v11 ledger state machine is unchanged. A sole OWNER_GERANT without an active firm mandate seals with an implicit direct-mode visa, then REVISEE_CYCLE→POSTED, in one transaction; with an active firm the Chef de Mission visa stays required. [9] [10]
- LEDGER_READ_PROOF (read the ledger integrity proof, no Step-Up) is granted to six roles (OWNER_GERANT, DAF_TRESORIER, AIDE_COMPTABLE, CHEF_MISSION, EXPERT_COMPTABLE_OEC, AUDITEUR_CAC_DGI) and denied to technical roles; CTR-COD-21. [11]
- The X-Fisca-Company-Id header format is [A-Za-z0-9_-]{1,64} (owner decision overriding the UUIDv7 of Doc_07 § 01); the client Idempotency-Key stays UUIDv7. [12] [13]

## Rules engine
- Promoting a candidate fiscal rule requires three contradictory cases named POSITIVE_NOMINAL, NEGATIVE_COUNTEREXAMPLE and BOUNDARY_LIMIT; the AST is really evaluated. [3] [14]

## Validators
- Moroccan RIB (owner decision): 24 digits = bank code 3 (not 000), locality code 3, account 16 (not all zeros), key 2 digits from 01 to 97. Key = 97 − ((base22 × 100) mod 97), equivalent to N24 mod 97 = 0. The validator is packages/shared-types/src/rib.ts. [15]
- A valid Moroccan IBAN is MA64 + RIB. The two Bank Al-Maghrib RIB test vectors (keys 21 and 18) are arithmetically correct but not cross-checked with the bank; tests must label them so. [15]
- Sage 100 SQL guard assertReadOnlySageSql (ADR-11): read-only; strips comments and literals first; refuses writes, DDL, EXEC, INTO and exclusive locks; every physical table after FROM/JOIN needs its own WITH (NOLOCK); CTE names are exempt; comma implicit joins stay refused. [16]

## Open decisions and reserves
- Anasse: invoice identifier mapping (PHIVE) once the official profile is published, and disbursements in the PIH tuple. [17]
- Reserves to fix before later gates: idempotence responses stored in unencrypted base64 (before G3); ICE scrubber hardening (before P3-B). [8]

## Related
- [[fisca]]: the product these rules apply to.
- [[fisca-monorepo]]: where the validators and triggers live.
- [[fisca-software-factory]]: the build during which the rules were set.
- [[fisca-pos-rules]]: POS hashing and business rules.
- [[fisca-chart-of-accounts]]: account mapping and VAT roles.
- [[anasse-el-haji]]: owner who made the arbitrations.

## Sources

| N | Type | Nom | Identifiants |
|---|---|---|---|
| 1 | memory | Saved memory by Anasse El Haji, Nov 13 | memoryId cmwf71ye300q506adsxse9fao |
| 2 | memory | Saved memory by Anasse El Haji, Nov 13 | memoryId cmwfl16r4004b07adtwvjpwb3 |
| 3 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 13 6:06 PM | threadId cmweubtfn067107ad0etaab1o, message cmwfag1yi002l07adjvp4emh0 |
| 4 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 13 7:02 PM | threadId cmweubtfn067107ad0etaab1o, message cmwfcgknx00a707adb9d39eja |
| 5 | memory | Saved memory by Anasse El Haji, Nov 13 | memoryId cmwf7246f00i007adtxxfm22p |
| 6 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 14 12:22 AM | threadId cmweubtfn067107ad0etaab1o, message cmwfnw8y900x306adl8o42d5f |
| 7 | memory | Saved memory by Anasse El Haji, Nov 14 | memoryId cmwfo14am00mg06ad6o053p66 |
| 8 | document | "FISCA_STATE_AND_HANDOFF" by Anasse El Haji, v166, Nov 12 | documentId cmwczkgbj01nc07ad7i2cqcee, version cmwg7roxh026n07adbetdxa1d |
| 9 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 14 12:28 AM | threadId cmweubtfn067107ad0etaab1o, message cmwfo3btj00gi08adnv3de9ir |
| 10 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 13 7:46 PM | threadId cmweubtfn067107ad0etaab1o, message cmwfe1bjj002807adkk6br001 |
| 11 | document | "FISCA_STATE_AND_HANDOFF" by Anasse El Haji, v166, Nov 12 | documentId cmwczkgbj01nc07ad7i2cqcee, version cmwfkg2qb000908ad2tc0fc4g |
| 12 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 13 5:06 PM | threadId cmweubtfn067107ad0etaab1o, message cmwf8b5g700v108ad3p0n3jbx |
| 13 | memory | Saved memory by Anasse El Haji, Nov 14 | memoryId cmwfo03o000ls07ady2kuz2yg |
| 14 | memory | Saved memory by Anasse El Haji, Nov 13 | memoryId cmwfl13ma006808ad22ipfwsy |
| 15 | memory | Saved memory by Anasse El Haji, Nov 13 | memoryId cmwezabx0035m07adnhz6izda |
| 16 | memory | Saved memory by Anasse El Haji, Nov 13 | memoryId cmwf9vdow015a06adj0gbkn5u |
| 17 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 13 | threadId cmweubtfn067107ad0etaab1o |
