#!/usr/bin/env node
// fold-delta.mjs — THE DOCKET IS THE SELECTOR (G1 lane 3, ruled 2026-09-08).
//
// ── WHOSE FILE THIS IS ──────────────────────────────────────────────────────
//
// THIS IS THE `foldDelta`. Not a stand-in for one.
//
// It was built here because lane 2's pin `a5ccd224` did not export it (measured:
// that file exports `stakesFromStore` and `foldInputFromStore` and nothing else)
// and the conductor's 18:1x ruling said to build it in this lane against lane
// 2's named signature if their second pin had not landed it. **On 2026-09-09 the
// conductor ruled ownership: this file is the canonical implementation, lane 2
// has been told not to build a second, and lane 2's pin 2 rebases onto a tree
// that carries it.**
//
// An earlier version of this header said the opposite — that lane 2 owned the
// function by right and that "when lane 2 lands its own, this file is deleted".
// **That plan is WITHDRAWN and the sentence is corrected rather than removed**,
// because a comment instructing the next reader to delete the canonical
// implementation is worse than no comment: it survives the conversation that
// retired it, and it reads as authority.
//
// If `world2/tools/fold-input.mjs` ever grows a `foldDelta` of its own, that is
// two answers to "which marks are this crossing's", and `fold-input-cli.mjs`
// REFUSES rather than picking one. Two selectors that can disagree is the same
// hazard `founder_commit` is kept out of.
//
// ── WHY A DOCKET AND NOT "THE BYTES DIFFER" ─────────────────────────────────
//
// The chain must write only the marks THIS crossing produced. The reviewer's
// measurement of the alternatives, on the live store at window 177:
//
//     the crossing's own output          2 marks
//     the closed window's locked docket  33 marks   ← a safe superset, and both
//                                                     true marks are inside it
//     every standing row                 956 written, suite RED 18/742
//
// A selector of "the bytes differ from the tree" is the third row wearing the
// first row's clothes: it happens to narrow 1,031 to 813, which is not a delta,
// it is the whole corpus minus the marks that render identically. It also makes
// the fold's membership depend on the RENDERER — change a field's spelling and
// the crossing silently rewrites eight hundred records.
//
// So provenance is the selector: a mark is in this crossing because the candle
// LOCKED it at the window this crossing is folding, and for no other reason.
//
// ── THE SET, AND THE PREMISE THAT WAS TRUE ONLY WHERE IT WAS USED ───────────
//
// The ruling names `claims WHERE window_id = <closed> AND status = 'locked'`.
// This reads `marks WHERE locked_window = <closed>` instead, because a `marks`
// row goes straight into `renderRecord` and joining back from `claims` would be
// a second projection of the same fact and a second thing to keep in step.
//
// AN EARLIER VERSION OF THIS HEADER JUSTIFIED THAT WITH A COUNT — "33 locked
// claims, 33 marks with locked_window = 177" — AND A COUNT IS NOT AN IDENTITY.
// Measured read-only against prod, 2026-09-09:
//
//   window 177   33 marks · 33 claims · 17 SHARED IDS · 33 shared slugs
//   window 176    4 marks ·  4 claims ·  4 shared ids ·  4 shared slugs
//   window 172  116 marks · 118 claims · 2 slugs in claims and NOT in marks
//
// At 177 the two sets agree on every SLUG and share barely half their ids. THE
// LINK IS `supersedes`, and here is the check rather than the prose — it takes
// ten seconds to re-run:
//
//   claims.supersedes = marks.id on 16 of 16 of the differing rows at window 177
//
// (`supersedes uuid REFERENCES claims(id)` — `001_tables.sql`, the amend-chain
// column, three lines below the `id` comment that misled the first version of
// this header.) A slug amended at a later window gets a NEW locked claim whose
// `supersedes` points back at the claim `marks.id` still names, so the id sets
// part company exactly where an amend happened and nowhere else.
//
// WHAT `marks.id` IS NOT: the first locking claim's id. Measured at 177, it is
// the earliest locked claim on the slug for only 24 of 33 — so "first" is a
// tempting sentence and a false one, and this header does not make it. What is
// safe to say is the narrow thing: `marks.id` names A claim that locked this
// slug, not necessarily the one that locked it at `locked_window`, and a later
// locked claim points back at it through `supersedes`.
// At 172 they do not even agree on slugs — `berthillon/cone-blue-moon-2026-08-30`
// and `wright/the-flip-day-plumb-line` were locked at 172 and now read
// `locked_window = 177`.
//
// THE REASON IS THAT THE TWO COLUMNS ANSWER DIFFERENT QUESTIONS.
// `claims.window_id` is HISTORICAL — the window that claim was filed under, kept
// forever. `marks.locked_window` is LATEST-WINS — the window that most recently
// locked this slug. They coincide only for the NEWEST CLOSED WINDOW, where
// "most recently locked" and "locked at this window" are the same sentence.
//
// So this refuses any other window rather than under-selecting quietly. The
// crossing's own wait can run to 240 s, and a replay or a catch-up crossing
// landing on an older window would otherwise fold a set missing every slug that
// has since been re-locked — a real, silent, unattributable shortfall.
//
// A RETIRED mark locked at this window is carried too, and deliberately: the
// fold has to know a mark left. Its `status` rides on the row and the write-down
// decides; dropping it here would make a retirement invisible to the crossing
// that performed it.

