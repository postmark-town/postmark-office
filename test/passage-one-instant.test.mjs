// passage-one-instant.test.mjs — a passage's ferry and its iso come from ONE
// clock reading, taken after the door's reads (POS-618, 2026-10-14;
// src/world-crossings.mjs § passageInstant).
//
// The defect, measured on prod's live ledger: the enter and exit doors read the
// ferry first, then the world, the ledger and the standpoint, and the verb
// stamped the iso from a second reading. 114 of 2,084 live rows carry a ferry
// up to 59 s behind their own iso, and 3 of them land behind a row written
// before them. Here every read the door makes moves a fake clock on by 10 s, so
// a stamp taken before the reads, or a second reading, shows up as a mismatch.
// The fake clock starts far from the wall clock, so an iso stamped from a
// second, real reading cannot match it by accident.
//
// Also pinned: with no `deps.now`, the ferry is the ferry's clock, not the
// unix-half-day count (about 40,000 crossings ahead) the doors used to fall
// back to; and a `now` that names its own instant keeps it as the ferry while
// the iso is still the write. (enter_on_arrival used that to date rows ahead;
// since WLD-5 only its pre-check does, and the pre-check writes nothing.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { enterViaOffice, exitViaOffice, occupancyViaOffice } from "../src/world-crossings.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const CLONE = worldClone();
const HAVE_CLONE = !!CLONE && existsSync(join(CLONE, "tools", "enter-exit.mjs"));
const WHY_NOT = CLONE ? `the world clone at ${CLONE} carries no tools/enter-exit.mjs` : NO_WORLD;
const SKIP = { skip: !HAVE_CLONE && WHY_NOT };

const key = (...handles) => ({ handles: new Set(handles) });
const SHIP = "the-town/the-post-office";

// The ferry's clock, written out here rather than imported, so the test is a
// second instrument: the engine's epoch and its twelve-hour crossing.
const EPOCH = Date.UTC(2026, 5, 12);
const HALF_DAY = 12 * 3600 * 1000;
const ferryOf = (ms) => Math.floor(((ms - EPOCH) / HALF_DAY) * 1e4) / 1e4;
const RE = /^- (\S+) · \S+ · (?:enters|exits) \S+ · ferry (\d+\.\d{4})/;

/** An office whose every read takes ten seconds, on a clock it owns. The pen
 *  notes the clock at the moment it is handed the rows. */
async function slowOffice({ standing = { x: -9, y: 35.5 }, start = Date.UTC(2026, 9, 1, 12), now = "the clock", world = null } = {}) {
  const worldState = world ?? JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  const law = await import(`file:///${join(CLONE, "tools", "enter-exit.mjs").replace(/\\/g, "/")}`);
  let t = start;
  const slow = (v) => { t += 10_000; return v; };
  let text = "";
  const writes = [];
  const deps = {
    world: async () => slow(worldState),
    ledger: async () => slow(text),
    standpointOf: async (who) => slow({ ...standing, name: who }),
    nowMs: () => t,
    record: async ({ lines, handle, at }) => {
      writes.push({ lines, t });
      text += lines.join("\n") + "\n";
      const acts = law.parseEnterExitLedger(text).acts;
      return { lines, within: law.occupancyAt(acts, at).get(handle) ?? [], commit: "deadbeef", pushed: false };
    },
  };
  if (now === "the clock") deps.now = (ms = t) => (ms - EPOCH) / HALF_DAY;
  else if (typeof now === "function") deps.now = now;
  return { deps, writes, clock: () => t };
}

const stampsOf = (line) => { const m = String(line).match(RE); return m ? { iso: m[1], ferry: +m[2] } : null; };

test("ONE INSTANT — an enter's ferry and iso are one reading, taken after the reads", SKIP, async () => {
  const o = await slowOffice();
  const answer = await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), o.deps);
  assert.ok(answer.entered?.length, "the enter wrote rows");
  assert.equal(o.writes.length, 1);
  const { lines, t } = o.writes[0];
  for (const line of lines) {
    const s = stampsOf(line);
    assert.ok(s, `a passage line: ${line}`);
    assert.equal(s.iso, new Date(t).toISOString(), "the iso is the reading the pen was handed, not a second one");
    assert.equal(s.ferry, ferryOf(t), "the ferry is that same reading, taken after the world, ledger and standpoint reads");
  }
});

test("ONE INSTANT — an exit's ferry and iso are one reading, taken after the reads", SKIP, async () => {
  const o = await slowOffice();
  await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), o.deps);
  const answer = await exitViaOffice(CLONE, { handle: "postmaster" }, key("postmaster"), o.deps);
  assert.equal(answer.target, SHIP);
  const { lines, t } = o.writes.at(-1);
  const s = stampsOf(lines[0]);
  assert.equal(s.iso, new Date(t).toISOString());
  assert.equal(s.ferry, ferryOf(t));
});

test("ONE INSTANT — a `now` that names its own instant keeps it as the ferry, and the write as the iso", SKIP, async () => {
  const ARRIVAL = 250.1234;
  const o = await slowOffice({ now: () => ARRIVAL });
  await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), o.deps);
  const { lines, t } = o.writes[0];
  const s = stampsOf(lines[0]);
  assert.equal(s.ferry, ARRIVAL, "the ferry is the instant the deps named");
  assert.equal(s.iso, new Date(t).toISOString(), "the iso is when the row was written");
});

test("NO HALF-DAY CLOCK — a door with no `now` stamps the ferry's own clock", SKIP, async () => {
  const before = Date.now();
  const o = await slowOffice({ start: before, now: null });
  await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), o.deps);
  const { lines, t } = o.writes[0];
  assert.equal(stampsOf(lines[0]).ferry, ferryOf(t), "about 248 in October 2026, never about 40,000");
  const read = await occupancyViaOffice(CLONE, {}, { ledger: async () => "" });
  const wall = ferryOf(Date.now());
  assert.ok(Math.abs(read.at - wall) <= 0.001, `the occupancy read's clock is the ferry's (${read.at} vs ${wall})`);
});

// ONE FLOOR (POS-699, 2026-10-19). The test above went red about one run in ten,
// and it was right: passageInstant floors the ferry with the world's stampAt, and
// the world's formatEnterExit floored it a second time. In floats stampAt is not
// idempotent ((k/1e4)·1e4 can land just under k), so about 9% of rows carried a
// ferry 0.0001 crossing (4.32 s) early. Here the real door writes at 300 chosen
// instants of a day, 4,321 ms apart, so the instants that the second floor broke
// are always among them: every row's ferry is its own reading's floor. One world
// object serves all 300: the door's world reads are keyed on it, and a fresh parse
// per door costs ~0.7 s, which 300 times is past the file's cap.
test("ONE FLOOR — at 300 instants of a day, every row's ferry is the floor of its own reading (POS-699)", SKIP, async () => {
  const wrong = [];
  const world = JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  for (let i = 0; i < 300; i++) {
    const o = await slowOffice({ start: Date.UTC(2026, 9, 19, 12) + i * 4321 + 7, now: null, world });
    await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), o.deps);
    const { lines, t } = o.writes[0];
    const got = stampsOf(lines[0]).ferry;
    if (got !== ferryOf(t)) wrong.push(`${new Date(t).toISOString()}: ${got} written, ${ferryOf(t)} read`);
  }
  assert.deepEqual(wrong, [], `${wrong.length} of 300 rows carry a ferry other than their reading's floor`);
});
