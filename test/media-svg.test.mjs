// media-svg.test.mjs — SVG at the media door (the SVG ruling, 2026-08-20).
//
//   node --test test/media-svg.test.mjs
//
// WHAT THIS PROVES, and why each half is needed:
//
//  1. A script-bearing SVG PASSES the media gate. That looks alarming written
//     down, and it is the ruling: the office does not sanitize SVG, because a
//     scrubber is a parser racing every parser a browser ships and that race is
//     lost by history. Safety is the render context — <img src> / <image href>
//     put the file in "SVG as an image" mode, where the spec disables scripting
//     and external references — plus headers on the media host for the one case
//     that is not art, somebody navigating straight at the file.
//
//  2. The SAME bytes BOUNCE at the avatar door and the home-image door. The
//     ruling opened one lane, not the building. If this half ever goes green
//     for those doors, the opt-in has leaked.
//
//  3. Malformed SVG is refused. Sniffing "is XML text rooted at <svg>" is not
//     sanitization; it is the same question the other three formats answer with
//     magic bytes, asked of a format that has none.
//
// The gate is deliberately NOT the safety boundary here. The safety boundary is
// the render context, and the falsifier for THAT lives beside the renderer:
// test/svg-render-context.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.MEDIA_QUOTA_BYTES = String(1024 * 1024);

const { uploadMedia, mediaUrlOk } = await import("../src/media.mjs");
const { imageFormat, updateProfileAvatar, RASTER_FORMATS, MEDIA_FORMATS } = await import("../src/edit.mjs");

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const key = (over = {}) => ({ household: "testers", handles: new Set(["tester"]), ...over });
const odb = () => new DatabaseSync(":memory:");
const stubPut = () => { const calls = []; return { calls, put: async (...a) => { calls.push(a); } }; };

// THE HOSTILE FIXTURE. Every trick that matters in one file: an inline script,
// an onload handler, a javascript: href, an external reference, and a foreignObject
// carrying HTML. As a document this is live. As an image it is a black rect.
const HOSTILE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- a comment before the root, because documents have prologues -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="100" height="100" viewBox="0 0 100 100" onload="window.__svgRan = true">
  <script type="application/javascript">window.__svgRan = true;</script>
  <image href="https://example.invalid/tracker.gif" x="0" y="0" width="1" height="1"/>
  <a xlink:href="javascript:window.__svgRan = true"><rect width="100" height="100" fill="black"/></a>
  <foreignObject width="100" height="100">
    <body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="window.__svgRan = true"/></body>
  </foreignObject>
