/**
 * Tests du calcul d'état du pilote. Lancement : `node --test docs/orchestration/reference/pilot-status.test.mjs`
 * (depuis la racine du dépôt ; lit .meta/session-scopes.json et .meta/backlog-seed.csv).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildLaneMessage, computePilotPlan, parseBacklog } from "./pilot-status.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = [resolve(here, "../../.."), resolve(here, "../../../..")].find((p) => {
  try { readFileSync(resolve(p, ".meta/session-scopes.json")); return true; } catch { return false; }
});
const scopes = JSON.parse(readFileSync(resolve(root, ".meta/session-scopes.json"), "utf8"));
const seed = () => parseBacklog(readFileSync(resolve(root, ".meta/backlog-seed.csv"), "utf8"));

const set = (rows, pred, status) => rows.forEach((t) => { if (pred(t)) t.status = status; });
const inSessions = (...ids) => (t) => ids.includes(t.session_id);
const plan = (rows, extra = {}) => computePilotPlan({ backlog: rows, scopes, ...extra });
const types = (p) => p.actions.map((a) => `${a.type}:${a.session ?? a.gate ?? a.reason ?? ""}`);

test("graine : 132 tickets, la première action est S0 par le pilote", () => {
  const rows = seed();
  assert.equal(rows.length, 132);
  const p = plan(rows);
  assert.deepEqual(types(p), ["PILOT_SESSION:S0"]);
  assert.equal(p.actions[0].mode, "START");
  assert.equal(p.actions[0].runnable, 1); // seul T-S0-01 est sans dépendance
});

test("S0 en cours : relais ; dépendance IN_REVIEW de la même session admise (ERRATA B-04)", () => {
  const rows = seed();
  set(rows, (t) => t.task_id === "T-S0-01", "IN_REVIEW");
  const p = plan(rows);
  assert.deepEqual(types(p), ["PILOT_SESSION:S0"]);
  assert.equal(p.actions[0].mode, "RELAY");
  assert.equal(p.actions[0].runnable, 2); // T-S0-02 et T-S0-04 dépendent de T-S0-01
});

test("S0 close : pont S0 ; S0 DONE non fusionnée : fusion ; fusionnée : S1A démarre seule", () => {
  const rows = seed();
  set(rows, inSessions("S0"), "IN_REVIEW");
  let p = plan(rows);
  assert.deepEqual(types(p), ["GATE:PONT_S0"]);
  assert.match(buildLaneMessage(p.actions[0], scopes, p.table), /BARRIÈRE PONT_S0 — tour 1[\s\S]*feat\/w0-foundation[\s\S]*VERDICT PONT_S0/);
  set(rows, inSessions("S0"), "DONE");
  assert.deepEqual(types(plan(rows)), ["MERGE:PONT_S0"]);
  p = plan(rows, { mergedBranches: ["feat/w0-foundation"] });
  assert.deepEqual(types(p), ["DISPATCH:S1A"]);
  assert.equal(p.actions[0].lane, "BACK-1");
  assert.match(p.notes.join(" "), /S1B attend la clôture de S1A/);
  const message = buildLaneMessage(p.actions[0], scopes, p.table);
  assert.match(message, /SESSION S1A — DÉMARRAGE \(voie BACK-1\)/);
  assert.match(message, /feat\/w1-auth-crypto-cndp/);
  assert.match(message, /09-auth-rbac-sod\.md/);
  assert.match(message, /ETAT S1A :/);
});

const afterWave0 = () => { const rows = seed(); set(rows, inSessions("S0"), "DONE"); return rows; };
const merged0 = { mergedBranches: ["feat/w0-foundation"] };
const merged1 = { mergedBranches: ["feat/w0-foundation", "feat/w1-auth-crypto-cndp", "feat/w1-erd-ast-cgnc"] };
const mergedAll = { mergedBranches: scopes.sessions.filter((s) => s.pushed).map((s) => s.git_branch) };

test("S1A close : S1B démarre (branche empilée) ; les deux closes : barrière G1", () => {
  const rows = afterWave0();
  set(rows, inSessions("S1A"), "IN_REVIEW");
  let p = plan(rows, merged0);
  assert.deepEqual(types(p), ["DISPATCH:S1B"]);
  assert.match(buildLaneMessage(p.actions[0], scopes, p.table), /base : origin\/feat\/w1-auth-crypto-cndp/);
  set(rows, inSessions("S1B"), "IN_REVIEW");
  p = plan(rows, merged0);
  assert.deepEqual(types(p), ["GATE:G1"]);
  assert.match(buildLaneMessage(p.actions[0], scopes, p.table), /feat\/w1-auth-crypto-cndp, feat\/w1-erd-ast-cgnc[\s\S]*R1 \+ R2/);
});

test("barrière défavorable : seules les sessions fautives sont relancées, puis la barrière se rejoue", () => {
  const rows = afterWave0();
  set(rows, inSessions("S1A", "S1B"), "DONE");
  set(rows, (t) => t.task_id === "T-S1B-04", "TODO");
  let p = plan(rows, { ...merged0, completed: ["G1"] });
  assert.deepEqual(types(p), ["DISPATCH:S1B"]);
  assert.equal(p.actions[0].mode, "RELAY");
  set(rows, (t) => t.task_id === "T-S1B-04", "IN_REVIEW");
  p = plan(rows, { ...merged0, state: p.state });
  assert.deepEqual(types(p), ["GATE:G1"]);
  assert.equal(p.actions[0].round, 2);
});

test("barrière qui ne converge pas : arrêt après 3 tours", () => {
  const rows = afterWave0();
  set(rows, inSessions("S1A", "S1B"), "IN_REVIEW");
  const p = plan(rows, { ...merged0, state: { sessions: {}, gates: { G1: { rounds: 3 } } } });
  assert.deepEqual(types(p), ["STOP_OWNER:GATE_NOT_CONVERGING"]);
  assert.equal(p.exitCode, 10);
});

test("verdict favorable : fusion ; tickets de barrière DONE : la vague 2 part sur 3 voies distinctes", () => {
  const rows = afterWave0();
  set(rows, inSessions("S1A", "S1B"), "DONE");
  set(rows, inSessions("G1"), "IN_REVIEW");
  assert.deepEqual(types(plan(rows, merged0)), ["MERGE:G1"]);
  set(rows, inSessions("G1"), "DONE");
  // Tickets de barrière DONE mais branches non fusionnées : la vague suivante ne démarre pas.
  assert.deepEqual(types(plan(rows, merged0)), ["MERGE:G1"]);
  const p = plan(rows, merged1);
  assert.deepEqual(types(p), ["DISPATCH:P2-A", "DISPATCH:P2-B", "DISPATCH:P2-C"]);
  assert.deepEqual(p.actions.map((a) => a.lane), ["EDI-1", "FRONT-1", "FRONT-2"]);
  assert.equal(new Set(p.actions.map((a) => a.lane)).size, 3);
});

test("ticket BLOCKED : signalé tout de suite, les autres sessions continuent, la barrière n'ouvre pas", () => {
  const rows = afterWave0();
  set(rows, inSessions("S1A", "S1B", "G1"), "DONE");
  set(rows, (t) => t.task_id === "T-P2C-01", "BLOCKED");
  let p = plan(rows, merged1);
  assert.equal(p.actions[0].type, "UNBLOCK");
  assert.deepEqual(p.actions[0].tickets, ["T-P2C-01"]);
  assert.ok(types(p).includes("DISPATCH:P2-A"));
  set(rows, inSessions("P2-A", "P2-B"), "IN_REVIEW");
  set(rows, (t) => t.session_id === "P2-C" && t.status === "TODO", "IN_REVIEW");
  p = plan(rows, merged1);
  assert.deepEqual(types(p), ["UNBLOCK:"]);
});

test("piétinement : 3 tours de voie sans changement d'état arrêtent la session", () => {
  const rows = afterWave0();
  set(rows, (t) => t.task_id === "T-S1A-01", "IN_REVIEW");
  let state;
  let p;
  for (let i = 0; i < 4; i += 1) { p = plan(rows, { ...merged0, completed: ["S1A"], state }); state = p.state; }
  assert.deepEqual(types(p), ["STOP_OWNER:SESSION_STALLED"]);
  set(rows, (t) => t.task_id === "T-S1A-02", "IN_REVIEW");
  p = plan(rows, { ...merged0, completed: ["S1A"], state });
  assert.deepEqual(types(p), ["DISPATCH:S1A"]); // un progrès remet le compteur à zéro
});

test("après la fusion de G4 : arrêt avant S5, sauf feu vert ; tout DONE : terminé sans tag automatique", () => {
  const rows = seed();
  set(rows, (t) => t.session_id !== "S5", "DONE");
  let p = plan(rows, mergedAll);
  assert.deepEqual(types(p), ["STOP_OWNER:READY_FOR_S5"]);
  p = plan(rows, { ...mergedAll, allowS5: true });
  assert.deepEqual(p.actions.map((a) => `${a.type}:${a.ticket}`), ["PILOT_TICKET:T-S5-01"]);
  set(rows, (t) => t.task_id === "T-S5-01", "IN_REVIEW");
  p = plan(rows, { ...mergedAll, allowS5: true });
  assert.deepEqual(p.actions.map((a) => `${a.type}:${a.ticket}`), ["AUDIT_TICKET:T-S5-02"]);
  set(rows, inSessions("S5"), "DONE");
  p = plan(rows, mergedAll);
  assert.equal(p.actions[0].type, "COMPLETE");
  assert.equal(p.exitCode, 11);
});

test("lecture d'un résultat GetTable précédé de texte, et backlog incohérent", () => {
  const rows = seed();
  const dump = `[résultat volumineux écrit dans un fichier]\n\n${JSON.stringify({ tableId: "x", title: "fisca_master_backlog", rows })}`;
  assert.equal(parseBacklog(dump).length, 132);
  rows.push({ ...rows[0] });
  assert.deepEqual(types(plan(rows)), ["STOP_OWNER:BACKLOG_INCOHERENT"]);
});

test("voie occupée : aucun double envoi ; tout le monde travaille : WAIT, pas d'arrêt", () => {
  const rows = afterWave0();
  set(rows, inSessions("S1A", "S1B", "G1"), "DONE");
  let p = plan(rows, { ...merged1, running: ["P2-B"] });
  assert.deepEqual(types(p), ["DISPATCH:P2-A", "DISPATCH:P2-C"]);
  assert.match(p.notes.join(" "), /P2-B : la voie FRONT-1 travaille encore/);
  p = plan(rows, { ...merged1, running: ["P2-A", "P2-B", "P2-C"] });
  assert.deepEqual(types(p), ["WAIT:"]);
  assert.equal(p.exitCode, 0);
  set(rows, inSessions("P2-A", "P2-B", "P2-C"), "IN_REVIEW");
  p = plan(rows, { ...merged1, running: ["G2"] });
  assert.deepEqual(types(p), ["WAIT:"]);
});

test("deux sessions ouvertes sur la même voie : une seule est envoyée par tick", () => {
  const rows = afterWave0();
  set(rows, inSessions("S1A", "S1B", "G1"), "DONE");
  const sameLane = structuredClone(scopes);
  sameLane.sessions.find((s) => s.session_id === "P2-C").lane = "FRONT-1";
  const p = computePilotPlan({ backlog: rows, scopes: sameLane, ...merged1 });
  assert.deepEqual(types(p), ["DISPATCH:P2-A", "DISPATCH:P2-B"]);
  assert.match(p.notes.join(" "), /P2-C attend que la voie FRONT-1 soit libre/);
});

test("simulation de bout en bout : les 132 tickets atteignent DONE sans interblocage, vagues dans l'ordre", () => {
  const rows = seed();
  const byId = new Map(rows.map((t) => [t.task_id, t]));
  const merged = new Set();
  const order = [];
  let state;
  let ticks = 0;
  for (;;) {
    ticks += 1;
    assert.ok(ticks < 400, `pas de terminaison après ${ticks} ticks : ${order.slice(-6).join(" ")}`);
    const p = computePilotPlan({ backlog: rows, scopes, mergedBranches: [...merged], state, allowS5: true });
    state = p.state;
    const first = p.actions[0];
    if (first.type === "COMPLETE") break;
    assert.notEqual(first.type, "STOP_OWNER", JSON.stringify(first));
    for (const a of p.actions) {
      order.push(`${a.type}:${a.ticket ?? a.session ?? a.gate}`);
      if (a.type === "DISPATCH" || a.type === "PILOT_SESSION") {
        // Un tour de voie : tous les tickets exécutables à cet instant passent à IN_REVIEW.
        const waveOf = (sid) => scopes.sessions.find((s) => s.session_id === sid).wave;
        const ready = rows.filter((t) => t.session_id === a.session && t.status === "TODO" && t.depends_on.every((d) => {
          const dep = byId.get(d);
          return dep.status === "DONE" || (dep.status === "IN_REVIEW" && waveOf(dep.session_id) === waveOf(t.session_id));
        }));
        assert.ok(ready.length > 0, `${a.session} envoyée sans ticket exécutable`);
        ready.forEach((t) => { t.status = "IN_REVIEW"; });
      } else if (a.type === "GATE") {
        const audited = a.gate === "PONT_S0" ? ["S0"] : a.sessions;
        set(rows, (t) => audited.includes(t.session_id) || t.session_id === a.gate, "DONE");
      } else if (a.type === "MERGE") {
        a.branches.forEach((b) => merged.add(b));
      } else if (a.type === "PILOT_TICKET" || a.type === "AUDIT_TICKET") {
        byId.get(a.ticket).status = "DONE";
      }
    }
  }
  assert.ok(rows.every((t) => t.status === "DONE"));
  const firstIndex = (label) => order.indexOf(label);
  const sequence = ["PILOT_SESSION:S0", "GATE:PONT_S0", "MERGE:PONT_S0", "DISPATCH:S1A", "DISPATCH:S1B", "GATE:G1", "MERGE:G1",
    "DISPATCH:P2-A", "GATE:G2", "MERGE:G2", "DISPATCH:P3-A", "GATE:G3", "MERGE:G3", "DISPATCH:P4-C", "GATE:G4", "MERGE:G4", "PILOT_TICKET:T-S5-01"];
  sequence.forEach((label, i) => {
    assert.ok(firstIndex(label) >= 0, `${label} absent`);
    if (i > 0) assert.ok(firstIndex(sequence[i - 1]) < firstIndex(label), `${sequence[i - 1]} doit précéder ${label}`);
  });
});

