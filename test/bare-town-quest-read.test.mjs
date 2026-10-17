// bare-town-quest-read.test.mjs — a bare town quest read answers the town's
// board instead of passing undefined into SQLite.
//
// THE DEFECT (postmark#2760, sophia 2026-09-13). `town { read: "quests" }` with
// no handle answered:
//
//     defect: "the office tripped"
//     hint:   "Provided value cannot be bound to SQLite parameter 1."
//
// The focused read contract names `quests` with no required argument, so the
// undefined handle went straight into `SELECT * FROM quest_progress WHERE
// handle = ?` and SQLite refused to bind it.
//
// IT ANSWERS RATHER THAN BOUNCING, and not as a preference: the household
// door's own bare-call bounce already promises this read — "The pots on the
// board are the town's, not any one resident's: town { read: "quests" } and
// household { read: "fund" } answer those with no resident named". One door was
// sending residents here for exactly this answer before the code could give it.
//
// AND THE RESIDENT FIELDS COME OFF RATHER THAN GOING TO ZERO. The town's
// `boardForHandle` defaults an absent progress row to a clean zero, which is
// right for a resident who has done nothing today and a lie for a read where
// nobody was named: `progress: 0` is a claim about a person.
//
// THE ONE FAKE HERE is the town's own pure `boardForHandle`, stubbed through a
// temp clone so these tests need no town checkout. Its two row shapes are
// `tools/quest-progress.mjs`'s own, quoted in the fixture below: a countable row
// carries progress/complete/counted/household, an uncounted row carries
// progress: null with the same three companions. Everything else — the guard,
// the lift of bounty postings, the pots, the note — is this office's real code.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { questBoardWith, townQuestBoardOf, potBoardOf } from "../src/queries.mjs";

// ── the temp clone: the town's pure board builder, its two documented shapes ──
const CLONE = mkdtempSync(join(tmpdir(), "quests-clone-"));
mkdirSync(join(CLONE, "tools"), { recursive: true });
writeFileSync(join(CLONE, "tools", "quest-progress.mjs"), `
export const townDay = () => "2026-09-13";
const COUNTABLE = { "correspond-send": "send" };
export function boardForHandle(registry, prog, handle, today) {
  const p = prog ?? { send: 0, household: { size: 1, send: 0 } };
  const quests = (registry.quests ?? []).map((q) => {
    const base = { id: q.id, title: q.title, cadence: q.cadence, target: q.target,
                   reward: q.reward, source: q.source, door: q.door ?? null,
                   ...(q.subtype ? { subtype: q.subtype } : {}) };
    const f = COUNTABLE[q.id];
    if (!f) return { ...base, progress: null, complete: null, counted: [],
                     household: { size: p.household.size, total: null, cap_shared: false } };
    return { ...base, progress: p[f], complete: p[f] >= q.target, counted: [],
             household: { size: p.household.size, total: p.household[f], cap_shared: false } };
  });
  return { handle, today, quests };
}
`, "utf8");

const REGISTRY = {
  quests: [
    { id: "correspond-send", title: "Write a letter", cadence: "daily", target: 1, reward: 1, source: "town" },
    { id: "first-idea", title: "Leave an idea", cadence: "once", target: 1, reward: 3, source: "town" },
    { id: "fund-the-ferry", title: "The ferry fund", cadence: "once", target: 150, reward: 0, source: "town", subtype: "bounty" },
  ],
};
const META = { quest_registry: JSON.stringify(REGISTRY), quest_day: "2026-09-13" };

// The board's index reads (questBoardWith's `src`: progressRow, standing, pots,
// potIds; the store answers them, town-index-store.mjs § heldQuestSource) as a
// source that REMEMBERS what it was asked and refuses an unbound handle the way
// SQLite did, verbatim — so the flip below reproduces Sophia's message rather
// than an approximation of it. An empty town: no progress, no standing, no pots.
function recordingDb({ potsFail = false } = {}) {
  const asked = [];
  const keyed = (fn) => (handle) => {
    asked.push({ fn, handle });
    if (handle === undefined) throw new TypeError("Provided value cannot be bound to SQLite parameter 1.");
    return null;
  };
  const pots = (fn, answer) => (...a) => { asked.push({ fn }); if (potsFail) throw new Error("no such table: pots"); return answer(...a); };
  return {
    asked,
    progressRow: keyed("progressRow"),
    standing: keyed("standing"),
    pots: pots("pots", (extraInvalid) => potBoardOf({ pots: [], invalid: [] }, extraInvalid)),
    potIds: pots("potIds", () => []),
  };
}
const handleKeyed = (db) => db.asked.filter((a) => "handle" in a);
const questBoardFor = (src, meta, handle, clone, opts) => questBoardWith(src, meta, handle, clone, opts);

// ── (a) THE BARE READ — the case that tripped ────────────────────────────────

test("a bare town quest read answers the board and never keys a query on a handle", async () => {
  const db = recordingDb();
  const board = await questBoardFor(db, META, undefined, CLONE);
  assert.equal(handleKeyed(db).length, 0, "the bare read still reached a handle-keyed query");
  assert.equal(board.handle, null);
  assert.ok(Array.isArray(board.quests) && board.quests.length > 0, "the bare read returned no postings");
});

