# EDI Containers & ERP Connectors Implementation

- **ID Hyperagent** : `cmwd3nvyh00b107adxlatxgh7`
- **Type de tâche** : `coding` · général : True · type : general
- **Critères** : 4 · somme des poids : 1.0
- **Créée** : 2026-11-12T05:20:58.505Z · **Mise à jour** : 2026-11-13T09:54:40.351Z
- **Seuil d'acceptation** : 95/100 (barrières et tickets) pour les rubriques R1–R3

## Description

Evaluates the execution quality, schema validity, scope boundary discipline, and workflow governance of the Fisca Containers, EDI, and ERP connector builder agent.

## Critères

| # | Critère | Poids | Part |
|---|---|---|---|
| 1 | EDI & XML Schema Validation Rigor | 0.3 | 30.0 % |
| 2 | ERP & Fintech Connector Engineering | 0.3 | 30.0 % |
| 3 | Repository Scope & Git Workflow Adherence | 0.2 | 20.0 % |
| 4 | Batch Processing & Handoff Quality | 0.2 | 20.0 % |

### 1. EDI & XML Schema Validation Rigor — poids 0.3

**Description.** Evaluates the accuracy and strict validation of UBL 2.1, Factur-X PDF/A-3, and DGI XSD schemas, including deterministic integer currency handling and pre-commit harness checks.

**Guide de notation (1–5).**

- 1: Generates invalid XML schemas, reconstructs specs from memory without reading official XSDs, or uses floating-point numbers for currency; 2: Generates XML payloads that fail against official DGI or UBL 2.1 XSD schemas, or skips pre-commit gatekeeper checks; 3: Validates XML against XSD schemas and avoids floating-point currency, but contains minor schema formatting or Factur-X metadata inaccuracies; 4: Flawless UBL 2.1, Factur-X, and DGI XSD validation with full compliance to deterministic monetary handling and gatekeeper checks; 5: Exemplary schema clearance and XML generation; perfectly handles signatures, Merkle trees, and SIMPL teledeclarations with zero validation warnings.

### 2. ERP & Fintech Connector Engineering — poids 0.3

**Description.** Measures the code quality, security, and contract adherence of Odoo (odoo-l10n-ma), Sage 100 (.NET), and fintech connectors (Payzone, FactorFlow, SES, Infobip) registered in fisca_contracts_registry.

**Guide de notation (1–5).**

- 1: Connector code breaks platform conventions, introduces unregistered endpoints/tables, or uses mismatched naming conventions; 2: Connectors function partially but fail to register bindings or tables in fisca_contracts_registry or lack proper multi-tenant isolation; 3: Connectors are functional and register resources correctly, but lack complete error handling for edge-case ERP payload schemas; 4: Connectors for Odoo, Sage 100, and fintech services strictly follow contract naming and provide robust, E2EE-compliant data mapping; 5: Robust, production-grade ERP and fintech connector logic with zero-trust tenant isolation, complete contract registry synchronization, and resilient integration patterns.

### 3. Repository Scope & Git Workflow Adherence — poids 0.2

**Description.** Assesses compliance with directory scope rules (containers/, connectors/), ticket locking workflows, contract registry entries, and safe Git branching/PR protocols.

**Guide de notation (1–5).**

- 1: Modifies restricted directories (apps/marketing-astro, apps/web-saas) without explicit ticket assignment, force-pushes, or attempts direct merges to main; 2: Modifies correct directories but forgets ticket status updates (IN_PROGRESS/IN_REVIEW), branch locking, or fisca_contracts_registry updates; 3: Respects directory boundaries and Git branching rules, but ticket status transitions or commit URL attachments are occasionally incomplete; 4: Strictly respects directory boundaries, locks tickets correctly, updates registry entries instantly, and opens PRs without pushing to main; 5: Flawless adherence to repository boundaries, lock management, commit URL tracking, and PR workflow with zero governance violations.

### 4. Batch Processing & Handoff Quality — poids 0.2

**Description.** Evaluates the agent's ability to operate in <= 5 ticket batches, update FISCA_STATE_AND_HANDOFF incrementally, produce clear autonomous briefs, and communicate strictly in French.

**Guide de notation (1–5).**

- 1: Exceeds batch limits (>5 tickets), overwrites FISCA_STATE_AND_HANDOFF entirely, fails to respond in French, or leaves incomplete handoff states; 2: Responds in French but uses unorganized batch sizes or leaves vague handoff briefings for subsequent agent instances; 3: Manages batches under 5 tickets and updates state documents incrementally, but handoff briefs require manual intervention to continue; 4: Consistently works in <= 5 ticket batches, performs section-by-section FISCA_STATE_AND_HANDOFF updates, and leaves clear autonomous briefs in French; 5: Exemplary batch execution and handoff orchestration; state updates are precise and incremental, and handoff briefs enable seamless continuation by a fresh agent instance.

---
_Critère type : general. Export fidèle ; le fichier `edi-erp.json` est la source exacte._
