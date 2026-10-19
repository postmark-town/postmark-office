// exit-lock.test.mjs — WLD-5 A, the office's half: leaving a dungeon by `exit`
// locks that walker out of it until the next settlement (Darko, Sitting B
// 2026-10-18 20:22 and 20:27; the words and readings ruled 2026-10-19 09:21).
//
// The lock's law and its words are the world clone's (postmark-world
// tools/portals.mjs § lockedPassage, tested there). Under test here is the
// office's own half: the exit act carries the lock (dungeon, the settlement
// after its own instant, when it left), the enter door reads the locks in force
// back from the walker's own acts and hands them to the clone, a refusal is a
// 403 bounce whose extras carry the instant, an unreadable record refuses (503)
// and never fails open, and the walk's pre-check is asked as of the arrival.
// It leans on the REAL clone's verbs, so a drift between the two repos reds
// here; it skips (saying why) on a clone that predates the lock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { enterViaOffice, exitViaOffice, CROSSING_TOOLS } from "../src/world-crossings.mjs";
import { entryAtTheWalk } from "../src/arrival-entries.mjs";
import { bounceExtras } from "../src/fault-words.mjs";
import { fractionalCrossing } from "../world2/tools/live-reads.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const CLONE = worldClone();
const HAVE = !!CLONE && existsSync(join(CLONE, "tools", "portals.mjs"))
  && readFileSync(join(CLONE, "tools", "portals.mjs"), "utf8").includes("export function lockedPassage");
const SKIP = !HAVE && (CLONE ? `the world clone at ${CLONE} predates WLD-5's exit lock (no lockedPassage)` : NO_WORLD);
const grammarOf = async () => import(pathToFileURL(join(CLONE, "tools", "enter-exit.mjs")).href);

const SPIRE = "spire/the-spire";
const marks = () => [
  { id: "spire/grounds", kind: "sited", by: "spire", at: { x: 1000, y: 1000 }, extent: { w: 500, h: 400 }, body: "The open Grounds." },
  { id: SPIRE, kind: "sited", by: "spire", class: "dungeon", at: { x: 1000, y: 1000 }, extent: { w: 300, h: 300 }, body: "The Spire.",
    entry: { into: "spire/vestibule", lands_at: "spire/doors-inside" } },
  { id: "spire/vestibule", kind: "sited", by: "spire", at: { x: 880, y: 1000 }, extent: { w: 50, h: 50 }, body: "The vestibule." },
  { id: "spire/the-approach", kind: "sited", by: "spire", at: { x: 820, y: 1000 }, extent: { w: 30, h: 30 }, body: "The approach." },
  { id: "spire/doors-outside", kind: "sited", by: "spire", at: { x: 845, y: 1000 }, extent: { w: 4, h: 2 }, body: "The Gilded Doors.",
    entry: { word: "neutral", into: "spire/vestibule", lands_at: "spire/doors-inside" } },
  { id: "spire/doors-inside", kind: "sited", by: "spire", at: { x: 860, y: 1000 }, extent: { w: 4, h: 2 }, body: "From inside.",
    entry: { word: "neutral", into: "spire/the-approach" } },
];
const key = (...h) => ({ handles: new Set(h) });
const ms = (iso) => Date.parse(iso);
const row = (who, act, mark) => `- 2026-10-19T12:00:00.000Z · ${who} · ${act} ${mark} · ferry 250.0000${act === "enters" ? " · word neutral" : ""}`;
const inTheVestibule = (who = "ann") => [row(who, "enters", "spire/grounds"), row(who, "enters", SPIRE), row(who, "enters", "spire/vestibule")].join("\n") + "\n";
const onTheGrounds = (who = "ann") => row(who, "enters", "spire/grounds") + "\n";
const ENTERED_BY_THE_DOORS = { action: "enter", object: "spire/vestibule",
  payload: { via: "spire/doors-outside", lines: [row("ann", "enters", SPIRE), row("ann", "enters", "spire/vestibule")] } };

/** A whole office in a closure, on the real clock at `nowIso`: the fixture world,
 *  one resident standing where we put them, an in-memory ledger, a pen that
 *  appends and remembers what it was handed, and the exit locks the store holds. */
