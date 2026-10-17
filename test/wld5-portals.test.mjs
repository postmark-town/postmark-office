// wld5-portals.test.mjs — the office's half of WLD-5: portals and the dungeon.
//
// The passage, the dungeon's rules and what a standpoint sees are the world
// clone's (postmark-world tools/portals.mjs, world-verbs.mjs; tested there).
// What is under test here is the office's own half: the reach at the portal,
// the pen, the landing written as the deposit's zero-length stop, the refusals
// as bounces with their fields, the `into` and `confirm` words on the doors'
// schemas, the whole-dungeon exit and the `via` it is set down by, and the walk
// fence. It leans on the REAL clone's verbs, so a drift between the two repos
// reds here, and it skips (saying why) on a clone that predates WLD-5.
//
// The world is the ruled instance in miniature (Darko 2026-10-13 21:29): the
// Grounds are OPEN, the Spire inside them is the dungeon; the Gilded Doors'
// outside face leads into the vestibule; the inside face is the exit and lands
// at the Approach, in the open Grounds. Exit inside the dungeon follows the
// 21:13 change: offered, confirmed, and it leaves the whole dungeon.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { enterViaOffice, exitViaOffice, dungeonEntryVia, CROSSING_TOOLS } from "../src/world-crossings.mjs";
import { walkFenceRefusal } from "../src/world-movement.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const CLONE = worldClone();
const HAVE = !!CLONE && existsSync(join(CLONE, "tools", "portals.mjs"));
const SKIP = !HAVE && (CLONE ? `the world clone at ${CLONE} predates WLD-5 (no tools/portals.mjs)` : NO_WORLD);
const verbsOf = async () => import(pathToFileURL(join(CLONE, "tools", "world-verbs.mjs")).href);
const grammarOf = async () => import(pathToFileURL(join(CLONE, "tools", "enter-exit.mjs")).href);

const HEIST = "spire/the-gilded-doo-YOULL-NEVER-CATCH-ME";
const SPIRE = "spire/the-spire";
function marks({ heist = false } = {}) {
  return [
    { id: "spire/grounds", kind: "sited", by: "spire", at: { x: 1000, y: 1000 }, extent: { w: 500, h: 400 }, body: "The open Grounds." },
    { id: SPIRE, kind: "sited", by: "spire", class: "dungeon", at: { x: 1000, y: 1000 }, extent: { w: 300, h: 300 }, body: "The Spire." },
    { id: "spire/vestibule", kind: "sited", by: "spire", at: { x: 880, y: 1000 }, extent: { w: 50, h: 50 }, body: "The vestibule." },
    { id: "spire/hall", kind: "sited", by: "spire", at: { x: 1030, y: 1000 }, extent: { w: 200, h: 200 }, body: "The hall." },
    { id: "spire/the-approach", kind: "sited", by: "spire", at: { x: 820, y: 1000 }, extent: { w: 30, h: 30 }, body: "The approach." },
    { id: "spire/doors-outside", kind: "sited", by: "spire", at: { x: 845, y: 1000 }, extent: { w: 4, h: 2 }, body: "The Gilded Doors.",
      entry: { word: "neutral", into: "spire/vestibule", lands_at: heist ? HEIST : "spire/doors-inside" } },
    { id: "spire/doors-inside", kind: "sited", by: "spire", at: { x: 860, y: 1000 }, extent: { w: 4, h: 2 }, body: "From inside.",
      entry: { word: "neutral", into: "spire/the-approach" } },
    { id: "spire/hall-door", kind: "sited", by: "spire", at: { x: 900, y: 1000 }, extent: { w: 2, h: 2 }, body: "To the hall.",
      entry: { word: "neutral", into: ["spire/hall", "spire/the-approach"] } },
    { id: "spire/hall-back", kind: "sited", by: "spire", at: { x: 935, y: 1000 }, extent: { w: 2, h: 2 }, body: "Back.",
      entry: { word: "neutral", into: "spire/vestibule", lands_at: "spire/hall-door" } },
  ];
}
const key = (...h) => ({ handles: new Set(h) });
const row = (act, mark, at = 299) => `- 2026-10-13T20:00:00.000Z · ann · ${act} ${mark} · ferry ${at}.0000${act === "enters" ? " · word neutral" : ""}`;
/** the enter act the journal holds for a passage into the Spire, as the exec writes it */
const ENTERED_BY_THE_DOORS = { action: "enter", object: "spire/vestibule",
  payload: { via: "spire/doors-outside", lines: [row("enters", SPIRE), row("enters", "spire/vestibule")] } };

