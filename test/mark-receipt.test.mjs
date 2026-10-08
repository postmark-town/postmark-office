// mark-receipt.test.mjs — the canon receipt, in every tense the record has.
//
// THE PROMISE UNDER TEST, verbatim, from the town's bulletin entry `the-world`:
//
//   "If your mark does not ride a crossing, the reason is knowable — held,
//    contested, unbacked, or malformed — and the door will tell you which."
//
// and the plan of record's own rule for this lane: "'No mark' is only for a
// mark the record never saw. A withdrawn mark, an unindexed-but-published mark,
// and a never-was are three states and get three sentences."
//
// The derivation is PURE over records, so every tense below is built by hand —
// no settlement, no candle, no clone, no Postgres. That is deliberate:
// `receiptFrom` IS the decision about what a resident is told, and a test that
// could only reach it through a live store would be asserting the store.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { receiptFrom, causeOf, checkNameOf, CAUSE_WORDS, RECEIPT_CLOCK, settlementThatCarried } from "../src/mark-receipt.mjs";

const ID = "wright/the-flip-day-plumb-line";
const S59 = { s: 59, sha: "5c2321aef89e65ac946b5d3b1dc4073da8af5f12", at: "2026-09-06T05:45:00Z" };
const CANON = { id: ID, by: "wright", kind: "thing", body: "a plumb line", at: { x: 1, y: 2 } };
const claim = (over = {}) => ({
  id: "c-1", slug: ID, class: "mark", claimant: "wright", household: "gh:67605380",
  status: "pending", window_id: 174, submitted_at: "2026-09-05T19:13:13Z",
  decided_at: null, refusal_check: null, stake: 1, supersedes: null, ...over,
});

// ── the walk's own mark, in the tense that produced the stopper ─────────────

test("#2526's shape: staked, on the docket, canon does not hold it — PENDING, not 'no mark'", () => {
  const r = receiptFrom({ id: ID, canon: null, claims: [claim()], settlement: S59 });
  assert.equal(r.status, "pending");
  assert.equal(r.window, 174, "the candle's window, and it is labelled as the candle's");
  assert.match(r.says, /pending at window 174/);
  assert.match(r.says, /2026-09-05T19:13:13Z/, "a resident is told WHEN it went forward");
  assert.deepEqual(r.sources, ["claims"], "the receipt names the record that answered");
});

test("the refusal the bulletin promised: refused@window, with the cause in the bulletin's own five words", () => {
  const r = receiptFrom({
    id: ID, canon: null, settlement: S59,
    claims: [claim({ status: "refused", refusal_check: "escrow", decided_at: "2026-09-06T17:45:00Z" })],
  });
  assert.equal(r.status, "refused");
  assert.equal(r.cause, "unbacked");
  assert.ok(CAUSE_WORDS.includes(r.cause), "the cause must be one of the five the bulletin published");
  assert.equal(r.cause_row, 'claims.refusal_check = "escrow"', "and it names the row it came from");
  assert.match(r.says, /refused at window 174 — unbacked/);
});

test("AN UNMAPPED CHECK IS NOT 'malformed' — the receipt says it has no word yet, and names the row", () => {
  const r = receiptFrom({
    id: ID, canon: null, settlement: S59,
    claims: [claim({ status: "refused", refusal_check: "some-check-nobody-classified" })],
  });
  assert.equal(r.status, "refused");
  assert.equal(r.cause, null, "guessing one of five promised words is keeping the promise in appearance only");
  assert.equal(r.cause_row, 'claims.refusal_check = "some-check-nobody-classified"');
  assert.match(r.says, /no word in the bulletin's five yet/);
});

test("held_review is 'held' — a mind rules on it; it did not ride and it was not refused", () => {
  const r = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [claim({ status: "held_review" })] });
  assert.equal(r.status, "held_review");
  assert.equal(r.cause, "held");
});

test("locked: the candle ruled for it, and the receipt does not pretend it is on the world yet", () => {
  const r = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [claim({ status: "locked" })] });
  assert.equal(r.status, "locked");
  assert.match(r.says, /it reaches the world at the settlement that carries the window/);
});

