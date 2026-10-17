// quest-welcome-date.test.mjs — the welcome quest row names the day its bundle
// was paid, read from the store's welcome line (POS-495, #2898).
//
// The ruling (Wright, 2026-10-14, POS-495): who counts as welcomed does not
// move; it stays the town's fold. The store's stamp_lines only DATES it: the
// line's own leading day, never `written_at`. A welcomed house the store has no
// line for, or a store that did not answer, reads welcomed and undated with the
// old note. Never "not welcomed" because of the store.
//
// The bound falsifier is the last test: over the pinned town's real ledger, the
// houses the store's lines date are exactly the houses the town's own
// `welcomedHouseholds` calls welcomed, resident by resident.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { standingJoin, STANDING_NOTES } from "../src/queries.mjs";
import { standingRow, standingRowsFromTown, welcomeDatesFrom } from "../src/quest-standing.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";

const TOWN = townClone();
const SKIP = !TOWN && NO_TOWN;

const WELCOME = { id: "welcome-to-postmark", target: 1 };
const welcomeLine = (date, handle, key) => `- ${date} · MINT → ${handle} · 5 · for: welcome:${key} · by: the-town`;

// The town's grammar, the same shape `classifyEntry` answers, so the pure tests
// need no checkout. The bound test at the bottom uses the town's own.
const classify = (canonical) => {
  const m = /^- (\d{4}-\d{2}-\d{2}) · MINT → (\S+) · ([1-9]\d*) · for: welcome:(\S+) · by: (\S+)$/.exec(canonical);
  return m ? { kind: "welcome", date: m[1], handle: m[2], n: Number(m[3]), household: m[4], by: m[5] } : { kind: "other" };
};

// ── the door: the row reads the day, and the store never unwelcomes ──────────

test("a welcomed house the store dates: the row names the paid day and says the town paid it", () => {
  const p = standingJoin(WELCOME, { welcomed: true, welcomed_since: "2026-09-14", received_since: "2026-06-12" });
  assert.equal(p.complete, true);
  assert.equal(p.progress, 1);
  assert.equal(p.since, "2026-09-14", "the day the bundle was paid, from the store's line");
  assert.equal(p.note, STANDING_NOTES.welcome_paid_dated);
});

test("a welcomed house the store has no line for stays welcomed and undated, with the old note", () => {
  const p = standingJoin(WELCOME, { welcomed: true, welcomed_since: null, received_since: "2026-06-12" });
  assert.equal(p.complete, true, "the store never unwelcomes a house the town calls welcomed");
  assert.equal(p.since, null, "and it never borrows a letter's day");
  assert.equal(p.note, STANDING_NOTES.welcome_paid);
});

test("a house not yet welcomed reads not welcomed, whatever day a stray field carries", () => {
  const p = standingJoin(WELCOME, { welcomed: false, welcomed_since: "2026-09-14" });
  assert.equal(p.complete, false);
  assert.equal(p.progress, 0);
  assert.equal(p.since, null, "an unpaid bundle has no paid day");
  assert.equal(p.note, undefined);
});

test("the standing row carries the day only on a row the town calls welcomed", () => {
  assert.equal(standingRow("ada", { facts: { welcomed: true }, welcomedSince: "2026-09-14" }).welcomed_since, "2026-09-14");
  assert.equal(standingRow("ada", { facts: { welcomed: false }, welcomedSince: "2026-09-14" }).welcomed_since, null,
    "the store's line dates a welcome; it never makes one");
  assert.equal(standingRow("ada", { facts: { welcomed: true } }).welcomed_since, null, "no line, no day");
});

// ── the dates: the line's own day, the earliest, under both keys ─────────────

