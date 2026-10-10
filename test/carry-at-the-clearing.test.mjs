// carry-at-the-clearing.test.mjs — THE CARRY, in the store, in the clearing's own
// transaction (POS-441, ruled by Darko 2026-10-07: moving a mark carries the
// marks inside it that belong to the same household; another household's marks
// never move. "That should just always be the default rule.").
//
//   node --test test/carry-at-the-clearing.test.mjs
//
// THE RIG. A real Postgres (test/helpers/embedded-store.mjs) with the whole
// schema, 068 included, and the real `clearing-job.mjs` run as a child under the
// `clearing_job` pen — because the carry is an INSERT that pen never held, and
// only Postgres can say whether the grant and its trigger let exactly that in.
//
// The fixture: Rei's parcel at (1000, 1000) holds her house (filed in it),
// Wright's bench (one household with Rei, under another spelling), and
// little-bird's spork. Rei amends the parcel to (1100, 960).

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");
const TOWN_SHA = "t".repeat(40);
const LAW_SHA = "l".repeat(40);
const WIN = 240;

const store = await startStore({ db: "carry_test" });
after(() => store.stop()); // a store never stopped left its server running on every run (POS-479)
const skip = store.skip ?? false;

const IDS = {
  parcel: "a0000000-0000-4000-8000-000000000001",
  house: "a0000000-0000-4000-8000-000000000002",
  bench: "a0000000-0000-4000-8000-000000000003",
  spork: "a0000000-0000-4000-8000-000000000004",
  district: "a0000000-0000-4000-8000-000000000005",
  inner: "a0000000-0000-4000-8000-000000000006",
  neighbour: "a0000000-0000-4000-8000-000000000007",
};
const box = (at, ext) => `((${at.x - ext.w / 2},${at.y - ext.h / 2}),(${at.x + ext.w / 2},${at.y + ext.h / 2}))`;

