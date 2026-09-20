// world2-mirror-expiry.test.mjs — the reverse mirror dies PER LANE (DEC-2).
//
//   node --test test/world2-mirror-expiry.test.mjs
//
// Pure: no store, no Postgres, no clock of its own. The two falsifiers that
// enforce this law (world2/tools/falsifier-acts-parity.mjs and
// falsifier-acts-lane-closure.mjs) are operator tools run on the box with both
// stores live, so their `--prove-can-fail` arms are not reachable from `npm
// test`. This file is the same law's standing check inside the suite.
//
// THE LAW IT ASSERTS, verbatim, so a reader never has to trust a paraphrase:
//
//   PARITY MATRIX P-143 (RULED, Keemin, 2026-08-29 party night — "we can just
//   keep the arena on sqlite for now"):
//     "The 09-30 reverse-mirror expiry does NOT apply to an unflipped lane"
//
//   CUTOVER RUNBOOK, DEC-2 (ruled by the founder, 2026-08-29 evening):
//     "Make the expiry per-lane — a lane in `FLIP_REFUSED` by ruling is exempt;
//      a lane refused by unreadiness is not. Do not simply move the date. ...
//      Moving a shim's death date is the mechanism by which shims become
//      furniture (rule 5). Per-lane keeps the falsifier honest for the six
//      lanes it should govern."
//
// Before DEC-2, `MIRROR_EXPIRES` was one constant for the whole store and
// `mirrorExpired()` was a clock reading, so the arena reded on 2026-10-01 with
// everything else — the ruling and the mechanism disagreed, and the mechanism
// is what fires. Each test below fails on that old shape.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MIRROR_EXPIRES, LANE_MIRROR,
  mirrorExpiresFor, laneMirrorExpired, expiredLanes, exemptLanes,
  mirrorExpired, mirrorExpiryLine,
} from "../src/world2-acts.mjs";
import { laneOf } from "../src/world2-pen.mjs";
// The office's CLASS_* constants, as namespaces: the vocabulary check below
// reads the lane names off the PRODUCERS instead of re-typing them (POS-125).
// THE CLASSES LIVE IN THREE MODULES and that is the trap a one-module import
// walks into — `CLASS_STANCE` is world-stance.mjs's and `CLASS_ARENA_ACT` is
// arena.mjs's, so deriving from the journal alone reports `stance` as a row
// for a lane nobody produces. It did, on the first run of this change.
// These are imports and nothing more — no store is opened, no path resolved,
// no clock read (measured: ~37 ms for all three); the file's purity above is
// about what it TOUCHES, and this touches nothing.
import * as journalClasses from "../src/world-journal.mjs";
import * as stanceClasses from "../src/world-stance.mjs";
import * as arenaClasses from "../src/arena.mjs";

const BEFORE = new Date("2026-09-30T12:00:00Z");
const AFTER = new Date("2026-10-01T12:00:00Z");
const FAR = new Date("2099-01-01T00:00:00Z");

// The runbook's lane table C1–C6 is "the six lanes it should govern". Two of
// them have CLOSED (POS-125, 2026-09-20): their rows were deleted because
// nothing reads their rows out of the sqlite journal any more, which is what
// rule 6 + DEC-2 make the end of a lane's obligation. The two lists are kept
// SEPARATE and both are named, so this file says which lanes closed rather than
// quietly shrinking a constant — a list that only ever gets shorter cannot tell
// a closure from a deletion somebody fat-fingered.
const GOVERNED = ["stance", "hold", "frame", "mark"];
const CLOSED = ["walk", "say"];

test("the arena's mirror never expires — P-143, by ruling", () => {
  assert.equal(mirrorExpiresFor("arena"), null,
    "P-143: 'the 09-30 reverse-mirror expiry does NOT apply to an unflipped lane'");
  assert.equal(laneMirrorExpired("arena", AFTER), false);
  assert.equal(laneMirrorExpired("arena", FAR), false,
    "an exemption by ruling has no date to outlive — not a later one, not any one");
  assert.deepEqual(exemptLanes(), ["arena"],
    "the arena is the ONLY exemption; every other lane's refusal is unreadiness, not a ruling");
  assert.ok(LANE_MIRROR.arena.ruling.includes("keep the arena on sqlite for now"),
    "an exemption must carry the ruling's own words, or a later reader cannot check it");
});

