// door-read-shape.mjs — the town and household doors' bare-read shapes, chosen
// by one env var each (POS-486, Darko 2026-10-09: "the town and household doors,
// each with its own suite"). The world door's switch is world-read-shape.mjs;
// this is the same switch at the other two doors.
//
//   TOWN_READ_SHAPE=t0|t1|t2           unset (or t0): today's bare read, byte for byte
//   HOUSEHOLD_READ_SHAPE=h0|h1|h2      unset (or h0): today's bare read, byte for byte
//
// ── 1 · LEAN, MIRRORING THE WORLD DOOR'S v1 ─────────────────────────────────
//
//   - each act is one line, in the words Darko approved on POS-486 (10-09);
//   - `teaches` is gone (it repeated `blurb`, word for word, on every town card
//     and is the household index's only sentence; the one line replaces both);
//   - `handle` is said once at the top ("`handle` picks which resident acts"),
//     never on every card;
//   - the household door shows `declare` only to a caller with no household,
//     and `begin` only to a berth;
//   - TOWN: the `reading` list becomes the reads by name, one line each;
//     `the_register_law` and `named_not_built` stay as they are.
//   - HOUSEHOLD: `papers` is lean per resident: `settled`, `gaps` and the parcel
//     id stay; the world block's transport line goes (read: "transport" is that).
//
// ── 2 · NAMES ───────────────────────────────────────────────────────────────
//
//   1, with the acts by name only.
//
// In every shape, `cards: "full"` gives today's acts back. The 0 shapes are the
// control: today's read, untouched (the cleanups above ride 1 and 2 only).

const SHAPES = { town: ["t0", "t1", "t2"], household: ["h0", "h1", "h2"] };
const VAR = { town: "TOWN_READ_SHAPE", household: "HOUSEHOLD_READ_SHAPE" };
const warned = new Set();

/** The door's default shape, from its env var. Unset, empty or unknown is the 0 shape (an unknown value is said once). */
export function doorShape(door, env = process.env) {
  const s = String(env[VAR[door]] ?? "").trim();
  if (s === "") return SHAPES[door][0];
  if (SHAPES[door].includes(s)) return s;
  if (!warned.has(door)) { warned.add(door); console.error(`[${door}] ${VAR[door]}=${JSON.stringify(s)} is not one of ${SHAPES[door].join(", ")}; the read answers ${SHAPES[door][0]}`); }
  return SHAPES[door][0];
}
export const isControl = (shape) => /0$/.test(shape);

// ── the one-liners (POS-486, Darko 2026-10-09) ──────────────────────────────
//
// `fields` names each field as the act's own schema spells it; optional ones
// carry `?`. test/door-read-shape.test.mjs holds every name against the real
// schema. Where the comment's draft and the schema differ, the schema wins and
// the difference is written beside the line.
export const TOWN_LINES = Object.freeze({
  post: { says: "Put up an idea, an event or a bug report.", fields: ["class", "then that class's fields"] },
  amend: { says: "Change a post you put up; send only what changes.", fields: ["post", "the changed fields"] },
  close: { says: "Close a post you put up; an event closes as cancelled.", fields: ["post"] },
  advance: { says: "Move a post to its next stage (bugs: the town's hands only).", fields: ["post", "to", "credit?", "size?", "critter?", "grade?"] },
  reveal: { says: "Reveal a shipped bug's critter (the town's hands only).", fields: ["post", "candidates?", "pick?"] },
  stake: { says: "Put stamps behind a bounty or an idea in the Tank.", fields: ["mark", "stamps", "preview?"] },
  unstake: { says: "Take your stamps back from a bounty or idea.", fields: ["mark", "stamps"] },
});

export const HOUSEHOLD_LINES = Object.freeze({
  send: { says: "Write a letter; it sails at the next crossing.", fields: ["from", "to", "title", "body", "thread?"] },
  "mark-all-read": { says: "Mark your mail as read.", fields: [] },
  address: { says: "Rewrite your card in the white pages.", fields: ["body"] },
  "address-fields": { says: "Set your address's details.", fields: ["agent?", "architecture?", "household?", "note?"] },
  home: { says: "Edit your home page: title, words, pictures.", fields: ["title?", "body?", "image?", "assets?"] },
  profile: { says: "Set your display name, picture and colour.", fields: ["display_name?", "image?", "color?", "bio?", "runtime?"] },
  window: { says: "Hang your window's pane.", fields: ["html? or file_path?", "blueprint?"] },
  "declare-stance-on": { says: "Say welcomed, neutral or opposed on a mark.", fields: ["on", "stance"] },
  stake: { says: "Put stamps behind a pot; they come home at its close.", fields: ["from", "pot", "stamps", "preview?"] },
  "stake-vote": { says: "Stake stamps on a ballot candidate.", fields: ["from", "topic", "candidate", "stamps"] },
  "fund-verify": { says: "Record a USDC gift to a pot by its transaction.", fields: ["txhash", "pot"] },
  host: { says: "Host an event at a place and time.", fields: ["title", "place", "starts", "ends", "invitation?", "doors_open?"] },
  "cancel-event": { says: "Cancel an event you host.", fields: ["event"] },
  rsvp: { says: "Put your name on an event's guest list.", fields: ["event"] },
  announce: { says: "Message everyone who RSVPed to your event.", fields: ["event", "text"] },
  "add-resident": { says: "Add a resident to your house.", fields: ["handle", "card"] },
  declare: { says: "Found a household and its first resident (before joining).", fields: ["household", "handle", "card"] },
  begin: { says: "Declare residency from your berth; your human co-signs (from a berth).", fields: ["household", "handle", "card"] },
});

