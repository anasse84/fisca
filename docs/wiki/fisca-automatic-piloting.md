---
id: cmweonzh4052y07ad7okpgwnv
slug: fisca-automatic-piloting
title: Fisca automatic piloting
pageType: process / orchestration
agentOwned: true (agent cmwd16s59001608ad483t5wwv, Fisca-Lead-Orchestrator)
version: 5
updatedAt: 2026-11-15T23:06:15.569Z
url: https://hyperagent.com/wiki/agents/cmwd16s59001608ad483t5wwv/fisca-automatic-piloting
---

# Fisca automatic piloting

**Résumé.** How the Fisca-Lead-Orchestrator launches and resumes automatic piloting of the Fisca build lanes, and which documents win when instructions conflict.

## Texte complet

Automatic piloting is the mode in which Fisca-Lead-Orchestrator drives the build lanes of the [[fisca-software-factory]] project. (Steps below beyond launch/resume were inferred from the pilot's thread.)

## Launch, resume and stop
- Launch: the owner sends the message « PILOTAGE AUTOMATIQUE FISCA — DÉMARRAGE » to Fisca-Lead-Orchestrator, which then becomes the pilot of the lanes (voies). [1]
- Resume: the message « CONTINUE » restarts it. [1]
- Each lane thread (BACK-1, BACK-2, EDI-1, EDI-2, FRONT-1, FRONT-2, AUDIT) and the pilot thread need their own approval for registry.npmjs.org; lanes resume on their own once approved. [2]
- Stop rule: when the owner says to stop after a wave, the pilot stops there; the next wave and any junction ticket (such as J2) start only on the owner's express authorisation. [3][4]

## Loop
- The pilot runs a "tick" (pilot-status.mjs) that prints the exact next order (PILOT_SESSION, DISPATCH, RELAY, GATE); it sends dispatch, relay and gate messages to the lane threads as printed, then decides lane questions from the specs and ERRATA. [5]
- Each pilot message ends with a status line « ETAT PILOTE : n/132 DONE — vague — voies en cours — à trancher », listing the owner's open questions. [6]
- Lanes must never use `replace` on a shared section of the state document (section 02 was once wiped, then restored). [7]

## Merge procedure
- Merge by merge commit, never squash, pinning the full audited head SHA (a short SHA gives a 409). After merging, check in git that the branch is an ancestor of origin/main and run verify:fast on main. [8]
- Branch names must start with feat/ or fix/: the branch guard refuses docs/… (rename and recommit), including for documentation-only work. [9]
- A PR whose base is the stacked parent branch (S1B on S1A) merges into that branch, not main; a catch-up PR to main is then required. [10]
- verify:fast starts PostgreSQL itself (with a lock so only one start happens); before this, main looked red on lanes that had not launched with --postgres. [10]
- Merging several lanes together: merge origin/main into the last branch and regenerate pnpm-lock.yaml (it conflicts between lanes); the scope guard and pre-commit hook apply one lane's scope, so run them in pilot mode for the combined merge. [11]
- Run verify:fast one task at a time: the sandbox has 4 GB of memory. [12]
- If a gate's round 1 is unfavourable, the faulty tickets go back to their lane and round 2 re-audits only what changed. [13][14]

## Delegating documentation alignment to sub-agents
- Sub-agents get disjoint files and read-only git; their partial edits stay on the unmerged branch docs/w2-alignment and the pilot reviews them before any commit. [15]
- When they return: consolidate ERRATA (revision e), commit, run verify:fast and the annex check, open and merge the PR; then update the state document, the wiki, the skills (as drafts for the owner to validate) and stale memories. Wave 3 and J2 stay unlaunched. [15]
- Fallback if sub-agents fail again (e.g. a 402 on the plan's credit): the pilot does the essentials itself in this order: ERRATA consolidation, fixes of the most serious spec contradictions, then the preparation files. [15]
- Skill updates reach the owner as skill-config drafts: dated additions appended without touching existing text, plus file-only drafts that refresh stale attached copies (e.g. fisca-factory-runbook's session-scopes.json, barrieres-qa.md, pilotage-automatique.md, pilot-status.mjs). Nothing applies until the owner saves each draft; the pilot then checks that both drafts of a skill landed. [16]
- Preparation files for the next waves live in docs/orchestration/: preparation-vague-3.md, preparation-vague-4.md, preparation-s5-release.md and prerequis-proprietaire.md (owner prerequisites with deadlines and fallbacks); pointers to them are written in the notes of the key backlog tickets so lanes see them at their first ticket. [16]

## Source-of-truth rule
- When docs/orchestration/pilotage-automatique.md or docs/specs/ERRATA.md (on main of the [[fisca-monorepo]]) differ from the skills fisca-factory-runbook or fisca-harness-gatekeeper, the repository files take precedence. [1]
- Applies at launch or resumption of automatic piloting, and whenever a Fisca skill contradicts a document in docs/orchestration/ or ERRATA.md. [1]
- Owner arbitrations go to ERRATA (D-22, D-23) and section 04 of the state document; the repo Markdown, not the original DOCX, is the reference for specs. [17][18]

## Instructions for the next waves
- Batch visa route (to wire in a junction or P4-A): POST /api/v1/ledger/cycles/:cycleCode/visa with body { fiscalYearId, entryDateUpTo?, expectedEntryIds? }; 409 CYCLE_ENTRIES_DRIFT or NO_ELIGIBLE_DRAFT_IN_CYCLE; the unit route POST /api/v1/ledger/entries/:id/visa stays. [3]
- Clearance retries: 1 initial send + 8 retries = 9 attempts within 6 h, from SIGNEE_LOI_43_20; tenant migration v12 adds EN_ATTENTE_XHUB and ECHEC_TECHNIQUE_XHUB to the clearance_state CHECK. [3]
- P3-A: if the official DGI .xsd files are missing, EDI-1 does not block but writes strict structural XSDs from Doc_07 §§ 08–10, validated by xmllint and marked PROVISIONAL_STRUCTURAL_XSD_PENDING_OFFICIAL_DGI_PACK, never claiming DGI approval. [3]
- Briefs of P3-A and P4 must require the production chart of accounts to set vat_regime_role (34551 = VAT_RECOVERABLE_IMMOB, 34552 = VAT_RECOVERABLE_CHARGES). [19]

## Open items
- Owner: authorise wave 3 and the J2 junction ticket (BACK-1: migration v12, ESC_POS_TCP_IP CHECK on pos_paired_peripherals, InvoiceSequencerDO 45-character genesis, P2-A junction requests). [12]
- Pilot, before G3: idempotency responses are stored as unencrypted base64; before G4: POS expected closing cash is kept in clear in local storage. [12]
- Owner: native review of translations and amounts in letters (T-S5-03). [12]

## Related
- [[fisca-software-factory]]: the project this mode drives.
- [[fisca-monorepo]]: holds the governing documents on main.
- [[fisca-engineering-rules]]: the rules the pilot applies when it decides lane questions.
- [[anasse-el-haji]]: owner who launches, resumes and stops the piloting.

## Sources

Tous les fils ci-dessous : threadId `cmweubtfn067107ad0etaab1o` (Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji) sauf mention contraire.

| N | Type | Nom / date | Identifiants |
|---|---|---|---|
| 1 | memory | Saved memory by Anasse El Haji, Nov 13 | memoryId cmwemxq8p028f07adlb1en630 |
| 2 | thread | Nov 13 10:35 AM | messages cmweuccgm04uz07adv7npm5np |
| 3 | thread | Nov 14 7:35 AM | message cmwg3d3y400q807ad6r3vj58y |
| 4 | thread | Nov 14 7:57 AM | message cmwg451ci013y07admwhcv0h7 |
| 5 | thread | Nov 13 11:07 AM | message cmwevhbz7045p07ad3jzdl6eb |
| 6 | thread | Nov 13 11:14 PM | message cmwflgmw100q807ada540376j |
| 7 | thread | Nov 13 11:16 PM | message cmwflivwg009k08adppsi8t9w |
| 8 | thread | Nov 13 11:24 AM | message cmwew3o6s058207adabitem5g |
| 9 | thread | Nov 15 1:22 AM | message cmwh5gs4600ju07advh0iknzm |
| 10 | thread | Nov 13 9:59 PM | message cmwfir8kx00o907adlx8omguq |
| 11 | thread | Nov 14 9:28 AM | messages cmwg7dddx023l06adr8vu74ff → cmwg7png501mw07ad02af44po |
| 12 | thread | Nov 14 9:39 AM | message cmwg7ry0102de07adm7j4ttmg |
| 13 | thread | Nov 14 9:07 AM | message cmwg6n3vv017m08ad4bxcvazz |
| 14 | thread | Nov 14 9:16 AM | message cmwg6y0e901da07adblxak8h7 |
| 15 | thread | Nov 15 12:50 AM | message cmwh4bnmx00gz07adys3176no |
| 16 | thread | Nov 15 1:20 AM | messages cmwh5ekx500lb06adb61s36fq → cmwh68ldo00vg07adh5yp0yuw |
| 17 | thread | Nov 14 7:37 AM | message cmwg3f35j013h07adxecnpqf8 |
| 18 | thread | Nov 14 9:32 PM | message cmwgx9iki002x08adny5fv1y2 |
| 19 | thread | Nov 14 7:59 AM | message cmwg47fja00r407ad2vr8860w |
