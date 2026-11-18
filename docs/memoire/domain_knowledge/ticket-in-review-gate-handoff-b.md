---
id_source: cmwg77z3n01bo07adtjrnv4qn
category: domain_knowledge
importance: 5
tags: ["ticket-lifecycle", "in_review", "handoff", "status-transition", "pr-link", "acceptance-criteria", "reviewer-assignment", "evidence", "mobile", "frontend", "governance"]
whenToUse: "Surface whenever changing a ticket's status, especially moving to in_review or done. Also surface when finishing a frontend or mobile task, writing a handoff or completion comment, responding to review feedback, or when work is blocked or partially done and you are tempted to change its status."
date_creation: 2026-11-14T09:23:53Z
titre: "Ticket → in_review : contrat de handoff (version B, relecteur nommé)"
---
# Ticket → in_review : contrat de handoff (version B, relecteur nommé)

## Contenu intégral (inchangé)

Ticket lifecycle governance for Fisca frontend/mobile growth work. The recurring failure is moving a ticket to in_review while the handoff is incomplete or missing. A status change is a handoff contract, not a progress note. Before transitioning any ticket to in_review, satisfy this gate:
(1) The work is actually complete against every acceptance criterion. Do not use in_review as a placeholder for partial work or for 'blocked, need help'. Use blocked or in_progress with a comment for those.
(2) Link the PR/branch/commit in the ticket.
(3) Post a structured handoff comment:
- What changed and why
- Files and areas touched
- How to test, with exact steps
- Evidence: screenshots or recordings for UI on web plus iOS and Android where relevant, test and lint results, analytics/experiment event verification for growth features
- Known limitations and follow-ups
- Feature flag or rollout state
(4) Assign or tag a named reviewer or owner.
(5) Keep states sequential: todo → in_progress → in_review → done. Never skip states, never self-move to done without reviewer approval, and never silently revert.
(6) If review requests changes, move the ticket back to in_progress, address the feedback, and re-post an updated handoff before returning it to in_review.
Always transition status in the same action as the evidence comment, never before it. Final check: 'Could a reviewer verify this ticket without asking me anything?' If not, the ticket is not ready for in_review.
