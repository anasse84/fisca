---
id: cmwd2it0m006907adfn145n8u
slug: fisca-monorepo
title: Fisca monorepo
pageType: tool / data store
version: 6
updatedAt: 2026-11-15T01:40:13.451Z
url: https://hyperagent.com/wiki/fisca-monorepo
---

# Fisca monorepo

**Résumé.** The private GitHub monorepo holding all of Fisca's code (apps, packages, containers and connectors).

## Texte complet

Private GitHub repository anasse84/fisca (default branch main; pnpm + Turborepo) containing all Fisca code. The tree was laid down in Session S0; product code now exists for the foundation, auth, crypto, schemas, ledger and the wave-2 e-invoicing containers, SME app, POS and marketing site. [1][2][3][4]

## Layout
- apps/: marketing-astro (public site, SEO), web-saas (React 19 + Vite + Capacitor), pos-pwa, mobile-capacitor, api-hono (backend on Cloudflare Workers), standby-vps. [1]
- packages/: shared-types, db-schema, auth-rbac, crypto-e2ee, compliance-cndp, qa-harness, fiscal-ast, ubl-xades, vault-merkle, edi-simpl, fec-auditor, ai-agents, external-integrations, billing-metering, factorflow, pra-reversibility, ui-mercury, i18n. [1]
- containers/: fiscal-java, docling-python, camel-bridge. [1]
- connectors/: odoo-l10n-ma and sage100-dotnet. [1]
- ops/ (sovereign node); scripts/ (bootstrap-sandbox.sh, harness-check.sh, enforce-constitution.ts). [1]
- docs/specs/ (18 specs, each with an amendment journal since 2026-11-15, + ERRATA.md revision e), docs/orchestration/ (execution guide, loop protocol, reference scripts, wave 3/4/S5 preparation files, prerequis-proprietaire.md), docs/reference/dgi/ (official schemas, to be added), .meta/ (session-scopes.json, backlog and OpenAPI snapshots). [1][4][5]

## Specifications
- The 18 specs are Markdown files in docs/specs/ named NN-slug.md (01-prd.md … 18-seo-geo-aeo.md); the originals were DOCX and are not modified, the repo Markdown is the reference. docs/specs/ERRATA.md prevails over them. A backlog reference such as Doc_04_TDD#S02 means 04-tdd-architecture.md, "Section 02". Sessions read them locally in their clone. [6][7]
- Annexe V of docs 03, 10, 12, 13, 14, 17, 18 holds Python verification code (docs/specs/verification/verify-annexes.py); evidence, not production code. [2]

## Verification
- `pnpm verify:fast` (72 turbo tasks) is the main gate; it starts PostgreSQL itself. `pnpm verify:gate` (scripts/verify-gate.sh, defined 2026-11-15, to be validated at G3) is the command of the QA gates and S5: verify:fast, test:xsd and the ubl-xades tests with PHIVE required (Java 21, `JAVA_HOME` exported because turbo does not pass it). For a cache-free run use `TURBO_FORCE=true pnpm verify:fast` (`-- --force` does not reach turbo). Cold runs take minutes (about 150 s at G1), so the 5 s target (B-08) is a target only. `scripts/harness-check.sh` must also exit 0. [3][4][5]
- On a 4 GB sandbox, parallel turbo runs can be killed (exit 137); use `--concurrency=1` or TURBO_CONCURRENCY=2. [4]
- The scope guard refuses changes to apps/api-hono/package.json other than adding a dependency; other changes go through a SEAM_REQUEST to the orchestrator. [3]
- Interrupted test runs can leave fisca_* PostgreSQL schemas behind; clean with DROP SCHEMA ... CASCADE. [3][4]
- Rules for validators, hashing and access are on [[fisca-engineering-rules]]; POS rules on [[fisca-pos-rules]].

## Branch protection and access
- All factory agents act on GitHub under the same account anasse84, and GitHub forbids approving one's own Pull Request. Protection of main must therefore require a Pull Request with 0 required approvals, with force-push and deletion blocked. [8]
- Human review is replaced by the QA auditor's gate (score ≥ 95/100); merging is reserved to Fisca-Lead-Orchestrator, by merge commit, never squash. [8][3]

## Open items
- Anasse protects main (not yet protected). [9][3]
- Anasse renews the GitHub token with the Workflows permission before wave 4 (expires 2026-12-12). [9][3]

## Related
- [[fisca]]: the product built in this repo.
- [[fisca-software-factory]]: the agents that work on it.
- [[fisca-engineering-rules]]: rules the code must follow.
- [[fisca-pos-rules]]: rules for `pos-pwa` and the POS sync server.
- [[fisca-chart-of-accounts]]: dataset kept in `marketing-astro`.

## Sources

| N | Type | Nom | Identifiants |
|---|---|---|---|
| 1 | memory | Saved memory by Anasse El Haji, Nov 12 | memoryId cmwczkh7r01wz06adjz2ip443 |
| 2 | memory | Saved memory by Anasse El Haji, Nov 13 | memoryId cmwelyx5e02j107ad4lsvws99 |
| 3 | document | "FISCA_STATE_AND_HANDOFF" by Anasse El Haji, v166, Nov 12 | documentId cmwczkgbj01nc07ad7i2cqcee, version cmwfkg2qb000908ad2tc0fc4g |
| 4 | document | "FISCA_STATE_AND_HANDOFF" by Anasse El Haji, v166, Nov 12 | documentId cmwczkgbj01nc07ad7i2cqcee, version cmwg7roxh026n07adbetdxa1d |
| 5 | manual_edit | Edit by Anasse El Haji via Fisca-Lead-Orchestrator, Nov 15 | threadId cmweubtfn067107ad0etaab1o |
| 6 | memory | Saved memory by Anasse El Haji, Nov 12 | memoryId cmwdcugei01fv07adovgg5pf0 |
| 7 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 14 9:32 PM | threadId cmweubtfn067107ad0etaab1o, message cmwgx9iki002x08adny5fv1y2 |
| 8 | memory | Saved memory by Anasse El Haji, Nov 12 | memoryId cmwdknhm002u907ad2nqe1zmh |
| 9 | document | "FISCA_STATE_AND_HANDOFF" by Anasse El Haji, v166, Nov 12 | documentId cmwczkgbj01nc07ad7i2cqcee, version cmwem4wk003f506ad2q0ysdsn |
