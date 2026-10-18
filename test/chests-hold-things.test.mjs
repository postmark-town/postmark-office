// chests-hold-things.test.mjs — WLD-27, Bevel's first review (2026-10-13).
//
// Four boundary findings and one scope correction, each held here by a test
// that fails on the submitted head (01abca91) and passes on the correction:
//   1. a take-back refused for the carry cap returns NO stake first;
//   2. a failed withdrawal of an exited mark is tried again on retry — and
//      only the withdrawal: no second unit, no second return;
//   3. a failed set-down's compensation cannot leave 25 carried when another
//      hold reached for the freed slot while the mark was filing;
//   4. a carried chest is on its CARRIER's card (and still on its maker's);
//   5. a chest takes whole THINGS too: they share its one capacity, show in
//      what it holds (101 candies and a toaster read 102 things), leave the
//      carrier's load, and come out by a take aimed at the chest.
// Everything is synthetic and in memory: the record, the ledger, the pens.

import { test } from "node:test";
import assert from "node:assert/strict";
import { callUnits, classViewOf, residentHolds, chestsRead, reservedFor } from "../src/world-units.mjs";
import { UNIT_ACTION, foldUnits, totalOf } from "../src/world-stacks.mjs";
import { liveHolder, holdingsOf } from "../src/world-hold.mjs";

// WLD-27's doors ship dark by default (src/chests-candy.mjs); these are their own tests, so they run with them open.
process.env.WORLD_CHESTS_CANDY = "1";

const LABEL = "test-comets";
const CLASSES = new Map(Object.entries({
  mark: { extends: null, dials: {} },
  thing: { extends: "mark", dials: { carry_cap: 24 } },
  consumable: { extends: "thing", dials: {} },
  candy: { extends: "consumable", dials: {}, labels: [{ label: LABEL, name: "Test Comets", creator: "sbx-ana" }] },
  chest: { extends: "thing", dials: { capacity: 30, capacity_min: 1, capacity_max: 120, first_stock: 30, portable: true, welcome: "open" } },
  toaster: { extends: "thing", dials: {} },
}));
const view = () => classViewOf({ classes: CLASSES });
const KEY = (h) => ({ handles: new Set([h]) });

function rig({ marks = {}, stakes = {} } = {}) {
  const acts = [], attachments = [], ledger = [], withdrawals = [];
  const positions = structuredClone(stakes);
  let failWithdraw = 0, leave = null;
  const deps = {
    classes: view,
    readRows: async () => ({ units: acts.filter((a) => String(a.action).startsWith("units:")), attachments: attachments.slice() }),
    markById: async (id) => marks[id] ?? null,
    reachTake: async () => ({}), reachGive: async () => ({}),
    standpoint: async () => ({ x: 1, y: 1 }),
    householdOf: (h) => ({ key: `hh:${h}`, house: `hh:${h}` }),
    stamp: async () => ({ at: {}, witnesses: [] }),
    crossing: () => 250, household: () => "hh:test",
    append: async (e) => {
      const id = acts.length + 100;
      acts.push({ id, class: e.cls, action: e.action, object: e.object, actor: e.actor, payload: e.payload, effect: e.effect });
      if (["give", "take", "drop"].includes(e.action) && e.payload?.thing)
        attachments.push({ entity: e.payload.holder ?? e.actor, target: e.payload.thing, policy: e.payload.policy, born_at: e.writtenAt });
      return { actId: id };
    },
    leave: async (...a) => (leave ? leave(...a) : { id: "x", put_forward: true }),
    holders: async (m) => (positions[m] ?? []).filter((p) => p.stamps > 0),
    unstake: async (r) => {
      const p = (positions[r.mark] ?? []).find((x) => x.handle === r.handle);
      const n = Math.min(p?.stamps ?? 0, r.stamps); if (p) p.stamps -= n;
      if (n) ledger.push({ handle: r.handle, mark: r.mark, n });
      return { applied: n };
    },
    withdraw: async (m) => { withdrawals.push(m); if (failWithdraw-- > 0) throw new Error("synthetic pen refused"); return { withdrawn: true }; },
    markTurn: (id, fn) => fn(), // no ledger process here to order against (WLD-27 A runs the real lock in exit-stake-boundary.test.mjs)
  };
  const seedUnits = (to, n, label = LABEL) => acts.push({ id: acts.length + 100, class: "holding", action: UNIT_ACTION.give, object: to, payload: { units: true, moves: [{ from: null, to, label, n }] } });
  const hold = (holder, thing) => attachments.push({ entity: holder, target: thing, policy: "cascade", born_at: new Date(Date.now() - 1000).toISOString() });
  return { deps, acts, attachments, ledger, withdrawals, seedUnits, hold,
    failWithdrawals: (n) => { failWithdraw = n; }, onLeave: (fn) => { leave = fn; },
    units: () => foldUnits(acts.filter((a) => String(a.action).startsWith("units:"))) };
}

