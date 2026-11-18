---
id_source: cmwfo07v000g307adus75de4k
category: preference
importance: 5
tags: ["fisca", "errata", "precedence", "pilot", "conflict resolution", "rule priority", "hierarchy", "override", "contradiction", "agent names", "fisca-lead-orchestrator", "fisca-core-backend-fiscal", "auditor vs pilot", "remediation order", "verify fast", "relay order", "g1 complement", "spec disagreement"]
whenToUse: "When applying owner arbitrations, pilot relays, or G1 complements for Fisca, or when spec, owner document and ERRATA disagree"
date_creation: 2026-11-14T00:25:58Z
date_maj: 2026-11-14T00:26:00Z
titre: "ERRATA prime sur les arbitrages du propriétaire (version A)"
---
# ERRATA prime sur les arbitrages du propriétaire (version A)

## Contenu intégral (inchangé)

In Fisca, the ERRATA takes precedence over the owner's arbitration documents (q1, q2, etc.). Do not follow any owner passage that contradicts it. Examples: the auditor never merges, the pilot (Fisca-Lead-Orchestrator) does (A-03). S1B is stacked on S1A, so there is no parallel remediation (B-04). 'verify:fast under 5 s' is a target, not a pass condition (B-08). The real agent names are Fisca-Core-Backend-Fiscal etc. (A-01). Where the pilot's latest relay or complement differs from an earlier relay, the latest one wins.
