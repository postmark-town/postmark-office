// falsifier-canon-locks.mjs — THE INSTRUMENT THAT WOULD HAVE FOUND THE THREE.
//
// The class (postmark#2594): the store locked a claim at a named candle window
// for a mark canon never carried. In the store's own vocabulary a locked claim
// materialized at a window IS standing; in canon those marks never stood. The two
// records disagreed from the moment of locking and NOTHING WAS LOOKING, for three
// weeks, until a G1 pre-flight lane happened to walk past.
//
// THIS FILE IS THE WHOLE INSTRUMENT, not half of one. A lock-time refusal was
// ruled and then WITHDRAWN on 2026-09-08, because the crossing's settlement
// pushes to origin three to four minutes AFTER the candle clears — seven
// consecutive crossings measured, never once before — so a canon check at the
// lock step would refuse the marks its own crossing just locked. Nothing refuses
// a canon-absent claim anywhere; this read is what finds them, and it runs on the
// NOTARY rail (03:20 UTC) where the push is hours old.
//
// It still asks `canon-register.mjs`, which keeps the predicate and its `fold`
// backend for the G1 swap — at which point the class becomes structurally
// impossible, because the fold writes what the candle locked, and this read stays
// as the detector.
//
// ── WHAT IT LISTS, AND THE ONE THING IT DELIBERATELY DOES NOT ────────────────
//
//   canon-absent   a STANDING mark whose slug has no file in the world's register
//                  at the checkout's sha, with the claim that locked it named
//                  beside it. THIS IS THE ALARM.
//   unmaterialized a locked claim naming a slug NO mark carries. A different
//                  defect — the lock happened and the materialization did not —
//                  and reported on its own line, because one is a disagreement
//                  between two records and the other is a missing record.
//   escrow-absent  a standing COMMONS mark with nothing staked on it at the town
//                  sha of the window that LOCKED it. The 1.0 sweep refuses this
//                  ("commons needs escrow > 0", `settlement-sweep.mjs:1146-1152`)
//                  and G1 deletes the path that rule lives on; `clearing-job.mjs`
//                  step 5.5 stops a new one and this lists the ones already
//                  standing. Its repair is a STAKE, not a retire — which is why
//                  it is a third class and not folded into canon-absent.
//   escrow-unjudgeable  A COUNT, NOT A FINDING (postmark#2935). Commons marks
//                  locked at a window whose town sha the projection holds NO
//                  rows for — every window before 181, migration 014's first
//                  ingest — cannot be judged there, and are counted by window
//                  with the oldest projected sha named beside them. Unavailable,
//                  never ✦0. Before this, 227 such marks read ESCROW-ABSENT on
//                  the roll-call every morning for eight nights, and the number
//                  of TRUE unbacked marks under them was zero.
//
// EACH MARK IS JUDGED AT ITS OWN LOCKING SHA, never at today's town. A mark
// locked at window 150 and one locked at 177 are answerable to different reads
// of the ledger, and one map keyed on the mark alone would judge August against
// September and invent findings. And `escrow_checked: false` — the projection
// absent (migration 014) or uningested — is REPORTED: zero findings from a check
// that could not run looks exactly like a clean town, and that is the whole
// failure this file exists to end. The unjudgeable count is that same
// distinction drawn per sha: `escrow_unbacked` lists only judgeable zeros.
//
// A RETIRED MARK IS NOT LISTED. A mark the world published and later UNPUBLISHED
// also stands with a locked claim and no file — the retire path (G1 lane 1)
// exists for exactly that and writes `status='retired'`. Listing those would make
// this alarm forever on a fact the town has already recorded, which is how a
// board teaches its reader to skim.
//
// ── THE DENOMINATOR, AND THE REPAIR THE REHEARSAL FORCED ────────────────────
//
// The first cut walked `claims`, because that is the noun the issue and the brief
// both use. It reported the three instances and looked right, and it was reading
// 188 OF 1,019 STANDING MARKS: `claims.slug` is NULL on every seed-imported
// claim, so 831 locked claims name nothing and two marks that were absent from
// canon and standing in the dump — `berthillon/pistache-cone-for-julian` and
// `the-town/pledges` — were invisible to it. It walks `marks` now.
//
// MEASURED, and the numbers are the lane's receipts:
//   · pre-cutover dump vs world main 91536f76 → FIVE (the three never-stood, plus
//     pistache which the sweep unpublished at 49e0fe89, plus the-town/pledges
//     which a law commit removed).
//   · prod after the founder's 2026-09-08 retire of all five → ONE:
//     `lupi/the-drift-room`, locked at window 177 that same evening.
//
// ── EXIT CODES (the siblings' rule) ──────────────────────────────────────────
//
//   0  every standing mark has a file in canon, and every locked claim made one
//   1  RED — at least one does not, named with its slug, window and the sha
//   2  CANNOT RUN
//
// There is no code for "checked nothing and found nothing": an empty `marks`, a
// checkout that loads no marks, or a comparison that ended with zero slugs all
// exit 2, loudly. A comparison whose two sides describe different worlds is not a
// pass.
//
// ── RUNNING IT ───────────────────────────────────────────────────────────────
//
//   export WORLD2_PG_URL="postgres://snapshot_reader:…@localhost:5432/world2_dev"
//   node world2/tools/falsifier-canon-locks.mjs --world-repo /srv/world2-lab/ingest-clones/world
//
//   --json                machine-readable
//   --history <path>      append one JSONL line for the box roll-call's outcome
//                         rule (deploy/box-rollcall-manifest.json § the notary
//                         row). The line is written on EVERY run, including the
//                         clean ones: "ran and found nothing" and "did not run"
//                         must not look alike, which is the whole of why the
//                         roll-call can judge this at all. The three lists are
//                         its `alarm_on_nonempty`; `escrow_unjudgeable` is a
//                         number on the line and the row's `report_counts` — a
//                         count the board prints, never an alarm.

