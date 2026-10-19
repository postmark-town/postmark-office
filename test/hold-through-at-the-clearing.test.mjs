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
    // an act the clearing writes comes after every seeded one, as ids do on the record
    await c.query("SELECT setval(pg_get_serial_sequence('acts', 'id'), 1000)");
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
    await insert({ ...held, owned_by: "sb-ash" });
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

// ── POS-688 · THE OWNER'S WORD: OPPOSED BRINGS IT BACK (Darko 2026-10-19 16:39–16:45) ──
//
// The word is a stance answering the take or set-down (`answers`, `act: { act_id,
// by }`), read at every clearing with no window. The return is to the owner's
// hands when their carry has room (the store's law: the resident class's
// capacity), otherwise onto their house's parcel, otherwise it waits.
const word = (id, actId, at, stance = "opposed", { answers = "take", by = "berthillon", setter = "sb-ash" } = {}) => ({ id, at, actor: by, action: "declare-stance-on", cls: "stance",
  payload: { on: CONE, stance, by, answers, act: { act_id: String(actId), by: setter } } });
const give = (id, at, to, actor = "berthillon") => ({ id, at, actor, action: "give", holder: to, payload: { thing: CONE, holder: to, policy: "cascade", made_by: "berthillon" } });
const PARCEL = "berthillon/home-ground";
const PARCEL_ID = "b0000000-0000-4000-8000-000000000003";
const BLESSED_SHA = "c".repeat(40);
const OTHER = "berthillon/a-spoon";
const OTHER_ID = "b0000000-0000-4000-8000-000000000004";

/** The store's law (the resident's carry), a parcel for berthillon's house, and a second thing, as a test needs them. */
async function withLaw({ capacity = 24, parcel = false, spoonHeld = false } = {}) {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE settlements, law_projection CASCADE");
    await c.query("INSERT INTO law_projection (law_sha, kind, path, key, data) VALUES ($1, 'class', 'WORLD/resident/mark.md', 'resident', $2)",
      [BLESSED_SHA, JSON.stringify({ class: "resident", dials: { capacity } })]);
    await c.query("INSERT INTO settlements (number, tag_sha, published_at, window_id) VALUES (130, $1, now(), $2)", [BLESSED_SHA, WIN - 1]);
    const put = async (id, slug, kind, at, ext) => {
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
    if (parcel) await put(PARCEL_ID, PARCEL, "parcel", { x: 400, y: 400 }, { w: 25, h: 25 });
    if (spoonHeld) {
      await put(OTHER_ID, OTHER, "thing", { x: 401, y: 401 }, { w: 1, h: 1 });
      await c.query(`INSERT INTO acts (id, at, crossing, actor, action, object, class, payload) OVERRIDING SYSTEM VALUE
                     VALUES (90, '2026-10-18T20:00:00Z', $1, 'berthillon', 'take', $2, 'holding', $3)`,
        [WIN - 0.5, OTHER, JSON.stringify({ thing: OTHER, holder: "berthillon", policy: "cascade", made_by: "berthillon" })]);
    }
  } finally { await c.end(); }
}
const townActs = () => read("SELECT id::int, actor, action, at_anchor, at_dx, at_dy, payload FROM acts WHERE class = 'holding' AND actor = 'the-town' AND object = $1 ORDER BY id", [CONE]);

test("5. HANDS: berthillon asks for the cone back from sb-ash: the settlement gives it into berthillon's hands, once, and prints it there", { skip }, async () => {
  await seed({ from: 100, acts: [take(101, "2026-10-19T01:00:00Z"), word(102, 101, "2026-10-19T01:30:00Z")] });
  await withLaw();
  const r = clear();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /⚑ hold: berthillon\/a-cone — returned to its owner berthillon \(into their hands\): they asked for it back \(act 101\)/);
  const back = await townActs();
  assert.equal(back.length, 1, "one return act");
  assert.equal(back[0].action, "give");
  assert.equal(back[0].payload.holder, "berthillon");
  assert.deepEqual(back[0].payload.returned, { act: "101", stance_act: "102" });
  const row = await coneRow();
  assert.equal(row.data.held_by, "berthillon", "printed in its owner's hands, in the same clearing");
  const [win] = await read("SELECT receipts FROM windows WHERE id = $1", [WIN]);
  assert.equal(win.receipts.hold_returned[0].slug, CONE);
  assert.deepEqual(win.receipts.hold_returned[0].to, { held_by: "berthillon" });
  // the outing is over: the next clearing returns nothing again
  clear();
  assert.equal((await townActs()).length, 1, "and a second clearing writes no second return");
});

