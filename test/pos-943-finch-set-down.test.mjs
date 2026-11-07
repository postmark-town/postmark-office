// pos-943-finch-set-down.test.mjs — the one-off that sets finch down at the Snug Jetty (POS-943).
//
//   node --test test/pos-943-finch-set-down.test.mjs
//
// finch boarded the Post Office through the Snug Jetty, declared no ride, and exited with no deposit; his next
// walk started 100 km out. tools/pos-943-finch-set-down.mjs writes the land that exit owed, with the town's
// hand, through landAt's own steps. This holds its guards (each refusal by name, nothing written), the act it
// would write, and the in-transaction guard against a real Postgres: a second repair, two at once, and a move
// after the reviewed dry run are each refused.
//
// THE ROWS ARE THE STORE'S SHAPE (the 1a212ee9 dry run on the box, 22:00:43Z, refused because world-ride §
// rideStateFrom found no stop in finch's real rows). So the boarding is named (--boarded 46971) and its own act
// is read, and these fixtures are what `SELECT id, at, actor, action, object, payload, household FROM acts`
// hands back through pg: a bigint id as TEXT, `at` a Date, the payload jsonb as an object. Act 46971's payload
// is the one Jetto read on the box, verbatim; the exit's is crossing-exec's shape with no set_down_at, as the
// issue says. The household is invented.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { REPAIR, MOVE_ACTIONS, ACTS_SQL, judgeRepair, judgePoint, repairEntry, repairGuard } from "../tools/pos-943-finch-set-down.mjs";
import { landEntry } from "../src/world.mjs";
import { CLASS_MOVE } from "../src/world-journal.mjs";
import { DEPARTURE_ACTIONS, departureRecordOf } from "../world2/tools/live-reads.mjs";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(ROOT, "tools", "pos-943-finch-set-down.mjs");
const JETTY = "current-the-reader/the-snug-jetty";
const SHIP = "the-town/the-post-office";
const VOID = { x: -72505.2, y: -72494.8 };
const HH = "hh:finch-house";

// act 46971's payload as the box's store holds it (Jetto, POS-943, 22:01:12Z)
const BOARDING_PAYLOAD = {
  via: JETTY,
  lines: ["- 2026-11-07T21:01:28.260Z · finch · enters the-town/the-post-office · ferry 297.7520 · word welcomed"],
  ledger: "WORLD/enter-exit-ledger.md",
  summary: "enters the-town/the-post-office via current-the-reader/the-snug-jetty",
  arrival_of: "46968",
};
const row = (id, at, action, object, payload) => ({ id: String(id), at: new Date(at), actor: "finch", action, object, payload, household: HH });
/** finch's rows as filed: the arrival's walk, the boarding, the exit with no set-down, the walk from the void, and his say. */
const stranded = () => [
  row(46968, "2026-11-07T21:00:40Z", "walk", null, { from: { x: -400, y: 4890 }, toward: { x: -415, y: 4905 }, pace: 60, within: null, to: SHIP, declared_by: "finch" }),
  row(46971, "2026-11-07T21:01:29Z", "enter", SHIP, BOARDING_PAYLOAD),
  row(46978, "2026-11-07T21:02:20Z", "exit", SHIP, { lines: ["- 2026-11-07T21:02:20.000Z · finch · exits the-town/the-post-office · ferry 297.7537"], ledger: "WORLD/enter-exit-ledger.md", summary: "exits the-town/the-post-office" }),
  row(46979, "2026-11-07T21:02:20Z", "walk", null, { from: VOID, toward: { x: -71806, y: -71744 }, pace: 60, within: null, to: null, declared_by: "finch" }),
  row(47026, "2026-11-07T21:14:36.934Z", "say", null, { text: "Hello? Is anyone else out here? I took a wrong turn at the Post Office and now I live in the void.", place: null }),
];
const judge = (acts, o = {}) => judgeRepair(acts, { boarded: 46971, ...o });
const repairLand = (id) => row(id, "2026-11-07T22:30:00Z", "land", JETTY,
  { from: REPAIR.at, toward: REPAIR.at, pace: null, within: null, to: null, via: JETTY, why: "deposit", declared_by: "the-town" });

