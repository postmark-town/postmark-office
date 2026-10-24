// world-read-shape.mjs — the bare world read's shape, chosen by one env var
// (POS-486, Darko 2026-10-09: "rather than just guessing, can we set up a basic
// eval/improvement loop where we try different versions of this").
//
//   WORLD_READ_SHAPE=v0|v1|v2      unset (or v0): today's read, byte for byte
//
// The shapes are candidates for the default, measured by fresh test agents on
// real tasks (tools/read-eval/). The eval picks one; until then v0 is the
// default and nothing here runs on it: `shapeRead` hands back the very object
// it was given, and the tool's description and schema are the ones it had.
//
// ── v1, LEAN ────────────────────────────────────────────────────────────────
//
//   - Bodies are always kept (Darko, 10-09: no read strips mark bodies).
//   - A record keeps id, by, kind, class, tier, at, extent, body, weight (the
//     total; never weight_parts) and the image link. A class record also keeps
//     its dials, which are the class's physics. No class rides a read by name
//     (WLD-29): the walk's one-liner is priced from the class's own dial, which
//     the apex hands in (`paceKmPerCrossing`).
//   - A polygon is said, not drawn: `shape: "polygon", vertices: n`. A mark the
//     caller stands inside (`within`) keeps an outline of at most 8 vertices.
//   - The always-sent ground set (the region rings and the water) becomes
//     `ground: [{ id, title }]`. A mark has no title field, so the title is its
//     slug in words ("the-town/the-main-channel" -> "the main channel").
//   - Each action card is one line: one sentence, then its fields, optional
//     ones marked `?` (the wording Darko approved, 10-09). `cards: "full"` gives
//     today's cards back; `cards: "names"` is the dial it always was.
//
// ── v2 ──────────────────────────────────────────────────────────────────────
//
//   THE WORLD READ v2 (POS-632, Darko 2026-10-14), shaped by world-read-v2.mjs
//   § shapeV2, never here: it is built from reads the apex asks only for it.
//   A caller opts in per call with read_shape: "v2" (W1), which wins over
//   WORLD_READ_SHAPE. Until 2026-10-14 "v2" named v1 with the cards as names
//   only; that shape never ran on prod (the eval picked v1), and cards: "names"
//   gives it per call, so the name went to the new read.

/** The shapes the switch accepts. */
export const READ_SHAPES = Object.freeze(["v0", "v1", "v2"]);

let warned = false;
/** The default shape, from WORLD_READ_SHAPE. Unset or empty is v0; an unknown value is v0 and said once. */
export function readShape(env = process.env) {
  const s = String(env.WORLD_READ_SHAPE ?? "").trim();
  if (s === "") return "v0";
  if (READ_SHAPES.includes(s)) return s;
  if (!warned) { warned = true; console.error(`[world] WORLD_READ_SHAPE=${JSON.stringify(s)} is not one of ${READ_SHAPES.join(", ")}; the read answers v0`); }
  return "v0";
}

/**
 * WHAT A WHISPER'S WORDS ARE (POS-672 D4, ruled 2026-10-20 22:37, review-692 F1):
 * heard in the world by the bat alone, and kept on the record, which is public.
 * One sentence, said wherever a whisper is taught or answered.
 */
export const WHISPER_WORDS = "Only the bat hears your words in the world; like everything a resident says, they are kept on the town's public record.";

/**
 * A creature's afforded actions, as the exact call (POS-672; Wright 2026-10-20:
 * "an agent learns the exact call"). `can`'s lines and explain's afforded
 * actions both quote these, so the two cannot teach two spellings.
 */
export const CREATURE_CALLS = Object.freeze({
  watch: 'world { do: "watch", args: { creature: "<its id>" } }',
  approach: 'world { do: "approach", args: { creature: "<its id>" } }',
  shoo: 'world { do: "shoo", args: { creature: "<its id>" } }',
  call: 'world { do: "call", args: { creature: "<its id>", words: "<optional, heard like a say>" } }',
  offer: 'world { do: "offer", args: { creature: "<its id>", kind: "<a consumable kind you carry>" } }',
  whisper: 'world { do: "whisper", args: { creature: "<its id>", words: "<optional: only it hears them, and they stay on the public record>" } }',
  dodge: 'world { do: "dodge", args: { creature: "<its id>" } }',
  persuade: 'world { do: "persuade", args: { creature: "<its id>", words: "<your words to it>" } }',
});

