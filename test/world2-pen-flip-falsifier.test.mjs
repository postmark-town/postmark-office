// world2-pen-flip-falsifier.test.mjs — two of the three defects the 2026-09-03
// hold/say flip found, each held down by a test that fails if the defect
// returns. (The third, the replay's missing dedupe, is
// test/world2-replay-dedupe.test.mjs.)
//
// Both are DECISIONS, and every one of them is pure with respect to the
// stores: which instant a lane is asked about, and which side of the rollback
// set a twin stands on. The database half is proved on the box
// (test/world2-replay-ingest.test.mjs's own contract: "the DB half ... is
// proved on the box"), but a decision that can only be read with a live
// Postgres in front of it is a decision nobody reviews.
//
// THE RECEIPTS THESE TESTS STAND ON (G:/Starstory/docs/2026-09-03/
// w2-hold-say-flip-report.md § Findings, reproduced live on the prod store
// 2026-09-03 before the fix):
//
//   finding 1 · `--lanes stance` → "RED: 3/5 flipped acts lack their reverse
//     twin" — acts 3867, 3868, 4175, all three standing in world main's
//     STATE/log (165.7653 seq 899/900, 167 seq 915). The journal had been
//     truncated by the drain at seq 917.
//   finding 2 · `--lanes stance,hold,say --since 2026-09-02T21:02:00Z` →
//     "RED: 81/91" — 76 voice + 2 holding rows the MIRROR wrote before those
//     lanes flipped, plus the 3 of finding 1.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { LANE_FLIPPED_AT, laneFlippedAt, flippedLanesAt } from "../src/world2-acts.mjs";
import { laneOf } from "../src/world2-pen.mjs";
import { sinceForLanes, readStateLog, twinSideOf, twinKey } from "../world2/tools/falsifier-pen-flip.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

// ── finding 2: one clock for lanes that flip on different days ───────────────

test("LANE_FLIPPED_AT speaks laneOf's vocabulary exactly, both directions", () => {
  // LANE_MIRROR's own rule, one table over and for its reason: a name-keyed map
  // drifts silently the day a lane is renamed or added. Here the drift is worse
  // in one direction than the other — a lane laneOf produces with no row here
  // reads as UNFLIPPED, which is the safe default, but only because it is the
  // default; a row for a lane nothing produces is a date about nothing.
  const produced = [...new Set([
    { class: "stance" }, { class: "voice" }, { class: "holding" }, { class: "move" },
    { class: "frame" }, { class: "mark" }, { class: "arena-act" },
    { action: "join" }, { action: "leave" },
  ].map(laneOf))];
  const keys = Object.keys(LANE_FLIPPED_AT);
  assert.deepEqual(produced.filter((l) => !keys.includes(l)), [],
    "a lane laneOf can produce with no LANE_FLIPPED_AT row");
  assert.deepEqual(keys.filter((k) => !produced.includes(k)), [],
    "a LANE_FLIPPED_AT row for a lane laneOf never produces");
});

test("an unnamed lane has not flipped — nothing gains a flipped era by omission", () => {
  assert.equal(laneFlippedAt("brand-new-lane"), null);
  assert.equal(laneFlippedAt("arena"), null, "the arena has not flipped (P-143: exempt by ruling)");
  assert.equal(laneFlippedAt("arena"), null, "refused by ruling, P-143");
  assert.deepEqual(flippedLanesAt().sort(), ["frame", "hold", "mark", "say", "stance", "walk"]);
});

test("the three flipped lanes carry the instant their SERVICE restarted", () => {
  // Not the first act observed after the flip: an act proves the flip happened
  // before it, the restart IS the flip. Both dates are quoted from the lane's
  // own flip report.
  assert.equal(LANE_FLIPPED_AT.stance, "2026-09-02T21:01:58Z");
  assert.equal(LANE_FLIPPED_AT.hold, "2026-09-03T18:58:05Z");
  assert.equal(LANE_FLIPPED_AT.say, LANE_FLIPPED_AT.hold, "C2 and C4 flipped in one restart");
});

