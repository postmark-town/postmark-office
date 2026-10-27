// named-creature-return.test.mjs — a named creature that comes back after it ends (WLD-124;
// src/creature-tick.mjs § comebackOf, namedSpawns).
//
// RULED (Darko, 2026-10-27): a declaration marked `return_until` comes back after it ends, at the first
// settlement after the one that ended it, as a new generation (`<id>-r2`, `-r3`); one that comes back
// after its key has been earned carries nothing; a finish records its finisher and who took part as today;
// none comes back from the settlement at 2026-11-01T06:00:00Z on; one already out stays.
//
// Pure: the world's side is a stub law and the store is an in-memory `acts` + `settlements`, so this runs
// with no world clone.
//
// THE CAN-FAIL FLIPS (each reds a case below): read the ending's settlement as `>=` not `>`; take the
// cutoff as `<=`; drop the earned-key read; drop the generation id (respawn the declaration's own id).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ENDED_OF_SQL, ENDED_ROWS_SQL, GENERATIONS_SQL, KEY_HOLDER_SQL, NEWEST_SETTLEMENT_SQL, SETTLEMENT_AT_SQL, UNSEAL_DUE_SQL, TICK_ROWS_SQL,
  creatureTick, generationId,
} from "../src/creature-tick.mjs";
import { planEnding } from "../world2/tools/creature-endings.mjs";

const ID = "creature:candied-test-den";
const KEY = "the-town/the-test-key";
const UNTIL = "2026-11-01T06:00:00Z";
const decl = (over = {}) => ({ id: ID, kind: "test", x: 5, y: 6, carries: KEY, from_crossing: 1, declared: "the-town/candied-test#den", return_until: UNTIL, ...over });
const creaturesMod = { creaturesOn: () => true, isCreatureId: (id) => typeof id === "string" && id.startsWith("creature:") };

/** A store: acts and settlements, answering the tick's own SQL by identity. */
function world({ named = [decl()], settlements = [] } = {}) {
  const acts = [], held = [];
  let id = 100;
  const rowOf = (a) => ({ ...a });
  const query = async (sql, params = []) => {
    if (sql === TICK_ROWS_SQL || sql === UNSEAL_DUE_SQL) return [];
    if (sql === GENERATIONS_SQL) return acts.filter((a) => a.action === "spawn" && (a.object === params[0] || new RegExp(`^${params[0]}-r[0-9]+$`).test(a.object))).map(rowOf);
    if (sql === ENDED_ROWS_SQL) return acts.filter((a) => a.action === "withdraw" && a.payload.reason === "ended" && params[0].includes(a.object)).map(rowOf);
    if (sql === ENDED_OF_SQL) return acts.filter((a) => a.action === "withdraw" && a.payload.reason === "ended" && params[0].includes(a.object)).map(rowOf);
    if (sql === NEWEST_SETTLEMENT_SQL) return settlements.length ? [settlements.reduce((a, b) => (b.number > a.number ? b : a))] : [];
    if (sql === SETTLEMENT_AT_SQL) return [{ number: Math.max(0, ...settlements.filter((s) => Date.parse(s.published_at) <= Date.parse(params[0])).map((s) => s.number)) }];
    if (sql === KEY_HOLDER_SQL) { const last = acts.filter((a) => a.class === "holding" && a.object === params[0]).at(-1); return last ? [{ holder: last.payload.holder }] : []; }
    throw new Error(`unexpected sql: ${sql.slice(0, 60)}`);
  };
  const write = async (row) => {
    const prior = acts.find((a) => a.action === row.action && a.object === row.object);
    if (prior) return { prior: true, row: prior };
    const r = { id: String(++id), at: row.written_at, actor: row.actor, action: row.action, object: row.object, payload: JSON.parse(row.payload) };
    acts.push(r);
    return { prior: false, row: r };
  };
  const W = { creaturesMod, starts: { test: { moods: { fear: 1 } } }, law: { fromCrossing: null, dials: {}, kinds: [], named } };
  const tick = (now) => creatureTick({ now, key: null, query, write, hold: async (thing, creature) => { held.push([thing, creature]); return { wrote: true }; }, inputsAt: async () => W, blessed: () => "sha" });
  const end = (object, over = {}) => acts.push({ id: String(++id), at: over.at ?? "2026-10-26T20:00:00Z", actor: "the-town", action: "withdraw", object, class: "creature",
    payload: { reason: "ended", finished_by: "lupi", act: "9", took_part: ["lupi"], ...over.payload } });
  const spawns = () => acts.filter((a) => a.action === "spawn").map((a) => a.object);
  return { acts, held, settlements, tick, end, spawns };
}
const S = (number, published_at) => ({ number, published_at });
const NOW = Date.parse("2026-10-27T07:00:00Z");

