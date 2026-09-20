// fold-input.mjs — everything the settlement's fold reads, from the store alone.
//
// G1: "the settlement's fold reads the store instead of the household draft
// branches, and writes the world repo as its snapshot" (the cutover plan of
// record, 2026-09-08). `deploy/settlement-auto.sh` gets the same two things from
// two git checkouts today:
//
//   the marks   from `refs/remotes/origin/draft/*`, written by the drain
//               (`settlement-sweep.mjs:328`, `:370`)
//   the stakes  from `node tools/world-stake.mjs --escrow --json` run inside a
//               FROZEN CLONE OF THE TOWN at a pinned sha
//               (`settlement-auto.sh:163` pins it, `:287` runs it)
//
// This is the one entry point that answers both from the store, so lane 3's
// chain rewrite calls one function and drops both checkouts.
//
// ── IT REFUSES RATHER THAN GUESSES, AND EACH REFUSAL NAMES ITS OWN CAUSE ─────
//
// A fold that runs on a store which cannot answer is the 2026-08-26 starving
// crossing in a new dress: a quiet green over an empty read. `settlement-auto.sh
// § WHAT CHANGED` states the rule this file obeys ("A sweep that finds no
// candidates at all … is not a quiet day, it is a starving crossing … The sweep
// now re-derives that question by a different path and REFUSES with the
// reason"). So every precondition below throws with the sha or window it wanted
// and the sentence for why, and none of them returns an empty answer.

import { standingMarkRows, renderedMark } from "./mark-render.mjs";

/**
 * The fold's stake rows — `{ tick, holder, mark, n, weight }` — from the store.
 *
 * EQUAL, ROW FOR ROW AND IN ORDER, to `world-stake.mjs --escrow --json` run in a
 * checkout of the town at `townSha`. That equality is the falsifier
 * (`test/world2-fold-input.test.mjs`) and it is what the escrow ruling rests on;
 * it is not an approximation of the town's number, it is the same number read
 * from a projection of the town's own fold.
 *
 * THE ARITHMETIC IS THE TOWN'S, RESTATED HERE FOR ONE REASON: the projection
 * stores the POSITION and the DIAL, not the weight, because weight is read-side
 * and a dial change must not be a data migration (see `014_escrow_projection.sql`).
 * So the read does the last step — and it does it from columns the town's own
 * `currentHouseholdOf` filled, so the only thing that could drift is this loop,
 * which is why the test compares against the town and not against a fixture.
 *
 *   weight = n + (k if this is the household's FIRST position on this mark and
 *                 the household is not the mark author's own)
 *
 * `tick: 0` is the town's own constant on every row it emits
 * (`world-stake.mjs § deriveWorldMarkWeights`); it is carried, not invented.
 */
