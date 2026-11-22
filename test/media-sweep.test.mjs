// media-sweep.test.mjs — POS-737: a file nothing hangs is freed after a 30-day
// grace; the sweep is dry by default and fails closed; an operator can take a
// file down at once. Storage is a stub in every test: nothing here deletes a
// real object, and nothing here needs a bucket.
//
//   node --test test/media-sweep.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { tempDir } from "./helpers/temp-dir.mjs";
import { join, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.MEDIA_QUOTA_BYTES = String(10 * 1024 * 1024);

const media = await import("../src/media.mjs");
const sweep = await import("../src/media-sweep.mjs");
const { MEDIA_BASE, ensureMediaTable, mediaHeldRefusal, mediaQuota, mediaLedgerRows, uploadMedia, mediaUrlFor, useMediaLedger } = media;
const { keysIn, planSweep, gitKeys, referenceSet, runSweep, takedown, rowKey, DAY_MS, GRACE_MS, MEDIA_URL_ERE,
  deleteOwnUpload, sweepClonesFrom, HOUSEHOLD_DELETE_REASON } = sweep;

const NOW = Date.UTC(2026, 10, 30);
const sha = (c) => c.repeat(64);
const url = (household, s, ext = "png", size = null) => `${MEDIA_BASE}/media/${household}/${s}${size ? `-${size}` : ""}.${ext}`;
const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// ── fixtures: a ledger, a world and a town ──────────────────────────────────

function ledger(rows) {
  const db = new DatabaseSync(":memory:");
  ensureMediaTable(db);
  for (const r of rows)
    db.prepare("INSERT INTO media (household, sha, ext, bytes, by_handle, created, unreferenced_since) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(r.household, r.sha, r.ext ?? "png", r.bytes ?? 1000, r.by ?? "someone", r.created ?? NOW - 90 * DAY_MS, r.since ?? null);
  return db;
}
const row = (db, household, s) => db.prepare("SELECT * FROM media WHERE household = ? AND sha = ?").get(household, s);

function repo(files, { branches = {} } = {}) {
  const dir = tempDir("media-sweep-repo-");
  dirs.push(dir);
  const git = (...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdio: ["ignore", "pipe", "pipe"] });
  const write = (fs) => { for (const [p, body] of Object.entries(fs)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); } };
  git("init", "-q", "-b", "main");
  write(files);
  git("add", "-A"); git("commit", "-q", "-m", "main");
  for (const [name, fs] of Object.entries(branches)) {
    git("checkout", "-q", "-b", name); write(fs); git("add", "-A"); git("commit", "-q", "-m", name); git("checkout", "-q", "main");
  }
  return dir;
}

// The town: four files. HUNG_MARK hangs on a published mark, HUNG_DRAFT only on
// a draft branch, HUNG_FACE on a profile, OLD only in the world's history.
const HUNG_MARK = url("alta", sha("a")), HUNG_DRAFT = url("bree", sha("b")), HUNG_FACE = url("cole", sha("c"));
const OLD = url("dane", sha("d")), LOOSE = url("eve", sha("e"), "jpg");
const world = () => repo({
  "WORLD/marks/alta/mooring/mark.md": `---\nimage: ${HUNG_MARK}\n---\nA mooring.`,
  "STATE/log/0001.meta.json": JSON.stringify({ image: OLD }),
}, { branches: { "draft/bree": { "WORLD/marks/bree/shed/mark.md": `---\nimage: ${HUNG_DRAFT}\n---\n` } } });
const town = () => repo({ "WHITE_PAGES/cole/PROFILE.md": `---\navatar_url: ${url("cole", sha("c"), "png", 96)}\n---\n` });
const FIVE = () => ledger([
  { household: "alta", sha: sha("a") }, { household: "bree", sha: sha("b") }, { household: "cole", sha: sha("c") },
  { household: "dane", sha: sha("d") }, { household: "eve", sha: sha("e"), ext: "jpg", bytes: 5000 },
]);
const stubDel = () => { const keys = []; return { keys, del: async (k) => { keys.push(k); } }; };

// ── the pieces ──────────────────────────────────────────────────────────────

