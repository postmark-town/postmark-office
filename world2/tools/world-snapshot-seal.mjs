// world-snapshot-seal.mjs — THE CLEARING SEALS THE WORLD IT JUST CLEARED
// (POS-357; 054_world_snapshots.sql. POS-410; 064_snapshot_register.sql).
//
// RULED (Darko, 2026-10-04, POS-337 R1 and "Agreed on 2"): the snapshot step
// inside the clearing's transaction is a PURE SQL COPY of rows the clearing just
// wrote: hash each standing mark's row, insert into mark_versions (on conflict do
// nothing), one world_snapshots header (shas read from the store's own tables),
// the world_snapshot_marks list. NO engine, no fold, no law evaluation, no
// network, no file reads.
//
// SO THIS FILE IMPORTS NOTHING. Every byte that is hashed is made by Postgres
// (`jsonb_build_object(...)::text`, `sha256`, `string_agg ... COLLATE "C"`), and
// this module only hands it five statements under the caller's connection,
// inside the caller's transaction. `test/world-snapshot.test.mjs` reads this
// file's import list and reds on any import at all: a fold, a world module or a
// file read here would bring the engine's failure modes into the clearing, and
// with this split the seal can only fail the clearing's own ways (a grant, a
// hashing bug), which the tests and the rehearsal catch.
//
// THE REGISTER (POS-410, 064_snapshot_register.sql; Darko 2026-10-05: "save
// whatever atomic upstream units are necessary"). Beside the marks, the seal
// copies the household register ROWS as they stand — every `households` and
// `household_pins` row, all columns, by content — so a later fold reads the
// houses of its own day, not today's. The stakes' source is the ledger
// position (`town_sha`) and the law and terrain are `law_sha`, both already on
// the header; nothing derived (escrow, the handle → household map) is copied.
//
// THE DIGESTS, defined once, here (054's and 064's headers say the same in prose):
//   version digest    sha256(row), row = the mark's canonical row as jsonb text,
//                     parent as the parent's slug
//   marks_digest      sha256 of "<slug> <digest>" lines, slug order (COLLATE "C"), "\n"-joined
//   register version  sha256(row), row = to_jsonb(<register row>) || {"table": <table>}, as text
//   register_digest   sha256 of "<key> <digest>" lines, key order (COLLATE "C"), "\n"-joined;
//                     key = "households/<slug>" | "household_pins/<handle>"
//   snapshot digest   sha256 of "<marks_digest> <law_sha> <town_sha> <world_sha> <register_digest>",
//                     "-" for an absent value, then " <stance_through>" when it is set (069),
//                     then " stances:<counted|not-counted>:<cutover|->:<settlement|->:<how>"
//                     when the decision is recorded (072). The number a seal allocates (095,
//                     `sealed_settlement`) is the decision's `settlement_inferred` (`how:
//                     "sealed"`), so the digest already names it; it adds no part of its own;
//                     then " held:<slug>=<why>,…" (slug order, COLLATE "C") when the seal holds anything
//                     back (095 `held`, POS-1025): a seal that holds nothing keeps the digest it always had
//
// THE TOWN'S WORDS (POS-362, 069_snapshot_stance_through.sql; Darko 2026-10-08,
// option A). The opposed half of a settlement is one more source: the seal
// records the newest stance act's id, and the settlement's World folds the words
// up to it (src/world-settlement.mjs § wordsAtSeal). One max(id), nothing derived.
//
// WHETHER THEY COUNT (POS-364, 072_snapshot_stances.sql; Darko 2026-10-09, the
// conservative cutover; Wright: decide once, at the seal). The caller hands the
// decision in (`stances`, made by world-settlement.mjs § stancesAtSeal from the
// cutover and the settlement number); this file only writes it, and the digest
// covers it. Every reader reads the record and never recomputes it.
//
// `src/world-snapshot.mjs § checkSnapshot` recomputes every one in JS from the
// stored rows; that second computation is a check, never a writer.

/**
 * The standing marks as their canonical rows: one (slug, row, digest) per mark.
 * `parent` is the parent's slug when the parent STANDS, which is exactly what
 * `marksFromRows` resolves (it maps a parent uuid through the standing rows only);
 * a retired or missing parent is null, and the record's own `data` carries the
 * fallbacks the fold reads.
 */