// ── the three absences, three sentences (walk #7 item 4) ────────────────────

test("PUBLISHED names the settlement that carried it, by number AND sha", () => {
  const r = receiptFrom({ id: ID, canon: CANON, published_at: S59, settlement: S59, claims: [] });
  assert.equal(r.status, "published");
  assert.equal(r.settlement_sha, S59.sha);
  assert.deepEqual(r.crossing, S59);
  assert.match(r.says, /published at S59 \(5c2321ae\)/);
});

test("published but the tags cannot say WHICH settlement — it says that, and invents no S-number", () => {
  const r = receiptFrom({ id: ID, canon: CANON, published_at: null, settlement: null, claims: [] });
  assert.equal(r.status, "published");
  assert.equal(r.settlement_sha, null);
  assert.match(r.says, /which settlement carried it could not be read from the tags/);
  assert.doesNotMatch(r.says, /S\d/, "an invented S-number is worse than an absent one");
});

test("WITHDRAWN, still standing: canon holds it and the resident has declared the removal", () => {
  const r = receiptFrom({ id: ID, canon: CANON, published_at: S59, settlement: S59, claims: [], withdrawn: true });
  assert.equal(r.status, "published");
  assert.match(r.withdrawal_standing, /it stands in the world until a crossing carries the removal/);
});

test("WITHDRAWN, nothing left standing — its own sentence, not 'no mark'", () => {
  const r = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [], withdrawn: true });
  assert.equal(r.status, "withdrawn");
  assert.match(r.says, /you let this one go/);
});

test("DRAFT: private, and the receipt says what would put it forward", () => {
  const r = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [claim({ status: "draft", window_id: 174 })] });
  assert.equal(r.status, "draft");
  assert.match(r.says, /on no docket and in no public answer/);
  assert.match(r.says, /Staking it is what puts it forward/);
});

test("a sketchbook-only mark (no claim row at all) is also a draft — the pre-flag half still answers", () => {
  const r = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [], sketchbook: { id: ID, status: "added" } });
  assert.equal(r.status, "draft");
  assert.ok(r.sources.includes("sketchbook"));
});

test("NEVER-WAS is the only case that may say the record holds no such mark", () => {
  const r = receiptFrom({ id: "nobody/a-thing-that-was-not", canon: null, settlement: S59, claims: [] });
  assert.equal(r.status, "never-was");
  assert.match(r.says, /no canon entry, no claim on the docket, and nothing in your own compose space/);
});

// ── the disclosure: an unreadable docket is never an empty one ──────────────

test("claims: null and claims: [] are DIFFERENT — an unreadable store discloses instead of answering 'never-was'", () => {
  const readable = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [] });
  const unreadable = receiptFrom({ id: ID, canon: null, settlement: S59, claims: null });

  assert.equal(readable.status, "never-was");
  assert.equal(readable.docket, undefined, "a store that answered has nothing to disclose");

  assert.equal(unreadable.status, "never-was");
  assert.equal(unreadable.docket.readable, false);
  assert.match(unreadable.docket.reason, /a claim standing on the docket would not appear in it/);
  assert.match(unreadable.says, /the docket could not be read/,
    "the law is the-town/the-disclosure — refuse or disclose absent inputs; never quietly substitute");
});

// ── the clock, named on every answer (R4) ──────────────────────────────────

