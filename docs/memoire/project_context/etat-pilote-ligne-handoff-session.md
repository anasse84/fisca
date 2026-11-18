---
id_source: cmwfnx2j800qi08ad22fcr8ot
category: project_context
importance: 5
tags: ["session handoff", "état pilote", "etat pilote line", "state maintenance", "orchestrator governance", "software factory", "handoff file", "STATE.md", "end of session checklist", "regression"]
whenToUse: "Surface at the start and end of every orchestrator or software-factory session. Also surface whenever writing or updating handoff, state, or status files, delegating work between agents, pausing or resuming a multi-session task, or when a judge mentions handoff, state maintenance, or the 'etat pilote line'."
date_creation: 2026-11-14T00:23:31Z
titre: "Handoff de session : ligne « État pilote » réécrite à chaque fin de session"
---
# Handoff de session : ligne « État pilote » réécrite à chaque fin de session

> Remarque d'export : formulée à partir de retours de « juges » d'évaluation Hyperagent ; le fond (réécrire la ligne « État pilote » en fin de session) reste utile.

## Contenu intégral (inchangé)

Orchestrator session handoff must include an explicit, current 'État pilote' line (pilot-state line). Judges repeatedly flag it as missing, stale, or vague, and handoff scores have been declining. The root cause is not missing work. It is that the canonical one-line state summary is not rewritten at the end of every session, so the next session or orchestrator cannot see at a glance where the factory stands.

Before ending ANY session:
(1) Open the state or handoff file (e.g. STATE.md, HANDOFF.md, or the orchestrator log).
(2) Rewrite the 'État pilote:' line near the top. Do not append a new one, and never leave an old one in place. Include:
- date/time
- current phase/milestone
- active agents or tasks and their status (done / in progress / blocked)
- blockers
- the single next concrete action and its owner.
Example: 'État pilote: 2025-01-14 18:00 | Phase 2 build | API agent done, UI agent in progress (60%), QA blocked on fixtures | Next: orchestrator unblocks QA fixtures'.
(3) Make sure the line matches the detailed sections below it. Contradictions count as failures.
(4) If the project's conventions are in French, keep the label 'État pilote' exactly. Do not translate or rename it.
(5) Treat skipping this line as a governance failure even when the task itself succeeded. If recent template or workflow changes removed the line, restore it.

At the START of a session: read the État pilote line first and resume from its 'Next' action before doing anything else.
