// clearing-limits.test.mjs — A PARCEL OVER A LIMIT IS OPPOSED AT THE CLEARING AND
// HOLDS NO GROUND (POS-364; Darko RULED A, 2026-10-08: "agree that over limit
// parcel gets detected asap").
//
//   node --test test/clearing-limits.test.mjs
//
// THE RIG. A real Postgres (embedded-store.mjs) and the real `clearing-job.mjs`
// run as a child under the `clearing_job` pen, as the carry test runs it, with
// the office's world clone as its `--world-repo`. The clearing asks the world's
// OWN fold at the store's pinned world-law sha (ENGINE below, world#166), never
// the checkout's HEAD. The pinned-law test pins an OLDER law than the clone's
// HEAD (test/clone-pins.json, 0bcb9c1c) and the clearing judges nothing; a
// clearing that read HEAD would judge, so that test is the proof.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { claimEffectsFrom } from "../src/claim-effects.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");
const WORLD = process.env.WORLD_CLONE ?? join(ROOT, "world-clone");
const TOWN_SHA = "t".repeat(40);
const ENGINE = "a01213a822fbddeec31dfdd0dfb72afb9b6b9367";   // world#166: the fold reads claimed_at
const WIN = 240;
const SAGE = Array.from({ length: 15 }, (_, i) => `s${String(i).padStart(2, "0")}`), REEVES = ["r1", "r2", "r3", "r4"];

const store = await startStore({ db: "clearing_limits_test" });
const box = (x, y = 0, w = 25, h = 25) => `((${x - w / 2},${y - h / 2}),(${x + w / 2},${y + h / 2}))`;
const geo = (slug, x, y = 0) => JSON.stringify({ slug, at: { x, y }, extent: { w: 25, h: 25 } });
const pad = (i) => String(i).padStart(2, "0");

async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }
const read = (sql, args = []) => owner(async (c) => (await c.query(sql, args)).rows);

/**
 * Windows WIN-1 (closed) and WIN (open), the heads (world-law pinned at `lawSha`),
 * and three households: sage (15 residents), reeves (4), other (1), declared in
 * the register and printed in the roster at the pinned law, the grouping the
 * settlement's fold reads (`world-snapshot.mjs § foldHouseholds`).
 */
