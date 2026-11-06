// pos-376-mail-law-invalidation.test.mjs — a change to the town's mail LAW re-derives every resident's mail_state, and a
// resident the new law could not derive is neither replaced nor deleted (POS-376).
//
//   node --test test/pos-376-mail-law-invalidation.test.mjs     (wholly invented: no repo, no database, no town read)
//
// THE GAP. world2/tools/town-index-ingest.mjs applyDelta recomputes mail_state only for the PARTIES of what moved and for
// residents with no stored row. A commit that changes only `tools/mail-state.mjs` (the law itself) moves no letter, so it
// selected nobody and every untouched resident kept a row derived by the old law. The fix selects everyone on a law change.
//
// THE WIDENED RISK, AND ITS GUARD. mailStateRows catches a per-resident derivation error, logs it and OMITS that row, and
// diffTable reads an in-scope missing candidate as a deletion. On the new full recompute that would erase every failed
// resident's last good row because the new law could not run on them. So, on a law change with a non-null candidate array,
// every requested resident must be covered by IDENTITY before the diff, or applyDelta throws and the caller's ROLLBACK
// leaves the index as it was. A null (law absent) and every sparse ingest are unchanged.
//
// WHAT THIS RUNS. applyDelta cannot be driven without a git checkout and a database, so (the WIRING-AND-PINS "lift the
// lines and run them" idiom) this slices the REAL source: the selection-and-guard block (from `const parties = new Set();`
// to the `lap("mail_state")` line), the module's own `keyOf` and MAIL_LAW_PATH definitions, with the real TOWN_TABLES
// (src/town-tables.mjs, a pure data module). The free names are recording stubs over invented handles a/b/c/d. Not covered,
// and said so: mailStateRows' own derivation, diffTable, the git diff that builds `changed` and the database ROLLBACK itself:
// the throw is proven, the rollback is only PINNED BY TEXT at the caller (the weakest instrument); no rollback was executed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOWN_TABLES } from "../src/town-tables.mjs";

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
const KEY_OF = between(SRC, "function keyOf(name) {", "\n}\n");
const NAMES = [
  "TOWN_TABLES", "letterSets", "threadSets", "newLines", "town", "client", "changed", "storedDigests", "partiesOfLetter", "participantsOf",
  "mailStateRows", "diffTable", "townRepo", "log", "tally", "lap",
];

const key = (h) => JSON.stringify([h]);
const sorted = (s) => [...s].sort();
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/** A mail_state candidate row, in the table's own column order: [handle, json]. */
const row = (h) => TOWN_TABLES.mail_state.cols.map((c) => (c === "handle" ? h : "{}"));

/**
 * Run the real block over invented inputs. `cands(only)` is what mailStateRows hands back for the residents it was asked
 * about: all of them, some, foreign ones, or null (law absent).
 */
async function select({ town = ["a", "b", "c"], stored = ["a", "b", "c"], changed = [], moved = [], cands = (only) => only.map(row) }) {
  const seen = { diffs: 0 };
  // an invented moved letter, in the letters table's own column order, with its parties at the column the block reads
  const lcols = TOWN_TABLES.letters.cols;
  const lrow = lcols.map((c) => (TOWN_TABLES.letters.key.includes(c) ? "L1" : ""));
  if (moved.length) lrow[8] = JSON.stringify({ from: moved[0], to: moved[1] });
  const letterSets = moved.length ? [{ oldRows: [], touched: [JSON.stringify(TOWN_TABLES.letters.key.map((c) => lrow[lcols.indexOf(c)]))], cands: [lrow] }] : [];
  const stubs = {
    TOWN_TABLES, letterSets, threadSets: [], newLines: [], town: { residents: town.map((handle) => ({ handle })) }, client: {}, changed,
    storedDigests: async () => new Map(stored.map((h) => [key(h), "digest"])),
    partiesOfLetter: (json) => { const l = JSON.parse(json); return [l.from, l.to]; },
    participantsOf: () => [],
    mailStateRows: async (_repo, _town, { only }) => { seen.only = sorted(only); return cands(sorted(only)); },
    diffTable: async (_c, name, _cands, _tally, { scope }) => { seen.diffs++; seen.table = name; seen.scope = sorted(scope); seen.cands = _cands.map((r) => r[0]).sort(); },
    townRepo: "invented", log: {}, tally: {}, lap: () => {},
  };
  const run = new AsyncFunction(...NAMES, `${KEY_OF}\n${LAW_DEF}\n${BLOCK}`);
  try { await run(...NAMES.map((n) => stubs[n])); } catch (e) { seen.error = e; }
  return seen;
}

const LAW = "tools/mail-state.mjs";

// ── the selection (first half of POS-376) ────────────────────────────────────

