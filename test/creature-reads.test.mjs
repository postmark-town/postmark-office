// creature-reads.test.mjs — a creature's afforded actions can be READ (the 2026-10-24 bug post
// wayward-archivist/creature-actions-advertised-but-unreadable; src/creature-verbs.mjs § readCreatureVerb).
//
// The bare read listed watch, approach and the rest under granted.here whenever a creature was in
// sight, but world { read: "watch" } answered 422 "not an action anywhere in your view": the shadow
// read gathers grants from the ground and the class marks at a standpoint (apexReadAction), and a
// creature's verbs are granted by neither, so the calculus never found them. The act had its own door
// (dispatchCreatureVerb, before the calculus) and the read had none. And the cards had no blurb,
// because creatureEntries built entries by hand and never quoted the class mark.
//
// The rule: anything you can do, you can read; a read never performs.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { LivingSet, loadCreatureLaw, reactTo } from "../src/creatures.mjs";
import { CREATURE_VERBS, creatureEntries, creaturePairs, worldCreature } from "../src/creature-verbs.mjs";
import { fullCards, canBlock } from "../src/world-read-v2.mjs";
import { NO_WORLD, worldClone, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const LAW_DIR = "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/creature";
const lawRecords = async () => {
  const { parseRecord } = await import(worldModuleUrl("tools", "marks-fold.mjs"));
  const root = join(worldClone(), LAW_DIR);
  return readdirSync(root, { recursive: true }).map(String).filter((p) => /(^|[\\/])mark\.md$/.test(p))
    .map((p) => parseRecord(readFileSync(join(root, p), "utf8"), `${LAW_DIR}/${p}`));
};
const LAW = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)),
  readText: (path) => readFileSync(join(worldClone(), path), "utf8"), lawRecords });

