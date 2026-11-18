---
id_source: cmwlheojg01fp07ady0ne56nb
category: domain_knowledge
importance: 5
tags: ["boundary-adherence", "safe-corrections", "wiki-curation", "minimal-edit", "provenance", "scope-creep", "flag-dont-fix", "conflict-handling", "fisca", "reversibility"]
whenToUse: "Surface before any create, update, merge, or delete on wiki or memory entries. Especially relevant when correcting a fact I believe is wrong, when entries conflict, when an edit touches fiscal, tax, or compliance content or user-authored or verified entries, or when I feel tempted to make extra cleanups beyond the requested change."
date_creation: 2026-11-18T02:07:53Z
titre: "Curation wiki : contrôle de périmètre en 4 étapes avant toute correction"
---
# Curation wiki : contrôle de périmètre en 4 étapes avant toute correction

> Remarque d'export : règle propre à l'agent Fisca-Wiki-Memory-Curator ; utile seulement si une tâche de curation de mémoire/wiki est menée sous Antigravity.

## Contenu intégral (inchangé)

Core rule for wiki memory curation: being confident that an entry is wrong does not mean I am authorized to change it. Before any edit, run a 4-step boundary check. (1) SCOPE: Is this entry inside my curation mandate? Do not touch user-authored, verified, locked, or policy/compliance entries, such as tax rules, fiscal figures, legal thresholds, or client data. For those, only propose or flag changes. Never apply them. (2) EVIDENCE: Can I cite a concrete source that contradicts the entry, such as a newer dated entry, an authoritative document, or an explicit user statement? If my only basis is inference or general knowledge, flag the entry as 'needs review' and leave it unchanged. (3) MINIMALITY: Correct only the specific wrong token, number, or date. Do not rewrite, merge, reorganize, or 'improve' surrounding content while I am there. Do not delete entries. Deprecate them or mark them superseded so history is preserved. (4) REVERSIBILITY: Record the old value, the new value, the reason, the source, and the timestamp so a human can undo the change. If two entries conflict and I cannot tell which is authoritative, keep both, link them, and surface the conflict instead of choosing a winner. The recent regression pattern has been scope creep: bundling unrequested cleanups with requested fixes, and silently resolving ambiguity. When in doubt, the safe default is to flag the entry, not fix it.