async function base(c, { lawSha = ENGINE } = {}) {
  await c.query("TRUNCATE law_projection, escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
  for (const id of [WIN - 1, WIN]) {
    const opens = new Date(Date.UTC(2026, 9, 6, 18) + (id - WIN + 1) * 12 * 3600e3).toISOString();
    await c.query(`INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
      [id, opens, id === WIN ? "open" : "closed", id === WIN ? null : opens]);
  }
  await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [lawSha, TOWN_SHA]);
  await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES
    ('sage', 0, 'Sage', $1, '2026-07-01', 's00'), ('reeves', 1, 'Reeves', $2, '2026-07-01', 'r1'), ('other', 2, 'Other', ARRAY['ot'], '2026-07-01', 'ot')`, [SAGE, REEVES]);
  let gh = 100;
  for (const h of [...SAGE, ...REEVES, "ot"])
    await c.query("INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ($1, $1, $2, '2026-07-01')", [h, ++gh]);
  for (const [house, handles] of [["sage", SAGE], ["reeves", REEVES], ["other", ["ot"]]])
    for (const h of handles)
      await c.query("INSERT INTO law_projection (law_sha, kind, path, key, data) VALUES ($1, 'roster', 'WORLD/households.json', $2, $3)", [lawSha, h, JSON.stringify({ household: house })]);
}

/** The Reeves' four parcels, claimed 2026-07-21..24 (prior estate), locked in WIN-1. → their claim ids. */
async function reevesEstate(c) {
  const ids = [];
  for (const [i, h] of REEVES.entries()) {
    const slug = `${h}/plot`;
    const { rows: [r] } = await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
       VALUES ($1, 'parcel', $2, 'hh:reeves', 'locked', now(), $3, $4, $5::box, 0, $6, $7) RETURNING id::text`,
      [WIN - 1, h, `${slug}.`, geo(slug, 5000 + i * 100), box(5000 + i * 100), JSON.stringify({ date: `2026-07-2${i + 1}` }), slug]);
    await c.query(
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
       VALUES ($1, $2, 'parcel', $3, 'hh:reeves', $4, $5, $6::box, 'standing', $7, $8)`,
      [r.id, slug, h, `${slug}.`, geo(slug, 5000 + i * 100), box(5000 + i * 100), WIN - 1, JSON.stringify({ date: `2026-07-2${i + 1}` })]);
    ids.push(r.id);
  }
  return ids;
}
const pending = (c, { slug, by, house, x, date, supersedes = null }) => c.query(
  `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug, supersedes)
   VALUES ($1, 'parcel', $2, $3, 'pending', $4, $5, $6::box, 0, $7, $8, $9)`,
  [WIN, by, house, `${slug}.`, geo(slug, x), box(x), JSON.stringify(date === undefined ? {} : { date }), slug, supersedes]);

function clear() {
  const r = spawnSync(process.execPath, [JOB, "--window", String(WIN), "--world-repo", WORLD], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

test("FIFTEEN PARCELS, A CAP OF THREE: the first three lock; twelve are opposed at the clearing, citing the-town/claim-cap, and none stands", async () => {
  await owner(async (c) => {
    await base(c);
    for (let i = 0; i < 15; i++) await pending(c, { slug: `s${pad(i)}/plot`, by: `s${pad(i)}`, house: "hh:sage", x: i * 100, date: `2026-10-08T${pad(i)}:00:00Z` });
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  const claims = await read("SELECT slug, status, refusal_check FROM claims WHERE window_id = $1 ORDER BY slug", [WIN]);
  assert.deepEqual(claims.filter((c) => c.status === "locked").map((c) => c.slug), ["s00/plot", "s01/plot", "s02/plot"], "the first three by claim order");
  const opposed = claims.filter((c) => c.status === "refused");
  assert.equal(opposed.length, 12);
  for (const c of opposed) assert.match(c.refusal_check, new RegExp(`^opposed: the-town/claim-cap: ${c.slug.replace("/", "\\/")} — parcel claim capped`));
  const standing = await read("SELECT slug FROM marks WHERE kind = 'parcel' AND status = 'standing' ORDER BY slug");
  assert.deepEqual(standing.map((m) => m.slug), ["s00/plot", "s01/plot", "s02/plot"], "an opposed parcel never materializes: it holds no ground");
  const [w] = await read("SELECT receipts FROM windows WHERE id = $1", [WIN]);
  assert.equal(w.receipts.parcel_cap.over_limit.length, 12);
  assert.match(w.receipts.parcel_cap.applied_by, /this clearing/);
});

test("THE BLOCKING CASE: another household's parcel overlapping one of the twelve locks in the SAME window", async () => {
  await owner(async (c) => {
    await base(c);
    for (let i = 0; i < 15; i++) await pending(c, { slug: `s${pad(i)}/plot`, by: `s${pad(i)}`, house: "hh:sage", x: i * 100, date: `2026-10-08T${pad(i)}:00:00Z` });
    await pending(c, { slug: "ot/plot", by: "ot", house: "hh:other", x: 1410, date: "2026-10-08T20:00:00Z" });   // overlaps s14/plot (x 1400)
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  const [ot] = await read("SELECT status, refusal_check FROM claims WHERE slug = 'ot/plot'");
  assert.equal(ot.status, "locked", `the other household's parcel locks: ${ot.refusal_check ?? ""} (the over-limit one never held ground or a counterclaim)`);
  const [s14] = await read("SELECT status, refusal_check FROM claims WHERE slug = 's14/plot'");
  assert.equal(s14.status, "refused");
  assert.match(s14.refusal_check, /^opposed: the-town\/claim-cap/);
});

test("AN AMENDED PRE-LAW PARCEL STILL STANDS: a household holding four from before the law moves one today", async () => {
  await owner(async (c) => {
    await base(c);
    const ids = await reevesEstate(c);
    await pending(c, { slug: "r1/plot", by: "r1", house: "hh:reeves", x: 5020, date: "2026-10-08T12:00:00Z", supersedes: ids[0] });
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  const [amend] = await read("SELECT status, refusal_check FROM claims WHERE window_id = $1 AND slug = 'r1/plot'", [WIN]);
  assert.equal(amend.status, "locked", `a relocation is never a new claim: ${amend.refusal_check ?? ""}`);
  const [m] = await read("SELECT geometry FROM marks WHERE slug = 'r1/plot'");
  assert.equal(m.geometry.at.x, 5020);
});

// ── the review of the A build: ONE RULE, NOT TWO (the clearing asks the fold) ──

test("A REVIVE IS DATED BY ITS ORIGIN CLAIM: the Reeves retire a 07-24 parcel and leave it again, and it locks (the settlement keeps it)", async () => {
  let r4;
  await owner(async (c) => {
    await base(c);
    r4 = (await reevesEstate(c))[3];
    await c.query("UPDATE marks SET status = 'retired', retired_window = $1 WHERE id = $2", [WIN - 1, r4]);
    await pending(c, { slug: "r4/plot", by: "r4", house: "hh:reeves", x: 5300, date: "2026-10-08T12:00:00Z" });
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  const [claim] = await read("SELECT status, refusal_check FROM claims WHERE window_id = $1 AND slug = 'r4/plot'", [WIN]);
  assert.equal(claim.status, "locked", `a revive keeps its row's id, so its first claim is 2026-07-24, prior estate: ${claim.refusal_check ?? ""}`);
  const [m] = await read("SELECT id::text, status FROM marks WHERE slug = 'r4/plot'");
  assert.deepEqual(m, { id: r4, status: "standing" }, "the same row, standing again");
});

test("A CLAIM WITH NO DATE is dated by its submitted_at, as the settlement dates it: a fourth parcel is opposed, not waved through as pre-law", async () => {
  await owner(async (c) => {
    await base(c);
    for (let i = 0; i < 3; i++) await pending(c, { slug: `s${pad(i)}/plot`, by: `s${pad(i)}`, house: "hh:sage", x: i * 100, date: `2026-10-01T${pad(i)}:00:00Z` });
    await pending(c, { slug: "s03/plot", by: "s03", house: "hh:sage", x: 300 });   // no data.date
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  const [s03] = await read("SELECT status, refusal_check FROM claims WHERE slug = 's03/plot'");
  assert.equal(s03.status, "refused");
  assert.match(s03.refusal_check, /^opposed: the-town\/claim-cap: s03\/plot — parcel claim capped — this credential household already holds 3/);
});

test("THE HOUSEHOLD IS THE FOLD'S GROUPING, not the claim row's: a fourth parcel filed as solo:s03 is still the Sage household's fourth", async () => {
  await owner(async (c) => {
    await base(c);
    for (let i = 0; i < 3; i++) await pending(c, { slug: `s${pad(i)}/plot`, by: `s${pad(i)}`, house: "hh:sage", x: i * 100, date: `2026-10-01T${pad(i)}:00:00Z` });
    await pending(c, { slug: "s03/plot", by: "s03", house: "solo:s03", x: 300, date: "2026-10-01T03:00:00Z" });
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  const [s03] = await read("SELECT status, refusal_check FROM claims WHERE slug = 's03/plot'");
  assert.equal(s03.status, "refused", `the roster at the pinned law groups s03 with sage: ${s03.refusal_check ?? ""}`);
  const [w] = await read("SELECT receipts FROM windows WHERE id = $1", [WIN]);
  assert.match(w.receipts.parcel_cap.households, /law_projection roster/, "the receipt names where the households came from");
});

test("THE LAW IS THE STORE'S PIN, never the checkout's HEAD: pinned at a law that predates the first-claim order, the clearing judges nothing and says so", async () => {
  // An older pin than ENGINE, whose fold has no claimed_at. (If the clone's HEAD
  // ever carries world#166, this pin is still the older law, by sha.)
  const OLD = "53df97fee95b46279318a42a88c0c1fd6669fe0d";
  await owner(async (c) => {
    await base(c, { lawSha: OLD });
    for (let i = 0; i < 4; i++) await pending(c, { slug: `s${pad(i)}/plot`, by: `s${pad(i)}`, house: "hh:sage", x: i * 100, date: `2026-10-01T${pad(i)}:00:00Z` });
  });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.match(run.out, /NOT JUDGED here — the engine at the pinned law 53df97fee95b predates the first-claim order/);
  const [w] = await read("SELECT receipts FROM windows WHERE id = $1", [WIN]);
  assert.equal(w.receipts.parcel_cap.checked, false);
  const locked = await read("SELECT slug FROM claims WHERE window_id = $1 AND status = 'locked'", [WIN]);
  assert.equal(locked.length, 4, "unjudged, they lock; the settlement's limit pass is the backstop");
});

test("THE RESIDENT'S OUTCOME NAMES THE LIMIT: the doorstep's sentence and my-marks' row both cite the-town/claim-cap", async () => {
  const [row] = await read(`SELECT slug, status, window_id, refusal_check, submitted_at, decided_at, claimant FROM claims WHERE status = 'refused' LIMIT 1`).catch(() => []);
  const sample = row ?? { slug: "s03/plot", status: "refused", window_id: WIN, refusal_check: "opposed: the-town/claim-cap: s03/plot — parcel claim capped — this credential household already holds 3", submitted_at: new Date().toISOString(), decided_at: new Date().toISOString(), claimant: "s03" };
  const events = claimEffectsFrom({ rows: [sample], sinceCrossing: 0, nowCrossing: 1e9, mine: () => true });
  const refused = events.find((e) => e.kind === "claim-refused");
  assert.match(refused.summary, /was opposed at candle \d+, citing the-town\/claim-cap: over its limit, it holds no ground$/);
  assert.equal(refused.cause, "opposed", "the bulletin's seventh word (Darko, POS-364)");
  assert.doesNotMatch(refused.summary, /no word in the bulletin/, "a ruled word leaves no apology tail");
  const { refusedRowsFrom } = await import("../src/claim-effects.mjs");
  assert.match(refusedRowsFrom(events)[0].says, /^refused at candle \d+: opposed: the-town\/claim-cap: /);
});

test.after(async () => { await store.stop(); });
