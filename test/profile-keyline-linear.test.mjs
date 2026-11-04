// profile-keyline-linear.test.mjs — POS-875: a resident's own key line parses in linear time.
//
// THE DEFECT. parseFrontmatterScalars (src/profiles.mjs) matched each frontmatter line with
// /^([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/. Both `[ \t]*` and `(.*)` can take a space, so on a line
// that `.` can't finish (a lone CR, U+2028 or U+2029 all survive split(/\r?\n/)) the engine tried
// every split of the spaces between the two before it gave up: quadratic in the line. One
// 63,015-character PROFILE.md line took 11.8 s, inside readProfile's 64,000 guard, and Node
// answers nothing else meanwhile. ADDRESS.md reaches the same function through pronounsInClone,
// with no guard at all. (Found by the Truey on office #825, Finding 2; on main since 0771b3242.)
//
// THE BOUND, AND WHY IT IS TIME. Nothing counts a regex's backtracking steps from JavaScript, so
// these tests bound wall time, and generously: 1,000 ms for one parse of about 64,000 characters.
// The linear parse takes about a millisecond; the old regex takes about 12 s per case. The margin
// is about a thousand on each side, so a slow runner can't red it and a quadratic regex can't
// pass it. The control at the bottom is the same document with the terminator replaced by a
// letter: it stays green on the old regex while every case above it reds.
//
// Every input here is invented. The temp clones are left in the OS temp dir, as the other
// pronouns tests leave theirs.
//   node --import ./test/helpers/sparse-guard.mjs --test test/profile-keyline-linear.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProfile, pronounsInClone } from "../src/profiles.mjs";

// LAW (POS-875, done when): "a key line of any content up to the guard parses in linear time".
const LAW = 'POS-875: "a key line of any content up to the guard parses in linear time"';
const GUARD = 64_000; // readProfile's MAX_PROFILE_BYTES: a longer file reads as no profile
const BOUND_MS = 1_000;
const TERMINATORS = { "a lone CR": "\r", "a lone U+2028": " ", "a lone U+2029": " " };

// A whole file of exactly GUARD - 10 characters: the fence, one key line holding the run of
// whitespace and the lone terminator, then a line the parse must still reach, then the fence.
function fileWith({ key, space, tail, after }) {
  const head = `---\n${key}:`;
  const rest = `${tail}\n${after}\n---\n`;
  const text = head + space.repeat(GUARD - 10 - head.length - rest.length) + rest;
  assert.equal(text.length, GUARD - 10, "the file sits just inside readProfile's guard");
  return text;
}

function cloneWith(file, text) {
  const town = mkdtempSync(join(tmpdir(), "pos875-keyline-"));
  mkdirSync(join(town, "WHITE_PAGES", "a"), { recursive: true });
  writeFileSync(join(town, "WHITE_PAGES", "a", file), text);
  return town;
}

function timed(fn) {
  const t0 = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t0 };
}

// PROFILE.md, through readProfile and its guard: spaces, then each terminator.
for (const [name, end] of Object.entries(TERMINATORS)) {
  test(`PROFILE.md: a bio line of about 64,000 spaces then ${name} parses in under ${BOUND_MS} ms, and reads as before`, () => {
    const town = cloneWith("PROFILE.md", fileWith({ key: "bio", space: " ", tail: `${end}x`, after: "pronouns: they/them" }));
    const { value, ms } = timed(() => readProfile(town, "a"));
    assert.ok(ms < BOUND_MS, `${LAW}; this parse took ${ms.toFixed(0)} ms`);
    // The line `.` can't finish is skipped, as it always was; the line after it still reads.
    assert.deepEqual(value, { pronouns: "they/them" });
  });
}

// ADDRESS.md, through pronounsInClone (no profile, so ADDRESS answers): tabs, then each terminator.
for (const [name, end] of Object.entries(TERMINATORS)) {
  test(`ADDRESS.md: a key line of about 64,000 tabs then ${name} parses in under ${BOUND_MS} ms, and the pronouns after it still read`, () => {
    const town = cloneWith("ADDRESS.md", fileWith({ key: "note", space: "\t", tail: `${end}x`, after: "pronouns: she/her" }));
    const { value, ms } = timed(() => pronounsInClone(town, "a"));
    assert.ok(ms < BOUND_MS, `${LAW}; this parse took ${ms.toFixed(0)} ms`);
    assert.equal(value, "she/her");
  });
}

// CONTROL: the same file with a letter where the terminator was. The old regex matched it at
// once too, so this stays green on main while the cases above red. Its answer shows the key line
// itself is read (the whitespace trimmed away), not skipped.
test("control: the same 64,000 spaces then a letter parse fast on either regex, and the bio reads", () => {
  const town = cloneWith("PROFILE.md", fileWith({ key: "bio", space: " ", tail: "yx", after: "pronouns: they/them" }));
  const { value, ms } = timed(() => readProfile(town, "a"));
  assert.ok(ms < BOUND_MS, `the control took ${ms.toFixed(0)} ms`);
  assert.deepEqual(value, { bio: "yx", pronouns: "they/them" });
});
