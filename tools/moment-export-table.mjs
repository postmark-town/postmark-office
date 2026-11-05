// moment-export-table.mjs — THE REVIEWABLE TABLE behind the founder moment export (POS-780).
//
// DATA ONLY. Adding a stored action name, or a payload key, is a visible edit to THIS
// file in a PR, never a silent one (Wright 2026-11-05 10:03). Nothing here is a class
// wildcard, a prefix test or a name scan: a stored action is in the table or it is out.
//
// Every entry says where its shape was read. Pins: O = postmark-office 32ce1e05
// (train/2026-w46), W = postmark-world f9ec8bec. A line range is where the WRITER or
// NORMALIZER builds the row; it is read, not run.
//
// ── ROLES (payload keys) ─────────────────────────────────────────────────────
//   party    a resident-handle slot, or null. Resolved against the consent registry;
//            a non-yes, an unmapped handle or an unchecked string takes the WHOLE act out.
//            `the-town` is the proven system actor and is not looked up (SYSTEM_ACTORS).
//   speaker  the same, named for the speech's source (say.stood_with, emission.spoken_by).
//   prov     provenance or a plain id (mark id, stop id, act id, maker): kept, never gated.
//            A maker named here is NOT a party (Wright 10:03).
//   str/num/bool/geo   an inert typed value, kept. A value of another type is a
//            type_mismatch and takes the act out (a Boolean `aboard` is never a handle).
//            `geo` is numbers, null, and arrays/objects of numbers only.
//   text     free words the actor wrote, kept (say.text, leave-mark body).
//   drop     removed from the projection; it does not gate (ledger prose, a raw `line`,
//            a creature id whose namespace is unread).
//   private  present and non-null means the row is not public (say.room).
//   moves    units rows: [{from,to,label,n}] where from/to are holders under
//            holderLawOf (kind-holding.mjs:88, a QUALIFIED caller): no "/" is a resident,
//            "/" is a mark or chest. A move's `to` may be `ground`: null, and ONLY in the
//            set-down (units:drop), whose writer stores `to: null` (world-units.mjs:495).
// A payload key that is not listed for its alias is UNCLASSIFIED: the act is out
// (Wright 09:14: an unclassified role is a party), counted by field path.

// ── COMMON ARCHIVAL METADATA: the pen's late-arrival stamp ────────────────────
// A row that files after its window is certified keeps its `at`, is restamped to the open window's crossing, and the
// pen adds EXACTLY TWO payload keys: `late_from_crossing` (the original crossing, a finite NUMBER) and `late_arrival`
// (the reason, a non-empty STRING). O src/world2-pen.mjs:119-128 lateCrossingGuard; the standing reason for a stake that
// puts a draft forward is world2-pen.mjs:101 LATE_ARRIVAL_PUT_FORWARD, filed from src/world2-claims.mjs:927-929.
// They are neither a resident role nor a clock: kept, never gated, never a consent. Only the pen-written (non-legacy)
// profiles list them; a legacy backfill row, and the inner payload of a persisted line, do not. The pair is written
// together, so one without the other is malformed.
const LATE = Object.freeze({ late_from_crossing: "crossnum", late_arrival: "reason" });
const withLate = (vocab) => Object.freeze({ ...vocab, ...LATE });

/** The nine canonical acts (the packet's list; Wright 10:03 item 2). */
export const CANONICAL_ACTS = Object.freeze(["walk", "say", "enter", "exit", "ride", "take", "give", "drop", "leave-mark"]);

/** Actors that are the town itself, not residents. Read: hold-through.mjs:271, creature-tick.mjs:425, creature-endings.mjs:420, set-down.mjs:32 (all O). */
export const SYSTEM_ACTORS = Object.freeze(["the-town"]);

/** The inner class an emission must carry to be a spoken line. O world2/tools/conversations.mjs:274,293. */
export const EMISSION_SOUND_CLASS = "sound";

const WALK = withLate({ from: "geo", toward: "geo", pace: "num", within: "geo", to: "prov", declared_by: "party", note: "drop", approach: "drop" });
const LEGACY_WALK = Object.freeze({ iso: "str", handle: "party", from: "geo", toward: "geo", at: "num", targetExtent: "geo", targetMarkId: "prov", pace: "num", line: "drop", _ledger: "drop" });
const FRAME = withLate({ ledger: "drop", lines: "drop", summary: "drop", via: "prov", set_down_at: "prov", arrived: "bool", arrival_of: "prov", dungeon: "prov", locked_until: "str", left_at: "str", fled: "drop" });
const LEGACY_FRAME = Object.freeze({ iso: "str", handle: "party", act: "str", mark: "prov", at: "num", word: "drop", line: "drop", _ledger: "drop" });
const HOLD = withLate({ thing: "prov", holder: "party", previous_holder: "party", made_by: "prov", policy: "str", owns: "bool" });
// give/take: the writer stores payload { units: true, moves } and nothing else (world-units.mjs:214-221;
// moves are planGive/planTake world-stacks.mjs:385,393: { from, to, label, n }). No `kind`, no `kinds`.
const UNITS = withLate({ units: "bool", moves: "moves" });
// the set-down: payload { units, moves:[{from:actor,to:null,label,n:1}], label, at:{x,y} } (world-units.mjs:495-497)
const UNITS_DROP = withLate({ units: "bool", moves: "moves", label: "str", at: "geo" });

