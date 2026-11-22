// settlement-printout-held.test.mjs — WLD-230's filing guard, as the printout meets it (POS-1025 integration for w49).
//
// The write-down planner (src/store-writedown.mjs § planStoreWriteDown) holds a mark whose planned filing is another id's published file, and
// whoever files under it, rather than overwrite (WLD-230: window 325 overwrote seth/signed-la-linterna). Since the printout (POS-1025) the
// settlement's publication is the SEALED record and the printout renders it through that same planner, so a held mark meets the printout's
// registry: the sealed registry holds a row the printout neither wrote nor main files.
//
// WHAT THIS PINS, and what it does not decide:
//   · the refusal that row gets names the hold and whose filing it met (instead of the generic "unprintable" words), and still refuses:
//     a refused printout publishes nothing and alarms. Since Wright's 2026-11-22 00:13Z return (WLD-230/a, "the collision check belongs to
//     settlement-decides") the hold is decided BEFORE the seal and the rest prints around it (settlement-printout.test.mjs case 6), so a
//     sealed-published row the printout still cannot file is a real fault, and this refusal is its backstop;
//   · the planner's hold is carried onto the printout's report and the settlement receipt (held_path_collision and its count), with the
//     receipt's null convention;
//   · the printout commit says its window in a `Window: <id>` trailer (POS-940 fix c, carried from the retired sweep's name_window).
//   node --test test/settlement-printout-held.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { printoutMessage, registryRowRefusal } from "../world2/tools/settlement-printout.mjs";
import { WINDOW_TRAILER } from "../world2/tools/settlements-backfill.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT = join(ROOT, "deploy", "settlement-receipt.mjs");

const LYRA = "lyra-of-the-east-tower/signed-la-linterna";
const NOTE = "lyra-of-the-east-tower/a-note-on-it";
const SETH_PATH = "WORLD/marks/bramblewick/libro-de-visitas-de-la-linterna/signed-la-linterna/mark.md";
const HELD = [
  { id: LYRA, path: SETH_PATH, held_by_filing_of: "seth/signed-la-linterna", crossing_output: "path-held-by-another-id" },
  { id: NOTE, path: SETH_PATH.replace("/mark.md", "/a-note-on-it/mark.md"), held_by_filing_of: "seth/signed-la-linterna", depends_on: LYRA, crossing_output: "parent-held" },
];

test("a sealed registry row the planner HELD is refused by name, with whose filing it met; any other unfilable row keeps the generic words", () => {
  const held = registryRowRefusal({ slug: LYRA, path: null, household: "lyra", held: HELD });
  assert.equal(held.reason, "filing-held-by-another-id");
  assert.match(held.detail, /the write-down held it \(path-held-by-another-id\)/);
  assert.match(held.detail, /seth\/signed-la-linterna's published file/);
  assert.match(held.detail, /nothing was printed/);
  const dependent = registryRowRefusal({ slug: NOTE, path: null, household: "lyra", held: HELD });
  assert.equal(dependent.reason, "filing-held-by-another-id");
  assert.match(dependent.detail, /files under lyra-of-the-east-tower\/signed-la-linterna/, "a dependent says what it files under");
  const other = registryRowRefusal({ slug: "someone/else", path: null, household: null, held: HELD });
  assert.equal(other.reason, "registry-unprintable");
  assert.match(other.detail, /neither this printout nor main files it/);
  assert.equal(registryRowRefusal({ slug: "someone/else", path: "WORLD/marks/someone/else/mark.md", household: "h", held: HELD }), null, "a row that can be filed is no refusal");
  assert.equal(registryRowRefusal({ slug: LYRA, path: "x", household: "h", held: HELD }), null, "and the hold never refuses a row that has its path and its house");
  assert.equal(registryRowRefusal({ slug: "a/b", path: null, household: "h", held: undefined }).reason, "registry-unprintable", "no hold list is no hold");
});

test("the printout commit ends in the Window: trailer the backfill prefers, and keeps the subject its readers know", () => {
  const m = printoutMessage({ settlement: 90, window: 211, snapshotId: 4, digest: "d".repeat(64), townSha: "t".repeat(40), written: 2, removed: 1, reframed: 0,
    from: { sealed_settlement: 89, window_id: 210 }, quiet: false });
  assert.equal(m.split("\n")[0], "settlement: S90 printout — 2 written, 1 removed, 0 re-framed", "the subject (printoutOnMain finds a landed printout by it)");
  const last = m.trimEnd().split("\n\n").at(-1);
  assert.match(last, WINDOW_TRAILER, "the last paragraph is the trailer block");
  assert.equal(last, "Window: 211");
  const quiet = printoutMessage({ settlement: 91, window: 212, snapshotId: 5, digest: "e".repeat(64), townSha: null, written: 0, removed: 0, reframed: 0, from: { sealed_settlement: 90, window_id: 211 }, quiet: true });
  assert.match(quiet, /an empty printout, so it is printed and tagged like every other\.\n\nWindow: 212$/, "an empty printout names its window too");
  // git itself reads it as a trailer
  const out = execFileSync("git", ["interpret-trailers", "--parse"], { input: m, encoding: "utf8" });
  assert.equal(out.trim(), "Window: 211");
});

/** The real receipt writer over an invented printout report, the way settlement-auto.sh's `report` runs it. */
function compose(printout) {
  const dir = mkdtempSync(join(tmpdir(), "receipt-held-"));
  try {
    const p = join(dir, "printout.json");
    writeFileSync(p, JSON.stringify(printout));
    const env = { ...process.env, SETTLEMENT_STATUS: "published", SETTLEMENT_AT: "2026-11-21T23:00:00Z", SETTLEMENT_PRINTOUT_JSON: p };
    delete env.SETTLEMENT_TOWN_SNAPSHOT;
    return JSON.parse(execFileSync(process.execPath, [RECEIPT], { encoding: "utf8", env }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const PRINTED = { status: "printed", settlement: 214, window: 213, written: [{ id: "a/one", path: "WORLD/marks/a/one/mark.md" }], removed: [], reframed: [], summary: { written: 1, removed: 0, reframed: 0 } };

test("the receipt carries the printout's held marks and their count: named in full; a printout that reported none is null, held none is empty", () => {
  const r = compose({ ...PRINTED, held_path_collision: HELD, held_path_collision_count: 2 });
  assert.deepEqual(r.printout.held_path_collision, HELD);
  assert.equal(r.printout.held_path_collision_count, 2);
  assert.deepEqual(r.printout.written, [{ id: "a/one", path: "WORLD/marks/a/one/mark.md" }], "the held marks are in no written list");
  const none = compose({ ...PRINTED, held_path_collision: [], held_path_collision_count: 0 });
  assert.deepEqual(none.printout.held_path_collision, []);
  assert.equal(none.printout.held_path_collision_count, 0);
  const absent = compose(PRINTED);
  assert.equal(absent.printout.held_path_collision, null);
  assert.equal(absent.printout.held_path_collision_count, null);
  // a refused printout carries its refusal's words (which name the held mark), as it always did
  const refused = compose({ status: "refused", refused: "filing-held-by-another-id", detail: "the sealed registry holds x" });
  assert.equal(refused.printout.refused, "filing-held-by-another-id");
  assert.match(refused.printout.detail, /sealed registry holds x/);
});
