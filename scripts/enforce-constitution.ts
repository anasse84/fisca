/**
 * enforce-constitution.ts — Gardien statique de la constitution AGENTS.md (version corrigée, 2026-11-13)
 *
 * Remplace le code de référence de Doc_15_AGENTS_MD#S11 (voir docs/specs/ERRATA.md, entrées E-15-x et B-xx).
 * Corrections par rapport au document :
 *   1. gabarits de messages réparés (le fichier fautif est nommé) ;
 *   2. `pnpm-lock.yaml` et `.meta/` sont toujours autorisés (sinon tout `pnpm add` bloque le commit) ;
 *   3. le périmètre est déduit de la branche via `.meta/session-scopes.json` quand FISCA_SCOPE_DIRS
 *      n'est pas exporté (le garde ne dépend plus d'une variable d'environnement oubliée) ;
 *   4. une branche feat/* ou fix/* sans périmètre connu échoue (ERR_SCOPE_UNDEFINED) au lieu de passer ;
 *   5. les manifestes du paquet englobant (package.json) acceptent un ajout de dépendances seul ;
 *   6. chemins protégés étendus : docs/specs/, fichiers AGENTS.md satellites, .meta/session-scopes.json ;
 *   7. mode `--range <base>` pour auditer toute une branche (auditeur, CI).
 *
 * Zéro dépendance npm. S'exécute avec `node scripts/enforce-constitution.ts` (Node >= 22.18) ou `tsx`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export const PROTECTED_GOVERNANCE_PATHS: readonly string[] = [
  "AGENTS.md",
  "CLAUDE.md",
  "scripts/harness-check.sh",
  "scripts/enforce-constitution.ts",
  "packages/qa-harness/src/fiscal-golden-suite.ts",
  "packages/db-schema/AGENTS.md",
  "containers/AGENTS.md",
  "apps/web-saas/AGENTS.md",
  ".meta/session-scopes.json",
];

export const PROTECTED_GOVERNANCE_PREFIXES: readonly string[] = ["docs/specs/", ".githooks/"];

export const ALWAYS_ALLOWED_PATHS: readonly string[] = ["pnpm-lock.yaml"];
export const ALWAYS_ALLOWED_PREFIXES: readonly string[] = [".meta/"];

/** Changement de manifeste : fourni par l'appelant pour chaque package.json modifié hors périmètre strict. */
export interface ManifestChange {
  readonly path: string;
  readonly beforeJson: string | null;
  readonly afterJson: string | null;
}

export interface ConstitutionCheckInput {
  readonly currentBranch: string;
  readonly changedFiles: readonly string[];
  readonly allowedScopeDirsCsv?: string | undefined;
  readonly commitMessage?: string | undefined;
  readonly nowIsoDate: string; // YYYY-MM-DD
  readonly allowOrchestratorOverride: boolean;
  readonly manifestChanges?: readonly ManifestChange[];
}

export interface ConstitutionCheckResult {
  readonly passed: boolean;
  readonly violations: readonly string[];
}

/** Fenêtres d'échéance fiscale marocaine sanctuarisées (Doc 12 § 02) : du 15 au 21 de chaque mois, et du 15/02 au 31/03. */
export function isProtectedMoroccanTaxWindow(isoDate: string): boolean {
  const parts = isoDate.split("-");
  const month = Number.parseInt(parts[1] ?? "0", 10);
  const day = Number.parseInt(parts[2] ?? "0", 10);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`CONSTITUTION_INVALID_DATE: ${isoDate}`);
  }
  if (day >= 15 && day <= 21) {
    return true;
  }
  return (month === 2 && day >= 15) || month === 3;
}