async function officeWith({ standing, ledger = "", nowIso, locks = [], locksThrow = null, acts = [] }) {
  const thresholds = await grammarOf();
  const worldState = { marks: marks(), determined: { [`${SPIRE}::name`]: "the Spire", "spire/doors-outside::name": "the Gilded Doors" } };
  let text = ledger;
  const records = [], lands = [];
  return {
    records, lands,
    deps: {
      world: async () => worldState,
      ledger: async () => text,
      standpointOf: async (who) => ({ ...standing, name: who }),
      acts: async () => acts,
      nowMs: () => ms(nowIso),
      dungeonLocks: async (who) => { if (locksThrow) throw locksThrow; return locks.filter((l) => l.who === who); },
      record: async (payload) => {
        records.push(payload);
        text += payload.lines.join("\n") + "\n";
        const folded = thresholds.parseEnterExitLedger(text).acts;
        return { lines: payload.lines, within: thresholds.occupancyAt(folded, Infinity).get(payload.handle) ?? [], commit: "deadbeef", pushed: false };
      },
      land: async (who, to, k, opts = {}) => { lands.push({ who, to, via: opts.via ?? null, why: opts.why ?? null }); },
    },
  };
}
const LOCK = { who: "ann", dungeon: SPIRE, locked_until: "2026-10-19T18:00:00.000Z", left_at: "2026-10-19T17:12:30.000Z" };
const LOCKED_LINE = "You left the Spire by exit at 17:12Z, so you can't come back in until the next settlement (18:00Z). Nothing was recorded.";

test("THE ASK says Darko's sentence with the settlement after this instant; the agent's instruction is `how`", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 880, y: 1000 }, ledger: inTheVestibule(), acts: [ENTERED_BY_THE_DOORS], nowIso: "2026-10-19T17:12:30.000Z" });
  const a = await exitViaOffice(CLONE, {}, key("ann"), o.deps);
  assert.equal(a.awaiting.effect, "confirm");
  assert.equal(a.note, "Leave the Spire from here? You can't come back in until the next settlement (18:00Z)."
    + " Walking out through a door doesn't count. You'll be set down outside, at the Gilded Doors.");
  assert.match(a.how, /Call again with confirm: true to go; nothing was recorded\.$/);
  assert.equal(a.locked_until, "2026-10-19T18:00:00.000Z");
  assert.equal(o.records.length, 0, "the ask writes nothing");
});

test("CONFIRMED, THE EXIT ACT CARRIES THE LOCK: the dungeon, the settlement after its own instant, and when it left; the time is said again", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 880, y: 1000 }, ledger: inTheVestibule(), acts: [ENTERED_BY_THE_DOORS], nowIso: "2026-10-19T17:12:30.000Z" });
  const a = await exitViaOffice(CLONE, { confirm: true }, key("ann"), o.deps);
  assert.equal(o.records.length, 1);
  assert.equal(o.records[0].act, "exit");
  assert.equal(o.records[0].dungeon, SPIRE);
  assert.equal(o.records[0].locked_until, "2026-10-19T18:00:00.000Z");
  assert.equal(o.records[0].left_at, "2026-10-19T17:12:30.000Z");
  assert.equal(a.locked_until, "2026-10-19T18:00:00.000Z");
  assert.match(a.note, /You can't come back into the Spire until the next settlement \(18:00Z\)\.$/);
});

test("THE WINDOW IS THE WINDOW: an exit at 17:59:59Z locks until 18:00Z, and one at 18:00:01Z until 06:00Z", { skip: SKIP }, async () => {
  for (const [nowIso, until] of [["2026-10-19T17:59:59.000Z", "2026-10-19T18:00:00.000Z"], ["2026-10-19T18:00:01.000Z", "2026-10-20T06:00:00.000Z"]]) {
    const o = await officeWith({ standing: { x: 880, y: 1000 }, ledger: inTheVestibule(), acts: [ENTERED_BY_THE_DOORS], nowIso });
    await exitViaOffice(CLONE, { confirm: true }, key("ann"), o.deps);
    assert.equal(o.records[0].locked_until, until, `an exit at ${nowIso}`);
  }
});

test("WALKING OUT A DOOR COSTS NOTHING: the inside face's passage writes no lock", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 860, y: 1000 }, ledger: inTheVestibule(), nowIso: "2026-10-19T17:12:30.000Z" });
  const a = await enterViaOffice(CLONE, { mark: "spire/doors-inside" }, key("ann"), o.deps);
  assert.ok(a.exited.includes(SPIRE), "out of the dungeon");
  assert.equal(o.records.length, 1);
  assert.equal(o.records[0].act, "enter");
  assert.equal(o.records[0].dungeon, undefined);
  assert.equal(o.records[0].locked_until, undefined);
});

