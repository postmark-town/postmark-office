// media-thumbnails.test.mjs — the small copies beside the original (postmark#2940,
// 2026-09-18). Unit layer: an upload puts THREE objects (the original, -96,
// -256) through the same injectable PUT, at the right dimensions, in the
// original's format; the ledger row and the wall see the original's bytes
// only; an SVG mints none; a copy that cannot be cut never refuses the upload.
// The backfill's own falsifier is test/media-thumbnails-backfill.test.mjs.
//
//   node --test test/media-thumbnails.test.mjs
//
// Fixtures are cut here with sharp itself — a 1200×800 JPEG, a 40×40 PNG, a
// WebP — so the door is held to real decoders, not to a 1×1 the resize would
// never touch. Env is pinned BEFORE the dynamic import (media.mjs reads its
// dials at module load).

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.MEDIA_QUOTA_BYTES = String(4 * 1024 * 1024);

const { uploadMedia, mintThumbnails, THUMB_VARIANTS, THUMB_SIZES, THUMB_FORMATS, thumbObjectKey, thumbUrlFor, mediaUrlOk, MEDIA_BASE }
  = await import("../src/media.mjs");
const { RASTER_FORMATS } = await import("../src/edit.mjs");

const key = (over = {}) => ({ household: "testers", handles: new Set(["tester"]), ...over });
const odb = () => new DatabaseSync(":memory:");
const stubPut = () => { const calls = []; return { calls, put: async (...a) => { calls.push(a); } }; };
const b64 = (buf) => buf.toString("base64");

// a landscape with a distinct centre, so a cover-crop and a letterbox cannot
// be told apart by dimensions alone — the centre column is white, the flanks navy
async function landscapeJpeg() {
  const centre = await sharp({ create: { width: 200, height: 800, channels: 3, background: "#ffffff" } }).png().toBuffer();
  return sharp({ create: { width: 1200, height: 800, channels: 3, background: "#0d1426" } })
    .composite([{ input: centre, left: 500, top: 0 }]).jpeg({ quality: 90 }).toBuffer();
}
const tinyPng = () => sharp({ create: { width: 40, height: 40, channels: 4, background: "#e8c48b" } }).png().toBuffer();
const webp = () => sharp({ create: { width: 640, height: 640, channels: 3, background: "#336699" } }).webp().toBuffer();
const dims = async (buf) => { const m = await sharp(buf).metadata(); return { w: m.width, h: m.height, format: m.format }; };

test("the table: two sizes, the card one the home card's own shape, rasters only", () => {
  assert.deepEqual(THUMB_SIZES, [96, 256]);
  assert.deepEqual(THUMB_VARIANTS[96], { w: 96, h: 96 }, "the face is a square");
  assert.deepEqual(THUMB_VARIANTS[256], { w: 256, h: 286 }, "the card is 52:58 — HOME_CARD in the viewer, 52 by 44+14");
  assert.deepEqual([...THUMB_FORMATS], ["jpg", "png", "webp"]);
  assert.deepEqual([...THUMB_FORMATS], [...RASTER_FORMATS], "the copy formats ARE the door's rasters — spelled twice because of the edit↔media cycle, held equal here");
  assert.equal(thumbObjectKey("testers", "abc", "jpg", 96), "media/testers/abc-96.jpg");
  assert.ok(mediaUrlOk(thumbUrlFor("testers", "abc", "png", 256)), "a copy's url passes the mark door's allowlist, like the original's");
});