// ── the one-liners (Darko-approved wording, 2026-10-09) ─────────────────────
//
// Every field named here is checked against the act's real schema by
// test/world-read-shape.test.mjs. Two names differ from the issue's draft
// because the schema says otherwise: walk's point is `to_x` + `to_y` (the
// apex's own names, FIELD_ALIASES), not `to`; and exit takes an optional
// `mark`, so it is not "no fields".
export const ONE_LINERS = Object.freeze({
  // the pace is the resident class's own dial, never this sentence's (#455 review, finding 5): see `oneLine`
  walk: { says: "Walk to a mark or a point, at about 5 km an hour.", fields: ["mark_id or to_x + to_y", "mode?", "enter_on_arrival?"] },
  say: { says: "Speak aloud where you stand; anyone within earshot hears it.", fields: ["text"] },
  enter: { says: "Go inside a place whose door you're standing at.", fields: ["mark"] },
  exit: { says: "Step back out to the place that holds this one.", fields: ["mark?"] },
  "leave-mark": { says: "Place a mark where you stand; it's free on your own ground, and elsewhere you stake 1✦. Or make into your own hands or a holder you're at, live and free: many by kind and count, or one thing of your own by slug and body.", fields: ["kind", "slug", "body (≤150)", "at", "extent", "stamps?", "preview?", "count?", "to?"] },
  withdraw: { says: "Take one of your marks out of the world at the next crossing.", fields: ["mark"] },
  stake: { says: "Put ✦ behind any mark to back it.", fields: ["mark", "stamps"] },
  unstake: { says: "Take back ✦ you staked.", fields: ["mark", "stamps"] },
  give: { says: "Hand a thing you carry to someone standing with you, or give it into a holder; counted things go by kind and count.", fields: ["thing or kind + count", "to"] },
  take: { says: "Pick up a thing where you stand, or take from a holder: by kind, or pot luck with no kind.", fields: ["thing or from", "kind?", "count?"] },
  drop: { says: "Set down a thing you carry, here.", fields: ["thing"] },
  // LOGOS v2 part 2 (the playground's QA): the lines name making by count, taking from and giving into a holder
  consume: { says: "Use up one consumable you carry, by kind, or the one you made by naming it.", fields: ["kind or thing"] },
  refill: { says: "Make things by kind into a holder you made, at it or carrying it, when its class affords refill (the Halloween Candy Bowl).", fields: ["thing", "kind", "count"] },
  ride: { says: "Aboard the Post Office, name your next stop.", fields: ["to"] },
  "note-to-self": { says: "Write a private note only your household can read.", fields: ["body"] },
  // A creature's afforded actions (POS-672): each names the creature, and its reaction is the reply
  watch: { says: `Watch a creature in sight, ${CREATURE_CALLS.watch}; its reaction is your reply.`, fields: ["creature"] },
  approach: { says: `Walk toward a creature in sight, stopping at half its ring, ${CREATURE_CALLS.approach}; its reaction is your reply.`, fields: ["creature"] },
  shoo: { says: `Shoo a creature whose ring you stand in, ${CREATURE_CALLS.shoo}; its reaction is your reply.`, fields: ["creature"] },
  call: { says: `Call to a creature in sight, ${CREATURE_CALLS.call}; its reaction is your reply.`, fields: ["creature", "words"] },
  offer: { says: `Hold out one consumable you carry to a creature whose ring you stand in, ${CREATURE_CALLS.offer}; it is used up, whatever it does.`, fields: ["creature", "kind"] },
  whisper: { says: `Whisper to a creature whose ring you stand in, ${CREATURE_CALLS.whisper}. ${WHISPER_WORDS}`, fields: ["creature", "words"] },
});

/** The field names a one-liner's list mentions ("mark_id or to_x + to_y" names three; "body (≤150)" names body). */
export const namedFields = (list) => list.flatMap((f) => f.replace(/\(.*?\)/g, "").replace(/\?/g, "").split(/\s+(?:or|\+)\s+/)).map((s) => s.trim()).filter(Boolean);

