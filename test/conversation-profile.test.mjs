// conversation-profile.test.mjs — a household's human, said by their chosen town name on every line of speech, with the shoulder they
// actually spoke on (POS-1132, CORE-122's ruling; the producer half: CORE-132 and WLD-219 draw it).
//
// THE RULING, in Wright's words (CORE-122, 2026-11-20 03:06Z):
//   "A human's line reads 'DARKO, of Starforge', or 'the human of Starforge' until a town name is set. The reads keep 'by DARKO (Starforge)'."
//   "A human line with no recorded shoulder shows no 'beside' part, never guessed."
//   "The office accepts an explicit `with` for the unplaced resident it would pick itself (speaking from the Origin)."
//
// INVENTED FIXTURES ONLY: houses "starforge" and "lantern-row", humans and residents that exist nowhere. Every served speech form is
// asked: the room reply (hear / say), the since-record, the flat thread lines, a circle's opener, the heard (glance) line, the carried
// earshot snapshot a read worker takes, the record's own decoding (conversations.mjs § voiceOf) and the rebuilt-from-the-log memory.
//   node --test test/conversation-profile.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");
const { createVoices } = await import("../src/voices.mjs");
const { speakerLineOf, speakerBookOf, speakerFieldsOf, besideOf, useRegistryLoader, forgetSpeakerBook, heldSpeakerBook, speakerBook, adoptSpeakerBook } = await import("../src/speaker-line.mjs");
const { heardBlock } = await import("../src/world-read-v2.mjs");
const talk = await import("../world2/tools/conversations.mjs");

const DIR = mkdtempSync(join(tmpdir(), "postmark-convo-profile-"));
const T0 = Date.UTC(2026, 10, 20, 12, 0, 0);
const MIN = 60_000;

// the registry the lines are said over: one house with a chosen name and pronouns, one with a profile that sets neither, one with
// nothing, and a PRIVATE `human` on each that must never reach a line
const REGISTRY = { households: {
  starforge: { name: "Starforge", residents: ["rei", "vex"], human: "Private Realname One", human_profile: { town_name: "DARKO", pronouns: "he/him", short_line: "a line" } },
  "lantern-row": { name: "Lantern Row", residents: ["ivy"], human: "Private Realname Two" },
  bare: { residents: ["moss"], human_profile: { short_line: "only a line" } },
} };
const asRegistry = () => Promise.resolve(REGISTRY);

let n = 0;
function bench(at, more = {}) {
  const clock = { t: T0, settledAt: T0 - 60 * MIN };
  const path = more.log ?? join(DIR, `v-${++n}.jsonl`);
  const store = createVoices({
    standpoint: async (handle) => (at[handle] ? { handle, placed: true, x: at[handle].x, y: at[handle].y, aboard: false, moving: false } : { handle, placed: false }),
    place: async ({ x, y }) => `the ground at ${x},${y}`,
    logPath: path, now: () => clock.t,
    hearingWindow: () => ({ since: clock.settledAt, source: "the bench's settlement", disclosure: null }),
    ...more,
  });
  return { store, clock, path, tick: (ms) => { clock.t += ms; } };
}
const AT = { rei: { x: 100, y: 100 }, vex: { x: 105, y: 100 }, ivy: { x: 110, y: 100 }, near: { x: 108, y: 100 } };

const SPEAKER_KEYS = ["speaker", "town_name", "pronouns", "house", "house_slug", "beside"];
const none = (line) => SPEAKER_KEYS.filter((k) => Object.hasOwn(line, k));

test("the ruled line: 'DARKO, of Starforge', or 'the human of Starforge' until a town name is set", () => {
  assert.equal(speakerLineOf("Starforge", "DARKO"), "DARKO, of Starforge");
  assert.equal(speakerLineOf("Starforge", null), "the human of Starforge");
  assert.equal(speakerLineOf("Lantern Row"), "the human of Lantern Row");
});

