// pos-923-input-boundary.test.mjs — the resident-supplied values a letter writes into its frontmatter, and what a refusal may say of them (POS-923, items 1 and 3).
//
//   node --test test/pos-923-input-boundary.test.mjs
//
//   1. stake_candidate is ONE SHORT LINE, judged as `thread` is: the thread's own 255-character cap, and no LF, CR, U+2028 or U+2029, judged BEFORE trimming so a terminator trimming
//      would hide is still refused; spaces and any Unicode spelling still land, padding is still trimmed, and the stake trio stays all-or-none;
//   2. a value is judged by its TYPE before any coercion it controls: a null-prototype object, one whose toString throws or an array nested 20,000 deep is a 422 naming its
//      type, never a 500 (the REST door answered 500 on `String(thread)`), and nothing is written;
//   3. no refusal echoes a value whole: a long value is cut short, an object is named by `typeof`;
//   4. every refusal drives the REAL validation path (enqueueLetter), leaves the clone untouched, and the same writer lands an honest letter straight after (a live control).
//   The controls are capable of turning red: each case below fails on the code before this change (a hostile value threw, a U+2028 candidate landed).

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tempClone, fixtureKey, fixtureTown } from "./fixture.mjs";
import { enqueueLetter } from "../src/write.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

delete process.env.TOWN_PUSH;

const db = fixtureTown();
const IX = await indexStore(db);
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });

const ok = { from: "wright", to: "limen", title: "a fine hat", thread: "new", body: "Limen —\n\nA test letter." };
const stake = { stake_topic: "the-name", stake_candidate: "Waystation", stake_stamps: 3 };
const outboxOf = (clone) => join(clone, "WHITE_PAGES", "wright", "outbox");
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const deepArray = (depth) => { let a = []; for (let i = 0; i < depth; i += 1) a = [a]; return a; };
const nullProto = () => Object.create(null);
const throwingToString = () => ({ toString() { throw new Error("hostile"); }, valueOf() { throw new Error("hostile"); } });
const HOSTILE = { "a null-prototype object": nullProto, "one whose coercion throws": throwingToString, "an array nested 20,000 deep": () => deepArray(20_000) };

const bounce = (payload) => {
  try { enqueueLetter(payload, fixtureKey, db, "unused"); } catch (e) { return e; }
  assert.fail("expected a bounce");
};

/** The REAL validation + write path on a fresh clone: the refusal, proof nothing was written, and a live control. */
function refusedOnClone(payload) {
  const clone = tempClone();
  try {
    let e = null;
    try { enqueueLetter(payload, fixtureKey, db, clone); } catch (err) { e = err; }
    assert.ok(e, "the letter was refused");
    assert.equal(e.code, 422, `a 422, not a trip: ${e.stack?.split("\n")[0]}`);
    assert.ok(e.message.length < 160, `the refusal does not echo the value whole (${e.message.length} chars)`);
    assert.equal(existsSync(outboxOf(clone)) ? readdirSync(outboxOf(clone)).length : 0, 0, "nothing was written");
    enqueueLetter({ ...ok, thread: "new" }, fixtureKey, db, clone);
    assert.equal(readdirSync(outboxOf(clone)).length, 1, "control: the same writer lands an honest letter");
    return e;
  } finally { rmSync(clone, { recursive: true, force: true }); }
}

const BAD_CANDIDATES = {
  "a line feed inside": "Way\nstation",
  "a lone CR inside": "Way\rstation",
  "a U+2028 inside": `Way${LS}station`,
  "a U+2029 inside": `Way${PS}station`,
  "a trailing line feed (trimming would hide it)": "Waystation\n",
  "a trailing CR (trimming would hide it)": "Waystation\r",
  "a leading U+2028 (trimming would hide it)": `${LS}Waystation`,
  "a trailing U+2029 (trimming would hide it)": `Waystation${PS}`,
  "a line and stake lines of its own": "Waystation\nstake_stamps: 99",
  "256 characters": "a".repeat(256),
  "200,000 characters": "a".repeat(200_000),
};
for (const [name, stake_candidate] of Object.entries(BAD_CANDIDATES)) {
  test(`a stake_candidate with ${name} → 422 and no letter is written`, () => {
    const e = refusedOnClone({ ...ok, ...stake, stake_candidate });
    assert.match(e.defect, /^stake_candidate (must be one line|is too long: at most 255 characters \(yours has \d+\))$/);
    assert.doesNotMatch(e.message, /Waystation|stake_stamps/, "the value is not echoed");
  });
}

