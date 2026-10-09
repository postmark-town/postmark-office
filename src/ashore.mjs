// ashore.mjs — the store's record that a handle came ashore (POS-444, 071_ashore.sql).
//
// RULED (Darko, 2026-10-08, A). Until this record, "does this handle stand
// ashore" had one answer, the town index: a COPY of the town repo that the
// ingest refreshes between crossings. A house the declaration door had just
// answered `settled: true` was refused mail as a harbor act until that copy
// caught up. The registry could not answer instead, because a harbor house
// and a settled one have the same rows.
//
// TWO HALVES, ONE TABLE.
//
//   · recordAshore: every road that lands an ADDRESS writes one row, in the
//     same act, AFTER the address's commit has landed (declare-exec.mjs,
//     join-bind.mjs; the drain's settle waits for w43 with POS-268 5b). After,
//     never before: a row ahead of its address would open the harbor gate for
//     a house that is not ashore, and a row that fails to land leaves the
//     handle exactly where it stood without this file, in the copy at the next
//     ingest. So the write never throws and never refuses the act it records.
//
//   · ashoreOf: the readers ask it ONLY when the copy does not know a handle
//     (oauth.mjs § householdFor's harbor stamp, send-at-door.mjs §
//     recipientProbe). A retired pin is not ashore. A store that cannot be
//     asked answers null, and every reader keeps the copy's answer on null: an
//     unreadable record never widens a gate.

import { execFileSync } from "node:child_process";
import { actsQuery } from "./world2-acts.mjs";
import { probeOf } from "./index-probe.mjs";

/** The roads a row may name (071's CHECK). */
export const ASHORE_ROADS = Object.freeze(["declare", "join-bind", "drain", "backfill"]);

/** The committer date of `sha` in `clone`, as ISO. */
const commitTime = (clone, sha) =>
  new Date(execFileSync("git", ["-C", clone, "show", "-s", "--format=%cI", sha], { encoding: "utf8" }).trim()).toISOString();

/**
 * Record that `handle` came ashore by `road` in the landed commit `sha`.
 * Answers `{ recorded: true }`, or `{ recorded: false, why }` and logs the miss.
 * Never throws.
 */
export async function recordAshore({ handle, sha, road, clone, log = console }, env = process.env) {
  let why;
  try {
    const at = commitTime(clone, sha);
    const rows = await actsQuery(
      "INSERT INTO ashore (handle, at, sha, road) VALUES ($1, $2, $3, $4) ON CONFLICT (handle) DO NOTHING RETURNING handle",
      [handle, at, sha, road], env);
    if (rows === null) why = "the office is not pointed at the store";
    else if (rows.length === 1) return { recorded: true };
    else why = "the store already holds this handle ashore";
  } catch (e) { why = String(e?.message ?? e).split("\n")[0].slice(0, 200); }
  log.error?.(`[ashore] ${handle} (${road}, ${String(sha).slice(0, 12)}) was not recorded: ${why}. The town index takes it at its next ingest.`);
  return { recorded: false, why };
}

/**
 * Which of `handles` the store holds ashore (a row, and no pin that retired it
 * or renamed it away: a renamed handle is ashore under its new name, never its
 * old one): a Set, or null when the store cannot be asked.
 */
export async function ashoreOf(handles, env = process.env) {
  const list = [...new Set(handles ?? [])].filter((h) => typeof h === "string" && h);
  if (!list.length) return new Set();
  try {
    const rows = await actsQuery(
      `SELECT a.handle FROM ashore a
        WHERE a.handle = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM household_pins p
                           WHERE p.handle = a.handle AND (p.retired IS NOT NULL OR p.renamed_to IS NOT NULL))`,
      [list], env);
    return rows === null ? null : new Set(rows.map((r) => r.handle));
  } catch { return null; }
}

// ── THE RECIPIENT CHECK'S PROBE, FOR THE DOOR AND THE DRAIN ALIKE ────────────
//
// validateLetter's `no resident "x"` asks the index, a copy that trails the
// record. The send door wraps the probe so a recipient the copy lacks and the
// store holds ashore reads as a resident (POS-444). The DRAIN replays that same
// letter through that same check at the crossing, with a probe it loaded itself,
// so it must take the same wrap: a door that accepted a letter the crossing then
// bounces has lost a letter the sender was told was accepted (the 10-08 review).
// One function, so the two cannot disagree about who lives here.

/**
 * `db` (an office.db handle, a probe, or null on a switched office) for the
 * letters to `tos`: itself when the copy knows every recipient or the store
 * holds none of the missing ones ashore, else a probe whose `hasResident` also
 * answers yes for those. A copy that cannot be asked is left to throw in the
 * check's own order.
 */
export async function recipientsProbe(db, tos, { env = process.env } = {}) {
  const ix = probeOf(db, { env });
  if (!ix) return db;
  const missing = [];
  for (const to of new Set(tos ?? [])) {
    if (typeof to !== "string" || !to) continue;
    try { if (!ix.hasResident(to)) missing.push(to); }
    catch { return db; }
  }
  if (!missing.length) return db;
  const ashore = await ashoreOf(missing, env);   // null (could not look): the copy's answer stands
  if (!ashore?.size) return db;
  return Object.freeze({ ...ix, hasResident: (h) => ashore.has(h) || ix.hasResident(h) });
}
