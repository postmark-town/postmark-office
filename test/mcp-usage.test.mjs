// mcp-usage.test.mjs — the report over the access line's `call` (POS-722).
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/mcp-usage.test.mjs
//
// A fixture week of lines, a hot day and a cold (gzipped) one, read by the tool
// itself as the entry: counts by tool, act and read, the bounce rate by act,
// and out_bytes p50/p95 by read.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tally } from "../tools/mcp-usage.mjs";
import { removeTempDir, tempDir } from "./helpers/temp-dir.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = tempDir("mcp-usage-");
after(() => removeTempDir(dir));

const line = (ts, mcp, call, extra = {}) => JSON.stringify({ ts, path: mcp ? "/mcp" : "/household", status: 200, household: "h", mcp, ...(call ? { call } : {}), ...extra });
const DAY_OLD = [ // before --since: never read
  line("2026-10-18T10:00:00Z", "household", { tool: "household", read: "house", out_bytes: 1 }),
];
const DAY_COLD = [
  line("2026-10-20T10:00:00Z", "household", { tool: "household", read: "house", out_bytes: 100 }),
  line("2026-10-20T10:01:00Z", "household", { tool: "household", read: "house", out_bytes: 300 }),
  line("2026-10-20T10:02:00Z", "household", { tool: "household", do: "send", out_bytes: 50, bounce: 422 }),
  line("2026-10-20T10:03:00Z", "world_orient", null), // a line from before POS-722: a tool, no call
  "{ a torn line",
];
const DAY_HOT = [
  line("2026-10-21T10:00:00Z", "household", { tool: "household", read: "house", out_bytes: 200 }),
  line("2026-10-21T10:01:00Z", "household", { tool: "household", do: "send", out_bytes: 40 }),
  line("2026-10-21T10:02:00Z", "household", { tool: "household", do: "send", out_bytes: 40 }),
  line("2026-10-21T10:03:00Z", "household", { tool: "household", do: "send", out_bytes: 40 }),
  line("2026-10-21T10:04:00Z", "world", { tool: "world", out_bytes: 70000 }),
  line("2026-10-21T10:05:00Z", null, { tool: "household", read: "doorstep", out_bytes: 900 }),
];
writeFileSync(join(dir, "access-2026-10-18.jsonl"), DAY_OLD.join("\n") + "\n");
writeFileSync(join(dir, "access-2026-10-20.jsonl.gz"), gzipSync(DAY_COLD.join("\n") + "\n"));
writeFileSync(join(dir, "access-2026-10-21.jsonl"), DAY_HOT.join("\n") + "\n");

test("the tool, as the entry: a hot day and a cold one, from --since on", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "tools", "mcp-usage.mjs"), "--since", "2026-10-19", "--dir", dir, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const t = JSON.parse(r.stdout);
  assert.equal(t.lines, 10, "the torn line is skipped and the day before --since is never read");
  assert.equal(t.shaped, 9);
  assert.deepEqual(t.tools, [["household", 7], ["household (rest)", 1], ["world", 1], ["world_orient", 1]]);
  assert.deepEqual(t.acts, [{ act: "household do:send", calls: 4, bounced: 1, bounce_rate: 0.25 }]);
  assert.deepEqual(t.reads, [
    { read: "household read:house", calls: 3, out_bytes_p50: 200, out_bytes_p95: 300 },
    { read: "household read:doorstep", calls: 1, out_bytes_p50: 900, out_bytes_p95: 900 },
    { read: "world (bare)", calls: 1, out_bytes_p50: 70000, out_bytes_p95: 70000 },
  ]);
});

test("the plain report says the same, in lines", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "tools", "mcp-usage.mjs"), "--since", "2026-10-19", "--dir", dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^mcp-usage since 2026-10-19: 10 lines, 9 with a call shape/);
  assert.match(r.stdout, /\n\s+4\s+25\.0%\s+household do:send\n/);
  assert.match(r.stdout, /\n\s+3\s+200 \/\s+300\s+household read:house\n/);
});

test("the tally alone, and its refusals", () => {
  assert.deepEqual(tally([]), { lines: 0, shaped: 0, tools: [], acts: [], reads: [] });
  const none = spawnSync(process.execPath, [join(ROOT, "tools", "mcp-usage.mjs")], { encoding: "utf8" });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /usage: mcp-usage\.mjs --since <YYYY-MM-DD>/);
  const bad = spawnSync(process.execPath, [join(ROOT, "tools", "mcp-usage.mjs"), "--since", "yesterday", "--dir", dir], { encoding: "utf8" });
  assert.equal(bad.status, 2, "a date that is not YYYY-MM-DD is refused, never compared as text");
});
