// settlement-printout.test.mjs — POS-1025: THE SETTLEMENT PRINTS ITS SEALED SNAPSHOT, TAGS IT, AND RECORDS IT.
//
// Darko 2026-11-13: POS-365/a "Printout only"; POS-1025/a "Every settlement" (the tag only after the printout,
// never rewritten); POS-1025/c "Report only" (nothing decided after the seal). On a real store and a real
// world tree (a full checkout of the office's pinned world clone, with the world's own fold and reparent
// verb), with the registry seeded from that tree's own WORLD/settlement-publications.json. The marks the
// store adds are INVENTED; the one it takes is a real commons mark of the pinned world, which the
// settlement's commons rule takes because nothing in this store stands behind it.
//
//   1  print: the delta between the last printed seal and this one, and nothing else — a new mark written at
//      its filing, a taken mark's file and empty seat removed, the registry as sealed (its other 1,4xx rows
//      byte for byte), the derived files folded, one `settlement: S<n> printout` commit; a second print of
//      the same seal is `already-printed` once recorded
//   2  tag: annotated settlement/S<n> at the printout, naming the digest; again is a no-op; a tag that
//      stands anywhere else is refused, never moved
//   3  record: the store keeps the sha once and moves world-marks only for the highest printed settlement;
//      a different sha is refused; an older settlement printed late is refused before it is rendered
//
//   node --test test/settlement-printout.test.mjs

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedRowsOf, seedPublications } from "../world2/tools/publications-seed.mjs";
import { printSettlement, tagSettlement, recordPrintout, digestOfTagMessage, deltaOf } from "../world2/tools/settlement-printout.mjs";
import { renderRecord } from "../world2/tools/mark-render.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");
const PINNED = process.env.WORLD_CLONE ?? join(ROOT, "world-clone");
const LAW_SHA = execFileSync("git", ["-C", PINNED, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const TOWN_SHA = "t".repeat(40), TOWN_SHA2 = "u".repeat(40);
const WIN = 520;
const OPENED = new Date(Date.UTC(2026, 10, 2, 5, 45, 40));

const store = await startStore({ db: "settlement_printout_test" });
after(() => store.stop());
const skip = store.skip ?? false;
const scratch = mkdtempSync(join(tmpdir(), "settlement-printout-"));
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
// a FULL working tree of the pinned world (its objects are whole; only its checkout is sparse)
const WORLD = join(scratch, "world");
if (!skip) {
  execFileSync("git", ["clone", "-q", "--no-checkout", PINNED, WORLD]);
  git(WORLD, "checkout", "-q", "-B", "main", LAW_SHA);
  git(WORLD, "config", "user.name", "the settlement sweep (box)");
  git(WORLD, "config", "user.email", "postmark-settlement@users.noreply.github.com");
}
const FILE = skip ? null : JSON.parse(git(WORLD, "show", `${LAW_SHA}:WORLD/settlement-publications.json`));
// A real commons mark of the pinned world, filed where its registry row says, which the store will take.
const TAKEN = skip ? null : Object.entries(FILE.published).find(([id, r]) => r.class === "commons" && existsSync(join(WORLD, r.path))
  && /^by:\s*(.+)$/m.exec(readFileSync(join(WORLD, r.path), "utf8"))?.[1]?.trim() === id.split("/")[0]);

async function owner(fn) {
  const c = await store.connect("world2_owner");
  try { return await fn(c); } finally { await c.end(); }
}
const read = (sql, args = []) => owner(async (c) => (await c.query(sql, args)).rows);
async function asClearing(fn) {
  const c = await store.connect("clearing_job");
  try { return await fn((t, a) => c.query(t, a)); } finally { await c.end(); }
}
const box = (at, ext) => `((${at.x - ext.w / 2},${at.y - ext.h / 2}),(${at.x + ext.w / 2},${at.y + ext.h / 2}))`;
const EXT = { w: 4, h: 4 };
function clear(win) {
  const r = spawnSync(process.execPath, [JOB, "--window", String(win), "--world-repo", PINNED], {
    cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const NEW = "sable/the-new-well";
let S1, S2;

test("setup: the last printed seal (S1, the pinned world's main) and the next (S2: one new mark, one taken)", { skip }, async () => {
  assert.ok(TAKEN, "the pinned world holds a commons mark filed where its row says");
  const [takenId] = TAKEN;
  await owner(async (c) => {
    await c.query("TRUNCATE settlement_publications, world_snapshot_folds, world_snapshots, world_snapshot_marks, mark_versions, world_snapshot_register, register_versions, escrow_projection, acts, claims, marks, windows, projection_heads, households, household_pins, settlements CASCADE");
    for (const id of [WIN, WIN + 1]) {
      const opens = new Date(OPENED.getTime() + (id - WIN) * 12 * 3600e3).toISOString();
      await c.query(`INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, $2, $2::timestamptz + interval '12 hours', 'open')`, [id, opens]);
    }
    await c.query("UPDATE windows SET status = 'closed', cleared_at = opens_at WHERE id = $1", [WIN + 1]);   // reopened below, in order
    await c.query("UPDATE windows SET status = 'open' WHERE id = $1", [WIN + 1]);
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now()), ('world-marks', $1, now())", [LAW_SHA, TOWN_SHA]);
    await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by, accounts) VALUES ('rabbit', 0, 'Rabbit', ARRAY['sable'], '2026-08-01', 'sable', '[]')`);
    await c.query("INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('sable', 'sable', 204, '2026-08-01')");
    // the keeper's last tag, read by the office tick: the pinned world carries real settlement tags, and the
    // settlement continues past every number the store has named
    await c.query("INSERT INTO settlements (number, tag_sha, published_at, window_id, blessed_at) VALUES (90000, $1, '2026-11-01T06:00:00Z', NULL, '2026-11-01T06:00:00Z')", [LAW_SHA]);
    // the taken mark stands in the store, as the cutover's store holds it
    const at = { x: -90000, y: -90000 };
    await c.query(
      `INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
       VALUES ('e0000000-0000-4000-8000-000000000001', $1, 'sited', $2, 'hh:taken', 'locked', now(), 'as it stood', $3, $4::box, 1, '{}', $5)`,
      [WIN, takenId.split("/")[0], JSON.stringify({ at, extent: EXT }), box(at, EXT), takenId]);
    await c.query(
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
       VALUES ('e0000000-0000-4000-8000-000000000001', $1, 'sited', $2, 'hh:taken', 'as it stood', $3, $4::box, 'standing', $5, '{}')`,
      [takenId, takenId.split("/")[0], JSON.stringify({ at, extent: EXT }), box(at, EXT), WIN]);
    // At S1's town sha a stamp stands behind the taken mark; at S2's, the stamp has gone (only the new well is staked).
    await c.query(`INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k) VALUES ($1, $2, 'sable', 'hh:rabbit', 'hh:rabbit', 1, 1)`, [TOWN_SHA, takenId]);
    await c.query(`INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k) VALUES ($1, $2, 'sable', 'hh:rabbit', 'hh:rabbit', 1, 1)`, [TOWN_SHA2, NEW]);
    // THE CUTOVER: the registry, seeded from the world's own file at main, before the first new clearing
    const paths = new Set(git(WORLD, "ls-tree", "-r", "--name-only", LAW_SHA, "--", "WORLD/marks").split("\n").filter(Boolean));
    const seeded = await seedPublications((t, a) => c.query(t, a), seedRowsOf(JSON.stringify(FILE), (p) => paths.has(p)));
    assert.equal(seeded.status, "seeded");
  });
  // S1: window WIN seals; it is the last printout, which is the pinned world's main
  let r = clear(WIN);
  assert.equal(r.code, 0, r.out);
  await owner(async (c) => {
    await c.query("UPDATE world_snapshots SET printout_sha = $1, printed_at = now() WHERE window_id = $2", [LAW_SHA, WIN]);
    await c.query("UPDATE projection_heads SET sha = $1 WHERE repo = 'town'", [TOWN_SHA2]);   // the town moves on
  });
  // S2: a new mark is put forward and locks; the taken mark has no stamp behind it, and the settlement takes it
  await owner((c) => c.query(
    `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
     VALUES ($1, 'sited', 'sable', 'hh:rabbit', 'pending', 'A well, new this window.', $2, $3::box, 1, $4, $5)`,
    [WIN + 1, JSON.stringify({ slug: NEW, at: { x: -91000, y: -91000 }, extent: EXT }), box({ x: -91000, y: -91000 }, EXT),
      JSON.stringify({ by: "sable", date: "2026-11-02" }), NEW]));
  r = clear(WIN + 1);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`${takenId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} a commons mark with no stamps behind it`));
  [S1, S2] = await read("SELECT window_id, sealed_settlement, digest FROM world_snapshots ORDER BY window_id");
  assert.equal(S2.sealed_settlement, S1.sealed_settlement + 1);
});

