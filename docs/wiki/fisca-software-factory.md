---
id: cmwd2itj3006x07ad2eie374r
slug: fisca-software-factory
title: Fisca software factory
pageType: project / build
version: 9
updatedAt: 2026-11-15T23:07:02.380Z
url: https://hyperagent.com/wiki/fisca-software-factory
---

# Fisca software factory

**Résumé.** The project of building Fisca with a team of specialised AI agents coordinated by an orchestrator, owned by Anasse El Haji.

## Texte complet

Goal: build [[fisca]] in the [[fisca-monorepo]] with six specialised agents (orchestrator, backend, containers/EDI, frontend, QA auditor, wiki curator). Owner: [[anasse-el-haji]]. It is open-ended and was set up on 2026-11-12. [1]

## As of 2026-11-15
- Waves 0, 1 and 2 are finished, audited and merged on main (66 of 132 tickets DONE); gate G2 passed on round 2 after round 1 failed on a POS client hash mismatch. [2][3][4]
- The pilot is stopped on the owner's instruction: wave 3 and the junction ticket J2 start only on his express authorisation. Resume by reading docs/orchestration/prerequis-proprietaire.md and preparation-vague-3.md, then sending `CONTINUE` with the decision. [2][5][3]
- Post-G2 junctions are proposed as ticket "J2" for BACK-1 before P3-A: tenant migration v12 (clearance_state CHECK with EN_ATTENTE_XHUB and ECHEC_TECHNIQUE_XHUB), ESC_POS_TCP_IP in pos_paired_peripherals, InvoiceSequencerDO aligned on the 45-char genesis, DgiClearanceWorkflow re-export and its queue, encrypted idempotency responses, EDI_EXPORT permission. [2][6][4]
- Waiting on the owner: protect main (PR required, 0 approvals) and renew the GitHub token with the Workflows permission before wave 4 (expires 2026-12-12). [7][5]
- Official DGI and xHub schemas are still unpublished; no ticket waits for them. [7]

