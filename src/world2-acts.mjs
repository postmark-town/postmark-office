// world2-acts.mjs — THE WORLD 2.0 SHADOW PEN (office_api's acts writer, dev era).
//
// Phase 3a of the World 2.0 gold plan (G:/Starstory/PULSE/gold-plans/
// postmark-world-2/): every row appendJournal writes into the sqlite journal is
// MIRRORED into Postgres `acts` — the permanent event log that replaces the
// journal-truncate-drain-to-git cycle at cutover. During the shadow era the
// sqlite journal remains the store the office READS; Postgres is the store
// being proven. The parity falsifier (world2/tools/falsifier-acts-parity.mjs)
// asserts every undrained journal row has its acts twin.
//
// ── THIS IS A SHIM, AND IT SHIPS WITH ITS OWN DEATH (anti-rebake rule 5) ─────
// The mirror exists so 1.0 and 2.0 can be A/B'd on the same live dev traffic
// (phase 4). At cutover the journal INSERT dies, this file's mirror becomes the
// door's ONE awaited write, and `acts.journal_seq` is dropped. The expiry
// falsifiers red past a lane's own backstop (below) so the shim cannot become
// furniture.
//
// ── WRITE DISCIPLINE ─────────────────────────────────────────────────────────
// appendJournal is synchronous; the mirror is an in-process serial queue —
// fire-and-forget FOR THE CALLER, never for the operator: a failed mirror
// write logs loudly, lands in `mirrorStatus().failed`, and the parity
// falsifier turns red at the next check. That is acceptable ONLY because the
// sqlite journal is still the SoT this era; the cutover rewrite awaits the
// insert and refuses at the door instead.
//
// Env:
//   WORLD2_PG=1        the mirror is on
//   WORLD2_PG_URL      postgres://office_api:<pw>@localhost:5432/world2_dev
//   (read per call like WORLD_SINGLE_LOG — a test flips it between cases)

// ── THE EXPIRY IS PER LANE (DEC-2, ruled by the founder 2026-08-29 evening) ──
//
// It was one constant for the whole store, and that constant contradicted a
// standing founder ruling. PARITY MATRIX P-143, verbatim:
//
//   "**NONE, by ruling — the lane stays sqlite-first.** No read port; the future
//    combat system is a hardened 2.0-native rebuild, not a port ... The 09-30
//    reverse-mirror expiry does NOT apply to an unflipped lane"
//
// The cutover runbook (§8) named the disagreement: "`MIRROR_EXPIRES` is global.
// ... `falsifier-acts-parity.mjs` reads one constant for the whole store and
// reds on 2026-10-01 regardless of lane. The ruling and the mechanism disagree,
// and the mechanism is what will fire." The founder ruled DEC-2's recommendation
// as written, verbatim:
//
//   "**Make the expiry per-lane** — a lane in `FLIP_REFUSED` *by ruling* is
//    exempt; a lane refused by *unreadiness* is not. Do not simply move the
//    date. ... Moving a shim's death date is the mechanism by which shims become
//    furniture (rule 5). Per-lane keeps the falsifier honest for the six lanes
//    it should govern."
//
// WHAT ENDS A LANE'S MIRROR OBLIGATION: that lane's read ports landing and its
// deletion being ruled (rule 6) — recorded by DELETING its row from LANE_MIRROR
// below, which is a thing a human does with a ruling in hand. Never a store-wide
// clock running out. The date a governed lane carries is a BACKSTOP, not the
// closure: it reds if the lane is still mirroring past it, which is the pressure
// rule 5 asks for and the reason moving a date is not the fix.
//
// UNREADINESS BUYS NO EXEMPTION. `mark` is refused in `FLIP_REFUSED`
// (world-journal.mjs) because its candle half is not wired — that is
// unreadiness, so it is governed here exactly like the five wired lanes. DEC-2's
// "the six lanes it should govern" is C1–C6 of the runbook's lane table
// (stance · hold · walk · say · frame · mark); the arena is the row beneath them
// and the only exemption, because its refusal is a RULING and not a to-do.
//
// That sentence describes the map DEC-2 governed, and it stays as written
// because it is the ruling's own scope. Two of the six have since CLOSED — see
// the closure record above the map, which names each one's instrument. A lane
// leaving this map is the obligation ending, never the ruling narrowing.