const DROPPED = "sbx-ana/test-comets-41";
const droppedMark = { id: DROPPED, by: "sbx-ana", class: "candy", kind: "sited", label: LABEL, dropped: "act:41" };
const STAKES = { [DROPPED]: [{ handle: "sbx-ana", stamps: 1 }, { handle: "sbx-bo", stamps: 2 }] };

test("1 · a take-back refused for the carry cap returns no stake and records nothing", async () => {
  const r = rig({ marks: { [DROPPED]: droppedMark }, stakes: STAKES });
  r.seedUnits("sbx-cy", 24);
  const before = r.acts.length;
  await assert.rejects(callUnits("take-back", { thing: DROPPED }, KEY("sbx-cy"), "sbx-cy", r.deps), (e) => e.code === 409 && /24 of 24/.test(e.defect));
  assert.deepEqual(r.ledger, [], "no position moved");
  assert.equal(r.acts.length, before);
  assert.deepEqual(r.withdrawals, []);
});

test("2 · a failed withdrawal is tried again on retry — and only the withdrawal", async () => {
  const r = rig({ marks: { [DROPPED]: droppedMark }, stakes: STAKES });
  r.failWithdrawals(1);
  const first = await callUnits("take-back", { thing: DROPPED }, KEY("sbx-cy"), "sbx-cy", r.deps);
  assert.equal(first.withdrawn.withdrawn, false);
  assert.match(first.withdrawn.retry, /only the withdrawal/);
  const second = await callUnits("take-back", { thing: DROPPED }, KEY("sbx-cy"), "sbx-cy", r.deps);
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.withdrawn, { withdrawn: true });
  assert.equal(r.withdrawals.length, 2);
  const third = await callUnits("take-back", { thing: DROPPED }, KEY("sbx-cy"), "sbx-cy", r.deps);
  assert.equal(third.withdrawn.already, true, "once the withdrawal is recorded, nothing asks the pen again");
  assert.equal(r.withdrawals.length, 2);
  assert.equal(totalOf(r.units(), "sbx-cy"), 1, "one unit gained, ever");
  assert.equal(r.ledger.length, 2, "two stakers, two returns, ever");
  assert.equal(r.acts.filter((a) => a.action === UNIT_ACTION.exitWithdrawn).length, 1);
});

test("3 · a failed set-down keeps its slot: another hold cannot take it, and the compensation lands at 24", async () => {
  const CHEST = "sbx-ana/the-bowl";
  const r = rig({ marks: { [CHEST]: { id: CHEST, by: "sbx-ana", class: "chest" } } });
  r.seedUnits("sbx-cy", 24); r.seedUnits(CHEST, 5);
  let raced = null;
  r.onLeave(async () => {
    raced = await callUnits("take", { from: CHEST }, KEY("sbx-cy"), "sbx-cy", r.deps).then(() => "took", (e) => e.defect);
    assert.equal(reservedFor("sbx-cy"), 1, "the slot is held while the filing is in flight");
    return { error: "bounce", defect: "the mark pass tripped" };
  });
  await assert.rejects(callUnits("drop", { label: LABEL }, KEY("sbx-cy"), "sbx-cy", r.deps), (e) => /back in your hands/.test(e.hint));
  assert.match(String(raced), /24 of 24/, "the racing take was refused, not admitted into the held slot");
  assert.equal(totalOf(r.units(), "sbx-cy"), 24);
  assert.equal(reservedFor("sbx-cy"), 0, "nothing stays reserved once the filing settles");
});

test("3b · a set-down that files releases its slot", async () => {
  const r = rig();
  r.seedUnits("sbx-cy", 2);
  await callUnits("drop", { label: LABEL }, KEY("sbx-cy"), "sbx-cy", r.deps);
  assert.equal(reservedFor("sbx-cy"), 0);
});

test("4 · a carried chest is on its carrier's card, contents and all; its maker still sees it, authorship unmoved", async () => {
  const BAG = "sbx-ana/the-bag";
  const marks = [{ id: BAG, by: "sbx-ana", class: "chest", portable: true }];
  const units = [{ class: "holding", action: UNIT_ACTION.stock, object: BAG, payload: { moves: [{ from: null, to: BAG, label: LABEL, n: 30 }] } }];
  const deps = { classes: view, units: async () => units, attachments: async () => [{ entity: "sbx-cy", target: BAG, policy: "cascade", born_at: "2026-10-13T00:00:00Z" }], marks: async () => marks };
  const carrier = await residentHolds("sbx-cy", deps);
  assert.equal(carrier.chests.length, 1);
  assert.deepEqual([carrier.chests[0].chest, carrier.chests[0].by, carrier.chests[0].held_by, carrier.chests[0].shows], [BAG, "sbx-ana", "sbx-cy", "Test Comets: 30"]);
  assert.equal(carrier.holds.count, 0, "the bag's contents are the bag's, not loose in the carrier's hands");
  const maker = await residentHolds("sbx-ana", deps);
  assert.equal(maker.chests[0].held_by, "sbx-cy");
  assert.equal((await residentHolds("sbx-dee", deps)).chests.length, 0, "a stranger's card has no row");
  assert.equal((await chestsRead(deps)).chests[0].held_by, "sbx-cy", "the map and the card agree");
});