export const STANDING_ROWS_SQL = `
  SELECT r.slug, r.row, encode(sha256(convert_to(r.row, 'UTF8')), 'hex') AS digest
    FROM (
      SELECT m.slug,
             jsonb_build_object(
               'slug', m.slug, 'kind', m.kind, 'owner', m.owner, 'body', m.body,
               'geometry', m.geometry, 'parent', p.slug, 'data', m.data)::text AS row
        FROM marks m
        LEFT JOIN marks p ON p.id = m.parent AND p.status = 'standing'
       WHERE m.status = 'standing'
    ) r`;

/** The register as it stands: one (key, row, digest) per households and household_pins row. */
export const REGISTER_ROWS_SQL = `
  SELECT r.key, r.row, encode(sha256(convert_to(r.row, 'UTF8')), 'hex') AS digest
    FROM (
      SELECT 'households/' || h.slug AS key,
             (to_jsonb(h) || jsonb_build_object('table', 'households'))::text AS row
        FROM households h
      UNION ALL
      SELECT 'household_pins/' || p.handle,
             (to_jsonb(p) || jsonb_build_object('table', 'household_pins'))::text
        FROM household_pins p
    ) r`;

/** The standing rows (`cur`), the register (`reg`), and their list digests and counts, as CTEs. */
const LIST_CTES = `
  cur AS (${STANDING_ROWS_SQL}),
  list AS (
    SELECT encode(sha256(convert_to(
             coalesce(string_agg(slug || ' ' || digest, E'\n' ORDER BY slug COLLATE "C"), ''),
             'UTF8')), 'hex') AS marks_digest,
           count(*)::int AS marks
      FROM cur),
  reg AS (${REGISTER_ROWS_SQL}),
  rlist AS (
    SELECT encode(sha256(convert_to(
             coalesce(string_agg(key || ' ' || digest, E'\n' ORDER BY key COLLATE "C"), ''),
             'UTF8')), 'hex') AS register_digest,
           count(*)::int AS register_rows
      FROM reg)`;

const VERSIONS_SQL = `
  WITH cur AS (${STANDING_ROWS_SQL})
  INSERT INTO mark_versions (digest, row)
  SELECT digest, row FROM cur
  ON CONFLICT (digest) DO NOTHING`;

const LIST_SQL = `
  WITH ${LIST_CTES}
  INSERT INTO world_snapshot_marks (marks_digest, slug, digest)
  SELECT list.marks_digest, cur.slug, cur.digest FROM cur, list
  ON CONFLICT (marks_digest, slug) DO NOTHING`;

const REGISTER_VERSIONS_SQL = `
  WITH reg AS (${REGISTER_ROWS_SQL})
  INSERT INTO register_versions (digest, row)
  SELECT digest, row FROM reg
  ON CONFLICT (digest) DO NOTHING`;

const REGISTER_LIST_SQL = `
  WITH ${LIST_CTES}
  INSERT INTO world_snapshot_register (register_digest, key, digest)
  SELECT rlist.register_digest, reg.key, reg.digest FROM reg, rlist
  ON CONFLICT (register_digest, key) DO NOTHING`;

/** The header a seal names, `hdr`, digest and all, over the lists (`$2` the stance decision, `$4` the held list). Written by
 *  HEADER_SQL (a seal in one step) or saved by DECISION_SQL (the decision the settlement crossing later seals): one computation. */
const HEADER_CTES = `
  ${LIST_CTES},
  heads AS (
    SELECT (SELECT sha FROM projection_heads WHERE repo = 'world-law')   AS law_sha,
           (SELECT sha FROM projection_heads WHERE repo = 'town')        AS town_sha,
           (SELECT sha FROM projection_heads WHERE repo = 'world-marks') AS world_sha,
           (SELECT max(id) FROM acts WHERE class = 'stance')             AS stance_through),
  hdr AS (
    SELECT encode(sha256(convert_to(
             list.marks_digest || ' ' || coalesce(heads.law_sha, '-') || ' ' ||
             coalesce(heads.town_sha, '-') || ' ' || coalesce(heads.world_sha, '-') || ' ' ||
             rlist.register_digest || coalesce(' ' || heads.stance_through::text, '') ||
             CASE WHEN $2::jsonb IS NULL THEN '' ELSE
               ' stances:' || CASE WHEN ($2::jsonb->>'counted')::boolean THEN 'counted' ELSE 'not-counted' END
               || ':' || coalesce($2::jsonb->>'cutover', '-') || ':' || coalesce($2::jsonb->>'settlement_inferred', '-')
               || ':' || coalesce($2::jsonb->>'how', '-') END ||
             CASE WHEN $4::jsonb IS NULL THEN '' ELSE
               ' held:' || (SELECT string_agg((e->>'slug') || '=' || coalesce(e->>'held', '-'), ',' ORDER BY (e->>'slug') COLLATE "C")
                              FROM jsonb_array_elements($4::jsonb) e) END, 'UTF8')), 'hex') AS digest,
           list.marks_digest, list.marks, heads.law_sha, heads.town_sha, heads.world_sha, rlist.register_digest, heads.stance_through,
           rlist.register_rows
      FROM list, rlist, heads)`;

