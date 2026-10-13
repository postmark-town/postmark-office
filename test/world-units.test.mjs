// world-units.test.mjs — WLD-27: the unit door, driven with an in-memory record.
//
// `callUnits` (src/world-units.mjs) with every collaborator injected: an
// in-memory `acts` holding rows, a class layer whose candy carries SYNTHETIC
// labels, chest marks, a reach that admits, a synthetic stake ledger and a
// recording leave/withdraw. Nothing here touches a store, a clone or a ledger.
// What these prove is the door's adjudication and ordering; the real pen and
// reach are proven by their own suites (hold-edge-on-acts, hold-reach).

import { test } from "node:test";
import assert from "node:assert/strict";
import { callUnits, unitRouteOf, classViewOf } from "../src/world-units.mjs";
import { UNIT_ACTION, foldUnits, totalOf, edgesOf } from "../src/world-stacks.mjs";

const LABELS = [
  { label: "test-comets", name: "Test Comets", creator: "sbx-ana" },
  { label: "test-drops", name: "Test Drops", creator: "sbx-bo" },
];
const CLASSES = {
  thing: { extends: "mark", dials: { carry_cap: 24 } },
  consumable: { extends: "thing", dials: {} },
  candy: { extends: "consumable", dials: {}, labels: LABELS },
  chest: { extends: "thing", dials: { capacity: 30, capacity_min: 1, capacity_max: 120, first_stock: 30, portable: true, welcome: "open" } },
  mark: { extends: "postmark-node", dials: {} },
  // the root the Keeping Works carries (postmark-node/mark.md): while a class is
  // taken, a chain that names a class the law lacks is refused as unknown (WLD-7)
  "postmark-node": { dials: {} },
};
const snapOf = (classes) => ({ classes: new Map(Object.entries(classes)) });

function world({ classes = CLASSES, marks = {}, holders = {}, things = [] } = {}) {
  const acts = [];
  const ledger = [];          // the synthetic ledger's return lines
  const positions = structuredClone(holders); // mark -> [{handle, stamps}]
  const left = [];
  const withdrawn = [];
  let leaveFails = null;
  const deps = {
    classes: () => classViewOf(snapOf(classes)),
    readRows: async () => ({ units: acts.slice(), attachments: things }),
    markById: async (id) => marks[id] ?? null,
    reachTake: async () => ({ reach: { stands: true } }),
    reachGive: async () => ({ stands: true }),
    standpoint: async () => ({ x: 5, y: 6 }),
    householdOf: (h) => ({ key: `hh:${h}`, house: `hh:${h}` }),
    append: async (entry) => { const id = acts.length + 100; acts.push({ id, class: entry.cls, action: entry.action, object: entry.object, actor: entry.actor, payload: entry.payload, effect: entry.effect }); return { actId: id }; },
    stamp: async () => ({ at: { anchor: "x" }, witnesses: [] }),
    crossing: () => 250,
    household: () => "hh:test",
    leave: async (payload, key, opts) => { if (leaveFails) return { error: "bounce", defect: leaveFails }; left.push({ payload, opts }); return { id: `${payload.by}/${payload.slug}`, put_forward: true }; },
    holders: async (mark) => (positions[mark] ?? []).filter((h) => h.stamps > 0),
    unstake: async (r) => {
      const open = (positions[r.mark] ?? []).find((h) => h.handle === r.handle);
      const n = Math.min(open?.stamps ?? 0, r.stamps); // the engine's clip: never more than you put in
      if (open) open.stamps -= n;
      if (n > 0) ledger.push(`- 2026-10-13 · ${r.handle} ← stake:world-mark/${r.mark} · ${n} · for: unstake`);
      return { applied: n };
    },
    withdraw: async (m) => { withdrawn.push(m); return { withdrawn: true }; },
  };
  const seed = (action, moves, object = null) => acts.push({ id: acts.length + 100, class: "holding", action, object, payload: { units: true, moves } });
  return { deps, acts, ledger, left, withdrawn, positions, seed, fold: () => foldUnits(acts), failLeave: (why) => { leaveFails = why; } };
}

const CHEST = "sbx-ana/the-bowl";
const chestMark = (over = {}) => ({ id: CHEST, by: "sbx-ana", class: "chest", ...over });
const KEY = { handles: new Set(["sbx-cy"]) };