/**
 * The governed lanes' shared backstop. Keemin may move it; it may not vanish.
 *
 * MOVED 2026-09-21 — 2026-09-30 → 2026-10-05, the end of cycle #6. Keemin's
 * ruling, ROLLOVER 29 option (b); the ruling is written on postmark#2743.
 *
 * DEC-2 is quoted above saying "Do not simply move the date", and that quote
 * stays exactly as it is, because it is the ruling's own words about the thing
 * it was protecting: a shim kept breathing by a clock while a lane still owed a
 * read port. That is not this case, and the difference is measurable rather
 * than argued. Every lane this map still names now reads the STORE — frame and
 * the ride's entry stop in POS-152, hold in POS-153, stands in POS-162, walkers
 * in flight in POS-154. What is left in this file is expiry BOOKKEEPING over
 * lanes whose ports have landed, and the map itself is deleted whole by G1
 * (POS-156), with the journal INSERT and `acts.journal_seq` following in G2.
 * So the date is not buying the shim more life; it is keeping two falsifiers
 * from reddening the suite for four days while the deletion that actually ends
 * the obligation is a week out.
 *
 * WHAT MOVING THIS DOES NOT DO, said here because the map's own history invites
 * the opposite reading: it does not end any lane's obligation, and it does not
 * narrow DEC-2's scope. A row still ends by being DELETED. This file's own
 * falsifier holds that line independently of whatever this constant says —
 * "a lane's obligation ends by removing its row, not by moving a date" asks the
 * question over DEC-2's original six at the year 2099, and a later date is
 * still a date.
 */
export const MIRROR_EXPIRES = "2026-10-05";

// ── CLOSED LANES: WHAT LEAVING IS, AND WHAT IT IS NOT (POS-125, 2026-09-20) ──
//
// `walk` (C3) and `say` (C4) are GONE from this map, per rule 6 and DEC-2's
// "what ends a lane's obligation is DELETING its row". Both were measured at
// office `2f6c4b2` by the only question that settles it: does anything still
// read that lane's rows OUT OF THE SQLITE JOURNAL?
//
//   · walk — nothing. No `readJournal` call site filters CLASS_MOVE. The 1.0
//     read source is `dynamic.db/movements`, written by its own INSERT
//     (dynamic-entities.mjs) and never by the reverse mirror; the store port is
//     live-reads.mjs, held to 1.0's law by falsifier-live-equality.
//   · say  — nothing. No `readJournal` call site filters CLASS_VOICE. The 1.0
//     read source is `voices-log.jsonl` (voices.mjs), written by voices.mjs and
//     never by the reverse mirror; the store port landed as
//     world2/tools/conversations.mjs + /world2/conversations, held by
//     falsifier-conversations-equality.
//
// WHAT THIS DELETION DOES NOT DO, said here because the map's own name invites
// the opposite reading: it does NOT stop the reverse mirror. The INSERT in
// `appendActFlipped` (world-journal.mjs) is unconditional and consults nothing
// here — every consumer of this map is an EXPIRY consumer. The mirror is one
// shared code path that cannot die per lane, so a row's removal is exactly the
// bookkeeping DEC-2 designed it to be: this lane is owed no twin any more. The
// shim itself dies in G2, with the journal INSERT and `acts.journal_seq`.
//
// THE FOUR THAT STAYED, and what each still needs (POS-125's MEASUREMENT.md):
//   · stance — world-stance.mjs's merged read; the register overwrites where
//     both hold an act, but whether `acts` holds a twin for EVERY standing
//     journal row is a question about the live store. falsifier-acts-parity
//     answers it on the box; green there closes this row.
//   · hold   — PORTED. This note used to say the `since:` shelf read
//     `cls: "holding"` out of sqlite as its SOLE source at three call sites;
//     POS-162 took `world.mjs § thingStandsBlock` and POS-153 took the other
//     three (`groundWithinReach`, `holdingsFor`, `readHoldEffects`), so NO live
//     sqlite reader of that class remains and the lane is portable. The row and
//     its date are untouched here on purpose — deleting it is POS-156's act, and
//     a lane that retires its own obligation is the shape rule 6 forbids.
//   · frame  — enter/exit rows are CLASS_FRAME. This note used to name TWO live
//     sqlite readers of them; as of POS-152 there is ONE. The ride's entry stop
//     (world-apex.mjs § actsOfActor) now folds from `acts`, so the drain can no
//     longer cost a rider their set-down. What is left is every crossing's
//     occupancy (enter-exit-ledger.mjs § readJournal), which still reads the
//     journal, so deleting this row's mirror today still costs the town its
//     occupancy. The row stays; POS-156 is where it goes.
//   · mark   — world-drain.mjs still photographs the journal to git, and
//     postmark-crossing-save.timer is still deployed. Its replacement exists
//     (state-log-from-store.mjs); the retirement is G2's.

