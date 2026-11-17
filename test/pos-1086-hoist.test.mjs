// pos-1086-hoist.test.mjs — the town-wide work of a doorstep is done once per key, never once per resident (POS-1086).
//
// The site's refresh composes every resident's doorstep at the same town head and the same world. Four pieces were
// recomputed per resident though the answer is the same for all of them. Three are hoisted (src/hoist.mjs; their keys
// are argued where each is kept) and one is not:
//
//   bulletin listing   town-index-store.mjs § bulletinListingsKept   key: the rows it folds, compared value for value
//   mail pulse         town-index-store.mjs § metricsPulseKept       key: the rows it folds, compared value for value
//   ideas tank         world-classes.mjs § ideasTank                 key: the published world snapshot's `tables` object
//   stance inbox       NOT HOISTED: it is per HOUSEHOLD (the ground is the caller's own marks), and its inputs
//                      (the live claims, the acts register, the drained photographs, the versions) have no cheap print.
//
// PER HOIST, as the lane was briefed: byte equality (a doorstep composed on a kept value is byte-identical to one composed on
// a forgotten cache), a falsifier per input (change it, compose again WITHOUT forgetting: the answer moved, so the kept value
// was not served stale), and reuse (two doorsteps under one key fold once).
//
//   node --test test/pos-1086-hoist.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { fixtureTown, put, drop } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { publishWorldGraphForTest, resetWorldGraph, worldGraphSnapshot } from "../src/world-graph-snapshot.mjs";
import { doorstepBundle } from "../src/doorstep-bundle.mjs";
import { deepFreeze } from "../src/hoist.mjs";
import { ideasTank, __forgetIdeasTankForTest, __ideasTankBuildsForTest } from "../src/world-classes.mjs";

delete process.env.TOWN_PUSH;
const town = fixtureTown();
const IX = await indexStore(town, { db: "pos1086_hoist" });
const RESTORE = await IX.useInProcess();
test.after(async () => { await RESTORE(); await IX.stop(); });
const tis = await import("../src/town-index-store.mjs");

const NOW = Date.parse("2026-07-12T09:30:00Z");
const compose = (handle) => doorstepBundle(handle, { key: null, asOf: undefined, canWrite: false, clone: null, odb: null, ix: tis.storeIndexPooled(null), nowMs: NOW });
const bytes = async (handle) => JSON.stringify(await compose(handle));
const forgetAll = () => { tis.__forgetDoorstepHoistsForTest(); __forgetIdeasTankForTest(); };
/** The doorstep as a cold office composes it: nothing kept. */
const cold = async (handle) => { forgetAll(); return bytes(handle); };
const builds = () => tis.__doorstepHoistBuildsForTest();

const HANDLES = ["wright", "limen"];
const bulletinOf = (d) => d.bulletin.entries;
const pulseOf = (d) => d.town_pulse;

/** Change the fixture town, put the store on it, and say what the doorstep reads after: warm (the kept values stand) and cold (forgotten). */
async function changed(edit, handle = "wright") {
  edit(town);
  await IX.reseed();
  const warm = JSON.parse(await bytes(handle));
  const fresh = JSON.parse(await cold(handle));
  assert.deepEqual(warm, fresh, "a doorstep on the kept values is the doorstep a cold office composes");
  return fresh;
}

// ═══════════════════════════════════════════════════════════════════════════
// the bulletin's listing
// ═══════════════════════════════════════════════════════════════════════════

test("BULLETIN · a doorstep composed on the kept listing is byte-identical to one composed cold (two residents)", async () => {
  for (const h of HANDLES) {
    const base = await cold(h);
    assert.ok(base.includes('"first_line":"Welcome to the town."'), "the fixture's posting is on the page, or this proves nothing");
    assert.equal(await bytes(h), base, `${h}: second read, served from the kept listing`);
  }
  // FLIP: in town-index-store.mjs § bulletinListingsKept, return `bulletinKept.listings` without the row comparison (drop the `.every(...)` clause): the falsifiers below redden.
});