test("the brief's path at the door: take 3 → 27 / 3, consume 1 → 27 / 2, the consume line says nothing was returned", async () => {
  const w = world({ marks: { [CHEST]: chestMark() } });
  w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 30 }], CHEST);
  const t = await callUnits("take", { from: CHEST, count: 3 }, KEY, "sbx-cy", w.deps);
  assert.deepEqual([t.did, t.count, t.chest.count, t.holds.count, t.chest.shows], ["take", 3, 27, 3, "Test Comets: 27"]);
  const c = await callUnits("consume", {}, KEY, "sbx-cy", w.deps);
  assert.deepEqual(c.returns, []);
  assert.match(c.returns_note, /returns nothing/);
  assert.match(w.acts.at(-1).effect, /nothing was returned/);
  assert.deepEqual([totalOf(w.fold(), CHEST), totalOf(w.fold(), "sbx-cy")], [27, 2]);
  // the settled record is untouched by a live transfer: no mark was filed, amended or withdrawn
  assert.deepEqual([w.left.length, w.withdrawn.length], [0, 0]);
  assert.ok(w.acts.every((a) => a.class === "holding" && a.action.startsWith("units:")), "only unit acts were written");
});

test("carry: 24 succeeds, the 25th refuses with no partial debit", async () => {
  const w = world({ marks: { [CHEST]: chestMark({ capacity: 60 }) } });
  w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 30 }], CHEST);
  await callUnits("take", { from: CHEST, count: 24 }, KEY, "sbx-cy", w.deps);
  const before = w.acts.length;
  await assert.rejects(callUnits("take", { from: CHEST, count: 1 }, KEY, "sbx-cy", w.deps), (e) => e.code === 409 && /24 of 24/.test(e.defect));
  assert.equal(w.acts.length, before, "nothing written");
  assert.deepEqual([totalOf(w.fold(), CHEST), totalOf(w.fold(), "sbx-cy")], [6, 24]);
});

test("carry: a held thing (a portable chest) is one slot whatever it holds", async () => {
  const w = world({ marks: { [CHEST]: chestMark(), "sbx-cy/my-chest": chestMark({ id: "sbx-cy/my-chest", by: "sbx-cy" }) },
    things: [{ entity: "sbx-cy", target: "sbx-cy/my-chest", policy: "cascade" }] });
  w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 30 }], CHEST);
  w.seed(UNIT_ACTION.stock, [{ from: null, to: "sbx-cy/my-chest", label: "test-drops", n: 30 }], "sbx-cy/my-chest");
  await callUnits("take", { from: CHEST, count: 23 }, KEY, "sbx-cy", w.deps);
  await assert.rejects(callUnits("take", { from: CHEST, count: 1 }, KEY, "sbx-cy", w.deps), /24 of 24/);
});

test("capacity: a give into a chest beyond its room refuses and leaves both counts intact", async () => {
  const w = world({ marks: { [CHEST]: chestMark({ capacity: 20 }) } });
  w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 18 }], CHEST);
  w.seed(UNIT_ACTION.give, [{ from: null, to: "sbx-cy", label: "test-drops", n: 5 }]);
  await assert.rejects(callUnits("give", { to: CHEST, label: "test-drops", count: 3 }, KEY, "sbx-cy", w.deps), (e) => /room for 2/.test(e.defect));
  assert.deepEqual([totalOf(w.fold(), CHEST), totalOf(w.fold(), "sbx-cy")], [18, 5]);
  const ok = await callUnits("give", { to: CHEST, label: "test-drops", count: 2 }, KEY, "sbx-cy", w.deps);
  assert.equal(ok.receiver.shows, "20 candies");
  assert.deepEqual(edgesOf(w.fold(), CHEST), [{ label: "test-comets", count: 18 }, { label: "test-drops", count: 2 }], "the labels are kept whole");
});

test("mixed chest: omitting the label refuses with the counts and mutates nothing; naming one moves just it", async () => {
  const w = world({ marks: { [CHEST]: chestMark() } });
  w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 10 }], CHEST);
  w.seed(UNIT_ACTION.give, [{ from: null, to: CHEST, label: "test-drops", n: 4 }]);
  const before = w.acts.length;
  await assert.rejects(callUnits("take", { from: CHEST }, KEY, "sbx-cy", w.deps), (e) => /name a label/.test(e.defect) && /10 test-comets, 4 test-drops/.test(e.hint));
  assert.equal(w.acts.length, before);
  const t = await callUnits("take", { from: CHEST, label: "test-drops" }, KEY, "sbx-cy", w.deps);
  assert.deepEqual(edgesOf(w.fold(), "sbx-cy"), [{ label: "test-drops", count: 1 }]);
  assert.equal(t.chest.shows, "13 candies");
  await assert.rejects(callUnits("take", { from: CHEST, label: "nope" }, KEY, "sbx-cy", w.deps), /no nope/);
});

