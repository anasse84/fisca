---
id_source: cmwfo14am00mg06ad6o053p66
category: project_context
importance: 4
tags: ["fisca", "idempotency", "tenant-db", "pilot-decision", "deduplication", "atomic-batch", "executebatchatomically", "g1-gate", "accounting-integrity", "request-fingerprint", "sha256", "replaying-responses", "422-unprocessable-entity", "dossier-database", "tenant-migration-v7", "anti-duplicate", "eventual-consistency", "kv-storage-unsuitable", "idempotency-key-expiration"]
whenToUse: "When implementing or reviewing idempotency, write routes, tenant migrations or ledger batch writes in the Fisca repo"
date_creation: 2026-11-14T00:26:40Z
date_maj: 2026-11-14T00:26:42Z
titre: "Idempotency-Key 72 h dans TENANT_DB (migration v7), pas en KV"
---
# Idempotency-Key 72 h dans TENANT_DB (migration v7), pas en KV

## Contenu intégral (inchangé)

Fisca pilot decision (to be validated at gate G1): the Idempotency-Key 72 h is stored in a table of the dossier's own database (TENANT_DB), not in KV FISCA_FAST_KV (eventual consistency is unsuitable for accounting anti-duplicates) and not in the control plane. The reason is that the key and the accounting write must commit in the same executeBatchAtomically batch. Table idempotency_keys(idempotency_key TEXT PK, request_sha256 TEXT NOT NULL, response_status INTEGER, response_body_json TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, CHECK expires_at > created_at), added as tenant migration v7 without touching v1–v6. Same key with a different request fingerprint returns 422; same key with the same fingerprint replays the stored response.