test("BULLETIN · reuse: two doorsteps under one key fold the listing once", async () => {
  forgetAll();
  await compose("wright");
  await compose("limen");
  await compose("wright");
  assert.equal(builds().bulletin, 1, "one fold for three doorsteps");
  // FLIP: in bulletinListingsKept, delete the `return bulletinKept.listings` line (always fold): builds().bulletin becomes 3.
});

test("BULLETIN · falsifier per input: a posting's json edited in place (same slug, same count, same length) is read, not served stale", async () => {
  const before = bulletinOf(await compose("wright"));
  const after = bulletinOf(await changed((t) => put(t, "bulletin", { slug: "settling-in", json: JSON.stringify({
    slug: "settling-in", data: { title: "settling-in", posted: "2026-06-12", kind: "guidance" }, body: "# Settling in\n\nWelcome to the towm." }) })));
  assert.equal(before.length, after.length);
  assert.equal(before[0].first_line, "Welcome to the town.");
  assert.equal(after[0].first_line, "Welcome to the towm.");
  // FLIP: compare only the slugs in bulletinListingsKept's key (drop `k[1] === flat[i][1]`): this goes red, as a count-and-slug print would have missed it.
});

test("BULLETIN · falsifier per input: a posting added, then a posting deleted", async () => {
  const added = bulletinOf(await changed((t) => put(t, "bulletin", { slug: "second-notice", json: JSON.stringify({
    slug: "second-notice", data: { title: "second-notice", posted: "2026-07-01", kind: "guidance" }, body: "# Second\n\nAnother notice." }) })));
  assert.deepEqual(added.map((e) => e.slug), ["second-notice", "settling-in"], "newest posted first");
  const deleted = bulletinOf(await changed((t) => drop(t, "bulletin", (r) => r.slug === "second-notice")));
  assert.deepEqual(deleted.map((e) => e.slug), ["settling-in"]);
  // FLIP: in bulletinListingsKept, drop the `bulletinKept.rows.length === flat.length` clause and walk `flat` (not the kept rows) in the comparison: the deleted posting is served from the kept list.
});

test("BULLETIN · the kept listing is handed out frozen: a caller cannot change the next caller's page", async () => {
  forgetAll();
  const d = await compose("wright");
  assert.ok(Object.isFrozen(bulletinOf(d)[0]), "an entry is frozen");
  const line = bulletinOf(d)[0].first_line;
  assert.throws(() => { bulletinOf(d)[0].first_line = "tampered"; }, TypeError);
  assert.equal(bulletinOf(await compose("limen"))[0].first_line, line, "the next caller's page is the kept one, untouched");
  // FLIP: in bulletinListingsKept, drop the `deepFreeze(...)` around the fold: the isFrozen assertion goes red.
});

// ═══════════════════════════════════════════════════════════════════════════
// the mail pulse
// ═══════════════════════════════════════════════════════════════════════════

test("PULSE · a doorstep composed on the kept pulse is byte-identical to one composed cold (two residents)", async () => {
  for (const h of HANDLES) {
    const base = await cold(h);
    assert.equal(pulseOf(JSON.parse(base)).active_threads, 1, "the fixture's pulse is on the page");
    assert.equal(await bytes(h), base, `${h}: second read, served from the kept pulse`);
  }
  // FLIP: in town-index-store.mjs § metricsPulseKept, return `k.value` unconditionally when `k` exists: the falsifiers below redden.
});

test("PULSE · reuse: two doorsteps under one key fold the pulse once", async () => {
  forgetAll();
  await compose("wright");
  await compose("limen");
  assert.equal(builds().pulse, 1);
  // FLIP: in metricsPulseKept, delete the `return k.value` line (always fold): builds().pulse becomes 2.
});