const HEADER_SQL = `
  WITH ${HEADER_CTES}
  INSERT INTO world_snapshots (window_id, digest, marks_digest, marks, law_sha, town_sha, world_sha, register_digest, stance_through, stances, sealed_settlement, held)
  SELECT $1, hdr.digest, hdr.marks_digest, hdr.marks, hdr.law_sha, hdr.town_sha, hdr.world_sha, hdr.register_digest,
         hdr.stance_through, $2::jsonb, $3::int, $4::jsonb
    FROM hdr
  RETURNING id, digest, marks_digest, marks, law_sha, town_sha, world_sha, register_digest, stance_through, stances, sealed_settlement, held,
            (SELECT register_rows FROM rlist) AS register_rows`;

/** THE SAVED DECISION (095 § 4; POS-1025/d "Save first, then pay"): the same header, saved whole instead of sealed, with the
 *  removal's day (`$5`), its town returns (`$6`) and the instant it was decided (`$7`, the sealed header's taken_at). */
const DECISION_SQL = `
  WITH ${HEADER_CTES}
  INSERT INTO settlement_decisions (window_id, settlement, day, header, town_returns, decided_at)
  SELECT $1, $3::int, $5::date,
         jsonb_build_object('digest', hdr.digest, 'marks_digest', hdr.marks_digest, 'marks', hdr.marks, 'law_sha', hdr.law_sha,
           'town_sha', hdr.town_sha, 'world_sha', hdr.world_sha, 'register_digest', hdr.register_digest,
           'stance_through', hdr.stance_through, 'stances', $2::jsonb, 'held', $4::jsonb),
         $6::jsonb, $7::timestamptz
    FROM hdr
  RETURNING window_id, settlement, day::text AS day, header, town_returns, decided_at, (SELECT register_rows FROM rlist) AS register_rows`;

/** THE SEAL OF A SAVED DECISION: its header copied into world_snapshots exactly as saved, nothing read live, taken_at the instant
 *  it was decided. Once: a window has one seal (054), and a second copy of the same decision writes nothing. */
const SEAL_DECISION_SQL = `
  INSERT INTO world_snapshots (window_id, digest, marks_digest, marks, law_sha, town_sha, world_sha, register_digest, stance_through,
                               stances, sealed_settlement, held, taken_at)
  SELECT d.window_id, d.header->>'digest', d.header->>'marks_digest', (d.header->>'marks')::int, d.header->>'law_sha',
         d.header->>'town_sha', d.header->>'world_sha', d.header->>'register_digest', (d.header->>'stance_through')::bigint,
         nullif(d.header->'stances', 'null'::jsonb), d.settlement, nullif(d.header->'held', 'null'::jsonb), d.decided_at
    FROM settlement_decisions d
   WHERE d.window_id = $1
  ON CONFLICT (window_id) DO NOTHING
  RETURNING id, window_id, digest, marks_digest, marks, law_sha, town_sha, world_sha, register_digest, stance_through, stances,
            sealed_settlement, held, taken_at`;

/** The saved decisions not sealed yet, in number order: the settlement crossing seals them in exactly this order. */
export const UNSEALED_DECISIONS_SQL = `
  SELECT d.window_id, d.settlement, d.day::text AS day, d.header, d.town_returns, d.decided_at
    FROM settlement_decisions d
   WHERE NOT EXISTS (SELECT 1 FROM world_snapshots s WHERE s.window_id = d.window_id)
   ORDER BY d.settlement`;

/**
 * THE HEADER, BEFORE IT IS WRITTEN: what HEADER_SQL will seal, read with the same CTEs and nothing inserted, so the clearing can
 * decide its held list over exactly the World it is about to seal (settlement-decides.mjs). Run after `sealPrepare`.
 */
