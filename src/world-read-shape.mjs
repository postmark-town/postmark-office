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
//     its dials, which are the class's physics: the walking pace rides every
//     read on `the-town/resident` for that reason (world.mjs § markRecords).
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
//   v1, with the cards as names only.

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

// ── the one-liners (Darko-approved wording, 2026-10-09) ─────────────────────
//
// Every field named here is checked against the act's real schema by
// test/world-read-shape.test.mjs. Two names differ from the issue's draft
// because the schema says otherwise: walk's point is `to_x` + `to_y` (the
// apex's own names, FIELD_ALIASES), not `to`; and exit takes an optional
// `mark`, so it is not "no fields".
export const ONE_LINERS = Object.freeze({
  walk: { says: "Walk to a mark or a point, at about 5 km an hour.", fields: ["mark_id or to_x + to_y", "mode?", "enter_on_arrival?"] },
  say: { says: "Speak aloud where you stand; anyone within earshot hears it.", fields: ["text"] },
  enter: { says: "Go inside a place whose door you're standing at.", fields: ["mark"] },
  exit: { says: "Step back out to the place that holds this one.", fields: ["mark?"] },
  "leave-mark": { says: "Place a mark where you stand; it's free on your own ground, and elsewhere you stake 1✦.", fields: ["kind", "slug", "body (≤150)", "at", "extent", "stamps?", "preview?"] },
  withdraw: { says: "Take one of your marks out of the world at the next crossing.", fields: ["mark"] },
  stake: { says: "Put ✦ behind any mark to back it.", fields: ["mark", "stamps"] },
  unstake: { says: "Take back ✦ you staked.", fields: ["mark", "stamps"] },
  give: { says: "Hand a thing you carry to someone standing with you.", fields: ["thing", "to"] },
  take: { says: "Pick up a thing where you stand.", fields: ["thing"] },
  drop: { says: "Set down a thing you carry, here.", fields: ["thing"] },
  ride: { says: "Aboard the Post Office, name your next stop.", fields: ["to"] },
  "note-to-self": { says: "Write a private note only your household can read.", fields: ["body"] },
});

/** The field names a one-liner's list mentions ("mark_id or to_x + to_y" names three; "body (≤150)" names body). */
export const namedFields = (list) => list.flatMap((f) => f.replace(/\(.*?\)/g, "").replace(/\?/g, "").split(/\s+(?:or|\+)\s+/)).map((s) => s.trim()).filter(Boolean);

const firstSentence = (s) => {
  const line = String(s ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  const m = /^(.*?[.!?])(\s|$)/.exec(line.trim());
  return (m ? m[1] : line.trim()).slice(0, 160);
};

/** One card, one line. An act with no approved line says its blurb's first sentence and its own fields. */
export function oneLine(card) {
  const fixed = ONE_LINERS[card.action];
  const says = fixed?.says ?? firstSentence(card.blurb);
  const fields = fixed?.fields
    ?? Object.entries(card.fields ?? {}).map(([name, spec]) => (spec?.required ? name : `${name}?`));
  return { action: card.action, line: `${says} ${fields.length ? `Fields: ${fields.join(", ")}.` : "No fields."}` };
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
  v2: 'the acts open here, by name. world { read: "<action>" } is the full card for one act (its fields, dials, the class that grants it, the terms); cards: "full" gives every card whole.',
};

/**
 * The bare read's answer at `shape`. v0 answers the same object, untouched.
 * `named` is every id the read names for itself (within and nearby); a record
 * outside it is the always-sent ground set (or the mover's class).
 */
export function shapeRead(answer, { shape = "v0", cards = null, within = [], named = [] } = {}) {
  if (shape === "v0" || !answer || answer.error) return answer;
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
      out.actions = shape === "v2" ? v.map((e) => e.action) : v.map(oneLine);
      out.cards = shape === "v2" ? "names-only" : "one-line";
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
  v1: "SIZE: a bare call is the lean read, roughly 15k characters as of 2026-10 (it grows with what stands near you), with each act as one line: mark: \"<id>\" is one mark whole, find: \"<q>\" finds one, read: \"<action>\" is one act's full card, and cards: \"full\" gives every card whole.",
  v2: "SIZE: a bare call is the lean read, roughly 14k characters as of 2026-10 (it grows with what stands near you), with the acts by name only: mark: \"<id>\" is one mark whole, find: \"<q>\" finds one, read: \"<action>\" is one act's full card, and cards: \"full\" gives every card whole.",
};

/** The apex's description at `shape`. v0 answers `text` itself. */
export function describeAt(text, shape = "v0") {
  if (shape === "v0") return text;
  if (!text.includes(RECORDS_V0) || !text.includes(SIZE_V0))
    throw new Error("world-read-shape: the apex description moved; RECORDS_V0 / SIZE_V0 no longer match it");
  return text.replace(RECORDS_V0, RECORDS_LEAN).replace(SIZE_V0, SIZE_LEAN[shape]);
}

/** The `cards` field's schema at `shape`: v0 is the schema it had; v1/v2 add "full". */
export function cardsSchemaAt(schema, shape = "v0") {
  if (shape === "v0") return schema;
  return {
    ...schema,
    enum: ["names", "full"],
    description: 'the action cards\' size. Omitted, the lean read gives each act as one line (v1) or by name (v2). cards: "full" gives every card whole (its blurb, fields, dials and grant); cards: "names" gives each act\'s name, one line and how it reached you.',
  };
}
