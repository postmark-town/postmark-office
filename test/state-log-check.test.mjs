// state-log-check.test.mjs — the CHECK, and the boundary it reads. POS-155.
//
// `state-log-from-store.test.mjs` already holds the line grammar against the
// real window-177 archive (F1-F16). This file holds the two things that lane
// did not need and this one does:
//
//   A1-A2  THE CHECK OVER A REAL ARCHIVE FILE. Against
//          `test/fixtures/177.journal.jsonl` — the bytes the drain committed —
//          every difference the register produces must fall in one of the three
//          NAMED gaps, and nothing may land in `unexplained`. That is the claim
//          `--check` makes on the box, so it is made here over the same bytes.
//          A1 is what the flip drives red: drop a field from `STANDING_FIELDS`
//          and eleven standing objects stop matching the drain's, which is an
//          `unexplained` difference and not one of the three.
//
//   B1-B4  THE BOUNDARY. `windowCrossings` reads the window's OWN recorded
//          edges and never a clock. B3 is the one that matters: the candle
//          window is offset from the ferry crossing by 5.75 hours on prod, so
//          one window's acts land in TWO journal files, and a checker that
//          assumed `window N -> N.journal.jsonl` would open the wrong file and
//          report a full archive missing.
//
//   node --test test/state-log-check.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";


import {
  GAP_CLASSES, NO_SUCH_WINDOW, WINDOW_BOUNDARY,
  checkStateLog, gapClassOf, windowCrossings, writeStateLogForWindow,
} from "../world2/tools/state-log-write.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-statelog-check-"));
after(() => sweep(scratch));

// ── THE FIXTURE REGISTER ─────────────────────────────────────────────────────
//
// A faithful miniature of the two tables this tool reads, answering the three
// queries it actually sends. Faithful matters more than usual here: the whole
// finding is that `windows.id` and `acts.crossing` are TWO CLOCKS, so a fixture
// that conflated them would make every test below pass on a tool that had the
// defect. Instants are compared with `Date.parse` and not as strings, because
// the `pg` driver's `+00:00` and the journal's `Z` are the same instant spelled
// two ways and a string compare would order them wrong.

const register = (acts, windows) => ({
  async query(sql, params) {
    if (sql.includes("FROM windows")) return { rows: windows.filter((w) => w.id === params[0]) };
    if (sql.includes("SELECT DISTINCT crossing")) {
      const lo = Date.parse(params[0]), hi = Date.parse(params[1]);
      const seen = [...new Set(acts
        .filter((a) => a.crossing != null && Date.parse(a.at) > lo && Date.parse(a.at) <= hi)
        .map((a) => Number(a.crossing)))].sort((x, y) => x - y);
      return { rows: seen.map((crossing) => ({ crossing })) };
    }
    // the derivation's own SELECT: `WHERE crossing = $1 [AND at <= $2]`
    const [c, upto] = params;
    return { rows: acts
      .filter((a) => Number(a.crossing) === Number(c))
      .filter((a) => upto == null || Date.parse(a.at) <= Date.parse(upto))
      .sort((x, y) => x.id - y.id) };
  },
});

/** A world checkout with a STATE dir, the shape the sweep clone is in. */
function world(name, { logins = {} } = {}) {
  const repo = join(scratch, name);
  mkdirSync(join(repo, "WORLD"), { recursive: true });
  mkdirSync(join(repo, "STATE", "log"), { recursive: true });
  writeFileSync(join(repo, "WORLD", "households.json"), JSON.stringify({ logins }, null, 1));
  return repo;
}

// ── A: THE CHECK, OVER THE ARCHIVE THE DRAIN ACTUALLY WROTE ──────────────────
//
// `177.acts.json` is the register's eleven rows and `177.journal.jsonl` is the
// file the drain committed for them, both taken byte-exact out of world main.
// Candle window 177's edges are the real ones: window 150 closed
// 2026-08-26T05:45Z (`018_settlements.sql`) and the tile is rigid, so
// 177 closes 2026-08-26T05:45Z + 27 × 12h = 2026-09-08T17:45Z. All eleven acts
// (12:07Z-17:12Z) fall inside it.