test("a governed lane's expiry still fires — the shim cannot become furniture", () => {
  for (const lane of GOVERNED) {
    assert.equal(mirrorExpiresFor(lane), MIRROR_EXPIRES, `${lane} is governed by the shared backstop`);
    assert.equal(laneMirrorExpired(lane, BEFORE), false, `${lane} is not yet past ${MIRROR_EXPIRES}`);
    assert.equal(laneMirrorExpired(lane, AFTER), true,
      `${lane} must red past its backstop — rule 5: "No immortal twins"`);
  }
  assert.deepEqual(expiredLanes(AFTER), GOVERNED,
    "the red names exactly the lanes still owing a mirror — and not the arena, and not a closed lane");
  assert.equal(mirrorExpired(AFTER), true);
  assert.equal(mirrorExpired(BEFORE), false);
});

test("a closed lane is GONE, and stays gone — the deletion is the record", () => {
  // The whole of what rule 6 buys is that a lane's obligation ends by REMOVAL.
  // A deletion nothing asserts is a deletion the next hand undoes by reflex, so
  // the closed lanes get a standing check of their own: re-adding `walk` or
  // `say` has to argue with this test, and the argument it has to make is the
  // right one — name the reader that came back.
  for (const lane of CLOSED) {
    assert.ok(!Object.prototype.hasOwnProperty.call(LANE_MIRROR, lane),
      `${lane} closed (POS-125): its row was deleted because nothing reads its rows out of the sqlite `
      + "journal. Re-adding it asserts a 1.0 reader came back — name it, or the row is furniture.");
    assert.ok(!expiredLanes(FAR).includes(lane),
      `${lane} has no backstop left to outlive — a closed lane can never red, at any date`);
  }
  // …and closing is not exempting. The two answers differ and must keep
  // differing: `arena` is exempt BY RULING and stays in the map carrying it; a
  // closed lane is simply absent. A closed lane appearing in `exemptLanes()`
  // would mean somebody had re-added it with `expires: null`, which is an
  // exemption nobody ruled.
  assert.deepEqual(exemptLanes(), ["arena"],
    "closing a lane removes its row; it does not make it exempt — exemption is P-143's ruling and nothing else");
});

test("mark is governed: unreadiness buys no exemption", () => {
  // DEC-2: "a lane in FLIP_REFUSED by ruling is exempt; a lane refused by
  // unreadiness is not." Both `mark` and `arena` sit in FLIP_REFUSED
  // (src/world-journal.mjs) and the two refusals are NOT the same kind.
  assert.equal(mirrorExpiresFor("mark"), MIRROR_EXPIRES);
  assert.equal(laneMirrorExpired("mark", AFTER), true,
    "mark is refused for unreadiness (its candle half is unwired), which is not a ruling");
});

test("an unnamed lane fails CLOSED — nothing is exempt by omission", () => {
  assert.equal(mirrorExpiresFor("brand-new-lane"), MIRROR_EXPIRES,
    "a lane absent from LANE_MIRROR inherits the backstop; being unnamed must not buy immortality");
  assert.equal(laneMirrorExpired("brand-new-lane", AFTER), true);
  // A row that simply forgot to say is the same case, and it is the one a hand
  // edit actually produces. Exemption is an EXPLICIT null and nothing else.
  assert.deepEqual(expiredLanes(FAR, { forgot: {} }), ["forgot"]);
  assert.deepEqual(exemptLanes({ forgot: {} }), []);
});

