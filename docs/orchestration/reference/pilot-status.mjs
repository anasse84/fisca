#!/usr/bin/env node
/**
 * pilot-status.mjs — Calcul déterministe de l'état de l'usine Fisca et des prochaines actions du pilote.
 *
 * Le pilote (Fisca-Lead-Orchestrator) ne décide pas « à l'intuition » : à chaque tick il lit la table
 * fisca_master_backlog, passe le résultat à ce script, et exécute les lignes ACTION imprimées.
 * Zéro dépendance npm (Node >= 20).
 *
 * Usage :
 *   node pilot-status.mjs --backlog <fichier> --scopes .meta/session-scopes.json
 *        [--merged-branches feat/w0-foundation,...] [--running P2-B,G1] [--completed S1A,G1]
 *        [--state .pilot-state.json] [--s5]
 *
 *   --backlog          résultat de GetTable (JSON, même précédé de texte), tableau JSON de lignes, ou CSV
 *   --merged-branches  branches de session déjà fusionnées dans origin/main, calculées par git :
 *                      git branch -r --merged origin/main | sed 's# *origin/##' | grep '^feat/' | paste -sd, -
 *   --running          sessions ou barrières dont la voie est encore en train de travailler (aucun nouvel envoi)
 *   --completed        sessions ou barrières dont la voie vient de terminer un tour (détection de piétinement)
 *   --state            fichier d'état du pilote (compteurs de piétinement et de tours de barrière)
 *   --s5               autorise la release S5 (sinon le pilote s'arrête après la fusion de G4)
 *
 * Code de sortie : 0 (des actions à exécuter), 10 (arrêt : décision du propriétaire), 11 (construction terminée).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const MAX_STALLED_TURNS = 3;
export const MAX_GATE_ROUNDS = 3;
const STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "BLOCKED"];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') { quoted = false; }
      else { field += ch; }
    } else if (ch === '"') { quoted = true; }
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); field = ""; if (row.some((c) => c !== "")) rows.push(row); row = []; }
    else { field += ch; }
  }
  if (field !== "" || row.length > 0) { row.push(field); if (row.some((c) => c !== "")) rows.push(row); }
  const header = rows[0] ?? [];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ""])));
}

/** Accepte : tableau JSON, objet { rows: [...] }, texte contenant un tel objet, ou CSV. */
export function parseBacklog(text) {
  const trimmed = text.trim();
  const tryJson = (candidate) => {
    try { return JSON.parse(candidate); } catch { return undefined; }
  };
  let parsed = tryJson(trimmed);
  if (parsed === undefined) {
    const start = trimmed.indexOf('{"tableId"') >= 0 ? trimmed.indexOf('{"tableId"') : trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) parsed = tryJson(trimmed.slice(start, end + 1));
  }
  let rows;
  if (Array.isArray(parsed)) rows = parsed;
  else if (parsed && Array.isArray(parsed.rows)) rows = parsed.rows;
  else if (trimmed.startsWith("task_id,")) rows = parseCsv(trimmed);
  else throw new Error("PILOT_BACKLOG_UNREADABLE: ni JSON de GetTable, ni tableau JSON, ni CSV.");
  return rows.map((r) => ({
    task_id: String(r.task_id ?? "").trim(),
    session_id: String(r.session_id ?? "").trim(),
    assigned_agent: String(r.assigned_agent ?? "").trim(),
    status: String(r.status ?? "").trim() || "TODO",
    depends_on: String(r.depends_on ?? "")
      .split(",").map((d) => d.trim()).filter((d) => d !== "" && d !== "NONE"),
  }));
}

function countByStatus(tickets) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const t of tickets) counts[t.status] = (counts[t.status] ?? 0) + 1;
  return counts;
}

const progressKey = (c) => STATUSES.map((s) => c[s] ?? 0).join("/");
const isOpen = (c) => c.TODO + c.IN_PROGRESS > 0;
const countsLine = (c) => `${c.TODO} TODO, ${c.IN_PROGRESS} IN_PROGRESS, ${c.IN_REVIEW} IN_REVIEW, ${c.DONE} DONE, ${c.BLOCKED} BLOCKED`;

