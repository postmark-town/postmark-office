// call-shape.mjs — the SHAPE of a call for the access line, never its content
// (POS-722, Darko 2026-10-19 22:32: "collecting data on how the MCP is actually
// being used, which is a lot more important than anything that we can theorize").
//
// The access line (telemetry.mjs) said who knocked on which door and which MCP
// tool they named, and nothing about what they asked: 9,961 household calls in a
// week could not be told apart. Each apex call and each MCP tools/call now carries
// a bounded `call` object:
//
//   tool       the apex or tool, when it is one the office answers; else "other"
//   do / read  the act or read name, ONLY when it is a name the apex knows; else "other"
//   focus      { mark, find, investigate, explain, since, depth }: present ones only, as true
//   keys       the argument field NAMES the office itself declares (a tool's
//              schema, a read's fields), sorted and capped; an envelope's fields
//              are "args.<name>". A name the office does not declare is the
//              caller's text (`{ "jane-at-42-elm-st": 1 }`), so it is only
//              counted (keys_other), never written
//   enums      fields whose value comes from a fixed set (read_shape, view, cards,
//              as, stance; class and to at the town door), the value only when it
//              IS in that set; anything else reads "other"
//   out_bytes  the answer's size, metered on the main thread (meterOut below)
//   bounce     the refusal's code only: the HTTP status at 400 and over, the
//              bounce body's own `code` inside an MCP answer, a JSON-RPC error's
//              code, or true when the refusal names none. Never the defect text:
//              it can echo the caller's values.
//
// THE PRIVACY LINE IS ABSOLUTE. Nothing here copies a string value out of an
// argument unless it is a member of a fixed set the office itself declares; a
// handle, a slug, a body, an id, a number: none of them is ever written. A field
// NAME, an MCP tool name and a JSON-RPC method are caller text too, and the same
// rule holds for each: written only when the office declares it. The sentinel
// test (test/call-shape.test.mjs) plants one string in every value and in a
// key's place, and reads the whole line for it.

import { APEX_TOOL, DISPATCHABLE as WORLD_ACTS, FIND_READ, FIND_READ_FIELDS, WORLD_READ_FIELDS } from "./world-apex.mjs";
import { BLOCK_READS } from "./world-read-v2.mjs";
import { APEX_ONLY_FIELDS, HOUSEHOLD_DISPATCHABLE, HOUSEHOLD_READ_ENUM, HOUSEHOLD_READ_FIELDS, HOUSEHOLD_TOOL } from "./household-apex.mjs";
import { TOWN_TOOL } from "./town-apex.mjs";
import { READ_SHAPES } from "./world-read-shape.mjs";
import { RESIDENT_WORDS } from "./town-stance.mjs";
import { POST_CLASSES } from "./town-posts.mjs";
import { BUG_STAGES, BUG_SIDE_EXITS } from "./bugs.mjs";
import { IDEA_STAGES } from "./ideas.mjs";
import { isHttpStatus } from "./fault-words.mjs";
import { DOORSTEP_TOOL } from "./doorstep-apex.mjs";
// A CYCLE, read lazily: mcp.mjs imports this module, and the flat tools' schemas
// (every act's own fields) are declared there. TOOLS is read at the first call,
// never while the modules evaluate.
import { TOOLS } from "./mcp.mjs";

/** The `call` object's own ceiling, in bytes of JSON (POS-722: ≤ 1 KB, inside telemetry.mjs § LINE_MAX). */
export const CALL_MAX = 1024;
/** At most this many field names; the rest are counted as keys_more. */
export const KEYS_MAX = 20;
/** A tool name's shape; the name itself is the caller's to check (mcp.mjs passes "other" for one it does not answer). */
const TOOL_RE = /^[a-z][a-z0-9_-]{0,31}$/;
/**
 * The JSON-RPC methods an MCP client is known to send (the protocol's own, the
 * ones this door answers and the ones it refuses by name). Any other method is
 * the caller's text and reads "other" in the `mcp` field.
 */
export const MCP_METHODS = Object.freeze(new Set(["initialize", "ping", "tools/list", "tools/call", "resources/list",
  "resources/templates/list", "resources/read", "prompts/list", "prompts/get", "logging/setLevel", "completion/complete",
  "notifications/initialized", "notifications/cancelled", "notifications/progress", "notifications/roots/list_changed"]));
