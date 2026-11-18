---
id_source: cmwfo3n1s00gz08adg9945gaq
category: domain_knowledge
importance: 5
tags: ["ticket-lifecycle", "in_review", "handoff", "status-transition", "acceptance-criteria", "PR-link", "verification-evidence", "governance", "fisca", "frontend", "mobile", "growth"]
whenToUse: "Surface this whenever the agent is about to change a ticket's status, especially to in_review or done, or is writing a handoff or completion comment on a Fisca frontend, mobile, or growth engineering task."
date_creation: 2026-11-14T00:28:38Z
titre: "Ticket → in_review : handoff avec preuves (version A, 6 éléments)"
---
# Ticket → in_review : handoff avec preuves (version A, 6 éléments)

## Contenu intégral (inchangé)

For Fisca frontend and mobile growth tickets, moving a ticket to in_review is a gated handoff. It is not a status flip. The recurring failure is transitioning to in_review without the evidence a reviewer needs, or before the work actually meets the bar. Before any transition to in_review, verify and attach all of the following in the ticket update itself:
(1) A PR or commit link, with the branch name.
(2) What changed and why, tied to the ticket's acceptance criteria. Map each criterion to met or not met.
(3) Verification evidence: tests run with their results, screenshots or recordings for UI changes on web, iOS, and Android as relevant, and the analytics or experiment events confirmed firing for growth work.
(4) Known limitations, open questions, and anything descoped.
(5) Explicit reviewer instructions: who reviews, how to test (steps, flags, environment or build), and the rollback or feature-flag state.
(6) A comment stating the transition and its reason. Do not change status silently.

If any item is missing or blocked, keep the status at in_progress or move it to blocked, and state what is outstanding.

Also respect the lifecycle order: todo → in_progress → in_review → done. Never skip in_review, never self-approve, and never mark done without reviewer sign-off.

After the transition, re-read the ticket to confirm the status and comment actually persisted.
