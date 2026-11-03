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

// FIX 3 (POS-862): once a double-quoted wrapped bio is COMPLETE (its closing quote read), nothing after it is the
// bio: a genuine indented comment, or more indented lines, are not folded on, and the next field is intact.
test("a completed double-quoted wrapped bio stops at its closing quote: a real comment after it is not part of the bio", () => {
  const p = parseProfile(doc('bio: "an invented start of a bio', '  and its end, quoted \\"inside\\" too"', "  # a genuine comment after the quote closed", "runtime: invented-runtime"));
  assert.equal(p.bio, 'an invented start of a bio and its end, quoted "inside" too', "the complete decoded bio only");
  assert.equal(p.runtime, "invented-runtime", "the following field is intact");
  assert.equal(JSON.stringify(p).includes("genuine comment"), false, "the comment text appears nowhere");
});

test("a completed quoted bio is not extended by indented lines after its closing quote; a hash still INSIDE an open quote stays text", () => {
  const closed = parseProfile(doc('bio: "first part', '  second part"', "  indented line after the quote", "runtime: r"));
  assert.deepEqual([closed.bio, closed.runtime], ["first part second part", "r"]);
  const open = parseProfile(doc('bio: "first part', "  # still inside the open quote", '  end of it"', "  # real comment after", "runtime: r"));
  assert.deepEqual([open.bio, open.runtime], ["first part # still inside the open quote end of it", "r"]);
});

// COST (POS-862 security brief, Rivet 2026-11-02 06:04Z): "Remove repeated growing-prefix work while retaining
// supported wrapped-quote completion, hashes/escaped quotes inside, post-close comment exclusion, adjacent fields
// and all non-bio/control behavior." Fix 3 found a quoted bio's end by re-joining and JSON-parsing the whole fold
// after every line (quadratic in the line count). The end is now found by one escape-aware scan and parsed once.
// Each expected value below is what fix 3's parser (fe5dddb0) answered for the same invented text, measured then.
test("a quoted bio's close is found escape-aware: an escaped quote, an escaped backslash and a \\u0022 each read as before", () => {
  const escapedQuote = parseProfile(doc('bio: "an invented \\"quoted', '  phrase\\" here"', "  # a comment after the close", "runtime: r"));
  assert.deepEqual([escapedQuote.bio, escapedQuote.runtime], ['an invented "quoted phrase" here', "r"], "an escaped quote does not close the bio; the real close does, and the comment after it is not the bio");
  const escapedBackslash = parseProfile(doc('bio: "an invented path C:\\\\', '  folder\\\\"', "  # a comment after the close", "runtime: r"));
  assert.deepEqual([escapedBackslash.bio, escapedBackslash.runtime], ["an invented path C:\\ folder\\", "r"], "a quote after an escaped backslash IS the close");
  const unicodeQuote = parseProfile(doc('bio: "an invented \\u0022 inside', '  and the end"', "  # a comment after the close", "runtime: r"));
  assert.deepEqual([unicodeQuote.bio, unicodeQuote.runtime], ['an invented " inside and the end', "r"], "a \\u0022 escape is text, not the close");
});

test("CONTROLS: a malformed quoted bio keeps fix 3's reading: the whole fold, quotes and comment included (pinned, not endorsed)", () => {
  const cases = [
    [['bio: "an invented bad \\x escape', '  ends here"'], '"an invented bad \\x escape ends here" # a comment'],
    [['bio: "closed" then more', '  "quoted" words'], '"closed" then more "quoted" words # a comment'],
    [['bio: "an invented trailing \\', '  then the end"'], '"an invented trailing \\ then the end" # a comment'],
  ];
  for (const [bioLines, expected] of cases) {
    const p = parseProfile(doc(...bioLines, "  # a comment", "runtime: r"));
    assert.deepEqual([p.bio, p.runtime], [expected, "r"], `fix 3 read ${JSON.stringify(bioLines)} this way`);
  }
});

// A count, not a clock (no timing SLA): the characters this parse hands JSON.parse. The first line is parsed
// once, and the fold at most twice (once where it may complete, once after), so the total stays within three
// times the document however many lines the bio wraps over. Re-parsing the fold after every line costs about
// lines x fold, hundreds of times this bound at 2,000 lines; so does parsing only lines that hold a quote, on
// the quote-rich shapes below.
const parseWork = (text) => {
  const real = JSON.parse;
  const seen = { calls: 0, chars: 0 };
  JSON.parse = function (source, ...rest) { seen.calls++; seen.chars += String(source).length; return real.call(this, source, ...rest); };
  try {
    const profile = parseProfile(text);
    return { profile, calls: seen.calls, chars: seen.chars };
  } finally { JSON.parse = real; }
};

test("COST: a quoted bio wrapped over many lines (unterminated, quote-rich, escaped, closed late) is parsed in linear work, with the same answers", () => {
  const N = 2000;
  const shapes = [
    ["unterminated, one-character lines", ['bio: "x', ...Array(N).fill("  x")], '"x' + " x".repeat(N)],
    ["unterminated, every line an escaped quote", ['bio: "x', ...Array(N).fill('  \\"')], '"x' + ' \\"'.repeat(N)],
    ["closed mid-line, every line quote-rich", ['bio: "x" y', ...Array(N).fill('  "z"')], '"x" y' + ' "z"'.repeat(N)],
    ["closed on the last line, then a comment", ['bio: "x', ...Array(N - 1).fill("  x"), '  x"', "  # a comment after the close"], "x" + " x".repeat(N)],
  ];
  // Every shape's verdict is collected and the whole map compared, so a red names every shape that moved.
  const verdicts = {}, work = {};
  for (const [shape, bioLines, expected] of shapes) {
    const text = doc(...bioLines, "runtime: r");
    const { profile, calls, chars } = parseWork(text);
    verdicts[shape] = {
      sameAnswer: profile?.bio === expected && profile?.runtime === "r", // fix 3's answer, and the next field intact
      countIsLive: calls > 0, // the count sees the parser's own JSON.parse
      linearWork: chars <= 3 * text.length,
    };
    work[shape] = `${chars} characters parsed for a ${text.length}-character document`;
  }
  const want = Object.fromEntries(shapes.map(([shape]) => [shape, { sameAnswer: true, countIsLive: true, linearWork: true }]));
  assert.deepEqual(verdicts, want, `the fold must not be re-parsed per line: ${JSON.stringify(work)}`);
});
