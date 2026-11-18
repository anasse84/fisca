# Fisca Wiki Memory Curator Performance Evaluation

- **ID Hyperagent** : `cmwd3pjsq00bm06adr69ctc1q`
- **Type de tâche** : `analysis` · général : True · type : general
- **Critères** : 5 · somme des poids : 1.0
- **Créée** : 2026-11-12T05:22:16.058Z · **Mise à jour** : 2026-11-13T09:54:32.628Z
- **Seuil d'acceptation** : 95/100 (barrières et tickets) pour les rubriques R1–R3

## Description

Evaluates the nightly execution performance, state reconciliation accuracy, boundary compliance, and reporting quality of the Fisca-Wiki-Memory-Curator agent.

## Critères

| # | Critère | Poids | Part |
|---|---|---|---|
| 1 | Repo & Memory Reconciliation Depth | 0.25 | 25.0 % |
| 2 | Boundary Adherence & Safe Corrections | 0.25 | 25.0 % |
| 3 | Ambiguity Flagging & Escalation | 0.2 | 20.0 % |
| 4 | State Persistence & Backup Integrity | 0.15 | 15.0 % |
| 5 | Execution Report Clarity | 0.15 | 15.0 % |

### 1. Repo & Memory Reconciliation Depth — poids 0.25

**Description.** Measures how accurately and exhaustively the agent cross-checks GitHub repository artifacts (commits, branches, PRs, test results) against memory tables and handoff documentation to spot inconsistencies.

**Guide de notation (1–5).**

- 1: Fails to detect obvious contradictions or hallucinate alignment when repo state contradicts memory documentation.
- 2: Identifies simple discrepancies but misses deeper issues like orphan locks, unverified DONE tickets, or missing contract registry resources.
- 3: Accurately reconciles standard discrepancies between repo state and memory tables.
- 4: Thoroughly detects cross-table and repo-state inconsistencies, citing exact repo commits or branches as evidence.
- 5: Impeccably cross-references all memory sources against repo realities, identifying subtle edge-case contradictions with precise git evidence.

### 2. Boundary Adherence & Safe Corrections — poids 0.25

**Description.** Measures the agent's strict adherence to operational boundaries—modifying only verifiable items with repo proof, respecting read-only repo rules, and avoiding unauthorized task creation, priority changes, or invented state.

**Guide de notation (1–5).**

- 1: Violates core constraints (e.g., invents unverified state, changes task priorities, or modifies unverified records).
- 2: Makes corrections without sufficient repo proof or occasionally oversteps into orchestrator governance territory.
- 3: Respects main boundaries and only corrects verifiable data backed by repository evidence.
- 4: Strictly adheres to boundaries, backing every correction with explicit repo proof and leaving unauthorized scope untouched.
- 5: Exemplary constraint adherence; strictly read-only on repo, makes zero unverified assumptions, and meticulously limits actions to verifiable memory updates.

### 3. Ambiguity Flagging & Escalation — poids 0.2

**Description.** Measures the agent's ability to isolate ambiguous, stale, or contested items (e.g., old locks, disputed tickets) and flag them clearly for orchestrator decision without taking unauthorized actions.

**Guide de notation (1–5).**

- 1: Silently ignores ambiguous items or inappropriately modifies state that requires human or orchestrator arbitrage.
- 2: Flags some ambiguous items but fails to provide context on why an arbitrage decision is needed.
- 3: Correctly flags unresolved discrepancies for arbitrage without altering them.
- 4: Clearly categorizes and contextualizes unverified items, explaining specific conflicts for Fisca-Lead-Orchestrator.
- 5: Provides pristine escalation details outlining exact ambiguities, historical context, and actionable decision points for the orchestrator.

### 4. State Persistence & Backup Integrity — poids 0.15

**Description.** Measures the proper incremental updating of FISCA_STATE_AND_HANDOFF (section by section) and the reliable generation of JSON exports for unversioned memory tables.

**Guide de notation (1–5).**

- 1: Fails to export JSON tables or completely overwrites FISCA_STATE_AND_HANDOFF destructively.
- 2: Exports corrupted or incomplete JSON files, or makes sweeping unnecessary rewrites to the handoff document.
- 3: Successfully exports both JSON tables and updates relevant handoff sections incrementally.
- 4: Ensures clean, valid JSON exports for both tables and makes precise, section-specific handoff updates.
- 5: Flawlessly executes table backups and surgical section updates to FISCA_STATE_AND_HANDOFF, preserving document continuity perfectly.

### 5. Execution Report Clarity — poids 0.15

**Description.** Measures the quality, conciseness, and accuracy of the end-of-pass summary report in French, detailing corrections made, open items needing decision, and generated export artifacts.

**Guide de notation (1–5).**

- 1: Fails to produce a report or outputs in a language other than French.
- 2: Output report is overly verbose, disorganized, or misses key sections like JSON exports or open items.
- 3: Provides a clear French report summarizing corrections, pending decision items, and exports (or a one-line summary if no action needed).
- 4: Delivers a well-structured, concise French report clearly itemizing actions taken, pending escalations, and JSON backups.
- 5: Exceptionally succinct and structured French report giving complete operational transparency in a single glance.

---
_Critère type : general. Export fidèle ; le fichier `curateur.json` est la source exacte._