test("1 · PRINT: the sealed delta and nothing else — the new mark at its filing, the taken file and its seat gone, the registry as sealed, the fold, one commit", { skip, timeout: 240000 }, async () => {
  const [takenId, takenRow] = TAKEN;
  const out = await asClearing((q) => printSettlement(q, { world: WORLD, window: WIN + 1 }));
  assert.equal(out.status, "printed", JSON.stringify(out).slice(0, 600));
  assert.equal(out.settlement, S2.sealed_settlement);
  assert.deepEqual(out.written.map((w) => w.id), [NEW]);
  assert.deepEqual(out.removed.map((g) => g.slug), [takenId]);
  assert.equal(out.removed[0].path, takenRow.path);

  const head = git(WORLD, "rev-parse", "HEAD").trim();
  assert.equal(out.commit, head);
  assert.match(git(WORLD, "log", "-1", "--format=%s"), new RegExp(`^settlement: S${S2.sealed_settlement} printout — 1 written, 1 removed`), "the subject the printout's readers know");
  const touched = git(WORLD, "diff", "--name-only", `${LAW_SHA}..HEAD`).split("\n").filter(Boolean).sort();
  const newPath = out.written[0].path;
  assert.ok(touched.includes(newPath) && touched.includes(takenRow.path) && touched.includes("WORLD/settlement-publications.json"), touched.join(", "));
  assert.ok(touched.every((p) => p === newPath || p === takenRow.path || p === "WORLD/settlement-publications.json" || p.startsWith(dirname(takenRow.path))
    || ["WORLD/world-state.json", "WORLD/INDEX.md", "WORLD/region-outsiders.json", "WORLD/region-outsiders.md", "WORLD/containment.json"].includes(p)),
    `the delta and the derived files only, no field-order rewrites: ${touched.join(", ")}`);

  const [row] = await read("SELECT slug, kind, owner, body, geometry, data FROM marks WHERE slug = $1", [NEW]);
  assert.equal(readFileSync(join(WORLD, newPath), "utf8"), renderRecord(row), "the bytes are the one serializer's, from the sealed row");
  assert.equal(newPath, `WORLD/marks/${NEW}/mark.md`, "a new mark files at its identity (Gate B)");
  assert.ok(!existsSync(join(WORLD, takenRow.path)), "the taken mark's file is gone");

  const after = JSON.parse(readFileSync(join(WORLD, "WORLD/settlement-publications.json"), "utf8")).published;
  const keys = Object.keys(after);
  assert.ok(!(takenId in after), "its registry row goes with it");
  assert.equal(keys.at(-1), NEW, "the new publication joins at the end, as the sweep's object did");
  assert.deepEqual(after[NEW].path, newPath);
  for (const [id, r] of Object.entries(FILE.published)) if (id !== takenId) assert.deepEqual(after[id], r, `${id}: kept byte for byte`);
  assert.deepEqual(keys.filter((k) => k !== NEW), Object.keys(FILE.published).filter((k) => k !== takenId), "and in the file's own order");
});

