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

test("FLED AT 0 NERVE (an encounter): the office's own exit carries the lock and says it fled; within no dungeon, nothing is written", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 880, y: 1000 }, ledger: inTheVestibule(), acts: [ENTERED_BY_THE_DOORS], nowIso: "2026-10-19T17:12:30.000Z" });
  const a = await exitViaOffice(CLONE, { handle: "ann", confirm: true }, key("ann"), { ...o.deps, flee: true });
  assert.equal(o.records.length, 1);
  assert.equal(o.records[0].fled, "nerve");
  assert.equal(o.records[0].locked_until, "2026-10-19T18:00:00.000Z", "the exit lock keeps them out until the settlement");
  assert.match(o.records[0].summary, /^flees .*, with no nerve left/);
  assert.equal(a.fled, "nerve");
  assert.match(a.note, /^you fled the whole of .* with no nerve left/);
  // a resident's own exit never says it fled: `flee` is the office's dep, never a field a caller can pass
  const own = await officeWith({ standing: { x: 880, y: 1000 }, ledger: inTheVestibule(), acts: [ENTERED_BY_THE_DOORS], nowIso: "2026-10-19T17:12:30.000Z" });
  await exitViaOffice(CLONE, { confirm: true, flee: true }, key("ann"), own.deps);
  assert.equal(own.records[0].fled, undefined);
  for (const ledger of ["", onTheGrounds()]) {
    const out = await officeWith({ standing: { x: 1000, y: 1000 }, ledger, nowIso: "2026-10-19T17:12:30.000Z" });
    const r = await exitViaOffice(CLONE, { handle: "ann", confirm: true }, key("ann"), { ...out.deps, flee: true });
    assert.equal(r.fled, false);
    assert.equal(out.records.length, 0, "no dungeon, no lock to flee through: spent, not fled (D5)");
  }
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

// ── WLD-132 · Yew's phantom exit: a flee's re-entry refusal says why ─────────────────────────────────
//
// A resident whose nerve ran out in a creature's ring is moved out by the office's own exit (encounter.mjs §
// queueFlee), which records `fled: "nerve"` on the exit act beside the lock. The refusal used to read that exit as
// one the resident made ("You left the Spire by exit…"). The office's half is to carry the cause the act already
// recorded from the store to the clone's passage (world-apex § dungeonLocksOf, world-crossings § locksInForce);
// the words are the clone's (postmark-world tools/portals.mjs § lockedOutWords). Nothing about who is locked out,
// until when, or what an exit costs moves.
//
// The creature is NOT in the refusal: the exit act records the cause and no creature, and its ring's name lives on
// the creature's separate nerve rows. Saying it would take a new field on the exit act or a new store read.
//
// The paired World words skip, saying why, on a clone that predates them (the pinned clone until the pin moves):
// the carrying below runs on every clone, the words only where the clone has them.
// Asked of the engine the doors LOAD (the newest blessing's portals.mjs, world-branches.mjs § importEngineAt), not of the
// clone's working tree: a candidate World commit is invisible to the doors until a settlement blesses it.
const HAVE_FLED_WORDS = await (async () => {
  if (SKIP) return false;
  try {
    const { importEngineAt } = await import("../src/world-branches.mjs");
    const portals = await importEngineAt(CLONE, "portals.mjs");
    return !/by exit/.test(portals.lockedOutWords({ dungeon: SPIRE, until: "2026-10-19T18:00:00.000Z", fled: "nerve" }));
  } catch { return false; }
})();
const FLED_SKIP = SKIP || (!HAVE_FLED_WORDS && `the engine the doors load from the world clone at ${CLONE} (its newest blessing) predates WLD-132's fled words (lockedOutWords ignores \`fled\`): the refusal still reads "by exit" there until a blessed World commit carries them`);
const FLED_LOCK = { ...LOCK, fled: "nerve" };
const FLED_LINE = "Your nerve ran out at 17:12Z, so you fled the Spire and can't come back in until the next settlement (18:00Z). Nothing was recorded.";
const enterLocked = async (locks, nowIso = "2026-10-19T17:30:00.000Z", mark = "spire/doors-outside", standing = { x: 845, y: 1000 }) => {
  const o = await officeWith({ standing, ledger: onTheGrounds(), locks, nowIso });
  return { o, e: await enterViaOffice(CLONE, { mark }, key("ann"), o.deps).catch((x) => x) };
};

test("WLD-132 · A FLEE SAYS WHY: the cause the exit act recorded reaches the refusal, with the same 403, extras and instant", { skip: FLED_SKIP }, async () => {
  const { o, e } = await enterLocked([FLED_LOCK]);
  assert.equal(e.code, 403);
  assert.equal(e.defect, FLED_LINE, "the whole line is the defect: the World page prints only that");
  assert.deepEqual(bounceExtras(e), { dungeon: SPIRE, law: "the-town/dungeon (WLD-5)", locked_until: "2026-10-19T18:00:00.000Z" }, "no new field on the envelope");
  assert.equal(o.records.length, 0);
  assert.equal(o.lands.length, 0);
  assert.equal((await enterLocked([FLED_LOCK], "2026-10-19T17:30:00.000Z", SPIRE, { x: 1100, y: 1100 })).e.defect, FLED_LINE, "the dungeon from its outline says the same");
});

