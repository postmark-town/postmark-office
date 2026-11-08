// settlement-receipt-reason.test.mjs — the receipt names why each unpublished or returned mark went (POS-937/a).
//
// Wright, 2026-11-07 15:53:23Z: for each mark the receipt reports as returned or unpublished, the writer
// reads the town's WHITE_PAGES/stamp-ledger.md for that mark's newest `for: unstake` line and names the
// date, the line number and who withdrew; with none, it says "no stake withdrawal on the ledger". No store
// change, no carry-through from the world, no judgment. An unread ledger is not an empty one.
//
// This drives the actual writer (deploy/settlement-receipt.mjs) over invented reports and a temporary
// ledger, the way settlement-receipt-retired.test.mjs composes a receipt. Invented residents and marks only.

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

/** Compose a receipt the way settlement-auto.sh's `report` function does, with a town snapshot holding `ledgerLines` (or none). */
function compose({ sweep = { published: [], unpublished: [] }, retire = undefined, ledgerLines = null, snapshot = true, ledgerPath = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "receipt-reason-"));
  try {
    const env = { ...process.env, SETTLEMENT_STATUS: "published", SETTLEMENT_AT: "2026-11-07T17:45:00Z" };
    delete env.SETTLEMENT_TOWN_SNAPSHOT;
    const put = (name, body) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(body)); return p; };
    env.SETTLEMENT_SWEEP_JSON = put("sweep.json", sweep);
    if (retire !== undefined) env.SETTLEMENT_RETIRE_JSON = put("retire.json", retire);
    if (snapshot) {
      const town = join(dir, "town");
      mkdirSync(join(town, "WHITE_PAGES"), { recursive: true });
      if (ledgerLines !== null && ledgerPath) writeFileSync(join(town, "WHITE_PAGES", "stamp-ledger.md"), ledgerLines.join("\n") + "\n");
      env.SETTLEMENT_TOWN_SNAPSHOT = town;
    }
    return JSON.parse(execFileSync(process.execPath, [RECEIPT], { encoding: "utf8", env }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HEADER = ["# stamp-ledger — the town's stamps, witnessed", "", "Machine-first, append-only.", ""]; // 4 physical lines before the first entry
const entryOf = (r, mark) => r.stake_withdrawals.find((e) => e.mark === mark);

test("an unpublished mark gets its NEWEST matching unstake: date, physical 1-based line, and who actually withdrew", () => {
  const ledger = [
    ...HEADER,
    unstake("2026-10-01", "ana-one/the-lamp", "ana-one"),            // line 5: an older unstake of the same mark
    "- 2026-10-02 · MINT → ren-two · 1 · for: letter-1 (sent) · sig: " + SIG,
    unstake("2026-10-28", "ana-one/the-lamp", "bo-three", 2),        // line 7: the newest, by another hand than the owner
  ];
  const r = compose({ sweep: { unpublished: [{ id: "ana-one/the-lamp" }] }, ledgerLines: ledger });
  assert.deepEqual(r.stake_withdrawals, [{
    mark: "ana-one/the-lamp", listed_as: ["unpublished"], found: true, date: "2026-10-28", line: 7, by: "bo-three",
    said: "stake withdrawn 2026-10-28 by bo-three (stamp-ledger.md line 7)",
  }]);
});

test("the withdrawer is the ledger's, never inferred from the mark's owner", () => {
  const r = compose({ sweep: { unpublished: [{ id: "ana-one/the-lamp" }] }, ledgerLines: [...HEADER, unstake("2026-10-30", "ana-one/the-lamp", "cy-four")] });
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
  const r = compose({ sweep: { unpublished: [{ id: mark }] }, ledgerLines: ledger });
  assert.deepEqual(entryOf(r, mark), { mark, listed_as: ["unpublished"], found: false, date: null, line: null, by: null, said: "no stake withdrawal on the ledger" });
});

test("no match says the exact sentence; a mark that has one beside one that has none each get their own answer", () => {
  const ledger = [...HEADER, unstake("2026-10-30", "ana-one/the-lamp", "ana-one")];
  const r = compose({ sweep: { unpublished: [{ id: "ana-one/the-lamp" }, { id: "dee-five/the-door" }] }, ledgerLines: ledger });
  assert.equal(entryOf(r, "ana-one/the-lamp").found, true);
  assert.equal(entryOf(r, "dee-five/the-door").said, "no stake withdrawal on the ledger");
  assert.equal(entryOf(r, "dee-five/the-door").found, false);
});

test("returned and retired marks are named too, each once, with how the receipt lists them", () => {
  const ledger = [...HEADER, unstake("2026-10-30", "ana-one/the-lamp", "ana-one"), unstake("2026-10-31", "bo-three/the-gate", "bo-three")];
  const r = compose({
    sweep: { unpublished: [{ id: "ana-one/the-lamp" }] },
    retire: { ran: true, count: 2, retired: [{ slug: "ana-one/the-lamp" }, { slug: "bo-three/the-gate" }], already_retired: [], absent: [],
      drafts: { returned: [{ slug: "bo-three/the-gate" }], kept: [], unreturned: [] } },
    ledgerLines: ledger,
  });
  assert.equal(r.stake_withdrawals.length, 2, "one entry per mark, not per list");
  assert.deepEqual(entryOf(r, "ana-one/the-lamp").listed_as, ["unpublished", "retired"]);
  assert.deepEqual(entryOf(r, "bo-three/the-gate").listed_as, ["retired", "returned"]);
  assert.equal(entryOf(r, "bo-three/the-gate").line, 6);
  // the existing fields keep their meaning
  assert.deepEqual(r.retired.slugs, ["ana-one/the-lamp", "bo-three/the-gate"]);
  assert.deepEqual(r.retired.drafts.returned, ["bo-three/the-gate"]);
  assert.equal(r.channels.unpublished, 1);
});

test("AN UNREAD LEDGER IS NOT AN EMPTY ONE: no snapshot, or no ledger file in it: found is null and the sentence says so", () => {
  const sweep = { unpublished: [{ id: "ana-one/the-lamp" }] };
  for (const [name, r] of [
    ["no town snapshot", compose({ sweep, snapshot: false })],
    ["a snapshot with no ledger file", compose({ sweep, snapshot: true, ledgerLines: null })],
  ]) {
    const e = entryOf(r, "ana-one/the-lamp");
    assert.equal(e.found, null, name);
    assert.match(e.said, /^could not read the stake ledger: /, name);
    assert.doesNotMatch(e.said, /no stake withdrawal on the ledger/, `${name}: never called an empty ledger`);
    assert.deepEqual([e.date, e.line, e.by], [null, null, null], name);
  }
  assert.match(entryOf(compose({ sweep, snapshot: false }), "ana-one/the-lamp").said, /no town snapshot/);
  assert.match(entryOf(compose({ sweep, ledgerLines: null }), "ana-one/the-lamp").said, /could not be read in the town snapshot \(ENOENT\)/);
});

test("a crossing that returned or unpublished nothing names no one, reads no ledger and adds no key; the receipt keeps every other field as before", () => {
  const r = compose({ sweep: { published: ["ana-one/x"], unpublished: [] }, snapshot: false });
  assert.equal("stake_withdrawals" in r, false, "a zero-return receipt is exactly as it was");
  assert.equal(r.channels.published, 1);
  assert.equal(r.channels.unpublished, 0);
  assert.equal(r.retired.ran, false);
});

test("a ledger with CRLF endings and a mark listed as a bare string still matches, on the same physical line", () => {
  const r = compose({ sweep: { unpublished: ["ana-one/the-lamp"] }, ledgerLines: [...HEADER, unstake("2026-10-30", "ana-one/the-lamp", "ana-one") + "\r"] });
  assert.deepEqual([entryOf(r, "ana-one/the-lamp").found, entryOf(r, "ana-one/the-lamp").line], [true, 5]);
});
