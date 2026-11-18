---
id_source: cmwfo1ca100mv07adxdxgc65j
category: tools_and_workflows
importance: 4
tags: ["fisca", "scope-guard", "api-hono", "tests", "monorepo"]
whenToUse: "When writing or placing tests for apps/api-hono routes in the Fisca repo, or when briefing sub-agents on where test files may be written"
date_creation: 2026-11-14T00:26:50Z
titre: "Scope guard : emplacement des tests de routes api-hono"
---
# Scope guard : emplacement des tests de routes api-hono

## Contenu intégral (inchangé)

In the Fisca monorepo (anasse84/fisca), the scope guard (scripts/enforce-constitution.ts, FISCA_SCOPE_DIRS / .meta/session-scopes.json) rejects files in apps/api-hono/tests/ for sessions whose scope is apps/api-hono/src/routes/<name>. Route tests must therefore live next to the glue code, e.g. apps/api-hono/src/routes/auth/*.test.ts, importing './index.ts'.
