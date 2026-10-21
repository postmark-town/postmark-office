// creature-tick.test.mjs — the creatures' clock (WLD-56 part 3; src/creature-tick.mjs).
//
// RULED (Darko, 2026-10-15 12:09 EDT, D1–D6): a wolf 2, a raven 4 and a bat 3 a
// window at seeded minutes, each lasting 12 h from its own minute. The window's
// inputs are the WORLD's, read at the pinned clone's sha through the same
// materializer the tick uses at the blessed ref: the class marks, the kind files,
// the skeleton and the marks. The store is an in-memory `acts` the seams drive.
// With no world clone the cases skip and say why.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ABANDON_ACTION, CREATURE_TICK_MS, LOOKBACK_MS, PRIOR_ROW_SQL, REVEAL_ACTION, SEED_ACTION, TICK_ACTIONS, keyFingerprint,
  creatureTick, startCreatureTick, stopCreatureTick, townRow, windowInputsAt, windowObject, writeOnce,
} from "../src/creature-tick.mjs";
import { currentCrossing } from "../src/crossings.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);
const PIN = JSON.parse(readFileSync(new URL("./clone-pins.json", import.meta.url), "utf8")).world.sha;
const KEY = "a test master key, never the box's";
const RAW = NO_WORLD ? null : await windowInputsAt(PIN, { repo: worldClone() });
// THE CASES FIX THEIR OWN DIALS (POS-672, the pin moving past WLD-56's tease and
// ramp): the law at the pin moves with rulings (one a window in rotation from
// 10-17, the ramp from 10-21), and these cases test the clock, not the law's
// numbers, so they run on the numbers they were written for (D2, 10-15: a wolf
// 2, a raven 4, a bat 3), no rotation, the launch dial off. The pin's law is
// still read whole (the first case); the world's own suite tests its numbers.
const FIXED = { counts: { bat: 3, raven: 4, wolf: 2 } };
const fixed = (w) => {
  const { rotation: _r, ...dials } = { ...w.law.dials, ...FIXED };
  return { ...w, law: { ...w.law, fromCrossing: null, dials }, inputs: { ...w.inputs, fromCrossing: null, dials } };
};
const W = NO_WORLD ? null : fixed(RAW);
/** The pin's law with the launch dial turned on from `from` (the pin's own dial is null: off). */
const on = (from = 270, w = W) => ({ ...w, law: { ...w.law, fromCrossing: from }, inputs: { ...w.inputs, fromCrossing: from } });
const N = 271;
const { startMs, endMs } = NO_WORLD ? {} : W.creaturesMod.windowOf(N);
const MIN = 60_000;

/** An in-memory `acts`: the tick's read, and a write that holds (action, object) once, as writeOnce does. */
function store() {
  const acts = [];
  let id = 1000;
  return {
    acts,
    query: async (sql, [actions, since]) => {
      assert.match(sql, /class = 'creature'/);
      return acts.filter((a) => actions.includes(a.action) && Date.parse(a.at) > Date.parse(since)).map((a) => ({ ...a, payload: JSON.stringify(a.payload) }));
    },
    write: async (row) => {
      const prior = acts.find((a) => a.action === row.action && a.object === row.object);
      if (prior) return { prior: true, row: prior };
      const r = { id: String(++id), at: row.written_at, actor: row.actor, action: row.action, object: row.object,
        payload: JSON.parse(row.payload), class: row.class, crossing: row.crossing, at_dx: row.at_dx, at_dy: row.at_dy };
      acts.push(r);
      return { prior: false, row: r };
    },
  };
}
const tickAt = (s, now, over = {}) => creatureTick({ now, key: KEY, query: s.query, write: s.write,
  inputsAt: async () => on(), blessed: () => PIN, ...over });
/** Run the clock through [from, to] every `step`. */
async function runThrough(s, from, to, step = 10 * MIN, over = {}) {
  for (let t = from; t <= to; t += step) await tickAt(s, t, over);
}

test("the window's inputs are the world's, read at a sha: the ruled law, the kinds' start states, the Mists and the marks", () => {
  assert.equal(W.sha, PIN);
  assert.deepEqual(Object.keys(RAW.law.dials.counts).sort(), ["bat", "raven", "wolf"], "the pin's law, read whole: the three kinds");
  assert.ok(RAW.law.fromCrossing === null || Number.isInteger(RAW.law.fromCrossing), "its launch dial, off or a crossing");
  assert.deepEqual(W.law.dials.counts, { bat: 3, raven: 4, wolf: 2 }, "the cases' own numbers");
  assert.deepEqual(W.starts.wolf, { moods: { fear: 1, curiosity: 1, hunger: 2 }, flags: [] });
  assert.deepEqual(W.starts.raven.moods, { fear: 1, curiosity: 2, hunger: 1 });
  assert.ok(W.inputs.mists?.clear || W.inputs.mists?.schedule, "the skeleton's Mists");
  assert.ok(W.inputs.marks.length > 1000, "the town's marks, for the keep-out");
  assert.equal(W.inputs.world_sha, PIN);
});

