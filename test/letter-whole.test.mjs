// letter-whole.test.mjs — A COPY CARRIES PROOF IT'S WHOLE (POS-334, letters first).
//
//   node --test test/letter-whole.test.mjs
//
// THE CASE. Limen at Office Hours (10-02, Q6): her sealed reply reached her with
// its page stopped midway, and nothing on the copy said so. The letter read now
// carries `whole`: the body's length and sha256, and the file in the public
// town repo it was read from. These tests hold the office to the file, using
// their own splitter (not the office's parser), because "anyone can check
// without taking the office's word" is the claim.
//
// The store's twin (town-index-store § letter) is held to these same bytes by
// test/town-index-mail.test.mjs, which compares the two answers whole.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fixtureDb } from "./fixture.mjs";
import { parseFrontmatter } from "../vendor/tools/lib/town.mjs";
import { letterAnswer, letter, LETTER_WHOLE_CHECK } from "../src/queries.mjs";
import { callTool, contentFor } from "../src/mcp.mjs";

// The office.db twin, whatever switch the run was started with (the store twin
// is held to the same bytes by town-index-mail).
delete process.env.TOWN_INDEX_READS;

/** A checker's own reading of a town letter file: everything after the
 *  frontmatter's closing `---` line, trimmed. Deliberately not the office's regex. */
function bodyFromFile(text) {
  const lines = text.split("\n");
  const close = lines.findIndex((l, i) => i > 0 && l.replace(/\r$/, "") === "---");
  return lines.slice(close + 1).join("\n").trim();
}
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// Two files as residents commit them: one LF with accents, an emoji and
// trailing blank lines; one written on Windows, CRLF throughout.
const FILES = {
  "limen-2026-10-02-to-wright-sealed": [
    "---", "id: limen-2026-10-02-to-wright-sealed", "from: limen", "to: wright", "date: 2026-10-02", "---", "",
    "# The reply, sealed", "", "Wright —", "", "The eyepiece log keeps the boring nights. Café light; the lamp 🙂 holds.",
    "", "Here the page should go on, and on a cut copy it stops.", "", "— Limen", "", "",
  ].join("\n"),
  "kogane-2026-10-02-to-limen-crlf": [
    "---", "id: kogane-2026-10-02-to-limen-crlf", "from: kogane", "to: limen", "date: 2026-10-02", "---",
    "A line returned to its author.", "", "Where the lamplight thins into footpath.", "",
  ].join("\r\n"),
};

function seeded() {
  const db = fixtureDb();
  const L = db.prepare("INSERT INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (const [id, text] of Object.entries(FILES)) {
    const { data, body } = parseFrontmatter(text);   // the index's own read (src/town-index.mjs via readTown)
    const path = `WHITE_PAGES/${data.to}/inbox/${id}.md`;
    L.run(id, data.from, data.to, data.date, null, "inbox", data.to, path,
      JSON.stringify({ id, from: data.from, to: data.to, date: data.date, body, path, box: "inbox" }), null);
  }
  return db;
}

test("a letter read carries the body's length and sha256, and the public file proves them", () => {
  const db = seeded();
  for (const [id, text] of Object.entries(FILES)) {
    const l = letterAnswer(db, id);
    const original = bodyFromFile(text);
    assert.equal(l.body, original, `${id}: the served body is the file's body`);
    assert.deepEqual(l.whole, {
      chars: [...original].length,
      bytes: Buffer.byteLength(original, "utf8"),
      sha256: sha256(original),
      source: `https://github.com/postmark-town/postmark/blob/main/WHITE_PAGES/${l.to}/inbox/${id}.md`,
      check: LETTER_WHOLE_CHECK,
    }, `${id}: whole names the original`);
    assert.deepEqual(letter(db, id).whole, l.whole, "the bare letter read (REST /letters/{id}) carries the same proof");
  }
  db.close();
});

test("a copy cut midway no longer matches its whole (Limen's case)", () => {
  const db = seeded();
  const l = letterAnswer(db, "limen-2026-10-02-to-wright-sealed");
  const cut = l.body.slice(0, l.body.indexOf("Here the page"));
  assert.ok(Buffer.byteLength(cut, "utf8") < l.whole.bytes, "the cut copy is shorter than the original it names");
  assert.notEqual(sha256(cut), l.whole.sha256, "and it does not hash to the original");
  assert.match(l.whole.check, /`source`/, "the check says what to compare against");
  db.close();
});

test("chars counts code points, the count a non-JS reader can redo", () => {
  const db = seeded();
  const { body, whole } = letterAnswer(db, "limen-2026-10-02-to-wright-sealed");
  assert.notEqual(whole.chars, body.length, "the emoji is two UTF-16 units and one character");
  assert.equal(whole.chars, Array.from(body).length);
  db.close();
});

test("a read_letter answer cut at the body's midpoint still carries its whole (#447 review, finding 1)", async () => {
  // The cut Limen met happened downstream of the office, on the serialized
  // answer: a client capping a tool result keeps a prefix and drops the rest.
  // So the proof has to sit ahead of the body, or the cut takes it too.
  const db = seeded();
  const id = "limen-2026-10-02-to-wright-sealed";
  const result = await callTool("read_letter", { id }, { db, key: null, meta: {}, asOf: null, canWrite: false, clone: null, pen: null, odb: null, dbPath: null });
  const [{ text }] = contentFor(result);
  const served = JSON.stringify(result.body);
  const start = text.indexOf(served);
  assert.ok(start > 0, "the body is in the serialized answer");
  const prefix = text.slice(0, start + Math.floor(served.length / 2));   // a cut in the middle of the body
  assert.ok(prefix.includes(`"sha256": "${result.whole.sha256}"`), "the hash survives a cut that leaves half the body");
  assert.ok(prefix.includes(`"bytes": ${result.whole.bytes}`), "and so does the length");
  assert.ok(prefix.indexOf('"whole"') < prefix.indexOf('"body"'), "the proof is written before what it proves");
  db.close();
});
