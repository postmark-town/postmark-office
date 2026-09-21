// media.test.mjs — the media door (2026-08-15). Unit layer: the handler's
// gates (who may upload, what bytes pass, the quota wall, content-addressed
// dedup) and the mark door's URL allowlist — everything around the storage
// call, with the SigV4 PUT stubbed out. The live bucket is proven at deploy,
// not here; the door's not-yet-open answer covers the credential-less office.
//
//   node --test test/media.test.mjs
//
// Env is pinned BEFORE the dynamic imports: media.mjs reads its dials at
// module load, so the quota + fake credentials must be in place first.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.MEDIA_QUOTA_BYTES = "100"; // per resident — tiny, so the wall is testable

const { uploadMedia, mediaUrlOk, MEDIA_BASE } = await import("../src/media.mjs");

// a real, whole 1×1 transparent PNG (70 bytes) — passes magic bytes + IEND
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const key = (over = {}) => ({ household: "testers", handles: new Set(["tester"]), ...over });
const odb = () => new DatabaseSync(":memory:");
const stubPut = () => { const calls = []; return { calls, put: async (...a) => { calls.push(a); } }; };
// The PUTs of ORIGINALS. Since postmark#2940 a raster upload also puts its two
// small copies (-96, -256) beside the original — held to account in
// test/media-thumbnails.test.mjs; the counts here are about the original.
const originals = (calls) => calls.filter(([k]) => !/-(?:96|256)\.[a-z]+$/.test(k));

// ── POS-150: the bytes lane, after the base64 door closed ────────────────────
//
// These tests are about what happens AFTER bytes reach the door — the gates,
// the wall, the dedupe, the copies. They used `image:` (base64) because it was
// the cheapest way to hand the handler a Buffer. That door is gone, so the
// bytes now walk in the way a resident's would: down the URL lane, with fetch
// and DNS injected so the falsifier still runs offline. Same bytes, same
// handler, same assertions — only the doorway changed.
const FIXTURE_URL = "https://fixture.example.com/bytes";
const serving = (b64) => {
  const buf = Buffer.from(b64, "base64");
  return {
    fetchImpl: async () => ({
      status: 200, ok: true,
      headers: new Headers({ "content-length": String(buf.length) }),
      body: { getReader: () => { let sent = false; return {
        read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(buf) })),
        cancel: async () => {},
      }; } },
    }),
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  };
};
// Drop-in for uploadMedia: an `image` argument is carried down the URL lane,
// anything else is passed straight through untouched.
const upload = (args, k, db, opts = {}) => {
  const { image, ...rest } = args ?? {};
  return image === undefined
    ? uploadMedia(args, k, db, opts)
    : uploadMedia({ ...rest, image_url: FIXTURE_URL }, k, db, { ...opts, ...serving(image) });
};


test("the gates: no key, a berth, no household, the wrong by", async () => {
  await assert.rejects(upload({ image: PNG }, null, odb()), (e) => e.code === 401);
  await assert.rejects(upload({ image: PNG }, { berth: true, slug: "wanderer" }, odb()),
    (e) => e.code === 403 && /berth/.test(e.defect));
  await assert.rejects(upload({ image: PNG }, { handles: new Set() }, odb()), (e) => e.code === 403);
  await assert.rejects(upload({ image: PNG, by: "someone-else" }, key(), odb()),
    (e) => e.code === 403 && /not one of your residents/.test(e.defect));
  // a two-resident key must choose
  await assert.rejects(upload({ image: PNG }, key({ handles: new Set(["a", "b"]) }), odb()),
    (e) => e.code === 422 && /which resident/.test(e.defect));
});

test("bytes are the law: not-an-image bounces before any storage call", async () => {
  const { calls, put } = stubPut();
  // The media door names SVG since the 2026-08-20 ruling; the avatar and home-image
  // doors still say "JPEG, PNG, or WebP", and test/media-svg.test.mjs is where
  // that difference is held to account.
  await assert.rejects(upload({ image: Buffer.from("plain text").toString("base64") }, key(), odb(), { put }),
    (e) => e.code === 422 && /JPEG, PNG, WebP, or SVG/.test(e.defect));
  assert.equal(calls.length, 0, "nothing reached storage");
});

test("the happy path: content-addressed key, URL on the media host, ledger row", async () => {
  const db = odb();
  const { calls, put } = stubPut();
  const r = await upload({ image: PNG }, key(), db, { put });
  assert.match(r.url, new RegExp(`^${MEDIA_BASE.replace(/[/.]/g, "\\$&")}/media/testers/[0-9a-f]{64}\\.png$`));
  assert.equal(r.bytes, 70);
  assert.equal(r.type, "image/png");
  assert.equal(originals(calls).length, 1);
  assert.equal(calls[0][2], "image/png");
  assert.ok(mediaUrlOk(r.url), "the media door's own URL passes the mark door's allowlist");
  assert.equal(r.quota.used, 70);
  assert.equal(r.quota.ceiling, 100, "one resident, one quota");
});

test("dedup: the same bytes answer with the same URL and never spend twice", async () => {
  const db = odb();
  const { calls, put } = stubPut();
  const first = await upload({ image: PNG }, key(), db, { put });
  const again = await upload({ image: PNG }, key(), db, { put });
  assert.equal(again.url, first.url);
  assert.equal(again.already, true);
  assert.equal(originals(calls).length, 1, "storage was written once");
  assert.equal(again.quota.used, 70, "quota unchanged by the re-send");
});

test("the quota wall: a full wall bounces 413 with the honest arithmetic", async () => {
  const db = odb();
  const { put } = stubPut();
  await upload({ image: PNG }, key(), db, { put }); // 70 of 100
  // different bytes (a second real 1×1 PNG, opaque white) — same wall
  const PNG2 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  await assert.rejects(upload({ image: PNG2 }, key(), db, { put }),
    (e) => e.code === 413 && /full/.test(e.defect));
});

test("the ceiling scales per resident: a two-handle household holds twice the wall", async () => {
  const db = odb();
  const { put } = stubPut();
  const r = await upload({ image: PNG, by: "a" }, key({ handles: new Set(["a", "b"]) }), db, { put });
  assert.equal(r.quota.ceiling, 200);
});

test("the mark door's allowlist: only the media door's own URLs pass", () => {
  assert.ok(mediaUrlOk(`${MEDIA_BASE}/media/testers/abc123.png`));
  for (const bad of [
    "https://evil.example/media/testers/abc.png",
    `http://${MEDIA_BASE.replace(/^https:\/\//, "")}/media/x.png`, // scheme downgrade
    `${MEDIA_BASE}/media/x.png?width=9000`, // query strings are not minted
    `${MEDIA_BASE}/../escape.png`,
    "data:image/png;base64,AAAA",
    "", null, undefined, 42,
  ])
    assert.ok(!mediaUrlOk(bad), String(bad));
});

test("the mark door itself: an off-media image bounces before any write", async () => {
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  await assert.rejects(
    leaveMarkViaOffice("/nonexistent-clone", {
      slug: "picture-test", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 1, h: 1 },
      body: "a test mark.", image: "https://evil.example/x.png",
    }, { household: "testers", handles: new Set(["tester"]) }),
    (e) => e.code === 422 && /media door/.test(e.defect),
    "the allowlist answers before the clone is ever touched");
});
