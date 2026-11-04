// convo-read.mjs — ONE SETTLEMENT'S PUBLIC VOICES, READ EXACTLY AND WITH A WORK BOUND (POS-779).
//
// STATUS: UNWIRED. Nothing in src/ imports this yet. It is the durable read the conversation page will stand on
// once the doors are switched to it; this phase builds and proves it on invented data only.
//
// WHAT IT ANSWERS. Given the edges of one settlement (`since` and `next`, both ms, `next` null for the open
// one), it returns every PUBLIC voice whose logical instant lies in [since, next), as voice records the
// vendored fold and the exact component builder read, or it answers "unavailable" with the reason. It never
// returns a partial epoch as if it were whole, and it never reads older history (the index range is the epoch).
//
// ── ONE SNAPSHOT ────────────────────────────────────────────────────────────
// Rows, emissions, anchors and dials are read on ONE pooled client in ONE `REPEATABLE READ READ ONLY`
// transaction, under `SET LOCAL statement_timeout`. (`Promise.all` over two pool connections is two snapshots.)
// A timeout is an honest "unavailable", not a short answer.
//
// ── LOGICAL TIME ────────────────────────────────────────────────────────────
// A voice's instant, in whole milliseconds:
//   * a live `say`: its row's `at`. node-postgres hands a timestamptz back as a Date that KEEPS milliseconds;
//     `voiceOf` (conversations.mjs) runs `Date.parse` on it, which reads the Date's string form and floors it
//     to the second. `exactVoiceOf` below keeps voiceOf's one mapping and puts the exact millisecond back.
//   * a crystallized emission: its own `payload.at` (what the crossing log froze), else the row's `at`.
//     That need not equal `acts.at`, so emissions are NOT placed by an index range on `at`. They are a closed
//     historical set: read behind a count and byte fuse, placed by their effective time here, and counted in the
//     fingerprint. (An index on `at` alone would drop the emission born in this epoch but written after it.)
// Ids are bigints and travel as decimal strings; they are ordered numerically, never as doubles.
//
// ── ELIGIBILITY BEFORE ANYTHING IS COUNTED ──────────────────────────────────
// A voice spoken inside a room is private. The SQL predicate (089: `NOT voice_payload_private(payload)`) hides
// only rows it can prove private, on the RAW payload, so a private flood spends no budget, joins no group,
// moves no count, fingerprint, cursor or position. The caller's JS guard (`isPrivate`, the real `spokenInRoom`)
// then checks every row again, as the defense it is. A private row never reaches `voiceOf`, whose output
// drops `room`.
//
// ── WORK AND BYTES ARE MEASURED BEFORE BODIES ARE SHIPPED ────────────────────
// An aggregate (row count, DECODED payload bytes, string-payload count, max id, a digest of the ids and
// instants) is read first, over at most `limit + 1` rows, in the same REPEATABLE READ snapshot and inside the
// statement timeout. If it passes a budget the answer is `over-budget` and no body is read.
//
// UNIT of `bytes`: `octet_length(payload::text)`, the UTF-8 length of the jsonb text Postgres sends for that
// column, which is the text node-pg then parses. It is computed server-side, so the server detoasts and
// decompresses at most `limit + 1` payloads to measure them (bounded by the row cap and the timeout) and ships
// none. It counts the payload column only: the other columns of a row are short fixed-role strings and are not
// in the unit. It is NOT a heap or RSS bound for the server or for JS.
// `stored_bytes` (`pg_column_size`) is the stored, possibly compressed size. It is a labelled DIAGNOSTIC only
// (reported in `source`, never compared with a budget, never in the fingerprint): a compressible payload is a
// fraction of its decoded size, so a stored-size fuse would admit a read far over the budget.
//
// ── THE FINGERPRINT ─────────────────────────────────────────────────────────
// Everything that can change a membership or a rendering, read in the same snapshot: the epoch, the edges
// version the caller read, the earshot (and the other dials), the eligibility/decoder version, the database
// name, the aggregates and digests of both row sets, and the composed centre of every referenced anchor.
// A count alone would miss a moved anchor or a reseeded source. `acts` is append-only (trigger
// `acts_append_only`), which is what makes count + bytes + the id/instant digest a faithful source identity;
// a reset or restore changes the digest or the count.

import { createHash } from "node:crypto";
import { voiceOf, sayDials, anchorCentres } from "./conversations.mjs";
import { makeSlicer } from "./convo-slice.mjs";

/** Bump when the SQL predicate, the JS guard contract or the row→voice decoding changes. Part of every fingerprint. */
export const ELIGIBILITY_VERSION = "pos779-e1";

