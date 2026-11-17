// refusal-log.mjs — A REFUSED ACT LEAVES A PRIVATE TRACE (POS-1003).
//
// WHY: Darko, 2026-11-11 13:41 EST: "I think probably refusals should be written
// down somewhere. If not publicly, then just in telemetry so that we can see."
// Reading Halloween week for Episode 2, the town could not say whether a resident
// had tried to give sweets back and been refused before the give that worked on
// 10-29, because a refused act wrote nothing anywhere.
//
// RULED (Darko, 2026-11-13 15:0x EST, batch 2): "Private log, own refusals
// visible". When a door refuses a resident's act, it records who tried which act,
// on what, when, and the refusal's code and words. The record is kept privately
// for 90 days and never goes on the public record. A resident can read their own
// refusals through their household read, and nobody else's.
//
// ── WHERE IT IS TAKEN: THE TWO PLACES AN ANSWER LEAVES THE OFFICE ───────────
//
// Acts are refused in a hundred places, and every one of them ends in one of two
// writers: the MCP door's handleMcp (every `tools/call`, the flat tools and the
// three apexes alike, the door's own gates included) and REST's `j` (every plain
// route). Each calls `noteRefusal` once, with the answer it is about to send. Nothing
// is recorded where a refusal is built, so a new refusal is recorded without
// anyone remembering to.
//
// ── WHAT IS RECORDED, AND WHAT IS NOT ───────────────────────────────────────
//
//   · An ACT: a write-shaped call (mcp.mjs § writeShaped) or a plain-HTTP write
//     (POST, PUT, PATCH, DELETE). A refused read is not an act.
//   · A REFUSAL: a bounce. A 5xx is the office's own fault, not a refusal of the
//     act, a 429 is the rate limit, charged before the act is looked at, and a 413 is a
//     body refused unread, so no act was seen; none of the three is recorded. A bounce
//     that names no code is recorded with none.
//   · A KNOWN HOUSEHOLD: a call whose key resolves to no household has no one to
//     read it back to, so nothing is kept.
//   · "ON WHAT" is the call's identifying fields only (TARGET_FIELDS), each cut to
//     TARGET_VALUE_MAX characters. A body, a text, a note or any field not on the
//     list is never copied, so a letter's words are never kept here.
//   · The words are the refusal's own `defect` and `hint`, cut. They can echo what
//     the resident sent, and they are kept for the resident alone.
//
// THE RECORD NEVER CHANGES AN ANSWER, AND NEITHER HOOK EVER THROWS. `noteMcpRefusal`
// and `noteRestRefusal` sit on the only two places an answer leaves, and a call is a
// caller's JSON (`{"toString":1}` throws when stringified), so both are total: a name
// comes only from a string or a number, and each body is inside a try/catch that says
// the failure once a minute and returns. `recordRefusal` never throws either. The record
// is taken after the answer is built, in the background, at most INFLIGHT_MAX at once
// (a burst keeps the first few and counts the rest), and a store that is absent,
// unreachable or not yet migrated costs the record and nothing else.
//
// WHO READS A ROW: the resident's own key. A key reads the rows of the residents it
// holds (a row names its resident; a row no resident could be named for, from a key
// holding several, is read only by a key that holds all of those residents). Not the house's.

import { officeRead, officeWrite } from "./world2-pen.mjs";
import { keyHouseholdOf } from "./world2-claims.mjs";
import { isHttpStatus } from "./fault-words.mjs";
import { refuse } from "./events.mjs";

/** How long a refusal is kept (Darko, 2026-11-13): migration 098 and the read both say it. */
export const RETENTION_DAYS = 90;
/** The most rows one read answers. */
export const READ_MAX = 200;
export const READ_DEFAULT = 50;
export const TARGET_VALUE_MAX = 80;
export const DEFECT_MAX = 400;
export const HINT_MAX = 600;
export const ACT_MAX = 80;
const TARGET_KEYS_MAX = 8;

/** The fields that say what an act was aimed at. A field that is not here is never copied. */
export const TARGET_FIELDS = Object.freeze([
  "to", "from", "mark_id", "mark", "id", "letter", "household", "handle", "slug", "class", "kind",
  "item", "thing", "what", "bowl", "holder", "target", "parcel", "room", "place", "door", "x", "y",
  "event", "pot", "quest", "stance",
]);

