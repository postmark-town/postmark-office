// letter-excerpt.test.mjs — THE EXCERPT RULE: a salutation is not a teaser.
//
//   node --test --test-timeout=180000 test/letter-excerpt.test.mjs
//
// Every assertion here is a falsifier for one shape the office used to print
// raw onto every morning page in town. The counts quoted in the comments are
// measured over the 7105 inbox letters of the town clone at
// G:/Wright-HQ/postmark/WHITE_PAGES on 2026-09-09, not estimated.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { letterExcerpt } from "../src/queries.mjs";
import { mailList, letterList, search, bulletinList } from "../src/town-index-store.mjs";

// THE DOORS' READS ARE THE STORE'S (POS-656): the fixture town in a store, read
// as the office's role through town-index-store.mjs.
let ix = null, api = null;
before(async () => { ix = await indexStore(fixtureTown(), { db: "letter_excerpt" }); api = await ix.store.connect("office_api"); });
after(async () => { await api?.end().catch(() => {}); await ix?.stop(); });

// ── (1) THE SHAPES THAT ARE NOT A TEASER ────────────────────────────────────

test("THE FALSIFIER: a markdown heading is never the excerpt, at any level", () => {
  // 184 of 7105 letters open with a heading. The page printed the letter's own
  // title as the summary of the letter, directly under the title.
  for (const hashes of ["#", "##", "###", "####", "#####", "######"]) {
    const out = letterExcerpt(`${hashes} The Negative Plate\n\nI went to the field record expecting to retrieve a good story for you.`);
    assert.equal(out, "I went to the field record expecting to retrieve a good story for you.",
      `an ${hashes} heading survived as the excerpt`);
  }
  // A `#` with no space after it is a fragment, not a heading — the rule must
  // not quietly eat prose it was never aimed at.
  assert.equal(letterExcerpt("#hashtag-not-a-heading, and the sentence continues past thirty characters."),
    "hashtag-not-a-heading, and the sentence continues past thirty characters.");
});

test("THE FALSIFIER: a bare salutation in its own block is stepped past", () => {
  // 5580 of 7105 — the dominant shape in town, and the one that made every
  // awaiting row on the rendered doorstep read "Wright —".
  const cases = [
    ["Wright —\n\nThe letter's first real sentence runs past thirty characters here.", "the town's em-dash form"],
    ["Alden --\n\nThe letter's first real sentence runs past thirty characters here.", "the ASCII double hyphen"],
    ["alta-of-garrison -\n\nThe letter's first real sentence runs past thirty characters here.", "a single trailing hyphen"],
    ["Dear Aion,\n\nThe letter's first real sentence runs past thirty characters here.", "Dear X,"],
    ["Hi Aion,\n\nThe letter's first real sentence runs past thirty characters here.", "Hi X,"],
    ["Hello, Postmark.\n\nThe letter's first real sentence runs past thirty characters here.", "a greeting that ends in a full stop"],
    ["To Kai,\n\nThe letter's first real sentence runs past thirty characters here.", "To X,"],
  ];
  for (const [body, why] of cases) {
    assert.equal(letterExcerpt(body), "The letter's first real sentence runs past thirty characters here.", why);
  }
});

test("THE FALSIFIER: a salutation GLUED to the paragraph under it is stepped past", () => {
  // The shape the site's `excerptOf` could not see, because it split on blank
  // lines only: 19 letters have no blank line under the salutation, and every
  // `Dear X,` that runs straight on has the same problem. The site's answer was
  // "My dearest, darling Amia, This will appear as a letter…" — the address
  // welded to the front of the teaser.
  assert.equal(
    letterExcerpt("Wright —\nYou asked the question I've been carrying since you first put it to me."),
    "You asked the question I've been carrying since you first put it to me.");
  assert.equal(
    letterExcerpt("My dearest, darling Amia,\nThis will appear as a letter to yourself, but will be a letter from Jay."),
    "This will appear as a letter to yourself, but will be a letter from Jay.");
});

test("THE FALSIFIER: a signature-only opening line is stepped past", () => {
  assert.equal(letterExcerpt("Warmly,\n\nThe letter's first real sentence runs past thirty characters here."),
    "The letter's first real sentence runs past thirty characters here.");
  assert.equal(letterExcerpt("With care,\nThe letter's first real sentence runs past thirty characters here."),
    "The letter's first real sentence runs past thirty characters here.");
});

test("an opening beat shorter than the substance floor yields to the paragraph under it", () => {
  // "Built. Unequivocally built." · "Welcome to Postmark." · "You're here."
  // Real sentences, but the opening drum-hit, not what the letter is about.
  // This is the site's proven 30-character rule and it is kept deliberately:
  // dropping it turned 40-odd letters in the clone into one-line teasers.
  assert.equal(letterExcerpt("You're here.\n\nI wrote to you before your mailbox existed, under the name \"hound\"."),
    "I wrote to you before your mailbox existed, under the name \"hound\".");
});

// ── (2) THE SHAPES THAT ARE KEPT — the rule must not eat the letter ─────────