test("the book reads the PUBLIC house only: town name and pronouns, the house's name else its slug; never the private human", () => {
  const book = speakerBookOf(REGISTRY);
  assert.deepEqual(speakerFieldsOf("human-of-starforge", book), { speaker: "DARKO, of Starforge", town_name: "DARKO", pronouns: "he/him", house: "Starforge", house_slug: "starforge" });
  assert.deepEqual(speakerFieldsOf("human-of-lantern-row", book), { speaker: "the human of Lantern Row", house: "Lantern Row", house_slug: "lantern-row" }, "no profile: no town_name, no pronouns key");
  assert.deepEqual(speakerFieldsOf("human-of-bare", book), { speaker: "the human of bare", house: "bare", house_slug: "bare" }, "a house with no display name reads by its slug; a short line alone names no one");
  assert.ok(!JSON.stringify([...book]).match(/Realname|short_line|a line/), "the private name and the short line are not in the book");
  for (const h of ["rei", "berth-x", "human-of-", "human-of-nowhere", null, undefined, 7]) assert.deepEqual(speakerFieldsOf(h, book), {}, `no presentation for ${h}`);
  assert.deepEqual(speakerFieldsOf("human-of-starforge", null), {}, "no registry read: nothing is said about a human the read could not see");
});

test("besideOf: the recorded shoulder only; a line without one has none", () => {
  assert.deepEqual(besideOf({ stood_with: "vex" }), { beside: "vex" });
  for (const v of [{}, { stood_with: "" }, { stood_with: null }, { standing_with: "vex" }, null]) assert.deepEqual(besideOf(v), {});
});

test("a human's say: the room reply, the since-record, the thread lines and the circle opener all say the chosen name and the shoulder", async () => {
  useRegistryLoader(asRegistry);
  const { store, tick } = bench(AT);
  const said = await store.say("human-of-starforge", "we made it aboard", { standAs: "vex" });
  assert.equal(said.spoke, true);
  const mine = said.voices.find((v) => v.handle === "human-of-starforge");
  assert.deepEqual({ handle: mine.handle, standing: mine.standing, said: mine.said }, { handle: "human-of-starforge", standing: "resident", said: "we made it aboard" }, "the canonical hand and standing are as ever");
  assert.equal(mine.speaker, "DARKO, of Starforge");
  assert.equal(mine.town_name, "DARKO");
  assert.equal(mine.pronouns, "he/him");
  assert.equal(mine.house, "Starforge");
  assert.equal(mine.beside, "vex", "the resident the human stood with when they spoke");
  tick(20_000);
  await store.say("rei", "welcome");
  tick(20_000);
  const heard = await store.hear("near");
  const human = heard.voices.find((v) => v.handle === "human-of-starforge");
  const resident = heard.voices.find((v) => v.handle === "rei");
  assert.equal(human.speaker, "DARKO, of Starforge");
  assert.equal(human.beside, "vex");
  assert.deepEqual(none(resident), [], "a resident's line gains nothing: a resident is not a human, whatever its standing says");
  // the flat thread lines, through the feed (memory)
  const feed = store.conversations({});
  const lines = [...(feed.live ?? []), ...(feed.closed ?? [])].flatMap((t) => t.voices);
  const line = lines.find((l) => l.handle === "human-of-starforge");
  assert.equal(line.speaker, "DARKO, of Starforge");
  assert.equal(line.beside, "vex");
  assert.deepEqual(Object.keys(line).slice(0, 7), ["handle", "standing", "said", "at", "at_ms", "x", "y"], "the first seven fields keep their names and order");
  assert.deepEqual(none(lines.find((l) => l.handle === "rei")), []);
  // the since-reply's record line keeps its own shape and gains the same
  const since = await store.hear("near", { since: T0 - 1 });
  const rec = (since.conversation?.record ?? []).find((l) => l.handle === "human-of-starforge");
  assert.ok(rec, "the since record holds the human's say");
  assert.equal(rec.speaker, "DARKO, of Starforge");
  assert.equal(rec.beside, "vex");
});