test("legitimate candidate spellings still land: spaces, Unicode, padding trimmed, exactly 255 characters, a tab", () => {
  for (const [given, written] of [["Way Station", "Way Station"], ["Ünï Cödé — 北京 🚉", "Ünï Cödé — 北京 🚉"], ["  padded  ", "padded"], ["a".repeat(255), "a".repeat(255)], ["tab\tinside", "tab\tinside"]]) {
    const clone = tempClone();
    try {
      enqueueLetter({ ...ok, title: "my ballot", ...stake, stake_candidate: given }, fixtureKey, db, clone);
      const text = readFileSync(join(outboxOf(clone), readdirSync(outboxOf(clone))[0]), "utf8");
      assert.ok(text.includes(`\nstake_candidate: ${written}\nstake_stamps: 3\n---\n`), `landed as ${JSON.stringify(written.slice(0, 20))}`);
    } finally { rmSync(clone, { recursive: true, force: true }); }
  }
});

test("the stake trio is still all-or-none, and a valid trio lands after thread: (stamps coerced to a bare integer)", () => {
  assert.match(bounce({ ...ok, stake_topic: "the-name", stake_candidate: "Waystation" }).defect, /incomplete stake/);
  const clone = tempClone();
  try {
    enqueueLetter({ ...ok, title: "my ballot", ...stake, stake_stamps: "3" }, fixtureKey, db, clone);
    const text = readFileSync(join(outboxOf(clone), readdirSync(outboxOf(clone))[0]), "utf8");
    assert.match(text, /thread: new\nstake_topic: the-name\nstake_candidate: Waystation\nstake_stamps: 3\n---\n/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

for (const [name, make] of Object.entries(HOSTILE)) {
  for (const field of ["stake_candidate", "stake_topic", "stake_stamps"]) {
    test(`${field} as ${name} → 422 by type, never a 500, nothing written`, () => {
      const e = refusedOnClone({ ...ok, ...stake, [field]: make() });
      assert.match(e.message, new RegExp(`^${field} must be (text|a positive whole number), not \\(a object\\)$`));
    });
  }
  test(`a thread that is ${name} → the normal 422 naming its type, never a 500, nothing written`, () => {
    const e = refusedOnClone({ ...ok, thread: make() });
    assert.equal(e.message, "thread (a object) is not a letter id");
    assert.match(e.hint, /"new", or to the exact id of the letter you are answering/);
  });
}

test("from, to, title and body that are not text → 422 by type, never a 500", () => {
  for (const field of ["from", "to", "title", "body"]) {
    for (const make of Object.values(HOSTILE)) {
      const e = bounce({ ...ok, [field]: make() });
      assert.equal(e.code, 422, `${field}: ${e.stack?.split("\n")[0]}`);
      assert.equal(e.message, `${field} must be text, not (a object)`);
    }
  }
});

test("valid thread ids and the default still pass: `new`, no thread at all, and a real letter id", () => {
  for (const thread of ["new", undefined, "limen-2026-07-01-to-wright-the-gap"]) {
    const clone = tempClone();
    try {
      const r = enqueueLetter({ ...ok, thread }, fixtureKey, db, clone);
      assert.match(r.commit, /^[0-9a-f]{40}$/);
      const text = readFileSync(join(outboxOf(clone), readdirSync(outboxOf(clone))[0]), "utf8");
      assert.match(text, new RegExp(`\\nthread: ${thread ?? "new"}\\n`));
    } finally { rmSync(clone, { recursive: true, force: true }); }
  }
});

test("refusals say how long, never what: a 5,000-character thread, recipient, sender, topic and stamps are cut short", () => {
  assert.ok(bounce({ ...ok, thread: "x".repeat(5_000) }).message.length < 80);
  assert.ok(bounce({ ...ok, to: "z".repeat(5_000) }).message.length < 80);
  assert.ok(bounce({ ...ok, from: "q".repeat(5_000) }).message.length < 80);
  assert.ok(bounce({ ...ok, ...stake, stake_topic: "T".repeat(5_000) }).message.length < 80);
  assert.ok(bounce({ ...ok, ...stake, stake_stamps: `${"9".repeat(5_000)}x` }).message.length < 100);
});
