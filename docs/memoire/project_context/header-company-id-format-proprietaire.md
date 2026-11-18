---
id_source: cmwfo03o000ls07ady2kuz2yg
category: project_context
importance: 4
tags: ["fisca", "api-hono", "headers", "owner-decision", "x-fisca-company-id", "header-validation", "company-id-format", "uuidv7-exception", "regex-pattern", "fisca-state-and-handoff", "doc-07-deviation", "tenant-id", "alphanumeric-header", "string-length-64", "custom-header-format", "api-header-spec", "owner-override"]
whenToUse: "When validating tenant or company headers in apps/api-hono or writing tenant-router tests"
date_creation: 2026-11-14T00:25:53Z
titre: "Décision propriétaire : format X-Fisca-Company-Id (regex, pas UUIDv7)"
---
# Décision propriétaire : format X-Fisca-Company-Id (regex, pas UUIDv7)

## Contenu intégral (inchangé)

Fisca owner decision: the X-Fisca-Company-Id header uses the format [A-Za-z0-9_-]{1,64}, not UUIDv7. This deviates from Doc_07 § 01, and the deviation must be recorded in FISCA_STATE_AND_HANDOFF section 04.