export async function stakesFromStore(client, { townSha } = {}) {
  if (!townSha) throw new Error("stakesFromStore: no townSha — the stakes are as-of a town commit and there is no 'latest'");

  const { rows } = await client.query(
    `SELECT mark, holder, household, own_household, n, weight_k
       FROM escrow_projection WHERE town_sha = $1`, [townSha]);

  if (rows.length === 0) {
    throw new Error(`stakesFromStore: no escrow_projection rows for town ${townSha} — the town has not been ingested at this sha, and an empty stake set is indistinguishable from a town where nobody stakes. Run stamp-ingest.mjs against a checkout at this sha.`);
  }
  const ks = new Set(rows.map((r) => Number(r.weight_k)));
  if (ks.size !== 1) {
    throw new Error(`stakesFromStore: escrow_projection rows for town ${townSha} carry ${ks.size} different weight_k values (${[...ks].sort().join(", ")}) — one sha has one dial, so this is a torn ingest and picking one would be inventing an arithmetic`);
  }
  const k = [...ks][0];

  // THE TOWN'S OWN ORDER, and it is load-bearing because the fold consumes an
  // ARRAY and because the FIRST position of a household in the walk is the one
  // that draws k. `deriveWorldMarkWeights` walks
  // `[...state.positions.entries()].sort()` — a plain lexicographic sort of
  // `<mark>|<holder>` — groups by mark in the order that walk first sees each
  // one, then emits the groups sorted by `localeCompare` on the mark.
  //
  // ⚑ THE TWO SORTS AGREE ON EVERY ID THIS GRAMMAR ADMITS, MEASURED, and the
  // first draft of this comment claimed otherwise. It said the codepoint walk
  // and a `localeCompare` sort "part company on the first mark id whose
  // codepoint order and locale order differ" — so the flip that replaced the
  // walk with the simpler sort was expected to red, and it reddened NOTHING.
  // Searched afterwards rather than asserted: every ordered pair over the mark-id
  // alphabet (`^[a-z0-9][a-z0-9-]*$`, `MARK_ID_RE`) at length 3, and the
  // hyphen-placement cases a variable-weighting collation is supposed to reorder
  // — zero divergent pairs. So the walk is reproduced because it is the TOWN'S,
  // which is the only thing the equality can rest on, and NOT because a
  // difference is known to exist. `test/world2-fold-input.test.mjs` pins that
  // agreement, so the day a wider alphabet makes it false, something says so
  // instead of the two answers quietly parting.
  const walked = rows
    .map((r) => ({ ...r, key: `${r.mark}|${r.holder}` }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const grouped = new Map();
  for (const r of walked) {
    if (!grouped.has(r.mark)) grouped.set(r.mark, []);
    grouped.get(r.mark).push(r);
  }

  const out = [];
  for (const [mark, positions] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const own = positions[0].own_household;
    const seen = new Set();
    for (const p of positions) {
      const external = p.household !== own;
      const firstForHousehold = external && !seen.has(p.household);
      if (external) seen.add(p.household);
      out.push({
        tick: 0,
        holder: p.holder,
        mark,
        n: Number(p.n),
        weight: Number(p.n) + (firstForHousehold ? k : 0),
      });
    }
  }
  return out;
}

/**
 * The window the fold is folding at, and the shas it is folding against.
 *
 * The OPEN window is the fold's window: `retire-unpublished.mjs` reads it the
 * same way (`SELECT id FROM windows WHERE status='open'`) rather than being
 * passed one, for the reason the retire lane established — a window passed in is
 * a window that can be wrong, and the store already knows which one is open.
 *
 * ── `projection_heads['town']` IS A PROXY, AND HERE IS THE COUPLING IT RESTS ON ──
 *
 * This function never reads `stamp_projection`. It trusts the head row, and
 * `stakesFromStore` then trusts `escrow_projection` at that sha. That is sound
 * ONLY because `stamp-ingest.mjs` is the one pen for all three town projections
 * (`stamp_projection`, `town_roll`, `escrow_projection`) and writes them in ONE
 * transaction, moving `projection_heads['town']` ONCE at the end — so a head at
 * sha S is a guarantee that every projection carries S, and a head that is absent
 * or behind means none of them do. `014_escrow_projection.sql`'s header states
 * the invariant; this is the reader that depends on it. If a second pen ever
 * writes one projection without the others, or the head moves before the last
 * `INSERT`, the proxy lies and the fold reads stakes for a sha the stamps do not
 * carry — and nothing here would refuse. (Reviewer's repair 5, 2026-09-08.)
 */
async function asOf(client) {
  const { rows } = await client.query(
    "SELECT id, status FROM windows WHERE status = 'open' ORDER BY id DESC");
  if (rows.length === 0) {
    throw new Error("fold-input: no open window — a fold with no window to file its crossing under cannot say when it happened, and the last closed window is not the answer (it has already cleared)");
  }
  if (rows.length > 1) {
    throw new Error(`fold-input: ${rows.length} open windows (${rows.map((r) => r.id).join(", ")}) — the candle holds one, so this is a store that cannot say which crossing is now`);
  }
  const { rows: head } = await client.query(
    "SELECT sha, ingested_at FROM projection_heads WHERE repo = 'town'");
  if (head.length === 0) {
    throw new Error("fold-input: projection_heads has no 'town' row — the store has never ingested the town, so it cannot name the sha its stakes are as-of");
  }
  return { window: rows[0].id, town_sha: head[0].sha, town_ingested_at: head[0].ingested_at };
}

/**
 * `{ marks, stakes, as_of }` — everything lane 3's chain needs, from the store.
 *
 * `marks` carries the rendered bytes beside the row, not instead of it: the
 * sweep files a record at a PATH and the path is not in the bytes, so a caller
 * handed bytes alone would have to re-derive the filing and that is the one
 * thing `WORLD/filing-freeze.json` forbids guessing at. `slug`, `kind` and
 * `household` ride so the caller can find the file the way
 * `world-drain.mjs § findMarkPath` does — by the record's own `by:` and its
 * leaf — rather than computing a new one.
 *
 * `townSha` may be supplied to fold against a sha other than the ingested head;
 * it is refused if the projection does not carry it, rather than falling back.
 *
 * `worldSha` IS REQUIRED AND IS THE CALLER'S, because the store does not know
 * it and must not appear to. The fold's world sha is the settlement clone's
 * `main` at the moment the crossing starts (`settlement-auto.sh` records it as
 * `world_from`); `projection_heads['world-law']` is a LAW sha and naming it here
 * would put a plausible wrong answer in a receipt. Returning `world_sha: null`
 * would be worse still — a field written that nothing fills, which is the defect
 * the retire lane shipped twice on 2026-09-08 and had to close both times.
 */
export async function foldInputFromStore(client, { townSha = null, worldSha = null } = {}) {
  if (!worldSha) {
    throw new Error("foldInputFromStore: no worldSha — the store does not know which world commit this crossing starts from (that is the settlement clone's `main`, the chain's `world_from`), and `projection_heads['world-law']` is a LAW sha, not this one. Pass the caller's; do not let the receipt carry a blank or a plausible substitute.");
  }
  const at = await asOf(client);
  const sha = townSha ?? at.town_sha;
  if (townSha && townSha !== at.town_sha) {
    const { rows } = await client.query(
      "SELECT 1 FROM escrow_projection WHERE town_sha = $1 LIMIT 1", [townSha]);
    if (rows.length === 0) {
      throw new Error(`fold-input: asked to fold at town ${townSha}, but the projection only carries ${at.town_sha} — folding at the head instead would silently answer a different question`);
    }
  }

  const rows = await standingMarkRows(client);
  if (rows.length === 0) {
    throw new Error("fold-input: no standing marks — an empty world is a starving crossing, not a quiet one (settlement-auto.sh § the loud-empty guard)");
  }
  const stakes = await stakesFromStore(client, { townSha: sha });

  return {
    marks: rows.map((r) => ({
      slug: r.slug,
      kind: r.kind,
      by: r.owner,
      household: r.household,
      locked_window: r.locked_window,
      // The bytes, the record and body they came from, and the frame the
      // record's numbers are in — see `mark-render.mjs § renderedMark`.
      ...renderedMark(r),
    })),
    stakes,
    as_of: { window: at.window, town_sha: sha, world_sha: worldSha },
  };
}