/** A whole office in a closure: the fixture world, one resident standing where
 *  we put them, an in-memory ledger, a pen that appends, the acts the journal
 *  holds, and a `stop` that records where it was asked to set the body down. */
async function officeWith({ standing, ledger = "", heist = false, at = 300, acts = [] } = {}) {
  const thresholds = await grammarOf();
  const worldState = { marks: marks({ heist }) };
  let text = ledger;
  const written = [], records = [], stops = [];
  return {
    written, records, stops,
    deps: {
      world: async () => worldState,
      ledger: async () => text,
      standpointOf: async (who) => ({ ...standing, name: who }),
      acts: async () => acts,
      now: () => at,
      record: async (payload) => {
        records.push(payload);
        written.push(...payload.lines);
        text += payload.lines.join("\n") + "\n";
        const folded = thresholds.parseEnterExitLedger(text).acts;
        return { lines: payload.lines, within: thresholds.occupancyAt(folded, at).get(payload.handle) ?? [], commit: "deadbeef", pushed: false };
      },
      stop: async (who, to, k, opts) => { stops.push({ who, to, from: opts?.from ?? null }); },
    },
  };
}
const inTheVestibule = [row("enters", SPIRE), row("enters", "spire/vestibule")].join("\n") + "\n";

test("THROUGH THE GILDED DOORS: one passage, written once, and the body set down at the landing by the deposit's write", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 845, y: 1000 } });
  const a = await enterViaOffice(CLONE, { mark: "spire/doors-outside" }, key("ann"), o.deps);
  assert.deepEqual(a.entered, [SPIRE, "spire/vestibule"], "the dungeon and the room, never the open Grounds above it");
  assert.deepEqual(a.within, [SPIRE, "spire/vestibule"]);
  assert.equal(o.records.length, 1);
  assert.equal(o.records[0].mark, "spire/vestibule", "the journal row's object is where the passage leads");
  assert.equal(o.records[0].via, "spire/doors-outside", "and `via` names the portal, as the Post Office's stops do");
  assert.deepEqual(o.stops, [{ who: "ann", to: { x: 860, y: 1000 }, from: { x: 860, y: 1000 } }], "a zero-length departure AT the landing");
  assert.deepEqual(a.landed, { x: 860, y: 1000, mark: "spire/doors-inside", clamped: false, recorded: true });
  assert.deepEqual(a.portals.map((p) => p.id), ["spire/doors-inside", "spire/hall-door"]);
});

test("a portal is entered from within its extent: from outside it, refused with the walk, nothing written", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 780, y: 1000 } });
  await assert.rejects(() => enterViaOffice(CLONE, { mark: "spire/doors-outside" }, key("ann"), o.deps),
    (e) => e.code === 409 && /not at that portal/.test(e.defect) && e.walk?.mark === "spire/doors-outside");
  assert.equal(o.written.length, 0);
  assert.equal(o.stops.length, 0);
});

test("THE DOOR BUG: a landing that names no mark is refused by quoting the field, standing at the portal, nothing written", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 845, y: 1000 }, heist: true });
  await assert.rejects(() => enterViaOffice(CLONE, { mark: "spire/doors-outside" }, key("ann"), o.deps),
    (e) => e.code === 409 && e.defect.includes(`lands_at: "${HEIST}" names no mark`) && e.stranded_at === "spire/doors-outside" && e.broken?.field === "lands_at");
  assert.equal(o.written.length, 0);
  assert.equal(o.stops.length, 0, "nobody is moved");
});

