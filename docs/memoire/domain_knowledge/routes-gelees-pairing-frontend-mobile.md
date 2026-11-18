---
id_source: cmwfnzfqx01bv07ad45m7mkti
category: domain_knowledge
importance: 5
tags: ["scope-isolation", "contract-adherence", "pairing-route", "routing", "deep-links", "navigation", "api-contract", "fisca", "mobile", "growth", "feature-flag", "diff-hygiene"]
whenToUse: "Surface on any Fisca frontend or mobile growth task (onboarding, funnels, experiments, referral, CTAs, deep links) that touches navigation, routing, linking config, device/account pairing, or shared API clients. Surface especially before editing files outside the task's named scope and during the final self-review of the diff."
date_creation: 2026-11-14T00:25:22Z
titre: "Routes existantes = contrats gelés (route de pairing) en frontend/mobile growth"
---
# Routes existantes = contrats gelés (route de pairing) en frontend/mobile growth

## Contenu intégral (inchangé)

In Fisca frontend and mobile growth tasks, treat existing routes as frozen contracts. This applies especially to the device/account pairing route. The judge's recurring complaint ('pairing route is...') points to the pairing route being changed, duplicated or bypassed while doing unrelated growth work. Root cause: treating shared navigation, deep links and API contracts as editable implementation details instead of fixed interfaces owned by other teams. Rules: (1) Do NOT rename, move, re-parametrize or restructure the pairing route. This covers its path, params and query keys, deep-link/universal-link mapping, navigation stack position, auth guards and the backend endpoint or payload shape it calls. (2) Do NOT create a parallel or alternate pairing screen or route. If a growth flow (onboarding, referral, promo, paywall, banner, A/B variant) needs to send users to pairing, navigate to the EXISTING route with its EXISTING params. Gate new behavior behind a feature flag or experiment at the call site. (3) Keep the diff inside the files the task names. If a contract change truly seems necessary, stop and state it as an explicit out-of-scope proposal with the reason, rather than implementing it. (4) Before finishing, run a scope check. Run `git diff --stat` and confirm no edits to router/navigation config, linking config, shared API clients/types or the pairing module unless the task explicitly asked for them. Grep for the pairing route name/path and confirm all references are unchanged. (5) In the final summary, state explicitly that existing route and API contracts (including pairing) were preserved, and list any touched shared files with a justification for each.
