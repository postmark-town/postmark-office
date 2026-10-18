// holder-nesting.test.mjs — plumb-nest-guard: one holder in hand, counts confer
// up, and the loop check walks the whole way (Darko, 2026-10-17 23:29: "yes,
// rule it, one holder and counts confer up"; LOGOS/classes.md § The transfer edge).
//
//   1. a second holder into a resident's hands is refused, by a take and by a
//      pot-luck draw (and a make of a holder kind stays refused);
//   2. a holder counts 1 plus everything it holds toward the room of what holds
//      it: a bag of 30 into a chest of 120 takes 31;
//   3. a give into a pouch in a bag in a chest checks all three rooms;
//   4. a holder far below the thing it would go into is still refused;
//   5. a loop already in the rows ends every walk and the give is refused.
//
// Each test is a falsifier: it fails on train/2026-w43 @ dd226dbd and passes
// with src/holder-tree.mjs and its callers, except where a line says it was
// already so. The kind door (`callKinds`, src/world-kinds.mjs) with every
// collaborator injected over an in-memory record, as kind-door.test.mjs drives
// it. The tree's helpers are read through a namespace import, so on the old code
// they are absent and the test fails rather than the file failing to load.

import { test } from "node:test";
import assert from "node:assert/strict";
import { callKinds } from "../src/world-kinds.mjs";
import { classViewOf } from "../src/world-units.mjs";
import { UNIT_ACTION, foldUnits } from "../src/world-stacks.mjs";
import { lawSnapshotFromRows } from "../src/law-classes.mjs";
import { usablePairs } from "../src/usable-verbs.mjs";
import * as tree from "../src/holder-tree.mjs";
import * as kinds from "../src/kind-holding.mjs";

const SHA = "c".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: parent ? `${klass}/${parent}/${name}` : `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const LAW = [
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }),
  cls("thing", { extends: "sited" }), cls("consumable", { extends: "thing" }), cls("candy", { extends: "consumable" }),
  cls("pocket-comet", { extends: "candy" }), cls("halloween-candy-bag", { extends: "thing" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  prop("postmark-node", "makers", false, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("resident", "holders", 1, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
  prop("halloween-candy-bag", "holder", true, "constitution"), prop("halloween-candy-bag", "capacity", 200, "sovereign", "holder"),
  prop("halloween-candy-bag", "max", 200, "constitution", "capacity"),
];
const SNAP = lawSnapshotFromRows(LAW);
const UNREAD = lawSnapshotFromRows(LAW.filter((r) => r.key !== "resident/holder/holders")); // the dial absent

const ME = "sbx-cy", LAMP = "sbx-cy/a-lamp";
const bag = (name) => `sbx-cy/${name}`;
const CAPS = {}; // a bag's own capacity, by id (sovereign on the bag class, within its max 200)
const markOf = (id) => (id === LAMP ? { id, by: ME, kind: "thing", at: { x: 5, y: 6 } }
  : { id, by: ME, kind: "halloween-candy-bag", at: { x: 5, y: 6 }, ...(CAPS[id] ? { capacity: CAPS[id] } : {}) });
const row = (entity, target) => ({ entity, target, policy: "cascade", born_at: "2026-10-17T00:00:00Z" });
/** `prefix-0` in `top`'s hands (or standing in it), `prefix-1` inside it, and so on down to `prefix-<n>`. */
const chain = (prefix, n, top = ME) => Array.from({ length: n + 1 }, (_, k) => row(k ? bag(`${prefix}-${k - 1}`) : top, bag(`${prefix}-${k}`)));

function world(things, snap = SNAP) {
  const acts = [];
  const deps = {
    classes: () => classViewOf(snap),
    readRows: async () => ({ units: acts.filter((a) => String(a.action).startsWith("units:")), attachments: things }),
    markById: async (id) => (String(id).startsWith("sbx-cy/") ? markOf(String(id)) : null),
    reachTake: async () => ({ reach: { stands: true } }),
    reachGive: async () => ({ stands: true }),
    standpoint: async () => ({ x: 5, y: 6 }),
    householdOf: (h) => ({ key: `hh:${h}`, house: `hh:${h}` }),
    append: async (entry, { also = [] } = {}) => { for (const e of [entry, ...also]) acts.push({ id: acts.length + 100, class: e.cls, action: e.action, payload: e.payload }); return { actId: acts.length + 99 }; },
    stamp: async (actor) => ({ at: `2026-10-17T06:00:00Z@${actor}#${acts.length}`, witnesses: [] }),
    crossing: () => 260,
    household: () => "hh:test",
  };
  // n pocket-comets already made into `to` (the record as it stands, not this test's write)
  const seed = (to, n) => acts.push({ id: acts.length + 100, class: "holding", action: UNIT_ACTION.make, payload: { units: true, moves: [{ from: null, to, kind: "pocket-comet", n }] } });
  let seeded = 0;
  return { deps, acts, seed: (to, n) => { seed(to, n); seeded += 1; }, written: () => acts.length - seeded };
}
const KEY = { handles: new Set([ME]) };
const go = (w, route, args) => callKinds(route, args, KEY, ME, w.deps);