function normalizePrefix(value: string): string {
  return value.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

export function parseScopeCsv(csv: string | undefined): readonly string[] {
  if (csv === undefined) {
    return [];
  }
  return csv
    .split(",")
    .map(normalizePrefix)
    .filter((s) => s.length > 0);
}

export function isProtectedPath(file: string): boolean {
  return (
    PROTECTED_GOVERNANCE_PATHS.includes(file) ||
    PROTECTED_GOVERNANCE_PREFIXES.some((prefix) => file.startsWith(prefix))
  );
}

function isAlwaysAllowed(file: string): boolean {
  return ALWAYS_ALLOWED_PATHS.includes(file) || ALWAYS_ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function isInScope(file: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`));
}

/** Racine de paquet (apps|packages|containers|connectors)/<nom> d'un chemin, ou null. */
export function workspaceRootOf(path: string): string | null {
  const match = /^(apps|packages|containers|connectors)\/[^/]+/.exec(path);
  return match ? match[0] : null;
}

const DEPENDENCY_KEYS: readonly string[] = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** Vrai si seules des dépendances ont été AJOUTÉES (aucune suppression, aucune autre clé modifiée). */
export function isDependencyAdditionOnly(beforeJson: string | null, afterJson: string | null): boolean {
  if (beforeJson === null || afterJson === null) {
    return false;
  }
  let before: Record<string, unknown>;
  let after: Record<string, unknown>;
  try {
    before = JSON.parse(beforeJson) as Record<string, unknown>;
    after = JSON.parse(afterJson) as Record<string, unknown>;
  } catch {
    return false;
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (DEPENDENCY_KEYS.includes(key)) {
      const prev = (before[key] ?? {}) as Record<string, string>;
      const next = (after[key] ?? {}) as Record<string, string>;
      for (const [name, version] of Object.entries(prev)) {
        if (next[name] !== version) {
          return false; // suppression ou changement de version d'une dépendance existante
        }
      }
    } else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      return false;
    }
  }
  return true;
}

export function verifyConstitutionalCompliance(input: ConstitutionCheckInput): ConstitutionCheckResult {
  const violations: string[] = [];
  const onGovernedBranch = input.currentBranch !== "main";

  // 0. Nommage des branches poussées : feat/* et fix/* seulement (audit/* reste locale).
  if (onGovernedBranch && !/^(feat|fix|audit)\//.test(input.currentBranch)) {
    violations.push(
      `ERR_BRANCH_NAMING: La branche [${input.currentBranch}] doit commencer par feat/ ou fix/ (audit/ est réservée aux branches locales de l'auditeur).`
    );
  }

  // 1. Fichiers de gouvernance : intouchables hors mode orchestrateur.
  if (!input.allowOrchestratorOverride && onGovernedBranch) {
    for (const file of input.changedFiles) {
      if (isProtectedPath(file)) {
        violations.push(
          `ERR_TAMPERED_QA: Modification interdite du fichier protégé [${file}] sur la branche [${input.currentBranch}].`
        );
      }
    }
  }

  // 2. Périmètre exclusif de la session.
  const scopePrefixes = parseScopeCsv(input.allowedScopeDirsCsv);
  if (!input.allowOrchestratorOverride && onGovernedBranch) {
    if (scopePrefixes.length === 0) {
      if (input.changedFiles.length > 0) {
        violations.push(
          `ERR_SCOPE_UNDEFINED: Aucun périmètre connu pour la branche [${input.currentBranch}]. Exporte FISCA_SCOPE_DIRS ou déclare la branche dans .meta/session-scopes.json.`
        );
      }
    } else {
      const manifestByPath = new Map((input.manifestChanges ?? []).map((m) => [m.path, m]));
      for (const file of input.changedFiles) {
        if (isAlwaysAllowed(file) || isInScope(file, scopePrefixes) || isProtectedPath(file)) {
          continue; // les chemins protégés ont déjà été signalés au point 1
        }
        const root = workspaceRootOf(file);
        const enclosesScope = root !== null && scopePrefixes.some((prefix) => prefix.startsWith(`${root}/`));
        if (enclosesScope && file === `${root}/package.json`) {
          const change = manifestByPath.get(file);
          if (change && isDependencyAdditionOnly(change.beforeJson, change.afterJson)) {
            continue;
          }
          violations.push(
            `ERR_OUT_OF_SCOPE: [${file}] n'accepte qu'un AJOUT de dépendances depuis une session au périmètre partiel (${scopePrefixes.join(", ")}).`
          );
          continue;
        }
        violations.push(
          `ERR_OUT_OF_SCOPE: Le fichier [${file}] est hors du périmètre FISCA_SCOPE_DIRS (${scopePrefixes.join(", ")}).`
        );
      }
    }
  }

  // 3. Fenêtres fiscales DGI : aucune migration perturbatrice.
  const touchesMigrations = input.changedFiles.some((f) => f.includes("migrations/"));
  const hasBreakingMarker = (input.commitMessage ?? "").includes("[BREAKING_MIGRATION]");
  if (touchesMigrations && hasBreakingMarker && isProtectedMoroccanTaxWindow(input.nowIsoDate)) {
    violations.push(
      `ERR_TAX_FREEZE_WINDOW: Migration perturbatrice bloquée pendant une échéance fiscale DGI (${input.nowIsoDate}).`
    );
  }

  return { passed: violations.length === 0, violations };
}

interface SessionScopeEntry {
  readonly session_id: string;
  readonly git_branch: string;
  readonly scope_dirs: readonly string[];
}

/** Périmètre d'une branche lu dans .meta/session-scopes.json (null si la branche n'y figure pas). */
export function resolveScopeCsvForBranch(branch: string, scopesJsonText: string): string | null {
  const parsed = JSON.parse(scopesJsonText) as { readonly sessions?: readonly SessionScopeEntry[] };
  const session = (parsed.sessions ?? []).find((s) => s.git_branch === branch);
  if (!session) {
    return null;
  }
  const dirs = session.scope_dirs.filter((d) => !d.startsWith("("));
  return dirs.length > 0 ? dirs.join(",") : null;
}

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function gitOrNull(args: readonly string[]): string | null {
  try {
    return execFileSync("git", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function runCli(argv: readonly string[]): number {
  const rangeIndex = argv.indexOf("--range");
  const rangeBase = rangeIndex >= 0 ? argv[rangeIndex + 1] : undefined;
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const diffArgs = rangeBase ? ["diff", "--name-only", `${rangeBase}...HEAD`] : ["diff", "--cached", "--name-only"];
  const diffOut = git(diffArgs);
  const changedFiles = diffOut.length > 0 ? diffOut.split("\n") : [];

  let scopeCsv = process.env["FISCA_SCOPE_DIRS"];
  if ((scopeCsv === undefined || scopeCsv.trim() === "") && existsSync(".meta/session-scopes.json")) {
    scopeCsv = resolveScopeCsvForBranch(branch, readFileSync(".meta/session-scopes.json", "utf8")) ?? undefined;
  }

  const beforeRef = rangeBase ? git(["merge-base", rangeBase, "HEAD"]) : "HEAD";
  const manifestChanges: ManifestChange[] = changedFiles
    .filter((f) => f.endsWith("/package.json"))
    .map((path) => ({
      path,
      beforeJson: gitOrNull(["show", `${beforeRef}:${path}`]),
      afterJson: rangeBase ? gitOrNull(["show", `HEAD:${path}`]) : gitOrNull(["show", `:${path}`]),
    }));

  const verdict = verifyConstitutionalCompliance({
    currentBranch: branch,
    changedFiles,
    allowedScopeDirsCsv: scopeCsv,
    commitMessage: process.env["FISCA_COMMIT_MSG"],
    nowIsoDate: new Date().toISOString().slice(0, 10),
    allowOrchestratorOverride: process.env["FISCA_ORCHESTRATOR_MODE"] === "1",
    manifestChanges,
  });

  if (!verdict.passed) {
    console.error("VIOLATION CONSTITUTION AGENTS.MD :\n" + verdict.violations.join("\n"));
    return 1;
  }
  return 0;
}

if (process.argv[1]?.endsWith("enforce-constitution.ts")) {
  process.exit(runCli(process.argv.slice(2)));
}
