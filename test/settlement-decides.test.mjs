// settlement-decides.test.mjs — POS-1025: THE SETTLEMENT'S LAST TWO DECISIONS ARE MADE BEFORE ITS SEAL.
//
// Darko 2026-11-13, POS-1025/c: "What publishes is decided inside the settlement and stays fixed." The two
// doors out of canon the sweep and retire-unpublished.mjs used to take AFTER the seal (the owner's
// withdrawal, the commons mark with no stamps behind it) are the clearing's step 7.5 now, on a real store,
// with the world's own unpublish rule read from the office's world clone at the pinned law
// (world2/tools/settlement-decides.mjs). Every house, handle and id here is INVENTED.
//
//   1  the commons rule takes the unbacked commons mark (retired settlement-unpublish, back to its drafts,
//      its registry row closed, out of the seal) and keeps the backed, the home, the stale and the held
//   2  the owner's withdrawal retires settlement-withdraw, returns nothing, closes its row; a slug locked
//      again in the same window waits for the next
//   3  what the store cannot answer is KEPT and named: no world checkout, no escrow read at the sha
//   4  the registry is kept as the sweep kept its file: a new publication is admitted at its walked class,
//      a reclass keeps its place, a hand-off is not a publication, the town's own marks are never registered
//
//   node --test test/settlement-decides.test.mjs

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");
const WORLD = process.env.WORLD_CLONE ?? join(ROOT, "world-clone");
const LAW_SHA = execFileSync("git", ["-C", WORLD, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();   // the world's own rule, at a real law
const TOWN_SHA = "t".repeat(40);
const WIN = 410;
const OPENED = new Date(Date.UTC(2026, 10, 1, 5, 45, 40));

const store = await startStore({ db: "settlement_decides_test" });
after(() => store.stop());
const skip = store.skip ?? false;

async function owner(fn) {
  const c = await store.connect("world2_owner");
  try { return await fn(c); } finally { await c.end(); }
}
const read = (sql, args = []) => owner(async (c) => (await c.query(sql, args)).rows);
const box = (at, ext) => `((${at.x - ext.w / 2},${at.y - ext.h / 2}),(${at.x + ext.w / 2},${at.y + ext.h / 2}))`;
const EXT = { w: 4, h: 4 };
let n = 0;
const uuid = () => `d0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

/** A standing mark on open ground (it walks `market`: commons), locked at an earlier window. */
async function mark(c, slug, ownerHandle, household, x, data = {}) {
  const id = uuid(), at = { x, y: 9000 }, geometry = JSON.stringify({ at, extent: EXT });
  await c.query(
    `INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
     VALUES ($1, $2, 'sited', $3, $4, 'locked', now(), $5, $6, $7::box, 1, $8, $9)`,
    [id, WIN - 1, ownerHandle, household, `${slug}, as it stood.`, geometry, box(at, EXT), JSON.stringify({ by: ownerHandle, date: "2026-10-01", ...data }), slug]);
  await c.query(
    `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
     VALUES ($1, $2, 'sited', $3, $4, $5, $6, $7::box, 'standing', $8, $9)`,
    [id, slug, ownerHandle, household, `${slug}, as it stood.`, geometry, box(at, EXT), WIN - 1, JSON.stringify({ by: ownerHandle, date: "2026-10-01", ...data })]);
  return id;
}

async function seed({ escrow = true } = {}) {
  n = 0;
  await owner(async (c) => {
    await c.query("TRUNCATE settlement_publications, world_snapshot_folds, world_snapshots, world_snapshot_marks, mark_versions, world_snapshot_register, register_versions, escrow_projection, acts, claims, marks, windows, projection_heads, households, household_pins, settlements CASCADE");
    for (const id of [WIN - 1, WIN]) {
      const opens = new Date(OPENED.getTime() + (id - WIN) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === WIN ? "open" : "closed", id === WIN ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by, accounts)
       VALUES ('rabbit', 0, 'Rabbit', ARRAY['sable','rei'], '2026-08-01', 'sable', '[]')`);
    await c.query("INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('sable', 'sable', 204, '2026-08-01'), ('rei', 'rei', 205, '2026-08-01')");
    await mark(c, "sable/the-lamp", "sable", "hh:rabbit", 9000);          // commons, nothing behind it: taken
    await mark(c, "sable/the-cup", "sable", "hh:rabbit", 9100);           // commons, one stamp behind it: kept
    await mark(c, "rei/the-garage", "rei", "hh:rabbit", 9200);            // registered home: never a candidate
    await mark(c, "sable/the-bench", "sable", "hh:rabbit", 9300);         // a stale row: never swept ("skip")
    await mark(c, "sable/the-cone", "sable", "hh:rabbit", 9400, { held_by: "rei" });   // held: published, unplaced
    await mark(c, "rei/the-shed", "rei", "hh:rabbit", 9500);              // its owner let it go
    await mark(c, "sable/the-founding-stone", "sable", "hh:rabbit", 9600); // not in the registry: founding estate
    if (escrow) await c.query(
      `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
       VALUES ($1, 'sable/the-cup', 'rei', 'hh:rabbit', 'hh:rabbit', 1, 1)`, [TOWN_SHA]);
    let ord = 0;
    for (const [slug, cls, stale] of [["sable/the-lamp", "commons", false], ["sable/the-cup", "commons", false], ["rei/the-garage", "home", false],
      ["sable/the-bench", "commons", true], ["sable/the-cone", "commons", false], ["rei/the-shed", "commons", false]])
      await c.query("INSERT INTO settlement_publications (slug, class, stale, ord, from_window) VALUES ($1, $2, $3, $4, 0)", [slug, cls, stale, ord++]);
    await c.query(
      `INSERT INTO acts (at, actor, action, object, class) VALUES (now() - interval '2 days', 'rei', 'leave-mark', 'rei/the-shed', 'mark'),
                                                                   (now() - interval '1 day', 'rei', 'withdraw', 'rei/the-shed', 'mark')`);
  });
}