test("off by the launch dial, or with no key: nothing is seeded or spawned", async () => {
  const s = store();
  const r = await tickAt(s, startMs + MIN, { inputsAt: async () => W });
  assert.deepEqual([r.wrote, s.acts.length], [{ seed: 0, spawn: 0, fade: 0, reveal: 0, abandon: 0 }, 0], "the pin's dial is null");
  const k = await tickAt(s, startMs + MIN, { key: null });
  assert.deepEqual([k.wrote, s.acts.length], [{ seed: 0, spawn: 0, fade: 0, reveal: 0, abandon: 0 }, 0], "no key: no seed, even with the dial on");
  assert.match(k.line, /no key \(fades only\)/);
  const n = await tickAt(s, startMs + MIN, { query: async () => null });
  assert.match(n.line, /not switched on/);
});

test("fades need no key: a creature out when the key goes is still faded at its span, once (review of #572, L3)", async () => {
  const s = store();
  await runThrough(s, startMs, endMs - 1);
  const spawns = s.acts.filter((a) => a.action === "spawn");
  assert.equal(spawns.length, 9);
  await runThrough(s, endMs, endMs + 13 * 3600_000, 15 * MIN, { key: null });
  assert.equal(s.acts.some((a) => a.action === SEED_ACTION && a.payload.crossing !== N), false, "no key: no new window");
  assert.equal(s.acts.some((a) => a.action === REVEAL_ACTION), false, "and no reveal, which needs the key");
  for (const sp of spawns) assert.equal(s.acts.filter((a) => a.action === "withdraw" && a.object === sp.object).length, 1, `${sp.object} faded without the key`);
});

test("a window: seeded first, each spawn at its minute and once, the reveal after it closes, and the world's audit passes", async () => {
  const s = store();
  const sched = W.creaturesMod.scheduleFor(N, W.creaturesMod.secretFor(KEY, N), on().inputs);
  assert.equal(sched.spawns.length, 9);
  const first = await tickAt(s, startMs);
  assert.equal(first.wrote.seed, 1);
  const seed = s.acts.find((a) => a.action === SEED_ACTION);
  assert.deepEqual(seed.payload, { crossing: N, world_sha: PIN, commitment: W.creaturesMod.commitmentOf(W.creaturesMod.secretFor(KEY, N), PIN), key_fingerprint: keyFingerprint(KEY) });
  assert.equal(seed.object, windowObject(N));
  await runThrough(s, startMs, endMs - 1);
  const spawns = s.acts.filter((a) => a.action === "spawn");
  assert.deepEqual(spawns.map((a) => a.object).sort(), sched.spawns.map((x) => x.id).sort(), "every scheduled spawn, once");
  for (const a of spawns) {
    const x = sched.spawns.find((y) => y.id === a.object);
    assert.ok(Date.parse(a.at) >= x.at_ms && Date.parse(a.at) < x.at_ms + 10 * MIN, `${a.object} written at its minute, not before`);
    assert.deepEqual(a.payload, { kind: x.kind, crossing: N, x: x.x, y: x.y, at: x.at, fades_at: x.fades_at, moods: W.starts[x.kind].moods, flags: [] });
    assert.deepEqual([a.at_dx, a.at_dy], [x.x, x.y], "the row stands where the creature does");
  }
  assert.equal(s.acts.some((a) => a.action === REVEAL_ACTION), false, "nothing is revealed while the window is open");
  await tickAt(s, endMs + 5000);
  const reveal = s.acts.find((a) => a.action === REVEAL_ACTION);
  assert.deepEqual(reveal.payload, { crossing: N, secret: W.creaturesMod.secretFor(KEY, N) });
  const audit = W.creaturesMod.auditWindow(N, s.acts, on().inputs);
  assert.deepEqual(audit, { ok: true, problems: [] }, "anyone holding the log re-derives the window");
  for (const a of s.acts) {
    assert.equal(a.class, "creature", "R6: every row the tick writes is class creature");
    assert.equal(a.actor, "the-town");
    assert.equal(a.crossing, currentCrossing(Date.parse(a.at)), "each files in the window it was written in");
  }
});

test("hidden until each spawn: the record holds only what is due", async () => {
  const s = store();
  const sched = W.creaturesMod.scheduleFor(N, W.creaturesMod.secretFor(KEY, N), on().inputs);
  const mid = sched.spawns[4].at_ms;
  await runThrough(s, startMs, mid);
  const written = new Set(s.acts.filter((a) => a.action === "spawn").map((a) => a.object));
  for (const x of sched.spawns) assert.equal(written.has(x.id), x.at_ms <= mid, `${x.id} ${x.at_ms <= mid ? "is" : "is not yet"} in the record`);
});

