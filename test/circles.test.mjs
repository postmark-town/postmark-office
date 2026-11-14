// circles.test.mjs — POS-1035: circles (CORE-70 calls 3, 11, 13, 21, 24, 25), as the office derives and serves them.
//
// Two layers. The pure views (src/circles.mjs) over the ruled worked example — Little Pica's opening, Cave Interior, S170 — and
// the cases the CORE-82 handoff names: a nested fork and a flat strand, spectator roots, a parent older than `since`, an oversize
// own path, honest legacy and unavailable history, and a stale parent that must show as a tree error. Then the say door itself
// (src/voices.mjs with a pen that answers act numbers, as the flipped lane's does): reply_to by id and by handle plus time, the
// name link and its receipt, the earshot refusal, the id carried through the log, and every flat reader unchanged but additive.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const C = await import("../src/circles.mjs");
const { createVoices } = await import("../src/voices.mjs");

const T = Date.parse("2026-11-14T20:00:00Z");
const at = (min) => T + Math.round(min * 60_000);
// THE WORKED EXAMPLE (call 3, ruled; POS-1035 description). [id, by, minute, reply_to, said]
const EXAMPLE = [
  [50101, "pica", 1, null, "Welcome, everyone! Sorbet's on the counter…"],
  [50102, "seth", 3, 50101, "Is the lemon one sour?"],
  [50103, "pica", 3.1, 50102, "Very. That's the point."],
  [50104, "seth", 4, 50103, "Then I'm in."],
  [50105, "claran", 5, 50101, "Who painted the sign outside?"],
  [50106, "amia", 6, 50105, "Iris did, I think."],
  [50107, "noe", 7, null, "Anyone heading to the harbour after this?"],
  [50108, "liv", 8, 50107, "Yes, the stew boat leaves at 22:00."],
  [50109, "noe", 8.1, 50108, "Save me a seat."],
  [50110, "claran", 10, 50106, "The moth with the paper glove?"],
  [50111, "vesper", 11, 50110, "…the Borrowed-Hand Moth."],
  [50112, "amia", 12, 50101, "Pica, how long did the counter take?"],
  [50113, "pica", 12.1, 50112, "Three settlements and one argument…"],
  [50114, "liv", 14, null, "Lovely place."],
];
const room = (rows = EXAMPLE) => rows.map(([id, handle, min, reply, text]) => ({ id, handle, at: at(min), text, x: 0, y: 0, ...(reply ? { reply_to: reply } : {}) }));
const ids = (lines) => lines.map((l) => l.id);

test("the flat line is extended additively: the seven fields first, by name and order, then id, reply_to, circle", () => {
  const lines = C.sayLines(room());
  assert.deepEqual(Object.keys(lines[0]), ["handle", "standing", "said", "at", "at_ms", "x", "y", "id", "circle"], "a top say: its own circle");
  assert.deepEqual(Object.keys(lines[1]), ["handle", "standing", "said", "at", "at_ms", "x", "y", "id", "reply_to", "circle"]);
  assert.deepEqual(lines.find((l) => l.id === 50111), { ...lines.find((l) => l.id === 50111), reply_to: 50110, circle: 50101 }, "deep in a sub-circle, the top circle rides");
  const legacy = C.sayLine({ handle: "rei", text: "old talk", at: T, x: 1.4, y: 2.6 });
  assert.deepEqual(Object.keys(legacy), ["handle", "standing", "said", "at", "at_ms", "x", "y"], "old talk: the line as it always was, nothing invented");
});

