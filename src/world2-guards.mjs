// world2-guards.mjs — B1: `world2/tools/guard-reads.mjs`, WIRED INTO THE DOORS.
//
// WHY THIS FILE EXISTS (runbook § 4 B1, quoted):
//
//   "`world2/tools/guard-reads.mjs` is merged, tested (falsifier-guard-equality.mjs,
//    G1–G6 green, seven injected faults each firing) — AND IMPORTED BY NOTHING.
//    `grep -rn "guard-reads" src/` returns zero hits. It is the split-brain gate,
//    finished and unwired."
//
// This module is the wire. It is the ONLY thing in `src/` that imports the port,
// so the port keeps its own law — "pure over rows and a pg client, nothing from
// `src/` is imported" — and the office keeps one place where the flag is read,
// one place where the household spelling is resolved, and one place where an
// unreachable guard turns into a refusal.
//
// ── THE FLAG IS READ, NOT MERELY SET (the flip's own discipline) ─────────────
//
// The runbook's §1 sentence about the C-series governs this lane too: "A flag is
// necessary and not sufficient … Every C-step is *wire the call site, then set
// the flag* — two things, and the receipt must prove both." So `W2_GUARDS=1` is
// read at each guard, through `guardsFlipped()`, and the receipt for this lane
// is the same shape as `penFor`'s: a probe that shows the door taking the other
// branch under the flag. A flag nothing reads is a state with no receipt.
//
// It rides `world2Enabled` the way `laneFlipped` does, and for the same reason:
// reading guards out of Postgres with no `WORLD2_PG_URL` is not a configuration,
// it is a crash waiting for the first duplicate slug.
//
// ── AN UNREACHABLE GUARD REFUSES. IT NEVER PERMITS. ─────────────────────────
//
// D2's ruling is about the pen — "the office's record cannot be reached — nothing
// was written, and nothing was lost" — and the same sentence is the right answer
// here for a sharper reason, which the port's own README states:
//
//   "the LIVE tier reads and this one PERMITS. A read tier that drops a row
//    answers with a number nobody can check; a guard that drops a row lets a
//    duplicate slug or a fourth parcel through, and the receipt for that arrives
//    at the next settlement."
//
// So there is NO silent fall-back to the 1.0 guard when the port cannot answer.
// A fall-back would be defensible on the runbook's own ROLLBACK sentence ("the
// 1.0 guards are still correct while the reverse mirror holds") — and it would
// still be wrong, because it would make the flip's failure mode INVISIBLE: the
// office would quietly validate against sqlite while every other receipt in the
// lane said Postgres. That is the split brain with a switch on it, wearing a
// fallback's coat. Rollback here is REMOVING THE FLAG, deliberately, by a hand
// that knows it did so — never a branch this file takes on its own.
//
// ── THE HOUSEHOLD SPELLING, WHICH IS THE SEAM THAT BITES ────────────────────
//
// 1.0's guards are scoped by the household NAME (`resolvedWorldHousehold(key)`,
// the office key's own word — 'darko'). `claims.household` holds the RESOLVED KEY
// ('gh:67605380', 'solo:the-town'). `guard-reads.mjs` says this out loud in
// `DISCLOSURES.two_household_spellings`, and it is not cosmetic: a guard scoped
// by the wrong spelling reads an EMPTY live layer and then PERMITS EVERYTHING —
// every duplicate slug, every parcel past the cap — with nothing on any page to
// show for it. So every household-scoped read in this file goes through
// `householdKeyFor`, world2-claims.mjs's ONE resolver, inside the same
// transaction that declares `app.household` for 007's row policy. Nothing here
// may reach a household-scoped read any other way.
//
// ── WHAT IS DELIBERATELY NOT WIRED, AND WHY ─────────────────────────────────
//
// `worldForStances` (world-stance.mjs) — declare-stance-on's candidate list — is
// named in the port's table and is NOT wired here. It is 1.0's one CROSS-
// household live read, and the port answers it structurally narrower.
// `DISCLOSURES.cross_household`, verbatim:
//
//   "a cross-household live read (household: null) is NARROWER than 1.0's by
//    exactly the other households' DRAFTS. 007's row policy makes a draft
//    visible only inside a transaction that named its household, and there is no
//    household to name here. 1.0's `worldForStances` deliberately surfaces
//    another household's sketch when it overlaps ground you hold — 'the ONE
//    place a sketch becomes visible to somebody who did not write it', which
//    the-late-welcome asks for. Under 007 that is not narrowable, it is
//    unrepresentable for office_api. WHICH LAW GIVES WAY IS A RULING, AND IT IS
//    NOT THIS PORT'S TO MAKE."
//
// It is not this module's to make either. Wiring it would silently delete
// the-late-welcome — a candidate list that got shorter, with every policy
// working exactly as written. Teed for the founder in the B1 report.

