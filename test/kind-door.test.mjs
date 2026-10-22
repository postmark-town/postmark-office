// kind-door.test.mjs — LOGOS v2 part 2, lane O2: marks made into a holder, and
// taken and given by kind, driven through the kind door with an in-memory record.
//
// `callKinds` (src/world-kinds.mjs) with every collaborator injected, over a law
// snapshot in W1's shape (the class tree as ruled 2026-10-16, holder → capacity
// → min/max and holder → open as nested property nodes; the Halloween Candy
// Bowl's afforded `refill`). The real pen, reach and queue are proven by their
// own suites; these prove the adjudication. Each test names the falsifier it is
// (O2's list, sent to the lead 2026-10-17, with the lead's three settlements:
// capacity refuses whole and says the room; pot luck is derived from the act;
// portable is sovereign, default true).

import { test } from "node:test";
import assert from "node:assert/strict";
import { callKinds, kindRouteOf } from "../src/world-kinds.mjs";
import { classViewOf } from "../src/world-units.mjs";
import { UNIT_ACTION, foldUnits, totalOf, kindEdgesOf, edgesOf } from "../src/world-stacks.mjs";
import { lawSnapshotFromRows } from "../src/law-classes.mjs";
import { potLuck, drawSeed, blurOf } from "../src/kind-holding.mjs";

const SHA = "b".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: parent ? `${klass}/${parent}/${name}` : `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const BOWL_ACTIONS = [{ action: "refill", who: "maker", from: "reach", effect: "leave-mark { kind, count, to: this bowl }", residue: "the-town/leave-mark" }];
const SNAP = lawSnapshotFromRows([
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("note", { extends: "sited" }),
  cls("thing", { extends: "sited" }), cls("consumable", { extends: "thing" }), cls("candy", { extends: "consumable" }),
  cls("pocket-comet", { extends: "candy" }), cls("carbon-ghost", { extends: "candy" }), cls("toaster", { extends: "thing" }),
  cls("parcel", { extends: "sited" }), cls("portal-ground", { extends: "sited" }), cls("vehicle", { extends: "portal-ground" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  cls("halloween-candy-bag", { extends: "thing" }), cls("halloween-candy-bowl", { extends: "thing", actions: JSON.stringify(BOWL_ACTIONS) }),
  prop("postmark-node", "makers", false, "constitution"), prop("sited", "makers", true, "constitution"),
  prop("thing", "makers", true, "constitution"), prop("parcel", "makers", false, "constitution"), prop("portal-ground", "makers", false, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
  prop("halloween-candy-bag", "holder", true, "constitution"), prop("halloween-candy-bag", "capacity", 200, "sovereign", "holder"),
  prop("halloween-candy-bag", "max", 200, "constitution", "capacity"),
  prop("halloween-candy-bowl", "holder", true, "constitution"),
]);

const BOWL = "sbx-ana/the-bowl", BOWL2 = "sbx-bo/the-other-bowl", CRATE = "sbx-ana/a-crate", BAG = "sbx-cy/my-bag";
const MARKS = {
  [BOWL]: { id: BOWL, by: "sbx-ana", kind: "halloween-candy-bowl", at: { x: 8, y: 6 } },
  [BOWL2]: { id: BOWL2, by: "sbx-bo", kind: "halloween-candy-bowl", at: { x: 5, y: 12 } },
  [CRATE]: { id: CRATE, by: "sbx-ana", kind: "sited", class: "thing", holder: true, capacity: 5, open: false, at: { x: 5, y: 7 } },
  [BAG]: { id: BAG, by: "sbx-cy", kind: "halloween-candy-bag", at: { x: 5, y: 6 } },
  "sbx-ana/a-lamp": { id: "sbx-ana/a-lamp", by: "sbx-ana", kind: "thing", at: { x: 5, y: 6 } },
};

function world({ marks = MARKS, things = [], snap = SNAP, reach = () => true } = {}) {
  const acts = [];
  const deps = {
    classes: () => classViewOf(snap),
    readRows: async () => ({ units: acts.slice(), attachments: things }),
    markById: async (id) => marks[id] ?? null,
    reachTake: async (id) => { if (!reach(id)) throw Object.assign(new Error(`${id} is out of reach`), { code: 409, defect: `${id} is out of reach` }); return { reach: { stands: true } }; },
    reachGive: async () => ({ stands: true }),
    standpoint: async () => ({ x: 5, y: 6 }),
    householdOf: (h) => ({ key: `hh:${h}`, house: `hh:${h}` }),
    // `also` commits with the act or not at all (the live pen's one transaction): here, all pushed together
    append: async (entry, { also = [] } = {}) => { const id = acts.length + 100; for (const e of [entry, ...also]) acts.push({ id: acts.length + 100, class: e.cls, action: e.action, object: e.object, actor: e.actor, at: e.at, payload: e.payload, effect: e.effect }); return { actId: id }; },
    stamp: async (actor) => ({ at: `2026-10-17T06:00:00Z@${actor}#${acts.length}`, witnesses: [] }),
    crossing: () => 260,
    household: () => "hh:test",
  };
  const seed = (moves, action = UNIT_ACTION.make) => acts.push({ id: acts.length + 100, class: "holding", action, object: null, payload: { units: true, moves } });
  return { deps, acts, seed, fold: () => foldUnits(acts) };
}
const KEY = (h) => ({ handles: new Set([h]) });
const go = (w, route, args, actor = "sbx-cy") => callKinds(route, args, KEY(actor), actor, w.deps);