function clear(win = WIN, { worldRepo = WORLD } = {}) {
  const r = spawnSync(process.execPath, [JOB, "--window", String(win), ...(worldRepo ? ["--world-repo", worldRepo] : [])], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const marksBy = async () => Object.fromEntries((await read("SELECT slug, status, retired_cause FROM marks ORDER BY slug")).map((r) => [r.slug, r.status === "standing" ? "standing" : r.retired_cause]));
const live = async () => (await read("SELECT slug, class, stale, ord, from_window FROM settlement_publications WHERE to_window IS NULL ORDER BY ord")).map((r) => [r.slug, r.class, Number(r.ord)]);
const receiptOf = async (win = WIN) => (await read("SELECT receipts FROM windows WHERE id = $1", [win]))[0].receipts.settlement;
const sealedSlugs = async (win = WIN) => (await read(
  "SELECT sm.slug FROM world_snapshots s JOIN world_snapshot_marks sm ON sm.marks_digest = s.marks_digest WHERE s.window_id = $1 ORDER BY sm.slug", [win])).map((r) => r.slug);

test("1 · THE COMMONS RULE, BEFORE THE SEAL: the unbacked commons mark leaves (settlement-unpublish, back to its drafts, its row closed, out of the seal); backed, home, stale and held stay", { skip }, async () => {
  await seed();
  const r = clear();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /settlement: sable\/the-lamp a commons mark with no stamps behind it — retired \(settlement-unpublish\)/);
  const m = await marksBy();
  assert.equal(m["sable/the-lamp"], "settlement-unpublish");
  for (const kept of ["sable/the-cup", "rei/the-garage", "sable/the-bench", "sable/the-cone", "sable/the-founding-stone"])
    assert.equal(m[kept], "standing", `${kept} stands`);
  const [draft, ...more] = await read("SELECT claimant, household, stake, window_id, data FROM claims WHERE status = 'draft' AND slug = 'sable/the-lamp'");
  assert.equal(more.length, 0);
  assert.deepEqual([draft.claimant, draft.household, draft.stake, draft.window_id], ["sable", "hh:rabbit", 0, WIN], "back in its household's drafts, at ✦0, in the window that took it");
  assert.equal(draft.data._returned.cause, "settlement-unpublish");
  assert.ok(!(await live()).some(([s]) => s === "sable/the-lamp"), "its registry row is closed");
  assert.deepEqual((await read("SELECT to_window FROM settlement_publications WHERE slug = 'sable/the-lamp'")).map((x) => x.to_window), [WIN], "closed AT this window, kept for the registry as sealed before it");
  const sealed = await sealedSlugs();
  assert.ok(!sealed.includes("sable/the-lamp"), "THE SEAL IS THE WORLD AS DECIDED: the taken mark is not in it");
  assert.ok(sealed.includes("sable/the-cup") && sealed.includes("sable/the-cone"));
  const receipt = await receiptOf();
  assert.deepEqual(receipt.unpublished, ["sable/the-lamp"]);
  assert.equal(receipt.rules, "read", "the world's rule was read at the pinned law");
  assert.ok(receipt.restanding, "ground left, so the standing was walked again before the seal");
});

test("2 · THE OWNER'S WITHDRAWAL: retired settlement-withdraw, returned to no drafts, its row closed; locked again in the same window, it waits for the next", { skip }, async () => {
  await seed();
  const r = clear();
  assert.equal(r.code, 0, r.out);
  assert.equal((await marksBy())["rei/the-shed"], "settlement-withdraw");
  assert.deepEqual(await read("SELECT slug FROM claims WHERE status = 'draft' AND slug = 'rei/the-shed'"), [], "the author let it go: no draft");
  assert.ok(!(await live()).some(([s]) => s === "rei/the-shed"));
  assert.deepEqual((await receiptOf()).withdrawn, ["rei/the-shed"]);
  assert.ok(!(await sealedSlugs()).includes("rei/the-shed"));

  // the docket wins its own crossing: an amend of the shed locked in the same window defers the withdrawal
  await seed();
  await owner((c) => c.query(
    `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug, supersedes)
     SELECT $1, 'sited', 'rei', 'hh:rabbit', 'pending', 'the shed, repainted', geometry, bbox, 1, data, slug, id FROM marks WHERE slug = 'rei/the-shed'`, [WIN]));
  await owner((c) => c.query(`INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k) VALUES ($1, 'rei/the-shed', 'sable', 'hh:rabbit', 'hh:rabbit', 1, 1)`, [TOWN_SHA]));
  const again = clear();
  assert.equal(again.code, 0, again.out);
  const receipt = await receiptOf();
  assert.deepEqual(receipt.deferred, ["rei/the-shed"]);
  assert.equal((await marksBy())["rei/the-shed"], "standing", "it stands this window; the next one carries the withdrawal");
});

test("3 · WHAT THE STORE CANNOT ANSWER IS KEPT, BY NAME: no world checkout, and no escrow read at the window's sha", { skip }, async () => {
  await seed();
  const blind = clear(WIN, { worldRepo: null });
  assert.equal(blind.code, 0, blind.out);
  assert.equal((await marksBy())["sable/the-lamp"], "standing", "never taken on a rule not read");
  const receipt = await receiptOf();
  assert.match(receipt.rules, /no --world-repo/);
  assert.ok(receipt.unchecked.some((u) => u.slug === "sable/the-lamp"));
  assert.match(blind.out, /sable\/the-lamp UNCHECKED for the commons rule \(kept\)/);
  assert.match(receipt.registry.unchecked, /no --world-repo/, "and the registry is left as it was, said so");
  assert.deepEqual((await receiptOf()).withdrawn, ["rei/the-shed"], "the withdrawal needs no world rule, and is made");

  await seed({ escrow: false });
  const unread = clear();
  assert.equal(unread.code, 0, unread.out);
  assert.equal((await marksBy())["sable/the-lamp"], "standing", "no escrow at this sha is not 'nobody stakes'");
  const r2 = await receiptOf();
  assert.equal(r2.escrow, "unread");
  assert.ok(r2.unchecked.some((u) => u.slug === "sable/the-lamp" && u.why === "escrow-unread"));
});

test("4 · THE REGISTRY, AS THE SWEEP KEPT ITS FILE: a new publication is admitted at its walked class at the end, a republish keeps its place, a hand-off is not a publication, the town is never registered", { skip }, async () => {
  await seed();
  assert.equal(clear().code, 0);   // window WIN seals the first snapshot (the lamp leaves)
  const before = await live();
  await owner(async (c) => {
    await c.query(
      `INSERT INTO windows (id, opens_at, closes_at, status) SELECT $1, closes_at, closes_at + interval '12 hours', 'open' FROM windows WHERE id = $2
       ON CONFLICT (id) DO NOTHING`, [WIN + 1, WIN]);
    const file = async (slug, ownerHandle, x, data, supersedes = null) => {
      const at = { x, y: 9000 };
      await c.query(
        `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug, supersedes)
         VALUES ($1, 'sited', $2, $3, 'pending', $4, $5, $6::box, 1, $7, $8, $9)`,
        [WIN + 1, ownerHandle, ownerHandle === "the-town" ? "solo:the-town" : "hh:rabbit", `${slug}, as it stood.`, JSON.stringify({ slug, at, extent: EXT }), box(at, EXT),
          JSON.stringify({ by: ownerHandle, date: "2026-10-01", ...data }), slug, supersedes]);
      await c.query(`INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k) VALUES ($1, $2, 'rei', 'hh:rabbit', 'hh:rabbit', 1, 1) ON CONFLICT DO NOTHING`, [TOWN_SHA, slug]);
    };
    await file("sable/the-new-well", "sable", 9700, {});                                    // a new publication
    const { rows: [stone] } = await c.query("SELECT id FROM marks WHERE slug = 'sable/the-founding-stone'");
    await file("sable/the-founding-stone", "sable", 9600, { colour: "grey" }, stone.id);      // founding estate, republished by an amend
    const { rows: [cone] } = await c.query("SELECT id FROM marks WHERE slug = 'sable/the-cone'");
    await file("sable/the-cone", "sable", 9400, { held_by: "sable" }, cone.id);              // only the hand moved: a hand-off
  });
  const r = clear(WIN + 1);
  assert.equal(r.code, 0, r.out);
  const after = await live();
  const receipt = await receiptOf(WIN + 1);
  assert.deepEqual(after.slice(0, before.length), before, "every row that stood keeps its place and class");
  assert.deepEqual(after.slice(before.length).map(([s, c]) => [s, c]), [["sable/the-founding-stone", "commons"], ["sable/the-new-well", "commons"]],
    "the new publications are admitted at the end, at the class their ground walks (open ground: commons)");
  assert.deepEqual(receipt.registry.hand_offs, ["sable/the-cone"], "the cone moved hands only: not a publication");
  assert.equal(after.find(([s]) => s === "sable/the-cone")[1], "commons");
});

// ── the cutover's seed (publications-seed.mjs) ──────────────────────────────

const SEED = join(ROOT, "world2", "tools", "publications-seed.mjs");
function seedCli(args) {
  const u = new URL(store.url("world2_owner"));
  const r = spawnSync(process.execPath, [SEED, ...args], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PGHOST: u.hostname, PGPORT: u.port, PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.slice(1) },
  });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* the assertion prints it */ }
  return { code: r.status, out, raw: `${r.stdout}\n${r.stderr}` };
}