/** payload roles for a say; `room` is the private marker (WLD-74: a room's record is shown only to readers in that room). */
const SAY = withLate({ text: "text", place: "str", aboard: "bool", room: "private", stood_with: "speaker" });

/**
 * The STORED DEPARTURE LINE, the second producer of `legacy:departure`. WRITER: tools/crossing-save.mjs:327-329 (and the
 * derived-side call at :514) builds { at, type:"departure", actor, seq, payload } from storedDepartureEvents, whose payload is
 * src/world-movement.mjs:535-546 departureEventOf: { from, toward, crossing, within, to, pace, declared_by, source:"acts" }.
 * world2/tools/seed-import.mjs:681-684 stores the WHOLE line as the payload of a `legacy:departure` row (class legacy).
 * The line's `actor` is the walker and `declared_by` the same handle: both are parties.
 */
export const DEPARTURE_OUTER = Object.freeze({ at: "str", type: "prov", actor: "party", seq: "num", payload: "inner", room: "private" });
export const DEPARTURE_INNER = Object.freeze({ from: "geo", toward: "geo", crossing: "num", within: "geo", to: "prov", pace: "num", declared_by: "party", source: "str" });
export const DEPARTURE_LINE_TYPE = "departure";

/**
 * The inner payload of a persisted emission. WRITER: tools/crossing-save.mjs:335-348 builds the line
 * { at, type:"emission", actor, id, payload:{ class, x, y, ttl_expires_at, spoken_by, human, aboard,
 * place, text, class_version, radius_m, ttl_min } }; world2/tools/seed-import.mjs:681-684 stores that
 * whole line as the payload of a `legacy:emission` row (class "legacy"). `_live` is not written there.
 */
export const EMISSION_INNER = Object.freeze({ class: "str", x: "num", y: "num", text: "text", spoken_by: "speaker", human: "bool", aboard: "bool", place: "str", radius_m: "num", ttl_min: "num", class_version: "num", ttl_expires_at: "str", room: "private" });
/** The persisted line's own keys (`at` is the instant; `type` is the line's discriminator; `actor` is the source and a party). */
export const EMISSION_OUTER = Object.freeze({ at: "str", type: "prov", actor: "party", id: "prov", payload: "inner", room: "private" });
/** The stored line type a `legacy:emission` row must carry (seed-import.mjs:681 names the action after it). */
export const EMISSION_LINE_TYPE = "emission";

const LEAVE_MARK = withLate({
  slug: "prov", kind: "str", at: "geo", extent: "geo", points: "geo", body: "text", parent_id: "prov", by: "party", date: "str",
  slot: "str", value: "str",
  holder: "bool", open: "bool", capacity: "num", stamps: "num", put_forward: "bool",
  image: "drop", _set_down: "drop", _placed_by: "drop", _consent: "drop",
});

/**
 * stored action name -> the canonical act it is, the classes its rows may carry (null: not
 * traced, so the inner check decides), the payload vocabulary, and where it was read.
 * `wrapper: true` means unwrap `payload.payload` and judge the inner as the canonical act; `line_type` is
 * the outer line's required `payload.type`.
 */
