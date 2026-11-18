---
id_source: cmwfo0w54006v07adusgnblny
category: project_context
importance: 4
tags: ["fisca", "api-hono", "problem-details", "company-id", "seam-request"]
whenToUse: "When building Hono middleware, error envelopes, or validation of tenant identifiers in apps/api-hono"
date_creation: 2026-11-14T00:26:29Z
titre: "Décisions du pilote : company-id UUID à la frontière HTTP, RFC 9457, SEAM_REQUEST"
---
# Décisions du pilote : company-id UUID à la frontière HTTP, RFC 9457, SEAM_REQUEST

## Contenu intégral (inchangé)

Fisca pilot rulings: (1) At the HTTP boundary, the request pipeline validates the X-Fisca-Company-Id header as a UUID (UUIDv7, Doc_07 § 01). The broader format [A-Za-z0-9_-]{1,64} from assertValidCompanyId in shared-types remains the rule for internal layers and must not be changed. (2) Error responses emit the RFC 9457 envelope including the issues[] extension from Doc_07. (3) If a frozen packages/shared-types contract (e.g. ProblemDetailsSchema) blocks something, file a precise SEAM_REQUEST naming the file and the change, with no workaround; the pilot edits shared-types himself.
