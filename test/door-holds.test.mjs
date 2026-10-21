// door-holds.test.mjs — WLD-5 B, the office half: a door that opens when it
// holds what it asks for (ruled 2026-10-18 21:23 and 2026-10-19 17:48).
//
// The office's two parts:
//   1. the enter door hands the clone's passage what each door that asks holds
//      now (`holdings`, from the hold record), and an unreadable record is a 503;
//   2. the give and take doors keep the holder's `accepts` (by id, what it takes
//      in) and `keeps` (nothing comes back out), read from the law like `open`.
// The passage and its words are the clone's (postmark-world tools/portals.mjs §
// unmetRequires, tested there); part 1 leans on the REAL clone and skips, saying
// why, on one that predates the door.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { callKinds } from "../src/world-kinds.mjs";
import { classViewOf } from "../src/world-units.mjs";
import { UNIT_ACTION } from "../src/world-stacks.mjs";
import { lawSnapshotFromRows } from "../src/law-classes.mjs";
import { holdingOf, idList } from "../src/holding-law.mjs";
import { enterViaOffice } from "../src/world-crossings.mjs";
import { engineDirAt } from "../src/world-branches.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

// ── 2. ACCEPTS AND KEEPS AT THE GIVE AND TAKE DOORS ─────────────────────────

const SHA = "c".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: parent ? `${klass}/${parent}/${name}` : `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const ROWS = [
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }),
  cls("thing", { extends: "sited" }), cls("consumable", { extends: "thing" }), cls("snack", { extends: "consumable" }),
  cls("pocket-comet", { extends: "snack" }), cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  prop("postmark-node", "makers", false, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
];
const LAW = lawSnapshotFromRows([...ROWS, prop("thing", "accepts", null, "sovereign", "holder"), prop("thing", "keeps", false, "sovereign", "holder")]);
const OLD_LAW = lawSnapshotFromRows(ROWS);   // a law that predates the two properties

const DOOR = "tw-ana/the-inner-door", BOX = "tw-ana/a-box";
const A = "tw-ana/token-a", B = "tw-ana/token-b", OTHER = "tw-ana/a-pebble";
const MARKS = {
  [DOOR]: { id: DOOR, by: "tw-ana", kind: "thing", holder: true, capacity: 3, portable: false, accepts: [A, B], keeps: true, at: { x: 5, y: 6 } },
  [BOX]: { id: BOX, by: "tw-ana", kind: "thing", holder: true, capacity: 5, at: { x: 5, y: 6 } },
  [A]: { id: A, by: "tw-ana", kind: "thing", at: { x: 5, y: 6 } },
  [B]: { id: B, by: "tw-ana", kind: "thing", at: { x: 5, y: 6 } },
  [OTHER]: { id: OTHER, by: "tw-ana", kind: "thing", at: { x: 5, y: 6 } },
};
const held = (entity, target) => ({ entity, target, policy: "cascade", born_at: "2026-10-21T00:00:00Z" });

function rig({ things = [], snap = LAW } = {}) {
  const acts = [];
  const deps = {
    classes: () => classViewOf(snap),
    readRows: async () => ({ units: acts.slice(), attachments: things }),
    markById: async (id) => MARKS[id] ?? null,
    reachTake: async () => ({ reach: { stands: true } }),
    reachGive: async () => ({ stands: true }),
    standpoint: async () => ({ x: 5, y: 6 }),
    householdOf: (h) => ({ key: `hh:${h}`, house: `hh:${h}` }),
    append: async (entry, { also = [] } = {}) => { const id = acts.length + 100; for (const e of [entry, ...also]) acts.push({ id: acts.length + 100, class: e.cls, action: e.action, object: e.object, actor: e.actor, at: e.at, payload: e.payload }); return { actId: id }; },
    stamp: async (actor) => ({ at: `2026-10-21T06:00:00Z@${actor}#${acts.length}`, witnesses: [] }),
    crossing: () => 270,
    household: () => "hh:test",
  };
  const seed = (moves) => acts.push({ id: acts.length + 100, class: "holding", action: UNIT_ACTION.make, object: null, payload: { units: true, moves } });
  return { deps, acts, seed };
}
const go = (r, route, args, actor = "tw-bo") => callKinds(route, args, { handles: new Set([actor]) }, actor, r.deps);