test("PULSE · falsifier per input: a thread's json edited in place (same root, same count) moves active_threads", async () => {
  assert.equal(pulseOf(await changed(() => {})).active_threads, 1);
  const after = pulseOf(await changed((t) => put(t, "threads", { root: "limen-2026-07-01-to-wright-the-gap", json: JSON.stringify({
    letters: [{ id: "limen-2026-07-01-to-wright-the-gap", from: "limen", to: "wright", date: "2026-05-01" }] }) })));
  assert.equal(after.active_threads, 0, "the thread went quiet: no count, date or total moved, only its json");
  // FLIP: compare only `k.threads.length` in metricsPulseKept (drop `sameScalars(k.threads, pulse.threadJsons)`): this goes red.
});

test("PULSE · falsifier per input: a ledger day's counts (a delivery added on a day already counted; a bounce deleted)", async () => {
  const day = (p, d) => p.days.find((x) => x.date === d);
  const before = day(pulseOf(await changed(() => {})), "2026-07-03");
  assert.equal(before.deliveries, 1);
  const added = pulseOf(await changed((t) => put(t, "ledger", { kind: "delivery", date: "2026-07-03", id: "extra-2026-07-03", from_h: "wright", to_h: "limen", json: "{}" })));
  assert.equal(day(added, "2026-07-03").deliveries, 2);
  assert.equal(added.totals.deliveries, 4, "and the total moved with it");
  const gone = pulseOf(await changed((t) => drop(t, "ledger", (r) => r.kind === "bounce")));
  assert.equal(day(gone, "2026-07-02").bounces, 0);
  // a delivery re-dated to another day: no total moves, and the newest day stays 2026-07-03; only the day series does
  const total = (p) => JSON.stringify([p.totals, p.as_of, p.active_threads]);
  const was = pulseOf(await changed(() => {}));
  assert.equal(day(was, "2026-07-03").deliveries, 2, "the delivery added above stands on 07-03");
  const moved = pulseOf(await changed((t) => {
    drop(t, "ledger", (r) => r.id === "extra-2026-07-03");
    put(t, "ledger", { kind: "delivery", date: "2026-07-02", id: "extra-2026-07-03", from_h: "wright", to_h: "limen", json: "{}" });
  }));
  assert.equal(total(moved), total(was), "nothing but the series moved");
  assert.equal(moved.days.length, was.days.length);
  assert.equal(day(moved, "2026-07-03").deliveries, 1);
  assert.equal(day(moved, "2026-07-02").deliveries, 2);
  // FLIP: in metricsPulseKept, drop the `k.days.every(...)` clause: the re-dated delivery is served stale (the totals and newest day did not move).
});

test("PULSE · falsifier per input: the newest ledger day moves the window and `as_of`", async () => {
  const moved = pulseOf(await changed((t) => put(t, "ledger", { kind: "delivery", date: "2026-07-09", id: "later-2026-07-09", from_h: "wright", to_h: "limen", json: "{}" })));
  assert.equal(moved.as_of, "2026-07-09");
  assert.equal(moved.days.at(-1).date, "2026-07-09");
  // FLIP: in metricsPulseKept, drop `k.newest === pulse.newest` together with `k.days.every(...)` and `sameScalars(k.totals, totals)` (the new row also moves the day series and the total, so each alone is covered by the others): this goes red.
});

test("PULSE · falsifier per input: the roll's totals (a resident added, a letter added) with no ledger row moved", async () => {
  const base = pulseOf(await changed(() => {}));
  const residents = pulseOf(await changed((t) => put(t, "residents", { handle: "errant", json: JSON.stringify({ handle: "errant", name: "Errant", joined: "2026-07-01" }) })));
  assert.equal(residents.totals.residents, base.totals.residents + 1);
  const letters = pulseOf(await changed((t) => put(t, "letters", { id: "errant-2026-07-06-to-wright-hello", from_h: "errant", to_h: "wright", date: "2026-07-06", thread: null, box: "inbox",
    owner: "wright", path: "WHITE_PAGES/wright/inbox/y.md", json: JSON.stringify({ id: "errant-2026-07-06-to-wright-hello", from: "errant", to: "wright", date: "2026-07-06", box: "inbox", body: "hi" }), delivered_at: "2026-07-06T08:00:00.000Z" })));
  assert.equal(letters.totals.letters, base.totals.letters + 1);
  // FLIP: in metricsPulseKept, drop `sameScalars(k.totals, totals)`: the totals are served stale.
});

