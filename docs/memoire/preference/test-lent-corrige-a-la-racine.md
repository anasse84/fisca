---
id_source: cmwfo0n7d00pu07ad5hjd9qos
category: preference
importance: 4
tags: ["fisca", "tests", "determinism", "verify-fast", "flaky-tests", "test-timeouts", "vitest", "math-random", "seeding", "crypto-getRandomValues", "deterministic-tests", "root-cause-fix", "statistical-sampling", "prng", "test-speed", "flakiness", "pseudo-randomness", "dependency-injection"]
whenToUse: "When a Fisca test times out under turbo parallelism, is non-deterministic, or depends on randomness"
date_creation: 2026-11-14T00:26:18Z
date_maj: 2026-11-14T00:26:20Z
titre: "Test lent ou instable : corriger à la racine, jamais masquer"
---
# Test lent ou instable : corriger à la racine, jamais masquer

## Contenu intégral (inchangé)

Fisca standing rule from the pilot: a slow or flaky test is fixed at the root, never masked. Never raise a vitest timeout to hide slowness. Reduce the cost instead, for example with an exhaustive deterministic proof in place of statistical sampling, and keep the coverage. Tests involving randomness use an injected generator with a fixed seed, never Math.random. Production code keeps crypto.getRandomValues as the default source.
