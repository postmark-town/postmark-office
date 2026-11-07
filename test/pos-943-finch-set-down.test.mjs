// pos-943-finch-set-down.test.mjs — the one-off that sets finch down at the Snug Jetty (POS-943).
//
//   node --test test/pos-943-finch-set-down.test.mjs
//
// finch boarded the Post Office through the Snug Jetty, declared no ride, and exited with no deposit; his next
// walk started 100 km out. tools/pos-943-finch-set-down.mjs writes the land that exit owed, with the town's
// hand, through landAt's own steps. This holds its guards (each refusal by name, nothing written), the act it
// would write, and the in-transaction guard against a real Postgres: a second repair, two at once, and a move
// after the reviewed dry run are each refused. The acts are invented, shaped as the store held them when filed.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { REPAIR, MOVE_ACTIONS, ACTS_SQL, judgeRepair, judgePoint, repairEntry, repairGuard } from "../tools/pos-943-finch-set-down.mjs";
import { rideStateFrom } from "../src/world-ride.mjs";
import { landEntry } from "../src/world.mjs";
import { CLASS_MOVE } from "../src/world-journal.mjs";
import { DEPARTURE_ACTIONS, departureRecordOf } from "../world2/tools/live-reads.mjs";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(ROOT, "tools", "pos-943-finch-set-down.mjs");
const JETTY = "current-the-reader/the-snug-jetty";
const SHIP = "the-town/the-post-office";
const VOID = { x: -72505.2, y: -72494.8 };

/** finch's acts as filed: the enter through the jetty, no ride, the exit with no set-down, and the walk from the void. */
const stranded = () => [
  { id: 46971, at: "2026-11-07T21:01:29Z", action: "enter", object: SHIP, payload: { via: JETTY }, household: "hh:finch" },
  { id: 46975, at: "2026-11-07T21:01:50Z", action: "say", object: null, payload: { text: "hello" }, household: "hh:finch" },
  { id: 46978, at: "2026-11-07T21:02:20Z", action: "exit", object: SHIP, payload: {}, household: "hh:finch" },
  { id: 46979, at: "2026-11-07T21:02:20Z", action: "walk", object: null, payload: { from: VOID, toward: { x: -71806, y: -71744 }, pace: 60, declared_by: "finch" }, household: "hh:finch" },
];
const judge = (acts, o = {}) => judgeRepair(acts, { rideStateFrom, ...o });
const repairLand = (id) => ({ id, at: "2026-11-07T22:00:00Z", action: "land", object: JETTY,
  payload: { from: REPAIR.at, toward: REPAIR.at, pace: null, via: JETTY, why: "deposit", declared_by: "the-town" }, household: "hh:finch" });

test("the stranded exit is found from the acts, not assumed: the enter through the jetty, the exit with no set-down, and the newest move to pin", () => {
  const j = judge(stranded());
  assert.equal(j.ok, true, j.why);
  assert.deepEqual([j.enter.id, j.exit.id, j.newestMove.id], [46971, 46978, 46979]);
  assert.deepEqual(j.after.map((a) => a.id), [46979]);
  assert.equal(j.household, "hh:finch", "the act is filed under finch's own household, as his exit was");
  assert.deepEqual(MOVE_ACTIONS.filter((a) => DEPARTURE_ACTIONS.includes(a)), [...DEPARTURE_ACTIONS], "every departure action is pinned");
  // the store hands payloads back as text on an unmigrated column; the judge reads either
  assert.equal(judge(stranded().map((a) => ({ ...a, id: String(a.id), payload: JSON.stringify(a.payload) }))).ok, true);
});

test("ALREADY REPAIRED: a land after the exit refuses, named as this repair when it is one; a second --apply is a no-op that says so", () => {
  const ours = judge([...stranded(), repairLand(47100)]);
  assert.deepEqual([ours.ok, ours.already], [false, true]);
  assert.match(ours.why, /^ALREADY REPAIRED: act 47100 set finch down at current-the-reader\/the-snug-jetty, declared by the-town/);
  const other = judge([...stranded(), { ...repairLand(47101), object: "the-town/the-quay", payload: { ...repairLand(0).payload, via: "the-town/the-quay", declared_by: "finch" } }]);
  assert.deepEqual([other.ok, other.already], [false, false]);
  assert.match(other.why, /has been set down since the exit \(act 47101, via the-town\/the-quay\): nothing is stranded to repair/);
});

