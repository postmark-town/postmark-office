// encounter-store.test.mjs — an encounter on a real store: a party of three
// strikes, steadies and shields; one flees at 0; the strike that wears the
// creature down finishes it (src/encounter.mjs, src/encounter-verbs.mjs,
// src/creatures.mjs § creatureTurn, writeReaction, recordFinish).
//
// The unit file (test/encounter.test.mjs) drives every rule with its store
// injected. Here the store is Postgres: each door's row is written by the pen's
// insertAct behind its own guard (the advisory locks, the store's nerve and
// resolve), each reaction by the real writeReaction (its cost written once), the
// finish by the real recordFinish. Then the record is read back and folded the
// way a restarted office would fold it, and must say what the doors said.
//
// The kind is the stub finishable kind of the unit file (its numbers the
// fixture's): resolve 10, a strike takes 4. Jev is a stub that leans the press
// onto the resident the step names, so the drive is the same every run.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

import { FINISH_ACTION, LivingSet, loadCreatureLaw, reactTo } from "../src/creatures.mjs";
import { NERVE_ACTION, STRIKES_SQL, foldNerve, nerveOf, windowAt, wornBy } from "../src/encounter.mjs";
import { strikeGuard, worldEncounter } from "../src/encounter-verbs.mjs";
import { answerWithin } from "../src/creatures-hook.mjs";
import { normalizeRow, WORLD_ANCHOR } from "../src/world-journal.mjs";
import { currentCrossing } from "../src/crossings.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const KIND_TEXT = `kind: keeper
name: a test keeper
ring_m: 40
what: >
  A fixture for the encounter's tests.
moods:
  temper: 0..3 = 1 | calm | stirred | angry | wild
