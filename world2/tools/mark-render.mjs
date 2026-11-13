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
/**
 * WHEN A MARK WAS FIRST CLAIMED, from its ORIGIN claim: the claim's record date,
 * else its submitted_at (ISO). The one rule: the tree's write-down (here) and the
 * store's fold (`world-snapshot.mjs § firstClaimedBySlug`) both ask it, so an
 * undated origin claim reads as the same instant on both sides (POS-364 review:
 * the write-down read the date only, and an undated pre-law parcel amended today
 * folded as post-law in the tree). PURE. Null when the claim has neither.
 */
export function firstClaimInstant(date, submittedAt) {
  if (date != null && date !== "") return String(date);
  if (submittedAt == null) return null;
  return submittedAt instanceof Date ? submittedAt.toISOString() : String(submittedAt);
}

/** Does a record carry a `date`? PURE. */
export const isDated = (date) => date != null && date !== "";

// ── A MARK'S FOOTPRINTS (POS-571) ────────────────────────────────────────────
//
// Seniority is per cell: "whoever first covered a cell is that cell's
// incumbent", and "an expansion is a newcomer on its new cells" (world LOGOS
// conflict-matrix § Roles from seniority, RULED 2026-10-04). The world engine
// reads a record's `footprints` for that (world tools/claim-instant.mjs §
// footprintsOf; WORLD/marks/SCHEMA.md § First-laid facts): every footprint the
// mark has stood on, each with the instant it took effect, in WORLD numbers.
//
// The store keeps no history on the `marks` row; every version is its own
// LOCKED claim, and every amend points at the mark's id (`supersedes`). So the
// chain is the origin claim (`claims.id = marks.id`) and the locked claims that
// supersede it. Only locked claims: a draft, a pending or a refused claim never
// stood, so it never covered a cell. The origin is dated by the one first-claim
// rule (`firstClaimInstant`, so it agrees with `claimed_at`); each later
// footprint by its claim's `decided_at`, when it took effect, never when it was
// put forward. A claim with no geometry (a hand-off into hands) covers nothing,
// and one that repeats the footprint before it adds nothing.
//
// A history is printed only when it says something `claimed_at` cannot (the
// geometry changed at least once) and only when it is whole: the origin is in the
// chain, every claim is dated, and the last footprint IS the current shape,
// compared in world numbers (the row's `geometry`, never a file's own offset).
// Anything less is no history, and the world dates every cell by `claimed_at`,
// as before. Never a guessed one.

const CLAIM_CHAIN_SQL = "(SELECT json_agg(json_build_object('id', c.id, 'geometry', c.geometry, 'decided_at', c.decided_at) "
  + "ORDER BY c.decided_at, c.id) FROM claims c WHERE c.slug = marks.slug AND c.status = 'locked' "
  + "AND (c.id = marks.id OR c.supersedes = marks.id)) AS claim_chain";

/** Each slug's mark id and its chain (`claim_chain`), the store fold's read of the same chain the write-down renders. */
export const FOOTPRINT_CHAIN_SQL = `SELECT slug, id, ${CLAIM_CHAIN_SQL} FROM marks WHERE slug = ANY($1)`;