## Setup
- State document FISCA_STATE_AND_HANDOFF, 5 sections: current wave status, active branches and locks (mirrors locked_by_branch), completed checkpoints, circuit-breaker blockers (task failed 3 times on the same error), QA gate verdicts (written by the auditor). [8]
- Agents: Fisca-Lead-Orchestrator (backlog, delegation, merges to main itself after audit), Fisca-Core-Backend-Fiscal (apps/api-hono; also P4-C), Fisca-Containers-EDI-ERP, Fisca-Frontend-Mobile-Growth, Fisca-QA-Security-Auditor (read-only, ends each report with a VERDICT line, acceptance threshold 95/100 on each rubric R1–R3), Fisca-Wiki-Memory-Curator (nightly 04:00 Casablanca check against the repo). Spec documents use other agent names; the real agents apply. [9][1]
- Lanes: PILOTE, BACK-1/2, EDI-1/2, FRONT-1/2 and AUDIT, each a thread of the matching agent. Auto-pilot is launched and resumed with the single message of docs/orchestration/pilotage-automatique.md § 8, then `CONTINUE`. [7][3]
- 132 tickets in 17 sessions (S0, S1A, S1B, G1, P2-A/B/C, G2, P3-A/B/C, G3, P4-A/B/C, G4, S5). A dependency is satisfied if DONE, or IN_REVIEW with its commit in the branch; an audit refusal returns the ticket to TODO with review_notes; a gate ticket is DONE only once its merge is seen in git. Waves merge in dependency order (P2-A before P2-B before P2-C). [9][7][2]
- Merges are by merge commit, never squash; only the orchestrator merges, after a favourable audit. [7]
- Specs: docs/specs/ERRATA.md (revision e) prevails over the specs, and the repo prevails over skills. Each session reads only the 3–5 specs of its row in the session matrix. The specs were aligned with waves 0–2 on 2026-11-15 (PR n° 26: amendment journals, ADR-13 to ADR-22), and preparation files for waves 3, 4 and S5 plus the owner-prerequisites table were added under docs/orchestration/; the repo Markdown is the reference and the original DOCX are untouched. [10][3][11][6][3]
- Annexe V (docs 03, 10, 12, 13, 14, 17, 18) holds owner-supplied Python numeric checks, re-runnable with docs/specs/verification/verify-annexes.py (13 identical blocks); supporting evidence only. [3][3]
- Models: every agent runs on Claude Sonnet 5.5 in Manual mode; GLM 5.3 and Auto "Low cost" are excluded (GLM failed table writes). A cheaper model only after a qualification test. [12][13]
- Cost: about 331 $ spent by 2026-11-14; estimate 370–690 $ more to gate G4 (700–1000 $ total), not a quote. The owner is weighing moving the loop to the Antigravity CLI; nothing decided. [14][15]
- GitHub policy: feat/* and fix/* branches, merge to main reserved to the orchestrator, no repo deletion or force-push; all agents share the account anasse84 (see [[fisca-monorepo]]). [1][16]
- Sandbox: pnpm, node, git and xmllint preinstalled; java and dotnet at bootstrap. The network filter blocks registry.npmjs.org per thread until the user approves, so request npm access at the start of each session; never use an npm mirror. [13][17]

## Provisional e-invoicing regime
- The decree implementing art. 145-IX CGI is unpublished and neither DGI nor xHub has released a spec. Not a blocker (ERRATA B-13 revised): validate against OASIS UBL 2.1 + EN 16931, keep Moroccan rules in the replaceable profile cius-ma-provisional, mark contracts PROVISIONAL, run the ClearanceGateway as a simulated pilot. [18]
- Known PHIVE deviations (BR-CL-10, BR-CL-11, BR-CO-09, BR-CL-24) are asserted by test; debit note 383 is emitted as an Invoice of type 383; FISCA_REQUIRE_PHIVE=1 is required in CI and at gates. [7]
- Forbidden: presenting a provisional schema as official, writing "conforme/homologué DGI", coding a reform date or threshold. [18]

## Known gaps in the plan (found while preparing waves 3, 4 and S5)
- Wave 3: no EDI export permission exists; the "5 operators" of the SIMPL-IS DSL are named in no spec; the table of 1,500+ SIMPL-IS cells exists nowhere; the DGI EDI specifications announced by the owner have not arrived. [5]
- Wave 4: nothing explains how a Worker opens the D1 database of a company created at runtime (architecture spike at the head of P4-C); PME, mandate and pairing routes have no owner in the backlog; the subscription tables of Doc_03 § 10 don't exist and P4-B does not cover their schema; the POS reserves have no session. [5]
- S5 (release v1.0.0): the signing key of the tag and the SBOM key are undefined, and three Go-Live points require real hardware or accounts. [5]
- Reserves open before G3: idempotency responses stored as unencrypted base64 (invoice and POS routes); before P3-B: harden the ICE scrubber and the injection filter; before G4: `expected_closing_cash_cents` in clear in the OPFS. [4]

## Known issues
- `pnpm verify:gate` was cited by 16 gate tickets but did not exist; since 2026-11-15 it is defined by scripts/verify-gate.sh (verify:fast, test:xsd, ubl-xades tests with FISCA_REQUIRE_PHIVE=1, Java 21; option --browser adds the OPFS proof and Lighthouse). The Java part was not run in the pilot's sandbox (no Java): validate at G3. [6][3]
- Sub-agent runs fail with a 402 when the plan's prepaid credit is used up; the pilot then does the work itself and says so to the owner. [6][4]

## Open items (owner decisions awaited)
- Anasse: authorise J2, then wave 3. [5]
- Anasse: drop the DGI EDI specs in docs/reference/dgi/ or accept provisional XSDs; drop the official DGI/xHub schemas there when published. [5][18]
- Anasse: decide D1 per company, a P4-D session for PME/mandate routes, and `expected_closing_cash_cents`. [5]
- Anasse: confirm the 61-account set (his message announced 60). [5]
- Anasse: protect main; renew the GitHub token with the Workflows permission before 2026-12-12. [7][5]
- Anasse: validate the skill and agent cards (17 skill drafts await his Save click), fix the agent prompts and set run-time limits; the auditor uses the v2 rubrics R1–R3. [1][19][4]
- Anasse: have the ar/ary translations and amounts in words reviewed by native speakers. [2][5]

## Related
- [[fisca]], [[fisca-monorepo]], [[anasse-el-haji]]
- [[fisca-engineering-rules]]: integrity and validation rules set during the build.
- [[fisca-pos-rules]]: POS rules decided in wave 2.
- [[fisca-chart-of-accounts]]: account mapping and the site dataset.

## Sources

| N | Type | Nom | Identifiants |
|---|---|---|---|
| 1 | thread | Thread started by Anasse El Haji, Nov 12 | threadId cmwcz46ow02jh07ad5hd5dkpj, messages cmwcz4a9201qn08admc3gw2dh → cmwd054g3011g07adx1xq3uxu |
| 2 | document | "FISCA_STATE_AND_HANDOFF" by Anasse El Haji, v166, Nov 12 | documentId cmwczkgbj01nc07ad7i2cqcee, version cmwg7roxh026n07adbetdxa1d |
| 3 | memory | Saved memory by Anasse El Haji, Nov 13 | memoryId cmwelyx5e02j107ad4lsvws99 |
| 4 | document | "FISCA_STATE_AND_HANDOFF" by Anasse El Haji, v166, Nov 12 | documentId cmwczkgbj01nc07ad7i2cqcee, version cmwhb734g00i307adwixami2s |
| 5 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 13 | threadId cmweubtfn067107ad0etaab1o |
| 6 | manual_edit | Edit by Anasse El Haji via Fisca-Lead-Orchestrator, Nov 15 | threadId cmweubtfn067107ad0etaab1o |
| 7 | document | "FISCA_STATE_AND_HANDOFF" by Anasse El Haji, v166, Nov 12 | documentId cmwczkgbj01nc07ad7i2cqcee, version cmwfkg2qb000908ad2tc0fc4g |
| 8 | document | "FISCA_STATE_AND_HANDOFF" by Anasse El Haji, v166, Nov 12 | documentId cmwczkgbj01nc07ad7i2cqcee, version cmwem4wk003f506ad2q0ysdsn |
| 9 | memory | Saved memory by Anasse El Haji, Nov 13 | memoryId cmwegzl88023706adf92snrso |
| 10 | memory | Saved memory by Anasse El Haji, Nov 12 | memoryId cmwdcugei01fv07adovgg5pf0 |
| 11 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 14 9:29 PM | threadId cmweubtfn067107ad0etaab1o, message cmwgx5dsr002w08adkkdwf7sn |
| 12 | memory | Saved memory by Anasse El Haji, Nov 12 | memoryId cmwdj6vsx023007adkev1d2ol |
| 13 | document | "FISCA_STATE_AND_HANDOFF" by Anasse El Haji, v166, Nov 12 | documentId cmwczkgbj01nc07ad7i2cqcee, version cmwdixjnm033v07ad8nskbxes |
| 14 | thread | Thread started by Anasse El Haji, Nov 14 3:07 AM | threadId cmwefsofj00sc07ad6nt99wu0, message cmwftrzop018q07adetut8qlq |
| 15 | thread | Thread started by Anasse El Haji, Nov 14 3:18 AM | threadId cmwefsofj00sc07ad6nt99wu0, message cmwfu5yt501nk09adf8ltm45u |
| 16 | memory | Saved memory by Anasse El Haji, Nov 12 | memoryId cmwdknhm002u907ad2nqe1zmh |
| 17 | memory | Saved memory by Anasse El Haji, Nov 12 | memoryId cmwdk1ipd02nt07ad433dmcsa |
| 18 | memory | Saved memory by Anasse El Haji, Nov 13 | memoryId cmwegzmm002qo07addhyzf8oe |
| 19 | thread | Thread started by Anasse El Haji, Nov 13 3:48 AM | threadId cmwefsofj00sc07ad6nt99wu0, messages cmwefssxt01bh07adn1e68zwn → cmwem94pn02u106adbl0mliis |
