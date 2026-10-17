// creatures-hook-store.test.mjs — the hook on a real store (POS-637 PR-B;
// src/act-watch.mjs, src/creatures-hook.mjs, src/creatures.mjs § writeReaction).
//
// The unit file (test/creatures-hook.test.mjs) drives the hook with its store
// injected. Here the store is Postgres: the act's row is written by the pen's
// own insertAct inside an act door's watch, the reaction by the real
// writeReaction (its lock, its prior read, its trigger read), and the door's
// retry key (POS-246) is open around the act, so the reaction is proved never
// to take the act's key.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

import { LivingSet, loadCreatureLaw, writeReaction, reactionRows, NO_TRIGGER } from "../src/creatures.mjs";
import { perceived, noteActWritten } from "../src/act-watch.mjs";
import { actUnderNonce } from "../src/act-nonce.mjs";
import { __setCreaturesForTest, answerWithin } from "../src/creatures-hook.mjs";
import { normalizeRow, WORLD_ANCHOR, CLASS_MOVE } from "../src/world-journal.mjs";
import { currentCrossing } from "../src/crossings.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

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
reaction watch "it stands still and watches": when true says At the edge of the Mists a grey wolf stands perfectly still, watching {actor}.
reaction stalk "it paces along the mist-line with you": when act.verb == "walk" says The wolf paces along the edge of the Mists, keeping level with {actor}, never closer.
`;
const LAW = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)),
  readText: () => WOLF_TEXT });

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const WOLF = "creature:wolf-270-1";
const wolfAlive = () => new LivingSet({ law: LAW }).fold([{ id: "1", at: iso(NOW - 3600_000), actor: "the-town", action: "spawn", object: WOLF,
  payload: { kind: "wolf", at: iso(NOW - 3600_000), fades_at: iso(NOW + 11 * 3600_000), x: 0, y: 0 } }]);
const jev = (probabilities) => async () => ({ response: { answers: { reaction: { probabilities } } }, latency_ms: 100, tokens: 900 });
const quiet = async () => ({});

/** The walk door's write, as the pen makes it: one acts row, in one transaction, through insertAct. */
async function walkInStore(handle, dx) {
  const { officeWrite, insertAct } = await import("../src/world2-pen.mjs");
  const row = normalizeRow({ crossing: currentCrossing(), actor: handle, action: "walk", object: null, cls: CLASS_MOVE,
    at: { anchor: WORLD_ANCHOR, dx, dy: 0 }, payload: { from: { x: dx, y: 0 }, toward: { x: dx + 30, y: 0 }, pace: 60 }, writtenAt: iso(Date.now()) });
  const id = await officeWrite((c) => insertAct(c, row));
  return { did: "walk", seq: String(id) };
}

test("ON THE STORE · an act door's own row wakes the wolf: one reaction row naming it, and the reaction never takes the act's retry key", async () => {
  const s = await startStore({ db: "creatures_hook" });
  const api = await s.connect("office_api");
  // the pen's own pool, pointed at this store (world2-pen.mjs § __setPoolForTest)
  const { default: pg } = await import("pg");
  const { __setPoolForTest } = await import("../src/world2-pen.mjs");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
  __setPoolForTest(pool);
  try {
    const q = async (t, p) => (await api.query(t, p)).rows;
    __setCreaturesForTest(wolfAlive(), { centreOf: () => null, around: quiet, ask: jev({ watch: 0.2, stalk: 0.8 }), env: { TYPESAFE_API_KEY: "k" },
      standpointOf: async () => ({ x: 20, y: 0, placed: true }), query: q });

    // the door's retry key is open around the act, as the apex opens it (POS-246)
    const keyed = await actUnderNonce({ action: "walk", nonce: "n-1", actors: ["kai"], kept: true, run: () => perceived(() => walkInStore("kai", 30)) });
    const answer = keyed.result;
    assert.equal(answer.creatures?.length, 1, "the walk's answer carries the wolf");
    const [act] = await q("SELECT id::text AS id, nonce FROM acts WHERE actor = 'kai' AND action = 'walk'");
    assert.equal(act.id, answer.seq);
    assert.equal(act.nonce, "walk:n-1", "the act took its key");
    const reacts = await q("SELECT actor, action, object, class, nonce, payload FROM acts WHERE action = 'react'");
    assert.equal(reacts.length, 1);
    assert.deepEqual([reacts[0].actor, reacts[0].object, reacts[0].class], [WOLF, act.id, "creature"]);
    assert.equal(reacts[0].nonce, null, "the reaction is not the act: it never carries the act's key");
    assert.equal(reacts[0].payload.to, "kai");
    assert.equal(reacts[0].payload.reaction, answer.creatures[0].reaction);
    assert.equal(reacts[0].payload.slice_sha256?.length, 64, "the slice's hash, never the slice");

    // AN ENTER, WRITTEN BY THE CROSSING PASS IN A CHILD PROCESS: the door's key scope saw no row of its
    // own, so a reaction written inside it would have taken the key. It is written outside it.
    const enterKeyed = await actUnderNonce({ action: "enter", nonce: "n-2", actors: ["lu"], kept: true, run: () => perceived(async () => {
      const [{ id }] = await q(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect)
        VALUES (now(), $1, 'lu', 'enter', 'a/room', 'frame', '{}'::jsonb, 'the crossing is declared') RETURNING id::text AS id`, [currentCrossing()]);
      noteActWritten({ actor: "lu", action: "enter" }, id); // as world-apex.mjs § crossingDeps.record does
      return { entered: ["a/room"], seq: id };
    }) });
    assert.equal(enterKeyed.result.creatures?.length, 1, "the enter is perceived where lu stands (kai, seconds ago, has had the wolf's answer: C2's 10 s window)");
    const enterReacts = await q("SELECT nonce FROM acts WHERE action = 'react' AND object = $1", [enterKeyed.result.seq]);
    assert.deepEqual(enterReacts, [{ nonce: null }], "the reaction never takes the enter's key");

    // far from the ring: the act is written, and nothing else is
    const far = await perceived(() => walkInStore("mo", 900));
    assert.equal(far.creatures, undefined);
    assert.equal((await q("SELECT count(*)::int AS n FROM acts WHERE action = 'react'"))[0].n, 2);

    // C1, the arrival: its own moment, written once however often it is judged (two offices, a re-run)
    const arrival = { actor: "kai", verb: "walk", actId: act.id, atIso: iso(Date.now()), point: { x: 10, y: 0 }, from: { x: 30, y: 0 }, toward: { x: 10, y: 0 }, moment: "arrival" };
    const deps = { living: wolfAlive(), law: LAW, around: quiet, ask: jev({ watch: 1, stalk: 0 }), env: { TYPESAFE_API_KEY: "k" } };
    const [one, two] = await Promise.all([answerWithin(arrival, deps), answerWithin(arrival, { ...deps, living: wolfAlive() })]);
    assert.equal(one.length + two.length, 2, "both offices answer the walker");
    const arrivals = await q("SELECT payload FROM acts WHERE action = 'react' AND payload->>'moment' = 'arrival'");
    assert.equal(arrivals.length, 1, "the lock and the prior read leave one row");
    assert.equal(arrivals[0].payload.arrived_at, arrival.atIso);

    // TWO OFFICES, ONE ARRIVAL, written at once past both processes' own turn chains: the lock leaves one row
    const twice = reactionRows(wolfAlive().byId.get(WOLF), { ...arrival, actor: "mo", actId: far.seq, atIso: iso(Date.now() + 1) },
      { to: "mo", verb: "walk", reaction: "watch", moment: "arrival", arrived_at: arrival.atIso }, {});
    // each insert waits a moment inside its transaction, so the second office asks while the first has not committed
    const { officeWrite, insertAct } = await import("../src/world2-pen.mjs");
    const slowly = { officeWrite, insertAct: async (c, r) => { await new Promise((res) => setTimeout(res, 300)); return insertAct(c, r); } };
    const both = await Promise.all([writeReaction(twice, slowly), writeReaction(twice, slowly)]);
    assert.deepEqual(both.map((w) => w.prior).sort(), [false, true]);
    assert.equal((await q("SELECT count(*)::int AS n FROM acts WHERE action = 'react' AND payload->>'to' = 'mo' AND payload->>'moment' = 'arrival'"))[0].n, 1);

    // a trigger that never reached the record gets no reaction
    const ghost = reactionRows(wolfAlive().byId.get(WOLF), { actor: "kai", verb: "say", actId: "987654321", atIso: iso(Date.now()) },
      { to: "kai", verb: "say", reaction: "watch" }, {});
    await assert.rejects(writeReaction(ghost), (e) => e.why === NO_TRIGGER);
    assert.equal((await q("SELECT count(*)::int AS n FROM acts WHERE object = '987654321'"))[0].n, 0);
  } finally {
    __setCreaturesForTest(null);
    __setPoolForTest(null);
    await pool.end();
    await api.end();
    await s.stop();
  }
});
