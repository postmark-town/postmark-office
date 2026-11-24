// spark-verb.test.mjs — world { do: "spark" } (POS-1222): one verb that makes a spark, a thin layer over leave-mark.
//
// Darko, 2026-11-24 14:24 EST: "we should probaby make a create-spark do: verb first". The law it fills in from is World's
// (LOGOS/classes.md § The spark): "An event's spark takes its doors-open to its end, or a circle's its first say to its last";
// "A room-bound spark takes its room's centre and sides as `at` and `extent`"; "With no room, the maker chooses its `at`, with an
// extent locked at 60 radius"; "A circle's spark uses its source room"; "a spark is never anchored".
//
// WHAT THIS RUNS. The act itself (spark-verb.mjs § sparkAct) with its readers handed in: the event as the calendar answers it, the
// circle as the record answers it, the maker's marks for the slug, and leave-mark as a RECORDER that answers like the door. So
// every assertion is about the exact leave-mark call the verb makes, and that the answer is leave-mark's own. That the real
// leave-mark door takes the call (its preview writing nothing, put_forward reaching its stake) is test/spark-verb-door.test.mjs.
// Every household, event, room and say here is invented.
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/spark-verb.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const V = await import("../src/spark-verb.mjs");
const { roomFrame, placeFrame } = await import("../src/event-sparks.mjs");

const KEY = { household: "pica-house", handles: new Set(["pica"]) };
const DOORS = "2026-11-14T19:30:00.000Z", ENDS = "2026-11-14T22:00:00.000Z";
const ROOM_A = { id: "t1794686460000-pica", extent: { x0: 10, y0: 20, x1: 41, y1: 20, span_m: 31 } };
const ROOM_B = { id: "t1794686520000-seth", extent: { x0: 300, y0: 300, x1: 320, y1: 330, span_m: 36 } };
const withFrame = (r) => ({ ...r, frame: roomFrame(r) });
const eventView = (rooms, extra = {}) => ({ id: "pica/sorbet-opening", place: { x: 100, y: 200 }, doors_open: DOORS, ends: ENDS, cancelled: false,
  evidence: { window: { from: DOORS, to: ENDS }, complete: true, rooms: rooms.map(withFrame), room_history: "complete" }, ...extra });
const CIRCLE = { id: 50101, room: ROOM_A, path: [50090, 50101], first_ms: Date.parse("2026-11-14T20:01:00Z"), last_ms: Date.parse("2026-11-14T20:40:00Z") };
const DOOR_ANSWER = Object.freeze({ id: "pica/x", status: "draft", publishing: "a draft: world_stake to put it forward", parent: null });

/** The readers, standing in for the office's; leave-mark records each call and answers like the door. */
function readers({ event = null, circle = null, taken = [], standpoint = { x: 7, y: 9 }, answer = DOOR_ANSWER } = {}) {
  const calls = [], asked = [];
  return {
    calls, asked,
    eventOf: async (id) => { asked.push(["event", id]); if (!event) throw Object.assign(new Error("x"), { code: 422, defect: "names no event" }); return event; },
    circleOf: async (id) => { asked.push(["circle", id]); return circle; },
    idTaken: async ({ by, slug }) => { asked.push(["slug", `${by}/${slug}`]); return taken.includes(`${by}/${slug}`); },
    standpointOf: async () => { asked.push(["standpoint"]); return standpoint; },
    leaveMark: async (call, key) => { calls.push({ call, key }); return { ...answer, id: `pica/${call.slug}` }; },
  };
}
const spark = (fields, r, ctx = {}) => V.sparkAct({ handle: "pica", ...fields }, KEY, ctx, r);
const refusedWith = (re) => (e) => e?.code === 422 && re.test(e.defect) && /Nothing was written\./.test(e.hint ?? "");

// ── each tie: the exact leave-mark call ────────────────────────────────────────────────────────────────────────────────────────

