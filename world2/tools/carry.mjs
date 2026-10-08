// carry.mjs — MOVING A MARK CARRIES YOUR HOUSEHOLD'S MARKS; OTHER HOUSEHOLDS'
// MARKS NEVER MOVE. POS-441 · postmark#2458 · ruled by Darko 2026-10-07:
//
//   moving a mark carries the marks inside it that belong to the same household;
//   they keep their place relative to it. Another household's marks never move:
//   they keep their absolute place and are re-parented by geometry. "That should
//   just always be the default rule."
//
// It replaces the move guard (src/world-move-guard.mjs, deleted), which refused
// any move of a mark with anything inside it. The design note is
// Starstory docs/2026-10-07/rail/POS-441/DESIGN.md; Darko agreed its five
// proposed answers the same day.
//
// ── WHY THE STORE HAS TO WRITE IT ────────────────────────────────────────────
//
// The store keeps world coordinates (`marks.geometry`) and composes no frames,
// so nothing rides in the store unless a writer moves it. Before this, a frame
// parent's move moved its children in the git printout only (a nested file's
// numbers are an offset), and marks-ingest skipped them because their files
// never changed — store and git would split on the first move the guard let
// through. So the carry is a STORE write, decided in the clearing's own
// transaction, and the printout follows it.
//
// ── WHO RIDES ────────────────────────────────────────────────────────────────
//
// A positioned (sited or parcel) mark rides a moving mark when BOTH:
//   · it stands inside it — the mover is in its containment chain (the standing
//     walk's own `containmentParentOf`, asked of the store's pre-state), OR it is
//     filed inside it (its `_parentMarkId` chain, the 08-25 directory edge the
//     printout composes its numbers against: "your own household's marks ride
//     your frame", LOGOS/edit-law.md § Amend); and
//   · its household is the mover's, by the store's one household resolver
//     (`houseOf`, materialize.mjs § liveHouseOfVia) — never a spelling compare.
// A chain through another household's mark still counts (Q3): my lamp in a
// neighbour's house on my parcel rides, and the house stays. A predicate has no
// ground; it continues its parent wherever it goes and is never written here.
//
// A rider that cannot move makes the whole move refuse (atomic; Q4): one with its
// own claim waiting in this window, one with no position to translate.
//
// PURE. Rows in, a plan out — no store, no clock — so the decision is falsifiable
// without a database. The clearing job does the reading and the writing.

import { recordOf, containmentParentOf, worldRootOf, rankCandidates } from "./standing.mjs";

const POSITIONED = new Set(["sited", "parcel"]);
const isPoint = (p) => !!p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y));

/** Did the mark's position move, and by how much? null for no move (words only, or extent only). */
export function moveOf(prior, next) {
  if (!isPoint(prior?.at) || !isPoint(next?.at)) return null;
  const dx = Number(next.at.x) - Number(prior.at.x), dy = Number(next.at.y) - Number(prior.at.y);
  return dx === 0 && dy === 0 ? null : { dx, dy };
}

/** A geometry translated by (dx, dy): `at` and every ring point move; `extent` is a size and never does. */
export function translated(geometry, { dx, dy }) {
  const g = { ...geometry };
  if (isPoint(g.at)) g.at = { x: Number(g.at.x) + dx, y: Number(g.at.y) + dy };
  if (Array.isArray(g.points)) g.points = g.points.map((p) => (Array.isArray(p)
    ? [Number(p[0]) + dx, Number(p[1]) + dy, ...p.slice(2)]
    : { ...p, x: Number(p.x) + dx, y: Number(p.y) + dy }));
  return g;
}

/**
 * THE PLAN.
 *
 * `rows`    the STANDING `marks` rows (id, slug, kind, owner, household, geometry, parent, data);
 * `movers`  [{ claimId, slug, next }] — amend claims of standing marks, `next` the claim's geometry;
 * `waiting` the slugs that have their own pending claim in this window;
 * `houseOf` a stored household spelling → the house's live key (identity when absent).
 *
 * Returns Map claimId → { slug, dx, dy, riders: [{ row, slug, owner, from, to, geometry }],
 * stayed: [{ slug, household }], stuck: [{ slug, why }] }. A mover whose position
 * did not change is absent: nothing rides a words-only amend.
 */