test("not this case, refused by name: an exit that did set down, a ride standing, another boarding stop, no exit, or a crossing since", () => {
  const acts = stranded();
  const cases = {
    setDown: [acts[0], acts[1], { ...acts[2], payload: { set_down_at: JETTY, arrived: false } }, acts[3]],
    ride: [acts[0], { id: 46976, action: "ride", object: SHIP, payload: { to: "the-town/the-pando-landing" } }, ...acts.slice(1)],
    otherStop: [{ ...acts[0], payload: { via: "the-town/the-quay" } }, ...acts.slice(1)],
    noVia: [{ ...acts[0], payload: {} }, ...acts.slice(1)],
    noExit: [acts[0], acts[1]],
    enteredSince: [...acts, { id: 47000, action: "enter", object: "the-town/a-room", payload: {} }],
  };
  const why = Object.fromEntries(Object.entries(cases).map(([k, a]) => [k, judge(a)]));
  for (const [k, j] of Object.entries(why)) assert.equal(j.ok, false, `${k} passed`);
  assert.match(why.setDown.why, /act 46978\) set them down at current-the-reader\/the-snug-jetty: not the stranded exit/);
  assert.match(why.ride.why, /had declared a ride to the-town\/the-pando-landing: a ride owes its own deposit/);
  assert.match(why.otherStop.why, /boarded through the-town\/the-quay, not current-the-reader\/the-snug-jetty/);
  assert.match(why.noVia.why, /boarded through no stop/);
  assert.match(why.noExit.why, /has no exit from the-town\/the-post-office on record/);
  assert.match(why.enteredSince.why, /has entered the-town\/a-room since the exit \(act 47000\): the state moved/);
});

