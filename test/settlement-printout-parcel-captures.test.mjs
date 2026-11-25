// settlement-printout-parcel-captures.test.mjs — A PARCEL THE SETTLEMENT PRINTED THAT NEWLY TOOK IN AN OLDER FOREIGN MARK
// REACHES THE KEEPER'S RECEIPT (WLD-224), now that the settlement prints itself (POS-1025).
//
//   node --test test/settlement-printout-parcel-captures.test.mjs
//
// Darko, 2026-11-20 15:48 EST: "isn't it just admit normally? and it gets flagged to the worldkeeper for coordination." The
// World asks the question (tools/parcel-captures.mjs § parcelCaptures); its sweep used to ask it after its fold, and the printout
// is the one that folds now, so the printout asks it, of the World it prints onto (settlement-printout.mjs §
// parcelCapturesAfterFold), and its report reaches the receipt through the one adapter the keeper's receipt always used
// (deploy/parcel-captures-reading.mjs). The retired settlement-receipt-parcel-captures.test.mjs's assertions, rehomed onto this
// carrier: the event by name, the quiet night byte-identical, a failed look carried, every event, the whitelist.
//
// THE WORLD'S TOOL IS NOT IN THE OFFICE'S PINNED WORLD (test/clone-pins.json's 90a869e12 predates World 07967bf8b), so the seam
// is driven over a scratch World holding a tool of the World's own interface and report shape, which records what it was asked.
// What the World decides is the World's own tests'; what this office owns is that it asks with the right inputs and carries the
// answer. Invented residents and marks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parcelCapturesAfterFold, STATE_REL } from "../world2/tools/settlement-printout.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT = join(ROOT, "deploy", "settlement-receipt.mjs");

/** The World's own event, as tools/parcel-captures.mjs writes it. */
const event = (over = {}) => ({
  parcel: "ola/the-low-house-parcel", parcel_household: "hh:ola", parcel_by: "ola", parcel_laid: "2026-11-18T09:00:00.000Z",
  mark: "pip/the-cafe", mark_household: "hh:pip", mark_by: "pip", mark_laid: "2026-11-06T08:00:00.000Z", mark_tier: "market",
  overlap_m2: 100, mark_area_m2: 100, ...over,
});
const captures = (events = [event()], over = {}) => ({ checked: true, parcels_checked: 1, events, ...over });

// ── THE SEAM: the printout asks the World's question, with the World's inputs ─

/** A scratch World: its folded state, and (unless `tool` is false) a parcel-captures tool that records its inputs and answers `answer`. */
function scratchWorld({ state = { marks: [] }, tool = true, answer = captures(), throws = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "printout-captures-"));
  mkdirSync(join(dir, "WORLD"), { recursive: true });
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, STATE_REL), JSON.stringify(state));
  if (tool) writeFileSync(join(dir, "tools", "parcel-captures.mjs"), `
import { writeFileSync } from "node:fs";
export function parcelCaptures({ state, publishedIds, priorParentOf }) {
  ${throws ? `throw new Error(${JSON.stringify(throws)});` : ""}
  const ids = [...publishedIds];
  writeFileSync(${JSON.stringify(join(dir, "asked.json"))}, JSON.stringify({ marks: state.marks.map((m) => m.id), publishedIds: ids,
    prior: Object.fromEntries(state.marks.map((m) => [m.id, priorParentOf(m.id)])) }));
  return ${JSON.stringify(answer)};
}`);
  return dir;
}
const asked = async (dir) => JSON.parse((await import("node:fs")).readFileSync(join(dir, "asked.json"), "utf8"));

