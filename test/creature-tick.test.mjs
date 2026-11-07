// creature-tick.test.mjs — the creatures' clock (WLD-56 part 3; src/creature-tick.mjs).
//
// RULED (Darko, 2026-10-15 12:09 EDT, D1–D6): creatures out a window at seeded
// minutes, each lasting 12 h from its own minute. RE-RULED 2026-10-17 13:58 EDT
// (world 9acaff9b, WLD-56 on LOGOS v2 part 2): ONE creature a window from
// crossing 259, the kinds in turn (bat, raven, wolf), each kind's count 1.
// RE-RULED 2026-10-19 20:05 EDT (WLD-84, the ramp, world #258): from the 10-21
// settlement every kind every window, 2 bats, 3 ravens and 1 wolf, the rotation
// written null. The first case pins that law at the clone's sha (world main
// b81aa6f7b since POS-672's re-pin). The mechanism cases (a window's
// order, what is hidden, a key rotated mid-window) need several spawns in one
// window, so they run the pin's law with every kind out at once and no rotation
// (`many`): the old 10-15 counts, under a rotation written null, which the
// law reads as lawful (tools/creatures.mjs § creatureLaw). WLD-96 (Darko,
// 2026-10-21 19:39 and 19:41 EDT): the fade is gone, the Mists creatures gather
// until one flees. The window's
// inputs are the WORLD's, read at the pinned clone's sha through the same
// materializer the tick uses at the blessed ref: the class marks, the kind files,
// the skeleton and the marks. The store is an in-memory `acts` the seams drive.
// With no world clone the cases skip and say why.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ABANDON_ACTION, CREATURE_TICK_MS, LOOKBACK_MS, PRIOR_ROW_SQL, REVEAL_ACTION, SEED_ACTION, TICK_ACTIONS, keyFingerprint,
  creatureTick, startCreatureTick, stopCreatureTick, townRow, windowInputsAt, windowObject, writeOnce, UNSEAL_DUE_SQL, THING_STANDING_SQL,
} from "../src/creature-tick.mjs";
import { currentCrossing } from "../src/crossings.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);
const PIN = JSON.parse(readFileSync(new URL("./clone-pins.json", import.meta.url), "utf8")).world.sha;
const KEY = "a test master key, never the box's";
const W = NO_WORLD ? null : await windowInputsAt(PIN, { repo: worldClone() });
/** The pin's law with every kind out in one window and no rotation: the 10-15 counts, for the mechanism cases. */
const MANY = { bat: 3, raven: 4, wolf: 2 };
// `named: []` (POS-896): these mechanism cases are about the window's seeded spawns. Until the world declared named creatures that CARRY a thing
// (the candied kinds, from crossing 272), the pin's law had none, so a tick past the window's end had no named creature to spawn or hold; the fixture
// says so explicitly instead of inheriting whatever the pinned world declares. The named path has its own cases below.
const many = (w) => ({ ...w, law: { ...w.law, named: [], dials: { ...w.law.dials, counts: MANY, rotation: null } }, inputs: { ...w.inputs, dials: { ...w.inputs.dials, counts: MANY, rotation: null } } });
/** That law with the launch dial at `from`. */
const on = (from = 270, w = W) => { const m = many(w); return { ...m, law: { ...m.law, fromCrossing: from }, inputs: { ...m.inputs, fromCrossing: from } }; };
/** The pin's own law with the launch dial written null: off. */
const off = (w = W) => ({ ...w, law: { ...w.law, fromCrossing: null }, inputs: { ...w.inputs, fromCrossing: null } });
/** The pin's own law with ONLY the launch dial turned on (POS-896): its counts, rotation and named declarations stay the world's. `on()` is not this: it
 *  goes through `many()` and changes the counts to 3/4/2. */
const ramp = (from = 259, w = W) => ({ ...w, law: { ...w.law, fromCrossing: from }, inputs: { ...w.inputs, fromCrossing: from } });
/** A law with exactly these named declarations and the launch dial off, so the window's schedule seeds nothing and only the named path runs. */
const withNamed = (named, w = W) => ({ ...off(w), law: { ...off(w).law, named } });
const N = 271;
const { startMs, endMs } = NO_WORLD ? {} : W.creaturesMod.windowOf(N);
const MIN = 60_000;
/** An invented named creature that CARRIES a thing, due from this window (a fake place and a fake key id; nothing real is read or held). */
const NAMED = { id: "creature:bat-the-test-room", kind: "bat", x: 120, y: -340, carries: "the-town/a-test-room-key", from_crossing: N };

