// clearing-escrow-order.test.mjs — THE CANDLE'S ESCROW GATE JUDGES AGAINST THE
// WINDOW'S RESULT (WLD-51; Darko, 2026-10-14: "the settlement's order is always
// town, then sovereign (parcels), then market").
//
//   node --test test/clearing-escrow-order.test.mjs
//
// Step 5.5 used to walk the standing rows AND every claim, so a claim moving a
// standing parcel stood in the walk twice, at its old place and its new one. A
// ✦0 commons claim passed as `home` on either rect: inside the old one though the
// parcel was leaving, or inside the new one though step 5.7 then refused the
// move. The store locked a ✦0 commons mark the world's sweep never publishes.
//
// THE RIG is carry-at-the-clearing.test.mjs's: a real Postgres
// (test/helpers/embedded-store.mjs) and the real `clearing-job.mjs` run as a
// child under the `clearing_job` pen. Rei's parcel stands at (1000, 1000), and a
// claim moves it to (1100, 960). Two ✦0 sheds of Rei's are claimed in the same
// window: one at the parcel's old place, one at its new place.

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
const WIN = 240;

const store = await startStore({ db: "escrow_order_test" });
after(() => store.stop());
const skip = store.skip ?? false;

const IDS = {
  parcel: "b0000000-0000-4000-8000-000000000001",
  house: "b0000000-0000-4000-8000-000000000002",
  stone: "b0000000-0000-4000-8000-000000000003",
};
const box = (at, ext) => `((${at.x - ext.w / 2},${at.y - ext.h / 2}),(${at.x + ext.w / 2},${at.y + ext.h / 2}))`;
const OLD = { x: 1000, y: 1000 }, NEW = { x: 1100, y: 960 }, FAR = { x: 5000, y: 5000 };