test("THE SEAM: the World's question is asked of the fold just written, over the ids this printout published, with main's PRE-PRINT parents as the prior", async () => {
  const after = { marks: [{ id: "ola/the-low-house-parcel", kind: "parcel" }, { id: "pip/the-cafe", placementParent: "ola/the-low-house-parcel" }, { id: "pip/the-shed", placementParent: "ola/the-low-house-parcel" }] };
  const before = { marks: [{ id: "pip/the-cafe", placementParent: null }, { id: "pip/the-shed", placementParent: "ola/the-low-house-parcel" }] };
  const dir = scratchWorld({ state: after });
  try {
    const report = await parcelCapturesAfterFold(dir, { publishedIds: ["ola/the-low-house-parcel"], beforeText: JSON.stringify(before) });
    assert.deepEqual(report, captures(), "the World's report, as it gave it");
    const q = await asked(dir);
    assert.deepEqual(q.marks, after.marks.map((m) => m.id), "the folded world the printout just wrote");
    assert.deepEqual(q.publishedIds, ["ola/the-low-house-parcel"], "the ids this printout published");
    assert.deepEqual(q.prior, { "ola/the-low-house-parcel": null, "pip/the-cafe": null, "pip/the-shed": "ola/the-low-house-parcel" },
      "where each filed on main before the printout: a pair that already filed under the parcel is the World's unchanged pair");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ABSENT IS NOT EMPTY, at the seam: a World without the check says nothing; a look that cannot be made is checked: false, with why", async () => {
  const none = scratchWorld({ tool: false });
  try { assert.equal(await parcelCapturesAfterFold(none, { publishedIds: [], beforeText: JSON.stringify({ marks: [] }) }), null); }
  finally { rmSync(none, { recursive: true, force: true }); }

  const dir = scratchWorld();
  try {
    const blind = await parcelCapturesAfterFold(dir, { publishedIds: [], beforeText: "not json" });
    assert.equal(blind.checked, false);
    assert.match(blind.why, /main's folded world before this printout could not be read/);
    const gone = await parcelCapturesAfterFold(dir, { publishedIds: [], beforeText: null });
    assert.equal(gone.checked, false, "no prior is never read as 'every pair is new'");
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const broken = scratchWorld({ throws: "the fold wrote no marks" });
  try {
    const r = await parcelCapturesAfterFold(broken, { publishedIds: [], beforeText: JSON.stringify({ marks: [] }) });
    assert.deepEqual(r, { checked: false, why: "the folded world could not be read for parcel captures: the fold wrote no marks" }, "a fault is a note, never a refusal");
  } finally { rmSync(broken, { recursive: true, force: true }); }
});

// ── THE RECEIPT: the retired receipt test's assertions, on the printout's carrier ─

const printoutOf = (over = {}) => ({
  status: "printed", settlement: 210, window: 420, snapshot: { id: 9, digest: "d".repeat(64), town_sha: "t".repeat(40) },
  base: { settlement: 209, window: 419, printout_sha: "p".repeat(40), world: "w".repeat(40) },
  written: [{ id: "ola/the-low-house-parcel", path: "WORLD/marks/ola/the-low-house-parcel/mark.md" }], removed: [], reframed: [],
  framed: [], registry: { added: ["ola/the-low-house-parcel"], removed: [], set: [], reclassed: [] },
  held_path_collision: [], held_path_collision_count: 0, summary: { written: 1, unchanged: 0, removed: 0, reframed: 0 },
  commit: "c".repeat(40), ...over,
});

/** Compose a receipt the way settlement-auto.sh's `report` function does, from the printout's JSON. */
function compose({ printout = printoutOf(), status = "published", detail = "1 printed" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "receipt-captures-"));
  try {
    const env = { ...process.env, SETTLEMENT_STATUS: status, SETTLEMENT_DETAIL: detail, SETTLEMENT_AT: "2026-11-21T17:45:00Z",
      SETTLEMENT_TOWN_SHA: "5392664e1aa0f6e2f1e0f4a1a1f0c2d3e4f5a6b7",
      SETTLEMENT_WORLD_FROM: "49bd1829b8ebef37ef12428b3412982145b8af92", SETTLEMENT_WORLD_TO: "3a3a645c2c5411f0426fd045efcb3f2ea36e1611" };
    for (const k of Object.keys(env)) if (k.startsWith("SETTLEMENT_") && k.endsWith("_JSON")) delete env[k];
    for (const k of ["SETTLEMENT_DRY", "SETTLEMENT_BY_HAND"]) delete env[k];
    const p = join(dir, "printout.json");
    writeFileSync(p, JSON.stringify(printout));
    env.SETTLEMENT_PRINTOUT_JSON = p;
    return JSON.parse(execFileSync(process.execPath, [RECEIPT], { encoding: "utf8", env }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("THE FALSIFIER: a parcel the settlement printed that took in an older foreign mark reaches the keeper's actual receipt, by name, and the settlement is otherwise what it was", () => {
  const plain = compose();
  const flagged = compose({ printout: printoutOf({ parcel_captures: captures() }) });
  assert.deepEqual(flagged.parcel_captures, { checked: true, parcels_checked: 1, events_total: 1, events: [event()] });
  const { parcel_captures: _note, ...rest } = flagged;
  assert.deepEqual(rest, plain, "a note for coordination: no status, class, refusal or printout field changes");
  assert.equal(flagged.status, "published");
});

test("a quiet night is byte-identical: no key for a printout whose World has no check, nor for one that looked and found nothing", () => {
  const plain = compose();
  assert.ok(!Object.hasOwn(plain, "parcel_captures"));
  assert.deepEqual(compose({ printout: printoutOf({ parcel_captures: captures([]) }) }), plain);
});

test("absent is not empty: a look that failed is carried with its reason, so a blind night is never read as a quiet one", () => {
  const r = compose({ printout: printoutOf({ parcel_captures: { checked: false, why: "the folded world could not be read for parcel captures: x" } }) });
  assert.deepEqual(r.parcel_captures, { checked: false, why: "the folded world could not be read for parcel captures: x" });
});

test("EVERY event reaches the keeper: twenty-one captures in one printout, each mark and household named on the real receipt (WLD-224 N1)", () => {
  const many = Array.from({ length: 21 }, (_, i) => event({ mark: `pip/stall-${String(i).padStart(2, "0")}` }));
  const r = compose({ printout: printoutOf({ parcel_captures: captures(many, { parcels_checked: 3 }) }) });
  assert.equal(r.parcel_captures.events_total, 21);
  assert.deepEqual(r.parcel_captures.events.map((e) => e.mark), many.map((e) => e.mark));
  assert.equal(r.parcel_captures.parcels_checked, 3);
});

test("what the receipt copies is the whitelist, a malformed line is read as nothing, and a refused printout carries no note", () => {
  const r = compose({ printout: printoutOf({ parcel_captures: captures([event({ secret: "x", overlap_m2: "lots" })]) }) });
  assert.ok(!Object.hasOwn(r.parcel_captures.events[0], "secret"));
  assert.equal(r.parcel_captures.events[0].overlap_m2, null);
  assert.ok(!Object.hasOwn(compose({ printout: printoutOf({ parcel_captures: "garbage" }) }), "parcel_captures"));
  const refused = compose({ status: "refused", detail: "x", printout: { status: "refused", refused: "fold-refused", detail: "x", parcel_captures: captures() } });
  assert.ok(!Object.hasOwn(refused, "parcel_captures"), "a refused printout published nothing: no note");
});
