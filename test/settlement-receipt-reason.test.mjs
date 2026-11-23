// settlement-receipt-reason.test.mjs — the receipt names why each mark that went, went (POS-937/a; POS-1025).
//
// Wright, 2026-11-07 15:53:23Z: for each mark the receipt reports as gone, the writer reads the town's
// WHITE_PAGES/stamp-ledger.md for that mark's newest `for: unstake` line and names the date, the line
// number and who withdrew; with none, it says "no stake withdrawal on the ledger". No store change, no
// carry-through from the world, no judgment. An unread ledger is not an empty one.
//
// Since the printout (POS-1025) the marks that went are the printout's `removed` (the clearing retired
// them before its seal), listed as `removed`. This drives the actual writer (deploy/settlement-receipt.mjs)
// over an invented printout report and a temporary ledger. Invented residents and marks only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT = join(ROOT, "deploy", "settlement-receipt.mjs");
const SIG = "S".repeat(86);
const unstake = (date, mark, who, n = 1) => `- ${date} · stake:world-mark/${mark} → ${who} · ${n} · for: unstake · sig: ${SIG}`;
const pathOf = (slug) => `WORLD/marks/${slug}/mark.md`;

/** Compose a receipt the way settlement-auto.sh's `report` function does, with a town snapshot holding `ledgerLines` (or none). */
function compose({ written = [], removed = [], printout = undefined, ledgerLines = null, snapshot = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "receipt-reason-"));
  try {
    const env = { ...process.env, SETTLEMENT_STATUS: "published", SETTLEMENT_AT: "2026-11-07T17:45:00Z" };
    delete env.SETTLEMENT_TOWN_SNAPSHOT;
    const put = (name, body) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(body)); return p; };
    env.SETTLEMENT_PRINTOUT_JSON = put("printout.json", printout ?? {
      status: "printed", settlement: 214, window: 213,
      written: written.map((id) => ({ id, path: pathOf(id) })),
      removed: removed.map((r) => (typeof r === "string" ? { slug: r, path: pathOf(r) } : r)),
      reframed: [], summary: { written: written.length, removed: removed.length, reframed: 0 },
    });
    if (snapshot) {
      const town = join(dir, "town");
      mkdirSync(join(town, "WHITE_PAGES"), { recursive: true });
      if (ledgerLines !== null) writeFileSync(join(town, "WHITE_PAGES", "stamp-ledger.md"), ledgerLines.join("\n") + "\n");
      env.SETTLEMENT_TOWN_SNAPSHOT = town;
    }
    return JSON.parse(execFileSync(process.execPath, [RECEIPT], { encoding: "utf8", env }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HEADER = ["# stamp-ledger — the town's stamps, witnessed", "", "Machine-first, append-only.", ""]; // 4 physical lines before the first entry
const entryOf = (r, mark) => r.stake_withdrawals.find((e) => e.mark === mark);

test("a removed mark gets its NEWEST matching unstake: date, physical 1-based line, and who actually withdrew", () => {
  const ledger = [
    ...HEADER,
    unstake("2026-10-01", "ana-one/the-lamp", "ana-one"),            // line 5: an older unstake of the same mark
    "- 2026-10-02 · MINT → ren-two · 1 · for: letter-1 (sent) · sig: " + SIG,
    unstake("2026-10-28", "ana-one/the-lamp", "bo-three", 2),        // line 7: the newest, by another hand than the owner
  ];
  const r = compose({ removed: ["ana-one/the-lamp"], ledgerLines: ledger });
  assert.deepEqual(r.stake_withdrawals, [{
    mark: "ana-one/the-lamp", listed_as: "removed", found: true, date: "2026-10-28", line: 7, by: "bo-three",
    said: "stake withdrawn 2026-10-28 by bo-three (stamp-ledger.md line 7)",
  }]);
});

test("the withdrawer is the ledger's, never inferred from the mark's owner", () => {
  const r = compose({ removed: ["ana-one/the-lamp"], ledgerLines: [...HEADER, unstake("2026-10-30", "ana-one/the-lamp", "cy-four")] });
  assert.equal(entryOf(r, "ana-one/the-lamp").by, "cy-four");
});

test("siblings and other kinds never match: a longer slug, another owner, a post, a pot, a close, a stake-in, and a malformed amount", () => {
  const mark = "ana-one/the-lamp";
  const ledger = [
    ...HEADER,
    unstake("2026-10-03", "ana-one/the-lamp-two", "ana-one"),                                  // a sibling slug that starts the same
    unstake("2026-10-04", "other-owner/the-lamp", "other-owner"),                              // same slug, another owner
    `- 2026-10-05 · stake:post/ana-one/the-lamp → ana-one · 1 · for: unstake · via: api`,       // another kind
    `- 2026-10-06 · stake:pot/ana-one/the-lamp → ana-one · 1 · for: unstake · via: api`,
    `- 2026-10-07 · stake:world-mark/ana-one/the-lamp → ana-one · 1 · for: close · sig: ${SIG}`, // a close, not an unstake
    `- 2026-10-08 · ana-one → stake:world-mark/ana-one/the-lamp · 1 · via: api · sig: ${SIG}`,   // the stake going IN
    `- 2026-10-09 · stake:world-mark/ana-one/the-lamp → ana-one · 0 · for: unstake · sig: ${SIG}`, // a zero amount is no line
  ];
  const r = compose({ removed: [mark], ledgerLines: ledger });
  assert.deepEqual(entryOf(r, mark), { mark, listed_as: "removed", found: false, date: null, line: null, by: null, said: "no stake withdrawal on the ledger" });
});

test("no match says the exact sentence; a mark that has one beside one that has none each get their own answer", () => {
  const ledger = [...HEADER, unstake("2026-10-30", "ana-one/the-lamp", "ana-one")];
  const r = compose({ removed: ["ana-one/the-lamp", "dee-five/the-door"], ledgerLines: ledger });
  assert.equal(entryOf(r, "ana-one/the-lamp").found, true);
  assert.equal(entryOf(r, "dee-five/the-door").said, "no stake withdrawal on the ledger");
  assert.equal(entryOf(r, "dee-five/the-door").found, false);
});

test("only marks the printout actually removed are named: a removal with nothing on main to remove names no one", () => {
  const ledger = [...HEADER, unstake("2026-10-30", "ana-one/the-lamp", "ana-one")];
  const r = compose({ removed: ["ana-one/the-lamp", { slug: "bo-three/the-gate", path: null, note: "not on main: nothing to remove" }], ledgerLines: ledger });
  assert.deepEqual(r.stake_withdrawals.map((e) => e.mark), ["ana-one/the-lamp"]);
  assert.equal(r.channels.unpublished, 1);
  // the printout block still carries both, with the note, for the keeper
  assert.deepEqual(r.printout.removed.map((g) => g.id), ["ana-one/the-lamp", "bo-three/the-gate"]);
  assert.equal(r.printout.removed[1].note, "not on main: nothing to remove");
});

test("AN UNREAD LEDGER IS NOT AN EMPTY ONE: no snapshot, or no ledger file in it: found is null and the sentence says so", () => {
  const removed = ["ana-one/the-lamp"];
  for (const [name, r] of [
    ["no town snapshot", compose({ removed, snapshot: false })],
    ["a snapshot with no ledger file", compose({ removed, snapshot: true, ledgerLines: null })],
  ]) {
    const e = entryOf(r, "ana-one/the-lamp");
    assert.equal(e.found, null, name);
    assert.match(e.said, /^could not read the stake ledger: /, name);
    assert.doesNotMatch(e.said, /no stake withdrawal on the ledger/, `${name}: never called an empty ledger`);
    assert.deepEqual([e.date, e.line, e.by], [null, null, null], name);
  }
  assert.match(entryOf(compose({ removed, snapshot: false }), "ana-one/the-lamp").said, /no town snapshot/);
  assert.match(entryOf(compose({ removed, ledgerLines: null }), "ana-one/the-lamp").said, /could not be read in the town snapshot \(ENOENT\)/);
});

test("a printout that removed nothing names no one, reads no ledger and adds no key", () => {
  const r = compose({ written: ["ana-one/x"], snapshot: false });
  assert.equal("stake_withdrawals" in r, false, "a zero-removal receipt carries no such key");
  assert.deepEqual(r.channels, { published: 1, unpublished: 0, reframed: 0 });
});

test("a refused printout names no one and counts nothing: a refusal never reads as a quiet zero", () => {
  const r = compose({ printout: { status: "refused", refused: "reframe-refused", detail: "…" }, snapshot: false });
  assert.equal("stake_withdrawals" in r, false);
  assert.equal(r.channels, null);
  assert.equal(r.class, "printout-refused");
  assert.equal(r.printout.status, "refused");
});

test("a ledger with CRLF endings still matches, on the same physical line", () => {
  const r = compose({ removed: ["ana-one/the-lamp"], ledgerLines: [...HEADER, unstake("2026-10-30", "ana-one/the-lamp", "ana-one") + "\r"] });
  assert.deepEqual([entryOf(r, "ana-one/the-lamp").found, entryOf(r, "ana-one/the-lamp").line], [true, 5]);
});