test("FINDING 2 · with no --since, each lane is asked about from its OWN flip", () => {
  const { since, shape, unflipped } = sinceForLanes(["stance", "hold", "say"], null);
  assert.equal(shape, "table");
  assert.deepEqual(unflipped, []);
  assert.equal(since.stance, "2026-09-02T21:01:58.000Z");
  assert.equal(since.say, "2026-09-03T18:58:05.000Z");
  // THE DEFECT, stated as the thing that must not be true: the say lane must not
  // be asked about from the stance lane's flip. That single clock is what read
  // 76 mirror-written voice rows as "flipped acts lacking twins".
  assert.notEqual(since.say, since.stance,
    "one clock for lanes that flipped a day apart is finding 2 itself");
  assert.ok(since.say > since.stance);
});

test("FINDING 2 · the one-clock shape still works, and says that it is one clock", () => {
  // An operator asking "what happened after 18:58" deserves that answer. What
  // they must not get is that answer while believing it is per-lane. This date
  // is after both flips, so nothing is clamped.
  const { since, shape, clamped } = sinceForLanes(["stance", "say"], "2026-09-03T18:59:00Z");
  assert.equal(shape, "one-clock");
  assert.equal(since.stance, since.say);
  assert.deepEqual(clamped, []);
});

test("FINDING 2 · CAN FAIL — the exact argv that produced the 81 is clamped", () => {
  // The run that found the defect: `--lanes stance,hold,say --since <the stance
  // flip>`. Under the old tool that read 76 mirror-written voice rows and 2
  // holding rows as flipped acts lacking twins. Making only the DEFAULT
  // per-lane would have left this run broken, and this run is the one that
  // happened.
  const { since, clamped } = sinceForLanes(["stance", "hold", "say"], "2026-09-02T21:02:00Z");
  assert.equal(since.stance, "2026-09-02T21:02:00.000Z", "after its own flip, so the operator's date stands");
  assert.equal(since.say, "2026-09-03T18:58:05.000Z", "before the say flip, so it is raised to the flip");
  assert.equal(since.hold, "2026-09-03T18:58:05.000Z");
  assert.deepEqual(clamped.map((c) => c.lane).sort(), ["hold", "say"],
    "and the clamp is reported, because a window that silently moved is a window nobody can judge");
});

test("a narrower --since is the operator's word and is kept", () => {
  // The clamp only ever moves a date FORWARD to a flip. Asking about the last
  // hour of a lane that flipped yesterday is a question the tool must answer.
  const { since, clamped } = sinceForLanes(["stance"], "2026-09-03T20:00:00Z");
  assert.equal(since.stance, "2026-09-03T20:00:00.000Z");
  assert.deepEqual(clamped, []);
});

test("FINDING 2 · --since names lanes, and an unnamed lane falls to its own row", () => {
  const { since, shape } = sinceForLanes(["stance", "hold", "say"], "say=2026-09-03T20:00:00Z");
  assert.equal(shape, "per-lane");
  assert.equal(since.say, "2026-09-03T20:00:00.000Z", "the operator's word wins for the lane they named");
  assert.equal(since.stance, "2026-09-02T21:01:58.000Z", "and the others keep their own flip");
});

test("FINDING 2 · an unflipped lane is set aside, not compared", () => {
  const { since, unflipped } = sinceForLanes(["stance", "arena"], null);
  assert.deepEqual(unflipped, ["arena"]);
  assert.equal(since.arena, undefined,
    "the arena's journal_seq-NULL rows are the mirror's; pairing them against a journal that never held them IS finding 2");
  // …unless the operator names it, which is how the NEXT lane is checked at the
  // moment of its flip, before its row is written down.
  const named = sinceForLanes(["walk"], "walk=2026-09-05T20:00:00Z");
  assert.equal(named.since.walk, "2026-09-05T20:00:00.000Z");
  assert.deepEqual(named.unflipped, []);
});

