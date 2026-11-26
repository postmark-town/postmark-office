// event-sparks.test.mjs — POS-1035: what an event leaves behind, from the record (CORE-70 calls 4, 13, 22, 25; the frozen
// room → spark frame, POS-1035-room-spark-frame.md). The pure frame, room and attendance derivations first; then the calendar's
// one-event evidence and the lasting list, on a disposable store.

import test, { after } from "node:test";
import assert from "node:assert/strict";

const S = await import("../src/event-sparks.mjs");

const T = Date.parse("2026-11-14T20:00:00Z");
const min = (m) => T + m * 60_000;
const PLACE = { x: 100, y: 200 };
const voice = (handle, m, x, y, id = null) => ({ handle, text: `${handle} at ${m}`, at: min(m), x, y, place: null, aboard: false, ...(id ? { id } : {}) });

test("the window is the canonical post's: fields.doors_open ?? starts, through ends — never the filing date or a room's span", () => {
  assert.deepEqual(S.eventWindow({ fields: { doors_open: "2026-11-14T19:30:00Z" }, starts: "2026-11-14T20:00:00Z", ends: "2026-11-14T22:00:00Z" }),
    { from: Date.parse("2026-11-14T19:30:00Z"), to: Date.parse("2026-11-14T22:00:00Z") });
  assert.deepEqual(S.eventWindow({ starts: new Date(min(0)), ends: new Date(min(60)) }), { from: min(0), to: min(60) }, "no doors_open: starts");
  assert.equal(S.eventWindow({ starts: "nope", ends: null }), null);
});

test("the frozen frame: a real room's exact bbox midpoint and differences — halves kept, zero kept, no padding", () => {
  assert.deepEqual(S.roomFrame({ id: "t1-pica", extent: { x0: 10, y0: 20, x1: 41, y1: 20, span_m: 31 } }),
    { room: "t1-pica", at: { x: 25.5, y: 20 }, extent: { w: 31, h: 0 } }, "a line room: a half kept, a zero height kept");
  assert.deepEqual(S.roomFrame({ id: "t2-solo", extent: { x0: 7, y0: 9, x1: 7, y1: 9, span_m: 0 } }),
    { room: "t2-solo", at: { x: 7, y: 9 }, extent: { w: 0, h: 0 } }, "a single-point room is a real room, not 'no conversation'");
  assert.deepEqual(S.placeFrame({ x: "100", y: 200 }), { at: { x: 100, y: 200 }, extent: { w: 120, h: 120 } }, "no conversation: the place, a 60 m radius");
});

const talk = await import("../world2/tools/conversations.mjs");
/** The ids the conversations page gives the same record (world2/tools/conversations.mjs § conversationsOf): the parity the event's rooms keep. */
const pageIds = (voices, { now, edges }) => {
  const page = talk.conversationsOf(voices.filter((v) => v.at <= now), { now, earshotM: 60, boundaries: edges, fadeMs: 600_000, closedMax: 999 });
  return [...page.live, ...page.closed].map((t) => t.id);
};

test("the event's room is the PAGE's room: clustered from the record exactly as the conversations page clusters it, picked by a voice inside the window at the place — a room that began before the doors keeps its own id", () => {
  const voices = [
    voice("early", -30, 100, 200),            // before the doors, at the place, in the same settlement: the room began here
    voice("pica", 1, 100, 200), voice("seth", 2, 110, 205), voice("liv", 3, 150, 200),
    voice("far", 4, 900, 900), voice("far2", 5, 905, 900), voice("far3", 6, 910, 900), // a bigger room, elsewhere
    voice("late", 200, 100, 200),             // after the window: not in the read as of its end
  ];
  const window = { from: min(0), to: min(120) }, edges = [min(-600)];
  const r = S.eventRoomFrom(voices, { window, place: PLACE, edges });
  assert.equal(r.history, "complete");
  assert.equal(r.rooms.length, 1, "the bigger room elsewhere is not the event's");
  const [room] = r.rooms;
  assert.equal(room.id, `t${min(-30)}-early`, "the room's own id, from its first say — not one made from the window's slice");
  assert.ok(pageIds(voices, { now: window.to, edges }).includes(room.id), "the id the conversations page gives it");
  assert.equal(room.voice_count, 4, "the room whole, as of the window's end (the later say is not read)");
  assert.deepEqual(room.participants, ["early", "pica", "seth", "liv"]);
  assert.equal("voices" in room, false, "the room's header; its lines are the circle reads' to serve");
  assert.deepEqual(S.roomFrame(room), { room: room.id, at: { x: 125, y: 202.5 }, extent: { w: 50, h: 5 } });
  // a room at the place that said nothing inside the window is not the event's
  const before = S.eventRoomFrom([voice("gone", -300, 100, 200)], { window, place: PLACE, edges: [min(-600), min(-120)] });
  assert.deepEqual(before.rooms, [], "talk that ended before the doors (closed at a settlement) is no room of the event");
});

test("no talk at the place is no room (the radius frame applies); talk the office cannot place in a settlement is UNAVAILABLE, never 'no conversation'", () => {
  const none = S.eventRoomFrom([voice("far", 1, 900, 900)], { window: { from: min(0), to: min(60) }, place: PLACE, edges: [min(-600)] });
  assert.deepEqual([none.rooms, none.history], [[], "complete"]);
  const old = S.eventRoomFrom([voice("pica", 1, 100, 200)], { window: { from: min(0), to: min(60) }, place: PLACE, edges: [min(30)] });
  assert.deepEqual([old.rooms, old.history], [[], "unavailable"]);
  assert.match(old.note, /not evidence that nobody spoke/);
});

test("CORE-97 × the event: a room that carries across a settlement inside the window is ONE room of the event, under the page's id; one that fell silent past the hour of grace is two — ALL the event's, in start order, none ranked (18:46:13Z)", () => {
  const window = { from: min(0), to: min(150) }, edges = [min(-600), min(30)];
  // a say at min(40) is within the hour after the settlement at min(30): it carries the room through it (CORE-97)
  const carried = [voice("a", 1, 100, 200), voice("b", 2, 100, 201), voice("c", 40, 100, 200), voice("d", 41, 101, 200)];
  const one = S.eventRoomFrom(carried, { window, place: PLACE, edges });
  assert.deepEqual(one.rooms.map((c) => [c.id, c.voice_count]), [[`t${min(1)}-a`, 4]], "carried across the settlement: one room, its first say's id");
  assert.deepEqual(pageIds(carried, { now: window.to, edges }), [`t${min(1)}-a`], "the page names it the same");
  // silence past the hour after the settlement (min(30) + 60 min = min(90)) closes it; a later say starts another room
  const split = [voice("a", 1, 100, 200), voice("b", 2, 100, 201), voice("c", 100, 100, 200), voice("d", 101, 101, 200), voice("e", 102, 100, 199)];
  const two = S.eventRoomFrom(split, { window, place: PLACE, edges });
  assert.deepEqual(two.rooms.map((c) => [c.id, c.voice_count]), [[`t${min(1)}-a`, 2], [`t${min(100)}-c`, 3]], "both, in the order they started — the bigger is not preferred");
  assert.deepEqual(new Set(pageIds(split, { now: window.to, edges })), new Set(two.rooms.map((c) => c.id)), "the page's two rooms, the same ids");
  assert.equal("room" in two, false, "no single room, no binding field");
  assert.equal("binding" in two, false);
});

test("spark_note (v1 read): an empty collection says why — free (the rule only, never a draft), cancelled, not ended, untellable rooms, or the next tick; a capped one says so; a whole one needs none", () => {
  const now = Date.parse("2026-11-14T23:00:00Z");
  const ended = "2026-11-14T22:00:00Z";
  const staked = { ends: ended, fields: { stake: { n: 20, by: "wright" } } };
  const ev = (over = {}) => ({ complete: true, room_history: "complete", rooms: [{ id: "t1-a" }], sparks: [], ...over });
  const free = S.sparkNoteOf({ ends: ended, fields: { completed: { act: 9, at: ended, free: true } } }, ev(), { now });
  assert.match(free, /posted before events were staked, so it stays free and keeps no public sparks of its own here: .* its host's draft, not the town's canon, and once published it is an ordinary spark — look for it in the gallery/);
  assert.doesNotMatch(free, /\bwere made\b|\bwas made\b/, "never claims a draft exists — an event before the cutoff has none");
  assert.doesNotMatch(free, /\d/, "the free note carries no count, id or time — only the rule");
  assert.match(S.sparkNoteOf({ ends: ended, fields: { stake: { n: 20, by: "w", returned: { n: 20 } } } }, ev(), { now }), /came home with its cancellation/);
  assert.match(S.sparkNoteOf({ ...staked, ends: "2026-11-15T01:00:00Z" }, ev({ complete: false }), { now }), /made after it ends, one per room/);
  assert.match(S.sparkNoteOf(staked, ev({ room_history: "unavailable", rooms: [] }), { now }), /cannot be told yet, .* unknown, not silence/);
  assert.match(S.sparkNoteOf(staked, ev({ rooms: [{ id: "t1-a" }, { id: "t2-b" }] }), { now }), /next keeping tick/, "several rooms are no hold: each will get its own");
  assert.match(S.sparkNoteOf(staked, ev({ rooms: [] }), { now }), /next keeping tick/, "confirmed silence still makes its spark");
  assert.equal(S.sparkNoteOf(staked, ev({ sparks: [{ id: "wright/x", accepted: true }] }), { now }), undefined, "a whole collection needs no note");
  const rooms = Array.from({ length: 23 }, (_, i) => ({ id: `t${i}-a` }));
  assert.match(S.sparkNoteOf(staked, ev({ rooms, sparks: rooms.slice(0, 20).map((r) => ({ id: r.id })) }), { now }),
    /^23 rooms formed, and an event makes at most 20 sparks, one per room in the order the rooms began — the last 3 have none/);
  assert.equal(S.sparkNoteOf(staked, ev({ sparks: null }), { now }), undefined, "an unread collection's note is the read's own");
});

// World's one-room rule as World #391 states it (tools/spark.mjs § roomsPlace, dcd4d57b): exactly one room's finite, uninverted
// bounds → midpoint and differences; anything else null. Handed in as the engine would hand its own; it records what it was asked.
const asked = [];
const worldRoomsPlace = (bounds) => {
  asked.push(bounds);
  if (!Array.isArray(bounds) || bounds.length !== 1) return null;
  const { x0, y0, x1, y1 } = bounds[0] ?? {};
  if (![x0, y0, x1, y1].every((v) => typeof v === "number" && Number.isFinite(v)) || x1 < x0 || y1 < y0) return null;
  return { at: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, extent: { w: x1 - x0, h: y1 - y0 } };
};

