---
id_source: cmwfo0rmq00os07adgx54rl24
category: project_context
importance: 4
tags: ["fisca", "tenant-router", "mandates", "access-control", "control-plane", "organization-memberships", "mandate-resolver", "fail-closed", "oec-firm", "direct-membership", "tenant-key-grants", "authorization", "multi-tenancy", "pilot-rule", "simulated-driver", "access-refused"]
whenToUse: "When working on TenantRouter, membership or mandate resolution, or OEC firm access in Fisca"
date_creation: 2026-11-14T00:26:24Z
date_maj: 2026-11-14T00:26:26Z
titre: "TenantRouter : appartenance directe + MandateResolver, fail-closed"
---
# TenantRouter : appartenance directe + MandateResolver, fail-closed

## Contenu intégral (inchangé)

Fisca tenant routing rule (pilot): resolve only direct membership (organization_memberships in the control plane). Mandate (OEC firm) access goes through an injectable MandateResolver port, with a simulated driver for tests. Do not invent a mirror table. Fail closed: without a mandate resolver, firm access is refused. The open question of mirroring active mandates from tenant_key_grants into the control plane is for the owner and is recorded in section 04.