test("the fades: each 12 h after its own minute, by the-town, once; a fled creature never fades", async () => {
  const s = store();
  await runThrough(s, startMs, endMs + 13 * 3600_000, 15 * MIN);
  const spawns = s.acts.filter((a) => a.action === "spawn");
  const mine = spawns.filter((a) => a.payload.crossing === N);
  const fades = s.acts.filter((a) => a.action === "withdraw");
  assert.equal(mine.length, 9);
  for (const sp of mine) assert.equal(fades.filter((f) => f.object === sp.object).length, 1, `${sp.object} faded once`);
  for (const f of fades) {
    const sp = spawns.find((a) => a.object === f.object);
    assert.deepEqual(f.payload, { reason: "faded", fades_at: sp.payload.fades_at });
    assert.ok(Date.parse(f.at) >= Date.parse(sp.payload.fades_at) && Date.parse(f.at) < Date.parse(sp.payload.fades_at) + 15 * MIN);
  }
  // a creature that fled (its own withdraw, POS-637) is not faded after
  const t = store();
  await runThrough(t, startMs, endMs - 1);
  const one = t.acts.find((a) => a.action === "spawn");
  t.acts.push({ id: "9", at: new Date(Date.parse(one.payload.at) + 5 * MIN).toISOString(), actor: one.object, action: "withdraw", object: one.object, payload: { reason: "fled" } });
  await runThrough(t, endMs, endMs + 13 * 3600_000, 15 * MIN);
  assert.equal(t.acts.filter((a) => a.action === "withdraw" && a.object === one.object).length, 1, "fled is its only leaving");
});

test("never twice: a rerun, a restart and a second office write nothing new", async () => {
  const s = store();
  await runThrough(s, startMs, endMs + 3600_000);
  const n = s.acts.length;
  await runThrough(s, startMs, endMs + 3600_000);
  assert.equal(s.acts.length, n, "the same ticks again write nothing");
  await Promise.all([tickAt(s, endMs + 2 * 3600_000), tickAt(s, endMs + 2 * 3600_000)]);
  const keys = s.acts.map((a) => `${a.action}|${a.object}`);
  assert.equal(new Set(keys).size, keys.length, "two offices at once: each (action, object) once");
});

test("writeOnce: the lock and the look come first, in one transaction, and a row the record holds is not written again", async () => {
  const row = townRow({ action: "spawn", object: "creature:wolf-271-1", payload: { kind: "wolf" }, place: { x: 1, y: 2 }, now: startMs, effect: "a wolf" });
  const calls = [];
  const client = (prior) => ({ query: async (sql, params) => { calls.push([sql, params]); return { rows: sql === PRIOR_ROW_SQL && prior ? [prior] : [] }; } });
  let txns = 0, inserted = 0;
  const deps = (prior) => ({ officeWrite: async (fn) => { txns += 1; return fn(client(prior)); }, insertAct: async () => { inserted += 1; return 77; } });
  const w = await writeOnce(row, deps(null));
  assert.deepEqual([w.prior, w.row.id, w.row.payload, txns, inserted], [false, "77", { kind: "wolf" }, 1, 1]);
  assert.match(calls[0][0], /pg_advisory_xact_lock/);
  assert.deepEqual(calls[0][1], ["creature-tick:spawn:creature:wolf-271-1"]);
  assert.deepEqual(calls[1], [PRIOR_ROW_SQL, ["spawn", "creature:wolf-271-1"]]);
  const again = await writeOnce(row, deps({ id: 70, at: new Date(startMs), actor: "the-town", action: "spawn", object: "creature:wolf-271-1", payload: { kind: "wolf" } }));
  assert.deepEqual([again.prior, again.row.id, inserted], [true, "70", 1], "the prior row answers; nothing is inserted");
});

test("a window is derived at its seed's sha: a blessing that lands mid-window moves no spawn", async () => {
  const s = store();
  await tickAt(s, startMs);
  const asked = [];
  const other = "0".repeat(40);
  await runThrough(s, startMs, endMs - 1, 30 * MIN, {
    blessed: () => other,
    inputsAt: async (sha) => { asked.push(sha); return sha === PIN ? on() : { ...on(), sha: other, inputs: { ...on().inputs, marks: [], world_sha: other } }; },
  });
  assert.ok(asked.includes(PIN), "the window's spawns are read at the seed's sha");
  assert.deepEqual(W.creaturesMod.auditWindow(N, [...s.acts, { at: new Date(endMs + 1).toISOString(), actor: "the-town", action: "reveal", object: windowObject(N), payload: { crossing: N, secret: W.creaturesMod.secretFor(KEY, N) } }], on().inputs).problems, []);
});