/**
 * ONE ROW PER LANE, in world2-pen.mjs's `laneOf` vocabulary.
 *
 * `expires: null` is an exemption BY RULING and must carry the ruling's own
 * words — nothing else may be exempt, and a lane that is merely unready is not.
 * Removing a row entirely is how a lane's obligation ENDS (ports + rule 6's
 * deletion, together). A lane absent from this map is governed by the shared
 * backstop: an unnamed lane must never buy immortality by being unnamed.
 */
export const LANE_MIRROR = Object.freeze({
  stance: Object.freeze({ expires: MIRROR_EXPIRES }),
  hold: Object.freeze({ expires: MIRROR_EXPIRES }),
  frame: Object.freeze({ expires: MIRROR_EXPIRES }),
  mark: Object.freeze({ expires: MIRROR_EXPIRES }),
  arena: Object.freeze({
    expires: null,
    ruling: 'P-143, RULED (Keemin, 2026-08-29 party night: "we can just keep the '
      + 'arena on sqlite for now") — the lane stays sqlite-first, no read port, '
      + "the hardened rebuild lands 2.0-native instead. Lifting this is a founder "
      + "ruling PLUS the arena read ports, together.",
  }),
});

// ── WHEN EACH LANE'S PEN FLIPPED — DATES AS DATA, NOT AS PROSE ───────────────
//
// THE DEFECT THIS EXISTS TO KILL (w2-hold-say-flip-report.md § Findings 2,
// 2026-09-03, verbatim): "`--since` is one clock for every lane, and lanes flip
// on different days. Asked for `--lanes stance,hold,say --since <the stance
// flip>`, it read 81 mirror-era say acts (`journal_seq` NULL by the mirror's
// design, never flipped) as 'flipped acts lacking twins'. The pairing key
// 'journal_seq NULL' does not distinguish a flipped row from a mirror-written
// row of a lane that never had journal rows."
//
// The pairing key CANNOT distinguish them and never will: before a lane flips,
// its mirror writes `acts` rows with `journal_seq` NULL too (the say gap and the
// holding gap were closed by the mirror, not by the journal — the lane simply
// had no journal row to carry a seq). The only thing that separates a flipped
// row from a mirror row of the same lane is WHEN — so the moment each lane's pen
// flipped is a fact the store needs written down, and this is where it lives:
// beside LANE_MIRROR, which is already the one home for per-lane truth about the
// shim. A falsifier that carried these dates in its own argv would make every
// operator re-type them, and a date re-typed is a date eventually mistyped.
//
// THE VALUE IS THE SERVICE-RESTART MOMENT, from that lane's own flip report —
// not the first act observed after it. An act is evidence the flip happened
// BEFORE it; the restart is the flip.
//
// `null` means THIS LANE HAS NOT FLIPPED. It is not "unknown" and it is not a
// backstop: a lane with a null here has no flipped era at all, so a reverse-
// parity check over it is a comparison with nothing to compare (its
// `journal_seq`-NULL rows are the mirror's, and pairing them against a journal
// that never held them manufactures exactly the 81 false reds above). A lane
// ABSENT from this map is also unflipped — nothing becomes "flipped" by being
// unnamed, which is LANE_MIRROR's own fail-closed rule pointed the other way.
//
// A lane's row changes ONCE, when its pen flips, and the change carries the
// report that names the restart. Rolling a lane back (removing it from `W2_PEN`)
// does NOT clear its row: the flipped-era acts it wrote still exist and still
// need pairing. A second flip after a rollback is a second era, and the honest
// shape for that is a list rather than a scalar — deliberately not built until
// a rollback actually happens, because a shape nobody needs is furniture.
export const LANE_FLIPPED_AT = Object.freeze({
  // C1 · `W2_PEN=stance`, postmark-office.service restarted 21:01:58Z
  // (G:/Starstory/docs/2026-09-02/w2-stance-flip-report.md).
  stance: "2026-09-02T21:01:58Z",
  // C2 + C4 · `W2_PEN=stance,hold,say`, one restart, both lanes
  // (G:/Starstory/docs/2026-09-03/w2-hold-say-flip-report.md: "FLIPPED ON PROD
  // 2026-09-03 18:58:05Z").
  hold: "2026-09-03T18:58:05Z",
  say: "2026-09-03T18:58:05Z",
  // C3, C5, C6 flipped on prod 2026-09-05, one lane at a time, each with the
  // refusal proof before the flag and the reverse-parity arm after its first
  // live act (walk 1/1, frame 3/3; mark's amend paired by hand — see the
  // report's finding on the held-act release instant). The arena stays null by
  // ruling (P-143). This table records when a lane's pen ACTUALLY flipped on a
  // box, which is a fact about `W2_PEN`, not about the code: a wired lane whose
  // flag has never named it has no flipped era, and a date written before the
  // flag moved would hand the reverse-parity arm a window in which every
  // `journal_seq`-NULL row is the mirror's — finding 2, planted by hand. The
  // founder's flip sets each line, in the same change as the flag.
  // C3 · `W2_PEN=stance,hold,say,walk`, postmark-office.service restarted 19:09:37Z
  // (G:/Starstory/docs/2026-09-05/w2-walk-frame-mark-flip-report.md).
  walk: "2026-09-05T19:09:37Z",
  // C5 · `W2_PEN=stance,hold,say,walk,frame`, restarted 19:11:01Z (same report).
  frame: "2026-09-05T19:11:01Z",
  // C6 · `W2_PEN=stance,hold,say,walk,frame,mark`, restarted 19:12:06Z (same report).
  mark: "2026-09-05T19:12:06Z",
  arena: null,
});

