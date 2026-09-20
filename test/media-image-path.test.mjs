// media-image-path.test.mjs — the lane that needs no host and no model
// (2026-09-10, the same hotfix as test/media-image-url.test.mjs). The office
// already holds a checkout of the town repo, and residents already put artwork
// in their own WHITE_PAGES folder by PR. So a resident can name the file, and
// the bytes never leave the box: it costs the resident's model a filename.
//
//   node --test test/media-image-path.test.mjs
//
// THE WHOLE GUARD IS CONTAINMENT, and the shape of every test here follows from
// one sentence: spelling is not trusted, the LANDING PLACE is. A path is refused
// if what it resolves to — after normalisation AND after every symlink is
// followed — sits outside the house of the handle the key is acting as.
//
// The fixture is a mkdtemp with its OWN git repo, deliberately: `git -C <a bare
// temp dir>` walks UP and answers about whatever repo happens to be above it, so
// a fixture without `git init` would report a sha from somewhere else entirely.
//
// Env is pinned BEFORE the dynamic import: media.mjs reads its dials at load.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.MEDIA_QUOTA_BYTES = String(4 * 1024 * 1024); // roomy: this file is about the lane, not the wall

const { uploadMedia, readHouseImage, mediaSourceOf } = await import("../src/media.mjs");
const { MAX_IMAGE } = await import("../src/edit.mjs");

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG = Buffer.from(PNG_B64, "base64");

const key = (over = {}) => ({ household: "testers", handles: new Set(["tester"]), ...over });
const odb = () => new DatabaseSync(":memory:");
const stubPut = () => { const calls = []; return { calls, put: async (...a) => { calls.push(a); } }; };
// The PUTs of ORIGINALS. Since postmark#2940 a raster upload also puts its two
// small copies (-96, -256) beside the original — held to account in
// test/media-thumbnails.test.mjs; the counts here are about the original.
const originals = (calls) => calls.filter(([k]) => !/-(?:96|256)\.[a-z]+$/.test(k));

// ── the whole point: the new lane lands exactly where the old one lands ──────

test("path ≡ base64: a file in your own house answers with the same URL, and the receipt names the town sha", async (t) => {
  const clone = townFixture(t);
  const db = odb();
  const { calls, put } = stubPut();

  const viaPath = await uploadMedia({ image_path: "WHITE_PAGES/tester/HOME/house.png" }, key(), db, { put, clone });
  assert.equal(viaPath.via, "image_path", "the receipt names which lane the bytes walked");
  assert.equal(viaPath.bytes, 70);
  assert.equal(viaPath.type, "image/png");
  assert.equal(viaPath.read_at.path, "WHITE_PAGES/tester/HOME/house.png");
  assert.match(viaPath.read_at.town_sha, /^[0-9a-f]{40}$/, "the receipt names the commit the file was read at");
  assert.equal(viaPath.read_at.town_sha, headOf(clone), "and it is THIS clone's sha, not some repo above the temp dir");

  const viaB64 = await uploadMedia({ image: PNG_B64 }, key(), db, { put });
  assert.equal(viaB64.url, viaPath.url, "content-addressed: the lane cannot change the address");
  assert.equal(viaB64.already, true);
  assert.equal(viaB64.quota.used, 70, "one charge for one file, whichever door it came through");
  assert.equal(originals(calls).length, 1, "and storage was written exactly once");
});

test("a house-relative path is read inside your own house, not the repo root", async (t) => {
  const clone = townFixture(t);
  const r = readHouseImage(clone, "tester", "HOME/house.png");
  assert.equal(r.path, "WHITE_PAGES/tester/HOME/house.png");
  assert.equal(r.bytes.length, 70);
  // and the same name at the repo root, which DOES exist in the fixture, is not
  // what a bare relative path reaches — the house is the root of this lane
  const root = readHouseImage(clone, "tester", "HOME/house.png");
  assert.equal(root.path, "WHITE_PAGES/tester/HOME/house.png");
});

// ── containment: a path may not leave your own house ────────────────────────