/** An in-memory `acts`: the tick's read, and a write that holds (action, object) once, as writeOnce does. */
function store() {
  const acts = [];
  let id = 1000;
  return {
    acts,
    query: async (sql, [actions, since]) => {
      assert.match(sql, /class = 'creature'/);
      if (sql === UNSEAL_DUE_SQL) return []; // no creature here tells (POS-712)
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
  // THE RAMP KINDS, from the ruling (spelled here, not read back from the law): 2 bats, 3 ravens, 1 wolf. EVERY OTHER KIND the law declares brings none
  // a window (POS-896): the candied kinds are named creatures, declared once in their own rooms and never a window's spawn (their count_per_window is 0).
  // A nonzero count on any other kind is not ignored: it reds here.
  const RAMP = { bat: 2, raven: 3, wolf: 1 };
  const counts = W.law.dials.counts;
  assert.deepEqual(Object.fromEntries(Object.keys(RAMP).map((k) => [k, counts[k]])), RAMP, "every ramp kind every window: 2 bats, 3 ravens, 1 wolf (Darko, 10-19 20:05, WLD-84)");
  assert.deepEqual(Object.entries(counts).filter(([k, n]) => !(k in RAMP) && n !== 0), [], "every other declared kind has window count 0 (named creatures, never a window's spawn)");
  assert.equal(W.law.dials.rotation, undefined, "no rotation: the ramp writes it null");
  // THE LAUNCH DIAL IS OFF AT THIS PIN (WLD-142; world commit d4dce118, "the creature class's launch dial is null after Halloween (Darko 2026-10-31 23:01 EDT)").
  // It was 259 until then. This asserts the pinned law's published state; it is no permission to switch the creatures on.
  assert.equal(W.law.fromCrossing, null, "the pinned law's launch dial is null (off): WLD-142, Darko 2026-10-31 23:01 EDT");
  // the pin's own counts, through the world's scheduler with ONLY the launch dial turned on: every window brings all six
  for (const M of [259, 262, 271]) {
    const sched = W.creaturesMod.scheduleFor(M, W.creaturesMod.secretFor(KEY, M), ramp().inputs);
    const n = (k) => sched.spawns.filter((x) => x.kind === k).length;
    assert.deepEqual([n("bat"), n("raven"), n("wolf")], [2, 3, 1], `window ${M} brings 2 bats, 3 ravens and a wolf`);
  }
  assert.deepEqual(W.starts.wolf, { moods: { fear: 1, curiosity: 1, hunger: 2 }, flags: [] });
  assert.deepEqual(W.starts.raven.moods, { fear: 1, curiosity: 2, hunger: 1 });
  assert.ok(W.inputs.mists?.clear || W.inputs.mists?.schedule, "the skeleton's Mists");
  assert.ok(W.inputs.marks.length > 1000, "the town's marks, for the keep-out");
  assert.equal(W.inputs.world_sha, PIN);
});

test("the pin's own counts through the tick, the launch dial turned on and nothing else: every kind in the window, at its count (the ramp, WLD-84)", async () => {
  // Until WLD-142 the pin's own law WAS on (259), and this drove it as published. It is off now (see the first case), so the dial is the one thing this
  // fixture turns on (`ramp()`); the counts, the rotation and the named declarations are the world's, unchanged. Not `on()`, which changes the counts.
  const s = store();
  await runThrough(s, startMs, endMs - 1, 10 * MIN, { inputsAt: async () => ramp() });
  const spawns = s.acts.filter((a) => a.action === "spawn");
  const n = (k) => spawns.filter((a) => a.payload.kind === k).length;
  assert.deepEqual([n("bat"), n("raven"), n("wolf")], [2, 3, 1], `window ${N}: 2 bats, 3 ravens and a wolf`);
  assert.equal(spawns.length, 6, "and nothing else comes out of the window (the candied kinds are no window's spawn)");
});

test("the pin's own law as published is OFF: the original window is neither seeded nor spawned into (WLD-142), the control for the case above", async () => {
  const s = store();
  await runThrough(s, startMs, endMs - 1, 10 * MIN, { inputsAt: async () => W });
  assert.deepEqual(s.acts.filter((a) => a.action === SEED_ACTION || a.action === "spawn"), [], `window ${N}: no seed and no spawn under the law as the pin publishes it`);
  // and the dial is the whole difference: the same window, the same ticks, with only the launch dial on, seeds and spawns
  const on259 = store();
  await runThrough(on259, startMs, endMs - 1, 10 * MIN, { inputsAt: async () => ramp() });
  assert.equal(on259.acts.some((a) => a.action === SEED_ACTION), true, "the control can seed: only the dial moved");
});

test("off by the launch dial, or with no key: nothing is seeded or spawned", async () => {
  const s = store();
  const r = await tickAt(s, startMs + MIN, { inputsAt: async () => off() });
  assert.deepEqual([r.wrote, s.acts.length], [{ seed: 0, spawn: 0, reveal: 0, abandon: 0, unseal: 0 }, 0], "a launch dial written null");
  const k = await tickAt(s, startMs + MIN, { key: null });
  assert.deepEqual([k.wrote, s.acts.length], [{ seed: 0, spawn: 0, reveal: 0, abandon: 0, unseal: 0 }, 0], "no key: no seed, even with the dial on");
  assert.match(k.line, /no key \(no window is seeded\)/);
  const n = await tickAt(s, startMs + MIN, { query: async () => null });
  assert.match(n.line, /not switched on/);
});

test("WLD-96: the Mists creatures gather: past 12 h, with the key or without, no fade is written and no spawn names one", async () => {
  const s = store();
  await runThrough(s, startMs, endMs - 1);
  const spawns = s.acts.filter((a) => a.action === "spawn");
  assert.equal(spawns.length, 9);
  for (const sp of spawns) assert.equal("fades_at" in sp.payload, false, `${sp.object} is written with no fade`);
  await runThrough(s, endMs, endMs + 13 * 3600_000, 15 * MIN);
  await runThrough(s, endMs + 13 * 3600_000, endMs + 26 * 3600_000, 15 * MIN, { key: null });
  assert.equal(s.acts.some((a) => a.action === "withdraw"), false, "no creature is withdrawn: they gather");
  // a creature out before this deployed carries a fade on its spawn: it gathers too
  const t = store();
  const old = W.creaturesMod.scheduleFor(N, W.creaturesMod.secretFor(KEY, N), on().inputs).spawns[0];
  t.acts.push({ id: "1", at: old.at, actor: "the-town", action: "spawn", object: old.id, class: "creature",
    payload: { kind: old.kind, crossing: N, x: old.x, y: old.y, at: old.at, fades_at: old.fades_at, moods: {}, flags: [] } });
  await runThrough(t, Date.parse(old.fades_at) - MIN, Date.parse(old.fades_at) + 13 * 3600_000, 15 * MIN, { key: null });
  assert.equal(t.acts.some((a) => a.action === "withdraw"), false, "the fade an older spawn names is not acted on");
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
    assert.deepEqual(a.payload, { kind: x.kind, crossing: N, x: x.x, y: x.y, at: x.at, moods: W.starts[x.kind].moods, flags: [] });
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

test("flee still ends one: a creature that fled has its own withdraw only, and the tick adds none (WLD-96)", async () => {
  // a creature that fled (its own withdraw, POS-637) is never withdrawn again
  const t = store();
  await runThrough(t, startMs, endMs - 1);
  const one = t.acts.find((a) => a.action === "spawn");
  t.acts.push({ id: "9", at: new Date(Date.parse(one.payload.at) + 5 * MIN).toISOString(), actor: one.object, action: "withdraw", object: one.object, payload: { reason: "fled" } });
  await runThrough(t, endMs, endMs + 13 * 3600_000, 15 * MIN);
  assert.equal(t.acts.filter((a) => a.action === "withdraw" && a.object === one.object).length, 1, "fled is its only leaving");
  assert.equal(t.acts.filter((a) => a.action === "withdraw").length, 1, "and the rest gather");
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

test("a key rotated mid-window: one abandon row with both fingerprints, said once; no more spawns, no reveal; its creatures gather (L2, WLD-96)", async () => {
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
  for (const id of before) assert.equal(s.acts.filter((a) => a.action === "withdraw" && a.object === id).length, 0, `${id} gathers`);
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

// ── A NAMED CREATURE THAT CARRIES A THING (WLD-25; POS-896) ──────────────────────────────────────────────────────
// The world now declares named creatures that carry a key (the candied kinds, from crossing 272); at the old pin it declared none, so the cases above
// never reached the tick's hold path. It is driven here through the tick's own `hold` seam (holdTown's shape) with an INVENTED declaration and a fake key
// id: no real town key, holding or service is read or written. The window's schedule is off (`withNamed` turns the dial off), so only the named path runs.

/** A spy with holdTown's shape: what it was asked, and a store-free answer. */
function holdSpy() {
  const calls = [];
  return { calls, hold: async (thing, creatureId, opts = {}) => { calls.push({ thing, creatureId, now: opts.now }); return { wrote: false }; } };
}
const spawnsOf = (s) => s.acts.filter((a) => a.action === "spawn");

test("a named creature that carries a thing: written once, and the hold seam is asked once, for that thing and that creature", async () => {
  const s = store();
  const spy = holdSpy();
  const r = await tickAt(s, startMs + MIN, { inputsAt: async () => withNamed([NAMED]), hold: spy.hold });
  assert.equal(r.wrote.spawn, 1);
  assert.deepEqual(spawnsOf(s).map((a) => a.object), [NAMED.id], "the declaration's own id, once");
  const [row] = spawnsOf(s);
  assert.equal(row.payload.kind, NAMED.kind);
  assert.equal(row.payload.carries, NAMED.carries, "the spawn row names what it carries");
  assert.equal(row.payload.stays, true, "a named creature stays until its settlement ends it");
  assert.deepEqual(spy.calls.map((c) => [c.thing, c.creatureId, c.now]), [[NAMED.carries, NAMED.id, startMs + MIN]], "asked once: what it carries, whose it is, when");
  await tickAt(s, startMs + 2 * MIN, { inputsAt: async () => withNamed([NAMED]), hold: spy.hold });
  assert.equal(spawnsOf(s).length, 1, "a later tick writes it no second time (writeOnce)");
});

test("the same law with no named declaration asks the hold seam nothing and writes no named creature (the control)", async () => {
  const s = store();
  const spy = holdSpy();
  const r = await tickAt(s, startMs + MIN, { inputsAt: async () => withNamed([]), hold: spy.hold });
  assert.deepEqual([r.wrote.spawn, spy.calls.length, spawnsOf(s).length], [0, 0, 0]);
});

test("a named creature is due from its own crossing, not before: a declaration for the next window waits for it", async () => {
  const later = { ...NAMED, from_crossing: N + 1 };
  const s = store();
  const spy = holdSpy();
  await tickAt(s, startMs + MIN, { inputsAt: async () => withNamed([later]), hold: spy.hold });
  assert.deepEqual([spy.calls.length, spawnsOf(s).length], [0, 0], `crossing ${N}: not yet due`);
  await tickAt(s, endMs + MIN, { inputsAt: async () => withNamed([later]), hold: spy.hold });
  assert.deepEqual([spy.calls.map((c) => c.creatureId), spawnsOf(s).map((a) => a.object)], [[NAMED.id], [NAMED.id]], `crossing ${N + 1}: due, written and held`);
});

test("the standing check holdTown makes is a read of `marks`, not of the creature acts (a CONSTANT pin: the seam above is a spy, so this proves no SQL ran)", () => {
  assert.match(THING_STANDING_SQL, /FROM marks WHERE slug = \$1 AND status = 'standing'/);
  assert.ok(!/class = 'creature'/.test(THING_STANDING_SQL), "it is a marks read; the store's strict creature-class assertion is for the acts reads and stays as it is");
});

test("the clock starts only in a writer with a store, a port and the key, and not when the operator says off", () => {
  const log = { log: () => {}, error: () => {} };
  const tick = async () => ({ wrote: { seed: 0, spawn: 0, reveal: 0 }, held: [], line: "" });
  const env = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://nowhere", CREATURE_SEED_KEY: "k" };
  assert.equal(startCreatureTick({ port: 0, env, log, tick }), false, "a suite's office");
  assert.equal(startCreatureTick({ port: 3000, env: { ...env, CREATURE_TICK: "off" }, log, tick }), false);
  assert.equal(startCreatureTick({ port: 3000, env: { CREATURE_SEED_KEY: "k" }, log, tick }), false, "no store");
  assert.equal(startCreatureTick({ port: 3000, env, log, tick }), true);
  assert.equal(startCreatureTick({ port: 3000, env, log, tick }), false, "idempotent");
  stopCreatureTick();
  const seen = [];
  assert.equal(startCreatureTick({ port: 3000, env: { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://nowhere" }, log: { log: (l) => seen.push(l) },
    tick: async (o) => { seen.push(`key ${o.key}`); return { wrote: { seed: 0, spawn: 0, reveal: 0, abandon: 0 }, held: [], line: "" }; } }), true, "no key: it starts, and says so");
  stopCreatureTick();
  assert.match(seen.join(" | "), /no CREATURE_SEED_KEY .*no window's creatures are seeded, spawned or revealed \| key null/);
  assert.ok(CREATURE_TICK_MS <= 60_000, "a spawn is written within a minute of its own");
  assert.ok(LOOKBACK_MS >= 13 * 3600_000);
  assert.deepEqual([...TICK_ACTIONS].sort(), ["abandon", "reveal", "seed", "spawn", "withdraw"]);
});