/**
 * The instant this lane's pen flipped, or null when it never has.
 *
 * Fail-closed the way `mirrorExpiresFor` is, and toward the opposite answer for
 * the opposite reason: an unnamed lane there must not buy IMMORTALITY, an
 * unnamed lane here must not buy a FLIPPED ERA it never had. Both defaults are
 * the answer that cannot manufacture a passing check out of an omission.
 */
export function laneFlippedAt(lane, lanes = LANE_FLIPPED_AT) {
  const at = Object.prototype.hasOwnProperty.call(lanes, lane) ? lanes[lane] : null;
  return at ?? null;
}

/** The lanes whose pen has flipped — what a reverse-parity check can ask about. */
export function flippedLanesAt(lanes = LANE_FLIPPED_AT) {
  return Object.keys(lanes).filter((lane) => laneFlippedAt(lane, lanes) !== null);
}

// THE BACKSTOP IS A TOWN DAY, NOT A WIRE DAY (2026-08-30, the v1 settlement
// sweep of every dated derivation). This was `.toISOString().slice(0, 10)`, so
// the whole 20:00–23:59 ET stretch of a lane's LAST lawful day already read as
// tomorrow: `laneMirrorExpired` went true four hours before the town's own
// 2026-09-30 was over, and `mirrorExpiryLine` would have told an operator six
// lanes were past a backstop they were still inside. Same defect, same shape,
// same night as town-bridge's `townDayOf` (the 00:00Z gift blackout) and
// ops.townDay — every dated derivation in this repo now reads TOWN_TZ.
//
// A day STRING passes through untouched and that asymmetry is the point: "2026-
// 09-30" is ALREADY a day somebody wrote down, and re-deriving it through a
// timezone would move it — `new Date("2026-09-30")` is midnight UTC, which is
// 2026-09-29 in town. A day is only derived from an INSTANT.
const dayOf = (today) =>
  typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)
    ? today
    : new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" })
        .format(today instanceof Date ? today : new Date(today));