test("each room its own spark (Darko 23:10 EST): each room placed by the WORLD's roomsPlace from its own bounds, naming that one room, in start order, at most 20; confirmed silence ONE on the locked circle; unknown history, a null or no helper HELD", () => {
  const row = { id: "pica/sorbet-night", title: "Sorbet night", body: "sorbet on the counter", place_x: 100, place_y: 200 };
  const window = { from: "2026-11-14T20:00:00.000Z", to: "2026-11-14T22:00:00.000Z" };
  const a = { id: "t1-a", voice_count: 2, extent: { x0: 10, y0: 20, x1: 30, y1: 20, span_m: 20 } };   // a line room
  const b = { id: "t2-b", voice_count: 9, extent: { x0: 55, y0: 18, x1: 61, y1: 26, span_m: 10 } };   // apart from it, and bigger
  const opts = { roomsPlace: worldRoomsPlace };
  asked.length = 0;
  const one = S.sparkDeclarations(row, { rooms: [{ ...a, frame: S.roomFrame(a) }], room_history: "complete", window, present: ["pica-house"] }, opts);
  assert.deepEqual(asked, [[{ x0: 10, y0: 20, x1: 30, y1: 20 }]], "World is asked with exactly that one room's absolute bounds");
  assert.equal(one.sparks.length, 1);
  assert.deepEqual([one.sparks[0].at, one.sparks[0].extent], [{ x: 20, y: 20 }, { w: 20, h: 0 }], "the room's own frame: exact midpoint and differences, its zero kept");
  assert.deepEqual(one.sparks[0].properties.rooms, ["t1-a"], "the room, by the page's id — World's strict `rooms`, one id");
  assert.equal("room" in one.sparks[0].properties, false, "no scalar alias");
  assert.deepEqual(one.sparks[0].properties.present, ["pica-house"]);
  assert.equal(one.sparks[0].properties.recounting, "sorbet on the counter");
  assert.equal(one.sparks[0].properties.event, "pica/sorbet-night");
  const two = S.sparkDeclarations(row, { rooms: [a, b], room_history: "complete", window, present: [] }, opts);
  assert.deepEqual(two.sparks.map((s) => s.properties.rooms), [["t1-a"], ["t2-b"]], "one spark per room, in start order — the bigger is not first");
  assert.deepEqual(two.sparks.map((s) => [s.at, s.extent]), [[{ x: 20, y: 20 }, { w: 20, h: 0 }], [{ x: 58, y: 22 }, { w: 6, h: 8 }]], "each its own room's frame, no union");
  assert.equal("beyond" in two, false);
  const many = Array.from({ length: 22 }, (_, i) => ({ id: `t${i}-r`, extent: { x0: i, y0: 0, x1: i + 1, y1: 1, span_m: 1 } }));
  const capped = S.sparkDeclarations(row, { rooms: many, room_history: "complete", window, present: [] }, opts);
  assert.equal(capped.sparks.length, 20, "at most 20");
  assert.deepEqual(capped.sparks.map((s) => s.room), many.slice(0, 20).map((r) => r.id), "the first 20 in the natural (start) order — no ranking");
  assert.deepEqual(capped.beyond, ["t20-r", "t21-r"], "the rooms past the cap are named, not dropped silently");
  const none = S.sparkDeclarations(row, { rooms: [], room_history: "complete", window, present: [] }, { roomsPlace: () => assert.fail("no room asks no place") });
  assert.equal(none.sparks.length, 1, "confirmed silence: ONE spark");
  assert.deepEqual([none.sparks[0].at, none.sparks[0].extent], [{ x: 100, y: 200 }, { w: 120, h: 120 }], "the place and the ruled locked circle");
  assert.equal("rooms" in none.sparks[0].properties, false, "standalone: rooms absent");
  assert.match(S.sparkDeclarations(row, { rooms: [], room_history: "unavailable", window, present: [] }, opts).held, /cannot be told/,
    "unknown history is not silence");
  const inverted = { id: "t3-x", extent: { x0: 5, y0: 5, x1: 1, y1: 5 } };
  const nulled = S.sparkDeclarations(row, { rooms: [a, inverted], room_history: "complete", window, present: [] }, opts);
  assert.match(nulled.held, /roomsPlace will not place room t3-x's bounds — a null is not "no room"/, "one null holds the whole collection");
  assert.equal("sparks" in nulled, false, "never the locked circle for a real room");
  assert.match(S.sparkDeclarations(row, { rooms: [a], room_history: "complete", window, present: [] }).held, /has no roomsPlace/,
    "an engine without the World's helper holds: the office computes no place of its own");
  assert.equal(S.sparkDeclarations(row, { rooms: [], room_history: "complete", window, present: [] }).sparks.length, 1, "silence needs no helper");
});

test("present: the households with a public act at the place in the window — once each, sorted; nothing without a household or a place", () => {
  const rows = [
    { at: new Date(min(5)), household: "rabbit", point: { x: 100, y: 200 } },
    { at: new Date(min(6)), household: "rabbit", point: { x: 101, y: 200 } },
    { at: new Date(min(7)), household: "otter", point: { x: 150, y: 220 } },
    { at: new Date(min(8)), household: "heron", point: { x: 400, y: 200 } },       // beyond 60 m
    { at: new Date(min(-5)), household: "badger", point: { x: 100, y: 200 } },     // before doors
    { at: new Date(min(9)), household: null, point: { x: 100, y: 200 } },          // a berth: no household
    { at: new Date(min(9)), household: "mole", point: null },                      // unplaced
  ];
  assert.deepEqual(S.presentFrom(rows, { window: { from: min(0), to: min(60) }, place: PLACE }), ["otter", "rabbit"]);
  assert.ok(!S.PRESENCE_ACTS.includes("rsvp"), "an RSVP is never presence (call 4)");
});

// ── POS-1217 (CORE-177): who was there, by the actor the record kept ──

test("participants: the distinct actors of the same qualifying acts — each once, sorted; two of one household stay two; a human's own hand is flagged; no actor lists no one", () => {
  const w = { window: { from: min(0), to: min(60) }, place: PLACE };
  const at = (m, actor, household, point = { x: 100, y: 200 }) => ({ at: new Date(min(m)), actor, household, point });
  const rows = [
    at(5, "pica", "pica-house"), at(6, "pica", "pica-house"),                      // once
    at(7, "pica2", "pica-house"),                                                   // a housemate with an act of their own: distinct
    at(8, "human-of-otter", "otter-house", { x: 150, y: 220 }),                     // a human's own hand, at the companion's standing
    at(9, "heron", "heron-house", { x: 400, y: 200 }),                              // beyond 60 m
    at(-5, "early", "badger-house"),                                                // before doors
    at(61, "late", "badger-house"),                                                 // after the window the read is scoped to
    at(10, "berth", null),                                                          // no household: not today's `present`, so not here
    { at: new Date(min(11)), actor: "unplaced", household: "mole-house", point: null },
    at(12, "", "blank-house"), at(13, "   ", "blank-house"), at(14, null, "blank-house"), at(15, undefined, "blank-house"), at(16, 7, "blank-house"), // no recorded actor
    at(17, "human-of-", "odd-house"),                                               // not a hand: no house after the prefix
  ];
  assert.deepEqual(S.participantsFrom(rows, w), [
    { handle: "human-of-", household: "odd-house" },
    { handle: "human-of-otter", household: "otter-house", human: true },
    { handle: "pica", household: "pica-house" },
    { handle: "pica2", household: "pica-house" },
  ]);
  assert.deepEqual(S.presentFrom(rows, w), ["blank-house", "odd-house", "otter-house", "pica-house"], "the household read is untouched by the new one, and still names a house whose act had no actor");
  // the first qualifying act's household is the actor's
  assert.equal(S.participantsFrom([at(5, "mover", "first-house"), at(6, "mover", "second-house")], w)[0].household, "first-house");
});

test("presentParticipants: a human's hand gains the public presentation a conversation's line has, a resident gains nothing, and no book (or no such house) is unknown — never guessed, never `beside`", () => {
  const book = new Map([["starforge", { house: "Starforge", house_slug: "starforge", town_name: "DARKO", pronouns: "he/him" }], ["lantern-row", { house: "Lantern Row", house_slug: "lantern-row" }]]);
  const list = [{ handle: "human-of-lantern-row", household: "lantern-row", human: true }, { handle: "human-of-nowhere", household: "nowhere", human: true },
    { handle: "human-of-starforge", household: "starforge", human: true }, { handle: "rei", household: "starforge" }];
  assert.deepEqual(S.presentParticipants(list, book), [
    { handle: "human-of-lantern-row", household: "lantern-row", human: true, speaker: "the human of Lantern Row", house: "Lantern Row", house_slug: "lantern-row" },
    { handle: "human-of-nowhere", household: "nowhere", human: true },
    { handle: "human-of-starforge", household: "starforge", human: true, speaker: "DARKO, of Starforge", town_name: "DARKO", pronouns: "he/him", house: "Starforge", house_slug: "starforge" },
    { handle: "rei", household: "starforge" },
  ]);
  assert.deepEqual(S.presentParticipants(list, null), list, "no registry read: the canonical handles, untouched");
});

// ── on a disposable store: the calendar's one-event evidence and the lasting list ──

const { startStore } = await import("./helpers/embedded-store.mjs");
const store = await startStore({ db: "pos1035_event_sparks_test" });
after(() => store.stop());
const ENV = { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), WORLD2_PG_IDLE_TX_MS: "2000" };
const { calendarAtOffice, PAST_PAGE } = await import("../src/events-store.mjs");
const owner = await store.connect("world2_owner");
after(() => owner.end());
const NOW = min(24 * 60 * 30); // a month after the evening

async function event(id, startMin, endMin, { doors = null, household = "pica-house", state = "announced" } = {}) {
  await owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ($1, 'event', $2, '', 'pica', $3, NULL, $4, $5, $6, $7, $8, $9, 0, 1, 1)`,
    [id, `the ${id}`, household, PLACE.x, PLACE.y, new Date(min(startMin)), new Date(min(endMin)), state,
      JSON.stringify({ doors_open: new Date(min(doors ?? startMin)).toISOString() })]);
}
async function act(action, actor, m, x, y, household, payload = {}) {
  await owner.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy, household)
    VALUES ($1, 0, $2, $3, $4, $5, 'world', $6, $7, $8)`, [new Date(min(m)), actor, action, action === "say" ? "voice" : action, JSON.stringify(payload), x, y, household]);
}

test("one event's evidence: its window, the rooms its talk formed at its place (each with its frozen frame), and the households with a public act there", async () => {
  await event("pica/sorbet-opening", 0, 120, { doors: -30 });
  await act("say", "pica", -20, 100, 200, "pica-house", { text: "Welcome, everyone!", place: "the cave" });
  await act("say", "seth", 10, 131, 200, "seth-house", { text: "Is the lemon one sour?", place: "the cave", reply_to: 1 });
  await act("say", "far", 30, 5000, 5000, "far-house", { text: "elsewhere", place: "the quay" });
  await act("walk", "otter1", 50, 120, 210, "otter-house");
  await act("walk", "heron1", 50, 900, 900, "heron-house");                 // public, but far from the place
  await act("rsvp", "badger1", 5, 100, 200, "badger-house");                // an RSVP: never presence
  await act("walk", "late1", 200, 100, 200, "late-house");                  // after ends
  const { event: e } = await calendarAtOffice({ event: "pica/sorbet-opening" }, { now: NOW, env: ENV, settlements: () => [min(-600)] });
  const ev = e.evidence;
  assert.deepEqual(ev.window, { from: new Date(min(-30)).toISOString(), to: new Date(min(120)).toISOString() }, "doors_open → ends");
  assert.equal(ev.complete, true);
  assert.equal(ev.room_history, "complete");
  assert.equal(ev.rooms.length, 1);
  assert.equal(ev.rooms[0].voice_count, 2);
  assert.deepEqual(ev.rooms[0].frame, { room: ev.rooms[0].id, at: { x: 115.5, y: 200 }, extent: { w: 31, h: 0 } }, "exact midpoint, a half and a zero kept");
  assert.equal("frame" in ev, false, "the rooms' combined place is the World's (roomsPlace), asked when the spark is made — not a second copy in the read");
  assert.deepEqual(ev.gallery, { rooms: [ev.rooms[0].id], sparks: [] }, "the gallery's coverage is the event's rooms; no accepted spark there yet: known none");
  assert.deepEqual(ev.sparks, [], "and no public spark before completion — known none, never a failed read");
  assert.equal("spark" in ev, false, "no singular root");
  assert.equal("room" in ev, false, "the room set replaces the single room");
  assert.deepEqual(ev.present, ["otter-house", "pica-house", "seth-house"], "public acts at the place in the window; never the RSVP");
  assert.match(ev.present_basis, /never RSVPs/);
});