test("generation ids: the declaration's own, then -r2, -r3; the suffix is the record's", () => {
  assert.equal(generationId(ID, 1), ID);
  assert.equal(generationId(ID, 2), `${ID}-r2`);
  assert.equal(generationId(ID, 5), `${ID}-r5`);
});

test("a creature that has not ended does not come back, and one that ended waits for the NEXT settlement", async () => {
  const w = world({ settlements: [S(133, "2026-10-26T18:20:00Z")] });
  await w.tick(NOW);
  assert.deepEqual(w.spawns(), [ID], "its first generation comes out as ever");
  await w.tick(NOW + 60_000);
  assert.deepEqual(w.spawns(), [ID], "alive: nothing returns");
  w.end(ID, { payload: { settlement: 133, carried: KEY } });
  await w.tick(NOW + 120_000);
  assert.deepEqual(w.spawns(), [ID], "ended at S133, and S133 is the newest landed: not yet (RED if the gate reads >=)");
  w.settlements.push(S(134, "2026-10-27T06:20:00Z"));
  await w.tick(NOW + 180_000);
  assert.deepEqual(w.spawns(), [ID, `${ID}-r2`], "S134 landed, later than the ending's S133: it is back");
});

test("never twice: a rerun, a restart and a second office add no second comeback in one settlement", async () => {
  const w = world({ settlements: [S(133, "2026-10-26T18:20:00Z"), S(134, "2026-10-27T06:20:00Z")] });
  await w.tick(NOW);
  w.end(ID, { payload: { settlement: 133, carried: KEY } });
  for (let i = 0; i < 6; i++) await w.tick(NOW + i * 30_000);
  assert.deepEqual(w.spawns(), [ID, `${ID}-r2`]);
  await Promise.all([w.tick(NOW + 999_000), w.tick(NOW + 999_000)]);
  assert.deepEqual(w.spawns(), [ID, `${ID}-r2`], "two ticks racing write the one row");
});

test("the comeback keeps its place, stays, and is the same declaration; its ending records the finisher and who took part as today (G5)", async () => {
  const w = world({ settlements: [S(133, "2026-10-26T18:20:00Z"), S(134, "2026-10-27T06:20:00Z")] });
  await w.tick(NOW);
  w.end(ID, { payload: { settlement: 133, carried: KEY } });
  await w.tick(NOW + 60_000);
  const back = w.acts.find((a) => a.object === `${ID}-r2`);
  assert.equal(back.payload.stays, true, "stays flows through the comeback spawn, so STAYING_SPAWNS_SQL holds it");
  assert.equal(back.payload.kind, "test");
  assert.deepEqual([back.payload.x, back.payload.y], [5, 6]);
  assert.equal(back.payload.declared, "the-town/candied-test#den");
  assert.equal(back.payload.generation, 2);
  assert.equal(back.payload.returns_after, ID);
  const plan = planEnding({ spawn: { object: back.object, payload: back.payload }, settlement: 135, cutoff: "2026-10-27T18:00:00Z",
    finishers: [{ by: "bo", act_id: "30", act_actor: "bo" }], answered: [{ act_id: "29", actor: "kai", object: back.object, approach: null }] });
  assert.equal(plan.finisher, "bo");
  assert.deepEqual(plan.took_part, ["kai", "bo"]);
  assert.equal(plan.carries, null);
  assert.equal(plan.give_line, null, "no key to give");
});

test("a comeback after its key was earned carries nothing: an ended withdraw that carried it, or a holder that is no longer the town", async () => {
  const done = [S(133, "2026-10-26T18:20:00Z"), S(134, "2026-10-27T06:20:00Z")];
  const a = world({ settlements: done });
  await a.tick(NOW);
  a.end(ID, { payload: { settlement: 133, carried: KEY } });
  await a.tick(NOW + 60_000);
  assert.equal(a.acts.find((x) => x.object === `${ID}-r2`).payload.carries, undefined, "the ending gave the key (RED if the earned read is dropped)");
  assert.equal(a.held.some(([, creature]) => creature === `${ID}-r2`), false, "the town puts nothing in its hands for the comeback");
  // a hand repair: the withdraw carried nothing, the key is still the town's: the comeback carries it
  const b = world({ settlements: done });
  await b.tick(NOW);
  b.end(ID, { payload: { hand_repair: "ended by hand" } });
  await b.tick(NOW + 60_000);
  assert.equal(b.acts.find((x) => x.object === `${ID}-r2`).payload.carries, KEY, "not earned yet: it carries the key until someone wins it");
  // the key moved on by another road: the holder is no longer the town
  const c = world({ settlements: done });
  await c.tick(NOW);
  c.end(ID, { payload: { hand_repair: "ended by hand" } });
  c.acts.push({ id: "900", at: "2026-10-26T21:00:00Z", actor: "the-town", action: "give", object: KEY, class: "holding", payload: { holder: "limen" } });
  await c.tick(NOW + 60_000);
  assert.equal(c.acts.find((x) => x.object === `${ID}-r2`).payload.carries, undefined);
});