reaction notice "it notices": when true says It notices {actor}.
`;
const BASE = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)), readText: () => KIND_TEXT });
const PRESS_ON = ["actor", "striker", "shielder", "loudest", "alone"];
const reaction = (name, src, effects, says) => ({ name, sentence: name, when: BASE.kindMod.parseCondition(src), src, effects, says });
const KEEPER = NO_WORLD ? null : {
  ...BASE.kindOf("keeper"), finishable: true, resolve: 10, strike: 4,
  reactions: [
    reaction("bristle", `act.verb == "strike"`, [{ do: "press", n: 2, on: ["striker", "loudest"] }], "It bristles and turns on {target}."),
    reaction("glare", `act.verb == "say"`, [{ do: "press", n: 2, on: PRESS_ON }], "It glares at {target}."),
    reaction("startle", `act.verb == "steady" or act.verb == "shield"`, [{ do: "press", n: 1, on: ["shielder", "actor"] }], "It starts, and snaps at {target}."),
  ],
};
const LAW = NO_WORLD ? null : {
  ...BASE, kindOf: (name) => (name === "keeper" ? KEEPER : null),
  kindMod: { ...BASE.kindMod, ENCOUNTER_VERBS: ["strike", "steady", "shield"], PRESS_ON,
    voiceLine: (r, w = {}) => BASE.kindMod.voiceLine({ ...r, says: r.says.replaceAll("{target}", String(w.target ?? w.actor)) }, w),
    scopeOf: (state, act, actor, enc = {}) => { const s = BASE.kindMod.scopeOf(state, act, actor); if (enc.resolve != null) s.self.resolve = enc.resolve; return s; } },
};

const ID = "creature:keeper-den";
const iso = (ms) => new Date(ms).toISOString();
// a party of three: kai lives alone; ren and mo share a hearth
const HOMES = { ren: "hearth", mo: "hearth" };
const lookup = (h) => (HOMES[h] ? { key: "house:hearth", slug: "hearth" } : { key: `solo:${h}`, slug: null });
const WHERE = { kai: { x: 10, y: 0 }, ren: { x: 0, y: 12 }, mo: { x: -14, y: 0 } };
const present = async () => ({ residents: Object.entries(WHERE).map(([handle, p]) => ({ handle, distance_m: Math.hypot(p.x, p.y) })) });

test("ON THE STORE · a party of three: strikes, a shield, a steady, one flees at 0, the strike that wears it down finishes it, and the record folds back to the same nerve", async () => {
  const s = await startStore({ db: "encounter_drive" });
  const api = await s.connect("office_api");
  const { default: pg } = await import("pg");
  const pen = await import("../src/world2-pen.mjs");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 4 });
  pen.__setPoolForTest(pool);
  try {
    const q = async (t, p) => (await api.query(t, p)).rows;
    const now = Date.now();
    const row = (actor, action, object, payload, cls = "creature") => normalizeRow({ crossing: currentCrossing(now), actor, action, object, cls,
      at: { anchor: WORLD_ANCHOR, dx: 0, dy: 0 }, payload, writtenAt: iso(Date.now()) });
    // the creature, spawned by the town, and kai already shaken: 3 nerve left (a press from earlier this window)
    await pen.officeWrite((c) => pen.insertAct(c, row("the-town", "spawn", ID, { kind: "keeper", at: iso(now - 3600_000), stays: true, x: 0, y: 0 })));
    await pen.officeWrite((c) => pen.insertAct(c, row(ID, NERVE_ACTION, "kai", { by: -7, why: "press", act: "0", creature: ID, window: windowAt(now).id })));
    const living = new LivingSet({ law: LAW });
    await living.refresh({ query: q, now });
    assert.equal(nerveOf(living, "kai", now), 3);

    let prefer = null;
    const fled = [];
    const ask = async (state, questions) => {
      const names = Object.keys(questions.reaction.criteria);
      const press = questions.press_on ? Object.fromEntries(Object.keys(questions.press_on.criteria).map((h) => [h, h === prefer ? 1 : 0])) : null;
      return { response: { answers: { reaction: { probabilities: Object.fromEntries(names.map((n) => [n, 1])) }, ...(press ? { press_on: { probabilities: press } } : {}) } } };
    };
    const seams = { present, households: async () => lookup, flee: (h) => fled.push(h), ask, env: { TYPESAFE_API_KEY: "k" } };
    const d = {
      now: Date.now, clock: Date.now, env: { CREATURE_JUDGE: "jev" }, freeze: () => null,
      creatures: async () => ({ living, law: LAW }),
      standpoint: async (h) => WHERE[h] ?? null,
      // the door's write, as the pen makes it: its guard, then the act's row, in one transaction
      write: async (entry, key, { guard }) => {
        const r = row(entry.actor, entry.action, entry.object, entry.payload);
        const actId = await pen.officeWrite(async (c) => { if (guard) await guard(c); return pen.insertAct(c, r); });
        return { actId: String(actId), written_at: r.written_at };
      },
      answer: (a, deps) => answerWithin(a, { ...deps, ...seams }),
      answerRing: (a, deps) => answerWithin(a, { ...deps, ...seams }),
      strikes: async (id, since) => q(STRIKES_SQL, [id, since]),
      finish: async (c, a) => (await import("../src/creatures.mjs")).recordFinish(c, a),
      flee: (h) => fled.push(h),
    };
    const as = (h) => ({ handles: new Set([h]), household: HOMES[h] ?? null });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    // A · kai strikes with 3 nerve: 2 for the strike, then it turns on the striker (2): kai is at 0 and flees
    prefer = "kai";
    const a = await worldEncounter({ act: "strike", creature: ID }, as("kai"), d);
    assert.equal(a.resolve.left, 6);
    assert.deepEqual(a.reaction.pressed, [{ on: "kai", nerve: -2 }]);
    assert.ok(fled.includes("kai"), "kai's nerve ran out: kai flees");
    // B · ren shields mo; the creature snaps at the shielder, whose house shares it (1 split two ways: ren pays it)
    prefer = "ren";
    const b = await worldEncounter({ act: "shield", resident: "mo" }, as("ren"), d);
    assert.equal(b.creature, ID);
    // C · mo steadies ren: mo pays 1, ren gains 2; the creature snaps at mo, and ren's shield takes it
    prefer = "mo";
    const c = await worldEncounter({ act: "steady", resident: "ren" }, as("mo"), d);
    assert.equal(c.creatures?.[0]?.pressed?.[0]?.on, "ren", "the shield moved the press onto ren");
    assert.equal(c.creatures[0].pressed[0].shielding, "mo");
    await wait(10_500); // the 10 s window: ren and mo each acted on it a moment ago
    // D · ren strikes (resolve 2); E · mo strikes and takes the last of it: mo finishes it
    prefer = "ren";
    const dd = await worldEncounter({ act: "strike", creature: ID }, as("ren"), d);
    assert.equal(dd.resolve.left, 2);
    const e = await worldEncounter({ act: "strike", creature: ID }, as("mo"), d);
    assert.equal(e.resolve.left, 0);
    assert.equal(e.finished, true);
    // F · worn down: the record refuses another strike (the guard, in its own transaction), and kai at 0 cannot strike at all
    await assert.rejects(pen.officeWrite((cl) => strikeGuard("kai", ID, { cost: 2, resolveMax: 10 })(cl)), (err) => err.code === 409 && /already worn down/.test(err.defect));
    await assert.rejects(worldEncounter({ act: "strike", creature: ID }, as("kai"), d), (err) => err.code === 409 && /you have 0/.test(err.defect));

    // THE RECORD: one finish, by the strike that crossed 0; and folded afresh, the same nerve the doors said
    const strikes = await q(STRIKES_SQL, [ID, iso(windowAt(now).start)]);
    assert.equal(strikes.length, 3);
    const finishes = await q(`SELECT actor, object, payload FROM acts WHERE action = '${FINISH_ACTION}'`);
    assert.equal(finishes.length, 1);
    assert.deepEqual([finishes[0].payload.by, finishes[0].payload.act], [wornBy(10, strikes).actor, wornBy(10, strikes).actId]);
    assert.equal(finishes[0].payload.by, "mo");
    const shieldUsed = await q(`SELECT payload FROM acts WHERE action = '${NERVE_ACTION}' AND payload ? 'shield'`);
    assert.equal(shieldUsed.length, 1, "the shield took one press, once");
    const split = await q(`SELECT object, payload FROM acts WHERE action = '${NERVE_ACTION}' AND payload ? 'split_of'`);
    assert.ok(split.length >= 2, "a press shared by the hearth");
    const fresh = new LivingSet({ law: LAW });
    const refreshed = await fresh.refresh({ query: q, now: Date.now() });
    assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
    for (const h of ["kai", "ren", "mo"]) {
      const rows = await q(`SELECT id::text AS id, actor, action, object, payload FROM acts WHERE class = 'creature' AND at >= $1 AND (object = $2 OR actor = $2)`, [iso(windowAt(now).start), h]);
      assert.equal(foldNerve(rows, h), nerveOf(living, h, Date.now()), `${h}: the store's fold and the door's agree`);
      assert.equal(nerveOf(fresh, h, Date.now()), nerveOf(living, h, Date.now()), `${h}: a restarted office folds the same nerve`);
    }
    assert.equal(nerveOf(fresh, "kai", Date.now()), 0);

    // AN ACT'S COST, ONCE: mo says something in the ring; the retried act writes no second cost
    const said = await pen.officeWrite((cl) => pen.insertAct(cl, row("mo", "say", null, { text: "steady now" }, "voice")));
    const sayAct = { actor: "mo", verb: "say", actId: String(said), atIso: iso(Date.now()), point: WHERE.mo };
    await wait(10_500);
    await reactTo(sayAct, { living, law: LAW, ...seams });
    await reactTo(sayAct, { living, law: LAW, ...seams });
    const costs = await q(`SELECT id FROM acts WHERE action = '${NERVE_ACTION}' AND payload->>'why' = 'act' AND payload->>'act' = $1`, [String(said)]);
    assert.equal(costs.length, 1);
  } finally {
    pen.__setPoolForTest(null);
    await pool.end().catch(() => {});
    await api.end().catch(() => {});
    await s.stop();
  }
});
