// deploy/loop-lag-keep.mjs, run by postmark-loop-lag-keep.timer (POS-1098; Wright's go 2026-11-23 16:03 EST): the office's loop-lag record keeps only the last 60
// minutes (telemetry/loop-lag-4380.json). This keeps every minute it has ever shown, deduped, in a dated JSONL, and
// snapshots the whole record beside the Postgres lines whenever a new idle-in-transaction kill appears, so the next
// stall can be tied to its requests. Read-only on everything but its own two folders. Run every 5 minutes, as root.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
const SRC = "/srv/postmark-office/telemetry/loop-lag-4380.json";
const KEEP = "/var/lib/postmark-loop-lag-keep";
const STATE = `${KEEP}/state.json`;
mkdirSync(`${KEEP}/minutes`, { recursive: true }); mkdirSync(`${KEEP}/kills`, { recursive: true });
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { last_minute: "", last_kill_line: "" };
const rec = JSON.parse(readFileSync(SRC, "utf8"));
const timeOf = (m) => String(m.minute ?? m.at ?? m.t ?? m.ts ?? "");
let kept = 0;
for (const m of (rec.minutes ?? []).slice().sort((a, b) => timeOf(a).localeCompare(timeOf(b)))) {
  const t = timeOf(m); if (!t || t <= state.last_minute) continue;
  appendFileSync(`${KEEP}/minutes/loop-lag-${t.slice(0, 10)}.jsonl`, JSON.stringify(m) + "\n"); state.last_minute = t; kept++;
}
// kills: the Postgres log's idle-in-transaction lines newer than the last one seen
let kills = [];
try {
  const out = execFileSync("grep", ["-h", "idle-in-transaction timeout", "/var/log/postgresql/postgresql-16-main.log"], { encoding: "utf8" });
  kills = out.trim().split("\n").filter((l) => l && l > state.last_kill_line);
} catch { /* grep exits 1 on no match */ }
if (kills.length) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(`${KEEP}/kills/kill-${stamp}.json`, JSON.stringify({ at: new Date().toISOString(), kills, loop_lag: rec }, null, 1));
  state.last_kill_line = kills[kills.length - 1];
}
writeFileSync(STATE, JSON.stringify(state));
console.log(`kept ${kept} new minute(s); ${kills.length} new kill line(s)${kills.length ? " snapshotted" : ""}; last minute ${state.last_minute}`);
