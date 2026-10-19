// hold-through-at-the-clearing.test.mjs — THE SETTLEMENT PRINTS WHERE A THING IS
// (POS-688, Darko 2026-10-18 20:58: a held thing is published but unplaced), in
// the store, in the clearing's own transaction (step 6.2, hold-through.mjs).
//
//   node --test test/hold-through-at-the-clearing.test.mjs
//
// THE RIG is carry-at-the-clearing's: a real Postgres (helpers/embedded-store.mjs)
// with the whole schema, 078 included, and the real `clearing-job.mjs` run as a
// child under the `clearing_job` pen, because only Postgres can say whether the
// trigger lets a hold printout in, and nothing else.
//
// THE FLIPS:
//   078 not applied (the trigger without its third arm)  → 1 and 2 red ("CLEARING FAILED")
//   the arm without its body/data check                   → 3 reds (a printout with new words lands)
//   step 6.2 taken out of the job                         → 1 and 2 red (nothing printed)

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");
const TOWN_SHA = "t".repeat(40);
const LAW_SHA = "l".repeat(40);
const WIN = 260;

const store = await startStore({ db: "hold_through_test" });
after(() => store.stop());
const skip = store.skip ?? false;

const CONE = "berthillon/a-cone";
const CONE_ID = "b0000000-0000-4000-8000-000000000001";
const ROOM = "berthillon/the-shop";
const ROOM_ID = "b0000000-0000-4000-8000-000000000002";
const box = (at, ext) => `((${at.x - ext.w / 2},${at.y - ext.h / 2}),(${at.x + ext.w / 2},${at.y + ext.h / 2}))`;

async function seed({ from = null, acts = [] } = {}) {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows, projection_heads, households, household_pins, acts CASCADE");
    for (const id of [WIN - 1, WIN]) {
      const opens = new Date(Date.UTC(2026, 9, 18, 0) + (id - WIN + 1) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at, receipts)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4, $5)`,
        [id, opens, id === WIN ? "open" : "closed", id === WIN ? null : opens,
          id === WIN - 1 && from != null ? JSON.stringify({ hold_through: from }) : null]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by)
                   VALUES ('berthillon', 0, 'Berthillon', ARRAY['berthillon'], '2026-08-01', 'berthillon'),
                          ('lantern', 1, 'Lantern', ARRAY['sb-ash'], '2026-08-01', 'sb-ash')`);
    await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned)
                   VALUES ('berthillon', 'berthillon', 301, '2026-08-01'), ('sb-ash', 'sb-ash', 302, '2026-08-01')`);
    const mark = async (id, slug, kind, at, ext) => {
      const geometry = JSON.stringify({ at, extent: ext }), d = JSON.stringify({ tier: "home", date: "2026-08-26" });
      await c.query(
        `INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
         VALUES ($1, $2, $3, 'berthillon', 'hh:berthillon', 'locked', now(), $4, $5, $6::box, 0, $7, $8)`,
        [id, WIN - 1, kind, `${slug}.`, geometry, box(at, ext), d, slug]);
      await c.query(
        `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
         VALUES ($1, $2, $3, 'berthillon', 'hh:berthillon', $4, $5, $6::box, 'standing', $7, $8)`,
        [id, slug, kind, `${slug}.`, geometry, box(at, ext), WIN - 1, d]);
    };
    await mark(ROOM_ID, ROOM, "sited", { x: 221, y: 95.5 }, { w: 15, h: 12 });
    await mark(CONE_ID, CONE, "thing", { x: 221, y: 95.5 }, { w: 1, h: 1 });
    for (const a of acts)
      await c.query(
        `INSERT INTO acts (id, at, crossing, actor, action, object, at_anchor, at_dx, at_dy, class, payload)
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [a.id, a.at, a.crossing ?? WIN + 0.1, a.actor, a.action, CONE, a.anchor ?? null, a.dx ?? null, a.dy ?? null, a.cls ?? "holding",
          JSON.stringify(a.payload ?? { thing: CONE, holder: a.holder ?? null, policy: a.action === "drop" ? "detach" : "cascade", made_by: "berthillon" })]);
  } finally { await c.end(); }
}
const take = (id, at) => ({ id, at, actor: "sb-ash", action: "take", holder: "sb-ash" });
const drop = (id, at, dx, dy) => ({ id, at, actor: "sb-ash", action: "drop", dx, dy });