export const ACTION_ALIASES = Object.freeze({
  "walk": { canonical: "walk", classes: ["move"], payload: WALK, source: "O src/world.mjs:1774-1792 walkEntry (class move)" },
  // TWO producers write this stored name; each is a profile with an explicit discriminator. Exactly one must match, else the row is
  // not carried (no fallback, no unwrap of a shape that did not name itself).
  "legacy:departure": { canonical: "walk", classes: ["legacy"], mismatch_reason: "not_a_departure", profiles: Object.freeze([
    { name: "backfill-ledger-row", match: { present: ["iso", "handle"], absent: ["type", "payload"] }, payload: LEGACY_WALK,
      source: "O world2/tools/ledger-backfill.mjs:233-247; payload = W tools/walk.mjs:86-98 parseWalkLedger departure + _ledger (flat: iso, handle, no type, no inner payload)" },
    { name: "state-log-line", match: { type: DEPARTURE_LINE_TYPE }, wrapper: true, line_type: DEPARTURE_LINE_TYPE, at_as: "line_at", payload: DEPARTURE_OUTER, inner: DEPARTURE_INNER,
      source: "O world2/tools/seed-import.mjs:681-684 (the whole STATE/log line) <- tools/crossing-save.mjs:327-329,514 <- src/world-movement.mjs:535-546 departureEventOf" },
  ]) },
  "say": { canonical: "say", classes: ["voice"], payload: SAY, source: "O src/world.mjs:1905-1921 voiceEntry (class voice)" },
  "legacy:emission": { canonical: "say", classes: ["legacy"], mismatch_reason: "not_a_say", wrapper: true, line_type: EMISSION_LINE_TYPE, inner_class: EMISSION_SOUND_CLASS, at_as: "emitted_at", inner: EMISSION_INNER, payload: EMISSION_OUTER, source: "O world2/tools/seed-import.mjs:681-684 (action legacy:<line type>, class legacy, payload = the line) <- tools/crossing-save.mjs:335-348 (the emission line); reader world2/tools/conversations.mjs:287-300" },
  "enter": { canonical: "enter", classes: ["frame"], payload: FRAME, source: "O src/crossing-exec.mjs:107-132 (class frame)" },
  "exit": { canonical: "exit", classes: ["frame"], payload: FRAME, source: "O src/crossing-exec.mjs:107-132 (class frame)" },
  "legacy:enter": { canonical: "enter", classes: ["legacy"], payload: LEGACY_FRAME, source: "O world2/tools/ledger-backfill.mjs:218-231; payload = W tools/enter-exit.mjs:178-182 + _ledger" },
  "legacy:exit": { canonical: "exit", classes: ["legacy"], payload: LEGACY_FRAME, source: "O world2/tools/ledger-backfill.mjs:218-231; payload = W tools/enter-exit.mjs:178-182 + _ledger" },
  "ride": { canonical: "ride", classes: ["ride"], payload: withLate({ origin: "prov", to: "prov", distance_m: "num", pace_km_per_crossing: "num", declared_at: "str", arrives_at: "str" }), source: "O src/world-ride.mjs:649-657 (key set pinned at src/world-apex.mjs:468-474)" },
  "take": { canonical: "take", classes: ["holding"], payload: HOLD, source: "O src/world-hold.mjs:1707-1721 holdingEntry" },
  "give": { canonical: "give", classes: ["holding"], payload: HOLD, source: "O src/world-hold.mjs:1707-1721 holdingEntry (class creature gives are NOT admitted: encounter-verbs.mjs:695, kind `who` unread)" },
  "drop": { canonical: "drop", classes: ["holding"], payload: HOLD, source: "O src/world-hold.mjs:1707-1721 holdingEntry" },
  "units:give": { canonical: "give", classes: ["holding"], payload: UNITS, source: "O src/world-units.mjs:214-221 writeUnits; plan src/world-stacks.mjs:375-385 planGive (moves { from:actor, to, label, n })" },
  "units:take": { canonical: "take", classes: ["holding"], payload: UNITS, source: "O src/world-units.mjs:214-221 writeUnits; plan src/world-stacks.mjs:389-393 planTake (moves { from, to:actor, label, n })" },
  "units:drop": { canonical: "drop", classes: ["holding"], moves: "drop", payload: UNITS_DROP, source: "O src/world-units.mjs:495-497 (moves [{ from:actor, to:null, label, n:1 }], payload { label, at:{x,y} }); writer 214-221" },
  "leave-mark": { canonical: "leave-mark", classes: ["mark"], payload: LEAVE_MARK, source: "O src/world.mjs:5544-5552 (clean), 4713-4750 (declaration, entry); public-log path src/world-journal.mjs:384-440,494-530 (an unstaked draft never reaches acts when the candle is on) + src/world2-claims.mjs:872-925 (the released deferred act lands in acts at the stake)" },
});

/** The keys of a units move (give/take): both ends are holders. */
export const UNITS_MOVE = Object.freeze({ from: "holder", to: "holder", label: "str", n: "num" });
/** The keys of a set-down's move: the source is the actor, the destination is the ground (null). */
export const UNITS_DROP_MOVE = Object.freeze({ from: "holder", to: "ground", label: "str", n: "num" });

/**
 * READ AND DELIBERATELY NOT IN THE TABLE (counted by stored name when they appear in a window):
 *   emission             a bare `emission` has no writer in the tree at 32ce1e05 (conversations.mjs:272,287 and falsifier-live-equality.mjs:131
 *                        name it; no code stores it): it cannot be qualified, so it is not admitted
 *   land                 DEPARTURE_ACTIONS (live-reads.mjs:410) names it; its writer and payload were not traced
 *   legacy:leave-mark    read at replay-ingest.mjs:1490; its writer is the generic seed path (seed-import.mjs:787), payload unread
 *   units:make|stock|refill|consume|offer|drop-*|take-back|exit-withdrawn|...   not one of the nine
 *   amend, withdraw, stake, note-to-self, letters, stances, creature-class give, every other action
 */
export const KNOWN_NOT_TABLED = Object.freeze(["emission", "land", "legacy:leave-mark", "units:make", "units:stock", "units:refill", "units:consume", "units:offer", "amend", "withdraw", "stake", "note-to-self"]);
