---
id_source: cmwlheiba01u207ad9ovixrnb
category: domain_knowledge
importance: 5
tags: ["reconciliation", "repo-memory-sync", "wiki-curation", "staleness", "verification", "provenance", "conflict-resolution", "fisca"]
whenToUse: "Surface whenever the task involves auditing, syncing, updating or curating wiki or memory entries against a codebase. This includes requests to 'reconcile', 'check if docs are current', 'clean up memory', or 'update the wiki after changes'. Use it before declaring any memory entry accurate."
date_creation: 2026-11-18T02:07:44Z
titre: "Curation wiki : réconcilier dépôt et mémoire par vérification des affirmations"
---
# Curation wiki : réconcilier dépôt et mémoire par vérification des affirmations

> Remarque d'export : règle propre à l'agent Fisca-Wiki-Memory-Curator (voir note ci-dessus).

## Contenu intégral (inchangé)

Reconciling repo and memory means checking each claim against evidence. Listing both sides is not enough. The judge feedback was truncated ('the reconciliation is...'), but declining scores point to shallow reconciliation: summarizing the wiki and the repo side by side without verifying, resolving and documenting differences. For each memory or wiki entry you touch:

1. Extract the concrete claims it makes: file paths, function or module names, config keys, env vars, versions, commands, architecture statements and ownership.
2. Verify each claim against the current repo. Open the file, grep the symbol, check package manifests, lockfiles and configs, and read recent git log or blame on the relevant paths. Do not infer from filenames or from the memory itself.
3. Label each claim with one status:
   - CONFIRMED, with the file:line or commit it was checked against.
   - STALE: it was true once but the code changed. Cite the commit or PR if findable.
   - CONTRADICTED: the repo says something different. Quote both.
   - UNVERIFIABLE: there is no evidence either way. Say what you searched.
   - MISSING: important repo facts that no memory covers.
4. Resolve each discrepancy explicitly. Update, deprecate, merge or delete the entry, and state why in one line. Never silently overwrite. Never leave two conflicting entries both active.
5. Check the other direction too, from repo to memory. Scan recently changed areas, new modules, renamed files and removed features for knowledge the wiki lacks.
6. Record provenance on updated entries: the source path or commit and a 'last verified' date, so future reconciliation is cheaper.
7. End with a reconciliation report giving counts per status, a list of changes made, and open questions that need a human.

Red flags that you are being shallow:
- Every entry is marked 'consistent'.
- There are no file or commit citations.
- The reconciliation only covers entries that were easy to check.
- Contradictions are noted but not acted on.