export function carryPlan({ rows, movers, waiting = new Set(), houseOf = null }) {
  const out = new Map();
  const moving = movers
    .map((m) => ({ ...m, row: rows.find((r) => r.slug === m.slug) ?? null }))
    .map((m) => ({ ...m, move: m.row ? moveOf(m.row.geometry, m.next) : null }))
    .filter((m) => m.move);
  if (!moving.length) return out;

  const house = (cred) => (typeof houseOf === "function" ? houseOf(cred) ?? cred : cred);
  const records = rows.map(recordOf);
  const bySlug = new Map();
  for (const [i, r] of records.entries()) if (!bySlug.has(r.slug)) bySlug.set(r.slug, { rec: r, row: rows[i] });

  // The containment answer, once, as the standing walk gives it (the same
  // function, the same ranked candidates).
  const root = worldRootOf(records);
  const ranked = rankCandidates(records);
  const geoParent = new Map();
  for (const r of records) if (POSITIONED.has(r.kind) && r.at) geoParent.set(r.slug, containmentParentOf(r, records, root, ranked));
  // UP ONE STEP, BOTH WAYS. A mark rides if the mover is above it by any path
  // that mixes the two edges: the lamp filed in the house rides when the house
  // rides, whether the house rides because it stands inside the parcel or
  // because it is filed there — the printout composes the lamp against the
  // house either way, so the store must move it too.
  const geoUp = (s) => geoParent.get(s) ?? null;
  const fileUp = (s) => bySlug.get(s)?.rec._parentMarkId ?? null;
  const under = (slug, target) => {
    const seen = new Set([slug]), stack = [slug];
    while (stack.length) {
      const s = stack.pop();
      for (const p of [geoUp(s), fileUp(s)]) {
        if (p == null || seen.has(p)) continue;
        if (p === target) return true;
        seen.add(p); stack.push(p);
      }
    }
    return false;
  };

  for (const m of moving) {
    const moverHouse = house(recordOf(m.row)._cred);
    const riders = [], stayed = [], stuck = [];
    for (const { rec, row } of bySlug.values()) {
      if (rec.slug === m.slug || !POSITIONED.has(rec.kind)) continue;
      if (!under(rec.slug, m.slug)) continue;
      if (house(rec._cred) !== moverHouse) { stayed.push({ slug: rec.slug, household: house(rec._cred) }); continue; }
      if (waiting.has(rec.slug)) { stuck.push({ slug: rec.slug, why: "it has its own claim waiting in this window" }); continue; }
      if (!isPoint(row.geometry?.at)) { stuck.push({ slug: rec.slug, why: "it carries no position to move" }); continue; }
      const geometry = translated(row.geometry, m.move);
      riders.push({ row, slug: rec.slug, owner: row.owner, from: { x: Number(row.geometry.at.x), y: Number(row.geometry.at.y) }, to: geometry.at, geometry });
    }
    const bySlugName = (a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
    out.set(String(m.claimId), { slug: m.slug, dx: m.move.dx, dy: m.move.dy, riders: riders.sort(bySlugName), stayed: stayed.sort(bySlugName), stuck: stuck.sort(bySlugName) });
  }
  return out;
}

/**
 * The receipt sentence a resident reads, in the clearing's past tense or the
 * door's future one. "moved X and 24 of your marks; 6 marks of other households
 * stayed where they were (the town ×4, …)".
 */
export function carrySentence(plan, { tense = "past" } = {}) {
  const n = plan.riders.length, s = plan.stayed.length;
  const moved = tense === "past" ? "moved" : "moves";
  const stay = s === 1
    ? (tense === "past" ? "stayed where it was" : "stays where it is")
    : (tense === "past" ? "stayed where they were" : "stay where they are");
  const of = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const tally = new Map();
  for (const x of plan.stayed) tally.set(x.household, (tally.get(x.household) ?? 0) + 1);
  const who = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([h, c]) => `${h} ×${c}`).join(", ");
  return `${moved} ${plan.slug}${n ? ` and ${of(n, "mark")} of your household's` : ""}`
    + (s ? `; ${of(s, "mark")} of other households ${stay} (${who})` : "");
}
