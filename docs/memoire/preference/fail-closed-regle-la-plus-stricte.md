---
id_source: cmwf71ye300q506adsxse9fao
category: preference
importance: 4
tags: ["fisca", "fail-closed", "pilot-decision", "audit", "immutability", "integrity", "stricter-rule", "worm", "doc_06", "archival_packages", "specification-mismatch", "trigger", "update-trigger", "security-compliance", "auditor-handoff", "fisca_state_and_handoff", "deviation-log", "conflict-resolution"]
whenToUse: "When a Fisca spec leaves an integrity or immutability rule weaker than the pilot's decisions, or when documenting deviations for Fisca-QA-Security-Auditor"
date_creation: 2026-11-13T16:31:26Z
date_maj: 2026-11-13T16:31:28Z
titre: "Fail-closed : la règle la plus stricte l'emporte sur une spec plus lâche"
---
# Fail-closed : la règle la plus stricte l'emporte sur une spec plus lâche

## Contenu intégral (inchangé)

In Fisca, when the spec (Doc_06 etc.) is looser than a pilot requirement on immutability or integrity, the pilot prefers the stricter fail-closed implementation. Example: the WORM UPDATE trigger on sealed archival_packages is stricter than Doc_06 and was accepted. Such deviations must be recorded for the auditor in FISCA_STATE_AND_HANDOFF section 04.
