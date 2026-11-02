// profile-wrapped-bio.test.mjs — a bio that wraps onto indented lines is read whole (POS-862).
//
//   node --test test/profile-wrapped-bio.test.mjs      (wholly synthetic: strings in, no file or store read)
//
// LAW (Darko 2026-11-01 via Wright, POS-862): "office reader includes wrapped bio continuation
// lines". YAML folds a plain or double-quoted scalar's line breaks to spaces; the indented lines
// up to the next top-level key are the same value. The reader had skipped them (plain) or kept a
// stray opening quote (double-quoted). The 400-character cap is the write door's and is untouched.
//
// Every text below is invented for this file.

import test from "node:test";
import assert from "node:assert/strict";
import { parseProfile } from "../src/profiles.mjs";

const doc = (...lines) => `---\n${lines.join("\n")}\n---\n`;

test("a plain wrapped bio reads whole, folded with single spaces, and the next field is still the next field", () => {
  const p = parseProfile(doc("bio: first words of an invented bio", "  continue on a second line", "  and a third line", "runtime: invented-runtime"));
  assert.equal(p.bio, "first words of an invented bio continue on a second line and a third line");
  assert.equal(p.runtime, "invented-runtime");
});

test("a double-quoted wrapped bio reads whole and unquoted, escapes honoured", () => {
  const p = parseProfile(doc('bio: "an invented \\"quoted\\" start', '  wraps here with a tab\\tinside and ends"', "runtime: invented-runtime"));
  assert.equal(p.bio, 'an invented "quoted" start wraps here with a tab\tinside and ends');
  assert.equal(p.runtime, "invented-runtime");
});

test("a wrapped bio stops at an unindented key, including an unknown one, which still passes through", () => {
  const p = parseProfile(doc("bio: wrapped start", "  wrapped end", "mystery_key: kept", "runtime: r"));
  assert.deepEqual([p.bio, p.mystery_key, p.runtime], ["wrapped start wrapped end", "kept", "r"]);
});

test("CONTROLS: a one-line JSON bio, a folded block and a literal block read as they did", () => {
  assert.equal(parseProfile(doc('bio: "one line, with a \\"quote\\" and a\\nnewline"', "runtime: r")).bio, 'one line, with a "quote" and a\nnewline');
  assert.equal(parseProfile(doc("bio: >", "  folded line one", "  folded line two", "runtime: r")).bio, "folded line one folded line two");
  assert.equal(parseProfile(doc("bio: |", "  literal line one", "  literal line two", "runtime: r")).bio, "literal line one\nliteral line two");
  assert.equal(parseProfile(doc("bio: just one line", "runtime: r")).bio, "just one line");
});

test("CONTROL: an empty value followed by an indented line stays empty (no value to continue), and is omitted", () => {
  const p = parseProfile(doc("bio:", "  indented but nothing to continue", "runtime: r"));
  assert.equal("bio" in p, false);
  assert.equal(p.runtime, "r");
});

test("a wrapped bio over the cap is still just text to the reader: the cap is the write door's", () => {
  const long = "word ".repeat(120).trim(); // 599 characters, invented
  const p = parseProfile(doc(`bio: ${long.slice(0, 300)}`, `  ${long.slice(300).trim()}`));
  assert.equal(p.bio.length > 400, true);
});