/**
 * The budgets, with the reason for each number. They are engineering bounds, not law, and none of them is an
 * environment switch.
 *   maxRows         eligible say rows per epoch. The reported 32,000-voice invented epochs are the target;
 *                   64,000 is twice that. Reading them is one index range (measured 20-26 ms at 32k).
 *   maxBytes        DECODED payload bytes (octet_length of the jsonb text) of those rows, not stored size.
 *                   32k invented says are ~7 MB as JSON; 48 MB covers 64k rows at about 750 bytes each. A payload
 *                   the producer's text dial lets reach ~2 KB each would NOT fit 64k rows: that read is refused,
 *                   by design, rather than shipped.
 *   maxEmissionRows the crystallized set is closed (1,630 rows at the seed). 20,000 is >12x that; past it the
 *   maxEmissionBytes read says so instead of reading on.
 *   maxStringPayloadRows  payloads stored as a JSON string. The SQL port parses them, so these are rare; the
 *                   cap bounds the JS re-check of a source that is mostly such rows.
 *   statementTimeoutMs  the poll's own per-statement bound (server.mjs STORE_READ_BOUND_MS = 10 s).
 *   fetchChunk       rows per FETCH of the bodies (2,000: about 8 ms of driver parsing a fetch, measured; not a row cap, a chunk size)
 */
export const BUDGETS = Object.freeze({
  maxRows: 64_000,
  maxBytes: 48 * 1024 * 1024,
  maxEmissionRows: 20_000,
  maxEmissionBytes: 16 * 1024 * 1024,
  maxStringPayloadRows: 512,
  statementTimeoutMs: 10_000,
  fetchChunk: 2_000,
});

/** The predicate 089's index carries. A query uses the index only when it repeats this text. */
export const PUBLIC_VOICE_PREDICATE = "action IN ('say', 'legacy:emission', 'emission') AND NOT voice_payload_private(payload)";

const EMISSION_WHERE = `${PUBLIC_VOICE_PREDICATE} AND action IN ('legacy:emission', 'emission')`;
const sayWhere = (bounded) =>
  `${PUBLIC_VOICE_PREDICATE} AND action = 'say' AND at >= $1::timestamptz${bounded ? " AND at < $2::timestamptz" : ""}`;

const DIGEST_ITEM = "id::text || '@' || to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US')";
const AGGREGATE = (where, limitParam) => `
  SELECT count(*)::int AS n,
         coalesce(sum(octet_length(payload::text)), 0)::bigint AS bytes,
         coalesce(sum(pg_column_size(payload)), 0)::bigint AS stored_bytes,
         (count(*) FILTER (WHERE jsonb_typeof(payload) = 'string'))::int AS strings,
         coalesce(max(id), 0)::text AS max_id,
         md5(coalesce(string_agg(${DIGEST_ITEM}, ',' ORDER BY at, id), '')) AS digest
    FROM (SELECT id, at, payload FROM acts WHERE ${where} LIMIT ${limitParam}) s`;
const ROWS = (where, limitParam, order = "") =>
  `SELECT id, at, actor, action, at_anchor, at_dx, at_dy, payload FROM acts WHERE ${where}${order} LIMIT ${limitParam}`;

/** The queries, exported so a test can EXPLAIN exactly what is sent. */
export const SQL = Object.freeze({
  saysAggregate: (bounded) => AGGREGATE(sayWhere(bounded), bounded ? "$3::int" : "$2::int"),
  // ORDER BY at, id is the index's own order for a say range (action, at, id): no sort node, and the interpreter below can merge instead of sorting 32k voices
  saysRows: (bounded) => ROWS(sayWhere(bounded), bounded ? "$3::int" : "$2::int", " ORDER BY at, id"),
  emissionsAggregate: AGGREGATE(EMISSION_WHERE, "$1::int"),
  emissionsRows: ROWS(EMISSION_WHERE, "$1::int"),
  anchors: "SELECT slug, status, geometry, data FROM marks WHERE slug = ANY($1::text[])",
  dials: "SELECT slug, status, geometry, data FROM marks WHERE status = 'standing' AND (data->>'_parent_is_law' = 'the-town/say' OR data->>'_parentMarkId' = 'the-town/say')",
  database: "SELECT current_database() AS db",
});

const sha = (...parts) => createHash("sha256").update(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join("\u0001")).digest("hex");

// ═════════════════════════════════════════════════════════════════════
// logical time, and the one mapping with the instant put back
// ═════════════════════════════════════════════════════════════════════