test("5b. PARCEL: berthillon's hands are full (capacity 1, a spoon in them): the settlement sets the cone on berthillon's parcel, free, and prints it there", { skip }, async () => {
  await seed({ from: 100, acts: [take(101, "2026-10-19T01:00:00Z"), word(102, 101, "2026-10-19T01:30:00Z")] });
  await withLaw({ capacity: 1, parcel: true, spoonHeld: true });
  const r = clear();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /returned to its owner berthillon \(onto berthillon\/home-ground\)/, r.out.slice(-800));
  const [back] = await townActs();
  assert.deepEqual([back.action, back.at_anchor, back.at_dx, back.at_dy], ["drop", PARCEL, 0, 0], "anchored at the parcel's centre");
  const row = await coneRow();
  assert.deepEqual(row.geometry, { at: { x: 400, y: 400 }, extent: { w: 1, h: 1 } }, r.out.split(/\r?\n/).filter((l) => /hold/.test(l)).join(" | "));
  assert.equal(row.data.held_by, undefined);
});

test("5c. WAITS: hands full and no parcel: nothing is written, the receipt says why, and the next clearing tries again", { skip }, async () => {
  await seed({ from: 100, acts: [take(101, "2026-10-19T01:00:00Z"), word(102, 101, "2026-10-19T01:30:00Z")] });
  await withLaw({ capacity: 1, spoonHeld: true });
  const r = clear();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /its owner berthillon asked for it back, and it waits — berthillon's hands are full and berthillon's house holds no parcel to set it on/);
  assert.equal((await townActs()).length, 0);
  assert.equal((await coneRow()).data.held_by, "sb-ash", "still lent, printed in sb-ash's hands");
});

test("5d. the latest word wins: opposed then neutral lends it, and nothing returns; welcomed gives it to keep, and the cone prints owned_by sb-ash", { skip }, async () => {
  await seed({ from: 100, acts: [take(101, "2026-10-19T01:00:00Z"), word(102, 101, "2026-10-19T01:30:00Z"), word(103, 101, "2026-10-19T01:40:00Z", "neutral")] });
  await withLaw();
  let r = clear();
  assert.equal(r.code, 0, r.out);
  assert.equal((await townActs()).length, 0, "neutral is the latest word: lent");
  await seed({ from: 100, acts: [take(101, "2026-10-19T01:00:00Z"), word(102, 101, "2026-10-19T01:30:00Z", "welcomed")] });
  await withLaw();
  r = clear();
  assert.equal(r.code, 0, r.out);
  assert.equal((await townActs()).length, 0);
  const row = await coneRow();
  assert.equal(row.data.owned_by, "sb-ash", "welcomed: it is sb-ash's now, printed so (D-O1)");
  assert.equal(row.data.held_by, "sb-ash");
});

test("5e. NO WINDOW: a take printed at an earlier clearing is still the owner's to ask back; a word from outside the owner's house reaches nothing", { skip }, async () => {
  await seed({ from: 101, acts: [take(101, "2026-10-19T01:00:00Z"), word(102, 101, "2026-10-19T01:30:00Z", "opposed", { by: "sb-cleo" })] });
  await withLaw();
  let r = clear();
  assert.equal(r.code, 0, r.out);
  assert.equal((await townActs()).length, 0, "sb-cleo is not the owner's house");
  await seed({ from: 101, acts: [take(101, "2026-10-19T01:00:00Z"), word(102, 101, "2026-10-19T01:30:00Z")] });
  await withLaw();
  r = clear();
  assert.equal(r.code, 0, r.out);
  assert.equal((await townActs()).length, 1, "printed before, and it still comes back");
});

test("5f. a SET-DOWN by someone outside the house is answered the same way: opposed brings it back", { skip }, async () => {
  await seed({ from: 100, acts: [take(101, "2026-10-19T01:00:00Z"), drop(102, "2026-10-19T02:00:00Z", 196, -352), word(103, 102, "2026-10-19T02:30:00Z", "opposed", { answers: "set-down" })] });
  await withLaw();
  const r = clear();
  assert.equal(r.code, 0, r.out);
  const [back] = await townActs();
  assert.deepEqual(back.payload.returned, { act: "102", stance_act: "103" });
  assert.equal((await coneRow()).data.held_by, "berthillon");
});

