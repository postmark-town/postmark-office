// pos-976.test.mjs — POS-976: a quest the town has PAID reads paid on the board.
//
// THE DEFECT. moose's `read-v2-feedback` quest row read `complete: null, measured: false` ("this surface did not look") after the town's signed 11-07 payment
// (`MINT → moose · 5 · for: quest:read-v2-feedback/hh:moose · by: the-town`, ledger line 32149; four other households paid the same day). The row is a hand-reviewed
// quest: no fold on the board counts it, and the office injected only the first-idea completion, so the payment, which the registry's own derivation sentence names as
// the row's completion, was never joined. The fix joins the existing receipt into the existing row: the ingest folds the household's qualifying signed lines into the
// standing row (`paid_quests`), and `standingJoin` answers `complete: true, progress: 1, since: <paid day>`.
//
// WHAT THESE WATCH. (1) the five real payments, in the ledger's canonical form (the fixture is the real line shape, not an invented one), settle the five houses'
// rows, through mixed `hh:` and `gh:` keys; (2) nothing else settles a row: another quest, another amount, another authority, a closed window, another house, a
// line the grammar does not read, a name or a balance; (3) unknown stays unknown, never false, and the first-idea row is untouched; (4) the earned-once completion
// survives a new day (the daily snapshot going stale); (5) the store reader returns exactly the quest payments, and the real derivation (`questRows`) over the pinned
// town's own ledger settles the real houses.
//
//   node --test test/pos-976.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { standingJoin } from "../src/queries.mjs";
import { questPaidFrom, standingRowsFromTown } from "../src/quest-standing.mjs";
import { questPayLinesVia } from "../src/stamp-lines.mjs";
import { storeIndexPooled } from "../src/town-index-store.mjs";
import { questRows } from "../src/town-index.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { emptyTown, fixtureTown, putValues, setMeta } from "./fixture.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";

const TOWN = townClone();
const SKIP = !TOWN && NO_TOWN;

// the five payments of 2026-11-07 (stamp-ledger.md lines 32148-32152), in the canonical form the store keeps (the signature is not part of it)
const REAL = [
  "- 2026-11-07 · MINT → alex-rowan · 5 · for: quest:read-v2-feedback/gh:323750339 · by: the-town",
  "- 2026-11-07 · MINT → moose · 5 · for: quest:read-v2-feedback/hh:moose · by: the-town",
  "- 2026-11-07 · MINT → domovoi-boulanger · 5 · for: quest:read-v2-feedback/gh:294303966 · by: the-town",
  "- 2026-11-07 · MINT → kogane · 5 · for: quest:read-v2-feedback/gh:302359603 · by: the-town",
  "- 2026-11-07 · MINT → dom-pidgey · 5 · for: quest:read-v2-feedback/gh:300310888 · by: the-town",
];
const ROW = { id: "read-v2-feedback", target: 1, cadence: "milestone" };

const engine = SKIP ? null : await import(townModuleUrl("tools", "stamp-mint.mjs"));
const quests = SKIP ? null : await import(townModuleUrl("tools", "quest-progress.mjs"));

// today's roll for the five houses and two bystanders: moose is a declared house, the rest are github-pinned solo houses (alex-rowan's account is ALSO a declared
// house now, so its key is hh:alex-house and its payment line names the gh: spelling of the same house)
const ROLL = new Map([
  ["alex-rowan", { key: "hh:alex-house" }], ["moose", { key: "hh:moose" }], ["domovoi-boulanger", { key: "gh:294303966" }],
  ["kogane", { key: "gh:302359603" }], ["dom-pidgey", { key: "gh:300310888" }],
  ["ada", { key: "gh:111" }], ["bex", { key: "solo:bex" }],
]);
const HOUSES = { "alex-house": { residents: ["alex-rowan"], accounts: [{ login: "alex", id: 323750339 }] }, moose: { residents: ["moose"], accounts: [] } };

const tools = (extra = {}) => ({
  ...engine,
  parseDeliveries: () => [],
  foldFriendships: () => ({ active: false, pairs: [] }),
  currentHouseholds: () => ROLL,
  welcomedHouseholds: () => new Set(),
  onboardingFactsFor: () => ({}),
  ...extra,
});
const rowsFor = (lines, handles = [...ROLL.keys()]) => standingRowsFromTown(tools(), "/nowhere", handles, { questPayLines: lines, houses: HOUSES }).rows;