test("concurrent takes of the last units cannot both land: the queue serializes check and write", async () => {
  const w = world({ marks: { [CHEST]: chestMark() } });
  w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 3 }], CHEST);
  const results = await Promise.allSettled([
    callUnits("take", { from: CHEST, count: 2 }, KEY, "sbx-cy", w.deps),
    callUnits("take", { from: CHEST, count: 2 }, { handles: new Set(["sbx-dee"]) }, "sbx-dee", w.deps),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  const f = w.fold();
  assert.equal(totalOf(f, CHEST) + totalOf(f, "sbx-cy") + totalOf(f, "sbx-dee"), 3, "no unit duplicated or lost");
  assert.deepEqual(f.anomalies, []);
});

test("a closed chest refuses another household; a fixed bowl's units are still taken from it", async () => {
  const w = world({ marks: { [CHEST]: chestMark({ welcome: "closed" }), "sbx-ana/bowl": chestMark({ id: "sbx-ana/bowl", portable: false }) } });
  w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 30 }], CHEST);
  w.seed(UNIT_ACTION.stock, [{ from: null, to: "sbx-ana/bowl", label: "test-comets", n: 30 }], "sbx-ana/bowl");
  await assert.rejects(callUnits("take", { from: CHEST }, KEY, "sbx-cy", w.deps), (e) => e.code === 403 && /closed/.test(e.defect));
  const t = await callUnits("take", { from: "sbx-ana/bowl" }, KEY, "sbx-cy", w.deps);
  assert.equal(t.count, 1);
});

test("refill at the door: the creator fills the room in one act line; a full chest writes nothing; another resident refuses", async () => {
  const w = world({ marks: { [CHEST]: chestMark({ capacity: 30 }) } });
  w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 30 }], CHEST);
  await callUnits("take", { from: CHEST, count: 9 }, KEY, "sbx-cy", w.deps);
  const r = await callUnits("refill", { chest: CHEST }, { handles: new Set(["sbx-ana"]) }, "sbx-ana", w.deps);
  assert.equal(r.count, 9);
  assert.match(w.acts.at(-1).effect, /refilled sbx-ana\/the-bowl with 9 test-comets/);
  const n = w.acts.length;
  const again = await callUnits("refill", { chest: CHEST }, { handles: new Set(["sbx-ana"]) }, "sbx-ana", w.deps);
  assert.equal(again.noop, true);
  assert.equal(w.acts.length, n, "a full chest records nothing");
  await assert.rejects(callUnits("refill", { chest: CHEST }, KEY, "sbx-cy", w.deps), (e) => e.code === 403);
});

test("drop: one unit leaves the hands and is filed as a sited candy mark naming its act and label, through the drop's own road", async () => {
  const w = world();
  w.seed(UNIT_ACTION.give, [{ from: null, to: "sbx-cy", label: "test-comets", n: 2 }]);
  const d = await callUnits("drop", { label: "test-comets" }, KEY, "sbx-cy", w.deps);
  const dropAct = w.acts.find((a) => a.action === UNIT_ACTION.drop);
  assert.equal(d.mark, `sbx-cy/test-comets-${dropAct.id}`);
  assert.equal(w.left.length, 1);
  const { payload, opts } = w.left[0];
  assert.deepEqual({ kind: payload.kind, class: payload.class, label: payload.label, dropped: payload.dropped, stamps: payload.stamps, by: payload.by, at: payload.at },
    { kind: "sited", class: "candy", label: "test-comets", dropped: `act:${dropAct.id}`, stamps: 1, by: "sbx-cy", at: { x: 5, y: 6 } });
  assert.deepEqual(opts, { dropUnit: { actId: dropAct.id, label: "test-comets" } });
  assert.equal(totalOf(w.fold(), "sbx-cy"), 1);
  await assert.rejects(callUnits("drop", { label: "test-comets", count: 2 }, KEY, "sbx-cy", w.deps), /one at a time/);
});

