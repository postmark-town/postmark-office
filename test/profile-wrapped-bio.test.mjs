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

// CONTROLS (fix 1): the go is wrapped BIOS, so no other key's reading moved. Each expected value
// below is what the base parser (532e7d62) answered for the same invented text, measured then.
test("CONTROLS: a wrapped non-bio key, known or unknown, reads exactly as it did: its first line, continuation ignored", () => {
  const read = (...l) => parseProfile(doc(...l, "bio: b"));
  assert.deepEqual(read("runtime: first part of invented runtime", "  second part"), { runtime: "first part of invented runtime", bio: "b" });
  assert.deepEqual(read("mystery_key: first part of a thing", "  second part"), { mystery_key: "first part of a thing", bio: "b" });
  assert.deepEqual(read("pronouns: they/them", "  and more"), { pronouns: "they/them", bio: "b" });
  assert.deepEqual(read('runtime: "first part', '  second part"'), { runtime: '"first part', bio: "b" }, "a wrapped quoted non-bio keeps its prior (stray-quote) reading");
});

// FIX 2 (POS-862): an indented YAML comment line ENDS a plain wrapped bio; it is not authored text, and it
// does not swallow the next field. Inside a double-quoted value a `#` is ordinary text and stays.
test("a plain wrapped bio stops at an indented comment line, which is not part of the bio; the next field still reads", () => {
  const p = parseProfile(doc("bio: first words of an invented bio", "  continue on a second line", "  # an invented comment, not the author's words", "runtime: invented-runtime"));
  assert.equal(p.bio, "first words of an invented bio continue on a second line");
  assert.equal(p.runtime, "invented-runtime");
  assert.equal(JSON.stringify(p).includes("comment"), false, "the comment text appears nowhere");
});

test("a comment right after the first line ends the bio at that line, and indented lines after the comment are not folded on", () => {
  const p = parseProfile(doc("bio: only this line", "  # a comment", "  a line after the comment", "runtime: r"));
  assert.deepEqual([p.bio, p.runtime], ["only this line", "r"]);
});

test("CONTROLS: a hash inside a double-quoted wrapped bio stays text, an inline hash in plain text is unchanged, and the adjacent key is intact", () => {
  const quoted = parseProfile(doc('bio: "an invented start', '  # not a comment here, it is quoted text', '  and the end"', "runtime: r"));
  assert.equal(quoted.bio, "an invented start # not a comment here, it is quoted text and the end");
  assert.equal(quoted.runtime, "r");
  const inline = parseProfile(doc("bio: first part with a C# mention", "  and a second part with # inside", "runtime: r"));
  assert.equal(inline.bio, "first part with a C# mention and a second part with # inside", "only a line that STARTS with # is a comment");
  assert.equal(parseProfile(doc("runtime: first part", "  # a comment", "bio: b")).runtime, "first part", "a non-bio key is still its first line");
});