async function seed({ refuseTheMove = false } = {}) {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [WIN - 1, WIN]) {
      const opens = new Date(Date.UTC(2026, 9, 6, 18) + (id - WIN + 1) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === WIN ? "open" : "closed", id === WIN ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by)
       VALUES ('starforge', 0, 'Starforge', ARRAY['rei'], '2026-08-01', 'rei'),
              ('rabbit', 1, 'Rabbit', ARRAY['sable'], '2026-08-01', 'sable')`);
    await c.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned)
       VALUES ('rei', 'rei', 201, '2026-08-01'), ('sable', 'sable', 204, '2026-08-01')`);
    const mark = async (id, slug, kind, owner, household, at, ext) => {
      const geometry = JSON.stringify({ at, extent: ext }), d = JSON.stringify({ tier: "home" });
      await c.query(
        `INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
         VALUES ($1, $2, $3, $4, $5, 'locked', now(), $6, $7, $8::box, 0, $9, $10)`,
        [id, WIN - 1, kind, owner, household, `${slug}.`, geometry, box(at, ext), d, slug]);
      await c.query(
        `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::box, 'standing', $9, $10)`,
        [id, slug, kind, owner, household, `${slug}.`, geometry, box(at, ext), WIN - 1, d]);
    };
    await mark(IDS.parcel, "rei/the-parcel", "parcel", "rei", "hh:starforge", OLD, { w: 25, h: 25 });
    await mark(IDS.house, "rei/the-house", "sited", "rei", "hh:starforge", OLD, { w: 10, h: 10 });
    // somebody's stake on another mark, so the escrow read is a real answer
    // (an empty projection reports every commons claim UNCHECKED and refuses none)
    await mark(IDS.stone, "sable/the-stone", "sited", "sable", "hh:rabbit", { x: 9000, y: 9000 }, { w: 1, h: 1 });
    await c.query(
      `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
       VALUES ($1, 'sable/the-stone', 'rei', 'hh:starforge', 'hh:rabbit', 1, 0),
              ($1, 'rei/the-staked-bench', 'sable', 'hh:rabbit', 'hh:starforge', 1, 0)`, [TOWN_SHA]);
    const claim = async (slug, kind, at, ext, supersedes = null) => (await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug, supersedes)
       VALUES ($1, $2, 'rei', 'hh:starforge', 'pending', $3, $4, $5::box, 0, '{"date":"2026-10-08"}', $6, $7)
       RETURNING id::text`,
      [WIN, kind, `${slug}.`, JSON.stringify({ slug, at, extent: ext }), box(at, ext), slug, supersedes])).rows[0].id;
    const ids = {
      move: await claim("rei/the-parcel", "parcel", NEW, { w: 25, h: 25 }, IDS.parcel),
      oldShed: await claim("rei/the-old-shed", "sited", OLD, { w: 4, h: 4 }),
      newShed: await claim("rei/the-new-shed", "sited", NEW, { w: 4, h: 4 }),
      bench: await claim("rei/the-far-bench", "sited", FAR, { w: 1, h: 1 }),
      // a non-mover on open ground with a stamp behind it: the gate is presence, and it holds
      stakedBench: await claim("rei/the-staked-bench", "sited", { x: 6000, y: 6000 }, { w: 1, h: 1 }),
    };
    // A rider with its own claim waiting refuses the move (5.7, ALL OR NOTHING).
    if (refuseTheMove) ids.house = await claim("rei/the-house", "sited", OLD, { w: 10, h: 10 }, IDS.house);
    return ids;
  } finally { await c.end(); }
}

function clear() {
  const r = spawnSync(process.execPath, [JOB, "--window", String(WIN)], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
// What the store says STANDS after the window: the ghost this gate must never leave.
async function standing(slugs) {
  const c = await store.connect("world2_owner");
  try {
    const { rows } = await c.query("SELECT slug FROM marks WHERE status = 'standing' AND slug = ANY($1) ORDER BY slug", [slugs]);
    return rows.map((r) => r.slug);
  } finally { await c.end(); }
}
const SHEDS = ["rei/the-far-bench", "rei/the-new-shed", "rei/the-old-shed", "rei/the-staked-bench"];
async function statusOf(id) {
  const c = await store.connect("world2_owner");
  try {
    const { rows: [row] } = await c.query("SELECT status, refusal_check FROM claims WHERE id = $1", [id]);
    return row ? `${row.status}${row.refusal_check ? `: ${row.refusal_check}` : ""}` : null;
  } finally { await c.end(); }
}

test("THE MOVE LOCKS: a ✦0 shed at the parcel's NEW place locks home; one at the place it LEFT is a commons mark with nothing staked, refused", { skip }, async () => {
  const ids = await seed();
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.equal(await statusOf(ids.move), "locked");
  assert.equal(await statusOf(ids.newShed), "locked");
  assert.match(await statusOf(ids.oldShed), /^refused: escrow-absent/, "the parcel left that ground in this window");
  assert.match(await statusOf(ids.bench), /^refused: escrow-absent/, "the control: open ground, nothing staked");
  assert.equal(await statusOf(ids.stakedBench), "locked", "a non-mover's verdict is unchanged: a stamp behind it, it locks");
  assert.deepEqual(await standing(SHEDS), ["rei/the-new-shed", "rei/the-staked-bench"], "no ghost: no ✦0 mark stands where the parcel left");
});

test("THE MOVE IS REFUSED (5.7): the shed at the parcel's OLD place locks home; the one at the place it never reached is refused", { skip }, async () => {
  const ids = await seed({ refuseTheMove: true });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.match(await statusOf(ids.move), /^refused: carry:/);
  assert.equal(await statusOf(ids.oldShed), "locked", "the parcel stayed, so its old ground still holds the shed");
  assert.match(await statusOf(ids.newShed), /^refused: escrow-absent/, "a move 5.7 refused lends no ground");
  assert.match(await statusOf(ids.bench), /^refused: escrow-absent/);
  assert.equal(await statusOf(ids.stakedBench), "locked");
  assert.deepEqual(await standing(SHEDS), ["rei/the-old-shed", "rei/the-staked-bench"], "no ghost: no ✦0 mark stands where a refused move never went");
});

// ── review-550 (FIX), lifted from its probes (Starstory docs/2026-10-13/rail/WLD-51/probes/review-550/) ──
//
// THE TWO-PASS SPLIT ITSELF (5.5a before the carry) is not pinned by a test: a
// test would need a ✦0 commons mover carrying a parcel rider. It stays for the
// reason 5.5 gives (a mover the gate refuses carries nothing), named and untested.

let uidN = 0;
const uid = () => `c0000000-0000-4000-8000-${String(++uidN).padStart(12, "0")}`;
const HH = { rei: "hh:starforge", sable: "hh:rabbit" };
const P = { w: 25, h: 25 };

/** A window built by `build({ mark, claim })` on the same households, heads and escrow as `seed`. */
async function rig(build) {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [WIN - 1, WIN]) {
      const opens = new Date(Date.UTC(2026, 9, 6, 18) + (id - WIN + 1) * 12 * 3600e3).toISOString();
      await c.query(`INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === WIN ? "open" : "closed", id === WIN ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ('starforge', 0, 'Starforge', ARRAY['rei'], '2026-08-01', 'rei'), ('rabbit', 1, 'Rabbit', ARRAY['sable'], '2026-08-01', 'sable')`);
    await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('rei', 'rei', 201, '2026-08-01'), ('sable', 'sable', 204, '2026-08-01')`);
    const mark = async (slug, kind, owner, at, ext, data = {}) => {
      const id = uid(), geometry = JSON.stringify({ at, extent: ext }), d = JSON.stringify({ tier: "home", ...data });
      await c.query(`INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug) VALUES ($1, $2, $3, $4, $5, 'locked', now(), $6, $7, $8::box, 0, $9, $10)`,
        [id, WIN - 1, kind, owner, HH[owner], `${slug}.`, geometry, box(at, ext), d, slug]);
      await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::box, 'standing', $9, $10)`,
        [id, slug, kind, owner, HH[owner], `${slug}.`, geometry, box(at, ext), WIN - 1, d]);
      return id;
    };
    // a stake on another mark, so the escrow read is a real answer
    await mark("sable/the-stone", "sited", "sable", { x: 9000, y: 9000 }, { w: 1, h: 1 });
    await c.query(`INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k) VALUES ($1, 'sable/the-stone', 'rei', 'hh:starforge', 'hh:rabbit', 1, 0)`, [TOWN_SHA]);
    const claim = async (slug, kind, owner, at, ext, supersedes = null, data = {}) => (await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug, supersedes) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7::box, 0, $8, $9, $10) RETURNING id::text`,
      [WIN, kind, owner, HH[owner], `${slug} (claimed).`, JSON.stringify({ slug, at, extent: ext }), box(at, ext), JSON.stringify({ date: "2026-10-08", ...data }), slug, supersedes])).rows[0].id;
    return await build({ mark, claim, c });
  } finally { await c.end(); }
}
async function markAt(slug) {
  const c = await store.connect("world2_owner");
  try { const { rows: [m] } = await c.query("SELECT status, geometry FROM marks WHERE slug = $1", [slug]); return m ? { status: m.status, at: m.geometry?.at ?? null } : null; }
  finally { await c.end(); }
}