// ── LEAVE-MARK INTO A HOLDER ────────────────────────────────────────────────

test("1 · make into a published holder is live: the count is in it at once, one units:make act, nothing filed", async () => {
  const w = world();
  const r = await go(w, "make", { kind: "pocket-comet", count: 10, to: BOWL }, "sbx-ana");
  assert.deepEqual([r.did, r.kind, r.count, r.live, r.holds.count], ["make", "pocket-comet", 10, true, 10]);
  assert.deepEqual(kindEdgesOf(w.fold(), BOWL), [{ kind: "pocket-comet", count: 10 }]);
  assert.equal(w.acts.length, 1);
  assert.equal(w.acts[0].action, UNIT_ACTION.make);
  assert.deepEqual(w.acts[0].payload.moves, [{ from: null, to: BOWL, kind: "pocket-comet", n: 10 }]);
});

test("2 · make into yourself: a resident is a holder (capacity 24), and the count lands in your hands", async () => {
  const w = world();
  const r = await go(w, "make", { kind: "carbon-ghost", count: 3, to: "sbx-cy" });
  assert.equal(r.holds.count, 3);
  assert.deepEqual(kindEdgesOf(w.fold(), "sbx-cy"), [{ kind: "carbon-ghost", count: 3 }]);
  await assert.rejects(go(w, "make", { kind: "carbon-ghost", count: 1, to: "sbx-dee" }), (e) => /make it into yourself, then give/.test(e.defect));
});

