import { RSVP_HINT } from "./events.mjs";
// validate-args.mjs — THE ONE "DOES THIS DOOR TAKE THAT FIELD" TEST.
//
// Lifted out of `mcp.mjs` on 2026-09-11, unchanged in its logic, for the same
// reason `reach.mjs` was lifted out of `world-crossings.mjs`: a second caller
// arrived, and the alternative to one owner is two copies that agree the day
// they are written and disagree the first time either moves.
//
// The second caller is the three apexes' READ branches. They cannot import
// `mcp.mjs` — it imports them, and a cycle is the reason their schemas are
// handed DOWN as data ("a line of data beats a cycle", household-apex.mjs
// § ctx). A module neither of them owns is importable by both. `mcp.mjs`
// re-exports this so `server.mjs` and every existing test keep the import they
// already have, and nothing outside had to learn a new name.
//
// ── WHY THE APEXES NEEDED IT (the parity finding, 2026-09-11) ────────────────
//
// `validateArgs` has existed since 2026-07-20, written after "six hours of one
// household's confusion for want of a field name". It was wired into the flat
// tools — which were then delisted — and into the world and household ACT
// branches, and into no read branch anywhere. So the door a connecting agent
// actually holds, `town { read: "letters", args: { from: "glitch" } }`, answered
// 200 and the WHOLE CORPUS labelled as matching, while the flat `list_letters`
// refused `from` by name. The office's own answer to this defect was live and
// unreachable. Ruled by the founder the same day: "yes on parity shape."

/**
 * Argument validation at the door (the little-bird finding, 2026-07-20).
 * Connector clients don't enforce inputSchema, so schema-violating calls used
 * to fall through to SQL and answer with a raw driver bind error ("Provided
 * value cannot be bound to SQLite parameter 1") dressed as "the office
 * tripped" — six hours of one household's confusion for want of a field name.
 * The door now names the defect itself: unknown params, missing required
 * fields, wrong types, bad enum values — each bounces with the field spelled out.
 *
 * `noun` is the word the HINT uses for the thing being called, and it exists
 * because the same validator now answers at two kinds of door. A flat tool says
 * "this tool takes: …"; an apex read says "this read takes: …", which is the
 * cold-read half of the founder's ruling — a caller who has just been refused a
 * field name is owed the list of names that would have worked. The default
 * keeps every sentence this function has ever spoken byte-identical.
 *
 * Returns null when the arguments are good, so `if (validateArgs(...))` reads
 * as "if something is wrong".
 */
export function validateArgs(tool, args, { noun = "tool" } = {}) { // exported 08-17: POST /world/apex runs the SAME validator — one door contract, two skins
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return { error: "bounce", defect: "arguments must be a JSON object", hint: `see the ${tool.name} input schema` };
  const props = tool.inputSchema.properties ?? {};
  for (const k of Object.keys(args)) {
    if (!props[k]) {
      const known = Object.keys(props);
      return { error: "bounce", defect: `unknown argument "${k}" for ${tool.name}`,
        hint: known.length ? `this ${noun} takes: ${known.join(", ")}` : `this ${noun} takes no arguments` };
    }
    const want = props[k].type;
    // A number that arrived as an unambiguous numeric STRING is accepted and
    // coerced, not refused. Clients and models stringify numbers freely, and the
    // door's own tool descriptions invite exactly that — world_say says "pass it
    // back as since:", world_walk takes x/y — so the strict check was rejecting
    // the whole call, which for say means the resident's words never got spoken
    // at all. Party night, 2026-08-08: agents reported world_say "not showing up
    // despite their posts" and the office was refusing them at the door.
    // Deliberately narrow: only number, only when the string parses whole and
    // finite. Everything else still bounces with the field named.
    if (want === "number" && typeof args[k] === "string" && args[k].trim() !== "" && Number.isFinite(Number(args[k])))
      args[k] = Number(args[k]);
    if (["string", "number", "boolean"].includes(want) && typeof args[k] !== want)
      return { error: "bounce", defect: `argument "${k}" should be a ${want}, got ${typeof args[k]}`,
        hint: props[k].description ?? `see the ${tool.name} input schema` };
    if (props[k].enum && !props[k].enum.includes(args[k]))
      return { error: "bounce", defect: `argument "${k}" must be one of: ${props[k].enum.join(", ")}`,
        hint: tool.name === "town" && k === "do" && args[k] === "rsvp"
          ? RSVP_HINT : props[k].description ?? `see the ${tool.name} input schema` };
  }
  for (const k of tool.inputSchema.required ?? []) {
    if (args[k] === undefined || args[k] === null || args[k] === "")
      return { error: "bounce", defect: `missing required argument "${k}" for ${tool.name}`,
        hint: props[k]?.description ? `${k}: ${props[k].description}` : `pass ${k}` };
  }
  return null;
}

/**
 * THE APEX READ BRANCHES' ONE CALL, so the three of them cannot drift into
 * three answers to "does this read take that field".
 *
 * `properties` is the read's declared field set — the flat tool's own
 * `inputSchema.properties` where the apex forwards to a flat tool (every town
 * read does), and the apex's own declaration where it does not (the household's
 * twelve reads speak `view`, not `box`; the world's shadows take a subset of
 * their act's fields). Absent entirely means the caller did not wire the
 * schemas, which is a WIRING defect and never a caller's: it is answered as one
 * rather than skipped, because a validator that silently stops validating is
 * the quiet failure this whole lane exists to end.
 *
 * ⛔ REQUIRED IS DELIBERATELY NOT ENFORCED HERE, and this is the one narrowing.
 * Several apex reads resolve `handle` from the KEY after this point — a
 * single-resident household's `household { read: "doorstep" }` is the door's own
 * advertised first read and names no handle — while the flat `read_doorstep`
 * marks `handle` required. Enforcing it would refuse calls that answer today,
 * and the ruling was about unknown fields being SWALLOWED, not about tightening
 * what a valid call may omit. So the required list is emptied and the unknown /
 * type / enum legs run exactly as the flat door runs them.
 *
 * @returns null, or `{ defect, hint, extra }` for the caller's own `bounce`.
 */
export function validateReadArgs({ read, tool, properties, fields, exempt = [] }) {
  if (!properties) {
    return { wiring: true,
      defect: `this office cannot say what "${read}" takes`,
      hint: "the apex was called without its schema map, so the read's field list could not be read. The caller must pass ctx.schemas — one owner for every door's field names, or the door stops refusing anything.",
      extra: {} };
  }
  const exemptSet = new Set(exempt);
  const judged = {};
  for (const [k, v] of Object.entries(fields ?? {})) if (!exemptSet.has(k)) judged[k] = v;
  const shim = { name: tool, inputSchema: { properties, required: [] } };
  const bad = validateArgs(shim, judged, { noun: "read" });
  if (!bad) {
    // The coercion leg mutates what it judged (a numeric string becomes a
    // number), so the judged copy is written back — otherwise `limit: "2"`
    // would pass this door and reach the implementation as a string, which is
    // the half-fix where the validator agrees and the query does not.
    for (const k of Object.keys(judged)) fields[k] = judged[k];
    return null;
  }
  return { defect: bad.defect, hint: bad.hint,
    extra: { read, dispatched_to: tool, accepted: Object.keys(properties) } };
}
