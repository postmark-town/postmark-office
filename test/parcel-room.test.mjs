// parcel-room.test.mjs — PARCELS FROM 11-01: the facts the world's fold sizes a
// household's parcel room by, and the warning at the leave-mark door (POS-762).
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/parcel-room.test.mjs
//
// The rule is the world's (postmark-world tools/marks-fold.mjs § parcels from
// 11-01) and the purchase line is the town's (postmark tools/stamp-mint.mjs §
// parcels from 11-01). What is the office's, and what this file holds:
//   1. a house's keys resolve to one house (hh:, formerly, gh:<account id>);
//   2. the purchases are the town's classifyEntry's `parcel-burn` lines, and a
//      town too old to know the kind has none;
//   3. the facts are each declared house's `since` and its purchase count;
//   4. houseFactsAt reads them from a snapshot's own two sources, the register
//      rows and the town checkout, and foldHouseholds hands them on, or none
//      (and says so) when it has no town;
//   5. the door's note speaks only for a new parcel past the room, in the
//      engine's own sentence, and never without the engine's law;
//   6. end to end, at a pinned world that carries the law: a house settled after
//      10-31 holds one, the clearing's limit pass opposes the second, and a
//      purchase makes room.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { houseKeyCanon, parcelBurnsOf, houseFactsOf, houseFactsAt, parcelRoomNoteOf } from "../src/parcel-room.mjs";
import { foldHouseholds } from "../src/world-snapshot.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORLD_CLONE = process.env.WORLD_CLONE ?? join(ROOT, "world-clone");

const registry = { households: {
  "the-rowan": { accounts: [{ login: "rowan-gh", id: 101 }], residents: ["ash", "birch"], since: "2026-11-02", formerly: ["rowan-house"] },
  "the-oak": { accounts: [{ login: "oak-gh", id: 102 }], residents: ["oak"], since: "2026-10-31" },
  "no-day": { accounts: [], residents: ["mist"] },
} };
// A stand-in for the town's classifyEntry, in the line's own grammar: the
// grammar itself is the town's and is tested there (stamp-parcel-burn.test.mjs).
const PARCEL = /^- (\d{4}-\d{2}-\d{2}) · (\S+) → BURN · (\d+) · for: parcel:([23])\/(\S+)$/;
const classifyEntry = (c) => {
  const m = PARCEL.exec(c);
  return m ? { kind: "parcel-burn", date: m[1], handle: m[2], n: Number(m[3]), nth: Number(m[4]), household: m[5] } : { kind: "unknown" };
};
const BUY = (handle, nth, household, n = 50 * (nth - 1)) => `- 2026-11-03 · ${handle} → BURN · ${n} · for: parcel:${nth}/${household}`;

test("1 · a house's keys are one house: its slug, a slug it once carried, an account it holds", () => {
  const canon = houseKeyCanon(registry);
  assert.equal(canon("hh:the-rowan"), "hh:the-rowan");
  assert.equal(canon("hh:rowan-house"), "hh:the-rowan");
  assert.equal(canon("gh:101"), "hh:the-rowan");
  assert.equal(canon("gh:102"), "hh:the-oak");
  assert.equal(canon("gh:999"), "gh:999", "a key no house holds is itself");
});

test("2 · the purchases are the classifier's parcel-burn lines; no classifier, or none of the kind, is none", () => {
  const lines = [BUY("ash", 2, "hh:the-rowan"), "- 2026-11-03 · ash → BURN · 50 · for: correction:x · by: wright", "- 2026-11-03 · MINT → ash · 1 · for: x (sent)"];
  assert.deepEqual(parcelBurnsOf(lines, classifyEntry), [{ date: "2026-11-03", handle: "ash", n: 50, nth: 2, household: "hh:the-rowan" }]);
  assert.deepEqual(parcelBurnsOf(lines, null), [], "no town engine: nothing is a purchase");
  assert.deepEqual(parcelBurnsOf(lines, () => ({ kind: "unknown" })), [], "a town too old to know the kind: none");
});