test("the five 11-07 payments settle the five houses' rows, with the paid day, through hh: and gh: keys", { skip: SKIP }, () => {
  const rows = rowsFor(REAL);
  for (const h of ["alex-rowan", "moose", "domovoi-boulanger", "kogane", "dom-pidgey"]) {
    const j = standingJoin(ROW, rows.get(h));
    assert.deepEqual(j, { progress: 1, complete: true, since: "2026-11-07" }, `${h}'s row`);
  }
});

test("nothing else settles a row: the other houses, another quest, amount, authority, window or house, an unread line, a bare name", { skip: SKIP }, () => {
  const rows = rowsFor(REAL);
  for (const h of ["ada", "bex"]) assert.equal(standingJoin(ROW, rows.get(h)), null, `${h} was not paid`);
  const bad = [
    "- 2026-11-07 · MINT → ada · 5 · for: quest:hearth-entry/gh:111 · by: the-town",            // another quest (and one that is closed)
    "- 2026-11-07 · MINT → ada · 4 · for: quest:read-v2-feedback/gh:111 · by: the-town",         // not the quest's amount (exactly 5)
    "- 2026-11-07 · MINT → ada · 5 · for: quest:read-v2-feedback/gh:111 · by: wright",           // not the town's hand
    "- 2026-10-01 · MINT → ada · 5 · for: quest:read-v2-feedback/gh:111 · by: the-town",         // before the quest opened (2026-10-15)
    "- 2026-11-07 · MINT → other · 5 · for: quest:read-v2-feedback/hh:other-house · by: the-town", // another house (and a name that is not on the roll)
    "- 2026-11-07 · MINT → ada · 5 · for: first-idea:the-think-tank · by: the-town",             // a different receipt kind
    "- 2026-11-07 · MINT → ada · 5 · for: welcome:gh:111 · by: the-town",                        // a welcome, not this quest
    "- 2026-11-07 · MINT → ada · 5 · for: quest:read-v2-feedback · by: the-town",                // no household: the grammar does not read it
    "- 2026-11-07 · MINT → ada · 5 · for: gift:read-v2-feedback/gh:111 · by: the-town",          // a gift that looks alike
  ];
  const r2 = rowsFor(bad);
  for (const h of ["ada", "bex", "moose", "alex-rowan"]) assert.equal(standingJoin(ROW, r2.get(h)), null, `${h} read paid on a line that does not qualify`);
  assert.deepEqual(Object.keys(r2.get("ada")).filter((k) => k === "paid_quests"), [], "the row carries no paid_quests key without a qualifying receipt");
  // a house paid for one quest is not paid for another the registry lists
  const mine = standingJoin({ id: "some-other-quest" }, rows.get("moose"));
  assert.equal(mine, null, "moose's receipt settles read-v2-feedback and nothing else");
});

test("a household is settled by the house its line NAMES (spellings of one declared house folded); a payment does not follow its recipient into another house", { skip: SKIP }, () => {
  // alex-rowan: paid under the gh: spelling, a declared house (hh:alex-house) today: the town's houseCanonOf folds the account id to the house
  const rows = rowsFor([REAL[0]]);
  assert.equal(standingJoin(ROW, rows.get("alex-rowan")).complete, true);
  // a housemate shares the house's key, so the house's receipt settles the housemate's row too (a quest paid ONCE PER HOUSEHOLD)
  const mates = new Map([["alex-rowan", { key: "hh:alex-house" }], ["alex-mate", { key: "hh:alex-house" }]]);
  const r = standingRowsFromTown(tools({ currentHouseholds: () => mates }), "/nowhere", ["alex-rowan", "alex-mate"], { questPayLines: [REAL[0]], houses: HOUSES }).rows;
  assert.equal(standingJoin(ROW, r.get("alex-mate")).complete, true, "the house was paid once; every resident's row reads it");
  // a former name of the house is the same house
  const formerly = { "alex-house": { residents: ["alex-rowan"], accounts: [], formerly: ["old-alex"] } };
  const f = standingRowsFromTown(tools({ currentHouseholds: () => mates }), "/nowhere", ["alex-rowan"], { questPayLines: ["- 2026-11-07 · MINT → alex-rowan · 5 · for: quest:read-v2-feedback/hh:old-alex · by: the-town"], houses: formerly }).rows;
  assert.equal(standingJoin(ROW, f.get("alex-rowan")).complete, true, "a payment under a retired slug of the house keeps its receipt");
  // a solo house under a different key is not settled by a stranger's line
  assert.equal(standingJoin(ROW, rowsFor([REAL[0]]).get("domovoi-boulanger")), null);
  // the earliest day wins when a house is named twice
  const twice = questPaidFrom(["- 2026-11-09 · MINT → moose · 5 · for: quest:read-v2-feedback/hh:moose · by: the-town", REAL[1]],
    { classifyEntry: engine.classifyEntry, questPay: engine.QUEST_PAY, questOpenOn: engine.questOpenOn });
  assert.equal(twice.get("hh:moose")["read-v2-feedback"], "2026-11-07");
});

