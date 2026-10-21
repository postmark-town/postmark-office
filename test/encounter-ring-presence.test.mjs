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
// with a dungeon and a hall inside it, four residents standing at one point in the
// hall and a fifth inside the ring's radius but beyond the hall's wall, the
// positions kept (WORLD_POSITIONS=1, WORLD_PRESENCE=1), the creature's room found
// by LivingSet § warmRooms over the published marks, the tick's warmRosters with
// its own presence read, and the act's turn reading what the tick kept.
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
import { NERVE_ACTION } from "../src/encounter.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const scratch = scratchDir("encounter-ring");
const FRAME = "the-town/let-there-be-light";
const KEEP = "keep/keep", HALL = "keep/hall";
const MARKS = [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "let there be light" },
  { id: KEEP, by: "keep", kind: "sited", class: "dungeon", at: { x: 100, y: 0 }, extent: { w: 400, h: 400 }, body: "a keep" },
  { id: HALL, by: "keep", kind: "sited", at: { x: 100, y: 0 }, extent: { w: 60, h: 60 }, body: "a hall" }, // its walls at x = 70 and 130
];
process.env.WORLD_STORE_DB = NO_WORLD_DB;

// standing since a crossing in the past: four at the hall's middle, one 35 m east (inside 40 m, beyond the wall)
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
const ID = "creature:keeper-hall";
const payloadOf = (r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload);

let creatures, law;
before(async () => {
  creatures = await import("../src/creatures.mjs");
  const base = await creatures.loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)), readText: () => KIND_TEXT });
  const reaction = (name, src, effects, says) => ({ name, sentence: name, when: base.kindMod.parseCondition(src), src, effects, says });
  const keeper = {
    ...base.kindOf("keeper"), finishable: true, resolve: 10, strike: 4,
    reactions: [
      reaction("glare", `act.verb == "say"`, [{ do: "press", n: 2, on: ["actor"] }], "It glares."),
      reaction("circle", `act.verb == "drop"`, [{ do: "press", n: 1, on: ["alone"] }], "It circles."),
    ],
  };
  law = { ...base, kindOf: (n) => (n === "keeper" ? keeper : null),
    kindMod: { ...base.kindMod, ENCOUNTER_VERBS: ["strike", "steady", "shield"], PRESS_ON,
      scopeOf: (s, a, actor, enc = {}) => { const sc = base.kindMod.scopeOf(s, a, actor); if (enc.resolve != null) sc.self.resolve = enc.resolve; return sc; } } };
});

test("the ring is presence's own: four at one point in the hall are the ring, the one beyond its wall is not, and the press reads them", async () => {
  process.env.WORLD_POSITIONS = "1";
  process.env.WORLD_PRESENCE = "1";
  try {
    assert.equal(typeof law.inCreatureRing, "function", "the pinned world's room clip");
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    let n = 30000;
    const nextId = () => String(++n);
    const living = new creatures.LivingSet({ law }).fold([{ id: nextId(), at: iso(now - 3600_000), actor: "the-town", action: "spawn", object: ID,
      payload: { kind: "keeper", at: iso(now - 3600_000), stays: true, x: 100, y: 0 } }]);
    // the creature's room, as the tick finds it: the published marks
    const pub = await creatures.publishedMarks({ repo });
    assert.ok(pub?.marks?.length, "the published marks are read");
    living.warmRooms(pub.marks, pub.key);
    assert.equal(living.living(now)[0].room?.id, HALL, "it stands in the hall");

    // the tick: presence at the creature's point, by presence's own read (no seam)
    creatures.__resetRostersForTest();
    assert.equal(await creatures.warmRosters(living, { now }), 1, "the tick kept one ring");

    const turn = async (verb, actor, at = now) => {
      const calls = [];
      const write = async (rows) => { calls.push(rows); return { prior: false, rows: rows.map((r) => ({ id: nextId(), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }; };
      const ask = async (s, q) => ({ response: { answers: { reaction: { probabilities: { [verb === "say" ? "glare" : "circle"]: 1 } } } } });
      await creatures.reactTo({ actor, verb, actId: nextId(), atIso: iso(at), point: { x: 100, y: 0 } },
        { living, law, write, writeCost: write, now: at, env: { TYPESAFE_API_KEY: "k" }, ask, households: async () => lookup, flee: () => {} });
      return calls[0];
    };

    // ash speaks: the ring is the four in the hall, never oak beyond the wall, and the press on ash splits with bram
    const said = await turn("say", "ash");
    const react = said.find((r) => r.action === "react");
    assert.deepEqual([...payloadOf(react).ring].sort(), ["ash", "bram", "gale", "heron"], "the four standing in the hall, and not oak");
    const pressed = said.filter((r) => r.action === NERVE_ACTION && payloadOf(r).why === "press")
      .map((r) => [r.object, payloadOf(r).by, payloadOf(r).split_of ?? null]);
    assert.deepEqual(pressed.sort(), [["ash", -1, 2], ["bram", -1, 2]], "the press of 2 on ash is split with her housemate");

    // gale drops something, past the creature's answering window: the one alone is someone other than the actor, so Jev has a choice
    const watched = await turn("drop", "gale", now + 15_000);
    const menu = payloadOf(watched.find((r) => r.action === "react")).press.menu.map((e) => e.on);
    assert.deepEqual(menu, ["heron"], "heron is the other one alone; gale, the actor, only when no one else is");
  } finally {
    delete process.env.WORLD_PRESENCE;
    delete process.env.WORLD_POSITIONS;
    creatures.__resetRostersForTest();
  }
});
