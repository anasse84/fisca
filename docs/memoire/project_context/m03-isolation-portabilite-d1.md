---
id_source: cmwczkhoi01kh07ad1pxs1a1h
category: project_context
importance: 5
tags: ["d1", "r2", "adapter", "isolation", "portabilite", "cloudflare", "storageadapter", "multi-tenant", "base-de-donnees", "database", "jurisdiction-eu", "rgpd", "standby_vps", "securite-client", "architecture-stockage", "fisca", "solo"]
whenToUse: "Projet Fisca : conception du stockage, des bases D1/R2, de l'isolation par client ou de l'adaptateur de stockage."
date_creation: 2026-11-12T03:26:21Z
date_maj: 2026-11-12T03:26:24Z
titre: "M03 — Isolation & portabilité (1 base D1 par société, StorageAdapter)"
---
# M03 — Isolation & portabilité (1 base D1 par société, StorageAdapter)

## Contenu intégral (inchangé)

[Fisca · M03 — Isolation & Portabilité] Chaque société cliente reçoit 1 base Cloudflare D1 isolée dès le plan Solo (jurisdiction = eu sur R2/D1). Toutes les écritures passent par StorageAdapter (mode cloudflare actif, adaptateur standby_vps prêt pour la pré-production).