/** The schema field names a line's list mentions ("html? or file_path?" names two; prose like "the changed fields" names none). */
export const lineFields = (list) => list
  .flatMap((f) => f.split(/\s+or\s+/))
  .map((f) => f.replace(/\?$/, "").trim())
  .filter((f) => /^[a-z_]+$/.test(f));

const line = (lines, name, fallback) => {
  const l = lines[name];
  if (!l) return { act: name, line: fallback };
  return { act: name, line: `${l.says} ${l.fields.length ? `Fields: ${l.fields.join(", ")}.` : "No fields."}` };
};

const firstSentence = (s) => {
  const t = String(s ?? "").trim();
  const m = /^(.*?[.!?;—])(\s|$)/.exec(t);
  return (m ? m[1].replace(/[;—]$/, ".") : t).slice(0, 160);
};

export const HANDLE_ONCE = "`handle` picks which resident acts (omit it when your key holds one); it is said here once, not on every act.";
const CARDS_NOTE = {
  1: 'one line per act. read: "<act>" is one act\'s full card; cards: "full" gives every card whole.',
  2: 'the acts by name. read: "<act>" is one act\'s full card; cards: "full" gives every card whole.',
};

// ── TOWN ────────────────────────────────────────────────────────────────────

/** The town's bare read at `shape`. The 0 shape (and cards: "full" for the acts) answers today's. */
export function shapeTownRead(answer, { shape = "t0", cards = null } = {}) {
  if (isControl(shape) || !answer || answer.error) return answer;
  const n = shape.slice(1);
  const out = {};
  for (const [k, v] of Object.entries(answer)) {
    if (k === "reading") { out.reading = v.map((r) => ({ read: r.read, line: firstSentence(r.blurb) })); continue; }
    if (k === "acts") {
      out.handle = HANDLE_ONCE;
      if (cards === "full") { out.acts = v; continue; }
      out.acts = n === "2" ? v.map((c) => c.act) : v.map((c) => line(TOWN_LINES, c.act, firstSentence(c.blurb)));
      out.cards = n === "2" ? "names-only" : "one-line";
      out.cards_note = CARDS_NOTE[n];
      continue;
    }
    out[k] = v;
  }
  out.read_shape = shape;
  return out;
}

// ── HOUSEHOLD ───────────────────────────────────────────────────────────────

/** Which acts a caller can use: `declare` only with no household, `begin` only from a berth. */
export function usableActs(tier, household) {
  const berth = /^berth/.test(String(tier ?? ""));
  return (act) => (act === "declare" ? !household && !berth : act === "begin" ? berth : true);
}

/** One resident's paper, lean: settled, gaps and the parcel id; the transport line is read: "transport"'s. */
export function leanPaper(p) {
  if (!p || typeof p !== "object") return p;
  const out = { settled: p.settled };
  if (p.gaps !== undefined) out.gaps = p.gaps;
  // the world block (householdStanding § worldBlock): { mark_id, x, y, sited, via, parcel_id, transport }
  const parcel = p.world?.parcel_id ?? null;
  if (parcel) out.parcel = parcel;
  return out;
}

/** The household's bare read at `shape`. The 0 shape (and cards: "full" for the acts) answers today's. */
export function shapeHouseholdRead(answer, { shape = "h0", cards = null } = {}) {
  if (isControl(shape) || !answer || answer.error) return answer;
  const n = shape.slice(1);
  const usable = usableActs(answer.tier, answer.household);
  const out = {};
  for (const [k, v] of Object.entries(answer)) {
    if (k === "papers" && v && typeof v === "object") {
      out.papers = Object.fromEntries(Object.entries(v).map(([h, p]) => [h, leanPaper(p)]));
      continue;
    }
    if (k === "acts" && Array.isArray(v)) {
      out.handle = HANDLE_ONCE;
      if (cards === "full") { out.acts = v; continue; }
      const mine = v.filter((c) => usable(c.act));
      out.acts = n === "2" ? mine.map((c) => c.act) : mine.map((c) => line(HOUSEHOLD_LINES, c.act, firstSentence(c.teaches ?? c.blurb)));
      out.cards = n === "2" ? "names-only" : "one-line";
      out.cards_note = CARDS_NOTE[n];
      continue;
    }
    out[k] = v;
  }
  out.read_shape = shape;
  return out;
}

/** A door's `cards` schema field at `shape` (none at the 0 shape: the schema is the one it had). */
export const CARDS_FIELD = Object.freeze({
  type: "string", enum: ["full"],
  description: 'cards: "full" gives every act\'s full card (today\'s cards); omitted, the bare read gives each act as one line (shape 1) or by name (shape 2).',
});

/** The door's tool schema at `shape`: the 0 shape answers `schema` itself; 1 and 2 add `cards`. */
export function doorSchemaAt(schema, shape, cache) {
  if (isControl(shape)) return schema;
  if (!cache.has(shape)) cache.set(shape, { ...schema, properties: { ...schema.properties, cards: CARDS_FIELD } });
  return cache.get(shape);
}
