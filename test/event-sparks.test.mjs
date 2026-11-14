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

test("the event's room: the record's talk inside the window, clustered as the conversations page clusters it, at the place", () => {
  const voices = [
    voice("early", -30, 100, 200),            // before doors: not the event's talk
    voice("pica", 1, 100, 200), voice("seth", 2, 110, 205), voice("liv", 3, 150, 200),
    voice("far", 4, 900, 900), voice("far2", 5, 905, 900), voice("far3", 6, 910, 900), // a bigger room, elsewhere
    voice("late", 200, 100, 200),             // after ends
  ];
  const r = S.eventRoomFrom(voices, { window: { from: min(0), to: min(120) }, place: PLACE, edges: [min(-600)] });
  assert.equal(r.history, "complete");
  assert.equal(r.room.id, `t${min(1)}-pica`);
  assert.equal(r.room.voice_count, 3, "the window scopes it: the early and late voices are not this event's talk");
  assert.deepEqual(r.room.participants, ["pica", "seth", "liv"]);
  assert.equal("voices" in r.room, false, "the room's header; its lines are the circle reads' to serve");
  assert.deepEqual(S.roomFrame(r.room), { room: r.room.id, at: { x: 125, y: 202.5 }, extent: { w: 50, h: 5 } });
});

test("no talk at the place is no room (the radius frame applies); talk the office cannot place in a settlement is UNAVAILABLE, never 'no conversation'", () => {
  const none = S.eventRoomFrom([voice("far", 1, 900, 900)], { window: { from: min(0), to: min(60) }, place: PLACE, edges: [min(-600)] });
  assert.deepEqual([none.room, none.history], [null, "complete"]);
  const old = S.eventRoomFrom([voice("pica", 1, 100, 200)], { window: { from: min(0), to: min(60) }, place: PLACE, edges: [min(30)] });
  assert.deepEqual([old.room, old.history], [null, "unavailable"]);
  assert.match(old.note, /not evidence that nobody spoke/);
});

test("a settlement inside the window splits the talk (until CORE-97 carries it): the most-said room is the event's, the others counted", () => {
  const voices = [voice("a", 1, 100, 200), voice("b", 2, 100, 201), voice("c", 40, 100, 200), voice("d", 41, 101, 200), voice("e", 42, 100, 199)];
  const r = S.eventRoomFrom(voices, { window: { from: min(0), to: min(60) }, place: PLACE, edges: [min(-600), min(30)] });
  assert.equal(r.rooms, 2);
  assert.equal(r.room.voice_count, 3);
  assert.match(r.note, /2 conversations formed at the place/);
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

test("one event's evidence: its window, the room its talk formed at its place (with the frozen frame), and the households with a public act there", async () => {
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
  assert.equal(ev.room.voice_count, 2);
  assert.deepEqual(ev.room.frame, { room: ev.room.id, at: { x: 115.5, y: 200 }, extent: { w: 31, h: 0 } }, "exact midpoint, a half and a zero kept");
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