/**
 * A lane's backstop date, or null when it is exempt by ruling.
 *
 * EXEMPTION IS AN EXPLICIT `null` AND NOTHING ELSE. A lane absent from the map,
 * and a row that simply never said, both fall back to the shared backstop —
 * nothing becomes immortal by omission, which is the failure this function
 * exists to make impossible. (The can-fail proof in both falsifiers asserts it:
 * a row of `{}` is governed, not exempt.)
 */
export function mirrorExpiresFor(lane, lanes = LANE_MIRROR) {
  const row = Object.prototype.hasOwnProperty.call(lanes, lane) ? lanes[lane] : null;
  return row && row.expires !== undefined ? row.expires : MIRROR_EXPIRES;
}

/** Has THIS lane's mirror passed its own backstop? An exempt lane: never. */
export function laneMirrorExpired(lane, today = new Date(), lanes = LANE_MIRROR) {
  const expires = mirrorExpiresFor(lane, lanes);
  return expires !== null && dayOf(today) > expires;
}

/** The governed lanes past their backstop, named — what a red must list. */
export function expiredLanes(today = new Date(), lanes = LANE_MIRROR) {
  return Object.keys(lanes).filter((lane) => laneMirrorExpired(lane, today, lanes));
}

/** The lanes exempt by ruling — what a red must say it did NOT count. */
export function exemptLanes(lanes = LANE_MIRROR) {
  return Object.keys(lanes).filter((lane) => mirrorExpiresFor(lane, lanes) === null);
}

/**
 * The one sentence both falsifiers append to a GREEN, so the two tools cannot
 * drift into describing the same expiry two ways (this file's own LEDGER_PAYLOAD
 * lesson: one home for a serialization, or two readers disagree in a way that
 * still parses). Says how many lanes are governed, when the soonest falls, and
 * names every exemption — a green that hid the exemptions would read as though
 * the arena were being checked.
 */
export function mirrorExpiryLine(lanes = LANE_MIRROR) {
  const governed = Object.keys(lanes).filter((lane) => mirrorExpiresFor(lane, lanes) !== null);
  const exempt = exemptLanes(lanes);
  const exemptPart = exempt.length ? `; exempt by ruling: ${exempt.join(", ")}` : "";
  if (!governed.length) return `No lane still owes a mirror — every governed row is closed${exemptPart}.`;
  const soonest = governed.map((lane) => mirrorExpiresFor(lane, lanes)).sort()[0];
  return `${governed.length} lane(s) still mirroring, none past its backstop (soonest ${soonest}: `
    + `${governed.filter((lane) => mirrorExpiresFor(lane, lanes) === soonest).join(", ")})${exemptPart}.`;
}

const state = {
  queue: Promise.resolve(),
  written: 0,
  failed: 0,
  lastError: null,
  pool: null,
};

export function world2Enabled(env = process.env) {
  return env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL;
}

/** Test seam: hand the module a pool (the late-crossing test uses a recording stub). Never used by the office. */
export function __setPoolForTest(p) { state.pool = p; }

async function pool(env = process.env) {
  if (state.pool) return state.pool;
  const { default: pg } = await import("pg");
  state.pool = new pg.Pool({ connectionString: env.WORLD2_PG_URL, max: 2 });
  return state.pool;
}

/**
 * Mirror one journal row into Postgres `acts`. `row` is the exact object
 * appendJournal built (post-normalization: witnesses/payload already JSON
 * strings, at_anchor/at_dx/at_dy split, written_at an ISO string); `seq` is
 * the sqlite rowid it landed at. Fire-and-forget for the caller; serialized
 * so acts receives rows in journal order.
 */