test("EVERY receipt names its clock, and the word 'crossing' here is the SETTLEMENT's", () => {
  for (const records of [
    { id: ID, canon: CANON, published_at: S59, settlement: S59, claims: [] },
    { id: ID, canon: null, settlement: S59, claims: [claim()] },
    { id: ID, canon: null, settlement: S59, claims: [] },
    { id: ID, canon: null, settlement: S59, claims: null },
  ]) {
    const r = receiptFrom(records);
    assert.equal(r.clock, RECEIPT_CLOCK, "a receipt that did not name its clock is the R4 finding, shipped");
    assert.match(r.clock, /SETTLEMENT epoch/);
    assert.match(r.clock, /not the ferry's 00:00\/12:00Z crossing/);
  }
});

test("`window` is the candle's and `crossing` is the settlement's — the two are never the same field", () => {
  const r = receiptFrom({ id: ID, canon: CANON, published_at: S59, settlement: S59, claims: [claim({ status: "locked" })] });
  assert.equal(r.window, 174, "the candle's window rides `window`");
  assert.equal(r.crossing.s, 59, "the settlement epoch rides `crossing`");
  assert.notEqual(r.window, r.crossing.s);
});

// ── the field nothing records ──────────────────────────────────────────────

test("site_pin is null and stays null — nothing in the office records what the site is pinned to", () => {
  const r = receiptFrom({ id: ID, canon: CANON, published_at: S59, settlement: S59, claims: [] });
  assert.equal(r.site_pin, null,
    "a FINDING, not a schema change: either the site publishes its pin at a door the office can read, or the field leaves the shape");
});

// ── latest-wins over the row history ───────────────────────────────────────

test("the NEWEST row decides the tense; the older ones are its history, never an average", () => {
  const rows = [
    claim({ id: "c-2", status: "refused", refusal_check: "geometry", submitted_at: "2026-09-06T02:00:00Z" }),
    claim({ id: "c-1", status: "draft", submitted_at: "2026-09-05T19:13:13Z" }),
  ];
  const r = receiptFrom({ id: ID, canon: null, settlement: S59, claims: rows });
  assert.equal(r.status, "refused");
  assert.equal(r.cause, "malformed");
});

// ── the map itself ─────────────────────────────────────────────────────────

test("causeOf maps every check it knows into the bulletin's five, and nothing else", () => {
  assert.deepEqual(causeOf("collision"), { cause: "contested", cause_row: 'claims.refusal_check = "collision"' });
  assert.equal(causeOf("QUARANTINE").cause, "quarantined", "the map is case-insensitive on the check");
  assert.equal(causeOf("held").cause, "held", "a check already spelled as one of the five passes through");
  assert.deepEqual(causeOf(null), { cause: null, cause_row: null });
  assert.deepEqual(causeOf("  "), { cause: null, cause_row: null });
});

// ── THE STRINGS THE TOWN ACTUALLY WRITES ───────────────────────────────────
//
// The first version of this map was built from the SWEEP's channel names and
// never measured against the CANDLE's writers — so it matched none of the eight
// strings `refusal_check` can actually hold, and every live refusal answered
// `cause: null`. The lane's own charter is "measure the premise first", and the
// premise here was a vocabulary nobody had read.
//
// EVERY WRITER EMITS `<name>: <detail>`. These eight are copied VERBATIM from
// the two files that write the column, with the line each came from, so the leg
// cannot drift into asserting a shape this file invented:
//
//   world2/tools/clearing-job.mjs  lines 129, 131, 141, 158, 176, 190-191
//   world2/tools/review-rule.mjs   line  247, 248
//
// If a writer gains a ninth prefix, this table does not know about it and the
// receipt answers `null` — which is the honest failure and is asserted below.
const REAL_REFUSAL_CHECKS = [
  ["duplicate: a standing mark already carries this slug", "contested", "clearing-job.mjs:131"],
  ["duplicate: a standing mark carries this slug, and this claim supersedes ab12cd34, which is not it", "contested", "clearing-job.mjs:129"],
  ["superseded: a later claim in this window amends this one", "contested", "clearing-job.mjs:141"],
  ["insufficient-stamps: staked 3, liquid 1 at town 9f2a1b0c", "unbacked", "clearing-job.mjs:158"],
  ['parcel-overlap: standing parcel "k-of-garrison/the-long-field"', "contested", "clearing-job.mjs:176"],
  ["counterclaim: collides with 77 — a mind rules (census D2)", "contested", "clearing-job.mjs:190-191"],
  ["review-ruling: wright refused this contest — the ground was already spoken for", "contested", "review-rule.mjs:247"],
  ["review-ruling: wright granted the-long-field — the elder claim stands", "contested", "review-rule.mjs:248"],
  // ⚑ THE SIXTH WORD, RULED 2026-09-08 (postmark#2594). This answered `null` for
  // one lap — none of the four bulletin words nor `quarantined` is honest about
  // a mark the WORLD has no file for — and the founder then classified it as
  // `unpublished`. It lives in THIS list rather than in a test of its own
  // because this list is "every refusal string the town can write", and an
  // exception kept somewhere else is an exception nobody re-reads. THE TOWN HALF
  // IS STILL OWED: the bulletin's published sentence lists four.
  ["canon-absent: lupi/the-drift-room @ 91536f76", "unpublished", "falsifier-canon-locks.mjs (the nightly read; no candle step writes it) / canon-register.mjs"],
  // ⚑ THE TWO #2594 CHECKS — escrow at the candle, canon on the nightly read —
  // ANSWER DIFFERENT WORDS, ON PURPOSE. `canon-absent`
  // says the world has no file yet; `escrow-absent` says the world's own sweep
  // would refuse it for want of a stake ("commons needs escrow > 0"). A resident
  // told `unpublished` waits; a resident told `unbacked` stakes. Collapsing them
  // to one word would cost the reader the only thing the difference is for.
  ["escrow-absent: lupi/the-drift-room @ 723005e5", "unbacked", "clearing-job.mjs step 5.5 / escrow-presence.mjs"],
  // ⚑ RULED 2026-10-08 (POS-356): a claim refused alone because the store would not file it.
  ["unfileable: no such household stands in the town for gabo: the town's roll does not name gabo, so this mark had no household to stand in. Nothing else waited on it. Once your house is on the roll, put the mark forward again.", "quarantined", "clearing-job.mjs step 5.4 / materialize.mjs § noHouseCheck"],
  ["unfileable: another mark already carries the name cleo/a-lamp-2, so this one could not be filed under it. Nothing else waited on it. (store: marks_slug_key)", "quarantined", "materialize.mjs § unfileableCheckOf (step 6)"],
  ["unfileable: the move of rei/the-district couldn't carry rei/the-lamp: rei/the-lamp is a sited mark with no place, so it could not be filed. (store: sited_marks_have_a_where)", "quarantined", "clearing-job.mjs step 6.1 (the move as one unit)"],
];

test("EVERY refusal string the town can write gets the word this map decided for it", () => {
  const misses = [];
  for (const [raw, expected, where] of REAL_REFUSAL_CHECKS) {
    const { cause, cause_row } = causeOf(raw);
    if (cause !== expected) misses.push(`${where} → ${JSON.stringify(raw.slice(0, 48))} gave ${JSON.stringify(cause)}, wanted ${JSON.stringify(expected)}`);
    assert.equal(cause_row, `claims.refusal_check = ${JSON.stringify(raw)}`,
      "the whole stored row rides beside the word, so a reader can go check the translation");
  }
  assert.deepEqual(misses, [],
    `${misses.length} of ${REAL_REFUSAL_CHECKS.length} real refusal strings do not map — a promise kept in appearance only`);
});

test("the detail after the colon does not change the word — the PREFIX is the check", () => {
  // Every one of these is `insufficient-stamps` with different arithmetic in it.
  for (const detail of ["staked 3, liquid 1 at town 9f2a1b0c", "staked 1, liquid 0 at town ?", ""]) {
    assert.equal(causeOf(`insufficient-stamps:${detail ? " " + detail : ""}`).cause, "unbacked");
  }
});

test("A CHECK NOBODY HAS CLASSIFIED STILL ANSWERS NULL — the discipline that saved this map", () => {
  for (const invented of [
    "a-check-that-does-not-exist: with a detail",
    "a-check-that-does-not-exist",
    "notaprefix",
  ]) {
    const { cause, cause_row } = causeOf(invented);
    assert.equal(cause, null, "guessing one of five promised words for an unclassified refusal is worse than an absent one");
    assert.equal(cause_row, `claims.refusal_check = ${JSON.stringify(invented)}`);
  }
});

test("a colon inside the DETAIL cannot be read as the check — the split is on the FIRST colon", () => {
  assert.equal(causeOf("review-ruling: wright refused this: it collides").cause, "contested");
});

// ── ONE WORD, ONE STATE (repair 8) ─────────────────────────────────────────
//
// `review-ruling` was mapped to `held` from the WRITER'S NAME — "a mind ruled,
// so: held" — rather than from the STATE that writer leaves the row in.
// `review-rule.mjs:245-248` writes the check ONLY on `refused`; the hold arm
// writes none. So the receipt said "refused at window N — held" on one object,
// while the `held_review` arm defines `held` as "it did not ride and IT WAS NOT
// REFUSED" — the literal opposite. This is the leg that keeps the two apart.

test("a REVIEW refusal and a HELD claim never share a word", () => {
  const refused = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [claim({
    status: "refused", refusal_check: "review-ruling: wright refused this contest — the ground was spoken for" })] });
  const held = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [claim({ status: "held_review" })] });

  assert.equal(refused.cause, "contested", "a mind ruled AGAINST it — the contest is over");
  assert.equal(held.cause, "held", "a mind has not ruled yet");
  assert.notEqual(refused.cause, held.cause,
    "one bulletin word on two opposite states is the defect: a resident told \"refused — held\" concludes a mind is still deciding");
  assert.match(refused.says, /refused at window 174 — contested/);
  assert.match(held.says, /did not ride and it was not refused/);
});