function clear() {
  const r = spawnSync(process.execPath, [JOB, "--window", String(WIN)], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
async function read(sql, args = []) {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
}
const coneRow = async () => (await read("SELECT geometry, data, locked_window FROM marks WHERE slug = $1", [CONE]))[0];

test("1. a thing taken is printed unplaced at the clearing: held_by, no geometry, and where it last stood kept unprinted", { skip }, async () => {
  await seed({ acts: [take(101, "2026-10-19T01:00:00Z")] });
  const r = clear();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /⚑ hold: berthillon\/a-cone — held by sb-ash/);
  const row = await coneRow();
  assert.equal(row.geometry, null, "no at, no extent: published but unplaced");
  assert.equal(row.data.held_by, "sb-ash");
  assert.deepEqual(row.data._placed, { at: { x: 221, y: 95.5 }, extent: { w: 1, h: 1 } });
  assert.equal(row.locked_window, WIN);
  const [win] = await read("SELECT receipts FROM windows WHERE id = $1", [WIN]);
  assert.equal(win.receipts.hold_through, 101, "the cutoff the reads place things by");
  assert.equal(win.receipts.hold_printed[0].slug, CONE);
  const [claim] = await read("SELECT status, claimant, supersedes::text, data FROM claims WHERE slug = $1 AND window_id = $2", [CONE, WIN]);
  assert.deepEqual([claim.status, claim.claimant, claim.supersedes], ["locked", "berthillon", CONE_ID], "the maker's mark, superseded in the maker's name: whose it is never moves");
  // and the next clearing prints nothing again
  const again = clear();
  assert.doesNotMatch(again.out, /⚑ hold: berthillon\/a-cone/);
});

test("2. a drop since the first printout prints a fresh at where the dropper stood, its extent back", { skip }, async () => {
  await seed({ from: 100, acts: [take(101, "2026-10-19T01:00:00Z"), drop(102, "2026-10-19T02:00:00Z", 196, -352)] });
  const r = clear();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /⚑ hold: berthillon\/a-cone — set down by sb-ash/);
  const row = await coneRow();
  assert.deepEqual(row.geometry, { at: { x: 196, y: -352 }, extent: { w: 1, h: 1 } });
  assert.equal(row.data.held_by, undefined);
});

test("3. 078's arm: clearing_job may insert a hold printout of a standing mark by its owner, and nothing wider", { skip }, async () => {
  await seed();
  const c = await store.connect("clearing_job");
  const insert = (data, { body = `${CONE}.`, claimant = "berthillon", supersedes = CONE_ID, cls = "thing" } = {}) => c.query(
    `INSERT INTO claims (window_id, class, claimant, household, status, decided_at, body, geometry, stake, data, slug, supersedes)
     VALUES ($1, $2, $3, 'hh:berthillon', 'locked', now(), $4, NULL, 0, $5, $6, $7)`,
    [WIN, cls, claimant, body, JSON.stringify(data), CONE, supersedes]);
  const held = { tier: "home", date: "2026-08-26", held_by: "sb-ash", _placed: { at: { x: 221, y: 95.5 } }, _held_through: 101 };
  try {
    await c.query("BEGIN");
    await insert(held);
    await c.query("ROLLBACK");
    const refused = /or a hold printout/;
    await assert.rejects(insert(held, { body: "A cone, eaten." }), refused, "new words are not a printout");
    await assert.rejects(insert({ ...held, tier: "market" }), refused, "nor is any other data line");
    await assert.rejects(insert(held, { claimant: "sb-ash" }), refused, "the claimant is the mark's owner, never its holder");
    await assert.rejects(insert(held, { cls: "parcel" }), refused, "nor another kind");
    await assert.rejects(insert(held, { supersedes: ROOM_ID }), refused, "and it supersedes its own mark");
    const { _held_through, ...unmarked } = held;
    await assert.rejects(insert(unmarked), refused, "a claim naming no cutoff is no printout");
  } finally { await c.end(); }
});