const PROVISIONAL_SQL = `
  WITH ${LIST_CTES},
  heads AS (
    SELECT (SELECT sha FROM projection_heads WHERE repo = 'world-law')   AS law_sha,
           (SELECT sha FROM projection_heads WHERE repo = 'town')        AS town_sha,
           (SELECT sha FROM projection_heads WHERE repo = 'world-marks') AS world_sha,
           (SELECT max(id) FROM acts WHERE class = 'stance')             AS stance_through)
  SELECT list.marks_digest, list.marks, heads.law_sha, heads.town_sha, heads.world_sha, rlist.register_digest, heads.stance_through
    FROM list, rlist, heads`;

/**
 * Seal window `windowId`'s World. Runs on the caller's connection, inside the
 * caller's open transaction; it never begins, commits or rolls back. A failure
 * throws, and the clearing rolls the whole window back with it: the snapshot
 * and the marks it copies can never disagree.
 *
 * @param {(text: string, args?: any[]) => Promise<{rows: object[], rowCount: number}>} q
 * @param {{ windowId: number, stances?: object|null, settlement?: number|null }} o  `stances`: the decision (072),
 *   null records none; `settlement`: the number this seal IS (095, § NEXT_SETTLEMENT_SQL), null records none
 * @returns {Promise<{ id: number, digest: string, marks_digest: string, marks: number,
 *   new_versions: number, register_digest: string, register_rows: number, new_register_versions: number,
 *   law_sha: string|null, town_sha: string|null, world_sha: string|null, stance_through: string|null,
 *   sealed_settlement: number|null }>}
 */
export async function sealSnapshot(q, { windowId, stances = null, settlement = null, held = null }) {
  const prepared = await sealPrepare(q);
  return sealHeader(q, { windowId, stances, settlement, held, prepared });
}

/**
 * THE SEAL IN TWO HALVES (POS-1025: the held list is decided over the World about to be sealed, and sealed with it). `sealPrepare`
 * copies the versions and the two lists (content-addressed, so a list is the same rows whoever inserted them); `provisionalHeader`
 * answers what the header will say, inserting nothing; `sealHeader` writes it, `held` covered by its digest. `sealSnapshot` is the
 * two in a row with nothing between them, as before.
 */
export async function sealPrepare(q) {
  const versions = await q(VERSIONS_SQL);
  await q(LIST_SQL);
  const register = await q(REGISTER_VERSIONS_SQL);
  await q(REGISTER_LIST_SQL);
  return { new_versions: versions.rowCount, new_register_versions: register.rowCount };
}

/** What the header will name, read after `sealPrepare` and before `sealHeader`; nothing written. */
export async function provisionalHeader(q) {
  const { rows: [h] } = await q(PROVISIONAL_SQL);
  return h;
}

/**
 * `held`: the seal's held list (095), `[{ slug, held, ... }]`, or null/empty for none. Each entry names why (`held`), and the digest
 * names every held slug with its reason, slug order.
 */
export async function sealHeader(q, { windowId, stances = null, settlement = null, held = null, prepared = { new_versions: 0, new_register_versions: 0 } }) {
  // The digest names the number through the decision (§ THE DIGESTS), so the two must be one number.
  const list = heldListOf({ stances, settlement, held });
  const { rows: [h] } = await q(HEADER_SQL, [windowId, stances == null ? null : JSON.stringify(stances), settlement, list ? JSON.stringify(list) : null]);
  return { ...h, ...prepared };
}

/** One seal, one number, each held slug once with its reason: what a header (sealed or saved) may say. */
function heldListOf({ stances, settlement, held }) {
  if (settlement != null && stances != null && Number(stances.settlement_inferred) !== Number(settlement))
    throw new Error(`the seal is S${settlement} but its stance decision was made at S${stances.settlement_inferred}: one seal, one number`);
  const list = Array.isArray(held) && held.length ? held : null;
  if (list && list.some((e) => typeof e?.slug !== "string" || !e.slug || typeof e?.held !== "string" || !e.held))
    throw new Error("a held entry names its slug and why it is held");
  if (list && new Set(list.map((e) => e.slug)).size !== list.length) throw new Error("a slug is held once");
  return list;
}