test("a GRANT to somebody else is contested too — you lost the contest, you were not held", () => {
  const r = receiptFrom({ id: ID, canon: null, settlement: S59, claims: [claim({
    status: "refused", refusal_check: "review-ruling: wright granted the-long-field — the elder claim stands" })] });
  assert.equal(r.cause, "contested");
  assert.equal(r.cause_row, 'claims.refusal_check = "review-ruling: wright granted the-long-field — the elder claim stands"',
    "and the row still rides beside the word, so a resident can read who ruled and why");
});

test("`held` is now reachable ONLY from held_review — the word names one state", () => {
  // Every mapped check, and the only one that may answer `held` is the status
  // arm. If a future check earns the word, this leg says so out loud rather
  // than letting two states share it again.
  const viaCheck = REAL_REFUSAL_CHECKS.map(([raw]) => causeOf(raw).cause);
  assert.ok(!viaCheck.includes("held"),
    `a refusal_check mapped to "held": ${JSON.stringify(REAL_REFUSAL_CHECKS.filter(([r]) => causeOf(r).cause === "held").map(([r]) => r))}`);
  assert.equal(receiptFrom({ id: ID, canon: null, settlement: S59, claims: [claim({ status: "held_review" })] }).cause, "held");
});

// ── WHICH SETTLEMENT CARRIED IT — derived, because nothing records it ───────
//
// `WORLD/settlement-publications.json` names which marks are published and, in
// `settlements.mjs`'s own words, "holds neither an index nor a date". So the
// S-number a mark rode is derived from the commit that first added its file and
// the `settlement/S<n>` tags that contain that commit. The fixture below is a
// world repo with three settlements and a mark that landed at the middle one.