import { resolve } from "node:path";
import { appendFileSync } from "node:fs";
import { canonRegisterAt, canonAbsentCheck } from "./canon-register.mjs";
import { causeOf } from "../../src/mark-receipt.mjs";
// THE JUDGEMENT LIVES NEXT DOOR, and it lives there because THIS file is a
// script: it exits at the top on a missing argument, so anything that imported it
// to test the judgement would be killed by it. `canon-locks.mjs` is the pure half
// and `test/canon-locks.test.mjs` is what watches the rules.
import { STANDING_SELECT, UNMATERIALIZED_SELECT, ESCROW_BY_SHA_SELECT, ESCROW_OLDEST_SELECT, canonLockFindings, unjudgeableByWindow } from "./canon-locks.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);
const die = (msg) => { console.error(`CANNOT RUN · ${msg}`); process.exit(2); };

const worldRepo = arg("--world-repo");
if (!worldRepo) die("usage: falsifier-canon-locks.mjs --world-repo <checkout> [--json] [--history <path>]");
if (!process.env.WORLD2_PG_URL) die("WORLD2_PG_URL missing");

const client = await (async () => {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
  try { await c.connect(); } catch (e) { die(`cannot connect: ${e.message}`); }
  return c;
})();

let out = {};
try {
  const register = await canonRegisterAt({ backend: "git", worldRepo: resolve(worldRepo) });
  const { rows } = await client.query(STANDING_SELECT);
  if (!rows.length) die("`marks` holds no standing rows — there is nothing to check, and a check that checked nothing must not report green");
  const { rows: unmaterializedRows } = await client.query(UNMATERIALIZED_SELECT);

  // The escrow projection, if the store has one. `null` when migration 014 is
  // not applied or nothing is ingested — REPORTED rather than silently producing
  // zero findings, which would look exactly like a clean town.
  let escrowBySha = null;
  // The boundary the unjudgeable count is measured against — the projection's
  // oldest sha, named on the line so the count can be read without the store.
  let oldestProjected = null;
  try {
    const { rows: has } = await client.query("SELECT to_regclass('public.escrow_projection') IS NOT NULL AS ok");
    if (has[0]?.ok) {
      const { rows: e } = await client.query(ESCROW_BY_SHA_SELECT);
      if (e.length) {
        escrowBySha = new Map(e.map((r) => [`${r.town_sha}|${r.mark}`, Number(r.n)]));
        const { rows: o } = await client.query(ESCROW_OLDEST_SELECT);
        if (o[0]) oldestProjected = { town_sha: o[0].town_sha, ingested_at: o[0].ingested_at, window: o[0].window_id ?? null };
      }
    }
  } catch { /* an unreadable projection is an unanswered question, not an empty one */ }

  const { absent, unbacked, unjudgeable, unmaterialized, compared, escrow_compared, escrow_checked } =
    canonLockFindings(rows, register, { unmaterializedRows, escrowBySha });
  if (!compared) die(
    `no standing mark carries a slug, so nothing was compared against the register at ${register.sha.slice(0, 8)} — ` +
    "an empty comparison is not a pass");

  out = {
    canon_sha: register.sha,
    register_records: register.count,
    standing_marks: rows.length,
    compared,
    // EACH FINDING CARRIES THE WORD A RESIDENT WOULD BE TOLD. The lock-time
    // refusal was withdrawn, so nothing writes `canon-absent` onto a claim any
    // more — and without this the bulletin's sixth word would have no reader on
    // the only path that still produces the class. The check string is composed
    // here and run through `causeOf`, the same map the door uses, so the read and
    // the door cannot drift about what this class is called.
    absent: absent.map((r) => ({
      slug: r.slug, claim_id: r.claim_id, claim_status: r.claim_status, window: r.window_id,
      locked_window: r.locked_window, claimant: r.claimant, decided_at: r.decided_at,
      check: canonAbsentCheck(r.slug, register.sha),
      cause: causeOf(canonAbsentCheck(r.slug, register.sha)).cause,
    })),
    unmaterialized: unmaterialized.map((r) => ({ slug: r.slug, claim_id: r.claim_id, window: r.window_id })),
    escrow_checked, escrow_compared,
    escrow_unbacked: unbacked.map((r) => ({
      slug: r.slug, tier: r.tier, locked_window: r.locked_window, town_sha: r.locking_town_sha,
    })),
    // THE COUNT, not a list of slugs: 227 names on a line every night is the
    // skim the alarm was teaching, and the windows are what a reader can act
    // on. `null` when the projection was not checked — nothing was counted,
    // which is not the same as counting zero.
    escrow_unjudgeable: escrow_checked ? unjudgeable.length : null,
    escrow_unjudgeable_windows: unjudgeableByWindow(unjudgeable),
    escrow_oldest_projected: oldestProjected,
    unreadable: register.unreadable,
  };
} catch (err) {
  die(err.message);
} finally {
  await client.end();
}

