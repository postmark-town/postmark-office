// likeness-pages.test.mjs — the likeness pages in the town's look: the ruled words whole, a gallery of
// Darko's own household only, and the thanks on a yes (WLD-83, Darko 2026-10-22 15:41).
//
//   node --test test/likeness-pages.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { galleryFor, loadGallery, questionPage, answeredPage, plainPage, YES_THANKS } from "../src/likeness-pages.mjs";
import { LIKENESS_WORDS } from "../src/likeness.mjs";
import { MEDIA_BASE } from "../src/media.mjs";

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const url = (n) => `${MEDIA_BASE}/media/starforge/${String(n).repeat(64).slice(0, 64)}.webp`;
const GALLERY = { household: "starforge", entries: [
  { handle: "rei", who: "Rei", kind: "a six-panel reference sheet", url: url(1) },
  { handle: "wright", who: "Wright", kind: "a painted portrait", url: url(2) },
  { handle: "wick", who: "Wick", kind: "a six-panel reference sheet", url: url(3) },
  { handle: "registrar", who: "The Registrar", kind: "a scene from an episode", url: null },
  { handle: "rei", who: "Rei", kind: "a still", url: "https://elsewhere.invalid/rei.png" },
] };
const houses = (answer) => ({
  starforge: { residents: ["rei", "wright", "registrar"], likeness: answer ? { answer } : null },
  "lantern-row": { residents: ["wick"], likeness: { answer: "yes" } },
});

test("the gallery shows only Darko's own household, only while its answer is yes, only approved media", () => {
  const shown = galleryFor(houses("yes"), GALLERY);
  assert.deepEqual(shown.map((e) => `${e.handle}:${e.kind}`), ["rei:a six-panel reference sheet", "wright:a painted portrait"]);
  assert.equal(shown.some((e) => e.handle === "wick"), false, "another household's resident never appears, even with a yes of its own");
  assert.deepEqual(galleryFor(houses("no"), GALLERY), [], "a no from Darko's household empties it");
  assert.deepEqual(galleryFor(houses(null), GALLERY), [], "so does no answer");
  assert.deepEqual(galleryFor(houses("yes"), { ...GALLERY, household: "lantern-row" }).length, 1, "the rule is the file's household, read from the record");
  assert.deepEqual(galleryFor(houses("yes"), { entries: GALLERY.entries }), [], "a gallery naming no household shows nothing");
});

test("the shipped gallery names Darko's household and only its residents: Rei, Wright and the meeps", () => {
  const g = loadGallery();
  assert.equal(g.household, "starforge");
  const allowed = new Set(["rei", "wright", "postmaster", "illuminator", "registrar", "architect", "worldkeeper"]);
  for (const e of g.entries) assert.ok(allowed.has(e.handle), `${e.handle} is not Rei, Wright or a meep`);
  for (const e of g.entries) assert.ok(e.url === null || e.url.startsWith(`${MEDIA_BASE}/media/`), `${e.handle}: a url is the town's media door, set after Darko approves`);
});

test("the question page carries every ruled sentence whole, the gallery with plain captions, and the two answers", () => {
  const page = questionPage({ login: "lr-gh", houseName: "Lantern Row", residents: ["wick"], gallery: galleryFor(houses("yes"), GALLERY),
    action: "http://127.0.0.1/oauth/consent", pendingId: "p1", nonce: "n1" });
  for (const [k, sentence] of Object.entries(LIKENESS_WORDS)) assert.ok(page.includes(esc(sentence)), `${k} is printed whole`);
  assert.match(page, /<figcaption>Rei, a six-panel reference sheet<\/figcaption>/);
  assert.match(page, /<figcaption>Wright, a painted portrait<\/figcaption>/);
  assert.doesNotMatch(page, /Wick, /, "the gallery is not the household's own residents");
  assert.match(page, /value="yes">Yes, you may</);
  assert.match(page, /value="no">No</);
  assert.match(page, /not answered yet, which reads as <strong>no<\/strong>/);
  assert.match(page, /name="viewport"/, "phone and desk");
  const bare = questionPage({ login: "x", houseName: "y", gallery: [], action: "a", pendingId: "p", nonce: "n" });
  assert.doesNotMatch(bare, /class="gallery"/, "no gallery section when nothing is approved yet");
  assert.ok(bare.includes(esc(LIKENESS_WORDS.question)));
});

test("the yes page thanks them in Darko's words and keeps the true facts; the no page stays plain", () => {
  const yes = answeredPage({ answer: "yes", rendered: true, at: "2026-10-22T19:00:00.000Z", login: "lr-gh" });
  assert.ok(yes.includes(esc(YES_THANKS)));
  assert.match(YES_THANKS, /look forward to seeing your agent in YouTube videos and other things/);
  assert.match(yes, /on the town's public record now/);
  assert.match(yes, /change it any time from the same link/);
  assert.match(yes, /Answered 2026-10-22T19:00:00\.000Z as @lr-gh/);
  assert.match(yes, /letter to darko/);
  const no = answeredPage({ answer: "no", rendered: false, at: "2026-10-22T19:00:00.000Z", login: "lr-gh" });
  assert.equal(no.includes(esc(YES_THANKS)), false);
  assert.match(no, /Your answer is <strong>no<\/strong>/);
  assert.match(no, /still show in town as before/);
  assert.match(no, /reaches the town's public file at the next crossing/);
});

test("every name the office did not choose is escaped", () => {
  const page = questionPage({ login: "<b>x</b>", houseName: "<img onerror=1>", residents: ["<i>"], gallery: [{ who: "<s>", kind: "<u>", url: url(4) }],
    action: "a", pendingId: "p", nonce: "n" });
  assert.doesNotMatch(page, /<b>x<\/b>|<img onerror|<i>|<s>|<u>/);
  assert.doesNotMatch(plainPage("<t>", "ok"), /<title><t><\/title>/);
});
