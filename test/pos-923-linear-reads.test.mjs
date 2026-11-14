// pos-923-linear-reads.test.mjs — the three sibling quadratics office #943 named and left (POS-923, item 4).
//
//   node --test test/pos-923-linear-reads.test.mjs
//
//   · src/queries.mjs § PSA_HEADING            /^##\s+(DATE)\s*(?:\(([^)]*)\))?\s*[—-]\s*(.+?)\s*$/      → psaHeading()
//   · world2/tools/amend-carried.mjs:140       /^date:\s*(.+?)\s*$/m                                     → frontDate()
//   · the unanchored ledger suffix              text.replace(/\s*$/, "\n")  (five call sites)            → endWithNewline()
//
// Each regex is quadratic on a run of blanks it cannot finish (`\s*` and `(.+?)\s*$` eat the same blanks and the engine tries every split). Two kinds of control:
//   1. SAME ANSWERS: the replacement is held against the ORIGINAL regex, byte for byte, over every short string of an alphabet built from the characters that matter (blanks, tabs,
//      every line terminator, the dashes, brackets, `date:`), so ordinary Unicode / whitespace / date / header semantics are kept, quirks included;
//   2. NO LONGER QUADRATIC: the adversarial shapes below, at a size where the regex takes seconds, are read in milliseconds. The budgets are generous (an order of magnitude over
//      what this box measures) so only a quadratic read can miss them. The measured numbers (a laptop, node 22): regex 3,617 ms at 32,000 characters; this, under 5 ms at 400,000.

import test from "node:test";
import assert from "node:assert/strict";
import { psaHeading, parsePsaEntries } from "../src/queries.mjs";
import { frontDate, markFileParts } from "../world2/tools/amend-carried.mjs";
import { endWithNewline } from "../src/text-linear.mjs";

const OLD_PSA = /^##\s+(\d{4}-\d{2}-\d{2})\s*(?:\(([^)]*)\))?\s*[—-]\s*(.+?)\s*$/;
const OLD_DATE = /^date:\s*(.+?)\s*$/m;
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

/** Every string of up to `max` tokens over `tokens`, including the empty one. */
function* strings(tokens, max) {
  let layer = [""];
  yield "";
  for (let n = 1; n <= max; n += 1) {
    const next = [];
    for (const s of layer) for (const t of tokens) { const x = s + t; next.push(x); yield x; }
    layer = next;
  }
}
const norm = (m) => (m ? [m[0], m[1], m[2] ?? null, m[3]] : null);

test("1 · psaHeading gives the regex's answer on every short string: groups, quirks and all", () => {
  const prefixes = ["## 2026-01-01", "## 2026-01-01 (night)", "##  2026-01-01 (", "## 2026-01-01(a)", "## 2026-1-01", "#2026-01-01", "##2026-01-01", "## 2026-01-01 ()", "## 2026-01-01 (a) (b)", "## 2026-01-01 -", "## 2026-01-01 —", "##"];
  const tokens = [" ", "\t", "\r", "\n", LS, PS, "-", "—", "a", "(", ")"];
  let n = 0;
  for (const prefix of prefixes) for (const tail of strings(tokens, 4)) {
    const line = prefix + tail;
    assert.deepEqual(norm(psaHeading(line)), norm(OLD_PSA.exec(line)), `line ${JSON.stringify(line)}`);
    n += 1;
  }
  // longer tails over a smaller alphabet: the blank/terminator interplay is where the backtracking lives
  for (const tail of strings([" ", "\r", "-", "a", LS], 7)) {
    const line = `## 2026-01-01 —${tail}`;
    assert.deepEqual(norm(psaHeading(line)), norm(OLD_PSA.exec(line)), `line ${JSON.stringify(line)}`);
    n += 1;
  }
  assert.ok(n > 100_000, `${n} lines compared`);
});

test("1b · parsePsaEntries keeps the wall's accepted headings: CRLF, qualifier, em dash and hyphen, order and text", () => {
  const wall = ["# Public service announcements", "", "## 2026-08-17 (night) — one door for the world's acts", "Body one.", "", "---", "## 2026-08-17 - a plain hyphen", "Body two.", "## 2026-08-16 — an older one  ", "Body three."].join("\r\n");
  const got = parsePsaEntries(wall);
  assert.deepEqual(got.map((e) => [e.date, e.qualifier, e.title]), [
    ["2026-08-17", "night", "one door for the world's acts"],
    ["2026-08-17", null, "a plain hyphen"],
    ["2026-08-16", null, "an older one"],
  ]);
  assert.match(got[0].text, /^Body one\.$/);
});

test("2 · frontDate gives the regex's answer on every short text: values on later lines, blanks only, several date: lines", () => {
  const prefixes = ["date:", "x\ndate:", "a: b\r\ndate:", "xdate:", `${LS}date:`, "date: 1\ndate:"];
  const tokens = [" ", "\n", "\r", LS, "a", "\t", "date:"];
  let n = 0;
  for (const prefix of prefixes) for (const tail of strings(tokens, 5)) {
    const text = prefix + tail;
    assert.equal(frontDate(text), OLD_DATE.exec(text)?.[1] ?? null, `text ${JSON.stringify(text)}`);
    n += 1;
  }
  for (const text of strings([" ", "\n", "\r", "d", "a", "t", "e", ":", LS], 7)) {
    assert.equal(frontDate(text), OLD_DATE.exec(text)?.[1] ?? null, `text ${JSON.stringify(text)}`);
    n += 1;
  }
  assert.ok(n > 100_000, `${n} texts compared`);
});

