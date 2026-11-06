// key-line-regex-linear.test.mjs — POS-877: the office's own world-file parsers read a key line in linear time.
//
// THE DEFECT (the kin of POS-875, whose test is profile-keyline-linear.test.mjs). Each parser below
// matched a line with a blank-eating quantifier followed by `(.*)$`: both can take the same blanks,
// and `.` stops at a line terminator that `\s` does not (a lone CR, U+2028 or U+2029 survive every
// line split here). On a line `.` can't finish, the engine tried every split of the blanks before it
// gave up: quadratic in the line. The lazy `(.*?)[ \t]*$` in rekey-household does the same by a
// different road. The fix in each is one lookahead that keeps the value from starting on a blank the
// quantifier took, or (rekey-household) the rest of the line trimmed where it is used. The old
// regexes were measured at 16,000 characters: store-writedown 533 ms, rekey-household 441 ms,
// ballot-pass-run 214 ms, world-hydrate 185 ms, settle-anchored-berths 187 ms.
//
// THE BOUND, AND WHY IT IS TIME. Nothing counts a regex's backtracking steps from JavaScript, so
// these tests bound wall time, generously: 1,000 ms for one parse of about 64,000 characters. The
// linear parse takes about a millisecond; the old regexes take seconds at 64,000 (quadratic: four
// times the 16,000 figures above, then four times again). The control in each block is the same
// input with a letter where the terminator was: it stays green on the old regexes while the
// pathological cases red.
//
// SAME ANSWERS. Every block also runs a grid of short tails through the real parser and compares
// it with a reference written with string operations only (trimStart, indexOf), never the regex
// under test. The pre-fix regexes and these references were also diffed head to head offline
// over about five million strings (the PR body).
//
// Every input here is invented. world-hydrate.mjs is a script that does its work at import, so its
// two regexes are lifted out of the source by name and run (WIRING-AND-PINS: lift the lines and
// run them); a text pin beside them checks that the hydrator calls them.
//   node --import ./test/helpers/sparse-guard.mjs --test test/key-line-regex-linear.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handOffPrint } from "../src/store-writedown.mjs";
import { readBerth } from "../tools/settle-anchored-berths.mjs";
import { parseFrontmatter } from "../tools/ballot-pass-run.mjs";
import { withHouseLine } from "../tools/rekey-household.mjs";

const LAW = 'POS-877: "every super-linear key-line regex in office src/ and tools/ is linear, with the same answers"';
const SIZE = 64_000;
const BOUND_MS = 1_000;
// The line terminators `.` refuses and `\s` accepts, other than LF (every parser splits on LF first).
const TERMINATORS = { "a lone CR": "\r", "a lone U+2028": String.fromCharCode(0x2028), "a lone U+2029": String.fromCharCode(0x2029) };
const LT = String.fromCharCode(0x2028);
const NBSP = String.fromCharCode(0xa0);

const timed = (fn) => {
  const t0 = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t0 };
};

// A grid of short tails (what follows `key:`), built from the characters that decide the answers.
// A tail ending in CR is left out of the grids that run through a CRLF normaliser: a CR before the
// next LF is no longer a lone CR there. The terminators are covered at length by the cases above.
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
const GRID = tails(4);
const GRID_NO_TRAILING_CR = GRID.filter((t) => !t.endsWith("\r"));
const TERMINATOR_CHARS = [13, 10, 0x2028, 0x2029].map((c) => String.fromCharCode(c)); // what `.` will not cross
const HAS_TERMINATOR = (s) => TERMINATOR_CHARS.some((c) => s.includes(c));
const keyOf = (i) => `k${i}`;

// ── 1 · store-writedown: a mark file's `key: value` lines (src, through handOffPrint) ───────────────

// A canon file and a render of it that differ by one hand-off, both carrying `note:` + tail.
function markPair(tail) {
  const mark = (owner) => `---\nkind: thing\nnote:${tail}\nowned_by: ${owner}\n---\n\nwords\n`;
  return [mark("a"), mark("b")];
}