test("1b · a RETRY before the record finds its printout already on main: the same commit, nothing printed twice under one number", { skip }, async () => {
  const head = git(WORLD, "rev-parse", "HEAD").trim();
  const again = await asClearing((q) => printSettlement(q, { world: WORLD, window: WIN + 1 }));
  assert.deepEqual([again.status, again.settlement, again.commit], ["already-on-main", S2.sealed_settlement, head]);
  assert.equal(git(WORLD, "rev-parse", "HEAD").trim(), head, "no second (empty) printout for the same settlement");
});

test("2 · TAG: settlement/S<n> at the printout, naming the digest; again is a no-op; a tag standing anywhere else is refused, never moved", { skip }, async () => {
  const head = git(WORLD, "rev-parse", "HEAD").trim();
  const tag = await asClearing((q) => tagSettlement(q, { world: WORLD, window: WIN + 1, commit: head }));
  assert.equal(tag.status, "tagged");
  assert.equal(tag.tag, `settlement/S${S2.sealed_settlement}`);
  assert.equal(git(WORLD, "cat-file", "-t", tag.tag).trim(), "tag", "annotated");
  assert.equal(git(WORLD, "rev-parse", `${tag.tag}^{commit}`).trim(), head);
  const msg = git(WORLD, "for-each-ref", `refs/tags/${tag.tag}`, "--format=%(contents)");
  assert.equal(digestOfTagMessage(msg), S2.digest);
  assert.match(msg, new RegExp(`\\bTown ${TOWN_SHA2}\\b`), "the town line snapshot-backfill reads: S2's own town sha");
  const again = await asClearing((q) => tagSettlement(q, { world: WORLD, window: WIN + 1, commit: head }));
  assert.equal(again.status, "already-tagged");
  await assert.rejects(asClearing((q) => tagSettlement(q, { world: WORLD, window: WIN + 1, commit: LAW_SHA })), (e) => e.reason === "tag-conflict");
  assert.equal(git(WORLD, "rev-parse", `${tag.tag}^{commit}`).trim(), head, "and it did not move");
});