// ── THE SECOND TERM: WHAT THE DOCKET CANNOT REACH (2026-09-12) ──────────────
//
// THE DOCKET IS STILL THE SELECTOR. Everything above stands. But the header's
// own sentence — "a window cleared outside the sweep's timing is orphaned;
// nothing revisits it" — was a description of the defect, not of a design, and
// on 2026-09-12 it cost the town two marks.
//
// WHAT HAPPENED. The 05:45Z candle could not log in. Window 184 was cleared BY
// HAND at 05:52Z, locking `neth/warm-stone-for-whoever-waits` and
// `sophia-familiaris/reachability-is-not-permission`, and the sweep's re-run
// refused on timing (correctly — the wait had passed). The 17:45Z crossing then
// folded window 185, published its seven, and never wrote the two. They stand in
// the store, `status = 'standing'`, with no file in canon, and the notary has
// listed them as `canon_absent 2` every 03:20 since. `marks.locked_window` is
// latest-wins, so the refusal above means nothing will ever fold 184 again.
//
// THE FIX IS A UNION, NOT A LOOSER SELECTOR. The docket query is untouched and
// its refusals fire first and unchanged. Beside it sits a second, NAMED term:
// every standing mark canon does not carry. It is bounded by the thing it is
// repairing — a mark leaves the set the moment its file lands — so it cannot
// become the standing set in a delta's clothes, and on an ordinary crossing it
// is empty.
//
// AND IT IS THE NOTARY'S OWN READER, not a second opinion. `STANDING_SELECT` and
// `canonLockFindings` are the same two the 03:20 read composes, so a mark listed
// at 03:20 and a mark carried at 17:45 are the same mark by construction. A
// second "is this slug in canon" written here is exactly the two-answers hazard
// this file's header keeps `foldDelta` single for. The register itself is built
// by the CALLER (`fold-input-cli.mjs`, from `--world-repo`), because
// `canonRegisterAt` reads a git checkout and this function has never touched a
// filesystem — which is what keeps every rule below provable on hand-built rows
// with no Postgres and no clone.

import { renderedMark, MARK_COLUMNS } from "./mark-render.mjs";
import { stakesFromStore } from "./fold-input.mjs";
import { STANDING_SELECT, canonLockFindings } from "./canon-locks.mjs";