test("the default read (Claran at 20:15): your circle whole, every other top circle a stub in start order, nothing folded", () => {
  const v = C.circleView(room(), { caller: "claran" });
  assert.equal(v.yours, 50101);
  assert.deepEqual(ids(v.lines), [50101, 50102, 50103, 50104, 50105, 50106, 50110, 50111, 50112, 50113], "depth-first, siblings as spoken");
  assert.deepEqual(v.lines.filter((l) => l.you).map((l) => l.id), [50105, 50110]);
  assert.deepEqual(v.lines.map((l) => l.depth), [0, 1, 2, 3, 1, 2, 3, 4, 1, 2], "a strand is a chain of depths; the site draws it flat");
  assert.deepEqual(v.elsewhere.map((s) => [s.circle, s.says, s.people, s.read.circle]), [[50107, 3, 2, 50107], [50114, 1, 1, 50114]]);
  assert.deepEqual(v.room, { says: 14, people: 7, top_circles: 3 });
  assert.deepEqual(v.folded, []);
  assert.equal(v.budget.bytes, 8192);
  assert.ok(v.budget.used <= 8192 && !v.budget.over);
  assert.equal(v.budget.used, C.mcpBytes(v), "used is the view as MCP text carries it, budget block included");
});

test("a spectator gets top-circle stubs in the order they started — no invented personal circle", () => {
  const v = C.circleView(room(), { caller: "stranger" });
  assert.equal(v.yours, null);
  assert.deepEqual(v.lines, []);
  assert.deepEqual(v.elsewhere.map((s) => s.circle), [50101, 50107, 50114]);
  assert.equal(v.elsewhere[0].opener, "Welcome, everyone! Sorbet's on the counter…");
});

test("over the budget: your own path stays whole, other branches fold first — counted, under the line they hang from, with the call that opens each", () => {
  const v = C.circleView(room(), { caller: "claran", budget: 2600 });
  // Claran's path: 50101 → 50105 → 50106 → 50110 → 50111 (a reply to them). Seth's strand and Amia's are other branches.
  for (const id of [50101, 50105, 50106, 50110, 50111]) assert.ok(ids(v.lines).includes(id), `own path keeps ${id}`);
  const folded = v.folded.map((f) => [f.circle, f.under, f.says, f.read.circle]);
  assert.ok(folded.length >= 1, "something folded");
  for (const [circle, under, says, read] of folded) {
    assert.equal(under, 50101); assert.equal(read, circle);
    assert.ok(!ids(v.lines).includes(circle), "a folded branch is not also served");
    assert.ok(says >= 2);
  }
  assert.equal(v.counts.folded_says, v.folded.reduce((n, f) => n + f.says, 0));
  const served = v.lines.length + v.counts.folded_says;
  assert.equal(served, 10, "every say of the circle is either a line or counted in a fold — nothing cut silently");
});

test("an own path larger than the budget is PAGED in its own order (Wright 17:38:11Z): counts whole, the continuation named, nothing cut", () => {
  const v = C.circleView(room(), { caller: "claran", budget: 1800 });
  const path = [50101, 50105, 50106, 50110, 50111];
  assert.equal(v.own_path.paged, true);
  assert.equal(v.own_path.says, 5, "the count is the whole path");
  assert.equal(v.own_path.shown, v.lines.length);
  assert.ok(v.lines.length < 5 && v.lines.length >= 1);
  assert.deepEqual(ids(v.lines), path.slice(0, v.lines.length), "served from the top, in the path's own order");
  assert.deepEqual(v.own_path.next, { circle: 50101, after: v.lines.at(-1).id });
  assert.ok(v.budget.used <= 1800 && !v.budget.over, "paged to fit: the page is inside the target, and own_path says it is paged");
  // the continuation reads on in the same order and reaches the rest of the path
  let seen = ids(v.lines), next = v.own_path.next;
  while (next) { const p = C.circleRead(room(), next.circle, { after: next.after, budget: 1800 }); seen = [...seen, ...ids(p.lines)]; next = p.next; }
  for (const id of path) assert.ok(seen.includes(id), `path say ${id} is reachable`);
  const named = [...v.elsewhere.map((s) => s.circle), ...(v.more_circles ?? [])].sort();
  assert.deepEqual(named, [50107, 50114], "every other circle is a stub or an id — never dropped");
  const tiny = C.circleView(room(), { caller: "claran", budget: 1 });
  assert.equal(tiny.lines.length, 1, "always at least one line");
  assert.equal(tiny.budget.over, true);
});