test("3 · RECORD: once, the world-marks head only for the highest printed; a different sha refused; an older settlement printed late refused before it renders", { skip }, async () => {
  const head = git(WORLD, "rev-parse", "HEAD").trim();
  const rec = await asClearing((q) => recordPrintout(q, { window: WIN + 1, commit: head }));
  assert.deepEqual([rec.settlement, rec.commit, rec.head_advanced], [S2.sealed_settlement, head, true]);
  assert.equal((await read("SELECT sha FROM projection_heads WHERE repo = 'world-marks'"))[0].sha, head, "the head the class layer and the next seal read");
  const again = await asClearing((q) => recordPrintout(q, { window: WIN + 1, commit: head }));
  assert.equal(again.head_advanced, true, "a re-run is the same record");
  await assert.rejects(asClearing((q) => recordPrintout(q, { window: WIN + 1, commit: LAW_SHA })), /already printed at/);
  // S1 recorded late: kept, but it never moves the head back
  await owner((c) => c.query("UPDATE world_snapshots SET printout_sha = NULL WHERE window_id = $1", [WIN]));
  const late = await asClearing((q) => recordPrintout(q, { window: WIN, commit: LAW_SHA }));
  assert.equal(late.head_advanced, false);
  assert.equal((await read("SELECT sha FROM projection_heads WHERE repo = 'world-marks'"))[0].sha, head);
  // and printing S1 now is a stale replay
  await owner((c) => c.query("UPDATE world_snapshots SET printout_sha = NULL WHERE window_id = $1", [WIN]));
  await assert.rejects(asClearing((q) => printSettlement(q, { world: WORLD, window: WIN })), (e) => e.reason === "stale-replay");
  const printed = await asClearing((q) => printSettlement(q, { world: WORLD, window: WIN + 1 }));
  assert.equal(printed.status, "already-printed", "a recorded printout is not printed twice");
});

test("4 · EVERY SETTLEMENT IS PRINTED: one that changed nothing is an EMPTY printout commit for its tag to stand on; dry, it says quiet and writes nothing", { skip, timeout: 240000 }, async () => {
  // The clearing of WIN+1 opened WIN+2; it clears with nothing claimed, and its seal changes nothing on main.
  const r = clear(WIN + 2);
  assert.equal(r.code, 0, r.out);
  const [S3] = await read("SELECT sealed_settlement FROM world_snapshots WHERE window_id = $1", [WIN + 2]);
  assert.equal(S3.sealed_settlement, S2.sealed_settlement + 1, "every seal is numbered, a quiet one too");
  const head = git(WORLD, "rev-parse", "HEAD").trim();
  const dry = await asClearing((q) => printSettlement(q, { world: WORLD, window: WIN + 2, dryRun: true }));
  assert.deepEqual([dry.status, dry.quiet], ["dry", true]);
  assert.equal(git(WORLD, "status", "--porcelain", "--", "WORLD").trim(), "", "and it wrote nothing");
  const out = await asClearing((q) => printSettlement(q, { world: WORLD, window: WIN + 2 }));
  assert.equal(out.status, "quiet");
  assert.equal(git(WORLD, "rev-parse", "HEAD^").trim(), head, "one commit on main");
  assert.equal(out.commit, git(WORLD, "rev-parse", "HEAD").trim());
  assert.equal(git(WORLD, "diff", "--name-only", head, "HEAD").trim(), "", "and it is empty");
  assert.match(git(WORLD, "log", "-1", "--format=%s").trim(), new RegExp(`^settlement: S${S3.sealed_settlement} printout — 0 written, 0 removed, 0 re-framed$`));
  const tag = await asClearing((q) => tagSettlement(q, { world: WORLD, window: WIN + 2, commit: out.commit }));
  assert.equal(tag.status, "tagged", "its own tag on its own commit, never a second number on another settlement's");
});

test("deltaOf is the sealed difference and nothing else (PURE)", () => {
  assert.deepEqual(deltaOf([{ slug: "a", digest: "1" }, { slug: "b", digest: "2" }, { slug: "c", digest: "3" }], [{ slug: "a", digest: "1" }, { slug: "b", digest: "9" }, { slug: "d", digest: "4" }]),
    { changed: ["b", "d"], removed: ["c"] });
});