test("a --since that is not a time is refused, not silently ignored", () => {
  assert.throws(() => sinceForLanes(["stance"], "yesterday"), /not a time/);
  assert.throws(() => sinceForLanes(["stance"], "stance=soon"), /not a time/);
  assert.throws(() => sinceForLanes(["stance"], "stance="), /not <lane>=<ISO>/);
});

// ── finding 1: the rollback set is the journal ∪ the drained photograph ──────

const withStateLog = (lines, fn) => {
  const dir = tempDir("penflip-log-");
  try {
    mkdirSync(join(dir, "STATE", "log"), { recursive: true });
    for (const [file, rows] of Object.entries(lines)) {
      writeFileSync(join(dir, "STATE", "log", file), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    }
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

// The three stance acts of finding 1, verbatim from world main's photograph.
const PHOTOGRAPH = {
  "165.7653.journal.jsonl": [
    { at: "2026-09-02T21:10:59.979Z", type: "declare-stance-on", actor: "wright", seq: 899, class: "stance", object: "glados-letta/glados-letta" },
    { at: "2026-09-02T21:11:00.125Z", type: "declare-stance-on", actor: "wright", seq: 900, class: "stance", object: "glados-letta/glados-letta-parcel" },
  ],
  "167.journal.jsonl": [
    { at: "2026-09-03T13:13:54.873Z", type: "declare-stance-on", actor: "wright", seq: 915, class: "stance", object: "rei/the-white-flower-at-wrights-door" },
  ],
};
const ACT_3867 = { id: "3867", at: "2026-09-02T21:10:59.979Z", actor: "wright", action: "declare-stance-on", object: "glados-letta/glados-letta" };

test("FINDING 1 · a drained act is found on the STATE/log side, not called lost", () => {
  withStateLog(PHOTOGRAPH, (dir) => {
    const photo = readStateLog(dir);
    assert.equal(photo.lines, 3);
    assert.equal(photo.horizon, "2026-09-03T13:13:54.873Z");
    // The journal is EMPTY — exactly the box's state after the 17:45Z drain.
    const v = twinSideOf(ACT_3867, { journalTwin: null, logIndex: photo.index, horizon: photo.horizon });
    assert.equal(v.side, "state-log", "the act the old check called lost stands in 1.0's photograph");
    assert.equal(v.seq, 899);
  });
});

test("FINDING 1 · the journal still answers first when it holds the row", () => {
  withStateLog(PHOTOGRAPH, (dir) => {
    const photo = readStateLog(dir);
    const v = twinSideOf(ACT_3867, { journalTwin: { seq: 899 }, logIndex: photo.index, horizon: photo.horizon });
    assert.equal(v.side, "journal");
  });
});

test("FINDING 1 · CAN FAIL — an act in neither store is still RED", () => {
  // The whole risk of this fix is that it turns a real loss green. So the flip:
  // an act nothing ever wrote, dated below the photograph's horizon.
  withStateLog(PHOTOGRAPH, (dir) => {
    const photo = readStateLog(dir);
    const lost = { ...ACT_3867, actor: "nobody-ever-wrote-this", at: "2026-09-02T21:10:59.979Z" };
    const v = twinSideOf(lost, { journalTwin: null, logIndex: photo.index, horizon: photo.horizon });
    assert.equal(v.side, null, "a twin found nowhere is the only RED");
    assert.equal(v.undecidable, undefined, "and it is RED, not excused");
  });
});

test("FINDING 1 · an act newer than the photograph is UNDECIDABLE, not red and not green", () => {
  // Between a write and the next crossing-save, the row is in the journal. If it
  // is in neither, the honest answer is that the clone has not caught up — a
  // check that paged an operator here would be crying wolf on every run.
  withStateLog(PHOTOGRAPH, (dir) => {
    const photo = readStateLog(dir);
    const fresh = { ...ACT_3867, id: "9999", at: "2026-09-03T23:59:00.000Z" };
    const v = twinSideOf(fresh, { journalTwin: null, logIndex: photo.index, horizon: photo.horizon });
    assert.equal(v.side, null);
    assert.match(v.undecidable, /horizon/);
  });
});

// ── finding 3: a stake-released mark has TWO instants, and both are right ────
//
// Reproduced on the live store, 2026-09-05, by running the falsifier itself:
//
//   since (table): mark=2026-09-05T19:12:06.000Z
//   photograph: 6489 line(s) across 471 STATE/log file(s), newest 17:09:09.155Z
//   UNDECIDABLE: acts 4496 (wright amend wright/the-flip-day-plumb-line
//     @ 2026-09-05T19:13:28.218Z, lane mark) — newer than the photograph's horizon
//   CANNOT RUN · 1/4 flipped act(s) this store cannot answer for.
//
// and the twin was there the whole time, in sqlite, at a different instant:
//
//   journal seq 1120   wright amend wright/the-flip-day-plumb-line  19:13:13.805Z
//   acts    4496       wright amend wright/the-flip-day-plumb-line  19:13:28.218Z
//
// 14.4 seconds and one stake. Phase 5.6 defers an unstaked mark — the journal
// row is the COMPOSE, no act is mirrored — and `promoteDraftOnStake` inserts the
// act at the RELEASE, under its own heading: "THE ACT IS DATED AT THE
// PUTTING-FORWARD, not at the composing." Both instants are correct and the
// tuple cannot pair them.
//
// The word it came back wearing is the finding. UNDECIDABLE is a blind spot in a
// soft word, and it only stayed soft because the clone's horizon was behind; the
// moment a clone is fetched past 19:13:28 the same row goes RED with "a rollback
// would lose this act", which is false. The last two tests below are those two
// failure modes, run against the fix.

const PLUMB_LINE = {
  "171.journal.jsonl": [
    { at: "2026-09-05T19:12:46.416Z", type: "leave-mark", actor: "wright", seq: 1119, class: "mark", object: "wright/the-flip-day-plumb-line" },
    { at: "2026-09-05T19:13:13.805Z", type: "amend", actor: "wright", seq: 1120, class: "mark", object: "wright/the-flip-day-plumb-line" },
  ],
};
/** acts 4496, verbatim: the release instant, and `class` because the pass is keyed on it. */
const ACT_4496 = {
  id: "4496", at: "2026-09-05T19:13:28.218Z", actor: "wright", action: "amend",
  object: "wright/the-flip-day-plumb-line", class: "mark",
};

test("FINDING 3 · a stake-released mark pairs with its COMPOSE row, and says that it did", () => {
  withStateLog(PLUMB_LINE, (dir) => {
    const photo = readStateLog(dir);
    const v = twinSideOf(ACT_4496, {
      journalTwin: null, logIndex: photo.index, looseIndex: photo.loose, horizon: photo.horizon,
    });
    assert.equal(v.side, "state-log", "the twin is there — 14 seconds earlier, under the compose instant");
    assert.equal(v.seq, 1120, "and it is the AMEND's row, not the leave-mark that preceded it");
    assert.equal(v.released, "2026-09-05T19:13:13.805Z",
      "the compose instant is REPORTED, so an operator can see this row was paired the loose way");
  });
});

test("FINDING 3 · the exact tuple still wins when it matches — the loose pass is a fallback, not a replacement", () => {
  withStateLog(PLUMB_LINE, (dir) => {
    const photo = readStateLog(dir);
    const exact = { ...ACT_4496, at: "2026-09-05T19:13:13.805Z" };
    const v = twinSideOf(exact, {
      journalTwin: null, logIndex: photo.index, looseIndex: photo.loose, horizon: photo.horizon,
    });
    assert.equal(v.side, "state-log");
    assert.equal(v.seq, 1120);
    assert.equal(v.released, undefined, "an exact pairing is not announced as a loose one");
  });
});

test("FINDING 3 · CAN FAIL — an act in neither store is still RED, loose pass and all", () => {
  // The whole risk of a looser key is that it turns a real loss green. Same flip
  // as finding 1's, on a mark-class act so the released pass actually runs.
  withStateLog(PLUMB_LINE, (dir) => {
    const photo = readStateLog(dir);
    // Dated BELOW the fixture's horizon (19:13:13.805Z), because above it the
    // honest answer really is "not drained yet" and the flip would be proving
    // the horizon rule rather than this one.
    const lost = { ...ACT_4496, actor: "nobody-ever-wrote-this", at: "2026-09-05T19:13:00.000Z" };
    const v = twinSideOf(lost, {
      journalTwin: null, logIndex: photo.index, looseIndex: photo.loose, horizon: photo.horizon,
    });
    assert.equal(v.side, null, "a twin found nowhere is still the only RED");
    assert.equal(v.undecidable, undefined, "and it is RED, not excused by the horizon");
  });
});

test("FINDING 3 · CAN FAIL — the loose pass never pairs FORWARDS in time", () => {
  // A twin cannot be composed after the release that published it. Without the
  // `<= act.at` bound this act would pair with a row 27 seconds in its future,
  // which is not a compose and not its twin.
  withStateLog(PLUMB_LINE, (dir) => {
    const photo = readStateLog(dir);
    const early = { ...ACT_4496, at: "2026-09-05T19:12:00.000Z" };
    const v = twinSideOf(early, {
      journalTwin: null, logIndex: photo.index, looseIndex: photo.loose, horizon: photo.horizon,
    });
    assert.equal(v.side, null, "nothing at or before this instant, so nothing pairs");
  });
});

test("FINDING 3 · the loose pass is the MARK lane's alone — no other class is deferred", () => {
  // Phase 5.6 defers `class === "mark"` and nothing else, so nothing else has a
  // compose instant that differs from its act's. Keyed on the class the act
  // carries, not on the lane name the operator typed, so `--lanes` cannot widen
  // it by accident. Same rows, same near-miss instant, a different class.
  withStateLog({
    "171.journal.jsonl": [
      { at: "2026-09-05T19:13:13.805Z", type: "amend", actor: "wright", seq: 1120, class: "stance", object: "wright/the-flip-day-plumb-line" },
    ],
  }, (dir) => {
    const photo = readStateLog(dir);
    const stanceAct = { ...ACT_4496, class: "stance" };
    const v = twinSideOf(stanceAct, {
      journalTwin: null, logIndex: photo.index, looseIndex: photo.loose, horizon: photo.horizon,
    });
    assert.equal(v.side, null, "a stance act 14 seconds off its row is a real miss, and stays one");
  });
});

test("FINDING 3 · the released pass runs BEFORE the horizon excuse — that ordering IS the finding", () => {
  // The live reproduction only said UNDECIDABLE because the clone's horizon was
  // behind. If the loose pass ran after the horizon check, the fix would do
  // nothing on exactly the run that found the defect.
  withStateLog({
    "170.journal.jsonl": [
      { at: "2026-09-05T19:13:13.805Z", type: "amend", actor: "wright", seq: 1120, class: "mark", object: "wright/the-flip-day-plumb-line" },
    ],
  }, (dir) => {
    const photo = readStateLog(dir);
    // A horizon BEHIND the act — the live condition, 17:09 against 19:13.
    const v = twinSideOf(ACT_4496, {
      journalTwin: null, logIndex: photo.index, looseIndex: photo.loose,
      horizon: "2026-09-05T17:09:09.155Z",
    });
    assert.equal(v.side, "state-log", "paired, not excused as newer than the photograph");
    assert.equal(v.undecidable, undefined);
  });
});

// ── finding 3, cardinality: ONE COMPOSE ROW MAY ANSWER FOR ONE ACT ──────────
//
// The reviewer's catch on the fix above, and it is the seam re-entering through
// its own repair. `looseKey` drops the instant, so its answer is "the newest
// compose of this (actor, action, object) at or before you". Asked by TWO
// released acts on one object, it hands both the SAME row — and the check
// reports GREEN twice while one of the two acts has no twin at all. A loosened
// key that says green about an act it never paired is exactly the class this
// whole file exists to stop.
//
// It is reachable: `promoteDraftOnStake` promotes one draft per (claimant, slug,
// household), so two drafts cannot stand at once — but compose, stake, compose
// again, stake again gives two acts over two composes, and an out-of-order
// release dates the second act at or after BOTH composes. The exact key is
// untouched by any of this; only the loose pass can do it, so only the loose
// pass is policed.

const TWO_COMPOSES = {
  "171.journal.jsonl": [
    { at: "2026-09-05T19:10:00.000Z", type: "amend", actor: "wright", seq: 1110, class: "mark", object: "wright/the-twice-composed" },
    { at: "2026-09-05T19:13:13.805Z", type: "amend", actor: "wright", seq: 1120, class: "mark", object: "wright/the-twice-composed" },
  ],
};
const releasedAct = (id, at) => ({
  id, at, actor: "wright", action: "amend", object: "wright/the-twice-composed", class: "mark",
});

test("FINDING 3 · CARDINALITY: two released acts cannot share one compose row — the second is RED, by name", () => {
  withStateLog(TWO_COMPOSES, (dir) => {
    const photo = readStateLog(dir);
    const claimed = new Map();
    const ask = (act) => twinSideOf(act, {
      journalTwin: null, logIndex: photo.index, looseIndex: photo.loose, horizon: photo.horizon, claimed,
    });

    // Out of order: the LATER act is asked first and takes the newest compose.
    const first = ask(releasedAct("4496", "2026-09-05T19:20:00.000Z"));
    assert.equal(first.side, "state-log");
    assert.equal(first.seq, 1120, "the newest compose at or before it");

    // A second act on the same object, also dated after both composes, would be
    // handed seq 1120 again by the newest-at-or-before rule alone.
    const second = ask(releasedAct("4497", "2026-09-05T19:21:00.000Z"));
    assert.equal(second.side, null, "it must NOT be paired to a row another act already owns");
    assert.equal(second.undecidable, undefined, "and it is not excused as undrained — the store was read");
    assert.match(second.conflict, /already the twin of acts 4496/,
      "the finding names the act that took the row, or an operator cannot see what happened");
    assert.match(second.conflict, /one of them has no twin/);
  });
});

test("FINDING 3 · CARDINALITY: the SAME act asked twice is not a conflict with itself", () => {
  // A re-ask (a retry, a second pass) must be idempotent. Keying the ledger on
  // the act id rather than on "has this row been claimed at all" is what makes
  // that true, and without this test the rule would look correct while being
  // one re-entrant call away from a false red.
  withStateLog(TWO_COMPOSES, (dir) => {
    const photo = readStateLog(dir);
    const claimed = new Map();
    const act = releasedAct("4496", "2026-09-05T19:20:00.000Z");
    const opts = { journalTwin: null, logIndex: photo.index, looseIndex: photo.loose, horizon: photo.horizon, claimed };
    assert.equal(twinSideOf(act, opts).seq, 1120);
    const again = twinSideOf(act, opts);
    assert.equal(again.seq, 1120, "the same act gets the same answer");
    assert.equal(again.conflict, undefined, "and is not accused of stealing from itself");
  });
});

test("FINDING 3 · CARDINALITY: two acts that pair to DIFFERENT composes are both green", () => {
  // The control. Without it the rule above would pass against a check that
  // refused every second act on an object, which is a different bug wearing the
  // same green. Dated so that each act's newest-at-or-before is its own row.
  withStateLog(TWO_COMPOSES, (dir) => {
    const photo = readStateLog(dir);
    const claimed = new Map();
    const ask = (act) => twinSideOf(act, {
      journalTwin: null, logIndex: photo.index, looseIndex: photo.loose, horizon: photo.horizon, claimed,
    });
    const a = ask(releasedAct("4496", "2026-09-05T19:11:00.000Z"));
    const b = ask(releasedAct("4497", "2026-09-05T19:20:00.000Z"));
    assert.equal(a.seq, 1110, "the earlier act takes the earlier compose");
    assert.equal(b.seq, 1120, "the later act takes the later one");
    assert.equal(a.conflict, undefined);
    assert.equal(b.conflict, undefined);
  });
});

test("FINDING 3 · CARDINALITY: with no ledger passed, behaviour is exactly what it was", () => {
  // `claimed` defaults to null, which disables the rule — the shape every
  // single-act unit test above relies on. Stated as an assertion so a future
  // change that made the ledger mandatory reds here rather than in six other
  // tests for a reason nobody would connect to this one.
  withStateLog(TWO_COMPOSES, (dir) => {
    const photo = readStateLog(dir);
    const opts = { journalTwin: null, logIndex: photo.index, looseIndex: photo.loose, horizon: photo.horizon };
    assert.equal(twinSideOf(releasedAct("4496", "2026-09-05T19:20:00.000Z"), opts).seq, 1120);
    assert.equal(twinSideOf(releasedAct("4497", "2026-09-05T19:21:00.000Z"), opts).seq, 1120,
      "no ledger, no cardinality rule — and that is the documented default, not an accident");
  });
});

test("FINDING 1 · with NO clone an unpaired act is UNDECIDABLE — never a green", () => {
  const v = twinSideOf(ACT_3867, { journalTwin: null, logIndex: null, horizon: null });
  assert.equal(v.side, null);
  assert.match(v.undecidable, /no world clone/,
    "an act that really was lost reads identically without the photograph; the check must refuse to judge");
});

test("the twin key is the drain's own conversion, read backwards", () => {
  // world-drain.logLine writes `at: row.written_at` and `type: row.action`, so
  // (actor, action, written_at, object) on an act is (actor, type, at, object)
  // on a line. If those two ever disagree, every drained twin goes missing at
  // once — which is finding 1 wearing a different hat.
  withStateLog(PHOTOGRAPH, (dir) => {
    const photo = readStateLog(dir);
    assert.ok(photo.index.has(twinKey("wright", "declare-stance-on", "2026-09-03T13:13:54.873Z", "rei/the-white-flower-at-wrights-door")));
    assert.ok(!photo.index.has(twinKey("wright", "declare-stance-on", "2026-09-03T13:13:54.873Z", null)),
      "object is part of the key, and a null object is not a wildcard");
  });
});

test("the fractional .journal filenames ARE seen — seed-import's own pattern", () => {
  // The 08-27 hand-drain filed four windows under `152.9084.journal.jsonl`. A
  // pattern that skips a file does not refuse; it does not see it at all. This
  // reader uses LOG_FILE rather than a second pattern for exactly that reason.
  withStateLog(PHOTOGRAPH, (dir) => {
    const photo = readStateLog(dir);
    assert.equal(photo.files, 2, "both `<n>.<frac>.journal.jsonl` and `<n>.journal.jsonl` are the log");
  });
});

test("a malformed log line is REFUSED, not skipped", () => {
  // seed-import's rule, and for its reason: a reader that drops the one line it
  // could not parse calls an act lost by exactly the amount nobody will look
  // for. Both malformations are named, with the file and the line.
  const bad = (body) => {
    const dir = tempDir("penflip-bad-");
    try {
      mkdirSync(join(dir, "STATE", "log"), { recursive: true });
      writeFileSync(join(dir, "STATE", "log", "1.jsonl"), body);
      return () => readStateLog(dir);
    } finally { /* the caller runs before the dir is gone */ }
  };
  assert.throws(bad('{"at":"2026-09-01T00:00:00Z","actor":"a","type":"t"}\n{not json\n'), /1\.jsonl:2 is not JSON/);
  assert.throws(bad('{"at":"whenever","actor":"a","type":"t"}\n'), /1\.jsonl:1 has an 'at' that is not a time/);
});