test("THE MOVED RESIDENT: a resident paid in house A who is in house B today takes no receipt with them; A keeps it and B stays unknown until B is paid on its own line", { skip: SKIP }, () => {
  // 11-07: x lived in hh:house-a and the town paid house A (the line names hh:house-a). 11-10: x registered into hh:house-b, a distinct house with its own resident y.
  const roll = new Map([["x", { key: "hh:house-b" }], ["y", { key: "hh:house-b" }], ["z", { key: "hh:house-a" }]]);
  const houses = { "house-a": { residents: ["z"], accounts: [] }, "house-b": { residents: ["x", "y"], accounts: [] } };
  const line = "- 2026-11-07 · MINT → x · 5 · for: quest:read-v2-feedback/hh:house-a · by: the-town";
  const rows = standingRowsFromTown(tools({ currentHouseholds: () => roll }), "/nowhere", ["x", "y", "z"], { questPayLines: [line], houses }).rows;
  assert.deepEqual(standingJoin(ROW, rows.get("z")), { progress: 1, complete: true, since: "2026-11-07" }, "house A, which was paid, keeps its completion");
  assert.equal(standingJoin(ROW, rows.get("x")), null, "the moved resident's row in house B stays unknown: the receipt is house A's");
  assert.equal(standingJoin(ROW, rows.get("y")), null, "house B's other resident stays unknown too");
  assert.equal(rows.get("y").paid_quests, undefined);
  // and when house B is later paid on its own line, B reads paid from ITS day, never A's
  const later = standingRowsFromTown(tools({ currentHouseholds: () => roll }), "/nowhere", ["x", "y", "z"],
    { questPayLines: [line, "- 2026-11-12 · MINT → y · 5 · for: quest:read-v2-feedback/hh:house-b · by: the-town"], houses }).rows;
  assert.equal(standingJoin(ROW, later.get("y")).since, "2026-11-12");
  assert.equal(standingJoin(ROW, later.get("x")).since, "2026-11-12");
  assert.equal(standingJoin(ROW, later.get("z")).since, "2026-11-07");
});

test("the registry that folds a house's aliases is the one the ingest hands (the store's), and a printout is only the fallback", { skip: SKIP }, async () => {
  // a fresh account the store's registry holds and the checkout's printout does not (or the other way round) must follow the store
  const roll = new Map([["s-res", { key: "hh:store-house" }]]);
  const storeHouses = { "store-house": { residents: ["s-res"], accounts: [{ login: "s", id: 777 }] } };
  const printout = { "store-house": { residents: ["s-res"], accounts: [] } };   // lags: no account 777 yet
  const line = "- 2026-11-07 · MINT → s-res · 5 · for: quest:read-v2-feedback/gh:777 · by: the-town";
  const run = (houses) => standingRowsFromTown(tools({ currentHouseholds: () => roll }), "/nowhere", ["s-res"], { questPayLines: [line], houses }).rows.get("s-res");
  assert.equal(standingJoin(ROW, run(storeHouses)).complete, true, "the store's account 777 folds the line to the house");
  assert.equal(standingJoin(ROW, run(printout)), null, "a lagging printout fails safe: unknown, never a wrong house");
  // through the derivation the ingest runs: `houses` overrides the checkout's printout (here an empty record, so kogane's gh: line no longer folds to hh:shard-house), and absent falls back to it
  const ledger = engine.parseStampLedger(readFileSync(join(TOWN, "WHITE_PAGES", "stamp-ledger.md"), "utf8")).map((e) => e.canonical).filter((c) => c.includes(" · for: quest:"));
  const pinned = engine.currentHouseholds(TOWN);
  const town = { residents: [...pinned.keys()].map((h) => ({ handle: h })) };
  const quiet = { log() {}, warn() {} };
  const viaStore = new Map((await questRows(TOWN, town, { log: quiet, questPayLines: ledger, houses: {} })).standing.map(([h, j]) => [h, JSON.parse(j)]));
  const viaPrintout = new Map((await questRows(TOWN, town, { log: quiet, questPayLines: ledger })).standing.map(([h, j]) => [h, JSON.parse(j)]));
  assert.equal(viaStore.get("kogane").paid_quests, undefined, "the store's record (no shard-house account) does not fold kogane's gh: line: unknown");
  assert.ok(viaPrintout.get("kogane").paid_quests, "the printout, when the ingest has no store registry, does");
});