test("4. a thing in the OLD form (kind: sited + class) prints held too: 078 lets a sited row be placeless only when it names its holder", { skip }, async () => {
  await seed({ acts: [take(101, "2026-10-19T01:00:00Z")] });
  const c = await store.connect("world2_owner");
  try {
    await c.query("UPDATE marks SET kind = 'sited', data = data || '{\"class\":\"thing\"}' WHERE slug = $1", [CONE]);
    await assert.rejects(c.query("UPDATE marks SET geometry = NULL, bbox = NULL WHERE slug = $1", [ROOM]),
      /sited_marks_have_a_where/, "a sited mark nobody holds still needs its where");
  } finally { await c.end(); }
  const r = clear();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /⚑ hold: berthillon\/a-cone — held by sb-ash/, r.out.slice(-800));
  const row = await coneRow();
  assert.equal(row.geometry, null);
  assert.equal(row.data.held_by, "sb-ash");
});

// ── POS-688 D3 · AN OPPOSED TAKE RETURNS AT THE SETTLEMENT ──────────────────
const opposeTake = (id, takeId, at, stance = "opposed") => ({ id, at, actor: "berthillon", action: "declare-stance-on", cls: "stance",
  payload: { on: CONE, stance, by: "berthillon", answers: "take", take: { act_id: String(takeId), by: "sb-ash" } } });

test("5. the maker's house opposed sb-ash's take: nothing prints in sb-ash's hands, and the clearing returns the cone where it was, once", { skip }, async () => {
  await seed({ from: 100, acts: [take(101, "2026-10-19T01:00:00Z"), opposeTake(102, 101, "2026-10-19T01:30:00Z")] });
  const r = clear();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /⚑ hold: berthillon\/a-cone — returned: its maker's house opposed sb-ash's take \(act 101\)/);
  const row = await coneRow();
  assert.deepEqual(row.geometry, { at: { x: 221, y: 95.5 }, extent: { w: 1, h: 1 } }, "canon is untouched: never printed held");
  assert.equal(row.data.held_by, undefined);
  const back = await read("SELECT actor, action, at_dx, at_dy, payload FROM acts WHERE class = 'holding' AND actor = 'the-town' AND object = $1", [CONE]);
  assert.equal(back.length, 1, "one return act");
  assert.equal(back[0].action, "drop");
  assert.deepEqual([back[0].at_dx, back[0].at_dy], [221, 95.5], "set down where it was printed");
  assert.deepEqual(back[0].payload.returned, { take_act: "101", stance_act: "102" });
  const [win] = await read("SELECT receipts FROM windows WHERE id = $1", [WIN]);
  assert.equal(win.receipts.hold_returned[0].slug, CONE);
  // the one return is the only one: 078 refuses a second for the same take (test 6)
  assert.equal((await read("SELECT count(*)::int AS n FROM acts WHERE actor = 'the-town' AND object = $1", [CONE]))[0].n, 1);
});

test("5b. a welcomed take, or one already printed, is never returned", { skip }, async () => {
  await seed({ from: 100, acts: [take(101, "2026-10-19T01:00:00Z"), opposeTake(102, 101, "2026-10-19T01:30:00Z", "welcomed")] });
  let r = clear();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /⚑ hold: berthillon\/a-cone — held by sb-ash/, "welcomed: the take prints");
  // printed at an earlier clearing (window 259's cutoff is past the take): too late, it stays in sb-ash's hands
  await seed({ from: 101, acts: [take(101, "2026-10-19T01:00:00Z"), opposeTake(102, 101, "2026-10-19T01:30:00Z")] });
  r = clear();
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /returned/);
});

