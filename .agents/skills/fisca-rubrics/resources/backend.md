# Backend Fiscal Core & Edge Implementation

- **ID Hyperagent** : `cmwd3n8fy00ec06ad7for4a3j`
- **Type de tâche** : `coding` · général : True · type : general
- **Critères** : 4 · somme des poids : 1.0
- **Créée** : 2026-11-12T05:20:28.030Z · **Mise à jour** : 2026-11-13T09:54:44.093Z
- **Seuil d'acceptation** : 95/100 (barrières et tickets) pour les rubriques R1–R3

## Description

Evaluates code quality, scope containment, edge architecture, and handoff governance for the Fisca backend fiscal core agent.

## Critères

| # | Critère | Poids | Part |
|---|---|---|---|
| 1 | Scope Boundary & Registry Adherence | 0.25 | 25.0 % |
| 2 | Cloudflare Edge Architecture & Code Quality | 0.3 | 30.0 % |
| 3 | Declarative Engine & Neuro-Symbolic Backend Integration | 0.25 | 25.0 % |
| 4 | Batch Execution & Autonomous Handoff Protocol | 0.2 | 20.0 % |

### 1. Scope Boundary & Registry Adherence — poids 0.25

**Description.** Measures strict restriction of modifications to apps/api-hono and mandatory, accurate registration of all created API endpoints, D1 tables, secrets, and bindings in fisca_contracts_registry.

**Guide de notation (1–5).**

- 1: Modifies files outside apps/api-hono without reporting to backlog, or creates backend resources without updating fisca_contracts_registry; 2: Stays within apps/api-hono but frequently forgets to log new contracts or uses unregistered resource names; 3: Generally respects directory boundaries and logs most resources in fisca_contracts_registry with minor omissions; 4: Fully respects directory boundaries and accurately registers all newly created tables, bindings, and API endpoints; 5: Implements flawless scope containment, strictly validates resource naming against fisca_contracts_registry, and proactively flags cross-app ticket requirements in the backlog.

### 2. Cloudflare Edge Architecture & Code Quality — poids 0.3

**Description.** Evaluates implementation quality of Hono routing, Drizzle ORM schemas on Cloudflare D1, adherence to edge runtime patterns, and strict avoidance of floating-point arithmetic for monetary values.

**Guide de notation (1–5).**

- 1: Uses floating-point numbers for currency, uses obsolete API syntax, or writes code incompatible with Cloudflare Workers runtime; 2: Avoids floats but has performance bottlenecks, improper Drizzle queries, or unhandled promise rejections on the edge; 3: Correctly uses fixed-point/integer arithmetic for monetary values and writes standard, functional Hono/Drizzle code for Cloudflare Workers; 4: Implements clean, modern Hono routes and optimal D1 queries with proper error handling and strict integer-based currency calculations; 5: Produces exemplary serverless backend code optimized for low-latency Cloudflare Workers execution, featuring robust schema migrations, flawless type safety, and zero monetary rounding errors.

### 3. Declarative Engine & Neuro-Symbolic Backend Integration — poids 0.25

**Description.** Assesses the technical implementation of dynamic fiscal AST runtime storage in D1 and the structural readiness for neuro-symbolic accounting agent execution and Hindsight auto-learning memory hooks.

**Guide de notation (1–5).**

- 1: Hardcodes fiscal rules into backend logic instead of using dynamic AST, or fails to provide agent integration hooks; 2: Partially uses dynamic AST but breaks declarative model flexibility or provides incomplete state hooks for agents; 3: Implements dynamic fiscal AST in D1 and exposes basic integration interfaces for neuro-symbolic accounting agents; 4: Robustly constructs the dynamic AST execution engine in D1 and provides complete, well-structured hooks for neuro-symbolic agent memory and rules; 5: Masterfully implements a fully declarative dynamic AST runtime for CGI/LF updates and seamless, zero-latency integration patterns for all 11 neuro-symbolic agents and Hindsight memory.

### 4. Batch Execution & Autonomous Handoff Protocol — poids 0.2

**Description.** Evaluates compliance with the 5-ticket batch execution limits, proper backlog state transitions (IN_PROGRESS, IN_REVIEW), PR workflow discipline (no main merges, no force-pushes), and section-by-section handoff documentation.

**Guide de notation (1–5).**

- 1: Exceeds 5-ticket batch size, merges directly to main, force-pushes commits, or fails to update backlog states and handoff logs; 2: Respects Git branch rules but writes vague handoff notes, overwrites entire handoff files, or misses IN_PROGRESS state transitions; 3: Follows ticket batching, updates locked_by_branch and status fields accurately, and updates FISCA_STATE_AND_HANDOFF incrementally; 4: Adheres strictly to the 5-ticket batch limit, maintains clean PR references, and provides clear autonomous handoff briefs pointing to next actionable tickets; 5: Demonstrates flawless workflow discipline, updating backlog states and handoff documentation with precision, ensuring completely seamless transition for fresh self-delegated agent instances.

---
_Critère type : general. Export fidèle ; le fichier `backend.json` est la source exacte._
