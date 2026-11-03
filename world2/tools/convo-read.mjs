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
// An aggregate (row count, STORED payload bytes, string-payload count, max id, a digest of the ids and
// instants) is read first, over at most `limit + 1` rows. If it passes a budget the answer is `over-budget`
// and no body is read. `pg_column_size` is the stored size: it does not decompress.
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

/** Bump when the SQL predicate, the JS guard contract or the row→voice decoding changes. Part of every fingerprint. */
export const ELIGIBILITY_VERSION = "pos779-e1";

/**
 * The budgets, with the reason for each number. They are engineering bounds, not law, and none of them is an
 * environment switch.
 *   maxRows         eligible say rows per epoch. The reported 32,000-voice invented epochs are the target;
 *                   64,000 is twice that. Reading them is one index range (measured 20-26 ms at 32k).
 *   maxBytes        STORED payload bytes of those rows. 32k invented says are ~7 MB as JSON; 48 MB covers
 *                   64k rows at the 500-character text limit with room to spare.
 *   maxEmissionRows the crystallized set is closed (1,630 rows at the seed). 20,000 is >12x that; past it the
 *   maxEmissionBytes read says so instead of reading on.
 *   maxStringPayloadRows  payloads stored as a JSON string. The SQL port parses them, so these are rare; the
 *                   cap bounds the JS re-check of a source that is mostly such rows.
 *   statementTimeoutMs  the poll's own per-statement bound (server.mjs STORE_READ_BOUND_MS = 10 s).
 */
export const BUDGETS = Object.freeze({
  maxRows: 64_000,
  maxBytes: 48 * 1024 * 1024,
  maxEmissionRows: 20_000,
  maxEmissionBytes: 16 * 1024 * 1024,
  maxStringPayloadRows: 512,
  statementTimeoutMs: 10_000,
});

/** The predicate 089's index carries. A query uses the index only when it repeats this text. */
export const PUBLIC_VOICE_PREDICATE = "action IN ('say', 'legacy:emission', 'emission') AND NOT voice_payload_private(payload)";

const EMISSION_WHERE = `${PUBLIC_VOICE_PREDICATE} AND action IN ('legacy:emission', 'emission')`;
const sayWhere = (bounded) =>
  `${PUBLIC_VOICE_PREDICATE} AND action = 'say' AND at >= $1::timestamptz${bounded ? " AND at < $2::timestamptz" : ""}`;

const DIGEST_ITEM = "id::text || '@' || to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US')";
const AGGREGATE = (where, limitParam) => `
  SELECT count(*)::int AS n,
         coalesce(sum(pg_column_size(payload)), 0)::bigint AS bytes,
         (count(*) FILTER (WHERE jsonb_typeof(payload) = 'string'))::int AS strings,
         coalesce(max(id), 0)::text AS max_id,
         md5(coalesce(string_agg(${DIGEST_ITEM}, ',' ORDER BY at, id), '')) AS digest
    FROM (SELECT id, at, payload FROM acts WHERE ${where} LIMIT ${limitParam}) s`;
const ROWS = (where, limitParam) =>
  `SELECT id, at, actor, action, at_anchor, at_dx, at_dy, payload FROM acts WHERE ${where} LIMIT ${limitParam}`;

/** The queries, exported so a test can EXPLAIN exactly what is sent. */
export const SQL = Object.freeze({
  saysAggregate: (bounded) => AGGREGATE(sayWhere(bounded), bounded ? "$3::int" : "$2::int"),
  saysRows: (bounded) => ROWS(sayWhere(bounded), bounded ? "$3::int" : "$2::int"),
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
  const r = voiceOf(row, centreOf);
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
 *
 * Answers `{ status: "ok", ... }` or `{ status: "unavailable", reason }`, reason one of:
 *   over-budget (with `what`, `measured`, `limit`), timeout, edges-moved, unreadable-acts, store-unreadable.
 */
export async function readEpoch(pool, { epoch, isPrivate, edgesOf = null, memo = null, budgets = {} } = {}) {
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

      // 3 · the bodies
      const { rows: sayRows } = await q(SQL.saysRows(bounded), [...sayParams, B.maxRows + 1]);
      const { rows: emiRows } = emi.n ? await q(SQL.emissionsRows, [B.maxEmissionRows + 1]) : { rows: [] };

      // 4 · only the anchors the says reference
      const anchors = [...new Set(sayRows.map((r) => r.at_anchor).filter((a) => a && a !== "world"))];
      const { centres, digest: anchorsDigest } = await centreDigest(anchors);
      const key = sha(...base, anchorsDigest);

      // 5 · JS eligibility on every raw row, then the one mapping
      const voices = [];
      const refusals = [];
      const unplaced = [];
      const eras = { crystallized: 0, live: 0 };
      let nonSound = 0, jsPrivate = 0;
      const place = (row) => {
        if (isPrivate(row)) { jsPrivate += 1; return; }
        const r = exactVoiceOf(row, (id) => centres.get(id) ?? null);
        if (r.skip) { nonSound += 1; return; }
        if (r.refused) { refusals.push(r.reason); return; }
        if (r.unplaced) { unplaced.push({ act_id: r.act_id, anchor: r.anchor }); return; }
        if (!(r.voice.at >= since && (next === null || r.voice.at < next))) return;
        eras[r.era] += 1;
        voices.push({ ...r.voice, era: r.era });
      };
      for (const row of sayRows) place(row);
      for (const row of emiRows) place(row);
      if (refusals.length) return unavailable("unreadable-acts", { count: refusals.length, example: refusals[0] });
      voices.sort(compareVoices);
      return { status: "ok", from: "store", key, edges_version: edgesBefore, epoch: { since, next }, earshotM, dials: dialsView, anchors,
        voices, eras, unplaced, non_sound_emissions: nonSound, js_private_dropped: jsPrivate,
        source: { says: { rows: say.n, bytes: Number(say.bytes), strings: say.strings }, emissions: { rows: emi.n, bytes: Number(emi.bytes), strings: emi.strings } } };
    }, { statementTimeoutMs: B.statementTimeoutMs });
  } catch (e) {
    if (e?.code === "57014") return unavailable("timeout", { limit_ms: B.statementTimeoutMs });
    return unavailable("store-unreadable", { code: e?.code ?? null });
  }
  if (result.status === "ok" && edgesOf) {
    const edgesAfter = String(edgesOf()?.version ?? "");
    if (edgesAfter !== edgesBefore) return unavailable("edges-moved", { from: edgesBefore, to: edgesAfter });
  }
  return result;
}