/**
 * @param {{backlog: ReturnType<typeof parseBacklog>, scopes: any, mergedBranches?: string[], running?: string[],
 *          completed?: string[], state?: any, allowS5?: boolean}} input
 */
export function computePilotPlan(input) {
  const { backlog, scopes } = input;
  const mergedBranches = new Set(input.mergedBranches ?? []);
  const completed = new Set(input.completed ?? []);
  const running = new Set(input.running ?? []);
  const busyLanes = new Set();
  const state = { sessions: {}, gates: {}, ...(input.state ?? {}) };
  const byId = new Map(backlog.map((t) => [t.task_id, t]));
  const ticketsOf = (sid) => backlog.filter((t) => t.session_id === sid);
  const sessionMeta = new Map(scopes.sessions.map((s) => [s.session_id, s]));
  const waveOf = (sid) => sessionMeta.get(sid)?.wave;

  const waves = new Map();
  for (const s of scopes.sessions) {
    const w = waves.get(s.wave) ?? { wave: s.wave, build: [], gate: null, release: null };
    if (s.mode === "barrière QA") w.gate = s.session_id;
    else if (s.mode === "release") w.release = s.session_id;
    else w.build.push(s.session_id);
    waves.set(s.wave, w);
  }
  const buildWaves = [...waves.values()].filter((w) => w.build.length > 0).sort((a, b) => a.wave - b.wave);

  const duplicates = backlog.map((t) => t.task_id).filter((id, i, all) => all.indexOf(id) !== i);
  const unknownDeps = backlog.flatMap((t) => t.depends_on.filter((d) => !byId.has(d)).map((d) => `${t.task_id}->${d}`));
  const badStatus = backlog.filter((t) => !STATUSES.includes(t.status)).map((t) => `${t.task_id}=${t.status}`);
  const actions = [];
  const notes = [];
  if (duplicates.length || unknownDeps.length || badStatus.length) {
    actions.push({ type: "STOP_OWNER", reason: "BACKLOG_INCOHERENT", detail: [...new Set(duplicates), ...unknownDeps, ...badStatus].slice(0, 12).join(" ") });
    return { actions, notes, state, table: [], exitCode: 10 };
  }

  const table = scopes.sessions.map((s) => ({ session: s.session_id, wave: s.wave, lane: s.lane, counts: countByStatus(ticketsOf(s.session_id)) }));
  const countsOf = (sid) => table.find((r) => r.session === sid).counts;

  const depSatisfied = (ticket, depId) => {
    const dep = byId.get(depId);
    if (dep.status === "DONE") return true;
    if (dep.status !== "IN_REVIEW") return false;
    return dep.session_id === ticket.session_id || waveOf(dep.session_id) === waveOf(ticket.session_id);
  };
  const runnableOf = (sid) => ticketsOf(sid).filter((t) => t.status === "IN_PROGRESS" || (t.status === "TODO" && t.depends_on.every((d) => depSatisfied(t, d))));

  const buildAllDone = (w) => w.build.every((sid) => { const c = countsOf(sid); return c.DONE > 0 && c.DONE === ticketsOf(sid).length; });
  // La vérité de la fusion vient de git (branches ancêtres de origin/main), jamais du seul statut des tickets.
  const waveMerged = (w) => buildAllDone(w) && w.build.every((sid) => mergedBranches.has(sessionMeta.get(sid).git_branch));

  // Détection de piétinement : une voie a terminé un tour sans changer l'état de sa session.
  for (const id of completed) {
    if (sessionMeta.has(id) && sessionMeta.get(id).mode !== "barrière QA") {
      const key = progressKey(countsOf(id));
      const prev = state.sessions[id] ?? { key: null, stalls: 0 };
      state.sessions[id] = { key, stalls: prev.key === key ? prev.stalls + 1 : 0 };
    } else {
      const prev = state.gates[id] ?? { rounds: 0 };
      state.gates[id] = { rounds: prev.rounds + 1 };
    }
  }

  const current = buildWaves.find((w) => !waveMerged(w));
  if (!current) {
    const releaseWave = [...waves.values()].find((w) => w.release);
    const releaseTickets = releaseWave ? ticketsOf(releaseWave.release) : [];
    if (releaseTickets.length === 0 || releaseTickets.every((t) => t.status === "DONE")) {
      actions.push({ type: "COMPLETE", detail: "Tous les tickets sont DONE. Le tag v1.0.0 reste une décision du propriétaire." });
      return { actions, notes, state, table, exitCode: 11 };
    }
    if (!input.allowS5) {
      actions.push({ type: "STOP_OWNER", reason: "READY_FOR_S5", detail: "Vagues 0 à 4 fusionnées. La release S5 déploie en pré-production : elle attend le feu vert du propriétaire (relancer avec --s5)." });
      return { actions, notes, state, table, exitCode: 10 };
    }
    const next = releaseTickets.find((t) => t.status !== "DONE" && t.status !== "IN_REVIEW") ?? releaseTickets.find((t) => t.status === "IN_REVIEW");
    const blocked = releaseTickets.filter((t) => t.status === "BLOCKED");
    if (blocked.length) actions.push({ type: "UNBLOCK", tickets: blocked.map((t) => t.task_id) });
    else if (running.has(releaseWave.release)) notes.push(`${releaseWave.release} : la voie travaille encore, aucun nouvel envoi.`);
    else if (next.assigned_agent === scopes.lanes.PILOTE) actions.push({ type: "PILOT_TICKET", session: releaseWave.release, ticket: next.task_id });
    else actions.push({ type: "AUDIT_TICKET", session: releaseWave.release, ticket: next.task_id, lane: "AUDIT" });
    if (actions.length === 0) actions.push({ type: "WAIT", detail: notes.join(" ") });
    return { actions, notes, state, table, exitCode: actions.some((a) => a.type === "STOP_OWNER") ? 10 : 0 };
  }

  const w = current;
  const blocked = w.build.flatMap((sid) => ticketsOf(sid).filter((t) => t.status === "BLOCKED").map((t) => t.task_id));
  if (blocked.length) actions.push({ type: "UNBLOCK", tickets: blocked });

  for (const sid of w.build) {
    const meta = sessionMeta.get(sid);
    const c = countsOf(sid);
    if (!isOpen(c)) continue;
    const waitingFor = (meta.after ?? []).filter((pre) => isOpen(countsOf(pre)));
    if (waitingFor.length) { notes.push(`${sid} attend la clôture de ${waitingFor.join(", ")}.`); continue; }
    if (running.has(sid)) { notes.push(`${sid} : la voie ${meta.lane} travaille encore, aucun nouvel envoi.`); busyLanes.add(meta.lane); continue; }
    if (busyLanes.has(meta.lane)) { notes.push(`${sid} attend que la voie ${meta.lane} soit libre.`); continue; }
    const stalls = state.sessions[sid]?.stalls ?? 0;
    if (stalls >= MAX_STALLED_TURNS) {
      actions.push({ type: "STOP_OWNER", reason: "SESSION_STALLED", detail: `${sid} : ${stalls} tours de voie sans aucun changement d'état (${countsLine(c)}).` });
      continue;
    }
    const runnable = runnableOf(sid);
    if (runnable.length === 0) { notes.push(`${sid} : aucun ticket exécutable tant que les tickets BLOCKED dont il dépend ne sont pas tranchés.`); continue; }
    busyLanes.add(meta.lane);
    const fresh = c.TODO === ticketsOf(sid).length;
    if (meta.lane === "PILOTE") actions.push({ type: "PILOT_SESSION", session: sid, mode: fresh ? "START" : "RELAY", runnable: runnable.length });
    else actions.push({ type: "DISPATCH", session: sid, lane: meta.lane, agent: scopes.lanes[meta.lane], mode: fresh ? "START" : "RELAY", runnable: runnable.length });
  }

  const anyOpen = w.build.some((sid) => isOpen(countsOf(sid)));
  if (!anyOpen && blocked.length === 0) {
    const gateId = w.gate ?? scopes.pont_s0.gate_id;
    if (buildAllDone(w)) {
      actions.push({ type: "MERGE", gate: gateId, wave: w.wave, branches: w.build.map((sid) => sessionMeta.get(sid).git_branch) });
    } else {
      const rounds = state.gates[gateId]?.rounds ?? 0;
      if (running.has(gateId)) notes.push(`${gateId} : l'auditeur travaille encore, aucun nouvel envoi.`);
      else if (rounds >= MAX_GATE_ROUNDS) actions.push({ type: "STOP_OWNER", reason: "GATE_NOT_CONVERGING", detail: `${gateId} : ${rounds} tours d'audit sans verdict favorable.` });
      else actions.push({ type: "GATE", gate: gateId, wave: w.wave, lane: "AUDIT", round: rounds + 1, sessions: w.build });
    }
  }
  if (actions.length === 0) {
    if (running.size > 0) actions.push({ type: "WAIT", detail: notes.join(" ") });
    else actions.push({ type: "STOP_OWNER", reason: "NO_ACTION", detail: notes.join(" ") || "État non prévu : relire le backlog." });
  }
  const stillWorking = running.size > 0 && notes.some((n) => n.includes("travaille encore"));
  if (stillWorking && actions.every((a) => a.type === "UNBLOCK")) actions.push({ type: "WAIT", detail: "des voies travaillent encore" });
  const onlyStops = actions.every((a) => a.type === "STOP_OWNER" || a.type === "UNBLOCK");
  return { actions, notes, state, table, exitCode: onlyStops && actions.some((a) => a.type === "STOP_OWNER") ? 10 : 0 };
}

