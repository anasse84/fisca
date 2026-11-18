---
id_source: cmwfo0d4p00lt07ad7bcsi16f
category: tools_and_workflows
importance: 4
tags: ["fisca", "qa-gate", "audit", "migrations", "workflow"]
whenToUse: "When reworking Fisca tickets returned to TODO by a QA gate verdict, or preparing a gate re-submission"
date_creation: 2026-11-14T00:26:05Z
titre: "Protocole de reprise après refus d'audit (red-first, migrations versionnées)"
---
# Protocole de reprise après refus d'audit (red-first, migrations versionnées)

## Contenu intégral (inchangé)

Fisca audit rework protocol, set by the pilot. A ticket refused by Fisca-QA-Security-Auditor is fixed with a red-first regression test that reproduces the auditor's case. It goes back to IN_REVIEW only when its review_notes cite that test and its initial failure. Never write in packages/qa-harness/src/adversarial, which belongs to the auditor; regression tests go in the session's own packages. Delivered migrations are never edited, and every fix ships as a new migration version. Before closing, the merged tree must pass three complete pnpm verify:fast runs with exit 0, with their outputs attached.
