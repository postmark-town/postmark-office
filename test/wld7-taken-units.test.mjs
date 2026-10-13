// wld7-taken-units.test.mjs — WLD-7 on the counted-unit door: the taken-class
// hook WLD-27 built is asked of the law the HOLD TURN reads, not the law the
// call came in on, and every route it guards moves nothing while candy is taken.
//
// `callUnits` (src/world-units.mjs) with an in-memory record, stake ledger and
// leave/withdraw injected — as world-units.test.mjs drives it — EXCEPT the class
// layer, which is the office's live one: `classViewOf(lawSnapshot())`, the law
// published through `reloadLawSnapshot` from synthetic rows. So "taken" and
// "returned" here are new snapshots published the office's own way.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { callUnits, classViewOf } from "../src/world-units.mjs";
import { UNIT_ACTION, foldUnits, totalOf } from "../src/world-stacks.mjs";
import { holdTurn } from "../src/world-hold.mjs";
import { reloadLawSnapshot, resetLawSnapshot, lawSnapshot, PIN_SQL } from "../src/law-snapshot.mjs";

after(() => resetLawSnapshot());

const LABELS = [{ label: "test-comets", name: "Test Comets", creator: "sbx-ana" }];
const LAW = () => ({
  "postmark-node": { dials: {} },
  mark: { extends: "postmark-node", dials: {} },
  thing: { extends: "mark", dials: { carry_cap: 24 } },
  consumable: { extends: "thing", dials: {} },
  candy: { extends: "consumable", dials: {}, labels: LABELS },
  chest: { extends: "thing", dials: { capacity: 30, capacity_min: 1, capacity_max: 120, first_stock: 30, portable: true, welcome: "open" } },
});
const CLUE = "Test clue: the sweet jars are empty; follow the wrappers.";
const TAKEN = () => { const l = LAW(); l.candy.dials = { taken: true, clue: CLUE }; return l; };
let blessing = 0;
async function publish(classes) {
  const n = ++blessing;
  const query = async (sql) => (sql === PIN_SQL
    ? { rows: [{ newest: n, pinned: n }] }
    : { rows: Object.entries(classes).map(([key, data]) => ({ number: n, tag_sha: `${n}cafe`, newest: n, kind: "class", key, data: structuredClone(data) })) });
  assert.equal((await reloadLawSnapshot({ query })).changed, true);
}

const CHEST = "sbx-ana/the-bowl";
const UNIT_MARK = "sbx-bo/test-comets-41";
const KEY = { handles: new Set(["sbx-cy"]) };
function world({ marks = {}, holders = {}, things = [] } = {}) {
  const acts = [], ledger = [], left = [], withdrawn = [];
  const positions = structuredClone(holders);
  const deps = {
    classes: () => classViewOf(lawSnapshot()),          // ← the office's live class layer
    readRows: async () => ({ units: acts.filter((a) => a.payload?.units), attachments: things }),
    markById: async (id) => marks[id] ?? null,
    reachTake: async () => ({ reach: { stands: true } }),
    reachGive: async () => ({ stands: true }),
    standpoint: async () => ({ x: 5, y: 6 }),
    householdOf: (h) => ({ key: `hh:${h}`, house: `hh:${h}` }),
    append: async (entry) => { const id = acts.length + 100; acts.push({ id, class: entry.cls, action: entry.action, object: entry.object, actor: entry.actor, payload: entry.payload }); return { actId: id }; },
    stamp: async () => ({ at: { anchor: "x" }, witnesses: [] }),
    crossing: () => 250,
    household: () => "hh:test",
    leave: async (payload, key, opts) => { left.push({ payload, opts }); return { id: `${payload.by}/${payload.slug}`, put_forward: true }; },
    holders: async (mark) => (positions[mark] ?? []).filter((h) => h.stamps > 0),
    unstake: async (r) => {
      const open = (positions[r.mark] ?? []).find((h) => h.handle === r.handle);
      const n = Math.min(open?.stamps ?? 0, r.stamps);
      if (open) open.stamps -= n;
      if (n > 0) ledger.push(`${r.handle} ← ${r.mark} · ${n}`);
      return { applied: n };
    },
    withdraw: async (m) => { withdrawn.push(m); return { withdrawn: true }; },
  };
  const seed = (action, moves, object = null) => acts.push({ id: acts.length + 100, class: "holding", action, object, payload: { units: true, moves } });
  const census = () => JSON.stringify({ acts: acts.length, ledger, left: left.length, withdrawn: withdrawn.length, positions });
  return { deps, acts, ledger, left, withdrawn, seed, census, fold: () => foldUnits(acts) };
}
const run = (route, args, w, actor = "sbx-cy", key = KEY) => callUnits(route, args, key, actor, w.deps).then((r) => ({ r }), (e) => ({ e }));
const refusedTaken = (out) => {
  assert.equal(out.r, undefined, `admitted: ${JSON.stringify(out.r)}`);
  assert.equal(out.e.code, 423, `${out.e.code} ${out.e.defect}`);
  assert.equal(out.e.defect, CLUE);
  assert.equal(out.e.taken, "candy");
};
function shutTheQueue() {
  let open;
  const blocker = holdTurn(() => new Promise((r) => { open = r; }));
  return async () => { open(); await blocker; };
}
const settle = () => new Promise((r) => setTimeout(r, 50));