const repo = mkdtempSync(join(tmpdir(), "postmark-carried-"));
after(() => rmSync(repo, { recursive: true, force: true }));
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const commit = (m) => git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", m);

put("WORLD/marks/wright/the-terrace/mark.md", "the terrace\n");
git("init", "-q", "-b", "main");
git("add", "-A");
commit("settlement: sweep 1 published");
git("tag", "settlement/S58");

put("WORLD/marks/wright/the-flip-day-plumb-line/mark.md", "a plumb line\n");
git("add", "-A");
commit("settlement: sweep 1 published");
git("tag", "settlement/S59");

put("WORLD/marks/k-of-garrison/a-hand-beside-hers/mark.md", "a hand\n");
git("add", "-A");
commit("settlement: sweep 1 published");
git("tag", "settlement/S60");

test("settlementThatCarried names the FIRST settlement that carried the mark, not the newest", () => {
  const c = settlementThatCarried(repo, "WORLD/marks/wright/the-flip-day-plumb-line/mark.md", { ref: "refs/heads/main" });
  assert.equal(c.s, 59, "S59, S60 and every later tag all CONTAIN the commit — the receipt wants the first");
  assert.equal(c.sha, git("rev-parse", "settlement/S59^{commit}").trim());
});

test("a mark the tags do not carry answers null — never a guessed S-number", () => {
  put("WORLD/marks/wright/an-untagged-thing/mark.md", "after every tag\n");
  git("add", "-A");
  commit("a commit no settlement tag contains");
  assert.equal(settlementThatCarried(repo, "WORLD/marks/wright/an-untagged-thing/mark.md", { ref: "refs/heads/main" }), null);
});