export const REFUSALS_NOTE = `private to the residents your key holds: the town keeps no public record of a refusal. Each row is an act a door refused, who tried it, on what, when and the refusal's own words; rows are kept ${RETENTION_DAYS} days`;

// ── the shape of what is recorded ────────────────────────────────────────────

// A NAME ONLY EVER COMES FROM A STRING OR A NUMBER. A call is a caller's JSON: `{"toString":1}` throws when
// it is stringified, and a hook that threw would keep the answer from leaving (POS-1003, the review of #1074).
const nameOf = (v) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const cut = (v, n) => { const t = nameOf(v); return t == null ? null : t.slice(0, n); };
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

/** Which act, by name: an apex's `do:` as `<apex>:<do>`, a flat tool by its own name, a REST route by its method and path. */
export function actOf(name, args) {
  const did = isObj(args) ? nameOf(args.do) : null;
  const apex = ["world", "household", "town"].includes(name) && did != null && did !== "";
  const raw = apex ? `${name}:${did}` : (nameOf(name) ?? "");
  return raw.replace(/[^A-Za-z0-9_:\-./ {}]/g, "?").slice(0, ACT_MAX);
}

/** "On what": the identifying fields of a call, from its top level and its `args` envelope. A pure function of the call. */
export function targetOf(args) {
  const out = {};
  const sources = [isObj(args) ? args : {}, isObj(args?.args) ? args.args : {}];
  for (const src of sources) {
    for (const f of TARGET_FIELDS) {
      if (Object.keys(out).length >= TARGET_KEYS_MAX) return out;
      if (Object.hasOwn(out, f) || !Object.hasOwn(src, f)) continue;
      const v = src[f];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[f] = String(v).slice(0, TARGET_VALUE_MAX);
    }
  }
  return out;
}

/** True for a refusal this log keeps: a bounce that is not the office's own fault (5xx) and not the rate limit (429). */
export function isKept(code) {
  if (code == null) return true;
  if (!isHttpStatus(code)) return false;
  // 413: the body was refused unread, so no act was ever seen to name (body-limits-loopback holds that a too-large body changes no table)
  return code >= 400 && code < 500 && code !== 429 && code !== 413;
}

/** The refusal a JSON-RPC answer carries, `{ code, defect, hint }`, or null when it does not refuse as a tool result. */
export function refusalInReply(reply) {
  if (reply?.result?.isError !== true) return null;
  let body = null;
  try { body = JSON.parse(reply.result.content?.[0]?.text ?? "null"); } catch { return null; }
  if (!isObj(body) || body.error !== "bounce") return null;
  return { code: isHttpStatus(body.code) ? body.code : null, defect: cut(body.defect, DEFECT_MAX), hint: cut(body.hint, HINT_MAX) };
}

/** The residents a key holds, as names. */
export const heldHandles = (key) => [...(key?.handles ?? [])].map(nameOf).filter((h) => h != null && h !== "");

/** The resident who tried: the call's own `handle` when the key holds it, else the key's only resident. */
export function actorHandle(key, args) {
  const held = heldHandles(key);
  const named = (nameOf(isObj(args?.args) ? args.args.handle : null) || nameOf(isObj(args) ? args.handle : null) || "").trim();
  if (named && held.includes(named)) return named;
  return held.length === 1 ? held[0] : null;
}

// ── the writer ───────────────────────────────────────────────────────────────

const PRUNE_EVERY_MS = 3_600_000;
let lastPrune = 0;
let absentSaid = false;
const inflight = new Set();
let skipped = 0;
/** How many refusals are kept at once (the pen's pool holds three connections). */
export const INFLIGHT_MAX = 2;
const HELD_MAX = 20;

/** Test seam: forget the prune clock, the said-once flags and the counts. */
export function __resetForTest() { lastPrune = 0; absentSaid = false; skipped = 0; lastSaid = 0; inflight.clear(); }

const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42883";

/**
 * Keep one refusal. Resolves `{ recorded: true }` or `{ recorded: false, why }` and
 * never throws: nothing a resident did waits on this. `rec` is `{ key, door, act, target,
 * handle, code, defect, hint }`; the household is resolved from the key here.
 */
