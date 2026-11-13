/**
 * Tests du gardien de constitution. Lancement sans dépendance : `node --test enforce-constitution.test.ts`.
 * Couvre les 4 contrôles de Doc_15_AGENTS_MD#S12 et les corrections B-01 à B-04 de docs/specs/ERRATA.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isDependencyAdditionOnly,
  isProtectedMoroccanTaxWindow,
  resolveScopeCsvForBranch,
  verifyConstitutionalCompliance,
  type ConstitutionCheckInput,
} from "./enforce-constitution.ts";

function check(overrides: Partial<ConstitutionCheckInput>) {
  return verifyConstitutionalCompliance({
    currentBranch: "feat/w2-astro-growth",
    changedFiles: [],
    allowedScopeDirsCsv: "apps/marketing-astro",
    nowIsoDate: "2026-11-13",
    allowOrchestratorOverride: false,
    ...overrides,
  });
}

test("rejet hors périmètre parallèle (Doc 15 § 12, contrôle 2)", () => {
  const verdict = check({ changedFiles: ["packages/db-schema/index.ts"] });
  assert.equal(verdict.passed, false);
  assert.match(verdict.violations[0] ?? "", /^ERR_OUT_OF_SCOPE: Le fichier \[packages\/db-schema\/index\.ts\]/);
});

test("fichier dans le périmètre accepté, y compris sous-dossier", () => {
  assert.equal(check({ changedFiles: ["apps/marketing-astro/src/pages/fr/index.astro"] }).passed, true);
});

test("un préfixe voisin ne passe pas (apps/marketing-astro-old)", () => {
  assert.equal(check({ changedFiles: ["apps/marketing-astro-old/x.ts"] }).passed, false);
});

test("pnpm-lock.yaml et .meta/ toujours autorisés (correction B-01)", () => {
  const verdict = check({ changedFiles: ["pnpm-lock.yaml", ".meta/backlog-snapshot-P2-C.json"] });
  assert.deepEqual(verdict.violations, []);
});

test("auto-défense du harnais (Doc 15 § 12, contrôle 3)", () => {
  for (const file of ["AGENTS.md", "packages/qa-harness/src/fiscal-golden-suite.ts", "docs/specs/14-qa-harness.md", ".meta/session-scopes.json"]) {
    const verdict = check({ currentBranch: "feat/w2-ui-pme-pos", allowedScopeDirsCsv: "packages/ui-mercury", changedFiles: [file] });
    assert.equal(verdict.passed, false, file);
    assert.match(verdict.violations.join("\n"), /ERR_TAMPERED_QA/);
    assert.match(verdict.violations.join("\n"), new RegExp(file.replace(/[.\/]/g, "\\$&")));
  }
});

test("le mode orchestrateur lève périmètre et protection", () => {
  const verdict = check({ currentBranch: "feat/w0-foundation", allowedScopeDirsCsv: undefined, allowOrchestratorOverride: true, changedFiles: ["AGENTS.md", "package.json"] });
  assert.equal(verdict.passed, true);
});

test("branche de travail sans périmètre connu : échec fermé (correction B-03)", () => {
  const verdict = check({ currentBranch: "feat/inconnue", allowedScopeDirsCsv: undefined, changedFiles: ["apps/api-hono/src/index.ts"] });
  assert.match(verdict.violations.join("\n"), /ERR_SCOPE_UNDEFINED/);
});

test("nommage de branche : feat/ ou fix/ uniquement", () => {
  const verdict = check({ currentBranch: "release/v1.0.0", changedFiles: [] });
  assert.match(verdict.violations.join("\n"), /ERR_BRANCH_NAMING/);
});

test("verrou calendaire fiscal marocain (Doc 15 § 12, contrôle 4)", () => {
  for (const date of ["2026-11-19", "2027-03-28", "2027-02-15"]) {
    const verdict = check({ changedFiles: ["apps/marketing-astro/migrations/001.sql"], commitMessage: "feat: x [BREAKING_MIGRATION]", nowIsoDate: date });
    assert.match(verdict.violations.join("\n"), /ERR_TAX_FREEZE_WINDOW/, date);
  }
  for (const date of ["2026-11-13", "2027-02-14", "2026-12-22"]) {
    const verdict = check({ changedFiles: ["apps/marketing-astro/migrations/001.sql"], commitMessage: "feat: x [BREAKING_MIGRATION]", nowIsoDate: date });
    assert.equal(verdict.passed, true, date);
  }
  assert.equal(check({ changedFiles: ["apps/marketing-astro/migrations/001.sql"], commitMessage: "feat: migration ordinaire", nowIsoDate: "2026-11-19" }).passed, true);
});

test("fenêtres fiscales : bornes exactes", () => {
  assert.equal(isProtectedMoroccanTaxWindow("2026-05-14"), false);
  assert.equal(isProtectedMoroccanTaxWindow("2026-05-15"), true);
  assert.equal(isProtectedMoroccanTaxWindow("2026-05-21"), true);
  assert.equal(isProtectedMoroccanTaxWindow("2026-05-22"), false);
  assert.equal(isProtectedMoroccanTaxWindow("2027-03-31"), true);
  assert.equal(isProtectedMoroccanTaxWindow("2027-04-01"), false);
  assert.throws(() => isProtectedMoroccanTaxWindow("pas-une-date"));
});

test("manifeste du paquet englobant : ajout de dépendances seul (correction B-02)", () => {
  const before = JSON.stringify({ name: "@fisca/api-hono", scripts: { test: "vitest" }, dependencies: { hono: "^4.6.0" } });
  const added = JSON.stringify({ name: "@fisca/api-hono", scripts: { test: "vitest" }, dependencies: { hono: "^4.6.0", "@fisca/edi-simpl": "workspace:*" } });
  const scriptChanged = JSON.stringify({ name: "@fisca/api-hono", scripts: { test: "true" }, dependencies: { hono: "^4.6.0" } });
  const removed = JSON.stringify({ name: "@fisca/api-hono", scripts: { test: "vitest" }, dependencies: {} });
  assert.equal(isDependencyAdditionOnly(before, added), true);
  assert.equal(isDependencyAdditionOnly(before, scriptChanged), false);
  assert.equal(isDependencyAdditionOnly(before, removed), false);
  assert.equal(isDependencyAdditionOnly(null, added), false);

  const base = { currentBranch: "feat/w3-edi-simpl-fec", allowedScopeDirsCsv: "packages/edi-simpl,apps/api-hono/src/routes/edi", changedFiles: ["apps/api-hono/package.json"] };
  assert.equal(check({ ...base, manifestChanges: [{ path: "apps/api-hono/package.json", beforeJson: before, afterJson: added }] }).passed, true);
  assert.equal(check({ ...base, manifestChanges: [{ path: "apps/api-hono/package.json", beforeJson: before, afterJson: scriptChanged }] }).passed, false);
  // un paquet qui n'englobe aucun dossier du périmètre reste interdit
  assert.equal(check({ ...base, changedFiles: ["apps/web-saas/package.json"], manifestChanges: [{ path: "apps/web-saas/package.json", beforeJson: before, afterJson: added }] }).passed, false);
});

test("périmètre déduit de la branche via session-scopes.json (correction B-03)", () => {
  const json = JSON.stringify({ sessions: [
    { session_id: "P2-C", git_branch: "feat/w2-astro-growth", scope_dirs: ["apps/marketing-astro"] },
    { session_id: "S0", git_branch: "feat/w0-foundation", scope_dirs: ["(racine du dépôt : mode orchestrateur)"] },
  ] });
  assert.equal(resolveScopeCsvForBranch("feat/w2-astro-growth", json), "apps/marketing-astro");
  assert.equal(resolveScopeCsvForBranch("feat/w0-foundation", json), null);
  assert.equal(resolveScopeCsvForBranch("feat/autre", json), null);
});