/** A timestamp as whole milliseconds. A Date keeps its milliseconds (Date.parse(Date) would floor to the second). */
export function instantMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return Date.parse(v);
}

/**
 * A voice row's logical instant in ms, or NaN. A `say` is its row's `at`; an emission is `payload.at` read the
 * way `voiceOf` reads it, else the row's `at` with its milliseconds.
 */
export function logicalMsOf(row) {
  const action = String(row?.action ?? "");
  if (action === "say") return instantMs(row.at);
  const p = row?.payload;
  if (p?.at != null) return Date.parse(p.at);
  return instantMs(row?.at);
}

/** `voiceOf`'s result with the exact millisecond: the one say→voice mapping, never a second. */
export function exactVoiceOf(row, centreOf = null) {
  // `voiceOf` reads a say's instant with Date.parse(row.at); handed a Date that is a round trip through the long locale
  // string (the slowest line of the interpretation at 32k). Its result is overwritten with the exact millisecond below,
  // so for a say with a valid Date it is handed the same instant as ISO text for the duration of the call, and the row
  // is put back. Any other row (an invalid Date included) takes the original road unchanged.
  const at = row?.at;
  let r;
  if (at instanceof Date && row.action === "say" && Number.isFinite(at.getTime())) {
    row.at = at.toISOString();
    try { r = voiceOf(row, centreOf); } finally { row.at = at; }
  } else r = voiceOf(row, centreOf);
  if (r.voice) {
    const ms = logicalMsOf(row);
    if (Number.isFinite(ms)) r.voice.at = ms;
  }
  return r;
}

/** Order two decimal-string ids numerically without a double or a BigInt (canonical decimals: no leading zeros). */
export function compareIds(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The total order of voices: logical ms, then act id numerically. */
export const compareVoices = (a, b) => (a.at - b.at) || compareIds(a.act_id, b.act_id);

/**
 * The epoch an instant belongs to, from the published edges (ms, any order) the caller read.
 * Outside what the edges can say it answers "unavailable", never "all history" or "no earlier":
 *   no edge at or before the instant  ->  `edges-unknown`
 * An epoch's `next` is the following edge, or null for the newest (still open).
 */
export function epochFor(edges, atMs) {
  const list = (edges ?? []).filter(Number.isFinite).sort((a, b) => a - b);
  let since = null, next = null;
  for (const e of list) {
    if (e <= atMs) since = e;
    else { next = e; break; }
  }
  if (since === null) return { unavailable: "edges-unknown" };
  return { since, next };
}

// ═════════════════════════════════════════════════════════════════════
// one snapshot
// ═════════════════════════════════════════════════════════════════════

/**
 * Run `fn(client)` on ONE checked-out client inside `REPEATABLE READ READ ONLY`, with a statement timeout, and
 * hand the client back on every path. A failed ROLLBACK discards the connection (store-pool.mjs § onPenClient's
 * rule) and the client has its own 'error' listener while it is out.
 */
export async function withSnapshot(pool, fn, { statementTimeoutMs = BUDGETS.statementTimeoutMs } = {}) {
  const client = await pool.connect();
  let discard = false;
  const heard = () => { discard = true; };
  client.on?.("error", heard);
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query(`SET LOCAL statement_timeout = '${Math.max(1, Math.trunc(Number(statementTimeoutMs)))}ms'`);
    const out = await fn(client);
    await client.query("ROLLBACK");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { discard = true; }
    throw e;
  } finally {
    client.removeListener?.("error", heard);
    client.release(discard ? true : undefined);
  }
}

const unavailable = (reason, detail = {}) => ({ status: "unavailable", reason, ...detail });

/**
 * Read one epoch.
 *
 *   pool       the serve pool (`connect()`); one client is taken
 *   epoch      { since, next }  ms; next null = the open epoch
 *   isPrivate  the real `spokenInRoom` (row => boolean): required, never copied here
 *   edgesOf    () => { version: string }  the caller's published-sweep view; read before AND after the snapshot,
 *              and a different version answers `edges-moved` (the caller refreshes), never a mixed answer
 *   memo       optional { lookup(epochId, key), peek(epochId) } — see convo-memo.mjs
 *   budgets    overrides of BUDGETS
 *   slice      { ms, now, yieldFn }: how long the interpretation of the rows may hold the event loop before it gives it back
 *
 * Answers `{ status: "ok", ... }` or `{ status: "unavailable", reason }`, reason one of:
 *   over-budget (with `what`, `measured`, `limit`), timeout, edges-moved, unreadable-acts, store-unreadable.
 */