const firstSentence = (s) => {
  const line = String(s ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  const m = /^(.*?[.!?])(\s|$)/.exec(line.trim());
  return (m ? m[1] : line.trim()).slice(0, 160);
};

/** km an hour from the resident class's pace dial (km a crossing; a crossing is 12 hours), or null. */
export const paceKmH = (dials) => {
  const perCrossing = Number(dials?.pace_km_per_crossing);
  return Number.isFinite(perCrossing) && perCrossing > 0 ? perCrossing / 12 : null;
};

/**
 * An act's line's tail: its fields in the approved wording, optional ones
 * marked `?`; an act with no approved line names its own schema's fields. ONE
 * tail for v1's `oneLine` and v2's `actLine` (POS-697 G1a, Darko 2026-10-19
 * 09:21: v2's lines carry their fields too, so a first act does not bounce).
 */
export function fieldsTail(card) {
  const fields = ONE_LINERS[card.action]?.fields
    ?? Object.entries(card.fields ?? {}).map(([name, spec]) => (spec?.required ? name : `${name}?`));
  return fields.length ? `Fields: ${fields.join(", ")}.` : "No fields.";
}

/**
 * One card, one line. An act with no approved line says its blurb's first
 * sentence and its own fields. Walk's pace is the resident class's own dial
 * (`the-town/resident`'s `pace_km_per_crossing`, as the walk itself is priced),
 * so a ruled change of pace changes the line; with no dial in hand the line
 * names no speed.
 */
export function oneLine(card, { pace = null } = {}) {
  const fixed = ONE_LINERS[card.action];
  let says = fixed?.says ?? firstSentence(card.blurb);
  if (card.action === "walk") says = pace ? says.replace(/about [\d.]+ km an hour/, `about ${Math.round(pace * 10) / 10} km an hour`) : "Walk to a mark or a point.";
  return { action: card.action, line: `${says} ${fieldsTail(card)}` };
}

// ── the records ─────────────────────────────────────────────────────────────

const KEEP = ["id", "by", "kind", "class", "tier", "at", "extent", "body", "weight", "image"];

/** Visvalingam: drop the vertex whose triangle with its neighbours is smallest, until `max` remain. */
export function simplifyRing(points, max = 8) {
  const ring = points.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]));
  const area = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  while (ring.length > max) {
    let at = 0;
    let least = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = area(ring[(i - 1 + ring.length) % ring.length], ring[i], ring[(i + 1) % ring.length]);
      if (a < least) { least = a; at = i; }
    }
    ring.splice(at, 1);
  }
  return ring.map(([x, y]) => [Math.round(x), Math.round(y)]);
}

/** A record at v1: the kept fields, and a polygon said rather than drawn (an outline when the caller stands in it). */
export function leanRecord(rec, { outline = false } = {}) {
  const out = {};
  for (const k of KEEP) if (rec[k] !== undefined) out[k] = rec[k];
  if (rec.kind === "class" && rec.dials) out.dials = rec.dials;
  if (Array.isArray(rec.points) && rec.points.length) {
    out.shape = "polygon";
    out.vertices = rec.points.length;
    if (outline) out.points = simplifyRing(rec.points, 8);
  }
  return out;
}

/** "the-town/the-main-channel" -> "the main channel". */
export const titleOf = (id) => String(id ?? "").split("/").pop().replace(/-/g, " ");

const CARDS_NOTE = {
  v1: 'one line per act. world { read: "<action>" } is the full card for one act (its fields, dials, the class that grants it, the terms); cards: "full" gives every card whole.',
};

/**
 * The bare read's answer at `shape`. v0 answers the same object, untouched.
 * `named` is every id the read names for itself (within and nearby); a record
 * outside it is the always-sent ground set. `paceKmPerCrossing` is the
 * resident class's walking dial, for the walk's one-liner (null: none in hand).
 */