/** Message autonome à envoyer à la voie (le destinataire ne voit rien d'autre). */
export function buildLaneMessage(action, scopes, table) {
  const specNames = (docs) => docs.map((d) => (typeof d === "string" ? d : d.file).split("/").pop()).join(", ");
  if (action.type === "DISPATCH") {
    const s = scopes.sessions.find((x) => x.session_id === action.session);
    const c = table.find((r) => r.session === action.session).counts;
    return [
      `SESSION ${s.session_id} — ${action.mode === "START" ? "DÉMARRAGE" : "RELAIS"} (voie ${action.lane}). Projet Fisca, dépôt anasse84/fisca.`,
      `Applique le protocole de boucle, de l'ouverture de session jusqu'au dernier ticket exécutable, sans t'arrêter entre les tickets : skill fisca-harness-gatekeeper, et dans ton clone docs/orchestration/protocole-boucle.md et docs/specs/ERRATA.md, qui priment sur le skill s'ils diffèrent.`,
      `Branche : ${s.git_branch} — base : ${s.base_ref} — bootstrap : bash scripts/bootstrap-sandbox.sh ${s.bootstrap}`.trimEnd(),
      `Périmètre (FISCA_SCOPE_DIRS) : ${s.scope_dirs.join(",")}`,
      `Spécifications à lire dans docs/specs/, section par section : ERRATA.md, ${specNames(s.spec_docs)}`,
      `Tickets : lignes de fisca_master_backlog dont session_id = ${s.session_id}. État : ${countsLine(c)}.`,
      `Ce fil est piloté : tu ne programmes aucun rappel et tu n'ouvres aucun autre fil ; le pilote te relance. Un ticket par sous-agent du fil ; vérifie toi-même ; commit et push après chaque ticket. Passé 40 minutes de tour, n'entame pas de nouveau ticket. Si npm répond 403, appelle RequestNetworkAccess pour registry.npmjs.org et attends l'accord.`,
      `Termine ton tour par la ligne : ETAT ${s.session_id} : <n> IN_REVIEW, <m> BLOCKED, <k> TODO — suivie de « SESSION ${s.session_id} CLOSE » s'il ne reste ni TODO ni IN_PROGRESS.`,
    ].join("\n");
  }
  if (action.type === "GATE") {
    const pont = action.gate === scopes.pont_s0.gate_id;
    const g = pont ? null : scopes.sessions.find((x) => x.session_id === action.gate);
    const branches = pont ? [scopes.pont_s0.candidate_branch] : action.sessions.map((sid) => scopes.sessions.find((x) => x.session_id === sid).git_branch);
    return [
      `BARRIÈRE ${action.gate} — tour ${action.round} (voie AUDIT). Projet Fisca, dépôt anasse84/fisca.`,
      `Applique la procédure de barrière : docs/orchestration/README.md § 4 de ton clone (elle prime sur le skill fisca-factory-runbook s'ils diffèrent) ; scénarios détaillés dans docs/orchestration/barrieres-qa.md.`,
      `Branches candidates, dans cet ordre : ${branches.join(", ")}. Branche locale d'audit, jamais poussée.`,
      `Rubrics engagées (versions v2, 5 critères) : ${(pont ? scopes.pont_s0.rubrics : g.rubrics).join(" + ")}. Seuil : 95/100 sur chacune, aucune clause éliminatoire.`,
      `Spécifications : ERRATA.md, ${specNames(pont ? scopes.pont_s0.spec_docs : g.spec_docs)}. Bootstrap : bash scripts/bootstrap-sandbox.sh ${pont ? scopes.pont_s0.bootstrap : g.bootstrap}`.trimEnd(),
      pont ? `Tickets audités : T-S0-01 à T-S0-08.` : `Tickets de barrière : ceux dont session_id = ${action.gate} ; tickets audités : sessions ${action.sessions.join(", ")}.`,
      `Verdict favorable : chaque ticket audité passe à DONE avec rubric_score ; verdict daté dans 05_QA_Gate_Verdicts ; contrats de la vague à LOCKED (les contrats PROVISIONAL gardent ce statut, ERRATA B-13). Verdict défavorable : seuls les tickets fautifs repassent à TODO (retry_count 0, review_notes précises).`,
      `Tu ne fusionnes rien et ne délègues à personne : le pilote lit ton verdict et fusionne. Si tu as écrit des tests adverses, colle leur correctif (git format-patch --stdout) à la fin de ton rapport. Si npm répond 403, appelle RequestNetworkAccess et attends.`,
      `Termine par la ligne : VERDICT ${action.gate} : FAVORABLE ou DÉFAVORABLE — puis la liste des Pull Requests et les scores par rubric.`,
    ].join("\n");
  }
  return "";
}