/**
 * SAVE WHAT THE SETTLEMENT DECIDED (095 § 4; Darko 2026-11-21, POS-1025/d: "Save first, then pay"). In the clearing's own
 * transaction, after `sealPrepare`, in place of `sealHeader`: the header exactly as it will be sealed, the removal's `day` and its
 * `townReturns` (`[{ mark, leaving }]`, null for none), at the instant `at`. Committed with the window's close, so it stands before
 * any stamp moves and survives anything the settlement crossing then does; the crossing seals it (§ sealDecision) and never
 * recomputes it.
 */
export async function saveDecision(q, { windowId, stances = null, settlement, held = null, day, townReturns = null, at, prepared = { new_versions: 0, new_register_versions: 0 } }) {
  if (!Number.isInteger(Number(settlement)) || Number(settlement) < 1) throw new Error("a saved decision names the settlement it will be sealed as");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ""))) throw new Error("a saved decision names the removal's day (YYYY-MM-DD)");
  const list = heldListOf({ stances, settlement, held });
  const returns = Array.isArray(townReturns) && townReturns.length ? townReturns : null;
  const { rows: [d] } = await q(DECISION_SQL, [windowId, stances == null ? null : JSON.stringify(stances), Number(settlement),
    list ? JSON.stringify(list) : null, day, returns ? JSON.stringify(returns) : null, new Date(at).toISOString()]);
  return { ...d, ...prepared };
}

/**
 * SEAL ONE SAVED DECISION, IN NUMBER ORDER (Wright 2026-11-22 03:26Z: "the office seals the saved decisions in number order").
 * Runs in the caller's transaction, which it serializes on one advisory key, so two crossings never seal past each other. Refuses
 * (throws, writing nothing) unless `windowId`'s decision is the lowest-numbered one still unsealed. A decision already sealed
 * answers its seal again (a retry), after checking the seal says what the decision saved.
 */
export async function sealDecision(q, { windowId }) {
  await q("SELECT pg_advisory_xact_lock(hashtext('settlement-seal:in-order'))");
  const { rows: [d] } = await q("SELECT window_id, settlement, header FROM settlement_decisions WHERE window_id = $1", [windowId]);
  if (!d) throw Object.assign(new Error(`window ${windowId} has no saved decision to seal`), { reason: "no-decision" });
  const { rows: [first] } = await q(`${UNSEALED_DECISIONS_SQL} LIMIT 1`);
  if (first && Number(first.window_id) !== Number(windowId)) {
    if (Number(first.settlement) < Number(d.settlement))
      throw Object.assign(new Error(`S${d.settlement} (window ${windowId}) waits for S${first.settlement} (window ${first.window_id}), which is not sealed yet: seals land in number order`), { reason: "out-of-order" });
  }
  const { rows: [h] } = await q(SEAL_DECISION_SQL, [windowId]);
  if (h) return { ...h, sealed_now: true };
  const { rows: [was] } = await q("SELECT id, window_id, digest, marks_digest, marks, law_sha, town_sha, world_sha, register_digest, stance_through, stances, sealed_settlement, held, taken_at FROM world_snapshots WHERE window_id = $1", [windowId]);
  const header = typeof d.header === "string" ? JSON.parse(d.header) : d.header;
  if (!was || was.digest !== header.digest || Number(was.sealed_settlement) !== Number(d.settlement))
    throw Object.assign(new Error(`window ${windowId} is sealed as ${was?.digest?.slice(0, 12) ?? "?"} (S${was?.sealed_settlement ?? "?"}), not as its saved decision ${String(header.digest).slice(0, 12)} (S${d.settlement})`), { reason: "seal-disagrees" });
  return { ...was, sealed_now: false };
}

/**
 * THE NUMBER THIS SEAL IS (095; Darko 2026-11-13, POS-1025/a "Every settlement"): the greatest number the
 * store has ever named, sealed, saved (a decision not sealed yet: Wright 2026-11-22 03:26Z, "numbering and
 * previous-state reads include the saved decisions") or tag-read, plus one. Asked by the clearing inside its own transaction,
 * after the candle lock, so two clearings never read the same greatest; a clearing that rolls back takes
 * no number. Every seal is numbered, a quiet one included. One statement, no engine: the seal's own rule.
 */
export const NEXT_SETTLEMENT_SQL = `
  SELECT greatest(coalesce((SELECT max(sealed_settlement) FROM world_snapshots), 0),
                  coalesce((SELECT max(settlement) FROM settlement_decisions), 0),
                  coalesce((SELECT max(number) FROM settlements), 0)) + 1 AS next`;