test("5 · THE SEED copies today's registry ONCE: every row in the file's order and class, stale exactly where the world rule says the path is not on main; a re-run changes nothing; a store already keeping a different registry refuses", { skip }, async () => {
  const { seedRowsOf } = await import("../world2/tools/publications-seed.mjs");
  const text = execFileSync("git", ["-C", WORLD, "show", `${LAW_SHA}:WORLD/settlement-publications.json`], { encoding: "utf8", maxBuffer: 1 << 28 });
  const file = JSON.parse(text).published;
  const onMain = new Set(execFileSync("git", ["-C", WORLD, "ls-tree", "-r", "--name-only", LAW_SHA, "--", "WORLD/marks"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean));

  await owner((c) => c.query("TRUNCATE settlement_publications"));
  const dry = seedCli(["--world-repo", WORLD, "--sha", LAW_SHA, "--dry-run"]);
  assert.equal(dry.code, 0, dry.raw);
  assert.equal(dry.out.status, "would-seed");
  assert.equal((await read("SELECT count(*)::int AS n FROM settlement_publications"))[0].n, 0, "a dry run writes nothing");

  const run = seedCli(["--world-repo", WORLD, "--sha", LAW_SHA]);
  assert.equal(run.code, 0, run.raw);
  assert.equal(run.out.status, "seeded");
  const rows = await read("SELECT slug, class, stale, ord, from_window, to_window FROM settlement_publications ORDER BY ord");
  assert.deepEqual(rows.map((r) => r.slug), Object.keys(file), "every row, in the file's own order");
  for (const r of rows) {
    assert.equal(r.class, file[r.slug].class, r.slug);
    assert.equal(r.stale, !onMain.has(file[r.slug].path), `${r.slug}: stale exactly when its registered path is not on main`);
    assert.deepEqual([r.from_window, r.to_window], [0, null]);
  }
  assert.deepEqual(seedRowsOf(text, (p) => onMain.has(p)).map((r) => [r.slug, r.ord]), rows.map((r) => [r.slug, Number(r.ord)]), "the pure half agrees with what was written");

  const again = seedCli(["--world-repo", WORLD, "--sha", LAW_SHA]);
  assert.equal(again.code, 0, again.raw);
  assert.equal(again.out.status, "already-seeded");

  await owner((c) => c.query("UPDATE settlement_publications SET to_window = 1 WHERE ord = 0"));   // the clearing has moved on
  const over = seedCli(["--world-repo", WORLD, "--sha", LAW_SHA]);
  assert.equal(over.code, 1, over.raw);
  assert.equal(over.out.status, "refused");
  assert.match(over.out.why, /differs from the file/);
  assert.equal((await read("SELECT count(*)::int AS n FROM settlement_publications WHERE to_window IS NULL"))[0].n, rows.length - 1, "and nothing was written");
});