test("a lane's obligation ends by removing its row, not by moving a date", () => {
  // What rule 6 actually buys: the ports land, the deletion is ruled, the row
  // goes. THEN the tools are green past any date — because the shim is dead,
  // not because its death was postponed.
  const closed = { arena: { expires: null } };
  assert.deepEqual(expiredLanes(FAR, closed), []);
  assert.equal(mirrorExpired(FAR, closed), false);
  assert.match(mirrorExpiryLine(closed), /No lane still owes a mirror/);
  assert.match(mirrorExpiryLine(closed), /exempt by ruling: arena/,
    "a green that hid the exemption would read as though the arena had been checked");

  // And moving the date alone changes nothing about which lanes are governed —
  // DEC-2: "Do not simply move the date." Asked over DEC-2's original six
  // (GOVERNED ∪ CLOSED — the union IS the ruling's scope), because the point is
  // about the ruling and not about today's map: a lane leaves this check by
  // being CLOSED, never by being re-dated.
  const dec2Six = [...GOVERNED, ...CLOSED];
  const moved = Object.fromEntries(dec2Six.map((l) => [l, { expires: "2027-12-31" }]));
  assert.deepEqual(expiredLanes(FAR, moved), dec2Six,
    "a later date is still a date; a lane owed a closure is still owed it in 2099");
});

test("LANE_MIRROR speaks laneOf's vocabulary exactly, both directions", () => {
  // The map is keyed by lane NAME, and a name-keyed reader drifts silently the
  // day the producer is renamed or gains a lane: the map would keep answering
  // for a lane nobody writes, and the new lane would fall to the backstop with
  // nobody having ruled on it. Both directions are checked, so neither drift is
  // the one nobody notices.
  // ── THE VOCABULARY IS READ OFF THE PRODUCER, NOT TYPED HERE (POS-125) ─────
  //
  // This list was nine hand-typed literals, and a copy of a vocabulary is a
  // copy, not a check: `CLASS_RIDE` shipped with the Post Office portal
  // (#2986, 2026-09-19), `laneOf` began producing a seventh lane name, and the
  // one test written to catch exactly that could not see it — its own list
  // predated the lane. Derived from the CLASS_* constants the journal actually
  // exports, a new class cannot arrive without arriving here too.
  // A class constant is a bare token — `CLASS_MARK_GATE_SQL` and its siblings
  // are also `CLASS_`-prefixed strings, and folding one of those through
  // `laneOf` would invent a lane out of a block of SQL. The value's shape is
  // what separates them, so it is the value that is tested.
  const classLanes = [journalClasses, stanceClasses, arenaClasses].flatMap((mod) =>
    Object.entries(mod)
      .filter(([k, v]) => k.startsWith("CLASS_") && typeof v === "string" && /^[a-z][a-z-]*$/.test(v))
      .map(([, v]) => laneOf({ class: v })));
  assert.ok(classLanes.includes("stance") && classLanes.includes("arena"),
    "the derivation reaches all three class-owning modules — if it does not, this check is asking "
    + "about a smaller vocabulary than the office actually produces, which is how it went blind before");
  // `join` / `leave` reach the arena by ACTION rather than by class, which no
  // class constant can express — `laneOf`'s own special case, so it is asked
  // in its own words.
  const produced = [...new Set([
    ...classLanes,
    laneOf({ action: "join" }), laneOf({ action: "leave" }),
  ])];
  const keys = Object.keys(LANE_MIRROR);

  // ── A REPORTED GAP, NOT AN EXEMPTION ──────────────────────────────────────
  //
  // `ride` is a lane `laneOf` produces with no row, so by `mirrorExpiresFor`'s
  // fail-closed rule it inherits the shared backstop — and NOTHING READS THAT
  // ANSWER: both falsifiers gate on `expiredLanes()`, which iterates this map's
  // own keys, and `laneMirrorExpired` has no production caller at all. So the
  // rule that an unnamed lane must never buy immortality by being unnamed has
  // no reader, and `ride` buys exactly that.
  //
  // Naming it here RECORDS the gap; it does not bless it. Whether the ride lane
  // is governed or exempt is a founder ruling, and POS-125 did not have one —
  // see docs/2026-09-20/w40-smalls/pos-125-lane-mirror/MEASUREMENT.md § F4. The
  // assertion still reds the day an eighth lane appears, and it reds the day
  // somebody rules on `ride`, which is the point: this list must be edited by
  // the hand that rules.
  const UNRULED = ["ride"];

  assert.deepEqual(produced.filter((l) => !keys.includes(l)).sort(), [...CLOSED, ...UNRULED].sort(),
    "a lane laneOf can produce with no LANE_MIRROR row that is neither a CLOSED lane nor a recorded "
    + "UNRULED gap — it would be governed by the fail-closed default with nobody having ruled on it, "
    + "and no falsifier would ever name it");
  assert.deepEqual(keys.filter((k) => !produced.includes(k)), [],
    "a LANE_MIRROR row for a lane laneOf never produces — a rule about a lane that does not exist");
});

