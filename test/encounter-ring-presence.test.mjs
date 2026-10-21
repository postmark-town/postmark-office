// encounter-ring-presence.test.mjs — the ring an encounter reads is presence's own,
// read the way the doors read it (eval round 2: F3 was still open with the tick's
// kept ring in place).
//
// creatures.mjs § presentAt called presence bare. Presence answers only from the
// kept positions (POS-269), so with no projection handed to it every read came
// back unavailable: the tick kept nothing, the act's own read found no one, and
// every ring held only the actor (and a steady's or shield's friend), while the
// door's presence read saw everyone standing there. Each earlier test handed the
// encounter a stubbed `present`, so none of them read presence at all.
//
// Here nothing is stubbed between the walk ledger and the ring: a fixture world
// with a dungeon and a room inside it, four residents standing at one point in the
// room and a fifth inside the ring's radius but beyond the room's wall, the
// positions kept (WORLD_POSITIONS=1, WORLD_PRESENCE=1), the creature's room found
// by LivingSet § warmRooms over the published marks, the tick's warmRosters with
// its own presence read, and the act's turn reading what the tick kept, with the
// world's own scope: ring.households reads 3, a shield moves a press, housemates
// split one, and the one alone is not the actor.
//
// The flip: presentAt calling presentNear bare again. The ring reads the actor
// alone, and this file goes red.
//
// Run: node --test test/encounter-ring-presence.test.mjs

import { test as nodeTest, after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { fixtureWorldCloneWithEngine, fixtureWorldDb, mainShaOf, scratchDir, crossingStart } from "./dynamic-fixture.mjs";
import { NO_WORLD_DB } from "./helpers/world-rows.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";
import { NERVE_ACTION, windowAt } from "../src/encounter.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const scratch = scratchDir("encounter-ring");
const FRAME = "the-town/let-there-be-light";
const FORT = "fort/fort", ROOM = "fort/room";
const MARKS = [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "let there be light" },
  { id: FORT, by: "fort", kind: "sited", class: "dungeon", at: { x: 100, y: 0 }, extent: { w: 400, h: 400 }, body: "a fort" },
  { id: ROOM, by: "fort", kind: "sited", at: { x: 100, y: 0 }, extent: { w: 60, h: 60 }, body: "a room" }, // its walls at x = 70 and 130
];
process.env.WORLD_STORE_DB = NO_WORLD_DB;

// standing since a crossing in the past: four at the room's middle, one 35 m east (inside 40 m, beyond the wall)
const N = 200;
const B = crossingStart(N);
const stand = (actor, x, i) => ({ at: new Date(B).toISOString(), actor, from: { x, y: 0 }, toward: { x, y: 0 }, crossing: N, line_no: i + 1 });
const STANDERS = [stand("ash", 100, 0), stand("bram", 100, 1), stand("gale", 100, 2), stand("heron", 100, 3), stand("oak", 135, 4)];
const repo = fixtureWorldCloneWithEngine({ label: "encounter-ring", marks: MARKS, departures: STANDERS });
after(() => { for (const d of [scratch, repo]) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } } });
process.env.WORLD_CLONE = repo;
fixtureWorldDb(join(scratch, "world.db"), { sha: mainShaOf(repo), departures: STANDERS });

const KIND_TEXT = `kind: keeper
name: a test keeper
ring_m: 40
what: >
  A fixture.
moods:
  temper: 0..3 = 1 | calm | stirred | angry | wild
reaction notice "it notices": when true says It notices {actor}.
`;
const PRESS_ON = ["actor", "striker", "shielder", "loudest", "alone"];
// ash and bram share a hearth; gale, heron and oak each live alone
const HOMES = { ash: "hearth", bram: "hearth" };
const lookup = (h) => (HOMES[h] ? { key: "house:hearth", slug: "hearth" } : { key: `solo:${h}`, slug: null });
const ID = "creature:keeper-den";
const payloadOf = (r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload);

let creatures, law;
before(async () => {
  creatures = await import("../src/creatures.mjs");
  const base = await creatures.loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)), readText: () => KIND_TEXT });
  const reaction = (name, src, effects, says) => ({ name, sentence: name, when: base.kindMod.parseCondition(src), src, effects, says });
  const keeper = {
    ...base.kindOf("keeper"), finishable: true, resolve: 10, strike: 4,
    reactions: [
      // a pack's answer, open only when three households stand in its ring
      reaction("pack", `act.verb == "say" and ring.households >= 3`, [{ do: "nothing" }], "It sees a pack."),
      reaction("glare", `act.verb == "say" or act.verb == "give"`, [{ do: "press", n: 2, on: ["actor"] }], "It glares."),
      reaction("circle", `act.verb == "drop"`, [{ do: "press", n: 1, on: ["alone"] }], "It circles."),
      reaction("snap", `act.verb == "take"`, [{ do: "press", n: 2, on: ["actor"] }], "It snaps."),
    ],
  };
  law = { ...base, kindOf: (n) => (n === "keeper" ? keeper : null),
    kindMod: { ...base.kindMod, ENCOUNTER_VERBS: ["strike", "steady", "shield"], PRESS_ON,
      scopeOf: base.kindMod.scopeOf } }; // the world's own scope: ring.households is read from what the ring held
});