test("6. 078's acts arm: clearing_job may insert only the return of an opposed take, once", { skip }, async () => {
  await seed({ from: 100, acts: [take(101, "2026-10-19T01:00:00Z"), opposeTake(102, 101, "2026-10-19T01:30:00Z"),
    take(103, "2026-10-19T02:00:00Z"), opposeTake(104, 103, "2026-10-19T02:30:00Z", "welcomed")] });
  const c = await store.connect("clearing_job");
  const ret = (payload, { actor = "the-town", action = "drop", cls = "holding", object = CONE } = {}) => c.query(
    `INSERT INTO acts (at, crossing, actor, action, object, class, payload) VALUES (now(), $1, $2, $3, $4, $5, $6)`,
    [WIN, actor, action, object, cls, JSON.stringify(payload)]);
  const good = { thing: CONE, holder: null, policy: "detach", returned: { take_act: "101", stance_act: "102" } };
  const refused = /clearing_job may insert only the return of an opposed take/;
  try {
    await c.query("BEGIN");
    await ret(good);
    await assert.rejects(ret(good), refused, "once per take");
    await c.query("ROLLBACK");
    await assert.rejects(ret({ ...good, returned: { take_act: "103", stance_act: "104" } }), refused, "a welcomed take is not returned");
    await assert.rejects(ret(good, { actor: "sb-ash" }), refused, "only the town returns");
    await assert.rejects(ret({ thing: CONE, holder: null, policy: "detach" }), refused, "a drop naming no return is no return");
    await assert.rejects(ret(good, { cls: "voice", action: "say" }), refused, "nor any other act");
  } finally { await c.end(); }
});

test("7. FALSIFIER (Wright's condition 1): clearing_job's INSERT on acts is the trigger's to refuse — every act that is not a return is refused, and with the trigger dropped the same inserts land", { skip }, async () => {
  await seed({ from: 100, acts: [take(101, "2026-10-19T01:00:00Z"), opposeTake(102, 101, "2026-10-19T01:30:00Z")] });
  // the shapes a clearing pen could be asked to write that are not the return of an opposed take
  const notReturns = [
    { actor: "the-town", action: "say", object: CONE, cls: "voice", payload: { text: "hello" } },
    { actor: "the-town", action: "leave-mark", object: CONE, cls: "mark", payload: { thing: CONE } },
    { actor: "the-town", action: "take", object: CONE, cls: "holding", payload: { thing: CONE, holder: "the-town", policy: "cascade", returned: { take_act: "101", stance_act: "102" } } },
    { actor: "the-town", action: "drop", object: ROOM, cls: "holding", payload: { thing: ROOM, holder: null, policy: "detach", returned: { take_act: "101", stance_act: "102" } } },
    { actor: "the-town", action: "drop", object: CONE, cls: "holding", payload: { thing: CONE, holder: null, policy: "detach", returned: { take_act: "102", stance_act: "101" } } },
    { actor: "berthillon", action: "drop", object: CONE, cls: "holding", payload: { thing: CONE, holder: null, policy: "detach", returned: { take_act: "101", stance_act: "102" } } },
  ];
  const insert = (c, a) => c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload) VALUES (now(), $1, $2, $3, $4, $5, $6)`,
    [WIN, a.actor, a.action, a.object, a.cls, JSON.stringify(a.payload)]);
  const refused = /clearing_job may insert only the return of an opposed take/;
  const job = await store.connect("clearing_job");
  const owner = await store.connect("world2_owner");
  try {
    for (const a of notReturns) await assert.rejects(insert(job, a), refused, `${a.actor} ${a.action} ${a.object}`);
    // THE FLIP, in the test: without the trigger the grant alone lets every one of them in
    await owner.query("DROP TRIGGER acts_insert_return_only ON acts");
    try {
      await job.query("BEGIN");
      for (const a of notReturns) await insert(job, a);
      await job.query("ROLLBACK");
    } finally {
      await owner.query("CREATE TRIGGER acts_insert_return_only BEFORE INSERT ON acts FOR EACH ROW EXECUTE FUNCTION acts_insert_return_only()");
    }
    await assert.rejects(insert(job, notReturns[0]), refused, "and back on, it refuses again");
  } finally { await job.end(); await owner.end(); }
});