/** The `mcp` field's word for a JSON-RPC method. */
export const methodForLog = (method) => (MCP_METHODS.has(method) ? method : "other");
export const FOCUS = Object.freeze(["mark", "find", "investigate", "explain", "since", "depth"]);
/** The paths whose calls are shaped at the REST door, and the apex each one is. */
export const APEX_DOORS = Object.freeze({ "/household": "household", "/world/apex": "world", "/town/apex": "town" });
/** An MCP answer longer than this is not parsed for its bounce code (bounce reads true). A refusal is a few hundred bytes. */
export const PEEK_MAX = 256 * 1024;

// The name lists are read at the first call, not at import: mcp.mjs imports this
// module, and the apexes sit in that same import graph.
let known = null;
function knownNames() {
  if (known) return known;
  const set = (...lists) => new Set(lists.flat().filter((s) => typeof s === "string"));
  const town = TOWN_TOOL.inputSchema.properties;
  known = {
    fields: declaredFields(),
    names: {
      world: { do: set(WORLD_ACTS), read: set(WORLD_ACTS, Object.keys(BLOCK_READS), FIND_READ) },
      household: { do: set(HOUSEHOLD_DISPATCHABLE), read: set(HOUSEHOLD_READ_ENUM) },
      town: { do: set(town.do?.enum ?? []), read: set(town.read?.enum ?? []) },
    },
    // field -> [the fixed set, the tools it is read at (null: every tool)]
    enums: {
      read_shape: [set(READ_SHAPES), null],
      view: [set(HOUSEHOLD_TOOL.inputSchema.properties.view?.enum ?? []), null],
      cards: [set("names", "full"), null],
      as: [set("resident", "human", "town"), null],
      stance: [set(RESIDENT_WORDS), null],
      // `class` and `to` are fixed sets at the town door only: elsewhere `to` is a
      // recipient's handle and `class` a mark's class id, and neither is ever written.
      class: [set(Object.keys(POST_CLASSES)), "town"],
      to: [set(BUG_STAGES, BUG_SIDE_EXITS, IDEA_STAGES), "town"],
    },
  };
  return known;
}

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

/**
 * Every field name the office declares: each tool's input schema (the apexes,
 * the doorstep, every flat tool, which is where most acts' own fields live),
 * walked through its nested objects; the household's apex-only acts (stake,
 * fund-verify, rsvp: no flat tool to borrow from); and every read's own fields
 * (the world's, the find read's, the v2 blocks', the household's).
 */
function declaredFields() {
  const names = new Set();
  const walk = (schema, depth = 0) => {
    if (!isObj(schema) || depth > 8) return;
    if (isObj(schema.properties)) for (const [k, v] of Object.entries(schema.properties)) { names.add(k); walk(v, depth + 1); }
    if (isObj(schema.items)) walk(schema.items, depth + 1);
    for (const alt of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(schema[alt])) for (const s of schema[alt]) walk(s, depth + 1);
  };
  for (const tool of [APEX_TOOL, HOUSEHOLD_TOOL, TOWN_TOOL, DOORSTEP_TOOL, ...TOOLS]) walk(tool?.inputSchema);
  for (const schema of Object.values(APEX_ONLY_FIELDS)) walk(schema);
  const fieldsOf = (byRead) => { for (const fields of Object.values(byRead ?? {})) walk({ properties: fields }); };
  fieldsOf(WORLD_READ_FIELDS);
  fieldsOf(BLOCK_READS);
  fieldsOf(HOUSEHOLD_READ_FIELDS);
  walk({ properties: FIND_READ_FIELDS });
  return names;
}
const present = (v) => v != null && v !== "" && v !== false;
const nameIn = (v, names) => (typeof v === "string" && names.has(v.trim()) ? v.trim() : "other");

/**
 * The shape of one call: `tool` is the apex or MCP tool name when the office
 * answers it (the caller decides; pass "other" otherwise), `args` the arguments
 * as they arrived. Answers a plain object of at most CALL_MAX bytes of JSON.
 */