test("a path the repo never held answers null, and does not throw out of a read", () => {
  assert.equal(settlementThatCarried(repo, "WORLD/marks/nobody/never-was/mark.md", { ref: "refs/heads/main" }), null);
  assert.equal(settlementThatCarried(null, "x"), null);
  assert.equal(settlementThatCarried(repo, null), null);
});

// ── THE THREE LIVES A MARK'S FILE CAN HAVE ─────────────────────────────────
//
// Repaired 2026-09-07 on the reviewer's measurement. The first version ran
// `git log --diff-filter=A -1 <ref> -- <path>` and called the answer "the FIRST
// settlement that carried it". `-1` returns the NEWEST add, not the first, and
// without `--follow` a rename reads as an add at the new path. Measured on a
// tagged fixture:
//
//   amended after publication   truth S2 · answered S2   ok
//   withdrawn and re-left       truth S4 · answered S6   WRONG
//   file MOVED                  truth S7 · answered S8   WRONG
//
// The third is the live one: the filing freeze says a mark is written once and
// nothing moves it after, and the-town's own class marks were moved in August —
// so the receipt printed the settlement that MOVED the file as the settlement
// that CARRIED the mark, with a real sha, on a receipt whose whole argument is
// that an invented number is worse than an absent one.
//
// Both flags are needed and each fixes a different case: `--follow` fixes the
// move, oldest-add fixes the re-leave.