test("an event still on answers its evidence so far; one not yet open, or cancelled, carries none", async () => {
  await event("pica/still-on", 0, 600);
  const { event: on } = await calendarAtOffice({ event: "pica/still-on" }, { now: min(60), env: ENV, settlements: () => [min(-600)] });
  assert.equal(on.evidence.complete, false);
  assert.equal(on.evidence.window.as_of, new Date(min(60)).toISOString());
  const { event: soon } = await calendarAtOffice({ event: "pica/still-on" }, { now: min(-60), env: ENV, settlements: () => [] });
  assert.equal("evidence" in soon, false);
  await event("pica/called-off", 0, 60, { state: "cancelled" });
  const { event: off } = await calendarAtOffice({ event: "pica/called-off" }, { now: NOW, env: ENV, settlements: () => [] });
  assert.equal("evidence" in off, false);
});

// POS-1217: the whole fixture is invented, and one ground of its own (far from every other test's place), so the read below is the only thing that can fill it
const GROUND = { x: -3000, y: -3000 };
const REGISTRY = { households: { starforge: { name: "Starforge", residents: ["rei", "vex"], human: "Private Realname One", human_profile: { town_name: "DARKO", pronouns: "he/him", short_line: "a line" } } } };

test("the calendar's one-event read names who was there: two actors of one house stay two, a walker who never spoke is there, a human is the human and not the resident they stood beside, and no member, RSVP or draft is added", async () => {
  const sp = await import("../src/speaker-line.mjs");
  const { penHeld } = await import("../src/store-pool.mjs");
  const pen = await import("../src/world2-pen.mjs");
  const post = (id, endMin) => owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ($1, 'event', $2, '', 'pica', 'pica-house', NULL, $3, $4, $5, $6, 'announced', $7, 0, 1, 1)`,
    [id, `the ${id}`, GROUND.x, GROUND.y, new Date(min(0)), new Date(min(endMin)), JSON.stringify({ doors_open: new Date(min(0)).toISOString() })]);
  await post("pica/lantern-walk", 120);
  await post("pica/lantern-on", 600);
  const at = (action, actor, m, household, payload = {}, dx = 0, dy = 0) => act(action, actor, m, GROUND.x + dx, GROUND.y + dy, household, payload);
  await at("say", "pica", 10, "pica-house", { text: "Welcome, everyone!" });
  await at("walk", "pica2", 20, "pica-house", {}, 10, 5);                                      // a housemate, never speaks: a second recorded actor of the same house
  await at("walk", "otter1", 30, "otter-house", {}, 20, 10);                                   // a walker who never spoke
  await at("say", "human-of-starforge", 40, "starforge", { text: "we made it aboard", stood_with: "vex" }, 5, 0); // the human's own hand; vex lent the standing and did nothing
  await at("say", "human-of-ghost", 41, "ghost", { text: "hello" });                           // a hand whose house the book does not know
  await owner.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy, household) VALUES
    ($1, 0, 'maker1', 'leave-mark', 'mark', '{"put_forward": true}', 'world', $3, $4, 'maker-house'),
    ($2, 0, 'drafter', 'leave-mark', 'mark', '{}', 'world', $3, $4, 'drafter-house')`, [new Date(min(45)), new Date(min(46)), GROUND.x, GROUND.y]); // a put-forward mark is the town's, a private draft is not
  await at("walk", "", 55, "blank-house");                                                     // an act with no recorded actor
  await at("walk", "walker90", 90, "late-house");                                              // inside the first event's window, after the second read's `now`
  await at("rsvp", "badger1", 5, "badger-house");                                              // an RSVP is not presence
  await at("rsvp", "pica3", 6, "pica-house");                                                  // a household's member with no act at the place
  await at("walk", "heron1", 50, "heron-house", {}, 900, 900);                                 // beyond 60 m
  await at("walk", "early1", -5, "early-house");                                               // before the doors
  await at("walk", "late1", 200, "late-house");                                                // after the event
  const HANDLES = ["human-of-ghost", "human-of-starforge", "maker1", "otter1", "pica", "pica2"];

  // the book is asked with no lease held, and the control shows the detector sees one when it is held
  const asked = [];
  sp.useRegistryLoader(() => { asked.push(penHeld() !== null); return Promise.resolve(REGISTRY); }); // penHeld: the lease's name, or null when none is held
  const read = (id, now) => calendarAtOffice({ event: id }, { now, env: ENV, settlements: () => [min(-600)] });
  const { event: ended } = await read("pica/lantern-walk", NOW);
  const ev = ended.evidence;
  const askedByTheRead = [...asked];

  assert.deepEqual(ev.participants.map((p) => p.handle), [...HANDLES, "walker90"].sort(), "the actors of the qualifying acts, sorted: not RSVPs, members, drafts, the far, the early, the late or the companion");
  const by = Object.fromEntries(ev.participants.map((p) => [p.handle, p]));
  assert.deepEqual(by.pica, { handle: "pica", household: "pica-house" });
  assert.deepEqual(by.pica2, { handle: "pica2", household: "pica-house" }, "two recorded actors of one household remain two");
  assert.deepEqual(by.otter1, { handle: "otter1", household: "otter-house" }, "a qualifying actor who never spoke is there");
  assert.deepEqual(by["human-of-starforge"], { handle: "human-of-starforge", household: "starforge", human: true, speaker: "DARKO, of Starforge", town_name: "DARKO", pronouns: "he/him", house: "Starforge", house_slug: "starforge" },
    "the human is the human, presented as a conversation's line presents them");
  assert.equal("vex" in by, false, "the companion lent standing, not authorship: it has no act of its own and is not listed");
  assert.equal(JSON.stringify(ev.participants).includes("vex"), false, "nor named as the shoulder");
  assert.deepEqual(by["human-of-ghost"], { handle: "human-of-ghost", household: "ghost", human: true }, "a hand whose house is unknown gains no line, never a guess");
  assert.equal("beside" in by["human-of-starforge"], false);
  assert.equal(JSON.stringify(ended).includes("Realname"), false, "the private human's name is nowhere in the read");
  assert.deepEqual(by.maker1, { handle: "maker1", household: "maker-house" }, "a put-forward mark is a public act");
  assert.equal("drafter" in by, false, "a private draft is not");
  assert.match(ev.participants_basis, /never RSVPs, never a household's members/);
  assert.deepEqual(askedByTheRead, [false], "the registry was asked once, outside the pen's leases");
  await pen.officeRead(async () => { sp.forgetSpeakerBook(); await sp.speakerBook(); }, { env: ENV });
  assert.deepEqual(asked, [false, true], "control: inside a lease the same ask is seen holding it");
  // and the household read is the one it always was
  assert.deepEqual(ev.present, ["blank-house", "ghost", "late-house", "maker-house", "otter-house", "pica-house", "starforge"],
    "present: the households, untouched — including the one whose act had no actor, who lists no participant");

  // an event still on: capped at now
  const { event: on } = await read("pica/lantern-on", min(60));
  assert.equal(on.evidence.complete, false);
  assert.deepEqual(on.evidence.participants.map((p) => p.handle), HANDLES, "walker90 acts after now: not there yet");
  assert.deepEqual(on.evidence.present, ["blank-house", "ghost", "maker-house", "otter-house", "pica-house", "starforge"]);

  // an unreadable registry leaves the human's canonical hand, and nothing else of the read moves
  sp.useRegistryLoader(() => Promise.resolve(null));
  const { event: blind } = await read("pica/lantern-walk", NOW);
  assert.deepEqual(blind.evidence.participants.find((p) => p.human && p.household === "starforge"), { handle: "human-of-starforge", household: "starforge", human: true }, "no book: unknown, not 'the human of starforge'");
  assert.deepEqual({ ...blind.evidence, participants: null }, { ...ev, participants: null }, "every other field of the evidence is the same read");
  sp.useRegistryLoader(null);
});

test("the lasting list: every ended event past the calendar's week, newest end first, paged with ties kept — the recent calendar stays short", async () => {
  for (let i = 0; i < PAST_PAGE + 3; i++) await event(`pica/old-${String(i).padStart(2, "0")}`, -24 * 60 * (20 + i), -24 * 60 * (20 + i) + 60);
  await event("pica/tie-a", -24 * 60 * 61, -24 * 60 * 61 + 60);
  await event("pica/tie-b", -24 * 60 * 61, -24 * 60 * 61 + 60);
  const recent = await calendarAtOffice({}, { now: NOW, env: ENV });
  assert.ok(!recent.ended.some((v) => v.id.startsWith("pica/old-")), "the calendar's ended list is still the week");
  const seen = [];
  let page = await calendarAtOffice({ past: true }, { now: NOW, env: ENV });
  for (;;) {
    for (let i = 1; i < page.past.length; i++) assert.ok(Date.parse(page.past[i - 1].ends) >= Date.parse(page.past[i].ends), "newest end first");
    seen.push(...page.past.map((v) => v.id));
    if (!page.next) break;
    page = await calendarAtOffice(page.next, { now: NOW, env: ENV });
  }
  for (let i = 0; i < PAST_PAGE + 3; i++) assert.ok(seen.includes(`pica/old-${String(i).padStart(2, "0")}`));
  assert.ok(seen.includes("pica/tie-a") && seen.includes("pica/tie-b"));
  assert.equal(new Set(seen).size, seen.length, "no event twice across pages");
  await assert.rejects(calendarAtOffice({ past: true, before: "soon" }, { now: NOW, env: ENV }), /not a cursor/);
  await assert.rejects(calendarAtOffice({ past: true, event: "pica/tie-a" }, { now: NOW, env: ENV }), /past lists events/);
});