test("QUEUED, THEN TAKEN: a unit take that came in under an untaken law and waits in the queue is refused in its turn by the newly published taken law", async () => {
  await publish(LAW());
  const w = world({ marks: { [CHEST]: { id: CHEST, by: "sbx-ana", class: "chest" } } });
  w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 30 }], CHEST);
  const before = w.census();
  const release = shutTheQueue();
  const pending = run("take", { from: CHEST, count: 2 }, w);
  await settle();
  await publish(TAKEN());
  await release();
  refusedTaken(await pending);
  assert.equal(w.census(), before, "nothing written");
  assert.equal(totalOf(w.fold(), CHEST), 30);
});

test("QUEUED, THEN RETURNED: a unit give that came in while candy was taken goes through once the class is returned before its turn", async () => {
  await publish(TAKEN());
  const w = world();
  w.seed(UNIT_ACTION.give, [{ from: null, to: "sbx-cy", label: "test-comets", n: 3 }]);
  const release = shutTheQueue();
  const pending = run("give", { to: "sbx-dee", label: "test-comets", count: 2 }, w);
  await settle();
  await publish(LAW());
  await release();
  const out = await pending;
  assert.equal(out.r?.did, "give", JSON.stringify(out.e ?? out.r));
  assert.deepEqual([totalOf(w.fold(), "sbx-cy"), totalOf(w.fold(), "sbx-dee")], [1, 2]);
});

test("EVERY UNIT ROUTE refuses while candy is taken, writes nothing, and the same holding moves again once returned", async () => {
  const w = world({ marks: { [CHEST]: { id: CHEST, by: "sbx-ana", class: "chest" } } });
  w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 20 }], CHEST);
  w.seed(UNIT_ACTION.give, [{ from: null, to: "sbx-cy", label: "test-comets", n: 4 }]);
  await publish(TAKEN());
  const before = w.census();
  refusedTaken(await run("take", { from: CHEST }, w));
  refusedTaken(await run("give", { to: "sbx-dee", label: "test-comets" }, w));
  refusedTaken(await run("give", { to: CHEST, label: "test-comets" }, w));
  refusedTaken(await run("drop", { label: "test-comets" }, w));
  refusedTaken(await run("consume", {}, w));
  refusedTaken(await run("refill", { chest: CHEST }, w, "sbx-ana", { handles: new Set(["sbx-ana"]) }));
  assert.equal(w.census(), before, "no unit act, no filing, no ledger line");
  assert.deepEqual([totalOf(w.fold(), CHEST), totalOf(w.fold(), "sbx-cy")], [20, 4], "and the counts read as they did");
  await publish(LAW());
  assert.equal((await run("take", { from: CHEST }, w)).r?.count, 1);
  assert.equal((await run("drop", { label: "test-comets" }, w)).r?.did, "drop");
  assert.deepEqual([totalOf(w.fold(), CHEST), totalOf(w.fold(), "sbx-cy")], [19, 4], "the same units, no recreation");
});

test("A SET-DOWN CANDY: take-back and consume-in-place refuse while taken — no stake returned, no exit act, no withdrawal — and work once returned", async () => {
  const unitMark = { id: UNIT_MARK, by: "sbx-bo", class: "candy", kind: "sited", label: "test-comets", dropped: "act:41" };
  const w = world({ marks: { [UNIT_MARK]: unitMark }, holders: { [UNIT_MARK]: [{ handle: "sbx-bo", stamps: 1 }, { handle: "sbx-ana", stamps: 2 }] } });
  await publish(TAKEN());
  const before = w.census();
  refusedTaken(await run("take-back", { thing: UNIT_MARK }, w));
  refusedTaken(await run("consume-in-place", { thing: UNIT_MARK, act: "consume" }, w));
  assert.equal(w.census(), before, "nobody's position on the mark moved, and it did not leave");
  await publish(LAW());
  const back = await run("take-back", { thing: UNIT_MARK }, w);
  assert.equal(back.r?.did, "take-back", JSON.stringify(back.e ?? back.r));
  assert.equal(w.ledger.length, 2);
  assert.equal(totalOf(w.fold(), "sbx-cy"), 1);
});