// ── 1 · ONE HOLDER IN A RESIDENT'S HANDS ────────────────────────────────────

test("1 · a second holder into your hands is refused, by a take and by a pot-luck draw; with none in hand it lands", { timeout: 10_000 }, async () => {
  const full = "you're already carrying a holder (sbx-cy/mine)";
  const hint = "set it down first. Nothing was changed.";
  // I carry a bag; a crate on the ground holds another bag
  const rows = [row(ME, bag("mine")), row(bag("crate"), bag("other"))];
  const w = world(rows);
  await assert.rejects(go(w, "thing-from-holder", { thing: bag("other"), from: bag("crate") }), (e) => e.code === 409 && e.defect === full && e.hint === hint);
  await assert.rejects(go(w, "take", { from: bag("crate"), count: 1 }), (e) => e.code === 409 && e.defect === full && e.hint === hint, "a pot-luck draw that would bring a holder");
  assert.equal(w.written(), 0, "nothing was written");
  // with no holder in hand, the take stands
  const free = world([row(bag("crate"), bag("other"))]);
  assert.equal((await go(free, "thing-from-holder", { thing: bag("other"), from: bag("crate") })).did, "take");
  // a lamp is not a holder: carrying a bag, you still take one
  const lamp = world([row(ME, bag("mine")), row(bag("crate"), LAMP)]);
  assert.equal((await go(lamp, "thing-from-holder", { thing: LAMP, from: bag("crate") })).did, "take");
});

test("1b · a make of a holder kind stays refused (already so on the base: a count cannot carry a holder's contents)", async () => {
  await assert.rejects(go(world([]), "make", { kind: "halloween-candy-bag", count: 1, to: ME }), (e) => /holds things of its own/.test(e.defect));
});

test("1c · the give face names the receiver, and an unread holders dial refuses any holder rather than letting it in", { timeout: 10_000 }, async () => {
  const markById = async (id) => markOf(String(id));
  await assert.rejects(kinds.refuseSecondHolder({ who: "sbx-dee", actor: ME, adding: [bag("mine")], held: [bag("theirs")], markById, view: classViewOf(SNAP) }),
    (e) => e.code === 409 && e.defect === "sbx-dee is already carrying a holder (sbx-cy/theirs)" && /Nothing was changed\.$/.test(e.hint));
  await assert.rejects(kinds.refuseSecondHolder({ who: ME, actor: ME, adding: [bag("mine")], held: [], markById, view: classViewOf(UNREAD) }),
    (e) => e.code === 503 && /holders/.test(e.defect));
  // a lamp asks no dial at all, read or not
  await kinds.refuseSecondHolder({ who: ME, actor: ME, adding: [LAMP], held: [bag("theirs")], markById, view: classViewOf(UNREAD) });
});

// ── 2 · COUNTS CONFER UP ────────────────────────────────────────────────────

test("2 · a bag of 30 takes 31 in a chest of 120: refused with 30 room left, given with 31", { timeout: 10_000 }, async () => {
  CAPS[bag("chest")] = 120;
  const at = (used) => { const w = world([row(ME, bag("bag30"))]); w.seed(bag("bag30"), 30); w.seed(bag("chest"), used); return w; };
  const tight = at(90);
  await assert.rejects(go(tight, "thing-into-holder", { thing: bag("bag30"), to: bag("chest") }),
    (e) => e.code === 409 && /has room for 30, not 31/.test(e.defect) && e.room === 30);
  assert.equal(tight.written(), 0);
  const fits = at(89);
  const g = await go(fits, "thing-into-holder", { thing: bag("bag30"), to: bag("chest") });
  assert.deepEqual([g.did, g.to], ["give", bag("chest")]);
  // the tree's own count: the chest then holds 89 + 31 = 120
  const up = tree.liveHolders([row(bag("chest"), bag("bag30"))]);
  assert.equal(tree.weightOf({ up, thing: bag("bag30"), unitsOf: (h) => (h === bag("bag30") ? 30 : 0) }), 31);
});