test("a portal that leads more than one way answers with its ways, and `into` picks one (the door's schema admits it)", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 900, y: 1000 }, ledger: inTheVestibule });
  const asked = await enterViaOffice(CLONE, { mark: "spire/hall-door" }, key("ann"), o.deps);
  assert.deepEqual(asked.choose.map((c) => c.id), ["spire/hall", "spire/the-approach"]);
  assert.equal(o.written.length, 0);
  const went = await enterViaOffice(CLONE, { mark: "spire/hall-door", into: "spire/hall" }, key("ann"), o.deps);
  assert.deepEqual(went.exited, ["spire/vestibule"]);
  assert.deepEqual(went.entered, ["spire/hall"]);
  assert.ok(CROSSING_TOOLS.find((t) => t.name === "world_enter").inputSchema.properties.into, "world_enter takes into");
});

// THE EXIT, AS DARKO CHANGED IT AT 21:13. Until then this block asserted a 403
// ("a dungeon offers no exit"); it is flipped, not deleted, into the confirm
// step and the whole-dungeon exit, so the old promise is visibly what changed.
test("EXIT INSIDE A DUNGEON ASKS FIRST: nothing written, and the answer names the whole dungeon and where you will stand", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 880, y: 1000 }, ledger: inTheVestibule, acts: [ENTERED_BY_THE_DOORS] });
  const a = await exitViaOffice(CLONE, {}, key("ann"), o.deps);
  assert.equal(a.awaiting.effect, "confirm");
  assert.equal(a.dungeon, SPIRE);
  assert.deepEqual(a.leaving, [SPIRE, "spire/vestibule"]);
  assert.deepEqual(a.set_down_at, { x: 845, y: 1000, via: "spire/doors-outside", chosen: false });
  assert.match(a.note, /leaves the whole of spire\/the-spire, a dungeon, and sets you down outside, at spire\/doors-outside \(845, 1000\)/);
  assert.equal(o.written.length, 0);
  assert.equal(o.stops.length, 0);
});

test("CONFIRMED: one row leaves the WHOLE dungeon, and the body is set down at the portal you entered by", { skip: SKIP }, async () => {
  const hall = [row("enters", SPIRE), row("enters", "spire/hall")].join("\n") + "\n";
  const acts = [ENTERED_BY_THE_DOORS,
    { action: "enter", object: "spire/hall", payload: { via: "spire/hall-door", lines: [row("exits", "spire/vestibule"), row("enters", "spire/hall")] } }];
  const o = await officeWith({ standing: { x: 1030, y: 1000 }, ledger: hall, acts });
  const a = await exitViaOffice(CLONE, { mark: "spire/hall", confirm: true }, key("ann"), o.deps);
  assert.equal(o.records.length, 1);
  assert.equal(o.records[0].mark, SPIRE, "the dungeon is the mark exited, whichever room was named");
  assert.equal(o.records[0].set_down_at, "spire/doors-outside");
  assert.match(o.written[0], / · ann · exits spire\/the-spire · ferry 300\.0000$/);
  assert.deepEqual(a.within, []);
  assert.deepEqual(o.stops, [{ who: "ann", to: { x: 845, y: 1000 }, from: { x: 845, y: 1000 } }], "the deposit's own write, at the portal entered by");
  assert.deepEqual(a.set_down, { at: "spire/doors-outside", x: 845, y: 1000, chosen: false, recorded: true });
});

test("the portal you entered by is read from the journal: the act that ENTERED the dungeon, not the last room-to-room passage, and none once you left", () => {
  const roomToRoom = { action: "enter", object: "spire/hall", payload: { via: "spire/hall-door", lines: [row("exits", "spire/vestibule"), row("enters", "spire/hall")] } };
  assert.equal(dungeonEntryVia([ENTERED_BY_THE_DOORS, roomToRoom], SPIRE), "spire/doors-outside");
  const left = { action: "exit", object: SPIRE, payload: { lines: [row("exits", SPIRE)] } };
  assert.equal(dungeonEntryVia([ENTERED_BY_THE_DOORS, left], SPIRE), null);
  assert.equal(dungeonEntryVia([], SPIRE), null);
});