test("the ring is presence's own: four at one point in the room are the ring (three households), the one beyond its wall is not, and the press, the house split and a shield read them", async () => {
  process.env.WORLD_POSITIONS = "1";
  process.env.WORLD_PRESENCE = "1";
  try {
    assert.equal(typeof law.inCreatureRing, "function", "the pinned world's room clip");
    // inside one settlement window: the shield and the acts after it must share one
    const now = Math.min(Date.now(), windowAt(Date.now()).ends - 120_000);
    const iso = (ms) => new Date(ms).toISOString();
    let n = 30000;
    const nextId = () => String(++n);
    const living = new creatures.LivingSet({ law }).fold([{ id: nextId(), at: iso(now - 3600_000), actor: "the-town", action: "spawn", object: ID,
      payload: { kind: "keeper", at: iso(now - 3600_000), stays: true, x: 100, y: 0 } }]);
    // gale shields heron, before any of it
    living.fold([{ id: nextId(), at: iso(now - 30_000), actor: "gale", action: "shield", object: "heron", payload: { creature: ID, cost: 1 } }], { advance: false });
    // the creature's room, as the tick finds it: the published marks
    const pub = await creatures.publishedMarks({ repo });
    assert.ok(pub?.marks?.length, "the published marks are read");
    living.warmRooms(pub.marks, pub.key);
    assert.equal(living.living(now)[0].room?.id, ROOM, "it stands in the room");

    // the tick: presence at the creature's point, by presence's own read (no seam)
    creatures.__resetRostersForTest();
    assert.equal(await creatures.warmRosters(living, { now }), 1, "the tick kept one ring");

    const turn = async (verb, actor, at, pick) => {
      assert.equal(await creatures.warmRosters(living, { now: at }), 1, "the tick keeps the ring");
      const calls = [];
      const write = async (rows) => { calls.push(rows); return { prior: false, rows: rows.map((r) => ({ id: nextId(), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }; };
      const ask = async (s, q) => ({ response: { answers: { reaction: { probabilities: { [pick]: 1 } } } } });
      await creatures.reactTo({ actor, verb, actId: nextId(), atIso: iso(at), point: { x: 100, y: 0 } },
        { living, law, write, writeCost: write, now: at, env: { TYPESAFE_API_KEY: "k" }, ask, households: async () => lookup, flee: () => {} });
      return calls[0];
    };

    const presses = (rows) => rows.filter((r) => r.action === NERVE_ACTION && payloadOf(r).why === "press")
      .map((r) => [r.object, payloadOf(r).by, payloadOf(r).split_of ?? null, payloadOf(r).shield ?? null]).sort();
    // each act past the creature's answering window (10 s), the tick's ring warmed at its instant

    // ash speaks: the ring is the four in the room, never oak beyond the wall, three households, so a pack's answer is open
    const said = await turn("say", "ash", now, "pack");
    const react = payloadOf(said.find((r) => r.action === "react"));
    assert.deepEqual([...react.ring].sort(), ["ash", "bram", "gale", "heron"], "the four standing in the room, and not oak");
    assert.equal(react.reaction, "pack", "ring.households is 3: the pack's answer was on the menu, and taken");

    // ash gives: the press of 2 on ash is split with their housemate
    assert.deepEqual(presses(await turn("give", "ash", now + 15_000, "glare")), [["ash", -1, 2, null], ["bram", -1, 2, null]], "the house split");

    // heron takes something: the press on heron lands on gale, who shields them (once: a shield takes the next press)
    const taken = presses(await turn("take", "heron", now + 30_000, "snap"));
    assert.equal(taken.length, 1);
    assert.deepEqual(taken[0].slice(0, 2), ["gale", -2], "the shield moved the press");
    assert.ok(taken[0][3], "and the row says it was the shield");

    // gale drops something: the one alone is someone other than the actor, so Jev has a choice
    const dropped = await turn("drop", "gale", now + 45_000, "circle");
    assert.deepEqual(payloadOf(dropped.find((r) => r.action === "react")).press.menu.map((e) => e.on), ["heron"], "heron is the other one alone; gale, the actor, only when no one else is");

  } finally {
    delete process.env.WORLD_PRESENCE;
    delete process.env.WORLD_POSITIONS;
    creatures.__resetRostersForTest();
  }
});