test("an upload puts three objects: the original, -96, -256 — each the right size, each the original's format", async () => {
  const db = odb();
  const { calls, put } = stubPut();
  const src = await landscapeJpeg();
  const r = await uploadMedia({ image: b64(src) }, key(), db, { put });
  assert.equal(calls.length, 3, "one PUT for the original and one per copy");
  const [orig, face, card] = calls;
  assert.equal(orig[0], `media/testers/${r.sha}.jpg`);
  assert.equal(face[0], `media/testers/${r.sha}-96.jpg`);
  assert.equal(card[0], `media/testers/${r.sha}-256.jpg`);
  assert.ok(Buffer.compare(orig[1], src) === 0, "the original's bytes are the resident's, untouched");
  assert.deepEqual(await dims(face[1]), { w: 96, h: 96, format: "jpeg" });
  assert.deepEqual(await dims(card[1]), { w: 256, h: 286, format: "jpeg" });
  assert.equal(face[2], "image/jpeg"); assert.equal(card[2], "image/jpeg");
  // the CENTRE of the picture, not a letterbox of the whole: the middle pixel
  // of the face copy is the white column, its corner the navy flank
  const { data } = await sharp(face[1]).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [data[(y * 96 + x) * 3], data[(y * 96 + x) * 3 + 1], data[(y * 96 + x) * 3 + 2]];
  assert.ok(px(48, 48)[0] > 200, `the centre is the white column, got ${px(48, 48)}`);
  assert.ok(px(2, 48)[0] < 60, `the flank is navy, got ${px(2, 48)}`);
  // …and the column runs the copy's full height: a letterbox (fit: contain)
  // would put a band here, a cover crop puts the picture
  assert.ok(px(48, 2)[0] > 200, `the top of the centre is still the column — no band, got ${px(48, 2)}`);
  assert.ok(px(48, 93)[0] > 200, `and so is the bottom, got ${px(48, 93)}`);
  // the receipt names the copies, and the wall saw the original alone
  assert.deepEqual(r.variants, {
    96: `${MEDIA_BASE}/media/testers/${r.sha}-96.jpg`,
    256: `${MEDIA_BASE}/media/testers/${r.sha}-256.jpg`,
  });
  assert.equal(r.quota.used, src.length, "the copies are the town's: no quota");
  const row = db.prepare("SELECT bytes FROM media WHERE household = ? AND sha = ?").get("testers", r.sha);
  assert.equal(row.bytes, src.length, "the ledger row is the household's bytes only");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media").get().n, 1, "no ledger row for a copy");
});

test("a picture already smaller than the copy is not enlarged — and still gets its copies", async () => {
  const { calls, put } = stubPut();
  const r = await uploadMedia({ image: b64(await tinyPng()) }, key(), odb(), { put });
  assert.equal(calls.length, 3);
  assert.deepEqual(await dims(calls[1][1]), { w: 40, h: 40, format: "png" });
  assert.deepEqual(await dims(calls[2][1]), { w: 40, h: 40, format: "png" });
  assert.ok(r.variants[96].endsWith(`-96.png`));
});

test("a WebP stays a WebP", async () => {
  const { calls, put } = stubPut();
  await uploadMedia({ image: b64(await webp()) }, key(), odb(), { put });
  assert.equal(calls.length, 3);
  assert.deepEqual(await dims(calls[1][1]), { w: 96, h: 96, format: "webp" });
  assert.equal(calls[1][2], "image/webp");
});

test("an SVG mints none: one PUT, variants null", async () => {
  const { calls, put } = stubPut();
  const r = await uploadMedia({ image: b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')) }, key(), odb(), { put });
  assert.equal(calls.length, 1, "the original only");
  assert.equal(r.variants, null);
  await assert.rejects(mintThumbnails(Buffer.from("<svg/>"), "svg"), (e) => e.code === 422 && /no small copies/.test(e.defect));
});

test("a copy the door cannot cut never refuses the upload: the original lands, variants null", async () => {
  // a JPEG the format gate admits (SOI … EOI) and libvips cannot decode
  const src = await landscapeJpeg();
  const corrupt = Buffer.concat([src.subarray(0, 600), Buffer.alloc(400, 0), src.subarray(-2)]);
  assert.equal(corrupt.at(-1), 0xd9, "the enclosure is intact, so the door admits it");
  await assert.rejects(mintThumbnails(corrupt, "jpg"), "the mint itself fails on it");
  const db = odb();
  const { calls, put } = stubPut();
  const r = await uploadMedia({ image: b64(corrupt) }, key(), db, { put });
  assert.equal(calls.length, 1, "the original was put");
  assert.equal(r.variants, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media").get().n, 1, "and its ledger row written");
});

test("a copy's PUT that fails leaves the upload standing", async () => {
  const calls = [];
  const put = async (k, ...rest) => { calls.push([k, ...rest]); if (/-96\./.test(k)) throw new Error("storage answered 503"); };
  const r = await uploadMedia({ image: b64(await webp()) }, key(), odb(), { put });
  assert.equal(r.variants, null);
  assert.ok(r.url.endsWith(`${r.sha}.webp`));
});

test("dedup still answers without a second PUT of anything", async () => {
  const db = odb();
  const { calls, put } = stubPut();
  const src = await webp();
  await uploadMedia({ image: b64(src) }, key(), db, { put });
  const again = await uploadMedia({ image: b64(src) }, key(), db, { put });
  assert.equal(again.already, true);
  assert.equal(calls.length, 3, "three objects once; nothing on the re-send");
});