test("the host's invitation (POS-1035, ruled): every spark of each completed event's COLLECTION that they have not rewritten waits, one row per event — until they amend its recounting or it is gone; the host pulling their stake while others keep it standing is not gone", async () => {
  // a closed window of its own, for the fixture marks to have been accepted in
  await owner.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (1034, now() - interval '3 days', now() - interval '2 days', 'closed')");
  const done = async (id, host, sparks, atMin) => owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ($1, 'event', $2, '', $3, $4, NULL, 0, 0, $5, $6, 'announced', $7, 0, 1, 1)`,
    [id, `the ${id}`, host, `${host}-house`, new Date(min(atMin - 120)), new Date(min(atMin - 1)),
      JSON.stringify({ doors_open: new Date(min(atMin - 120)).toISOString(), stake: { n: 20, by: host, returned: { act: 1, n: 20, to: host }, backing: { sparks, n: sparks.length } },
        completed: { act: 1, sparks, at: new Date(min(atMin)).toISOString() } })]);
  const markAct = async (action, actor, object, atMin, payload = {}) => owner.query(`INSERT INTO acts (at, crossing, actor, action, class, object, payload, at_anchor, at_dx, at_dy)
    VALUES ($1, 0, $2, $3, 'mark', $4, $5, 'world', 0, 0)`, [new Date(min(atMin)), actor, action, object, JSON.stringify(payload)]);
  const stands = (slug) => owner.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
    VALUES (gen_random_uuid(), $1, 'spark', $2, $3, $4, $5, box(point(0,0), point(1,1)), 'standing', 1034, $6)`,
    [slug, slug.split("/")[0], `${slug.split("/")[0]}-house`, `the ${slug}`, JSON.stringify({ at: { x: 0, y: 0 }, extent: { w: 0, h: 0 } }), JSON.stringify({ kind: "spark" })]);
  // each completion's own leave act: the spark as made, recounted from the invitation; and it stands
  const made = async (spark, atMin) => { await markAct("leave-mark", spark.split("/")[0], spark, atMin, { kind: "spark", body: `the ${spark}`, recounting: "come for sorbet" }); await stands(spark); };
  await done("hosty/tea", "hosty", ["hosty/tea"], 1000); await made("hosty/tea", 1000);
  await done("hosty/supper", "hosty", ["hosty/supper", "hosty/supper-2"], 2000); await made("hosty/supper", 2000); await made("hosty/supper-2", 2000);
  await done("hosty/brunch", "hosty", ["hosty/brunch", "hosty/brunch-2"], 3000);
  await markAct("leave-mark", "hosty", "hosty/brunch", 3000, { kind: "spark", recounting: "come for sorbet" });                // withdrawn while nobody held it: gone
  await made("hosty/brunch-2", 3000);
  await done("hosty/picnic", "hosty", ["hosty/picnic"], 3500); await made("hosty/picnic", 3500);
  await done("other/fair", "other", ["other/fair"], 2500); await made("other/fair", 2500);
  await markAct("amend", "hosty", "hosty/tea", 900, { body: "Tea", recounting: "we drank it all" });        // BEFORE the completion: answers nothing
  await markAct("amend", "hosty", "hosty/supper", 2100, { body: "Supper", recounting: "nine came, the soup ran out" }); // ONE room's recounting rewritten
  await markAct("withdraw", "hosty", "hosty/brunch", 3100);                                                 // withdrawn, and no longer there
  await markAct("withdraw", "hosty", "hosty/brunch-2", 3100);                                               // the host let go, but others' stakes keep it standing
  await markAct("amend", "hosty", "hosty/picnic", 3600, { body: "A better headline", recounting: "come for sorbet" }); // the headline alone: NOT an answer

  const rows = await S.recountingsAwaitingVia(owner, ["hosty"]);
  assert.deepEqual(rows.map((r) => [r.event, r.sparks]), [["hosty/picnic", ["hosty/picnic"]], ["hosty/brunch", ["hosty/brunch-2"]], ["hosty/supper", ["hosty/supper-2"]], ["hosty/tea", ["hosty/tea"]]],
    "one row per event, naming every spark of its collection still waiting — the rewritten one and the gone one answered; never another host's");
  const tea = rows.find((r) => r.event === "hosty/tea");
  assert.match(tea.cause, /became the spark hosty\/tea; its recounting is your invitation's words \(or its title\) — write what actually happened/);
  assert.match(tea.act, /^world_leave_mark \{ slug: "tea", amend: true, … \}.*recounting/);
  const two = S.recountingInvitation({ id: "hosty/supper", title: "Supper", host: "hosty", completed_at: "x", sparks: ["hosty/supper", "hosty/supper-2"] });
  assert.match(two.cause, /became 2 sparks, one per room: hosty\/supper, hosty\/supper-2; each is recounted from your invitation's words/);
  assert.deepEqual((await S.recountingsAwaitingVia(owner, ["hosty", "other"])).map((r) => r.event), ["hosty/picnic", "hosty/brunch", "other/fair", "hosty/supper", "hosty/tea"], "newest completion first, every host asked");
  assert.deepEqual(await S.recountingsAwaitingVia(owner, ["nobody"]), []);
  assert.deepEqual(await S.recountingsAwaitingVia(owner, []), [], "no residents, no read");
  await markAct("amend", "hosty", "hosty/tea", 1100, { body: "Tea" });                       // an amend that carries no recounting at all
  assert.ok((await S.recountingsAwaitingVia(owner, ["hosty"])).some((r) => r.event === "hosty/tea"), "no recounting written: still asked");
  await markAct("amend", "hosty", "hosty/tea", 1200, { body: "Tea", recounting: "twelve came; the pot went round twice" });
  await markAct("amend", "hosty", "hosty/picnic", 3700, { body: "A better headline", recounting: "rain, then sun, then sorbet" });
  await markAct("amend", "hosty", "hosty/supper-2", 2200, { body: "Supper", recounting: "the garden room sang" });
  await markAct("amend", "hosty", "hosty/brunch-2", 3200, { body: "Brunch", recounting: "eggs, mostly" });
  assert.deepEqual(await S.recountingsAwaitingVia(owner, ["hosty"]), [], "the host wrote what happened: every spark of every collection answered");

  // A FREE event's drafts (pure: the household's own read handed in) — each waits while it is a draft with the completion's words
  const free = [{ id: "pica/old-fair", title: "Old fair", host: "pica", household: "pica-house", completed_at: "2026-11-14T21:00:00.000Z", recounting: "bring a chair" },
    { id: "pica/older", title: "Older", host: "pica", household: "pica-house", completed_at: "2026-11-13T21:00:00.000Z", recounting: "Older" }];
  const asked = [];
  const drafts = await S.draftRecountingsVia(free, async (host, ids) => {
    asked.push([host, ids]);
    return [{ slug: "pica/old-fair", claimant: "pica", event: "pica/old-fair", recounting: "bring a chair" },
      { slug: "pica/old-fair-2", claimant: "pica", event: "pica/old-fair", recounting: "bring a chair" },
      { slug: "pica/older", claimant: "pica", event: "pica/older", recounting: "we sang" },          // rewritten: answered
      { slug: "pica/hand-made", claimant: "noe", event: "pica/old-fair", recounting: "bring a chair" }]; // not the host's: never
  });
  assert.deepEqual(asked, [["pica", ["pica/old-fair", "pica/older"]]], "read once per host, under the household its own drafts are filed in");
  assert.deepEqual(drafts.map((d) => [d.id, d.drafts]), [["pica/old-fair", ["pica/old-fair", "pica/old-fair-2"]]]);
  const inv = S.recountingInvitation(drafts[0]);
  assert.deepEqual(inv.drafts, ["pica/old-fair", "pica/old-fair-2"]);
  assert.match(inv.cause, /posted before events were staked, so its rooms' sparks start as your drafts\. Your spark drafts that name it and still carry its invitation's words \(or its title\): pica\/old-fair, pica\/old-fair-2 — write what actually happened\. A draft is not the town's canon .* until you publish it with 1 stamp/);
  assert.doesNotMatch(inv.cause, /\b2 sparks\b|were made/, "an association, never a claim of which the completion made or how many (Wright 05:35Z)");
  assert.match(inv.act, /^world_leave_mark \{ slug: "old-fair", … \}.*stamps: 1 publishes it/);
  // an office pointed at no record cannot establish the list: it throws (NoRecordError), and needs-you says unknown — never an
  // empty answer from a missing store (Rivet 03:56Z). A fresh process: this one's pen has its pool already.
  const { spawnSync: run } = await import("node:child_process");
  const probe = run(process.execPath, ["--input-type=module", "-e",
    `const S = await import(${JSON.stringify(new URL("../src/event-sparks.mjs", import.meta.url).href)});
     try { console.log("ROWS", JSON.stringify(await S.recountingsAwaitingAtOffice(["other"]))); } catch (e) { console.log("THREW", e?.name); }
     process.exit(0);`],
    { encoding: "utf8", env: { ...process.env, WORLD2_PG: "", WORLD2_PG_URL: "" } });
  assert.match(probe.stdout, /THREW NoRecordError/, `${probe.stdout}${probe.stderr}`);
});

// ── THE HOSTING STAKE, on disposable fixtures: a town in a bottle (its own engine, ledger and key) and this store ──
//
// Money proof (the brief): an insufficient balance writes nothing; a cancellation returns the whole stake once and a second cannot
// pay again; an interrupted act rolls back its coupled changes (no row, no line, no commit); a legacy (switch-off) event stays free.

const { generateKeyPairSync } = await import("node:crypto");
const { mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync } = await import("node:fs");
const { join, resolve, dirname } = await import("node:path");
const { execFileSync, spawnSync } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");
const { copyTownTools } = await import("./helpers/town-tools.mjs");
const { pinTown } = await import("./helpers/pinned-town.mjs");
const { tempDir } = await import("./helpers/temp-dir.mjs");
const { postAtTown, closeAtTown } = await import("../src/events-store.mjs");

const TOWN_SRC = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "town-clone");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const bottle = tempDir("pos1035-stake-");
after(() => rmSync(bottle, { recursive: true, force: true, maxRetries: 5 }));
const KEY_FILE = join(bottle, "stamp-key.pem");
writeFileSync(KEY_FILE, privateKey.export({ type: "pkcs8", format: "pem" }));
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
const ledgerText = (dir) => readFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const verifies = (dir) => spawnSync(process.execPath, [join(dir, "tools", "stamp-verify.mjs"), "--repo", dir], { encoding: "utf8" });
let townN = 0;
function townInABottle() {
  const dir = join(bottle, `town-${++townN}`);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  copyTownTools(TOWN_SRC, dir);
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(join(dir, "tools", "github-ids.json"), JSON.stringify({ wright: { login: "w", id: 7 }, ada: { login: "a", id: 9 } }));
  // wright earns 25 stamps (five days of five letters), ada 10
  const lines = [];
  const days = { wright: ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"], ada: ["2026-06-07", "2026-06-08"] };
  for (const [who, dates] of Object.entries(days))
    for (const date of dates) for (let i = 1; i <= 5; i++) lines.push(`- ${date} · ${who}-${date}-${i} · ${who} → pen-pal-${i} · thread: new`);
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), `# ledger\n\n${lines.join("\n")}\n`);
  execFileSync(process.execPath, [join(dir, "tools", "stamp-mint.mjs"), "--append", "--key", KEY_FILE, "--repo", dir], { cwd: dir });
  execFileSync(process.execPath, [join(dir, "tools", "stamp-mint.mjs"), "--declare-rules", "stamps-v2", "--meeps", "postmaster", "--date", "2026-06-20", "--key", KEY_FILE, "--repo", dir], { cwd: dir });
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  process.env.TOWN_PINS_DIR = pinTown(dir); // POS-994: the office verifies with the PINNED public key, so a fixture signed with its own key is pinned to itself
  return dir;
}
const liquidOf = async (dir, handle) => {
  const mint = await import(`${new URL(`file://${join(dir, "tools", "stamp-mint.mjs")}`).href}?t=${Date.now()}`);
  return mint.foldBalances(mint.parseStampLedger(ledgerText(dir))).get(handle) ?? 0;
};
// the executor's child reads the pins this bottle was pinned to (POS-994), not the suite clone's
const stakeEnv = (dir) => ({ ...ENV, TOWN_CLONE: dir, STAMP_KEY: KEY_FILE, TOWN_LOCK: join(bottle, `town-${townN}.lock`), TOWN_PUSH: "", TOWN_PINS_DIR: process.env.TOWN_PINS_DIR });
const keyOf = (handle) => ({ handles: new Set([handle]), household: `${handle}-house` });
const T_POST = Date.now();
const eventArgs = (title) => ({ class: "event", title, body: "sorbet on the counter", place: { at: { x: 10, y: 20 } },
  starts: new Date(T_POST + 3_600_000).toISOString(), ends: new Date(T_POST + 7_200_000).toISOString() });
const postRow = async (id) => (await owner.query("SELECT state, fields FROM posts WHERE id = $1", [id])).rows[0] ?? null;

test("an insufficient balance writes NOTHING: no row, no ledger line, no commit — and the refusal says why in plain words", async () => {
  const dir = townInABottle();
  const head = git(dir, "rev-parse", "HEAD").trim();
  const before = ledgerText(dir);
  await assert.rejects(postAtTown(eventArgs("Ada's tea"), keyOf("ada"), { env: stakeEnv(dir) }),
    (e) => e.code === 422 && /hosting an event stakes 20 of your own stamps, and ada holds 10/.test(e.defect) && /no housemate's/.test(e.hint));
  assert.equal(ledgerText(dir), before);
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head);
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM posts WHERE author = 'ada'")).rows[0].n, 0);
});

test("posting stakes the host's own 20 in the post's own act; cancelling brings all 20 home in the cancellation's act — once", async () => {
  const dir = townInABottle();
  assert.equal(await liquidOf(dir, "wright"), 25);
  const posted = await postAtTown(eventArgs("Sorbet night"), keyOf("wright"), { env: stakeEnv(dir) });
  const id = posted.post.id;
  assert.deepEqual(posted.stake && [posted.stake.n, posted.stake.by], [20, "wright"]);
  assert.deepEqual((await postRow(id)).fields.stake, { n: 20, by: "wright" }, "the row carries the stake, through the fold");
  assert.match(ledgerText(dir), new RegExp(`· wright → stake:post/${id} · 20 · side: for · via: api`));
  assert.equal(await liquidOf(dir, "wright"), 5, "the 20 left the host's liquid stamps");
  assert.equal(verifies(dir).status, 0, `the town's own verifier passes: ${verifies(dir).stdout}${verifies(dir).stderr}`);

  const cancelled = await closeAtTown({ post: id }, keyOf("wright"), { env: stakeEnv(dir) });
  assert.equal(cancelled.state, "cancelled");
  assert.deepEqual([cancelled.stake.returned, cancelled.stake.to], [20, "wright"]);
  assert.match(cancelled.stake.note, /no spark is made/);
  const row = await postRow(id);
  assert.equal(row.state, "cancelled");
  assert.equal(row.fields.stake.returned.n, 20);
  assert.match(ledgerText(dir), new RegExp(`· stake:post/${id} → wright · 20 · for: post-return`));
  assert.equal(await liquidOf(dir, "wright"), 25, "all 20 came home");
  assert.equal(verifies(dir).status, 0);

  // never twice: the door refuses, and the executor asked directly refuses too, before any line is signed
  const lines = ledgerText(dir);
  await assert.rejects(closeAtTown({ post: id }, keyOf("wright"), { env: stakeEnv(dir) }), /already cancelled/);
  const { stakedCancel } = await import("../src/event-sparks.mjs");
  const again = await stakedCancel({ handle: "wright", id, door: "town", date: "2026-11-14" }, { clone: dir, keyPem: readFileSync(KEY_FILE, "utf8"), env: stakeEnv(dir) });
  assert.match(again.error.defect, /already come home/);
  assert.equal(ledgerText(dir), lines, "no second return line");
});

test("an interrupted staked post rolls back its coupled changes: the line it signed is put back, nothing committed, no row", async () => {
  const dir = townInABottle();
  const head = git(dir, "rev-parse", "HEAD").trim();
  const before = ledgerText(dir);
  // a place mark that does not stand passes the door's cheap shape check and is refused INSIDE the post's transaction, after the
  // executor has signed the stake line — the interruption the coupling must survive
  await assert.rejects(postAtTown({ ...eventArgs("Nowhere night"), place: { mark: "nobody/no-such-mark" } }, keyOf("wright"), { env: stakeEnv(dir) }));
  assert.equal(ledgerText(dir), before, "the signed line was put back");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "nothing was committed");
  assert.equal(git(dir, "status", "--porcelain").trim(), "", "the clone is clean");
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM posts WHERE title = 'Nowhere night'")).rows[0].n, 0);
  assert.equal(await liquidOf(dir, "wright"), 25);
});