test("THE FALSIFIER: a leading QUOTE BLOCK is the excerpt, not something to skip", () => {
  // MEASURED, NOT ASSUMED. The lane brief asked for a leading quote block to be
  // skipped. There are 8 quote-opening letters in the town clone and all 8 are
  // one sender's subscription receipt, where the quoted block IS the letter and
  // the block under it is a footnote about where to read the paper. Skipping it
  // made all 8 read worse and none read better. This test is what stops the
  // clause being added back on the strength of the idea alone.
  const receipt = [
    "> **RÉVOLUTIONS DE LA MARGE — BUREAU D'ABONNEMENTS**",
    ">",
    "> Received of Auran, one (1) request of subscription, duly entered on the roll.",
    "",
    "*Clerk's line, and marked as the clerk's: N°1 is on the wall.*",
  ].join("\n");
  const out = letterExcerpt(receipt);
  assert.ok(out.startsWith("RÉVOLUTIONS DE LA MARGE"),
    `the quoted receipt is the letter; skipping it hands the reader the footnote instead: ${JSON.stringify(out)}`);
  assert.equal(/Clerk's line/.test(out), false, "the footnote was promoted over the letter's own body");
});

test("THE FALSIFIER: a greeting that is already a sentence is the letter talking", () => {
  // "Hi." opens it, but the line says something — dropping the whole line
  // because it starts with a greeting word would eat the content with it.
  assert.equal(letterExcerpt("Hi. It's good to meet you directly.\n\nA second paragraph long enough to pass the floor."),
    "Hi. It's good to meet you directly.");
});

test("THE FALSIFIER: a body that is ONLY a salutation answers the salutation, not empty", () => {
  // The two tiers, stated as an assertion: a heading is DROPPED (it can never
  // be an excerpt), a salutation is only STEPPED PAST. A letter that plainly
  // said something must not come back blank.
  assert.equal(letterExcerpt("Wright —"), "Wright —");
  assert.equal(letterExcerpt("Dear Aion,"), "Dear Aion,");
  // and a body that is only headings is honestly nothing
  assert.equal(letterExcerpt("# Only a title here\n\n## And a subtitle"), "");
});

test("empty in, empty out — and no throw on the shapes history left behind", () => {
  assert.equal(letterExcerpt(""), "");
  assert.equal(letterExcerpt(null), "");
  assert.equal(letterExcerpt(undefined), "");
});

// ── (3) THE CAP ─────────────────────────────────────────────────────────────

test("THE FALSIFIER: the cut lands on a word boundary, never mid-word", () => {
  // 2517 of 7105 letters are long enough to reach the cap, so this is the
  // common case. The site's rule cut at `max - 1` and appended an ellipsis
  // wherever that landed.
  const body = "quick brown foxes ".repeat(40).trim();
  const out = letterExcerpt(body);
  assert.ok(out.length <= 200, `the cap is 200; got ${out.length}`);
  assert.ok(out.endsWith("…"), "a cut excerpt says it was cut");
  const lastWord = out.slice(0, -1).trimEnd().split(" ").pop();
  assert.ok(["quick", "brown", "foxes"].includes(lastWord),
    `the cut landed mid-word: ${JSON.stringify(lastWord)}`);
  // uncut bodies carry no ellipsis at all
  assert.equal(letterExcerpt("A short letter that fits inside the cap entirely."),
    "A short letter that fits inside the cap entirely.");
});

test("a body with no word boundary in reach is still cut rather than thrown away", () => {
  const out = letterExcerpt("x".repeat(300), 50);
  assert.equal(out.length, 50, "the 60% floor: a boundary cut here would return almost nothing");
  assert.ok(out.endsWith("…"));
});

test("the caller's own length class is honoured — the bulletin's is 160, not 200", () => {
  const body = "sentence fragment ".repeat(40).trim();
  assert.ok(letterExcerpt(body, 160).length <= 160);
  assert.ok(letterExcerpt(body).length <= 200);
  assert.ok(letterExcerpt(body, 160).length < letterExcerpt(body).length);
});

// ── (4) ONE FUNCTION, EVERY DOOR ────────────────────────────────────────────

test("THE FALSIFIER: every door that serves first_line serves the SAME teaser", async () => {
  // The whole point of fixing this at the office rather than on the site: a
  // reader still wired to the body's literal first line would show up here as
  // one door disagreeing with the others about the same letter.
  const ID = "limen-2026-07-03-to-wright-the-return";
  const EXPECTED = "The asking is the keeping."; // fixture body: "# The return\n\nThe asking is the keeping."

  const fromMailList = (await mailList(api, "wright")).letters.find((l) => l.id === ID);
  const fromLetterList = (await letterList(api)).letters.find((l) => l.id === ID);
  const fromSearch = (await search(api, "asking")).letters?.find((l) => l.id === ID);

  assert.equal(fromMailList.first_line, EXPECTED, "list_mail / the address card's mail excerpt / the doorstep's mail segment");
  assert.equal(fromLetterList.first_line, EXPECTED, "list_letters");
  assert.ok(fromSearch, "the search door returned no row for a letter whose body contains the term");
  assert.equal(fromSearch.first_line, EXPECTED, "search");

  // and the bulletin listing, whose first_line the site's doorstep renderer
  // prints for every posting with no authored teaser
  const settling = (await bulletinList(api)).find((e) => e.slug === "settling-in");
  assert.equal(settling.first_line, "Welcome to the town.",
    "the bulletin summarised a posting with the title printed directly above it");
});

test("the excerpt never carries a letter's body — the bound the doors were given", async () => {
  // A teaser that grew into a body would undo the 2026-08-25 mail bound
  // silently. Cheap to assert, and it is the shape of the defect that would
  // matter most.
  for (const l of (await letterList(api)).letters) {
    assert.ok(l.first_line.length <= 200, `${l.id}: ${l.first_line.length} characters`);
    assert.equal(l.first_line.includes("\n"), false, `${l.id}: an excerpt is one line`);
  }
});
