// arrival-entries-store.test.mjs — 074 and the arrival tick on a real store
// (WLD-5, POS-618; world2/schema/074_arrival_entries.sql, src/arrival-entries.mjs).
//
// The unit file (test/arrival-entries.test.mjs) drives the tick with its store
// injected. Here the SQL is the store's: the queue, the due probe, the walker's
// current departure read off `acts`, the walk read back and placed by the
// engine's own positionAt, the settle-once trigger, the standpoint's line, and
// the pen's never-twice guard through the real crossing-exec.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { arrivalTick, queueArrival, arrivalLineFor, resetArrivalLines, currentDeparture } from "../src/arrival-entries.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const CLONE = worldClone();
const HAVE = !!CLONE && existsSync(join(CLONE, "tools", "walk.mjs")) && existsSync(join(CLONE, "WORLD"));
const SKIP = !HAVE && (CLONE ? `the world clone at ${CLONE} has no tools/walk.mjs or WORLD/` : NO_WORLD);
const EXEC = fileURLToPath(new URL("../src/crossing-exec.mjs", import.meta.url));
const ferryOf = (ms) => (ms - Date.UTC(2026, 5, 12)) / (12 * 3600 * 1000);

/** A walk act, in the shape the walk door writes (world.mjs § walkEntry), at `ms`. */
async function walkAct(api, { handle, from, toward, ms, within = null, to = null }) {
  const { rows: [r] } = await api.query(
    `INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household)
     VALUES ($1, $2, $3, 'walk', $4, 'move', $5::jsonb, 'the walk is declared', 'ann-house') RETURNING id::text AS id`,
    [new Date(ms).toISOString(), ferryOf(ms), handle, to,
     JSON.stringify({ from, toward, pace: 60, within, to, declared_by: handle })]);
  return r.id;
}

test("074 · a row is settled once, only on its settle columns, and never deleted", async () => {
  const s = await startStore({ db: "arrival_entries_trigger" });
  const api = await s.connect("office_api");
  try {
    const query = async (t, p) => (await api.query(t, p)).rows;
    assert.deepEqual(await queueArrival({ walkActId: "7", handle: "ann", household: "ann-house", mark: "a/room", dueAt: "2026-10-14T18:00:00Z" }, { query }), { queued: true });
    assert.deepEqual(await queueArrival({ walkActId: "7", handle: "ann", mark: "a/room", dueAt: "2026-10-14T18:00:00Z" }, { query }),
      { queued: false, why: "this walk's entry is already queued" });
    await api.query("UPDATE arrival_entries SET settled_at = now(), outcome = 'entered', enter_act_id = 9 WHERE walk_act_id = 7");
    await assert.rejects(api.query("UPDATE arrival_entries SET outcome = 'refused' WHERE walk_act_id = 7"), /already settled/);
    await api.query("INSERT INTO arrival_entries (walk_act_id, handle, mark, due_at) VALUES (8, 'ann', 'a/room', now())");
    await assert.rejects(api.query("UPDATE arrival_entries SET mark = 'a/other' WHERE walk_act_id = 8"), /only the settle columns/);
    await assert.rejects(api.query("DELETE FROM arrival_entries WHERE walk_act_id = 8"), /permission denied/, "the pen holds no DELETE");
    const owner = await s.connect("world2_owner");
    try { await assert.rejects(owner.query("DELETE FROM arrival_entries WHERE walk_act_id = 8"), /never deleted/, "and the trigger refuses even the owner"); }
    finally { await owner.end(); }
    await assert.rejects(api.query("UPDATE arrival_entries SET settled_at = now() WHERE walk_act_id = 8"), /check constraint/, "a settle names its outcome");
  } finally { await api.end(); await s.stop(); }
});

