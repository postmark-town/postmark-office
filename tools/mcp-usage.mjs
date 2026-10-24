#!/usr/bin/env node
// mcp-usage.mjs — how the doors are actually being used, from the access line's
// `call` object (POS-722, src/call-shape.mjs).
//
//   node tools/mcp-usage.mjs --since 2026-10-20 [--dir <telemetry dir>] [--json]
//
// Reads telemetry/access-YYYY-MM-DD.jsonl and the cold days' .jsonl.gz (the
// world-report loop), every day from --since on, and prints:
//
//   · calls by tool (the MCP tool name, or "<apex> (rest)" for a REST apex call);
//   · calls by act and by read, each as "<tool> do:<act>" / "<tool> read:<read>",
//     with a bare apex call as "<tool> (bare)";
//   · the bounce rate by act;
//   · out_bytes p50 / p95 by read.
//
// A line written before POS-722 has no `call` and counts toward the tools only.
// The dir defaults to $OFFICE_TELEMETRY, then the box's /srv/postmark-office/telemetry.

import { createReadStream, existsSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The days' files at or after `since`, oldest first. */
export function filesSince(dir, since) {
  return readdirSync(dir)
    .map((f) => ({ f, day: /^access-(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$/.exec(f)?.[1] }))
    .filter((x) => x.day && x.day >= since)
    .sort((a, b) => a.f.localeCompare(b.f))
    .map((x) => join(dir, x.f));
}

/** Every parseable line of the files, in order; a torn line or a broken .gz is skipped, as every reader of this log does. */
export async function* lines(files) {
  for (const file of files) {
    const input = file.endsWith(".gz") ? createReadStream(file).pipe(createGunzip()) : createReadStream(file);
    try {
      for await (const ln of createInterface({ input, crlfDelay: Infinity })) {
        try { yield JSON.parse(ln); } catch {}
      }
    } catch {}
  }
}

const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null);

/** The counts, one access-line record at a time (a week of the log is never held whole: the box has 1.9 GB). */
export function tallier() {
  const tools = new Map(), acts = new Map(), reads = new Map(), bounced = new Map(), sizes = new Map();
  let lines = 0, shaped = 0;
  const add = (r) => {
    lines++;
    const call = r?.call && typeof r.call === "object" ? r.call : null;
    const tool = r?.mcp ? String(r.mcp) : call ? `${call.tool} (rest)` : null;
    if (tool) bump(tools, tool);
    if (!call) return;
    shaped++;
    const name = call.tool;
    if (call.do != null) {
      const act = `${name} do:${call.do}`;
      bump(acts, act);
      if (call.bounce != null && call.bounce !== false) bump(bounced, act);
    } else {
      const read = call.read != null ? `${name} read:${call.read}` : `${name} (bare)`;
      bump(reads, read);
      if (Number.isFinite(call.out_bytes)) (sizes.get(read) ?? sizes.set(read, []).get(read)).push(call.out_bytes);
    }
  };
  const byCount = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const result = () => ({
    lines, shaped,
    tools: byCount(tools),
    acts: byCount(acts).map(([act, n]) => ({ act, calls: n, bounced: bounced.get(act) ?? 0, bounce_rate: n ? (bounced.get(act) ?? 0) / n : 0 })),
    reads: byCount(reads).map(([read, n]) => {
      const s = (sizes.get(read) ?? []).sort((a, b) => a - b);
      return { read, calls: n, out_bytes_p50: pct(s, 50), out_bytes_p95: pct(s, 95) };
    }),
  });
  return { add, result };
}

/** The counts of a list of records. */
export function tally(records) { const t = tallier(); for (const r of records) t.add(r); return t.result(); }

export function render(t, since) {
  const out = [`mcp-usage since ${since}: ${t.lines} lines, ${t.shaped} with a call shape`, "", "by tool"];
  for (const [tool, n] of t.tools) out.push(`  ${String(n).padStart(8)}  ${tool}`);
  out.push("", "by act (calls, bounce rate)");
  for (const a of t.acts) out.push(`  ${String(a.calls).padStart(8)}  ${(100 * a.bounce_rate).toFixed(1).padStart(5)}%  ${a.act}`);
  out.push("", "by read (calls, out_bytes p50 / p95)");
  for (const r of t.reads) out.push(`  ${String(r.calls).padStart(8)}  ${String(r.out_bytes_p50 ?? "-").padStart(8)} / ${String(r.out_bytes_p95 ?? "-").padStart(8)}  ${r.read}`);
  return out.join("\n");
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const since = arg("--since");
  if (!since || !DAY_RE.test(since)) { console.error("usage: mcp-usage.mjs --since <YYYY-MM-DD> [--dir <telemetry dir>] [--json]"); return 2; }
  const dir = arg("--dir") ?? process.env.OFFICE_TELEMETRY ?? "/srv/postmark-office/telemetry";
  if (!existsSync(dir)) { console.error(`mcp-usage: no telemetry at ${dir}`); return 2; }
  const counting = tallier();
  for await (const r of lines(filesSince(dir, since))) counting.add(r);
  const t = counting.result();
  console.log(argv.includes("--json") ? JSON.stringify({ since, ...t }, null, 1) : render(t, since));
  return 0;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exitCode = await main(process.argv.slice(2));
