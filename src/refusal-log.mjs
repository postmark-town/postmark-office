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
//     act, and a 429 is the rate limit, charged before the act is looked at; neither is
//     recorded. A bounce that names no code is recorded with none.
//   · A KNOWN HOUSEHOLD: a call whose key resolves to no household has no one to
//     read it back to, so nothing is kept.
//   · "ON WHAT" is the call's identifying fields only (TARGET_FIELDS), each cut to
//     TARGET_VALUE_MAX characters. A body, a text, a note or any field not on the
//     list is never copied, so a letter's words are never kept here.
//   · The words are the refusal's own `defect` and `hint`, cut. They can echo what
//     the resident sent, and they are kept for the resident alone.
//
// THE RECORD NEVER CHANGES AN ANSWER. It is taken after the answer is built, in the
// background, and a store that is absent, unreachable or not yet migrated costs the
// record and nothing else: the failure is said once in the log.

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

export const REFUSALS_NOTE = `private to your household: the town keeps no public record of a refusal. Each row is an act a door refused, who tried it, on what, when and the refusal's own words; rows are kept ${RETENTION_DAYS} days`;

// ── the shape of what is recorded ────────────────────────────────────────────

const cut = (v, n) => (v == null ? null : String(v).slice(0, n));
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

/** Which act, by name: an apex's `do:` as `<apex>:<do>`, a flat tool by its own name, a REST route by its method and path. */
export function actOf(name, args) {
  const apex = ["world", "household", "town"].includes(name) && isObj(args) && args.do != null && args.do !== "";
  const raw = apex ? `${name}:${args.do}` : String(name ?? "");
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
  return code >= 400 && code < 500 && code !== 429;
}

/** The refusal a JSON-RPC answer carries, `{ code, defect, hint }`, or null when it does not refuse as a tool result. */
export function refusalInReply(reply) {
  if (reply?.result?.isError !== true) return null;
  let body = null;
  try { body = JSON.parse(reply.result.content?.[0]?.text ?? "null"); } catch { return null; }
  if (!isObj(body) || body.error !== "bounce") return null;
  return { code: isHttpStatus(body.code) ? body.code : null, defect: cut(body.defect, DEFECT_MAX), hint: cut(body.hint, HINT_MAX) };
}

/** The resident who tried: the call's own `handle` when the key holds it, else the key's only resident. */
export function actorHandle(key, args) {
  const held = [...(key?.handles ?? [])].map(String);
  const named = String((isObj(args?.args) && args.args.handle) || (isObj(args) && args.handle) || "").trim();
  if (named && held.includes(named)) return named;
  return held.length === 1 ? held[0] : null;
}

// ── the writer ───────────────────────────────────────────────────────────────

const PRUNE_EVERY_MS = 3_600_000;
let lastPrune = 0;
let absentSaid = false;
const inflight = new Set();

/** Test seam: forget the prune clock and the said-once flag. */
export function __resetForTest() { lastPrune = 0; absentSaid = false; inflight.clear(); }

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
        `INSERT INTO refused_acts (household, handle, door, act, target, code, defect, hint)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [mine, rec.handle ?? null, rec.door === "rest" ? "rest" : "mcp", cut(rec.act, ACT_MAX) || "?",
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
    if (!known) console.error(`[office] refusal log: a refusal was not kept (${String(e?.message ?? e).slice(0, 160)})`);
    else if (!absentSaid) { absentSaid = true; console.error(`[office] refusal log: a refusal was not kept (${why})`); }
    return { recorded: false, why };
  }
}

/** Fire and forget: keep a refusal in the background, and let a test wait for it (`refusalLogSettled`). */
export function noteRefusal(rec, opts) {
  const p = recordRefusal(rec, opts).finally(() => inflight.delete(p));
  inflight.add(p);
}
export const refusalLogSettled = () => Promise.all([...inflight]);

/**
 * The MCP door's side: given the call and the answer about to be sent, keep the
 * refusal when it is an act's. `msg` is the JSON-RPC message, `reply` its answer.
 */
export function noteMcpRefusal(msg, ctx, reply, { writeShaped }) {
  if (msg?.method !== "tools/call" || !ctx?.key) return;
  const name = msg.params?.name;
  const args = msg.params?.arguments;
  if (!writeShaped(name, args)) return;
  const refused = refusalInReply(reply);
  if (!refused) return;
  noteRefusal({ key: ctx.key, door: "mcp", act: actOf(name, args), target: targetOf(args), handle: actorHandle(ctx.key, args), ...refused });
}

/**
 * REST's side: `req.tel` carries the household the key resolved to, and an apex route
 * stamps `req.tel.act = { name, args }` with the call it parsed. A plain write route
 * stamps nothing and is named by its method and path.
 */
export function noteRestRefusal(req, code, body) {
  const method = String(req?.method ?? "GET");
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const key = req?.tel?.key;
  if (!key || !isObj(body) || body.error !== "bounce") return;
  const staged = req.tel.act;
  if (!staged && req.tel.call) return; // an apex route's read (no `do:`) is not an act
  const act = staged ? actOf(staged.name, staged.args) : `${method} ${String(req.tel.path ?? "")}`.slice(0, ACT_MAX);
  noteRefusal({ key, door: "rest", act, target: targetOf(staged?.args), handle: actorHandle(key, staged?.args),
    code: isHttpStatus(code) ? code : null, defect: cut(body.defect, DEFECT_MAX), hint: cut(body.hint, HINT_MAX) });
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
 * `household { read: "refusals" }`: the refusals the key's own household has met in
 * the last 90 days, newest first. `handle:` narrows to one of its residents.
 * An office whose store has not taken 098 says so rather than answering none.
 */
export async function readOwnRefusals(key, { limit, offset, handle } = {}, { env = process.env } = {}) {
  const lim = Math.min(READ_MAX, Math.max(1, Math.trunc(Number(limit)) || READ_DEFAULT));
  const off = Math.max(0, Math.trunc(Number(offset)) || 0);
  const named = handle == null || handle === "" ? null : String(handle).trim();
  if (named && !(key?.handles ?? new Set()).has(named))
    throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${[...(key?.handles ?? [])].join(", ") || "no resident"}`);
  try {
    const mine = await officeRead(async (c) => (await keyHouseholdOf(c, key)).household, { env, by: "readOwnRefusals" });
    if (!mine) throw refuse(403, "refusals are a household's", "your key is in no household");
    const rows = await officeWrite(async (c) => (await c.query(
      `SELECT at, act, target, handle, door, code, defect, hint FROM refused_acts
        WHERE household = $1 AND at > now() - make_interval(days => $2) AND ($3::text IS NULL OR handle = $3)
        ORDER BY at DESC, id DESC LIMIT $4 OFFSET $5`, [mine, RETENTION_DAYS, named, lim + 1, off])).rows, { env, household: mine });
    const more = rows.length > lim;
    return { household: mine, refusals: rows.slice(0, lim).map(refusalRow), count: Math.min(rows.length, lim),
      ...(more ? { more: true, next_offset: off + lim } : {}), kept_days: RETENTION_DAYS, note: REFUSALS_NOTE };
  } catch (e) {
    // unknown, never zero: the read says it could not look
    if (isMissingTable(e) || e?.name === "NoRecordError")
      return { household: null, refusals: null, count: null, kept_days: RETENTION_DAYS, note: REFUSALS_NOTE,
        unavailable: "refusals are not kept on this office's record yet, so this read cannot say which acts were refused" };
    throw e;
  }
}
