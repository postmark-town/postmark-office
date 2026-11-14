// event-sparks.mjs — WHAT AN EVENT LEAVES BEHIND (POS-1035; CORE-70 calls 4, 12, 13, 16, 17, 22, 25; WLD-173's office half).
//
// THE EVIDENCE OF AN EVENT, from the record and nothing else. For an event that has opened its doors, the office answers:
//   · its WINDOW — `fields.doors_open ?? starts` through `ends`, the canonical post's own instants (frozen frame, 16:44Z), never
//     the filing date, a room's started/latest or the current time;
//   · its ROOM — the conversation that formed at the event's place in that window: the say record clustered exactly as the
//     conversations page clusters it (world2/tools/conversations.mjs, one place per settlement, carried across one by CORE-97),
//     scoped to the window, the cluster with a voice within earshot of the place. Its thread is the conversations page's own;
//   · who was THERE — `present`: the households with a PUBLIC act at the place in the window (call 4). Never RSVPs, never who is
//     standing there now, never a guessed membership: the act's own `household`, as the record attributed it when it was taken.
// The site reads these; it never works out a room, a window or attendance itself (CORE-82).
//
// THE SPARK'S FRAME (POS-1035-room-spark-frame.md, frozen). A real room's absolute bounds become the record's centred frame —
// `at` the exact midpoint (halves kept), `extent` the exact differences (zero kept) — with no rounding, padding or minimum. With
// NO conversation the frame is the event's place and the ruled 60 m radius (120 × 120). A room that cannot be read is NOT "no
// conversation": it is unavailable, and nothing falls back to the radius on its account.

import * as talk from "../world2/tools/conversations.mjs";
import { PUBLIC_ACTS } from "./world-read-v2.mjs";
import { publicActSql } from "./hearth-public.mjs";

/** The ruled no-conversation extent (WLD-173 Q1, Darko 09:37 EST: "an extent locked at 60 radius (base earshot)"). */
export const SPARK_RADIUS_M = 60;
/** How near the event's place a public act must be to count as there, and a room's voice to be the event's room: earshot. */
export const EVENT_PLACE_M = 60;
/** The in-world public acts that show a household was there (world-read-v2.mjs § PUBLIC_ACTS). An RSVP is not among them. */
export const PRESENCE_ACTS = Object.freeze(Object.keys(PUBLIC_ACTS));

const iso = (ms) => new Date(ms).toISOString();
const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));

/** The event's canonical window, `[doors_open ?? starts, ends]`, from a posts row (events-store.mjs § rowOf) or an event view. */
export function eventWindow(event) {
  const from = ms(event?.fields?.doors_open ?? event?.doors_open ?? event?.starts);
  const to = ms(event?.ends);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from, to };
}

/** The frozen frame of a real room (`thread.extent` is absolute, rounded-metre bounds): exact midpoint and differences. */
export function roomFrame(thread) {
  const { x0, y0, x1, y1 } = thread.extent;
  return { room: thread.id, at: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, extent: { w: x1 - x0, h: y1 - y0 } };
}

/** The frame with no conversation: the maker's resolved place (an event's canonical place) and the 60 m radius. */
export function placeFrame(place) {
  return { at: { x: Number(place.x), y: Number(place.y) }, extent: { w: 2 * SPARK_RADIUS_M, h: 2 * SPARK_RADIUS_M } };
}

const near = (p, place, m = EVENT_PLACE_M) => Math.hypot(p.x - place.x, p.y - place.y) <= m;

/**
 * THE ROOM, from voices already read off the record. `voices` are `voiceRecords` voices (each with `at` ms, `x`, `y`); `edges` the
 * published settlements (ms). Pure, so the read and the tick resolve the same room from the same rows. Returns
 * `{ room: thread | null, rooms: n, history, note? }` — `history: "unavailable"` when the window opens before the oldest settlement
 * this office knows, since then a voice's settlement (and so its room) cannot be told; that is never read as no conversation.
 */