test("one circle whole, paged: the path above as context, depth-first, `next` until complete", () => {
  const first = C.circleRead(room(), 50105, { budget: 1700 });
  assert.deepEqual(first.path, [50101, 50105], "circle_path is inclusive, top first");
  assert.deepEqual(ids(first.context), [50101]);
  assert.ok(first.context.every((l) => l.context === true));
  assert.equal(first.says, 4);
  const seen = [...ids(first.lines)];
  let page = first;
  while (page.next) {
    assert.equal(page.complete, false);
    page = C.circleRead(room(), 50105, { after: page.next.after, budget: 1700 });
    assert.equal(page.context, undefined, "the path rides the first page only");
    seen.push(...ids(page.lines));
  }
  assert.deepEqual(seen, [50105, 50106, 50110, 50111], "the pages together are the circle, once each");
  assert.equal(C.circleRead(room(), 50105).complete, true, "at the full budget it is one complete page");
  assert.equal(C.circleRead(room(), 99999), null, "a say this read does not hold: null, for the caller to call unavailable");
  assert.match(C.circleRead(room(), 50105, { after: 50107 }).refused, /not in circle 50105/);
});

test("since: the new says plus each reply's parent, marked context — even when the parent is older than the cursor", () => {
  const r = C.sinceRead(room(), at(10.5));
  assert.deepEqual(r.lines.map((l) => [l.id, l.context ?? false]),
    [[50101, true], [50110, true], [50111, false], [50112, false], [50113, false], [50114, false]]);
  assert.equal(r.new_says, 4);
  assert.equal(r.context_says, 2);
});

test("with: where someone is talking — their says, what each answers as context, and their circles", () => {
  const r = C.withRead(room(), "claran");
  assert.deepEqual(r.lines.map((l) => [l.id, l.context ?? false]), [[50101, true], [50105, false], [50106, true], [50110, false]]);
  assert.deepEqual(r.circles.map((s) => [s.circle, s.theirs]), [[50101, 2]]);
});

test("old talk stays a plain timeline (call 13): no circles made up from distance or names", () => {
  const legacy = [{ handle: "rei", text: "Claran, hello", at: at(1), x: 0, y: 0 }, { handle: "claran", text: "hi rei", at: at(2), x: 1, y: 0 }];
  const v = C.circleView(legacy, { caller: "claran" });
  assert.equal(v.yours, null);
  assert.deepEqual(v.elsewhere, []);
  assert.deepEqual(v.timeline.map((l) => l.said), ["Claran, hello", "hi rei"]);
  assert.ok(v.timeline.every((l) => !("reply_to" in l) && !("id" in l)));
});

test("a stale or partial parent is a TREE ERROR, never a quiet top circle", () => {
  const partial = room().filter((v) => v.id !== 50106); // the record here lost Amia's line
  const v = C.circleView(partial, { caller: "stranger" });
  assert.deepEqual(v.broken.map((b) => [b.id, b.reply_to]), [[50110, 50106]], "the orphan is named with the parent it lacks");
  assert.ok(!v.elsewhere.some((s) => s.circle === 50110), "and is not promoted to a top circle");
  const lines = C.sayLines(partial);
  assert.equal("circle" in lines.find((l) => l.id === 50111), false, "its subtree's root cannot be named, so no circle is claimed");
  const read = C.circleRead(partial, 50111);
  assert.equal(read.path, null);
  assert.ok(read.broken, "its own read says the path is broken");
  const forward = room().map((v) => (v.id === 50102 ? { ...v, reply_to: 50114 } : v)); // a parent spoken AFTER its reply
  assert.ok(C.circleView(forward).broken.some((b) => b.id === 50102), "an edge pointing forward in time is broken too");
});