test("R3, THE WRONG LOCK: a ✦0 mark moved onto the place a REFUSED parcel move never reached is refused, and no ghost stands there", { skip }, async () => {
  const ids = await rig(async ({ mark, claim }) => {
    const parcel = await mark("rei/the-parcel", "parcel", "rei", OLD, P);
    const house = await mark("rei/the-house", "sited", "rei", OLD, { w: 10, h: 10 });
    const lamp = await mark("rei/the-lamp", "sited", "rei", FAR, { w: 1, h: 1 });
    return {
      move: await claim("rei/the-parcel", "parcel", "rei", NEW, P, parcel),
      house: await claim("rei/the-house", "sited", "rei", OLD, { w: 10, h: 10 }, house),   // waits: 5.7 refuses the move
      lamp: await claim("rei/the-lamp", "sited", "rei", { x: NEW.x + 8, y: NEW.y + 8 }, { w: 1, h: 1 }, lamp),
    };
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.match(await statusOf(ids.move), /^refused: carry:/);
  assert.match(await statusOf(ids.lamp), /^refused: escrow-absent/, "the parcel never reached NEW, so the lamp would stand on open ground at ✦0");
  assert.deepEqual(await markAt("rei/the-lamp"), { status: "standing", at: FAR }, "the lamp stays where it stood");
  assert.doesNotMatch(run.out, /⚑ carry: moved/, "a move that did not happen is not named on the crossing's log");
});

test("R5, THE NAMED RESIDUAL (b): a ✦0 mark moved INTO the place a refused parcel move was leaving is refused at 5.5a, and stays standing where it was", { skip }, async () => {
  // Under the ruling this lamp would lock home: the parcel stays at OLD. 5.5a
  // judged it with the parcel laid at NEW and refused it, and a mover decided
  // at 5.5a is not asked again. Safe: nothing is taken, and filing the move
  // again next window locks it. The day this residual is closed, this test
  // says so (assert `locked` instead).
  const ids = await rig(async ({ mark, claim }) => {
    const parcel = await mark("rei/the-parcel", "parcel", "rei", OLD, P);
    const house = await mark("rei/the-house", "sited", "rei", OLD, { w: 10, h: 10 });
    const lamp = await mark("rei/the-lamp", "sited", "rei", FAR, { w: 1, h: 1 });
    return {
      move: await claim("rei/the-parcel", "parcel", "rei", NEW, P, parcel),
      house: await claim("rei/the-house", "sited", "rei", OLD, { w: 10, h: 10 }, house),
      lamp: await claim("rei/the-lamp", "sited", "rei", { x: OLD.x + 8, y: OLD.y + 8 }, { w: 1, h: 1 }, lamp),
    };
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.match(await statusOf(ids.move), /^refused: carry:/);
  assert.match(await statusOf(ids.lamp), /^refused: escrow-absent/);
  assert.deepEqual(await markAt("rei/the-lamp"), { status: "standing", at: FAR }, "nothing is taken: the lamp stands at FAR");
});

test("R1, THE MOVED SLUG LEAVES THE INDEX: a ✦0 mark moved into a parcel that welcomes it locks home by consent", { skip }, async () => {
  const ids = await rig(async ({ mark, claim }) => {
    await mark("rei/the-parcel", "parcel", "rei", OLD, P, { consent: { "sable/the-stool": "welcomed" } });
    const stool = await mark("sable/the-stool", "sited", "sable", FAR, { w: 1, h: 1 });
    return { stoolMove: await claim("sable/the-stool", "sited", "sable", { x: 1008, y: 1008 }, { w: 1, h: 1 }, stool) };
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.equal(await statusOf(ids.stoolMove), "locked", "the index answered for the stool at FAR, where nothing holds it");
});

test("R2, THE CARRIED RIDER: a ✦0 claim inside a carried house that welcomes it locks at the house's new place; one at its old place is refused", { skip }, async () => {
  const ids = await rig(async ({ mark, claim }) => {
    const parcel = await mark("rei/the-parcel", "parcel", "rei", OLD, P);
    await mark("rei/the-house", "sited", "rei", OLD, { w: 10, h: 10 }, { consent: { "sable/cup-new": "welcomed", "sable/cup-old": "welcomed" } });
    return {
      move: await claim("rei/the-parcel", "parcel", "rei", NEW, P, parcel),
      cupNew: await claim("sable/cup-new", "sited", "sable", { x: NEW.x + 2, y: NEW.y + 2 }, { w: 1, h: 1 }),
      cupOld: await claim("sable/cup-old", "sited", "sable", { x: OLD.x + 2, y: OLD.y + 2 }, { w: 1, h: 1 }),
    };
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.equal(await statusOf(ids.move), "locked", run.out);
  assert.match(run.out, /⚑ carry: moved rei\/the-parcel/);
  assert.equal(await statusOf(ids.cupNew), "locked");
  assert.match(await statusOf(ids.cupOld), /^refused: escrow-absent/);
});

test("R2, REFUSED: when the move is refused, the house's riders stand where they are — the cup at its old place locks, the one at the new place is refused", { skip }, async () => {
  const ids = await rig(async ({ mark, claim }) => {
    const parcel = await mark("rei/the-parcel", "parcel", "rei", OLD, P);
    await mark("rei/the-house", "sited", "rei", OLD, { w: 10, h: 10 }, { consent: { "sable/cup-new": "welcomed", "sable/cup-old": "welcomed" } });
    const lantern = await mark("rei/the-lantern", "sited", "rei", { x: OLD.x - 8, y: OLD.y - 8 }, { w: 1, h: 1 });
    return {
      move: await claim("rei/the-parcel", "parcel", "rei", NEW, P, parcel),
      // a rider with its own claim waiting refuses the move (5.7)
      lantern: await claim("rei/the-lantern", "sited", "rei", { x: OLD.x - 8, y: OLD.y - 8 }, { w: 1, h: 1 }, lantern),
      cupNew: await claim("sable/cup-new", "sited", "sable", { x: NEW.x + 2, y: NEW.y + 2 }, { w: 1, h: 1 }),
      cupOld: await claim("sable/cup-old", "sited", "sable", { x: OLD.x + 2, y: OLD.y + 2 }, { w: 1, h: 1 }),
    };
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.match(await statusOf(ids.move), /^refused: carry:/);
  assert.equal(await statusOf(ids.cupOld), "locked");
  assert.match(await statusOf(ids.cupNew), /^refused: escrow-absent/);
});

test("R4, A WORDS-ONLY AMEND moves no ground: a ✦0 shed inside the amended parcel locks home", { skip }, async () => {
  const ids = await rig(async ({ mark, claim }) => {
    const parcel = await mark("rei/the-parcel", "parcel", "rei", OLD, P);
    return {
      amend: await claim("rei/the-parcel", "parcel", "rei", OLD, P, parcel),
      shed: await claim("rei/the-shed", "sited", "rei", { x: OLD.x + 5, y: OLD.y + 5 }, { w: 2, h: 2 }),
    };
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.equal(await statusOf(ids.amend), "locked");
  assert.equal(await statusOf(ids.shed), "locked", run.out);
});

test("THE UUID BELT: a predicate whose parent edge names an amended mark by uuid alone still walks to it (home)", { skip }, async () => {
  // Today's door always writes `data.parent_id` too, so the slug fallback
  // carries the edge; this pins the uuid edge on its own.
  const ids = await rig(async ({ mark, claim, c }) => {
    const parcel = await mark("rei/the-parcel", "parcel", "rei", OLD, P);
    const amend = await claim("rei/the-parcel", "parcel", "rei", OLD, P, parcel);
    const { rows: [note] } = await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, stake, data, slug, parent)
       VALUES ($1, 'predicated', 'rei', 'hh:starforge', 'pending', 'A note on the parcel.', 0, '{"date":"2026-10-08","slot":"note","value":"a note"}', 'rei/a-note', $2)
       RETURNING id::text`, [WIN, parcel]);
    return { amend, note: note.id };
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.equal(await statusOf(ids.note), "locked", run.out);
});

test("THE RECEIPT COUNTS A MOVER ONCE: a backed commons mark moved on open ground is judged in both passes and counted once", { skip }, async () => {
  const ids = await rig(async ({ mark, claim, c }) => {
    const lamp = await mark("rei/the-lamp", "sited", "rei", FAR, { w: 1, h: 1 });
    await c.query(`INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k) VALUES ($1, 'rei/the-lamp', 'sable', 'hh:rabbit', 'hh:starforge', 1, 0)`, [TOWN_SHA]);
    return { lamp: await claim("rei/the-lamp", "sited", "rei", { x: FAR.x + 50, y: FAR.y }, { w: 1, h: 1 }, lamp) };
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.equal(await statusOf(ids.lamp), "locked");
  const c = await store.connect("world2_owner");
  try {
    const { rows: [w] } = await c.query("SELECT receipts FROM windows WHERE id = $1", [WIN]);
    assert.equal(w.receipts.escrow_presence.commons, 1, JSON.stringify(w.receipts.escrow_presence));
  } finally { await c.end(); }
});