test("the boarding is the named act, read as the store holds it: finch's enter of the Post Office, its raw payload via the jetty; the stranded exit and the move to pin follow", () => {
  const j = judge(stranded());
  assert.equal(j.ok, true, j.why);
  assert.deepEqual([j.enter.id, j.exit.id, j.newestMove.id], [46971, 46978, 46979]);
  assert.deepEqual(j.between.map((a) => a.id), [], "nothing between the boarding and the exit");
  assert.deepEqual(j.after.map((a) => a.id), [46979, 47026]);
  assert.equal(j.household, HH, "the act is filed as his exit was");
  assert.equal(judge(stranded(), { boarded: "46971" }).ok, true, "the id as the CLI passes it");
  assert.deepEqual(MOVE_ACTIONS.filter((a) => DEPARTURE_ACTIONS.includes(a)), [...DEPARTURE_ACTIONS], "every departure action is pinned");
  // a store column still holding text hands the payload back as a string; the judge reads either
  assert.equal(judge(stranded().map((a) => ({ ...a, payload: JSON.stringify(a.payload) }))).ok, true);
  // the Post Office by the act's summary when its object says otherwise, and printed either way
  assert.equal(judge(stranded().map((a) => (a.id === "46971" ? { ...a, object: null } : a))).ok, true);
});