test("keysIn: a copy's URL names its original's row; prose, other hosts and the old /m/ path name none", () => {
  const text = `see ${url("a", sha("1"))}. and ${url("a", sha("1"), "png", 256)}, ${url("b", sha("2"), "jpg")}) and `
    + `${MEDIA_BASE}/m/d849fa0eb84fc1399cb1.jpg https://evil.example/media/c/${sha("3")}.png ${url("d", sha("4"), "png", 128)}`;
  assert.deepEqual([...keysIn(text)].sort(), [`a/${sha("1")}.png`, `b/${sha("2")}.jpg`]);
  assert.ok(new RegExp(MEDIA_URL_ERE).test(HUNG_MARK));
});

test("planSweep: hung clears, first sight stamps, the grace decides due from waiting, and a claimed row owes storage", () => {
  const rows = [
    { household: "h", sha: "1", ext: "png", bytes: 1, unreferenced_since: NOW - 40 * DAY_MS },   // hung again: clear
    { household: "h", sha: "2", ext: "png", bytes: 1, unreferenced_since: null },               // unhung, first sight: stamp
    { household: "h", sha: "3", ext: "png", bytes: 1, unreferenced_since: NOW - GRACE_MS },      // exactly the grace: due
    { household: "h", sha: "4", ext: "png", bytes: 1, unreferenced_since: NOW - GRACE_MS + 1 },  // a millisecond short: waiting
    { household: "h", sha: "5", ext: "png", bytes: 1, deleted_at: NOW - DAY_MS, purged_at: null }, // claimed, not purged
    { household: "h", sha: "6", ext: "png", bytes: 1, deleted_at: NOW - DAY_MS, purged_at: NOW - DAY_MS }, // freed: done
  ];
  const p = planSweep(rows, new Set(["h/1.png"]), { now: NOW });
  assert.deepEqual([p.clear, p.stamp, p.due, p.waiting, p.unpurged].map((l) => l.map((r) => r.sha)), [["1"], ["2"], ["3"], ["4"], ["5"]]);
  assert.deepEqual([p.live, p.hung], [4, 1]);
});

test("the world source reads the blessing and main but never STATE/log; drafts are their own source; the town reads its whole tree", async () => {
  const w = world(), t = town();
  assert.deepEqual([...gitKeys(w, ["refs/heads/main"], { exclude: sweep.WORLD_HISTORY })], [rowKey({ household: "alta", sha: sha("a"), ext: "png" })]);
  assert.equal(gitKeys(w, ["refs/heads/main"]).has(`dane/${sha("d")}.png`), true, "precondition: the history does name OLD");
  const r = await referenceSet({ worldClone: w, townClone: t, pool: null, storeSources: [], officeFiles: [] });
  assert.equal(r.ok, true, JSON.stringify(r.sources));
  assert.deepEqual([...r.keys].sort(), [`alta/${sha("a")}.png`, `bree/${sha("b")}.png`, `cole/${sha("c")}.png`]);
  // a draft branch carries main's marks beside its own: alta's and bree's
  assert.deepEqual(r.sources.map((s) => [s.name, s.found]), [["world", 1], ["drafts", 2], ["town", 1]]);
});

test("an extra clone the operator names keeps every file any of its branches names, and an unreadable one refuses", async () => {
  const extra = repo({ "README.md": "nothing yet" }, { branches: { "work/one": { "a.md": `picture: ${LOOSE}` } } });
  const r = await referenceSet({ worldClone: world(), townClone: town(), pool: null, storeSources: [], extraClones: [extra] });
  assert.equal(r.ok, true, JSON.stringify(r.sources));
  assert.ok(r.keys.has(`eve/${sha("e")}.jpg`), "a picture named only on an unpublished branch is kept");
  const db = FIVE();
  await runSweep({ odb: db, worldClone: world(), townClone: town(), storeSources: [], extraClones: [extra], now: NOW });
  assert.equal(row(db, "eve", sha("e")).unreferenced_since, null, "so its clock never starts");
  const bad = await referenceSet({ worldClone: world(), townClone: town(), pool: null, storeSources: [], extraClones: [join(tmpdir(), "no-such-extra-xyz")] });
  assert.equal(bad.ok, false);
});