test("3 · the facts: each declared house's settling day and its purchases, counted across its spellings", () => {
  const burns = parcelBurnsOf([BUY("ash", 2, "gh:101"), BUY("birch", 3, "hh:rowan-house")], classifyEntry);
  assert.deepEqual(houseFactsOf({ registry, burns }), {
    "hh:the-rowan": { since: "2026-11-02", bought: 2 },
    "hh:the-oak": { since: "2026-10-31", bought: 0 },
  }, "a house with no settling day states no facts, so the fold keeps it at three");
  assert.deepEqual(houseFactsOf({ registry: null }), {});
});

/** The register rows a snapshot seals, as world-snapshot.mjs § registerOfVersions reads them. */
const registerRows = () => Object.entries(registry.households).map(([slug, rec], ord) => ({
  key: `households/${slug}`, digest: `d${ord}`,
  row: JSON.stringify({ table: "households", slug, ord, name: null, human: null, accounts: rec.accounts, residents: rec.residents,
    since: rec.since ?? null, member_of: null, declared_by: "t", formerly: rec.formerly ?? [], provisional: false }),
}));
/** A town checkout with a ledger and the engine that reads it (the stand-in classifier above). */
function townWith(lines, { engine = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "parcel-room-town-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  if (engine) writeFileSync(join(dir, "tools", "stamp-mint.mjs"),
    `const PARCEL = ${PARCEL};\n`
    + `export const classifyEntry = ${classifyEntry.toString()};\n`
    + "export const parseStampLedger = (text) => text.split(/\\r?\\n/).filter((l) => l.startsWith('- ')).map((l) => ({ canonical: l.replace(/ · sig: \\S+$/, '') }));\n");
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "# stamp-ledger\n\n" + lines.map((l) => `${l} · sig: x`).join("\n") + "\n");
  return dir;
}

test("4 · houseFactsAt reads the snapshot's two sources: the sealed register and the town's ledger at its position", async () => {
  const town = townWith([BUY("ash", 2, "hh:the-rowan")]);
  const bare = townWith([BUY("ash", 2, "hh:the-rowan")], { engine: false });
  try {
    assert.deepEqual(await houseFactsAt(registerRows(), town), {
      "hh:the-rowan": { since: "2026-11-02", bought: 1 },
      "hh:the-oak": { since: "2026-10-31", bought: 0 },
    });
    assert.deepEqual((await houseFactsAt(registerRows(), bare))["hh:the-rowan"], { since: "2026-11-02", bought: 0 },
      "a town with no engine reads no purchases: the days still stand");
  } finally { rmSync(town, { recursive: true, force: true }); rmSync(bare, { recursive: true, force: true }); }
});

test("4 · foldHouseholds without a town hands on no facts, and its source says every household keeps three", async () => {
  const p = { query: async () => ({ rows: [] }) }; // no roster at the law
  const r = await foldHouseholds(p, { lawSha: "0".repeat(40), registerRows: null, townRepo: null });
  assert.equal(r.houseFacts, null);
  assert.match(r.source, /no parcel facts, so every household keeps the cap of three/);
});

const TOWN_CLONE = join(ROOT, "town-clone");
const NO_TOWN = existsSync(join(TOWN_CLONE, "tools", "stamp-mint.mjs")) ? false : "no town-clone/ beside the office";

