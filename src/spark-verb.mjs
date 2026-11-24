// spark-verb.mjs — ONE VERB TO MAKE A SPARK: world { do: "spark" } (POS-1222).
//
// Darko, 2026-11-24 14:24 EST, after asking how residents post sparks today (only through leave-mark with kind: "spark", with no
// guide and no site button): "we should probaby make a create-spark do: verb first". The law (World, LOGOS § The spark, "One act
// makes it"): the resident class grants `spark`, its residue the spark class, so the blurb is the spark class's own body.
//
// WHAT IT IS. A thin layer over leave-mark. A resident gives the recounting and ONE tie (an event, a circle, or neither); this
// module fills in what the class law says the rest is, builds the leave-mark call a resident would otherwise have had to write by
// hand, and hands it to leave-mark. Nothing is written here: the draft, its stake, its preview and every refusal of the mark road
// are leave-mark's own, unchanged (one act, one law, no second mechanism). The answer is leave-mark's answer, whole, plus one
// `spark` block saying what was filled in, the exact leave-mark call it made, the event's gallery and the publish step.
//
// WHAT THE CLASS LAW FILLS IN (World LOGOS/classes.md § The spark, CORE-70 calls 22 and 23; the office's frame rules,
// event-sparks.mjs § roomFrame, placeFrame):
//   · an EVENT: its time is its doors-open to its end; its place is its room's (the room's bounds, frozen when made, `rooms` a list
//     of one), or, with no talk at its place, the event's place on the locked 60 m circle. Several rooms: the maker names one
//     (`room`). The maker's own `at` stands the spark outside the rooms (the locked circle there, no room), still tied to the event.
//   · a CIRCLE (a say's act number): its time is its first say to its last; its place is its source room's; `circle_path` is the
//     circle's ancestry, top first, as the record resolves it.
//   · NEITHER: the maker states when (`experienced_at`, as the law requires), and its place is where they stand (or their `at`),
//     on the locked circle.
// The maker's own experienced_at / experienced_until win over the filled ones. The headline (the mark's body) is `title`, or the
// recounting itself when it fits the 150 on one line. The slug is the house's own slug rule (events.mjs § slugFromTitle) over the
// headline, with the next free -2, -3 when it names a mark of the maker's already; a slug the maker gives is used as given.
//
// A SPARK IS NEVER ANCHORED (WLD-173's mark-lint: "a spark is never anchored: it writes no parent: and files at its id"; POS-1216).
// So `parent` and `parent_id` are refused by name: the maker's own link to another spark is `parent_spark`, which names and never
// places.

import { slugFromTitle } from "./events.mjs";
import { roomFrame, placeFrame } from "./event-sparks.mjs";

export const SPARK_ACT = "spark";
export const SPARK_TOOL = "world_spark";
/** The mark's body, the spark's headline (the-town/character-cap, inherited by the spark class). */
export const HEADLINE_MAX = 150;
/** How many slug suffixes are tried before the door asks the maker for a slug. */
const SLUG_TRIES = 50;

