// temptation-store.test.mjs — a creature that tempts, on a real store: three
// residents; one obeys, one declines, one answers plainly; a phase advances; the
// settlement ends it by persuasion (src/temptation.mjs, src/creatures.mjs § the
// tempting half, src/encounter-verbs.mjs § encounterTick's resolver and
// givenToATempter, world2/tools/creature-endings.mjs § the tallies' ending).
//
// Each reaction is written by the real writeReaction, each give through the pen,
// each outcome by the real writeTempted (its lock, its look), and the ending by the
// real endCreatures on its own client. Jev is a stub that leans each temptation and
// each judgment the way the step names. The kind and its menu are the unit file's
// fixtures, with placeholder words.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

import { LivingSet, loadCreatureLaw, reactTo } from "../src/creatures.mjs";
import { windowAt } from "../src/encounter.mjs";
import { TEMPT_ACTION, TEMPTED_ACTION, TALLY_ACTION, phaseOf, talliesOf } from "../src/temptation.mjs";
import { encounterTick, givenToATempter, writeTempted, ACTS_SINCE_SQL, __resetEncounterTickForTest } from "../src/encounter-verbs.mjs";
import { endCreatures } from "../world2/tools/creature-endings.mjs";
import { normalizeRow, WORLD_ANCHOR } from "../src/world-journal.mjs";
import { currentCrossing, CROSSING_EPOCH_UTC, CROSSING_MS } from "../src/crossings.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const KIND_TEXT = `kind: tempter
name: a test tempter
ring_m: 40
what: >
  A fixture.
moods:
  mood: 0..3 = 1 | calm | stirred | eager | wild
reaction notice "it notices": when true says It notices {actor}.
`;
const BASE = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)), readText: () => KIND_TEXT });
const WHO = "a-tempter";
const reaction = (name, src, says) => ({ name, sentence: name, when: BASE.kindMod.parseCondition(src), src, effects: [{ do: "nothing" }], says });
const TEMPTER = NO_WORLD ? null : { ...BASE.kindOf("tempter"), finishable: true, tempts: "tempter.menu.json", who: WHO, fight_size: 12,
  reactions: [reaction("hum", "true", "It hums at {actor}.")] };
const W = (id, phase, text, tempts) => ({ id, phase, text, tempts, aims_at: "loudest", seen_through: ["names the trick"], slots: [] });
const MENU = {
  who: WHO, phaseOrder: ["hush", "recall"], phases: { hush: { aims_at: "loudest", span_m: 15, seen_through: [] }, recall: { aims_at: "longest", seen_through: [] } },
  // the same two asks in each phase, so the drive reads the same whatever the window's clock says
  whispers: [W("give", "hush", "Give me one small thing.", { act: "give", to: WHO, what: "any" }), W("leave", "hush", "Step back to the stair.", { act: "leave" }),
    W("give2", "recall", "You owe me one small thing.", { act: "give", to: WHO, what: "any" }), W("leave2", "recall", "Go home.", { act: "leave" })],
  lines: {}, endings: { damage: { name: "the fall", text: "It falls." }, persuasion: { name: "the turn", text: "It turns back." } }, quotes: [],
};
const LAW = NO_WORLD ? null : {
  ...BASE, kindOf: (n) => (n === "tempter" ? TEMPTER : null), menuOf: (n) => (n === "tempter" ? MENU : null),
  temptsMod: { fillWhisper: (t) => t }, lintChecked: new Map(MENU.whispers.map((w) => [w.id, true])),
  kindMod: { ...BASE.kindMod, ENCOUNTER_VERBS: ["strike", "steady", "shield"], scopeOf: (s, a, actor) => BASE.kindMod.scopeOf(s, a, actor) },
  creaturesMod: { ...BASE.creaturesMod, DESPAWN_REASONS: [...BASE.creaturesMod.DESPAWN_REASONS, "ended"] },
};
const ID = "creature:tempter-top";
const iso = (ms) => new Date(ms).toISOString();
const WHERE = { kai: { x: 10, y: 0 }, ren: { x: 0, y: 12 }, mo: { x: -14, y: 0 } };
const present = async () => ({ residents: Object.entries(WHERE).map(([handle, p]) => ({ handle, distance_m: Math.hypot(p.x, p.y) })) });
const lookup = (h) => ({ key: `solo:${h}`, slug: null });

/** How long the drive runs on its own clock: the tick resolves 31 minutes on, plus the drive's own waits and margin. */
const DRIVE_MS = 40 * 60_000;
/**
 * The drive's clock: the real one, held so the whole drive (to the tick 31 minutes on) stays inside the real
 * clock's settlement window AND its crossing. The pen refuses a row stamped with a crossing that has not opened
 * ("a row for crossing 266 may not enter the record while the open window is 265"), so a drive begun in the
 * last half hour before 00:00Z or 12:00Z wrote its tick's rows into the next crossing and every one was refused. Pure.
 */
function driveClockNow(realStart) {
  const nextCrossing = CROSSING_EPOCH_UTC + (currentCrossing(realStart) + 1) * CROSSING_MS;
  return Math.min(realStart, windowAt(realStart).ends - DRIVE_MS, nextCrossing - DRIVE_MS);
}

nodeTest("the drive's clock keeps the whole drive inside the real clock's crossing and window, at any hour", () => {
  // ⚑ THE FLIP: drop the nextCrossing bound from driveClockNow → the half hour before each crossing reds
  for (let m = 0; m < 24 * 60; m += 5) {
    const real = Date.UTC(2026, 9, 22, 0, 0) + m * 60_000;
    const base = driveClockNow(real), end = base + 31 * 60_000 + 2 * 60_000;
    const at = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}Z`;
    assert.ok(base <= real, `never ahead of the real clock (${at})`);
    assert.equal(currentCrossing(end), currentCrossing(real), `the tick's rows stay in the open crossing (${at})`);
    assert.equal(windowAt(end).id, windowAt(real).id, `the tallies stay in the real clock's window (${at})`);
  }
});

