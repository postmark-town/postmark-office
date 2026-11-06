// ballot-pass-keyline-linear.test.mjs — POS-921: the ballot pass reads a letter's key line in linear time.
//
// THE DEFECT. tools/ballot-pass-run.mjs parses EVERY letter in the postmaster's inbox at each
// crossing (before it asks whether the letter is a ballot), and its key-line regex matched
// `key:\s*(.*)$`. The blank-eating `\s*` and `(.*)` can take the same blanks, and `.` stops at a line
// terminator that `\s` does not (a lone CR, U+2028 or U+2029 survive the LF split). On a line `.` can't
// finish, the engine tried every split of the blanks before it gave up: quadratic in the line. A
// resident's letter could carry such a line (the `thread:` value was written unvalidated), and the pass
// runs inside the ferry's lock chain with no timeout. The fix is one lookahead that keeps the value from
// starting on a blank `\s*` took. It is the same one-line change POS-877 made on the train (office #943,
// whose test file key-line-regex-linear.test.mjs covers the six parsers there, this one among them): this
// file is the main-side copy for the hotfix, so the crossing is safe before the train ships.
//
// THE BOUND, AND WHY IT IS TIME. Nothing counts a regex's backtracking steps from JavaScript, so this
// bounds wall time, generously: 1,000 ms for one parse of a 100,000-character line. The linear parse takes
// about a millisecond; the old regex takes several seconds there. The control is the same input with a
// letter where the terminator was: it stays green on the old regex while the pathological cases red.
//
// SAME ANSWERS. A grid of short tails goes through the real parser and is compared with a reference
// written with string operations only (trimStart, trim), never the regex under test.
//
// Every input here is invented.
//   node --import ./test/helpers/sparse-guard.mjs --test test/ballot-pass-keyline-linear.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { parseFrontmatter } from "../tools/ballot-pass-run.mjs";

const LAW = 'POS-877/POS-921: "every super-linear key-line regex in office tools/ is linear, with the same answers"';
const BIG = 100_000;
const BOUND_MS = 1_000;
// The line terminators `.` refuses and `\s` accepts, other than LF (the parser splits on LF first).
const TERMINATORS = { "a lone CR": "\r", "a lone U+2028": String.fromCharCode(0x2028), "a lone U+2029": String.fromCharCode(0x2029) };
const LT = String.fromCharCode(0x2028);

const timed = (fn) => {
  const t0 = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t0 };
};

// A grid of short tails (what follows `key:`), built from the characters that decide the answers.
// A tail ending in CR is left out: a CR before the next LF is no longer a lone CR after the CRLF normaliser.
const ALPHABET = [" ", "\t", "\r", LT, "\v", String.fromCharCode(0xa0), "x"];
function tails(maxLen) {
  const out = [""];
  let layer = [""];
  for (let len = 1; len <= maxLen; len++) {
    const next = [];
    for (const s of layer) for (const c of ALPHABET) next.push(s + c);
    out.push(...next);
    layer = next;
  }
  return out;
}
const GRID_NO_TRAILING_CR = tails(4).filter((t) => !t.endsWith("\r"));
const TERMINATOR_CHARS = [13, 10, 0x2028, 0x2029].map((c) => String.fromCharCode(c)); // what `.` will not cross
const HAS_TERMINATOR = (s) => TERMINATOR_CHARS.some((c) => s.includes(c));
const keyOf = (i) => `k${i}`;

for (const [name, end] of Object.entries(TERMINATORS)) {
  test(`ballot-pass-run: a letter line of about 100,000 blanks then ${name} reads in under ${BOUND_MS} ms, and the lines after it still read`, () => {
    for (const tail of [`${" ".repeat(BIG)}${end}x${end}y`, `${"\t".repeat(BIG)}x${end}y`]) {
      const { value, ms } = timed(() => parseFrontmatter(`---\nthread:${tail}\nstake_topic: t\n---\n\nmy ballot\n`));
      assert.ok(ms < BOUND_MS, `${LAW}; this read took ${ms.toFixed(0)} ms`);
      assert.deepEqual(value, { stake_topic: "t" }, "the line `.` can't finish is skipped, as it always was");
    }
  });
}

test("control: a letter line of 100,000 blanks then a letter reads fast, and the value is read", () => {
  const { value, ms } = timed(() => parseFrontmatter(`---\nthread:${" ".repeat(BIG)}yx\nstake_topic: t\n---\n\nmy ballot\n`));
  assert.ok(ms < BOUND_MS, `the control took ${ms.toFixed(0)} ms`);
  assert.deepEqual(value, { thread: "yx", stake_topic: "t" });
});

test("ballot-pass-run: short tails read as the string-operation reference reads them", () => {
  const cases = GRID_NO_TRAILING_CR;
  const fields = parseFrontmatter(`---\n${cases.map((t, i) => `${keyOf(i)}:${t}`).join("\n")}\n---\n\nbody\n`);
  let read = 0;
  cases.forEach((tail, i) => {
    const rest = tail.trimStart();
    const want = HAS_TERMINATOR(rest) ? undefined : rest.trim();
    assert.equal(fields[keyOf(i)], want, `${LAW}; tail ${JSON.stringify(tail)}`);
    if (want !== undefined) read++;
  });
  assert.ok(read > 100 && read < cases.length, `the grid has both answers (${read} read of ${cases.length})`);
});