const CHEST = "sbx-ana/the-bowl";
const TOASTER = "sbx-cy/the-toaster";
const thingMarks = { [CHEST]: { id: CHEST, by: "sbx-ana", class: "chest", capacity: 3 }, [TOASTER]: { id: TOASTER, by: "sbx-cy", class: "toaster" },
  "sbx-cy/a-stool": { id: "sbx-cy/a-stool", by: "sbx-cy", class: "thing" }, "sbx-cy/a-tin": { id: "sbx-cy/a-tin", by: "sbx-cy", class: "chest" } };

test("5 · a whole thing goes into a chest: it shares the one capacity, shows in what the chest holds, and leaves the carrier's load", async () => {
  const r = rig({ marks: thingMarks });
  r.seedUnits(CHEST, 2); r.hold("sbx-cy", TOASTER);
  const put = await callUnits("thing-into-chest", { thing: TOASTER, to: CHEST }, KEY("sbx-cy"), "sbx-cy", r.deps);
  assert.equal(liveHolder(r.attachments, TOASTER), CHEST, "the holding edge names the chest");
  assert.equal(holdingsOf(r.attachments, "sbx-cy").length, 0, "no longer in the carrier's hands");
  assert.equal(put.chest.shows, "3 things", "2 candies and a toaster: the nearest common class is thing");
  assert.deepEqual(put.chest.things, [{ thing: TOASTER, class: "toaster" }]);
  // capacity 3 is now full: a unit and a thing are both refused, and nothing moves
  r.seedUnits("sbx-cy", 1); r.hold("sbx-cy", "sbx-cy/a-stool");
  await assert.rejects(callUnits("give", { to: CHEST, label: LABEL }, KEY("sbx-cy"), "sbx-cy", r.deps), /room for 0/);
  await assert.rejects(callUnits("thing-into-chest", { thing: "sbx-cy/a-stool", to: CHEST }, KEY("sbx-cy"), "sbx-cy", r.deps), /no room — 3 of 3/);
  const read = await chestsRead({ classes: view, units: async () => r.acts.filter((a) => a.action.startsWith("units:")), attachments: async () => r.attachments, marks: async () => Object.values(thingMarks) });
  assert.equal(read.chests.find((c) => c.chest === CHEST).shows, "3 things", "the map read counts the toaster too");
});

test("5b · it comes out by a take aimed at the chest — reach, welcome and the carry cap apply", async () => {
  const r = rig({ marks: { ...thingMarks, [CHEST]: { ...thingMarks[CHEST], welcome: "closed" } } });
  r.hold(CHEST, TOASTER);
  await assert.rejects(callUnits("thing-from-chest", { thing: TOASTER, from: CHEST }, KEY("sbx-cy"), "sbx-cy", r.deps), (e) => e.code === 403);
  const r2 = rig({ marks: thingMarks });
  r2.hold(CHEST, TOASTER); r2.seedUnits("sbx-cy", 24);
  await assert.rejects(callUnits("thing-from-chest", { thing: TOASTER, from: CHEST }, KEY("sbx-cy"), "sbx-cy", r2.deps), /24 of 24/);
  assert.equal(liveHolder(r2.attachments, TOASTER), CHEST, "a refused take moves nothing");
  const r3 = rig({ marks: thingMarks });
  r3.hold(CHEST, TOASTER);
  const out = await callUnits("thing-from-chest", { thing: TOASTER, from: CHEST }, KEY("sbx-cy"), "sbx-cy", r3.deps);
  assert.equal(out.holder, "sbx-cy");
  assert.equal(liveHolder(r3.attachments, TOASTER), "sbx-cy");
  await assert.rejects(callUnits("thing-from-chest", { thing: TOASTER, from: CHEST }, KEY("sbx-cy"), "sbx-cy", r3.deps), /is not holding/);
});