const ACTS_177 = JSON.parse(readFileSync(join(FIX, "177.acts.json"), "utf8"));
const WINDOW_177 = [{ id: 177, opens_at: "2026-09-08T05:45:00.000Z", closes_at: "2026-09-08T17:45:00.000Z" }];

/** The 177 archive, on disk, in a world checkout. */
function world177(name) {
  const repo = world(name);
  for (const f of ["177.journal.jsonl", "177.journal.meta.json"]) {
    copyFileSync(join(FIX, f), join(repo, "STATE", "log", f));
  }
  return repo;
}

test("A1 · over the REAL 177 archive, every difference is one of the three NAMED gaps — nothing is unexplained", async () => {
  // THE CLAIM `--check` MAKES ON THE BOX, made here over the same bytes. The
  // three gaps are measured in `state-log-from-store.mjs § THE THREE THINGS THE
  // REGISTER CANNOT GIVE BACK`; anything outside them is a finding, and the
  // whole value of the check is that it can tell the two apart.
  //
  // THE FLIP DRIVES THIS RED. Drop a field from `STANDING_FIELDS` and all
  // eleven standing objects stop matching the drain's — `unexplained`, not one
  // of the three.
  const repo = world177("a1");
  const chk = await checkStateLog(register(ACTS_177, WINDOW_177), { world: repo, window: 177 });

  assert.equal(chk.refused, undefined);
  assert.deepEqual(chk.crossings.map((c) => c.crossing), [177], "one ferry crossing in this window");
  const c = chk.crossings[0];
  assert.equal(c.file_lines, 11, "eleven lines on disk, all inside the window's horizon");
  assert.equal(c.derived_lines, 11, "eleven out of the register — no act lost and none invented");
  assert.equal(c.beyond_horizon, 0);
  assert.equal(c.unparsed, 0);

  assert.equal(c.classes.unexplained, undefined,
    `nothing outside the three named gaps — got ${JSON.stringify(c.classes)} · ${c.first_difference}`);
  assert.equal(c.classes.absent, undefined, "the file is there");
  assert.equal(c.classes.seq, 11, "every line: acts.journal_seq is null and this is the register's own id");
  assert.equal(c.classes.at, 3, "three of eleven: the private-draft deferral, the same three F8 measures");
  assert.ok(c.classes.payload >= 1, "the mark rows differ by payload key order only");

  // AND IT IS NOT BYTE-EQUAL, and says so. `byte_equal` is the strict question
  // and the seq gap alone answers it no; the classes are what tell a reader the
  // no is a cost the town already accepted. A check that conflated the two
  // would have to choose between crying wolf and going quiet.
  assert.equal(c.byte_equal, false);
  assert.equal(chk.clean, false);
  assert.equal(chk.boundary, WINDOW_BOUNDARY, "and it carries the rule it read");
});

test("A2 · CONTROL — one mangled byte in the archive lands in `unexplained` and is named", async () => {
  // Without this, A1's "nothing unexplained" could be passing on a checker that
  // classes everything as known, or on one whose comparison never fires.
  const repo = world177("a2");
  const path = join(repo, "STATE", "log", "177.journal.jsonl");
  const before = readFileSync(path, "utf8");
  const mangled = before.replace('"class":"voice"', '"class":"vioce"');
  assert.notEqual(mangled, before, "the fixture still has a voice line to mangle");
  assert.equal(mangled.length, before.length, "one transposition, not one line added");
  writeFileSync(path, mangled, "utf8");

  const chk = await checkStateLog(register(ACTS_177, WINDOW_177), { world: repo, window: 177 });
  const c = chk.crossings[0];
  assert.equal(c.classes.unexplained, 1, "the mangled class is a finding, not a gap");
  assert.equal(c.classes.seq, 11, "and the known gaps are still counted, not swallowed by the finding");

  // AND THE SUMMARY LINE LEADS WITH THE FINDING, not with the gap. This caught
  // a real defect: `first_difference` reported the literally-first cause, and
  // since the `seq` gap is on every line of every window by construction, the
  // mangled field came back announced as `gap:seq`. The one line a reader needs
  // was buried under the one class the town already accepted.
  assert.match(c.first_difference, /UNEXPLAINED/,
    "an unexplained difference outranks a known gap in the summary line");
  assert.match(c.first_difference, /field class/, "and it names the field, not just the class");
});

