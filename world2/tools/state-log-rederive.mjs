#!/usr/bin/env node
// state-log-rederive.mjs — re-derive one window's photograph from the register
// and diff it against the file the drain committed, difference by difference.
//
// This is the lane's measuring instrument made permanent. It answers one
// question and prints its evidence: for window N, does the register produce the
// lines `STATE/log/<N>.journal.jsonl` holds, and where it does not, why.
//
// ── IT REFUSES A NON-SCRATCH DATABASE ────────────────────────────────────────
//
// Read-only or not, a rehearsal instrument pointed at `world2_dev` is pointed at
// PROD — `/srv/world2-lab/lab.env` and `/etc/postmark-office.env` name the same
// database, and "there is a lab store" is a premise this month has now cost
// twice. So the connection string must name a database beginning `w2_scratch_`.
// The guard is on the NAME rather than on the statements because a SELECT-only
// tool is one careless edit from not being one, and a name is checkable before
// the first query rather than after the last.
//
//   WORLD2_PG_URL=postgres://…/w2_scratch_statelog_20260908 \
//     node world2/tools/state-log-rederive.mjs --world /path/to/world-clone --window 177 \
//       [--upto 2026-09-08T17:45:08Z] [--json]
//
// `--world` is a world CHECKOUT (or any directory holding `STATE/log/`); the
// file is read off disk, so point it at a throwaway clone checked out at the
// settlement you mean, never at a live settlement clone somebody is using.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { LINE_FIELDS, compareWindow, stateLogFromStore, windowFromActs } from "../../src/state-log-from-store.mjs";

const SCRATCH = /\/w2_scratch_[a-z0-9_]+(\?|$)/;

/**
 * The register's household KEY → the name the journal spelled.
 *
 * The `solo:` half is closed here. The `gh:<id>` half needs
 * `WORLD/households.json.logins`, which lane 3's `sketchbookNameFor` already
 * reads for the sweep's authorship wall — so this reads the SAME file rather
 * than inventing a second rule, and returns null when the file cannot answer.
 * A null is a finding the run prints; it is never a guess written into a
 * photograph.
 */
export function householdNamerFor(worldRoot) {
  let logins = {};
  const path = join(worldRoot, "WORLD", "households.json");
  if (existsSync(path)) {
    try { logins = JSON.parse(readFileSync(path, "utf8")).logins ?? {}; } catch { logins = {}; }
  }
  // logins maps a lowercased GitHub login -> household key; this wants the
  // inverse, and a key bound by more than one login is AMBIGUOUS rather than
  // first-wins: picking one would name a household the line may not belong to.
  const byKey = new Map();
  for (const [login, key] of Object.entries(logins)) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(login);
  }
  return (key) => {
    const k = String(key);
    if (k.startsWith("solo:")) return k.slice(5) || null;
    const bound = byKey.get(k) ?? [];
    return bound.length === 1 ? bound[0] : null;
  };
}

/**
 * ABSENCE, SPLIT BY LANE — EXPECTED vs A FINDING.
 *
 * MY REVIEWER'S NOTE 1, SECOND HALF. The byte-equality floor moved into
 * `exitCodeFor` last lap and this did not: it stayed inline in the CLI tail
 * where nothing under `test/` could reach it, and **inverting the ternary left
 * the suite 31/31 green** — a parity run would then have called every arena
 * absence a finding and every real finding expected, which is the check reading
 * exactly backwards while reporting nothing wrong. Half a repair is its own
 * defect: the half that moved is now guarded and the half that stayed was not,
 * and the second half is the one that decides what the exit means.
 *
 * A governed-exempt lane's absence is EXPECTED — the arena is never mirrored by
 * ruling (`EXEMPT_LANES` in src/world2-acts.mjs, P-143), so its rows cannot be in the register and
 * a red that fires on that is a red nobody reads. Anything else is a finding.
 *
 * `lanes` and `laneOf` are injected with the real ones as defaults, so a test
 * can drive the split without standing up the office's lane table AND the
 * default path is the one production takes. `laneOf` is the office's own census
 * — the same call the reaper makes, for the same reason.
 */
export async function classifyAbsence(lines, { lanes = null, laneOf = null } = {}) {
  const exemptOf = lanes ?? new Set((await import("../../src/world2-acts.mjs")).exemptLanes());
  const laneFor = laneOf ?? (await import("../../src/world2-pen.mjs")).laneOf;
  const expected = [], unexpected = [];
  for (const l of lines) {
    (exemptOf.has(laneFor({ class: l.class, action: l.type })) ? expected : unexpected).push(l);
  }
  return { expected, unexpected };
}

