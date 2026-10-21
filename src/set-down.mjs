// set-down.mjs — a berth that comes ashore is set down where it stood (POS-740).
//
// RULED (Darko, 2026-10-21 08:07 and 08:09): "it's strange to teleport residents
// without any warning". A keyless berth speaks from the quay (or the deck), and
// until this file its co-sign left the new resident with no position at all, so
// every door answered the 09-17 Origin (src/groundless.mjs) and the visitor's
// next sentence landed 5.6 km from the people they were talking to (Ash,
// 2026-10-21 03:59Z). Now the co-sign files the new resident's FIRST POSITION:
// one zero-length departure at the berth's place, the ledger's and the store's
// own idiom for "standing here" (tools/ledger-freeze.mjs § the remedy), written
// the way a ground sets its entrant down (world-apex.mjs § landOnEnter):
// `appendJournal(walkEntry(...))` and the kept positions in the same step. Every
// reader then places them by the ordinary movement record, with no fallback:
// say and walk (`residentStandpoint`), presence (`whereIs`), orient, eyes and the
// apex (`standCoords`), and the first walk departs from there. groundless.mjs is
// untouched: a resident with no position history still stands at the Origin.
//
// NEVER OVER A REAL MOVE. The write happens only when the handle has no departure
// on record at all, read as the walk door reads it. A resident who walked, or who
// a ground set down, is never moved, and a second run is a no-op that says so.
//
// NOBODY WALKED HERE. The record is the town's (`declared_by: "the-town"`), and
// its note says so (G2); orient prints that note instead of "where your walk
// arrived" (G5).
//
// NEVER REFUSES THE ACT IT FOLLOWS. The co-sign has founded the house before this
// runs; a set-down that cannot be written answers `{ written: false, why }`, the
// co-sign logs it by name, and the resident stands at the Origin until the hand
// repair (tools/set-down-ashore.mjs) is run for them.

/** Who files the record, and what it says about itself. */
export const SET_DOWN_BY = "the-town";
export const SET_DOWN_NOTE = "set down where the berth stood, at the co-sign";

/**
 * File `handle`'s first position at `place` ({ x, y, mark }), unless the record
 * already holds one for them. Returns `{ written: true, actId, at, mark }`,
 * `{ written: false, why, already? }` or, with `dry`, `{ written: false, would }`.
 * Never throws: every failure is an answer.
 */
export async function setDownWhereItStood({ handle, household = null, place, note = SET_DOWN_NOTE, dry = false }, deps = null) {
  if (!handle || typeof handle !== "string") return { written: false, why: "no handle to set down" };
  const x = Number(place?.x), y = Number(place?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { written: false, why: `no place to set ${handle} down: ${JSON.stringify(place ?? null)}` };
  const at = { x, y };
  const mark = place.mark ?? null;
  let d;
  try { d = deps ?? await setDownDeps(); }
  catch (e) { return { written: false, why: `the office's movement record could not be opened: ${String(e?.message ?? e).split("\n")[0].slice(0, 200)}` }; }

  let held;
  try { held = (await d.departures()).filter((r) => r?.handle === handle); }
  catch (e) { return { written: false, why: `the movement record could not be read, so nothing is written over it: ${String(e?.message ?? e).split("\n")[0].slice(0, 200)}` }; }
  if (held.length)
    return { written: false, already: true, why: `${handle} already has a position on record (${held.length} departure${held.length === 1 ? "" : "s"}): a set-down never moves a resident the record already places` };

  const crossing = d.crossing(), pace = d.pace(), writtenAt = d.now();
  const entry = d.walkEntry({
    crossing, who: handle, targetMarkId: mark,
    stampAt: null, witnesses: null,
    from: at, toward: at, pace, targetExtent: null,
    household, writtenAt, declaredBy: SET_DOWN_BY, note,
  });
  if (dry) return { written: false, would: { handle, at, mark, crossing, declared_by: SET_DOWN_BY, note } };

  let row;
  try { row = await d.append(entry); }
  catch (e) { return { written: false, why: `the set-down was not written: ${String(e?.defect ?? e?.message ?? e).split("\n")[0].slice(0, 200)}` }; }
  // THE KEPT POSITIONS, IN THE SAME STEP (POS-691), as landOnEnter: a record
  // that trips never unsays the set-down; the projection's head read hears it.
  try {
    d.record({ at: writtenAt, actor: handle, from: at, toward: at, crossing, within: null, toMark: mark, pace, note }, row?.actId ?? null);
  } catch (e) { console.error(`[set-down] ${handle}'s kept position did not record (${String(e?.message ?? e).slice(0, 160)}); the head read will hear it`); }
  return { written: true, actId: row?.actId ?? null, at, mark };
}

/** The office's own movement record, read and written as the walk door and landOnEnter do. */
export async function setDownDeps() {
  const w = await import("./world.mjs");
  const { appendJournal } = await import("./world-journal.mjs");
  const { departurePace } = await import("./world-classes.mjs");
  return {
    // BOTH ERAS, OR NOTHING: `departuresAcrossEras` answers era one alone when the
    // store does not answer, and says so only in `disclosed`. Read as "no record",
    // that would set down a resident who has walked, so an unread era refuses.
    departures: async () => {
      const eras = w.positionsProjected() ? await w.positionProjection.snapshot() : await w.departuresAcrossEras(w.WORLD_CLONE);
      const unread = (eras.disclosed ?? []).find((d) => /^(record-unreadable|walk-ledger-unreadable)/.test(String(d)));
      if (unread) throw new Error(unread);
      if (eras.ledgerUnreadable) throw new Error(`the walk ledger is unreadable: ${eras.ledgerUnreadable}`);
      return eras.departures ?? [];
    },
    walkEntry: w.walkEntry,
    append: (entry) => appendJournal(null, entry),
    record: w.recordMoved,
    crossing: () => w.currentCrossing(),
    pace: () => departurePace(),
    now: () => new Date().toISOString(),
  };
}