export function shapeRead(answer, { shape = "v0", cards = null, within = [], named = [], paceKmPerCrossing = null } = {}) {
  if (shape === "v0" || !answer || answer.error) return answer;
  if (shape === "v2") throw new Error("the v2 read is shaped by world-read-v2.mjs § shapeV2, from reads the apex asks only for it");
  const inside = new Set(within);
  const own = new Set(named);
  const records = {};
  const ground = [];
  for (const [id, rec] of Object.entries(answer.records ?? {})) {
    if (own.has(id) || rec?.kind === "class") records[id] = leanRecord(rec, { outline: inside.has(id) });
    else ground.push({ id, title: titleOf(id) });
  }
  const out = {};
  for (const [k, v] of Object.entries(answer)) {
    if (k === "records") { out.records = records; out.ground = ground; continue; }
    if (k === "actions" && cards == null) {
      // the walk pace is law: the class's own dial, handed in by the apex (WLD-29)
      const pace = paceKmH({ pace_km_per_crossing: paceKmPerCrossing });
      out.actions = v.map((e) => oneLine(e, { pace }));
      out.cards = "one-line";
      out.cards_note = CARDS_NOTE[shape];
      continue;
    }
    out[k] = v;
  }
  out.read_shape = shape;
  return out;
}

// ── the door's own words, per shape ─────────────────────────────────────────
//
// The tool's description says what a bare read carries and how big it is. At
// v0 it is untouched. At v1/v2 those two sentences would be false, so they are
// replaced by what the lean read carries; nothing else in the description moves.
export const RECORDS_V0 = "`records` — the full mark record for everything `within` and `nearby` just named, plus the town's ground (its region rings and its water), so a reader never has to go and fetch what this answer already told them about —";
const RECORDS_LEAN = "`records` — each mark `within` and `nearby` names, with its body (a polygon is said as its vertex count; a place you stand inside keeps an 8-point outline), `ground` — the town's region rings and water by name —";
export const SIZE_V0 = 'SIZE: a bare call returns roughly 50–80k characters as of 2026-10, most of it `records` and the action cards, so use targeted reads: cards: "names" (the cards alone, shrunk), mark: "<id>" (one mark whole), find: "<q>", or read: "<action>" (one act).';
const SIZE_LEAN = {
  v1: "SIZE: a bare call is the lean read, roughly 15k characters as of 2026-10 (it grows with what stands near you), with each act as one line: mark: \"<id>\" is one mark whole, find: \"<q>\" finds one, read: \"<action>\" is one act's full card, and cards: \"full\" gives every card whole. read_shape: \"v2\" is the compact read, at about half this size: opt-in per call, while the default stays as it is.",
  v2: "SIZE: a bare call is the world read v2, roughly 5k characters as of 2026-10: you, now (what happened since the last crossing), view (what fills your eyes, by bearing), who (who is active near you), happening_here, can (each act in one line) and law. mark: \"<id>\" is one mark whole, find: \"<q>\" finds one, read: \"<action>\" is one act's full card, and read_shape: \"v1\" is the lean read.",
};

let moved = false;
/**
 * The apex's description at `shape`. v0 answers `text` itself.
 *
 * FAILS SOFT (#455 review, finding 2). This runs inside the tool's description
 * getter, which every MCP `tools/list` serializes; a throw here would take
 * tool discovery down for every client. So if a later edit moves the two
 * sentences this swaps, it says so once and answers the v0 description, and
 * test/world-read-shape.test.mjs is the loud signal that goes red in CI.
 */
export function describeAt(text, shape = "v0") {
  if (shape === "v0") return text;
  if (!text.includes(RECORDS_V0) || !text.includes(SIZE_V0)) {
    if (!moved) { moved = true; console.error("[world] the apex description moved: RECORDS_V0 / SIZE_V0 no longer match it, so tools/list answers the v0 description at " + shape + " (world-read-shape.mjs § describeAt)"); }
    return text;
  }
  return text.replace(RECORDS_V0, RECORDS_LEAN).replace(SIZE_V0, SIZE_LEAN[shape]);
}

/** The `cards` field's schema at `shape`: v0 is the schema it had; v1/v2 add "full". */
export function cardsSchemaAt(schema, shape = "v0") {
  if (shape === "v0") return schema;
  return {
    ...schema,
    enum: ["names", "full"],
    description: 'the action cards\' size. Omitted, each act is one line with its fields (v1\'s actions, v2\'s can). cards: "full" gives every card whole (its blurb, fields, dials and grant; in v2, as cards beside can); cards: "names" gives each act\'s name, one line and how it reached you (in v2, can names its acts and nothing more).',
  };
}