test("5c · only what you hold goes in; no chest inside itself, however deep", async () => {
  const r = rig({ marks: thingMarks });
  await assert.rejects(callUnits("thing-into-chest", { thing: TOASTER, to: CHEST }, KEY("sbx-cy"), "sbx-cy", r.deps), /you are not holding/);
  await assert.rejects(callUnits("thing-into-chest", { thing: CHEST, to: CHEST }, KEY("sbx-ana"), "sbx-ana", r.deps), /cannot hold itself/);
  // the bowl sits in the tin; carrying the tin, you cannot put the tin into the bowl
  r.hold("sbx-cy", "sbx-cy/a-tin"); r.hold("sbx-cy/a-tin", CHEST);
  await assert.rejects(callUnits("thing-into-chest", { thing: "sbx-cy/a-tin", to: CHEST }, KEY("sbx-cy"), "sbx-cy", r.deps), /is inside/);
});

test("5d · plumb-nest-guard: a chest 70 levels inside the thing is still refused, and nothing nests past 16 deep", { timeout: 10_000 }, async () => {
  const chests = Object.fromEntries(Array.from({ length: 71 }, (_, k) => [`sbx-cy/c-${k}`, { id: `sbx-cy/c-${k}`, by: "sbx-cy", class: "chest", capacity: 3 }]));
  const nest = (r, n) => { r.hold("sbx-cy", "sbx-cy/c-0"); for (let k = 1; k <= n; k++) r.hold(`sbx-cy/c-${k - 1}`, `sbx-cy/c-${k}`); };
  const deep = rig({ marks: chests });
  nest(deep, 70);
  await assert.rejects(callUnits("thing-into-chest", { thing: "sbx-cy/c-0", to: "sbx-cy/c-70" }, KEY("sbx-cy"), "sbx-cy", deep.deps),
    (e) => e.defect === "sbx-cy/c-70 is inside sbx-cy/c-0" && /Nothing was recorded\.$/.test(e.hint));
  assert.equal(deep.acts.length, 0, "nothing was recorded");
  // c-16 sits 16 deep: a toaster into it would be 17
  const tall = rig({ marks: { ...chests, [TOASTER]: thingMarks[TOASTER] } });
  nest(tall, 16); tall.hold("sbx-cy", TOASTER);
  await assert.rejects(callUnits("thing-into-chest", { thing: TOASTER, to: "sbx-cy/c-16" }, KEY("sbx-cy"), "sbx-cy", tall.deps),
    (e) => e.defect === `${TOASTER} would be nested 17 deep` && e.hint === "the town holds things at most 16 deep. Nothing was recorded.");
  assert.equal(tall.acts.length, 0);
  assert.equal((await callUnits("thing-into-chest", { thing: TOASTER, to: "sbx-cy/c-15" }, KEY("sbx-cy"), "sbx-cy", tall.deps)).did, "give");
});

// ── Wright, 2026-10-13T01:19Z: refill reach stays — the REAL reach, not a stub ─
import { refuseOutOfReach } from "../src/world-hold.mjs";
import { standsWithin } from "../src/reach.mjs";

test("REFILL REACH: the creator must stand at the chest — the real threshold check refuses from 500 m and admits at the chest", async () => {
  const CHEST = "sbx-ana/the-bowl";
  const chest = { id: CHEST, by: "sbx-ana", class: "chest", kind: "sited", at: { x: 100, y: 100 }, extent: { w: 2, h: 2 } };
  let standing = { placed: true, x: 600, y: 100 };
  const r = rig({ marks: { [CHEST]: chest } });
  r.seedUnits(CHEST, 10);
  r.deps.reachTake = (thing, actor) => refuseOutOfReach({ thing, to: null, actor, act: "take", holder: null,
    ctx: { mark: chest, canon_readable: true, within: null, standing, standsWithin, householdOf: null } });
  const before = r.acts.length;
  await assert.rejects(callUnits("refill", { chest: CHEST }, KEY("sbx-ana"), "sbx-ana", r.deps), (e) => e.code === 409 && /you are not standing where/.test(e.defect));
  await assert.rejects(callUnits("give", { to: CHEST, label: LABEL }, KEY("sbx-cy"), "sbx-cy", r.deps), (e) => e.code === 409 && /you are not standing where/.test(e.defect), "give-into-chest has the same reach");
  assert.equal(r.acts.length, before, "nothing recorded from afar");
  standing = { placed: true, x: 100, y: 100 };
  const ok = await callUnits("refill", { chest: CHEST }, KEY("sbx-ana"), "sbx-ana", r.deps);
  assert.equal(ok.count, 20, "at the chest, the creator fills the room");
});

// ── Bevel's revised first review (2026-10-13T02:15Z), controls carried VERBATIM from
// /tmp/bevel-wld27-r2-pf71t09r/test/chests-hold-things.test.mjs (appended there; red at ebef4f49).