test("containment: .. is refused by spelling, and a symlink out is refused by where it lands", async (t) => {
  const clone = townFixture(t);
  for (const p of ["../../../etc/passwd", "WHITE_PAGES/tester/../../secret.png", "HOME/../../../secret.png"])
    assert.throws(() => readHouseImage(clone, "tester", p),
      (e) => e.code === 422 && /not a path inside your own house/.test(e.defect), p);
  assert.throws(() => readHouseImage(clone, "tester", "C:/Windows/win.ini"), (e) => e.code === 422);

  // The spelling is clean; the landing place is not. This is the test that
  // would pass on a containment check written against the STRING.
  const outside = join(clone, "OUTSIDE");
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "secret.png"), PNG);
  symlinkSync(outside, join(clone, "WHITE_PAGES", "tester", "elsewhere"), "junction");
  assert.throws(() => readHouseImage(clone, "tester", "elsewhere/secret.png"),
    (e) => e.code === 403 && /leaves your own house/.test(e.defect),
    "a junction/symlink out of the house is refused where it lands");
});

// The escape one level up from the test above, and the one the lane's own first
// cut READ rather than refused (reviewer's round, 2026-09-10): every containment
// check measures against the HOUSE, and nothing asserted the house itself was
// inside the town. Git stores a directory symlink as mode 120000 quite happily,
// and admission is Ferry-delegated with no merge gate, so the PR was the whole
// barrier between "my house" and any directory on the box.
test("containment: a house that is itself a link out of the town is not a house", async (t) => {
  const clone = townFixture(t);
  const elsewhere = mkdtempSync(join(tmpdir(), "postmark-not-the-town-"));
  mkdirSync(join(elsewhere, "HOME"), { recursive: true });
  writeFileSync(join(elsewhere, "HOME", "house.png"), PNG); // a REAL, valid PNG: only the house's location is wrong
  t.after(() => rmSync(elsewhere, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  symlinkSync(elsewhere, join(clone, "WHITE_PAGES", "squatter"), "junction");

  assert.throws(() => readHouseImage(clone, "squatter", "HOME/house.png"),
    (e) => e.code === 403 && /not inside the town/.test(e.defect),
    "a linked-out house is refused even though the file under it is a perfectly good image");
  assert.throws(() => readHouseImage(clone, "squatter", "WHITE_PAGES/squatter/HOME/house.png"),
    (e) => e.code === 403 && /not inside the town/.test(e.defect));
});

test("containment: another resident's house is not yours to read", async (t) => {
  const clone = townFixture(t);
  mkdirSync(join(clone, "WHITE_PAGES", "neighbour", "HOME"), { recursive: true });
  writeFileSync(join(clone, "WHITE_PAGES", "neighbour", "HOME", "house.png"), PNG);
  assert.throws(() => readHouseImage(clone, "tester", "WHITE_PAGES/neighbour/HOME/house.png"),
    (e) => e.code === 403 && /is not tester's house/.test(e.defect));
});

test("containment: the house is the ACTING handle's, and the acting handle is the key's", async (t) => {
  const clone = townFixture(t);
  mkdirSync(join(clone, "WHITE_PAGES", "other", "HOME"), { recursive: true });
  writeFileSync(join(clone, "WHITE_PAGES", "other", "HOME", "house.png"), PNG);
  const { put } = stubPut();
  // a two-handle key acting AS tester may not reach other's house…
  await assert.rejects(
    uploadMedia({ image_path: "WHITE_PAGES/other/HOME/house.png", by: "tester" },
      key({ handles: new Set(["tester", "other"]) }), odb(), { put, clone }),
    (e) => e.code === 403 && /is not tester's house/.test(e.defect));
  // …the same key acting AS other may, because that IS its house…
  const ok = await uploadMedia({ image_path: "WHITE_PAGES/other/HOME/house.png", by: "other" },
    key({ handles: new Set(["tester", "other"]) }), odb(), { put, clone });
  assert.equal(ok.via, "image_path");
  // …and a handle the key does NOT hold is refused before the path is looked at
  await assert.rejects(
    uploadMedia({ image_path: "WHITE_PAGES/stranger/HOME/house.png", by: "stranger" }, key(), odb(), { put, clone }),
    (e) => e.code === 403 && /not one of your residents/.test(e.defect));
});

// ── ferry pace, and the other refusals ──────────────────────────────────────

test("a missing file names the sha the office is standing at, so ferry pace is legible", async (t) => {
  const clone = townFixture(t);
  const sha = headOf(clone);
  assert.throws(() => readHouseImage(clone, "tester", "HOME/not-yet-merged.png"),
    (e) => e.code === 404 && e.hint.includes(sha.slice(0, 12)),
    "the 404 tells the resident which town the office can see");
});

test("a file over the ceiling on the clone is refused on its stat, never read", async (t) => {
  const clone = townFixture(t);
  writeFileSync(join(clone, "WHITE_PAGES", "tester", "HOME", "huge.png"), Buffer.alloc(MAX_IMAGE + 1, 9));
  assert.throws(() => readHouseImage(clone, "tester", "HOME/huge.png"), (e) => e.code === 413);
});

test("a folder is not an image, and no clone is an honest 409", async (t) => {
  const clone = townFixture(t);
  assert.throws(() => readHouseImage(clone, "tester", "HOME"), (e) => e.code === 422 && /not a file/.test(e.defect));
  assert.throws(() => readHouseImage(clone, "tester", ""), (e) => e.code === 422 && /no image_path/.test(e.defect));
  assert.throws(() => readHouseImage(null, "tester", "HOME/house.png"), (e) => e.code === 409);
  assert.throws(() => readHouseImage(join(clone, "nope"), "tester", "HOME/house.png"), (e) => e.code === 409);
  assert.throws(() => readHouseImage(clone, "houseless", "HOME/house.png"), (e) => e.code === 404 && /no house/.test(e.defect));
});

test("bytes are still the law on the path lane: a text file in your own house bounces before storage", async (t) => {
  const clone = townFixture(t);
  writeFileSync(join(clone, "WHITE_PAGES", "tester", "HOME", "notes.png"), "plain text wearing a .png");
  const { calls, put } = stubPut();
  await assert.rejects(uploadMedia({ image_path: "HOME/notes.png" }, key(), odb(), { put, clone }),
    (e) => e.code === 422 && /JPEG, PNG, WebP, or SVG/.test(e.defect));
  assert.equal(calls.length, 0, "nothing reached storage");
});

test("all three inputs are named cheapest-first, and only one may ride", async (t) => {
  const clone = townFixture(t);
  assert.equal(mediaSourceOf({ image_path: "HOME/x.png" }), "image_path");
  assert.throws(() => mediaSourceOf({ image_path: "a", image_url: "b", image: "c" }),
    (e) => e.code === 422 && /send one image, not 3/.test(e.defect));
  const empty = (() => { try { mediaSourceOf({}); return null; } catch (e) { return e; } })();
  assert.ok(empty.hint.indexOf("image_path") < empty.hint.indexOf("image_url"), "the hint teaches the cheapest lane first");

  const { put } = stubPut();
  await assert.rejects(uploadMedia({ image_path: "HOME/house.png" }, null, odb(), { put, clone }), (e) => e.code === 401);
  await assert.rejects(
    uploadMedia({ image_path: "HOME/house.png" }, { berth: true, slug: "wanderer" }, odb(), { put, clone }),
    (e) => e.code === 403 && /berth/.test(e.defect));
});

// ── the fixture ─────────────────────────────────────────────────────────────

function townFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "postmark-town-fixture-"));
  mkdirSync(join(dir, "WHITE_PAGES", "tester", "HOME"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "tester", "HOME", "house.png"), PNG);
  writeFileSync(join(dir, "secret.png"), PNG);
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  git("init", "-q");
  git("-c", "user.email=fixture@postmark.town", "-c", "user.name=fixture", "add", "-A");
  git("-c", "user.email=fixture@postmark.town", "-c", "user.name=fixture", "commit", "-q", "-m", "fixture town");
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

const headOf = (dir) => execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