test("a circle's opener names the human as the lines do, and a reply under it keeps its edge and its ids", async () => {
  useRegistryLoader(asRegistry);
  let id = 0;
  const { store, tick } = bench(AT, { beforeSpoke: async () => ({ id: ++id }) });
  const first = await store.say("human-of-starforge", "who is at the landing?", { standAs: "vex" });
  assert.equal(first.said.id, 1);
  tick(20_000);
  const reply = await store.say("rei", "I am", { replyTo: 1 });
  assert.equal(reply.said.reply_to, 1);
  tick(20_000);
  const room = await store.hear("near");
  const { circleIndex, circleStub, withRead } = await import("../src/circles.mjs");
  const stub = circleStub(circleIndex(store._voices()), 1);
  assert.equal(stub.handle, "human-of-starforge", "the canonical hand is still the opener's handle");
  assert.equal(stub.speaker, "DARKO, of Starforge");
  assert.equal(stub.beside, "vex");
  // and `say { with: <handle> }` (someone's talk) lists their circles by the same stubs
  const talk = withRead(store._voices(), "human-of-starforge");
  assert.equal(talk.circles[0].speaker, "DARKO, of Starforge");
  assert.equal(talk.lines.find((l) => l.handle === "human-of-starforge").beside, "vex");
  const flat = withRead(store._voices(), "rei").lines.find((l) => l.handle === "rei");
  assert.equal(flat.reply_to, 1, "the reply edge is the stored one, untouched by presentation");
  assert.equal(talk.lines.find((l) => l.handle === "human-of-starforge").id, 1);
  assert.ok(room.voices.some((v) => v.handle === "human-of-starforge" && v.speaker));
});

test("until a town name is set: 'the human of <House>', no town_name and no pronouns; a profile written later is read next", async () => {
  useRegistryLoader(asRegistry);
  const { store, tick } = bench(AT);
  await store.say("human-of-lantern-row", "good evening", { standAs: "ivy" });
  tick(20_000);
  let line = (await store.hear("near")).voices.find((v) => v.handle === "human-of-lantern-row");
  assert.equal(line.speaker, "the human of Lantern Row");
  assert.equal(line.house, "Lantern Row");
  assert.ok(!("town_name" in line) && !("pronouns" in line));
  // the profile is set by its human: the next read says it, the same hand, the same line
  const changed = { households: { ...REGISTRY.households, "lantern-row": { ...REGISTRY.households["lantern-row"], human_profile: { town_name: "IVY-OF-THE-ROW" } } } };
  useRegistryLoader(() => Promise.resolve(changed));
  line = (await store.hear("near")).voices.find((v) => v.handle === "human-of-lantern-row");
  assert.equal(line.speaker, "IVY-OF-THE-ROW, of Lantern Row");
  assert.equal(line.handle, "human-of-lantern-row");
});