test('Bevel R2: refill receipt describes the same mixed holding as the authoritative chest read', async () => {
  const c = 'sbx-ana/review-bowl', t = 'sbx-ana/review-toaster';
  const marks = {
    [c]: { id: c, by: 'sbx-ana', class: 'chest', capacity: 30 },
    [t]: { id: t, by: 'sbx-ana', class: 'toaster' },
  };
  const r = rig({ marks });
  r.hold(c, t);
  r.seedUnits(c, 10);
  const act = await callUnits('refill', { chest: c }, KEY('sbx-ana'), 'sbx-ana', r.deps);
  assert.equal(act.count, 19, 'refill correctly reserves the toaster slot');
  const read = await chestsRead({ classes: view, units: async () => r.acts,
    attachments: async () => r.attachments, marks: async () => Object.values(marks) });
  const face = read.chests.find(x => x.chest === c);
  assert.equal(face.count, 30, 'the actual recorded chest is full, including its toaster');
  assert.deepEqual({ count: act.chest.count, class: act.chest.class, shows: act.chest.shows },
    { count: face.count, class: face.class, shows: face.shows },
    'the act receipt must not call a full mixed chest 29 candies');
});

test('Bevel R2: another caller finishing withdrawal preserves the original exit actor and action', async () => {
  const r = rig({ marks: { [DROPPED]: droppedMark }, stakes: STAKES });
  r.failWithdrawals(1);
  const first = await callUnits('take-back', { thing: DROPPED }, KEY('sbx-cy'), 'sbx-cy', r.deps);
  assert.equal(first.withdrawn.withdrawn, false);
  const exit = r.acts.find(a => a.action === UNIT_ACTION.takeBack);
  const retry = await callUnits('consume-in-place', { thing: DROPPED }, KEY('sbx-bo'), 'sbx-bo', r.deps);
  assert.equal(retry.duplicate, true);
  assert.equal(totalOf(r.units(), 'sbx-cy'), 1, 'the original take-back remains the only unit mutation');
  assert.deepEqual(r.withdrawals.at(-1).cause, { exit: 'take-back', by: 'sbx-cy', act: exit.id },
    'a cleanup retry cannot claim another resident consumed the mark instead');
});

// ── the revised review's B and D, past the probes: every unit act's chest
// receipt, and the same-caller retry ──────────────────────────────────────

test("B · take, give and a no-room refill each describe a mixed chest as the chests read does — the whole thing counted", async () => {
  const c = "sbx-ana/mixed-bowl", t = "sbx-ana/mixed-toaster";
  const marks = { [c]: { id: c, by: "sbx-ana", class: "chest", capacity: 30 }, [t]: { id: t, by: "sbx-ana", class: "toaster" } };
  const r = rig({ marks });
  r.hold(c, t); r.seedUnits(c, 10); r.seedUnits("sbx-cy", 3);
  const face = async () => (await chestsRead({ classes: view, units: async () => r.acts.filter((a) => String(a.action).startsWith("units:")),
    attachments: async () => r.attachments, marks: async () => Object.values(marks) })).chests.find((x) => x.chest === c);
  const same = async (block, what) => {
    const f = await face();
    assert.deepEqual({ count: block.count, class: block.class, shows: block.shows }, { count: f.count, class: f.class, shows: f.shows }, what);
    assert.deepEqual(block.things, [{ thing: t, class: "toaster" }], `${what}: the toaster is named`);
  };
  const took = await callUnits("take", { from: c, count: 4 }, KEY("sbx-cy"), "sbx-cy", r.deps);
  assert.equal(took.count, 4, "the transfer count is the units moved");
  assert.equal(took.chest.count, 7, "6 units and a toaster");
  await same(took.chest, "take");
  const gave = await callUnits("give", { to: c, count: 2 }, KEY("sbx-cy"), "sbx-cy", r.deps);
  assert.equal(gave.count, 2);
  assert.equal(gave.receiver.count, 9, "8 units and a toaster");
  await same(gave.receiver, "give");
  const filled = await callUnits("refill", { chest: c }, KEY("sbx-ana"), "sbx-ana", r.deps);
  assert.equal(filled.count, 21, "fills the room the units and the toaster leave");
  await same(filled.chest, "refill");
  const noop = await callUnits("refill", { chest: c }, KEY("sbx-ana"), "sbx-ana", r.deps);
  assert.equal(noop.noop, true);
  assert.equal(noop.chest.count, 30);
  await same(noop.chest, "a refill with no room");
});