test("drop: when the mark cannot be filed the unit comes back, and both acts stand", async () => {
  const w = world();
  w.seed(UNIT_ACTION.give, [{ from: null, to: "sbx-cy", label: "test-comets", n: 1 }]);
  w.failLeave("the mark pass tripped");
  await assert.rejects(callUnits("drop", { label: "test-comets" }, KEY, "sbx-cy", w.deps), (e) => /back in your hands/.test(e.hint));
  assert.deepEqual(w.acts.map((a) => a.action).slice(-2), [UNIT_ACTION.drop, UNIT_ACTION.dropUndone]);
  assert.equal(totalOf(w.fold(), "sbx-cy"), 1);
});

const UNIT_MARK = "sbx-bo/test-comets-41";
const unitMark = { id: UNIT_MARK, by: "sbx-bo", class: "candy", kind: "sited", label: "test-comets", dropped: "act:41" };
const STAKES = { [UNIT_MARK]: [{ handle: "sbx-bo", stamps: 1 }, { handle: "sbx-ana", stamps: 3 }, { handle: "sbx-eve", stamps: 2 }] };

for (const route of ["take-back", "consume-in-place"]) {
  test(`${route}: the escrow and every stake return once, one receipt each, and a retry returns nothing more`, async () => {
    const w = world({ marks: { [UNIT_MARK]: unitMark }, holders: STAKES });
    const r1 = await callUnits(route, { thing: UNIT_MARK, ...(route === "consume-in-place" ? { act: "consume" } : {}) }, KEY, "sbx-cy", w.deps);
    assert.deepEqual(r1.returns.map((r) => [r.handle, r.stamps]), [["sbx-ana", 3], ["sbx-bo", 1], ["sbx-eve", 2]]);
    assert.equal(w.ledger.length, 3, "one line per actual staker");
    assert.ok(w.ledger.every((l) => l.includes(`stake:world-mark/${UNIT_MARK}`)));
    assert.equal(w.withdrawn.length, 1);
    const { cause, ...asked } = w.withdrawn[0];
    assert.deepEqual(asked, { by: "sbx-bo", slug: "test-comets-41", household: "hh:sbx-bo" });
    // the record says whose act made the author's mark leave (not the author)
    assert.deepEqual([cause.exit, cause.by, typeof cause.act], [route, "sbx-cy", "number"]);
    const r2 = await callUnits(route, { thing: UNIT_MARK }, KEY, "sbx-cy", w.deps);
    assert.equal(r2.duplicate, true);
    assert.equal(w.ledger.length, 3, "no second return");
    assert.equal(w.acts.filter((a) => a.action.endsWith(route)).length, 1, "the exit is recorded once");
    assert.equal(totalOf(w.fold(), "sbx-cy"), route === "take-back" ? 1 : 0);
  });
}

test("a return that fails halfway is finished by the retry — never doubled", async () => {
  const w = world({ marks: { [UNIT_MARK]: unitMark }, holders: STAKES });
  const real = w.deps.unstake;
  let calls = 0;
  w.deps.unstake = async (r) => (++calls === 2 ? { error: "bounce", defect: "ledger busy" } : real(r));
  await assert.rejects(callUnits("take-back", { thing: UNIT_MARK }, KEY, "sbx-cy", w.deps), (e) => e.code === 503 && e.returned.length === 1);
  assert.equal(w.acts.length, 0, "no exit act before every return is made");
  w.deps.unstake = real;
  const r = await callUnits("take-back", { thing: UNIT_MARK }, KEY, "sbx-cy", w.deps);
  assert.deepEqual(r.returns.map((x) => x.handle), ["sbx-bo", "sbx-eve"], "only the positions still open");
  assert.equal(w.ledger.length, 3);
});

test("the taken-class hook at the door: refuses with the clue, inactive otherwise, restored allows", async () => {
  const classes = structuredClone(CLASSES);
  classes.candy.dials = { taken: true, clue: "The sweet jars are empty; follow the wrappers." };
  const w = world({ classes, marks: { [CHEST]: chestMark() } });
  w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 30 }], CHEST);
  await assert.rejects(callUnits("take", { from: CHEST }, KEY, "sbx-cy", w.deps), (e) => e.code === 423 && e.defect === "The sweet jars are empty; follow the wrappers.");
  assert.equal(w.acts.length, 1);
  classes.candy.dials = {};
  const ok = await callUnits("take", { from: CHEST }, KEY, "sbx-cy", w.deps);
  assert.equal(ok.count, 1);
});

