// named-creature-ending.test.mjs — a named creature stays, is finished, and ends at
// the settlement (WLD-25; src/creatures.mjs, src/creatures-read.mjs,
// src/creature-tick.mjs § the named creatures, world2/tools/creature-endings.mjs).
//
// RULED (Darko, 2026-10-20 22:47 and 22:56 EDT): what a named creature carries
// drops at the settlement, to the first resident to finish it by record order,
// on either road; everyone who took part is named; that settlement retires it.
// SETTLED (Wright, the same night, W1–W11): the ending on the office tick, the
// nominal settlement instant as the cutoff, a finish row any mechanic writes, an
// earned finish taken by code (W4), the 10 s window never swallowing it (W5),
// and the ending failing closed until the blessed law knows "ended" (W8).
//
// No mechanic is chosen here. The world's kind grammar has no `finish` yet (its
// PR follows POS-672's), so the finishing kind is the pinned law's own parsed
// kind with `{ do: "finish" }` added to one reaction: the stub mechanic.
//
// THE CAN-FAIL FLIPS (each reds a case below): take `finishing` out of the
// window check in creatureTurn; let Jev judge a menu holding a finish; drop
// writeFinishOnce's look; order firstFinisher by row instead of act id; write an
// ending while DESPAWN_REASONS lacks "ended"; drop the staying arm of the boot read.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

import {
  ENDED, FINISH_ACTION, FINISH_WHY, LIVING_BOOT_SQL, STAYING_SQL, LivingSet, PRIOR_FINISH_SQL, TRIGGER_SQL,
  finishes, loadCreatureLaw, reactTo, reactionRows, recordFinish, writeReaction, buildSlice,
} from "../src/creatures.mjs";
import { findCreatures, investigateCreature, creatureHappening } from "../src/creatures-read.mjs";
import { creatureTick, namedSpawns } from "../src/creature-tick.mjs";
import { settlementAtOrBefore } from "../src/world-forecast.mjs";
import {
  FINISHES_SQL, ANSWERED_SQL, NEWEST_SETTLEMENT_SQL, PRIOR_WITHDRAW_SQL, STAYING_SPAWNS_SQL, THING_HOLDER_SQL, THING_STANDING_SQL,
  NAMES_SHOWN, TOOK_PART, endCreatures, endingLine, firstFinisher, namesSaid, planEnding, tookPart,
} from "../world2/tools/creature-endings.mjs";
import { endingsOnTick, softStepStatus } from "../world2/tools/settlements-backfill.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const levels = (m) => `none | a little ${m} | plain ${m} | overwhelming ${m}`;
const KIND_TEXT = `kind: wolf
name: a grey wolf
ring_m: 80
what: >
  A grey wolf. It belongs to no one.
moods:
  fear: 0..3 = 1 | ${levels("fear")}
reaction watch "it stands still and watches": when true says The wolf stands perfectly still, watching {actor}.
reaction yield "it lowers its head": when act.verb == "say" says The wolf lowers its head to {actor}.
`;
const BASE = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)),
  readText: (path) => { if (path !== "WORLD/kinds/wolf.kind") throw new Error(`no fixture kind at ${path}`); return KIND_TEXT; } });
/** The stub mechanic: the pinned kind, with `yield` finishing. */
const STUB = NO_WORLD ? null : (() => {
  const k = BASE.kindOf("wolf");
  return { ...k, reactions: k.reactions.map((r) => (r.name === "yield" ? { ...r, effects: [...r.effects, { do: "finish" }] } : r)) };
})();
/** The law as the office holds it, with the stub kind and (when `ended`) "ended" among the despawn reasons. */
const lawWith = ({ ended = true } = {}) => (NO_WORLD ? null : {
  ...BASE, kindOf: (name) => (name === "wolf" ? STUB : null),
  creaturesMod: { ...BASE.creaturesMod, DESPAWN_REASONS: ended ? [...BASE.creaturesMod.DESPAWN_REASONS, "ended"] : [...BASE.creaturesMod.DESPAWN_REASONS] },
});