test("D · the withdrawal's cause is always the exit itself: the first try names its own act, a same-caller retry names it again, and another finisher is recorded beside it", async () => {
  const r = rig({ marks: { [DROPPED]: droppedMark }, stakes: STAKES });
  r.failWithdrawals(2);
  await callUnits("take-back", { thing: DROPPED }, KEY("sbx-cy"), "sbx-cy", r.deps);
  const exit = r.acts.find((a) => a.action === UNIT_ACTION.takeBack);
  const cause = { exit: "take-back", by: "sbx-cy", act: exit.id };
  assert.deepEqual(r.withdrawals[0].cause, cause, "the first try");
  await callUnits("take-back", { thing: DROPPED }, KEY("sbx-cy"), "sbx-cy", r.deps);      // fails again
  assert.deepEqual(r.withdrawals[1].cause, cause, "the same caller's retry");
  const done = await callUnits("consume-in-place", { thing: DROPPED }, KEY("sbx-bo"), "sbx-bo", r.deps);
  assert.deepEqual(r.withdrawals[2].cause, cause, "another caller, another route: still Cy's take-back");
  assert.equal(done.duplicate, true);
  const w = r.acts.filter((a) => a.action === UNIT_ACTION.exitWithdrawn);
  assert.equal(w.length, 1);
  assert.deepEqual([w[0].payload.exit, w[0].payload.finished_by], [cause, "sbx-bo"], "the finisher is logged beside the cause, not as it");
  assert.equal(r.acts.filter((a) => a.action === UNIT_ACTION.consumeInPlace).length, 0, "no consumption happened");
  assert.equal(totalOf(r.units(), "sbx-cy"), 1);
  assert.equal(r.ledger.length, 2, "two returns, ever");
});

// ── F2 (Wright's independent review, AUTHORITY 2026-10-13T03:01:29Z): refill
// needs the chest's MAKER who is also the CREATOR of the label used. Authorship
// is not possession or household; giving into a chest stays open. ───────────

const BO_LABEL = { label: "test-drops", name: "Test Drops", creator: "sbx-bo" };
const twoLabels = () => classViewOf({ classes: new Map([...CLASSES, ["candy", { ...CLASSES.get("candy"), labels: [...CLASSES.get("candy").labels, BO_LABEL] }]]) });
const F2_CHEST = "sbx-ana/f2-bowl";
const f2Rig = (extra = {}) => {
  const r = rig({ marks: { [F2_CHEST]: { id: F2_CHEST, by: "sbx-ana", class: "chest", capacity: 30 } } });
  r.deps.classes = twoLabels;
  r.deps.householdOf = (h) => ({ key: "hh:ana-and-bo", house: "hh:ana-and-bo" });     // Bo shares Ana's house
  Object.assign(r.deps, extra);
  return r;
};

test("F2 · Bo cannot refill Ana's chest — empty, partly full, full (a would-be no-op), carried by Bo, same household, with a label of his own — and nothing is recorded", async () => {
  for (const [what, setup] of [
    ["empty", () => {}],
    ["partly full of Ana's", (r) => r.seedUnits(F2_CHEST, 10)],
    ["holding Bo's own label", (r) => r.seedUnits(F2_CHEST, 4, "test-drops")],
    ["full", (r) => r.seedUnits(F2_CHEST, 30)],
    ["carried by Bo", (r) => r.hold("sbx-bo", F2_CHEST)],
  ]) {
    const r = f2Rig(); setup(r);
    let reached = 0; r.deps.reachTake = async () => { reached += 1; };
    const before = r.acts.length;
    await assert.rejects(callUnits("refill", { chest: F2_CHEST }, KEY("sbx-bo"), "sbx-bo", r.deps),
      (e) => e.code === 403 && /sbx-bo did not make sbx-ana\/f2-bowl/.test(e.defect), what);
    assert.equal(r.acts.length, before, `${what}: nothing recorded`);
    assert.equal(reached, 0, `${what}: refused before anything else is asked`);
  }
});

test("F2 · the maker with no registered label cannot refill her own chest", async () => {
  const r = rig({ marks: { "sbx-eve/her-tin": { id: "sbx-eve/her-tin", by: "sbx-eve", class: "chest" } } });
  await assert.rejects(callUnits("refill", { chest: "sbx-eve/her-tin" }, KEY("sbx-eve"), "sbx-eve", r.deps), (e) => e.code === 403 && /sbx-eve has no candy label/.test(e.defect));
  assert.equal(r.acts.filter((a) => a.action === UNIT_ACTION.refill).length, 0);
});