test("A CHEST'S WHOLE THINGS: a candy thing neither goes in nor comes out while taken; the toaster beside it does; the chest's own units stay blocked", async () => {
  const CANDY_BAR = "sbx-ana/test-bar", TOASTER = "sbx-ana/test-toaster";
  const things = [
    { entity: CHEST, target: CANDY_BAR, policy: "cascade", born_at: "2026-10-13T00:00:00.000Z" },
    { entity: CHEST, target: TOASTER, policy: "cascade", born_at: "2026-10-13T00:00:00.000Z" },
    { entity: "sbx-cy", target: "sbx-cy/test-bar-2", policy: "cascade", born_at: "2026-10-13T00:00:00.000Z" },
  ];
  const marks = { [CHEST]: { id: CHEST, by: "sbx-ana", class: "chest" }, [CANDY_BAR]: { id: CANDY_BAR, by: "sbx-ana", class: "candy" },
    [TOASTER]: { id: TOASTER, by: "sbx-ana", class: "thing" }, "sbx-cy/test-bar-2": { id: "sbx-cy/test-bar-2", by: "sbx-cy", class: "candy" } };
  const w = world({ marks, things });
  w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 5 }], CHEST);
  await publish(TAKEN());
  const before = w.census();
  refusedTaken(await run("thing-from-chest", { thing: CANDY_BAR, from: CHEST }, w));
  refusedTaken(await run("thing-into-chest", { thing: "sbx-cy/test-bar-2", to: CHEST }, w));
  refusedTaken(await run("take", { from: CHEST, label: "test-comets" }, w));
  assert.equal(w.census(), before);
  const toaster = await run("thing-from-chest", { thing: TOASTER, from: CHEST }, w);
  assert.equal(toaster.r?.did, "take", JSON.stringify(toaster.e ?? toaster.r));
});

test("THE OTHER GATES FIRST: a closed chest and a thing you do not hold keep their own refusals while candy is taken", async () => {
  const marks = { [CHEST]: { id: CHEST, by: "sbx-ana", class: "chest", welcome: "closed" }, "sbx-ana/test-bar": { id: "sbx-ana/test-bar", by: "sbx-ana", class: "candy" } };
  const w = world({ marks, things: [{ entity: "sbx-dee", target: "sbx-ana/test-bar", policy: "cascade", born_at: "2026-10-13T00:00:00.000Z" }] });
  w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 5 }], CHEST);
  await publish(TAKEN());
  const closed = await run("take", { from: CHEST }, w);
  assert.equal(closed.e?.code, 403, JSON.stringify(closed.e));
  const unheld = await run("thing-into-chest", { thing: "sbx-ana/test-bar", to: CHEST }, w);
  assert.equal(unheld.e?.code, 409);
  assert.match(unheld.e.defect, /you are not holding/);
});