export async function recordRefusal(rec, { env = process.env, now = Date.now } = {}) {
  try {
    if (!rec?.key) return { recorded: false, why: "no key" };
    if (!isKept(rec.code ?? null)) return { recorded: false, why: "not a refusal this log keeps" };
    const mine = await officeRead(async (c) => (await keyHouseholdOf(c, rec.key)).household, { env, by: "recordRefusal" });
    if (!mine) return { recorded: false, why: "no household" };
    await officeWrite(async (c) => {
      await c.query(
        `INSERT INTO refused_acts (household, handle, held, door, act, target, code, defect, hint)
         VALUES ($1, $2, $3::text[], $4, $5, $6::jsonb, $7, $8, $9)`,
        [mine, cut(rec.handle, 80), heldHandles(rec.key).slice(0, HELD_MAX).map((h) => h.slice(0, 80)), rec.door === "rest" ? "rest" : "mcp", cut(rec.act, ACT_MAX) || "?",
         JSON.stringify(rec.target ?? {}), rec.code ?? null, cut(rec.defect, DEFECT_MAX), cut(rec.hint, HINT_MAX)]);
    }, { env, household: mine });
    if (now() - lastPrune >= PRUNE_EVERY_MS) {
      lastPrune = now();
      await officeWrite(async (c) => { await c.query("SELECT refused_acts_prune()"); }, { env }).catch((e) => {
        console.error(`[office] refusal log: the 90-day prune failed (${String(e?.message ?? e).slice(0, 160)})`);
      });
    }
    return { recorded: true };
  } catch (e) {
    // A store that is absent or not yet migrated is said once; anything else is said each time, with the error's own words in the log only.
    const known = e?.name === "NoRecordError" || isMissingTable(e);
    const why = e?.name === "NoRecordError" ? "the office is pointed at no record"
      : isMissingTable(e) ? "refused_acts is not on this store yet (migration 098)"
      : "the store could not take the write";
    if (!known) saidAtMost(`a refusal was not kept (${cut(e?.message, 160) ?? "an error with no message"})`);
    else if (!absentSaid) { absentSaid = true; console.error(`[office] refusal log: a refusal was not kept (${why})`); }
    return { recorded: false, why };
  }
}

/** The log hears an unexpected failure at most once a minute, so a saturated pool is one line and not one per refusal. */
let lastSaid = 0;
function saidAtMost(what) {
  const t = Date.now();
  if (t - lastSaid < 60_000) return;
  lastSaid = t;
  try { console.error(`[office] refusal log: ${what}`); } catch { /* a log that cannot be written is not the answer's concern */ }
}

/**
 * Fire and forget: keep a refusal in the background, and let a test wait for it (`refusalLogSettled`).
 * AT MOST INFLIGHT_MAX AT ONCE: each record takes the pen three times, the pen's pool holds three
 * connections and a real act waits in the same line, so a burst keeps the first few and counts the
 * rest (`refusalLogSkipped`), said in the log with the next unexpected failure. A skipped refusal is
 * the one cost of a burst; no act is slowed by it.
 */
export function noteRefusal(rec, opts) {
  if (inflight.size >= INFLIGHT_MAX) { skipped += 1; saidAtMost(`${skipped} refusals skipped while ${INFLIGHT_MAX} were being kept (a burst)`); return; }
  const p = recordRefusal(rec, opts).finally(() => inflight.delete(p));
  inflight.add(p);
}
export const refusalLogSettled = () => Promise.all([...inflight]);
export const refusalLogSkipped = () => skipped;

/**
 * The MCP door's side: given the call and the answer about to be sent, keep the
 * refusal when it is an act's. `msg` is the JSON-RPC message, `reply` its answer.
 */
export function noteMcpRefusal(msg, ctx, reply, { writeShaped }) {
  // TOTAL: this runs on the only place an MCP answer leaves, so it never throws (a call is a caller's JSON).
  try {
    if (msg?.method !== "tools/call" || !ctx?.key) return;
    const name = msg.params?.name;
    const args = msg.params?.arguments;
    if (!writeShaped(name, args)) return;
    const refused = refusalInReply(reply);
    if (!refused) return;
    noteRefusal({ key: ctx.key, door: "mcp", act: actOf(name, args), target: targetOf(args), handle: actorHandle(ctx.key, args), ...refused });
  } catch (e) { saidAtMost(`the MCP hook could not read a call (${cut(e?.message, 120) ?? "no message"})`); }
}