test("LOCKED OUT: the portal refuses with a 403 naming when, its extras carry the instant, and nothing is written", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 845, y: 1000 }, ledger: onTheGrounds(), locks: [LOCK], nowIso: "2026-10-19T17:30:00.000Z" });
  const e = await enterViaOffice(CLONE, { mark: "spire/doors-outside" }, key("ann"), o.deps).catch((x) => x);
  assert.equal(e.code, 403);
  assert.equal(e.defect, LOCKED_LINE, "the whole line is the defect: the World page prints only that");
  assert.deepEqual(bounceExtras(e), { dungeon: SPIRE, law: "the-town/dungeon (WLD-5)", locked_until: "2026-10-19T18:00:00.000Z" });
  assert.equal(o.records.length, 0);
  assert.equal(o.lands.length, 0);
});

test("LOCKED OUT: the dungeon itself from its outline, and from 150 m away the lock is said, not the walk", { skip: SKIP }, async () => {
  for (const standing of [{ x: 1100, y: 1100 }, { x: 700, y: 1150 }]) {
    const o = await officeWith({ standing, ledger: onTheGrounds(), locks: [LOCK], nowIso: "2026-10-19T17:30:00.000Z" });
    const e = await enterViaOffice(CLONE, { mark: standing.x > 1000 ? SPIRE : "spire/doors-outside" }, key("ann"), o.deps).catch((x) => x);
    assert.equal(e.code, 403, `standing at (${standing.x}, ${standing.y})`);
    assert.equal(e.walk, undefined, "no walk is offered to a door that will not open");
  }
});

test("THE LOCK LIFTS AT THE SETTLEMENT: a millisecond before it refuses, at it the passage goes through", { skip: SKIP }, async () => {
  const before = await officeWith({ standing: { x: 845, y: 1000 }, ledger: onTheGrounds(), locks: [LOCK], nowIso: "2026-10-19T17:59:59.999Z" });
  assert.equal((await enterViaOffice(CLONE, { mark: "spire/doors-outside" }, key("ann"), before.deps).catch((x) => x)).code, 403);
  const at = await officeWith({ standing: { x: 845, y: 1000 }, ledger: onTheGrounds(), locks: [LOCK], nowIso: "2026-10-19T18:00:00.000Z" });
  const a = await enterViaOffice(CLONE, { mark: "spire/doors-outside" }, key("ann"), at.deps);
  assert.ok(a.entered.includes(SPIRE));
});

test("THE LOCK IS EACH RESIDENT'S OWN: another resident of the same household walks in", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 845, y: 1000 }, ledger: onTheGrounds("bob"), locks: [LOCK], nowIso: "2026-10-19T17:30:00.000Z" });
  const a = await enterViaOffice(CLONE, { mark: "spire/doors-outside", handle: "bob" }, key("ann", "bob"), o.deps);
  assert.ok(a.entered.includes(SPIRE));
});

test("AN UNREADABLE RECORD REFUSES (503) rather than letting a locked-out walker in", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 845, y: 1000 }, ledger: onTheGrounds(), locksThrow: new Error("ECONNREFUSED"), nowIso: "2026-10-19T17:30:00.000Z" });
  const e = await enterViaOffice(CLONE, { mark: "spire/doors-outside" }, key("ann"), o.deps).catch((x) => x);
  assert.equal(e.code, 503);
  assert.match(e.defect, /could not check whether you may enter this dungeon again, so nothing was recorded/);
  assert.equal(o.records.length, 0);
});

test("THE WALK'S PRE-CHECK is asked as of the arrival: before the settlement nothing is queued and the line is relayed; after it, queued", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 700, y: 1150 }, ledger: onTheGrounds(), locks: [LOCK], nowIso: "2026-10-19T17:30:00.000Z" });
  const walk = (arrivalIso) => entryAtTheWalk({ who: "ann", key: key("ann"), mark: "spire/doors-outside", arrived: false,
    target: { x: 845, y: 1000 }, arrivalCrossing: fractionalCrossing(ms(arrivalIso)), dueAt: arrivalIso, walkActId: "w1", household: "ann" },
    { enter: (p, k, d) => enterViaOffice(CLONE, p, k, d), crossingDeps: () => o.deps, queue: async () => ({ queued: true }) });
  const early = await walk("2026-10-19T17:45:00.000Z");
  assert.equal(early.queued, false);
  assert.equal(early.entry.refused, LOCKED_LINE);
  const late = await walk("2026-10-19T18:05:00.000Z");
  assert.equal(late.queued, true, "it will arrive after the lock lifts");
});

test("the doors' own words say it: world_exit and world_enter name the lock", () => {
  const exit = CROSSING_TOOLS.find((t) => t.name === "world_exit").description;
  const enter = CROSSING_TOOLS.find((t) => t.name === "world_enter").description;
  assert.match(exit, /Leaving a dungeon by exit closes it to you until the next settlement \(06:00 or 18:00Z\); walking out through a door costs nothing\./);
  assert.match(enter, /A dungeon you left by exit stays closed to you until the next settlement/);
});