async function seed({ houseClaim = false, district = false, ghost = false } = {}) {
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
       VALUES ('starforge', 0, 'Starforge', ARRAY['rei','wright'], '2026-08-01', 'wright'),
              ('foundoutanyway', 1, 'Found Out Anyway', ARRAY['little-bird'], '2026-08-01', 'little-bird'),
              ('rabbit', 2, 'Rabbit', ARRAY['sable'], '2026-08-01', 'sable')`);
    await c.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned)
       VALUES ('rei', 'rei', 201, '2026-08-01'), ('wright', 'wright-starforge', 202, '2026-08-01'),
              ('little-bird', 'little-bird', 203, '2026-08-01'), ('sable', 'sable', 204, '2026-08-01')`);
    // A mark's id is the claim that locked it (001), and `claims.supersedes` is a
    // foreign key into `claims` — so every standing mark here has its locking claim.
    const mark = async (id, slug, kind, owner, household, at, ext, data = {}) => {
      const geometry = JSON.stringify({ at, extent: ext }), d = JSON.stringify({ tier: "home", ...data });
      await c.query(
        `INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
         VALUES ($1, $2, $3, $4, $5, 'locked', now(), $6, $7, $8::box, 0, $9, $10)`,
        [id, WIN - 1, kind, owner, household, `${slug}.`, geometry, box(at, ext), d, slug]);
      await c.query(
        `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::box, 'standing', $9, $10)`,
        [id, slug, kind, owner, household, `${slug}.`, geometry, box(at, ext), WIN - 1, d]);
    };
    if (district) {
      // A district of Rei's holding a parcel of hers; sable's parcel stands where hers would land.
      await mark(IDS.district, "rei/the-district", "sited", "rei", "hh:starforge", { x: 5000, y: 5000 }, { w: 200, h: 200 });
      await mark(IDS.inner, "rei/the-inner-parcel", "parcel", "rei", "hh:starforge", { x: 5000, y: 5000 }, { w: 25, h: 25 });
      await mark(IDS.neighbour, "sable/the-next-parcel", "parcel", "sable", "hh:rabbit", { x: 5300, y: 5000 }, { w: 25, h: 25 });
    } else {
      await mark(IDS.parcel, "rei/the-parcel", "parcel", "rei", "hh:starforge", { x: 1000, y: 1000 }, { w: 25, h: 25 });
      // the house is a SEEDED row: its file bookkeeping must not survive the carry
      await mark(IDS.house, "rei/the-house", "sited", "rei", "hh:starforge", { x: 1000, y: 1000 }, { w: 10, h: 10 },
        { _parentMarkId: "rei/the-parcel", _fileAt: { x: 0, y: 0 }, _origin: { x: 1000, y: 1000 } });
      await mark(IDS.bench, "wright/the-bench", "sited", "wright", "solo:wright", { x: 1008, y: 1008 }, { w: 2, h: 1 });
      await mark(IDS.spork, "little-bird/the-spork", "sited", "little-bird", "hh:foundoutanyway", { x: 995, y: 995 }, { w: 1, h: 1 });
      // A rider the roll does not name: starforge's spelling on the row, an owner no house lists.
      if (ghost) await mark(GHOST_ID, "ghost/the-lantern", "sited", "ghost", "hh:starforge", { x: 1004, y: 1004 }, { w: 1, h: 1 });
    }
    const [moverSlug, moverId, from, to, ext, kind] = district
      ? ["rei/the-district", IDS.district, { x: 5000, y: 5000 }, { x: 5300, y: 5000 }, { w: 200, h: 200 }, "sited"]
      : ["rei/the-parcel", IDS.parcel, { x: 1000, y: 1000 }, { x: 1100, y: 960 }, { w: 25, h: 25 }, "parcel"];
    void from;
    const { rows: [claim] } = await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug, supersedes)
       VALUES ($1, $2, 'rei', 'hh:starforge', 'pending', $3, $4, $5::box, 0, '{"date":"2026-10-07"}', $6, $7)
       RETURNING id::text`,
      [WIN, kind, `${moverSlug}, moved.`, JSON.stringify({ slug: moverSlug, at: to, extent: ext }), box(to, ext), moverSlug, moverId]);
    if (ghost)
      // An unrelated claim in the same window: it must lock whatever the move does.
      await c.query(
        `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
         VALUES ($1, 'sited', 'sable', 'hh:rabbit', 'pending', 'A gate.', $2, $3::box, 0, '{"date":"2026-10-08","tier":"home"}', 'sable/the-gate')`,
        [WIN, JSON.stringify({ slug: "sable/the-gate", at: { x: 3000, y: 3000 }, extent: { w: 2, h: 2 } }), box({ x: 3000, y: 3000 }, { w: 2, h: 2 })]);
    if (houseClaim)
      await c.query(
        `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug, supersedes)
         VALUES ($1, 'sited', 'rei', 'hh:starforge', 'pending', 'A new picture.', $2, $3::box, 0, '{"date":"2026-10-07"}', 'rei/the-house', $4)`,
        [WIN, JSON.stringify({ slug: "rei/the-house", at: { x: 1000, y: 1000 }, extent: { w: 10, h: 10 } }), box({ x: 1000, y: 1000 }, { w: 10, h: 10 }), IDS.house]);
    return claim.id;
  } finally { await c.end(); }
}

function clear(job = JOB) {
  const r = spawnSync(process.execPath, [job, "--window", String(WIN)], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
async function read(sql, args = []) {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
}
const placeOf = async (slug) => (await read("SELECT geometry FROM marks WHERE slug = $1", [slug]))[0]?.geometry?.at ?? null;

test("THE CARRY: the parcel moves and its household's marks ride by the same offset in the same window, as their own claims; another household's mark stays", { skip }, async () => {
  const claimId = await seed();
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.match(run.out, /⚑ carry: moved rei\/the-parcel and 2 marks of your household's; 1 mark of other households stayed where it was \(hh:foundoutanyway ×1\)/);

  assert.deepEqual(await placeOf("rei/the-parcel"), { x: 1100, y: 960 });
  assert.deepEqual(await placeOf("rei/the-house"), { x: 1100, y: 960 }, "the house rode: same offset, same place relative to the parcel");
  assert.deepEqual(await placeOf("wright/the-bench"), { x: 1108, y: 968 }, "the bench rode: one household under another spelling (solo:wright is starforge's)");
  assert.deepEqual(await placeOf("little-bird/the-spork"), { x: 995, y: 995 }, "another household's mark never moves");

  const riders = await read(
    `SELECT c.slug, c.claimant, c.status, c.supersedes::text, c.data->>'_carried_by' AS carried_by, c.data ? '_fileAt' AS has_file_at, m.locked_window
       FROM claims c JOIN marks m ON m.slug = c.slug
      WHERE c.window_id = $1 AND c.status = 'locked' AND c.data ? '_carried_by' ORDER BY c.slug`, [WIN]);
  assert.deepEqual(riders.map((r) => [r.slug, r.claimant, r.supersedes, r.carried_by, r.has_file_at, r.locked_window]), [
    ["rei/the-house", "rei", IDS.house, claimId, false, WIN],
    ["wright/the-bench", "wright", IDS.bench, claimId, false, WIN],
  ], "one locked claim per rider, superseding its mark, naming the move; the owner is the rider's own; the stale file numbers are gone");
  const [bench] = await read("SELECT owner FROM marks WHERE slug = 'wright/the-bench'");
  assert.equal(bench.owner, "wright", "a carry moves a mark; it never changes whose it is");
  // POS-457: a rider's claim is a NEW row, so it is spelled as every row is
  // since the law date. The bench stood under `solo:wright`; its claim names
  // the house the deriver answers for its owner, never the old spelling copied.
  const riderHouses = await read(
    `SELECT slug, household FROM claims WHERE window_id = $1 AND data ? '_carried_by' ORDER BY slug`, [WIN]);
  assert.deepEqual(riderHouses.map((r) => [r.slug, r.household]), [
    ["rei/the-house", "hh:starforge"],
    ["wright/the-bench", "hh:starforge"],
  ], "each rider's claim carries the slug key of its owner's house");

  const [w] = await read("SELECT receipts FROM windows WHERE id = $1", [WIN]);
  assert.deepEqual(w.receipts.carried, [{
    claim: claimId, slug: "rei/the-parcel", dx: 100, dy: -40,
    carried: [
      { slug: "rei/the-house", from: { x: 1000, y: 1000 }, to: { x: 1100, y: 960 } },
      { slug: "wright/the-bench", from: { x: 1008, y: 1008 }, to: { x: 1108, y: 968 } },
    ],
    stayed: [{ slug: "little-bird/the-spork", household: "hh:foundoutanyway" }],
    sentence: "moved rei/the-parcel and 2 marks of your household's; 1 mark of other households stayed where it was (hh:foundoutanyway ×1)",
  }], "the one act, its riders named on the window's record");
  assert.equal(w.receipts.six_count.locked, 1, "the six-count is the docket's: the riders are the move's, not new claims anyone filed");
});

test("ALL OR NOTHING: a rider with its own claim waiting in the window refuses the move by name, and nothing moves", { skip }, async () => {
  const claimId = await seed({ houseClaim: true });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  const [c] = await read("SELECT status, refusal_check FROM claims WHERE id = $1", [claimId]);
  assert.equal(c.status, "refused");
  assert.equal(c.refusal_check, "carry: a move carries all of its household's marks inside it or none, and rei/the-house cannot move (it has its own claim waiting in this window)");
  assert.deepEqual(await placeOf("rei/the-parcel"), { x: 1000, y: 1000 });
  assert.deepEqual(await placeOf("wright/the-bench"), { x: 1008, y: 1008 }, "nothing half-moves");
  const [w] = await read("SELECT receipts FROM windows WHERE id = $1", [WIN]);
  assert.equal(w.receipts.carried, undefined);
});

test("A CARRIED PARCEL may not land on another's: the move refuses by name instead of the exclusion constraint taking the window down", { skip }, async () => {
  const claimId = await seed({ district: true });
  const run = clear();
  assert.equal(run.code, 0, `one move must never roll a whole window back:\n${run.out}`);
  const [c] = await read("SELECT status, refusal_check FROM claims WHERE id = $1", [claimId]);
  assert.equal(c.status, "refused");
  assert.match(c.refusal_check, /rei\/the-inner-parcel cannot move \(carried, it would overlap the parcel "sable\/the-next-parcel"\)/);
  assert.deepEqual(await placeOf("rei/the-inner-parcel"), { x: 5000, y: 5000 });
});

test("068's trigger: clearing_job may insert a carried mark's claim and nothing else", { skip }, async () => {
  await seed();
  const c = await store.connect("clearing_job");
  try {
    await assert.rejects(c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, geometry, stake, data, slug)
       VALUES ($1, 'sited', 'rei', 'hh:starforge', 'pending', '{}', 0, '{}', 'rei/a-new-thing')`, [WIN]),
      /clearing_job may insert only a carried mark's claim/);
    await assert.rejects(c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, geometry, stake, data, slug, supersedes)
       VALUES ($1, 'sited', 'rei', 'hh:starforge', 'locked', '{}', 0, '{}', 'rei/the-house', $2)`, [WIN, IDS.house]),
      /clearing_job may insert only a carried mark's claim/, "locked and superseding, but naming no move");
  } finally { await c.end(); }
});

// POS-457 (Wright's review of #438, #427's reviewer's forecast): 6.1 resolves a
// rider's house BEFORE the insert's try. A NO_SUCH_HOUSE carries no SQLSTATE,
// so inside the try it rethrew and took the WHOLE window down. Step 5.7 checks
// the roll first today, so to test 6.1's own answer this runs a copy of the job
// with 5.7's roll check taken out: the ruling (a mover and its riders refuse as
// one unit, alone) must hold in 6.1 whatever runs before it.
const GHOST_ID = "a0000000-0000-4000-8000-000000000099";
function jobWithout57() {
  const src = readFileSync(JOB, "utf8");
  const check = "          try { await ownerHouseholdFor(q, r.owner); }\n          catch { stuck.push({ slug: r.slug, why: `its owner ${r.owner} is not on the town's roll` }); }\n";
  assert.equal(src.split(check).length, 2, "5.7's roll check is where this test expects it");
  const tools = pathToFileURL(join(ROOT, "world2", "tools")).href, root = pathToFileURL(ROOT).href;
  const copy = src.replace(check, "")
    .replaceAll('from "./', `from "${tools}/`).replaceAll('from "../../', `from "${root}/`)
    .replace('await import("pg")', `await import(${JSON.stringify(pathToFileURL(createRequire(join(ROOT, "package.json")).resolve("pg")).href)})`)
    .replace("const HERE = dirname(fileURLToPath(import.meta.url));", `const HERE = ${JSON.stringify(join(ROOT, "world2", "tools"))};`);
  const dir = mkdtempSync(join(tmpdir(), "pos457-job-"));
  const path = join(dir, "clearing-job.mjs");
  writeFileSync(path, copy);
  return { path, done: () => { rmSync(path); rmdirSync(dir); } };
}

test("A RIDER THE ROLL DOES NOT NAME refuses its move alone, and the window locks the rest (6.1, with 5.7's check taken out)", { skip }, async () => {
  const claimId = await seed({ ghost: true });
  const job = jobWithout57();
  let run;
  try { run = clear(job.path); } finally { job.done(); }
  assert.equal(run.code, 0, `one rider must never roll a whole window back:\n${run.out}`);
  const [c] = await read("SELECT status, refusal_check FROM claims WHERE id = $1", [claimId]);
  assert.equal(c.status, "refused", "the move refuses, as one unit");
  assert.match(c.refusal_check, /ghost\/the-lantern/, "and names the rider");
  assert.deepEqual(await placeOf("rei/the-parcel"), { x: 1000, y: 1000 }, "the mover stayed");
  assert.deepEqual(await placeOf("wright/the-bench"), { x: 1008, y: 1008 }, "nothing half-moved");
  const [gate] = await read("SELECT status FROM claims WHERE slug = 'sable/the-gate'");
  assert.equal(gate.status, "locked", "the rest of the window locked");
});