/**
 * THE EXIT CODE, AS A FUNCTION, SO ITS DELETION IS VISIBLE.
 *
 * MY REVIEWER'S NOTE (a). This lived inline in the CLI tail, where nothing could
 * reach it — so `--require-byte-equal` had no test and removing it would have
 * been invisible: the flag would silently stop gating and every run would exit 0
 * again, which is the exact defect the flag was added to fix, returning through
 * its own repair. A gate whose removal nothing notices is not a gate.
 *
 * PURE, and it is the whole exit decision rather than a piece of it, because a
 * function that computed only the floor would leave the `||` chain untested and
 * that chain is where the original defect lived.
 *
 * `only_in_file` here is already lane-classified: a governed-exempt lane's
 * absence sits in `expected_absent` and never reaches this, which is what lets
 * a parity run over an arena window exit 0 when it should.
 */
export function exitCodeFor(report, floor = null) {
  const n = floor == null ? null : Number(floor);
  const missed_floor = n != null && Number.isFinite(n) && report.byte_equal_once_seq_supplied < n;
  const code = (report.only_in_file.length || report.only_in_derived.length || missed_floor) ? 1 : 0;
  return { code, missed_floor, floor: n };
}

function readWindowFile(worldRoot, window) {
  const path = join(worldRoot, "STATE", "log", `${window}.journal.jsonl`);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").split("\n").filter((s) => s.trim()).map((s) => JSON.parse(s));
}

const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };


// ── the CLI ──────────────────────────────────────────────────────────────────
//
// GUARDED, and it was not. Everything below ran at IMPORT time — including the
// `process.exit(2)` refusal — so `import { householdNamerFor }` from a sibling
// tool killed the importing process before it reached its own first line. The
// resolver above is the one piece of this file worth reusing and it was
// unreachable to anything but a shell.
//
// The guard is a BASENAME comparison, not `argv[1] === import.meta.url`. The
// URL form is the one that breaks under a junction — a junctioned path makes
// the two strings differ and the tool exits 0 having done nothing, which is the
// shape that cost 33 fixture reds on 2026-09-05. `world-drain.mjs` and
// `enter-exit-ledger.mjs` both use the basename form; this matches them.
if (process.argv[1]?.endsWith("state-log-rederive.mjs")) {
  const url = process.env.WORLD2_PG_URL ?? "";
  if (!SCRATCH.test(url)) {
    console.error("REFUSED · WORLD2_PG_URL must name a database beginning `w2_scratch_`.");
    console.error("  There is no lab store: /srv/world2-lab/lab.env and /etc/postmark-office.env name the same");
    console.error("  database. Take a fresh pg_dump into a scratch and point this at that.");
    process.exit(2);
  }
  const worldRoot = resolve(argOf("--world", "."));
  const window = Number(argOf("--window"));
  if (!Number.isFinite(window)) { console.error("--window <exact crossing value> is required"); process.exit(2); }
  const upto = argOf("--upto", null);

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const namer = householdNamerFor(worldRoot);
    const out = await stateLogFromStore(client, { window, upto, householdNameFor: namer });
    const file = readWindowFile(worldRoot, window);

    if (!file) {
      console.log(JSON.stringify({ window, derived: out.lines.length, file: null,
        note: "the drain never photographed this window — nothing to diff against, and nothing to merge into" }, null, 2));
      process.exit(0);
    }

    const cmp = compareWindow(file, out.lines);

    // BYTE-equality is measured with the FILE's own seq supplied, because `seq`
    // has no store source and reporting it as a difference on every line would
    // bury the three that are about the record. The substitution is stated, never
    // silent: the count below is "byte-equal once the journal seq is supplied".
    const sig = (l) => JSON.stringify([l.actor, l.type, l.object ?? null]);
    const buckets = new Map();
    for (const l of file) { const k = sig(l); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(l); }
    const used = new Map();
    let byteEqual = 0; const notByteEqual = [];
    for (const d of out.lines) {
      const k = sig(d); const i = used.get(k) ?? 0; used.set(k, i + 1);
      const f = (buckets.get(k) ?? [])[i];
      if (!f) continue;
      const rebuilt = {};
      for (const key of LINE_FIELDS) rebuilt[key] = key === "seq" ? f.seq : d[key];
      if (JSON.stringify(rebuilt) === JSON.stringify(f)) byteEqual++;
      else notByteEqual.push({ actor: d.actor, type: d.type, class: d.class, object: d.object,
        fields: LINE_FIELDS.filter((key) => JSON.stringify(rebuilt[key]) !== JSON.stringify(f[key])) });
    }

    // ── THE ROLL CALL SPLITS ABSENCE IN TWO (the conductor's ruling, lap 3) ────
  //
  // This ships as the PARITY INSTRUMENT, not as a writer: the drain does not
  // die at the swap, it NARROWS to the arena's windows (P-143 is Keemin's —
  // until his word the arena stays sqlite-first and the drain is its only pen),
  // and the check is that the store re-derives what the drain wrote for those
  // windows.
  //
  // Which makes a plain `only_in_file` useless here. An arena window's rows are
  // arena acts, the arena is never mirrored BY RULING, so every one of them is
  // absent from the register and a check keyed on raw absence exits 1 every
  // time it runs. A red that fires on a governed exemption is a red nobody
  // reads, and a roll call nobody reads is worse than none.
  //
  // So absence is classified by the lane it belongs to, through `laneOf` —
  // the office's own census, and the same call the reaper makes for the same
  // reason. A governed-exempt lane's absence is EXPECTED and reported in its own
  // field; anything else is a finding and fails the exit.
  const { laneOf } = await import("../../src/world2-pen.mjs");
  const { expected: expectedAbsent, unexpected: unexpectedAbsent } = await classifyAbsence(cmp.onlyInFile);

  const report = {
      window,
      world: worldRoot,
      upto,
      file_lines: file.length,
      derived_lines: out.lines.length,
      only_in_file: unexpectedAbsent.map((l) => ({ seq: l.seq, actor: l.actor, type: l.type, object: l.object })),
      expected_absent: expectedAbsent.map((l) => ({ seq: l.seq, actor: l.actor, type: l.type, lane: laneOf({ class: l.class, action: l.type }) })),
      only_in_derived: cmp.onlyInDerived.map((l) => ({ seq: l.seq, actor: l.actor, type: l.type, object: l.object })),
      byte_equal_once_seq_supplied: byteEqual,
      not_byte_equal: notByteEqual,
      causes: cmp.differing,
      unnamed_households: out.unnamed_households,
    };
    if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 2)); }
    else {
      console.log(`window ${window} · file ${file.length} line(s) · derived ${out.lines.length} line(s)`);
      console.log(`byte-equal once the journal seq is supplied: ${byteEqual} of ${out.lines.length}`);
      for (const n of notByteEqual) console.log(`  NOT byte-equal · ${n.actor} ${n.type} (${n.class}) · ${n.fields.join(" + ")}`);
      if (report.expected_absent.length) console.log(`  expected absent: ${report.expected_absent.length} — governed-exempt lanes (${[...new Set(report.expected_absent.map((l) => l.lane))].join(", ")}), never mirrored by ruling`);
    if (report.only_in_file.length) console.log(`  ONLY IN THE FILE: ${report.only_in_file.length} — the register cannot produce these, and their lanes are NOT exempt`);
      if (report.only_in_derived.length) console.log(`  ONLY IN THE REGISTER: ${report.only_in_derived.length} — the drain never wrote these`);
      if (out.unnamed_households.length) console.log(`  UNNAMED HOUSEHOLDS: ${out.unnamed_households.join(", ")}`);
      const byField = {};
      for (const d of cmp.differing) for (const c of d.causes) (byField[c.field] ??= new Set()).add(c.cause);
      for (const [f, causes] of Object.entries(byField)) for (const c of causes) console.log(`  ${f}: ${c}`);
    }
    // THE EXIT CODE HAS TO SEE THE NUMBER THE TOOL IS FOR.
    //
    // It keyed only on `only_in_file` / `only_in_derived`, so a run whose
    // byte-equal count fell from 7 of 11 to 0 of 11 still exited 0 — every act
    // present, every line differing, and a gate reading the status would have
    // called that a pass. My reviewer found it. A tool whose headline number
    // cannot fail its own exit is a tool that only looks like a check.
    //
    // `--require-byte-equal <n>` is opt-in because this is a MEASURING instrument
    // first: the honest answer today is 7 of 11, and a tool that exited non-zero
    // on its own true answer would be one nobody could run. Passing the flag is
    // what turns it into a gate, and then the floor is the caller's to state.
    const verdict = exitCodeFor(report, argOf("--require-byte-equal", null));
    if (verdict.missed_floor) {
      console.error(`RED: byte-equal ${byteEqual} of ${out.lines.length}, below the required ${verdict.floor}`);
    }
    process.exit(verdict.code);
  } finally {
    await client.end();
  }

}
