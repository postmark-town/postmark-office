// read-eval/report.mjs — a round's results page, from its run files (POS-486).
//
//   writeReport(<round dir>)  ->  <round dir>/results.md
//
// Variant × task: success rate, median tokens, median tool calls and median
// time; a per-variant line; then every agent's feedback, by variant, verbatim.
// The themes are read from that feedback by a person and written beside this
// page; a tool that summarized them would be a second author of what the agents
// said.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const k = (n) => (n == null ? "–" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const s = (ms) => (ms == null ? "–" : `${Math.round(ms / 1000)} s`);

export function loadRuns(dir) {
  const runs = join(dir, "runs");
  if (!existsSync(runs)) return [];
  return readdirSync(runs).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(runs, f), "utf8")));
}

export function writeReport(dir) {
  const round = existsSync(join(dir, "round.json")) ? JSON.parse(readFileSync(join(dir, "round.json"), "utf8")) : {};
  // a column is a runtime and a variant ("claude v1", "codex v1"); runs before the second runtime carry no runtime and were Claude's
  const runs = loadRuns(dir).map((r) => ({ ...r, col: `${r.runtime ?? "claude"} ${r.variant}` }));
  const variants = [...new Set(runs.map((r) => r.col))].sort();
  const tasks = [...new Set(runs.map((r) => r.task))].sort((a, b) => a - b);
  const name = (t) => runs.find((r) => r.task === t)?.task_name ?? `task ${t}`;
  const cell = (rs) => {
    if (!rs.length) return "–";
    const pass = rs.filter((r) => r.pass).length;
    return `${pass}/${rs.length} · ${k(median(rs.map((r) => r.tokens?.total)))} tok · ${k(median(rs.map((r) => r.calls)))} calls · ${s(median(rs.map((r) => r.wall_ms)))}`;
  };
  const L = [];
  L.push(`# Read-shape eval: results`, "");
  L.push(`Round started ${round.started ?? "?"}. Agents: ${round.model ?? "?"} at ${round.effort ?? "?"} effort, as ${round.handle ?? "?"} (household ${round.household ?? "?"}). Office ${String(round.office ?? "?").slice(0, 9)}, town ${String(round.clones?.town ?? "?").slice(0, 9)}, world ${String(round.clones?.world ?? "?").slice(0, 9)}. ${runs.length} runs.`, "");
  L.push("Each cell: passed/runs · median total tokens (input + cache writes + cache reads + output) · median tool calls · median wall time. Success is read from the run's store, the town clone's ledger, or (for a question) the answer against the fold; never from the agent's own claim.", "");
  L.push(`| task | ${variants.join(" | ")} |`, `|---|${variants.map(() => "---").join("|")}|`);
  for (const t of tasks) L.push(`| ${t} ${name(t)} | ${variants.map((v) => cell(runs.filter((r) => r.col === v && r.task === t))).join(" | ")} |`);
  L.push(`| **all** | ${variants.map((v) => `**${cell(runs.filter((r) => r.col === v))}**`).join(" | ")} |`, "");
  L.push("## Per variant", "");
  for (const v of variants) {
    const rs = runs.filter((r) => r.col === v);
    const sum = (f) => rs.reduce((a, r) => a + (f(r) ?? 0), 0);
    L.push(`- **${v}**: ${rs.filter((r) => r.pass).length}/${rs.length} passed; tokens ${k(sum((r) => r.tokens?.total))} in all (median ${k(median(rs.map((r) => r.tokens?.total)))}); output tokens median ${k(median(rs.map((r) => r.tokens?.output)))}; tool calls ${sum((r) => r.calls)} in all; characters the door answered, median per run ${k(median(rs.map((r) => r.call_chars)))}; cost $${sum((r) => r.cost_usd).toFixed(2)}${rs.some((r) => r.harness_error) ? `; ${rs.filter((r) => r.harness_error).length} harness failure(s)` : ""}.`);
  }
  L.push("", "## Every run", "", "| run | pass | tokens | calls | door chars | time | why |", "|---|---|---|---|---|---|---|");
  for (const r of [...runs].sort((a, b) => a.task - b.task || a.col.localeCompare(b.col) || a.repeat - b.repeat))
    L.push(`| ${r.run} | ${r.pass ? "yes" : "no"} | ${k(r.tokens?.total)} | ${r.calls ?? "–"} | ${k(r.call_chars)} | ${s(r.wall_ms)} | ${String(r.why ?? "").replace(/\|/g, "/")} |`);
  L.push("", "## Feedback, verbatim", "");
  for (const v of variants) {
    L.push(`### ${v}`, "");
    for (const r of runs.filter((x) => x.col === v).sort((a, b) => a.task - b.task || a.repeat - b.repeat))
      L.push(`**${r.run}** (${r.pass ? "passed" : "failed"}): ${String(r.feedback ?? "(none)").replace(/\s*\n+\s*/g, " ")}`, "");
  }
  const out = join(dir, "results.md");
  writeFileSync(out, L.join("\n") + "\n");
  return out;
}