for (const [name, end] of Object.entries(TERMINATORS)) {
  test(`store-writedown: a mark-file line of about 64,000 blanks then ${name} reads in under ${BOUND_MS} ms, and is held out as before`, () => {
    for (const lines of [[" ".repeat(SIZE), `${end}x`], ["\t".repeat(SIZE), `x${end}y`]]) {
      const [canon, next] = markPair(lines.join(""));
      const { value, ms } = timed(() => handOffPrint(canon, next));
      assert.ok(ms < BOUND_MS, `${LAW}; this read took ${ms.toFixed(0)} ms`);
      assert.equal(value, null, "a line `.` can't finish is a file this does not understand: held out, as it always was");
    }
  });
}

test("control: the same 64,000 blanks then a letter read fast and print the hand-off", () => {
  const [canon, next] = markPair(` ${" ".repeat(SIZE)}yx`);
  const { value, ms } = timed(() => handOffPrint(canon, next));
  assert.ok(ms < BOUND_MS, `the control took ${ms.toFixed(0)} ms`);
  assert.ok(value && value.bytes.includes("owned_by: b"), "the control file is read, not held out");
});

test("store-writedown: short tails are accepted exactly when the key line is `key:` alone or `key:` + a blank + a value with no line terminator", () => {
  // Reference (string operations only): bare key, or a blank first and no terminator anywhere in the rest.
  const accepts = (tail) => tail === "" || ((tail[0] === " " || tail[0] === "\t") && !HAS_TERMINATOR(tail));
  let accepted = 0;
  for (const tail of GRID_NO_TRAILING_CR) {
    const [canon, next] = markPair(tail);
    const printed = handOffPrint(canon, next) !== null;
    if (printed) accepted++;
    assert.equal(printed, accepts(tail), `${LAW}; tail ${JSON.stringify(tail)}`);
  }
  assert.ok(accepted > 100 && accepted < GRID_NO_TRAILING_CR.length, `the grid has both answers (${accepted} accepted of ${GRID_NO_TRAILING_CR.length})`);
});

// ── 2 · world-hydrate: ENGINE.md headings and walk-ledger fields (src; a script, so lifted) ──────────

const HYDRATE_SRC = readFileSync(new URL("../src/world-hydrate.mjs", import.meta.url), "utf8");
function lifted(name) {
  const prefix = `const ${name} = `;
  const hits = HYDRATE_SRC.split("\n").filter((l) => l.startsWith(prefix));
  assert.equal(hits.length, 1, `${name} is declared once, on one line, in src/world-hydrate.mjs`);
  return vm.runInNewContext(hits[0].slice(prefix.length).replace(/;\s*$/, ""));
}
const ENGINE_HEADING_RE = lifted("ENGINE_HEADING_RE");
const WALK_LEDGER_FIELD_RE = lifted("WALK_LEDGER_FIELD_RE");

test("world-hydrate calls the lifted regexes, and no inline copy of the old ones is left (a text pin: the behavioural readers are the tests below)", () => {
  const count = (needle) => HYDRATE_SRC.split(needle).length - 1;
  assert.equal(count("ENGINE_HEADING_RE.exec(line)"), 1, "the ENGINE.md loop reads headings through ENGINE_HEADING_RE");
  assert.equal(count("WALK_LEDGER_FIELD_RE.exec(seg)"), 1, "the walk-ledger loop reads fields through WALK_LEDGER_FIELD_RE");
  assert.equal(count("/^##\\s+(.*)$/"), 0, "the old heading regex is gone");
  assert.equal(count("pace)\\s+(.*)$/"), 0, "the old field regex is gone");
});

for (const [name, end] of Object.entries(TERMINATORS)) {
  test(`world-hydrate: an ENGINE.md heading line of about 64,000 blanks then ${name} reads in under ${BOUND_MS} ms, and is no heading as before`, () => {
    for (const line of [`##${" ".repeat(SIZE)}${end}x${end}y`, `##${"\t".repeat(SIZE)}x${end}y`]) {
      const { value, ms } = timed(() => ENGINE_HEADING_RE.exec(line));
      assert.ok(ms < BOUND_MS, `${LAW}; this read took ${ms.toFixed(0)} ms`);
      assert.equal(value, null);
    }
  });
  test(`world-hydrate: a walk-ledger field of about 64,000 blanks then ${name} reads in under ${BOUND_MS} ms, and is no field as before`, () => {
    for (const seg of [`pace${" ".repeat(SIZE)}${end}x${end}y`, `from${"\t".repeat(SIZE)}x${end}y`]) {
      const { value, ms } = timed(() => WALK_LEDGER_FIELD_RE.exec(seg));
      assert.ok(ms < BOUND_MS, `${LAW}; this read took ${ms.toFixed(0)} ms`);
      assert.equal(value, null);
    }
  });
}