test("F2 · the maker who created the label refills to capacity — a mixed chest with another label's gifts and a whole thing included; full is a no-op", async () => {
  const r = f2Rig();
  r.deps.markById = async (id) => ({ [F2_CHEST]: { id: F2_CHEST, by: "sbx-ana", class: "chest", capacity: 30 }, "sbx-bo/f2-toaster": { id: "sbx-bo/f2-toaster", class: "toaster" } })[id] ?? null;
  r.seedUnits(F2_CHEST, 6); r.seedUnits(F2_CHEST, 5, "test-drops"); r.hold(F2_CHEST, "sbx-bo/f2-toaster");
  const filled = await callUnits("refill", { chest: F2_CHEST }, KEY("sbx-ana"), "sbx-ana", r.deps);
  assert.deepEqual([filled.label, filled.count, filled.chest.count], [LABEL, 18, 30], "6 + 5 + 1 thing + 18 = 30");
  const noop = await callUnits("refill", { chest: F2_CHEST }, KEY("sbx-ana"), "sbx-ana", r.deps);
  assert.equal(noop.noop, true);
});

test("F2 · an outsider still gives into the chest", async () => {
  const r = f2Rig({ householdOf: (h) => ({ key: `hh:${h}`, house: `hh:${h}` }) });
  r.seedUnits("sbx-cy", 3);
  const gave = await callUnits("give", { to: F2_CHEST, count: 2 }, KEY("sbx-cy"), "sbx-cy", r.deps);
  assert.deepEqual([gave.count, gave.receiver.count], [2, 2]);
});

test("F2 · Ana's own chest holding only Bo's gifts: Ana fills the rest with her own label (Wright 03:38:35Z — the label-presence guard is dropped); Bo still cannot refill it", async () => {
  const r = f2Rig();
  r.seedUnits(F2_CHEST, 5, "test-drops");
  await assert.rejects(callUnits("refill", { chest: F2_CHEST }, KEY("sbx-bo"), "sbx-bo", r.deps), (e) => e.code === 403 && /sbx-bo did not make/.test(e.defect));
  const filled = await callUnits("refill", { chest: F2_CHEST }, KEY("sbx-ana"), "sbx-ana", r.deps);
  assert.deepEqual([filled.label, filled.count, filled.chest.count], [LABEL, 25, 30], "30 − 5 of her own beside Bo's 5");
  assert.deepEqual(filled.chest.edges.map((e) => [e.label, e.count]).sort(), [[LABEL, 25], ["test-drops", 5]]);
  assert.equal(filled.chest.class, "candy", "the mixed chest reads as the nearest common class");
});

// ── F4 (Wright's independent review, 03:01:29Z): every stake is returned before
// the mark leaves — a stake that lands after the exit read its holders too, on
// a fresh exit and on a cleanup retry. THESE USE INJECTED LEDGER COLLABORATORS
// (the rig's `holders`/`unstake`, which clip to the open position as the
// engine's unstake does) — not the town's engine, not a real ledger. ────────

/** After the exit's first holder read, `who` stakes `n` on the mark. */
const stakeLandsAfterFirstRead = (r, who, n) => {
  const read = r.deps.holders; let reads = 0;
  r.deps.holders = async (m) => { const out = await read(m); if (++reads === 1) r.positions[m].push({ handle: who, stamps: n }); return out; };
};

function f4Rig() {
  const r = rig({ marks: { [DROPPED]: droppedMark }, stakes: STAKES });
  // reach the rig's open positions (the ledger the injected unstake clips against)
  const positions = {}; let failUnstakeFor = null;
  positions[DROPPED] = [{ handle: "sbx-ana", stamps: 1 }, { handle: "sbx-bo", stamps: 2 }];
  r.positions = positions;
  r.deps.holders = async (m) => (positions[m] ?? []).filter((p) => p.stamps > 0).map((p) => ({ ...p }));
  r.deps.unstake = async (x) => {
    if (failUnstakeFor === x.handle) { failUnstakeFor = null; return { error: "bounce", defect: "the ledger could not be written" }; }
    const p = (positions[x.mark] ?? []).find((y) => y.handle === x.handle);
    const n = Math.min(p?.stamps ?? 0, x.stamps); if (p) p.stamps -= n;
    if (n) r.ledger.push({ handle: x.handle, mark: x.mark, n });
    return { applied: n };
  };
  r.failUnstakeOnceFor = (h) => { failUnstakeFor = h; };
  return r;
}
const once = (ledger) => Object.fromEntries(ledger.map((l) => [l.handle, ledger.filter((x) => x.handle === l.handle).reduce((a, x) => a + x.n, 0)]));

