// pos-198-the-walk-act-carries-its-instant.test.mjs — POS-198, the fix POS-196
// named: the walk act carries its DECLARED INSTANT, `declared_by` and `note`,
// and one clock read feeds both pens.
//
// ── THE STOP THIS CLOSES ────────────────────────────────────────────────────
//
// POS-196 built the store-backed renderer for the world's `STATE/log/<N>.jsonl`
// departure record and could not ship the swap, for one reason, measured on the
// record itself:
//
//   "`at` has no source in the register, and `at` is the first field every
//    world reader reads."
//
// `world.mjs § walkEntry` passed no `writtenAt`, so `world-journal.mjs §
// normalizeRow` filled `written_at` — which IS `acts.at` — from its own clock,
// taken after the resident declared. And the act's other instant-shaped column,
// `crossing`, is a DIFFERENT read: across the 2,808 live door-written lines of
// windows 120–204 it reconstructs the true instant exactly ZERO times, median
// −203 ms, 235 of them missing by more than a second, the worst by 10.6 hours.
//
// ── WHAT IS ON TRIAL HERE ───────────────────────────────────────────────────
//
//   1. ONE CLOCK READ. A walk declared at T lands in `dynamic.db/movements`
//      with `at = T` and in `acts` with `written_at = T`. EQUALITY, not
//      closeness — two clock reads are never equal, so this can only pass if
//      there genuinely is one read. A tolerance would have passed for the last
//      three months.
//   2. THE DOOR ACTUALLY MAKES THAT ONE READ. Test 1 proves the plumbing given
//      one instant; the structural guard proves `walkViaOffice` supplies it to
//      both pens rather than letting either reach for a clock of its own.
//   3. `declared_by` AND `note` REACH THE ACT — and `note` stays CONDITIONAL,
//      as it is on the record's own 2,870 lines.
//   4. THE FALLBACK SURVIVES. An act class with no declared instant of its own
//      still gets the mirror's clock, because that is the only honest answer
//      for it. Closing the STOP for `move` must not silently move `ride`,
//      `mark`, `stance` or the crossing's own rows onto a null.
//
//   node --test test/pos-198-the-walk-act-carries-its-instant.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// `src/world.mjs` reads WORLD_CLONE at module load and the door is never driven
// here — only its act builder — but the import must not trip over an unset one.
process.env.WORLD_CLONE ??= HERE;

const tmp = mkdtempSync(join(tmpdir(), "pos198-"));
after(() => { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } });

// No pen, no register: these tests drive the two WRITERS, and a flipped lane
// would send the act at a Postgres that is not there.
delete process.env.W2_PEN;

const { openDynamic } = await import("../src/dynamic-store.mjs");
const { declareMovement, declareMovementFlipped, readMovements } = await import("../src/dynamic-entities.mjs");
const { normalizeRow, CLASS_RIDE, CLASS_MOVE } = await import("../src/world-journal.mjs");
const { walkEntry } = await import("../src/world.mjs");

/**
 * ONE DECLARATION, BUILT THE WAY THE DOOR BUILDS IT.
 *
 * `new Date().toISOString()` is called ONCE here, exactly as
 * `world.mjs § walkViaOffice` calls it once, and both pens are handed the same
 * string from the same object. That is the whole shape under test — if a second
 * read creeps back into either pen, the equality below is the thing that reds.
 */