test("a staked event's words are checked BEFORE money moves (Rivet 18:39Z): an invitation or title its spark's record could not carry is refused, plainly, and nothing is written", async () => {
  const dir = townInABottle();
  const before = ledgerText(dir);
  await assert.rejects(postAtTown({ ...eventArgs("Sorbet #2"), body: "on the counter" }, keyOf("wright"), { env: stakeEnv(dir) }),
    (e) => e.code === 422 && /title would not survive as its spark's record: a # is read/.test(e.defect));
  await assert.rejects(postAtTown({ ...eventArgs("Sorbet night"), body: "line one\nline two" }, keyOf("wright"), { env: stakeEnv(dir) }),
    (e) => e.code === 422 && /invitation would not survive/.test(e.defect));
  assert.equal(ledgerText(dir), before, "no stamp moved");
  const posted = await postAtTown(eventArgs("Sorbet evening"), keyOf("wright"), { env: stakeEnv(dir) });
  const { amendAtTown } = await import("../src/events-store.mjs");
  await assert.rejects(amendAtTown({ post: posted.post.id, title: "Sorbet #3" }, keyOf("wright"), { env: stakeEnv(dir) }),
    (e) => e.code === 422 && /title would not survive/.test(e.defect), "an amendment is held to the same line");
});

test("legacy: an event scheduled before this shipped (stored with no stake) stays free — it cancels with no stamp moving, and nothing is charged retroactively", async () => {
  const dir = townInABottle();
  const before = ledgerText(dir);
  // a row as the store already holds it: no stake
  await owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ('wright/old-free-tea', 'event', 'Old free tea', '', 'wright', 'wright-house', NULL, 10, 20, $1, $2, 'announced', $3, 0, 1, 1)`,
    [new Date(Date.now() + 3_600_000), new Date(Date.now() + 7_200_000), JSON.stringify({ doors_open: new Date(Date.now() + 3_600_000).toISOString() })]);
  const closed = await closeAtTown({ post: "wright/old-free-tea" }, keyOf("wright"), { env: stakeEnv(dir) });
  assert.equal(closed.state, "cancelled");
  assert.equal("stake" in closed, false);
  assert.equal(ledgerText(dir), before, "no line: it never staked, and is not charged now");
});

// ── THE COMPLETION, on the same fixtures: one spark, 19 home and 1 backing, in one batch and one transaction — or nothing ──
//
// The mark road's planner is handed in (completeEvent's `planLeave`): the World pin CI reads does not know the spark class until
// World #391 is blessed, and the planner's own guards are World's to prove. Everything after it is the office's real road — the
// spark's act and claim on the candle, its mark lock, the event's receipt FOR UPDATE, and the ledger's landing in the bottle.

const { completeEvent, landedCompletionOf } = await import("../src/event-sparks.mjs");
const { eventRowAtOffice } = await import("../src/events-store.mjs");
const { penTransaction } = await import("../src/write.mjs");
const { townDay } = await import("../src/votes.mjs");
const { verifyStampLinesVia } = await import("../src/stamp-lines.mjs");

const plannerCalls = [];
const planLeave = async ({ by, household, slug, body, at, extent, properties, stamps }) => {
  plannerCalls.push({ by, slug, body, at, extent, properties, stamps });
  const id = `${by}/${slug}`;
  // as the mark road answers: staked goes forward, unstaked stays the household's private draft
  const forward = stamps > 0;
  return { planned: true, id, put_forward: forward, ground_min: 0, entry: {
    actor: by, household, action: "leave-mark", object: id, cls: "mark",
    payload: { slug, kind: "spark", by, household, body, at, extent, ...properties, stamps, put_forward: forward } } };
};
let candleLit = false;
async function lightTheCandle() {
  if (candleLit) return;
  // the claim pen reads the process's own switches (world2-claims § candleEnabled), as the office's does
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), WORLD2_CANDLE: "1" });
  // the candle tiles time: it opens where the last window closed (the invitation's fixture window), else a day ago
  await owner.query(`INSERT INTO windows (id, opens_at, closes_at, status)
    SELECT 1035, COALESCE((SELECT closes_at FROM windows ORDER BY id DESC LIMIT 1), now() - interval '1 day'), now() + interval '1 day', 'open'`);
  candleLit = true;
}
const keyPem = () => readFileSync(KEY_FILE, "utf8");
const completionEnv = (dir) => ({ ...stakeEnv(dir), WORLD2_CANDLE: "1", STAMP_LINES: "store" });
/** A staked event posted in the bottle, read back as the store holds it, and the instant after it ended. */
async function endedEvent(dir, title, { at = null } = {}) {
  await lightTheCandle();
  // each bottle is its own town with its own ledger: the store's copy of the lines starts empty for it, as at a town's genesis
  await owner.query("TRUNCATE stamp_lines");
  const posted = await postAtTown({ ...eventArgs(title), ...(at ? { place: { at } } : {}) }, keyOf("wright"), { env: completionEnv(dir) });
  // posting needs a window ahead; completing it must not need a FUTURE clock: the pen files a row by the real crossing
  // (world2-pen § lateCrossingGuard), so an act stamped at "now + 2h" fails whenever a crossing boundary falls in between.
  // So the posted event's window is moved 3 h into the past, and the completion runs at the real clock, as the tick does.
  const shift = (v) => new Date(Date.parse(v) - 3 * 3_600_000).toISOString();
  const was = await eventRowAtOffice(posted.post.id, { env: ENV });
  await owner.query("UPDATE posts SET starts = $2, ends = $3, fields = $4 WHERE id = $1",
    [was.id, shift(was.starts), shift(was.ends), JSON.stringify({ ...was.fields, ...(was.fields?.doors_open ? { doors_open: shift(was.fields.doors_open) } : {}) })]);
  const row = await eventRowAtOffice(posted.post.id, { env: ENV });
  return { row, after: Date.now() };
}
const complete = (dir, row, now, opts = {}) => penTransaction(dir, () =>
  completeEvent(row, { clone: dir, keyPem: keyPem(), env: completionEnv(dir), now, date: townDay(), planLeave, roomsPlace: worldRoomsPlace, ...opts }));
const claimOf = async (id) => (await owner.query("SELECT class, status, stake, claimant FROM claims WHERE slug = $1", [id])).rows;
const storeVerifies = async (dir) => verifyStampLinesVia(owner, dir);

test("completion with nobody speaking: ONE put-forward spark on the locked circle — all 20 come home and its own 1 backs it (19 home), the town's verifier green", async () => {
  const dir = townInABottle();
  const { row, after: now } = await endedEvent(dir, "Sorbet finale");
  assert.equal(await liquidOf(dir, "wright"), 5);
  const head = git(dir, "rev-parse", "HEAD").trim();
  const out = await complete(dir, row, now);
  const slug = row.id.split("/").slice(1).join("/");
  assert.equal(out.completed, true, JSON.stringify(out));
  assert.deepEqual(out.sparks, [`wright/${slug}`], "identity: <host>/<event-slug>");
  assert.deepEqual(out.stake, { returned: 20, to: "wright", backing: 1, home: 19 });
  const call = plannerCalls.at(-1);
  assert.equal(call.body, "Sorbet finale", "the headline is the title");
  assert.equal(call.stamps, 1);
  assert.deepEqual(call.extent, { w: 120, h: 120 }, "no conversation at the place: the 60 m radius frame");
  assert.equal(call.properties.event, row.id);

  const text = ledgerText(dir);
  assert.match(text, new RegExp(`· stake:post/${row.id} → wright · 20 · for: post-return`));
  assert.match(text, new RegExp(`· wright → stake:world-mark/wright/${slug} · 1 · via: api`));
  assert.ok(landedCompletionOf((await import(`${new URL(`file://${join(dir, "tools", "stamp-mint.mjs")}`).href}?t=${Date.now()}`)).parseStampLedger(text), row.id, "wright", 20),
    "the batch is the pair a retry would recognise");
  assert.equal(await liquidOf(dir, "wright"), 24, "5 left after the stake, 19 home");
  assert.notEqual(git(dir, "rev-parse", "HEAD").trim(), head, "the batch was committed");
  assert.equal(git(dir, "status", "--porcelain").trim(), "");
  const v = verifies(dir);
  assert.equal(v.status, 0, `the town's own verifier passes: ${v.stdout}${v.stderr}`);
  assert.deepEqual((await storeVerifies(dir)).problems, [], "the store's copy of the lines matches the ledger");

  const stored = await postRow(row.id);
  assert.deepEqual(stored.fields.completed.sparks, [`wright/${slug}`]);
  assert.deepEqual(stored.fields.stake.returned, { act: stored.fields.completed.act, n: 20, to: "wright" });
  assert.deepEqual(stored.fields.stake.backing, { sparks: [`wright/${slug}`], n: 1 });
  const claims = await claimOf(`wright/${slug}`);
  assert.equal(claims.length, 1, "exactly one spark claim");
  assert.equal(claims[0].class, "spark");
  assert.notEqual(claims[0].status, "draft", "put forward, never a draft");
});

test("completion: a second tick does nothing — no second spark, no second return — and the pass no longer finds it due", async () => {
  const dir = townInABottle();
  const { row, after: now } = await endedEvent(dir, "Sorbet twice");
  assert.equal((await complete(dir, row, now)).completed, true);
  const lines = ledgerText(dir), head = git(dir, "rev-parse", "HEAD").trim();
  const slug = row.id.split("/").slice(1).join("/");

  const again = await complete(dir, await eventRowAtOffice(row.id, { env: ENV }), now + 60_000);
  assert.match(again.held, /not a staked, open event/, "the row it reads is complete");
  const stale = await complete(dir, row, now + 60_000); // the row as the first tick read it: the ledger and the receipt refuse
  assert.ok(stale.error || stale.held, JSON.stringify(stale));
  assert.equal(ledgerText(dir), lines, "no line signed");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "no commit");
  assert.equal((await claimOf(`wright/${slug}`)).length, 1);
  assert.equal((await claimOf(`wright/${slug}-2`)).length, 0, "no second spark under a suffix");
  const { DUE_EVENTS_SQL } = await import("../deploy/event-sparks-pass.mjs");
  const due = (await owner.query(DUE_EVENTS_SQL, [new Date(now + 60_000).toISOString(), null])).rows.map((r) => r.id);
  assert.ok(!due.includes(row.id));
});