test("FAIL CLOSED: a source that cannot be read, a store with no pool, and a world with no pictures at all each make the set untrustworthy", async () => {
  const t = town();
  const missing = await referenceSet({ worldClone: join(tmpdir(), "no-such-world-xyz"), townClone: t, pool: null, storeSources: [] });
  assert.equal(missing.ok, false);
  assert.match(missing.sources.find((s) => s.name === "world").error, /./);
  const noPool = await referenceSet({ worldClone: world(), townClone: t, pool: null });
  assert.equal(noPool.ok, false, "the store's tables are sources; with no store they cannot be read");
  assert.match(noPool.sources.find((s) => s.name === "store:posts").error, /not configured/);
  const empty = await referenceSet({ worldClone: repo({ "WORLD/marks/x/mark.md": "no picture" }), townClone: t, pool: null, storeSources: [] });
  assert.equal(empty.ok, false);
  assert.match(empty.sources.find((s) => s.name === "world").error, /found no picture at all/);
});

// ── the sweep ───────────────────────────────────────────────────────────────

test("DRY (the default): the clock is kept, what would be freed is named, and nothing is claimed or deleted", async () => {
  const db = FIVE(), w = world(), t = town(), { keys, del } = stubDel();
  const first = await runSweep({ odb: db, worldClone: w, townClone: t, storeSources: [], now: NOW, del });
  assert.equal(first.mode, "dry");
  assert.deepEqual(first.clock, { cleared: 0, stamped: 2, waiting: 0 }, "dane and eve: first sight");
  assert.equal(first.would_free.files, 0, "first sight is never due");
  assert.equal(row(db, "dane", sha("d")).unreferenced_since, NOW);

  const later = await runSweep({ odb: db, worldClone: w, townClone: t, storeSources: [], now: NOW + GRACE_MS, del });
  assert.deepEqual(later.would_free.rows.map((r) => r.url).sort(), [OLD, LOOSE]);
  assert.equal(later.would_free.bytes, 6000);
  assert.deepEqual(keys, [], "a dry run never reaches storage");
  assert.equal(row(db, "dane", sha("d")).deleted_at, null, "and claims nothing");
  assert.equal((await mediaQuota(db, "eve")).used, 5000, "the wall is untouched");
});

test("APPLY: a file unhung for 30 days is claimed, its original and copies deleted, purged; it leaves the wall and stops being held", async () => {
  const db = FIVE(), w = world(), t = town(), { keys, del } = stubDel();
  await runSweep({ odb: db, worldClone: w, townClone: t, storeSources: [], now: NOW, del });
  const r = await runSweep({ odb: db, worldClone: w, townClone: t, storeSources: [], now: NOW + GRACE_MS, apply: true, del });
  assert.equal(r.freed.files, 2);
  assert.deepEqual(keys.sort(), [
    `media/dane/${sha("d")}-256.png`, `media/dane/${sha("d")}-96.png`, `media/dane/${sha("d")}.png`,
    `media/eve/${sha("e")}-256.jpg`, `media/eve/${sha("e")}-96.jpg`, `media/eve/${sha("e")}.jpg`,
  ]);
  const eve = row(db, "eve", sha("e"));
  assert.deepEqual([eve.deleted_cause, eve.deleted_by, eve.deleted_at, eve.purged_at], ["sweep", "media-sweep", NOW + GRACE_MS, NOW + GRACE_MS]);
  assert.match(eve.deleted_reason, /hung nowhere for 30 days/);
  assert.equal((await mediaQuota(db, "eve")).used, 0, "its bytes gave the wall back");
  assert.deepEqual(await mediaLedgerRows(db, "eve"), [], "and the household's media read no longer lists it");
  const held = await mediaHeldRefusal(LOOSE, { odb: db });
  assert.deepEqual([held.code, held.defect], [422, "the town no longer holds that file"]);
  assert.match(held.hint, /hung nowhere for 30 days and was freed — upload it first/);
  for (const k of ["alta", "bree", "cole"]) assert.equal(row(db, k, sha(k[0])).deleted_at, null, `${k}'s hung file is kept`);
});

test("A HANG RESETS THE GRACE: a door that hangs the file clears its clock, so the claim misses it", async () => {
  const db = ledger([{ household: "eve", sha: sha("e"), ext: "jpg", since: NOW - 60 * DAY_MS }]);
  assert.equal(await mediaHeldRefusal(LOOSE, { odb: db }), null, "a door hangs it (and touches the clock)");
  assert.equal(row(db, "eve", sha("e")).unreferenced_since, null);
  const { keys, del } = stubDel();
  const r = await runSweep({ odb: db, worldClone: world(), townClone: town(), storeSources: [], now: NOW, apply: true, del });
  assert.equal(r.freed.files, 0);
  assert.deepEqual(keys, []);
  assert.equal(row(db, "eve", sha("e")).unreferenced_since, NOW, "the sources still do not name it, so its clock starts again from today");
});

