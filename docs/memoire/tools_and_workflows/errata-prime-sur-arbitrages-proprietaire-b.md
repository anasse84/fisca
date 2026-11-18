---
id_source: cmwfnzspi00pi07admfz2xrcz
category: tools_and_workflows
importance: 5
tags: ["fisca", "errata", "precedence", "owner-arbitration", "governance"]
whenToUse: "When applying owner (propriétaire) arbitration documents or pilot relays that cite them in Fisca sessions, especially on merging, branch stacking, verify:fast timing or agent names"
date_creation: 2026-11-14T00:25:38Z
titre: "ERRATA prime sur les arbitrages du propriétaire (version B, cas connus)"
---
# ERRATA prime sur les arbitrages du propriétaire (version B, cas connus)

## Contenu intégral (inchangé)

In Fisca, docs/specs/ERRATA.md outranks the owner's arbitration documents when they contradict each other. The pilot's standing instruction is to ignore any contradicting passage. The known cases are: (1) the auditor never merges; only Fisca-Lead-Orchestrator merges (A-03). (2) S1B is stacked on S1A, so remediation is never done 'in parallel' (B-04). (3) 'verify:fast under 5 s' is a target, not an acceptance condition (B-08). (4) Real agent names are Fisca-Core-Backend-Fiscal and the other registered agents (A-01). Owner arbitrations otherwise override the pilot's earlier relays where they differ.