const unknownClass = (out) => {
  assert.equal(out.r, undefined, `admitted: ${JSON.stringify(out.r)}`);
  assert.equal(out.e.code, 503, `${out.e.code} ${out.e.defect}`);
  assert.equal(out.e.reason, "taken-class-unknown");
  assert.match(out.e.defect, /can't tell whether .* is of a taken class right now/);
  assert.match(out.e.hint, /Nothing was recorded — try again/);
};

// Bevel's first review, R1 (direct route; credited): a thing canon does not hold
// is not a `thing` by default when it comes out of a chest.
test("R1 · A WHOLE THING CANON DOES NOT HOLD, OUT OF A CHEST: refused by name while candy is taken; moves on an ordinary day", async () => {
  const UNKNOWN = "sbx-ana/no-canon-candy";
  const mk = () => world({ marks: { [CHEST]: { id: CHEST, by: "sbx-ana", class: "chest" } },
    things: [{ entity: CHEST, target: UNKNOWN, policy: "cascade", born_at: "2026-10-13T00:00:00.000Z" }] });
  await publish(TAKEN());
  const w = mk();
  const before = w.census();
  unknownClass(await run("thing-from-chest", { thing: UNKNOWN, from: CHEST }, w));
  assert.equal(w.census(), before, "no holding act for an unclassified thing");
  await publish(LAW());
  const ok = await run("thing-from-chest", { thing: UNKNOWN, from: CHEST }, mk());
  assert.equal(ok.r?.did, "take", JSON.stringify(ok.e ?? ok.r));
});

// Bevel's first review, R2 (direct route; credited): the selected label is judged,
// never the chest's aggregate display class.
test("R2 · A MIXED CHEST: selected candy refuses with the clue, a label the law does not register refuses by name, while taken; both move on an ordinary day", async () => {
  const mk = () => {
    const w = world({ marks: { [CHEST]: { id: CHEST, by: "sbx-ana", class: "chest" } } });
    w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "retired-label", n: 1 }], CHEST);
    w.seed(UNIT_ACTION.stock, [{ from: null, to: CHEST, label: "test-comets", n: 2 }], CHEST);
    return w;
  };
  await publish(TAKEN());
  const w = mk();
  const before = w.census();
  refusedTaken(await run("take", { from: CHEST, label: "test-comets", count: 1 }, w));
  unknownClass(await run("take", { from: CHEST, label: "retired-label", count: 1 }, w));
  assert.equal(w.census(), before);
  await publish(LAW());
  const day = mk();
  assert.equal((await run("take", { from: CHEST, label: "test-comets", count: 1 }, day)).r?.count, 1);
  assert.equal((await run("take", { from: CHEST, label: "retired-label", count: 1 }, day)).r?.count, 1);
});

test("SELECTED LABEL ON EVERY UNIT ROUTE: holding an unregistered label beside candy does not hide the candy, and the unregistered label is refused by name, while taken", async () => {
  await publish(TAKEN());
  const w = world({ marks: { [CHEST]: { id: CHEST, by: "sbx-ana", class: "chest" } } });
  w.seed(UNIT_ACTION.give, [{ from: null, to: "sbx-cy", label: "retired-label", n: 2 }]);
  w.seed(UNIT_ACTION.give, [{ from: null, to: "sbx-cy", label: "test-comets", n: 2 }]);
  const before = w.census();
  refusedTaken(await run("give", { to: "sbx-dee", label: "test-comets" }, w));
  refusedTaken(await run("give", { to: CHEST, label: "test-comets" }, w));
  refusedTaken(await run("drop", { label: "test-comets" }, w));
  refusedTaken(await run("consume", { label: "test-comets" }, w));
  unknownClass(await run("give", { to: "sbx-dee", label: "retired-label" }, w));
  unknownClass(await run("drop", { label: "retired-label" }, w));
  assert.equal(w.census(), before);
});

test("HELPER-LEVEL (no door): the one taken question — inert while nothing is taken; unknown, a class the law lacks, or a missing ancestor refused by name while something is", async () => {
  const { takenClassRefusal, markClassFor } = await import("../src/world-units.mjs");
  assert.deepEqual([markClassFor({ class: "candy" }), markClassFor({}), markClassFor(null), markClassFor(undefined)], ["candy", null, undefined, undefined]);
  const floor = classViewOf(null);
  assert.equal(floor.readable, false);
  for (const k of ["candy", "ghost", null, undefined]) assert.equal(takenClassRefusal(k, floor, "x/y"), null, `no law loaded: inert (${k})`);
  const law = { ...LAW(), wobbly: { extends: "nowhere", dials: {} }, ghostly: { extends: "thing", dials: {} } };
  await publish(law);
  const day = classViewOf(lawSnapshot());
  assert.equal(day.takenAny(), false);
  for (const k of ["candy", "ghost", "wobbly", null, undefined]) assert.equal(takenClassRefusal(k, day, "x/y"), null, `nothing taken: inert (${k})`);
  law.candy.dials = { taken: true, clue: CLUE };
  await publish(law);
  const heist = classViewOf(lawSnapshot());
  assert.equal(heist.takenAny(), true);
  assert.equal(takenClassRefusal("candy", heist, "x/bar")?.code, 423);
  for (const [k, why] of [[undefined, "no mark / canon unread / unregistered label"], ["ghost", "a class the law does not hold"], ["wobbly", "an ancestor the law does not hold"]])
    assert.equal(takenClassRefusal(k, heist, "x/y")?.reason, "taken-class-unknown", why);
  for (const k of [null, "thing", "chest", "ghostly"]) assert.equal(takenClassRefusal(k, heist, "x/y"), null, `proven not candy: ${k}`);
});