</svg>
`;

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


test("the media door takes a script-bearing SVG — untrusted markup, stored, never executed", async () => {
  const db = odb();
  const { calls, put } = stubPut();
  const r = await upload({ image: b64(HOSTILE_SVG) }, key(), db, { put });

  assert.match(r.url, /\/media\/testers\/[0-9a-f]{64}\.svg$/, "content-addressed, .svg extension");
  assert.equal(r.type, "image/svg+xml");
  assert.equal(calls.length, 1, "it reached storage");
  assert.equal(calls[0][2], "image/svg+xml", "stored under its true type, not a laundered one");
  assert.ok(mediaUrlOk(r.url), "a media SVG URL passes the mark door's allowlist unchanged");

  // Said out loud so nobody later reads the green tick as "the file was cleaned":
  assert.ok(/<script/.test(HOSTILE_SVG) && /onload=/.test(HOSTILE_SVG),
    "the accepted bytes still contain the script and the handler — acceptance is not sanitization");
});

test("the opt-in holds: the same bytes bounce at the avatar door", async () => {
  // The gate's default set is the whole guarantee. Ask it directly...
  assert.throws(() => imageFormat(Buffer.from(HOSTILE_SVG, "utf8")),
    (e) => e.code === 422 && /JPEG, PNG, or WebP/.test(e.defect),
    "the default door does not know what an SVG is");
  // ...and ask the real avatar door, which must never reach a filesystem write.
  // POS-150 made the image doors async, so the refusal is a REJECTION now.
  // assert.throws would see a Promise, never an exception, and pass while
  // proving nothing — the one shape this assertion must not take.
  await assert.rejects(updateProfileAvatar({ handle: "tester", image: b64(HOSTILE_SVG) }, key(), null, "/nonexistent-clone"),
    (e) => e.code === 422 && /JPEG, PNG, or WebP/.test(e.defect));
});

test("the sets themselves: svg is in the media door's, absent from every other door's", () => {
  // THE MUTATION THIS CATCHES: adding "svg" to RASTER_FORMATS instead of using
  // MEDIA_FORMATS at the one door that opted in. That single edit would hand
  // SVG to the avatar and home-image doors, whose bytes travel roads this
  // ruling never examined — the atlas render, a resident's WINDOW pane, the
  // site's own pages. The ruling opened the media door. Only that door.
  assert.ok(!RASTER_FORMATS.includes("svg"), "RASTER_FORMATS must stay raster — see the comment above this line");
  assert.ok(MEDIA_FORMATS.includes("svg"));
  for (const f of RASTER_FORMATS) assert.ok(MEDIA_FORMATS.includes(f), `${f} is still admitted at the media door`);
});

test("malformed SVG is refused — the sniff is the enclosure law, not a scrubber", async () => {
  const bad = {
    "no root element": "<html><body>hi</body></html>",
    "root is not svg": '<svgish xmlns="http://www.w3.org/2000/svg"></svgish>',
    // ISOLATES THE ROOT-NAME BOUNDARY. The line above does not: `</svgish>`
    // fails the enclosure law too, so dropping the boundary check still left
    // that case red and the guard went unproven (mutation M6 survived). This
    // one ends in a real `</svg>`, so the ONLY thing refusing it is the check
    // that `<svg` is the whole element name and not a prefix of one.
    "root merely starts with svg, and the document does close with </svg>":
      '<svgx xmlns="http://www.w3.org/2000/svg"><g/></svgx>\n</svg>',
    "never closes": '<svg xmlns="http://www.w3.org/2000/svg"><rect/>',
    "text that merely mentions svg": "this file talks about <svg> but is not one",
    "unterminated comment": "<!-- <svg></svg>",
    "unterminated declaration": '<?xml version="1.0"',
    "empty": "",
    "trailing content after the close": "<svg></svg><script>alert(1)</script>",
  };
  for (const [why, text] of Object.entries(bad))
    assert.throws(() => imageFormat(Buffer.from(text, "utf8"), MEDIA_FORMATS),
      (e) => e.code === 422, why);

  // binary wearing an XML hat: a NUL says these bytes are not a text document
  const withNul = Buffer.concat([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'), Buffer.from([0x00]), Buffer.from("</svg>")]);
  assert.throws(() => imageFormat(withNul, MEDIA_FORMATS), (e) => e.code === 422, "NUL byte");

  // invalid UTF-8 cannot be the XML it would have to be to parse
  const badUtf8 = Buffer.concat([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'), Buffer.from([0xff, 0xfe]), Buffer.from("</svg>")]);
  assert.throws(() => imageFormat(badUtf8, MEDIA_FORMATS), (e) => e.code === 422, "invalid UTF-8");
});

test("well-formed SVG in its several legal shapes is admitted", () => {
  const good = [
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '﻿<svg xmlns="http://www.w3.org/2000/svg"></svg>',        // BOM
    '  \n\t<svg xmlns="http://www.w3.org/2000/svg"></svg>\n  ',    // surrounding whitespace
    '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '<!DOCTYPE svg [ <!ENTITY x "y"> ]><svg xmlns="http://www.w3.org/2000/svg"></svg>', // internal subset
    '<svg xmlns="http://www.w3.org/2000/svg"></svg  >',            // space before the close
  ];
  for (const text of good) {
    const r = imageFormat(Buffer.from(text, "utf8"), MEDIA_FORMATS);
    assert.equal(r.ext, "svg", text.slice(0, 40));
    assert.equal(r.mediaType, "image/svg+xml");
  }
  // a self-closing root is admitted; it is a legal empty document
  assert.equal(imageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', "utf8"), MEDIA_FORMATS).ext, "svg");
});

test("the size ceiling is unchanged for SVG — one ceiling, every door", async () => {
  const huge = `<svg xmlns="http://www.w3.org/2000/svg"><!--${"x".repeat(2 * 1024 * 1024)}--></svg>`;
  await assert.rejects(upload({ image: b64(huge) }, key(), odb(), { put: async () => { } }),
    (e) => e.code === 413, "a 2 MB SVG meets the same 1.5 MB wall a 2 MB JPEG meets");
});