test('EVENT, ONE ROOM — LAW: "An event\'s spark takes its doors-open to its end" and "A room-bound spark takes its room\'s centre and sides": the call is the room\'s frame, the window, rooms: [the room]', async () => {
  const r = readers({ event: eventView([ROOM_A]) });
  const out = await spark({ recounting: "Pica opened the counter; the lemon one ran out first.", event: "pica/sorbet-opening" }, r);
  assert.equal(r.calls.length, 1, "leave-mark was called once");
  const f = roomFrame(ROOM_A);
  // the call a resident would have written by hand (set.mjs's shape: kind, slug, body, at, extent, properties)
  assert.deepEqual(r.calls[0].call, { handle: "pica", kind: "spark", slug: "pica-opened-the-counter-the-lemon-one-ran-out-first", body: "Pica opened the counter; the lemon one ran out first.",
    at: f.at, extent: f.extent, properties: { recounting: "Pica opened the counter; the lemon one ran out first.", event: "pica/sorbet-opening",
      experienced_at: DOORS, experienced_until: ENDS, rooms: [ROOM_A.id] } }, "LAW: the event's window and its one room's frozen frame");
  assert.deepEqual(out.spark.filled.rooms, [ROOM_A.id]);
  assert.equal(out.spark.gallery.joins, true, "naming the event's room is what puts it in the gallery");
  assert.deepEqual(out.spark.leave_mark, { do: "leave-mark", args: r.calls[0].call }, "the answer names the exact call it made");
});

test("EVENT, NOBODY TALKING — the event's place on the locked 60 m circle, no room, and NOT in the gallery", async () => {
  const r = readers({ event: eventView([]) });
  const out = await spark({ recounting: "A quiet table.", event: "pica/sorbet-opening" }, r);
  const call = r.calls[0].call;
  assert.deepEqual([call.at, call.extent], [placeFrame({ x: 100, y: 200 }).at, { w: 120, h: 120 }], "LAW: \"an extent locked at 60 radius\"");
  assert.equal("rooms" in call.properties, false, "no room is written");
  assert.equal(out.spark.gallery.joins, false);
});