test("a hand-written withdraw has no settlement: it counts as ended before the first settlement landed after it", async () => {
  const w = world({ settlements: [S(133, "2026-10-26T18:20:00Z")] });
  await w.tick(NOW);
  w.end(ID, { at: "2026-10-26T20:00:00Z", payload: { hand_repair: "by hand" } });
  await w.tick(NOW + 60_000);
  assert.deepEqual(w.spawns(), [ID], "S133 landed before the hand repair: the next one has not landed");
  w.settlements.push(S(134, "2026-10-27T06:20:00Z"));
  await w.tick(NOW + 120_000);
  assert.deepEqual(w.spawns(), [ID, `${ID}-r2`]);
});

test("the cutoff: a comeback needs the landed settlement's instant strictly before 2026-11-01T06:00:00Z, and the one out stays (G3, G6)", async () => {
  // last allowed: the settlement at 18:00Z on 10-31 brings it
  const a = world({ settlements: [S(200, "2026-10-31T06:10:00Z")] });
  await a.tick(NOW);
  a.end(ID, { payload: { settlement: 200, carried: KEY } });
  a.settlements.push(S(201, "2026-10-31T18:05:00Z"));
  await a.tick(NOW + 60_000);
  assert.deepEqual(a.spawns(), [ID, `${ID}-r2`], "10-31 18:00Z is before the cutoff");
  // it ends at S201 and the settlement AT 06:00Z on 11-01 brings none (RED if the cutoff is <=)
  a.end(`${ID}-r2`, { payload: { settlement: 201 } });
  a.settlements.push(S(202, "2026-11-01T06:07:00Z"));
  await a.tick(NOW + 120_000);
  assert.deepEqual(a.spawns(), [ID, `${ID}-r2`], "the settlement at 06:00Z on 11-01 brings none");
  a.settlements.push(S(203, "2026-11-01T18:07:00Z"));
  await a.tick(NOW + 180_000);
  assert.deepEqual(a.spawns(), [ID, `${ID}-r2`], "nor any after it");
  // a settlement that lands late still counts by its own nominal instant
  const late = world({ settlements: [S(200, "2026-10-31T06:10:00Z")] });
  await late.tick(NOW);
  late.end(ID, { payload: { settlement: 200, carried: KEY } });
  late.settlements.push(S(201, "2026-11-01T05:59:00Z"));
  await late.tick(NOW + 60_000);
  assert.deepEqual(late.spawns(), [ID, `${ID}-r2`], "published at 05:59Z the nominal instant is 10-31 18:00Z: before the cutoff");
});

test("a declaration without return_until never comes back, and a bad one comes back as none", async () => {
  const w = world({ named: [decl({ return_until: undefined })], settlements: [S(133, "2026-10-26T18:20:00Z"), S(134, "2026-10-27T06:20:00Z")] });
  await w.tick(NOW);
  w.end(ID, { payload: { settlement: 133, carried: KEY } });
  await w.tick(NOW + 60_000);
  assert.deepEqual(w.spawns(), [ID], "ended, later settlements landed, and still only the one (RED if the generation read ignores return_until)");
  const bad = world({ named: [decl({ return_until: "soon" })], settlements: [S(133, "2026-10-26T18:20:00Z"), S(134, "2026-10-27T06:20:00Z")] });
  await bad.tick(NOW);
  bad.end(ID, { payload: { settlement: 133 } });
  await bad.tick(NOW + 60_000);
  assert.deepEqual(bad.spawns(), [ID]);
});

test("each ending brings the next: generation 3 after generation 2's ending, with the same rule", async () => {
  const w = world({ settlements: [S(133, "2026-10-26T18:20:00Z"), S(134, "2026-10-27T06:20:00Z")] });
  await w.tick(NOW);
  w.end(ID, { payload: { settlement: 133, carried: KEY } });
  await w.tick(NOW + 60_000);
  w.end(`${ID}-r2`, { payload: { settlement: 134 } });
  await w.tick(NOW + 120_000);
  assert.deepEqual(w.spawns(), [ID, `${ID}-r2`], "ended at S134, not yet back");
  w.settlements.push(S(135, "2026-10-27T18:20:00Z"));
  await w.tick(NOW + 180_000);
  assert.deepEqual(w.spawns(), [ID, `${ID}-r2`, `${ID}-r3`]);
});
