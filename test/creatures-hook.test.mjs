// creatures-hook.test.mjs — the hook: every act door perceives creatures, and a
// walk is seen when it lands (POS-637 PR-B; src/act-watch.mjs, src/creatures-hook.mjs).
//
// RULED (Darko, Sitting E 2026-10-14 21:31): every ordinary public act a
// resident takes inside a creature's ring has an effect, and the reaction comes
// back in the actor's own answer. RULED (C1–C6, 2026-10-15 12:09 EDT): the walk
// is seen both when it's declared and when it lands; the answer carries the
// line, the reaction, the roll and judged_by. Settled (Wright, W1–W10): the hook
// wraps the act implementations, the answer waits at most 1 s, and no store
// connection is held across Jev.
//
// The law is the world's own (tools/creature-kind.mjs from the pinned clone)
// over a real kind file's text, as test/creatures.test.mjs reads it. The store,
// the judge and the world reads are injected; test/creatures-hook-store.test.mjs
// drives the pen, the watch and the reaction's row on a real Postgres.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { LivingSet, loadCreatureLaw, ANSWER_WAIT_MS, AROUND_WAIT_MS, JEV_TIMEOUT_MS, TURN_WAIT_MS } from "../src/creatures.mjs";
import { perceived, noteActWritten, setCreaturesAwake, creaturesAwake, insideWatchedAct } from "../src/act-watch.mjs";
import {
  __setCreaturesForTest, __resetArrivalsForTest, actOfRow, aroundCreature, arrivalTick, arrivals, creaturesAnswer, foldWalks, landingOf,
  ARRIVAL_STALE_MS, VIEWS_PER_TICK, seeFrom, views, warmViews, __resetViewsForTest,
} from "../src/creatures-hook.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const src = (f) => readFileSync(join(SRC, f), "utf8");

// The wolf in the kind file's own grammar (WLD-56 § 6's draft), as creatures.test.mjs has it.
const levels = (m) => `none | a little ${m} | plain ${m} | overwhelming ${m}`;
const WOLF_TEXT = `kind: wolf
name: a grey wolf
ring_m: 80
what: >
  A grey wolf come out of the Mists. It belongs to no one.
moods:
  fear: 0..3 = 1 | ${levels("fear")}
  curiosity: 0..3 = 1 | ${levels("curiosity")}
  hunger: 0..3 = 2 | ${levels("hunger")}
flags: wary
reaction watch "it stands still and watches": when true says At the edge of the Mists a grey wolf stands perfectly still, watching {actor}.
reaction snarl "it bares its teeth, a warning only": when act.approaching and act.distance_m < 40 says The wolf's lip curls back. It snarls at {actor}, low and steady.
reaction stalk "it paces along the mist-line with you": when act.verb == "walk" says The wolf paces along the edge of the Mists, keeping level with {actor}, never closer.
reaction slink "it slinks back a step": when self.fear >= 2 does self.fear -1 says The wolf slinks back a step into the fog, its eyes still on {actor}.
reaction flee "it turns and is gone": when self.fear >= 3 does flee says The wolf wheels and is gone, a grey shape folding back into the grey.
`;
const KINDS = { "WORLD/kinds/wolf.kind": WOLF_TEXT };
const LAW = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)),
  readText: (path) => { if (!(path in KINDS)) throw new Error(`no fixture kind at ${path}`); return KINDS[path]; } });
const WALK = NO_WORLD ? null : await import(worldModuleUrl("tools", "walk.mjs"));

// The real clock: the hook judges against now, as the office does.
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const WOLF = "creature:wolf-270-1";
const spawnRow = (id = WOLF, { n = 1, x = 0, y = 0, at = NOW - 3600_000 } = {}) =>
  ({ id: String(n), at: iso(at), actor: "the-town", action: "spawn", object: id,
    payload: { kind: "wolf", at: iso(at), fades_at: iso(at + 12 * 3600_000), x, y } });
const livingWith = (...rows) => new LivingSet({ law: LAW }).fold(rows);
// An acts row as the pen hands it to the watch (world-journal.mjs § normalizeRow), at the world anchor.
const penRow = (over = {}) => ({ actor: "kai", action: "say", object: null, at_anchor: "the-town/let-there-be-light", at_dx: 30, at_dy: 0,
  class: "voice", payload: JSON.stringify({ text: "hello" }), written_at: iso(NOW), ...over });
