// creature-verbs.test.mjs — a creature's afforded actions, the office half (POS-672; src/creature-verbs.mjs).
//
// RULED (Darko 2026-10-16 17:47 and 18:06; the details 2026-10-20 22:37, all as
// the gap read recommended, D4 as Wright's version): watch, approach and shoo
// for every creature; call and offer for the wolf and the raven; whisper for the
// bat. The reply IS the creature's reaction (call 7), from that creature alone
// (D7). From sight: watch, approach, call; from inside its ring: shoo, offer,
// whisper (D1). Approach walks to half its ring (D2). Offer uses up one
// consumable you carry (call 2, D3). A call's words are public like a say; a
// whisper's are on its own row and never in the shared ear (D4). The raven
// repeats a few words heard in public (D5). An aimed act inside the 10 s window
// is refused before anything happens (D6).
//
// The LAW is the world's own at the pinned clone (tools/creature-kind.mjs,
// tools/creatures.mjs, the class marks and the three kind files, as the office
// reads them at the blessed ref). The door's collaborators are injected: the
// store, the hold lane, the walk and the say have their own suites.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { LivingSet, loadCreatureLaw, reactTo, dial } from "../src/creatures.mjs";
import {
  AIMED_JEV_MS, AIMED_WAIT_MS, APPROACH_STOP, CREATURE_VERBS, SIGHT_M, WORDS_MAX,
  creatureEntries, creaturePairs, whyNot, worldCreature,
} from "../src/creature-verbs.mjs";
import { canOn, canVerbs } from "../src/usable-verbs.mjs";
import { ACT_GROUPS, canBlock } from "../src/world-read-v2.mjs";
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
const spawnRow = (id, kind, { n = 1, x = 0, y = 0, at = NOW - 3600_000, moods } = {}) =>
  ({ id: String(n), at: iso(at), actor: "the-town", action: "spawn", object: id,
    payload: { kind, at: iso(at), fades_at: iso(at + 12 * 3600_000), x, y, ...(moods ? { moods } : {}) } });
// a bat at the origin (ring 30), a raven 1000 m east (ring 60), a wolf 2000 m east (ring 80)
const livingWith = (...rows) => new LivingSet({ law: LAW }).fold(rows);
const THREE = () => livingWith(spawnRow(BAT, "bat"), spawnRow(RAVEN, "raven", { n: 2, x: 1000 }), spawnRow(WOLF, "wolf", { n: 3, x: 2000 }));
const ENV = { TYPESAFE_API_KEY: "k" };
const KEY = { handles: new Set(["kai"]), household: "hh:kai" };

