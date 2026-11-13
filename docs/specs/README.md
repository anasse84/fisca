# Spécifications Fisca

Les 18 documents de spécification, convertis en Markdown le 2026-11-13. `ERRATA.md` prime sur eux : lis-le d'abord.

| N° | ID canonique | Fichier |
|---|---|---|
| 01 | `Doc_01_PRD` | [`01-prd.md`](01-prd.md) |
| 02 | `Doc_02_State_Machines` | [`02-state-machines.md`](02-state-machines.md) |
| 03 | `Doc_03_Entitlements_Pricing` | [`03-entitlements-pricing.md`](03-entitlements-pricing.md) |
| 04 | `Doc_04_TDD` | [`04-tdd-architecture.md`](04-tdd-architecture.md) |
| 05 | `Doc_05_ADR` | [`05-adr.md`](05-adr.md) |
| 06 | `Doc_06_ERD` | [`06-erd-data-lifecycle.md`](06-erd-data-lifecycle.md) |
| 07 | `Doc_07_API_EDI` | [`07-api-edi-contracts.md`](07-api-edi-contracts.md) |
| 08 | `Doc_08_Design_i18n` | [`08-design-system-i18n.md`](08-design-system-i18n.md) |
| 09 | `Doc_09_RBAC_SoD` | [`09-auth-rbac-sod.md`](09-auth-rbac-sod.md) |
| 10 | `Doc_10_STRIDE_Crypto` | [`10-stride-crypto.md`](10-stride-crypto.md) |
| 11 | `Doc_11_CNDP_Souverainete` | [`11-cndp-sovereignty.md`](11-cndp-sovereignty.md) |
| 12 | `Doc_12_SLA_DPA_PRA_Reversibilite` | [`12-sla-dpa-pra-reversibility.md`](12-sla-dpa-pra-reversibility.md) |
| 13 | `Doc_13_FinOps` | [`13-finops.md`](13-finops.md) |
| 14 | `Doc_14_QA` | [`14-qa-harness.md`](14-qa-harness.md) |
| 15 | `Doc_15_AGENTS_MD` | [`15-agents-md-constitution.md`](15-agents-md-constitution.md) |
| 16 | `Doc_16_Cloud_Deploy` | [`16-cloud-deploy.md`](16-cloud-deploy.md) |
| 17 | `Doc_17_Third_Party_Integrations` | [`17-third-party-integrations.md`](17-third-party-integrations.md) |
| 18 | `Doc_18_SEO_GEO_AEO` | [`18-seo-geo-aeo.md`](18-seo-geo-aeo.md) |

Le backlog cite les sections sous la forme `Doc_04_TDD#S02` : document `04-tdd-architecture.md`, titre « ## Section 02 ».

Chaque session ne lit que les 3 à 5 documents de sa ligne dans la matrice de `docs/orchestration/README.md`, section par section. Ce dossier est protégé : seul Fisca-Lead-Orchestrator le modifie.

## Annexes V : code de vérification numérique

Les documents 03, 10, 12, 13, 14, 17 et 18 se terminent par une « Annexe V » : le code Python qui a servi à calculer et contrôler leurs chiffres (fichier `code.docx` du propriétaire), suivi de sa sortie. 13 blocs au total.

```bash
python3 docs/specs/verification/verify-annexes.py        # réexécute les 13 blocs et compare les sorties
python3 docs/specs/verification/verify-annexes.py 14     # un seul document
```

C'est une pièce justificative, pas une exigence ni du code de production (ERRATA D-21). L'état de vérification des règles fiscales contre les textes officiels est dans `ERRATA.md`, section E.
