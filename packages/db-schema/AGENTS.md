# AGENTS.md — `packages/db-schema` (SQLite D1, triggers, migrations)

Précise la constitution racine (`/AGENTS.md`) sans en assouplir aucune interdiction. Lire aussi `docs/specs/ERRATA.md` (D-03, D-04, D-10, D-11, D-19) et Doc_06.

## Règles locales

- **Dialecte** : SQLite D1 d'abord. Pas d'extension ni de fonction non portable. PostgreSQL 16 reçoit des triggers PL/pgSQL équivalents ; la parité se prouve par le comportement (mêmes erreurs, mêmes empreintes), pas par un DDL identique (D-11).
- **Montants** : colonnes `_cents` en INTEGER, `_bps`, `_milli`, `_micro`. Aucune colonne REAL, FLOAT ou NUMERIC pour de l'argent. Exception posée : `deduction_prorata_pct` reste un entier de 0 à 100 (XSD SIMPL-TVA) ; conversion pct = bps / 100 (D-10).
- **TVA** : le CHECK `vat_rate_bps IN (2000, 1000, 0)` reste strict ; les anciens taux sont convertis avant enregistrement, les exercices antérieurs à 2026 entrent par le journal d'ouverture AN (D-04).
- **Pièces comptables** : un trigger interdit tout UPDATE et DELETE d'une pièce `POSTED`. Le statut `CONTRE_PASSEE` n'existe pas ; la contre-passation est une nouvelle écriture liée par `reversal_of_entry_id`. Un trigger `BEFORE INSERT` refuse l'insertion directe d'une écriture au statut `POSTED` (D-03). Un trigger bloque toute caisse `5161` négative.
- **Rôles** : le CHECK de `organization_memberships.role_code` compte 10 rôles humains, dont `COMMERCIAL_FACTURATION` ; `ERP_CONNECTOR_AGENT` et `AI_MCP_ACTOR` sont des identités techniques hors de cette table (D-02).
- **Chiffrement** : champ sensible = colonne `_enc` plus index aveugle `_bidx`. Le AAD est exactement `companyId|tableName|recordId|columnName`, lié à chaque chiffrement et déchiffrement.
- **Migrations immuables** : une migration appliquée ne se modifie jamais ; toute correction est une nouvelle migration. L'application passe par `ensureTenantSchemaUpToDate`, qui compare une somme de contrôle SHA-256 et refuse une migration altérée. Aucune migration ne porte `[BREAKING_MIGRATION]` avant la v1.0.0 (B-11).
- **Identifiants** : UUIDv7 triables.
- **Règles fiscales** : jamais en dur ; lignes datées des tables AST (`dynamic_fiscal_rules`). `tax_regimes_catalog` et `company_billing_meters` n'existent pas : utiliser `dynamic_fiscal_rules` et `fiduciary_dossier_meters` (D-06, D-19).
- **Objets sans DDL d'origine** (`processed_queue_messages`, `whatsapp_optin_at`, `unsubscribed_at`, `pii_restricted_flag`) : définis ici par S1B et inscrits au registre (D-19).

## Vérifier

`pnpm --filter @fisca/db-schema test`, puis `pnpm verify:fast`. Tout test de trigger prouve l'erreur levée, pas seulement l'absence d'écriture.