// ── THE THIRD TERM: A WITHDRAWAL CANON HAS NOT YET CARRIED (WLD-88) ─────────
//
// THE DEFECT. The withdraw door answers "canon lets it go at the next crossing
// — the settlement unpublishes it" (src/world.mjs § journalWithdraw). In the
// git era the drain wrote that as a deletion on the household's sketchbook, and
// the sweep's withdrawal branch (settlement-sweep.mjs, "WITHDRAWAL") executed
// it. The store crossing (G1, 2026-09-08) dropped the drain and never wrote a
// removal: a withdraw of a published mark files no claim, so neither the docket
// nor the carry above could name it. The `withdrawn` channel read 0 on every
// crossing from 09-08, and a withdrawn ✦0 commons mark only ever left by the
// escrow unpublish, by accident. A home mark had no way out: Current's bed
// (`current-the-reader/the-bed-under-the-moons-road`, act 18087, S250) stood
// in canon ten settlements after its author let it go.
//
// THE TERM. Every STANDING mark whose latest mark act BY ITS OWNER (leave-mark,
// amend, withdraw) is a withdraw, and which canon still holds. It is STATE, not a
// window: a withdrawal owed since S250 is carried by the first crossing that
// looks, with no act from its author. It is bounded by what it repairs — a
// mark leaves the set when its file leaves canon, and the retire step
// (retire-unpublished.mjs) retires its row in the same crossing — so on an
// ordinary crossing it is empty.
//
// THE CARRY ABOVE MUST NOT UNDO IT. A withdrawn mark whose file has left canon
// and whose row did not retire (a refused retire step) is "standing, canon
// absent" — exactly the carry's set — and the carry would write it back. So
// the carry skips every slug this term's predicate names, whether canon holds
// it or not: one read, two readers.
//
// AND THE RETIREMENT IS OWED UNTIL IT LANDS (Wright's review of #672). The
// retire step reads its crossing's own sweep, so a refused retire would leave
// that row standing for good with no file in canon. Such a row (standing,
// canon-absent, latest owner act a withdraw) is named as `retire_only`, and
// the retire step reads it from the fold input: retired as settlement-withdraw,
// returned to no drafts, at the next crossing that runs it.
//
// ONLY THE OWNER'S ACTS COUNT. The door files a withdraw with the author as the
// actor, the WLD-27 `cause` withdrawals included (world-units.mjs passes the
// mark's own `by`). replay-ingest's synthesised withdraw is an act by
// `the-town` (DEC-15 case b), and a pre-flip re-leave has a NULL object, so
// without the actor test a founder-removed mark left again would read as
// withdrawn and be pulled from live canon. Measured 2026-10-20: marks.owner is
// the slug's prefix on 1,672 of 1,672 rows, and 13 of 13 door withdraws on a
// marks row carry the owner as actor.
//
// THE DOCKET WINS ITS OWN CROSSING. A slug in this window's docket is written
// by the docket and is not also removed; its withdrawal is owed, and carried,
// at the next crossing. One sketchbook never writes and removes one mark.
//
// The rows go to the write-down as `withdrawals`, beside `marks`, and become
// removals on the household's sketchbook. The sweep's withdrawal law judges
// them exactly as it judged a drained deletion: the town wall, authorship,
// escrow, stranded children and the gate.
export const WITHDRAWN_OWED_SELECT = `
  SELECT m.slug, m.owner, m.household, latest_mark_act.id AS act_id, latest_mark_act.crossing
    FROM marks m
    JOIN LATERAL (
      SELECT a.id, a.action, a.crossing FROM acts a
       WHERE a.object = m.slug AND a.class = 'mark' AND a.actor = m.owner
         AND a.action IN ('leave-mark', 'amend', 'withdraw')
       ORDER BY a.id DESC LIMIT 1
    ) latest_mark_act ON true
   WHERE m.status = 'standing' AND latest_mark_act.action = 'withdraw'
   ORDER BY m.slug`;


/**
 * WHAT COUNTS AS A DOCKET COUNT — one rule, one home, two readers.
 *
 * `selection.docket_claims` is produced here and consumed in two places that
 * must agree about what a valid one is: `fold-input-cli.mjs`, which refuses a
 * fold whose selection cannot carry the guard's third input, and
 * `src/store-writedown.mjs § starvingCheck`, which is the guard. Two copies of
 * this predicate is how two eras come to disagree about one field — the exact
 * argument `mark-record.mjs` makes about serializations — so there is one.
 *
 * IT IS A TYPE TEST, NOT A COERCION, and the reviewer's note of 2026-09-09 is
 * why. `Number("")`, `Number(false)` and `Number([])` are all 0, so an empty
 * string, a `false` and an empty array each read as "the docket was empty" and
 * PASS the last guard before publication. `Number(null)` is 0 too, which is the
 * same trap a second time: the first version of the CLI's own check spelled it
 * `Number.isFinite(Number(v))` and so accepted the explicit null its message
 * said it existed to catch. A count is a non-negative integer or it is not a
 * count, and anything else refuses rather than being read charitably.
 */