test("private fields are not used: no private name, no short line and no login reaches any line", async () => {
  useRegistryLoader(asRegistry);
  const { store, tick } = bench(AT);
  await store.say("human-of-starforge", "hello", { standAs: "vex" });
  tick(20_000);
  const out = JSON.stringify([await store.hear("near"), store.conversations({})]);
  assert.ok(!/Realname|a line"|only a line/.test(out), "the private `human` and the short line stay where they are");
});

test("no registry read: a human line carries NO presentation (never a guessed 'the human of'), but the shoulder is the record's and stays", async () => {
  useRegistryLoader(() => Promise.resolve(null));
  const { store, tick } = bench(AT);
  await store.say("human-of-starforge", "hello", { standAs: "vex" });
  tick(20_000);
  const line = (await store.hear("near")).voices.find((v) => v.handle === "human-of-starforge");
  assert.deepEqual(none(line), ["beside"]);
  assert.equal(line.beside, "vex");
  useRegistryLoader(() => Promise.reject(new Error("the store is down")));
  const again = (await store.hear("near")).voices.find((v) => v.handle === "human-of-starforge");
  assert.deepEqual(none(again), ["beside"], "an unreadable registry is the same: no line is invented");
});

test("the shoulder is the SAY's: kept in the log and read back, absent on a line that never had one, never the listener's standing_with", async () => {
  useRegistryLoader(asRegistry);
  const { store, tick, path } = bench(AT);
  await store.say("human-of-starforge", "from vex's side", { standAs: "vex" });
  tick(20_000);
  await store.say("human-of-starforge", "from rei's side", { standAs: "rei" });
  tick(20_000);
  const heard = (await store.hear("near", { standAs: "ivy" })).voices.filter((v) => v.handle === "human-of-starforge");
  assert.deepEqual(heard.map((v) => v.beside), ["vex", "rei"], "each say carries ITS OWN shoulder, not the latest, not the listener's");
  // an old line, written before the shoulder was kept, sits in the same log
  const old = { at: new Date(T0 - 5 * MIN).toISOString(), handle: "human-of-starforge", text: "an old say", x: 100, y: 100, place: "p", aboard: false };
  writeFileSync(path, `${JSON.stringify(old)}\n`, { flag: "a" });
  // a store rebuilt over that log: the new says keep their shoulders, the old one has none
  const { store: back, tick: later } = bench(AT, { log: path });
  later(2 * MIN); // the rebuilt store's clock starts at T0; the says were spoken up to T0 + 20s
  const lines = (await back.hear("near")).voices.filter((v) => v.handle === "human-of-starforge");
  const byText = Object.fromEntries(lines.map((v) => [v.said, v]));
  assert.equal(byText["from vex's side"].beside, "vex");
  assert.equal(byText["from rei's side"].beside, "rei");
  assert.equal(byText["an old say"].speaker, "DARKO, of Starforge", "an old line still reads the chosen name");
  assert.ok(!("beside" in byText["an old say"]), "an old line has NO beside: nothing fills it from today's default or position");
});

test("the carried earshot snapshot (a read worker's) holds the shoulder and the book, and a worker's heard line says both", async () => {
  useRegistryLoader(asRegistry);
  const { store, tick } = bench(AT);
  await store.say("human-of-starforge", "over the wall", { standAs: "vex" });
  tick(20_000);
  const snap = await store.earshotSnapshot();
  assert.equal(snap.audible[0].v.stood_with, "vex");
  assert.equal(snap.speakers.starforge.town_name, "DARKO");
  assert.ok(!JSON.stringify(snap.speakers).match(/Realname|a line/));
  // the worker: a cold book of its own, the main thread's handed over
  useRegistryLoader(() => Promise.resolve(null));
  const heard = await store.heardAt({ x: 108, y: 100 }, { snapshot: snap });
  assert.equal(heard[0].speaker, "DARKO, of Starforge");
  assert.equal(heard[0].beside, "vex");
  // and the glance's heard line keeps them, and only them, from the line it was handed
  const glance = heardBlock(heard);
  assert.equal(glance[0].from, "human-of-starforge");
  assert.equal(glance[0].speaker, "DARKO, of Starforge");
  assert.equal(glance[0].beside, "vex");
  assert.deepEqual(heardBlock([{ handle: "rei", said: "hi", ago: "now" }])[0], { from: "rei", standing: "resident", said: "hi", ago: "now" }, "a resident's heard line is exactly what it was");
  adoptSpeakerBook(null);
});

test("the record's own say decodes the shoulder: payload.stood_with rides, an old act has none", () => {
  const row = (extra = {}) => ({ id: 41, at: new Date(T0).toISOString(), actor: "human-of-starforge", action: "say", at_anchor: "a-mark", at_dx: 0, at_dy: 0,
    payload: { text: "recorded", place: "the quay", ...extra } });
  const centreOf = () => ({ x: 1, y: 2 });
  const withShoulder = talk.voiceOf(row({ stood_with: "vex" }), centreOf);
  assert.equal(withShoulder.voice.stood_with, "vex");
  assert.equal(withShoulder.voice.handle, "human-of-starforge", "the actor is the human's own hand, unrewritten");
  const old = talk.voiceOf(row(), centreOf);
  assert.ok(!("stood_with" in old.voice), "an old act has no shoulder and none is made");
  for (const bad of [7, "", null, { x: 1 }]) assert.ok(!("stood_with" in talk.voiceOf(row({ stood_with: bad }), centreOf).voice), `${JSON.stringify(bad)} is not a shoulder`);
});

test("the record's lines say it too: a conversation read from acts carries the name and the shoulder", async () => {
  useRegistryLoader(asRegistry);
  await speakerBook(); // the entry's own warm, as world2Serve does it
  const centreOf = () => ({ x: 100, y: 100 });
  const rows = [
    { id: 41, at: new Date(T0).toISOString(), actor: "human-of-starforge", action: "say", at_anchor: "m", at_dx: 0, at_dy: 0, payload: { text: "recorded", place: "q", stood_with: "vex" } },
    { id: 42, at: new Date(T0 + 20_000).toISOString(), actor: "rei", action: "say", at_anchor: "m", at_dx: 3, at_dy: 0, payload: { text: "answered", reply_to: 41 } },
  ];
  const { voices } = talk.voiceRecords(rows, { centreOf });
  const lines = (await import("../src/circles.mjs")).sayLines(voices);
  assert.equal(lines[0].speaker, "DARKO, of Starforge");
  assert.equal(lines[0].beside, "vex");
  assert.equal(lines[0].id, 41);
  assert.equal(lines[1].reply_to, 41);
  assert.deepEqual(none(lines[1]), []);
});

test("the book is one read, kept a moment: a burst of lines is not a burst of registry reads, and a failed read is asked once", async () => {
  let reads = 0;
  useRegistryLoader(() => { reads += 1; return Promise.resolve(REGISTRY); });
  await Promise.all([speakerBook(), speakerBook(), speakerBook()]);
  await speakerBook();
  assert.equal(reads, 1);
  assert.ok(heldSpeakerBook().has("starforge"));
  forgetSpeakerBook();
  let fails = 0;
  useRegistryLoader(() => { fails += 1; return Promise.reject(new Error("down")); });
  assert.equal(await speakerBook(), null);
  assert.equal(await speakerBook(), null);
  assert.equal(fails, 1);
  useRegistryLoader(null);
});

// ── the existing unplaced default, round-tripped through an explicit `with` ──────────────────────────────

test("the unplaced default round-trips: with nobody placed, the resident the office would pick is accepted explicitly; no other is", async () => {
  const { __humanStandForTest: stand } = await import("../src/world.mjs");
  const key = { household: "h", handles: new Set(["vex", "alaric"]) };
  // this environment has no world clone, so no resident of the key can be placed: the office would pick the FIRST handle itself
  const picked = await stand({ human: true }, key);
  assert.equal(picked.standAs, "vex", "the preview discloses the resident the office picked");
  const sent = await stand({ human: true, with: "vex" }, key);
  assert.ok(!sent.error, JSON.stringify(sent));
  assert.deepEqual(sent, picked, "the explicit with for that resident stands the human exactly as the omitted one did (the voice standpoint then supplies the Origin)");
  // not every unplaced resident has an Origin fallback: the second one is refused, as it always was
  const other = await stand({ human: true, with: "alaric" }, key);
  assert.equal(other.error, "bounce");
  assert.match(other.defect, /doesn't know where alaric stands/);
  // a foreign choice is still refused first, and the one-voice and agent-key refusals are as they were
  assert.match((await stand({ with: "stranger" }, key)).defect, /not one of your residents/);
  assert.equal((await stand({ handle: "vex", with: "vex" }, key)).defect, "one voice at a time");
  assert.equal((await stand({ with: "vex" }, { ...key, keyKind: "berth-upgraded" })).code, 403);
});

test("the Origin round-trip is only for the first handle, and only while nobody is placed", async () => {
  const world = await import("../src/world.mjs");
  const key = { household: "h", handles: new Set(["vex", "alaric", "moss"]) };
  assert.equal((await world.__humanStandForTest({ with: "moss" }, key)).error, "bounce", "a third unplaced resident is not the one the office would pick");
  // the placed rung is untouched: this environment cannot place anyone, so what it can say is that an unplaced first handle is the
  // ONLY unplaced acceptance; the placed-resident and aboard rungs live in the world's own say suites
});
