// set-pieces-store.test.mjs — a fight in set pieces on a real store: each of its
// once-only writes behind its own lock and look, and its ending at the settlement
// (src/set-pieces.mjs; src/creatures.mjs § writeReaction, advanceFight, unmaskFight;
// src/encounter-verbs.mjs § encounterTick; src/creature-verbs.mjs § persuadeGuard;
// world2/tools/creature-endings.mjs § endCreatures).
//
// The unit file (test/set-pieces.test.mjs) drives every rule with its writes stubbed.
// Here the store is Postgres, and two offices are played by two living sets, one of
// them stale (it never folded the other's rows), so each guard is the record's:
//   · a feint is answered once (the turn's answer and the tick's lapse race)
//   · a set piece begins once, and a disguise is broken once
//   · a household persuades once each settlement
//   · at a settlement where its sanity is full, the town withdraws it, ended, and
//     restores the class its fight names, once.
//
// The kind and its fight are the unit file's fixtures (placeholders).

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

import { LivingSet, loadCreatureLaw, reactionRows, writeReaction, advanceFight, unmaskFight, creatureRow } from "../src/creatures.mjs";
import { windowAt } from "../src/encounter.mjs";
import { HURL_ACTION, HURLED_ACTION, SANITY_ACTION, PHASE_ACTION, UNMASKED_ACTION, LINE_ACTION, pieceOf } from "../src/set-pieces.mjs";
import { encounterTick, __resetEncounterTickForTest } from "../src/encounter-verbs.mjs";
import { persuadeGuard } from "../src/creature-verbs.mjs";
import { endCreatures } from "../world2/tools/creature-endings.mjs";
import { normalizeRow, WORLD_ANCHOR } from "../src/world-journal.mjs";
import { currentCrossing } from "../src/crossings.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const KIND_TEXT = `kind: fighter
name: a test fighter
ring_m: 40
what: >
  A fixture.
moods:
  mood: 0..3 = 1 | calm | stirred | eager | wild
