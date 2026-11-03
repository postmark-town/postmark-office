// pos-376-mail-law-invalidation.test.mjs — a change to the town's mail LAW re-derives every resident's mail_state (POS-376).
//
//   node --test test/pos-376-mail-law-invalidation.test.mjs     (wholly invented: no repo, no database, no town read)
//
// THE GAP. world2/tools/town-index-ingest.mjs applyDelta recomputes mail_state only for the PARTIES of what moved (a
// changed letter or thread, a new ledger line) and for residents with no stored row. A commit that changes only
// `tools/mail-state.mjs` (the law itself, e.g. the town's repair that puts a reply after its parent) moves no letter, so it
// selected nobody and every untouched resident kept a row derived by the old law.
//
// WHAT THIS RUNS. applyDelta cannot be driven without a git checkout and a database, so (the WIRING-AND-PINS "lift the
// lines and run them" idiom) this slices the REAL source block from `const parties = new Set();` to the `lap("mail_state")`
// line, plus the module's own MAIL_LAW_PATH definition, and runs it in a function whose free names are stubs that RECORD
// what the block asks for: which residents it hands to mailStateRows (`only`) and which keys it scopes the diff to. The
// stubs answer only invented data (handles a/b/c/d, JSON letters). The selection logic is the source's, not a copy.
// Not covered: mailStateRows' own derivation, diffTable, the git diff that builds `changed` (pinned below by text, the
// weakest instrument), and any real ingest.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../world2/tools/town-index-ingest.mjs", import.meta.url), "utf8");
const between = (text, from, to) => {
  const a = text.indexOf(from);
  assert.ok(a >= 0, `marker not found: ${from}`);
  const b = text.indexOf(to, a);
  assert.ok(b > a, `end marker not found: ${to}`);
  return text.slice(a, b + to.length);
};
const BLOCK = between(SRC, "const parties = new Set();", 'lap("mail_state");');
const LAW_DEF = between(SRC, "const MAIL_LAW_PATH", ";");
const NAMES = [
  "letterSets", "threadSets", "newLines", "town", "client", "changed", "storedDigests", "keyOf", "partiesOfLetter", "participantsOf",
  "mailStateRows", "diffTable", "townRepo", "log", "tally", "lap",
];

const key = (h) => JSON.stringify([h]);
const sorted = (s) => [...s].sort();

/** Run the real selection block over invented inputs; report what it asked mailStateRows and diffTable for. */
async function select({ town = ["a", "b", "c"], stored = ["a", "b", "c"], changed = [], moved = [] }) {
  const asked = {};
  const scope = { letterSets: [], threadSets: [] };
  // an invented moved letter: the block asks for its parties from the touched candidate rows
  const letterSets = moved.length
    ? [{ oldRows: [], touched: ["L1"], cands: [{ _k: "L1", 8: JSON.stringify({ from: moved[0], to: moved[1] }) }] }]
    : [];
  const stubs = {
    letterSets, threadSets: [], newLines: [], town: { residents: town.map((handle) => ({ handle })) }, client: {}, changed,
    storedDigests: async () => new Map(stored.map((h) => [key(h), "digest"])),
    keyOf: () => (r) => r._k,
    partiesOfLetter: (json) => { const l = JSON.parse(json); return [l.from, l.to]; },
    participantsOf: () => [],
    mailStateRows: async (_repo, _town, { only }) => { asked.only = sorted(only); return [["rows"]]; },
    diffTable: async (_c, name, _cands, _tally, { scope: sc }) => { asked.table = name; asked.scope = sorted(sc); },
    townRepo: "invented", log: {}, tally: {}, lap: () => {},
  };
  const run = new (Object.getPrototypeOf(async () => {}).constructor)(...NAMES, `${LAW_DEF}\n${BLOCK}`);
  await run(...NAMES.map((n) => stubs[n]));
  return asked;
}

const LAW = "tools/mail-state.mjs";

test("a law-only change (no letter moved) hands every resident to the recomputation", async () => {
  const a = await select({ changed: [LAW] });
  assert.deepEqual(a.only, ["a", "b", "c"], "every resident is re-derived");
  assert.equal(a.table, "mail_state");
  assert.deepEqual(a.scope, [key("a"), key("b"), key("c")].sort(), "and the diff is scoped to all of them");
});

test("CONTROL: no law change and nothing moved keeps the sparse delta: nobody is re-derived", async () => {
  const a = await select({ changed: ["WHITE_PAGES/zz/ADDRESS.md", "tools/mail-state.test.mjs", "docs/tools/mail-state.mjs"] });
  assert.deepEqual(a.only, [], "a path that merely resembles the law's is not the law");
  assert.deepEqual(a.scope, []);
});

test("CONTROL: a moved letter without a law change re-derives only its parties", async () => {
  const a = await select({ changed: ["WHITE_PAGES/a/outbox/x.md"], moved: ["a", "b"] });
  assert.deepEqual(a.only, ["a", "b"], "c is untouched and stays as stored");
});

test("a law change and a moved letter together re-derive everyone, once", async () => {
  const a = await select({ changed: [LAW, "WHITE_PAGES/a/outbox/x.md"], moved: ["a", "b"] });
  assert.deepEqual(a.only, ["a", "b", "c"]);
});

test("the law path in a delete or the old side of a rename still counts (the diff lists --no-renames paths)", async () => {
  const gone = await select({ changed: [LAW] });
  assert.deepEqual(gone.only, ["a", "b", "c"]);
  // a rename away is listed as the old path (deleted) and the new one: the old one is enough
  const moved = await select({ changed: [LAW, "tools/mail-law-moved.mjs"] });
  assert.deepEqual(moved.only, ["a", "b", "c"]);
  assert.match(SRC, /"diff", "--name-only", "-z", "--no-renames", head, sha/, "TEXT PIN (weakest instrument): the changed list is built --no-renames");
});

test("a new resident (no stored row) and a deleted one still behave as before, with or without a law change", async () => {
  for (const changed of [[], [LAW]]) {
    const a = await select({ town: ["a", "b", "c"], stored: ["a", "b", "d"], changed });
    assert.ok(a.only.includes("c"), "the resident with no stored row is derived");
    assert.ok(a.scope.includes(key("d")), "the stored row of a resident who is gone is in the diff's scope, so it is deleted");
    assert.ok(!a.only.includes("d"), "a gone resident is not handed to the derivation");
  }
  const quiet = await select({ town: ["a", "b", "c"], stored: ["a", "b", "d"], changed: [] });
  assert.deepEqual(quiet.only, ["c"], "without a law change only the missing row is derived");
});