test("unknown stays unknown: no receipt is `complete: null`, a store that was not read settles nothing, and first-idea is untouched", { skip: SKIP }, () => {
  assert.equal(questPaidFrom(null, { classifyEntry: engine.classifyEntry, questPay: engine.QUEST_PAY }), null, "a store not read is null, never an empty map");
  const unread = standingRowsFromTown(tools(), "/nowhere", ["moose"], {}).rows;       // the hydrate's shape: no lines
  assert.equal(standingJoin(ROW, unread.get("moose")), null, "no lines: the row is exactly as it was");
  assert.equal(standingJoin(ROW, null), null);
  assert.equal(standingJoin(ROW, {}), null);
  assert.equal(standingJoin(ROW, { paid_quests: { "read-v2-feedback": null } }), null, "a bent value settles nothing");
  // a checkout too old to export QUEST_PAY leaves every such row unknown
  const old = standingRowsFromTown(tools({ QUEST_PAY: undefined }), "/nowhere", ["moose"], { questPayLines: REAL, houses: HOUSES }).rows;
  assert.equal(standingJoin(ROW, old.get("moose")), null);
  // first-idea keeps its own join: a paid_quests entry is not its fact
  const idea = standingJoin({ id: "first-idea" }, { paid_quests: { "read-v2-feedback": "2026-11-07" } }, { idea: null });
  assert.equal(idea.complete, undefined, "first-idea still answers from the tank only");
});

// ── the board, through the store: the common read the household and public doors share ─────────────────────────────

const seated = emptyTown();
const IX = await indexStore(seated);
after(async () => { await IX.stop(); });
async function seat(rows) {
  for (const k of Object.keys(seated)) seated[k] = rows[k] ?? [];
  await IX.reseed();
  return storeIndexPooled(TOWN, { env: IX.env });
}
const REGISTRY = JSON.stringify({ quests: [
  { id: "read-v2-feedback", title: "Tell us about the new world read", cadence: "milestone", validation: "needs-review", target: 1, reward: "5 stamps, once per household", resets: "never; earned once per household and kept" },
] });

test("the board row: a paid house reads complete and measured with its paid day; an unpaid one still reads unknown; the paid row survives a new day", { skip: SKIP }, async () => {
  const rows = rowsFor(REAL);
  const db = fixtureTown();
  for (const h of ["moose", "bex"]) putValues(db, "quest_standing", [h, JSON.stringify(rows.get(h))], ["handle", "json"]);
  const today = quests.townDay();
  setMeta(db, "quest_registry", REGISTRY);
  setMeta(db, "quest_day", today);
  const ix = await seat(db);
  const paid = (await ix.questBoard("moose")).quests.find((q) => q.id === "read-v2-feedback");
  assert.equal(paid.complete, true);
  assert.equal(paid.progress, 1);
  assert.equal(paid.measured, true, "a counted row, by the receipt");
  assert.equal(paid.since, "2026-11-07");
  const unpaid = (await ix.questBoard("bex")).quests.find((q) => q.id === "read-v2-feedback");
  assert.equal(unpaid.complete, null, "no receipt: unknown, not false");
  assert.equal(unpaid.progress, null);
  assert.equal(unpaid.measured, false);
  // a new day: the daily snapshot is stale (served as a clean zero board), and an earned-once completion does not go with it
  setMeta(db, "quest_day", "1970-01-01");
  const stale = (await (await seat(db)).questBoard("moose")).quests.find((q) => q.id === "read-v2-feedback");
  assert.equal(stale.complete, true, "the payment does not expire with the day");
  assert.equal(stale.since, "2026-11-07");
});