reaction notice "it notices": when true says It notices {actor}.
`;
const BASE = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)), readText: () => KIND_TEXT });
const FIGHTER = NO_WORLD ? null : { ...BASE.kindOf("fighter"), finishable: true, resolve: 40, strike: 2, fight: "fighter.fight.json", ending: "It is itself again. {names} were there." };
const FIGHT = {
  sanity_max: 12, order: ["feint", "disguise", "unbreakable"], restores: "snack",
  pieces: [
    { piece: "feint", looks: "It glows.", throws: "a ball of sparks", aims_at: "loudest", flinch_nerve: 3, held: 2, held_by: { watch: 3 },
      answer_min: 30, ends: { hit_points_at: 0.5, sanity_at: 0.5, after_h: 4 } },
    { piece: "disguise", looks: "It looks ordinary.", surrender: "You won. Go home now.", admits: "Fine. You saw me." },
    { piece: "unbreakable", looks: "It blazes.", persuade: { low: 3, high: 8, nerve: 8, story: ["wait like everyone else"] } },
  ],
};
const LAW = NO_WORLD ? null : {
  ...BASE, kindOf: (n) => (n === "fighter" ? FIGHTER : null), fightOf: (n) => (n === "fighter" ? FIGHT : null),
  creaturesMod: { ...BASE.creaturesMod, DESPAWN_REASONS: [...new Set([...BASE.creaturesMod.DESPAWN_REASONS, "ended"])] },
};
const ID = "creature:fighter-top";
const iso = (ms) => new Date(ms).toISOString();
const ROSTER = ["kai", "ren", "ana"].map((handle) => ({ handle, distance_m: 10, household: handle === "ana" ? "house:hearth" : `solo:${handle}`, slug: null, human: `human-of-${handle}`, nerve: 10 }));

test("ON THE STORE · a feint answered once, a set piece begun once, a disguise broken once, a persuade once per household, and the ending with its restore, once", async () => {
  const s = await startStore({ db: "set_pieces_drive" });
  const api = await s.connect("office_api");
  const { default: pg } = await import("pg");
  const pen = await import("../src/world2-pen.mjs");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 4 });
  pen.__setPoolForTest(pool);
  try {
    const q = async (t, p) => (await api.query(t, p)).rows;
    // the drive's clock, inside one settlement window, its rows written on the window's own instants
    const realStart = Date.now();
    const now = Math.min(realStart, windowAt(realStart).ends - 10 * 60_000);
    const w = windowAt(now);
    const row = (actor, action, object, payload, cls = "creature", at = now) => normalizeRow({ crossing: currentCrossing(at), actor, action, object, cls,
      at: { anchor: WORLD_ANCHOR, dx: 0, dy: 0 }, payload, writtenAt: iso(at) });
    const put = (r) => pen.officeWrite((c) => pen.insertAct(c, r));
    await put(row("the-town", "spawn", ID, { kind: "fighter", at: iso(now - 30 * 3600_000), stays: true, x: 0, y: 0 }));
    const fresh = async () => { const l = new LivingSet({ law: LAW }); await l.refresh({ query: q, now }); return l; };
    const living = await fresh();
    const c = living.byId.get(ID);

    // A · A FEINT IS ANSWERED ONCE. One aimed at ren 40 min ago: the tick lapses it, and a second tick (another office) does not
    const hurlId = String(await put(row(ID, HURL_ACTION, "ren", { piece: "feint", throws: "a ball of sparks", says: "x", until: iso(now - 10 * 60_000), window: w.id }, "creature", now - 40 * 60_000)));
    const stale = await fresh();
    await living.refresh({ query: q, now });
    __resetEncounterTickForTest();
    const tick = (l) => encounterTick({ living: l, law: LAW }, { now, deps: { roster: async () => ROSTER, strikes: async () => [], finish: async () => ({}), flee: async () => null,
      creatures: async () => null, standpoint: async () => null, write: async () => null, answer: async () => [], answerRing: async () => [], freeze: () => null,
      actsSince: async () => [], outside: async () => false, gist: async () => false, writeTempted: async () => ({ rows: [] }), jevLint: async () => null } });
    await tick(living);
    await tick(stale);
    const hurled = await q(`SELECT payload FROM acts WHERE action = '${HURLED_ACTION}' AND payload->>'hurl' = $1`, [hurlId]);
    assert.deepEqual(hurled.map((r) => r.payload.outcome), ["lapsed"], "lapsed once, though two ticks saw it open");
    // and an answer racing the lapse: a reaction carrying its own answer to the same feint writes neither the answer nor what rode on it
    const said = String(await put(row("ren", "say", null, { text: "hm" }, "voice")));
    const act = { actor: "ren", verb: "say", actId: said, atIso: iso(now) };
    const late = reactionRows(c, act, { reaction: "notice", to: "ren", verb: "say" }, { now });
    late.push(creatureRow(c, HURLED_ACTION, "ren", { hurl: hurlId, outcome: "held", by: said, window: w.id }, "held", now),
      creatureRow(c, SANITY_ACTION, "ren", { by: 2, why: "held", act: said, hurl: hurlId, window: w.id }, "held", now));
    const wrote = await writeReaction(late);
    assert.deepEqual(wrote.rows.map((r) => r.action), ["react"], "the reaction stands; the answer and its sanity do not");

    // B · A SET PIECE BEGINS ONCE. Sanity at half: the fight moves to its disguise, and says its surrender to the ring
    await put(row(ID, SANITY_ACTION, "kai", { by: 6, why: "held", act: "1", window: w.id }));
    const two = [await fresh(), await fresh()];
    const first = await advanceFight(two[0].byId.get(ID), FIGHTER, FIGHT, { living: two[0], now, roster: ROSTER });
    const second = await advanceFight(two[1].byId.get(ID), FIGHTER, FIGHT, { living: two[1], now, roster: ROSTER });
    assert.equal(first.piece, "disguise");
    assert.equal(second, null, "the other office's look finds it begun");
    assert.equal((await q(`SELECT 1 FROM acts WHERE action = '${PHASE_ACTION}'`)).length, 1);
    assert.deepEqual((await q(`SELECT object FROM acts WHERE action = '${LINE_ACTION}' ORDER BY id`)).map((r) => r.object), ["kai", "ren", "ana"]);

    // C · A DISGUISE IS BROKEN ONCE: two looks from inside its ring, from two offices
    const looks = [await fresh(), await fresh()];
    const u1 = await unmaskFight(looks[0].byId.get(ID), FIGHTER, FIGHT, { by: "ana", verb: "investigate", living: looks[0], now, roster: ROSTER });
    const u2 = await unmaskFight(looks[1].byId.get(ID), FIGHTER, FIGHT, { by: "kai", verb: "strike", living: looks[1], now, roster: ROSTER });
    assert.equal(u1.piece, "unbreakable");
    assert.equal(u2, null);
    assert.deepEqual((await q(`SELECT object FROM acts WHERE action = '${UNMASKED_ACTION}'`)).map((r) => r.object), ["ana"], "the first breaker is the one on the record");
    assert.equal((await q(`SELECT 1 FROM acts WHERE action = '${PHASE_ACTION}'`)).length, 2);
    const after = await fresh();
    assert.equal(pieceOf(after.byId.get(ID), FIGHT, now).piece, "unbreakable", "a restarted office folds the same set piece");

    // D · ONCE PER HOUSEHOLD EACH SETTLEMENT, in the persuade's own transaction
    const persuade = (actor, household) => pen.officeWrite(async (cl) => {
      await persuadeGuard(actor, ID, household, { now })(cl);
      return pen.insertAct(cl, row(actor, "persuade", ID, { words: `${actor}'s words`, household, window: w.id }));
    });
    await persuade("ana", "house:hearth");
    await assert.rejects(persuade("bo", "house:hearth"), (e) => e.code === 409 && /once per household/.test(e.hint));
    await persuade("kai", "solo:kai");

    // E · THE ENDING: sanity full in its last piece when the settlement runs; the town withdraws it, ended, and restores the class, once
    for (const [who, by] of [["ana", 8], ["kai", 5]]) await put(row(ID, SANITY_ACTION, who, { by, why: "persuade", act: "2", window: w.id }));
    await q(`INSERT INTO settlements (number, tag_sha, published_at) VALUES (300, $1, $2)`, ["a".repeat(40), iso(w.ends + 41_000)]).catch(async () => {
      // the drive's office_api role inserts; a schema without the table answers here plainly
      throw new Error("the embedded store has no settlements table");
    });
    const client = await pool.connect();
    try {
      const r1 = await endCreatures(client, { law: LAW, now: w.ends + 60_000 });
      const r2 = await endCreatures(client, { law: LAW, now: w.ends + 60_000 });
      assert.equal(r1.ended.length, 1, r1.line);
      assert.equal(r2.ended.length, 0, "once");
    } finally { client.release(); }
    const [end] = await q(`SELECT payload, effect FROM acts WHERE action = 'withdraw' AND object = $1`, [ID]);
    assert.equal(end.payload.reason, "ended");
    assert.deepEqual([end.payload.sanity, end.payload.of, end.payload.restores], [12, 12, "snack"]);
    assert.ok(end.payload.took_part.includes("ana") && end.payload.took_part.includes("kai"));
    const restored = await q(`SELECT actor, object, payload FROM acts WHERE action = 'restore'`);
    assert.deepEqual(restored.map((r) => [r.actor, r.object, r.payload.by]), [["the-town", "snack", ID]]);
  } finally {
    pen.__setPoolForTest(null);
    await pool.end().catch(() => {});
    await api.end().catch(() => {});
    await s.stop();
  }
});