test("storage that refuses leaves the row claimed and unpurged, named, and the next run retries it", async () => {
  const db = ledger([{ household: "eve", sha: sha("e"), ext: "jpg", since: NOW - GRACE_MS }]);
  const r = await runSweep({ odb: db, worldClone: world(), townClone: town(), storeSources: [], now: NOW, apply: true,
    del: async () => { throw new Error("storage answered 503"); } });
  assert.equal(r.storage_failed.length, 1);
  assert.match(r.storage_failed[0].error, /503/);
  assert.equal(row(db, "eve", sha("e")).purged_at, null);
  assert.notEqual(row(db, "eve", sha("e")).deleted_at, null, "claimed: it no longer counts against the wall");
  const { keys, del } = stubDel();
  const again = await runSweep({ odb: db, worldClone: world(), townClone: town(), storeSources: [], now: NOW + DAY_MS, apply: true, del });
  assert.equal(again.unpurged.length, 1);
  assert.equal(again.freed.rows[0].retried, true);
  assert.equal(keys.length, 3);
  assert.equal(row(db, "eve", sha("e")).purged_at, NOW + DAY_MS);
});

test("a run that finds more files due than its limit frees NONE and says why", async () => {
  const db = ledger([1, 2, 3].map((n) => ({ household: "eve", sha: sha(String(n)), since: NOW - GRACE_MS })));
  const { keys, del } = stubDel();
  const r = await runSweep({ odb: db, worldClone: world(), townClone: town(), storeSources: [], now: NOW, apply: true, maxDelete: 2, del });
  assert.match(r.refused, /3 files are due, more than this run's limit of 2/);
  assert.deepEqual(keys, []);
  assert.equal(db.prepare("SELECT count(*) AS n FROM media WHERE deleted_at IS NOT NULL").get().n, 0);
});

test("a source that cannot be read refuses the whole run: no clock is written, nothing is claimed", async () => {
  const db = FIVE(), { keys, del } = stubDel();
  const r = await runSweep({ odb: db, worldClone: world(), townClone: join(tmpdir(), "no-such-town-xyz"), storeSources: [], now: NOW, apply: true, del });
  assert.match(r.refused, /a source could not be read \(town\)/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM media WHERE unreferenced_since IS NOT NULL").get().n, 0);
  assert.deepEqual(keys, []);
});

// ── the door after a sweep ──────────────────────────────────────────────────

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const KEY = (household, handle) => ({ household, handles: new Set([handle]) });
const put = async () => {};

test("a freed file uploaded again lives again; not while the sweep is between its claim and storage's answer", async () => {
  const db = new DatabaseSync(":memory:");
  const first = await uploadMedia({}, KEY("eve", "eve"), db, { put, bytes: PNG });
  const s = first.sha;
  db.prepare("UPDATE media SET unreferenced_since = ? WHERE sha = ?").run(NOW - GRACE_MS, s);
  db.prepare("UPDATE media SET deleted_at = ?, deleted_cause = 'sweep' WHERE sha = ?").run(NOW, s); // claimed, storage not yet answered
  await assert.rejects(uploadMedia({}, KEY("eve", "eve"), db, { put, bytes: PNG }),
    (e) => e.code === 409 && e.defect === "the town is freeing this exact file right now");
  db.prepare("UPDATE media SET purged_at = ? WHERE sha = ?").run(NOW, s);
  const puts = [];
  const back = await uploadMedia({}, KEY("eve", "eve"), db, { put: async (k) => { puts.push(k); }, bytes: PNG });
  assert.equal(back.url, first.url, "the same bytes, the same URL");
  assert.notEqual(back.already, true, "a fresh upload, not the dedupe answer");
  assert.ok(puts.includes(`media/eve/${s}.png`), "the bytes were put again");
  const r = row(db, "eve", s);
  assert.deepEqual([r.deleted_at, r.deleted_cause, r.purged_at, r.unreferenced_since], [null, null, null, null], "every state cleared");
  assert.equal(await mediaHeldRefusal(back.url, { odb: db }), null, "and it hangs again");
});

// ── the takedown ────────────────────────────────────────────────────────────

test("TAKEDOWN: dry by default; with --apply the file goes at once, hung or not, with a receipt, and stays down in every household", async () => {
  const db = new DatabaseSync(":memory:");
  const up = await uploadMedia({}, KEY("eve", "eve"), db, { put, bytes: PNG });
  assert.match((await takedown({ odb: db, url: up.url, by: "wright" })).refused, /names its reason/);
  assert.match((await takedown({ odb: db, url: up.url, reason: "x" })).refused, /names the operator/);
  assert.match((await takedown({ odb: db, url: `${MEDIA_BASE}/m/abc.png`, reason: "x", by: "wright" })).refused, /not an address the media door mints/);
  const { keys, del } = stubDel();
  const dry = await takedown({ odb: db, url: up.url, reason: "a stranger's face", by: "wright", now: NOW, del });
  assert.equal(dry.dry, true);
  assert.deepEqual(keys, [], "the dry answer touches nothing");
  assert.equal(row(db, "eve", up.sha).deleted_at, null);

  const done = await takedown({ odb: db, url: up.url, reason: "a stranger's face", by: "wright", now: NOW, apply: true, del });
  assert.deepEqual([done.taken_down, done.purged], [true, true]);
  assert.deepEqual(done.receipt, { url: up.url, household: "eve", bytes: PNG.length, uploaded_by: "eve",
    objects: [`media/eve/${up.sha}.png`, `media/eve/${up.sha}-96.png`, `media/eve/${up.sha}-256.png`],
    reason: "a stranger's face", by: "wright", at: new Date(NOW).toISOString() });
  assert.equal(keys.length, 3);
  const r = row(db, "eve", up.sha);
  assert.deepEqual([r.deleted_cause, r.deleted_by, r.deleted_reason, r.purged_at], ["takedown", "wright", "a stranger's face", NOW]);
  const held = await mediaHeldRefusal(up.url, { odb: db });
  assert.equal(held.defect, "the town took that file down");
  for (const k of [KEY("eve", "eve"), KEY("frank", "frank")])
    await assert.rejects(uploadMedia({}, k, db, { put, bytes: PNG }),
      (e) => e.code === 403 && e.defect === "the town took this file down", `${k.household} cannot bring it back`);
  assert.equal((await takedown({ odb: db, url: up.url, reason: "again", by: "wright", apply: true, del })).already, true);
});

// ── coverage: every door that hangs a URL has a source that sees it ─────────

test("every office door that hangs a media URL is named, and so is the source the sweep reads it back from", async () => {
  const { readdirSync } = await import("node:fs");
  const src = new URL("../src/", import.meta.url);
  const callers = readdirSync(src).filter((f) => f.endsWith(".mjs") && f !== "media.mjs" && f !== "media-sweep.mjs")
    .filter((f) => /\b(mediaHeldRefusal|assertMediaHeld)\(/.test(readFileSync(new URL(f, src), "utf8"))).sort();
  assert.deepEqual(callers, Object.keys(sweep.HANGING_DOORS).sort(), "a new hanging door names its sweep source in HANGING_DOORS");
  const names = new Set(["world", "drafts", "town", ...sweep.STORE_SOURCES.map((s) => `store:${s.table}`)]);
  for (const [file, { sources }] of Object.entries(sweep.HANGING_DOORS))
    for (const s of sources) assert.ok(names.has(s), `${file} names ${s}, which is not a source the sweep reads`);
});

// ── the household's own delete (POS-737/c) ──────────────────────────────────
//
// LAW (Darko, 2026-11-21 21:18 EST, POS-737/c, "Yes, both"): "give a household a
// delete for its own pictures that nothing uses, with a receipt. Deletion is
// permanent; a picture still in use can't be deleted." Wright's return (02:21Z):
// "using the sweep's own reference check. It's refused while anything still uses
// the picture, and it leaves a receipt. The bytes leave the household's 200 MB
// wall at once."

/** The sweep's own sources over this file's fixture town; the store is left out (no pool here). */
const srcs = (over = {}) => ({ worldClone: world(), townClone: town(), pool: null, storeSources: [], officeFiles: [], ...over });
const own = (db, household, url, over = {}) => deleteOwnUpload({ odb: db, household, by: household, url, ...srcs(), now: NOW, log: () => {}, ...over });
const live = (db, household, s) => { const r = row(db, household, s); return [r.deleted_at, r.purged_at]; };

test("POS-737/c: an own upload nothing uses is deleted AT ONCE, no grace: claimed, original and copies deleted, purged, its bytes off the wall once, with a receipt", async () => {
  const db = new DatabaseSync(":memory:");
  const up = await uploadMedia({}, KEY("eve", "eve"), db, { put, bytes: PNG });
  assert.equal(row(db, "eve", up.sha).unreferenced_since, null, "precondition: no clock runs, so the sweep would wait 30 days");
  assert.equal((await mediaQuota(db, "eve")).used, PNG.length);
  const { keys, del } = stubDel();
  const r = await own(db, "eve", up.url, { del });
  assert.equal(r.refused, undefined, JSON.stringify(r.refused));
  assert.deepEqual([r.deleted, r.purged, r.freed_bytes], [true, true, PNG.length]);
  assert.deepEqual(keys, [`media/eve/${up.sha}.png`, `media/eve/${up.sha}-96.png`, `media/eve/${up.sha}-256.png`], "the original first, then its copies");
  const after = row(db, "eve", up.sha);
  assert.deepEqual([after.deleted_cause, after.deleted_by, after.deleted_reason, after.deleted_at, after.purged_at],
    ["household", "eve", HOUSEHOLD_DELETE_REASON, NOW, NOW]);
  assert.deepEqual(r.receipt, { url: up.url, household: "eve", bytes: PNG.length, uploaded_by: "eve", cause: "household", deleted_by: "eve",
    objects: keys, at: new Date(NOW).toISOString() });
  assert.equal((await mediaQuota(db, "eve")).used, 0, "LAW: \"The bytes leave the household's 200 MB wall at once.\"");
  assert.deepEqual(await mediaLedgerRows(db, "eve"), [], "and the household's media read no longer lists it");
  const held = await mediaHeldRefusal(up.url, { odb: db });
  assert.deepEqual([held.code, held.defect], [422, "the town no longer holds that file"]);
  assert.match(held.hint, /^its household deleted it — upload it first/, "a door that would hang it is told why, and not the sweep's 30 days");

  // ONCE: the same ask again frees nothing more and touches no storage
  const again = await own(db, "eve", up.url, { del });
  assert.deepEqual([again.already, again.freed_bytes, again.receipt.cause], [true, 0, "household"]);
  assert.equal(keys.length, 3, "no second DELETE");
  assert.equal((await mediaQuota(db, "eve")).used, 0);
});

test("POS-737/c: IN USE is refused, on every source the sweep reads: a published mark, a draft only (the media read's blind spot), the town; nothing deleted, nothing freed", async () => {
  // LAW: "a picture still in use can't be deleted."
  for (const [household, s, file, where] of [
    ["alta", sha("a"), HUNG_MARK, ["world", "drafts"]], // a draft branch carries main's marks beside its own
    ["bree", sha("b"), HUNG_DRAFT, ["drafts"]],
    ["cole", sha("c"), HUNG_FACE, ["town"]],             // hung by its -96 copy's URL, which names the original
  ]) {
    const db = FIVE(), { keys, del } = stubDel();
    const r = await own(db, household, file, { del });
    assert.deepEqual([r.refused?.code, r.refused?.defect], [409, "that file is still in use"], `${household}: ${JSON.stringify(r)}`);
    assert.deepEqual(r.refused.in_use, where, `${household}: it names where`);
    assert.deepEqual(keys, [], `${household}: storage untouched`);
    assert.deepEqual(live(db, household, s), [null, null], `${household}: not claimed`);
    assert.equal(row(db, household, s).unreferenced_since, null, `${household}: and no clock left running on a hung file`);
    assert.equal((await mediaQuota(db, household)).used, 1000, `${household}: the wall is untouched`);
  }
});

test("POS-737/c: another household's file, a small copy's URL, an address the door never mints and a file the household never held are refused; nothing is touched", async () => {
  const db = FIVE(), { keys, del } = stubDel();
  // dane's OLD hangs nowhere current: only the OWNER rule stands between eve and deleting it
  const foreign = await own(db, "eve", OLD, { del });
  assert.deepEqual([foreign.refused?.code, foreign.refused?.defect], [403, "that file is another household's"]);
  assert.deepEqual(live(db, "dane", sha("d")), [null, null]);
  assert.match((await own(db, "eve", url("eve", sha("e"), "jpg", 256), { del })).refused.defect, /small copy, not an upload/);
  assert.equal((await own(db, "eve", `${MEDIA_BASE}/m/abc.png`, { del })).refused.code, 422);
  assert.deepEqual([(await own(db, "eve", url("eve", sha("f"), "jpg"), { del })).refused.code], [404]);
  assert.deepEqual(keys, []);
  assert.equal(db.prepare("SELECT count(*) AS n FROM media WHERE deleted_at IS NOT NULL OR unreferenced_since IS NOT NULL").get().n, 0);
});

test("POS-737/c: FAIL CLOSED — a source that cannot be read refuses, names it, and takes back only its own clock", async () => {
  const db = ledger([{ household: "eve", sha: sha("e"), ext: "jpg" }, { household: "dane", sha: sha("d"), since: NOW - 5 * DAY_MS }]);
  const { keys, del } = stubDel();
  const missing = join(tmpdir(), "no-such-town-xyz");
  for (const [h, file, clock] of [["eve", LOOSE, null], ["dane", OLD, NOW - 5 * DAY_MS]]) {
    const r = await own(db, h, file, { del, townClone: missing });
    assert.deepEqual([r.refused?.code, r.refused?.unread], [503, ["town"]], JSON.stringify(r));
    assert.match(r.refused.hint, /"could not look" is never "not used"/);
    assert.deepEqual(live(db, h, h === "eve" ? sha("e") : sha("d")), [null, null]);
    assert.equal(row(db, h, h === "eve" ? sha("e") : sha("d")).unreferenced_since, clock, `${h}: the clock is as it was`);
  }
  // no store at all is a source that cannot be read, too
  const noPool = await own(db, "eve", LOOSE, { del, storeSources: undefined });
  assert.equal(noPool.refused?.code, 503);
  assert.ok(noPool.refused.unread.includes("store:posts"));
  assert.deepEqual(keys, []);
});

test("POS-737/c: STORAGE that refuses leaves the file claimed and off the wall (once); the same ask finishes it; a re-upload waits for that, then lives again", async () => {
  const db = new DatabaseSync(":memory:");
  const up = await uploadMedia({}, KEY("eve", "eve"), db, { put, bytes: PNG });
  const failed = await own(db, "eve", up.url, { del: async () => { throw new Error("storage answered 503 to DELETE x"); } });
  assert.deepEqual([failed.deleted, failed.purged, failed.freed_bytes], [true, false, PNG.length]);
  assert.match(failed.storage_failed, /503/);
  assert.equal((await mediaQuota(db, "eve")).used, 0, "its bytes left the wall at the claim");
  await assert.rejects(uploadMedia({}, KEY("eve", "eve"), db, { put, bytes: PNG }),
    (e) => e.code === 409 && /your household deleted it and storage has not confirmed yet/.test(e.hint));
  const { keys, del } = stubDel();
  const done = await own(db, "eve", up.url, { del, now: NOW + 1 });
  assert.deepEqual([done.deleted, done.purged, done.retried, done.freed_bytes], [true, true, true, 0], "finished, and nothing freed twice");
  assert.equal(keys.length, 3);
  assert.equal(row(db, "eve", up.sha).purged_at, NOW + 1);
  assert.equal((await mediaQuota(db, "eve")).used, 0);
  // NOT MODERATION: the same bytes come back, in this household and in any other
  const back = await uploadMedia({}, KEY("eve", "eve"), db, { put, bytes: PNG });
  assert.equal(back.url, up.url);
  assert.notEqual(back.already, true);
  assert.equal((await mediaQuota(db, "eve")).used, PNG.length);
  assert.ok((await uploadMedia({}, KEY("frank", "frank"), db, { put, bytes: PNG })).url, "no other household is refused the bytes");
});

test("POS-737/c: A HANG DURING THE CHECK keeps the file — the claim needs the clock the door stamped, and a hanging door clears it", async () => {
  const db = new DatabaseSync(":memory:");
  const up = await uploadMedia({}, KEY("eve", "eve"), db, { put, bytes: PNG });
  // A store source whose read is the moment another door hangs the file: it runs
  // the hanging doors' own check (media.mjs § mediaHeldRefusal), then answers no rows.
  let hung = 0;
  const pool = { query: async (sql) => {
    if (/pg_class/.test(sql)) return { rows: [{ rls: false, can: true, policy: false }] };
    assert.equal(await mediaHeldRefusal(up.url, { odb: db }), null, "the hanging door's check passes: the file is live");
    hung += 1;
    return { rows: [] };
  } };
  const { keys, del } = stubDel();
  const r = await own(db, "eve", up.url, { del, pool, storeSources: [{ table: "posts" }] });
  assert.equal(hung, 1, "precondition: the hang ran inside the check");
  assert.deepEqual([r.refused?.code, r.refused?.defect], [409, "that file is still in use"], JSON.stringify(r));
  assert.match(r.refused.hint, /a door hung it while the town was checking/);
  assert.deepEqual(keys, []);
  assert.deepEqual(live(db, "eve", up.sha), [null, null]);
  assert.equal((await mediaQuota(db, "eve")).used, PNG.length);
  // the control: the same check with no hang inside it frees the file
  const ok = await own(db, "eve", up.url, { del, pool: { query: async (sql) => ({ rows: /pg_class/.test(sql) ? [{ rls: false, can: true, policy: false }] : [] }) }, storeSources: [{ table: "posts" }] });
  assert.equal(ok.deleted, true, JSON.stringify(ok));
});

test("POS-737/c leaves the sweep as it was: `locate` adds `holds` only when asked, and a household's claim storage refused is retried by a sweep that applies", async () => {
  const plain = await referenceSet(srcs());
  assert.ok(plain.sources.every((s) => !("holds" in s)), "the sweep's report is unchanged");
  const located = await referenceSet({ ...srcs(), locate: `alta/${sha("a")}.png` });
  assert.deepEqual(located.sources.filter((s) => s.holds).map((s) => s.name), ["world", "drafts"]);
  assert.deepEqual([...located.keys].sort(), [...plain.keys].sort(), "and the set is the same set");

  const db = FIVE();
  await own(db, "eve", LOOSE, { del: async () => { throw new Error("storage answered 500"); } });
  const { keys, del } = stubDel();
  const r = await runSweep({ odb: db, worldClone: world(), townClone: town(), storeSources: [], now: NOW + DAY_MS, apply: true, del });
  assert.equal(r.freed.rows.find((x) => x.url === LOOSE)?.retried, true);
  assert.equal(keys.filter((k) => k.startsWith("media/eve/")).length, 3);
  assert.equal(row(db, "eve", sha("e")).deleted_cause, "household", "the sweep finishes it and keeps its cause");
});

test("POS-737/c: the sweep and the household's delete read the same clones from the office's env", () => {
  assert.deepEqual(sweepClonesFrom({ WORLD_CLONE: "/w", TOWN_CLONE: "/t", MEDIA_SWEEP_EXTRA_CLONES: " /a, ,/b " }),
    { worldClone: "/w", townClone: "/t", extraClones: ["/a", "/b"] });
  assert.deepEqual(sweepClonesFrom({}), { worldClone: null, townClone: null, extraClones: [] });
  const cli = readFileSync(new URL("../tools/media-sweep.mjs", import.meta.url), "utf8");
  assert.match(cli, /\.\.\.sweepClonesFrom\(process\.env\)/, "a text pin (the CLI runs nothing at import): the sweep's CLI takes its clones from the one reader");
});

test("WLD-83: the office's own likeness gallery is a source, so a picture it hangs is never freed", async () => {
  const { writeFileSync: wf } = await import("node:fs");
  const file = join(tempDir("gallery-src-"), "likeness-gallery.json");
  wf(file, JSON.stringify({ household: "starforge", entries: [{ handle: "rei", url: LOOSE }] }));
  const r = await referenceSet({ worldClone: world(), townClone: town(), pool: null, storeSources: [], officeFiles: [file] });
  assert.equal(r.ok, true, JSON.stringify(r.sources));
  assert.ok(r.keys.has(`eve/${sha("e")}.jpg`), "the gallery's picture is referenced");
  assert.ok(r.sources.some((s) => s.name === "office:likeness-gallery.json" && s.found === 1));
  const db = FIVE();
  await runSweep({ odb: db, worldClone: world(), townClone: town(), storeSources: [], officeFiles: [file], now: NOW });
  assert.equal(row(db, "eve", sha("e")).unreferenced_since, null, "so its clock never starts");
  const shipped = await referenceSet({ worldClone: world(), townClone: town(), pool: null, storeSources: [] });
  assert.ok(shipped.sources.some((s) => s.name === "office:likeness-gallery.json"), "the shipped gallery is read by default");
});