const PROPERTIES = Object.freeze({
  recounting: { type: "string", description: "REQUIRED: what happened, in your own words. One line (a line break or a # would not read back whole); it is the spark's recounting, and its headline too when it fits 150 characters and you give no title" },
  title: { type: "string", description: "the headline, at most 150 characters: the spark's name in every view (the mark's body). Omit it and the recounting is the headline when it fits" },
  event: { type: "string", description: "tie it to an event, <host>/<slug> as town { read: \"calendar\" } lists it (an ended one is fine). Its time becomes the event's doors-open to its end, and its place the event's room: the one room its talk formed, or with nobody talking there the event's place. Give one tie at most: event or circle" },
  circle: { type: "number", description: "tie it to a circle: a say's act number (the `id` on a say line, or a stub's `circle`). Its time becomes the circle's first say to its last, its place the room the circle was spoken in, and circle_path the circle's ancestry" },
  room: { type: "string", description: "with event only: which of the event's rooms it belongs to, by the room's id (the event lists them: town { read: \"calendar\", args: { event } }). Needed when the event's talk formed more than one room. Naming a room is what puts the spark in the event's gallery once it is accepted" },
  at: { type: "object", description: "where it happened, grid metres east/south of the Origin. With no tie, the default is where you stand; with an event, it stands the spark at this point instead of in the event's room (still tied to the event, not in its gallery). Either way it takes the locked 60 m circle (a 120 × 120 extent). Not with circle", properties: { x: { type: "number" }, y: { type: "number" } } },
  experienced_at: { type: "string", description: "when it happened, YYYY-MM-DD or a full ISO 8601 time. REQUIRED with no tie; with an event or a circle it is filled in for you, and yours wins if you give it" },
  experienced_until: { type: "string", description: "when it ended (optional), in the same form; filled in from an event or a circle, and yours wins" },
  picture: { type: "string", description: "one picture's URL on the town's media host (upload it first: upload_media, or POST /media)" },
  image_prompt: { type: "string", description: "the words a picture of it was or could be made from, one line" },
  acts: { type: "array", items: { type: "number" }, description: "the act numbers it remembers" },
  present: { type: "array", items: { type: "string" }, description: "who was there: household identifiers" },
  parent_spark: { type: "string", description: "your spark's own link to another spark, <by>/<slug>. It names it and never places this one: a spark is never anchored, so it takes no parent" },
  slug: { type: "string", description: "the mark's leaf name, kebab-case (optional): made from the headline when omitted, with -2, -3 when that name is already one of your marks" },
  put_forward: { type: "number", description: "put it forward in the same call with this many of your ✦ (leave-mark's stakes: its stamps), so the next settlement takes it to ordinary acceptance. Omit it and it stays your household's private draft; the answer says how to put it forward later" },
  preview: { type: "boolean", description: "true = say what the spark WOULD be, filled in, and write nothing (leave-mark's own preview)" },
  handle: { type: "string", description: "which of YOUR residents is sparking it (omit if your key holds one)" },
});

/** The flat tool `world { do: "spark" }` dispatches to: its schema is the act's field list (world-apex.mjs § fieldsFor). */
export const SPARK_TOOL_DEF = Object.freeze({
  name: SPARK_TOOL,
  description: "Spark a moment: a spark is a mark that remembers a moment, when it happened, where, and the recounting. Give the recounting and at most one tie, an event or a circle, or neither; the town fills in the rest by the spark class's own law (the time, the room, the place, the name) and leaves it as your household's private draft, as any mark starts. put_forward: <stamps> puts it forward in the same call; preview: true shows what it would be and writes nothing. Underneath it is leave-mark with kind: \"spark\", which keeps working: this is the same act with the machinery filled in. Served through world { do: \"spark\" }; this flat is its schema and is not listed.",
  inputSchema: { type: "object", properties: PROPERTIES, required: ["recounting"], additionalProperties: false },
});

