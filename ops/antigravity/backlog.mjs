#!/usr/bin/env node
// Backlog vivant (remplace la table Hyperagent fisca_master_backlog).
// Fichier : $FISCA_RT/state/backlog.json (tableau de 132 lignes). Instantané versionné : ops/state/backlog.json.
// Usage : node backlog.mjs count | get <task_id> | set <task_id> champ=valeur ... | list <session_id> | snapshot <chemin>
import { readFileSync, writeFileSync, renameSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
const file = process.env.FISCA_BACKLOG ?? `${process.env.FISCA_RT ?? homedir() + "/.fisca-runtime"}/state/backlog.json`;
const STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "BLOCKED"];
const raw = JSON.parse(readFileSync(file, "utf8"));
const rows = Array.isArray(raw) ? raw : raw.rows; // tolère l'enveloppe {rows:[…]} de l'export Hyperagent
const [cmd, a, ...rest] = process.argv.slice(2);
const save = () => { writeFileSync(file + ".tmp", JSON.stringify(rows, null, 2) + "\n"); renameSync(file + ".tmp", file); };
if (cmd === "count") {
  const c = {}; for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
  console.log(JSON.stringify({ total: rows.length, ...c }));
} else if (cmd === "get") {
  console.log(JSON.stringify(rows.find((r) => r.task_id === a) ?? null, null, 2));
} else if (cmd === "list") {
  for (const r of rows.filter((x) => x.session_id === a)) console.log(`${r.task_id}\t${r.status}\t${r.task_title ?? ""}`);
} else if (cmd === "set") {
  const r = rows.find((x) => x.task_id === a); if (!r) { console.error("ticket inconnu"); process.exit(1); }
  for (const kv of rest) { const i = kv.indexOf("="); const k = kv.slice(0, i); let v = kv.slice(i + 1);
    if (v === "null") v = null; else if (v === "true" || v === "false") v = v === "true"; else if (v !== "" && !isNaN(Number(v)) && k !== "task_id") v = Number(v);
    if (k === "status" && !STATUSES.includes(v)) { console.error("statut invalide"); process.exit(1); }
    r[k] = v; }
  r.updated_at = new Date().toISOString(); save(); console.log("ok");
} else if (cmd === "snapshot") { copyFileSync(file, a); console.log("ok"); }
else { console.error("Usage : count | get <id> | list <session> | set <id> champ=valeur … | snapshot <chemin>"); process.exit(2); }
