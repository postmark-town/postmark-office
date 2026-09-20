// mark-render.mjs — a `marks` row → the `mark.md` bytes the drain would write.
//
// G1 makes the store the only source: the settlement's fold reads the store
// instead of the household draft branches, and writes the world repo as its
// snapshot. Today those files come from `src/world-drain.mjs:411`, which calls
// `markRecord(u.fileRec, u.body)` with a fileRec built out of a JOURNAL row's
// payload (`world-drain.mjs:231`). This is the same call with the same
// serializer, fed from a store row instead — so the grammar has ONE writer
// still, which is the whole point of `src/mark-record.mjs` existing:
//
//   "Two copies of a serialization is how two eras come to disagree about the
//    bytes of the same declaration — and the disagreement would be invisible,
//    because both would parse."
//
// So this file maps ROWS TO A RECORD and serializes with the door's own
// function. It never formats a field itself.
//
// ── WHAT THIS CAN AND CANNOT REPRODUCE, MEASURED BEFORE IT WAS WRITTEN ───────
//
// The brief this was built to assumed byte-equality against the tree was a
// property of the mapping. It is not, and the tree is why. Measured against
// world `66da7f97` (settlement/S62), 1,182 mark files:
//
//   · 75 DISTINCT FRONTMATTER FIELD ORDERS, `by` before `kind` in some eras and
//     after it in others.
//   · 40+ distinct frontmatter keys. `RECORD_FIELDS` — the door's grammar — is
//     13. On disk: `pre` 506, `derived_from` 506, `tier` 472, `mechanic_draft`
//     101, `source` 182, `version` 158, `dials` 157, `implements` 154 …
//   · KEY ORDER INSIDE `at` AND `extent`, which jsonb does not keep. 510 files
//     write `extent: { w, h }` and 36 write `{ h, w }`; 545 write `at: { x, y }`
//     and one writes `{ y, x }` (rei/the-latecomers-circle, 2026-09-03 — the
//     door wrote back what the resident sent).
//   · TWO VALUE FORMS FOR ONE RING. Of 22 files carrying `points`, 3 are in
//     `fmtVal`'s JSON-array form (`[[x,y],…]`, all written since 2026-08-27) and
//     19 in the older `x,y x,y` hand form, which `parseDeltaRecord` still READS
//     and `markRecord` has never WRITTEN. This one was found by the test's own
//     unknown-class guard after the header had already been written claiming two
//     classes — the guard reddened on the third within the hour.
//
// None of that is the store's fault and none of it is reachable: the door
// REFUSES the extra fields today (`RECORD_FIELDS`'s note on `tier`: "standing is
// derived from the ground your mark stands on, never asserted by the author"),
// and jsonb has no key order to return. Two of those keys became reachable on
// 2026-09-08/09 by ruling, because a crossing DOES write them for the town's
// own marks: `tier` is emitted for the one value the walk reads from a file
// (`constitution`; `src/mark-record.mjs § EMITS`, the reader's predicate quoted
// there) and `version` is written last. The key order lived on the tree side
// (world PR #23 normalised the 36 `{ h, w }` files). So the honest claim is the
// narrow one, and it is the one G1 needs:
//
//   A MARK A CROSSING WRITES renders byte-identical from the store.
//
// A mark no crossing touches keeps the bytes it already has, because the fold
// writes what it publishes and leaves the rest of the tree alone
// (`world-drain.mjs § writeDownHousehold` builds its tree from the base). The
// falsifier is `test/world2-mark-render.test.mjs` and the equality it runs is
// over the crossing's own set, not over the corpus — a corpus-wide equality
// would be a check nobody could ever make green, which is a check that gets
// turned off.
//
// ── THE TWO CONVENTIONS, NAMED SO THEY CAN BE ARGUED WITH ────────────────────
//
//   `at`     → `{ x, y }`      545 of 546 on disk; `world-drain.test.mjs:348`'s
//   `extent` → `{ w, h }`      reference literal is `at: { x: 7, y: -3 },
//                              extent: { w: 6, h: 6 }`, and that literal is
//                              deliberately not another call to `markRecord`
//                              (its own comment says so), which makes it the
//                              closest thing this office has to a written
//                              record grammar.
//
// ── THE FRAME, AND IT IS THE FIELD MOST LIKELY TO BE GOT WRONG ───────────────
//
// `geometry.at` is WORLD coordinates; the FILE speaks its parent's frame.
// seed-import.mjs § the frame note: "`at` is already WORLD coordinates —
// `loadMarks` composed the v3 frame. The file's own numbers stay behind in
// `_fileAt`, deliberately." So the file's `at` is `data._fileAt` where the
// parser left one, and `geometry.at` only where it did not — which is exactly
// the root-level marks, whose two frames are the same. 503 rows carry
// `_fileAt`; the 46 that do not are the door's own, all of them root-level.
// Reading `geometry.at` unconditionally would put world coordinates into a
// relative-framed file — the 2026-08-27T01:13Z pando-peak defect, which
// `world-drain.mjs § fileFramer` exists to prevent on the journal side.

import { markRecord } from "../../src/mark-record.mjs";

/**
 * One `marks` row → the record `markRecord` serializes. PURE: no store, no fs.
 *
 * The whole of `data` rides and the columns override it, for `apex-reads.mjs
 * § markRecordOf`'s reason ("an allowlist here was a live defect … that is a
 * guess about a consumer"). `markRecord`'s own `RECORD_FIELDS` filter is what
 * decides which of them reaches the file, and it is the door's list, not ours —
 * so the internal keys the parser leaves behind (`_fileAt`, `_origin`, `_stray`,
 * `_parentMarkId`, `_act_id`) and the derived `tier` fall out there rather than
 * being stripped here by a second rule that could drift from the first.
 */