/** The door with every collaborator a spy: what it was handed, and what it wrote. */
function door({ living = THREE(), law = LAW, here = { x: 10, y: 0 }, carrying = true, env = ENV, pick = null, now = NOW } = {}) {
  const calls = { write: [], offer: [], approach: [], say: [], answer: [], others: [] };
  let next = 900;
  const deps = {
    now: () => now, clock: () => now, env,
    freeze: () => null,
    creatures: async () => (law ? { living, law } : null),
    standpoint: async () => here,
    carryingConsumable: async () => carrying,
    write: async (entry) => { calls.write.push(entry); return { actId: String(++next), written_at: iso(now) }; },
    offer: async (a) => { calls.offer.push(a); return { did: "offer", kind: a.kind ?? "hoard-coins", seq: String(++next), written_at: iso(now), holds: { holder: "kai", shows: "nothing" },
      offered: { kind: a.kind ?? "hoard-coins", name: "hoard coins", body: "Hard-sugar coins stamped with a ridge of red spikes." } }; },
    approach: async (a, k, id) => { calls.approach.push({ ...a, creature: id }); return { result: { walked: true }, rows: [{ id: String(++next), action: "walk", actor: "kai", written_at: iso(now) }] }; },
    say: async (a) => { calls.say.push(a); return { spoke: true }; },
    answer: async (act, deps2) => { calls.answer.push({ act, deps: deps2 });
      return reactTo(act, { ...deps2, env, now, clock: () => now, around: async () => ({}), heardFor: async () => null,
        ask: pick ? async () => ({ response: { answers: { reaction: { probabilities: pick } } } }) : async () => { throw Object.assign(new Error("down"), { why: "fault" }); },
        write: async (rows) => ({ prior: false, rows: rows.map((r, i) => ({ id: String(5000 + i), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }) }); },
    others: async (rows, except) => { calls.others.push({ rows, except }); return []; },
  };
  return { deps, calls, run: (args) => worldCreature(args, KEY, deps) };
}
const nothingDone = (calls) => ["write", "offer", "approach", "say", "answer"].every((k) => calls[k].length === 0);

// ── the law, as the office reads it ─────────────────────────────────────────

test("the law at the pin declares the afforded actions per kind, and the office reads them (fail closed without them)", async () => {
  assert.deepEqual(LAW.affordedOf("bat").map((a) => a.action), ["watch", "approach", "shoo", "whisper"]);
  assert.deepEqual(LAW.affordedOf("raven").map((a) => a.action), ["watch", "approach", "shoo", "call", "offer"]);
  assert.deepEqual(LAW.affordedOf("wolf").map((a) => a.action), ["watch", "approach", "shoo", "call", "offer"]);
  assert.deepEqual([...LAW.kindMod.AFFORDED_VERBS], [...CREATURE_VERBS], "the door's six are the world's six");
  // a ref with no afforded actions (before the world half) reads none, and the law is otherwise whole
  const older = await loadCreatureLaw({ ref: "older", importTool: (f) => import(worldModuleUrl("tools", f)),
    readText: (path) => readFileSync(join(worldClone(), path), "utf8"), lawRecords: async () => { throw new Error("no marks here"); } });
  assert.equal(older.afforded, null);
  assert.deepEqual(older.affordedOf("bat"), []);
  assert.ok(older.kindOf("bat"), "the kinds still read: the ring stands without the verbs");
});

// ── D1, D2, D3: from where, and what you hold (the one judgment) ─────────────

test("D1: watch, approach and call from sight; shoo, offer and whisper from inside the ring; a kind takes only its own", () => {
  const c = THREE().byId.get(BAT); // ring 30
  const why = (verb, d, carrying = true) => whyNot(verb, c, d, { law: LAW, carryingConsumable: carrying });
  assert.equal(why("watch", 400), null);
  assert.match(why("watch", SIGHT_M + 1), /out of sight/);
  assert.equal(why("whisper", 30), null);
  assert.match(why("whisper", 31), /from inside its ring \(30 m\)/);
  assert.match(why("shoo", 31), /inside its ring/);
  assert.match(why("call", 10), /does not take call/, "a bat takes no call");
  assert.match(why("offer", 10), /does not take offer/);
  const raven = THREE().byId.get(RAVEN); // ring 60
  assert.equal(whyNot("call", raven, 450, { law: LAW }), null);
  assert.equal(whyNot("offer", raven, 60, { law: LAW, carryingConsumable: true }), null);
  assert.match(whyNot("offer", raven, 61, { law: LAW, carryingConsumable: true }), /inside its ring \(60 m\)/);
  assert.match(whyNot("offer", raven, 20, { law: LAW, carryingConsumable: false }), /nothing to offer/, "D3: a consumable in your hands");
});

test("D2: approach is usable until you stand within half the ring", () => {
  const wolf = THREE().byId.get(WOLF); // ring 80
  assert.equal(whyNot("approach", wolf, 41, { law: LAW }), null);
  assert.match(whyNot("approach", wolf, 40, { law: LAW }), /already within 40 m/);
  assert.equal(APPROACH_STOP, 0.5);
});

// ── W4: shown when usable, one matrix projected two ways ────────────────────

test("W4: `can` lists each creature verb once; investigate's `can` is one creature's column; the bare verbs are the union of the columns", () => {
  const living = THREE();
  const here = { x: 950, y: 0 }; // 50 m from the raven (in its ring, past half of it), 950 m from the bat and 1050 m from the wolf (out of sight)
  const pairs = creaturePairs({ here, living, law: LAW, carryingConsumable: true, now: NOW, env: ENV });
  assert.deepEqual(canOn(pairs, RAVEN), ["watch", "approach", "shoo", "call", "offer"]);
  assert.deepEqual(canOn(pairs, BAT), [], "out of sight: nothing");
  const union = [...new Set(living.living(NOW).flatMap((c) => canOn(pairs, c.id)))];
  assert.deepEqual(canVerbs(pairs).filter((v) => CREATURE_VERBS.includes(v)).sort(), union.sort(), "the invariant, over every creature in view");
  const entries = creatureEntries(pairs);
  assert.deepEqual(entries.map((e) => e.action), ["watch", "approach", "shoo", "call", "offer"], "each verb once");
  assert.deepEqual(entries.find((e) => e.action === "call").creatures, [RAVEN]);
  assert.deepEqual(Object.keys(canBlock(entries, { names: true }).creatures ?? []).length ? canBlock(entries, { names: true }).creatures : null,
    ["watch", "approach", "shoo", "call", "offer"], "the read groups them as `creatures`");
  assert.deepEqual(ACT_GROUPS.creatures, [...CREATURE_VERBS]);
  // each line teaches the exact call (Wright 2026-10-20: an agent learns it from `can` itself)
  const lines = canBlock(entries).creatures;
  for (const v of Object.keys(lines)) assert.ok(lines[v].includes(`world { do: "${v}", args: { creature: "<its id>"`), `${v}: ${lines[v]}`);
  // nothing carried: no offer; within half its ring: no approach
  const close = creaturePairs({ here: { x: 1010, y: 0 }, living, law: LAW, carryingConsumable: false, now: NOW, env: ENV });
  assert.deepEqual(canOn(close, RAVEN), ["watch", "shoo", "call"]);
  // fail closed: no afforded actions in the law, or the creatures switched off
  assert.deepEqual(creaturePairs({ here, living, law: { ...LAW, afforded: null }, now: NOW, env: ENV }), []);
  assert.deepEqual(creaturePairs({ here, living, law: LAW, now: NOW, env: { CREATURE_JUDGE: "off" } }), []);
});

test("W4: the door admits exactly the matrix's pairs (a pair the matrix shows is never refused for reach)", async () => {
  const living = THREE();
  for (const here of [{ x: 980, y: 0 }, { x: 25, y: 0 }, { x: 1600, y: 0 }, { x: 2050, y: 0 }]) {
    const pairs = creaturePairs({ here, living, law: LAW, carryingConsumable: true, now: NOW, env: ENV });
    for (const c of living.living(NOW)) for (const verb of CREATURE_VERBS) {
      const d = door({ living: THREE(), here });
      const shown = pairs.some((p) => p.verb === verb && p.object === c.id);
      const r = await d.run({ act: verb, creature: c.id }).then(() => "admitted", (e) => (e.code === 422 || e.code === 409 ? "refused" : `other ${e.code}`));
      assert.equal(r, shown ? "admitted" : "refused", `${verb} on ${c.id} from ${here.x}`);
    }
  }
});

// ── the door's refusals: nothing is written, nothing used up ─────────────────

test("refusals: which resident, not yours, no law (503), no afforded actions (409), which creature, none (404), gone (410), not its verb, out of reach", async () => {
  const cases = [
    [{ act: "pounce", creature: BAT }, {}, 422, /not a creature's afforded action/],
    [{ act: "watch", creature: BAT, handle: "mo" }, {}, 403, /not one of your residents/],
    [{ act: "watch", creature: BAT }, { law: null }, 503, /cannot be read here/],
    [{ act: "watch", creature: BAT }, { law: { ...LAW, afforded: null, affordedOf: () => [] } }, 409, /not law yet/],
    [{ act: "watch" }, {}, 422, /watch which creature\?/],
    [{ act: "watch", creature: "creature:bat-999-9" }, {}, 404, /no creature/],
    [{ act: "whisper", creature: RAVEN }, { here: { x: 1000, y: 10 } }, 422, /does not take whisper/],
    [{ act: "shoo", creature: BAT }, { here: { x: 40, y: 0 } }, 409, /inside its ring/],
    [{ act: "offer", creature: RAVEN }, { here: { x: 1000, y: 10 }, carrying: false }, 409, /nothing to offer/],
    [{ act: "watch", creature: BAT }, { env: { CREATURE_JUDGE: "off" } }, 503, /resting/],
  ];
  for (const [args, over, code, re] of cases) {
    const d = door(over);
    await assert.rejects(d.run(args), (e) => e.code === code && re.test(e.defect), JSON.stringify(args));
    assert.ok(nothingDone(d.calls), `nothing was done: ${JSON.stringify(args)}`);
  }
  const fled = livingWith(spawnRow(BAT, "bat"), { id: "9", at: iso(NOW - 60_000), actor: BAT, action: "withdraw", object: BAT, payload: { reason: "fled" } });
  const d = door({ living: fled });
  await assert.rejects(d.run({ act: "watch", creature: BAT }), (e) => e.code === 410 && /gone/.test(e.defect) && /fled/.test(e.hint));
  await assert.rejects(door().run({ act: "watch", creature: BAT, words: "hi" }), /watch carries no words/);
  await assert.rejects(door({ here: { x: 1000, y: 10 } }).run({ act: "call", creature: RAVEN, words: "x".repeat(WORDS_MAX + 1) }), /more than a call carries/);
});

test("D6: an afforded action inside the 10 s window is refused before anything happens, so an offer uses nothing up", async () => {
  const living = THREE();
  living.fold([{ id: "77", at: iso(NOW - 4000), actor: RAVEN, action: "react", object: "70", payload: { to: "kai", verb: "walk", reaction: "watch", roll: 3 } }]);
  const d = door({ living, here: { x: 1000, y: 10 } });
  await assert.rejects(d.run({ act: "offer", creature: RAVEN, kind: "hoard-coins" }),
    (e) => e.code === 429 && /still answering you/.test(e.defect) && e.retry_after_s === 6 && /try again in 6 s/.test(e.hint));
  assert.ok(nothingDone(d.calls), "nothing written, nothing used up");
  assert.equal(dial("per_actor_ms"), 10_000);
});

// ── the reply is the reaction (call 7), that creature's alone (D7) ──────────

test("watch: its own row (actor, verb, the creature, class creature) is the trigger; that creature alone answers, within AIMED_WAIT_MS, Jev given AIMED_JEV_MS", async () => {
  const d = door({ pick: { still: 1 } });
  const r = await d.run({ act: "watch", creature: BAT });
  const [row] = d.calls.write;
  assert.deepEqual([row.actor, row.action, row.object, row.cls, row.payload.kind], ["kai", "watch", BAT, "creature", "bat"]);
  const [{ act, deps }] = d.calls.answer;
  assert.equal(deps.aimed.id, BAT);
  assert.equal(deps.jevMs, AIMED_JEV_MS);
  assert.equal(deps.deadline, NOW + AIMED_WAIT_MS);
  assert.equal(act.actId, "901");
  assert.equal(r.did, "watch");
  assert.equal(r.reaction.id, BAT);
  assert.equal(r.reaction.reaction, "still");
  assert.equal(r.reaction.line, "The bat hangs from nothing at all, quite still, watching kai back.");
  assert.equal(r.reaction.judged_by, "jev");
});

test("every verb, every kind: the reply is one of the kind's reactions for that verb, and code answers when Jev is down", async () => {
  const where = { bat: { x: 10, y: 0 }, raven: { x: 1010, y: 0 }, wolf: { x: 2010, y: 0 } };
  const ids = { bat: BAT, raven: RAVEN, wolf: WOLF };
  for (const kind of ["bat", "raven", "wolf"]) {
    const keyed = (verb) => LAW.kindOf(kind).reactions.filter((x) => new RegExp(`act\\.verb == "${verb}"`).test(x.src)).map((x) => x.name);
    for (const verb of LAW.affordedOf(kind).map((a) => a.action)) {
      const here = verb === "approach" ? { x: where[kind].x + 300, y: 0 } : where[kind];
      // Jev picks among the verb's own reactions (those its `when` allows now); then Jev is down and code rolls the d20 over the menu
      const picked = await door({ here, pick: Object.fromEntries(keyed(verb).map((n) => [n, 1])) })
        .run({ act: verb, creature: ids[kind], ...(verb === "offer" ? { kind: "hoard-coins" } : {}) });
      assert.ok(keyed(verb).includes(picked.reaction.reaction), `${kind} ${verb}: ${picked.reaction.reaction}`);
      assert.equal(picked.reaction.judged_by, "jev");
      const down = await door({ here }).run({ act: verb, creature: ids[kind], ...(verb === "offer" ? { kind: "hoard-coins" } : {}) });
      assert.equal(down.reaction.judged_by, "code", `${kind} ${verb}: Jev down, code answers`);
      assert.ok(LAW.kindOf(kind).reactions.some((x) => x.name === down.reaction.reaction));
    }
  }
});

test("offer (call 2, D3): the hold lane uses one up toward the creature, its row is the trigger, and the line names what was held out", async () => {
  const d = door({ here: { x: 2010, y: 0 }, pick: { accept: 1 } });
  const r = await d.run({ act: "offer", creature: WOLF, kind: "hoard-coins" });
  assert.deepEqual(d.calls.offer, [{ kind: "hoard-coins", creature: WOLF }]);
  assert.equal(d.calls.write.length, 0, "the offer's row is the hold lane's units:offer, not a second row");
  assert.equal(d.calls.answer[0].act.actId, "901");
  assert.deepEqual(d.calls.answer[0].act.offered, { kind: "hoard-coins", name: "hoard coins", body: "Hard-sugar coins stamped with a ridge of red spikes." });
  assert.equal(r.reaction.line, "The wolf waits until kai steps back, then takes the hoard coins in one snap.");
  assert.equal(r.offered, "hoard-coins");
  assert.ok(r.holds);
});

test("approach (D2): a walk to half the ring along the line to it; the walk is the trigger; every other creature answers it as a walk", async () => {
  const d = door({ here: { x: 1300, y: 0 }, pick: { lets: 1 } });
  const r = await d.run({ act: "approach", creature: RAVEN });
  assert.deepEqual(d.calls.approach, [{ handle: "kai", x: 1030, y: 0, creature: RAVEN }], "half of the raven's 60 m ring, on the near side");
  assert.equal(d.calls.answer[0].act.approaching, true);
  assert.equal(d.calls.answer[0].act.actId, "901", "the walk's own row");
  assert.deepEqual(d.calls.others.map((o) => o.except), [RAVEN], "the others answer it, and the raven does not twice");
  assert.deepEqual(r.walk, { walked: true });
  assert.equal(r.reaction.reaction, "lets");
});

test("D4: a call's words are spoken through the say (public, heard); a whisper's are on its own row and never spoken", async () => {
  const call = door({ here: { x: 1010, y: 0 }, pick: { caw: 1 } });
  const c = await call.run({ act: "call", creature: RAVEN, words: "  is   anyone   there " });
  assert.deepEqual(call.calls.say, [{ handle: "kai", text: "is anyone there" }], "the say's own door: heard by the shared ear, on the record");
  assert.deepEqual(call.calls.write[0].payload, { kind: "raven", said: true }, "the call's row points at the say, never a second copy of the words");
  assert.equal(c.words, "is anyone there");
  // a settled bat (fear 1, as after a watch's stillness) leans in; a startled one would startle
  const whisper = door({ living: livingWith(spawnRow(BAT, "bat", { moods: { fear: 1 } })), here: { x: 10, y: 0 }, pick: { listen: 1 } });
  const w = await whisper.run({ act: "whisper", creature: BAT, words: "it's all right" });
  assert.deepEqual(whisper.calls.say, [], "a whisper is never spoken: the shared ear never holds it");
  assert.deepEqual(whisper.calls.write[0].payload, { kind: "bat", words: "it's all right" }, "on the record, on its own row");
  assert.equal(whisper.calls.write[0].cls, "creature", "a creature row, not a voice: nothing that reads what was said nearby reads it");
  assert.equal(whisper.calls.answer[0].act.words, "it's all right", "the bat's answer is judged on them");
  assert.equal(w.reaction.reaction, "listen");
});

test("D4: a whisper's words reach the bat's judgment and no one's ear; a call's words reach both", async () => {
  // the slice the judge reads carries the words; the ear (creatureHeard) reads only the voices
  const living = THREE();
  let slice = null;
  await reactTo({ actor: "kai", verb: "whisper", actId: "1", atIso: iso(NOW), point: { x: 10, y: 0 }, words: "hush now" },
    { living, law: LAW, aimed: living.byId.get(BAT), env: ENV, now: NOW, clock: () => NOW, deadline: NOW + AIMED_WAIT_MS, around: async () => ({}),
      ask: async (s) => { slice = s; return { response: { answers: { reaction: { probabilities: { listen: 1 } } } } }; },
      write: async (rows) => ({ prior: false, rows: rows.map((r) => ({ id: "2", at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }) });
  assert.equal(slice.this_act.words, "hush now");
  const src = readFileSync(new URL("../src/creature-verbs.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /voices\.mjs/, "the door never writes a voice itself: a call speaks through the say's door, a whisper not at all");
});

test("D5: the raven repeats a few words heard in public, filled by code; nothing heard, no mimicry on the menu", async () => {
  const living = THREE();
  const run = (heard) => reactTo({ actor: "kai", verb: "call", actId: "3", atIso: iso(NOW), point: { x: 1010, y: 0 } },
    { living, law: LAW, aimed: living.byId.get(RAVEN), env: ENV, now: NOW, clock: () => NOW, deadline: NOW + AIMED_WAIT_MS, around: async () => ({}),
      heardFor: async () => heard, ask: async () => ({ response: { answers: { reaction: { probabilities: { mimic: 1, caw: 0 } } } } }),
      write: async (rows) => ({ prior: false, rows: rows.map((r) => ({ id: "4", at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }) });
  const [r] = await run("meet me by the old mill");
  assert.equal(r.reaction, "mimic");
  assert.equal(r.line, 'The raven calls back in a voice not its own: "meet me by the old mill"');
  const living2 = THREE();
  const [none] = await reactTo({ actor: "kai", verb: "call", actId: "5", atIso: iso(NOW), point: { x: 1010, y: 0 } },
    { living: living2, law: LAW, aimed: living2.byId.get(RAVEN), env: ENV, now: NOW, clock: () => NOW, deadline: NOW + AIMED_WAIT_MS, around: async () => ({}),
      heardFor: async () => null, ask: async () => ({ response: { answers: { reaction: { probabilities: { mimic: 1, caw: 1 } } } } }),
      write: async (rows) => ({ prior: false, rows: rows.map((r) => ({ id: "6", at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }) });
  assert.notEqual(none.reaction, "mimic", "nothing heard: the mimicry is not on the menu");
});

test("tastes (call 8): the kind's plain-prose line rides the creature's slice for Jev", async () => {
  const living = THREE();
  let slice = null;
  await reactTo({ actor: "kai", verb: "offer", actId: "7", atIso: iso(NOW), point: { x: 1010, y: 0 }, offered: { kind: "hoard-coins", name: "hoard coins" } },
    { living, law: LAW, aimed: living.byId.get(RAVEN), env: ENV, now: NOW, clock: () => NOW, deadline: NOW + AIMED_WAIT_MS, around: async () => ({}),
      ask: async (s) => { slice = s; return { response: { answers: { reaction: { probabilities: { snatch: 1 } } } } }; },
      write: async (rows) => ({ prior: false, rows: rows.map((r) => ({ id: "8", at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }) });
  assert.match(slice.creature.tastes, /[Ss]hiny/);
  assert.deepEqual(slice.this_act.offered, { kind: "hoard-coins", name: "hoard coins" });
});

test("an aimed verb never answers on the ring's path, and a ring verb never takes the aimed path", async () => {
  const living = THREE();
  const base = { living, law: LAW, env: ENV, now: NOW, clock: () => NOW, around: async () => ({}), ask: async () => { throw new Error("down"); },
    write: async (rows) => ({ prior: false, rows: rows.map((r) => ({ id: "9", at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }) };
  assert.deepEqual(await reactTo({ actor: "kai", verb: "watch", actId: "10", atIso: iso(NOW), point: { x: 10, y: 0 } }, base), [], "no aimed creature: watch is no ring verb");
  assert.deepEqual(await reactTo({ actor: "kai", verb: "say", actId: "11", atIso: iso(NOW), point: { x: 10, y: 0 } }, { ...base, aimed: living.byId.get(BAT) }), [], "aimed: only an afforded verb");
});

nodeTest("the doors: each verb is the apex's, dispatched to world_creature before the grant calculus, and charged on the world-write ledger", async () => {
  process.env.WORLD_APEX = "1";
  const { dispatchToolFor, worldApex } = await import("../src/world-apex.mjs");
  const { WORLD_WRITE_VERBS } = await import("../src/bouncer.mjs");
  for (const v of CREATURE_VERBS) assert.equal(dispatchToolFor(v), "world_creature", v);
  assert.ok(WORLD_WRITE_VERBS.has("world_creature"), "one line per act on the household's world-write ledger, whichever door");
  // a human never aims one: refused at the door, before anything is read
  const human = await worldApex({ do: "watch", as: "human", args: { creature: BAT } }, KEY, {});
  assert.equal(human.error, "bounce");
  assert.match(human.defect, /a resident's/);
  // the door answers through the apex's envelope, its refusal whole (here: the verb names no creature)
  const bare = await worldApex({ do: "watch", args: {} }, KEY, {});
  assert.equal(bare.error, "bounce");
  assert.equal(bare.dispatched_to, "world_creature");
  assert.equal(bare.did, "watch");
  // the envelope is judged against the grammar (CREATURE_TOOLS, schema only): an unknown field bounces by name
  const odd = await worldApex({ do: "call", args: { creature: RAVEN, shout: "hey" } }, KEY, {});
  assert.equal(odd.error, "bounce");
  assert.match(odd.defect, /does not take: shout/);
});

test("D4: a call's words keep the say's own rule (a voice every 15 s); its refusal is said as the call's, and nothing is written", async () => {
  const d = door({ here: { x: 1010, y: 0 } });
  d.deps.say = async (a) => { d.calls.say.push(a); return { error: "bounce", code: 422, defect: "you just spoke", hint: "a voice every 15 seconds — try again in 2s (listening is free: call with no arguments)" }; };
  await assert.rejects(d.run({ act: "call", creature: RAVEN, words: "again" }),
    (e) => e.code === 422 && /the call's words could not be spoken: you just spoke/.test(e.defect) && /try again in 2 s, or call without words/.test(e.hint));
  assert.equal(d.calls.write.length, 0, "no call row");
  assert.equal(d.calls.answer.length, 0, "no reaction");
});