const sayAt = async (who, at, x, y) => owner.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy, household)
  VALUES ($1, 0, $2, 'say', 'voice', $3, 'world', $4, $5, $6)`, [new Date(at), who, JSON.stringify({ text: `${who} here`, place: "the counter" }), x, y, `${who}-house`]);

test("completion is HELD, nothing moved: before its end, and when its rooms cannot be told — no spark, no plan, no line, no receipt, no claim", async () => {
  const dir = townInABottle();
  const { row, after: now } = await endedEvent(dir, "Sorbet held", { at: { x: 1900, y: 1900 } });
  const lines = ledgerText(dir), head = git(dir, "rev-parse", "HEAD").trim();
  const calls = plannerCalls.length;
  assert.match((await complete(dir, row, Date.parse(row.ends) - 60_000)).held, /not ended/);
  // a settlement the office knows that is newer than the window's start: the rooms cannot be told — never "no conversation"
  assert.match((await complete(dir, row, now, { edges: [Date.parse(row.ends)] })).held, /rooms cannot be told/);
  assert.equal(plannerCalls.length, calls, "held before a spark is even planned");
  assert.equal(ledgerText(dir), lines, "no return, no backing: nothing signed");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "nothing committed");
  assert.equal((await postRow(row.id)).fields.completed, undefined, "no completion written");
  assert.equal((await claimOf(`wright/${row.id.split("/").slice(1).join("/")}`)).length, 0, "no spark claim");
});

test("EACH ROOM ITS OWN SPARK (Darko 23:10/23:14 EST): two rooms make two put-forward sparks, each on its own room's frozen frame, 1 of the 20 backing each and 18 home — one batch, one transaction; the read names the whole collection, the gallery none of it", async () => {
  const dir = townInABottle();
  // its own place: the record is append-only, and the talk this test adds must not be any other event's
  const { row, after: now } = await endedEvent(dir, "Sorbet rooms", { at: { x: 900, y: 900 } });
  // two groups each 50 m from the place and 100 m apart (beyond earshot of each other): two rooms, whatever the settlements
  const doors = Date.parse(row.fields.doors_open ?? row.starts);
  await sayAt("rooms-a", doors + 60_000, 850, 900);
  await sayAt("rooms-b", doors + 30 * 60_000, 950, 900);
  const edges = [doors - 3_600_000];
  const slug = row.id.split("/").slice(1).join("/");
  const head = git(dir, "rev-parse", "HEAD").trim();
  const out = await complete(dir, row, now, { edges });
  assert.equal(out.completed, true, JSON.stringify(out));
  assert.deepEqual(out.sparks, [`wright/${slug}`, `wright/${slug}-2`], "one per room, the event's id then the next suffix, in the rooms' start order");
  assert.deepEqual(out.stake, { returned: 20, to: "wright", backing: 2, home: 18 }, "five rooms would be 5 and 15; two are 2 and 18");
  assert.equal(out.rooms.length, 2);
  const [first, second] = plannerCalls.slice(-2);
  assert.deepEqual([first.properties.rooms, second.properties.rooms], [[out.rooms[0]], [out.rooms[1]]], "each names its ONE room — World's strict `rooms`");
  assert.deepEqual([first.at, first.extent, second.at, second.extent], [{ x: 850, y: 900 }, { w: 0, h: 0 }, { x: 950, y: 900 }, { w: 0, h: 0 }], "each its own room's frame — never a union");
  assert.deepEqual([first.stamps, second.stamps], [1, 1]);

  const text = ledgerText(dir);
  const ours = text.split("\n").filter((l) => l.includes(`stake:post/${row.id} → wright`) || l.includes(`stake:world-mark/wright/${slug}`));
  assert.equal(ours.length, 3, "one return and two backings — nothing more");
  assert.match(ours[0], / · 20 · for: post-return/, "the whole return first");
  assert.match(ours[1], new RegExp(`→ stake:world-mark/wright/${slug} · 1 · via: api`), "then each spark's own 1, in the collection's order");
  assert.match(ours[2], new RegExp(`→ stake:world-mark/wright/${slug}-2 · 1 · via: api`));
  const mint = await import(`${new URL(`file://${join(dir, "tools", "stamp-mint.mjs")}`).href}?t=${Date.now()}`);
  assert.deepEqual(landedCompletionOf(mint.parseStampLedger(text), row.id, "wright", 20), { sparks: out.sparks }, "the batch a retry would recognise, whole");
  assert.equal(await liquidOf(dir, "wright"), 23, "5 left after the stake, 18 home");
  assert.notEqual(git(dir, "rev-parse", "HEAD").trim(), head, "the batch was committed");
  assert.equal(verifies(dir).status, 0, "the town's own verifier passes");
  assert.deepEqual((await storeVerifies(dir)).problems, []);
  for (const id of out.sparks) assert.equal((await claimOf(id)).length, 1, `${id}: exactly one claim`);
  const stored = await postRow(row.id);
  assert.deepEqual(stored.fields.completed.sparks, out.sparks);
  assert.deepEqual(stored.fields.stake.backing, { sparks: out.sparks, n: 2 });

  const ev = (await calendarAtOffice({ event: row.id }, { now, env: ENV, settlements: () => edges })).event.evidence;
  assert.deepEqual(ev.sparks.map((s) => s.id), out.sparks, "the read names the whole recorded collection, in order — no first or chosen one");
  assert.ok(ev.sparks.every((s) => s.accepted === false && s.status === "pending"), "each waiting on acceptance");
  assert.equal("spark" in ev, false, "no singular alias");
  assert.equal("spark_note" in ev, false, "a whole collection needs no note");
  assert.deepEqual(ev.gallery.rooms, ev.rooms.map((r) => r.id), "the gallery covers every room");
  assert.equal(ev.gallery.sparks.length, 0);
  // accepted, the roots stay out of the gallery: every one of them
  for (const id of out.sparks) await owner.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
    VALUES (gen_random_uuid(), $1, 'spark', 'wright', 'wright-house', 'Sorbet rooms', '{}', box(point(0,0), point(1,1)), 'standing', 1035, $2)`,
    [id, JSON.stringify({ kind: "spark", rooms: [out.rooms[out.sparks.indexOf(id)]], event: row.id })]);
  const ev2 = (await calendarAtOffice({ event: row.id }, { now, env: ENV, settlements: () => edges })).event.evidence;
  assert.deepEqual(ev2.sparks.map((s) => [s.id, s.accepted]), out.sparks.map((id) => [id, true]));
  assert.deepEqual(ev2.gallery.sparks, [], "every completion root excluded from the gallery");
  // the host is asked about every spark of it
  const asked = (await S.recountingsAwaitingAtOffice(["wright"], { env: ENV })).find((r) => r.event === row.id);
  assert.deepEqual(asked?.sparks, out.sparks, "the notice follows the actual collection");

  // a retry whose ledger batch does not back as many sparks as its rooms make is refused, never guessed
  const dir2 = townInABottle();
  const two = await endedEvent(dir2, "Sorbet rooms short", { at: { x: 900, y: 900 } });
  const slug2 = two.row.id.split("/").slice(1).join("/");
  const mint2 = await import(`${new URL(`file://${join(dir2, "tools", "stamp-mint.mjs")}`).href}?t=${Date.now()}`);
  const ws2 = await import(`${new URL(`file://${join(dir2, "tools", "world-stake.mjs")}`).href}?t=${Date.now()}`);
  mint2.appendSigned(dir2, [mint2.postReturnLine({ date: townDay(), post: two.row.id, handle: "wright", n: 20 })], keyPem());
  ws2.worldStakeApply(dir2, { handle: "wright", mark: `wright/${slug2}`, n: 1, via: "api", date: townDay() }, keyPem());
  git(dir2, "add", "WHITE_PAGES/stamp-ledger.md");
  git(dir2, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "a batch backing one");
  const lines2 = ledgerText(dir2);
  const short = await complete(dir2, two.row, two.after, { edges });
  assert.equal(short.error?.code, 503, JSON.stringify(short));
  assert.match(short.error.defect, /backs 1 spark\(s\), and its rooms make 2/);
  assert.equal(ledgerText(dir2), lines2);
  assert.equal((await postRow(two.row.id)).fields.completed, undefined);
});