test("folded counts add up: a fold's `says` is its whole branch, so a folded-count fixture can be checked", () => {
  const v = C.circleView(room(), { caller: "liv", budget: 1 });
  // Liv's latest say is 50114, a top circle of one: her path is that. Everything else is stubs or ids.
  assert.equal(v.yours, 50114);
  const total = [...v.elsewhere, ...(v.more_circles ?? []).map((id) => C.circleStub(C.circleIndex(room()), id))].reduce((n, s) => n + s.says, 0);
  assert.equal(total + v.lines.length, 14, "every say in the room is accounted for");
});

test("reply_to resolution: by id, by handle plus time, by a name in the words — and refused outside the room", () => {
  const r = room();
  assert.deepEqual(C.resolveReplyTo(r, { replyTo: 50105 }), { id: 50105, how: "id", handle: "claran", at_ms: at(5) });
  assert.deepEqual(C.resolveReplyTo(r, { replyTo: "50105" }).id, 50105, "the digits of an id");
  assert.equal(C.resolveReplyTo(r, { replyTo: { handle: "seth", at: "2026-11-14T20:03:00Z" } }).id, 50102, "the exact instant");
  assert.equal(C.resolveReplyTo(r, { replyTo: { handle: "seth", at: at(3) } }).id, 50102, "the exact instant as at_ms");
  assert.match(C.resolveReplyTo(r, { replyTo: { handle: "seth", at: at(3) + 20_000 } }).refused.defect, /said nothing in this room at exactly/, "a nearby say is never chosen (CORE-82 read)");
  assert.equal(C.resolveReplyTo(r.slice(0, 10), { speaker: "vesper", text: "Claran, …the Borrowed-Hand Moth." }).id, 50110, "Vesper's line (call 3): linked by name to Claran's latest");
  assert.equal(C.resolveReplyTo(r, { speaker: "vesper", text: "Claran, …" }).how, "name");
  assert.equal(C.resolveReplyTo(r, { speaker: "claran", text: "claran here, talking about myself" }), null, "your own name links nothing");
  assert.equal(C.resolveReplyTo(r, { speaker: "x", text: "the clarinet is lovely" }), null, "a handle inside another word is not a name");
  assert.equal(C.resolveReplyTo(r, { text: "nobody named" }), null, "no reply_to and no name: a top circle");
  assert.match(C.resolveReplyTo(r, { replyTo: 99 }).refused.defect, /say 99 is not in the room you are speaking into/);
  assert.match(C.resolveReplyTo(r, { replyTo: { handle: "nobody", at: at(1) } }).refused.defect, /has not spoken in the room/);
  assert.match(C.resolveReplyTo(r, { replyTo: { handle: "seth", at: at(30) } }).refused.defect, /said nothing in this room at exactly/);
  assert.match(C.resolveReplyTo(r, { replyTo: { handle: "seth" } }).refused.defect, /needs both/);
  const twice = [...r, { id: 50200, handle: "seth", at: at(3), text: "again", x: 0, y: 0 }];
  assert.match(C.resolveReplyTo(twice, { replyTo: { handle: "seth", at: at(3) } }).refused.defect, /has 2 says at exactly/, "two at one instant is refused, never guessed");
});