const lives = mkdtempSync(join(tmpdir(), "postmark-carried-lives-"));
after(() => rmSync(lives, { recursive: true, force: true }));
const lgit = (...a) => execFileSync("git", ["-C", lives, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const lput = (p, t) => { const f = join(lives, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const lsettle = (n, msg) => {
  lgit("add", "-A");
  lgit("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", `settlement: ${msg}`);
  lgit("tag", `settlement/S${n}`);
};
const shaOfS = (n) => lgit("rev-parse", `settlement/S${n}^{commit}`).trim();

const AMENDED = "WORLD/marks/wright/the-amended-thing/mark.md";
const RELEFT = "WORLD/marks/wright/the-re-left-thing/mark.md";
const MOVED_TO = "WORLD/marks/let-there-be-light/the-garden/the-moved-thing/mark.md";
const MOVED_FROM = "WORLD/marks/wright/the-moved-thing/mark.md";

lgit("init", "-q", "-b", "main");
lput("WORLD/README.md", "the world\n");
lsettle(1, "the town begins");

lput(AMENDED, "the first declaration\n");
lsettle(2, "sweep 1 published — the amended thing arrives");          // ← truth for A

lput(AMENDED, "a newer declaration on my own node\n");
lsettle(3, "sweep 0 published — an amend, in place");

lput(RELEFT, "left once\n");
lsettle(4, "sweep 1 published — the re-left thing arrives");          // ← truth for B

rmSync(join(lives, RELEFT));
lsettle(5, "sweep 0 published, 1 withdrawn");

lput(RELEFT, "left again, same slug\n");
lsettle(6, "sweep 1 published — and again");

lput(MOVED_FROM, "a thing on open ground\n");
lsettle(7, "sweep 1 published — the moved thing arrives");            // ← truth for C

mkdirSync(dirname(join(lives, MOVED_TO)), { recursive: true });
lgit("mv", MOVED_FROM, MOVED_TO);
lsettle(8, "operator repair: re-home by geometry");

test("RED CONTROL: the fixture really is three different lives, tagged apart", () => {
  const at = (n, p) => { try { lgit("cat-file", "-e", `settlement/S${n}:${p}`); return true; } catch { return false; } };
  assert.equal(at(2, AMENDED), true, "A must be present from S2");
  assert.equal(at(1, AMENDED), false);
  assert.equal(at(4, RELEFT), true, "B must be present at S4");
  assert.equal(at(5, RELEFT), false, "and GONE at S5 — that is the withdrawal");
  assert.equal(at(6, RELEFT), true, "and back at S6");
  assert.equal(at(7, MOVED_FROM), true, "C must arrive at its ORIGINAL path at S7");
  assert.equal(at(8, MOVED_TO), true, "and stand at the new path at S8");
  assert.equal(at(8, MOVED_FROM), false, "the old path is gone at S8 — that is the move");
});

test("A · a mark AMENDED after publication names the settlement that carried it, not the amend", () => {
  const c = settlementThatCarried(lives, AMENDED, { ref: "refs/heads/main" });
  assert.equal(c.s, 2);
  assert.equal(c.sha, shaOfS(2));
});

test("B · a mark WITHDRAWN and RE-LEFT names the FIRST settlement, not the newest add", () => {
  const c = settlementThatCarried(lives, RELEFT, { ref: "refs/heads/main" });
  assert.equal(c.s, 4, "`-1` answered S6 here — the newest add, not the first");
  assert.equal(c.sha, shaOfS(4));
});

test("C · a mark whose FILE MOVED names the settlement that carried the MARK, not the move", () => {
  const c = settlementThatCarried(lives, MOVED_TO, { ref: "refs/heads/main" });
  assert.equal(c.s, 7, "without --follow the rename read as an add, and the receipt printed S8 with a real sha");
  assert.equal(c.sha, shaOfS(7));
});

// ── the canon-absent FINDING answers `unpublished`, by ruling (postmark#2594) ─
//
// For one lap this answered null by the guess-nothing rule; Keemin then named
// the word (2026-09-08). Asserted separately from the list above so the DECISION
// is legible and not merely a row that happens to expect a word. Nothing at the
// candle writes this check — the lock-time refusal was withdrawn the same day —
// so the string reaches `causeOf` from the nightly read,
// `falsifier-canon-locks.mjs`. A future reader changing the word to `malformed`
// reds here with the reason in front of them, which is the only thing that stops
// a well-meaning "fix" from making the town keep its promise in appearance only.
//
// THE CAN-FAIL FLIP: change `"canon-absent": "unpublished"` to `"malformed"` in
// CAUSE_OF_CHECK, src/mark-receipt.mjs. Both this test and the list test above go red.
test("canon-absent answers `unpublished`, and it is one of the words the town publishes", () => {
  const raw = "canon-absent: darko/the-second-foundation-stone @ a23a8d17";
  const { cause, cause_row } = causeOf(raw);
  assert.equal(cause, "unpublished",
    "a refusal that has a name must not answer null (Keemin, 2026-09-08)");
  assert.ok(CAUSE_WORDS.includes(cause),
    "the word the door answers must be a word the receipt's own vocabulary carries");
  assert.equal(cause_row, `claims.refusal_check = ${JSON.stringify(raw)}`);
  assert.equal(checkNameOf(raw), "canon-absent");
});

test("the guess-nothing rule is UNTOUCHED for the next unclassified check", () => {
  // The thing the fifth word must not cost: classifying one check is not licence
  // to guess at the next. A ruling named `canon-absent`; nothing named this.
  const { cause, cause_row } = causeOf("some-check-the-founder-has-not-ruled-on: with a detail");
  assert.equal(cause, null);
  assert.equal(cause_row, 'claims.refusal_check = "some-check-the-founder-has-not-ruled-on: with a detail"');
});