import { world2Enabled } from "./world2-acts.mjs";
import { officeRead } from "./world2-pen.mjs";
import * as port from "../world2/tools/guard-reads.mjs";

/**
 * The guard port could not answer. Carries D2's sentence, because the resident
 * is owed the same truth here as at the pen: nothing happened, and nothing was
 * lost by it.
 */
export class GuardsUnreachableError extends Error {
  constructor(which, cause) {
    super("the office's record cannot be reached — nothing was written, and nothing was lost");
    this.name = "GuardsUnreachableError";
    this.code = 503;
    this.which = which;
    this.hint =
      `this door validates against the office's own record (W2_GUARDS=1), and the ${which} guard could not read it. ` +
      `The door refuses rather than permitting on a guess — a guard that cannot see your neighbours' claims would ` +
      `let a duplicate slug or a parcel past the cap stand, and the receipt for that arrives at the next settlement. ` +
      `Nothing was written; your act is safe to make again.`;
    this.cause = cause;
  }
}

/**
 * Is the read half flipped? `W2_GUARDS=1`, read here and nowhere else.
 *
 * Exactly `"1"` — not truthiness. `W2_GUARDS=0` reading as ON is the class of
 * bug that makes a flag unreadable from the outside, and the roll-call's whole
 * discipline is that what is live can be read off the box.
 */
export function guardsFlipped(env = process.env) {
  if (!world2Enabled(env)) return false;
  return String(env.W2_GUARDS ?? "").trim() === "1";
}

// ── THE ONE SEAM, AND WHY IT IS HERE ────────────────────────────────────────
//
// world-hold.mjs's `deps` won its argument this way and the same one applies:
// "`deps` exist so the ordering can be proven on a hand-built store with no
// world db and no Postgres — the door injects the real ones."
//
// The claim this lane has to prove is a DOOR's behaviour, not a port's: "a
// deliberate duplicate-slug submission is refused at the door with the reason
// named" (runbook §4 B1's third GO). The port's own equality falsifier needs
// Postgres, a world checkout and a scratch database, so it can only ever run on
// the box; the refusal at the door has to be provable anywhere, or it is proven
// once and never again. Hence one swappable reader, restored by the function
// that installed it — the doors above thread nothing, so a caller cannot pass a
// reader in by accident.
let readerOverride = null;

/**
 * Install a stand-in for `officeRead` and return the undo.
 *
 * `test/world2-guard-doors.test.mjs` hands in a hand-built client. Nothing in
 * `src/` calls this.
 */
export function useGuardReader(read) {
  const prev = readerOverride;
  readerOverride = read;
  return () => { readerOverride = prev; };
}

const reading = (fn) => (readerOverride ?? officeRead)(fn);

/** The one place a port throw becomes the door's refusal. */
const refusing = async (which, fn) => {
  try { return await fn(); }
  catch (err) {
    if (err instanceof GuardsUnreachableError) throw err;
    throw new GuardsUnreachableError(which, err);
  }
};

