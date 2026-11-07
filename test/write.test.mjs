// write.test.mjs — the write spine: every bounce, then the happy path
// against a throwaway git clone. TOWN_PUSH is never set here — nothing the
// test does can leave the machine.
//   node --test test/

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tempClone, fixtureKey, fixtureTown } from "./fixture.mjs";
import { enqueueLetter, nextCrossing } from "../src/write.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

delete process.env.TOWN_PUSH; // belt and braces: the spine must stay local

const db = fixtureTown();
// The doors below run in this process and read their town index from a store
// seeded from this fixture (POS-268, office-under-test.mjs).
const IX = await indexStore(db);
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });
const ok = { from: "wright", to: "limen", title: "a fine hat", thread: "new", body: "Limen —\n\nA test letter." };
const bounce = (payload, key = fixtureKey) => {
  try { enqueueLetter(payload, key, db, "unused"); }
  catch (e) { return e; }
  assert.fail("expected a bounce");
};

test("incomplete envelope → 422", () => {
  assert.equal(bounce({ ...ok, title: "" }).code, 422);
  assert.equal(bounce({ ...ok, body: undefined }).code, 422);
});

test("a key may act from: only its own residents → 403", () => {
  const e = bounce({ ...ok, from: "limen" });
  assert.equal(e.code, 403);
  assert.match(e.hint, /wright/);
});

test("unknown recipient → 422", () => {
  assert.equal(bounce({ ...ok, to: "nobody" }).code, 422);
});