export async function readEpoch(pool, { epoch, isPrivate, edgesOf = null, memo = null, budgets = {}, slice = {} } = {}) {
  if (typeof isPrivate !== "function") throw new TypeError("readEpoch needs the JS eligibility guard (spokenInRoom) — the SQL port is a prefilter, not the rule");
  const B = { ...BUDGETS, ...budgets };
  const since = Number(epoch?.since);
  const next = epoch?.next == null ? null : Number(epoch.next);
  if (!Number.isFinite(since) || (next !== null && !(Number.isFinite(next) && next > since))) return unavailable("bad-epoch");
  const bounded = next !== null;
  const epochId = `${since}:${next ?? "open"}`;
  const edgesBefore = edgesOf ? String(edgesOf()?.version ?? "") : "";

  let result;
  try {
    result = await withSnapshot(pool, async (client) => {
      const q = (text, params) => client.query(text, params);
      const { rows: [{ db }] } = await q(SQL.database);

      // 1 · measure, before any body is shipped
      const sayParams = bounded ? [new Date(since).toISOString(), new Date(next).toISOString()] : [new Date(since).toISOString()];
      const { rows: [say] } = await q(SQL.saysAggregate(bounded), [...sayParams, B.maxRows + 1]);
      if (say.n > B.maxRows) return unavailable("over-budget", { what: "rows", measured: say.n, limit: B.maxRows });
      if (Number(say.bytes) > B.maxBytes) return unavailable("over-budget", { what: "bytes", measured: Number(say.bytes), limit: B.maxBytes });
      if (say.strings > B.maxStringPayloadRows) return unavailable("over-budget", { what: "string-payload rows", measured: say.strings, limit: B.maxStringPayloadRows });
      const { rows: [emi] } = await q(SQL.emissionsAggregate, [B.maxEmissionRows + 1]);
      if (emi.n > B.maxEmissionRows) return unavailable("over-budget", { what: "emission rows", measured: emi.n, limit: B.maxEmissionRows });
      if (Number(emi.bytes) > B.maxEmissionBytes) return unavailable("over-budget", { what: "emission bytes", measured: Number(emi.bytes), limit: B.maxEmissionBytes });
      if (emi.strings > B.maxStringPayloadRows) return unavailable("over-budget", { what: "emission string-payload rows", measured: emi.strings, limit: B.maxStringPayloadRows });

      // 2 · the dials and the anchors the memoized epoch referenced, for the memo's key
      const { rows: dialRows } = await q(SQL.dials);
      const dials = sayDials(dialRows);
      const earshotM = dials.earshot_m.value;
      const dialsView = Object.fromEntries(Object.entries(dials).map(([k, d]) => [k, { value: d.value, source: d.source }]));
      const base = [ELIGIBILITY_VERSION, db, since, next, edgesBefore, earshotM, dialsView,
        say.n, say.bytes, say.max_id, say.digest, emi.n, emi.bytes, emi.max_id, emi.digest];
      const centreDigest = async (slugs) => {
        const sorted = [...new Set(slugs)].sort();
        const { rows } = sorted.length ? await q(SQL.anchors, [sorted]) : { rows: [] };
        const centres = anchorCentres(rows);
        return { centres, digest: sha(sorted.map((s) => [s, centres.get(s) ?? null])) };
      };
      const prior = memo?.peek?.(epochId) ?? null;
      if (prior) {
        const { digest } = await centreDigest(prior.anchors);
        const key = sha(...base, digest);
        const hit = memo.lookup(epochId, key);
        if (hit) return { status: "ok", from: "memo", key, epoch: { since, next }, earshotM, dials: dialsView, value: hit };
      }

      // 3 · the bodies, fetched in chunks from a cursor in THIS snapshot (same client, same transaction, same statement
      //     timeout per fetch, the same LIMIT as the aggregate): one 32,000-row result parsed in one go is a 60-70 ms
      //     stretch of the event loop in the driver; sixteen fetches of 2,000 are not.
      const sayRows = await fetchChunked(client, "convo_says", SQL.saysRows(bounded), [...sayParams, B.maxRows + 1], B.fetchChunk);
      const emiRows = emi.n ? await fetchChunked(client, "convo_emissions", SQL.emissionsRows, [B.maxEmissionRows + 1], B.fetchChunk) : [];

      // 4 · only the anchors the says reference
      const anchors = [...new Set(sayRows.map((r) => r.at_anchor).filter((a) => a && a !== "world"))];
      const { centres, digest: anchorsDigest } = await centreDigest(anchors);
      const key = sha(...base, anchorsDigest);
      return { status: "rows", key, anchors, centres, sayRows, emiRows, earshotM, dialsView, say, emi };
    }, { statementTimeoutMs: B.statementTimeoutMs });
    if (result.status === "rows") result = await interpret(result);
  } catch (e) {
    if (e?.code === "57014") return unavailable("timeout", { limit_ms: B.statementTimeoutMs });
    return unavailable("store-unreadable", { code: e?.code ?? null });
  }
  if (result.status === "ok" && edgesOf) {
    const edgesAfter = String(edgesOf()?.version ?? "");
    if (edgesAfter !== edgesBefore) return unavailable("edges-moved", { from: edgesBefore, to: edgesAfter });
  }
  return result;

  // 5 · AFTER the snapshot is released: JS eligibility on every raw row, then the one mapping, a slice at a time
  async function interpret({ key, anchors, centres, sayRows, emiRows, earshotM, dialsView, say, emi }) {
    const refusals = [];
    const unplaced = [];
    const eras = { crystallized: 0, live: 0 };
    let nonSound = 0, jsPrivate = 0;
    const place = (row, into) => {
      if (isPrivate(row)) { jsPrivate += 1; return; }
      const r = exactVoiceOf(row, (id) => centres.get(id) ?? null);
      if (r.skip) { nonSound += 1; return; }
      if (r.refused) { refusals.push(r.reason); return; }
      if (r.unplaced) { unplaced.push({ act_id: r.act_id, anchor: r.anchor }); return; }
      if (!(r.voice.at >= since && (next === null || r.voice.at < next))) return;
      eras[r.era] += 1;
      r.voice.era = r.era; // the voice is this call's own fresh object: no copy per voice
      into.push(r.voice);
    };
    const slicer = makeSlicer(slice);
    const sayVoices = [], emiVoices = [];
    for (let i = 0; i < sayRows.length; i++) { place(sayRows[i], sayVoices); if ((i & 31) === 31) await slicer.maybeYield(); }
    for (let i = 0; i < emiRows.length; i++) { place(emiRows[i], emiVoices); if ((i & 31) === 31) await slicer.maybeYield(); }
    if (refusals.length) return unavailable("unreadable-acts", { count: refusals.length, example: refusals[0] });
    // The says came in (at, id) order and an emission's logical instant is its own, so: sort the (few) emissions, CHECK that
    // the says really are in the order the comparator wants (the index's order, but the proof is the check), and MERGE. A
    // list that fails the check is sorted whole, so a plan that did not hand back the index order costs time, never order.
    if (!(await isSorted(sayVoices, slicer))) sayVoices.sort(compareVoices);
    emiVoices.sort(compareVoices);
    const voices = [];
    for (let a = 0, b = 0; a < sayVoices.length || b < emiVoices.length; ) {
      if (b >= emiVoices.length || (a < sayVoices.length && compareVoices(sayVoices[a], emiVoices[b]) <= 0)) voices.push(sayVoices[a++]); else voices.push(emiVoices[b++]);
      if ((voices.length & 255) === 0) await slicer.maybeYield();
    }
    return { status: "ok", from: "store", key, edges_version: edgesBefore, epoch: { since, next }, earshotM, dials: dialsView, anchors,
      voices, eras, unplaced, non_sound_emissions: nonSound, js_private_dropped: jsPrivate,
      source: { says: { rows: say.n, bytes: Number(say.bytes), stored_bytes: Number(say.stored_bytes), strings: say.strings },
        emissions: { rows: emi.n, bytes: Number(emi.bytes), stored_bytes: Number(emi.stored_bytes), strings: emi.strings } } };
  }
}

/**
 * The bodies of one bounded query, in chunks, from a cursor on the snapshot's own client. A cursor is declared and
 * fetched inside the open transaction, so every chunk sees the snapshot the aggregate measured, and the query keeps the
 * very LIMIT that made the aggregate a fuse. Each `FETCH` is its own statement under the transaction's statement timeout.
 */
async function fetchChunked(client, name, text, params, chunk) {
  await client.query(`DECLARE ${name} NO SCROLL CURSOR FOR ${text}`, params);
  const rows = [];
  for (;;) {
    const { rows: part } = await client.query(`FETCH FORWARD ${chunk} FROM ${name}`);
    for (let i = 0; i < part.length; i++) rows.push(part[i]);
    if (part.length < chunk) break;
  }
  await client.query(`CLOSE ${name}`);
  return rows;
}

async function isSorted(list, slicer) {
  for (let i = 1; i < list.length; i++) {
    if (compareVoices(list[i - 1], list[i]) > 0) return false;
    if ((i & 1023) === 0) await slicer.maybeYield();
  }
  return true;
}