/**
 * Run `fn(client, householdKey)` inside one READ ONLY transaction that has
 * declared the household 007's policy asks about.
 *
 * `name` is 1.0's household NAME; `householdKey` is what `claims.household`
 * holds. Both are handed to `fn` so a read that needs the second spelling (the
 * withdraw acts, whose column carries the FIRST) can have it without resolving
 * twice — `householdKeyFor` is memoised per handle, so the second call is free,
 * but two resolvers is how the spellings came apart in the first place.
 */
async function scoped(name, fn) {
  return reading(async (client) => {
    const { householdKeyFor } = await import("./world2-claims.mjs");
    const key = name == null ? null : await householdKeyFor(client, name);
    if (key != null) await client.query("SELECT set_config('app.household', $1, true)", [key]);
    return fn(client, key);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// GUARD 1 · `liveMarks` / `liveChildrenOf` — the mark door's own live layer
// ═════════════════════════════════════════════════════════════════════════════
//
// Consumers, from the port's table: leave-mark's slug collision, the parcel cap,
// withdraw's stranding check. All three are in `src/world.mjs`, both already
// async, and both read the live layer ONCE and reuse it — so the guard is one
// round trip per declaration, not one per predicate.

/**
 * 1.0's `liveMarks(db, {household})`, answered from `claims` under the flag.
 *
 * `strict: true` is the port's default and is kept: a claim this cannot read as
 * a mark THROWS rather than being skipped, and the throw becomes the refusal
 * above. A skipped row is the permissive direction, and permissive is the one
 * direction a guard may not fail in.
 */
export async function guardedLiveMarks(db, { household = undefined } = {}) {
  if (!guardsFlipped()) {
    const { liveMarks } = await import("./world-journal.mjs");
    return liveMarks(db, { household });
  }
  return refusing("live-marks", async () =>
    scoped(household ?? null, async (client, key) => {
      const { marks } = await port.pgLiveMarks(client, { household: key });
      return marks;
    }));
}

/**
 * 1.0's `liveChildrenOf(db, id, {household})` — withdraw's stranding check.
 *
 * The port filters in JS rather than pushing `data->>'parent_id' = $n` into SQL,
 * "deliberately: the predicate must be the SAME predicate". Nothing here widens
 * that; this is the flag branch and the household resolution, and no more.
 */
export async function guardedLiveChildrenOf(db, id, { household = undefined } = {}) {
  if (!guardsFlipped()) {
    const { liveChildrenOf } = await import("./world-journal.mjs");
    return liveChildrenOf(db, id, { household });
  }
  return refusing("live-children", async () =>
    scoped(household ?? null, async (client, key) => {
      const { children } = await port.pgLiveChildrenOf(client, id, { household: key });
      return children;
    }));
}

// ═════════════════════════════════════════════════════════════════════════════
// GUARD 2 · `draftsForKey` — the signed-in draft overlay
// ═════════════════════════════════════════════════════════════════════════════
//
// THE SKETCHBOOK HALF IS NOT REPLACED, and that is the whole shape of this one.
// 1.0's `draftsForKey` is `gitDelta ∪ replayDrafts(journal)`; the flag swaps the
// SECOND half only. `DISCLOSURES.sketchbook` says why the first cannot be
// swapped: `draft/<household>` "still holds every draft written before the
// single-log flag … A resident with pre-flag sketches sees them in 1.0's answer
// and not in this one." Dropping it would make a resident's existing work vanish
// from their own overlay on the day the guard flipped — which is precisely what
// 1.0's own comment says the union exists to prevent.
//
// `pathFor` and the canon filing are INJECTED, not vendored — the port refuses
// to grow a twin of them ("a guessed path would be worse than a null one: gate A
// refuses a mark filed at the wrong place at the next lint"). This function is
// where the office hands over its own, which is exactly what the equality
// falsifier does, so the shape under test is the shape that runs.

/**
 * 1.0's `draftsForKey(repo, key)`, with the journal half answered from `claims`
 * plus the withdraw acts under the flag.
 *
 * The `log` block keeps meaning what it meant — "what the journal contributes is
 * disclosed in its own `log` block rather than smuggled into a field that
 * already means a commit" — and gains `source`, so a reader can tell which store
 * answered without reading the flag.
 */
export async function guardedDraftsForKey(repo, key) {
  const journal = await import("./world-journal.mjs");
  if (!guardsFlipped()) return journal.draftsForKey(repo, key);

  const branches = await import("./world-branches.mjs");
  const gitDelta = branches.draftDeltaForKey(repo, key);
  if (gitDelta?.error) return gitDelta;

  const name = branches.resolvedWorldHousehold(key);
  let replayed;
  try {
    const state = branches.publishedState(repo).state ?? {};
    const publishedIds = new Set((state.marks ?? []).map((m) => m.id));
    const sha = String(gitDelta.main ?? branches.mainRef(repo));
    const publishedPathOf = journal.filedPathOfAt(repo, sha);
    const canonById = new Map((state.marks ?? []).map((m) => [m.id, m]));
    const publishedMarkOf = (id) => canonById.get(id) ?? null;

    replayed = await refusing("draft-overlay", async () =>
      scoped(name, (client, key2) => port.pgDraftsForKey(client, {
        household: key2,
        // The withdraw acts are scoped by the OTHER spelling — `acts.household`
        // carried the office key's NAME on every row the mirror wrote. The port
        // takes both and joins through `identities`; handing it one would return
        // every added and modified mark and no deleted ones, silently.
        journalHousehold: name,
        publishedIds, publishedPathOf, publishedMarkOf,
        pathFor: journal.pathFor,
      })));
  } catch (e) {
    // 1.0's own answer to an unreadable live layer, kept verbatim in shape: the
    // sketchbook half still answers and the block says what is missing from it.
    // This is NOT the permissive direction — the overlay is a READ a resident
    // sees, not a gate that lets a write through — so the door tells the truth
    // rather than refusing a page.
    return { ...gitDelta, log: { readable: false, source: "acts", reason: String(e?.message ?? e).slice(0, 200) } };
  }

  const byId = new Map();
  for (const m of gitDelta.marks ?? []) if (m.id) byId.set(m.id, m);
  for (const m of replayed.marks) if (m.id) byId.set(m.id, m);
  const marks = [...byId.values()].sort((a, b) => String(a.path).localeCompare(String(b.path)));

  return {
    ...gitDelta,
    exists: gitDelta.exists || marks.length > 0,
    marks,
    counts: {
      added: marks.filter((m) => m.status === "added").length,
      modified: marks.filter((m) => m.status === "modified").length,
      deleted: marks.filter((m) => m.status === "deleted").length,
    },
    log: { readable: true, source: "claims", head: null, marks: replayed.marks.length },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// GUARD 3 · `liveHolder` / `readAttachments` — give/drop/take's holder check
// ═════════════════════════════════════════════════════════════════════════════
//
// `declareHolding` is the PURE ADJUDICATOR — "it takes a db and no key, it is
// tested directly on hand-built stores" — and world-hold.mjs's own header gives
// the reason nothing async may go inside it. So the rows are read HERE and
// handed in, which is the same argument the mirror and the loot shroud already
// won at that door.
//
// The read is NOT household-scoped: `acts` holds holdings for the whole town and
// 1.0's `readAttachments(db)` is the whole record too — "narrowing it to one
// target would change the answer, not just the cost."

/**
 * 1.0's `readAttachments(db)`, answered from `acts` (both eras) under the flag.
 *
 * `strict: true` again, and here it is the sharpest of the three: the port's own
 * refusal text says a skipped holding act "would answer with the WRONG RESIDENT
 * holding a thing, which is the one answer this door exists to get right."
 */
export async function guardedAttachments(db, { until = null } = {}) {
  if (!guardsFlipped()) {
    const { readAttachments } = await import("./dynamic-entities.mjs");
    return readAttachments(db, { until });
  }
  return refusing("holder", async () =>
    reading(async (client) => {
      const { rows } = await port.pgAttachmentsFor(client, { until });
      return rows;
    }));
}

// ═════════════════════════════════════════════════════════════════════════════
// THE HOLD SHELF'S READS · no flag, one source (POS-153)
// ═════════════════════════════════════════════════════════════════════════════
//
// The three functions below are NOT guards. A guard adjudicates a write and is
// allowed a flag while its port is proven; these are plain reads that used to
// open sqlite and now read the record, and Everything Reads the Store says the
// flag is the disease — "one question, one owner". So there is no
// `guardsFlipped()` branch here and no sqlite fallback underneath: a store that
// cannot be reached THROWS, and each of the three callers turns that into the
// answer it has always given for an unreadable record (POS-153 finding 5).
//
// They sit in this file because `reading` and `refusing` do — the read worker's
// road (`officeRead`: one pooled connection, `BEGIN READ ONLY`, released) is
// DEC-4's whole guarantee that a read worker holds no writable handle, and a
// second pool opened beside it would be the fourth copy of a word this office
// already knows four times.
//
// ⚑ `world2Enabled` HERE IS NOT A SOURCE SWITCH. There is no second source to
// switch to. It is the question "is there a record to reach at all" — `pool()`
// builds its pg.Pool from `WORLD2_PG_URL`, so an office with none would spend a
// socket timeout discovering that on every read. `actsQuery` already draws this
// exact line ("`null` means 'not asked'; `[]` means 'asked, and the answer is
// none'"), and every arm of it lands on the same three refusal answers an
// unreachable pool does.

const unconfigured = (which) => {
  if (world2Enabled()) return null;
  return new GuardsUnreachableError(which,
    new Error("WORLD2_PG/WORLD2_PG_URL are unset — this office is not pointed at the record"));
};

/**
 * `readJournal(db, { cls: "holding" })`, from the record. Oldest first.
 *
 * `since` / `until` are crossing bounds, both optional and both pushed only
 * when finite (the port's own § explains why that IS the equality).
 */
export async function storeHoldingRows({ since = null, until = null } = {}) {
  const off = unconfigured("holding");
  if (off) throw off;
  return refusing("holding", async () =>
    reading(async (client) => port.pgHoldingRows(client, { since, until })));
}

/**
 * `readAttachments(db)`, from the record — the whole town's edge, never
 * narrowed, for `pgAttachmentsFor`'s own reason: "narrowing it to one target
 * would change the answer, not just the cost."
 *
 * ⚑ RETURNS THE ARRAY, NOT THE PORT'S ENVELOPE. `readAttachments` answers a
 * bare array and `pgAttachmentsFor` answers `{ rows, refusals, eras }`; handing
 * the envelope to `holdingsOf` would throw inside a caller whose catch answers
 * `[]`, so "you are holding nothing" would ship green. The unwrap is here, once,
 * rather than at each of the three call sites.
 *
 * `guardedAttachments` above still carries its flag: it is the WRITE guard, its
 * port is row 29 of the reader inventory and its flip is not this lane's. Both
 * call the same `pgAttachmentsFor` underneath, so there is one answer with two
 * doors to it, and the doors collapse when row 29 lands.
 */
export async function storeAttachmentRows({ until = null } = {}) {
  const off = unconfigured("holder");
  if (off) throw off;
  return refusing("holder", async () =>
    reading(async (client) => {
      const { rows } = await port.pgAttachmentsFor(client, { until });
      return rows;
    }));
}

/** What the doors say about the read half, for the status surfaces. */
export function guardStatus(env = process.env) {
  return { flipped: guardsFlipped(env), flag: "W2_GUARDS", source: guardsFlipped(env) ? "postgres" : "sqlite" };
}
