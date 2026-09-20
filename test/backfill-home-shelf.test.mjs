// backfill-home-shelf.test — the home-image backfill's falsifiers.
//
// Each test names the law sentence it asserts, quoted verbatim from the gold
// plan (Starstory PULSE/gold-plans/postmark-home-images, "The law"). The one
// this leg answers to is law 4, and the whole point of these tests is that the
// backfill never becomes a second door: it hands bytes to the SAME uploadMedia
// the REST and MCP doors land in, and takes whatever answer it gets.
//
//   node --test test/backfill-home-shelf.test.mjs
//
// Env is pinned BEFORE the dynamic import, the same way test/media.test.mjs
// does it: media.mjs freezes its dials at module load.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.MEDIA_QUOTA_BYTES = "100"; // per resident — tiny, so the door's wall is reachable

const { uploadMedia, mediaUrlOk, MEDIA_BASE } = await import("../src/media.mjs");
const { backfillHomeShelf } = await import("../tools/backfill-home-shelf.mjs");

// the same real 1×1 transparent PNG test/media.test.mjs uses (70 bytes)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
// 204 bytes, still a JPEG by the office's own reading (SOI at the front, EOI at
// the back) — big enough to walk into a 200-byte ceiling
const BIG_JPG = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(200, 0x41), Buffer.from([0xff, 0xd9])]);

const odb = () => new DatabaseSync(":memory:");
const stubPut = () => { const calls = []; return { calls, put: async (...a) => { calls.push(a); } }; };
// The PUTs of ORIGINALS. Since postmark#2940 a raster upload also puts its two
// small copies (-96, -256) beside the original — held to account in
// test/media-thumbnails.test.mjs; the counts here are about the original.
const originals = (calls) => calls.filter(([k]) => !/-(?:96|256)\.[a-z]+$/.test(k));

// a staging dir shaped exactly as the world repo's selector writes one
function staging(files) {
  const root = mkdtempSync(join(tmpdir(), "backfill-home-shelf-test-"));
  mkdirSync(join(root, "files"), { recursive: true });
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(root, "files", name), bytes);
  return root;
}
// what oauth.mjs householdFor hands back: household = ghLogin ?? String(ghId),
// handles = every handle the pins bind to that account
const door = (household, handles) => ({ household, handles: new Set(handles) });
const houses = (map) => (handle) => map[handle] ?? null;