export function callShape(tool, args) {
  const { fields, names, enums } = knownNames();
  const top = isObj(args) ? args : {};
  const env = isObj(top.args) ? top.args : {};
  const call = { tool: typeof tool === "string" && TOOL_RE.test(tool) ? tool : "other" };

  const apex = names[call.tool];
  if (apex) {
    if (present(top.do)) call.do = nameIn(top.do, apex.do);
    if (present(top.read)) call.read = nameIn(top.read, apex.read);
  }

  const focus = {};
  for (const f of FOCUS) if (present(top[f]) || present(env[f])) focus[f] = true;
  if (Object.keys(focus).length) call.focus = focus;

  const good = [];
  let other = 0;
  for (const k of Object.keys(top)) (fields.has(k) ? good.push(k) : other++);
  for (const k of Object.keys(env)) (fields.has(k) ? good.push(`args.${k}`) : other++);
  good.sort();
  if (good.length) call.keys = good.slice(0, KEYS_MAX);
  if (good.length > KEYS_MAX) call.keys_more = good.length - KEYS_MAX;
  if (other) call.keys_other = other;

  const fixed = {};
  for (const [field, [values, only]] of Object.entries(enums)) {
    if (only && only !== call.tool) continue;
    const v = Object.hasOwn(top, field) ? top[field] : Object.hasOwn(env, field) ? env[field] : undefined;
    if (v !== undefined) fixed[field] = nameIn(v, values);
  }
  if (Object.keys(fixed).length) call.enums = fixed;

  return bounded(call);
}

/**
 * The ceiling, as a check after the build rather than a hope about it: the
 * field names go first. The caps above keep an ordinary call far under it; a
 * call that names every focus, every enum, both an act and a read and twenty
 * long field names can reach it, and so can the finished call with its size
 * and code (finishCall bounds again).
 */
export function bounded(call) {
  if (Buffer.byteLength(JSON.stringify(call), "utf8") <= CALL_MAX) return call;
  const { keys, keys_more, keys_other, ...rest } = call;
  return { ...rest, keys_dropped: true };
}

/** A REST query as the apex reads it: `args=` rides as JSON, and only its field names are ever kept. */
export function queryArgs(searchParams) {
  const args = Object.fromEntries(searchParams.entries());
  if (typeof args.args === "string") {
    try { const o = JSON.parse(args.args); if (isObj(o)) args.args = o; } catch {}
  }
  return args;
}

/**
 * Count the bytes this response writes, on the thread that writes the access
 * line (a read worker's answer is written back here, so it is counted here too).
 * With `mcp`, the answer's own refusal code is read as it is sent: a JSON-RPC
 * answer is HTTP 200 whether it refused or not.
 */
export function meterOut(res, tel, { mcp = false } = {}) {
  tel.out_bytes = 0;
  const { write, end } = res;
  const count = (chunk, enc) => {
    if (chunk == null || typeof chunk === "function") return;
    tel.out_bytes += typeof chunk === "string" ? Buffer.byteLength(chunk, typeof enc === "string" ? enc : "utf8") : (chunk.byteLength ?? 0);
  };
  res.write = function (chunk, enc, cb) { count(chunk, enc); return write.call(this, chunk, enc, cb); };
  res.end = function (chunk, enc, cb) {
    count(chunk, enc);
    if (mcp && tel.call) {
      const b = replyBounce(chunk);
      if (b !== undefined) tel.call.bounce = b;
    }
    return end.call(this, chunk, enc, cb);
  };
}

/**
 * The refusal code of a JSON-RPC answer, or undefined when it did not refuse.
 * The cheap test first: `"isError":true` and `"error":{` can only appear in the
 * answer's own structure, because inside a string value every quote is escaped.
 * A batch answers for its last call, as the `mcp` field does.
 */
export function replyBounce(chunk) {
  if (chunk == null || typeof chunk === "function") return undefined;
  const s = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : null;
  if (s == null || (!s.includes('"isError":true') && !s.includes('"error":{'))) return undefined;
  if (s.length > PEEK_MAX) return true;
  try {
    let reply = JSON.parse(s);
    if (Array.isArray(reply)) reply = reply.at(-1);
    if (isObj(reply?.error)) return Number.isInteger(reply.error.code) ? reply.error.code : true;
    if (reply?.result?.isError !== true) return undefined;
    const inner = JSON.parse(reply.result.content?.[0]?.text ?? "null");
    return isHttpStatus(inner?.code) ? inner.code : true;
  } catch { return true; }
}

/** The `call` the access line carries, finished at the response's end: its size, and the status when that refused. */
export function finishCall(tel, status) {
  if (!tel?.call) return undefined;
  const call = { ...tel.call };
  if (Number.isFinite(tel.out_bytes)) call.out_bytes = tel.out_bytes;
  if (isHttpStatus(status) && status >= 400) call.bounce = status;
  return bounded(call);
}