test("welcomeDatesFrom: the line's leading day under its own key and the paid resident's key today", () => {
  const roll = new Map([["ada", { key: "gh:2" }], ["bex", { key: "gh:3" }]]);
  const lines = [
    "- 2026-09-01 · MINT → ada · 1 · for: first-letter · by: the-town",
    welcomeLine("2026-09-20", "ada", "gh:1"),    // ada's house was re-keyed gh:1 → gh:2 after the line
    welcomeLine("2026-09-14", "bex", "gh:3"),
    welcomeLine("2026-10-02", "bex", "gh:3"),    // a later line never moves the day back
  ];
  const d = welcomeDatesFrom(lines, { classifyEntry: classify, roll });
  assert.deepEqual(Object.fromEntries(d), { "gh:1": "2026-09-20", "gh:2": "2026-09-20", "gh:3": "2026-09-14" });
  assert.equal(welcomeDatesFrom(null, { classifyEntry: classify, roll }), null, "a store not read is null, never an empty map");
  assert.equal(welcomeDatesFrom([], { classifyEntry: classify, roll }).size, 0, "an empty chain dates nobody");
});

test("standingRowsFromTown: the store's lines date the row by the key the town's fact looks up, solo: included", () => {
  const roll = new Map([["ada", { key: "gh:2" }]]);
  const tools = {
    parseDeliveries: () => [],
    foldFriendships: () => ({ active: false, pairs: [] }),
    currentHouseholds: () => roll,
    welcomedHouseholds: () => new Set(["gh:2", "solo:cyd"]),
    onboardingFactsFor: (_repo, h, { welcomed }) => ({ welcomed: welcomed.has(roll.get(h)?.key ?? `solo:${h}`) }),
    classifyEntry: classify,
  };
  const lines = [welcomeLine("2026-09-14", "ada", "gh:2"), welcomeLine("2026-09-30", "cyd", "solo:cyd")];
  const { rows } = standingRowsFromTown(tools, "/nowhere", ["ada", "bex", "cyd"], { welcomeLines: lines });
  assert.equal(rows.get("ada").welcomed_since, "2026-09-14");
  assert.equal(rows.get("bex").welcomed_since, null, "bex is not welcomed");
  assert.equal(rows.get("cyd").welcomed_since, "2026-09-30", "a solo house is dated by its solo: key");
  const undated = standingRowsFromTown(tools, "/nowhere", ["ada"], {}).rows;
  assert.equal(undated.get("ada").welcomed, true, "no store lines: still welcomed");
  assert.equal(undated.get("ada").welcomed_since, null, "and undated (the hydrate's shape)");
});

// ── THE BOUND FALSIFIER: the store's welcome set IS the town's ───────────────

test("over the pinned town's real ledger, the houses the welcome lines date are exactly the town's welcomed houses", { skip: SKIP }, async () => {
  const engine = await import(townModuleUrl("tools", "stamp-mint.mjs"));
  const quests = await import(townModuleUrl("tools", "quest-progress.mjs"));
  // the store's welcome rows are the ledger's lines byte for byte (stamp-lines.mjs § the verifier)
  const entries = engine.parseStampLedger(readFileSync(join(TOWN, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
  const lines = entries.map((e) => e.canonical).filter((c) => c.includes(" · for: welcome:"));
  assert.ok(lines.length > 100, `the pinned ledger carries the 09-14 welcome pass (${lines.length} welcome lines)`);
  const roll = engine.currentHouseholds(TOWN);
  const dated = welcomeDatesFrom(lines, { classifyEntry: engine.classifyEntry, roll });
  const town = quests.welcomedHouseholds(TOWN, roll);
  assert.deepEqual([...dated.keys()].sort(), [...town].sort(),
    "the keys the store's lines date must be the town's welcomed keys: the town's join changed, so welcomeDatesFrom must follow it");

  // and resident by resident, through the same reduction the ingest runs
  const handles = [...roll.keys()];
  const { rows } = standingRowsFromTown({ ...engine, ...quests }, TOWN, handles, { welcomeLines: lines });
  const wrong = handles.filter((h) => (rows.get(h).welcomed === true) !== (rows.get(h).welcomed_since !== null));
  assert.deepEqual(wrong, [], "every welcomed resident is dated and no other resident is");
  for (const h of handles) if (rows.get(h).welcomed_since) assert.match(rows.get(h).welcomed_since, /^\d{4}-\d{2}-\d{2}$/);
});