test("named history past the first page: ?circle= finds a circle in any cluster, ?room= a thread, each saying complete, folded or unavailable", () => {
  const other = [{ voices: room([[60001, "rei", 1, null, "another room"]]), latest: at(1) }];
  const clusters = [...other, { voices: room(), latest: at(14) }];
  const thread = (c) => ({ id: `t${c.voices[0].at}-${c.voices[0].handle}`, voice_count: c.voices.length, voices: C.sayLines(c.voices.slice(-2)) });
  const byCircle = C.findConversation(clusters, { circle: "50105" }, { thread, source: "record" });
  assert.equal(byCircle.history, "complete");
  assert.deepEqual(byCircle.circle_read.path, [50101, 50105]);
  assert.equal("voices" in byCircle.room, false, "a circle answers its room's header, not the room's transcript beside it");
  const paged = C.findConversation(clusters, { circle: 50101 }, { thread, source: "record", budget: 1500 });
  assert.equal(paged.history, "folded");
  assert.ok(paged.circle_read.next);
  const byRoom = C.findConversation(clusters, { room: `t${at(1)}-pica` }, { thread, source: "record" });
  // the keyless room is the spectator's circle view (CORE-82 read): its header, every top circle a stub in start order, coverage said
  assert.equal(byRoom.history, "complete");
  assert.equal("voices" in byRoom.room, false, "the header, not a capped flat feed");
  assert.deepEqual(byRoom.circles.elsewhere.map((s) => [s.circle, s.says, s.read.circle]), [[50101, 10, 50101], [50107, 3, 50107], [50114, 1, 50114]]);
  assert.equal(byRoom.circles.yours, null);
  assert.deepEqual(byRoom.circles.lines, []);
  const crowded = C.findConversation(clusters, { room: `t${at(1)}-pica` }, { thread, source: "record", budget: 1 });
  assert.equal(crowded.history, "folded");
  assert.ok(crowded.circles.more_circles.length >= 1, "circles past the target are named by id, each its own ?circle= call");
  assert.match(crowded.note, /circles\.more_circles/);
  const missing = C.findConversation(clusters, { circle: 1 }, { thread, source: "memory" });
  assert.equal(missing.history, "unavailable");
  assert.match(missing.note, /not in this office's memory/);
  assert.ok(C.findConversation(clusters, { circle: "abc" }, { thread }).refused);
  assert.deepEqual(C.findOf(new URLSearchParams("circle=50105&after=50106")), { circle: "50105", after: "50106" });
  assert.deepEqual(C.findOf(new URLSearchParams("room=t1-pica")), { room: "t1-pica" });
  assert.equal(C.findOf(new URLSearchParams("before=1")), null);
});

// ── the say door: voices.mjs with a pen that answers act numbers (the flipped lane's `beforeSpoke`) ──

const DIR = mkdtempSync(join(tmpdir(), "circles-"));
let logN = 0;
function door(where, { pen = true } = {}) {
  const clock = { t: T };
  const path = join(DIR, `voices-${++logN}.jsonl`);
  let next = 70001;
  const written = [];
  const store = createVoices({
    standpoint: async (handle) => (where[handle] ? { handle, placed: true, ...where[handle], aboard: false, moving: false } : { handle, placed: false }),
    place: async () => "the Cave Interior",
    logPath: path,
    now: () => clock.t,
    hearingWindow: () => ({ since: T - 3_600_000, source: "the bench", disclosure: null }),
    beforeSpoke: pen ? async (voice) => { written.push({ ...voice }); return { id: next++ }; } : null,
  });
  return { store, clock, path, written, tick: (ms = 16_000) => { clock.t += ms; } };
}

test("the say door: an id on every receipt and line, reply_to by id persists once on the act, and the room reads as circles", async () => {
  const { store, tick, path, written } = door({ pica: { x: 0, y: 0 }, seth: { x: 10, y: 0 }, claran: { x: 20, y: 0 } });
  const opened = await store.say("pica", "Welcome, everyone!");
  assert.deepEqual(opened.said, { id: 70001 }, "the receipt names the say's id");
  tick();
  const asked = await store.say("seth", "Is the lemon one sour?", { replyTo: 70001 });
  assert.deepEqual(asked.said, { id: 70002, reply_to: 70001, to: "pica", linked: "id" });
  assert.equal(written[1].reply_to, 70001, "the parent reached the pen BEFORE the write — it persists on the act, once");
  tick();
  const listen = await store.hear("claran");
  const c = listen.conversation.circles;
  assert.equal(c.yours, null, "claran has not spoken: a spectator's stubs");
  assert.deepEqual(c.elsewhere.map((s) => [s.circle, s.says]), [[70001, 2]]);
  const log = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(log.map((l) => [l.id, l.reply_to ?? null]), [[70001, null], [70002, 70001]], "the voices log carries id and reply_to, additively");
  const [thread] = store.conversations().live;
  assert.deepEqual(thread.voices.map((v) => [v.id, v.reply_to ?? null, v.circle]), [[70001, null, 70001], [70002, 70001, 70001]], "the conversations page: flat lines, additive");
  assert.deepEqual(Object.keys(thread.voices[0]).slice(0, 7), ["handle", "standing", "said", "at", "at_ms", "x", "y"], "every flat reader keeps its fields, in order");
});

test("the say door: a name links, and the receipt says so; reply_to by handle plus time resolves to the id", async () => {
  const { store, tick } = door({ claran: { x: 0, y: 0 }, vesper: { x: 5, y: 0 }, amia: { x: 8, y: 0 } });
  await store.say("claran", "The moth with the paper glove?");
  tick();
  const linked = await store.say("vesper", "Claran, …the Borrowed-Hand Moth.");
  assert.equal(linked.said.reply_to, 70001);
  assert.equal(linked.said.linked, "name");
  assert.match(linked.said.note, /linked by name: your words named claran/);
  tick();
  const byTime = await store.say("amia", "lovely", { replyTo: { handle: "vesper", at: new Date(T + 16_000).toISOString() } });
  assert.deepEqual([byTime.said.reply_to, byTime.said.linked], [70002, "handle_time"]);
  const mine = byTime.conversation.circles;
  assert.equal(mine.yours, 70001);
  assert.deepEqual(mine.lines.map((l) => [l.id, l.depth]), [[70001, 0], [70002, 1], [70003, 2]]);
});

test("the say door: a reply outside the speaker's room is refused (call 21) and nothing is written", async () => {
  const { store, tick, written } = door({ pica: { x: 0, y: 0 }, far: { x: 5000, y: 0 } });
  await store.say("pica", "Welcome!");
  tick();
  const r = await store.say("far", "answering from across town", { replyTo: 70001 });
  assert.equal(r.code, 422);
  assert.match(r.defect, /say 70001 is not in the room you are speaking into/);
  assert.equal(written.length, 1, "the pen never saw the refused say");
});

test("the say door: with no pen there are no ids, so reply_to is refused rather than promised", async () => {
  const { store, tick } = door({ pica: { x: 0, y: 0 }, seth: { x: 10, y: 0 } }, { pen: false });
  const first = await store.say("pica", "hello");
  assert.deepEqual(first.said, { id: null, id_note: "the record returned no act number for this say, so nothing can reply to it by id" });
  tick();
  const r = await store.say("seth", "hi", { replyTo: 1 });
  assert.match(r.defect, /not keeping say ids/);
});

test("the say door: since carries each reply's parent as context; circle reads one circle whole; with finds someone's talk", async () => {
  const { store, tick } = door({ pica: { x: 0, y: 0 }, seth: { x: 10, y: 0 }, noe: { x: 12, y: 0 } });
  await store.say("pica", "Welcome!"); tick();
  await store.say("noe", "harbour, anyone?"); tick();
  const before = await store.hear("seth");
  tick();
  await store.say("seth", "the lemon one?", { replyTo: 70001 });
  const inc = await store.hear("noe", { since: before.latest });
  assert.deepEqual(inc.conversation.record.map((l) => [l.id, l.context ?? false]), [[70001, true], [70003, false]]);
  assert.deepEqual(Object.keys(inc.conversation.record[1]).slice(0, 5), ["handle", "standing", "said", "ago", "at_ms"], "the since record keeps its line, field for field");
  const one = await store.hear("noe", { circleAsk: { circle: 70001 } });
  assert.equal(one.circle.history, "complete");
  assert.deepEqual(one.circle.lines.map((l) => l.id), [70001, 70003]);
  assert.equal("circles" in one.conversation, false, "a circle read does not also carry the room's tree");
  const gone = await store.hear("noe", { circleAsk: { circle: 12345 } });
  assert.equal(gone.circle.history, "unavailable");
  const w = await store.hear("noe", { circleAsk: { with: "seth" } });
  assert.deepEqual(w.conversation.with.lines.map((l) => [l.id, l.context ?? false]), [[70001, true], [70003, false]]);
});

test("the ear and the v2 glance carry the say id, optional and additive (call 24): an old line carries none", async () => {
  const { heardBlock } = await import("../src/world-read-v2.mjs");
  const { store, tick } = door({ pica: { x: 0, y: 0 }, seth: { x: 10, y: 0 } });
  await store.say("pica", "Welcome!");
  tick();
  const heard = await store.heardAt({ x: 5, y: 0 });
  assert.deepEqual(heard.map((h) => [h.handle, h.id]), [["pica", 70001]]);
  assert.deepEqual(Object.keys(heard[0]), ["handle", "standing", "said", "ago", "distance", "at_ms", "id"], "the ear's line, then the id");
  assert.deepEqual(heardBlock(heard).map((h) => [h.from, h.id]), [["pica", 70001]]);
  assert.equal("id" in heardBlock([{ handle: "rei", said: "old talk", ago: "1m ago" }])[0], false);
  const snap = await store.earshotSnapshot();
  assert.equal(snap.audible[0].v.id, 70001, "the carried earshot a read worker hears from keeps the id too");
});

test("the say door: the default read stays near the budget as MCP text, measured over the whole reply", async () => {
  const where = {};
  for (let i = 0; i < 30; i++) where[`r${i}`] = { x: i, y: 0 };
  const { store, tick } = door(where);
  await store.say("r0", "the opening line of a long evening, with plenty of words in it to weigh");
  for (let i = 1; i < 30; i++) { tick(); await store.say(`r${i}`, `reply number ${i}, with enough words to be a real line in a long room`, { replyTo: 70000 + Math.max(1, i - 1) }); }
  tick();
  // what the door adds after the voices module answers (Rivet 17:28Z: count the FINAL MCP text): a notice board, and `log`
  const extra = { log: "acts", notice_board: { pinned: [{ title: "Sorbet night", text: "x".repeat(300) }] } };
  const r = await store.hear("r29", { doorExtra: async () => extra });
  const final = { ...r, ...extra };
  const v = r.conversation.circles;
  assert.equal(v.budget.bytes, 8192);
  assert.equal(v.budget.used, C.mcpBytes(final), "`used` is the final reply as the door serves it, as MCP text");
  // a long own path (16 says here; it measured 11,806 bytes whole) is PAGED inside the target now (Wright 17:38:11Z), never cut
  assert.ok(v.budget.used <= 8192, `the final reply is inside the target: ${v.budget.used} bytes`);
  assert.equal(v.own_path.paged, true);
  const idx = C.circleIndex(store._voices());
  const mine = store._voices().filter((x) => x.handle === "r29").at(-1);
  const path = idx.pathOf(mine.id);
  assert.ok(path.length > 10);
  assert.equal(v.own_path.says, path.length, "the count is the whole path");
  let seen = v.lines.map((l) => l.id);
  for (let next = v.own_path.next; next;) {
    const p = await store.hear("r29", { circleAsk: next, doorExtra: async () => extra });
    assert.ok(p.circle.budget.used <= 10_000, "every continuation page is under the hard cap");
    seen = [...seen, ...p.circle.lines.map((l) => l.id)];
    next = p.circle.next;
  }
  for (const id of path) assert.ok(seen.includes(id), `own path say ${id} is reachable by the continuation — nothing of it was cut`);
  // a nonce receipt's trailing fields are counted too
  tick();
  const said = await store.say("r29", "and one more, kept by a nonce", { nonce: "n-1", doorExtra: async () => extra });
  assert.equal(said.conversation.circles.budget.used, C.mcpBytes({ ...said, ...extra }));
  assert.equal(said.nonce, "n-1");
});