export const isDocketCount = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * THE CROSSING'S OWN MARKS, from the docket the candle locked.
 *
 * Signature is lane 2's as the ruling names it: `(client, { window })`, plus the
 * `worldSha` and `townSha` `foldInputFromStore` already requires and for the
 * same reasons — the store does not know the world commit and must not appear
 * to, and the stakes are as-of a town sha with no "latest".
 */
export async function foldDelta(
  client, { window = null, worldSha = null, townSha = null, canonRegister = null } = {},
) {
  // `window == null` is checked SEPARATELY from finiteness, and that separation
  // is the whole guard: `Number(null)` is 0, which is finite, so the obvious
  // one-line version accepted a missing window and went looking for window 0. It
  // would have refused there with `not-a-window` — a true sentence about the
  // wrong problem, sending the operator to look for a window nobody asked for
  // instead of at the caller that named none. Found by this function's own
  // falsifier asserting the refusal happened before any query.
  if (window === null || window === undefined || !Number.isFinite(Number(window))) {
    throw new Error(
      "foldDelta: no window — the docket IS the selector, so a fold with no window has no way to say which marks are "
      + "this crossing's. Falling back to the standing set here would be the 956-write configuration wearing a "
      + "delta's name.");
  }
  if (!worldSha) {
    throw new Error(
      "foldDelta: no worldSha — the store does not know which world commit this crossing starts from (that is the "
      + "settlement clone's `main`, the chain's `world_from`). Pass the caller's; do not let the receipt carry a blank.");
  }

  // ── THE REGISTER IS CHECKED BEFORE ANY QUERY, LIKE THE WINDOW ──────────────
  //
  // Both refusals here are about the ARGUMENT and need nothing from the store, so
  // they go where the window's do: a refusal that first opens a database is a
  // refusal with a second way to fail, and on the night the store is also down
  // the operator reads the wrong cause.
  //
  // THE SHA CHECK IS THE ONE THAT MATTERS. `as_of.world_sha` is what the receipt
  // says this crossing folded from. A register built at a DIFFERENT checkout
  // answers "canon does not carry this" about a world this crossing is not
  // publishing into — a carry that is correct, precise, and about the wrong
  // subject, which is the worst shape an instrument has.
  //
  // WHY IT CANNOT FIRE ON THE RAIL, AND THE REASON THIS COMMENT FIRST GAVE WAS
  // FALSE. It said the two were "the same by construction (`settlement-auto.sh`
  // checks `$SWEEP` out at `$WORLD_FROM` and passes both)". THAT WAS WRONG, and
  // the sentence is corrected rather than removed because it is the tempting one:
  // the sweep checks the clone out at `$WORLD_FROM` and then COMMITS
  // `WORLD/households.json` onto it whenever the household registry moved
  // (`deploy/settlement-auto.sh:386-395`, which that script's own :418-425 spells
  // out), so the clone's HEAD is one commit past `$WORLD_FROM` on every crossing
  // that follows a household declaration. A register stamped HEAD would have made
  // this check refuse a crossing that was fine.
  //
  // The identity holds by construction OF THE READER, not of the checkout:
  // `fold-input-cli.mjs` builds the register with `canon-register.mjs §
  // canonRegisterAtSha`, which is handed `--world-sha` and reads the tree at THAT
  // COMMIT — never the working tree and never HEAD. So `register.sha` is the sha
  // the crossing named, and what remains for this check to catch is a caller that
  // built its register somewhere else: a hand-run pointed at the wrong clone, or
  // a future path that goes back to reading a checkout. Which is exactly when it
  // should fire.
  if (canonRegister !== null && canonRegister !== undefined) {
    if (!(canonRegister.slugs instanceof Set) || typeof canonRegister.sha !== "string") {
      throw new Error(
        "canon-register-shape: `canonRegister` is not what `canon-register.mjs § canonRegisterAtSha` returns (a "
        + "`slugs` Set and the `sha` that answer is true at). That is the sibling the crossing's caller builds its "
        + "register with — the one that reads a NAMED commit rather than a checkout's HEAD — and naming it here is "
        + "the whole repair a reader needs to make. The carry is only as good as the register behind it, and a "
        + "register this function had to interpret would be a second answer to what canon carries.");
    }
    if (canonRegister.sha !== worldSha) {
      throw new Error(
        `canon-register-sha-mismatch: this crossing folds from world ${String(worldSha).slice(0, 8)} and the canon `
        + `register was read at ${canonRegister.sha.slice(0, 8)}. "Canon does not carry this slug" is only true of the `
        + "world it was asked of, so a register from another checkout would carry marks on evidence about a different "
        + "world. Pass the checkout this crossing's `world_from` names.");
    }
  }

  const w = Number(window);

  // ── THE WINDOW IS CHECKED BEFORE ANYTHING IS READ FROM IT ──────────────────
  const closed = await client.query(
    "SELECT id, status, cleared_at, town_sha FROM windows WHERE id = $1", [w]);
  if (closed.rows.length === 0) {
    throw new Error(`not-a-window: window ${w} is not in the store — a fold cannot file its crossing under a window that does not exist`);
  }
  if (closed.rows[0].status !== "closed") {
    // An OPEN window's docket is still being written. Folding it would publish a
    // half-locked crossing and, worse, would publish it again next crossing when
    // the rest of the docket landed.
    throw new Error(
      `window-not-closed: window ${w} is "${closed.rows[0].status}", not "closed" — the candle has not finished locking `
      + "this docket, so the crossing's own marks are not all in it yet");
  }

  // AND IT MUST BE THE NEWEST CLOSED ONE. `marks.locked_window` is latest-wins
  // and `claims.window_id` is historical, so "the marks locked at window N" is
  // only the crossing's docket while N is the most recent closed window. One
  // window back the two disagree by slug (172: two slugs the claims hold that
  // the marks no longer do, both since re-locked at 177), and folding it would
  // silently omit every slug re-locked since — a shortfall nothing downstream
  // could attribute, because each omitted mark simply is not in the fold.
  const newest = await client.query(
    "SELECT id FROM windows WHERE status = 'closed' ORDER BY id DESC LIMIT 1");
  if (newest.rows.length === 0) {
    throw new Error("no-closed-window: the store holds no closed window, so no docket has been locked to fold");
  }
  if (Number(newest.rows[0].id) !== w) {
    throw new Error(
      `not-newest-closed-window: asked to fold window ${w}, but the newest closed window is ${newest.rows[0].id}. `
      + "`marks.locked_window` is latest-wins while `claims.window_id` is historical, so the docket of an older window "
      + "is no longer recoverable from `marks` — every slug re-locked since would be missing, and nothing downstream "
      + "could tell. If this is a replay of an older crossing, it needs a different reader than this one.");
  }

  const sha = townSha ?? closed.rows[0].town_sha;
  if (!sha) {
    throw new Error(`foldDelta: window ${w} pins no town_sha and none was passed — the stakes are as-of a town commit and there is no "latest"`);
  }

  const { rows } = await client.query(
    `SELECT ${MARK_COLUMNS} FROM marks WHERE locked_window = $1 ORDER BY slug`, [w]);

  // ── HOW BIG THE DOCKET WAS, READ FROM THE DOCKET AND NOT FROM THE ANSWER ────
  //
  // WHY THIS QUERY EXISTS AT ALL. The loud-empty guard
  // (`src/store-writedown.mjs § starvingCheck`) has to tell two states apart:
  // NOBODY CLAIMED (lawful — a quiet crossing) and THE STORE DID NOT ANSWER (the
  // disagreement it exists to catch). Its own header forbids it firing on the
  // first. Before this line it had no way to see the difference: it was handed
  // `marks` and inferred emptiness from `marks.length === 0`, and under the
  // delta contract the OFFERED set IS the docket, so both states arrived as the
  // same value. Measured on prod 2026-09-09: 6 of the 30 closed windows ever
  // (151, 156, 157, 158, 165, 167 — one in five) had an empty docket, so one
  // crossing in five refused with `store-starving` and published nothing.
  //
  // WHY `claims` AND NOT `rows.length`. `rows.length` is the same array the
  // guard already holds. A guard whose two inputs are one read cannot disagree
  // with itself, which is the exact defect its own header names ("a guard that
  // asked the same array twice would be a check that cannot disagree with
  // itself"). So the size comes from the OTHER table: `claims`, which the
  // clearing sets to `locked` in one step and materializes into `marks` in a
  // second (`clearing-job.mjs § materializeClaims`). A materialization that
  // wrote nothing shows here as a docket with rows and a mark read with none —
  // and that is the state the guard must still refuse.
  //
  // THIS IS THE RULING'S OWN DEFINITION OF THE DOCKET, recovered. The ruling
  // names `claims WHERE window_id = <closed> AND status = 'locked'`; this file
  // reads `marks` for the CONTENT, for the reasons in the header above, and now
  // reads `claims` for the SIZE. Two questions, two pens, one window.
  //
  // MEASURED BEFORE IT WAS WRITTEN, because a size that can lawfully exceed the
  // mark read would be a new false refusal. Read-only against prod, all 30
  // closed windows:
  //
  //   · the two agree on EMPTINESS on 30 of 30 — the same six ids by either read
  //   · zero windows have locked claims and no mark rows (the false-refusal shape)
  //   · windows 173–179: zero locked-claim slugs with no `marks` row at all
  //   · they differ in SIZE on the older windows (150: 831 vs 820; 172: 118 vs
  //     116), which is `marks.locked_window` being latest-wins — and this
  //     function refuses any window but the newest closed one, where the two
  //     coincide (176: 4·4, 177: 33·33, 178: 1·1, 179: 3·3).
  const docket = await client.query(
    "SELECT count(*)::int AS n FROM claims WHERE window_id = $1 AND status = 'locked'", [w]);
  const docketClaims = docket.rows[0].n;

  // ── THE SECOND TERM: EVERY STANDING MARK CANON DOES NOT CARRY ──────────────
  //
  // Read through the NOTARY'S OWN two pieces, so the 03:20 listing and the 17:45
  // carry cannot come to disagree about what the class is. `canonLockFindings` is
  // handed no escrow map on purpose: this is the canon-absent question only, and
  // the escrow class has a different repair (a stake, not a write).
  //
  // THE DEDUP IS NOT COSMETIC. Every mark the candle just locked is ALSO absent
  // from canon at `world_from` — the settlement's push lands three to four
  // minutes AFTER the clear, seven crossings measured, which is the whole reason
  // the lock-time refusal was withdrawn (`canon-register.mjs`, the ordering
  // section). So on an ordinary crossing the absent set CONTAINS this window's
  // whole docket, and without the dedup every mark would be offered twice.
  //
  // THE SECOND READ EXISTS BECAUSE `STANDING_SELECT` IS THE NOTARY'S SHAPE, NOT
  // THE FOLD'S: it carries the claim's evidence and not `body`, `geometry` or
  // `data`, and `renderRecord` needs all three. So the slugs come from the
  // judgement and the BYTES come from `MARK_COLUMNS`, the same columns the docket
  // read uses — one renderer, one column list, two selectors that agree by
  // construction.
  let carriedSlugs = [];
  let carriedRows = [];
  let skippedNoHousehold = [];
  // § THE THIRD TERM (WLD-88): the withdrawals canon still owes, and the
  // predicate's whole answer, which the carry below must not write back.
  const withdrawals = [];
  const withdrawnSkippedNoHousehold = [];
  const withdrawnDeferred = [];
  const retireOnly = [];
  if (canonRegister) {
    const docketSlugs = new Set(rows.map((r) => r.slug));
    const owed = await client.query(WITHDRAWN_OWED_SELECT);
    const withdrawnLatest = new Set(owed.rows.map((r) => r.slug));
    for (const r of owed.rows) {
      if (docketSlugs.has(r.slug)) { withdrawnDeferred.push(r.slug); continue; }
      // the file has left canon and the row still stands: the retirement is owed
      if (!canonRegister.slugs.has(r.slug)) { retireOnly.push(r.slug); continue; }
      if (!r.household) { withdrawnSkippedNoHousehold.push(r.slug); continue; }
      withdrawals.push({
        slug: r.slug, by: r.owner, household: r.household,
        act: Number(r.act_id), crossing: r.crossing === null || r.crossing === undefined ? null : Number(r.crossing),
      });
    }

    const standing = await client.query(STANDING_SELECT);
    const { absent } = canonLockFindings(standing.rows, canonRegister);
    const candidates = absent.map((r) => r.slug)
      .filter((s) => !docketSlugs.has(s) && !withdrawnLatest.has(s)).sort();
    if (candidates.length) {
      const carried = await client.query(
        `SELECT ${MARK_COLUMNS} FROM marks WHERE slug = ANY($1::text[]) ORDER BY slug`, [candidates]);
      // A slug the judgement named and the column read cannot produce is a store
      // disagreeing with itself between two statements of one crossing. It is not
      // a thing to carry quietly at a smaller count: the receipt would say
      // `carried_absent 2` over one written mark and nothing downstream could
      // attribute the gap. Checked BEFORE the household filter below, so a row
      // that vanished and a row that was skipped stay two different findings.
      if (carried.rows.length !== candidates.length) {
        const got = new Set(carried.rows.map((r) => r.slug));
        throw new Error(
          `carried-mark-vanished: the canon-absent read named ${candidates.length} slug(s) to carry and the mark `
          + `read returned ${carried.rows.length} — missing ${candidates.filter((s) => !got.has(s)).join(", ")}. `
          + "Two reads of `marks` in one crossing disagreed about which rows exist.");
      }

      // ── A CARRIED CANDIDATE WITH NO HOUSEHOLD IS NAMED AND SKIPPED ─────────
      //                                            (reviewer, 2026-09-12)
      //
      // `marks.household` is NULLABLE (`world2/schema/001_tables.sql`), and
      // `src/store-writedown.mjs § normalizeMark` refuses the WHOLE fold input
      // with `mark-without-household` when it meets one. The docket never meets
      // it — the door composes a household on every path that locks a claim — but
      // THIS term draws from the whole standing corpus, so a single canon-absent
      // standing row with a null household would have refused every crossing in
      // the town until somebody edited the store by hand.
      //
      // Skipped, not carried, and NAMED: a silent skip is how a mark stays lost
      // for another three weeks, which is the defect this whole term exists to
      // end. The notary goes on listing it at 03:20, which is the right place for
      // a row that needs a person.
      //
      // The test is FALSY, not null-only: an empty-string household resolves to a
      // sketchbook name of nothing, and `?? null` would have let it through.
      for (const r of carried.rows) {
        if (!r.household) { skippedNoHousehold.push(r.slug); continue; }
        carriedRows.push(r);
      }
      carriedSlugs = carriedRows.map((r) => r.slug);   // the query ordered by slug already
    }
  }

  const stakes = await stakesFromStore(client, { townSha: sha });

  return {
    // THE SELECTOR, SAID BY THE FUNCTION THAT DID THE SELECTING. It used to be
    // assembled by `fold-input-cli.mjs`, which knew `by`, `window` and `entry`
    // but could not know `docket_claims` without running this query a second time.
    // A caller re-deriving a callee's fact is two answers to one question, which
    // is the hazard this file's header keeps `foldDelta` single for.
    selection: {
      by: "docket",
      window: w,
      entry: "fold-delta.mjs § foldDelta",
      // THE SIZE OF THE DOCKET THIS CROSSING FOLDED, and the guard's third
      // input. On the receipt beside `marks` (what the mark read returned), so
      // `docket_claims: 33, marks: 0` reads as a materialization that did not
      // happen and `docket_claims: 0, marks: 0` reads as a town where nobody
      // claimed — two sentences that were one number until this field existed.
      //
      // THE NAME SAYS WHICH TABLE, and that is the whole of it. This field was
      // first written as `docket_rows`, which is what you call a number when you
      // have not decided where it comes from — and the only thing that makes it
      // worth putting on a receipt is that it comes from `claims` and not from
      // the mark array beside it. A keeper reading `docket_rows: 0, marks: 0`
      // cannot tell a second read from a restatement of the first; reading
      // `docket_claims: 0, marks: 0` they can. Renamed 2026-09-09, before any
      // receipt carrying the old name reached a history file.
      docket_claims: docketClaims,
      // WHAT THIS CROSSING SWEPT UP THAT ITS OWN DOCKET DID NOT NAME, and why
      // the count alone would not do. A keeper reading `docket_claims: 7,
      // marks: 9` sees a fold that offered more than its docket and has no way
      // to tell a widened selector from a repair; reading `carried_absent:
      // { count: 2, slugs: [...] }` beside it they can name both marks.
      //
      // `checked` IS THE FIELD THAT KEEPS A ZERO HONEST. A crossing run with no
      // `--world-repo` carries nothing and a crossing where canon carries
      // everything carries nothing, and those are different states: the first
      // never looked. Without this the notary's `canon_absent` could climb for
      // weeks under a receipt reading `carried_absent: 0` on every crossing —
      // the same "ran and found nothing" versus "did not run" distinction the
      // notary's own history line exists for.
      //
      // `canon_sha` names the state the absence was judged at, from the register
      // and never from `world_sha` beside it, even though the two are checked
      // equal above. One stamp, one source: a field copied from its neighbour
      // stops being evidence the moment the check between them is edited.
      //
      // `skipped_no_household` is the term beside it, present and EMPTY on an
      // ordinary crossing. A field that appeared only on the bad crossings is a
      // field whose absence starts meaning "fine" — the same rule `note: null`
      // keeps. A row here needs a person: nothing downstream can invent a
      // household, and the notary goes on listing it at 03:20 until one does.
      carried_absent: {
        checked: Boolean(canonRegister),
        count: carriedSlugs.length,
        slugs: carriedSlugs,
        skipped_no_household: skippedNoHousehold,
        canon_sha: canonRegister ? canonRegister.sha : null,
      },
      // THE THIRD TERM (WLD-88). `checked: false` with no register, as the
      // carry says it, because "owed nothing" and "never looked" differ.
      withdrawn_owed: {
        checked: Boolean(canonRegister),
        count: withdrawals.length,
        slugs: withdrawals.map((w) => w.slug),
        acts: withdrawals.map((w) => ({ slug: w.slug, act: w.act, crossing: w.crossing })),
        deferred_to_docket: withdrawnDeferred,
        retire_only: retireOnly,
        skipped_no_household: withdrawnSkippedNoHousehold,
        canon_sha: canonRegister ? canonRegister.sha : null,
      },
      // `note: null` is not decoration. There is one selector now and no
      // fallback, so nothing ever fills this — and that is exactly when a field
      // goes missing and its absence starts meaning "fine". An empty channel is
      // named, the same rule the receipt composer keeps for its own.
      note: null,
    },
    // THE DOCKET FIRST, THE CARRY AFTER, and not re-sorted into one list. The
    // order is the structure: a keeper scrolling the fold sees this crossing's
    // own window, then the rows it swept up behind it, in the same shape
    // `written_by_locked_window` reports downstream.
    marks: [...rows, ...carriedRows].map((r) => ({
      slug: r.slug,
      kind: r.kind,
      by: r.owner,
      household: r.household,
      locked_window: r.locked_window,
      status: r.status,
      // THE PROVENANCE MARKER, reported and never used as a filter (the
      // conductor's ruling of 19:5x: `founder_commit` is present on 142 rows and
      // covers all five of the-town's docket marks, but filtering on it would be
      // a second selector arguing with the docket).
      founder_commit: r.data?.founder_commit ?? null,
      // The bytes, the record they came from, and the frame its numbers are in
      // (`mark-render.mjs § renderedMark`). The write-down frames a world-framed
      // record landing at a nested frozen path; bytes alone cannot be framed.
      ...renderedMark(r),
    })),
    // THE WITHDRAWALS CANON OWES (§ THE THIRD TERM): removals, never marks.
    withdrawals: withdrawals.map(({ slug, by, household }) => ({ slug, by, household })),
    stakes,
    as_of: { window: w, town_sha: sha, world_sha: worldSha },
  };
}
