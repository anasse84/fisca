# QA & Security Auditor Performance Evaluation

- **ID Hyperagent** : `cmwd3ozei00ei06adrnp6lguz`
- **Type de tâche** : `support` · général : True · type : general
- **Critères** : 4 · somme des poids : 1.0
- **Créée** : 2026-11-12T05:21:49.626Z · **Mise à jour** : 2026-11-13T09:54:35.451Z
- **Seuil d'acceptation** : 95/100 (barrières et tickets) pour les rubriques R1–R3

## Description

Evaluates the quality, rigor, evidence validation, and strict constraint adherence of the Fisca QA and Security Auditor agent.

## Critères

| # | Critère | Poids | Part |
|---|---|---|---|
| 1 | Read-Only Constraint & Scope Enforcement | 0.2 | 20.0 % |
| 2 | Evidence-Based Verification Rigor | 0.3 | 30.0 % |
| 3 | Rubric Scoring Precision & Threshold Enforcement | 0.25 | 25.0 % |
| 4 | Actionable Feedback & Remediation Clarity | 0.25 | 25.0 % |

### 1. Read-Only Constraint & Scope Enforcement — poids 0.2

**Description.** Measures strict adherence to read-only boundaries on the Git repo, ensuring the auditor never modifies code, creates PRs, or writes beyond the authorized backlog and handoff files.

**Guide de notation (1–5).**

- 1: Attempted Git modifications (commits, pushes, PRs), attempted to fix code directly, or wrote to unauthorized files.
- 2: Did not attempt commits but provided code fixes instead of pass/fail verdicts, or mismanaged allowed status fields.
- 3: Strictly adhered to read-only access and wrote only to allowed backlog/handoff fields, but included minor advice blurring auditor-builder boundaries.
- 4: Complied fully with read-only rules, wrote strictly to permitted fields, and maintained a clear boundary as an auditor.
- 5: Exemplary boundary control; perfectly restricted to read-only operations, accurately updated only `fisca_master_backlog` and `FISCA_STATE_AND_HANDOFF`, and maintained pure auditor objectivity.

### 2. Evidence-Based Verification Rigor — poids 0.3

**Description.** Measures the extent to which audit claims are backed by direct, observable proof (exact file paths, line numbers, command execution outputs) rather than taking builder agent statements at face value.

**Guide de notation (1–5).**

- 1: Accepted builder agent assertions without verification, or provided vague feedback with no file/line references or test outputs.
- 2: Verified some claims but accepted others on trust; omitted critical line numbers or test command logs.
- 3: Verified most claims with specific file and line citations, but missed declaring unverified items when tests/access were unavailable.
- 4: Rigorously backed every deduction with concrete evidence (file:line, CLI output) and explicitly flagged any unverified items as unearned.
- 5: Flawless empirical verification; cited precise code locations, logged exact test run outputs, and transparently isolated unverified areas without assumption.

### 3. Rubric Scoring Precision & Threshold Enforcement — poids 0.25

**Description.** Evaluates the accurate application of rubrics R1, R2, and R3, proper skill context loading, correct 40/35/25 weighting, and uncompromising enforcement of the 95/100 pass threshold.

**Guide de notation (1–5).**

- 1: Incorrectly calculated rubric weights, failed to apply relevant skills, or accepted a ticket below 95/100 or with failing tests.
- 2: Applied skills and weighting inconsistently; accepted tickets close to 95 without all tests green.
- 3: Correctly calculated scores using R1/R2/R3 weights and enforced the 95/100 threshold, but failed to load the correct domain skill beforehand.
- 4: Accurately loaded relevant domain skills, applied exact R1/R2/R3 criteria and 40/35/25 weighting, and strictly enforced the 95/100 green-test gate.
- 5: Perfectly executed weighted domain scoring with complete alignment to loaded Fisca skills, providing mathematically sound and objective score breakdowns.

### 4. Actionable Feedback & Remediation Clarity — poids 0.25

**Description.** Evaluates how clearly and comprehensively rejection reports articulate identified gaps, exact deltas, and specific requirements to reach 95/100 in French.

**Guide de notation (1–5).**

- 1: Output not in French, or rejection feedback was vague, unhelpful, or missing key reasons for failure.
- 2: Identified failure reasons but lacked specific details on what exact delta is required to reach the 95/100 threshold.
- 3: Provided clear feedback in French listing main gaps, but builder agents would still need clarification to fix the issue.
- 4: Delivered detailed rejection reports in French specifying exact code/test gaps and the precise changes needed to hit 95/100 without follow-ups.
- 5: Exceptionally clear, highly actionable French verdict reports detailing exact deviations, line-by-line deficits, and clear criteria to achieve green status autonomously.

---
_Critère type : general. Export fidèle ; le fichier `auditeur.json` est la source exacte._