const NOW = Date.parse("2026-10-26T13:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const ID = "creature:wolf-den";
let n = 100;
const staySpawn = (id = ID, { x = 0, y = 0, at = NOW - 3 * 24 * 3600_000, carries = "the-town/a-thing" } = {}) =>
  ({ id: String(++n), at: iso(at), actor: "the-town", action: "spawn", object: id, payload: { kind: "wolf", at: iso(at), stays: true, x, y, carries } });
const finishRowOf = (creature, by, act, at = NOW - 60_000) =>
  ({ id: String(++n), at: iso(at), actor: creature, action: FINISH_ACTION, object: creature, payload: { by, act: String(act) } });
const act = (over = {}) => ({ actor: "kai", verb: "say", actId: "9001", atIso: iso(NOW), point: { x: 10, y: 0 }, ...over });

function recordingWrite() {
  const calls = [];
  let next = 500;
  const write = async (rows) => {
    calls.push(rows);
    return { prior: false, rows: rows.map((r) => ({ id: String(next++), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) };
  };
  return { calls, write };
}
const payloadOf = (r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload);

// ── the living set: a creature that stays ──────────────────────────────────

test("a spawn with stays: true and no fades_at is taken, lives past any span, and is never pruned while it stays", () => {
  const living = new LivingSet({ law: lawWith() }).fold([staySpawn()]);
  const c = living.byId.get(ID);
  assert.ok(c, "taken, though it has no fades_at");
  assert.equal(c.stays, true);
  assert.equal(c.carries, "the-town/a-thing");
  assert.equal(c.fades_at, Infinity);
  assert.deepEqual(living.living(NOW + 30 * 24 * 3600_000).map((x) => x.id), [ID], "a month on, still here");
  living.prune(NOW + 30 * 24 * 3600_000);
  assert.ok(living.byId.has(ID));
  // and a Mists spawn without fades_at is still skipped, as before
  const mists = new LivingSet({ law: lawWith() }).fold([{ ...staySpawn("creature:wolf-270-1"), payload: { kind: "wolf", at: iso(NOW), x: 0, y: 0 } }]);
  assert.equal(mists.byId.size, 0);
});

test("finishes fold once per resident; an ended withdraw is honoured only when the law knows the reason", () => {
  const rows = [staySpawn(), finishRowOf(ID, "kai", 9001), finishRowOf(ID, "kai", 9005), finishRowOf(ID, "mo", 9003)];
  const living = new LivingSet({ law: lawWith() }).fold(rows);
  assert.deepEqual(living.byId.get(ID).finishes.map((f) => f.by), ["kai", "mo"]);
  const ended = { id: String(++n), at: iso(NOW), actor: "the-town", action: "withdraw", object: ID, payload: { reason: ENDED } };
  assert.equal(new LivingSet({ law: lawWith({ ended: false }) }).fold([...rows, ended]).byId.get(ID).gone, null, "a law without it ignores it");
  assert.equal(new LivingSet({ law: lawWith() }).fold([...rows, ended]).byId.get(ID).gone, ENDED);
});

nodeTest("the boot read also takes every row of a staying creature not yet withdrawn, however old", () => {
  assert.match(LIVING_BOOT_SQL, /OR actor IN \(/);
  assert.match(LIVING_BOOT_SQL, /OR object IN \(/);
  assert.ok(LIVING_BOOT_SQL.includes(STAYING_SQL));
  assert.match(STAYING_SQL, /payload->>'stays' = 'true'/);
  assert.match(STAYING_SQL, /NOT EXISTS \(SELECT 1 FROM acts w WHERE w\.class = 'creature' AND w\.action = 'withdraw'/);
});

test("the slice and the reads say it stays instead of naming a fade", () => {
  const law = lawWith();
  const living = new LivingSet({ law }).fold([staySpawn(), finishRowOf(ID, "kai", 9001)]);
  const c = living.byId.get(ID);
  assert.equal(buildSlice(c, STUB, { ...act(), distance_m: 10 }, {}, { now: NOW }).creature.fades_in, "never: it stays until it is finished");
  const [hit] = findCreatures({ living, law }, "wolf", { x: 0, y: 0 }, { nowMs: NOW });
  assert.equal(hit.stays, true);
  assert.equal("fades_in" in hit, false);
  assert.deepEqual(creatureHappening({ living, law }, { x: 0, y: 0 }, { nowMs: NOW }), [], "no far line names it at the Mists' edge");
});

test("investigate: a staying creature reads as here, with who has finished it, and no fade", async () => {
  const law = lawWith();
  const living = new LivingSet({ law }).fold([staySpawn(), finishRowOf(ID, "kai", 9001)]);
  const r = await investigateCreature(ID, { creatures: { living, law }, nowMs: NOW, rows: async () => [] });
  assert.equal(r.presence.now.state, "here until it is finished");
  assert.equal(r.presence.now.stays, true);
  assert.deepEqual(r.presence.now.finished_by, ["kai"]);
  assert.equal("fades_at" in r.presence.now, false);
  const ended = new LivingSet({ law }).fold([staySpawn(), { id: "999", at: iso(NOW - 1000), actor: "the-town", action: "withdraw", object: ID, payload: { reason: ENDED } }]);
  assert.equal((await investigateCreature(ID, { creatures: { living: ended, law }, nowMs: NOW, rows: async () => [] })).presence.now.state, "ended at its settlement");
});

// ── the finish: taken by code, never swallowed by the window ────────────────

test("a reaction carrying finish is taken by code with no Choice and no die, and writes its finish row beside the reaction", async () => {
  assert.equal(finishes(STUB.reactions.find((r) => r.name === "yield")), true);
  assert.equal(finishes(STUB.reactions.find((r) => r.name === "watch")), false);
  const law = lawWith();
  const living = new LivingSet({ law }).fold([staySpawn()]);
  const { calls, write } = recordingWrite();
  let asked = 0;
  const [answer] = await reactTo(act(), { living, law, write, now: NOW, env: { TYPESAFE_API_KEY: "k" }, ask: async () => { asked += 1; throw new Error("never"); } });
  assert.equal(asked, 0, "Jev is not asked when a finish is on the menu");
  assert.equal(answer.reaction, "yield");
  assert.equal(answer.judged_by, "code");
  const [react, fin] = calls[0];
  assert.equal(payloadOf(react).why, FINISH_WHY);
  assert.deepEqual(payloadOf(react).allowed, { watch: 0, yield: 1 }, "the odds the row stores re-derive the pick");
  assert.equal(fin.action, FINISH_ACTION);
  assert.equal(fin.actor, ID);
  assert.equal(fin.object, ID);
  assert.deepEqual(payloadOf(fin), { by: "kai", act: "9001", reaction: "yield" });
  assert.deepEqual(living.byId.get(ID).finishes.map((f) => f.by), ["kai"], "the set folds its own finish");
});

test("the 10 s window never swallows a finish; an act that would not finish still waits it out", async () => {
  const law = lawWith();
  const living = new LivingSet({ law }).fold([staySpawn()]);
  const { calls, write } = recordingWrite();
  const deps = { living, law, write, env: { CREATURE_JUDGE: "code" } };
  await reactTo(act({ verb: "walk", actId: "9001", atIso: iso(NOW) }), { ...deps, now: NOW });
  assert.equal(calls.length, 1, "the walk is answered");
  const second = await reactTo(act({ verb: "walk", actId: "9002", atIso: iso(NOW + 2000) }), { ...deps, now: NOW + 2000 });
  assert.deepEqual(second, [], "a walk 2 s later gets nothing (C2)");
  const fin = await reactTo(act({ verb: "say", actId: "9003", atIso: iso(NOW + 3000) }), { ...deps, now: NOW + 3000 });
  assert.equal(fin[0]?.reaction, "yield", "a finishing act 3 s later is answered");
  assert.equal(calls.at(-1).some((r) => r.action === FINISH_ACTION), true);
});

/** A store for the write paths: acts in memory, the queries the finish writer asks. */
function finishStore({ acts = [], triggers = ["9001", "9002"] } = {}) {
  let id = 700;
  const client = {
    query: async (sql, params = []) => {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (sql === PRIOR_FINISH_SQL) return { rows: acts.filter((a) => a.actor === params[0] && a.action === FINISH_ACTION && payloadOf(a).by === params[1]).map((a) => ({ id: a.id })) };
      if (sql === TRIGGER_SQL) return { rows: triggers.includes(String(params[0])) ? [{ here: 1 }] : [] };
      if (/PRIOR_REACTION|action = 'react' AND object/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  return {
    acts,
    officeWrite: async (fn) => fn(client),
    insertAct: async (_c, row) => { const r = { ...row, id: String(++id) }; acts.push(r); return r.id; },
  };
}

test("a resident finishes a creature once: a second finish, by reaction or by code, is not written again", async () => {
  const s = finishStore();
  const law = lawWith();
  const c = new LivingSet({ law }).fold([staySpawn()]).byId.get(ID);
  const rows = reactionRows(c, act(), { reaction: "yield" }, { now: NOW, finishes: true });
  const first = await writeReaction(rows, { officeWrite: s.officeWrite, insertAct: s.insertAct });
  assert.deepEqual(first.rows.map((r) => r.action), ["react", FINISH_ACTION]);
  const again = await writeReaction(reactionRows(c, act({ actId: "9002" }), { reaction: "yield" }, { now: NOW, finishes: true }), { officeWrite: s.officeWrite, insertAct: s.insertAct });
  assert.deepEqual(again.rows.map((r) => r.action), ["react"], "kai's second finish is answered and not written");
  const coded = await recordFinish(c, { actor: "kai", actId: "9002" }, { now: NOW, officeWrite: s.officeWrite, insertAct: s.insertAct });
  assert.deepEqual(coded, { written: false, why: "kai has already finished it" });
  assert.equal(s.acts.filter((a) => a.action === FINISH_ACTION).length, 1);
});

test("a finish from code needs a staying, living creature and an act on the record", async () => {
  const s = finishStore({ triggers: ["9001"] });
  const law = lawWith();
  const c = new LivingSet({ law }).fold([staySpawn()]).byId.get(ID);
  assert.deepEqual(await recordFinish(c, { actor: "mo", actId: "4242" }, { now: NOW, officeWrite: s.officeWrite, insertAct: s.insertAct }), { written: false, why: "its trigger act is not on the record" });
  const ok = await recordFinish(c, { actor: "mo", actId: "9001" }, { now: NOW, officeWrite: s.officeWrite, insertAct: s.insertAct });
  assert.equal(ok.written, true);
  assert.deepEqual(payloadOf(s.acts.at(-1)), { by: "mo", act: "9001" });
  const mists = { ...c, stays: undefined };
  assert.equal((await recordFinish(mists, { actor: "mo", actId: "9001" }, { officeWrite: s.officeWrite, insertAct: s.insertAct })).written, false);
});

// ── the tick: a named creature spawns once ever ─────────────────────────────

test("the tick spawns each declaration once ever, at its own place, from its crossing on, and puts what it carries in the town's hands", async () => {
  const W = { creaturesMod: BASE.creaturesMod, starts: { wolf: { moods: { fear: 1 } } },
    law: { fromCrossing: null, dials: {}, kinds: [], named: [{ id: ID, kind: "wolf", x: 100, y: 200, carries: "the-town/a-thing", from_crossing: 300, declared: "the-town/a-declaration" }] } };
  const acts = [];
  let id = 0;
  const query = async () => [];
  const write = async (row) => {
    const prior = acts.find((a) => a.action === row.action && a.object === row.object);
    if (prior) return { prior: true, row: prior };
    const r = { id: String(++id), at: row.written_at, actor: row.actor, action: row.action, object: row.object, payload: JSON.parse(row.payload) };
    acts.push(r);
    return { prior: false, row: r };
  };
  const held = [];
  const hold = async (thing, creature) => { held.push([thing, creature]); return { wrote: true }; };
  const crossingAt = (N) => Date.parse("2026-10-21T00:00:00Z") + (N - 262) * 12 * 3600_000 + 60_000;
  const before = await creatureTick({ now: crossingAt(299), key: null, query, write, hold, inputsAt: async () => W, blessed: () => "sha" });
  assert.equal(before.wrote.spawn, 0, "dark before its crossing");
  await creatureTick({ now: crossingAt(300), key: null, query, write, hold, inputsAt: async () => W, blessed: () => "sha" });
  await creatureTick({ now: crossingAt(301), key: null, query, write, hold, inputsAt: async () => W, blessed: () => "sha" });
  const spawns = acts.filter((a) => a.action === "spawn");
  assert.equal(spawns.length, 1, "once ever");
  assert.deepEqual({ ...spawns[0].payload, at: null }, { kind: "wolf", crossing: 300, x: 100, y: 200, at: null, stays: true,
    carries: "the-town/a-thing", declared: "the-town/a-declaration", moods: { fear: 1 }, flags: [] });
  assert.deepEqual(held[0], ["the-town/a-thing", ID]);
  // a bad declaration is said, never spawned
  const bad = [];
  assert.deepEqual(await namedSpawns({ now: crossingAt(300), N: 300, held: bad, blessed: () => "sha",
    inputsAt: async () => ({ ...W, law: { ...W.law, named: [{ id: "wolf-den", kind: "wolf", x: 1, y: 1, from_crossing: 1 }] } }) }), []);
  assert.match(bad[0], /its id is not a creature's/);
});

// ── the ending ──────────────────────────────────────────────────────────────

nodeTest("took part (D1, settled 2026-10-21): every act it answered, aimed or only in its ring; aimed acts on the other reading; finishers always", () => {
  const answered = [
    { act_id: "10", actor: "lu", object: "some/mark", approach: null },  // in its ring, not aimed
    { act_id: "11", actor: "bo", object: ID, approach: null },           // aimed
    { act_id: "12", actor: "ze", object: null, approach: ID },           // a walk toward it
    { act_id: "13", actor: "bo", object: ID, approach: null },
    { act_id: "14", actor: "the-town", object: ID, approach: null },
  ];
  const finishers = [{ by: "kai", act_id: "20", act_actor: "kai" }];
  assert.equal(TOOK_PART.value, "answered");
  assert.match(TOOK_PART.ruled, /settled by Wright/);
  assert.equal(NAMES_SHOWN.value, 12);
  assert.match(NAMES_SHOWN.ruled, /settled by Wright/);
  assert.deepEqual(tookPart(ID, answered, finishers), ["lu", "bo", "ze", "kai"], "lu acted only in its ring, and it answered: lu took part");
  assert.deepEqual(tookPart(ID, answered, finishers, { mode: "aimed" }), ["bo", "ze", "kai"]);
});

nodeTest("the first finisher is the lowest act id, by record order, never the order the finish rows were written", () => {
  const rows = [{ by: "mo", act_id: "30", act_actor: "mo" }, { by: "kai", act_id: "9", act_actor: "kai" }, { by: "lu", act_id: "100", act_actor: "lu" }];
  assert.deepEqual(firstFinisher(rows), { by: "kai", act_id: "9", act_actor: "kai" });
  assert.equal(firstFinisher([{ by: "mo", act_id: "5", act_actor: "kai" }]), null, "a finish naming someone else's act does not count");
  assert.equal(firstFinisher([]), null);
});

nodeTest("the line: the kind's own ending when it writes one, else plain words; twelve names, then the count", () => {
  assert.equal(namesSaid(["a"]), "a");
  assert.equal(namesSaid(["a", "b", "c"]), "a, b and c");
  assert.equal(namesSaid(Array.from({ length: 14 }, (_, i) => `r${i}`)), "r0, r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11 and 2 more");
  assert.equal(endingLine({ kind: "wolf", finisher: "kai", others: [] }), "The wolf is finished. kai finished it first.");
  assert.equal(endingLine({ kind: "wolf", finisher: "kai", others: ["mo", "lu"] }), "The wolf is finished. kai finished it first; mo and lu took part.");
  assert.equal(endingLine({ kind: "wolf", kindFile: { ending: "{finisher} wins {carried}; {names} were there." }, finisher: "kai", others: ["mo"], carried: "a thing" }),
    "kai wins a thing; mo were there.");
});

nodeTest("the cutoff is the settlement's own instant on the one clock, whenever its sweep pushed", () => {
  assert.equal(settlementAtOrBefore(new Date("2026-10-26T18:00:41Z")), "2026-10-26T18:00:00.000Z");
  assert.equal(settlementAtOrBefore(new Date("2026-10-26T05:59:59Z")), "2026-10-25T18:00:00.000Z");
  assert.equal(settlementAtOrBefore(new Date("2026-10-26T06:00:00Z")), "2026-10-26T06:00:00.000Z");
});

nodeTest("no finish counted, no ending", () => {
  assert.equal(planEnding({ spawn: staySpawn(), finishers: [], answered: [], settlement: 130, cutoff: "x" }), null);
});

/** A store for the ending: staying spawns, finishes, answered acts, marks standing, and every write recorded. */
function endingStore({ spawns = [staySpawn()], finishes: fins = [{ by: "kai", act_id: "20", act_actor: "kai" }], answered = [], standing = true, priorWithdraw = false, failInsert = false } = {}) {
  const writes = [], asked = [];
  const client = {
    query: async (sql, params = []) => {
      asked.push([sql, params]);
      if (sql === STAYING_SPAWNS_SQL) return { rows: spawns.map((s) => ({ id: s.id, object: s.object, payload: s.payload })) };
      if (sql === NEWEST_SETTLEMENT_SQL) return { rows: [{ number: 130, published_at: new Date("2026-10-26T18:00:41Z") }] };
      if (sql === FINISHES_SQL) return { rows: fins };
      if (sql === ANSWERED_SQL) return { rows: answered };
      if (sql === PRIOR_WITHDRAW_SQL) return { rows: priorWithdraw ? [{ id: "1" }] : [] };
      if (sql === THING_STANDING_SQL) return { rows: standing ? [{ here: 1 }] : [] };
      if (sql === THING_HOLDER_SQL) return { rows: [{ holder: "the-town", policy: "cascade" }] };
      if (/^\s*INSERT INTO acts/.test(sql)) { if (failInsert) throw new Error("the store refused it"); writes.push([sql, params]); return { rows: [] }; }
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) { writes.push([sql]); return { rows: [] }; }
      return { rows: [] };
    },
  };
  return { client, writes, asked };
}

test("the ending: the town gives what it carried to the first finisher and withdraws the creature, ended, in one transaction", async () => {
  const s = endingStore({ answered: [{ act_id: "11", actor: "bo", object: ID, approach: null }] });
  const r = await endCreatures(s.client, { law: lawWith(), now: NOW });
  assert.match(r.line, /^endings: ended 1 \(creature:wolf-den → kai\) at S130, cutoff 2026-10-26T18:00:00\.000Z$/);
  assert.equal(softStepStatus(r.line, "endings"), "ok");
  assert.deepEqual(s.writes.map(([q]) => q.trim().split(/\s+/).slice(0, 1)[0]), ["BEGIN", "INSERT", "INSERT", "COMMIT"]);
  const [, give] = s.writes[1], [, end] = s.writes[2];
  assert.equal(give[1], "the-town/a-thing");
  assert.deepEqual(JSON.parse(give[2]), { thing: "the-town/a-thing", holder: "kai", policy: "cascade", previous_holder: "the-town",
    ended: { creature: ID, act: "20", settlement: 130 } });
  assert.equal(end[1], ID);
  assert.deepEqual(JSON.parse(end[5]), { reason: "ended", finished_by: "kai", act: "20", took_part: ["bo", "kai"], carried: "the-town/a-thing",
    settlement: 130, cutoff: "2026-10-26T18:00:00.000Z" });
  assert.equal(end[6], "The wolf is finished. kai finished it first; bo took part.");
  const cut = s.asked.find(([q]) => q === FINISHES_SQL)[1];
  assert.deepEqual(cut, [ID, "2026-10-26T18:00:00.000Z"], "only finishes earned before the settlement's instant");
});

test("fail closed: until the blessed law knows \"ended\", nothing is written, and the line says why (ok, the design)", async () => {
  const s = endingStore();
  const r = await endCreatures(s.client, { law: lawWith({ ended: false }), now: NOW });
  assert.deepEqual(s.writes, []);
  assert.match(r.line, /^endings: none ended — the blessed law has no "ended" reason yet/);
  assert.equal(softStepStatus(r.line, "endings"), "ok");
  const unread = await endCreatures(endingStore().client, { law: { unavailable: "no law at the ref" } });
  assert.equal(softStepStatus(unread.line, "endings"), "refused prereq:law");
});

test("once: an ending already written is not written again; a thing not standing holds the whole ending back; a refused write alarms", async () => {
  const again = endingStore({ priorWithdraw: true });
  assert.match((await endCreatures(again.client, { law: lawWith(), now: NOW })).line, /^endings: ended 0 at S130/);
  assert.deepEqual(again.writes.map(([q]) => q), ["BEGIN", "ROLLBACK"]);
  const waits = endingStore({ standing: false });
  const w = await endCreatures(waits.client, { law: lawWith(), now: NOW });
  assert.deepEqual(waits.writes.map(([q]) => q), ["BEGIN", "ROLLBACK"]);
  assert.match(w.line, /1 waiting \(creature:wolf-den: what it carries, the-town\/a-thing, is not standing, so it waits\)/);
  assert.equal(softStepStatus(w.line, "endings"), "ok");
  const failed = endingStore({ failInsert: true });
  const f = await endCreatures(failed.client, { law: lawWith(), now: NOW });
  assert.match(f.line, / · 1 failed \(/);
  assert.equal(softStepStatus(f.line, "endings"), "refused write-failed");
  assert.equal(failed.writes.at(-1)[0], "ROLLBACK");
});

test("the tick's step: its own line, an error is one named line and alarms", async () => {
  const ok = await endingsOnTick(endingStore().client, "unused", { loadLaw: async () => lawWith(), now: () => NOW });
  assert.equal(softStepStatus(ok.line, "endings"), "ok");
  const threw = await endingsOnTick(null, "unused", { loadLaw: async () => { throw new Error("boom"); } });
  assert.equal(threw.line, "endings: NOT ended (non-fatal) — boom");
  assert.equal(softStepStatus(threw.line, "endings"), "refused write-failed");
});