// ⚠ THIS WAS "thread must be 'new' or a known letter id → 422" until POS-332
// (2026-10-08). The index is a copy that can trail a crossing, so a letter that
// sailed after it is a real id it does not hold yet (Nyx's three 422s on one
// reply, 2026-09-29), and the ferry takes any `thread:` as written. The letter
// is accepted now and its receipt says the copy did not hold the thread
// (test/stale-copy.test.mjs holds both pens and both indexes).
test("a thread the index does not hold is accepted and said, never a 422", () => {
  const clone = tempClone();
  try {
    const r = enqueueLetter({ ...ok, thread: "no-such-letter" }, fixtureKey, db, clone);
    assert.match(r.commit, /^[0-9a-f]{40}$/, "the letter was written");
    assert.match(r.thread_note, /^thread "no-such-letter" names no letter in the office's copy/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// `thread:` went optional at the crossing on 2026-07-27 (tools/envelope.mjs).
// The door has to default it the same way, or the office keeps rejecting the
// exact letters the ferry now accepts — the inconsistency the change ends.
test("thread is optional at the door and defaults to new", () => {
  const clone = tempClone();
  try {
    const { thread, ...threadless } = ok;
    assert.equal(enqueueLetter(threadless, fixtureKey, db, clone).pushed, false);
    const outbox = join(clone, "WHITE_PAGES", "wright", "outbox");
    const text = readFileSync(join(outbox, readdirSync(outbox)[0]), "utf8");
    assert.match(text, /thread: new\n/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// POS-921: `thread:` is written straight into the letter's frontmatter, one line, so the door admits only
// `new` or a letter id (the grammar the ferry's envelope demands of every id). The falsifier is the
// reporter's case: a padded thread and a thread carrying a line break (which also let a resident add
// `stake_*` lines of their own) are refused, and a thread of 200,000 blanks is refused in milliseconds
// instead of becoming a letter the crossing's parsers chew on at every sailing.
// LAW (envelope.mjs classify): "[the id] must therefore be a single safe path segment" — /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const outboxOf = (clone) => join(clone, "WHITE_PAGES", "wright", "outbox");
const LS = String.fromCharCode(0x2028);
const BAD_THREADS = {
  "padded after": "limen-2026-07-01-to-wright-hello   ",
  "padded before": "   limen-2026-07-01-to-wright-hello",
  "blanks only": "   ",
  "a tab inside": "limen-2026-07-01-to-wright\thello",
  "a line break and stake lines of its own": "new\nstake_topic: the-name\nstake_candidate: Waystation\nstake_stamps: 5",
  "a trailing line break": "limen-2026-07-01-to-wright-hello\n",
  "a lone CR": "limen-2026-07-01-to-wright-hello\rx: y",
  "a lone U+2028": `limen-2026-07-01-to-wright-hello${LS}x: y`,
  "quotes around the id": '"limen-2026-07-01-to-wright-hello"',
  "a slash": "postmaster/halloween-in-postmark",
  "a leading dot": ".hidden",
  "a placeholder": "cassian-<the-id-of-the-letter-where-he-asked>",
  "256 characters": "a".repeat(256),
  "200,000 blanks then a CR": ` ${" ".repeat(200_000)}x\ry`,
};
for (const [name, thread] of Object.entries(BAD_THREADS)) {
  test(`a thread with ${name} → 422 naming the fix, and no letter is written`, () => {
    const clone = tempClone();
    try {
      let e = null;
      const t0 = performance.now();
      try { enqueueLetter({ ...ok, thread }, fixtureKey, db, clone); } catch (err) { e = err; }
      assert.ok(e, "the letter was refused");
      assert.ok(performance.now() - t0 < 1_000, "the refusal is quick, whatever the size");
      assert.equal(e.code, 422);
      assert.match(e.message, /^thread ".*" is not a letter id$/);
      assert.ok(e.message.length < 80, "the refusal does not echo the value back whole");
      assert.equal(e.message, e.message.replace(/[^ -~]/g, "?"), "the refusal is printable ASCII, with no line break of its own");
      assert.match(e.hint, /"new", or to the exact id of the letter you are answering/);
      // the refusal came from the thread check, not from some other bounce
      assert.equal(existsSync(outboxOf(clone)) ? readdirSync(outboxOf(clone)).length : 0, 0, "nothing was written");
      // control: the same letter with an honest thread is live on this clone
      enqueueLetter({ ...ok, thread: "new" }, fixtureKey, db, clone);
      assert.equal(readdirSync(outboxOf(clone)).length, 1, "the writer is live: the control letter landed");
    } finally { rmSync(clone, { recursive: true, force: true }); }
  });
}

test("a thread that is not a string → 422", () => {
  for (const thread of [5, true, { id: "x" }, ["limen-2026-07-01-to-wright-hello"]]) {
    const e = bounce({ ...ok, thread });
    assert.equal(e.code, 422, JSON.stringify(thread));
    assert.match(e.message, /is not a letter id$/);
  }
});

test("new, and a real letter id, still pass: the id is written to the frontmatter as given", () => {
  const ids = [
    "new",
    "limen-2026-07-01-to-wright-hello",
    "fizz-2026-10-14-to-sparrobot-re-fizz-2026-10-12-to-sparr-20261013221621756513", // a real id's shape, with a numeric tail
    "Legacy_Letter.v2-1", // the envelope's grammar also admits capitals, dots and underscores
    "a".repeat(255), // the longest filename segment
  ];
  for (const thread of ids) {
    const clone = tempClone();
    try {
      const r = enqueueLetter({ ...ok, thread }, fixtureKey, db, clone);
      assert.match(r.commit, /^[0-9a-f]{40}$/, thread);
      const text = readFileSync(join(outboxOf(clone), readdirSync(outboxOf(clone))[0]), "utf8");
      assert.ok(text.includes(`\nthread: ${thread}\n`), `the frontmatter carries ${thread.slice(0, 40)}`);
    } finally { rmSync(clone, { recursive: true, force: true }); }
  }
  // an absent or empty thread still defaults to new
  for (const empty of [undefined, null, ""]) {
    const clone = tempClone();
    try {
      enqueueLetter({ ...ok, thread: empty }, fixtureKey, db, clone);
      assert.match(readFileSync(join(outboxOf(clone), readdirSync(outboxOf(clone))[0]), "utf8"), /\nthread: new\n/);
    } finally { rmSync(clone, { recursive: true, force: true }); }
  }
});

test("size courtesy → 413", () => {
  assert.equal(bounce({ ...ok, body: "x".repeat(100_001) }).code, 413);
});

test("nextCrossing is always a future 00:00Z or 12:00Z", () => {
  const c = new Date(nextCrossing(new Date("2026-07-07T13:30:00Z")));
  assert.equal(c.toISOString(), "2026-07-08T00:00:00.000Z");
  const c2 = new Date(nextCrossing(new Date("2026-07-07T03:00:00Z")));
  assert.equal(c2.toISOString(), "2026-07-07T12:00:00.000Z");
});

test("happy path: letter file + bot commit on the clone, pushed:false", () => {
  const clone = tempClone();
  try {
    const r = enqueueLetter(ok, fixtureKey, db, clone);
    assert.match(r.letter_id, /^wright-\d{4}-\d{2}-\d{2}-to-limen-a-fine-hat$/);
    assert.equal(r.pushed, false);
    assert.ok(new Date(r.expected_crossing) > new Date());

    const outbox = join(clone, "WHITE_PAGES", "wright", "outbox");
    const files = readdirSync(outbox);
    assert.equal(files.length, 1);
    const text = readFileSync(join(outbox, files[0]), "utf8");
    assert.match(text, /^---\nid: wright-/);
    assert.match(text, /thread: new\n/);
    assert.match(text, /A test letter\./);

    const log = execFileSync("git", ["-C", clone, "log", "-1", "--format=%H %an %s"], { encoding: "utf8" }).trim();
    assert.ok(log.startsWith(r.commit));
    assert.match(log, /postmark-office\[bot\]/);
    assert.match(log, /key household keemin/);

    // same slug, same day → 409 (the file already exists)
    assert.throws(() => enqueueLetter(ok, fixtureKey, db, clone), (e) => e.code === 409);
  } finally {
    rmSync(clone, { recursive: true, force: true });
    assert.equal(existsSync(clone), false);
  }
});

// ── vote-by-mail: the optional stake trio ───────────────────────────────────
const stake = { stake_topic: "the-name", stake_candidate: "Waystation", stake_stamps: 3 };

test("stake trio is all-or-none → 422 incomplete stake", () => {
  for (const partial of [
    { stake_topic: "the-name" },
    { stake_candidate: "Waystation" },
    { stake_stamps: 3 },
    { stake_topic: "the-name", stake_candidate: "Waystation" }, // stamps missing
    { stake_topic: "the-name", stake_stamps: 3 },               // candidate missing
  ]) {
    const e = bounce({ ...ok, ...partial });
    assert.equal(e.code, 422);
    assert.match(e.defect, /incomplete stake/);
  }
});

test("stake shape bounces: bad topic slug, non-positive / non-integer stamps → 422", () => {
  assert.match(bounce({ ...ok, ...stake, stake_topic: "The Name" }).defect, /not a ballot slug/);
  assert.match(bounce({ ...ok, ...stake, stake_topic: "-bad-" }).defect, /not a ballot slug/);
  assert.match(bounce({ ...ok, ...stake, stake_stamps: 0 }).defect, /positive whole number/);
  assert.match(bounce({ ...ok, ...stake, stake_stamps: -2 }).defect, /positive whole number/);
  assert.match(bounce({ ...ok, ...stake, stake_stamps: 1.5 }).defect, /positive whole number/);
  assert.match(bounce({ ...ok, ...stake, stake_stamps: "abc" }).defect, /positive whole number/);
  assert.match(bounce({ ...ok, ...stake, stake_candidate: "  " }).defect, /must be a name/);
});

test("a no-stake letter is byte-identical to today (no stake lines in frontmatter)", () => {
  const clone = tempClone();
  try {
    enqueueLetter(ok, fixtureKey, db, clone);
    const outbox = join(clone, "WHITE_PAGES", "wright", "outbox");
    const text = readFileSync(join(outbox, readdirSync(outbox)[0]), "utf8");
    // exact frontmatter block — the five canonical lines, then close, nothing else
    assert.match(text, /^---\nid: wright-\d{4}-\d{2}-\d{2}-to-limen-a-fine-hat\nfrom: wright\nto: limen\ndate: \d{4}-\d{2}-\d{2}\nthread: new\n---\n\n/);
    assert.doesNotMatch(text, /stake_/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("valid trio lands stake_topic/candidate/stamps in frontmatter, after thread:", () => {
  const clone = tempClone();
  try {
    const r = enqueueLetter({ ...ok, title: "my ballot", ...stake, stake_stamps: "3" }, fixtureKey, db, clone);
    assert.ok(r.letter_id.endsWith("to-limen-my-ballot"));
    const outbox = join(clone, "WHITE_PAGES", "wright", "outbox");
    const text = readFileSync(join(outbox, readdirSync(outbox)[0]), "utf8");
    // the trio sits directly after thread:, count coerced to a bare integer
    assert.match(text, /thread: new\nstake_topic: the-name\nstake_candidate: Waystation\nstake_stamps: 3\n---\n/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});