test("4 · foldHouseholds with the register and the town hands the facts on beside the households, and says so", { skip: NO_TOWN }, async () => {
  const r = await foldHouseholds(null, { lawSha: "0".repeat(40), registerRows: async () => registerRows(), townRepo: TOWN_CLONE });
  assert.ok(r.households && typeof r.households === "object" && Object.keys(r.households).length > 0, "the households, as before (the town's own residents)");
  assert.deepEqual(r.houseFacts, await houseFactsAt(registerRows(), TOWN_CLONE), "the facts, from the same two sources");
  assert.equal(r.houseFacts["hh:the-rowan"].since, "2026-11-02");
  assert.match(r.source, /parcel room: each house's settling day there, and its parcel purchases on the ledger/);
});

// The engine's two exports, standing in for the world's law (its own test holds the law: postmark-world tools/parcel-room.test.mjs).
const engine = {
  parcelRoomOf: (f) => (f?.since > "2026-10-31" ? Math.min(3, 1 + (f.bought ?? 0)) : 3),
  parcelCapRefusal: (held, room) => `parcel claim capped — this household holds ${held} and has room for ${room}`,
};

test("5 · the door's note: only a new parcel past the room, in the engine's own sentence", () => {
  const fact = { since: "2026-11-02", bought: 0 };
  const note = parcelRoomNoteOf({ kind: "parcel", held: 1, fact, engine });
  assert.deepEqual(note, { held: 1, room: 1,
    note: "parcel claim capped — this household holds 1 and has room for 1. Your claim is written, and the next crossing opposes it unless the household has room by then." });
  assert.equal(parcelRoomNoteOf({ kind: "parcel", held: 0, fact, engine }), null, "the first parcel fits");
  assert.equal(parcelRoomNoteOf({ kind: "parcel", held: 1, fact: { ...fact, bought: 1 }, engine }), null, "a bought room fits the second");
  assert.equal(parcelRoomNoteOf({ kind: "parcel", held: 2, fact: { since: "2026-10-31" }, engine }), null, "settled by 10-31: three");
  assert.ok(parcelRoomNoteOf({ kind: "parcel", held: 3, fact: { since: "2026-10-31" }, engine }), "and the fourth is still past the cap");
  assert.equal(parcelRoomNoteOf({ kind: "parcel", amending: true, held: 1, fact, engine }), null, "an amend moves a parcel, it adds none");
  assert.equal(parcelRoomNoteOf({ kind: "sited", held: 1, fact, engine }), null, "only a parcel");
  assert.equal(parcelRoomNoteOf({ kind: "parcel", held: 1, fact, engine: {} }), null, "an engine without the law says nothing");
});

// ── 6 · end to end, at a pinned world that carries the law ───────────────────
let worldFold = null;
try {
  const p = join(WORLD_CLONE, "tools", "marks-fold.mjs");
  if (existsSync(p)) worldFold = await import(pathToFileURL(p).href);
} catch { worldFold = null; }
const NO_LAW = typeof worldFold?.parcelRoomOf === "function" ? false
  : "the pinned world clone predates postmark-world#300 (the parcel room); this runs once the pin moves past it";

test("6 · end to end: a house settled after 10-31 holds one, the limit pass opposes the second, and a purchase makes room", { skip: NO_LAW }, async () => {
  const { limitOppositions } = await import("../src/world-settlement.mjs");
  const P = (id, by, x) => ({ id, by, household: by, kind: "parcel", tier: "market", at: { x, y: 0 }, extent: { w: 25, h: 25 }, date: `2026-11-0${x / 500 + 2}T12:00:00Z`, body: "b" });
  const marks = () => [P("ash/one", "ash", 0), P("birch/two", "birch", 500)];
  const households = { ash: "hh:the-rowan", birch: "hh:the-rowan" };
  const foldWith = (houseFacts) => worldFold.fold({ marks: marks(), terrain: { features: [] }, stakes: [], tick: 1, households, houseFacts });
  const none = houseFactsOf({ registry, burns: [] });
  assert.deepEqual(limitOppositions(foldWith(none)).map((l) => [l.mark, l.law]), [["birch/two", "the-town/claim-cap"]]);
  const bought = houseFactsOf({ registry, burns: parcelBurnsOf([BUY("ash", 2, "gh:101")], classifyEntry) });
  assert.deepEqual(limitOppositions(foldWith(bought)), [], "one purchase is room for the second");
});
