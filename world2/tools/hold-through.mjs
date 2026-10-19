// hold-through.mjs — THE SETTLEMENT PRINTS WHERE A THING IS (POS-688, ruled by
// Darko 2026-10-18 20:58; W1 (a), settled by Wright the same night).
//
// "A held thing is published but unplaced": the same mark (maker, words, id), no
// ground position while held, shown as its holder's contents. The settlement
// prints a held thing's mark with `held_by: <its holder>` and no `at`/`extent`,
// and a drop prints a fresh `at` where the dropper stood.
//
// ── HOW: THE CLEARING WRITES THE HOLD RECORD THROUGH ────────────────────────
//
// The hold record lives in `acts` (class holding: take, give, drop; and the frozen
// era's attachments). The clearing already writes store-held facts through into
// the record it locks (the carry's riders, POS-441, step 6.1), so this is that
// move once more, as step 6.2: for every thing whose standing row disagrees with
// the hold record, one locked claim of its own superseding the row, filed by
// materialize.mjs, so the write-down prints it and the sweep lets it land
// (settlement-sweep.mjs § hold-only change). Rejected (W1 b): an author's amend
// filed at the take or drop door, which on the commons at ✦0 is a private draft
// that never publishes (POS-451), and would write in the author's name for a
// stranger's hand.
//
// A DIFF, NOT A DELTA. The printout is the hold record's answer for every thing
// it names, compared with the standing row, so an act committed late (an id taken
// before a neighbour's and committed after it) is printed at the next clearing,
// never lost behind a cutoff. The cutoff (`hold_through`, the last hold act this
// clearing read, on the window's receipts) says only which DROPS are the
// printout's: those after the first clearing that printed. A drop from before it
// is the POS-138 era's, and D2 leaves those alone (canon stays the author's).
//
// WHAT A PRINTOUT IS:
//   held      geometry null (no at, no extent), `held_by: <holder>` in data, and
//             `_placed`: where it last stood (held.mjs § PLACED; never printed),
//             which is the extent a drop prints again and the centre an act
//             anchored on it before it was taken still composes against (W4).
//   set down  geometry { at: where the dropper stood, extent: the one it had },
//             no `held_by`, no `_placed`.
//
// WHAT IS NEVER PRINTED (each a note on the window's receipts, by name):
//   · a thing the store holds no standing row for (an unpublished draft, a
//     retired mark): there is no mark to print;
//   · a thing that frames marks filed inside it (their numbers are written against
//     its centre: unplacing it would move them; the sweep holds the same back);
//   · a drop whose place cannot be composed, or a thing with no extent to print;
//   · a drop the standing row has been amended past (its window is later than the
//     drop's): the author's word stands.
//
// PURE planner (`holdPrintout`), plus the one function that reads and writes
// (`writeHoldThrough`), which the clearing job calls inside its transaction.

import { HELD_BY, PLACED, heldBy, latestRows, actIdOf, placedCentreOfRow } from "../../src/held.mjs";
import { HOLD_TOP_SQL } from "../../src/hold-record.mjs";
import { composeAnchor } from "./conversations.mjs";
import { pgAttachmentsFor, pgHoldingRows } from "./guard-reads.mjs";

/** The cutoff the first clearing that printed sealed: drops at or before it are the POS-138 era's. */
export const FIRST_THROUGH_SQL = `SELECT min((receipts->>'hold_through')::bigint) AS "from" FROM windows WHERE id < $1 AND receipts ? 'hold_through'`;
/** The standing rows the printout is compared with (the carry reads the same columns). */
export const STANDING_ROWS_SQL = `SELECT id::text, slug, kind, owner, household, geometry, parent::text, data, body, locked_window
                                   FROM marks WHERE status = 'standing'`;

const asObj = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const point = (p) => (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: Number(p.x), y: Number(p.y) } : null);
const sameAt = (a, b) => !!a && !!b && Number(a.x) === Number(b.x) && Number(a.y) === Number(b.y);
const windowOf = (row) => (row?.crossing == null || !Number.isFinite(Number(row.crossing)) ? null : Math.floor(Number(row.crossing)));

/**
 * What the settlement prints this clearing. PURE.
 *
 * @param attachments  the hold rows up to the cutoff, in replay order (last wins)
 * @param drops        `Map(thing → its latest drop act row)` (acts columns)
 * @param rows         the standing `marks` rows
 * @param from         the first printing clearing's cutoff, or null when none has printed yet
 * @returns `{ prints: [{ slug, row, geometry, data, why }], notes: [string] }`
 */