test("the exit card is not withheld any more, and world_exit takes confirm", async () => {
  const exit = CROSSING_TOOLS.find((t) => t.name === "world_exit");
  assert.ok(exit.inputSchema.properties.confirm, "world_exit takes confirm");
  const apex = readFileSync(new URL("../src/world-apex.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(apex, /e\.action !== "exit"/, "no card is subtracted inside a dungeon");
});

test("a dungeon is entered by its portals, and a hidden room is no mark at all", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 1000, y: 1000 } });
  await assert.rejects(() => enterViaOffice(CLONE, { mark: SPIRE }, key("ann"), o.deps),
    (e) => e.code === 403 && e.dungeon === SPIRE && e.portals.join(",") === "spire/doors-outside");
  await assert.rejects(() => enterViaOffice(CLONE, { mark: "spire/hall" }, key("ann"), o.deps),
    (e) => e.code === 422 && e.defect === "no mark 'spire/hall' to enter");
});

test("G4 · inside a dungeon the walk is fenced to the room entered, and the refusal names its portals", { skip: SKIP }, async () => {
  const verbs = await verbsOf();
  const all = marks();
  const inHall = [SPIRE, "spire/hall"];
  assert.equal(walkFenceRefusal({ stack: inHall, toward: { x: 950, y: 1050 }, marks: all, verbs }), null, "anywhere inside the hall");
  const r = walkFenceRefusal({ stack: inHall, toward: { x: 880, y: 1000 }, marks: all, verbs });
  assert.match(r.defect, /fenced to the room you entered, spire\/hall/);
  assert.deepEqual(r.fields.portals, ["spire/hall-back"]);
  assert.equal(walkFenceRefusal({ stack: ["spire/grounds"], toward: { x: 0, y: 0 }, marks: all, verbs }), null, "the open Grounds fence nobody");
  assert.equal(walkFenceRefusal({ stack: inHall, toward: { x: 0, y: 0 }, marks: all, verbs: {} }), null, "a clone without the fence fences nothing");
});

test("G11 · the resident reads see what the world tools' one function says: the dungeon alone from outside, the room from inside, a household's own always", { skip: SKIP }, async () => {
  const { sightedWorld } = await import("../src/world.mjs");
  const verbs = await verbsOf();
  const w = { marks: marks() };
  const ids = (x) => x.marks.map((m) => m.id);
  const outside = sightedWorld(w, { verbs, handle: "ann", stack: [], key: key("ann") });
  assert.ok(ids(outside).includes(SPIRE) && ids(outside).includes("spire/grounds"));
  assert.ok(!ids(outside).includes("spire/hall") && !ids(outside).includes("spire/doors-inside"), "nothing inside, at any depth");
  const inHall = sightedWorld(w, { verbs, handle: "ann", stack: [SPIRE, "spire/hall"], key: key("ann") });
  assert.ok(ids(inHall).includes("spire/hall-back"));
  assert.ok(!ids(inHall).includes("spire/vestibule"), "not the hall's neighbours");
  const builder = sightedWorld(w, { verbs, handle: "spire", stack: [], key: key("spire") });
  assert.ok(ids(builder).includes("spire/hall"), "the household that made it reads its own marks");
  const plain = { marks: marks().filter((m) => m.class !== "dungeon") };
  assert.equal(sightedWorld(plain, { verbs, handle: "ann", stack: [] }), plain, "no dungeon: the same world back");
});

test("[pin] the four resident reads ask sightFor before they read a mark (the wiring sightedWorld's test cannot see)", async () => {
  const src = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
  for (const fn of ["worldOrient", "worldEyes", "worldInvestigate", "worldFind"]) {
    const start = src.indexOf(`export async function ${fn}(`);
    assert.ok(start >= 0, `${fn} exists`);
    assert.match(src.slice(start, start + 900), /const w = await sightFor\(await world\(\),/, `${fn} reads the world through sightFor`);
  }
});