test("WLD-132 · AN EXIT THE RESIDENT MADE, AND EVERY LOCK WITHOUT A CAUSE, KEEP THEIR WORDS BYTE FOR BYTE", { skip: SKIP }, async () => {
  for (const [label, lock] of [["no fled column (a lock written before this change)", LOCK], ["fled null (the store's answer for an exit the resident made)", { ...LOCK, fled: null }],
    ["fled empty", { ...LOCK, fled: "" }]]) {
    const { e } = await enterLocked([lock]);
    assert.equal(e.defect, LOCKED_LINE, label);
  }
});

test("WLD-132 · AN UNKNOWN CAUSE IS NOT GUESSED: the ordinary line, never an invented reason", { skip: FLED_SKIP }, async () => {
  assert.equal((await enterLocked([{ ...LOCK, fled: "hunger" }])).e.defect, LOCKED_LINE);
});

test("WLD-132 · THE LOCK LIFTS AT THE SAME INSTANT A FLEE OR AN EXIT: a millisecond before it refuses, at it the passage goes through; another dungeon is never locked", { skip: SKIP }, async () => {
  for (const lock of [FLED_LOCK, LOCK]) {
    assert.equal((await enterLocked([lock], "2026-10-19T17:59:59.999Z")).e.code, 403);
    const at = await enterLocked([lock], "2026-10-19T18:00:00.000Z");
    assert.ok(at.e.entered?.includes(SPIRE), "at the settlement it goes through");
  }
  assert.ok((await enterLocked([{ ...FLED_LOCK, dungeon: "elsewhere/crypt" }])).e.entered?.includes(SPIRE), "a flee from another dungeon locks nothing here");
});

test("WLD-132 · THE REAL SEAM, end to end: the office's own flee writes the cause, the store's projection carries it, the refusal says it", { skip: FLED_SKIP }, async () => {
  // 1. the producer: a flee at 0 nerve, through the real exit act, writes the lock and the cause on its record
  const fleeing = await officeWith({ standing: { x: 880, y: 1000 }, ledger: inTheVestibule(), acts: [ENTERED_BY_THE_DOORS], nowIso: "2026-10-19T17:12:30.000Z" });
  await exitViaOffice(CLONE, { handle: "ann", confirm: true }, key("ann"), { ...fleeing.deps, flee: true });
  const written = fleeing.records[0];
  assert.equal(written.fled, "nerve");
  // 2. the projection: world-apex § dungeonLocksOf over a stand-in store that answers as the store's SELECT would,
  //    from the record just written (payload keys to columns). The SQL is NOT executed (there is no lab store); its text is pinned below.
  const { __setPoolForTest } = await import("../src/world2-acts.mjs");
  const { crossingDeps } = await import("../src/world-apex.mjs");
  const asked = [];
  const hadPg = [process.env.WORLD2_PG, process.env.WORLD2_PG_URL];
  process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = "postgres://stand-in.invalid/none";
  __setPoolForTest({ query: async (text, params) => { asked.push({ text, params });
    return { rows: [{ dungeon: written.dungeon, locked_until: written.locked_until, left_at: written.left_at, fled: written.fled ?? null }] }; } });
  let projected;
  try { projected = await crossingDeps().dungeonLocks("ann"); }
  finally { __setPoolForTest(null); [process.env.WORLD2_PG, process.env.WORLD2_PG_URL] = hadPg.map((v) => v); if (hadPg[0] === undefined) delete process.env.WORLD2_PG; if (hadPg[1] === undefined) delete process.env.WORLD2_PG_URL; }
  assert.deepEqual(projected, [{ dungeon: SPIRE, locked_until: "2026-10-19T18:00:00.000Z", left_at: "2026-10-19T17:12:30.000Z", fled: "nerve" }]);
  // [text pin, labelled: the weakest instrument here] the query selects the recorded cause beside the lock, from exit acts only, for this actor
  assert.match(asked[0].text, /payload->>'fled' AS fled/);
  assert.match(asked[0].text, /action = 'exit' AND payload \? 'locked_until'/);
  assert.deepEqual(asked[0].params, ["ann"]);
  // 3. the consumer: the enter door, handed what the projection returned, refuses in the flee's words
  const o = await officeWith({ standing: { x: 845, y: 1000 }, ledger: onTheGrounds(), nowIso: "2026-10-19T17:30:00.000Z" });
  const e = await enterViaOffice(CLONE, { mark: "spire/doors-outside" }, key("ann"), { ...o.deps, dungeonLocks: async () => projected }).catch((x) => x);
  assert.equal(e.defect, FLED_LINE);
});