// ── B: THE BOUNDARY ──────────────────────────────────────────────────────────
//
// Prod's own two phases: windows tile from 05:45Z, crossings from 00:00/12:00Z.

const WINDOWS = [
  { id: 203, opens_at: "2026-09-21T05:45:00.000Z", closes_at: "2026-09-21T17:45:00.000Z" },
  { id: 204, opens_at: "2026-09-21T17:45:00.000Z", closes_at: "2026-09-22T05:45:00.000Z" },
  { id: 205, opens_at: "2026-09-22T05:45:00.000Z", closes_at: "2026-09-22T17:45:00.000Z" },
];

const act = (id, at, crossing, actor, extra = {}) => ({
  id, at, crossing, actor, action: "say", object: null,
  at_anchor: null, at_dx: null, at_dy: null, witnesses: null,
  class: "voice", payload: { text: `line ${id}` }, effect: "spoken",
  household: `solo:${actor}`, journal_seq: null, ...extra,
});

// CANDLE WINDOW 204 = [2026-09-21T17:45Z, 2026-09-22T05:45Z). Every row below is
// inside it, and their CROSSING values straddle the ferry boundary at
// 2026-09-22T00:00Z: three in crossing 203, two in 204, one a fractional walk.
const ACTS = [
  act(9001, "2026-09-21T18:10:00.000Z", 203, "neth"),
  act(9002, "2026-09-21T20:00:00.000Z", 203, "nyx"),
  act(9003, "2026-09-21T23:30:00.000Z", 203, "pica"),
  act(9004, "2026-09-21T22:15:00.000Z", 203.8541666666667, "quill", { action: "walk", class: "move" }),
  act(9005, "2026-09-22T01:00:00.000Z", 204, "neth"),
  act(9006, "2026-09-22T04:59:00.000Z", 204, "nyx"),
  // OUTSIDE, both ways, and both are traps a sloppy boundary falls into:
  act(9007, "2026-09-21T17:45:00.000Z", 203, "early"),   // exactly window 203's close
  act(9008, "2026-09-22T06:30:00.000Z", 204, "late"),    // window 205's, ferry crossing 204's FILE
];

const reg = () => register(ACTS, WINDOWS);

test("B1 · the window's edges come from the window's OWN row, and the acts inside them are (opens, closes]", async () => {
  const w = await windowCrossings(reg(), 204);
  assert.equal(w.refused, undefined);
  assert.equal(w.opens_at, "2026-09-21T17:45:00.000Z");
  assert.equal(w.closes_at, "2026-09-22T05:45:00.000Z");

  // HALF-OPEN AT THE BOTTOM. Act 9007 sits exactly on window 203's close, which
  // IS window 204's open; it belongs to 203 and to nothing else. An inclusive
  // bottom would file it in both and the tiling would stop being a partition.
  // It is a `say` at crossing 203 like 9001-9003, so nothing but the boundary
  // can tell it from them — which is what makes this an assertion about the
  // boundary rather than about the fixture.
  const inside = ACTS.filter((a) => Date.parse(a.at) > Date.parse(w.opens_at)
    && Date.parse(a.at) <= Date.parse(w.closes_at)).map((a) => a.id);
  assert.deepEqual(inside, [9001, 9002, 9003, 9004, 9005, 9006],
    "9007 is on the lower boundary instant (excluded); 9008 is past the close (excluded)");
});

test("B2 · a window the store does not hold REFUSES; it never falls back to arithmetic on the number", async () => {
  // The fallback is the tempting repair and it is the defect: window 151's
  // `opens_at` was repaired BY HAND (`005_candle_tiling.sql`), so the tile is a
  // recorded fact and not a formula. A formula would be wrong about exactly
  // that one window and right about every other — the worst shape a boundary
  // can have, because nothing would ever surface it.
  const w = await windowCrossings(reg(), 999);
  assert.equal(w.refused, "no-such-window");
  assert.match(w.detail, /window 999/);
  assert.ok(w.detail.includes(NO_SUCH_WINDOW));
});