test("A FREE EVENT (Darko 23:15/23:17 EST): each room's spark is made as its host's PRIVATE DRAFT — no line, no charge, no backing; the public row, act, read and gallery name none of it; the host is told; never twice", async () => {
  const dir = townInABottle();
  await lightTheCandle();
  const lines = ledgerText(dir), head = git(dir, "rev-parse", "HEAD").trim();
  const ends = Date.now() - 60_000, starts = ends - 3_600_000;
  await owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ('wright/free-supper', 'event', 'Free supper', 'soup at the long table', 'wright', 'wright-house', NULL, 3000, 3000, $1, $2, 'announced', $3, 0, 1, 1)`,
    [new Date(starts), new Date(ends), JSON.stringify({ doors_open: new Date(starts).toISOString() })]);
  await sayAt("free-a", starts + 60_000, 2950, 3000);
  await sayAt("free-b", starts + 120_000, 3050, 3000);
  const edges = [starts - 3_600_000];
  const row = await eventRowAtOffice("wright/free-supper", { env: ENV });
  // PROSPECTIVE ONLY (Wright 04:58:48Z): no cutoff configured, none made; a cutoff at or after its end, none made — by its own end
  const calls = plannerCalls.length;
  assert.match((await complete(dir, row, Date.now(), { edges })).held, /unconfigured \(no cutoff is set\): held, not found ineligible/);
  assert.match((await complete(dir, row, Date.now(), { edges, draftsFrom: ends })).held, /ended at or before the free events' cutoff/);
  assert.equal(plannerCalls.length, calls, "held before a draft is even planned");
  const { DUE_EVENTS_SQL, draftsCutoffOf } = await import("../deploy/event-sparks-pass.mjs");
  const dueWith = async (cut) => (await owner.query(DUE_EVENTS_SQL, [new Date().toISOString(), cut == null ? null : new Date(cut).toISOString()])).rows.map((r) => r.id);
  assert.ok(!(await dueWith(null)).includes(row.id), "no cutoff: the pass finds no free event due");
  assert.ok(!(await dueWith(ends)).includes(row.id), "ended at the cutoff: not due");
  assert.ok((await dueWith(ends - 1)).includes(row.id), "ended after it: due — whatever the tick's clock");
  assert.equal(draftsCutoffOf(undefined), null);
  assert.equal(draftsCutoffOf("2026-11-14T14:37:00Z"), Date.parse("2026-11-14T14:37:00Z"), "one UTC instant, any value");
  assert.deepEqual(draftsCutoffOf("yesterday"), { invalid: "yesterday" });
  assert.deepEqual(draftsCutoffOf("2026-11-14 14:37"), { invalid: "2026-11-14 14:37" }, "no zone, no guess");
  const out = await complete(dir, row, Date.now(), { edges, draftsFrom: starts });
  assert.equal(out.completed, true, JSON.stringify(out));
  assert.equal(out.free, true);
  assert.deepEqual(out.drafts, ["wright/free-supper", "wright/free-supper-2"], "one per room");
  assert.deepEqual(plannerCalls.slice(-2).map((c) => c.stamps), [0, 0], "unstaked: the mark road keeps them drafts");
  assert.equal(ledgerText(dir), lines, "no line: nothing charged, nothing backs them");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "nothing committed");
  // the drafts are the household's own: invisible to a public read of the claims (007's row policy), visible under its keys
  const { rows: seen } = await owner.query("SELECT slug, status FROM claims WHERE slug LIKE 'wright/free-supper%' ORDER BY slug");
  assert.deepEqual(seen.map((r) => [r.slug, r.status]), [["wright/free-supper", "draft"], ["wright/free-supper-2", "draft"]]);
  const pen = await import("../src/world2-pen.mjs");
  const publicly = await pen.officeRead((q) => q.query("SELECT slug FROM claims WHERE slug LIKE 'wright/free-supper%'"), { env: ENV });
  assert.deepEqual(publicly.rows, [], "a public read sees no draft");
  // the public row and its act say only that it completed, free
  const stored = await postRow(row.id);
  assert.deepEqual(Object.keys(stored.fields.completed).sort(), ["act", "at", "free"]);
  const { rows: [act] } = await owner.query("SELECT payload FROM acts WHERE id = $1", [out.act_id]);
  assert.deepEqual(Object.keys(act.payload).sort(), ["at", "free", "post"], "the complete act carries no draft id, count or word");
  assert.doesNotMatch(JSON.stringify(stored.fields) + JSON.stringify(act.payload), /free-supper-2|soup at the long table/);
  const { rows: mirrored } = await owner.query("SELECT 1 FROM acts WHERE object LIKE 'wright/free-supper%' AND class = 'mark'");
  assert.equal(mirrored.length, 0, "no draft wrote a public act");
  const ev = (await calendarAtOffice({ event: row.id }, { now: Date.now(), env: ENV, settlements: () => edges })).event;
  assert.deepEqual(ev.evidence.sparks, [], "the public collection: none — drafts are not public");
  assert.match(ev.evidence.spark_note, /stays free and keeps no public sparks of its own here: .* look for it in the gallery/);
  assert.doesNotMatch(JSON.stringify(ev), /free-supper-2/, "no draft id anywhere in the public event object");
  assert.equal(ev.evidence.rooms.length, 2, "its rooms are still listed — public talk, public coverage");
  // published (Wright 05:35Z, "the simpler roads"): an ordinary spark, found in the gallery by its room — never a completion root
  await owner.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
    VALUES (gen_random_uuid(), 'wright/free-supper', 'spark', 'wright', 'wright-house', 'Free supper', '{}', box(point(0,0), point(1,1)), 'standing', 1035, $1)`,
    [JSON.stringify({ kind: "spark", rooms: [ev.evidence.rooms[0].id], event: row.id })]);
  const later = (await calendarAtOffice({ event: row.id }, { now: Date.now(), env: ENV, settlements: () => edges })).event.evidence;
  assert.deepEqual(later.sparks, [], "no recorded public completion collection for a free event — even once one is published");
  assert.deepEqual(later.gallery.sparks.map((s) => s.id), ["wright/free-supper"], "the published one is an ordinary accepted spark in the gallery");
  // the host is told, privately: needs-you, under the event's household
  const asked = (await S.recountingsAwaitingAtOffice(["wright"], { env: ENV })).find((r) => r.event === row.id);
  assert.deepEqual(asked?.drafts, out.drafts);
  assert.match(asked.cause, /start as your drafts\. Your spark drafts that name it .* not the town's canon/);
  // never twice
  const again = await complete(dir, await eventRowAtOffice(row.id, { env: ENV }), Date.now(), { edges, draftsFrom: starts });
  assert.match(again.held, /already complete/);
  const raced = await complete(dir, row, Date.now(), { edges, draftsFrom: starts }); // the row as the first tick read it: ids taken, receipt refuses
  assert.ok(raced.error || raced.held, JSON.stringify(raced));
  const { rows: after } = await owner.query("SELECT slug FROM claims WHERE slug LIKE 'wright/free-supper%'");
  assert.equal(after.length, 2, "no third draft");
});

// ── AT THE PINNED WORLD (S173, 90a869e1): the REAL mark road and World's own roomsPlace, nothing handed in ──
// The tests above hand the planner and roomsPlace in; this one runs completion through world.mjs § planSparkLeave (World's spark
// class, its pre-check and journalLeaveMark { plan }) and § sparkRoomsPlace (the engine's tools/spark.mjs at the blessing), over
// the suite's pinned world clone — the integration WLD-173's landing makes possible (Wright 22:18Z).
test("S173 integration: two rooms complete through the REAL mark road and World's engine roomsPlace — two put-forward spark claims, each one room's strict `rooms`, placed by World", async (t) => {
  const world = await import("../src/world.mjs");
  const place = await world.sparkRoomsPlace();
  assert.equal(typeof place, "function", "the pinned World engine carries tools/spark.mjs § roomsPlace (S173)");
  // the store holds the law as the office does: the pinned blessing's law, derived by the law pen and written --blessed
  // (law-classes-parity's road), so the spark class's own properties (spark-recounting, spark-rooms, …) are the law's
  const { deriveLaw, writeLaw } = await import("../world2/tools/law-ingest.mjs");
  const { materializeWorldAtSha } = await import("../src/world-store.mjs");
  const law = await import("../src/law-snapshot.mjs");
  const blessed = execFileSync("git", ["-C", world.WORLD_CLONE, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const { rows: lawRows } = await deriveLaw({ lawRepo: materializeWorldAtSha(world.WORLD_CLONE, blessed, ["WORLD", "tools", "LOGOS"], join(bottle, "law")) });
  await owner.query("INSERT INTO settlements (number, tag_sha, published_at) VALUES (173, $1, now()) ON CONFLICT (number) DO NOTHING", [blessed]);
  await writeLaw(owner, { lawSha: blessed, rows: lawRows, blessed: true });
  await law.reloadLawSnapshot({ query: (sql, params) => owner.query(sql, params), force: true });
  t.after(() => law.resetLawSnapshot());
  const dir = townInABottle();
  const { row, after: now } = await endedEvent(dir, "Sorbet at the pin", { at: { x: 640, y: 980 } });
  const doors = Date.parse(row.fields.doors_open ?? row.starts);
  await sayAt("pin-a", doors + 60_000, 590, 980);
  await sayAt("pin-b", doors + 30 * 60_000, 690, 980);
  const edges = [doors - 3_600_000];
  const out = await complete(dir, row, now, { edges, planLeave: null, roomsPlace: undefined });
  assert.equal(out.completed, true, JSON.stringify(out));
  assert.equal(out.sparks.length, 2, "one spark per room");
  assert.deepEqual(out.stake, { returned: 20, to: "wright", backing: 2, home: 18 });
  for (const [i, id] of out.sparks.entries()) {
    const { rows: [c] } = await owner.query("SELECT class, status, stake, data, geometry FROM claims WHERE slug = $1", [id]);
    assert.equal(c?.class, "spark", `${id}: a spark claim on the real road`);
    assert.notEqual(c.status, "draft", `${id}: put forward`);
    assert.deepEqual(c.data.rooms, [out.rooms[i]], `${id}: its one room, strict`);
    assert.equal(c.data.event, row.id);
    const geo = typeof c.geometry === "string" ? JSON.parse(c.geometry) : c.geometry;
    const room = (await calendarAtOffice({ event: row.id }, { now, env: ENV, settlements: () => edges })).event.evidence.rooms[i];
    const { x0, y0, x1, y1 } = room.extent;
    assert.deepEqual([geo.at, geo.extent], [place([{ x0, y0, x1, y1 }]).at, place([{ x0, y0, x1, y1 }]).extent], `${id}: placed by World's roomsPlace`);
  }
  assert.equal(verifies(dir).status, 0, "the town's verifier passes");
});

test("one room: the mark road's refusal or draft holds the completion; then the room's spark completes with that room's own frame, frozen, under the page's id", async () => {
  const dir = townInABottle();
  const { row, after: now } = await endedEvent(dir, "Sorbet single", { at: { x: 700, y: 700 } });
  const doors = Date.parse(row.fields.doors_open ?? row.starts);
  await sayAt("solo-a", doors + 60_000, 700, 700);
  await sayAt("solo-b", doors + 2 * 60_000, 731, 700);
  const edges = [doors - 3_600_000];
  const lines = ledgerText(dir);
  assert.match((await complete(dir, row, now, { edges, planLeave: async () => ({ refused: { defect: "outside the world", hint: "World's guard" } }) })).held,
    /^its spark for room t\d+-solo-a would not go forward: outside the world/);
  assert.match((await complete(dir, row, now, { edges, planLeave: async (a) => ({ ...(await planLeave(a)), put_forward: false }) })).held, /kept it a draft/);
  assert.equal(ledgerText(dir), lines, "no line signed by any held completion");
  const done = await complete(dir, row, now, { edges });
  assert.equal(done.completed, true, JSON.stringify(done));
  const ev = (await calendarAtOffice({ event: row.id }, { now, env: ENV, settlements: () => edges })).event.evidence;
  assert.equal(ev.rooms.length, 1);
  assert.match(ev.rooms[0].id, /^t\d+-solo-a$/, "the room is named by its first say, as the page names it");
  assert.deepEqual(done.rooms, [ev.rooms[0].id], "the one room, by the page's id");
  assert.deepEqual(ev.sparks.map((s) => s.id), done.sparks, "the collection is the completed one (waiting on acceptance here)");
  assert.equal("spark_note" in ev, false, "a whole collection needs no note");
  const call = plannerCalls.at(-1);
  assert.deepEqual(call.properties.rooms, done.rooms, "the record names it: World's strict `rooms`, one id");
  assert.equal("room" in call.properties, false, "no scalar alias");
  assert.deepEqual([call.at, call.extent], [{ x: 715.5, y: 700 }, { w: 31, h: 0 }], "that room's own frame, frozen at completion: exact midpoint, half and zero kept");
});

test("completion interrupted after its lines landed and before the store committed: the retry finishes it from the ledger's own batch — no new line, no re-sign", async () => {
  const dir = townInABottle();
  const { row, after: now } = await endedEvent(dir, "Sorbet interrupted");
  const slug = row.id.split("/").slice(1).join("/");
  // the state such an interruption leaves: the batch signed and committed in the town, nothing in the store
  const mint = await import(`${new URL(`file://${join(dir, "tools", "stamp-mint.mjs")}`).href}?t=${Date.now()}`);
  const ws = await import(`${new URL(`file://${join(dir, "tools", "world-stake.mjs")}`).href}?t=${Date.now()}`);
  mint.appendSigned(dir, [mint.postReturnLine({ date: townDay(), post: row.id, handle: "wright", n: 20 })], keyPem());
  assert.equal(ws.worldStakeApply(dir, { handle: "wright", mark: `wright/${slug}`, n: 1, via: "api", date: townDay() }, keyPem()).applied, 1);
  git(dir, "add", "WHITE_PAGES/stamp-ledger.md");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "landed batch, store rolled back");
  const lines = ledgerText(dir), head = git(dir, "rev-parse", "HEAD").trim();
  assert.equal(await liquidOf(dir, "wright"), 24);

  const out = await complete(dir, row, now);
  assert.equal(out.completed, true, JSON.stringify(out));
  assert.deepEqual(out.sparks, [`wright/${slug}`], "the ledger's spark, followed");
  assert.match(out.recovered, /already in the ledger/);
  assert.equal(ledgerText(dir), lines, "not re-signed: the ledger is byte for byte the same");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "no new commit");
  assert.equal(await liquidOf(dir, "wright"), 24, "19 home once, 1 backing once");
  assert.deepEqual((await storeVerifies(dir)).problems, [], "the store now holds the lines the town already had");
  assert.equal((await claimOf(`wright/${slug}`)).length, 1);
  assert.deepEqual((await postRow(row.id)).fields.completed.sparks, [`wright/${slug}`]);
});

test("completion never signs onto a RED ledger: the mint's own arrival predicate, at the completion's own boundary, refuses before the first signature — no line, no commit, no claim, no receipt", async () => {
  const dir = townInABottle();
  const { row, after: now } = await endedEvent(dir, "Sorbet on red");
  appendFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "- 2026-11-14 · a line no key signed · wright → ada · 3\n");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qam", "a red line, committed");
  assert.notEqual(verifies(dir).status, 0, "red to the town's own verifier");
  assert.equal(S.ledgerArrivalRed(dir), true, "and to the mint's arrival predicate");
  const lines = ledgerText(dir), head = git(dir, "rev-parse", "HEAD").trim();
  const calls = plannerCalls.length;
  const out = await complete(dir, row, now); // a direct call: no pass in front of it
  assert.equal(out.error?.reason, "ledger-red", JSON.stringify(out));
  assert.match(out.error.defect, /the stamp ledger is red .* no completion signs onto it/);
  assert.equal(ledgerText(dir), lines, "no line signed");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "nothing committed");
  assert.equal(plannerCalls.length, calls, "not even planned");
  assert.equal((await claimOf(`wright/${row.id.split("/").slice(1).join("/")}`)).length, 0, "no spark claim");
  assert.equal((await postRow(row.id)).fields.completed, undefined, "no receipt");
  assert.equal(S.ledgerArrivalRed(townInABottle()), false, "a green ledger passes the same predicate");
});