test("the law: accepts and keeps are read like open, sovereign, and absent from an older law", () => {
  const view = classViewOf(LAW);
  const read = (mark, snap = LAW) => holdingOf({ mark, className: "thing", classProperty: (n, p) => classViewOf(snap).property(n, p) });
  assert.deepEqual([read(MARKS[DOOR]).accepts, read(MARKS[DOOR]).keeps], [[A, B], true]);
  assert.deepEqual([read(MARKS[BOX]).accepts, read(MARKS[BOX]).keeps], [null, false], "the defaults: anything, and nothing kept");
  assert.deepEqual([read(MARKS[DOOR], OLD_LAW).accepts, read(MARKS[DOOR], OLD_LAW).keeps], [null, false], "a law without them reads as before");
  assert.deepEqual(idList('["a/b", "c/d"]'), ["a/b", "c/d"], "the JSON spelling a frontmatter parser may leave");
  assert.equal(idList([1]), null);
  assert.ok(view.readable);
});

test("ACCEPTS: a give of a mark it names goes in; anything else, and any count of a kind, is refused at the door", async () => {
  const ok = rig({ things: [held("tw-bo", A)] });
  const g = await go(ok, "thing-into-holder", { thing: A, to: DOOR });
  assert.deepEqual([g.did, g.edge], ["give", { giver: "tw-bo", receiver: DOOR }]);
  const no = rig({ things: [held("tw-bo", OTHER)] });
  await assert.rejects(go(no, "thing-into-holder", { thing: OTHER, to: DOOR }),
    (e) => e.code === 403 && e.defect === `${DOOR} does not take ${OTHER}` && e.accepts.join() === [A, B].join());
  const units = rig();
  units.seed([{ from: null, to: "tw-bo", kind: "pocket-comet", n: 2 }]);
  await assert.rejects(go(units, "give", { kind: "pocket-comet", count: 1, to: DOOR }), (e) => e.code === 403 && /takes in only the marks it names/.test(e.defect));
  await assert.rejects(go(rig(), "make", { kind: "pocket-comet", count: 1, to: DOOR }, "tw-ana"), (e) => e.code === 403 && /takes in only the marks it names/.test(e.defect));
  assert.equal(no.acts.length + units.acts.length - 1, 0, "nothing written by a refusal (the seed is the one act)");
});

test("KEEPS: nothing is taken back out, by anyone, its maker included, by name or by draw", async () => {
  for (const actor of ["tw-bo", "tw-ana"]) {
    const r = rig({ things: [held(DOOR, A)] });
    await assert.rejects(go(r, "thing-from-holder", { thing: A, from: DOOR }, actor), (e) => e.code === 403 && e.defect === `${DOOR} keeps what it holds`);
    await assert.rejects(go(r, "take", { from: DOOR, count: 1 }, actor), (e) => e.code === 403 && e.defect === `${DOOR} keeps what it holds`);
    assert.equal(r.acts.length, 0);
  }
  // a draw that names no holder never lands on one that keeps: the only other holder in reach is the source
  const r = rig({ things: [held(DOOR, A), held(BOX, B)] });
  const t = await go(r, "take", { count: 1 });
  assert.equal(t.from, BOX);
});

test("a holder without them is untouched: a box takes anything and gives it back", async () => {
  const r = rig({ things: [held("tw-bo", OTHER)] });
  assert.equal((await go(r, "thing-into-holder", { thing: OTHER, to: BOX })).did, "give");
  const back = rig({ things: [held(BOX, OTHER)] });
  assert.equal((await go(back, "thing-from-holder", { thing: OTHER, from: BOX })).did, "take");
});

// ── 1. THE ENTER DOOR HANDS THE PASSAGE WHAT THE DOOR HOLDS ─────────────────

// The enter door runs the engine of the clone's newest blessing (world-branches.mjs §
// engineDirAt), so that is the engine asked here: a pin whose tree carries the door
// while its newest settlement predates it skips, saying so, rather than reddening.
const CLONE = worldClone();
const ENGINE = CLONE ? engineDirAt(CLONE) : null;
const HAVE = !!ENGINE && existsSync(join(ENGINE, "tools", "portals.mjs"))
  && readFileSync(join(ENGINE, "tools", "portals.mjs"), "utf8").includes("export function requiresHolderOf");
const SKIP = !HAVE && (CLONE ? `the newest blessing in the world clone at ${CLONE} predates WLD-5 B (no requiresHolderOf)` : NO_WORLD);

