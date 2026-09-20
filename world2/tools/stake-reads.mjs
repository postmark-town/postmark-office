// stake-reads.mjs — THE ESCROW DOOR'S PORT. `/world2/stake` answers `GET
// /world/stake` out of `escrow_projection` instead of out of the town clone.
//
// ── WHAT 1.0 DOES, AND WHERE IT READS ───────────────────────────────────────
//
// `src/world-stake.mjs § worldStakeRead` imports the TOWN's own engine live out
// of `TOWN_CLONE/tools/world-stake.mjs`, folds `WHITE_PAGES/stamp-ledger.md`
// into `worldStakeState`, and answers nine fields. Every number it reports is a
// fold of that one ledger file.
//
// `escrow_projection` (migration 014) is that same fold, already derived and
// stored: `escrow-ingest.mjs § deriveEscrow` imports the SAME town functions at
// ingest time and writes one row per OPEN position — `(mark, holder, household,
// own_household, n, weight_k)` at a `town_sha`. So this port does not
// re-implement the ledger grammar; it reads the town's own answer back.
//
// ── THE ARITHMETIC IS THE TOWN'S, QUOTED ────────────────────────────────────
//
// `tools/world-stake.mjs § deriveWorldMarkWeights`, verbatim (the town repo,
// lines 175-185):
//
//     const externalHouseholds = [...group.households].filter((h) => h !== own).length;
//     marks.push({ mark, escrow: group.escrow,
//                  households: group.households.size,
//                  households_external: externalHouseholds,
//                  weight: group.escrow + dial.k * externalHouseholds });
//
// — four quantities, all of them readable off the rows for one mark:
//
//   escrow               Σ n
//   households           |{ household }|            ← INCLUDING the mark's own
//   households_external  |{ household } \ { own }|  ← the set k is paid on
//   weight               escrow + k · households_external
//
// `households` keeps the town's meaning and not the narrower one: the town's own
// comment says so in place ("`households` keeps its old meaning — every unique
// household with escrow here … Reporting less must never mean counting wrong").
// Counting only the external ones here would be a second definition of a word
// the town already defines, which is how `stamps` came to mean weight.
//
// ── WHAT THE STORE CANNOT ANSWER, NAMED ─────────────────────────────────────
//
// Three of 1.0's fields are not here, and each is a fact about a working tree
// rather than about the ledger:
//
//   retirement   `mod.retirementBlocked(TOWN_CLONE, mark, state)` — a town-clone
//                read over the whole ledger state, not a per-mark position.
//   proposed     `forecastForMark` reads `WORLD/world-state.json` at the world
//                clone's `mainRef` (src/world-forecast.mjs:107-114) and folds
//                what the NEXT crossing would make of it. Two clones, no rows.
//   holders[] TIE ORDER
//                1.0 builds `holders` by walking `state.positions` — the stamp
//                ledger's own APPEND order — and then sorts by stamps
//                descending. `Array.prototype.sort` has been stable since
//                ES2019, so two holders with equal stamps come back in the
//                order the LEDGER FILE lists them. `escrow_projection` stores a
//                set of positions and not the file's order (escrow-ingest sorts
//                by `(mark, holder)`), so the tie order is a property of the
//                tree. This port breaks ties by `holder` — deterministic, and
//                DECLARED rather than accidentally inherited from whatever
//                order Postgres returns.
//
// An absent mark answers ZERO, not null, and that is 1.0's own reading:
// `markEscrow` is `state.escrow.get(mark) ?? 0`, and `deriveEscrow` drops a
// closed position because "a closed position is an absence, not a zero". The
// two absences agree on the number. What is NOT zero is a store that cannot
// answer at all — no ingested town head — and that refuses out loud rather than
// reporting an unstaked town.

/** The rows one mark's answer is folded from, at one pinned town sha. */
export const STAKE_ROWS_SQL = `
  SELECT mark, holder, household, own_household, n, weight_k
    FROM escrow_projection WHERE town_sha = $1 AND mark = $2
   ORDER BY holder`;

/** 1.0's own sentence, carried verbatim so the two doors say one thing. */
export const STAKE_NOTE =
  "ledger_weight is own escrow + breadth bonus. The ✦weight in the telling also includes marks inside this one fanning up — see world_investigate.weight_parts.";

/**
 * ONE MARK'S ESCROW, from its `escrow_projection` rows. PURE.
 *
 * Exported and pure because it is the DECISION — the breadth arithmetic and the
 * two absences — and a falsifier that could only reach it through a Postgres
 * would be asserting the fixture rather than the rule.
 *
 * `rows` may be empty: that is a mark nobody stakes, and the answer is a row of
 * zeroes with an empty holder list. `k` cannot be read from an empty set, so it
 * comes back `null` there — a dial with no source, said plainly, rather than the
 * ruled default recorded as if it had been pinned (escrow-ingest's own refusal,
 * one tier up: "a projection may not record a defaulted dial as a pinned one").
 *
 * A TORN INGEST REFUSES. `stakesFromStore` refuses a sha whose rows disagree
 * about `weight_k` because "one sha has one dial, so this is a torn ingest and
 * picking one would be inventing an arithmetic". The same rule holds for one
 * mark's slice of the same sha, so the same refusal is thrown here rather than
 * quietly folding with whichever k came back first.
 */
export function stakeAnswerFrom(rows = [], { mark, townSha = null } = {}) {
  const id = String(mark ?? "").trim();
  if (!id) throw new Error("stakeAnswerFrom: no mark — escrow is always about one mark");

  const ks = new Set(rows.map((r) => Number(r.weight_k)));
  if (ks.size > 1)
    throw new Error(
      `stakeAnswerFrom: escrow_projection rows for ${id} at town ${String(townSha ?? "?").slice(0, 8)} carry ` +
      `${ks.size} different weight_k values (${[...ks].sort((a, b) => a - b).join(", ")}) — one sha has one dial, ` +
      "so this is a torn ingest and picking one would be inventing an arithmetic");
  const k = ks.size === 1 ? [...ks][0] : null;

  // The mark's OWN household, off the rows rather than off the id: the column is
  // `escrow-ingest`'s resolution of `<by>` through the town's DATED registry at
  // the ingested sha, and re-deriving it here from the id would answer with
  // today's registry about a sha from last week.
  const own = rows.find((r) => r.own_household != null)?.own_household ?? null;

  const escrow = rows.reduce((n, r) => n + Number(r.n), 0);
  const households = new Set(rows.map((r) => r.household));
  const externalHouseholds = [...households].filter((h) => h !== own).length;
  const weight = escrow + (k ?? 0) * externalHouseholds;

  // DESCENDING BY STAMPS, then by holder. The second term is this port's own —
  // see § holders[] TIE ORDER above; without it the order would be whatever the
  // query planner handed back, which is an order nobody declared.
  const holders = rows
    .map((r) => ({ handle: r.holder, stamps: Number(r.n) }))
    .sort((a, b) => b.stamps - a.stamps || a.handle.localeCompare(b.handle));

  return {
    mark: id,
    escrow,
    stamps: escrow,
    ledger_weight: weight,
    breadth: {
      k,
      external_households: externalHouseholds,
      households: households.size,
      bonus: weight - escrow,
    },
    _note: STAKE_NOTE,
    holders,
  };
}