function formatAction(a) {
  const { type, ...rest } = a;
  const parts = Object.entries(rest).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : String(v).includes(" ") ? JSON.stringify(v) : v}`);
  return `ACTION ${type} ${parts.join(" ")}`.trimEnd();
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const list = (name) => (arg(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const backlogPath = arg("--backlog");
  const scopesPath = arg("--scopes") ?? ".meta/session-scopes.json";
  if (!backlogPath) { console.error("Usage : node pilot-status.mjs --backlog <fichier> [--scopes ...] [--merged-branches ...] [--running ...] [--completed ...] [--state ...] [--s5]"); return 2; }
  const statePath = arg("--state");
  const state = statePath && existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : undefined;
  const scopes = JSON.parse(readFileSync(scopesPath, "utf8"));
  const plan = computePilotPlan({
    backlog: parseBacklog(readFileSync(backlogPath, "utf8")), scopes, state,
    mergedBranches: list("--merged-branches"), running: list("--running"), completed: list("--completed"), allowS5: argv.includes("--s5"),
  });
  if (statePath) writeFileSync(statePath, JSON.stringify(plan.state, null, 2));
  const done = plan.table.reduce((n, r) => n + r.counts.DONE, 0);
  const total = plan.table.reduce((n, r) => n + STATUSES.reduce((m, s) => m + r.counts[s], 0), 0);
  console.log(`ETAT USINE FISCA — ${done}/${total} tickets DONE`);
  for (const r of plan.table) console.log(`  ${r.session.padEnd(5)} vague ${r.wave} voie ${String(r.lane).padEnd(12)} ${countsLine(r.counts)}`);
  for (const n of plan.notes) console.log(`NOTE ${n}`);
  for (const a of plan.actions) {
    console.log(formatAction(a));
    const message = buildLaneMessage(a, scopes, plan.table);
    if (message) console.log(`--- MESSAGE POUR LA VOIE ${a.lane} ---\n${message}\n--- FIN DU MESSAGE ---`);
  }
  return plan.exitCode;
}

if (process.argv[1] && process.argv[1].endsWith("pilot-status.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