test("STALE: --expect-last must be finch's newest movement act; a later walk invalidates the reviewed dry run, a later say does not", () => {
  assert.equal(judge(stranded(), { expectLast: 46979 }).ok, true);
  assert.equal(judge(stranded(), { expectLast: "46979" }).ok, true);
  const walked = [...stranded(), { id: 47010, action: "walk", object: null, payload: { from: VOID, toward: VOID } }];
  assert.match(judge(walked, { expectLast: 46979 }).why, /^STALE: finch's newest movement act is 47010, not the 46979 the reviewed dry run named/);
  const spoke = [...stranded(), { id: 47011, action: "say", object: null, payload: { text: "Hello? Is anyone else out here?" } }];
  assert.equal(judge(spoke, { expectLast: 46979 }).ok, true, "a say moves no one");
});

test("the point is the deposit rule's own for the jetty, and only the authorised one passes", () => {
  assert.deepEqual(judgePoint({ x: -415, y: 4905 }), { ok: true });
  assert.match(judgePoint({ x: -415, y: 4906 }).why, /at \(-415, 4906\), not the authorised \(-415, 4905\)/);
  assert.match(judgePoint(null).why, /gives current-the-reader\/the-snug-jetty no point/);
});

test("the act: one land, finch's, the town's hand, at from and toward (-415, 4905), pace null, via the jetty, read by every reader of position as a landing", () => {
  const e = repairEntry(landEntry, { crossing: 1000.5, writtenAt: "2026-11-07T22:00:00.000Z", household: "hh:finch" });
  assert.deepEqual([e.actor, e.action, e.object, e.cls, e.household], ["finch", "land", JETTY, CLASS_MOVE, "hh:finch"]);
  assert.deepEqual(e.payload, { from: { x: -415, y: 4905 }, toward: { x: -415, y: 4905 }, pace: null, within: null, to: null,
    via: JETTY, why: "deposit", declared_by: "the-town" });
  const r = departureRecordOf({ id: "1", at: new Date("2026-11-07T22:00:00Z"), crossing: "1000.5", actor: "finch", action: "land", payload: e.payload });
  assert.equal(r.refused, undefined, r.reason);
  assert.deepEqual([r.record.from, r.record.toward, r.record.landed], [REPAIR.at, REPAIR.at, { via: JETTY, why: "deposit" }]);
});

test("the CLI: --apply never runs without --expect-last, and a stray argument is refused, before any store is read", () => {
  for (const args of [["--apply"], ["--apply", "--expect-last"], ["--apply", "--expect-last", "x"], ["--force"]]) {
    const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8", env: { ...process.env, WORLD2_PG: "", WORLD2_PG_URL: "" } });
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
    assert.match(r.stderr, /--apply needs --expect-last/);
  }
});

// ── the guard inside the pen's transaction, on a real Postgres ───────────────
const store = await startStore({ db: "pos943_finch_test" });
after(() => store.stop());
const skip = store.skip ?? false;

async function seeded(acts) {
  const c = await store.connect("world2_owner");
  await c.query("TRUNCATE acts RESTART IDENTITY CASCADE");
  for (const a of acts)
    await c.query("INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES ($1, 1, 'finch', $2, $3, 'move', $4, $5)",
      [a.at ?? "2026-11-07T21:00:00Z", a.action, a.object, JSON.stringify(a.payload), a.household ?? null]);
  return c;
}
/** The pen's shape: the guard, then the insert, in one transaction. */
async function penLike(c, guard, land) {
  await c.query("BEGIN");
  try {
    await guard(c);
    await c.query("INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), 1, 'finch', 'land', $1, 'move', $2, 'hh:finch')",
      [land.object, JSON.stringify(land.payload)]);
    await c.query("COMMIT");
    return "written";
  } catch (e) { await c.query("ROLLBACK"); if (e?.defect) return e.defect; throw e; }
}

test("on the store: the guard passes once and writes; a second repair is ALREADY REPAIRED; a move after the dry run is STALE", { skip }, async () => {
  const c = await seeded(stranded());
  try {
    const ids = (await c.query(ACTS_SQL, ["finch"])).rows.map((r) => Number(r.id));
    const newest = ids.at(-1);
    const land = repairLand(0);
    assert.equal(await penLike(c, repairGuard({ rideStateFrom, expectLast: newest }), land), "written");
    assert.match(await penLike(c, repairGuard({ rideStateFrom, expectLast: newest }), land), /^ALREADY REPAIRED: act \d+ set finch down/);
    assert.equal((await c.query("SELECT count(*)::int AS n FROM acts WHERE action = 'land'")).rows[0].n, 1, "one land, ever");
  } finally { await c.end(); }

  const d = await seeded([...stranded(), { action: "walk", object: null, payload: { from: VOID, toward: VOID } }]);
  try {
    const ids = (await d.query(ACTS_SQL, ["finch"])).rows.map((r) => Number(r.id));
    assert.match(await penLike(d, repairGuard({ rideStateFrom, expectLast: ids.at(-2) }), repairLand(0)), /^STALE: finch's newest movement act is \d+/);
    assert.equal((await d.query("SELECT count(*)::int AS n FROM acts WHERE action = 'land'")).rows[0].n, 0);
  } finally { await d.end(); }
});

test("on the store: two applies at once serialize on the repair's lock, and exactly one lands", { skip }, async () => {
  const a = await seeded(stranded());
  const b = await store.connect("world2_owner");
  try {
    const newest = Number((await a.query(ACTS_SQL, ["finch"])).rows.at(-1).id);
    const guard = repairGuard({ rideStateFrom, expectLast: newest });
    const results = await Promise.all([penLike(a, guard, repairLand(0)), penLike(b, guard, repairLand(0))]);
    assert.deepEqual(results.filter((r) => r === "written").length, 1, JSON.stringify(results));
    assert.match(results.find((r) => r !== "written"), /^ALREADY REPAIRED/);
    assert.equal((await a.query("SELECT count(*)::int AS n FROM acts WHERE action = 'land'")).rows[0].n, 1);
  } finally { await a.end(); await b.end(); }
});