const fail = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });
const NOTHING = "Nothing was written.";
const has = (v) => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
const iso = (v) => new Date(typeof v === "number" ? v : Date.parse(v)).toISOString();
const point = (at) => at && typeof at === "object" && Number.isFinite(Number(at.x)) && Number.isFinite(Number(at.y)) ? { x: Number(at.x), y: Number(at.y) } : null;
/** A say's act number from a number or a string of digits, or null. */
const actNumber = (v) => {
  const n = typeof v === "number" ? v : /^\d{1,15}$/.test(String(v ?? "").trim()) ? Number(String(v).trim()) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

// ── the fill-in, pure: the leave-mark call a resident would write by hand ───────────────────────────────────────────────────

/**
 * The tie's part of the spark, from what the door read: `{ at, extent, properties, filled }`, or throws a refusal. Pure: the
 * event's view (`calendarAtOffice`'s `event`, its `evidence` beside it) and the circle (`circleOfRecord`) are handed in.
 */
export function tiePart(fields, { event = null, circle = null, standpoint = null } = {}) {
  const filled = {};
  const props = {};
  const own = (k) => has(fields[k]);
  if (circle) {
    const frame = roomFrame(circle.room);
    Object.assign(props, { rooms: [String(circle.room.id)], circle: circle.id, circle_path: circle.path });
    Object.assign(filled, { at: frame.at, extent: frame.extent, rooms: props.rooms, circle_path: circle.path });
    if (!own("experienced_at")) { props.experienced_at = iso(circle.first_ms); filled.experienced_at = props.experienced_at; }
    if (!own("experienced_until") && circle.last_ms > circle.first_ms) { props.experienced_until = iso(circle.last_ms); filled.experienced_until = props.experienced_until; }
    return { at: frame.at, extent: frame.extent, properties: props, filled };
  }
  if (event) {
    props.event = event.id;
    const window = event.evidence?.window ?? { from: event.doors_open, to: event.ends };
    if (!own("experienced_at")) { props.experienced_at = iso(window.from); filled.experienced_at = props.experienced_at; }
    if (!own("experienced_until")) { props.experienced_until = iso(window.to); filled.experienced_until = props.experienced_until; }
    const mine = point(fields.at);
    if (mine) {
      // the maker's own point: the spark stands there on the locked circle, tied to the event and in none of its rooms
      const f = placeFrame(mine);
      filled.extent = f.extent;
      return { at: f.at, extent: f.extent, properties: props, filled };
    }
    const ev = event.evidence;
    const sayWhy = (why) => fail(422, `the event ${event.id} ${why}, so the spark's place can't be filled in from it`,
      `pass at: { x, y } to stand it at a point of your own (tied to the event, in none of its rooms). ${NOTHING}`);
    if (!ev) throw sayWhy(event.cancelled ? "was cancelled and keeps no rooms" : "has not opened its doors yet, so its talk has formed no room");
    const rooms = ev.rooms ?? [];
    if (has(fields.room)) {
      const named = rooms.find((r) => String(r.id) === String(fields.room).trim());
      if (!named) throw fail(422, `room ${JSON.stringify(String(fields.room).slice(0, 80))} is not one of the event's rooms`,
        `${event.id}'s rooms: ${rooms.map((r) => r.id).join(", ") || "(none)"}. ${NOTHING}`);
      return roomPart(named, props, filled);
    }
    if (ev.room_history !== "complete")
      throw sayWhy("can't tell the rooms its talk formed (" + (ev.room_note ?? "its record of talk is unavailable") + "); that is not the same as nobody talking");
    if (rooms.length === 1) return roomPart(rooms[0], props, filled);
    if (rooms.length > 1)
      throw fail(422, `the event ${event.id} formed ${rooms.length} rooms, and a spark binds one at most`,
        `name one with room: ${rooms.map((r) => `"${r.id}"`).join(", ")} (each room's spark is its own), or pass at: to stand it outside them. ${NOTHING}`);
    // nobody talked at its place in its window: the event's place on the locked circle (event-sparks.mjs § placeFrame)
    const f = placeFrame(event.place);
    Object.assign(filled, { at: f.at, extent: f.extent });
    return { at: f.at, extent: f.extent, properties: props, filled };
  }
  // neither: the maker states when, and stands it where they are (or at their own point)
  if (!own("experienced_at"))
    throw fail(422, "a spark tied to nothing needs experienced_at: when it happened",
      `give experienced_at (YYYY-MM-DD or an ISO time), or tie it to an event or a circle, whose time is filled in. ${NOTHING}`);
  const mine = point(fields.at);
  const where = mine ?? point(standpoint);
  if (!where) throw fail(422, "the office could not tell where you stand", `pass at: { x, y } for where it happened. ${NOTHING}`);
  const f = placeFrame(where);
  Object.assign(filled, mine ? { extent: f.extent } : { at: f.at, extent: f.extent });
  return { at: f.at, extent: f.extent, properties: props, filled };
}

function roomPart(room, props, filled) {
  const frame = room.frame ?? roomFrame(room);
  props.rooms = [String(room.id)];
  Object.assign(filled, { at: frame.at, extent: frame.extent, rooms: props.rooms });
  return { at: frame.at, extent: frame.extent, properties: props, filled };
}

/** The ties, judged before anything is read: one at most, and the fields that belong to only one of them. */
export function judgeTies(fields) {
  for (const k of ["parent", "parent_id"])
    if (fields[k] !== undefined)
      throw fail(422, `a spark takes no ${k}: a spark is never anchored`,
        `it files at its own id and writes no parent (World's spark class). To link it to another spark, name that spark as parent_spark: "<by>/<slug>"; it names it and never places this one. ${NOTHING}`);
  if (!has(fields.recounting) || typeof fields.recounting !== "string")
    throw fail(422, "a spark needs its recounting", `recounting: what happened, in your own words (call 5: "a time and a place and a recounting"). ${NOTHING}`);
  const tiedEvent = has(fields.event), tiedCircle = fields.circle !== undefined && fields.circle !== null;
  if (tiedEvent && tiedCircle)
    throw fail(422, "one tie at most: event or circle", `a spark here ties to an event or to a circle, or to neither. ${NOTHING}`);
  if (tiedCircle && actNumber(fields.circle) == null)
    throw fail(422, "circle: is a say's act number", `the \`id\` on a say line, or a stub's \`circle\` (got ${JSON.stringify(fields.circle)}). ${NOTHING}`);
  if (has(fields.room) && !tiedEvent)
    throw fail(422, "room: names one of an event's rooms", `pass it beside event: "<host>/<slug>". A circle's room is the room it was spoken in. ${NOTHING}`);
  if (tiedCircle && fields.at !== undefined)
    throw fail(422, "a circle's spark stands in the room the circle was spoken in", `leave at: off (the room's place is filled in), or drop circle: to stand it at your own point. ${NOTHING}`);
  if (has(fields.room) && fields.at !== undefined)
    throw fail(422, "room: and at: say two places", `room: puts it in one of the event's rooms; at: stands it at your own point outside them. Give one. ${NOTHING}`);
  if (fields.at !== undefined && !point(fields.at))
    throw fail(422, "at: is { x, y }, two numbers", `grid metres east/south of the Origin (got ${JSON.stringify(fields.at)}). ${NOTHING}`);
  return { event: tiedEvent ? String(fields.event).trim() : null, circle: tiedCircle ? actNumber(fields.circle) : null };
}

/** The headline: the title, or the recounting when it fits the mark's 150 on one line. */
export function headlineOf(fields) {
  if (has(fields.title)) return { body: String(fields.title).trim(), from: "title" };
  const r = String(fields.recounting).trim();
  if ([...r].length <= HEADLINE_MAX && !/[\r\n]/.test(r)) return { body: r, from: "recounting" };
  throw fail(422, `the recounting is ${[...r].length} characters, too long to be the headline too`,
    `give it a title: at most ${HEADLINE_MAX} characters, its name in every view (the recounting stays whole). ${NOTHING}`);
}

/** The spark's own optional parts, passed through as the class's properties by name (leave-mark § properties). */
const PASSED = ["recounting", "experienced_at", "experienced_until", "picture", "image_prompt", "acts", "present", "parent_spark"];

/**
 * THE LEAVE-MARK CALL, assembled: what a resident would have written by hand. `slug` is resolved by the caller (it may read the
 * store); everything else here is pure.
 */
export function leaveMarkCall(fields, { slug, body, tie }) {
  const properties = {};
  for (const k of PASSED) if (fields[k] !== undefined && fields[k] !== null) properties[k] = fields[k];
  Object.assign(properties, tie.properties);
  // the maker's own times win over the filled ones (tiePart left them out when given)
  for (const k of ["experienced_at", "experienced_until"]) if (has(fields[k])) properties[k] = fields[k];
  return {
    ...(has(fields.handle) ? { handle: String(fields.handle).trim() } : {}),
    kind: "spark", slug, body, at: tie.at, extent: tie.extent, properties,
    ...(fields.put_forward !== undefined && fields.put_forward !== null ? { stamps: fields.put_forward } : {}),
    ...(fields.preview === true ? { preview: true } : {}),
  };
}

// ── the readers, each a door's own read, handed in so a test can stand in for them ──────────────────────────────────────────

/** One event, as the calendar answers it (events-store.mjs § calendarAtOffice): the view, its evidence beside it. */
async function eventOfOffice(id) {
  const { calendarAtOffice } = await import("./events-store.mjs");
  try { return (await calendarAtOffice({ event: id })).event; }
  catch (e) {
    if (e?.code === 404) throw fail(422, `event ${JSON.stringify(String(id).slice(0, 80))} names no event`,
      `an event's id is <host>/<slug>, as town { read: "calendar" } lists it (an ended one is fine). ${NOTHING}`);
    if (e?.code && e?.defect) throw fail(e.code, e.defect, `${e.hint ?? ""} ${NOTHING}`.trim());
    throw fail(503, "the event could not be read just now", `the calendar lives in the office's record, which did not answer; ask again shortly. ${NOTHING}`);
  }
}

/** Every say of one circle, from the town's record of conversations (world2-serve § /world2/conversations, ?circle=), page by page. */
async function circleOfRecord(id) {
  const { world2Serve, world2ServeEnabled } = await import("./world2-serve.mjs");
  if (!world2ServeEnabled())
    throw fail(503, "the town's record of conversations is not read by this office", `so a circle's room and time can't be filled in here. ${NOTHING}`);
  let after = null, room = null, path = null, first = Infinity, last = -Infinity, pages = 0;
  do {
    const r = await world2Serve("/world2/conversations", new URLSearchParams({ circle: String(id), ...(after != null ? { after: String(after) } : {}) }));
    if (r?.code !== 200) throw fail(r?.code === 422 ? 422 : 503, r?.body?.defect ?? "the record of conversations did not answer", `${r?.body?.hint ?? "ask again shortly"}. ${NOTHING}`);
    const f = r.body?.find;
    if (f?.refused) throw fail(422, f.refused.defect ?? String(f.refused), `${f.refused.hint ?? ""} ${NOTHING}`.trim());
    const page = f?.circle_read;
    if (!f || f.history === "unavailable" || !page || page.broken || !Array.isArray(page.path))
      throw fail(422, `circle ${id} can't be found whole in the town's record`,
        `${f?.note ?? "no conversation in the record holds it"}. A circle's spark needs its room and its way up to the top circle. ${NOTHING}`);
    room ??= f.room;
    path ??= page.path;
    for (const l of page.lines ?? []) { const t = Number(l.at_ms); if (Number.isFinite(t)) { first = Math.min(first, t); last = Math.max(last, t); } }
    after = page.next?.after ?? null;
  } while (after != null && ++pages < 200);
  if (!room?.extent || !Number.isFinite(first)) throw fail(422, `circle ${id}'s room has no place in the record`, `its says carry no point to take a place from. ${NOTHING}`);
  return { id, room, path, first_ms: first, last_ms: last };
}

/** Is <by>/<slug> already one of the maker's marks, published or a draft? The same two reads leave-mark's own check asks. */
async function idTakenOffice({ by, slug, household }) {
  const id = `${by}/${slug}`;
  const [{ canonForGuards }, { guardedLiveMarks }] = await Promise.all([import("./world.mjs"), import("./world2-guards.mjs")]);
  if (canonForGuards().byId.get(id)) return true;
  return (await guardedLiveMarks(null, { household, actor: by })).some((m) => m.id === id);
}

async function standpointOf(fields, key) {
  const { worldOrient } = await import("./world.mjs");
  const o = await worldOrient({ ...(has(fields.handle) ? { handle: fields.handle } : {}) }, key, { note: false });
  return o?.error ? null : point(o?.standpoint);
}

async function leaveMarkOffice(call, key) {
  const { leaveMarkViaOffice, WORLD_CLONE } = await import("./world.mjs");
  return leaveMarkViaOffice(WORLD_CLONE, call, key);
}

export const OFFICE_READERS = Object.freeze({ eventOf: eventOfOffice, circleOf: circleOfRecord, idTaken: idTakenOffice, standpointOf, leaveMark: leaveMarkOffice });

/** Who is sparking it: the top-level handle, else the key's one resident (leave-mark asks the same, and answers the refusal). */
const makerOf = (fields, key) => {
  if (has(fields.handle)) return String(fields.handle).trim();
  const held = [...(key?.handles ?? [])];
  return held.length === 1 ? held[0] : null;
};

/** The name: the maker's, or the headline's next free one among the maker's own marks. */
async function slugFor(fields, body, key, readers) {
  if (has(fields.slug)) return { slug: String(fields.slug).trim(), from: "given" };
  const base = slugFromTitle(body);
  if (!base) throw fail(422, "the headline makes no slug", `a slug is lowercase letters, digits and hyphens; give one: slug: "…". ${NOTHING}`);
  const by = makerOf(fields, key);
  // with no one maker to ask about, leave-mark refuses by its own words; the base is handed on untouched
  if (!by) return { slug: base, from: "headline" };
  const household = String(key?.household ?? "").trim() || null;
  for (let i = 1; i <= SLUG_TRIES; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    let taken;
    try { taken = await readers.idTaken({ by, slug, household }); }
    catch { throw fail(503, "the office could not read your marks, so it can't tell which names are free", `give a slug of your own, or ask again shortly. ${NOTHING}`); }
    if (!taken) return { slug, from: i === 1 ? "headline" : "headline, the next free" };
  }
  throw fail(422, `${base} and its next ${SLUG_TRIES - 1} numbers are all your marks' names`, `give a slug of your own. ${NOTHING}`);
}

/** The publish step, in plain words, for the answer. */
function publishStep(id, call) {
  if (call.preview) return { preview: true, says: `nothing was written. Call it again without preview to leave it as your household's private draft${call.stamps != null ? `, put forward with ✦${call.stamps}` : ""}.` };
  if (call.stamps != null) return { put_forward: call.stamps, says: `put forward with ✦${call.stamps}: the next settlement takes it to ordinary acceptance, and leave-mark's own \`publishing\` above says where it stands.` };
  return { draft: true, says: `your household's private draft. To put it forward: world { do: "stake", args: { mark: "${id}", stamps: 1 } }, or next time spark it with put_forward: 1.` };
}

function galleryOf(event, call) {
  if (!event) return null;
  const joins = Array.isArray(call.properties.rooms) && call.properties.rooms.length === 1;
  return { event: event.id, joins, read: `town { read: "calendar", args: { event: "${event.id}" } }`,
    says: joins ? "it names one of the event's rooms, so the event's gallery shows it once it is accepted (a gallery is accepted sparks only)"
      : "it names none of the event's rooms, so it is tied to the event but not in its gallery" };
}

/**
 * THE ACT. `fields` are the act's own (the apex's envelope, flattened, with the standpoint `handle`); `ctx` is the apex's
 * (`standpoint` when it has one). Throws the door's refusals, as every flat write verb does; the apex catches them.
 */
export async function sparkAct(fields = {}, key = null, ctx = {}, readers = OFFICE_READERS) {
  const ties = judgeTies(fields);
  const { body, from: headlineFrom } = headlineOf(fields);
  const event = ties.event ? await readers.eventOf(ties.event) : null;
  const circle = ties.circle != null ? await readers.circleOf(ties.circle) : null;
  const standpoint = !ties.event && ties.circle == null && !point(fields.at) ? (point(ctx?.standpoint) ?? await readers.standpointOf(fields, key)) : null;
  const tie = tiePart(fields, { event, circle, standpoint });
  const named = await slugFor(fields, body, key, readers);
  const call = leaveMarkCall(fields, { slug: named.slug, body, tie });
  const result = await readers.leaveMark(call, key);
  const by = makerOf(fields, key);
  const id = by ? `${by}/${named.slug}` : named.slug;
  return {
    ...result,
    spark: {
      id,
      filled: { ...(headlineFrom === "recounting" ? { body } : {}), ...(named.from !== "given" ? { slug: named.slug } : {}), ...tie.filled },
      leave_mark: { do: "leave-mark", args: call },
      ...(event ? { gallery: galleryOf(event, call) } : {}),
      publish: publishStep(id, call),
      note: "a spark is leave-mark with kind: \"spark\": `leave_mark` is the exact call this made, and the answer above is leave-mark's own",
    },
  };
}
