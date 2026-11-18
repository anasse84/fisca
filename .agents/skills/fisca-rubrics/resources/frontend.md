# Fisca Frontend & Mobile Growth Engineering Execution

- **ID Hyperagent** : `cmwd3oi0r00au06adv8yww2gh`
- **Type de tâche** : `coding` · général : True · type : general
- **Critères** : 4 · somme des poids : 1.0
- **Créée** : 2026-11-12T05:21:27.099Z · **Mise à jour** : 2026-11-13T09:54:37.834Z
- **Seuil d'acceptation** : 95/100 (barrières et tickets) pour les rubriques R1–R3

## Description

Evaluates the agent's frontend code implementation across Astro and React/Capacitor, monorepo scope isolation, contract adherence, multi-theme responsive testing, and ticket lifecycle governance.

## Critères

| # | Critère | Poids | Part |
|---|---|---|---|
| 1 | Scope Isolation and Contract Adherence | 0.3 | 30.0 % |
| 2 | Cross-Platform Tech Stack Engineering | 0.25 | 25.0 % |
| 3 | Dual-Viewport and Dual-Theme Verification | 0.25 | 25.0 % |
| 4 | Ticket Lifecycle and Handoff Governance | 0.2 | 20.0 % |

### 1. Scope Isolation and Contract Adherence — poids 0.3

**Description.** Measures strict containment within apps/marketing-astro and apps/web-saas, zero forbidden directory mutations, and exact usage of API routes declared in fisca_contracts_registry.

**Guide de notation (1–5).**

- 1: Modifies forbidden directories (e.g., apps/api-hono, containers/) or invents unregistered API endpoints; 2: Stays mostly within boundaries but includes unregistered endpoints or unflagged missing contract routes; 3: Respects directory boundaries and uses contract routes, but misses logging contract gaps in the backlog; 4: Fully respects directory boundaries, relies strictly on fisca_contracts_registry, and logs missing contract endpoints in the backlog; 5: Implements flawless scope isolation, verifies all endpoints against fisca_contracts_registry, and logs missing backend capabilities with exact backlog specifications.

### 2. Cross-Platform Tech Stack Engineering — poids 0.25

**Description.** Evaluates implementation quality across Astro (marketing/SEO) and React 19 + Vite + Capacitor (SaaS web & mobile), following up-to-date documentation standards.

**Guide de notation (1–5).**

- 1: Uses outdated or broken syntax, produces non-functional Capacitor web-mobile code, or introduces severe build errors; 2: Code runs but suffers from sub-optimal Astro SEO practices or improper React 19/Capacitor patterns; 3: Clean implementation following current Astro, React, and Capacitor documentation with functional web and mobile behavior; 4: Robust cross-platform engineering with optimized Astro SEO structures and clean React 19 state management; 5: Exemplary frontend architecture with modern Astro SEO optimizations, flawless web-mobile Capacitor integration, and highly performant React 19 patterns.

### 3. Dual-Viewport and Dual-Theme Verification — poids 0.25

**Description.** Assesses explicit visual and structural verification across 375px mobile and 1440px desktop viewports in both light and dark modes.

**Guide de notation (1–5).**

- 1: Fails to verify screens across viewports or themes, resulting in broken layouts or illegible contrast; 2: Renders correctly at one viewport size or theme, but breaks at 375px mobile or in dark mode; 3: Supports 375px and 1440px viewports and both themes with minor visual alignment glitches; 4: Fully verifies layouts across 375px and 1440px breakpoints in light and dark modes with zero visual breaking; 5: Delivers pixel-perfect responsiveness and color contrast at 375px and 1440px across both light and dark themes with complete visual consistency.

### 4. Ticket Lifecycle and Handoff Governance — poids 0.2

**Description.** Evaluates compliance with task batching (≤ 5 tickets), branch locking, commit/PR workflow, ticket state transitions, and incremental FISCA_STATE_AND_HANDOFF updates.

**Guide de notation (1–5).**

- 1: Violates workflow by committing directly to main, force-pushing, skipping ticket branch locking, or exceeding batch limits; 2: Moves tickets to IN_REVIEW without commit URLs or neglects updating FISCA_STATE_AND_HANDOFF; 3: Follows ticket branch locking and status flow, but handoff briefs are vague or batch limits are slightly unorganized; 4: Strictly operates in batches of ≤5, locks branches correctly, updates tickets to IN_REVIEW with commit URLs, and updates state documents; 5: Flawlessly executes ticket lifecycle governance, maintains precise branch locking, updates FISCA_STATE_AND_HANDOFF section-by-section, and provides autonomous delegate handoff briefs.

---
_Critère type : general. Export fidèle ; le fichier `frontend.json` est la source exacte._
