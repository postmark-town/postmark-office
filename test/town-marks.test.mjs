// town-marks.test.mjs — `town { read: "marks" }` and the resident card's counts.
//
// THE HOLE (docs/2026-09-06/resident-walk.md, 01:53 EDT, item 2), verbatim:
//
//   "nothing in town says what a resident MADE. The roster is handle · github ·
//    joined · last_active. The resident card has address + home + mail, no
//    marks. The site's resident page: 'No marks section appears on this page.'
//    … So 'what has Errant put in the world?' has no door and no page — I still
//    do not know whether Errant has laid a single mark."
//
// THE THREE TENSES ARE THREE DIFFERENT FACTS, and the tests that matter most
// here are the ones about the two that can be UNREADABLE. Conflating "nothing
// pending" with "this office cannot see the docket" is the disclosure guard's
// own named defect, and it is exactly what produced the weekend's one stopper:
// a resident's staked mark answered "does not exist" from one door, "draft"
// from another, and "nothing happened to you" from a third.
//
//   node --test test/town-marks.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { marksRead, marksCountsFor, publishedMarksOf, DOCKET_UNREADABLE } from "../src/town-marks.mjs";

const scratch = mkdtempSync(join(tmpdir(), "pm-town-marks-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } });

// ── a world in a bottle: errant has laid three, argos one, nobody none ───────
const repo = join(scratch, "world");
mkdirSync(repo, { recursive: true });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const MARKS = [
  { id: "errant/the-misfiled-annex", by: "errant", kind: "parcel", tier: "market", date: "2026-07-01", body: "poured, wired and assigned a place", at: { x: 1, y: 1 }, stamps: 2, weight: 3 },
  { id: "errant/a-paper-epaulette", by: "errant", kind: "sited", tier: "market", date: "2026-09-02", body: "worn on the shoulder of a building", at: { x: 2, y: 2 }, stamps: 0, weight: 0 },
  { id: "errant/the-morning-artifacts", by: "errant", kind: "sited", tier: "market", date: "2026-08-20", body: "what the night leaves out", at: { x: 3, y: 3 }, stamps: 1, weight: 1 },
  { id: "argos/one-thing", by: "argos", kind: "sited", tier: "market", date: "2026-08-01", body: "the only thing argos has laid", at: { x: 9, y: 9 }, stamps: 0, weight: 0 },
];
put("WORLD/world-state.json", JSON.stringify({ tick: 0, marks: MARKS, parcels: [] }));
git("init", "-q", "-b", "main");
git("config", "user.email", "t@postmark.invalid");
git("config", "user.name", "marks falsifier");
git("add", "-A");
git("commit", "-qm", "canon");

// The two injected readers. The live ones are one call each into doors that
// already own their connections; these drive the same seam so the SHAPE is
// proven without a store — and there is no lab store to prove it against.
const docketWith = (rows) => async () => ({ readable: true, rows });
const docketDown = (reason) => async () => ({ readable: false, ...(reason ? { reason } : {}) });
const draftsWith = (rows) => async () => ({ readable: true, rows });
const draftsDown = async () => ({ readable: false, reason: "the overlay refused" });

const KEY_ERRANT = { household: "errant-house", handles: new Set(["errant"]) };
const STRANGER = { household: "someone-else", handles: new Set(["argos"]) };

test("the published tense is the world's canon, filtered to WHOSE — and the count is of the whole set", async () => {
  assert.deepEqual(publishedMarksOf("errant", { repo }).map((m) => m.id),
    ["errant/a-paper-epaulette", "errant/the-misfiled-annex", "errant/the-morning-artifacts"]);
  const a = await marksRead("errant", { repo, docketFor: docketWith([]), draftsFor: draftsWith([]) });
  assert.equal(a.counts.published, 3);
  assert.equal(a.published.length, 3);
  // The rows carry what a stranger may read about a mark: its words, its
  // weight, where it stands.
  const annex = a.published.find((m) => m.id === "errant/the-misfiled-annex");
  assert.equal(annex.body, "poured, wired and assigned a place");
  assert.equal(annex.stamps, 2);
  // AND THE ERRAND'S OWN QUESTION IS NOW ANSWERABLE for somebody with nothing:
  // an empty published list is a real answer, not a missing door.
  const none = await marksRead("nobody", { repo, docketFor: docketWith([]), draftsFor: draftsWith([]) });
  assert.equal(none.counts.published, 0);
  assert.deepEqual(none.published, []);
});

test("COUNT FIRST, SLICE AFTER — a page never becomes the total", async () => {
  const a = await marksRead("errant", { repo, limit: 2, docketFor: docketWith([]), draftsFor: draftsWith([]) });
  assert.equal(a.counts.published, 3, "the count is the whole set");
  assert.equal(a.shown, 2, "the page is the page");
  assert.equal(a.complete, false);
  assert.equal(a.next_offset, 2);
  const b = await marksRead("errant", { repo, limit: 2, offset: 2, docketFor: docketWith([]), draftsFor: draftsWith([]) });
  assert.equal(b.counts.published, 3);
  assert.equal(b.complete, true);
  assert.deepEqual([...a.published, ...b.published].map((m) => m.id),
    publishedMarksOf("errant", { repo }).map((m) => m.id), "the two pages rejoin whole");
});

test("A FRACTIONAL limit/offset PAGES AS ITS WHOLE NUMBER — the echo and the next cursor stay whole", async () => {
  const a = await marksRead("errant", { repo, limit: 1.5, offset: 0.5, docketFor: docketWith([]), draftsFor: draftsWith([]) });
  assert.equal(a.limit, 1, "limit 1.5 pages one");
  assert.equal(a.offset, 0, "offset 0.5 starts at the top");
  assert.equal(a.next_offset, 1, "the cursor is a whole number");
  const b = await marksRead("errant", { repo, offset: 1e30, docketFor: docketWith([]), draftsFor: draftsWith([]) });
  assert.equal(b.shown, 0, "past the end reads empty, not a throw");
});

test("AN UNREADABLE DOCKET ANSWERS null WITH A REASON — never zero", async () => {
  // This is the finding, not a nicety. "Nothing is pending" and "this office
  // cannot see the docket" are different facts, and the second wearing the
  // first's clothes is what told a resident their staked mark did not exist.
  const down = await marksRead("errant", { repo, docketFor: docketDown(), draftsFor: draftsWith([]) });
  assert.equal(down.counts.docket, null, "null, not 0");
  assert.equal(down.docket, null);
  assert.equal(down.docket_unreadable, DOCKET_UNREADABLE);
  assert.match(down.docket_unreadable, /never a claim that nothing is pending/);

  // A store that IS readable and holds nothing answers zero, which is the fact
  // the null must be distinguishable from.
  const empty = await marksRead("errant", { repo, docketFor: docketWith([]), draftsFor: draftsWith([]) });
  assert.equal(empty.counts.docket, 0, "a readable empty docket is a real zero");
  assert.deepEqual(empty.docket, []);
  assert.equal(empty.docket_unreadable, undefined);

  // And a CONFIGURED store that cannot be reached is a third state with its own
  // sentence — not folded into either of the two above.
  const unreachable = await marksRead("errant", { repo, docketFor: docketDown("the public docket could not be reached (ECONNREFUSED)"), draftsFor: draftsWith([]) });
  assert.match(unreachable.docket_unreadable, /could not be reached/);
});

test("a resident's sketchbook is THEIRS — withheld from everyone else, and withheld as null", async () => {
  const rows = [{ id: "errant/a-chalk-line", by: "errant", kind: "sited", body: "not for anyone yet" }];
  const mine = await marksRead("errant", { repo, key: KEY_ERRANT, docketFor: docketWith([]), draftsFor: draftsWith(rows) });
  assert.equal(mine.counts.drafts_mine, 1);
  assert.equal(mine.drafts_mine.length, 1);

  // A stranger — and note this key HOLDS A RESIDENT, just not this one. The gate
  // is the key's handles, never the household name a caller could claim.
  const theirs = await marksRead("errant", { repo, key: STRANGER, docketFor: docketWith([]), draftsFor: draftsWith(rows) });
  assert.equal(theirs.counts.drafts_mine, null, "null, not 0 — an empty list would be a claim about their drafts");
  assert.equal(theirs.drafts_mine, null);
  assert.match(theirs.drafts_withheld, /lives only in its own household's reading of the world/);
  assert.equal(theirs.drafts_unreadable, undefined, "withheld and unreadable are different words for different states");

  // And an anonymous caller is a stranger too.
  const anon = await marksRead("errant", { repo, key: null, docketFor: docketWith([]), draftsFor: draftsWith(rows) });
  assert.equal(anon.counts.drafts_mine, null);
  assert.ok(anon.drafts_withheld);
});

test("your OWN sketchbook that could not be read says so, and is not read as empty", async () => {
  const a = await marksRead("errant", { repo, key: KEY_ERRANT, docketFor: docketWith([]), draftsFor: draftsDown });
  assert.equal(a.counts.drafts_mine, null);
  assert.equal(a.drafts_mine, null);
  assert.match(a.drafts_unreadable, /the overlay refused/);
  assert.equal(a.drafts_withheld, undefined, "yours is not withheld from you");
});

test("an unreadable world checkout does not become 'this resident made nothing'", async () => {
  const gone = join(scratch, "no-world-here");
  const a = await marksRead("errant", { repo: gone, docketFor: docketWith([]), draftsFor: draftsWith([]) });
  assert.equal(a.counts.published, null, "null, not 0");
  assert.equal(a.published, null);
  assert.match(a.published_unreadable, /could not be read/);
});

test("the counts block the resident card carries is the same derivation, and each tense reports itself", async () => {
  const own = await marksCountsFor("errant", { repo, key: KEY_ERRANT, docketFor: docketWith([{ id: 1 }]), draftsFor: draftsWith([{ id: 2 }]) });
  assert.deepEqual({ published: own.published, docket: own.docket, drafts_mine: own.drafts_mine },
    { published: 3, docket: 1, drafts_mine: 1 });

  const seen = await marksCountsFor("errant", { repo, key: STRANGER, docketFor: docketDown(), draftsFor: draftsWith([{ id: 2 }]) });
  assert.equal(seen.published, 3, "what they made in public is public");
  assert.equal(seen.docket, null);
  assert.ok(seen.docket_unreadable);
  assert.equal(seen.drafts_mine, null);
  assert.ok(seen.drafts_withheld, "and the card says WHY it is null, so a renderer cannot print it as zero");
});

test("the read asks who, rather than guessing", async () => {
  const b = await marksRead("", { repo });
  assert.equal(b.code, 422);
  assert.match(b.defect, /whose marks/);
  assert.match(b.hint, /read: "residents"/, "and names the roster");
});
