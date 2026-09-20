// world2-ledger-names.test.mjs — the guard on the guard that went stale.
//
// postmark#2894: `falsifier-live-equality.mjs`'s E6occupancy resolved its ledger
// from the frozen passage acts' own `payload._ledger`, which says
// `WORLD/threshold-ledger.md` — a file deleted from world main on 2026-08-28. On
// every current checkout E6 compared 0, a compared-0 equality lands in
// `unchecked`, and `unchecked` exits the whole run 2 (CANNOT RUN). Nineteen days
// silent.
//
// WHAT THIS FILE CAN AND CANNOT PROVE, said plainly so nobody reads more into a
// green than it earns. `falsifier-live-equality.mjs` parses argv, imports the
// checkout's tools and connects to Postgres at module scope, so it cannot be
// imported here and E6 cannot be called directly without a store, a clone and a
// Postgres. What IS proven here is the resolution the repair turns on, over real
// directories on disk, plus a scoped source assertion that E6 is wired to it.
// The end-to-end run against prod's store stays what it always was: the recipe
// in world2/tools/README.md, run on the box.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LEDGER_RENAMES, resolveLedgerRel } from "../world2/tools/ledger-names.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RETIRED = "WORLD/threshold-ledger.md";
const CURRENT = "WORLD/enter-exit-ledger.md";

/** A throwaway checkout carrying exactly the WORLD/ files named. */
function checkout(...rels) {
  const dir = mkdtempSync(join(tmpdir(), "w2-ledger-"));
  for (const rel of rels) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), `# ${rel}\n`, "utf8");
  }
  return dir;
}

test("a checkout that still carries the named file is read untouched — settlement/S50's case", () => {
  // THE NON-REGRESSION, and it is the important one: at S50 both sides of the
  // rename stand, so the repair must not reach for the successor. A verdict that
  // was reachable before this change must be byte-for-byte reachable after it.
  const dir = checkout(RETIRED, CURRENT);
  try {
    const r = resolveLedgerRel(dir, RETIRED);
    assert.equal(r.rel, RETIRED, "the named file exists and must be the one read");
    assert.equal(r.followed, null, "nothing was forwarded, and the answer must say so");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a checkout carrying only the successor follows the rename — the defect, and the fix", () => {
  // This is the shape of every world checkout since 2026-08-28, and the shape
  // that used to exit the whole falsifier 2.
  const dir = checkout(CURRENT);
  try {
    const r = resolveLedgerRel(dir, RETIRED);
    assert.ok(r, "a checkout carrying the successor must resolve, not refuse");
    assert.equal(r.rel, CURRENT);
    assert.equal(r.followed.from, RETIRED);
    assert.equal(r.followed.to, CURRENT);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a checkout carrying neither still refuses — the honest refusal is preserved", () => {
  // A resolver that invented an answer here would be worse than the bug: E6
  // would compare the store against a file it was not built from and call it
  // equality. Refusing keeps E6's own `compared: 0` message reachable.
  const dir = checkout("WORLD/walk-ledger.md");
  try {
    assert.equal(resolveLedgerRel(dir, RETIRED), null);
    assert.equal(resolveLedgerRel(dir, "WORLD/never-existed.md"), null,
      "an unknown path with no rename entry refuses too");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("missing arguments refuse rather than throw", () => {
  assert.equal(resolveLedgerRel(null, RETIRED), null);
  assert.equal(resolveLedgerRel("/nowhere", null), null);
});

test("the rename is DATED and EVIDENCED, and does not repeat the issue's own error", () => {
  // A rename table whose dates are wrong is a rename table nobody can audit.
  // postmark#2894 and the POS-104 report both date this to 2026-08-29 and
  // attribute it to world 3ef755913, which is not an ancestor of world main.
  // Measured in a read-only clone on 2026-09-17: the removal is 2a9042d4b,
  // 2026-08-28. These assertions are what stop the wrong date drifting back in.
  const e = LEDGER_RENAMES[RETIRED];
  assert.ok(e, "the retired path must be in the table");
  assert.equal(e.to, CURRENT);
  assert.equal(e.on, "2026-08-28", "the REMOVAL date, not the day of the founder's word");
  assert.ok(e.by.startsWith("2a9042d4b"), "the commit that deleted it from main");
  assert.ok(/3ef755913/.test(e.word) && /NOT an ancestor/.test(e.word),
    "the founder's vocabulary ruling is recorded as the word it is, and marked as off-main");
  assert.ok(/byte-identical/.test(e.proof), "the successor claim carries its proof");
});

test("E6occupancy is wired to the resolver, and no longer to a bare existsSync", async () => {
  // A SCAN CANNOT TELL A CITATION FROM A CORRECTION, so this reads the body of
  // e6Occupancy ONLY, with comment lines stripped — a sentence about the
  // resolver in a comment must not be able to turn this green.
  const src = await readFile(join(HERE, "..", "world2", "tools", "falsifier-live-equality.mjs"), "utf8");
  const start = src.indexOf("export function e6Occupancy");
  assert.ok(start > 0, "e6Occupancy must still be exported under that name");
  const end = src.indexOf("\n}", src.indexOf("return {", start));
  const body = src.slice(start, end)
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.match(body, /resolveLedgerRel\(REPO, rel\)/,
    "E6 must resolve through the rename table");
  assert.doesNotMatch(body, /existsSync\(join\(REPO, rel\)\)/,
    "the filename-pinned refusal that went stale must be gone");
  assert.match(body, /ledger: resolved\.rel/,
    "the answer must name the file actually opened, not the one the acts asked for");
});