test("EVENT, SEVERAL ROOMS — refused until the maker names one (\"a spark binds one room at most\"); named, that room's frame; an unknown room refused", async () => {
  const r = readers({ event: eventView([ROOM_A, ROOM_B]) });
  await assert.rejects(spark({ recounting: "x", event: "pica/sorbet-opening" }, r), refusedWith(/formed 2 rooms, and a spark binds one at most/));
  assert.equal(r.calls.length, 0, "nothing reached leave-mark");
  await spark({ recounting: "x", event: "pica/sorbet-opening", room: ROOM_B.id }, r);
  assert.deepEqual([r.calls[0].call.at, r.calls[0].call.properties.rooms], [roomFrame(ROOM_B).at, [ROOM_B.id]]);
  await assert.rejects(spark({ recounting: "x", event: "pica/sorbet-opening", room: "t1-nobody" }, r), refusedWith(/is not one of the event's rooms/));
});

test("EVENT, THE MAKER'S OWN POINT — at: stands it there on the locked circle, still tied to the event, in no room; the maker's own time wins", async () => {
  const r = readers({ event: eventView([ROOM_A]) });
  const out = await spark({ recounting: "On the way home.", event: "pica/sorbet-opening", at: { x: 500, y: 600 }, experienced_at: "2026-11-14T22:30:00.000Z" }, r);
  const call = r.calls[0].call;
  assert.deepEqual([call.at, call.extent], [{ x: 500, y: 600 }, { w: 120, h: 120 }]);
  assert.equal(call.properties.event, "pica/sorbet-opening");
  assert.equal("rooms" in call.properties, false);
  assert.equal(call.properties.experienced_at, "2026-11-14T22:30:00.000Z", "the maker's time, not the doors-open");
  assert.equal(call.properties.experienced_until, ENDS, "and the end still filled in");
  assert.equal("experienced_at" in out.spark.filled, false, "the answer does not claim it filled what the maker gave");
});

test("EVENT, ROOMS UNKNOWN — never read as nobody talking: not opened, cancelled, or untellable history all refuse and ask for at:", async () => {
  for (const [what, ev, re] of [["not opened", eventView([], { evidence: null }), /has not opened its doors yet/],
    ["cancelled", eventView([], { evidence: null, cancelled: true }), /was cancelled/],
    ["untellable", eventView([], { evidence: { window: { from: DOORS, to: ENDS }, rooms: [], room_history: "unavailable", room_note: "the window opens before the oldest settlement" } }), /can't tell the rooms its talk formed .*not the same as nobody talking/]]) {
    const r = readers({ event: ev });
    await assert.rejects(spark({ recounting: "x", event: "pica/sorbet-opening" }, r), refusedWith(re), what);
    assert.equal(r.calls.length, 0, `${what}: nothing reached leave-mark`);
  }
  // the control: the same untellable event takes the maker's own point
  const r = readers({ event: eventView([], { evidence: null }) });
  await spark({ recounting: "x", event: "pica/sorbet-opening", at: { x: 1, y: 2 } }, r);
  assert.equal(r.calls.length, 1);
});

test('CIRCLE — LAW: "a circle\'s its first say to its last" and "A circle\'s spark uses its source room": rooms, circle, circle_path and the time from the record', async () => {
  const r = readers({ circle: CIRCLE });
  const out = await spark({ recounting: "Seth asked who painted the sign.", circle: "50101" }, r);
  assert.deepEqual(r.asked.find((a) => a[0] === "circle"), ["circle", 50101], "a string of digits is read as the act number");
  const call = r.calls[0].call, f = roomFrame(ROOM_A);
  assert.deepEqual([call.at, call.extent], [f.at, f.extent]);
  assert.deepEqual(call.properties, { recounting: "Seth asked who painted the sign.", rooms: [ROOM_A.id], circle: 50101, circle_path: [50090, 50101],
    experienced_at: "2026-11-14T20:01:00.000Z", experienced_until: "2026-11-14T20:40:00.000Z" });
  assert.equal("gallery" in out.spark, false, "no event, no gallery");
  await assert.rejects(spark({ recounting: "x", circle: 50101, at: { x: 1, y: 2 } }, readers({ circle: CIRCLE })), refusedWith(/stands in the room the circle was spoken in/));
});

test("NEITHER — where the maker stands, on the locked circle; experienced_at is the maker's to state (LOGOS: \"the maker states its start\")", async () => {
  const r = readers();
  await spark({ recounting: "A walk by the water.", experienced_at: "2026-11-20" }, r, { standpoint: { x: 40, y: -12 } });
  assert.deepEqual([r.calls[0].call.at, r.calls[0].call.extent], [{ x: 40, y: -12 }, { w: 120, h: 120 }], "the apex's standpoint");
  assert.equal(r.asked.some((a) => a[0] === "standpoint"), false, "the apex already knew where they stand");
  const r2 = readers({ standpoint: { x: 3, y: 4 } });
  await spark({ recounting: "A walk by the water.", experienced_at: "2026-11-20" }, r2);
  assert.deepEqual(r2.calls[0].call.at, { x: 3, y: 4 }, "the flat door asks the orient for it");
  const r3 = readers();
  await spark({ recounting: "A walk.", experienced_at: "2026-11-20", at: { x: -5, y: 5 } }, r3, { standpoint: { x: 40, y: -12 } });
  assert.deepEqual(r3.calls[0].call.at, { x: -5, y: 5 }, "the maker's own point wins");
  await assert.rejects(spark({ recounting: "A walk." }, readers(), { standpoint: { x: 1, y: 1 } }), refusedWith(/needs experienced_at/));
});

test("the ties are judged before anything is read: one at most, room only with an event, room and at together refused", async () => {
  for (const [fields, re] of [[{ event: "pica/sorbet-opening", circle: 50101 }, /one tie at most/], [{ room: ROOM_A.id }, /room: names one of an event's rooms/],
    [{ event: "pica/sorbet-opening", room: ROOM_A.id, at: { x: 1, y: 1 } }, /room: and at: say two places/], [{ circle: "fifty" }, /circle: is a say's act number/],
    [{ at: { x: "a" }, experienced_at: "2026-11-20" }, /at: is \{ x, y \}/], [{ recounting: "  " }, /needs its recounting/]]) {
    const r = readers({ event: eventView([ROOM_A]), circle: CIRCLE });
    await assert.rejects(spark({ recounting: "x", ...fields }, r), refusedWith(re), JSON.stringify(fields));
    assert.equal(r.asked.length + r.calls.length, 0, `${JSON.stringify(fields)}: nothing read, nothing left`);
  }
});

// ── a parent is refused ───────────────────────────────────────────────────────────────────────────────────────────────────────

test('A PARENT IS REFUSED — LAW: "a spark is never anchored: it writes no parent: and files at its id"; parent_spark, its own link, rides as a property', async () => {
  for (const k of ["parent", "parent_id"]) {
    const r = readers();
    await assert.rejects(spark({ recounting: "x", experienced_at: "2026-11-20", [k]: "pica/the-first-sorbet" }, r),
      refusedWith(new RegExp(`a spark takes no ${k}: a spark is never anchored`)), k);
    assert.equal(r.calls.length + r.asked.length, 0, `${k}: nothing reached leave-mark`);
  }
  const r = readers();
  await spark({ recounting: "x", experienced_at: "2026-11-20", parent_spark: "pica/the-first-sorbet" }, r);
  assert.equal(r.calls[0].call.properties.parent_spark, "pica/the-first-sorbet");
  assert.equal("parent_id" in r.calls[0].call, false, "no parent rides the call");
  // the apex's near miss names the link: world { do: "spark", args: { parent } } bounces with parent_spark offered
  const { didYouMean } = await import("../src/world-apex.mjs");
  assert.deepEqual(didYouMean("spark", ["parent"], Object.keys(V.SPARK_TOOL_DEF.inputSchema.properties)).parent.fields, ["parent_spark"]);
});

// ── preview and put_forward reach leave-mark as its own fields ────────────────────────────────────────────────────────────────

test("PREVIEW and PUT_FORWARD are leave-mark's own: preview: true rides as preview; put_forward: N as stamps: N; neither, a draft", async () => {
  const r = readers();
  const p = await spark({ recounting: "x", experienced_at: "2026-11-20", preview: true, put_forward: 2 }, r);
  assert.equal(r.calls[0].call.preview, true);
  assert.equal(r.calls[0].call.stamps, 2, "put_forward is leave-mark's stake in the same act");
  assert.equal(p.spark.publish.preview, true);
  const w = await spark({ recounting: "y", experienced_at: "2026-11-20", put_forward: 1 }, r);
  assert.equal("preview" in r.calls[1].call, false);
  assert.equal(r.calls[1].call.stamps, 1);
  assert.equal(w.spark.publish.put_forward, 1);
  const d = await spark({ recounting: "z", experienced_at: "2026-11-20" }, r);
  assert.equal("stamps" in r.calls[2].call, false, "no put_forward, no stamps: leave-mark keeps it a draft");
  assert.match(d.spark.publish.says, /world \{ do: "stake", args: \{ mark: "pica\/z", stamps: 1 \} \}/);
});

// ── the answer is leave-mark's own ────────────────────────────────────────────────────────────────────────────────────────────

test("THE ANSWER IS LEAVE-MARK'S, WHOLE: everything but the spark block is exactly what leave-mark answered", async () => {
  const r = readers({ event: eventView([ROOM_A]) });
  const { spark: block, ...rest } = await spark({ recounting: "x", event: "pica/sorbet-opening" }, r);
  assert.deepEqual(rest, { ...DOOR_ANSWER, id: "pica/x" });
  assert.equal(block.id, "pica/x");
  // a refusal of leave-mark's stays its refusal, untouched
  const boom = Object.assign(new Error("you already have a mark \"x\""), { code: 409, defect: "you already have a mark \"x\"", hint: "pick another slug" });
  const r2 = readers();
  r2.leaveMark = async () => { throw boom; };
  await assert.rejects(spark({ recounting: "x", slug: "x", experienced_at: "2026-11-20" }, r2), (e) => e === boom);
});

// ── the headline and the name ─────────────────────────────────────────────────────────────────────────────────────────────────

test("THE HEADLINE is the title, or the recounting when it fits 150 on one line; a longer recounting asks for a title", async () => {
  const r = readers();
  await spark({ recounting: "a long night", title: "The night the bowls were sealed", experienced_at: "2026-11-20" }, r);
  assert.equal(r.calls[0].call.body, "The night the bowls were sealed");
  assert.equal(r.calls[0].call.properties.recounting, "a long night", "the recounting stays whole");
  const long = "x".repeat(151);
  await assert.rejects(spark({ recounting: long, experienced_at: "2026-11-20" }, readers()), refusedWith(/the recounting is 151 characters, too long to be the headline too/));
  await spark({ recounting: "y".repeat(150), experienced_at: "2026-11-20" }, r);
  assert.equal(r.calls[1].call.body, "y".repeat(150), "150 is the cap, and it fits");
});

test("THE NAME is the house's slug rule over the headline, the next free -2 when it is already the maker's; a given slug is used as given", async () => {
  const r = readers({ taken: ["pica/a-walk", "pica/a-walk-2"] });
  await spark({ recounting: "A walk!", experienced_at: "2026-11-20" }, r);
  assert.equal(r.calls[0].call.slug, "a-walk-3");
  const r2 = readers({ taken: ["pica/mine"] });
  await spark({ recounting: "A walk", slug: "mine", experienced_at: "2026-11-20" }, r2);
  assert.equal(r2.calls[0].call.slug, "mine", "the maker's slug goes to leave-mark, which judges it");
  assert.equal(r2.asked.some((a) => a[0] === "slug"), false, "and no name was looked up for it");
});

// ── the wiring: the door reaches it ───────────────────────────────────────────────────────────────────────────────────────────

test("THE WIRING: the apex dispatches spark to world_spark; it is a write, charged as one, delisted, annotated, and its card's fields are the schema's", async () => {
  const apex = await import("../src/world-apex.mjs");
  assert.equal(apex.DISPATCH_TOOLS.spark, "world_spark");
  assert.equal(apex.dispatchToolFor("spark"), "world_spark");
  assert.ok(apex.DISPATCHABLE.includes("spark"), "L6's handled side holds it");
  const { WRITE_TOOLS, DELISTED } = await import("../src/mcp.mjs");
  assert.ok(WRITE_TOOLS.has("world_spark") && DELISTED.has("world_spark"));
  const { WORLD_WRITE_VERBS } = await import("../src/bouncer.mjs");
  assert.ok(WORLD_WRITE_VERBS.has("world_spark"), "it spends the household's world-write budget, as leave-mark does");
  const { WORLD_TOOLS } = await import("../src/world.mjs");
  assert.equal(WORLD_TOOLS.find((t) => t.name === "world_spark"), V.SPARK_TOOL_DEF);
  const card = apex.fieldsFor("spark");
  assert.deepEqual(Object.keys(card).sort(), Object.keys(V.SPARK_TOOL_DEF.inputSchema.properties).filter((k) => k !== "handle").sort(),
    "the card names the schema's fields, less the standpoint's handle (the apex's STANDPOINT_PARAMS)");
  assert.equal(card.recounting.required, true, "the recounting is marked required");
});