// The roll-call's line. Written before the exit so a RED run records itself —
// an instrument that only logs when it is happy is an instrument that cannot be
// judged by its output.
const historyPath = arg("--history");
if (historyPath) {
  try {
    appendFileSync(historyPath, JSON.stringify({
      at: new Date().toISOString(),
      canon_sha: out.canon_sha,
      compared: out.compared,
      canon_absent: out.absent.map((a) => a.slug),
      unmaterialized: out.unmaterialized.map((u) => u.slug),
      escrow_unbacked: out.escrow_unbacked.map((u) => u.slug),
      escrow_checked: out.escrow_checked,
      escrow_unjudgeable: out.escrow_unjudgeable,
      escrow_oldest_projected: out.escrow_oldest_projected ? out.escrow_oldest_projected.town_sha : null,
    }) + "\n");
  } catch (e) {
    console.error(`  ⚑ could not append to ${historyPath}: ${e.message} — the finding below still stands`);
  }
}

if (has("--json")) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`canon ${out.canon_sha.slice(0, 8)} · ${out.register_records} register records · ${out.standing_marks} standing mark(s), ${out.compared} compared`);
  for (const u of out.unreadable) console.log(`  ⚑ the register could not parse ${u} — it states nothing either way`);
  for (const u of out.unmaterialized)
    console.log(`  ✗ UNMATERIALIZED · claim ${u.claim_id.slice(0, 8)} locked at window ${u.window} names ${u.slug} and no mark carries that slug`);
  if (!out.escrow_checked)
    console.log("  ⚑ escrow: NOT CHECKED — escrow_projection is absent or holds no rows (migration 014, lane 2). Zero findings below is a question unanswered, not a clean town.");
  if (out.escrow_unjudgeable) {
    const o = out.escrow_oldest_projected;
    const windows = out.escrow_unjudgeable_windows.map((w) => `${w.locked_window ?? "?"} ×${w.marks}`).join(", ");
    const oldest = o
      ? `${String(o.town_sha).slice(0, 8)}${o.window != null ? ` (window ${o.window}` : " ("}${o.ingested_at ? `, ingested ${new Date(o.ingested_at).toISOString()})` : ")"}`
      : "unknown";
    console.log(`  ⚑ escrow: ${out.escrow_unjudgeable} commons mark(s) UNJUDGEABLE — locked at ${out.escrow_unjudgeable_windows.length} window(s) whose town sha the projection holds no rows for (${windows}); ` +
      `the oldest projected town sha is ${oldest}. Unavailable, never ✦0 — a count, not a finding.`);
  }
  for (const u of out.escrow_unbacked)
    console.log(`  ✗ ESCROW-ABSENT · ${u.slug} stands as ${u.tier} (commons), locked at window ${u.locked_window}, with nothing staked on it at that window's town ${String(u.town_sha).slice(0, 8)}`);
  for (const a of out.absent)
    console.log(`  ✗ CANON-ABSENT · ${a.slug} stands in the register, locked at window ${a.locked_window ?? a.window ?? "?"} ` +
      `(claim ${a.claim_id ? a.claim_id.slice(0, 8) : "none"}${a.claimant ? `, ${a.claimant}` : ""}), and canon carries no file for it at ${out.canon_sha.slice(0, 8)} — a resident reading this mark is told "${a.cause}"`);
  const n = out.absent.length + out.unmaterialized.length + out.escrow_unbacked.length;
  console.log(n
    ? `\nRED · ${n} row(s) the world does not carry or does not back`
    : `\nGREEN · every standing mark has a file in canon at ${out.canon_sha.slice(0, 8)}, every locked claim made one` +
      `${out.escrow_checked
        ? `, and all ${out.escrow_compared} judgeable commons mark(s) carry a stake${out.escrow_unjudgeable ? ` (${out.escrow_unjudgeable} more lock before the projection's oldest sha and are unjudgeable, not ✦0)` : ""}`
        : " — but escrow was NOT checked"}`);
}
process.exit(out.absent.length + out.unmaterialized.length + out.escrow_unbacked.length ? 1 : 0);