test("PULSE · the kept pulse is handed out frozen", async () => {
  forgetAll();
  const d = await compose("wright");
  assert.ok(Object.isFrozen(pulseOf(d).days) && Object.isFrozen(pulseOf(d).totals));
  assert.throws(() => { pulseOf(d).days.push({}); }, TypeError);
  // FLIP: in metricsPulseKept, drop the `deepFreeze(...)` around the fold.
});

// ═══════════════════════════════════════════════════════════════════════════
// the ideas tank
// ═══════════════════════════════════════════════════════════════════════════

const DECL = "the-town/idea";
const TANK = "the-town/the-think-tank";
/** A world snapshot's tables carrying these ideas, each `{ id, by, body, date }`, in the shape world-graph-db.mjs reads. */
function worldWith(ideas, { body = "an idea is a resident's ask of the town" } = {}) {
  const nodes = [
    { id: DECL, kind: "mark", subkind: "class", tier: "constitution", by: "the-town", props: JSON.stringify({ class: "idea", in_works: 1, body }) },
    { id: TANK, kind: "mark", tier: "constitution", by: "the-town", props: "{}" },
    ...ideas.map((i) => ({ id: i.id, kind: "mark", subkind: "sited", tier: "market", by: i.by, props: JSON.stringify({ class: "idea", body: i.body ?? "a thought", date: i.date ?? "2026-09-01" }) })),
  ];
  const edges = ideas.flatMap((i, n) => [{ seq: 2 * n + 1, src: i.id, dst: DECL, type: "instance-of" }, { seq: 2 * n + 2, src: TANK, dst: i.id, type: "contains" }]);
  return { meta: [{ key: "hydration_status", value: "OK" }], nodes, edges, events: [], geometryVersions: [], lintFindings: [] };
}
const publish = (t) => publishWorldGraphForTest(t, { label: "hoist" });
const IDEAS = [{ id: "wright/a-bench", by: "wright", date: "2026-09-02" }, { id: "limen/a-lamp", by: "limen", date: "2026-09-03" }];
const ids = (t) => t.ideas.map((i) => i.id);

test("IDEAS · a doorstep composed on the kept tank is byte-identical to one composed cold (two residents)", async (t) => {
  const prev = worldGraphSnapshot();
  t.after(() => { if (prev) publishWorldGraphForTest(prev.tables, { label: "restored" }); else resetWorldGraph(); __forgetIdeasTankForTest(); });
  publish(worldWith(IDEAS));
  for (const h of HANDLES) {
    const base = await cold(h);
    assert.ok(__ideasTankBuildsForTest() >= 1, "the doorstep reached the tank, or this proves nothing");
    assert.equal(await bytes(h), base, `${h}: second read, served from the kept tank`);
  }
  // FLIP: in world-classes.mjs § ideasTank, change the `ideasKept?.tables === tables` test to compare nothing (e.g. `ideasKept?.tables === null`): reuse and the falsifiers below redden.
});

test("IDEAS · reuse: the doorsteps of a pass under one snapshot read the tank once (it was read twice a doorstep)", async (t) => {
  const prev = worldGraphSnapshot();
  t.after(() => { if (prev) publishWorldGraphForTest(prev.tables, { label: "restored" }); else resetWorldGraph(); __forgetIdeasTankForTest(); });
  publish(worldWith(IDEAS));
  forgetAll();
  await compose("wright");
  const one = __ideasTankBuildsForTest();
  await compose("limen");
  await compose("wright");
  assert.equal(__ideasTankBuildsForTest(), one, "no further read of the snapshot");
  assert.equal(one, 1, "and the first doorstep read it once, not twice");
  // FLIP: in ideasTank, delete the `return ideasKept.value` early return: builds go up with every doorstep.
});