const NOW = Date.parse("2026-10-21T15:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const BAT = "creature:bat-270-1", RAVEN = "creature:raven-270-1", WOLF = "creature:wolf-270-1";
const spawnRow = (id, kind, { n = 1, x = 0, y = 0, at = NOW - 3600_000 } = {}) =>
  ({ id: String(n), at: iso(at), actor: "the-town", action: "spawn", object: id, payload: { kind, at: iso(at), fades_at: iso(at + 12 * 3600_000), x, y } });
// a bat at the origin (ring 30), a raven 1000 m east (ring 60), a wolf 2000 m east (ring 80)
const THREE = () => new LivingSet({ law: LAW }).fold([spawnRow(BAT, "bat"), spawnRow(RAVEN, "raven", { n: 2, x: 1000 }), spawnRow(WOLF, "wolf", { n: 3, x: 2000 })]);
const ENV = { TYPESAFE_API_KEY: "k" };
const KEY = { handles: new Set(["kai"]), household: "hh:kai" };

/** Every collaborator a spy; what any of them was asked to do is on `calls`. */
function seams({ living = THREE(), here = { x: 10, y: 0 }, carrying = true } = {}) {
  const calls = { write: [], offer: [], approach: [], say: [], answer: [], others: [] };
  let next = 900;
  const deps = {
    now: () => NOW, clock: () => NOW, env: ENV, freeze: () => null,
    creatures: async () => ({ living, law: LAW }),
    standpoint: async () => here,
    carryingConsumable: async () => carrying,
    write: async (e) => { calls.write.push(e); return { actId: String(++next), written_at: iso(NOW) }; },
    offer: async (a) => { calls.offer.push(a); return { did: "offer", kind: a.kind ?? "hoard-coins", seq: String(++next), written_at: iso(NOW), holds: { holder: "kai", shows: "nothing" }, offered: { kind: "hoard-coins", name: "hoard coins", body: "x" } }; },
    approach: async (a, k, id) => { calls.approach.push({ ...a, creature: id }); return { result: { walked: true }, rows: [{ id: String(++next), action: "walk", actor: "kai", written_at: iso(NOW) }] }; },
    say: async (a) => { calls.say.push(a); return { spoke: true }; },
    answer: async (act, d2) => { calls.answer.push(act);
      return reactTo(act, { ...d2, env: ENV, now: NOW, clock: () => NOW, around: async () => ({}), heardFor: async () => null,
        ask: async () => { throw Object.assign(new Error("down"), { why: "fault" }); },
        write: async (rows) => ({ prior: false, rows: rows.map((r, i) => ({ id: String(5000 + i), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }) }); },
    others: async (rows, except) => { calls.others.push({ rows, except }); return []; },
  };
  return { deps, calls };
}
const nothingDone = (calls) => Object.values(calls).every((l) => l.length === 0);
const effectOf = (kind, verb) => LAW.affordedOf(kind).find((a) => a.action === verb).effect;

async function apex() {
  process.env.WORLD_APEX = "1";
  return import("../src/world-apex.mjs");
}

test("a resident in the bat's ring reads watch, approach and shoo through the apex: the card quotes the class mark, nothing is done", async () => {
  const { worldApex } = await apex();
  const { deps, calls } = seams({ here: { x: 20, y: 0 } }); // 20 m from the bat: inside its 30 m ring, outside half of it
  for (const verb of ["watch", "approach", "shoo"]) {
    const r = await worldApex({ read: verb }, KEY, { creatureDeps: deps });
    assert.equal(r.error, undefined, `${verb}: ${r.defect ?? ""}`);
    assert.equal(r.read, verb);
    assert.equal(r.card.action, verb);
    assert.equal(r.card.blurb, effectOf("bat", verb), `${verb}: the blurb is the class mark's own words`);
    assert.ok(r.card.blurb.length > 10);
    assert.equal(r.card.blurb_from, "the-town/creature", "quoted from the class that declares it");
    assert.ok("creature" in r.card.fields, "the card names the field the act takes");
    assert.deepEqual(r.creatures.map((c) => c.id), [BAT]);
    assert.equal(r.creatures[0].can, true, `${verb}: ${r.creatures[0].why_not}`);
  }
  assert.ok(nothingDone(calls), `a read never performs: ${JSON.stringify(calls)}`);
});

test("every pair the bare read advertises is readable, and the row says it can be aimed; the matrix and the read cannot differ", async () => {
  const { worldApex } = await apex();
  for (const here of [{ x: 980, y: 0 }, { x: 25, y: 0 }, { x: 1020, y: 0 }, { x: 2050, y: 0 }]) {
    const living = THREE();
    const pairs = creaturePairs({ here, living, law: LAW, carryingConsumable: true, now: NOW, env: ENV });
    assert.ok(pairs.length > 0);
    const { deps, calls } = seams({ living, here });
    for (const { verb, object } of pairs) {
      const r = await worldApex({ read: verb }, KEY, { creatureDeps: deps });
      assert.equal(r.error, undefined, `${verb} on ${object} from ${here.x} is advertised but ${r.defect}`);
      const row = r.creatures.find((c) => c.id === object);
      assert.ok(row?.can, `${verb} on ${object}: ${JSON.stringify(row)}`);
      const narrowed = await worldApex({ read: verb, args: { creature: object } }, KEY, { creatureDeps: deps });
      assert.deepEqual(narrowed.creatures.map((c) => c.id), [object], "creature: narrows the read to the one");
    }
    assert.ok(nothingDone(calls));
  }
});

test("the reads and the acts agree: where a read says can, the door admits it; where it says why_not, the door refuses and does nothing", async () => {
  const { worldApex, dispatchCreatureVerb } = await apex();
  for (const [here, carrying] of [[{ x: 980, y: 0 }, true], [{ x: 1010, y: 0 }, false], [{ x: 25, y: 0 }, false], [{ x: 1070, y: 0 }, true]]) {
    for (const verb of CREATURE_VERBS) {
      const { deps } = seams({ here, carrying });
      const r = await worldApex({ read: verb }, KEY, { creatureDeps: deps });
      if (r.error) continue; // nothing in sight takes it
      for (const row of r.creatures) {
        const act = seams({ here, carrying });
        const done = await dispatchCreatureVerb(verb, { do: verb, args: { creature: row.id } }, KEY, { door: (a, k) => worldCreature(a, k, act.deps) });
        if (row.can) assert.equal(done.error, undefined, `${verb} on ${row.id} from ${here.x}: the read says can, the act says ${done.defect}`);
        else {
          assert.equal(done.error, "bounce", `${verb} on ${row.id} from ${here.x}: the read says ${row.why_not}`);
          assert.ok(nothingDone(act.calls), "a refused act did nothing");
        }
      }
    }
  }
});

test("a verb out of reach is still readable: the row says why not (offer with empty hands, approach inside half the ring, shoo from sight)", async () => {
  const { worldApex } = await apex();
  const near = seams({ here: { x: 1010, y: 0 }, carrying: false }); // 10 m from the raven, hands empty
  const offer = await worldApex({ read: "offer" }, KEY, { creatureDeps: near.deps });
  assert.equal(offer.error, undefined);
  assert.equal(offer.creatures[0].can, false);
  assert.match(offer.creatures[0].why_not, /nothing to offer/);
  const approach = await worldApex({ read: "approach" }, KEY, { creatureDeps: near.deps });
  assert.match(approach.creatures[0].why_not, /already within/);
  const farther = seams({ here: { x: 1070, y: 0 } }); // 70 m off: in sight, outside the raven's 60 m ring
  const shoo = await worldApex({ read: "shoo" }, KEY, { creatureDeps: farther.deps });
  assert.equal(shoo.creatures[0].can, false);
  assert.match(shoo.creatures[0].why_not, /inside its ring/);
  assert.ok(nothingDone(near.calls) && nothingDone(farther.calls));
});

test("nothing in sight that takes the verb: the read bounces plainly, naming what is in sight", async () => {
  const { worldApex } = await apex();
  const lonely = seams({ here: { x: -700, y: 0 } });
  const none = await worldApex({ read: "watch" }, KEY, { creatureDeps: lonely.deps });
  assert.equal(none.error, "bounce");
  assert.equal(none.code, 422);
  assert.match(none.defect, /no creature in sight takes it/);
  const bat = seams({ here: { x: 10, y: 0 } });
  const wrong = await worldApex({ read: "watch", args: { creature: RAVEN } }, KEY, { creatureDeps: bat.deps });
  assert.equal(wrong.error, "bounce");
  assert.match(wrong.hint, new RegExp(BAT));
  const call = await worldApex({ read: "call" }, KEY, { creatureDeps: bat.deps }); // a bat does not take call
  assert.equal(call.error, "bounce");
});

test("a read refuses the act's payload by name and every unknown field by name; the resident is the key's, as for the act", async () => {
  const { worldApex } = await apex();
  const { deps, calls } = seams({ here: { x: 1010, y: 0 } });
  for (const [verb, args, re] of [
    ["call", { creature: RAVEN, words: "hello" }, /a read never performs: words/],
    ["offer", { creature: RAVEN, kind: "hoard-coins" }, /a read never performs: kind/],
    ["watch", { creature: RAVEN, nonce: "n1" }, /a read never performs: nonce/],
    ["watch", { creature: RAVEN, bogus: 1 }, /does not take: bogus/],
  ]) {
    const r = await worldApex({ read: verb, args }, KEY, { creatureDeps: deps });
    assert.equal(r.error, "bounce", verb);
    assert.match(r.defect, re);
  }
  const two = await worldApex({ read: "watch" }, { handles: new Set(["kai", "lee"]) }, { creatureDeps: deps });
  assert.match(two.defect, /which resident/);
  const notMine = await worldApex({ read: "watch", handle: "zed" }, KEY, { creatureDeps: deps });
  assert.equal(notMine.code, 403);
  const human = await worldApex({ read: "watch", as: "human" }, KEY, { creatureDeps: deps });
  assert.match(human.defect, /a resident's/);
  assert.ok(nothingDone(calls));
});

test("fail closed as the act does: creatures off is 503, a law with no afforded actions is 409, an unplaced resident is 422", async () => {
  const { worldApex } = await apex();
  const s = seams();
  assert.equal((await worldApex({ read: "watch" }, KEY, { creatureDeps: { ...s.deps, env: { CREATURE_JUDGE: "off" } } })).code, 503);
  assert.equal((await worldApex({ read: "watch" }, KEY, { creatureDeps: { ...s.deps, creatures: async () => ({ living: THREE(), law: { ...LAW, afforded: null } }) } })).code, 409);
  assert.equal((await worldApex({ read: "watch" }, KEY, { creatureDeps: { ...s.deps, standpoint: async () => null } })).code, 422);
});

test("the bare read's creature cards carry the class mark's blurb, the class it is quoted from and the fields; the glance's lines and cards:full say them", () => {
  const living = THREE();
  const pairs = creaturePairs({ here: { x: 1010, y: 0 }, living, law: LAW, carryingConsumable: true, now: NOW, env: ENV });
  const entries = creatureEntries(pairs, { law: LAW, living, now: NOW });
  assert.deepEqual(entries.map((e) => e.action), ["watch", "shoo", "call", "offer"]);
  for (const e of entries) {
    assert.equal(e.blurb, effectOf("raven", e.action), `${e.action}: an empty blurb is the bug`);
    assert.equal(e.blurb_from, LAW.affordedOf("raven").find((a) => a.action === e.action).from_class);
    assert.ok(Object.keys(e.fields).includes("creature"), e.action);
  }
  assert.deepEqual(Object.keys(entries.find((e) => e.action === "offer").fields).sort(), ["creature", "handle", "kind"]);
  assert.deepEqual(Object.keys(entries.find((e) => e.action === "call").fields).sort(), ["creature", "handle", "words"]);
  assert.deepEqual(Object.keys(entries.find((e) => e.action === "watch").fields).sort(), ["creature", "handle"]);
  assert.equal(fullCards(entries).watch.blurb, effectOf("raven", "watch"));
  assert.ok(canBlock(entries).creatures.watch.length > 0);
  // without the law in hand the entry is what it was: never an invented blurb
  assert.equal(creatureEntries(pairs)[0].blurb, undefined);
});

test("inside the 10 s answer window the read says so, with the seconds left, as the act's 429 does", async () => {
  const { worldApex, dispatchCreatureVerb } = await apex();
  const living = THREE();
  living.fold([{ id: "77", at: iso(NOW - 4000), actor: RAVEN, action: "react", object: "70", payload: { to: "kai", verb: "walk", reaction: "watch", roll: 3 } }]);
  const { deps } = seams({ living, here: { x: 1010, y: 0 } });
  const r = await worldApex({ read: "watch" }, KEY, { creatureDeps: deps });
  assert.equal(r.error, undefined);
  assert.equal(r.creatures[0].can, false);
  assert.equal(r.creatures[0].why_not, "still answering you");
  assert.equal(r.creatures[0].retry_after_s, 6);
  const act = seams({ living, here: { x: 1010, y: 0 } });
  const done = await dispatchCreatureVerb("watch", { do: "watch", args: { creature: RAVEN } }, KEY, { door: (a, k) => worldCreature(a, k, act.deps) });
  assert.equal(done.code, 429, "the act agrees");
});

test("a world freeze: every row says can:false with the freeze's words, as the act bounces", async () => {
  const { worldApex } = await apex();
  const { deps } = seams({ here: { x: 1010, y: 0 } });
  const r = await worldApex({ read: "watch" }, KEY, { creatureDeps: { ...deps, freeze: () => ({ error: "bounce", code: 503, defect: "the world is frozen for the settlement" }) } });
  assert.equal(r.error, undefined);
  assert.ok(r.creatures.every((c) => c.can === false && /frozen/.test(c.why_not)));
});

test("any `as` the act refuses, the read refuses: a human, an unknown kind", async () => {
  const { worldApex } = await apex();
  const { deps } = seams({ here: { x: 1010, y: 0 } });
  for (const as of ["human", "companion"]) {
    const r = await worldApex({ read: "watch", as }, KEY, { creatureDeps: deps });
    assert.equal(r.error, "bounce", as);
    assert.equal(r.code, 422, as);
  }
});

test("a blurb is capped at the class grammar's 150, and a refused read lists every verb any creature in sight takes", async () => {
  const { worldApex } = await apex();
  const long = { ...LAW, affordedOf: (k) => LAW.affordedOf(k).map((a) => ({ ...a, effect: a.effect + " ".padEnd(200, "x") })) };
  const s = seams({ living: THREE(), here: { x: 1010, y: 0 } });
  const r = await worldApex({ read: "watch" }, KEY, { creatureDeps: { ...s.deps, creatures: async () => ({ living: THREE(), law: long }) } });
  assert.ok(r.card.blurb.length <= 150 && r.card.blurb.endsWith("…"));
  const entries = creatureEntries([{ verb: "watch", object: RAVEN }], { law: long, living: THREE(), now: NOW });
  assert.ok(entries[0].blurb.length <= 150);
  // hands empty: offer is not aimable, but the raven takes it, so the hint lists it
  const empty = seams({ here: { x: 1010, y: 0 }, carrying: false });
  const none = await worldApex({ read: "whisper" }, KEY, { creatureDeps: empty.deps });
  assert.equal(none.error, "bounce");
  assert.match(none.hint, /Readable from here: watch, approach, shoo, call, offer\./);
});