test("5 · makers: a kind under a makers-false class refuses, and so does an unknown kind, a non-thing and a holder kind; nothing is made", async () => {
  const w = world();
  for (const [kind, why] of [["vehicle", /the town's to make/], ["parcel", /the town's to make/], ["resident", /the town's to make/],
    ["no-such-kind", /no kind "no-such-kind"/], ["note", /not a thing/], ["halloween-candy-bowl", /holds things of its own/]])
    await assert.rejects(go(w, "make", { kind, count: 1, to: "sbx-cy" }), (e) => why.test(e.defect), kind);
  assert.equal(w.acts.length, 0);
  // and a kind under thing passes, its makers inherited
  await go(w, "make", { kind: "toaster", count: 1, to: "sbx-cy" });
});

test("6 · capacity (the lead's settlement): past the room refuses WHOLE, nothing made, and says the room — 'has room for 4, not 10'", async () => {
  const w = world();
  w.seed([{ from: null, to: BOWL, kind: "pocket-comet", n: 26 }]);
  const before = w.acts.length;
  await assert.rejects(go(w, "make", { kind: "carbon-ghost", count: 10, to: BOWL }, "sbx-ana"),
    (e) => e.code === 409 && /has room for 4, not 10/.test(e.defect) && e.room === 4);
  assert.equal(w.acts.length, before, "nothing made");
  await go(w, "make", { kind: "carbon-ghost", count: 4, to: BOWL }, "sbx-ana");
  assert.equal(totalOf(w.fold(), BOWL), 30, "thing's capacity, 30, inherited by the bowl");
  // a resident's 24; a bag's own 200 above thing's 120; a mark's own sovereign capacity (the crate's 5)
  w.seed([{ from: null, to: "sbx-cy", kind: "pocket-comet", n: 22 }]);
  await assert.rejects(go(w, "make", { kind: "pocket-comet", count: 3, to: "sbx-cy" }), (e) => /room for 2, not 3/.test(e.defect));
  await go(w, "make", { kind: "pocket-comet", count: 150, to: BAG });
  assert.equal(totalOf(w.fold(), BAG), 150);
  await assert.rejects(go(w, "make", { kind: "pocket-comet", count: 6, to: CRATE }, "sbx-ana"), (e) => /room for 5, not 6/.test(e.defect));
});

test("6b · whole things in a holder share its room with its counts", async () => {
  const w = world({ things: [{ entity: BOWL, target: "sbx-ana/a-lamp", policy: "cascade" }] });
  w.seed([{ from: null, to: BOWL, kind: "pocket-comet", n: 28 }]);
  await assert.rejects(go(w, "make", { kind: "pocket-comet", count: 2, to: BOWL }, "sbx-ana"), (e) => /room for 1, not 2/.test(e.defect));
});

test("7 · open: another household's holder that is not open refuses at the door; its own household passes", async () => {
  const w = world();
  await assert.rejects(go(w, "make", { kind: "pocket-comet", count: 1, to: CRATE }), (e) => e.code === 403 && /not open to other households/.test(e.defect));
  assert.equal(w.acts.length, 0);
  await go(w, "make", { kind: "pocket-comet", count: 1, to: CRATE }, "sbx-ana");
  // an open one (a bowl, open by thing's default) takes another household's make
  await go(w, "make", { kind: "pocket-comet", count: 1, to: BOWL });
});

test("a holder must be published and must hold: a draft and a plain thing refuse, nothing made", async () => {
  const w = world();
  await assert.rejects(go(w, "make", { kind: "pocket-comet", count: 1, to: "sbx-cy/a-draft" }), (e) => e.code === 404 && /a draft holds nothing yet/.test(e.hint));
  await assert.rejects(go(w, "make", { kind: "pocket-comet", count: 1, to: "sbx-ana/a-lamp" }), (e) => /holds nothing/.test(e.defect));
  assert.equal(w.acts.length, 0);
});

// ── TAKE BY KIND ────────────────────────────────────────────────────────────

test("8 · pot luck: a take naming no kind draws from everything held, derived from the act — the same act draws the same", async () => {
  const draws = [];
  for (let i = 0; i < 2; i++) {
    const w = world();
    w.seed([{ from: null, to: BOWL, kind: "pocket-comet", n: 6 }, { from: null, to: BOWL, kind: "carbon-ghost", n: 6 }]);
    const r = await go(w, "take", { from: BOWL, count: 5 });
    assert.equal(r.draw, "pot luck");
    assert.equal(r.took.count, 5);
    const seed = w.acts.at(-1).payload.seed;
    assert.equal(seed, drawSeed({ actor: "sbx-cy", from: BOWL, crossing: 260, at: w.acts.at(-1).at, ordinal: 1 }), "the seed is the act's own identity, recorded on it");
    // the recorded moves are exactly the draw the seed gives: a replay draws the same
    const replay = potLuck({ edges: [{ kind: "carbon-ghost", count: 6 }, { kind: "pocket-comet", count: 6 }], n: 5, seed });
    assert.deepEqual(w.acts.at(-1).payload.moves.map((m) => ({ kind: m.kind, count: m.n })), replay.drawn);
    draws.push(JSON.stringify(w.acts.at(-1).payload.moves));
  }
  assert.equal(draws[0], draws[1], "two offices replaying the same act draw the same");
  // a witness stamp is an object on the real path: the seed serializes it, never "[object Object]"
  const placed = drawSeed({ actor: "a", from: BOWL, at: { anchor: "x/y", dx: 1, dy: 2 }, ordinal: 4 });
  assert.ok(placed.includes(`"anchor":"x/y"`), placed);
  assert.notEqual(placed, drawSeed({ actor: "a", from: BOWL, at: { anchor: "x/y", dx: 1, dy: 2 }, ordinal: 5 }), "a second take from one spot draws apart");
  // a different seed may draw differently, and every draw is within what is held
  const d = potLuck({ edges: [{ kind: "a", count: 1 }, { kind: "b", count: 100 }], n: 101, seed: "x" });
  assert.deepEqual(d.drawn, [{ kind: "a", count: 1 }, { kind: "b", count: 100 }]);
});

test("8b · naming a kind narrows the draw to it; count defaults to 1", async () => {
  const w = world();
  w.seed([{ from: null, to: BOWL, kind: "pocket-comet", n: 6 }, { from: null, to: BOWL, kind: "carbon-ghost", n: 6 }]);
  const r = await go(w, "take", { from: BOWL, kind: "carbon-ghost" });
  assert.equal(r.count, 1);
  assert.deepEqual(kindEdgesOf(w.fold(), "sbx-cy"), [{ kind: "carbon-ghost", count: 1 }]);
  await assert.rejects(go(w, "take", { from: BOWL, kind: "toaster" }), (e) => /holds no toaster/.test(e.defect));
});

test("9 · more than held refuses: 'holds 12, not 15', nothing moved", async () => {
  const w = world();
  w.seed([{ from: null, to: BOWL, kind: "pocket-comet", n: 12 }]);
  const before = w.acts.length;
  await assert.rejects(go(w, "take", { from: BOWL, count: 15 }), (e) => /holds 12, not 15/.test(e.defect));
  await assert.rejects(go(w, "take", { from: BOWL, kind: "pocket-comet", count: 15 }), (e) => /holds 12 pocket-comet, not 15/.test(e.defect));
  assert.equal(w.acts.length, before);
});

test("10 · from omitted, several holders in reach hold the kind: refused, nothing changed, candidates by owner, id and distance, nearest first", async () => {
  const w = world();
  w.seed([{ from: null, to: BOWL, kind: "pocket-comet", n: 3 }, { from: null, to: BOWL2, kind: "pocket-comet", n: 3 }]);
  const before = w.acts.length;
  await assert.rejects(go(w, "take", { kind: "pocket-comet" }), (e) => {
    assert.match(e.defect, /take from which\? 2 holders in reach/);
    assert.match(e.hint, /^sbx-ana\/the-bowl \(sbx-ana's, 3 m\), sbx-bo\/the-other-bowl \(sbx-bo's, 6 m\)/);
    assert.deepEqual(e.candidates.map((c) => [c.id, c.owner, c.distance_m]), [[BOWL, "sbx-ana", 3], [BOWL2, "sbx-bo", 6]]);
    return true;
  });
  assert.equal(w.acts.length, before);
});

test("11 · from omitted, exactly one holder in reach holds the kind: it is the source (out of reach does not count)", async () => {
  const w = world({ reach: (id) => id !== BOWL2 });
  w.seed([{ from: null, to: BOWL, kind: "pocket-comet", n: 3 }, { from: null, to: BOWL2, kind: "pocket-comet", n: 3 }]);
  const r = await go(w, "take", { kind: "pocket-comet", count: 2 });
  assert.equal(r.from, BOWL);
  assert.equal(totalOf(w.fold(), BOWL), 1);
  await assert.rejects(go(world(), "take", { kind: "pocket-comet" }), (e) => /nothing in reach holds pocket-comet/.test(e.defect));
});

test("12 · counts are blur: no answer names a unit, says 'piece', or lists units one by one; a read gives the nearest common class and a number", async () => {
  const w = world();
  w.seed([{ from: null, to: BOWL, kind: "pocket-comet", n: 18 }, { from: null, to: BOWL, kind: "carbon-ghost", n: 3 }]);
  const r = await go(w, "take", { from: BOWL, count: 2 });
  assert.equal(r.holder.shows, "19 candies");
  const text = JSON.stringify(r) + JSON.stringify(w.acts);
  assert.doesNotMatch(text, /\bpiece/i);
  assert.equal(blurOf({ edges: [{ kind: "pocket-comet", count: 18 }], extendsOf: classViewOf(SNAP).extendsOf }).shows, "18 pocket-comets");
  const lamp = blurOf({ edges: [{ kind: "pocket-comet", count: 18 }], things: ["toaster"], extendsOf: classViewOf(SNAP).extendsOf });
  assert.equal(lamp.shows, "19 things");
  const sharp = blurOf({ edges: [{ kind: "carbon-ghost", count: 3 }, { kind: "pocket-comet", count: 18 }], extendsOf: classViewOf(SNAP).extendsOf, sharp: true });
  assert.deepEqual(sharp.kinds.map((k) => k.shows), ["3 carbon-ghosts", "18 pocket-comets"], "investigate sharpens the class, never into units");
});

test("a take respects the taker's carry and a holder's open; a resident's hands are not a source", async () => {
  const w = world();
  w.seed([{ from: null, to: BOWL, kind: "pocket-comet", n: 30 }, { from: null, to: CRATE, kind: "pocket-comet", n: 2 }]);
  await go(w, "take", { from: BOWL, count: 24 });
  await assert.rejects(go(w, "take", { from: BOWL, count: 1 }), (e) => /24 of 24/.test(e.defect));
  await assert.rejects(go(w, "take", { from: CRATE }, "sbx-dee"), (e) => e.code === 403);
  await assert.rejects(go(w, "take", { from: "sbx-ana" }, "sbx-dee"), (e) => /hands are their own/.test(e.defect));
});

// ── GIVE BY KIND, THE TRANSFER EDGE ─────────────────────────────────────────

test("13 · give { kind, count, to }: to a resident or into a holder, the room checked whole at the receiving end", async () => {
  const w = world();
  w.seed([{ from: null, to: "sbx-cy", kind: "pocket-comet", n: 5 }, { from: null, to: BOWL, kind: "carbon-ghost", n: 28 }]);
  await assert.rejects(go(w, "give", { to: BOWL, kind: "pocket-comet", count: 3 }), (e) => /has room for 2, not 3/.test(e.defect));
  const r = await go(w, "give", { to: BOWL, count: 2 });
  assert.equal(r.kind, "pocket-comet", "one kind in hand: it may be omitted");
  const g = await go(w, "give", { to: "sbx-dee", kind: "pocket-comet", count: 3 });
  assert.match(g.stands, /neutral/);
  assert.deepEqual([totalOf(w.fold(), "sbx-cy"), totalOf(w.fold(), "sbx-dee"), totalOf(w.fold(), BOWL)], [0, 3, 30]);
  w.seed([{ from: null, to: "sbx-cy", kind: "pocket-comet", n: 1 }, { from: null, to: "sbx-cy", kind: "carbon-ghost", n: 1 }]);
  await assert.rejects(go(w, "give", { to: "sbx-dee" }), (e) => /give which kind\?/.test(e.defect) && /1 carbon-ghost, 1 pocket-comet/.test(e.hint));
});

test("15 + 16 · a give and a take are each ONE act with two ends; a failing end refuses the whole edge, nothing moved", async () => {
  const w = world();
  w.seed([{ from: null, to: "sbx-cy", kind: "pocket-comet", n: 4 }]);
  const before = w.acts.length;
  await go(w, "give", { to: BOWL, kind: "pocket-comet", count: 4 });
  assert.equal(w.acts.length, before + 1);
  assert.deepEqual(w.acts.at(-1).payload.edge, { giver: "sbx-cy", receiver: BOWL });
  await go(w, "take", { from: BOWL, count: 4 }, "sbx-dee");
  assert.equal(w.acts.length, before + 2);
  assert.deepEqual(w.acts.at(-1).payload.edge, { giver: BOWL, receiver: "sbx-dee" });
  // the giver does not hold it: refused, nothing moved
  await assert.rejects(go(w, "give", { to: BOWL, kind: "pocket-comet", count: 1 }), /no pocket-comet in your hands/);
  assert.equal(w.acts.length, before + 2);
  assert.deepEqual(w.fold().anomalies, []);
});

test("17 · a holder that is not open refuses another household's give at the door; its own household's give passes", async () => {
  const w = world();
  w.seed([{ from: null, to: "sbx-cy", kind: "pocket-comet", n: 2 }, { from: null, to: "sbx-ana", kind: "pocket-comet", n: 2 }]);
  await assert.rejects(go(w, "give", { to: CRATE, count: 1 }), (e) => e.code === 403 && /not open/.test(e.defect));
  await go(w, "give", { to: CRATE, count: 1 }, "sbx-ana");
  assert.equal(totalOf(w.fold(), CRATE), 1);
});

// ── REFILL, THE BOWL'S OWN ACTION ───────────────────────────────────────────

test("19 · refill is the Candy Bowl's afforded action: maker only, and it is leave-mark into the bowl", async () => {
  const w = world();
  const r = await go(w, "refill", { act: "refill", thing: BOWL, kind: "pocket-comet", count: 12 }, "sbx-ana");
  assert.equal(r.did, "refill");
  assert.equal(w.acts.at(-1).action, UNIT_ACTION.make, "the same act as leave-mark into the bowl");
  assert.equal(w.acts.at(-1).payload.via, "refill");
  assert.equal(totalOf(w.fold(), BOWL), 12);
});

test("20 · a non-maker's refill refuses; a refill past capacity refuses whole and says the room (the lead's settlement)", async () => {
  const w = world();
  await assert.rejects(go(w, "refill", { act: "refill", thing: BOWL, kind: "pocket-comet", count: 1 }, "sbx-bo"), (e) => e.code === 403 && /did not make/.test(e.defect));
  w.seed([{ from: null, to: BOWL, kind: "pocket-comet", n: 26 }]);
  await assert.rejects(go(w, "refill", { act: "refill", thing: BOWL, kind: "pocket-comet", count: 10 }, "sbx-ana"), (e) => /has room for 4, not 10/.test(e.defect));
  assert.equal(totalOf(w.fold(), BOWL), 26);
});

test("21 · there is no general refill verb: on any other holder it refuses with its reason", async () => {
  const w = world();
  await assert.rejects(go(w, "refill", { act: "refill", thing: CRATE, kind: "pocket-comet", count: 1 }, "sbx-ana"),
    (e) => /refill is not an action of a thing/.test(e.defect) && /leave-mark \{ kind, count, to: "sbx-ana\/a-crate" \}/.test(e.hint));
  await assert.rejects(go(w, "refill", { act: "refill", thing: BAG, kind: "pocket-comet", count: 1 }), /refill is not an action of a halloween-candy-bag/);
  assert.equal(w.acts.length, 0);
});

// ── SAFETY ──────────────────────────────────────────────────────────────────

test("27 · labels and kinds never mix: a label move is never read as a kind holding, nor a kind as a label; room counts both", () => {
  const rows = [
    { class: "holding", action: UNIT_ACTION.give, payload: { moves: [{ from: null, to: BOWL, label: "pocket-comet", n: 4 }] } },
    { class: "holding", action: UNIT_ACTION.make, payload: { moves: [{ from: null, to: BOWL, kind: "pocket-comet", n: 3 }] } },
  ];
  const f = foldUnits(rows);
  assert.deepEqual(edgesOf(f, BOWL), [{ label: "pocket-comet", count: 4 }]);
  assert.deepEqual(kindEdgesOf(f, BOWL), [{ kind: "pocket-comet", count: 3 }]);
  assert.equal(totalOf(f, BOWL), 7, "the holder holds both");
  // a kind take cannot draw a label's units
  const take = { class: "holding", action: UNIT_ACTION.take, payload: { moves: [{ from: BOWL, to: "sbx-cy", kind: "pocket-comet", n: 4 }] } };
  assert.equal(foldUnits([...rows, take]).anomalies.length, 1, "4 kind units were never there; the label's 4 are not borrowed");
});

test("the route is read off the arguments: label and chest are #499's, thing is the thing door's, the rest by kind", () => {
  assert.equal(kindRouteOf({ from: BOWL, label: "x" }), null);
  assert.equal(kindRouteOf({ act: "refill", chest: BOWL }), null);
  assert.equal(kindRouteOf({ act: "consume" }), "consume", "consume { kind } is the kind door's (12:36)");
  assert.equal(kindRouteOf({ act: "consume", thing: "a/set-down" }), null, "a set-down's mark consumed in place is #499's");
  assert.equal(kindRouteOf({ act: "consume", label: "x" }), null);
  assert.equal(kindRouteOf({ thing: "a/b" }), null);
  assert.equal(kindRouteOf({ thing: "a/b", to: "kai" }), null);
  assert.equal(kindRouteOf({ from: BOWL }), "take");
  assert.equal(kindRouteOf({ kind: "pocket-comet" }), "take");
  assert.equal(kindRouteOf({ kind: "pocket-comet" }, "drop"), "drop");
  assert.equal(kindRouteOf({ kind: "pocket-comet", to: "kai" }), "give");
  assert.equal(kindRouteOf({ to: BOWL }), "give");
  assert.equal(kindRouteOf({ to: "kai" }), "give", "a give naming no thing is by kind: G7 answers it (review-610 nit)");
  assert.equal(kindRouteOf({ act: "refill", thing: BOWL }), "refill");
});

// ── G6 CORRECTED (the lead, 2026-10-17): pot luck draws over EVERYTHING held ──

test("G6 · pot luck draws over the counted kinds AND the whole marks a holder holds, a whole mark counting 1; replayed from the act", async () => {
  const lamp = "sbx-ana/a-lamp";
  const w = world({ things: [{ entity: BOWL, target: lamp, policy: "cascade", born_at: "2026-10-17T00:00:00Z" }] });
  w.seed([{ from: null, to: BOWL, kind: "pocket-comet", n: 2 }]);
  const r = await go(w, "take", { from: BOWL, count: 3 });
  assert.equal(r.took.count, 3, "everything: two counted and the lamp");
  const draw = w.acts.find((a) => a.action === UNIT_ACTION.take);
  assert.deepEqual(draw.payload.things, [lamp], "the act records the whole mark its draw took");
  const moved = w.acts.filter((a) => !String(a.action).startsWith("units:"));
  assert.equal(moved.length, 1, "the whole mark moves by its own holding act");
  assert.equal(moved[0].object, lamp);
  const replay = potLuck({ edges: [{ kind: "pocket-comet", count: 2 }], things: [{ thing: lamp, class: "thing" }], n: 3, seed: draw.payload.seed });
  assert.deepEqual(replay.things, [lamp]);
  assert.deepEqual(replay.drawn, [{ kind: "pocket-comet", count: 2 }]);
  // the weights: over many seeds, the lamp (1 of 11) is drawn about a tenth of the time
  let lampHits = 0;
  for (let i = 0; i < 2000; i++) if (potLuck({ edges: [{ kind: "pocket-comet", count: 10 }], things: [{ thing: lamp, class: "thing" }], n: 1, seed: `s${i}` }).things.length) lampHits++;
  assert.ok(lampHits > 120 && lampHits < 250, `a whole mark weighs 1 against 10 counted (${lampHits}/2000)`);
});

test("G6 · naming a kind narrows the draw by lineage: candy draws every candy kind and no lamp", () => {
  const extendsOf = classViewOf(SNAP).extendsOf;
  const d = potLuck({ edges: [{ kind: "pocket-comet", count: 2 }, { kind: "carbon-ghost", count: 2 }], things: [{ thing: "x/lamp", class: "thing" }], n: 4, seed: "q", kind: "candy", extendsOf });
  assert.deepEqual(d.things, []);
  assert.equal(d.drawn.reduce((s, x) => s + x.count, 0), 4);
  assert.deepEqual(potLuck({ edges: [{ kind: "pocket-comet", count: 2 }], things: [{ thing: "x/lamp", class: "thing" }], n: 3, seed: "q", kind: "candy", extendsOf }), { short: 2 }, "the lamp is not candy");
});

test("a whole mark into a holder and out of it: the holder's room counts kinds and whole marks, and its open answers", async () => {
  const lamp = "sbx-ana/a-lamp";
  const w = world({ things: [{ entity: "sbx-cy", target: lamp, policy: "cascade", born_at: "2026-10-17T00:00:00Z" }] });
  w.seed([{ from: null, to: BOWL, kind: "pocket-comet", n: 30 }]);
  await assert.rejects(go(w, "thing-into-holder", { thing: lamp, to: BOWL }), (e) => /has room for 0, not 1/.test(e.defect));
  await assert.rejects(go(w, "thing-into-holder", { thing: lamp, to: CRATE }), (e) => e.code === 403);
  const w2 = world({ things: [{ entity: "sbx-cy", target: lamp, policy: "cascade", born_at: "2026-10-17T00:00:00Z" }] });
  const g = await go(w2, "thing-into-holder", { thing: lamp, to: BOWL });
  assert.deepEqual([g.did, g.edge], ["give", { giver: "sbx-cy", receiver: BOWL }]);
  const w3 = world({ things: [{ entity: BOWL, target: lamp, policy: "cascade", born_at: "2026-10-17T00:00:00Z" }] });
  const t = await go(w3, "thing-from-holder", { thing: lamp, from: BOWL });
  assert.deepEqual([t.did, t.holder], ["take", "sbx-cy"]);
  assert.equal(kindRouteOf({ thing: lamp, from: BOWL }), "thing-from-holder");
  assert.equal(kindRouteOf({ thing: lamp, to: BOWL }), "thing-into-holder");
});

test("a holder's own capacity outside its class's bounds is refused at the door, never trusted (O1's holdingOf)", async () => {
  const big = "sbx-ana/big-crate";
  const w = world({ marks: { ...MARKS, [big]: { id: big, by: "sbx-ana", kind: "sited", class: "thing", holder: true, capacity: 500, at: { x: 5, y: 7 } } } });
  for (const [route, args] of [["make", { kind: "pocket-comet", count: 1, to: big }], ["take", { from: big }], ["give", { to: big, kind: "pocket-comet" }]])
    await assert.rejects(go(w, route, args, "sbx-ana"), (e) => /own capacity is refused/.test(e.defect) && /outside 1\.\.120/.test(e.hint), route);
  assert.equal(w.acts.length, 0);
});

test("consume { kind } (12:36): one mark of a consumable kind from your own hands; a non-consumable refuses; several kinds are named", async () => {
  const w = world();
  w.seed([{ from: null, to: "sbx-cy", kind: "pocket-comet", n: 2 }, { from: null, to: "sbx-cy", kind: "toaster", n: 1 }]);
  const r = await go(w, "consume", { act: "consume" });
  assert.deepEqual([r.did, r.kind, r.count], ["consume", "pocket-comet", 1], "one consumable kind in hand: it may be omitted (the toaster is not one)");
  assert.deepEqual(w.acts.at(-1).payload.moves, [{ from: "sbx-cy", to: null, kind: "pocket-comet", n: 1 }]);
  await assert.rejects(go(w, "consume", { act: "consume", kind: "toaster" }), (e) => e.code === 422 && /not a consumable/.test(e.defect));
  await assert.rejects(go(w, "consume", { act: "consume", kind: "carbon-ghost" }), (e) => /no carbon-ghost in your hands/.test(e.defect));
  await assert.rejects(go(w, "consume", { act: "consume", count: 2 }), /one at a time/);
  w.seed([{ from: null, to: "sbx-cy", kind: "carbon-ghost", n: 1 }]);
  await assert.rejects(go(w, "consume", { act: "consume" }), (e) => /consume which kind\?/.test(e.defect));
  assert.deepEqual(kindEdgesOf(w.fold(), "sbx-cy"), [{ kind: "carbon-ghost", count: 1 }, { kind: "pocket-comet", count: 1 }, { kind: "toaster", count: 1 }]);
});

test("nit · give { to: <resident> } naming nothing answers G7, never \"you are not holding undefined\"", async () => {
  const w = world();
  await assert.rejects(go(w, "give", { to: "sbx-dee" }), (e) => /nothing to give: your hands hold nothing/.test(e.defect));
  w.seed([{ from: null, to: "sbx-cy", kind: "pocket-comet", n: 1 }, { from: null, to: "sbx-cy", kind: "carbon-ghost", n: 2 }]);
  await assert.rejects(go(w, "give", { to: "sbx-dee" }), (e) => /give which kind?/.test(e.defect) && /2 carbon-ghosts, 1 pocket-comet/.test(e.hint));
});

const MY_BOWL_FOR_REFILL = "sbx-ana/the-bowl";
test("B1 · a holder in your own hands is in reach wherever you stand: the door asks where it is now, not where it was made", async () => {
  const w = world({ reach: () => false }); // the canon place is out of reach
  w.deps.holderPlace = async (id) => ({ holder: id === BAG ? "sbx-cy" : null, at: null, moved: false });
  const r = await go(w, "make", { kind: "pocket-comet", count: 2, to: BAG });
  assert.equal(r.holds.count, 2, "in your hands: in reach");
  const t = await go(w, "take", { from: BAG });
  assert.equal(t.count, 1, "and taken from, in your hands, wherever you stand");
  await assert.rejects(go(w, "make", { kind: "pocket-comet", count: 1, to: BOWL }, "sbx-ana"), /out of reach/, "not carried: the canon place, out of reach");
  w.deps.holderPlace = async () => ({ holder: "sbx-dee", at: null, moved: false });
  await assert.rejects(go(w, "take", { from: BAG }), (e) => /in sbx-dee's hands/.test(e.defect), "another's carried holder is theirs to give from");
  // SETTLED: making into another resident's carried holder is refused (make into yourself, then give); a give into it stands
  await assert.rejects(go(w, "make", { kind: "pocket-comet", count: 1, to: BAG }), (e) => e.code === 422 && /make into yourself, then give/.test(e.defect));
  await assert.rejects(go(w, "refill", { act: "refill", thing: MY_BOWL_FOR_REFILL, kind: "pocket-comet", count: 1 }, "sbx-ana"), (e) => /make into yourself, then give/.test(e.defect), "refill is a make");
  w.seed([{ from: null, to: "sbx-cy", kind: "pocket-comet", n: 1 }]);
  const g = await go(w, "give", { to: BAG, kind: "pocket-comet", count: 1 });
  assert.equal(g.did, "give", "a give into another's carried holder at arm's length stands");
  w.deps.holderPlace = async () => ({ holder: BOWL, at: null, moved: false });
  await assert.rejects(go(w, "take", { from: BAG }), (e) => /inside sbx-ana\/the-bowl/.test(e.defect));
});

test("B2 · a holder is a holder by its holder property, and portable is the thing/portable property — never a class named chest", async () => {
  const { isHolderMark, portableMark } = await import("../src/kind-holding.mjs");
  const cp = (n, p) => classViewOf(SNAP).property(n, p);
  assert.equal(isHolderMark(MARKS[BOWL], cp), true, "a Candy Bowl: holder by its class's constitution property");
  assert.equal(isHolderMark(MARKS[CRATE], cp), true, "a thing whose maker set holder: true");
  assert.equal(isHolderMark(MARKS["sbx-ana/a-lamp"], cp), false, "a plain thing holds nothing");
  assert.equal(portableMark(MARKS["sbx-ana/a-lamp"], cp), true, "portable: sovereign, default true");
  assert.equal(portableMark({ ...MARKS["sbx-ana/a-lamp"], portable: false }, cp), false, "a maker's own portable: false");
});

test("B2 · [source pin, not a run] the withdraw-only-when-empty guard and the fixed-thing refusal ask the holder and portable properties", async () => {
  const { readFileSync } = await import("node:fs");
  const world = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
  const hold = readFileSync(new URL("../src/world-hold.mjs", import.meta.url), "utf8");
  assert.match(world, /const isChest = \(await import\("\.\/kind-holding\.mjs"\)\)\.isHolderMark\(/, "journalWithdraw's empty guard is keyed on the holder property");
  assert.match(hold, /!\(await import\("\.\/kind-holding\.mjs"\)\)\.portableMark\(m, classProperty\)/, "the fixed-thing refusal reads thing/portable");
  assert.doesNotMatch(hold, /markClassOf\(m\) === "chest" && m\.portable === false/);
});

test("offer { kind, creature } (POS-672, call 2, D3): one of a consumable kind from your hands, used up toward the creature as units:offer; refusals change nothing", async () => {
  const w = world();
  const WOLF = "creature:wolf-270-1";
  w.seed([{ from: null, to: "sbx-cy", kind: "pocket-comet", n: 2 }, { from: null, to: "sbx-cy", kind: "toaster", n: 1 }]);
  const before = w.acts.length;
  await assert.rejects(go(w, "offer", { kind: "toaster", creature: WOLF }), (e) => e.code === 422 && /not a consumable/.test(e.defect));
  await assert.rejects(go(w, "offer", { kind: "carbon-ghost", creature: WOLF }), (e) => e.code === 409 && /no carbon-ghost in your hands/.test(e.defect));
  await assert.rejects(go(w, "offer", { kind: "pocket-comet" }), /offer to which creature\?/);
  assert.equal(w.acts.length, before, "a refused offer writes nothing and uses nothing up");
  const r = await go(w, "offer", { creature: WOLF });
  assert.deepEqual([r.did, r.kind, r.count, r.offered.kind, r.offered.name], ["offer", "pocket-comet", 1, "pocket-comet", "pocket comet"],
    "one consumable kind in hand: it may be omitted, as consume's");
  const row = w.acts.at(-1);
  assert.deepEqual([row.action, row.object, row.class], [UNIT_ACTION.offer, WOLF, "holding"], "its row is the creature's trigger");
  assert.deepEqual(row.payload.moves, [{ from: "sbx-cy", to: null, kind: "pocket-comet", n: 1 }], "used up: from your hands to nobody (a creature holds nothing)");
  assert.ok(r.seq != null, "the act's id rides the answer: the trigger the creature door hands its creature");
  assert.deepEqual(kindEdgesOf(w.fold(), "sbx-cy"), [{ kind: "pocket-comet", count: 1 }, { kind: "toaster", count: 1 }]);
  const empty = world();
  await assert.rejects(go(empty, "offer", { creature: WOLF }), (e) => e.code === 409 && /carry nothing to offer/.test(e.defect) && /leave-mark/.test(e.hint));
});