export function holdPrintout({ attachments = [], drops = new Map(), rows = [], from = null }) {
  const bySlug = new Map(rows.map((r) => [String(r.slug), { ...r, geometry: asObj(r.geometry), data: asObj(r.data) ?? {} }]));
  const centreOf = (id) => placedCentreOfRow(bySlug.get(String(id)) ?? null);
  const framedBy = new Map();   // slug -> marks filed inside it that carry their own place
  for (const r of bySlug.values()) {
    const up = r.data?._parentMarkId;
    if (up && point(r.geometry?.at) && r.data?._fileAt) framedBy.set(String(up), [...(framedBy.get(String(up)) ?? []), r.slug]);
  }
  const prints = [], notes = [];
  for (const [slug, hold] of latestRows(attachments)) {
    const row = bySlug.get(slug);
    if (!row) continue; // no mark to print (a draft, or retired)
    const { _fileAt, _origin, [HELD_BY]: wasHeldBy, [PLACED]: placed, ...rest } = row.data ?? {};
    if (hold.policy === "cascade" && hold.entity != null) {
      const holder = String(hold.entity);
      if (heldBy(row.data) === holder && !point(row.geometry?.at)) continue; // printed so already
      const framed = framedBy.get(slug) ?? [];
      if (framed.length) { notes.push(`${slug} stays placed: ${framed.length} mark(s) filed inside it write their place against it (${framed.slice(0, 4).join(", ")})`); continue; }
      const lastPlace = point(row.geometry?.at) ? row.geometry : (placed ?? null);
      prints.push({ slug, row, geometry: null, why: `held by ${holder}`,
        data: { ...rest, [HELD_BY]: holder, ...(lastPlace ? { [PLACED]: lastPlace } : {}) } });
      continue;
    }
    if (hold.policy !== "detach") continue;
    const legacy = from == null || actIdOf(hold) <= from;
    if (legacy) continue; // the POS-138 era: D2 leaves it alone
    const drop = drops.get(slug) ?? null;
    const at = drop ? composeAnchor({ anchor: drop.at_anchor, dx: drop.at_dx, dy: drop.at_dy }, centreOf) : null;
    if (!at) { notes.push(`${slug}: its set-down could not be placed (the drop's witnessed line does not compose)`); continue; }
    if (!heldBy(row.data) && sameAt(row.geometry?.at, at)) continue; // canon has it there already
    const dropWindow = windowOf(drop);
    if (!heldBy(row.data) && dropWindow != null && Number(row.locked_window) >= dropWindow) {
      notes.push(`${slug}: amended in window ${row.locked_window}, after its set-down in ${dropWindow}: the author's word stands`);
      continue;
    }
    const extent = row.geometry?.extent ?? placed?.extent ?? null;
    if (!extent) { notes.push(`${slug}: set down, but no extent is on record to print`); continue; }
    prints.push({ slug, row, geometry: { at: { x: at.x, y: at.y }, extent }, why: `set down by ${drop?.actor ?? "somebody"}`, data: rest });
  }
  return { prints, notes };
}

/**
 * STEP 6.2 · THE HOLD WRITE-THROUGH, inside the clearing's transaction. `q` is
 * the clearing's query function, `materialize` its filer (materialize.mjs §
 * materializeClaims, bound), `houseOrRefusal` its owner-house resolver. Returns
 * the receipt the window keeps: `{ hold_through, printed: [...], notes: [...] }`.
 */
export async function writeHoldThrough(q, { windowId, materialize, houseOrRefusal, boxOf }) {
  const client = { query: (text, params) => q(text, params) };
  const through = Number((await q(HOLD_TOP_SQL, [])).rows?.[0]?.top ?? NaN);
  if (!Number.isFinite(through)) return { hold_through: null, printed: [], notes: ["no hold act on record"] };
  const fromRow = (await q(FIRST_THROUGH_SQL, [windowId])).rows?.[0];
  const from = fromRow?.from == null ? null : Number(fromRow.from);
  const atts = (await pgAttachmentsFor(client, {})).rows.filter((r) => actIdOf(r) <= through);
  const holding = await pgHoldingRows(client, {});
  const drops = new Map();
  for (const r of holding) if (r.action === "drop" && Number(r.id) <= through) drops.set(String(r.object ?? r.payload?.thing), r);
  const { rows } = await q(STANDING_ROWS_SQL, []);
  const plan = holdPrintout({ attachments: atts, drops, rows, from });
  const printed = [];
  for (const p of plan.prints) {
    const house = await houseOrRefusal(q, p.row.owner);
    if (house.check) { plan.notes.push(`${p.slug}: ${house.check}`); continue; }
    // ONE PRINTOUT, ONE UNIT: its claim row and its filing, or neither (a claim
    // written locked with no mark is a lock that never landed)
    await q("SAVEPOINT print_one_hold");
    const { rows: [claim] } = await q(
      `INSERT INTO claims (window_id, slug, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, parent, supersedes)
       VALUES ($1, $2, $3, $4, $5, 'locked', now(), $6, $7, $8, 0, $9, $10, $11)
       RETURNING *`,
      [windowId, p.slug, p.row.kind, p.row.owner, house.household, p.row.body ?? null,
        p.geometry ? JSON.stringify(p.geometry) : null, p.geometry ? boxOf(p.geometry) : null,
        JSON.stringify({ ...p.data, _held_through: through }), p.row.parent ?? null, p.row.id]);
    let failed = null;
    await materialize({ claims: [claim], amends: new Map([[String(claim.id), { id: p.row.id }]]), refuseEach: (_c, check) => { failed = check; } });
    if (failed) {
      await q("ROLLBACK TO SAVEPOINT print_one_hold");
      await q("RELEASE SAVEPOINT print_one_hold");
      plan.notes.push(`${p.slug}: ${failed}`);
      continue;
    }
    await q("RELEASE SAVEPOINT print_one_hold");
    printed.push({ slug: p.slug, claim: String(claim.id), why: p.why });
  }
  return { hold_through: through, printed, notes: plan.notes };
}