test("the green line names the exemption and the soonest backstop", () => {
  const line = mirrorExpiryLine();
  // The COUNT is derived from GOVERNED rather than typed, so a future closure
  // updates one list and this follows. A literal here would have to be edited
  // by the same hand for the same reason, and the day it is not, the green
  // line and the map disagree while both still parse.
  assert.match(line, new RegExp(`${GOVERNED.length} lane\\(s\\) still mirroring`));
  assert.match(line, new RegExp(`soonest ${MIRROR_EXPIRES}`));
  assert.match(line, /exempt by ruling: arena/);
  // And the green NAMES them. A count alone cannot tell a reader that a lane
  // they expected to be closed is still in the list — which is the whole
  // question anyone reads this line to answer.
  for (const lane of GOVERNED) assert.ok(line.includes(lane), `the green line names ${lane}`);
  for (const lane of CLOSED) {
    assert.ok(!new RegExp(`\\b${lane}\\b`).test(line),
      `${lane} closed, so it must not appear in the line that says who is still mirroring`);
  }
});

// ── THE BACKSTOP IS A TOWN DAY (added 2026-08-30, the v1 dated-derivation sweep)

test("a lane's backstop ends when the TOWN's day ends, not when the wire's does", () => {
  // The law every dated derivation in this repo answers, quoted from the fix
  // that bought it (src/town-bridge.mjs, the 2026-08-30 gift blackout):
  //
  //   "THE TOWN'S DAY, NOT THE WIRE'S ... the 00:00Z crossing (8 PM in town)
  //    stamped its registry lines with TOMORROW's date ... Every other dated
  //    writer in this repo derives the day from TOWN_TZ (ops.townDay, declare,
  //    residency, the mint engine itself)."
  //
  // 2026-10-01T02:00Z is 2026-09-30, 22:00, in America/New_York. The town's own
  // 09-30 has two hours left to run, so a lane whose backstop IS 09-30 is not
  // past it. Under `toISOString().slice(0, 10)` this instant read 2026-10-01 and
  // every governed lane reported expired — the backstop firing four hours early,
  // on every single one of them, every night of its last day.
  const townStillTheThirtieth = new Date("2026-10-01T02:00:00Z");
  assert.equal(MIRROR_EXPIRES, "2026-09-30", "this test is written against that backstop specifically");

  for (const lane of GOVERNED) {
    assert.equal(laneMirrorExpired(lane, townStillTheThirtieth), false,
      `${lane} reported past its 2026-09-30 backstop while it is still 2026-09-30 in town`);
  }
  assert.deepEqual(expiredLanes(townStillTheThirtieth), []);

  // …and it DOES fire once the town's day is actually over: 04:00Z is 00:00 ET.
  const townNowTheFirst = new Date("2026-10-01T04:00:00Z");
  assert.deepEqual(expiredLanes(townNowTheFirst), GOVERNED,
    "a backstop that never fires is not a backstop — the shim would become furniture");
});

test("a day already written down is not re-derived — a string passes through", () => {
  // `new Date("2026-09-30")` is midnight UTC, which is 2026-09-29 in town. If a
  // caller hands a DAY and the derivation treats it as an INSTANT, the day moves
  // backwards by one and the backstop slips a whole extra day. A day is derived
  // from an instant and only from an instant.
  assert.equal(laneMirrorExpired("stance", "2026-09-30"), false, "its own backstop day is not past it");
  assert.equal(laneMirrorExpired("stance", "2026-10-01"), true, "the day after is");
  assert.equal(laneMirrorExpired("stance", "2026-09-29"), false);
});
