// held.mjs — A HELD THING IS PUBLISHED BUT UNPLACED (POS-688, ruled by Darko
// 2026-10-18 20:58). PURE: no store, no world, no clock.
//
// "I totally forgot that we made it so that held marks are still technically
// considered marks. I think that's the best of both worlds and just the cleanest
// and most commonsensical solution." A held thing stays the same mark (its maker,
// its words, its id), has no ground position while held, never appears in anyone's
// field of view as a mark of its own, and reads as its holder's contents, exactly
// as a thing in a chest does. The settlement prints it with `held_by: <holder>` and
// no `at`/`extent` (world2/tools/hold-through.mjs); a drop prints a fresh `at`.
//
// ── ONE QUESTION, ONE OWNER ─────────────────────────────────────────────────
//
// "Where is this thing?" had seven readers on 2026-10-18, and the look-closer read
// gave two answers in one reply (`focus.at` the canon place, `focus.stands.where`
// the holder's). `placeOf` is the one answer now, over the hold record the office
// already keeps (world-kinds.mjs § holdRecordNow), and `unplaceHeld` lays it over
// the one world, so the take door, the look-closer, the field of view, find and
// the World page all read the same thing:
//
//   held      the latest hold row is a holding (`cascade`): no place, `held_by`
//   set-down  the latest is a drop the settlement has not printed: where it was
//             set down. That is a drop past the last clearing's `hold_through`
//             (it prints at the next one), or one from before the first printout
//             (the POS-138 era, which D2 leaves alone: a stranger's set-down
//             still stands where it was set down while canon keeps the author's)
//   canon     everything else: the fold's own record, as it stands
//
// A drop the settlement HAS printed (between the first printout and the last) is
// canon's, so a later amend by its author is never undone by an old drop.

/** The printed field. ONE name, so a rename is this line; the world's twin is
 *  `tools/mark-kind.mjs § HELD_BY`, and test/held-place.test.mjs holds them equal. */
export const HELD_BY = "held_by";

/**
 * Where a held thing last stood, kept in its STORE row's `data` by the
 * settlement's write-through, never printed (markRecord drops `_` keys): the
 * extent a drop prints again, and the centre an act anchored to it before it was
 * taken still composes against (W4).
 */
export const PLACED = "_placed";

/** Who holds this record, or null when it is placed. */
export const heldBy = (m) => {
  const v = m?.[HELD_BY];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

const pointOf = (p) => (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: Number(p.x), y: Number(p.y) } : null);
// a hold row's act id; a frozen-era row has none (its `seq` is the old log's, not an act's), so it is the oldest
export const actIdOf = (r) => { const n = r?.act_id == null ? NaN : Number(r.act_id); return Number.isFinite(n) ? n : -Infinity; };

/** The latest hold row per thing (the record's own order is the replay order: last wins). */
export function latestRows(attachments = []) {
  const last = new Map();
  for (const r of attachments ?? []) if (r?.target != null) last.set(String(r.target), r);
  return last;
}

/**
 * Where a store row's mark stands, or stood: its geometry's centre, else the
 * place it last stood before it was taken. Every reader that composes an act's
 * anchor through the store asks this (conversations, the earpiece), so an act
 * anchored on a thing that is now in someone's hands still has a place. PURE.
 */
export function placedCentreOfRow(row) {
  const g = typeof row?.geometry === "string" ? JSON.parse(row.geometry) : row?.geometry;
  const d = typeof row?.data === "string" ? JSON.parse(row.data) : row?.data;
  return pointOf(g?.at) ?? pointOf(d?.[PLACED]?.at);
}

/**
 * THE ONE ANSWER for one thing. `view` is `{ last, through, places, placed }`
 * (`viewOf` below); `mark` is the canon record. Returns
 *   `{ held_by }`                         in someone's hands (or a holder thing)
 *   `{ at, extent, source: "set-down" }`  set down past the last printout
 *   `null`                                canon's own answer stands
 */