test("5g. THE OWNER'S GIVE passes ownership: berthillon gives the cone to sb-ash, and it prints owned_by sb-ash in sb-ash's hands", { skip }, async () => {
  await seed({ from: 100, acts: [give(101, "2026-10-19T01:00:00Z", "sb-ash")] });
  await withLaw();
  const r = clear();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /⚑ hold: berthillon\/a-cone — held by sb-ash; owned by sb-ash/);
  const row = await coneRow();
  assert.equal(row.data.owned_by, "sb-ash");
  const [claim] = await read("SELECT claimant FROM claims WHERE slug = $1 AND window_id = $2", [CONE, WIN]);
  assert.equal(claim.claimant, "berthillon", "the maker is fixed: the printout is filed in the maker's name");
});

test("6. 078's acts arm: clearing_job may insert only the return of a thing its owner asked back (a take or a set-down), once per word", { skip }, async () => {
  await seed({ from: 100, acts: [take(101, "2026-10-19T01:00:00Z"), word(102, 101, "2026-10-19T01:30:00Z"),
    take(103, "2026-10-19T02:00:00Z"), word(104, 103, "2026-10-19T02:30:00Z", "welcomed"),
    drop(105, "2026-10-19T03:00:00Z", 196, -352), word(106, 105, "2026-10-19T03:30:00Z", "opposed", { answers: "set-down" })] });
  const c = await store.connect("clearing_job");
  const ret = (payload, { actor = "the-town", action = "drop", cls = "holding", object = CONE } = {}) => c.query(
    `INSERT INTO acts (at, crossing, actor, action, object, class, payload) VALUES (now(), $1, $2, $3, $4, $5, $6)`,
    [WIN, actor, action, object, cls, JSON.stringify(payload)]);
  const good = { thing: CONE, holder: null, policy: "detach", returned: { act: "101", stance_act: "102" } };
  const refused = /clearing_job may insert only the return of an opposed take/;
  try {
    await c.query("BEGIN");
    await ret(good);
    await assert.rejects(ret(good), refused, "once per word");
    await c.query("ROLLBACK");
    await c.query("BEGIN");
    await ret({ ...good, returned: { act: "105", stance_act: "106" } });
    await c.query("ROLLBACK");
    await assert.rejects(ret({ ...good, returned: { act: "103", stance_act: "104" } }), refused, "a welcomed take is not returned");
    await assert.rejects(ret({ ...good, returned: { act: "101", stance_act: "106" } }), refused, "the word must answer the act it names");
    await assert.rejects(ret(good, { actor: "sb-ash" }), refused, "only the town returns");
    await assert.rejects(ret({ thing: CONE, holder: null, policy: "detach" }), refused, "a drop naming no return is no return");
    await assert.rejects(ret(good, { cls: "voice", action: "say" }), refused, "nor any other act");
  } finally { await c.end(); }
});

test("7. FALSIFIER (Wright's condition 1): clearing_job's INSERT on acts is the trigger's to refuse — every act that is not a return is refused, and with the trigger dropped the same inserts land", { skip }, async () => {
  await seed({ from: 100, acts: [take(101, "2026-10-19T01:00:00Z"), word(102, 101, "2026-10-19T01:30:00Z")] });
  // the shapes a clearing pen could be asked to write that are not the return of an opposed take
  const notReturns = [
    { actor: "the-town", action: "say", object: CONE, cls: "voice", payload: { text: "hello" } },
    { actor: "the-town", action: "leave-mark", object: CONE, cls: "mark", payload: { thing: CONE } },
    { actor: "the-town", action: "take", object: CONE, cls: "holding", payload: { thing: CONE, holder: "the-town", policy: "cascade", returned: { act: "101", stance_act: "102" } } },
    { actor: "the-town", action: "drop", object: ROOM, cls: "holding", payload: { thing: ROOM, holder: null, policy: "detach", returned: { act: "101", stance_act: "102" } } },
    { actor: "the-town", action: "drop", object: CONE, cls: "holding", payload: { thing: CONE, holder: null, policy: "detach", returned: { act: "102", stance_act: "101" } } },
    { actor: "berthillon", action: "drop", object: CONE, cls: "holding", payload: { thing: CONE, holder: null, policy: "detach", returned: { act: "101", stance_act: "102" } } },
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