export function recordFromRow(row) {
  if (!row) throw new Error("recordFromRow: no row");
  const d = row.data ?? {};
  const g = row.geometry ?? null;
  const rec = { ...d, kind: row.kind, by: row.owner };
  // A de-sited mark (predicated/naming) has no geometry and no `at`/`extent` —
  // and after 004 that is a representable row rather than a missing one. Ten
  // rows carry a `geometry` holding nothing but a stray `slug`, which is the
  // door's own residue and not a placement; `at && extent` is the test, never
  // `geometry` being non-null.
  if (g && g.at && g.extent) {
    const at = d._fileAt ?? g.at;
    rec.at = { x: at.x, y: at.y };
    rec.extent = { w: g.extent.w, h: g.extent.h };
    // A ring rides in `geometry` (seed-import.mjs § the ring note: dropping it
    // "would silently widen twenty-one marks … from their real shape to their
    // bounding box"). Array order is jsonb-stable; only OBJECT key order is not.
    if (Array.isArray(g.points)) rec.points = g.points;
  }
  return rec;
}

/** The `mark.md` bytes for one `marks` row. PURE. */
export function renderRecord(row) {
  return markRecord(recordFromRow(row), row.body ?? "");
}

/**
 * WHICH FRAME the record's `at`/`points` are written in — `"file"` when the row
 * still carries the file's own numbers (`_fileAt`, left by the loader at seed),
 * `"world"` when it does not, which is every row the door has written since:
 * `materialize.mjs § materializeClaims` rewrites `data` from the claim on an
 * amend, and the door's payload has no `_fileAt`.
 *
 * It is named beside the bytes because the bytes cannot say. `at: { x: 221,
 * y: 95.5 }` reads the same whether it is a world position or an offset from a
 * frame, and on 2026-09-18T05:45Z the difference moved a shop 54 m west and
 * 79.5 m north: Berthillon's image-only amend of `le-petit-berthillon` was
 * rendered from `geometry.at` (world), filed by Gate A at its frozen path under
 * `the-town-centre` (whose origin is (-54, -79.5)), and the fold read the world
 * number as a file number. The write-down (`store-writedown.mjs`) frames a
 * `"world"` record landing at a nested path through the drain's one framer; a
 * `"file"` record is left as the file's own numbers, which is what they are.
 * `null` geometry has no frame to name.
 */
export function frameOfRow(row) {
  const g = row?.geometry ?? null;
  if (!(g && g.at && g.extent)) return null;
  const f = row.data?._fileAt;
  return f && Number.isFinite(f.x) && Number.isFinite(f.y) ? "file" : "world";
}

/**
 * The fold's mark entry for one row — the bytes, AND the record and body they
 * were rendered from, AND the frame the record's numbers are in. One helper
 * because two entry points build these (`fold-delta.mjs § foldDelta`, the
 * crossing's; `fold-input.mjs § foldInputFromStore`) and a shape assembled twice
 * is a shape that drifts. The record rides so the write-down can re-derive the
 * bytes after framing (and so `normalizeMark`'s serialization check has both
 * sides — `supplied_bytes_only` on the receipt was 3 of 3 on the crossing that
 * moved the shop, and the receipt's own comment says it should be 0).
 */
export function renderedMark(row) {
  const fileRec = recordFromRow(row);
  const body = row.body ?? "";
  return { fileRec, body, at_frame: frameOfRow(row), bytes: markRecord(fileRec, body) };
}

const MARK_COLUMNS = "id, slug, kind, owner, household, body, geometry, status, locked_window, retired_window, data";

/**
 * The `mark.md` bytes for one slug, read from the store.
 *
 * `window` and `worldSha` are NOT read from — they are the caller's as-of, and
 * they are refused here rather than silently ignored, because a caller that
 * passes them is asking for a mark as it stood at a window and this function
 * answers only about the row standing NOW. The store keeps no per-window mark
 * history (`marks` is materialized cleared state; `locked_window` says when the
 * standing row was locked, not what it held at some earlier window), so there is
 * nothing to answer with and pretending otherwise is the quiet kind of wrong.
 * `foldInputFromStore` is the as-of caller: it names the window it folded at in
 * `as_of` and takes the rows standing at that moment.
 */
export async function renderMarkFromStore(client, slug, opts = {}) {
  for (const k of ["window", "worldSha", "world_sha"]) {
    if (opts[k] !== undefined && opts[k] !== null) {
      throw new Error(`renderMarkFromStore: \`${k}\` is not answerable — \`marks\` is materialized CURRENT state and keeps no per-window record history, so a mark cannot be rendered as it stood at an earlier window. Drop the argument, or ask foldInputFromStore, which stamps the window it actually folded at.`);
    }
  }
  const { rows } = await client.query(
    `SELECT ${MARK_COLUMNS} FROM marks WHERE slug = $1`, [slug]);
  if (rows.length === 0) return null;
  return renderRecord(rows[0]);
}

/** Every standing mark's row, ordered by slug — the fold's input set. */
export async function standingMarkRows(client) {
  const { rows } = await client.query(
    `SELECT ${MARK_COLUMNS} FROM marks WHERE status = 'standing' ORDER BY slug`);
  return rows;
}

export { MARK_COLUMNS };
