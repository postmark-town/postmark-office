// mists-standing.mjs — which Mists keyframe STANDS (WLD-147).
//
// The world's record may name `withdrawn_from`: the first crossing with NO MISTS AT ALL, from
// which the engine's `mistsAt` answers null (Darko, 2026-11-02 17:06 EST, "full removal for
// mists"). Its schedule then ends with the withdrawal's own keyframe (the front pulled back past
// the border, no veil), so a test that wants "the wall at its fullest" must not take the
// schedule's last keyframe: it takes the last crossing that still stands.
//
// With no `withdrawn_from` (the record the office's pinned world carries today) every answer
// here is the schedule's last keyframe, exactly as the tests read it before.

/** The crossing the record withdraws the Mists from, or Infinity when it names none. */
export const withdrawnFrom = (mists) => (Number.isFinite(mists?.withdrawn_from) ? mists.withdrawn_from : Infinity);

/** The last crossing the Mists still stand: the one before the withdrawal, else the last keyframe's. */
export function lastStandingCrossing(mists) {
  const gone = withdrawnFrom(mists);
  return Number.isFinite(gone) ? gone - 1 : mists.schedule.at(-1).crossing;
}

/** The keyframe in force at the last standing crossing (its `front_m` is the wall at its fullest). */
export function lastStandingKeyframe(mists) {
  const at = lastStandingCrossing(mists);
  return mists.schedule.filter((k) => k.crossing <= at).at(-1);
}

/** The schedule's crossings at which the engine still answers a state: those before the withdrawal. */
export const standingKeyframes = (mists) => mists.schedule.map((k) => k.crossing).filter((c) => c < withdrawnFrom(mists));