export function eventRoomFrom(voices, { window, place, edges = [], earshotM = talk.SAY_DIAL_SPEC.earshot_m[0] }) {
  const marks = [...edges].filter(Number.isFinite).sort((a, b) => a - b);
  if (marks.length && window.from < marks[0])
    return { room: null, rooms: 0, history: "unavailable",
      note: `the event's window opens before the oldest settlement this office has read (${iso(marks[0])}), so the room its talk formed cannot be told — this is not evidence that nobody spoke` };
  const inWindow = voices.filter((v) => v.at >= window.from && v.at <= window.to);
  const clusters = talk.clusterVoices(inWindow, { earshotM, boundaries: marks });
  const here = clusters.filter((c) => c.voices.some((v) => near(v, place, earshotM)));
  if (!here.length) return { room: null, rooms: 0, history: "complete" };
  // the event's room is the one where most was said at its place; the others are counted, not dropped
  const best = [...here].sort((a, b) => b.voices.length - a.voices.length || a.voices[0].at - b.voices[0].at)[0];
  // the conversations page's own thread header (its id, bounds, participants, counts); its lines are the circle reads' to serve
  const { voices: _lines, ...thread } = talk.threadOf(best, { live: false, voiceCap: 1 });
  return { room: thread, rooms: here.length, history: "complete",
    ...(here.length > 1 ? { note: `${here.length} conversations formed at the place in the window (a settlement split one, or two groups talked apart); the room is the one with the most said` } : {}),
    ...(marks.length ? {} : { settlement_note: "no settlement could be read, so the window's talk is grouped as one settlement" }) };
}

/** Who was there: the distinct households of `rows` (public acts, each placed `{x, y}` and attributed) at the place in the window. */
export function presentFrom(rows, { window, place }) {
  const out = new Set();
  for (const r of rows) {
    const t = ms(r.at);
    if (!r.household || !Number.isFinite(t) || t < window.from || t > window.to) continue;
    if (!r.point || !near(r.point, place)) continue;
    out.add(String(r.household));
  }
  return [...out].sort();
}

/**
 * THE EVIDENCE, read from the record in one read-only transaction (`client`). `event` is a posts row; `edges` the published
 * settlements. Answers `{ window, room, present, evidence }`; while the event is still on, `as_of` is now and `complete` false.
 */
export async function eventEvidence(client, event, { now = Date.now(), edges = [] } = {}) {
  const window = eventWindow(event);
  if (!window) return null;
  const place = { x: Number(event.place_x), y: Number(event.place_y) };
  const until = Math.min(window.to, now);
  if (until < window.from) return null; // doors not open yet: nothing to tell
  const scoped = { from: window.from, to: until };
  const [{ rows: sayRows }, { rows: markRows }, { rows: actRows }] = await Promise.all([
    client.query(`SELECT id, at, actor, action, at_anchor, at_dx, at_dy, payload FROM acts
                   WHERE action = ANY($1) AND at >= $2 AND at <= $3 ${talk.VOICE_ORDER_SQL}`, [talk.VOICE_ACTIONS, iso(scoped.from), iso(scoped.to)]),
    client.query(talk.ANCHOR_MARKS_SQL),
    client.query(`SELECT id, at, action, household, at_anchor, at_dx, at_dy FROM acts
                   WHERE action = ANY($1) AND household IS NOT NULL AND at >= $2 AND at <= $3 AND ${publicActSql()}
                   ORDER BY at, id`, [PRESENCE_ACTS, iso(scoped.from), iso(scoped.to)]),
  ]);
  const centres = talk.anchorCentres(markRows);
  const centreOf = (id) => centres.get(id) ?? null;
  // WLD-74: a say spoken inside a dungeon room is not on a public read, and so not in an event's public room either
  const spoken = sayRows.filter((r) => !(r.payload?.room ?? r.payload?.payload?.room));
  const { voices, unplaced } = talk.voiceRecords(spoken, { centreOf, strict: false });
  const room = eventRoomFrom(voices, { window: scoped, place, edges });
  const placed = actRows.map((r) => ({ ...r, point: talk.composeAnchor({ anchor: r.at_anchor, dx: r.at_dx, dy: r.at_dy }, centreOf) }));
  const present = presentFrom(placed, { window: scoped, place });
  const complete = until === window.to;
  return {
    window: { from: iso(window.from), to: iso(window.to), ...(complete ? {} : { as_of: iso(until) }) },
    complete,
    room: room.room ? { ...room.room, frame: roomFrame(room.room) } : null,
    room_history: room.history,
    ...(room.note ? { room_note: room.note } : {}),
    ...(room.rooms > 1 ? { rooms_at_place: room.rooms } : {}),
    present,
    present_basis: `households with a public act (${PRESENCE_ACTS.join(", ")}) within ${EVENT_PLACE_M} m of the event's place inside its window — never RSVPs, never who is there now`,
    ...(unplaced.length ? { unplaced_says: unplaced.length } : {}),
  };
}