const centreOf = () => null;
// A walk inside the ring: the wolf may watch or stalk, so Jev is asked.
const walkPen = (id) => ({ ...penRow({ action: "walk", class: "move", payload: JSON.stringify({ from: { x: 30, y: 0 }, toward: { x: 60, y: 0 } }) }), id: String(id) });
const ENV = { TYPESAFE_API_KEY: "k" };
const jev = (probabilities) => async () => ({ response: { answers: { reaction: { probabilities } } }, latency_ms: 120, tokens: 1000 });
function recordingWrite() {
  const calls = [];
  let next = 700;
  const write = async (rows) => { calls.push(rows); return { prior: false, rows: rows.map((r) => ({ id: String(next++), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }; };
  return { calls, write };
}
const quiet = async () => ({});

// ── the watch (act-watch.mjs) ───────────────────────────────────────────────

nodeTest("DORMANT: with no creature living, an act door is its plain self — no scope, no hook, the same answer object", async () => {
  setCreaturesAwake(false);
  const answer = { did: "say" };
  let runs = 0;
  let watched = null;
  const out = await perceived(async () => { runs += 1; watched = insideWatchedAct(); noteActWritten(penRow(), 1); return answer; });
  assert.equal(out, answer);
  assert.equal(runs, 1);
  assert.equal(watched, false, "no watch is opened around the act");
  assert.ok(!("creatures" in answer));
});

test("AWAKE: an act inside the wolf's ring answers with the wolf's line, its reaction, the roll and judged_by (C4)", async () => {
  const living = livingWith(spawnRow());
  __setCreaturesForTest(living);
  assert.equal(creaturesAwake(), true);
  const { calls, write } = recordingWrite();
  // a walk, so the wolf has more than one reaction to choose from and Jev is asked
  const walk = { ...penRow({ action: "walk", class: "move", payload: JSON.stringify({ from: { x: 30, y: 0 }, toward: { x: 60, y: 0 } }) }), id: "9001" };
  const result = await creaturesAnswer([walk], { did: "walk" }, { centreOf, around: quiet, ask: jev({ watch: 1, stalk: 0 }), write, env: ENV });
  assert.equal(result.creatures.length, 1);
  const [c] = result.creatures;
  assert.deepEqual(Object.keys(c).sort(), ["id", "judged_by", "kind", "line", "reaction", "roll"]);
  assert.equal(c.id, WOLF);
  assert.equal(c.reaction, "watch");
  assert.equal(c.line, "At the edge of the Mists a grey wolf stands perfectly still, watching kai.");
  assert.equal(c.judged_by, "jev");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].object, "9001", "the reaction names the trigger act");
  __setCreaturesForTest(null);
});

test("the trigger is the LAST row the world's law perceives: a walk that exits first is one walk; a consume is no trigger", async () => {
  __setCreaturesForTest(livingWith(spawnRow()));
  const seen = [];
  const ask = async (slice) => { seen.push(slice.this_act.verb); return (await jev({ watch: 1 })()); };
  const exit = { ...penRow({ action: "exit", class: "frame" }), id: "10" };
  const walk = { ...penRow({ action: "walk", class: "move", payload: JSON.stringify({ from: { x: 30, y: 0 }, toward: { x: 10, y: 0 } }) }), id: "11" };
  const out = await creaturesAnswer([exit, walk], {}, { centreOf, around: quiet, ask, write: recordingWrite().write, env: ENV });
  assert.deepEqual(seen, ["walk"]);
  assert.equal(out.creatures.length, 1);
  const consume = { ...penRow({ action: "consume", class: "holding" }), id: "12" };
  const none = await creaturesAnswer([consume], { did: "consume" }, { centreOf, around: quiet, ask, write: recordingWrite().write, env: ENV });
  assert.equal(none.creatures, undefined);
  __setCreaturesForTest(null);
});

test("FAR from every ring, nothing is read: no standpoint, no read-back, no judge, no write", async () => {
  __setCreaturesForTest(livingWith(spawnRow()));
  const boom = async () => { throw new Error("must not be called"); };
  const far = { ...penRow({ at_dx: 900 }), id: "13" };
  const out = await creaturesAnswer([far], { did: "say" }, { centreOf, standpointOf: boom, query: boom, around: boom, ask: boom, write: boom, env: ENV });
  assert.equal(out.creatures, undefined);
  // a row from the crossing pass (only its id came back): its actor's standpoint is asked, and nothing else when it is far
  let asked = 0, reads = 0;
  const enter = { actor: "kai", action: "enter", id: "14" };
  await creaturesAnswer([enter], {}, { centreOf, standpointOf: async () => { asked += 1; return { x: 900, y: 0, placed: true }; },
    query: async () => { reads += 1; return []; }, around: boom, ask: boom, write: boom, env: ENV });
  assert.equal(asked, 1);
  assert.equal(reads, 0, "an enter far from every ring is never read back");
  __setCreaturesForTest(null);
});

test("carry 2: the act's instant is its row's own — read back for a crossing-pass row; a row with none is no trigger", async () => {
  const back = { id: "15", at: new Date(NOW - 5000), actor: "kai", action: "enter", at_anchor: null, at_dx: null, at_dy: null, payload: null };
  const act = await actOfRow({ actor: "kai", action: "enter", id: "15" }, { centreOf, standpointOf: async () => ({ x: 20, y: 0, placed: true }),
    query: async (sql, [id]) => { assert.match(sql, /WHERE id = \$1::bigint/); return id === "15" ? [back] : []; } });
  assert.equal(act.atIso, iso(NOW - 5000));
  assert.deepEqual(act.point, { x: 20, y: 0 });
  assert.equal(act.verb, "enter");
  assert.equal(await actOfRow({ ...penRow(), written_at: "not a time", id: "16" }, { centreOf }), null);
  assert.equal(await actOfRow({ actor: "kai", action: "enter", id: "17" }, { centreOf, standpointOf: async () => ({ x: 20, y: 0 }), query: async () => [] }), null,
    "a row that cannot be read back is no trigger");
  assert.equal(await actOfRow({ actor: "kai", action: "enter", id: "18" }, { centreOf, standpointOf: async () => ({ x: null, y: null, placed: false }) }), null,
    "an actor who stands nowhere is perceived nowhere");
});

test("a walk's trigger carries where it set out and where it is going: approaching is the toward-point nearer than the start", async () => {
  const walk = { ...penRow({ action: "walk", payload: JSON.stringify({ from: { x: 30, y: 0 }, toward: { x: 5, y: 0 } }) }), id: "19" };
  const act = await actOfRow(walk, { centreOf });
  assert.deepEqual(act.from, { x: 30, y: 0 });
  assert.deepEqual(act.toward, { x: 5, y: 0 });
  __setCreaturesForTest(livingWith(spawnRow()));
  let slice;
  await creaturesAnswer([walk], {}, { centreOf, around: quiet, ask: async (s) => { slice = s; return jev({ watch: 1 })(); }, write: recordingWrite().write, env: ENV });
  assert.equal(slice.this_act.approaching, true);
  __setCreaturesForTest(null);
});

test("a bounce is no act: an answer with an error gets no creatures, whatever rows the call wrote", async () => {
  __setCreaturesForTest(livingWith(spawnRow()));
  const { calls, write } = recordingWrite();
  const out = await creaturesAnswer([walkPen(20)], { error: "bounce", defect: "no" }, { centreOf, around: quiet, ask: jev({ watch: 1 }), write, env: ENV });
  assert.equal(out.creatures, undefined);
  assert.equal(calls.length, 0, "nothing judged, nothing written");
  __setCreaturesForTest(null);
});

// ── W2 / carry 4: the answer waits at most ANSWER_WAIT_MS ────────────────────

test("W2: a write that hangs costs the act at most ANSWER_WAIT_MS; the answer goes out without the creature", async () => {
  // its own wolf: the hung turn holds that wolf's next turn for TURN_WAIT_MS
  __setCreaturesForTest(livingWith(spawnRow("creature:wolf-270-9")));
  const t0 = Date.now();
  const out = await creaturesAnswer([{ ...penRow(), id: "21" }], { did: "say" }, { centreOf, around: quiet, ask: jev({ watch: 1 }),
    write: () => new Promise(() => {}), env: ENV });
  const took = Date.now() - t0;
  assert.equal(out.creatures, undefined);
  assert.ok(took >= ANSWER_WAIT_MS - 50 && took < ANSWER_WAIT_MS + 400, `took ${took} ms`);
  __setCreaturesForTest(null);
});

test("carry 4: the creature's read gets AROUND_WAIT_MS and no more; Jev gets what is left, never more than JEV_TIMEOUT_MS", async () => {
  __setCreaturesForTest(livingWith(spawnRow()));
  let budget = null, slice = null;
  const t0 = Date.now();
  const out = await creaturesAnswer([walkPen(22)], { did: "say" }, { centreOf,
    around: () => new Promise((r) => setTimeout(() => r({ hour: "never" }), 5000)),
    ask: async (s, q, o) => { slice = s; budget = o.timeoutMs; return jev({ watch: 1 })(); },
    write: recordingWrite().write, env: ENV });
  assert.ok(Date.now() - t0 < ANSWER_WAIT_MS, "a late read is not a late answer");
  assert.equal(out.creatures.length, 1);
  assert.equal(slice.hour, undefined, "the late read is left out: the slice is the creature and the act");
  assert.ok(budget <= JEV_TIMEOUT_MS && budget >= JEV_TIMEOUT_MS - AROUND_WAIT_MS - 100, `Jev's budget ${budget}`);
  __setCreaturesForTest(null);
});

test("a turn that hangs holds its creature's next turn for TURN_WAIT_MS at most, never for the rest of its life", async () => {
  const id = "creature:wolf-270-7";
  const living = livingWith(spawnRow(id));
  const writes = [];
  let hang = true;
  const write = (rows) => { writes.push(rows[0].object); if (hang) { hang = false; return new Promise(() => {}); } return recordingWrite().write(rows); };
  const deps = { living, law: LAW, around: quiet, ask: jev({ watch: 1, stalk: 0 }), write, env: ENV };
  const { answerWithin } = await import("../src/creatures-hook.mjs");
  const act = (n, actor) => ({ actor, verb: "walk", actId: String(n), atIso: iso(NOW), point: { x: 30, y: 0 }, toward: { x: 60, y: 0 } });
  assert.deepEqual(await answerWithin(act(41, "kai"), deps), [], "the hung write: no answer inside the wait");
  assert.deepEqual(await answerWithin(act(42, "mo"), deps), [], "the next act waits behind it, past its own answer");
  await new Promise((r) => setTimeout(r, TURN_WAIT_MS + 500));
  assert.deepEqual(writes, ["41", "42"], "after TURN_WAIT_MS the creature answers again: the reaction is written and stands");
});

test("B1 (review-571): the bound starts at the hook — a slow standpoint or a slow read-back never holds the act past ANSWER_WAIT_MS", async () => {
  __setCreaturesForTest(livingWith(spawnRow("creature:wolf-270-4")));
  const enter = { actor: "kai", action: "enter", id: "51" };
  const slow = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
  for (const [name, deps] of [
    ["a standpoint that takes 3 s", { standpointOf: () => slow(3000, { x: 20, y: 0, placed: true }) }],
    ["a read-back that takes 3 s", { standpointOf: async () => ({ x: 20, y: 0, placed: true }), query: () => slow(3000, [{ id: "51", at: new Date(), actor: "kai", action: "enter" }]) }],
  ]) {
    const t0 = Date.now();
    const out = await creaturesAnswer([enter], { entered: ["a/room"] }, { centreOf, around: quiet, ask: jev({ watch: 1 }), write: recordingWrite().write, env: ENV, ...deps });
    const took = Date.now() - t0;
    assert.ok(took < ANSWER_WAIT_MS + 200, `${name}: took ${took} ms`);
    assert.deepEqual(out, { entered: ["a/room"] }, `${name}: the answer goes out as it was`);
  }
  __setCreaturesForTest(null);
});

test("note 3 (review-571): a late creature drops only its own line; the creatures that answered in time ride", async () => {
  const fast = "creature:wolf-270-5", slowWolf = "creature:wolf-270-6";
  __setCreaturesForTest(livingWith(spawnRow(fast, { n: 1, x: 0 }), spawnRow(slowWolf, { n: 2, x: 10 })));
  const write = (rows) => (rows[0].actor === slowWolf ? new Promise(() => {}) : recordingWrite().write(rows));
  const t0 = Date.now();
  const out = await creaturesAnswer([walkPen(52)], {}, { centreOf, around: quiet, ask: jev({ watch: 1 }), write, env: ENV });
  assert.ok(Date.now() - t0 < ANSWER_WAIT_MS + 200);
  assert.deepEqual(out.creatures.map((c) => c.id), [fast]);
  __setCreaturesForTest(null);
});

// ── carry 3: the creatures' rows are never the act's ─────────────────────────

test("carry 3: through a real act door's watch — the creatures' turns run outside it, so their writes are never the act's", async () => {
  const seen = { judged: 0, inside: [], writes: 0 };
  const write = async (rows) => {
    seen.writes += 1;
    seen.inside.push(insideWatchedAct());
    noteActWritten(rows[0], 999); // as the real pen does; outside the watch this is nothing
    return { prior: false, rows: rows.map((r, i) => ({ id: String(800 + i), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) };
  };
  __setCreaturesForTest(livingWith(spawnRow("creature:wolf-270-3")), { centreOf, around: quiet, env: ENV, write,
    ask: async () => { seen.judged += 1; return jev({ watch: 1 })(); } });
  // the act implementation, as the door runs it: its pen tells the watch about its row
  const out = await perceived(async () => { noteActWritten(walkPen(24), 24); return { did: "walk" }; });
  assert.equal(out.did, "walk");
  assert.equal(out.creatures.length, 1, "the walk was perceived through the watch");
  assert.equal(seen.judged, 1);
  assert.equal(seen.writes, 1, "one reaction: the reaction's own row was never taken for a second trigger");
  assert.deepEqual(seen.inside, [false], "the write ran outside the watched act");
  __setCreaturesForTest(null);
});

// ── W1: every door reaches a perceived implementation ────────────────────────

nodeTest("W1: the eight act implementations are each their own perceived wrapper", () => {
  const wrapped = {
    "world.mjs": ["worldSay", "worldSayHuman", "leaveMarkViaOffice", "walkViaOffice"],
    "world-crossings.mjs": ["enterViaOffice", "exitViaOffice"],
    "world-hold.mjs": ["callHoldTool"],
    "world-stake.mjs": ["callWorldStakeTool"],
  };
  for (const [file, names] of Object.entries(wrapped)) {
    const text = src(file);
    for (const n of names)
      assert.match(text, new RegExp(`export async function ${n}\\([^)]*\\) \\{ return perceived\\(\\(\\) => \\w+Act\\(`), `${file} § ${n} is perceived`);
  }
});

nodeTest("W1: the apex, the flat MCP tools and the REST doors all dispatch the act verbs to those functions", () => {
  const apex = src("world-apex.mjs");
  for (const [verb, fn] of [["say", "worldSay"], ["walk", "walkViaOffice"], ['"leave-mark"', "leaveMarkViaOffice"], ["stake", "callWorldStakeTool"],
    ["give", "callHoldTool"], ["drop", "callHoldTool"], ["take", "callHoldTool"], ["enter", "enterViaOffice"], ["exit", "exitViaOffice"]])
    assert.match(apex, new RegExp(`\\n  ${verb}: \\{ tool: "[a-z_]+", run: \\(args, key\\) => ${fn}\\(`), `the apex's ${verb}`);
  assert.match(apex, /result = await worldSayHuman\(/, "the apex's human say");
  const flat = src("world.mjs");
  for (const [tool, fn] of [["world_leave_mark", "leaveMarkViaOffice"], ["world_walk", "walkViaOffice"], ["world_say", "worldSay"], ["world_hold", "callHoldTool"]])
    assert.match(flat, new RegExp(`case "${tool}":[^\\n]*return ${fn}\\(`), `the flat ${tool}`);
  assert.match(flat, /default: return callWorldStakeTool\(name, args, key\)/);
  const server = src("server.mjs");
  for (const fn of ["leaveMarkViaOffice", "walkViaOffice", "callHoldTool", "worldSayHuman", "worldSay"])
    assert.match(server, new RegExp(`await ${fn}\\(`), `REST reaches ${fn}`);
  // the pen tells the watch, and the crossing pass's parent tells it the child's row
  assert.match(src("world2-pen.mjs"), /RETURNING id`, values\);\n[^\n]*\n[^\n]*\n  noteActWritten\(row, r\.id\);/);
  assert.match(apex, /if \(result\.seq != null\) noteActWritten\(\{ actor: handle, action: act \?\? "enter" \}, result\.seq\);/);
});

// ── the creature's own world read (W9) ──────────────────────────────────────

test("W9: the creature's read is the resident read's own blocks at the creature's point, as a spectator; its view is the one the tick saw", async () => {
  __resetViewsForTest();
  const asked = [];
  const world = {
    worldOrient: async (args, key, opts) => { asked.push(["orient", args, key, opts]); return { present: { residents: [
      { handle: "kai", distance_m: 30, bearing: "E", band: "near" }, { handle: "mo", distance_m: 120, bearing: "N", band: "near" }] } }; },
    worldEyes: async (args, key, opts) => { asked.push(["eyes", args, key, opts]);
      return { _fov: { rows: [{ id: "mo/cairn", name: "a cairn", body: "Stones, stacked.", bearing: "N", band: "near", distM: 70 }] } }; },
    heardAt: async (at, opts) => { asked.push(["heard", at, opts]);
      return [1, 2, 3, 4].map((i) => ({ handle: `h${i}`, said: `word ${i}`, ago: `${i} min ago`, distance: 10, at_ms: i })); },
    worldAir: async () => "fog low over the fringe",
  };
  const query = async (sql, params) => {
    if (/unnest/.test(sql)) return [{ handle: "mo", action: "say", at: new Date(NOW - 60_000) }];
    asked.push(["last", params]);
    return [{ action: "walk", at: new Date(NOW - 120_000) }];
  };
  const wolf = { id: "creature:wolf-270-31", x: 5, y: 7 };
  // the tick sees for it, at its point, as a spectator (play row 51)
  views.set(wolf.id, { key: "k", ...(await seeFrom(wolf, { world })) });
  assert.deepEqual(asked.find((a) => a[0] === "eyes").slice(1), [{ x: 5, y: 7 }, null, { v2: true }]);
  asked.length = 0;
  const out = await aroundCreature(wolf, { actor: "kai", actId: "31" }, { world, query, nowMs: NOW });
  assert.equal(asked.filter((a) => a[0] === "eyes").length, 0, "no line of sight on the act's path");
  assert.deepEqual(asked[0].slice(1), [{ x: 5, y: 7 }, null, { crowd: true }], "orient at the creature's point, nobody's key");
  assert.deepEqual(asked[1][2], { cap: 3, exclude: "kai" }, "the shared ear, the actor's own words left out");
  assert.equal(asked[2][1][0], "kai");
  assert.equal(asked[2][1][2], "31", "the actor's last acts leave out this act itself");
  assert.deepEqual(out.heard.map((h) => h.who), ["h2", "h3", "h4"], "rows come newest last: the newest three, handle as who");
  assert.equal(out.who.active[0].handle, "mo");
  assert.equal(out.view.N[0].name, "a cairn");
  assert.equal(out.bodies["mo/cairn"], "Stones, stacked.");
  assert.equal(out.air, "fog low over the fringe");
  assert.deepEqual(out.actor_last, ["walked, 2 min ago"]);
  // the room is read FRESH on every act, never kept: a resident who arrives is in the very next slice
  const crowded = await aroundCreature(wolf, { actor: "kai", actId: "33" }, { query, nowMs: NOW, world: { ...world,
    worldOrient: async () => ({ present: { residents: [{ handle: "zed", distance_m: 12, bearing: "S", band: "near" }] } }),
    heardAt: async () => [{ handle: "zed", said: "a new voice", ago: "just now" }] } });
  assert.deepEqual(crowded.heard.map((h) => h.who), ["zed"], "what was heard is this act's");
  assert.equal(crowded.view.N[0].name, "a cairn", "while the marks in its sight are the kept view");
  // a creature the tick has not seen for yet: no marks in its slice, and still no line of sight on the act
  const fresh = await aroundCreature({ id: "creature:wolf-270-32", x: 0, y: 0 }, { actor: "kai", actId: "32" },
    { world: { ...world, worldEyes: async () => { throw new Error("must not be asked on the act"); }, heardAt: async () => { throw new Error("deaf"); } }, query, nowMs: NOW });
  assert.equal(fresh.view, undefined);
  assert.equal(fresh.heard, undefined, "a part that cannot be read is left out, never a fault on the act");
  assert.ok(fresh.who);
  __resetViewsForTest();
});

test("play row 51: the tick sees for each living creature once per (published sha, crossing), one a tick, the newest first; the ended leave", async () => {
  __resetViewsForTest();
  assert.equal(VIEWS_PER_TICK, 1);
  const c = (n, spawned) => ({ id: `creature:wolf-270-${n}`, x: n, y: 0, spawned_at: spawned, fades_at: NOW + 3600_000 });
  let alive = [c(1, NOW - 3000), c(2, NOW - 1000), c(3, NOW - 2000)];
  const living = { living: () => alive };
  const seen = [];
  const see = async (cr) => { seen.push(cr.id); return { view: { N: [] }, bodies: {} }; };
  await warmViews(living, { key: "s1:257", see, now: NOW });
  assert.deepEqual(seen, ["creature:wolf-270-2"], "one a tick, the newest out first");
  await warmViews(living, { key: "s1:257", see, now: NOW });
  await warmViews(living, { key: "s1:257", see, now: NOW });
  await warmViews(living, { key: "s1:257", see, now: NOW });
  assert.deepEqual(seen, ["creature:wolf-270-2", "creature:wolf-270-3", "creature:wolf-270-1"], "each once; then nothing is due");
  // a new published sha: each sees again, the old view standing until it does
  await warmViews(living, { key: "s2:257", see, now: NOW });
  assert.equal(seen.length, 4);
  assert.equal(views.get("creature:wolf-270-1").key, "s1:257", "not yet re-seen: its last view still answers the act");
  // a creature that ended leaves the map
  alive = [c(2, NOW - 1000)];
  await warmViews(living, { key: "s2:257", see, now: NOW });
  assert.deepEqual([...views.keys()].sort(), ["creature:wolf-270-2"]);
  // eyes that fail leave no view and fault nothing
  __resetViewsForTest();
  assert.equal(await warmViews(living, { key: "s3:258", see: async () => { throw new Error("blind"); }, now: NOW }), 0);
  assert.equal(views.size, 0);
});

// ── C1: the arrival ─────────────────────────────────────────────────────────

const CROSS = (ms) => (ms - Date.UTC(2026, 5, 12)) / (12 * 3600 * 1000);
const walkRow = (id, { actor = "kai", from, toward, ms, pace = 60 }) =>
  ({ id: String(id), at: new Date(ms), crossing: String(CROSS(ms)), actor, action: "walk", payload: { from, toward, pace, within: null, to: null, declared_by: actor } });

test("landingOf: where a walk lands and when, by the engine's own positionAt; a stop has no landing", () => {
  const t = NOW - 600_000;
  // 300 m at 60 km a crossing (12 h): 3.6 minutes
  const land = landingOf(walkRow(1, { from: { x: 300, y: 0 }, toward: { x: 0, y: 0 }, ms: t }), WALK);
  assert.deepEqual(land.at, { x: 0, y: 0 });
  assert.deepEqual(land.from, { x: 300, y: 0 });
  assert.ok(Math.abs(land.dueMs - (t + 3.6 * 60_000)) < 1500, `due ${land.dueMs - t} ms after`);
  assert.equal(landingOf(walkRow(2, { from: { x: 5, y: 5 }, toward: { x: 5, y: 5 }, ms: t }), WALK), null);
});

test("C1: a walk that lands inside a ring is judged at its landing instant, as an arrival, and named so on the row", async () => {
  __resetArrivalsForTest();
  const living = livingWith(spawnRow(WOLF, { x: 0, y: 0, at: NOW - 3 * 3600_000 }));
  __setCreaturesForTest(living);
  const t = NOW - 600_000; // landed about 6 minutes ago
  const rows = [walkRow(101, { from: { x: 300, y: 0 }, toward: { x: 20, y: 0 }, ms: t }),
    walkRow(102, { actor: "mo", from: { x: 0, y: 3000 }, toward: { x: 0, y: 2700 }, ms: t })]; // lands far from the wolf
  const query = async (sql) => (/crossing >= \$1/.test(sql) ? rows : []);
  const judged = [];
  const judge = async (act) => { judged.push(act); return [{ id: WOLF }]; };
  const r = await arrivalTick({ query, now: NOW, walkMod: WALK, judge });
  assert.equal(r.landed, 2);
  assert.equal(judged.length, 1, "only the landing inside a ring is judged");
  const [a] = judged;
  assert.equal(a.moment, "arrival");
  assert.equal(a.actId, "101");
  assert.equal(a.verb, "walk");
  assert.deepEqual(a.point, { x: 20, y: 0 });
  assert.deepEqual(a.from, { x: 300, y: 0 });
  assert.ok(Math.abs(Date.parse(a.atIso) - (t + (280 / 60_000) * 12 * 3600_000)) < 1500, "the instant it landed, not the tick's");
  assert.equal(arrivals.byActor.size, 0, "a landed walk is judged once and let go");
  __setCreaturesForTest(null);
});

test("C1: the real judge writes the arrival's row with its moment and its instant; the walker is told nothing now, the row carries it", async () => {
  __resetArrivalsForTest();
  __setCreaturesForTest(livingWith(spawnRow(WOLF, { x: 0, y: 0, at: NOW - 3 * 3600_000 })));
  const { calls, write } = recordingWrite();
  const t = NOW - 600_000;
  const query = async (sql) => (/crossing >= \$1/.test(sql) ? [walkRow(111, { from: { x: 300, y: 0 }, toward: { x: 20, y: 0 }, ms: t })] : []);
  const { answerWithin } = await import("../src/creatures-hook.mjs");
  const r = await arrivalTick({ query, now: NOW, walkMod: WALK,
    judge: (act, cur) => answerWithin(act, { ...cur, around: quiet, ask: jev({ watch: 1 }), write, env: ENV }) });
  assert.equal(r.answered, 1);
  const p = calls[0][0].payload;
  const payload = typeof p === "string" ? JSON.parse(p) : p;
  assert.equal(payload.moment, "arrival");
  assert.equal(payload.to, "kai");
  assert.equal(payload.approaching, true, "it landed nearer than it set out");
  assert.ok(Date.parse(payload.arrived_at) < NOW);
  __setCreaturesForTest(null);
});

test("C1: a later walk replaces the one still on its way (a later departure overtakes), and a stop replaces it too", async () => {
  __resetArrivalsForTest();
  const t = NOW - 600_000;
  foldWalks([walkRow(201, { from: { x: 300, y: 0 }, toward: { x: 20, y: 0 }, ms: t }),
    walkRow(202, { from: { x: 200, y: 0 }, toward: { x: 900, y: 0 }, ms: t + 60_000 })], WALK);
  assert.equal(arrivals.byActor.get("kai").walk, "202");
  foldWalks([walkRow(203, { from: { x: 210, y: 0 }, toward: { x: 210, y: 0 }, ms: t + 120_000 })], WALK);
  assert.equal(arrivals.byActor.has("kai"), false);
  // a row the cursor has passed is never folded twice
  foldWalks([walkRow(201, { from: { x: 300, y: 0 }, toward: { x: 20, y: 0 }, ms: t })], WALK);
  assert.equal(arrivals.byActor.has("kai"), false);
});

test("C1: not before it lands; never by a creature that came out after it landed; let go once stale", async () => {
  __resetArrivalsForTest();
  const judged = [];
  const judge = async (act) => { judged.push(act.actId); return []; };
  // the wolf came out of the Mists two minutes ago
  __setCreaturesForTest(livingWith(spawnRow(WOLF, { x: 0, y: 0, at: NOW - 120_000 })));
  const rows = [
    walkRow(301, { actor: "a", from: { x: 3000, y: 0 }, toward: { x: 10, y: 0 }, ms: NOW - 60_000 }),  // still on its way
    walkRow(302, { actor: "b", from: { x: 300, y: 0 }, toward: { x: 10, y: 0 }, ms: NOW - 900_000 }), // landed ~10 min ago, before the wolf
    walkRow(303, { actor: "c", from: { x: 300, y: 0 }, toward: { x: 10, y: 0 }, ms: NOW - 300_000 }), // 290 m takes ~3.5 min: landed ~1.5 min ago, after it
  ];
  await arrivalTick({ query: async (sql) => (/crossing >= \$1/.test(sql) ? rows : []), now: NOW, walkMod: WALK, judge });
  assert.deepEqual(judged, ["303"]);
  assert.ok(arrivals.byActor.has("a"), "the walk still on its way waits for its instant");
  // an arrival judged a tick late is judged; one past ARRIVAL_STALE_MS (a long restart) is let go
  __resetArrivalsForTest();
  __setCreaturesForTest(livingWith(spawnRow(WOLF, { x: 0, y: 0, at: NOW - 6 * 3600_000 })));
  judged.length = 0;
  const old = NOW - ARRIVAL_STALE_MS - 600_000;
  await arrivalTick({ query: async (sql) => (/crossing >= \$1/.test(sql) ? [walkRow(304, { actor: "d", from: { x: 300, y: 0 }, toward: { x: 10, y: 0 }, ms: old })] : []),
    now: NOW, walkMod: WALK, judge });
  assert.deepEqual(judged, []);
  __setCreaturesForTest(null);
});

test("the walk cursor: after the boot, only walks past the cursor are read, by the class index", async () => {
  __resetArrivalsForTest();
  const asked = [];
  const query = async (sql, params) => { asked.push([sql.replace(/\s+/g, " ").trim(), params]); return /max\(id\)/.test(sql) ? [{ id: "500" }] : []; };
  await arrivalTick({ query, now: NOW, walkMod: WALK, judge: async () => [] });
  assert.match(asked[0][0], /crossing >= \$1 AND class = 'move'/);
  assert.equal(arrivals.cursor, "500", "a quiet boot starts at the newest walk, never at 0");
  asked.length = 0;
  await arrivalTick({ query, now: NOW, walkMod: WALK, judge: async () => [] });
  assert.match(asked[0][0], /WHERE class = 'move' AND id > \$1::bigint ORDER BY id LIMIT \$2/);
  assert.equal(asked[0][1][0], "500");
});