test("consume refuses a non-consumable label; take refuses a mark that is not a chest; an unreadable class layer refuses", async () => {
  const w = world({ marks: { "sbx-ana/toaster": { id: "sbx-ana/toaster", class: "thing" } } });
  w.seed(UNIT_ACTION.give, [{ from: null, to: "sbx-cy", label: "not-a-candy", n: 1 }]);
  await assert.rejects(callUnits("consume", { label: "not-a-candy" }, KEY, "sbx-cy", w.deps), /not a consumable/);
  await assert.rejects(callUnits("take", { from: "sbx-ana/toaster" }, KEY, "sbx-cy", w.deps), /is not a chest/);
  const dark = world({ classes: {} });
  await assert.rejects(callUnits("consume", {}, KEY, "sbx-cy", dark.deps), (e) => e.code === 503);
});

test("routing: which act a call is, read off its arguments", () => {
  assert.equal(unitRouteOf({ from: CHEST }), "take");
  assert.equal(unitRouteOf({ to: "sbx-ana", label: "x" }), "give");
  assert.equal(unitRouteOf({ to: CHEST }), "give");
  assert.equal(unitRouteOf({ label: "x" }), "drop");
  assert.equal(unitRouteOf({ act: "consume" }), "consume");
  assert.equal(unitRouteOf({ act: "consume", thing: UNIT_MARK }), "consume-in-place");
  assert.equal(unitRouteOf({ act: "refill", chest: CHEST }), "refill");
  assert.equal(unitRouteOf({ thing: UNIT_MARK }, { thingMark: unitMark }), "take-back");
  assert.equal(unitRouteOf({ thing: "wright/a-stool" }, { thingMark: { class: "thing" } }), null, "a thing is the thing door's");
  assert.equal(unitRouteOf({ thing: "wright/a-stool", to: "sbx-ana" }), null);
  assert.throws(() => unitRouteOf({ act: "eat" }), /consume or refill/);
});

// ── the reads: the card's and doorstep's block, and the map's chests ────────
import { chestsRead, residentHolds } from "../src/world-units.mjs";

function readDeps({ units = [], attachments = [], marks = [], classes = CLASSES } = {}) {
  return { classes: () => classViewOf(snapOf(classes)), units: async () => units, attachments: async () => attachments, marks: async () => marks };
}
const u = (action, moves, object = null) => ({ class: "holding", action, object, payload: { units: true, moves } });

test("the map's chests: label and live count from the fold; a carried chest is on its holder, not a pip", async () => {
  const marks = [chestMark({ id: CHEST, at: { x: 1, y: 2 } }), chestMark({ id: "sbx-bo/tin", by: "sbx-bo" }), { id: "sbx-ana/stool", class: "thing" }];
  const units = [u(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 30 }], CHEST),
    u(UNIT_ACTION.take, [{ from: CHEST, to: "sbx-cy", label: "test-comets", n: 12 }], CHEST)];
  const r = await chestsRead(readDeps({ units, marks, attachments: [{ entity: "sbx-cy", target: "sbx-bo/tin", policy: "cascade" }] }));
  assert.equal(r.count, 2, "chests only");
  const bowl = r.chests.find((c) => c.chest === CHEST);
  assert.deepEqual([bowl.shows, bowl.count, bowl.capacity, bowl.at], ["Test Comets: 18", 18, 30, { x: 1, y: 2 }]);
  const tin = r.chests.find((c) => c.chest === "sbx-bo/tin");
  assert.equal(tin.held_by, "sbx-cy");
  assert.equal(tin.shows, "empty");
  assert.equal(tin.empty_because, undefined, "sbx-bo has a label: an empty chest of theirs is just empty");
});

test("the card's block: a holding shows on its holder; an absent one is absent; an unlabelled maker's empty chest says why", async () => {
  const marks = [chestMark({ id: "sbx-eve/her-chest", by: "sbx-eve" })];
  const units = [u(UNIT_ACTION.give, [{ from: null, to: "sbx-cy", label: "test-comets", n: 2 }])];
  const cy = await residentHolds("sbx-cy", readDeps({ units, marks }));
  assert.deepEqual([cy.holds.count, cy.holds.shows, cy.chests.length], [2, "Test Comets: 2", 0]);
  const dee = await residentHolds("sbx-dee", readDeps({ units, marks }));
  assert.equal(dee.holds.count, 0);
  const eve = await residentHolds("sbx-eve", readDeps({ units, marks }));
  assert.match(eve.chests[0].empty_because, /no candy was registered for sbx-eve/);
  const ana = await residentHolds("sbx-ana", readDeps({ units, marks }));
  assert.deepEqual(ana.label, { label: "test-comets", name: "Test Comets", creator: "sbx-ana" });
});
