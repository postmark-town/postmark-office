// twin-golden.mjs — the office.db twins' answers, frozen (POS-656).
//
// Until POS-656 these suites held each store reader, and each door switched to
// the store, equal to its office.db twin asked alike over one fixture town.
// office.db is gone, so the twins' answers were recorded once, in the last tree
// that had both (train/2026-w43 at 941a0ed40; the PR names the run), over the
// same fixture rows, and the suites hold the store to that record:
// test/golden/office-db-twins/<suite>.json, each label mapped to the twin's
// answer as the suite compared it (a door's status and bytes, or a reader's
// JSON). A label the record lacks fails by name, so a renamed ask cannot pass
// quietly against nothing.
//
// TWIN_GOLDEN_RECORD=<dir> is how the record was made: the base tree's suites,
// patched to call `record` with each twin answer, wrote <dir>/<suite>.json.
// No suite in this tree records.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The town's day, as the town's own townDay() counts it (America/New_York unless TOWN_TZ).
const townDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date());

// Fields that are the live clock, not the index: the next boat, the crossing a
// copy has caught up to as of now, when a standing letter is expected to sail,
// the crossings an outcomes read spans, the next settlement and when a stake
// catches up to it, and when the world-write budget resets.
const LIVE = new Set(["next_crossing", "copy", "expected_crossing", "since_crossing", "through_crossing",
  "next_settlement", "catches_up_at", "resets_at"]);

/**
 * An answer as the record keeps it: its JSON text with the live clock taken
 * out, so the record holds on any day. The LIVE fields go, and the town's day,
 * wherever an answer states it (`today.day`, a quest row's day) or mints it
 * into a letter id, reads "<today>". JSON carried as text (an MCP result's
 * content) is opened, so its clock goes too. A failed command's own words
 * (git's, inside an "unreadable" note, with the test's temp path in them) and a
 * checkout's line endings differ by machine and by run: the first reads
 * "(<a command failed>)", CRLF reads LF, and a hung pane's file size (the
 * checkout's bytes) is left out. Every other byte stays, key order included.
 */
export function steady(value, { today = townDay() } = {}) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "undefined";
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "string" && /^\s*[{[]/.test(v)) { try { return { "<json>": walk(JSON.parse(v)) }; } catch { /* prose that starts with a bracket */ } }
    if (typeof v === "string" && v.includes("(Command failed: ")) return v.replace(/\(Command failed: [\s\S]*$/, "(<a command failed>)");
    if (typeof v === "string") {
      // a checkout's line endings are the machine's (git's autocrlf on Windows), not the office's
      const s = v.replace(/\r\n/g, "\n");
      return s === today ? "<today>" : s.split(`-${today}-to-`).join("-<today>-to-");
    }
    if (!v || typeof v !== "object") return v;
    const out = {};
    // a hung pane's `bytes` is its file's size in this checkout, line endings and all
    const checkout = (k) => k === "bytes" && Object.hasOwn(v, "hung");
    for (const [k, x] of Object.entries(v)) if (!LIVE.has(k) && !checkout(k)) out[k] = walk(x);
    return out;
  };
  try { return JSON.stringify(walk(JSON.parse(text))); } catch { return text.split(today).join("<today>"); }
}

export function twinGolden(suite) {
  const recording = process.env.TWIN_GOLDEN_RECORD;
  const taken = {};
  if (recording) process.on("exit", () => writeFileSync(join(recording, `${suite}.json`), JSON.stringify(taken, null, 1) + "\n"));
  let book = null;
  const read = () => (book ??= JSON.parse(readFileSync(new URL(`../golden/office-db-twins/${suite}.json`, import.meta.url), "utf8")));
  // read back through `steady` too, so the record and a new answer are held to one rule
  const of = (label) => {
    const b = read();
    if (!Object.hasOwn(b, label)) throw new Error(`${suite}: no recorded twin answer for "${label}" (test/golden/office-db-twins/${suite}.json)`);
    return steady(b[label]);
  };
  return {
    /** The base tree's side: keep the twin's answer under its label. A label asked twice must answer alike. */
    record(label, value) {
      const v = steady(value);
      if (Object.hasOwn(taken, label) && taken[label] !== v) throw new Error(`${suite}: "${label}" was recorded twice with different answers`);
      taken[label] = v;
      return value;
    },
    /** The base tree's side, for a door: its status and bytes. */
    async recordResponse(label, response) {
      const body = await response.text();
      this.record(label, { status: response.status, body: steady(body) });
      return new Response(body, { status: response.status, headers: response.headers });
    },
    /** The twin's recorded answer for `label`, as `steady` keeps it. */
    of,
    /** This answer is the twin's, as recorded. */
    equal(label, value, message = label) { assert.equal(steady(value), of(label), message); },
    /** This door's answer is the twin's: the same status and the same bytes. */
    async equalResponse(label, response, message = label) {
      const body = await response.text();
      assert.equal(steady({ status: response.status, body: steady(body) }), of(label), message);
      return body;
    },
  };
}