test("F4 · a stake that lands after the exit's first read is returned before the withdrawal — each staker once, clipped to what is open", async () => {
  const r = f4Rig();
  stakeLandsAfterFirstRead(r, "sbx-dee", 3);
  const out = await callUnits("take-back", { thing: DROPPED }, KEY("sbx-cy"), "sbx-cy", r.deps);
  assert.deepEqual(out.returns.map((x) => [x.handle, x.stamps]), [["sbx-ana", 1], ["sbx-bo", 2]], "the exit's own returns");
  assert.deepEqual(out.late_returns.map((x) => [x.handle, x.stamps]), [["sbx-dee", 3]], "the late stake, returned before the mark left");
  assert.deepEqual(once(r.ledger), { "sbx-ana": 1, "sbx-bo": 2, "sbx-dee": 3 }, "each staker once");
  assert.equal(out.withdrawn.withdrawn, true);
  assert.equal(r.withdrawals.length, 1);
  const [w] = r.acts.filter((a) => a.action === UNIT_ACTION.exitWithdrawn);
  assert.deepEqual(w.payload.late_returns.map((x) => [x.handle, x.stamps]), [["sbx-dee", 3]], "the record says what was returned late");
  assert.equal(totalOf(r.units(), "sbx-cy"), 1, "one unit");
  assert.ok(r.positions[DROPPED].every((p) => p.stamps === 0), "nothing left open on a mark that left");
});

test("F4 · a late return that fails leaves the withdrawal pending and says so; the retry returns only what is open, then withdraws", async () => {
  const r = f4Rig();
  stakeLandsAfterFirstRead(r, "sbx-dee", 3);
  r.failUnstakeOnceFor("sbx-dee");
  const first = await callUnits("take-back", { thing: DROPPED }, KEY("sbx-cy"), "sbx-cy", r.deps);
  assert.equal(first.withdrawn.withdrawn, false);
  assert.match(first.withdrawn.why, /a late stake by sbx-dee could not be returned/);
  assert.equal(r.withdrawals.length, 0, "the mark was NOT withdrawn with a stake open on it");
  assert.equal(r.acts.filter((a) => a.action === UNIT_ACTION.exitWithdrawn).length, 0, "not marked complete");
  const retry = await callUnits("take-back", { thing: DROPPED }, KEY("sbx-cy"), "sbx-cy", r.deps);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.late_returns.map((x) => [x.handle, x.stamps]), [["sbx-dee", 3]]);
  assert.equal(retry.withdrawn.withdrawn, true);
  assert.deepEqual(once(r.ledger), { "sbx-ana": 1, "sbx-bo": 2, "sbx-dee": 3 }, "each staker once — the early ones not repaid on the retry");
  assert.equal(totalOf(r.units(), "sbx-cy"), 1);
  assert.equal(r.acts.filter((a) => a.action === UNIT_ACTION.exitWithdrawn).length, 1);
});

test("F4 · an already-exited mark whose withdrawal is pending: a stake that lands meanwhile is returned before another resident's retry withdraws it — cause still the original exit", async () => {
  const r = f4Rig();
  r.failWithdrawals(1);
  await callUnits("take-back", { thing: DROPPED }, KEY("sbx-cy"), "sbx-cy", r.deps);
  const exit = r.acts.find((a) => a.action === UNIT_ACTION.takeBack);
  r.positions[DROPPED].push({ handle: "sbx-eve", stamps: 2 });                // lands while the withdrawal is pending
  const done = await callUnits("consume-in-place", { thing: DROPPED }, KEY("sbx-bo"), "sbx-bo", r.deps);
  assert.deepEqual(done.late_returns.map((x) => [x.handle, x.stamps]), [["sbx-eve", 2]]);
  assert.equal(done.withdrawn.withdrawn, true);
  assert.deepEqual(r.withdrawals.at(-1).cause, { exit: "take-back", by: "sbx-cy", act: exit.id });
  assert.deepEqual(once(r.ledger), { "sbx-ana": 1, "sbx-bo": 2, "sbx-eve": 2 });
  const [w] = r.acts.filter((a) => a.action === UNIT_ACTION.exitWithdrawn);
  assert.deepEqual([w.payload.finished_by, w.payload.late_returns.length], ["sbx-bo", 1]);
  assert.equal(r.acts.filter((a) => a.action === UNIT_ACTION.consumeInPlace).length, 0, "no consumption happened");
});

test("F4 · stakes that keep arriving refuse the withdrawal this time — pending, honest, every stake returned so far stays returned", async () => {
  const r = f4Rig();
  let k = 0;
  const read = r.deps.holders;
  r.deps.holders = async (m) => { const out = await read(m); r.positions[m].push({ handle: `sbx-late-${++k}`, stamps: 1 }); return out; };
  const out = await callUnits("take-back", { thing: DROPPED }, KEY("sbx-cy"), "sbx-cy", r.deps);
  assert.equal(out.withdrawn.withdrawn, false);
  assert.match(out.withdrawn.why, /stakes kept arriving/);
  assert.equal(r.withdrawals.length, 0);
  assert.equal(r.acts.filter((a) => a.action === UNIT_ACTION.exitWithdrawn).length, 0);
  assert.ok(r.ledger.every((l) => r.ledger.filter((x) => x.handle === l.handle).length === 1), "no staker returned twice");
});