test("B3 · ONE CANDLE WINDOW LANDS IN TWO JOURNAL FILES — the two clocks are 5.75 hours apart", async () => {
  // THE FINDING THIS LANE TURNED ON. `window N -> N.journal.jsonl` is the
  // assumption the lane was handed and it is false: candle window 204 is
  // [09-21 17:45Z, 09-22 05:45Z) and ferry crossing 204 is [09-22 00:00Z,
  // 09-22 12:00Z). A checker holding that assumption would open ONE file, find
  // two of six lines in it, and report the archive four lines short with no
  // class to put them in.
  const w = await windowCrossings(reg(), 204);
  assert.deepEqual(w.crossings, [203, 203.8541666666667, 204],
    "three files, not one — two ferry crossings plus a fractional walk");
  assert.ok(w.crossings.includes(203), "the window reaches BACK into the previous crossing's file");
});

test("B4 · the fractional walk crossing keeps its own file, exactly as the drain grouped it", async () => {
  // `planDrain`: "Grouped by the row's OWN crossing" — which is why the town
  // holds `182.journal.jsonl` beside `182.2538.journal.jsonl`.
  const repo = world("b4");
  const out = await writeStateLogForWindow(reg(), { world: repo, window: 204, commit: false });
  assert.equal(out.refused, undefined);
  assert.deepEqual(out.windows.map((x) => x.crossing), [203, 203.8541666666667, 204]);
  assert.ok(existsSync(join(repo, "STATE", "log", "203.8541666666667.journal.jsonl")),
    "the walk is its own file, not folded into 203's");
  assert.equal(out.boundary, WINDOW_BOUNDARY);
});

// ── C: THE CHECK'S OTHER VERDICTS ────────────────────────────────────────────

test("C1 · an ABSENT file is its own class — the archive being dark is a finding, not a pass", async () => {
  // This is what `--check` reports on prod today, on every window: the drain
  // stopped 2026-09-11 and nothing has written a `.journal.jsonl` since. A
  // check that treated "no file" as "nothing to compare, green" would report
  // eleven dark days as eleven clean ones — which is exactly how the archive
  // went dark unnoticed in the first place.
  const repo = world("c1");
  const chk = await checkStateLog(reg(), { world: repo, window: 204 });
  assert.equal(chk.clean, false);
  assert.equal(chk.crossings.length, 3);
  for (const c of chk.crossings) {
    assert.equal(c.byte_equal, false);
    assert.equal(c.classes.absent, 1);
    assert.equal(c.first_difference, GAP_CLASSES.absent);
    assert.ok(c.derived_lines > 0, "and it still says how many lines it WOULD have written");
  }
});

test("C2 · the on-disk horizon is filtered on BOTH sides, and the count dropped is reported", async () => {
  // Act 9008 is at 06:30Z — window 205's act, in ferry crossing 204's FILE. The
  // next settlement writes it there, so a check of window 204 run afterwards
  // must not call it a stray. Filtered, counted, and named: a filter nobody can
  // see is one that will one day hide a real row.
  const repo = world("c2");
  const client = reg();
  await writeStateLogForWindow(client, { world: repo, window: 204, commit: false });

  // THE NEXT SETTLEMENT, run as the crossing runs it — window 205, through the
  // same door, which lands 9008 in ferry crossing 204's file beside the two
  // rows window 204 already wrote there.
  //
  // Simulated with `writeJournalWindow` directly at first, and that was wrong
  // in a way worth keeping: the raw call skips `householdNamerFor`, so the
  // second write overwrote `solo:neth` over the resolved `neth` and the check
  // then reported two household differences as UNEXPLAINED. The check was
  // right; the fixture was lying about what prod does. A simulation that skips
  // a step the real caller takes manufactures its own finding.
  const next = await writeStateLogForWindow(client, { world: repo, window: 205, commit: false });
  assert.deepEqual(next.windows.map((x) => x.crossing), [204], "window 205 writes into crossing 204's file");
  const onDisk = readFileSync(join(repo, "STATE", "log", "204.journal.jsonl"), "utf8");
  assert.equal(onDisk.split("\n").filter(Boolean).length, 3, "merged by seq: the file now holds the later row too");

  const chk = await checkStateLog(client, { world: repo, window: 204 });
  const c = chk.crossings.find((x) => x.crossing === 204);
  assert.equal(c.beyond_horizon, 1, "the later row is named, not silently dropped");
  assert.equal(c.file_lines, 2, "and the comparison is over the two rows this window owns");
  assert.equal(c.classes.unexplained, undefined, "no false finding");
  assert.equal(c.equal, 2, "both pair exactly");
});