export function placeOf(id, view, mark = null) {
  if (!view) return null;
  const key = String(id);
  const row = view.last.get(key);
  if (row?.policy === "cascade" && row.entity != null) return { [HELD_BY]: String(row.entity) };
  if (row?.policy !== "detach") return null;
  const act = actIdOf(row);
  const legacy = view.through == null || view.from == null || act <= view.from;
  // printed: canon has it where it was set down. Unless canon still names a holder: then the
  // settlement could not print the drop (its notes say why), and the record's place stands
  if (!legacy && act <= view.through && !heldBy(mark)) return null;
  const at = pointOf(view.places?.get?.(key));
  if (!at) return null;
  const extent = mark?.extent ?? view.placed?.get?.(key)?.extent ?? null;
  return { at, ...(extent ? { extent } : {}), source: "set-down", ...(legacy ? { before_printout: true } : {}) };
}

const cutoff = (n) => (n != null && Number.isFinite(Number(n)) ? Number(n) : null);
/**
 * The view `placeOf` reads: the kept hold record, the first and the last
 * clearing cutoffs (`from`, `through`), and the store's last places.
 */
export const viewOf = ({ record, from = null, through = null, placed = new Map() } = {}) =>
  record ? { last: latestRows(record.attachments), from: cutoff(from), through: cutoff(through), places: record.places ?? new Map(), drops: record.drops ?? new Map(), placed } : null;

/** One mark as the one answer places it: held → no place and `held_by`; set down → there; else as it is. PURE. */
export function placedMark(m, view) {
  if (!m?.id || !view) return m;
  const p = placeOf(m.id, view, m);
  if (p?.[HELD_BY] != null) {
    if (heldBy(m) === p[HELD_BY] && m.at === undefined) return m;
    const { at, extent, points, ...rest } = m;
    return { ...rest, [HELD_BY]: p[HELD_BY] };
  }
  if (p?.source === "set-down") {
    const { [HELD_BY]: _held, points, ...rest } = m;
    return { ...rest, at: p.at, ...(p.extent ? { extent: p.extent } : {}) };
  }
  return m;
}

/**
 * THE ONE WORLD, PLACED BY THE HOLD RECORD. Returns `w` itself when nothing
 * moves (most reads: a world with no hand-off since the last printout), so a
 * caller comparing identity, or caching on it, pays nothing.
 */
export function unplaceHeld(w, view) {
  if (!w?.marks || !view) return w;
  let changed = false;
  const marks = w.marks.map((m) => { const n = placedMark(m, view); if (n !== m) changed = true; return n; });
  return changed ? { ...w, marks } : w;
}

/**
 * Is this mark a thing (its class, or a class it extends, is `thing`)? `classOf`
 * reads a mark's class in either form (world-grants.mjs § markClassOf) and
 * `extendsOf` a class's parent (world-classes.mjs § classExtendsOf); both are
 * handed in so this stays pure. A thing is never an act's anchor (POS-688, W4):
 * it can be picked up, and a held thing has no place to compose an act against.
 */
export function isThingMark(m, { classOf, extendsOf }) {
  let c = m ? classOf(m) : null;
  for (let hops = 0; c != null && hops < 32; hops += 1) {
    if (String(c) === "thing") return true;
    c = extendsOf(String(c));
  }
  return false;
}

/**
 * The ground of a containment chain: every link that is not a thing (W4). A link
 * is known by its FULL record (`byId`), never by the link itself: the engine's
 * chain hands back slim links (`{ id, by, tier, body, extentM }`, world-verbs §
 * containmentChain) with no kind and no class, so asked of the link a thing never
 * reads as one. Found on the playground (2026-10-19): drops anchored on a tin box.
 */
export function groundChain(chain = [], byId = new Map(), opts) {
  return (chain ?? []).filter((link) => !isThingMark(byId.get(link?.id) ?? link, opts));
}

/**
 * The engine's close look at a mark, with its holder named (POS-688): the engine
 * reads the record's own fields and knows no hold, so the office adds the one
 * word the placed world says. The look gives no place for a held thing already
 * (the placed world has none), so this is the whole of what a resident reads:
 * the same mark, and whose hands it is in. PURE.
 */
export function withHolder(look, w, id) {
  if (!look || look.error) return look;
  const holder = heldBy((w?.marks ?? []).find((m) => m.id === String(id)));
  return holder ? { ...look, [HELD_BY]: holder } : look;
}
