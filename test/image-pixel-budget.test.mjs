// image-pixel-budget.test.mjs — the town's pixel budget (POS-390). The byte
// cap (MAX_IMAGE, 1.5 MB) bounds what arrives; it never bounded what a decode
// allocates, because a flat picture compresses about a thousand to one. Every
// image door now reads the header's width and height first and refuses past
// MAX_PIXELS by name, before a single row is decoded; and every sharp() the
// doors construct carries that same number as its limitInputPixels, so the
// ceiling is the town's and not the library's default (~268 million pixels).
//
//   node --test test/image-pixel-budget.test.mjs
//
// The fixtures stay small on purpose: 8192 × 2048 is exactly the budget and
// 8193 × 2048 is one column over, so the edge is proven without this test
// itself allocating what the fix exists to prevent. The 20000 × 20000 SVG is a
// few hundred bytes that only become 400 million pixels if someone renders them.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";

const { decodeWhole, MAX_PIXELS } = await import("../src/edit.mjs");
const { uploadMedia, mintThumbnails } = await import("../src/media.mjs");

const flatPng = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: "#336699" } }).png({ compressionLevel: 9 }).toBuffer();
const hugeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000"><rect width="10" height="10"/></svg>');
const refusal = (p) => p.then(() => null, (e) => e);

test("the budget is the stated number: 4096 × 4096", () => {
  assert.equal(MAX_PIXELS, 4096 * 4096);
});

test("a picture exactly at the budget decodes", async () => {
  await decodeWhole(await flatPng(8192, 2048), "png", "avatar");
});

test("one column over the budget is refused by name, before the decode", async () => {
  const bytes = await flatPng(8193, 2048);
  assert.ok(bytes.length < 1024 * 1024, "well under the byte cap — the byte cap was never the guard");
  const e = await refusal(decodeWhole(bytes, "png", "avatar"));
  assert.ok(e, "the door refused");
  assert.equal(e.code, 413);
  assert.match(e.defect, /that avatar is 8193 × 2048 pixels/, "the refusal names what arrived");
  assert.match(e.defect, /4096 × 4096/, "and the budget");
  assert.match(e.hint, /nothing was stored/);
});

test("the media door refuses a picture that declares 20000 × 20000, and stores nothing", async () => {
  const calls = [];
  const put = async (...a) => { calls.push(a); };
  const key = { household: "testers", handles: new Set(["tester"]) };
  const e = await refusal(uploadMedia({}, key, new DatabaseSync(":memory:"), { put, bytes: hugeSvg }));
  assert.ok(e, "the door refused");
  assert.equal(e.code, 413);
  assert.match(e.defect, /that image is 20000 × 20000 pixels/);
  assert.equal(calls.length, 0, "nothing reached storage");
});

test("the small copies carry the same ceiling", async () => {
  const e = await refusal(mintThumbnails(await flatPng(8193, 2048), "png"));
  assert.ok(e, "the cutter refused an over-budget original");
  assert.match(String(e.message), /pixel limit/);
});