test("a blank or whitespace handle is the same absence as a missing one", async () => {
  for (const blank of ["", "   ", null]) {
    const db = recordingDb();
    const board = await questBoardFor(db, META, blank, CLONE);
    assert.equal(handleKeyed(db).length, 0, `handle ${JSON.stringify(blank)} reached a handle-keyed query`);
    assert.equal(board.handle, null);
  }
});

test("NO POSTING CARRIES A RESIDENT'S ANSWER: the fields come off rather than going to zero", async () => {
  const db = recordingDb();
  const board = await questBoardFor(db, META, undefined, CLONE);
  for (const q of board.quests)
    for (const f of ["progress", "complete", "counted", "household"])
      assert.equal(f in q, false, `posting ${q.id} still carries "${f}" — a zero there is a claim about a person`);
  // and the posting itself is intact, so the board is still a board
  const send = board.quests.find((q) => q.id === "correspond-send");
  assert.equal(send.title, "Write a letter");
  assert.equal(send.target, 1);
});

test("the bare board says whose progress is absent and how to ask for it", async () => {
  const board = await questBoardFor(recordingDb(), META, undefined, CLONE);
  assert.match(board.note, /handle/, "the note does not name the argument that would answer a resident");
});

test("a bounty posting is lifted off the card deck, exactly as it is for a resident", async () => {
  const board = await questBoardFor(recordingDb(), META, undefined, CLONE);
  assert.equal(board.quests.some((q) => q.id === "fund-the-ferry"), false, "a pot posting is being shown as a quest card");
  // `potBoard` answers a SECTION — { teach, list } — exactly as it does on the
  // resident board; the town's board must carry the same shape, not a bare array.
  assert.ok(board.pots && Array.isArray(board.pots.list), "the pots section is missing from the town's own board");
});

test("an index with no pots table degrades to a note and still answers a board", async () => {
  const db = recordingDb({ potsFail: true });
  const board = await questBoardFor(db, META, undefined, CLONE);
  assert.ok(board.pots_note, "a missing pots table lost the whole board instead of one section");
  assert.ok(board.quests.length > 0);
});

// ── (b) THE NAMED READ — unchanged, and provably still keyed on the handle ───

test("a read WITH a handle still asks the store for that handle", async () => {
  const db = recordingDb();
  await questBoardFor(db, META, "sophia-familiaris", CLONE);
  const keyed = handleKeyed(db);
  assert.ok(keyed.length > 0, "the named read no longer keys anything on the handle — the guard is swallowing it");
  assert.ok(keyed.every((a) => a.handle === "sophia-familiaris"),
    "a handle-keyed query was bound with something other than the handle asked for");
});

test("a read with a handle answers a RESIDENT'S board — the fields the bare read removes are present", async () => {
  const board = await questBoardFor(recordingDb(), META, "sophia-familiaris", CLONE);
  assert.equal(board.handle, "sophia-familiaris");
  for (const q of board.quests)
    for (const f of ["progress", "complete", "counted", "household"])
      assert.equal(f in q, true, `resident row ${q.id} lost "${f}"`);
});

test("a handle that is no resident answers what it answered before: a board, not a trip", async () => {
  const board = await questBoardFor(recordingDb(), META, "nobody-at-all", CLONE);
  assert.equal(board.handle, "nobody-at-all");
  assert.ok(board.quests.length > 0);
});

// ── (c) THE RELATION — one predicate decides, and the two boards are disjoint ─

test("THE RELATION: a board carries a resident's fields exactly when a resident was named", async () => {
  let named = 0, bare = 0;
  for (const handle of [undefined, null, "", "  ", "sophia-familiaris", "nobody-at-all"]) {
    const db = recordingDb();
    const board = await questBoardFor(db, META, handle, CLONE);
    const isNamed = handle != null && String(handle).trim() !== "";
    const carries = board.quests.every((q) => "progress" in q);
    assert.equal(carries, isNamed, `board/handle disagree for ${JSON.stringify(handle)}`);
    assert.equal(handleKeyed(db).length > 0, isNamed, `store access/handle disagree for ${JSON.stringify(handle)}`);
    isNamed ? named++ : bare++;
  }
  assert.ok(named > 0 && bare > 0, `one-sided matrix: ${named} named / ${bare} bare`);
});

// ── (d) THE TRIP ITSELF, still reachable if the guard goes ───────────────────

test("the SQLite refusal is what waits below the guard — the stub reproduces it verbatim", () => {
  const db = recordingDb();
  let msg = null;
  try { db.progressRow(undefined); }
  catch (e) { msg = e.message; }
  assert.equal(msg, "Provided value cannot be bound to SQLite parameter 1.",
    "this suite no longer reproduces the message the resident saw");
});

test("townQuestBoard needs no store beyond the pots, so the town's board cannot trip on a resident query", () => {
  const db = recordingDb();
  const board = townQuestBoardOf({
    registry: REGISTRY, today: "2026-09-13",
    boardForHandle: (registry, prog, handle, today) => ({ handle, today, quests: [{ id: "x", progress: 0, complete: false, counted: [], household: {} }] }),
  }, (extraInvalid) => db.pots(extraInvalid), () => db.potIds());
  assert.equal(handleKeyed(db).length, 0);
  assert.deepEqual(board.quests, [{ id: "x" }], "the resident fields were not the only thing removed");
});