test("THE TICK ON THE STORE · arrived → entered; overtaken by a later walk; still walking → left; and the standpoint's line follows", { skip: SKIP }, async () => {
  const s = await startStore({ db: "arrival_entries_tick" });
  const api = await s.connect("office_api");
  const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = s.url("office_api");
  resetArrivalLines();
  try {
    const query = async (t, p) => (await api.query(t, p)).rows;
    const walkMod = await import(pathToFileURL(join(CLONE, "tools", "walk.mjs")).href);
    const { arrivalOf } = await import("../src/arrival-entries.mjs");
    // an hour ago on the real clock: the refusal half below reads "their next act" off acts.at, which is real time
    const T0 = Date.now() - 3600_000;
    // ann walks 300 m east to a 20 m box; at 60 km per crossing that is 3.6 minutes to its rim
    const annWalk = await walkAct(api, { handle: "ann", from: { x: 0, y: 0 }, toward: { x: 310, y: 0 }, within: { w: 20, h: 20 }, to: "a/room", ms: T0 });
    const annDue = new Date(T0 + 3.6 * 60_000).toISOString();
    await queueArrival({ walkActId: annWalk, handle: "ann", household: "ann-house", mark: "a/room", dueAt: annDue }, { query });
    // bea walks too, then walks again before arriving: overtaken
    const beaWalk = await walkAct(api, { handle: "bea", from: { x: 0, y: 50 }, toward: { x: 300, y: 50 }, ms: T0 });
    await queueArrival({ walkActId: beaWalk, handle: "bea", mark: "b/room", dueAt: annDue }, { query });
    await walkAct(api, { handle: "bea", from: { x: 10, y: 50 }, toward: { x: -300, y: 50 }, ms: T0 + 60_000 });

    assert.equal(await currentDeparture("ann", { query }), annWalk, "the current departure is read off acts, newest by instant then id");

    // the standpoint, while pending: ann's entry shows; bea's overtaken one does not
    const lineNow = await arrivalLineFor("ann", { now: T0 + 1000, query });
    assert.equal(lineNow.enters_on_arrival?.mark, "a/room");
    assert.deepEqual(await arrivalLineFor("bea", { now: T0 + 1000, query }), {}, "an overtaken intent is not on the standpoint");

    // a minute in, nothing is due
    const entered = [];
    const enter = async (r) => { entered.push(r.walk); return { answer: { entered: [r.mark] }, seq: "5001" }; };
    const early = await arrivalTick({ deferredIds: new Map(), now: T0 + 60_000, query, enter, arrival: (r) => arrivalOf(r, { query, now: T0 + 60_000, walkMod }) });
    assert.equal(early.due, 0);

    // due by the clock a second early, but the walk record has not arrived: left
    const edge = await arrivalTick({ deferredIds: new Map(), now: Date.parse(annDue), query, enter, arrival: (r) => arrivalOf(r, { query, now: Date.parse(annDue) - 2000, walkMod }) });
    assert.deepEqual(edge.walking, [annWalk]);
    assert.deepEqual(edge.overtaken, [beaWalk], "bea's later walk overtakes hers, read off the store");

    // arrived: ann is entered, once
    const at = Date.parse(annDue) + 5000;
    const r = await arrivalTick({ deferredIds: new Map(), now: at, query, enter, arrival: (row) => arrivalOf(row, { query, now: at, walkMod }) });
    assert.deepEqual(r.entered, [annWalk]);
    assert.deepEqual(entered, [annWalk]);
    const rows = (await api.query("SELECT walk_act_id::text AS walk, outcome, enter_act_id::text AS act FROM arrival_entries ORDER BY walk_act_id")).rows;
    assert.deepEqual(rows, [{ walk: annWalk, outcome: "entered", act: "5001" }, { walk: beaWalk, outcome: "overtaken", act: null }]);
    assert.equal((await arrivalTick({ deferredIds: new Map(), now: at + 60_000, query, enter })).due, 0, "a settled row is never asked again");

    // a refusal at arrival is on the walker's standpoint until their next act
    // (on the real clock: "their next act" is an act written after the settle's now())
    const cyWalk = await walkAct(api, { handle: "cy", from: { x: 0, y: 90 }, toward: { x: 5, y: 90 }, ms: Date.now() - 60_000 });
    await queueArrival({ walkActId: cyWalk, handle: "cy", mark: "c/room", dueAt: new Date(Date.now() - 30_000).toISOString() }, { query });
    await arrivalTick({ deferredIds: new Map(), now: Date.now(), query, arrival: async () => ({ arrived: true }),
      enter: async () => { throw Object.assign(new Error("c/room is opposed to you"), { code: 422, defect: "c/room is opposed to you" }); } });
    resetArrivalLines();
    const refused = await arrivalLineFor("cy", { now: Date.now(), query });
    assert.equal(refused.arrival?.outcome, "refused");
    assert.equal(refused.arrival.words, "c/room is opposed to you");
    await walkAct(api, { handle: "cy", from: { x: 5, y: 90 }, toward: { x: 9, y: 90 }, ms: Date.now() + 1000 });
    resetArrivalLines();
    assert.deepEqual(await arrivalLineFor("cy", { now: Date.now() + 20_000, query }), {}, "and gone after their next act");

    // A WALK ACT THAT CANNOT BE READ BACK (a payload the record's converter refuses):
    // it stands aside, then expires a day after it fell due, and the walker reads that
    const { rows: [bad] } = await api.query(
      `INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household)
       VALUES ($1, $2, 'dee', 'walk', 'd/room', 'move', '{"note":"no road"}'::jsonb, 'the walk is declared', 'dee-house') RETURNING id::text AS id`,
      [new Date(Date.now() - 2 * 864e5).toISOString(), ferryOf(Date.now() - 2 * 864e5)]);
    await queueArrival({ walkActId: bad.id, handle: "dee", mark: "d/room", dueAt: new Date(Date.now() - 2 * 864e5 + 60_000).toISOString() }, { query });
    const expired = await arrivalTick({ deferredIds: new Map(), now: Date.now(), query, enter: async () => { throw new Error("never asked"); } });
    assert.deepEqual(expired.expired, [bad.id], expired.line);
    resetArrivalLines();
    const deeLine = await arrivalLineFor("dee", { now: Date.now() + 40_000, query });
    assert.equal(deeLine.arrival?.outcome, "expired");
  } finally {
    resetArrivalLines();
    if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
    if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
    await api.end(); await s.stop();
  }
});