function oneDeclaration({ note = null, declaredBy = null, who = "alpha" } = {}) {
  const declaredAt = new Date().toISOString();          // ⚑ THE ONE READ
  const movement = {
    actor: who, from: { x: 1306, y: 2093.5 }, toward: { x: 1329, y: 2083 },
    crossing: 204.02035324074075, at: declaredAt,
    within: { w: 4, h: 4 }, toMark: "neth/little-free-library",
    declaredBy: declaredBy ?? who, pace: 60, note,
  };
  const entry = walkEntry({
    crossing: movement.crossing, who, targetMarkId: movement.toMark,
    stampAt: { anchor: "the-town/the-post-office", dx: 3, dy: -2 }, witnesses: [],
    from: movement.from, toward: movement.toward, pace: movement.pace,
    targetExtent: movement.within, household: "house-a",
    writtenAt: movement.at, declaredBy: movement.declaredBy, note: movement.note ?? null,
  });
  return { declaredAt, movement, entry };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 · ONE CLOCK READ, TWO PENS
// ═════════════════════════════════════════════════════════════════════════════

test("ONE CLOCK READ: the movements row and the act carry the SAME instant, not a near one", async () => {
  const { declaredAt, movement, entry } = oneDeclaration();
  const db = openDynamic(join(tmp, "one-read.db"));
  try {
    // The flipped pen, injected, so the two rows are written by the real
    // `declareMovementFlipped` ordering with no Postgres in the room. The
    // injection is what `deps.appendActFlipped` exists for.
    const penned = [];
    await declareMovementFlipped(db, movement, entry, {
      appendActFlipped: async (handle, e) => {
        const row = normalizeRow(e);                    // the real write path
        penned.push(row);
        handle.prepare("INSERT INTO journal (crossing, actor, action, object, class, payload, written_at) VALUES (?,?,?,?,?,?,?)")
          .run(row.crossing, row.actor, row.action, row.object, row.class, row.payload, row.written_at);
        return { seq: 1, actId: 4242, flipped: true };
      },
    });

    const [dep] = readMovements(db);
    const act = penned[0];

    // EQUALITY, NOT CLOSENESS. Two reads of a wall clock are never equal; a
    // `Math.abs(a - b) < 1000` here would have passed on the drifted office for
    // 2,573 of its 2,808 lines and still been wrong on all of them.
    assert.equal(dep.at, declaredAt, "the movements row did not take the declaration's instant");
    assert.equal(act.written_at, declaredAt, "the act did not take the declaration's instant");
    assert.equal(act.written_at, dep.at,
      "the act and the movements row were stamped from two different clock reads — that is the STOP, returned");

    // `written_at` is the column that becomes `acts.at`, which is the instant
    // `live-reads § departureRecordOf` reads for era 5 (`iso: isoOf(row.at)`).
    assert.match(act.written_at, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, "the instant is an ISO string, as `acts.at` holds it");
  } finally { db.close(); }
});

test("CONTROL: the equality CAN fail — a second clock read for the act is caught", async () => {
  // A probe that cannot fail is an act. This is the office as it stood before
  // POS-198: the act reaches for its own clock, a hair after the pen.
  const { declaredAt, movement, entry } = oneDeclaration();
  const db = openDynamic(join(tmp, "two-reads.db"));
  try {
    declareMovement(db, movement);
    const driftedAct = normalizeRow({ ...entry, writtenAt: undefined });   // the fallback = a SECOND read
    const [dep] = readMovements(db);

    assert.equal(dep.at, declaredAt, "the pen's own row is unaffected — only the act drifted");
    assert.notEqual(driftedAct.written_at, dep.at,
      "two clock reads produced the same millisecond — if this ever fails the control has stopped controlling, not the office stopped drifting");
  } finally { db.close(); }
});

test("the DOOR makes that one read, and hands it to both pens", () => {
  // `walkViaOffice` has no bottle in this suite (it wants a world clone, a
  // pool and a fold), and `test/issue-2859-enter-on-arrival.test.mjs` already
  // establishes the source-shape guard as this function's instrument for
  // exactly that reason. The claim is narrow and structural: ONE read, on the
  // movement object, carried to BOTH `walkEntry` calls.
  const src = readFileSync(join(HERE, "..", "src", "world.mjs"), "utf8");

  const reads = src.match(/const declaredAt = new Date\(\)\.toISOString\(\);/g) ?? [];
  assert.equal(reads.length, 1, "`walkViaOffice` should read the declaration clock exactly once");

  assert.match(src, /actor: who, from, toward, crossing: at, at: declaredAt,/,
    "the movements row is stamped from that read — without this, `declareMovement` reads a clock of its own");

  const carried = src.match(/writtenAt: movement\.at, declaredBy: movement\.declaredBy, note: movement\.note \?\? null/g) ?? [];
  assert.equal(carried.length, 2,
    "both pens — the flipped arm and the async mirror arm — must stamp the act from the movement's own instant");

  const builders = src.match(/walkEntry\(\{ crossing: at,/g) ?? [];
  assert.equal(builders.length, 2,
    "if a third walk pen appears, it needs the instant too and this count is where that is noticed");
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · `declared_by` AND `note` REACH THE ACT
// ═════════════════════════════════════════════════════════════════════════════

test("`declared_by` rides the act's payload, and a self-declared walk says so", () => {
  const { entry } = oneDeclaration({ who: "neth" });
  assert.equal(entry.payload.declared_by, "neth",
    "the record's own coalesce: `declared_by ?? actor`, so a self-declared walk spells it out rather than implying it");
});

test("a DELEGATED walk carries its declarer, which is the whole point of the column", () => {
  // The 28 lines in the record that differ are the 2026-08-10 `ledger-freeze`
  // one-off (`declaredBy: "the-town"`). A register that could not hold this
  // could not render them.
  const { entry } = oneDeclaration({ who: "neth", declaredBy: "the-town" });
  assert.equal(entry.payload.declared_by, "the-town");
  assert.equal(entry.actor, "neth", "the actor is still whose feet moved");
});

test("`note` is CONDITIONAL — a walk with no note writes no key, as the record does", () => {
  const plain = oneDeclaration().entry;
  assert.equal("note" in plain.payload, false,
    "28 of the record's 2,870 lines carry a note; a null key on the other 2,842 would be the register disagreeing with the grammar it renders into");

  const noted = oneDeclaration({ note: "the freeze carried this one" }).entry;
  assert.equal(noted.payload.note, "the freeze carried this one");
});

test("the five read keys keep their order, and the two new ones follow — the era-5 arm still recognises this act", () => {
  const { entry } = oneDeclaration({ note: "n" });
  assert.deepEqual(Object.keys(entry.payload).slice(0, 5), ["from", "toward", "pace", "within", "to"],
    "`live-reads § departureRecordOf` reads era 5 by name, but this order is what every reader of the record was built against");
  assert.deepEqual(Object.keys(entry.payload), ["from", "toward", "pace", "within", "to", "declared_by", "note"]);

  // The era-5 discriminator, quoted from `departureRecordOf`: a movement-store
  // departure is `p.from && p.toward && !p.lines && !p._ledger`. Two new keys
  // must not push this act into "a fifth pen has written here".
  const p = entry.payload;
  assert.ok(p.from && p.toward && !p.lines && !p._ledger,
    "the act stopped matching the movement-store era and would be REFUSED BY NAME by every reader of it");
});

test("the instant does NOT enter the payload — it is a column, and the record has no key for it", () => {
  const { entry } = oneDeclaration();
  const row = normalizeRow(entry);
  assert.equal("writtenAt" in entry.payload, false);
  assert.equal("at" in JSON.parse(row.payload), false,
    "finding 1's payload grammar has eight keys and none of them is an instant; `at` is a TOP key, read off the act row");
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · THE FALLBACK SURVIVES, FOR THE CLASSES THAT HAVE NOTHING BETTER
// ═════════════════════════════════════════════════════════════════════════════

test("FALLBACK: a `ride` act, which has no declared instant, still gets the mirror's clock", () => {
  // `world-apex.mjs § record` builds a ride with `at: null` and no `writtenAt`,
  // and there is no earlier instant in a ride to carry — the crossing IS the
  // ride's own clock. `mark` (world.mjs, declare and withdraw), `stance`
  // (world-stance.mjs) and the crossing's rows (crossing-exec.mjs) are in the
  // same position. Closing the STOP for `move` must not move any of them.
  const before = Date.now();
  const row = normalizeRow({
    crossing: 204.5, actor: "alpha", action: "ride", object: "the-town/the-post-office",
    cls: CLASS_RIDE, at: null, witnesses: null,
    payload: { boarded: 204.0, alighting: 205.0 }, effect: "aboard",
  });
  const after = Date.now();

  const stamped = Date.parse(row.written_at);
  assert.ok(Number.isFinite(stamped), "the fallback produced no parseable instant");
  assert.ok(stamped >= before && stamped <= after,
    "a class with no instant of its own must still be stamped, and stamped NOW — an unstamped act is a row no reader can order");
});

test("FALLBACK: a null `writtenAt` is still the fallback, never the string \"null\"", () => {
  // A destructuring default fires on `undefined` and NOT on `null`, so a caller
  // that coalesces badly would put "null" in the first field every reader of a
  // departure reads. `walkEntry` coalesces with `?? undefined` for this reason.
  const { entry } = oneDeclaration();
  const row = normalizeRow(walkEntry({ ...describeArgs(entry), writtenAt: null }));
  assert.notEqual(row.written_at, "null");
  assert.ok(Number.isFinite(Date.parse(row.written_at)), "an unparseable instant in `acts.at` is a record that cannot be ordered");
});

/** The builder's own arguments, recovered from an entry it built — so the test
 *  above bends ONE input rather than restating the whole call. */
function describeArgs(entry) {
  const p = entry.payload;
  return {
    crossing: entry.crossing, who: entry.actor, targetMarkId: entry.object,
    stampAt: entry.at, witnesses: entry.witnesses,
    from: p.from, toward: p.toward, pace: p.pace,
    targetExtent: p.within, household: entry.household,
    declaredBy: p.declared_by, note: p.note ?? null,
  };
}

test("the act is still a `move`, and still says what a walk does", () => {
  const { entry } = oneDeclaration();
  assert.equal(entry.cls, CLASS_MOVE);
  assert.equal(entry.action, "walk");
  assert.equal(entry.effect, "the walk is declared; the record receives it at the save");
});