test("ON THE STORE · three residents: one obeys, one declines, one answers plainly; a phase advances; the settlement ends it by persuasion", async () => {
  const s = await startStore({ db: "temptation_drive" });
  const api = await s.connect("office_api");
  const owner = await s.connect("world2_owner");
  const { default: pg } = await import("pg");
  const pen = await import("../src/world2-pen.mjs");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 4 });
  pen.__setPoolForTest(pool);
  try {
    const q = async (t, p) => (await api.query(t, p)).rows;
    // THE DRIVE'S CLOCK: its 31 minutes must fit inside one settlement window (the tallies are a window's) and one
    // crossing (the pen refuses a row for a crossing not yet open), so near either end the whole drive runs earlier,
    // on the record's own instants (the pen writes `at` from them): driveClockNow
    const realStart = Date.now();
    const base = driveClockNow(realStart);
    const clock = () => base + (Date.now() - realStart);
    const row = (actor, action, object, payload, cls = "creature") => normalizeRow({ crossing: currentCrossing(), actor, action, object, cls,
      at: { anchor: WORLD_ANCHOR, dx: 0, dy: 0 }, payload, writtenAt: iso(clock()) });
    const insert = (r) => pen.officeWrite((c) => pen.insertAct(c, r));
    await insert(row("the-town", "spawn", ID, { kind: "tempter", at: iso(clock() - 3600_000), stays: true, x: 0, y: 0 }));
    const living = new LivingSet({ law: LAW });
    await living.refresh({ query: q, now: clock() });

    let lean = {};
    const ask = async (state, questions) => ({ response: { answers: {
      reaction: { probabilities: { hum: 1 } },
      ...(questions.tempt_with ? { tempt_with: { probabilities: Object.fromEntries(Object.keys(questions.tempt_with.criteria)
        .map((k) => [k, (MENU.whispers.find((w) => w.id === k)?.tempts.act ?? k) === lean.tempt ? 1 : 0])) } } : {}),
      ...(questions.answer ? { answer: { probabilities: { [lean.answer ?? "other"]: 1 } } } : {}),
    } } });
    const says = new Map();
    const seams = { living, law: LAW, present, households: async () => lookup, flee: () => {}, ask, env: { TYPESAFE_API_KEY: "k" },
      sayText: async (a) => says.get(String(a.actId)) ?? null };
    const say = async (who, text) => {
      const id = String(await insert(row(who, "say", null, { text }, "voice")));
      says.set(id, text);
      return reactTo({ actor: who, verb: "say", actId: id, atIso: iso(clock()), point: WHERE[who] }, { ...seams, now: clock() });
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    // ren speaks first and is tempted to give; then kai, tempted to leave; then mo, tempted to give
    lean = { tempt: "give" };
    const [a] = await say("ren", "hello up there");
    assert.equal(a.tempts?.to, "ren");
    lean = { tempt: "leave" };
    const [b] = await say("kai", "what are you");
    assert.equal(b.tempts?.to, "kai", "ren already holds one");
    lean = { tempt: "give" };
    const [c] = await say("mo", "it is late");
    assert.equal(c.tempts?.to, "mo");

    // ren obeys: a give to the one who speaks for it, which moves nothing
    const given = await givenToATempter({ to: WHO, kind: "a-thing" }, { handles: new Set(["ren"]) }, "ren",
      { now: clock, creatures: async () => ({ living, law: LAW }), standpoint: async (h) => WHERE[h],
        write: async (entry) => ({ actId: String(await insert(row(entry.actor, entry.action, entry.object, entry.payload))) }) });
    assert.equal(given.counted, true);
    await wait(10_500); // the 10 s window: each has just been answered
    // kai acts again in its ring, not as tempted (a decline, when its time runs out); mo answers plainly and short
    lean = { tempt: "none", answer: "other" };
    await say("kai", "I think I will stay a while");
    lean = { tempt: "none", answer: "plain" };
    // the phase is the window's clock's too, and this drive runs on the real clock: a short plain answer is +3 in the
    // first phase (its echo), +2 in the second
    const first = phaseOf(living, living.byId.get(ID), TEMPTER, MENU, clock()).name === "hush";
    const [m] = await say("mo", "That's a trick. I'm staying.");
    assert.deepEqual(m.counted, [first ? { for: "mo", persuasion: 3, why: "plain, and short" } : { for: "mo", persuasion: 2, why: "plain" }]);
    const plain = first ? 3 : 2;

    // 31 minutes on: the tick resolves all three, once
    __resetEncounterTickForTest();
    await living.refresh({ query: q, now: clock() });
    const later = clock() + 31 * 60_000;
    const d = { actsSince: (h, since) => q(ACTS_SINCE_SQL, [h, since]), outside: async () => false, gist: async () => false,
      roster: async () => [], writeTempted: (t, rows) => writeTempted(t, rows), jevLint: async () => true,
      strikes: async () => [], finish: async () => ({}), flee: async () => null, creatures: async () => null, standpoint: async () => null,
      write: async () => null, answer: async () => [], answerRing: async () => [], freeze: () => null };
    const out = await encounterTick({ living, law: LAW }, { now: later, deps: d });
    assert.equal(out.tempted, 3);
    await encounterTick({ living, law: LAW }, { now: later, deps: d });
    const outcomes = await q(`SELECT object, payload->>'outcome' AS outcome FROM acts WHERE action = '${TEMPTED_ACTION}' ORDER BY object`);
    assert.deepEqual(outcomes.map((r) => [r.object, r.outcome]), [["kai", "declined"], ["mo", "declined"], ["ren", "obeyed"]], "each once");

    // the tallies: ren's obeying mended damage (never below 0); kai's and mo's declines and mo's plain answer, 5 persuasion
    const fresh = new LivingSet({ law: LAW });
    await fresh.refresh({ query: q, now: clock() });
    const creature = fresh.byId.get(ID);
    assert.deepEqual(talliesOf(fresh, creature, clock()), { damage: 0, persuasion: 2 + plain });
    assert.equal(phaseOf(fresh, creature, TEMPTER, MENU, clock()).name, "recall", "4 or 5 of 12: past a third, the next phase");
    assert.equal((await q(`SELECT count(*)::int AS n FROM acts WHERE action = '${TEMPT_ACTION}'`))[0].n, 3);
    assert.equal((await q(`SELECT count(*)::int AS n FROM acts WHERE action = '${TALLY_ACTION}'`))[0].n, 4);

    // the settlement lands: the window's tallies end it by persuasion, naming everyone
    const ends = windowAt(clock()).ends;
    await owner.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (1, $1, $2, 'closed') ON CONFLICT (id) DO NOTHING", [iso(windowAt(clock()).start), iso(ends)]);
    await owner.query("INSERT INTO settlements (number, tag_sha, published_at, window_id) VALUES (900, $1, $2, 1)", ["9".repeat(40), iso(ends + 60_000)]);
    const client = await s.connect("office_api");
    try {
      const r = await endCreatures(client, { law: LAW, now: ends + 120_000 });
      assert.equal(r.ended.length, 1, r.line);
      assert.equal(r.ended[0].road, "persuasion");
    } finally { await client.end().catch(() => {}); }
    const [w] = await q(`SELECT payload, effect FROM acts WHERE action = 'withdraw' AND object = $1`, [ID]);
    assert.deepEqual([w.payload.reason, w.payload.road, w.payload.persuasion, w.payload.damage], ["ended", "persuasion", 2 + plain, 0]);
    assert.deepEqual([...w.payload.took_part].sort(), ["kai", "mo", "ren"]);
    assert.match(w.effect, /^It turns back\./);
  } finally {
    pen.__setPoolForTest(null);
    await pool.end().catch(() => {});
    await api.end().catch(() => {});
    await owner.end().catch(() => {});
    await s.stop();
  }
});
