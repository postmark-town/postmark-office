// harbor-gate.mjs — the arrival ladder's write gate (Keemin-ruled 2026-08-16).
//
// The ruling, verbatim in substance: we overshot what the harbor tier may do.
// An unsettled household — co-signed, standing at the harbor, no white-pages
// address yet — READS everything and keeps exactly one write lane: the
// EPHEMERAL one (speech at the quay, the emission class whose residue
// evaporates). Every durable act — mail, marks, walks, notes, holdings,
// stakes, votes, media, paper pages — waits for settlement through the
// Registrar, in boarded order. Durable participation is the settlement prize,
// and a white-pages presence is never created as a side effect.
//
// DEACTIVATION, NOT DELETION (his words: "we may reactivate it later"):
// HARBOR_WRITES=1 reopens every gated door without a deploy; the capability
// code beneath is untouched. The tier itself is stamped on the KEY at lookup
// (oauth.mjs householdFor sets `harbor: true` when no handle of the household
// stands in the residents index), so a gate is one property check and the
// stamp disappears on its own the moment settlement lands a handle ashore.
//
// The allowed set is the arrival lane plus the ephemeral voice:
//   world_say          — the voice (emissions; hearable to the next settlement, sixty metres from where it stands)
//   request_residency  — adding to the house is arrival machinery
//   declare_household  — so is declaring
//   household_begin    — the berth's bridge (its own door answers harbor
//                        households honestly; the gate must not talk over it)
//   world_walk         — ONLY for a key that boarded as a berth, and only as
//                        that berth's visitor body (POS-739, below)
//
// A VISITOR WALKS AND SAYS (POS-739, Darko 2026-10-22 17:53). A bare berth
// carries no household and no handles, and the second gate below is its own:
// it walks and says, and keeps the arrival lane; every other write is refused
// by name with the visitor's sentence (speaker-standing.mjs § VISITOR_REFUSED).
// A household still at the harbor that boarded as a berth speaks as that
// berth (oauth.mjs § berthLookup), so it walks as that berth too; the walk
// door refuses it walking any resident of its own (world.mjs § walkAct).

// The settlement clause is the declaration door's (declare.mjs § SETTLING_ASHORE,
// POS-70 row 38) — this gate names it, never a copy of it.
import { SETTLING_ASHORE } from "./declare.mjs";
import { VISITOR_REFUSED, berthHandleOf } from "./speaker-standing.mjs";

export const harborWritesOpen = () => process.env.HARBOR_WRITES === "1";

export const HARBOR_ALLOWED = new Set([
  "world_say", "request_residency", "declare_household", "household_begin",
]);

// A visitor's body moves: walk, enter, exit and ride (POS-739; Darko 18:12, "Enter, exit and ride").
export const VISITOR_MOVES = new Set(["world_walk", "world_enter", "world_exit", "world_ride"]);

export const harborGated = (key, verb) =>
  key?.harbor === true && !harborWritesOpen() && !HARBOR_ALLOWED.has(verb)
  && !(VISITOR_MOVES.has(verb) && Boolean(key.berth));

// What a bare berth may do: say and move, and the arrival lane.
export const VISITOR_ALLOWED = new Set([
  "world_say", ...VISITOR_MOVES, "request_residency", "declare_household", "household_begin",
]);

/**
 * The body a moving act stands as (walk, enter, exit, ride), for a key that
 * boarded as a berth: `{ who }`, its visitor body, when it names none or names
 * that one; `{ bounce }` when a household still at the harbor names one of
 * its own residents, whose durable acts wait for settlement; null for every
 * other key, which resolves its resident as it always has.
 */
export function visitorBody(named, key) {
  const body = berthHandleOf(key);
  if (!body) return null;
  if (!named || named === body) return { who: body };
  if (key.harbor === true && !harborWritesOpen()) return { bounce: HARBOR_BOUNCE };
  return null;
}

/** A bare berth (a visitor: no household, no residents) asking for any other write. */
export const visitorGated = (key, verb) =>
  Boolean(key?.berth) && key?.harbor !== true && !(key?.handles?.size > 0) && !VISITOR_ALLOWED.has(verb);

/** The refusal, naming the act refused. `verb` is the dispatched tool or the path. */
export const visitorBounceFor = (verb) => VISITOR_REFUSED(String(verb ?? "").replace(/^world_/, "").replace(/^\//, ""));

export const HARBOR_BOUNCE = {
  code: 403,
  defect: "the harbor is read + ephemeral",
  hint: `read everything, and speak where you stand (a household that boarded as a berth walks as its visitor too) — durable acts (mail, marks, media, papers, stakes) come ashore with settlement: ${SETTLING_ASHORE}. The manifest is public at HARBOR/berths/, and no letter is needed`,
};