test("NEVER TWICE, THROUGH THE PEN · crossing-exec writes an arrival's enter once, and a second run names the first", { skip: SKIP }, async () => {
  const s = await startStore({ db: "arrival_entries_pen" });
  const api = await s.connect("office_api");
  try {
    const grammar = await import(pathToFileURL(join(CLONE, "tools", "enter-exit.mjs")).href);
    const at = grammar.stampAt(ferryOf(Date.now()));
    const line = grammar.formatEnterExit({ handle: "ann", act: "enters", mark: "a/room", at, word: "neutral", iso: new Date().toISOString() });
    const run = (arrival_of) => {
      const out = spawnSync(process.execPath, [EXEC, JSON.stringify({ handle: "ann", act: "enter", at, lines: [line], summary: "enters a/room", mark: "a/room", ...(arrival_of ? { arrival_of } : {}) })], {
        env: { ...process.env, WORLD_CLONE: CLONE, WORLD_SINGLE_LOG: "1", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }, encoding: "utf8" });
      return JSON.parse(out.stdout.trim().split("\n").at(-1));
    };
    const walkA = await walkAct(api, { handle: "ann", from: { x: 0, y: 0 }, toward: { x: 100, y: 0 }, ms: Date.now() - 60_000 });
    const first = run(walkA);
    assert.ok(first.seq, `the first enter was written: ${JSON.stringify(first).slice(0, 200)}`);
    const second = run(walkA);
    assert.equal(second.error?.code, 409);
    assert.equal(second.error.arrival_settled, String(first.seq), "the refusal names the enter that stands");
    const rows = (await api.query("SELECT id::text AS id, payload->>'arrival_of' AS arrival_of FROM acts WHERE actor = 'ann' AND action = 'enter'")).rows;
    assert.deepEqual(rows, [{ id: String(first.seq), arrival_of: walkA }], "one enter, carrying its walk");

    // THE G4 RACE, IN THE PEN: bea's walk A is queued, then walk B reaches the
    // record (as during the town-lock wait); the entry for A is refused inside the
    // write's own transaction, and nothing is written
    const beaA = await walkAct(api, { handle: "bea", from: { x: 0, y: 10 }, toward: { x: 100, y: 10 }, ms: Date.now() - 60_000 });
    await walkAct(api, { handle: "bea", from: { x: 50, y: 10 }, toward: { x: -100, y: 10 }, ms: Date.now() - 1000 });
    const beaLine = grammar.formatEnterExit({ handle: "bea", act: "enters", mark: "a/room", at, word: "neutral", iso: new Date().toISOString() });
    const raced = JSON.parse(spawnSync(process.execPath, [EXEC, JSON.stringify({ handle: "bea", act: "enter", at, lines: [beaLine], summary: "enters a/room", mark: "a/room", arrival_of: beaA })], {
      env: { ...process.env, WORLD_CLONE: CLONE, WORLD_SINGLE_LOG: "1", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }, encoding: "utf8" }).stdout.trim().split("\n").at(-1));
    assert.equal(raced.error?.arrival_overtaken, true, JSON.stringify(raced).slice(0, 300));
    assert.equal((await api.query("SELECT count(*)::int AS n FROM acts WHERE actor = 'bea' AND action = 'enter'")).rows[0].n, 0, "nothing written for the overtaken walk");
    const plain = run(null);
    assert.ok(plain.seq, "an ordinary enter carries no arrival_of and is never guarded");
  } finally { await api.end(); await s.stop(); }
});