/**
 * REST's side: `req.tel` carries the household the key resolved to, and an apex route
 * stamps `req.tel.act = { name, args }` with the call it parsed. A plain write route
 * stamps nothing and is named by its method and path.
 */
export function noteRestRefusal(req, code, body) {
  // TOTAL: this runs inside `j`, the only writer of a REST answer, so it never throws (a call is a caller's JSON).
  try {
    const method = nameOf(req?.method) ?? "GET";
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    const key = req?.tel?.key;
    if (!key || !isObj(body) || body.error !== "bounce") return;
    const staged = req.tel.act;
    if (!staged && req.tel.call) return; // an apex route's read (no `do:`) is not an act
    const act = staged ? actOf(staged.name, staged.args) : `${method} ${nameOf(req.tel.path) ?? ""}`.slice(0, ACT_MAX);
    noteRefusal({ key, door: "rest", act, target: targetOf(staged?.args), handle: actorHandle(key, staged?.args),
      code: isHttpStatus(code) ? code : null, defect: cut(body.defect, DEFECT_MAX), hint: cut(body.hint, HINT_MAX) });
  } catch (e) { saidAtMost(`the REST hook could not read a call (${cut(e?.message, 120) ?? "no message"})`); }
}

// ── the household's read: its own refusals, and nobody else's ───────────────

export const refusalRow = (r) => ({
  at: r.at instanceof Date ? r.at.toISOString() : r.at,
  act: r.act,
  target: r.target ?? {},
  ...(r.handle ? { handle: r.handle } : {}),
  door: r.door,
  code: r.code ?? null,
  defect: r.defect ?? null,
  hint: r.hint ?? null,
});

/**
 * `household { read: "refusals" }`: the refusals of the residents this key holds, in
 * the last 90 days, newest first. `handle:` narrows to one of those residents.
 * An office whose store has not taken 098 says so rather than answering none.
 */
export async function readOwnRefusals(key, { limit, offset, handle } = {}, { env = process.env } = {}) {
  const lim = Math.min(READ_MAX, Math.max(1, Math.trunc(Number(limit)) || READ_DEFAULT));
  const off = Math.max(0, Math.trunc(Number(offset)) || 0);
  const named = nameOf(handle)?.trim() || null;
  const held = heldHandles(key);
  if (named && !held.includes(named))
    throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${held.join(", ") || "no resident"}`);
  if (!held.length) throw refuse(403, "refusals are a resident's", "your key holds no resident");
  try {
    const mine = await officeRead(async (c) => (await keyHouseholdOf(c, key)).household, { env, by: "readOwnRefusals" });
    if (!mine) throw refuse(403, "refusals are a household's", "your key is in no household");
    // THE RESIDENT'S OWN (the ruling: "their own … and nobody else's"; letter notes ride the key that holds the resident the same way, POS-730):
    // a row whose resident the key holds, or a row no resident could be named for (a key holding several, none named) that a key
    // holding every resident the filing key held. A key holding only a2 never reads a1's tries.
    const rows = await officeWrite(async (c) => (await c.query(
      `SELECT at, act, target, handle, door, code, defect, hint FROM refused_acts
        WHERE household = $1 AND at > now() - make_interval(days => $2)
          AND ((handle = ANY($3::text[])) OR (handle IS NULL AND cardinality(held) > 0 AND held <@ $3::text[]))
          AND ($4::text IS NULL OR handle = $4)
        ORDER BY at DESC, id DESC LIMIT $5 OFFSET $6`, [mine, RETENTION_DAYS, named ? [named] : held, named, lim + 1, off])).rows, { env, household: mine });
    const more = rows.length > lim;
    return { household: mine, refusals: rows.slice(0, lim).map(refusalRow), count: Math.min(rows.length, lim),
      ...(more ? { more: true, next_offset: off + lim, more_note: `more refusals stand — call again with offset: ${off + lim}` } : {}), kept_days: RETENTION_DAYS, note: REFUSALS_NOTE };
  } catch (e) {
    // unknown, never zero: the read says it could not look
    if (isMissingTable(e) || e?.name === "NoRecordError")
      return { household: null, refusals: null, count: null, kept_days: RETENTION_DAYS, note: REFUSALS_NOTE,
        unavailable: "refusals are not kept on this office's record yet, so this read cannot say which acts were refused" };
    throw e;
  }
}
