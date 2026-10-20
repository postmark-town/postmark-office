// Access telemetry — the readership layer of the traffic dashboard.
//
// One JSONL line per HTTP request, appended to telemetry/access-YYYY-MM-DD.jsonl
// under the office root (systemd ProtectSystem=strict permits writes only inside
// /srv/postmark-office, so the log lives here; the dashboard generator reads it).
//
// Privacy stance: we log WHO read WHAT SURFACE, AND THE SHAPE OF WHAT THEY ASKED
// (household, path, MCP tool name, and the `call` object: the act or read by
// name, the argument field names, values from the office's own fixed sets, the
// answer's size and the refusal's code), and never payloads: no string value an
// argument carried, no number, no defect text. Tool arguments can carry letter
// bodies, handles and ids; src/call-shape.mjs is the one place that reads them,
// and its sentinel test reads the whole line for a planted value.
// Provenance: 2026-07-11 traffic-dashboard arc (Keemin + Wright); the call's
// shape added 2026-10-19 (POS-722, Darko: "collecting data on how the MCP is
// actually being used").

import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// OFFICE_ACCESS_LOG_DIR moves the log for a test's own office; the box sets none.
const DIR = process.env.OFFICE_ACCESS_LOG_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "telemetry");
let made = false;

// ── THE LINE IS BOUNDED, because N READERS SHARE THIS FILE ───────────────────
//
// Read workers (runbook DEC-4 / G3) append to ONE access log from N processes.
// A POSIX `O_APPEND` write is atomic only up to `PIPE_BUF`, which is 4096 bytes
// on Linux; past that the kernel may split it, and two workers writing long
// lines at the same moment interleave — producing two unparseable lines where
// there were two good ones. Every reader here does `try { JSON.parse } catch
// { continue }`, so a torn line is dropped in SILENCE, and it takes the
// innocent partner line down with it. That is the corruption class, and it is
// the one thing about a shared append that a per-worker mind cannot see.
//
// ⚑ WHAT IS ACTUALLY UNBOUNDED IS THE PATHNAME, NOT THE QUERY STRING, and the
// lane's own first write-up said the opposite. `server.mjs` logs
// `url.pathname` with the query already stripped, so a query string never
// reaches this line. MEASURED against the real server, 2026-09-08:
//
//     a 6,000-char pathname          ->  6,143-byte line   OVER
//     a 6,000-char query string      ->    147-byte line   fine (never logged)
//     1,200 emoji in the pathname    -> 14,543-byte line   OVER, and the worst
//                                       case: percent-encoding turns each
//                                       4-byte character into 12 characters
//
// nginx will pass a request line up to `large_client_header_buffers` (8k by
// default), so this is reachable from outside, not a laboratory curiosity.
//
// ⚑ WHAT THE DASHBOARD LOSES: NOTHING. Every consumer of this file was read
// before the cap was chosen — `tools/traffic-report.mjs:221-231` takes `mcp`,
// `ts` and `household`; `tools/world-report.mjs:107-110` takes `mcp` and `ts`;
// `tools/traffic-snapshot.mjs` does not read this file at all. **No consumer
// reads `path`.** The dashboard's path dimension comes from the nginx access
// log, which strips the query string itself (`traffic-report.mjs:140`). So the
// field is kept for the operator reading the raw JSONL by hand, and capped at a
// length that still shows which door was knocked on.
export const PATH_MAX = 512;

// 4096 minus the newline, minus room for the JSON envelope this function may
// have to rebuild. A cap BELOW PIPE_BUF rather than at it, because the number
// that matters is what the kernel sees, and the newline is part of the write.
export const LINE_MAX = 4000;

/**
 * The line this entry becomes, bounded. Exported so a falsifier can drive the
 * bound instead of grepping for the slice — a check on the code's text is not a
 * check on its behaviour, which is this lane's whole carry.
 *
 * Two stages, because one is not a guarantee. Slicing `path` fixes every case
 * anybody has produced; the length check afterwards is what makes the bound
 * TRUE rather than likely, since `household`, `mcp` and `ip` are bounded by
 * convention and not by code, and a bound that rests on convention is the kind
 * that fails the week someone changes the convention.
 */
export function accessLine(entry) {
  const capped = { ...entry, path: String(entry?.path ?? "").slice(0, PATH_MAX) };
  let line = JSON.stringify(capped);
  if (Buffer.byteLength(line, "utf8") + 1 <= LINE_MAX) return line;
  // Still over: drop the path entirely and say so in the record, rather than
  // write a line that can tear. An entry that names its own truncation is
  // readable; a torn one is not, and neither is its neighbour.
  line = JSON.stringify({ ...capped, path: "", path_dropped: true });
  if (Buffer.byteLength(line, "utf8") + 1 <= LINE_MAX) return line;
  // `call` rides the first two stages: it is bounded at call-shape.mjs §
  // CALL_MAX, so it is never what made the line long. Only this resort drops it.
  // The last resort keeps only what the three readers actually consume — AND
  // CAPS THOSE TOO. The first draft of this line kept `household` and `mcp`
  // verbatim, which put the guarantee straight back where it started: the test
  // that drives 5,000-character fields went red on this very branch. A last
  // resort that can itself exceed the bound is not a last resort.
  const cap = (v, n) => (v == null ? v : String(v).slice(0, n));
  return JSON.stringify({
    ts: cap(capped.ts, 32),
    household: cap(capped.household, 128),
    mcp: cap(capped.mcp, 128),
    truncated: true,
  });
}

export function logAccess(entry) {
  try {
    if (!made) { mkdirSync(DIR, { recursive: true }); made = true; }
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(join(DIR, `access-${day}.jsonl`), accessLine(entry) + "\n");
  } catch {
    // telemetry must never take down a door
  }
}