test("3 · a give into a pouch in a bag in a chest checks all three rooms", { timeout: 10_000 }, async () => {
  // chest (20) holds bag (12) holds pouch (10); I hold a lamp
  Object.assign(CAPS, { [bag("k-chest")]: 20, [bag("k-bag")]: 12, [bag("k-pouch")]: 10 });
  const rows = [row(bag("k-chest"), bag("k-bag")), row(bag("k-bag"), bag("k-pouch")), row(ME, LAMP)];
  const at = ({ pouch = 0, bagU = 0, chest = 0 }) => { const w = world(rows); w.seed(bag("k-pouch"), pouch); w.seed(bag("k-bag"), bagU); w.seed(bag("k-chest"), chest); return w; };
  const give = (w) => go(w, "thing-into-holder", { thing: LAMP, to: bag("k-pouch") });
  // the pouch is full (already so on the base: its own room)
  await assert.rejects(give(at({ pouch: 10 })), (e) => /sbx-cy\/k-pouch has room for 0, not 1/.test(e.defect));
  // the bag is full: its 5 units, the pouch 1, the pouch's 6 units = 12 of 12
  const bagFull = at({ pouch: 6, bagU: 5 });
  await assert.rejects(give(bagFull), (e) => e.code === 409 && e.defect === "sbx-cy/k-bag has room for 0, not 1" && e.at === bag("k-bag") && /sbx-cy\/k-pouch is inside it/.test(e.hint));
  assert.equal(bagFull.written(), 0);
  // the chest is full: its 12 units, the bag 1 + 3, the pouch 1 + 3 = 20 of 20
  const chestFull = at({ pouch: 3, bagU: 3, chest: 12 });
  await assert.rejects(give(chestFull), (e) => e.code === 409 && e.defect === "sbx-cy/k-chest has room for 0, not 1" && e.at === bag("k-chest"));
  assert.equal(chestFull.written(), 0);
  // a place left in all three: it lands
  assert.equal((await give(at({ pouch: 3, bagU: 3, chest: 11 }))).did, "give");
});

// ── 4 · THE LOOP CHECK WALKS THE WHOLE WAY ──────────────────────────────────

test("4 · a holder 70 levels inside the thing is refused: the loop check walks the whole way up", { timeout: 10_000 }, async () => {
  const w = world(chain("b", 70));
  await assert.rejects(go(w, "thing-into-holder", { thing: bag("b-0"), to: bag("b-70") }),
    (e) => e.code === 422 && e.defect === `${bag("b-70")} is inside ${bag("b-0")}` && /Nothing was changed\.$/.test(e.hint));
  assert.equal(w.written(), 0, "nothing was written");
  // the walk reaches the top: b-69 down to b-0, then my hands
  const { chain: up, loop } = tree.holderChain(tree.liveHolders(chain("b", 70)), bag("b-70"));
  assert.deepEqual([up.length, up.at(-2), up.at(-1), loop], [71, bag("b-0"), ME, false]);
});

// ── 5 · A LOOP ALREADY IN THE ROWS ──────────────────────────────────────────

test("5 · a loop already in the rows ends every walk: the give is refused, and the reads that count rooms return", { timeout: 10_000 }, async () => {
  // p holds q and q holds p: a record no door should have written, read as it stands
  const loopRows = [row(bag("p"), bag("q")), row(bag("q"), bag("p")), row(ME, LAMP)];
  const w = world(loopRows);
  await assert.rejects(go(w, "thing-into-holder", { thing: LAMP, to: bag("q") }),
    (e) => e.code === 422 && e.defect === `the record holds a loop above ${bag("q")}` && /Nothing was changed\.$/.test(e.hint));
  w.seed(ME, 1); // a pocket-comet in my hands: a give by kind into q counts up through the loop
  await assert.rejects(go(w, "give", { kind: "pocket-comet", count: 1, to: bag("q") }),
    (e) => e.code === 422 && e.defect === `the record holds a loop above ${bag("q")}`);
  assert.equal(w.written(), 0);
  const up = tree.liveHolders(loopRows);
  assert.deepEqual(tree.holderChain(up, bag("q")), { chain: [bag("p")], loop: true });
  assert.equal(tree.wholeLoadOf({ up, holder: bag("p") }), 1, "the walk down counts q once and stops when it comes back to p");
  // the verbs matrix counts rooms through the same walk, and returns over the loop
  const view = classViewOf(SNAP);
  const pairs = usablePairs({ actor: ME, here: { x: 5, y: 6 }, marks: [markOf(bag("p")), markOf(bag("q")), markOf(LAMP)], residents: [],
    fold: foldUnits([]), attachments: loopRows, view });
  assert.ok(Array.isArray(pairs));
});