// ── the store's reader, and the real derivation ──────────────────────────────

test("questPayLinesVia returns exactly the signed quest payments, in chain order (null without the table)", async () => {
  const owner = await IX.store.connect("world2_owner");
  try {
    await owner.query("DELETE FROM stamp_lines");
    const put = async (seq, canonical) => owner.query("INSERT INTO stamp_lines (seq, canonical, sig, seal) VALUES ($1, $2, $3, $4)", [seq, canonical, "sig" + seq, String(seq).padStart(64, "0")]);
    await put(1, "- 2026-09-14 · MINT → ada · 5 · for: welcome:gh:111 · by: the-town");
    await put(2, REAL[1]);
    await put(3, "- 2026-11-07 · MINT → solace-aurelian · 20 · for: gift:qotw5-biome-idea · by: wright");
    await put(4, REAL[0]);
    await put(5, "- 2026-11-08 · MINT → ada · 1 · for: first-letter · by: the-town");
    assert.deepEqual(await questPayLinesVia(owner), [REAL[1], REAL[0]]);
    await owner.query("DELETE FROM stamp_lines");
    assert.deepEqual(await questPayLinesVia(owner), [], "an empty chain is an empty list");
    await owner.query("DROP TABLE stamp_lines CASCADE");
    assert.equal(await questPayLinesVia(owner), null, "066 not applied: null, never an empty list standing in for nobody");
  } finally { await owner.end(); }
});

test("the real derivation over the pinned town's own ledger settles the real houses (questRows, the function the ingest runs)", { skip: SKIP }, async () => {
  const ledger = engine.parseStampLedger(readFileSync(join(TOWN, "WHITE_PAGES", "stamp-ledger.md"), "utf8")).map((e) => e.canonical);
  const lines = ledger.filter((c) => c.includes(" · for: quest:"));
  assert.ok(lines.length >= 5, `the pinned ledger carries the 11-07 quest payments (${lines.length} quest lines)`);
  const roll = engine.currentHouseholds(TOWN);
  const handles = [...roll.keys()];
  const town = { residents: handles.map((h) => ({ handle: h })) };
  const out = await questRows(TOWN, town, { log: { log() {}, warn() {} }, questPayLines: lines });
  assert.ok(out?.standing, "the pinned town folds standing rows");
  const rows = new Map(out.standing.map(([h, json]) => [h, JSON.parse(json)]));
  // THE FIVE ROWS: every paid household's resident reads paid with the paid day, through the real keys (kogane's line names gh:302359603; the roll holds hh:shard-house,
  // the same house by the town's houseCanonOf)
  for (const h of ["alex-rowan", "moose", "domovoi-boulanger", "kogane", "dom-pidgey"]) {
    assert.ok(roll.has(h), `${h} is on the pinned roll`);
    assert.deepEqual(standingJoin(ROW, rows.get(h)), { progress: 1, complete: true, since: "2026-11-07" }, `${h}'s v2 row`);
  }
  // a quest paid ONCE PER HOUSEHOLD reads paid for every resident of the paid house, and for no house without a receipt
  const paidKeys = new Set(["alex-rowan", "moose", "domovoi-boulanger", "kogane", "dom-pidgey"].map((h) => roll.get(h).key));
  for (const h of handles) {
    const paid = standingJoin(ROW, rows.get(h)) !== null;
    assert.equal(paid, paidKeys.has(roll.get(h).key), `${h} (${roll.get(h).key}): paid exactly when its house holds a receipt`);
  }
  const none = await questRows(TOWN, town, { log: { log() {}, warn() {} } });
  const unpaid = new Map(none.standing.map(([h, json]) => [h, JSON.parse(json)]));
  assert.equal([...unpaid.values()].filter((r) => r.paid_quests).length, 0, "no lines read (the hydrate's shape): no row is settled");
});