test("IDEAS · falsifier per input: a new snapshot (an idea added, an idea deleted, a row edited in place, the law sentence reworded)", async (t) => {
  const prev = worldGraphSnapshot();
  t.after(() => { if (prev) publishWorldGraphForTest(prev.tables, { label: "restored" }); else resetWorldGraph(); __forgetIdeasTankForTest(); });
  __forgetIdeasTankForTest();
  publish(worldWith(IDEAS));
  assert.deepEqual(ids(ideasTank()), ["wright/a-bench", "limen/a-lamp"]);
  publish(worldWith([...IDEAS, { id: "alden/a-gate", by: "alden", date: "2026-09-04" }]));
  assert.deepEqual(ids(ideasTank()), ["wright/a-bench", "limen/a-lamp", "alden/a-gate"], "added");
  publish(worldWith(IDEAS.slice(1)));
  assert.deepEqual(ids(ideasTank()), ["limen/a-lamp"], "deleted");
  publish(worldWith([{ ...IDEAS[1], body: "a lamp, but brighter" }]));
  assert.equal(ideasTank().ideas[0].body, "a lamp, but brighter", "edited in place: same ids, same count");
  publish(worldWith([{ ...IDEAS[1], body: "a lamp, but brighter" }], { body: "ideas are asks" }));
  assert.equal(ideasTank().law, "ideas are asks", "the declaration's own body");
  // FLIP: key the kept tank on `ideas.length` of the last build instead of the `tables` object: the edit-in-place case goes red.
});

test("IDEAS · falsifier per input: the doorstep itself moves with the snapshot (the first-idea standing reads the tank)", async (t) => {
  const prev = worldGraphSnapshot();
  t.after(() => { if (prev) publishWorldGraphForTest(prev.tables, { label: "restored" }); else resetWorldGraph(); __forgetIdeasTankForTest(); });
  forgetAll();
  publish(worldWith([]));
  const none = await bytes("wright");
  publish(worldWith(IDEAS));
  const some = await bytes("wright");
  assert.notEqual(none, some, "an idea of wright's moves wright's doorstep (the quest board's first-idea row)");
  assert.equal(some, await cold("wright"));
  // FLIP: as above (ideasTank's `tables` identity check): the second doorstep is served the empty tank.
});

test("IDEAS · an unreadable store is never kept, and the kept tank is frozen", async (t) => {
  const prev = worldGraphSnapshot();
  t.after(() => { if (prev) publishWorldGraphForTest(prev.tables, { label: "restored" }); else resetWorldGraph(); __forgetIdeasTankForTest(); });
  __forgetIdeasTankForTest();
  resetWorldGraph();
  assert.equal(ideasTank().source, "floor");
  publish(worldWith(IDEAS));
  assert.equal(ideasTank().source, "store", "the floor answer was not kept over the snapshot that arrived");
  const tank = ideasTank();
  assert.ok(Object.isFrozen(tank) && Object.isFrozen(tank.ideas) && Object.isFrozen(tank.ideas[0]));
  assert.throws(() => { tank.ideas.push({}); }, TypeError);
  assert.equal(ideasTank(), tank, "one kept value");
  // FLIP: in ideasTank's `keep`, drop `deepFreeze(...)`: the isFrozen assertion goes red.
});

test("deepFreeze freezes the whole value, and only plain data is walked", () => {
  const v = deepFreeze({ a: [{ b: 1 }], c: { d: "e" } });
  assert.ok(Object.isFrozen(v) && Object.isFrozen(v.a) && Object.isFrozen(v.a[0]) && Object.isFrozen(v.c));
});