test("a key rotated mid-window: one abandon row with both fingerprints, said once; no more spawns, no reveal; its creatures still fade (L2)", async () => {
  const s = store();
  const sched = W.creaturesMod.scheduleFor(N, W.creaturesMod.secretFor(KEY, N), on().inputs);
  const mid = sched.spawns[3].at_ms;
  await runThrough(s, startMs, mid);
  await tickAt(s, mid);
  const before = s.acts.filter((a) => a.action === "spawn").map((a) => a.object);
  assert.equal(before.length, 4);
  const faults = [];
  const err = console.error;
  console.error = (...a) => faults.push(a.join(" "));
  let first;
  try {
    first = await tickAt(s, mid + MIN, { key: "another key" });
    await runThrough(s, mid + 2 * MIN, endMs + 13 * 3600_000, 15 * MIN, { key: "another key" });
  } finally { console.error = err; }
  const abandon = s.acts.filter((a) => a.action === ABANDON_ACTION);
  assert.equal(abandon.length, 1, "abandoned once");
  assert.deepEqual(abandon[0].payload, { crossing: N, reason: "the seed key changed mid-window", seed_key_fingerprint: keyFingerprint(KEY), key_fingerprint: keyFingerprint("another key") });
  assert.equal(abandon[0].object, windowObject(N));
  assert.match(first.held.join(" "), /does not match the seed's commitment.*abandoned/);
  assert.equal(faults.filter((l) => /abandoned/.test(l)).length, 1, "the fault is logged once, not every 30 s");
  assert.deepEqual(s.acts.filter((a) => a.action === "spawn" && a.payload.crossing === N).map((a) => a.object), before, "no spawn the commitment does not cover");
  assert.equal(s.acts.some((a) => a.action === REVEAL_ACTION && a.payload.crossing === N), false, "no reveal of an abandoned window");
  for (const id of before) assert.equal(s.acts.filter((a) => a.action === "withdraw" && a.object === id).length, 1, `${id} still fades`);
  const next = s.acts.find((a) => a.action === SEED_ACTION && a.payload.crossing === N + 1);
  assert.equal(next.payload.key_fingerprint, keyFingerprint("another key"), "the next window is seeded by the new key, and the log says which");
});

test("the key's fingerprint: each seed names its key without telling it (L1)", async () => {
  const s = store();
  await tickAt(s, startMs);
  await tickAt(s, endMs + MIN, { key: "a second key" });
  const [a, b] = [N, N + 1].map((M) => s.acts.find((r) => r.action === SEED_ACTION && r.payload.crossing === M).payload.key_fingerprint);
  assert.equal(a, keyFingerprint(KEY));
  assert.equal(b, keyFingerprint("a second key"));
  assert.notEqual(a, b, "a key changed between windows shows in the record");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, W.creaturesMod.secretFor(KEY, N), "nor is it any window's secret");
  assert.ok(!JSON.stringify(s.acts).includes(KEY), "the key itself is never written");
});

test("the clock starts only in a writer with a store, a port and the key, and not when the operator says off", () => {
  const log = { log: () => {}, error: () => {} };
  const tick = async () => ({ wrote: { seed: 0, spawn: 0, fade: 0, reveal: 0 }, held: [], line: "" });
  const env = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://nowhere", CREATURE_SEED_KEY: "k" };
  assert.equal(startCreatureTick({ port: 0, env, log, tick }), false, "a suite's office");
  assert.equal(startCreatureTick({ port: 3000, env: { ...env, CREATURE_TICK: "off" }, log, tick }), false);
  assert.equal(startCreatureTick({ port: 3000, env: { CREATURE_SEED_KEY: "k" }, log, tick }), false, "no store");
  assert.equal(startCreatureTick({ port: 3000, env, log, tick }), true);
  assert.equal(startCreatureTick({ port: 3000, env, log, tick }), false, "idempotent");
  stopCreatureTick();
  const seen = [];
  assert.equal(startCreatureTick({ port: 3000, env: { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://nowhere" }, log: { log: (l) => seen.push(l) },
    tick: async (o) => { seen.push(`key ${o.key}`); return { wrote: { seed: 0, spawn: 0, fade: 0, reveal: 0, abandon: 0 }, held: [], line: "" }; } }), true, "no key: it starts, for the fades");
  stopCreatureTick();
  assert.match(seen.join(" | "), /no CREATURE_SEED_KEY .*the fades still run \| key null/);
  assert.ok(CREATURE_TICK_MS <= 60_000, "a spawn is written within a minute of its own");
  assert.ok(LOOKBACK_MS >= 13 * 3600_000);
  assert.deepEqual([...TICK_ACTIONS].sort(), ["abandon", "reveal", "seed", "spawn", "withdraw"]);
});
