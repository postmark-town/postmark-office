// carry-forecast.mjs — WHAT A MOVE WILL CARRY, said at the door (POS-441).
//
// The carry itself is decided at the clearing, in the window's transaction,
// against the store's pre-state (world2/tools/carry.mjs). The door cannot know
// that state — a housemate may place a mark inside before the window closes —
// so what it says is a FORECAST, labelled as one (R11's courtesy layer: a
// forecast, never a refusal), read from the World the door already serves:
//
//   · inside by geometry — the published fold's own `placementParent` on each
//     mark, walked up (the fold's containment answer; no geometry is computed
//     here, which keeps the 2026-08-22 "a draft costs nothing" ruling whole);
//   · inside by filing — the frozen manifest's directory edge, the one the
//     printout composes a nested file's numbers against;
//   · the household — the fold's `declared_household` (its resolver's answer),
//     falling back to the mark's own `household`.
//
// The sentence is carry.mjs's, so the door and the clearing say one thing in
// two tenses.

import { moveOf, carrySentence } from "../world2/tools/carry.mjs";

const POSITIONED = new Set(["sited", "parcel"]);
const houseOfMark = (m) => m?.declared_household ?? m?.household ?? (m?.id ? `solo:${String(m.id).split("/")[0]}` : null);
const LIST_CAP = 25;

/**
 * `id` the mover; `prior` its standing record (world coordinates); `next` the
 * amend's declaration; `marks` the published fold's marks; `filedParentOf(id)`
 * the frozen filing's parent id or null. Returns null when nothing moves.
 */
export function carryForecast({ id, prior, next, marks, filedParentOf = () => null }) {
  const move = moveOf(prior, next);
  if (!move) return null;
  const byId = new Map(marks.map((m) => [m.id, m]));
  const holds = (start, up) => {
    const seen = new Set([start]);
    for (let p = up(start); p != null && !seen.has(p); p = up(p)) { if (p === id) return true; seen.add(p); }
    return false;
  };
  const geoUp = (m) => byId.get(m)?.placementParent ?? null;
  const moverHouse = houseOfMark(byId.get(id) ?? prior);
  const riders = [], stayed = [];
  for (const m of marks) {
    if (m.id === id || !POSITIONED.has(m.kind) || !m.at) continue;
    if (!holds(m.id, geoUp) && !holds(m.id, filedParentOf)) continue;
    const house = houseOfMark(m);
    if (house === moverHouse) riders.push({ slug: m.id, from: m.at, to: { x: m.at.x + move.dx, y: m.at.y + move.dy } });
    else stayed.push({ slug: m.id, household: house });
  }
  const plan = { slug: id, dx: move.dx, dy: move.dy, riders, stayed };
  return {
    forecast: true,
    dx: move.dx, dy: move.dy,
    moves: riders.length, stays: stayed.length,
    sentence: carrySentence(plan, { tense: "future" }) + " — at the next crossing",
    riders: riders.slice(0, LIST_CAP).map((r) => r.slug),
    stayed: stayed.slice(0, LIST_CAP),
    decided: "the clearing decides the carry against the town as it stands when the window closes; a mark of your household placed inside before then rides too, and the crossing's receipt names every one",
  };
}