test("control: 64,000 blanks then a letter read fast and give the text", () => {
  const h = timed(() => ENGINE_HEADING_RE.exec(`##${" ".repeat(SIZE)}yx`));
  assert.ok(h.ms < BOUND_MS, `the heading control took ${h.ms.toFixed(0)} ms`);
  assert.equal(h.value[1], "yx");
  const f = timed(() => WALK_LEDGER_FIELD_RE.exec(`pace${" ".repeat(SIZE)}yx`));
  assert.ok(f.ms < BOUND_MS, `the field control took ${f.ms.toFixed(0)} ms`);
  assert.deepEqual([f.value[1], f.value[2]], ["pace", "yx"]);
});

test("world-hydrate: short tails read as the string-operation reference reads them (heading, then field)", () => {
  // Reference: a blank run first, then a rest with no line terminator in it. The rest is the capture.
  const reference = (rest) => {
    const r = rest.trimStart();
    return r.length < rest.length && !HAS_TERMINATOR(r) ? r : null;
  };
  let hits = 0;
  for (const tail of GRID) {
    const h = ENGINE_HEADING_RE.exec(`##${tail}`);
    const want = reference(tail);
    assert.equal(h ? h[1] : null, want, `${LAW}; heading tail ${JSON.stringify(tail)}`);
    if (h) hits++;
    for (const word of ["from", "toward", "at", "within", "to", "pace"]) {
      const f = WALK_LEDGER_FIELD_RE.exec(`${word}${tail}`);
      assert.deepEqual(f ? [f[1], f[2]] : null, want === null ? null : [word, want], `${LAW}; ${word} tail ${JSON.stringify(tail)}`);
    }
  }
  assert.ok(hits > 100 && hits < GRID.length, `the grid has both answers (${hits} headings of ${GRID.length})`);
  assert.equal(WALK_LEDGER_FIELD_RE.exec("fromage x"), null, "a word that merely starts like a field is no field");
});

// ── 3 · settle-anchored-berths: a berth card's frontmatter (tools, through readBerth) ────────────────

function berthClone(frontmatter) {
  const clone = mkdtempSync(join(tmpdir(), "pos877-berth-"));
  mkdirSync(join(clone, "HARBOR", "berths"), { recursive: true });
  writeFileSync(join(clone, "HARBOR", "berths", "ada.md"), `---\n${frontmatter}\n---\n\nhello\n`);
  return clone;
}

for (const [name, end] of Object.entries(TERMINATORS)) {
  test(`settle-anchored-berths: a berth line of about 64,000 blanks then ${name} reads in under ${BOUND_MS} ms, and the lines after it still read`, () => {
    for (const tail of [`${" ".repeat(SIZE)}${end}x${end}y`, `${"\t".repeat(SIZE)}x${end}y`]) {
      const clone = berthClone(`note:${tail}\nhandle: ada`);
      const { value, ms } = timed(() => readBerth(clone, "ada"));
      assert.ok(ms < BOUND_MS, `${LAW}; this read took ${ms.toFixed(0)} ms`);
      assert.deepEqual(value.data, { handle: "ada" }, "the line `.` can't finish is skipped, as it always was");
    }
  });
}

test("control: a berth line of 64,000 blanks then a letter reads fast, and the value is read", () => {
  const clone = berthClone(`note:${" ".repeat(SIZE)}yx\nhandle: ada`);
  const { value, ms } = timed(() => readBerth(clone, "ada"));
  assert.ok(ms < BOUND_MS, `the control took ${ms.toFixed(0)} ms`);
  assert.deepEqual(value.data, { note: "yx", handle: "ada" });
});