export function mirrorAct(row, seq, env = process.env) {
  if (!world2Enabled(env)) return;
  state.queue = state.queue.then(async () => {
    try {
      const p = await pool(env);
      // ONE SPELLING (enforced 2026-08-29; see world2-pen.insertAct for the
      // whole argument): the resolved household KEY, via the docket pen's own
      // resolver on the docket pen's own input — never the key's name, never a
      // gh:<id>, or acts and claims spell one fact two ways and every reader
      // joining them loses rows silently (the guards lane measured it live).
      const { householdKeyFor } = await import("./world2-claims.mjs");
      // THE LATE-CROSSING GUARD RUNS HERE TOO (2026-09-04). This path inserted
      // straight into acts and, that evening, filed four backfilled holding rows
      // at crossing 157 — certified history — while the pen's insertAct would
      // have refused or re-stamped them. One guard, both pens: a row that may
      // not file through the door may not file through the mirror either.
      const { lateCrossingGuard } = await import("./world2-pen.mjs");
      const guarded = lateCrossingGuard(row, { env });
      const household = guarded.household == null ? null : await householdKeyFor(p, guarded.household);
      await p.query(
        `INSERT INTO acts (at, crossing, actor, action, object,
                           at_anchor, at_dx, at_dy, witnesses, class,
                           payload, effect, household, journal_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [guarded.written_at, guarded.crossing, guarded.actor, guarded.action, guarded.object,
         guarded.at_anchor, guarded.at_dx, guarded.at_dy, guarded.witnesses, guarded.class,
         guarded.payload, guarded.effect, household, seq],
      );
      state.written += 1;
    } catch (err) {
      state.failed += 1;
      state.lastError = String(err?.message ?? err);
      // Loud, always: a silent shadow is a shadow nobody can trust.
      console.error(`[world2-acts] MIRROR WRITE FAILED (seq ${seq}): ${state.lastError}`);
    }
  });
  return state.queue;
}

/** Status for the office's status answer + the parity falsifier's preamble. */
export function mirrorStatus() {
  const { written, failed, lastError } = state;
  // `expires` keeps its scalar shape and meaning — the governed lanes' shared
  // backstop — so no reader of this answer changes; `lane_expiry` is the
  // per-lane truth added beside it (DEC-2), null where a lane is exempt.
  return {
    enabled: world2Enabled(), written, failed, lastError,
    expires: MIRROR_EXPIRES,
    lane_expiry: Object.fromEntries(
      Object.keys(LANE_MIRROR).map((lane) => [lane, mirrorExpiresFor(lane)])),
  };
}

/** Await everything queued (tests + graceful shutdown). */
export function mirrorSettled() {
  return state.queue;
}

/**
 * The shim's own death (rule 5): call from the falsifier/test suite.
 *
 * Store-wide, and now a DERIVED answer rather than a clock reading: true when
 * ANY GOVERNED lane has passed its own backstop. A lane exempt by ruling can
 * never make this true, which is P-143 holding; and once every governed lane's
 * row has been removed (ports landed, deletion ruled), this is false past any
 * date, because there is no longer a shim to outlive its death. Callers wanting
 * to say WHICH lanes should use `expiredLanes()` — a red that cannot name the
 * lane is the defect DEC-2 fixed.
 */
export function mirrorExpired(today = new Date(), lanes = LANE_MIRROR) {
  return expiredLanes(today, lanes).length > 0;
}

/**
 * READ the register, through the pool this module already owns.
 *
 * WHY IT LIVES IN THE WRITE MIRROR'S FILE. Three modules — `world2-serve`,
 * `world2-claims`, `world2-pen` — each carry their own private `pool(env)`,
 * and this file is the fourth. A fifth copy in `world-stance.mjs` would be the
 * office learning one word five times, so the read ports borrow the pool from
 * the module that owns the TABLE rather than opening another. (That there are
 * four already is a finding handed up, not a licence to add the fifth.)
 *
 * Returns `null` — never a throw and never `[]` — when the register is not
 * configured. **The distinction is the whole point:** a read port that answered
 * an empty array for "I could not look" would tell its caller the town has no
 * stances, which is the #2454 shape (a door that takes an act, keeps it, and
 * shows a world in which it never happened). `null` means "not asked"; `[]`
 * means "asked, and the answer is none".
 */
export async function actsQuery(text, params = [], env = process.env) {
  if (!world2Enabled(env)) return null;
  const p = await pool(env);
  const { rows } = await p.query(text, params);
  return rows;
}