test("a law-only change (no letter moved) hands every resident to the recomputation, and the full candidates reach the diff", async () => {
  const a = await select({ changed: [LAW] });
  assert.equal(a.error, undefined);
  assert.deepEqual(a.only, ["a", "b", "c"], "every resident is re-derived");
  assert.equal(a.table, "mail_state");
  assert.deepEqual(a.scope, [key("a"), key("b"), key("c")].sort(), "and the diff is scoped to all of them");
  assert.deepEqual(a.cands, ["a", "b", "c"]);
});

test("CONTROL: no law change and nothing moved keeps the sparse delta: nobody is re-derived (look-alike paths are not the law)", async () => {
  const a = await select({ changed: ["WHITE_PAGES/zz/ADDRESS.md", "tools/mail-state.test.mjs", "docs/tools/mail-state.mjs"] });
  assert.deepEqual(a.only, []);
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

test("a delete of the law, or a rename away from it, lists its old path and still selects everyone (selection only, not recovery)", async () => {
  assert.deepEqual((await select({ changed: [LAW, "tools/mail-law-moved.mjs"] })).only, ["a", "b", "c"]);
  assert.match(SRC, /"diff", "--name-only", "-z", "--no-renames", head, sha/, "TEXT PIN (weakest instrument): the changed list is built --no-renames");
});

test("a new resident (no stored row) and a gone one still behave as before, with or without a law change", async () => {
  for (const changed of [[], [LAW]]) {
    const a = await select({ town: ["a", "b", "c"], stored: ["a", "b", "d"], changed });
    assert.equal(a.error, undefined);
    assert.ok(a.only.includes("c"), "the resident with no stored row is derived");
    assert.ok(a.scope.includes(key("d")), "the stored row of a resident who is gone is in the diff's scope, so it is deleted");
    assert.ok(!a.only.includes("d"), "a gone resident is not handed to the derivation");
  }
  assert.deepEqual((await select({ town: ["a", "b", "c"], stored: ["a", "b", "d"], changed: [] })).only, ["c"]);
});

// ── the guard (the FIX): a failed derivation is not a deletion ───────────────

test("GUARD: on a law change, a resident the derivation omitted aborts the ingest BEFORE the diff, and says how many, not who", async () => {
  const a = await select({ changed: [LAW], cands: (only) => only.filter((h) => h !== "b").map(row) });
  assert.ok(a.error instanceof Error, "the ingest throws");
  assert.match(a.error.message, /1 of 3 residents could not be re-derived/);
  assert.match(a.error.message, /Nothing was written/);
  assert.doesNotMatch(a.error.message, /\bb\b/, "the omitted resident's handle is not named: counts only");
  assert.equal(a.diffs, 0, "the mail_state diff was never invoked, so no stored row could be deleted");
});

test("GUARD: all-failed (an empty candidate array) also aborts, and nothing reaches the diff", async () => {
  const a = await select({ changed: [LAW], cands: () => [] });
  assert.ok(a.error);
  assert.match(a.error.message, /3 of 3 residents/);
  assert.equal(a.diffs, 0);
});

test("GUARD: coverage is by IDENTITY, not by count: same-sized foreign or duplicate candidates do not fill a missing resident", async () => {
  const foreign = await select({ changed: [LAW], cands: () => ["x", "y", "z"].map(row) });
  assert.ok(foreign.error, "three foreign handles are not the three residents");
  const dup = await select({ changed: [LAW], cands: () => ["a", "a", "b"].map(row) });
  assert.ok(dup.error, "a duplicate does not stand in for c");
  assert.match(dup.error.message, /1 of 3/);
  assert.equal(foreign.diffs + dup.diffs, 0);
});

test("GUARD: an empty roster is fine, a null candidate (law file absent) keeps its existing skip, and neither throws", async () => {
  const empty = await select({ town: [], stored: [], changed: [LAW], cands: () => [] });
  assert.equal(empty.error, undefined, "no residents, nothing to cover");
  const none = await select({ changed: [LAW], cands: () => null });
  assert.equal(none.error, undefined, "the existing warn-and-null path is untouched: no new fail-closed policy");
  assert.equal(none.diffs, 0, "and, as before, no diff runs on a null");
});

test("CONTROL: without a law change a partial candidate set does NOT throw: the sparse semantics are as they were", async () => {
  const a = await select({ changed: ["WHITE_PAGES/a/outbox/x.md"], moved: ["a", "b"], cands: (only) => only.filter((h) => h !== "b").map(row) });
  assert.equal(a.error, undefined, "the guard is only on the new law-changed branch");
  assert.equal(a.diffs, 1, "the existing behavior (diff runs on what came back) is unchanged");
});

test("the throw is meant to roll back: TEXT PIN that the caller opens a transaction around applyDelta and rolls back on a throw (source only, no rollback was executed)", () => {
  const caller = between(SRC, 'await client.query("BEGIN");', 'await client.query("ROLLBACK")');
  assert.match(caller, /applyDelta\(/);
  assert.match(caller, /COMMIT/);
});