test("settle-anchored-berths: short tails read as the string-operation reference reads them", () => {
  // One card for the whole grid: line i is `k<i>:` + tail, keys written with letters (the key class is [a-z_]).
  const letters = (i) => String(i).split("").map((d) => "abcdefghij"[d]).join("");
  const cases = GRID_NO_TRAILING_CR;
  const clone = berthClone(cases.map((t, i) => `${letters(i)}:${t}`).join("\n"));
  const { data } = readBerth(clone, "ada");
  let read = 0;
  cases.forEach((tail, i) => {
    const rest = tail.trimStart();
    const want = HAS_TERMINATOR(rest) ? undefined : rest.trim();
    assert.equal(data[letters(i)], want, `${LAW}; tail ${JSON.stringify(tail)}`);
    if (want !== undefined) read++;
  });
  assert.ok(read > 100 && read < cases.length, `the grid has both answers (${read} read of ${cases.length})`);
});

// ── 4 · ballot-pass-run: a ballot letter's frontmatter (tools, through parseFrontmatter) ─────────────

for (const [name, end] of Object.entries(TERMINATORS)) {
  test(`ballot-pass-run: a letter line of about 64,000 blanks then ${name} reads in under ${BOUND_MS} ms, and the lines after it still read`, () => {
    for (const tail of [`${" ".repeat(SIZE)}${end}x${end}y`, `${"\t".repeat(SIZE)}x${end}y`]) {
      const { value, ms } = timed(() => parseFrontmatter(`---\nnote:${tail}\nstake_topic: t\n---\n\nmy ballot\n`));
      assert.ok(ms < BOUND_MS, `${LAW}; this read took ${ms.toFixed(0)} ms`);
      assert.deepEqual(value, { stake_topic: "t" }, "the line `.` can't finish is skipped, as it always was");
    }
  });
}

test("control: a letter line of 64,000 blanks then a letter reads fast, and the value is read", () => {
  const { value, ms } = timed(() => parseFrontmatter(`---\nnote:${" ".repeat(SIZE)}yx\nstake_topic: t\n---\n\nmy ballot\n`));
  assert.ok(ms < BOUND_MS, `the control took ${ms.toFixed(0)} ms`);
  assert.deepEqual(value, { note: "yx", stake_topic: "t" });
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

// ── 5 · rekey-household: the card's `household:` line (tools, through withHouseLine) ─────────────────

// The line is rewritten when its trimmed value is one of the old values; the lazy trailing-blank
// match used to retry at every blank of a run in the value.
const card = (valueLine) => `---\nhandle: ada\nhousehold:${valueLine}\nsince: 2026-09-25\n---\n\nHello.\n`;

test(`rekey-household: a household line with a value of 64,000 inner blanks reads in under ${BOUND_MS} ms, and is rewritten as before`, () => {
  for (const blank of [" ", "\t"]) {
    const value = `a${blank.repeat(SIZE)}b`;
    const { value: out, ms } = timed(() => withHouseLine(card(` ${value}  `), { oldValues: [value], name: "New Name" }));
    assert.ok(ms < BOUND_MS, `${LAW}; this read took ${ms.toFixed(0)} ms`);
    assert.equal(out, card(" New Name"), "the whole old line, trailing blanks included, becomes the new one");
  }
});

test("control: a value that is not an old one is left alone, fast", () => {
  const value = `a${" ".repeat(SIZE)}b`;
  const { value: out, ms } = timed(() => withHouseLine(card(` ${value}`), { oldValues: ["somebody else"], name: "New Name" }));
  assert.ok(ms < BOUND_MS, `the control took ${ms.toFixed(0)} ms`);
  assert.equal(out, null);
});

test("rekey-household: short values are rewritten exactly when their trimmed text is an old value", () => {
  const OLD = "the old house";
  const spellings = ["the old house", "  the old house", "the old house  ", "\tthe old house\t", "the old  house", "the old house x", "", " ", `the old house${NBSP}`];
  for (const s of spellings) {
    const out = withHouseLine(card(` ${s}`), { oldValues: [OLD], name: "New" });
    const want = s.trim() === OLD ? card(" New") : null;
    assert.equal(out, want, `${LAW}; value ${JSON.stringify(s)}`);
  }
});