test("completion never adopts or guesses: a return that is not its batch is refused, a ledger's spark id already held is refused, and a fresh id taken is suffixed", async () => {
  // a foreign return: the stake came home without its backing — not this completion's batch
  const dir = townInABottle();
  const { row, after: now } = await endedEvent(dir, "Sorbet foreign");
  const mint = await import(`${new URL(`file://${join(dir, "tools", "stamp-mint.mjs")}`).href}?t=${Date.now()}`);
  mint.appendSigned(dir, [mint.postReturnLine({ date: townDay(), post: row.id, handle: "wright", n: 20 })], keyPem());
  git(dir, "add", "WHITE_PAGES/stamp-ledger.md");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "a return alone");
  let lines = ledgerText(dir);
  const foreign = await complete(dir, row, now);
  assert.equal(foreign.error?.code, 503, JSON.stringify(foreign));
  assert.match(foreign.error.defect, /not as this completion's batch/);
  assert.equal(ledgerText(dir), lines);
  assert.equal((await postRow(row.id)).fields.completed, undefined);

  // the ledger's batch names a spark id this office already holds as another claim: refused, never adopted
  const dir2 = townInABottle();
  const two = await endedEvent(dir2, "Sorbet taken");
  const slug2 = two.row.id.split("/").slice(1).join("/");
  const ws = await import(`${new URL(`file://${join(dir2, "tools", "world-stake.mjs")}`).href}?t=${Date.now()}`);
  const mint2 = await import(`${new URL(`file://${join(dir2, "tools", "stamp-mint.mjs")}`).href}?t=${Date.now()}`);
  mint2.appendSigned(dir2, [mint2.postReturnLine({ date: townDay(), post: two.row.id, handle: "wright", n: 20 })], keyPem());
  ws.worldStakeApply(dir2, { handle: "wright", mark: `wright/${slug2}`, n: 1, via: "api", date: townDay() }, keyPem());
  git(dir2, "add", "WHITE_PAGES/stamp-ledger.md");
  git(dir2, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "landed batch");
  await owner.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, slug)
    VALUES (1035, 'sited', 'wright', 'solo:wright', 'pending', 'A bench.', '{}', box(point(1,1), point(2,2)), 0, $1)`, [`wright/${slug2}`]);
  lines = ledgerText(dir2);
  const taken = await complete(dir2, two.row, two.after);
  assert.equal(taken.error?.code, 503, JSON.stringify(taken));
  assert.match(taken.error.defect, /already holds as other marks or claims/);
  assert.equal(ledgerText(dir2), lines);
  assert.equal((await claimOf(`wright/${slug2}`)).length, 1, "the other claim is untouched and no spark joined it");

  // a fresh completion whose id is already someone's claim takes the first unused suffix
  const dir3 = townInABottle();
  const three = await endedEvent(dir3, "Sorbet suffix");
  const slug3 = three.row.id.split("/").slice(1).join("/");
  await owner.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, slug)
    VALUES (1035, 'sited', 'wright', 'solo:wright', 'pending', 'A lamp.', '{}', box(point(1,1), point(2,2)), 0, $1)`, [`wright/${slug3}`]);
  const suffixed = await complete(dir3, three.row, three.after);
  assert.deepEqual(suffixed.sparks, [`wright/${slug3}-2`], JSON.stringify(suffixed));
  assert.equal((await claimOf(`wright/${slug3}-2`))[0]?.class, "spark");
});

test("the pass: a stamp ledger with lines nobody committed is not touched (exit 3); no arguments is usage (exit 2)", async () => {
  const { main } = await import("../deploy/event-sparks-pass.mjs");
  const dir = townInABottle();
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), `${ledgerText(dir)}- uncommitted\n`);
  const quiet = console.error; console.error = () => {};
  try {
    assert.equal(await main(["--town", dir, "--key", KEY_FILE], ENV), 3);
    assert.equal(await main([], ENV), 2);
  } finally { console.error = quiet; }
  // the free events' cutoff: unset is said to be UNCONFIGURED (held), never a quiet empty cohort; a malformed one admits none, exit 1
  const clean = townInABottle();
  const said = [];
  const log = console.log;
  console.error = (s) => said.push(String(s)); console.log = () => {};
  try {
    assert.equal(await main(["--town", clean, "--dry-run"], ENV), 0);
    assert.ok(said.some((s) => /free events' drafts are UNCONFIGURED .* held, not found ineligible/.test(s)), said.join("\n"));
    said.length = 0;
    assert.equal(await main(["--town", clean, "--dry-run", "--drafts-from", "yesterday"], ENV), 1);
    assert.ok(said.some((s) => /--drafts-from "yesterday" is not one UTC instant/.test(s)), said.join("\n"));
    said.length = 0;
    assert.equal(await main(["--town", clean, "--dry-run", "--drafts-from", "2026-11-14T14:37:00Z"], ENV), 0);
    assert.ok(!said.some((s) => /UNCONFIGURED/.test(s)), "a configured cutoff is not unconfigured");
  } finally { console.error = quiet; console.log = log; }
});

test("the pass never signs onto a RED ledger: an event due meets its completion's own arrival check and the pass stops (exit 4); a quiet tick runs no verify", async () => {
  const { main } = await import("../deploy/event-sparks-pass.mjs");
  const dir = townInABottle();
  appendFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "- 2026-11-14 · a line no key signed · wright → ada · 3\n");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qam", "a red line, committed");
  assert.notEqual(verifies(dir).status, 0, "the fixture ledger is red to the town's own verifier");
  const lines = ledgerText(dir), head = git(dir, "rev-parse", "HEAD").trim();
  // a quiet tick: the earlier tests' events (ended, some still held) are closed first, so nothing is due here
  await owner.query("UPDATE posts SET state = 'cancelled' WHERE class = 'event' AND NOT (fields ? 'completed')");
  const quiet = [console.error, process.stderr.write]; console.error = () => {}; process.stderr.write = () => true;
  try {
    assert.equal(await main(["--town", dir, "--key", KEY_FILE], ENV), 0, "nothing due: the ledger is not judged at all");
    await owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
      VALUES ('wright/red-ledger-night', 'event', 'Red ledger night', '', 'wright', 'wright-house', NULL, 10, 20, $1, $2, 'announced', $3, 0, 1, 1)`,
      [new Date(Date.now() - 7_200_000), new Date(Date.now() - 3_600_000), JSON.stringify({ doors_open: new Date(Date.now() - 7_200_000).toISOString(), stake: { n: 20, by: "wright" } })]);
    assert.equal(await main(["--town", dir, "--key", KEY_FILE], ENV), 4, "an event due on a red ledger: refused");
  } finally { [console.error, process.stderr.write] = quiet; }
  assert.equal(ledgerText(dir), lines, "nothing signed");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "nothing committed");
  assert.equal((await postRow("wright/red-ledger-night")).fields.completed, undefined, "the event waits for a green ledger");
});

test("POS-1204 (the falsifier): an ENDED event with zero rooms still reads its standing, directly named Sparks — beside the room-derived ones once each; another event's, a non-standing one and its root stay out", async () => {
  await owner.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (1204, now() - interval '3 days', now() - interval '2 days', 'closed') ON CONFLICT DO NOTHING");
  const mark = (slug, data, status = "standing") => owner.query(
    `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
     VALUES (gen_random_uuid(), $1, 'spark', $2, $3, $4, $5, box(point(0,0), point(1,1)), $6, 1204, $7)`,
    [slug, slug.split("/")[0], `${slug.split("/")[0]}-house`, `the ${slug}`, JSON.stringify({ at: { x: 0, y: 0 }, extent: { w: 0, h: 0 } }), status, JSON.stringify(data)]);
  const base = { kind: "spark", recounting: "r", experienced_at: "2026-11-14T20:00:00.000Z" };
  const EV = "pica/album-night";
  await event(EV, 5000, 5120, { doors: 4970 });                                                  // ended, and nobody said a word there (its own hours: the store is shared)
  await mark("amia/a-picture", { ...base, event: EV });
  await mark("seth/b-picture", { ...base, event: EV });
  await mark("liv/elsewhere", { ...base, event: "pica/another-night" });
  await mark("noe/retired", { ...base, event: EV }, "retired");
  await mark("pica/album-night-root", { ...base, event: EV });
  await owner.query("UPDATE posts SET fields = fields || $2::jsonb WHERE id = $1", [EV, JSON.stringify({ completed: { act: 1, sparks: ["pica/album-night-root"], at: new Date(min(5121)).toISOString() } })]);   // the completion's own root
  const read = async () => (await calendarAtOffice({ event: EV }, { now: NOW, env: ENV, settlements: () => [min(-600)] })).event.evidence;
  let ev = await read();
  assert.equal(ev.complete, true);
  assert.deepEqual(ev.rooms, [], "no conversation, no rooms — and still an album");
  assert.deepEqual(ev.gallery.rooms, []);
  assert.deepEqual(ev.gallery.sparks.map((s) => s.id), ["amia/a-picture", "seth/b-picture"], "the standing, directly named Sparks, in accepted order; never another event's, a retired one, or a completion root");
  // a room-derived Spark and a dual match (named AND in the room) — once each
  await act("say", "pica", 4980, 100, 200, "pica-house", { text: "Welcome!", place: "the cave" });
  await act("say", "seth", 5010, 131, 200, "seth-house", { text: "Hello!", place: "the cave", reply_to: 1 });
  ev = await read();
  assert.equal(ev.rooms.length, 1);
  const room = ev.rooms[0].id;
  await mark("dee/room-only", { ...base, rooms: [room], circle: 1, circle_path: [1] });
  await mark("fay/dual", { ...base, event: EV, rooms: [room], circle: 1, circle_path: [1] });
  ev = await read();
  assert.deepEqual(ev.gallery.sparks.map((s) => s.id), ["amia/a-picture", "dee/room-only", "fay/dual", "seth/b-picture"], "named and room-derived as one list in accepted order, the dual match once");
  // unknown rooms stay unknown, even with Sparks naming the event
  const lost = (await calendarAtOffice({ event: EV }, { now: NOW, env: ENV, settlements: () => [min(6000)] })).event.evidence;
  assert.equal(lost.room_history, "unavailable");
  assert.equal(lost.gallery, null, "rooms that cannot be told: the gallery is unknown, not none");
});
