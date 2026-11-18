---
id_source: cmwfnzzzq00r608adorik2dbb
category: tools_and_workflows
importance: 4
tags: ["fisca", "turbo", "verify-fast", "ci", "uncached", "cache-bypass", "turbo_force", "cache", "monorepo", "environment-variable", "build-cache", "force-run", "invalidation", "cli-flags", "pnpm-script", "task-runner", "pass-through", "fresh-build"]
whenToUse: "When the pilot asks for complete or uncached verify:fast runs in anasse84/fisca"
date_creation: 2026-11-14T00:25:48Z
date_maj: 2026-11-14T00:25:50Z
titre: "verify:fast sans cache : TURBO_FORCE=true"
---
# verify:fast sans cache : TURBO_FORCE=true

## Contenu intégral (inchangé)

In the Fisca monorepo, `pnpm verify:fast -- --force` does not reach turbo: the flag goes to the last command in the chain, so the run stays cached. For a full uncached run, use `TURBO_FORCE=true pnpm verify:fast` and confirm the output shows 'Cached: 0 cached'.