const shapeOf = (g) => {
  if (!g?.at || !g?.extent) return null;
  const at = { x: Number(g.at.x), y: Number(g.at.y) }, extent = { w: Number(g.extent.w), h: Number(g.extent.h) };
  if (![at.x, at.y, extent.w, extent.h].every(Number.isFinite)) return null;
  return { at, extent, ...(Array.isArray(g.points) ? { points: g.points.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y])) } : {}) };
};
const sameShape = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const instantOf = (v) => {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

/**
 * The mark's footprints, oldest first, as the world reads them
 * (`[{ since, at, extent, points? }]`), or null when there is nothing whole to
 * say (above). `chain` is the locked claims of the mark (`{ id, geometry,
 * decided_at }`, as CLAIM_CHAIN_SQL reads them); `originId` the mark's id;
 * `originSince` its first-claim instant; `current` its shape now, in world
 * numbers (`{ at, extent, points? }`). PURE.
 */
export function footprintsFromChain({ chain, originId, originSince, current }) {
  if (!Array.isArray(chain) || !chain.length || originId == null || originSince == null || originSince === "") return null;
  if (!Number.isFinite(Date.parse(String(originSince)))) return null;
  const origin = chain.find((c) => String(c?.id) === String(originId));
  if (!origin) return null;
  const later = chain.filter((c) => c !== origin);
  if (later.some((c) => instantOf(c?.decided_at) == null)) return null;
  later.sort((a, b) => Date.parse(instantOf(a.decided_at)) - Date.parse(instantOf(b.decided_at)));
  const out = [];
  for (const [since, g] of [[String(originSince), origin.geometry], ...later.map((c) => [instantOf(c.decided_at), c.geometry])]) {
    const shape = shapeOf(g);
    if (!shape) continue;
    const last = out[out.length - 1];
    if (last && sameShape(shape, { at: last.at, extent: last.extent, ...(last.points ? { points: last.points } : {}) })) continue;
    out.push({ since, ...shape });
  }
  const now = shapeOf(current);
  if (out.length < 2 || !now) return null;
  const end = out[out.length - 1];
  return sameShape(now, { at: end.at, extent: end.extent, ...(end.points ? { points: end.points } : {}) }) ? out : null;
}

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
  // A PARCEL CARRIES ITS FIRST CLAIM INTO THE TREE (POS-364 review, 2026-10-08).
  // Every door amend restamps `date`, and the tree's fold orders parcels and
  // reads the cap's law date by when each was first claimed (marks-fold §
  // claimInstant, world#166). A pre-law parcel amended today, in a household
  // holding more than three, would otherwise read as a fourth claim and stop the
  // crossing ("capped — already holds 4"). `first_claimed` is the mark's ORIGIN
  // claim's instant (the claim whose id the mark keeps for life; MARK_COLUMNS reads
  // its date and its submitted_at, and `firstClaimInstant` is the one rule the
  // store's fold uses too), written only when the parcel carries a `date` and it
  // differs from that date, so a parcel that was never amended keeps the bytes it
  // has always had. An UNDATED parcel carries none either (Wright's review of
  // #441): its file never had a date line, and the first write-down after the
  // deploy would otherwise rewrite it with its origin claim's submitted_at. The
  // cost, named: the store's fold still dates such a parcel by that submitted_at
  // (world-snapshot.mjs § firstClaimedBySlug) while the tree's reads it undated,
  // which sorts first and is never the one over a limit. World main held no
  // undated parcel on 2026-10-09 (117 of 117 carry a date).
  //
  // EVERY MARK CARRIES IT NOW, not only a parcel (POS-571): a mark's age is its
  // first-laid date wherever the law asks who came first (Darko, 2026-10-07: "an
  // amend does not make an elder mark young"), and an amended elder that is not a
  // parcel lost its age here. Same rule, same bytes for a mark never amended. And
  // its footprints ride beside it when its geometry has changed (§ A MARK'S
  // FOOTPRINTS), read off the row's world `geometry`, never the file's own offset.
  const first = firstClaimInstant(row.first_claimed, row.first_claim_submitted_at);
  if (first && isDated(d.date) && first !== String(d.date)) rec.claimed_at = first;
  const footprints = footprintsFromChain({ chain: row.claim_chain, originId: row.id, originSince: first, current: g });
  if (footprints) rec.footprints = footprints;
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

const MARK_COLUMNS = "id, slug, kind, owner, household, body, geometry, status, locked_window, retired_window, data, "
  + "(SELECT c.data->>'date' FROM claims c WHERE c.id = marks.id) AS first_claimed, "
  + "(SELECT c.submitted_at FROM claims c WHERE c.id = marks.id) AS first_claim_submitted_at, "
  + CLAIM_CHAIN_SQL;

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