test("C3 · --write twice is one diff of zero", async () => {
  const repo = world("c3");
  const client = reg();
  await writeStateLogForWindow(client, { world: repo, window: 204, commit: false });
  const first = new Map();
  for (const c of [203, 203.8541666666667, 204]) {
    for (const ext of ["journal.jsonl", "journal.meta.json"]) {
      const p = join(repo, "STATE", "log", `${c}.${ext}`);
      first.set(p, readFileSync(p, "utf8"));
    }
  }
  assert.equal(first.size, 6, "three files and three metas");
  await writeStateLogForWindow(client, { world: repo, window: 204, commit: false });
  for (const [p, bytes] of first) assert.equal(readFileSync(p, "utf8"), bytes, `${p} is unchanged`);
});

test("C4 · a window with no acts is NOT clean — it says nothing was compared", async () => {
  // "Green, I looked at nothing" is the starving-crossing shape one layer down.
  const repo = world("c4");
  const chk = await checkStateLog(register([], WINDOWS), { world: repo, window: 204 });
  assert.equal(chk.clean, false);
  assert.match(chk.note, /not the same as clean/);
  assert.deepEqual(chk.crossings, []);
});

test("C5 · an unrecognised cause never borrows a known gap's name", async () => {
  // `gapClassOf` is the one place a `compareWindow` cause becomes a word a
  // reader acts on, and its default has to be the loud one. Driven directly,
  // because no fixture can produce a cause that does not exist yet — which is
  // exactly the case the default is for.
  assert.equal(gapClassOf({ field: "seq", cause: "no store source — acts.journal_seq is null; this is the register's own id" }), "seq");
  assert.equal(gapClassOf({ field: "at", cause: "the private-draft deferral: the register holds the putting-forward instant, the journal held the compose" }), "at");
  assert.equal(gapClassOf({ field: "payload", cause: "payload key ORDER only — jsonb does not preserve it; the values are equal" }), "payload");
  assert.equal(gapClassOf({ field: "payload", cause: "values differ" }), "unexplained",
    "a payload whose VALUES differ is not the key-order gap wearing its name");
  assert.equal(gapClassOf({ field: "at", cause: "values differ" }), "unexplained",
    "and an `at` that differs for any other reason is not the deferral");
  assert.equal(gapClassOf({ field: "somethingNobodyHasWrittenYet", cause: "values differ" }), "unexplained");
});

test("C6 · the writer refuses a crossing the DRAIN already photographed", async () => {
  // `MERGE_HAZARD`, reached through the window door rather than the exact-value
  // one: the register's seq is `acts.id`, a different numbering, so re-deriving
  // a drain-era window merges a SECOND copy of every line. The drain's last
  // file is `182.2538.journal.jsonl`, which is what the crossing step passes.
  const repo = world("c6");
  await assert.rejects(
    () => writeStateLogForWindow(register(ACTS_177, WINDOW_177),
      { world: repo, window: 177, commit: false, lastDrainedWindow: 182.2538 }),
    /already photographed|at or below the last drained window/);
  assert.equal(existsSync(join(repo, "STATE", "log", "177.journal.jsonl")), false,
    "the refusal happens before any file is written");
});