test("the named act must be the boarding, by its own fields: finch's, an enter, of the Post Office, via the Snug Jetty", () => {
  const swap = (patch) => stranded().map((a) => (a.id === "46971" ? { ...a, ...patch(a) } : a));
  const cases = {
    missing: judge(stranded(), { boarded: 46970 }),
    notEnter: judge(stranded(), { boarded: 46979 }),
    otherActor: judge(swap(() => ({ actor: "little-bird" }))),
    otherMark: judge(swap((a) => ({ object: "the-town/a-room", payload: { ...a.payload, summary: "enters the-town/a-room" } }))),
    otherStop: judge(swap((a) => ({ payload: { ...a.payload, via: "the-town/the-quay" } }))),
    noVia: judge(swap((a) => { const { via, ...rest } = a.payload; return { payload: rest }; })),
  };
  for (const [k, j] of Object.entries(cases)) assert.equal(j.ok, false, `${k} passed`);
  assert.match(cases.missing.why, /^act 46970 is not one of finch's acts/);
  assert.match(cases.notEnter.why, /^act 46979 is finch's walk, not an enter/);
  assert.match(cases.otherActor.why, /^act 46971 is little-bird's, not finch's/);
  assert.match(cases.otherMark.why, /^act 46971 enters the-town\/a-room .*, not the-town\/the-post-office/);
  assert.match(cases.otherStop.why, /^act 46971's payload boards via "the-town\/the-quay", not current-the-reader\/the-snug-jetty/);
  assert.match(cases.noVia.why, /^act 46971's payload boards via null/);
});

test("its relationship to the stranded exit: the first Post Office exit after it, with no set-down, and no ride or land between them", () => {
  const acts = stranded();
  const at = (s) => new Date(s);
  const cases = {
    setDown: judge(acts.map((a) => (a.id === "46978" ? { ...a, payload: { ...a.payload, set_down_at: JETTY, arrived: false } } : a))),
    ride: judge([...acts, { ...row(46975, at("2026-11-07T21:01:50Z"), "ride", SHIP, { to: "the-town/the-pando-landing" }) }]),
    landAboard: judge([...acts, { ...row(46976, at("2026-11-07T21:01:55Z"), "land", "x/y", { via: "x/y" }) }]),
    noExit: judge(acts.filter((a) => a.id !== "46978")),
  };
  for (const [k, j] of Object.entries(cases)) assert.equal(j.ok, false, `${k} passed`);
  assert.match(cases.setDown.why, /exit after the boarding \(act 46978\) set them down at current-the-reader\/the-snug-jetty: not the stranded exit/);
  assert.match(cases.ride.why, /^act 46975, a ride, stands between the boarding \(act 46971\) and the exit \(act 46978\): a ride owes its own deposit/);
  assert.match(cases.landAboard.why, /^act 46976, a land, stands between/);
  assert.match(cases.noExit.why, /has no exit from the-town\/the-post-office after act 46971/);
  // a say between them is no ride and no land
  assert.equal(judge([...acts, row(46974, "2026-11-07T21:01:40Z", "say", null, { text: "all aboard" })]).ok, true);
});

test("ALREADY REPAIRED: a land after the exit refuses, named as this repair when it is one; and an enter or exit since is a moved state", () => {
  const ours = judge([...stranded(), repairLand(47100)]);
  assert.deepEqual([ours.ok, ours.already], [false, true]);
  assert.match(ours.why, /^ALREADY REPAIRED: act 47100 set finch down at current-the-reader\/the-snug-jetty, declared by the-town/);
  const other = judge([...stranded(), { ...repairLand(47101), object: "the-town/the-quay", payload: { ...repairLand(0).payload, via: "the-town/the-quay", declared_by: "finch" } }]);
  assert.deepEqual([other.ok, other.already], [false, false]);
  assert.match(other.why, /has been set down since the exit \(act 47101, via the-town\/the-quay\): nothing is stranded to repair/);
  const entered = judge([...stranded(), row(47030, "2026-11-07T21:20:00Z", "enter", "the-town/a-room", { lines: [], summary: "enters the-town/a-room" })]);
  assert.match(entered.why, /has entered the-town\/a-room since the exit \(act 47030\): the state moved/);
});

test("STALE: --expect-last must be finch's newest movement act; a later walk invalidates the reviewed dry run, his say does not", () => {
  assert.equal(judge(stranded(), { expectLast: 46979 }).ok, true, "47026, his say, is newer and moves no one");
  assert.equal(judge(stranded(), { expectLast: "46979" }).ok, true);
  const walked = [...stranded(), row(47040, "2026-11-07T22:10:00Z", "walk", null, { from: VOID, toward: VOID })];
  assert.match(judge(walked, { expectLast: 46979 }).why, /^STALE: finch's newest movement act is 47040, not the 46979 the reviewed dry run named/);
});

test("the point is the deposit rule's own for the jetty, and only the authorised one passes", () => {
  assert.deepEqual(judgePoint({ x: -415, y: 4905 }), { ok: true });
  assert.match(judgePoint({ x: -415, y: 4906 }).why, /at \(-415, 4906\), not the authorised \(-415, 4905\)/);
  assert.match(judgePoint(null).why, /gives current-the-reader\/the-snug-jetty no point/);
});

test("the act: one land, finch's, the town's hand, at from and toward (-415, 4905), pace null, via the jetty, read by every reader of position as a landing", () => {
  const e = repairEntry(landEntry, { crossing: 1000.5, writtenAt: "2026-11-07T22:00:00.000Z", household: HH });
  assert.deepEqual([e.actor, e.action, e.object, e.cls, e.household], ["finch", "land", JETTY, CLASS_MOVE, HH]);
  assert.deepEqual(e.payload, { from: { x: -415, y: 4905 }, toward: { x: -415, y: 4905 }, pace: null, within: null, to: null,
    via: JETTY, why: "deposit", declared_by: "the-town" });
  const r = departureRecordOf({ id: "1", at: new Date("2026-11-07T22:00:00Z"), crossing: "1000.5", actor: "finch", action: "land", payload: e.payload });
  assert.equal(r.refused, undefined, r.reason);
  assert.deepEqual([r.record.from, r.record.toward, r.record.landed], [REPAIR.at, REPAIR.at, { via: JETTY, why: "deposit" }]);
});

test("the CLI: --boarded is always needed, --apply never runs without --expect-last, and a stray argument is refused, before any store is read", () => {
  const env = { ...process.env, WORLD2_PG: "", WORLD2_PG_URL: "" };
  for (const args of [[], ["--boarded"], ["--boarded", "x"], ["--boarded", "46971", "--apply"], ["--boarded", "46971", "--apply", "--expect-last"],
    ["--boarded", "46971", "--apply", "--expect-last", "x"], ["--boarded", "46971", "--force"], ["--apply"]]) {
    const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8", env });
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
    assert.match(r.stderr, /--boarded is finch's boarding act .*\n--apply needs --expect-last/);
  }
  // with --boarded and nothing else, the dry run gets past usage, and says so when there is no store
  const r = spawnSync(process.execPath, [TOOL, "--boarded", "46971"], { encoding: "utf8", env });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /no store configured/);
});

// ── the guard inside the pen's transaction, on a real Postgres ───────────────
const store = await startStore({ db: "pos943_finch_test" });
after(() => store.stop());
const skip = store.skip ?? false;

/** finch's rows, inserted in order (the store gives them new ids); answers the client and the boarding's new id. */
async function seeded(acts) {
  const c = await store.connect("world2_owner");
  await c.query("TRUNCATE acts RESTART IDENTITY CASCADE");
  let boarded = null;
  for (const a of acts) {
    const { rows: [r] } = await c.query("INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES ($1, 1, 'finch', $2, $3, 'move', $4, $5) RETURNING id::text",
      [a.at, a.action, a.object, JSON.stringify(a.payload), a.household ?? null]);
    if (a.action === "enter" && a.payload?.via === JETTY) boarded = r.id;
  }
  return { c, boarded };
}
/** The pen's shape: the guard, then the insert, in one transaction. */
async function penLike(c, guard, land, { afterGuard = null } = {}) {
  await c.query("BEGIN");
  try {
    await guard(c);
    if (afterGuard) await afterGuard();
    await c.query("INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), 1, 'finch', 'land', $1, 'move', $2, $3)",
      [land.object, JSON.stringify(land.payload), HH]);
    await c.query("COMMIT");
    return "written";
  } catch (e) { await c.query("ROLLBACK"); if (e?.defect) return e.defect; throw e; }
}
const newestMoveOf = async (c) => Number((await c.query(ACTS_SQL, ["finch"])).rows.filter((r) => MOVE_ACTIONS.includes(r.action)).at(-1).id);

test("on the store, its own rows: the guard reads the boarding act, passes once and writes; a second repair is ALREADY REPAIRED; a move after the dry run is STALE", { skip }, async () => {
  const { c, boarded } = await seeded(stranded());
  try {
    const got = (await c.query(ACTS_SQL, ["finch"])).rows;
    assert.equal(typeof got[0].id, "string", "pg hands a bigint id back as text");
    assert.equal(typeof got[0].payload, "object", "and the jsonb payload as an object");
    assert.ok(got[0].at instanceof Date);
    const newest = await newestMoveOf(c);
    assert.equal(await penLike(c, repairGuard({ boarded, expectLast: newest }), repairLand(0)), "written");
    assert.match(await penLike(c, repairGuard({ boarded, expectLast: newest }), repairLand(0)), /^ALREADY REPAIRED: act \d+ set finch down/);
    assert.equal((await c.query("SELECT count(*)::int AS n FROM acts WHERE action = 'land'")).rows[0].n, 1, "one land, ever");
  } finally { await c.end(); }

  const s = await seeded([...stranded(), row(47040, "2026-11-07T22:10:00Z", "walk", null, { from: VOID, toward: VOID })]);
  try {
    const moves = (await s.c.query(ACTS_SQL, ["finch"])).rows.filter((r) => MOVE_ACTIONS.includes(r.action)).map((r) => Number(r.id));
    assert.match(await penLike(s.c, repairGuard({ boarded: s.boarded, expectLast: moves.at(-2) }), repairLand(0)), /^STALE: finch's newest movement act is \d+/);
    assert.equal((await s.c.query("SELECT count(*)::int AS n FROM acts WHERE action = 'land'")).rows[0].n, 0);
  } finally { await s.c.end(); }
});

test("on the store: two applies at once serialize on the repair's lock, and exactly one lands", { skip }, async () => {
  const { c: a, boarded } = await seeded(stranded());
  const b = await store.connect("world2_owner");
  try {
    const guard = repairGuard({ boarded, expectLast: await newestMoveOf(a) });
    // A RACE THAT IS ONE: A has passed its guard and holds its transaction open while B's guard runs. Without the
    // lock B reads no land and both write; with it, B waits for A's commit and then reads A's land.
    let guarded;
    const aGuarded = new Promise((ok) => { guarded = ok; });
    const first = penLike(a, guard, repairLand(0), { afterGuard: async () => { guarded(); await new Promise((ok) => setTimeout(ok, 400)); } });
    const second = aGuarded.then(() => penLike(b, guard, repairLand(0)));
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.filter((r) => r === "written").length, 1, JSON.stringify(results));
    assert.match(results.find((r) => r !== "written"), /^ALREADY REPAIRED/);
    assert.equal((await a.query("SELECT count(*)::int AS n FROM acts WHERE action = 'land'")).rows[0].n, 1);
  } finally { await a.end(); await b.end(); }
});