test("2b · markFileParts keeps its accepted values: quotes around the date go, CRLF is normalised, no frontmatter is null", () => {
  assert.deepEqual(markFileParts('---\ndate: "2026-08-17T10:00:00Z"\nx: y\n---\nbody\nmore\n'), { date: "2026-08-17T10:00:00Z", body: "body\nmore\n" });
  assert.deepEqual(markFileParts("---\r\ndate: '2026-08-17'  \r\n---\r\n\r\nbody"), { date: "2026-08-17", body: "\nbody" });
  assert.deepEqual(markFileParts("---\nkind: tree\n---\nbody"), { date: null, body: "body" });
  assert.equal(markFileParts("no frontmatter"), null);
});

test("3 · endWithNewline is `.replace(/\\s*$/, \"\\n\")` on every short string of blanks and letters", () => {
  let n = 0;
  for (const text of strings([" ", "\t", "\n", "\r", LS, PS, "\u00a0", "\ufeff", "a", "b"], 6)) {
    assert.equal(endWithNewline(text), text.replace(/\s*$/, "\n"), `text ${JSON.stringify(text)}`);
    n += 1;
  }
  assert.ok(n > 1_000_000 - 1, `${n} texts compared`);
  // a ledger's tail, as the writers meet it
  for (const ledger of ["- 2026-09-01 · row\n", "- 2026-09-01 · row", "- 2026-09-01 · row\n\n\n", "- 2026-09-01 · row  \r\n", ""]) assert.equal(endWithNewline(ledger), ledger.replace(/\s*$/, "\n"));
});

// ── no longer quadratic ──────────────────────────────────────────────────────────────────────────
const timed = (fn) => { const t0 = process.hrtime.bigint(); const out = fn(); return { out, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; };
const BIG = 400_000;
const BUDGET_MS = 500;

test("4 · psaHeading on the shape the regex dies on (a title, a blank run, a lone CR, a letter) is read in milliseconds", () => {
  for (const line of [`## 2026-01-01 — a${" ".repeat(BIG)}\rx`, `## 2026-01-01 —${" ".repeat(BIG)}\rx`, `## 2026-01-01 — a${" ".repeat(BIG)}${LS}x`, `## 2026-01-01 —${" ".repeat(BIG)}`, `## 2026-01-01 (${" ".repeat(BIG)}`]) {
    const { ms } = timed(() => psaHeading(line));
    assert.ok(ms < BUDGET_MS, `${ms.toFixed(1)} ms on ${line.length} characters`);
  }
  // control: the regex itself is quadratic on the first shape (so this file can go red): at 6,000 characters it is already thousands of times slower per character
  const small = `## 2026-01-01 — a${" ".repeat(6_000)}\rx`;
  const old = timed(() => OLD_PSA.exec(small)).ms;
  const fresh = timed(() => psaHeading(small)).ms;
  assert.ok(old > 4 * fresh, `the original regex (${old.toFixed(1)} ms) is slower than the hand read (${fresh.toFixed(2)} ms) even at 6,000 characters`);
});

test("5 · frontDate on a value with an internal blank run (the shape the regex dies on) is read in milliseconds", () => {
  for (const text of [`date: a${" ".repeat(BIG)}b`, `date:${" ".repeat(BIG)}`, `date: a${" ".repeat(BIG)}\nx`, `x\n${"date: a \n".repeat(BIG / 9)}`]) {
    const { ms } = timed(() => frontDate(text));
    assert.ok(ms < BUDGET_MS, `${ms.toFixed(1)} ms on ${text.length} characters`);
  }
  const small = `date: a${" ".repeat(6_000)}b`;
  const old = timed(() => OLD_DATE.exec(small)).ms;
  const fresh = timed(() => frontDate(small)).ms;
  assert.ok(old > 4 * fresh, `the original regex (${old.toFixed(1)} ms) is slower than the hand read (${fresh.toFixed(2)} ms) even at 6,000 characters`);
});

test("6 · endWithNewline on a long internal blank run is read in milliseconds", () => {
  for (const text of [`a${" ".repeat(BIG)}b`, `${" \n".repeat(BIG / 2)}x`, `a${" ".repeat(BIG)}`]) {
    const { ms } = timed(() => endWithNewline(text));
    assert.ok(ms < BUDGET_MS, `${ms.toFixed(1)} ms on ${text.length} characters`);
  }
  const small = `a${" ".repeat(30_000)}b`;
  const old = timed(() => small.replace(/\s*$/, "\n")).ms;
  const fresh = timed(() => endWithNewline(small)).ms;
  assert.ok(old > 4 * fresh, `the original replace (${old.toFixed(1)} ms) is slower than the hand read (${fresh.toFixed(2)} ms) at 30,000 characters`);
});
