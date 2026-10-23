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
//   6. end to end, at a pinned world that carries the law: a house declared after
//      10-31 holds one, the clearing's limit pass opposes the second, and a
//      purchase makes room.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { houseKeyCanon, parcelBurnsOf, houseFactsOf, houseFactsAt, parcelRoomNoteOf, parcelRoomQuote, buyParcelRoomViaOffice } from "../src/parcel-room.mjs";
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

test("3 · the facts: each declared house's declaration day and its purchases, across its spellings", () => {
  const burns = parcelBurnsOf([BUY("ash", 2, "gh:101"), BUY("birch", 3, "hh:rowan-house")], classifyEntry);
  assert.deepEqual(houseFactsOf({ registry, burns }), {
    "hh:the-rowan": { since: "2026-11-02", bought: 2 },
    "hh:the-oak": { since: "2026-10-31", bought: 0 },
  }, "a house with no declaration day states no facts, so the fold keeps it at three");
  assert.deepEqual(houseFactsOf({ registry: null }), {});
});

test("3 · bought is the highest parcel bought less one, never a count of lines: a duplicate or stray line adds no room", () => {
  const bought = (lines) => houseFactsOf({ registry, burns: parcelBurnsOf(lines, classifyEntry) })["hh:the-rowan"].bought;
  assert.equal(bought([BUY("ash", 2, "hh:the-rowan"), BUY("birch", 2, "gh:101")]), 1, "two lines for the 2nd are one purchase");
  assert.equal(bought([BUY("ash", 3, "hh:the-rowan")]), 2, "a purchase of the 3rd says two were bought");
  assert.equal(bought([BUY("ash", 3, "hh:the-rowan"), BUY("ash", 2, "hh:the-rowan"), BUY("ash", 3, "gh:101")]), 2, "never past the highest");
  assert.equal(houseFactsOf({ registry, burns: [{ household: "hh:the-rowan", nth: 4 }, { household: "hh:the-rowan", nth: "2" }] })["hh:the-rowan"].bought, 0,
    "an nth the grammar never writes buys nothing");
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
  assert.match(r.source, /parcel room: each house's declaration day there, and its parcel purchases on the ledger/);
});

// The engine's two exports, standing in for the world's law (its own test holds the law: postmark-world tools/parcel-room.test.mjs).
const engine = {
  parcelRoomOf: (f) => (f?.since > "2026-10-31" ? Math.min(3, 1 + (f.bought ?? 0)) : 3),
  parcelCapRefusal: (held, room) => `parcel claim capped — this household holds ${held} and has room for ${room}`,
};

test("5 · the door's note: only a new parcel past the room, in the engine's own sentence", () => {
  const fact = { since: "2026-11-02", bought: 0 };
  const note = parcelRoomNoteOf({ kind: "parcel", held: 1, fact, engine, by: "ash" });
  assert.deepEqual(note, { held: 1, room: 1,
    note: "parcel claim capped — this household holds 1 and has room for 1. Your claim is written, and the next crossing opposes it unless the household has room by then.",
    buy_room: { do: "buy-parcel-room", args: { from: "ash", preview: true } } },
    "below the cap, the note hands the call that buys the room ahead (POS-762/e), as a preview first");
  assert.equal(parcelRoomNoteOf({ kind: "parcel", held: 3, fact: { since: "2026-11-02", bought: 2 }, engine, by: "ash" }).buy_room, undefined,
    "at the cap there is no room to buy, and no call");
  assert.equal(parcelRoomNoteOf({ kind: "parcel", held: 0, fact, engine }), null, "the first parcel fits");
  assert.equal(parcelRoomNoteOf({ kind: "parcel", held: 1, fact: { ...fact, bought: 1 }, engine }), null, "a bought room fits the second");
  assert.equal(parcelRoomNoteOf({ kind: "parcel", held: 2, fact: { since: "2026-10-31" }, engine }), null, "declared by 10-31: three");
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

test("6 · end to end: a house declared after 10-31 holds one, the limit pass opposes the second, and a purchase makes room", { skip: NO_LAW }, async () => {
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

// ── 7 · the quote: buying room ahead (POS-762/e "Buy room ahead", /f "Room bought") ──
// A stand-in for the town's stamp-mint module, in its own grammar and numbers;
// the town's own tests hold the real ones (postmark tools/stamp-parcel-burn.test.mjs),
// and test 9 runs the real engine end to end.
const townEngine = {
  PARCEL_PRICE: 50, PARCEL_SETTLED_BY_DAY: "2026-10-31", PARCEL_ROOM_FROM: "2026-11-01",
  parcelBurnLine: ({ date, handle, n, nth, household }) => `- ${date} · ${handle} → BURN · ${n} · for: parcel:${nth}/${household}`,
  classifyEntry,
  parseLaws: (entries) => ({ laws: entries.filter((e) => e.canonical.includes("meeps: ")).map((e) => ({ date: e.canonical.slice(2, 12), meeps: new Set(e.canonical.split("meeps: ")[1].split(",")) })), revisions: [] }),
  meepChecker: (laws) => (h, d) => laws.some((l) => l.date <= d && l.meeps.has(h)),
  foldBalances: (entries) => {
    const m = new Map();
    for (const { canonical: c } of entries) {
      const mint = /MINT → (\S+) · (\d+)/.exec(c); if (mint) m.set(mint[1], (m.get(mint[1]) ?? 0) + Number(mint[2]));
      const burn = /^- \S+ · (\S+) → BURN · (\d+)/.exec(c); if (burn) m.set(burn[1], (m.get(burn[1]) ?? 0) - Number(burn[2]));
    }
    return m;
  },
};
const GIFT = (handle, n) => ({ canonical: `- 2026-10-20 · MINT → ${handle} · ${n} · for: gift:seed · by: keemin` });
const quote = (over = {}) => parcelRoomQuote({ handle: "ash", date: "2026-11-03", registry, entries: [GIFT("ash", 200)], engine: townEngine, townKey: "gh:101", ...over });

test("7 · the quote: room 1→2 costs 50, 2→3 costs 100, whatever is held; the line is the town's", () => {
  const q = quote().quote;
  assert.deepEqual([q.household, q.declared, q.room, q.price], ["the-rowan", "2026-11-02", { now: 1, after: 2 }, 50]);
  assert.equal(q.line, "- 2026-11-03 · ash → BURN · 50 · for: parcel:2/hh:the-rowan");
  assert.deepEqual(q.stamps, { liquid_now: 200, liquid_after: 150 });
  assert.match(q.cutoff.says, /declared on or before 2026-10-31 \(town time\) keep room for three/, "the quote shows the cutoff");
  assert.match(q.price_says, /50 stamps × the room the-rowan already has \(1\), whatever it holds/, "and the price, by the room");
  const second = quote({ registry: withResidents(["ash", "birch", "cedar"]), entries: [GIFT("ash", 200), { canonical: BUY("birch", 2, "hh:the-rowan") }] }).quote;
  assert.deepEqual([second.room, second.price], [{ now: 2, after: 3 }, 100], "the 3rd room costs 100");
  assert.equal(second.line, "- 2026-11-03 · ash → BURN · 100 · for: parcel:3/hh:the-rowan");
});

// The registry with the-rowan's residents replaced, for the residents rule.
function withResidents(residents) {
  return { households: { ...registry.households, "the-rowan": { ...registry.households["the-rowan"], residents } } };
}

test("7 · no room past the residents (POS-762/g, \"Refuse it\"): add the resident first, then buy the room", () => {
  const refused = (r, re) => { assert.ok(r.error, `sold: ${JSON.stringify(r.quote ?? r)}`); assert.match(`${r.error.defect} — ${r.error.hint}`, re); };
  // two residents and room for two already: the third room has no resident to hold it
  refused(quote({ entries: [GIFT("ash", 200), { canonical: BUY("birch", 2, "hh:the-rowan") }] }),
    /^the-rowan has 2 residents, and room for a third parcel needs a third resident to hold it — a parcel is one per resident: add the resident first \(household \{ do: "add-resident" \}\), then buy the room\. Nothing was burned$/);
  // one resident: even the second room is refused
  refused(quote({ registry: withResidents(["ash"]) }), /the-rowan has 1 resident, and room for a second parcel needs a second resident/);
  // and it is the reason given before the price: short of stamps too, the step is still the resident
  refused(quote({ registry: withResidents(["ash"]), entries: [GIFT("ash", 10)] }), /add the resident first/);
  // a resident each: sold
  assert.equal(quote({ registry: withResidents(["ash", "birch"]) }).quote.room.after, 2);
});

test("7 · the quote refuses, in plain words naming the price and the cutoff, and writes nothing", () => {
  const no = (over, re) => { const r = quote(over); assert.ok(r.error, `no refusal for ${JSON.stringify(over)}`); assert.match(`${r.error.defect} — ${r.error.hint}`, re); };
  no({ handle: "oak", townKey: "gh:102" }, /the-oak was declared on 2026-10-31, on or before 2026-10-31 \(town time\) — it keeps room for three parcels/);
  no({ date: "2026-10-31" }, /room is bought from 2026-11-01 \(town time\)/);
  no({ handle: "mist", townKey: "solo:mist" }, /no-day has no declaration day/);
  no({ handle: "stray", townKey: "solo:stray" }, /stray is in no declared household/);
  no({ townKey: "gh:999" }, /the town's ledger files ash under gh:999, not hh:the-rowan/);
  no({ entries: [GIFT("ash", 30)] }, /room for a second parcel costs 50 stamps, and ash holds 30 liquid — the price is 50 × the room the-rowan already has \(1\), whatever it holds/);
  no({ entries: [GIFT("ash", 300), { canonical: BUY("ash", 2, "hh:the-rowan") }, { canonical: BUY("ash", 3, "hh:the-rowan") }] }, /the-rowan already has room for three parcels/);
  no({ entries: [{ canonical: "- 2026-07-13 · rules: stamps-v2 · meeps: ash" }, GIFT("ash", 200)] }, /meep accounts cannot buy room \(ash\)/);
  no({ engine: { ...townEngine, parcelBurnLine: undefined } }, /not-yet-open — the town's ledger does not know a parcel purchase yet/);
});

// ── 8 · the door ─────────────────────────────────────────────────────────────
test("8 · the door: a preview quotes and writes nothing; a stranger or no payer is refused", async () => {
  const { readFileSync } = await import("node:fs");
  const town = townWith(["- 2026-10-20 · MINT → ash · 200 · for: gift:seed · by: keemin"]);
  try {
    writeFileSync(join(town, "tools", "households.json"), JSON.stringify(registry));
    // the stand-in engine module gains the rest of what the quote asks of the town's
    writeFileSync(join(town, "tools", "stamp-mint.mjs"), [
      `const PARCEL = ${PARCEL};`,
      `export const classifyEntry = ${classifyEntry.toString()};`,
      "export const parseStampLedger = (text) => text.split(/\\r?\\n/).filter((l) => l.startsWith('- ')).map((l) => ({ canonical: l.replace(/ · sig: \\S+$/, '') }));",
      ...Object.entries(townEngine).filter(([k]) => k !== "classifyEntry")
        .map(([k, v]) => `export const ${k} = ${typeof v === "function" ? v.toString() : JSON.stringify(v)};`),
      "export const householdKeys = () => new Map([['ash', { key: 'gh:101' }]]);",
    ].join("\n"));
    const KEY = { household: "the-rowan", handles: new Set(["ash"]) };
    const ledger = join(town, "WHITE_PAGES", "stamp-ledger.md");
    const before = readFileSync(ledger, "utf8");
    const p = await buyParcelRoomViaOffice(town, { from: "ash", preview: true }, KEY, { date: "2026-11-03" });
    assert.equal(p.error, undefined, JSON.stringify(p));
    assert.deepEqual([p.preview, p.did, p.room, p.price], [true, "buy-parcel-room", { now: 1, after: 2 }, 50]);
    assert.match(p.to_confirm, /household \{ do: "buy-parcel-room", args: \{ from: "ash" \} \} — the same call without preview: true/);
    assert.ok(p.nothing_written);
    assert.equal(readFileSync(ledger, "utf8"), before, "a preview writes nothing");
    // POS-762/g: a preview quotes the same refusal for room past the residents, and writes nothing
    writeFileSync(join(town, "tools", "households.json"), JSON.stringify(withResidents(["ash"])));
    const lone = await buyParcelRoomViaOffice(town, { from: "ash", preview: true }, KEY, { date: "2026-11-03" });
    assert.equal(lone.code, 409);
    assert.match(`${lone.defect} — ${lone.hint}`, /needs a second resident to hold it — a parcel is one per resident: add the resident first/);
    assert.equal(readFileSync(ledger, "utf8"), before, "the refused preview writes nothing");
    writeFileSync(join(town, "tools", "households.json"), JSON.stringify(registry));
    const early = await buyParcelRoomViaOffice(town, { from: "ash", preview: true }, KEY, { date: "2026-10-30" });
    assert.match(early.defect, /room is bought from 2026-11-01/);
    assert.equal((await buyParcelRoomViaOffice(town, { from: "birch", preview: true }, KEY, { date: "2026-11-03" })).code, 403);
    assert.equal((await buyParcelRoomViaOffice(town, { preview: true }, KEY, { date: "2026-11-03" })).code, 422);
  } finally { rmSync(town, { recursive: true, force: true }); }
});

// ── 9 · end to end through the exec, with the town's real engine ─────────────
const ENGINE_TOWN = process.env.TOWN_CLONE ?? TOWN_CLONE;
let realMint = null;
try { realMint = await import(pathToFileURL(join(ENGINE_TOWN, "tools", "stamp-mint.mjs")).href); } catch { realMint = null; }
const NO_PURCHASE = typeof realMint?.parcelBurnLine === "function" ? false
  : "the town engine at hand predates postmark#4094 (the parcel purchase); this runs once the town pin moves past it";

test("9 · end to end: the exec burns the price, the town's verifier stays green, and the next room costs 100", { skip: NO_PURCHASE }, async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { execFileSync } = await import("node:child_process");
  const { copyTownTools } = await import("./helpers/town-tools.mjs");
  const repo = mkdtempSync(join(tmpdir(), "parcel-room-exec-"));
  const env = { STAMP_KEY: process.env.STAMP_KEY, BOT_NAME: process.env.BOT_NAME, BOT_EMAIL: process.env.BOT_EMAIL, TOWN_PUSH: process.env.TOWN_PUSH };
  try {
    copyTownTools(ENGINE_TOWN, repo);
    mkdirSync(join(repo, "WHITE_PAGES", "ash"), { recursive: true });
    writeFileSync(join(repo, "WHITE_PAGES", "ash", "ADDRESS.md"), "---\nhandle: ash\n---\n");
    writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n");
    writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify({ ash: { login: "rowan-gh", id: 101 } }));
    writeFileSync(join(repo, "tools", "households.json"), JSON.stringify({ schema_version: 1, households: {
      "the-rowan": { accounts: [{ login: "rowan-gh", id: 101 }], residents: ["ash", "birch", "cedar"], since: "2026-11-02" } } }));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    writeFileSync(join(repo, "stamp-key.pem"), pem);
    const mint = await import(pathToFileURL(join(repo, "tools", "stamp-mint.mjs")).href);
    mint.appendSigned(repo, [mint.rulesLine("2026-06-12"), mint.giftLine({ date: "2026-10-20", handle: "ash", n: 200, slug: "seed", by: "keemin" })], pem);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "fixture"], { cwd: repo });
    process.env.STAMP_KEY = join(repo, "stamp-key.pem"); process.env.BOT_NAME = "t"; process.env.BOT_EMAIL = "t@t"; delete process.env.TOWN_PUSH;
    const KEY = { household: "the-rowan", handles: new Set(["ash"]) };
    const r = await buyParcelRoomViaOffice(repo, { from: "ash" }, KEY, { date: "2026-11-03", channel: null });
    assert.equal(r.error, undefined, JSON.stringify(r));
    assert.ok(r.commit, "the exec committed the sealed ledger");
    assert.equal(r.line, "- 2026-11-03 · ash → BURN · 50 · for: parcel:2/hh:the-rowan");
    const { verifyStampLedger } = await import(pathToFileURL(join(repo, "tools", "stamp-verify.mjs")).href);
    const v = verifyStampLedger(repo);
    assert.equal(v.ok, true, `the town's verifier, over the burned line: ${v.problems.join("; ")}`);
    const next = await buyParcelRoomViaOffice(repo, { from: "ash", preview: true }, KEY, { date: "2026-11-04" });
    assert.deepEqual([next.room, next.price], [{ now: 2, after: 3 }, 100], "the next room is quoted at 100 from the ledger the act just wrote");
  } finally {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(repo, { recursive: true, force: true });
  }
});