test('THE MEDIA DOOR IS THE ONLY MINT: "Every URL written is a `https://media.postmark.town/…` URL minted by the office\'s own `uploadMedia` path (same byte validation, same content-addressed dedup, same per-household quota ledger in odb)"', async () => {
  const dir = staging({ "resident.png": PNG });
  const { calls, put } = stubPut();
  try {
    const { urls, skipped } = await backfillHomeShelf({
      images: { resident: { file: "WHITE_PAGES/resident/HOME/art.png", format: "png" } },
      stagingDir: dir, householdFor: houses({ resident: door("gh-user", ["resident"]) }),
      upload: uploadMedia, odb: odb(), put,
    });
    // the URL is the handler's, and its shape is the handler's content-address:
    // the digest is of the BYTES, and the object key the handler PUT carries the
    // same one — a tool composing its own URL could not keep those two agreeing
    const sha = createHash("sha256").update(PNG).digest("hex");
    assert.equal(urls.resident, `${MEDIA_BASE}/media/gh-user/${sha}.png`);
    assert.equal(originals(calls).length, 1, "exactly one object reached storage");
    assert.equal(calls[0][0], `media/gh-user/${sha}.png`, "and the object key is the URL's own path");
    assert.equal(calls[0][2], "image/png", "and the media type is the one the BYTES named");
    assert.deepEqual(skipped, { noHousehold: [], missingBytes: [], refused: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("EVERY MINTED URL PASSES THE MARK DOOR'S OWN ALLOWLIST — the household grain must be the door's, not the economy's", async () => {
  // The bug this exists to catch, found on the first real dry run: the ECONOMY
  // names this same house `gh:293432145` (stamp-mint currentHouseholds, via
  // src/households.mjs), and `mediaUrlOk` — like tools/mark-lint.mjs and the
  // viewer — admits no colon in a media door path. Keyed on the economy's answer the
  // backfill mints URLs no mark in the town may carry and no viewer will draw,
  // and every other assertion in this file still passes. So the mint is asked
  // the only question that catches it: would the mark door take this back?
  const dir = staging({ "a.png": PNG });
  const { put } = stubPut();
  try {
    const { urls } = await backfillHomeShelf({
      images: { a: { file: "x", format: "png" } },
      stagingDir: dir, householdFor: houses({ a: door("AionSolare", ["a"]) }),
      upload: uploadMedia, odb: odb(), put,
    });
    assert.ok(mediaUrlOk(urls.a), `the mark door refuses ${urls.a}`);
    // and the same check, run against the shape the economy would have handed
    // us, must FAIL — a test that cannot fail is not watching anything
    assert.equal(mediaUrlOk(`${MEDIA_BASE}/media/gh:293432145/${"0".repeat(64)}.png`), false,
      "a colon-bearing household key is exactly what the allowlist refuses");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("NO SECOND VALIDATION LANE: bytes the door refuses are refused here, with the door's own code, and never reach the URL file", async () => {
  const dir = staging({ "prose.png": Buffer.from("this is not a picture"), "good.png": PNG });
  const { calls, put } = stubPut();
  try {
    const { urls, skipped } = await backfillHomeShelf({
      images: {
        prose: { file: "WHITE_PAGES/prose/HOME/prose.png", format: "png" },
        good: { file: "WHITE_PAGES/good/HOME/good.png", format: "png" },
      },
      stagingDir: dir,
      householdFor: houses({ prose: door("one", ["prose"]), good: door("two", ["good"]) }),
      upload: uploadMedia, odb: odb(), put,
    });
    assert.equal(urls.prose, undefined, "a refusal writes no URL");
    assert.ok(urls.good, "and the run continues past it");
    assert.equal(skipped.refused.length, 1);
    assert.equal(skipped.refused[0].handle, "prose");
    assert.equal(skipped.refused[0].code, 422, "the code is the DOOR's, not a code this tool invented");
    assert.match(skipped.refused[0].why, /JPEG, PNG, WebP, or SVG/, "and so is the reason");
    assert.equal(originals(calls).length, 1, "the refused bytes never reached storage");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("SAME CONTENT-ADDRESSED DEDUP: two handles of one household leading with the same file mint once, share the URL, and spend the quota once", async () => {
  // The town's real shape: fabel-, k-, little-m- and rook-of-garrison all lead
  // with HeartHouse_by_Sol.png and all sit in one GitHub household.
  const dir = staging({ "one.png": PNG, "two.png": PNG });
  const { calls, put } = stubPut();
  const db = odb();
  const house = door("garrison", ["one", "two"]);
  try {
    const { urls, dedup } = await backfillHomeShelf({
      images: { one: { file: "a", format: "png" }, two: { file: "b", format: "png" } },
      stagingDir: dir, householdFor: houses({ one: house, two: house }), upload: uploadMedia, odb: db, put,
    });
    assert.equal(urls.one, urls.two, "the same bytes are the same media door entry");
    assert.deepEqual(dedup, ["two"], "the second is reported as already on the media door");
    assert.equal(originals(calls).length, 1, "and only one object was ever written");
    const spent = db.prepare("SELECT COALESCE(SUM(bytes),0) AS u FROM media WHERE household = ?").get("garrison").u;
    assert.equal(spent, PNG.length, "the quota was spent exactly once");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("SAME PER-HOUSEHOLD QUOTA LEDGER IN ODB: the media door's own wall stops the backfill, and says so by name", async () => {
  const dir = staging({ "a.png": PNG, "b.jpg": BIG_JPG });
  const { calls, put } = stubPut();
  const house = door("two-up", ["a", "b"]); // two residents ⇒ a 200-byte ceiling
  try {
    const { urls, skipped } = await backfillHomeShelf({
      images: { a: { file: "a", format: "png" }, b: { file: "b", format: "jpg" } },
      stagingDir: dir, householdFor: houses({ a: house, b: house }), upload: uploadMedia, odb: odb(), put,
    });
    assert.ok(urls.a, "70 of the household's 200 bytes fits");
    assert.equal(urls.b, undefined, "the next one does not");
    assert.equal(skipped.refused[0].code, 413);
    assert.match(skipped.refused[0].why, /media is full/);
    assert.equal(originals(calls).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the household is the DOOR's answer: a handle it does not resolve is NAMED, never guessed into a household", async () => {
  const dir = staging({ "stranger.png": PNG, "outsider.png": PNG });
  const { calls, put } = stubPut();
  try {
    const { urls, skipped } = await backfillHomeShelf({
      images: { stranger: { file: "x", format: "png" }, outsider: { file: "y", format: "png" } },
      stagingDir: dir,
      // stranger: no household at all. outsider: a household that does not hold
      // them — the door would answer 403, so the run must not even try.
      householdFor: houses({ outsider: door("somebody-else", ["not-outsider"]) }),
      upload: uploadMedia, odb: odb(), put,
    });
    assert.deepEqual(urls, {});
    assert.deepEqual(skipped.noHousehold.map((r) => r.handle).sort(), ["outsider", "stranger"]);
    assert.equal(calls.length, 0, "nothing was minted under a made-up household");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("staged bytes that are not there are named, not invented", async () => {
  const dir = staging({});
  const { calls, put } = stubPut();
  try {
    const { urls, skipped } = await backfillHomeShelf({
      images: { ghost: { file: "x", format: "png" } },
      stagingDir: dir, householdFor: houses({ ghost: door("gh-user", ["ghost"]) }),
      upload: uploadMedia, odb: odb(), put,
    });
    assert.deepEqual(urls, {});
    assert.equal(skipped.missingBytes[0].handle, "ghost");
    assert.equal(calls.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the uploader acts AS the resident, inside their own household — the door's own by-check is the one that holds", async () => {
  const dir = staging({ "r.png": PNG });
  const { put } = stubPut();
  const db = odb();
  try {
    await backfillHomeShelf({
      images: { r: { file: "x", format: "png" } },
      stagingDir: dir, householdFor: houses({ r: door("shared-account", ["r", "sibling"]) }),
      upload: uploadMedia, odb: db, put,
    });
    const row = db.prepare("SELECT household, by_handle FROM media").get();
    assert.equal(row.household, "shared-account");
    assert.equal(row.by_handle, "r", "the ledger records the resident whose art it is, not the operator");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the box's own two questions, made into probes (2026-08-21) ───────────────
//
// Wright's first real run on meepo-ec2 failed with Headers.append errors from
// CR-tainted R2 env, the second reported "no new objects" while every URL
// HEAD-verified 200, and the three facts did not reconcile under his model of
// this tool. They reconcile under the code — one of the two behaviours was
// already right and untested, and the other was a real defect. Both are probes
// now, so neither can drift back into being a matter of opinion.

test("A FAILED PUT WRITES NO LEDGER ROW, NO URL, AND LANDS IN skipped.refused — the ledger may never claim what storage does not hold", () => {
  // uploadMedia reaches its INSERT only on the line AFTER `await put(...)`, and
  // neither is guarded, so a throw from storage takes the row with it. That is
  // the invariant the media door's whole dedup branch rests on: `already: true`
  // returns a URL without sending any bytes, so a row written for an object
  // that never landed would hand back a URL for a file that does not exist —
  // permanently, since nothing here ever deletes.
  const dir = staging({ "a.png": PNG, "b.png": Buffer.concat([PNG, Buffer.alloc(0)]) });
  const db = odb();
  const boom = async () => { throw new TypeError("Headers.append: is an invalid header value"); };
  return (async () => {
    const { urls, skipped } = await backfillHomeShelf({
      images: { a: { file: "a", format: "png" } },
      stagingDir: dir, householdFor: houses({ a: door("gh-user", ["a"]) }),
      upload: uploadMedia, odb: db, put: boom,
    });
    assert.deepEqual(urls, {}, "a failed PUT writes no URL");
    assert.equal(skipped.refused.length, 1);
    assert.equal(skipped.refused[0].handle, "a");
    assert.match(skipped.refused[0].why, /invalid header value/, "the storage error is carried through by name, not swallowed");
    const rows = db.prepare("SELECT COUNT(*) AS n FROM media").get().n;
    assert.equal(rows, 0, "THE LEDGER MUST BE EMPTY — a row here would make the next run answer `already` for bytes that never landed");

    // and the failure leaves nothing poisoned: a later run with working storage
    // mints it for real, which is exactly what the box's second run did
    const { calls, put } = stubPut();
    const again = await backfillHomeShelf({
      images: { a: { file: "a", format: "png" } },
      stagingDir: dir, householdFor: houses({ a: door("gh-user", ["a"]) }),
      upload: uploadMedia, odb: db, put,
    });
    assert.ok(again.urls.a, "the retry mints");
    assert.deepEqual(again.dedup, [], "and it is NOT reported as already on the media door");
    assert.deepEqual(again.minted, ["a"]);
    assert.equal(originals(calls).length, 1, "one object really was written this time");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media").get().n, 1);
    rmSync(dir, { recursive: true, force: true });
  })();
});

test("THE OBJECT COUNTER COUNTS OBJECTS THAT REACHED STORAGE — in a run with a real put as much as a mocked one", () => {
  // The defect the box caught: the count used to be pushed from inside the DRY
  // mock, so on a real run — where no mock exists — it was structurally zero
  // and the tool reported "no new objects" after writing 57. `minted` is
  // derived from the handler's own answers instead: a result that is neither a
  // throw nor `already` is one object written, which is true in both modes.
  const dir = staging({ "one.png": PNG, "two.png": PNG, "three.jpg": BIG_JPG });
  const db = odb();
  const house = door("garrison", ["one", "two", "three"]);
  return (async () => {
    const { calls, put } = stubPut();
    const r = await backfillHomeShelf({
      images: { one: { file: "a", format: "png" }, three: { file: "c", format: "jpg" }, two: { file: "b", format: "png" } },
      stagingDir: dir, householdFor: houses({ one: house, two: house, three: house }),
      upload: uploadMedia, odb: db, put,
    });
    assert.equal(Object.keys(r.urls).length, 3, "three handles got a URL");
    assert.deepEqual(r.dedup, ["two"], "two shares one's bytes");
    assert.deepEqual(r.minted.sort(), ["one", "three"]);
    assert.equal(r.minted.length, originals(calls).length, "THE COUNT IS THE NUMBER OF CALLS STORAGE ACTUALLY TOOK");
    assert.notEqual(r.minted.length, Object.keys(r.urls).length, "and it is not simply the URL count — that is the conflation that hid the real number");
    rmSync(dir, { recursive: true, force: true });
  })();
});
