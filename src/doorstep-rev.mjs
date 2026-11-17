// doorstep-rev.mjs — a doorstep's content revision (POS-1086).
//
// WHY. The site's refresh asks the office for every resident's doorstep each
// pass (about 392 of them) and cannot tell which moved. Measured 2026-11-17
// (14:55Z to 15:07Z, prod's public /doorsteps, read-only): the office's body has
// no clocks; across an idle resident's two reads exactly FIVE leaves differed,
// all of them the one global value `as_of` (the office's copy of the town
// record) or the copy's newest change; and a resident's own content moves
// without `as_of` moving (a stance written on their ground changed 762 leaves
// of limen's page 6+ minutes before `as_of` moved). So no global marker can say
// "unchanged", and the office has no per-resident one.
//
// THE REVISION IS THE CONTENT. `rev` is a hash of the composed body with those
// five as_of leaves and the six town-wide blocks (TOWN_WIDE_BLOCKS) taken out.
// It cannot serve stale content, because it is
// computed from the same body the reader would otherwise get: a caller that
// holds a doorstep's `rev` and is told it is unchanged holds the same bytes,
// modulo the five leaves and the six blocks, which the response hands back
// ONCE (`global`, version 2, on the bulk door) so a caller can patch a
// carried-over file. It saves the reader's transfer and
// write, not the office's compose; the compose is what a later change can cut.

import { createHash } from "node:crypto";

/**
 * The five `as_of`-derived leaves, by path. The only places a doorstep's body moves with the office's copy alone.
 * The rev is the body without these five leaves AND without the six town-wide blocks (TOWN_WIDE_BLOCKS below),
 * all handed back in `global` (version 2) on the bulk door.
 */
export const GLOBAL_LEAVES = Object.freeze([
  "as_of",
  "copy.newest_change_at",
  "copy.sentence",
  "window.freshness.settled_as_of",
  "pending_outbox_freshness.settled_as_of",
]);

/**
 * THE TOWN-WIDE BLOCKS (POS-1086, global-blocks): top-level keys of the doorstep body that are the same for every
 * resident at one moment, and that move when the TOWN moves (a letter anywhere, a crossing, a posting), not when
 * the resident's own page does. Left in the hash they changed every resident's rev at once, and a pass over a town
 * that had moved carried over nobody (prod 2026-11-17 21:40Z: "0 carried over, 393 fetched whole").
 * Each reads no resident input, from the code (town-index-store.mjs § doorstepFromRows, doorstep-bundle.mjs):
 *   copy           ix.copy() and the timetable: copyBlock(await ix.copy(), as_of, nowMs); no handle.
 *   next_crossing  nextCrossingForDoorstep(nowMs): a pure function of the clock.
 *   bulletin       bulletinTeaserOf(bulletinListingsKept(rows.bulletin)): rows.bulletin = bulletinRows(q), the whole board.
 *   town_pulse     metricsPulseKept(rows.pulse): rows.pulse = metricsMailRows(q), the whole ledger; no handle.
 *   psa            psaFoldOf(rows.psa, { now }): rows.psa = psaRow(q), the one posting; the clock.
 *   town           rows.town: the resident count, delivery count and last delivery of the whole ledger, and the five newest arrivals.
 * What is NOT here: the keys that are constants of the build (the_bundle, segments, clocks, moved, doorstep_version,
 * civic, rulings). They move only with a deploy, and they stay in the hash so that a deploy moves every rev.
 * Order is the body's own and is not significant here: each is taken out by key.
 */
export const TOWN_WIDE_BLOCKS = Object.freeze(["copy", "next_crossing", "bulletin", "town_pulse", "psa", "town"]);

/**
 * The version of the `global` part (and of the rev scheme). A caller says it understands it with `&global=2`;
 * the office answers `unchanged` only to such a caller, so a reader that cannot patch the blocks is never told
 * "unchanged" about a body whose blocks it does not hold.
 */
export const GLOBAL_VERSION = 2;

/** A rev is 16 lowercase hex characters (64 bits of sha-256). */
export const REV_RE = /^[0-9a-f]{16}$/;

// The body as JSON, keys sorted at every depth, so the hash does not depend on the order a segment happened to be composed in.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * `{ rest, global }`: the body without its five global leaves (and without a `rev`), and the leaves' values.
 * The body is not changed; `rest` is a copy.
 */
export function splitGlobal(doorstep) {
  const { rev: _rev, ...body } = JSON.parse(JSON.stringify(doorstep));
  // the town-wide blocks, taken before the leaf deletions below (copy loses two leaves from `body`, but is handed back whole): clone only these
  const townWide = {};
  for (const k of TOWN_WIDE_BLOCKS) if (k in body) townWide[k] = JSON.parse(JSON.stringify(body[k]));
  const global = {
    as_of: body.as_of ?? null,
    copy: { newest_change_at: body.copy?.newest_change_at ?? null, sentence: body.copy?.sentence ?? null },
    window_settled_as_of: body.window?.freshness?.settled_as_of ?? null,
    outbox_settled_as_of: body.pending_outbox_freshness?.settled_as_of ?? null,
  };
  delete body.as_of;
  if (body.copy && typeof body.copy === "object") { delete body.copy.newest_change_at; delete body.copy.sentence; }
  if (body.window?.freshness && typeof body.window.freshness === "object") delete body.window.freshness.settled_as_of;
  if (body.pending_outbox_freshness && typeof body.pending_outbox_freshness === "object") delete body.pending_outbox_freshness.settled_as_of;
  // the town-wide blocks leave `rest` (handed back once, whole, in `global.town_wide`; copy too, so its two leaves above are repeated inside it and the block wins)
  for (const k of TOWN_WIDE_BLOCKS) delete body[k];
  global.version = GLOBAL_VERSION;
  global.town_wide = townWide;
  return { rest: body, global };
}

/** The content revision of a doorstep body: the hash of the page without the five leaves and without the town-wide blocks (which blocks it held is hashed, so a page missing one is another page). */
export function revOf(doorstep) {
  const { rest, global } = splitGlobal(doorstep);
  return createHash("sha256").update(canonical({ rest, town_wide_keys: Object.keys(global.town_wide).sort() })).digest("hex").slice(0, 16);
}

/** The body with its `rev` appended as the last key; null stays null (a 404's row). */
export function withRev(doorstep) {
  return doorstep ? { ...doorstep, rev: revOf(doorstep) } : doorstep;
}

/**
 * `?known=handle:rev,handle:rev` as a Map handle to rev, or `{ refused }` naming the first bad entry.
 * A handle named twice keeps the last rev.
 */
export function parseKnown(entries) {
  const known = new Map();
  for (const e of entries) {
    const m = /^([a-z0-9-]+):([0-9a-f]{16})$/.exec(e);
    if (!m) return { refused: e.slice(0, 60) };
    known.set(m[1], m[2]);
  }
  return { known };
}