const KEEP = "tw/the-keep";
const GATE = "tw/inner-door";
const ASKS = ["tw/token-a", "tw/token-b"];
const marks = () => [
  { id: KEEP, kind: "sited", by: "tw", class: "dungeon", at: { x: 1000, y: 1000 }, extent: { w: 300, h: 300 }, body: "The keep.",
    entry: { into: "tw/hall", lands_at: "tw/front-inside" } },
  { id: "tw/hall", kind: "sited", by: "tw", at: { x: 950, y: 1000 }, extent: { w: 100, h: 100 }, body: "The hall." },
  { id: "tw/inner-room", kind: "sited", by: "tw", at: { x: 1060, y: 1000 }, extent: { w: 20, h: 20 }, body: "The inner room." },
  { id: "tw/front-inside", kind: "sited", by: "tw", at: { x: 905, y: 1000 }, extent: { w: 2, h: 2 }, body: "Out.", entry: { word: "neutral", into: "tw/yard" } },
  { id: "tw/yard", kind: "sited", by: "tw", at: { x: 700, y: 1000 }, extent: { w: 100, h: 100 }, body: "The yard." },
  { id: GATE, kind: "thing", by: "tw", holder: true, capacity: 2, at: { x: 999, y: 1000 }, extent: { w: 2, h: 2 }, body: "A door.",
    entry: { word: "neutral", into: "tw/inner-room", requires: { holds: ASKS, says: "Two marks hold the door. {held} of {asks} are in place." } } },
  ...ASKS.map((id) => ({ id, kind: "thing", by: "the-town", body: "A token." })),
];
const row = (who, mark) => `- 2026-10-21T12:00:00.000Z · ${who} · enters ${mark} · ferry 255.0000 · word neutral`;
const inTheHall = (who) => [row(who, KEEP), row(who, "tw/hall")].join("\n") + "\n";

async function officeWith({ who = "ann", holdings = null, holdingsThrow = null, world = null }) {
  const thresholds = await import(pathToFileURL(join(ENGINE, "tools", "enter-exit.mjs")).href);
  let text = inTheHall(who);
  const records = [], asked = [];
  return {
    records, asked,
    deps: {
      world: async () => world ?? { marks: marks() },
      ledger: async () => text,
      standpointOf: async (h) => ({ x: 999, y: 1000, name: h }),
      acts: async () => [],
      nowMs: () => Date.parse("2026-10-21T12:00:00.000Z"),
      dungeonLocks: async () => [],
      doorHoldings: async (holders) => { asked.push(holders); if (holdingsThrow) throw holdingsThrow; return holdings ?? {}; },
      record: async (payload) => {
        records.push(payload);
        text += payload.lines.join("\n") + "\n";
        return { lines: payload.lines, within: thresholds.occupancyAt(thresholds.parseEnterExitLedger(text).acts, Infinity).get(payload.handle) ?? [], commit: "deadbeef", pushed: false };
      },
      land: async () => {},
    },
  };
}
const KEY = (...h) => ({ handles: new Set(h) });

test("SHUT: the door holding one of two refuses with its own line and the count; nothing is recorded", { skip: SKIP }, async () => {
  const o = await officeWith({ holdings: { [GATE]: ["tw/token-b"] } });
  await assert.rejects(enterViaOffice(CLONE, { mark: GATE }, KEY("ann"), o.deps), (e) => {
    assert.equal(e.code, 403);
    assert.equal(e.defect, "Two marks hold the door. 1 of 2 are in place. Nothing was recorded.");
    assert.deepEqual(e.requires, { in: GATE, holds: ASKS, held: ["tw/token-b"], missing: ["tw/token-a"] });
    assert.match(e.hint, /world \{ do: "give", args: \{ thing: "<its id>", to: "tw\/inner-door" \} \}/);
    return true;
  });
  assert.deepEqual(o.asked, [[GATE]], "the office asked the record for the one door that asks");
  assert.equal(o.records.length, 0);
});

test("OPEN: holding both, the door passes, and for the next walker too", { skip: SKIP }, async () => {
  for (const who of ["ann", "bob"]) {
    const o = await officeWith({ who, holdings: { [GATE]: [...ASKS] } });
    const a = await enterViaOffice(CLONE, { mark: GATE }, KEY(who), o.deps);
    assert.ok(a.entered?.includes("tw/inner-room") || a.within?.includes("tw/inner-room"), `${who} is through`);
    assert.equal(o.records.length, 1);
  }
});

test("AN UNREADABLE RECORD IS A 503, never an open door", { skip: SKIP }, async () => {
  const o = await officeWith({ holdingsThrow: new Error("ECONNREFUSED") });
  await assert.rejects(enterViaOffice(CLONE, { mark: GATE }, KEY("ann"), o.deps), (e) => e.code === 503 && /could not read what this door holds/.test(e.defect));
  assert.equal(o.records.length, 0);
});

test("NO DOOR ASKS: the record is never asked", { skip: SKIP }, async () => {
  const plain = marks().map((m) => (m.id === GATE ? { ...m, entry: { word: "neutral", into: "tw/inner-room" } } : m));
  const o = await officeWith({ world: { marks: plain } });
  await enterViaOffice(CLONE, { mark: GATE }, KEY("ann"), o.deps);
  assert.deepEqual(o.asked, []);
  assert.equal(o.records.length, 1);
});
