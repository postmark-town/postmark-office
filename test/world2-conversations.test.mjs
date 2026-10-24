// The pure half of the conversations port: the row→voice mapping, its refusals,
// and the say dials read off `marks`. No database — everything this file
// exercises is pure with respect to Postgres, and the rows are shaped the way
// `pg` hands them over (jsonb as objects, timestamptz as Date).
//
// Each case asserts a quoted sentence of law.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  voiceOf, voiceRecords, sayDials, sayDialsDisclosure, composeAnchor,
  conversationsOf, clusterVoices, SAY_DIAL_SPEC,
} from "../world2/tools/conversations.mjs";

const emission = (over = {}) => ({
  id: 1, at: new Date("2026-08-20T10:00:00Z"), actor: "wright", action: "legacy:emission",
  payload: { at: "2026-08-20T10:00:00.000Z", type: "emission", actor: "wright",
    payload: { class: "sound", x: 100, y: 200, text: "hello", spoken_by: "wright",
      place: "the quay", aboard: false, ...over } },
});

const say = (over = {}) => ({
  id: 2, at: new Date("2026-08-28T18:00:00Z"), actor: "wright", action: "say",
  at_anchor: "the-town/the-quay", at_dx: 12, at_dy: -7,
  payload: { text: "spoken here", place: "the quay" }, ...over,
});

const quayCentre = () => ({ x: 1390, y: 5665 });

// ── the crystallized era ────────────────────────────────────────────────────

test("a sound emission is a voice, and its point is the one the crossing log froze", () => {
  const r = voiceOf(emission());
  assert.equal(r.era, "crystallized");
  assert.deepEqual({ handle: r.voice.handle, x: r.voice.x, y: r.voice.y, text: r.voice.text },
    { handle: "wright", x: 100, y: 200, text: "hello" });
});

test("the SPEAKER is `spoken_by`, not the act's actor — the human lane lends the place, never the mouth", () => {
  const row = emission({ spoken_by: "human-of-keith" });
  assert.equal(voiceOf(row).voice.handle, "human-of-keith");
});

test("a NON-sound emission is skipped, not refused — a row this read is not about is a different fact from one it cannot understand", () => {
  const r = voiceOf(emission({ class: "light" }));
  assert.equal(r.skip, true);
  assert.equal(r.refused, undefined);
});

test("a sound emission missing its point is REFUSED — the record cannot say where it was said", () => {
  const r = voiceOf(emission({ x: undefined }));
  assert.equal(r.refused, true);
  assert.match(r.reason, /missing handle\/at\/x\/y/);
});

// ── the live era, and the witnessed line ────────────────────────────────────

test("a live say composes its point from the WITNESSED LINE — anchor plus offset, never a bare x,y", () => {
  const r = voiceOf(say(), () => quayCentre());
  assert.equal(r.era, "live");
  assert.deepEqual({ x: r.voice.x, y: r.voice.y }, { x: 1402, y: 5658 });
});

test("a live say whose anchor does not resolve is UNPLACED, never placed at {0,0}, and never refused (#351)", () => {
  // "{x:0,y:0} is the Origin, a real place somebody could be standing, and
  //  a deriver that substitutes it for 'unknown' is the exact quiet substitution
  //  the customs-house law forbids."
  const r = voiceOf(say(), () => null);
  assert.equal(r.unplaced, true);
  assert.equal(r.voice, undefined, "no point is made up for it");
  assert.equal(r.refused, undefined, "the act is understood; only its place is lost");
  assert.deepEqual({ act_id: r.act_id, anchor: r.anchor }, { act_id: "2", anchor: "the-town/the-quay" });
  assert.match(r.reason, /does not compose to a point/);
});

test("voiceRecords answers AROUND an unplaced say and returns it, where an unreadable act still throws", () => {
  const { voices, unplaced } = voiceRecords([emission(), say()], { centreOf: () => null });
  assert.equal(voices.length, 1);
  assert.deepEqual(unplaced.map((u) => u.act_id), ["2"]);
});

test("composeAnchor checks `dx == null` FIRST — Number(null) is 0, not NaN", () => {
  assert.equal(composeAnchor({ anchor: "world", dx: null, dy: null }), null);
  assert.deepEqual(composeAnchor({ anchor: "world", dx: 4, dy: 5 }), { x: 4, y: 5 });
});

test("an act no era explains stops the read — a dropped row would be a conversation nobody knows to look for", () => {
  assert.throws(() => voiceRecords([{ id: 9, action: "walk", payload: {} }]),
    /match no known era/);
});

test("the era rides the record, because the equality falsifier scopes per era", () => {
  const { voices, eras } = voiceRecords([emission(), say()], { centreOf: () => quayCentre() });
  assert.deepEqual(eras, { crystallized: 1, live: 1 });
  assert.deepEqual(voices.map((v) => v.era), ["crystallized", "live"]);
});

// ── the dials ───────────────────────────────────────────────────────────────

const dialMark = (slot, value) => ({ slug: `the-town/${slot}`, data: { slot, value, _parent_is_law: "the-town/say" } });

test("the dials are the say class's PREDICATE CHILDREN, read off `marks`", () => {
  const d = sayDials([dialMark("earshot_m", "90"), dialMark("fade_min", "7")]);
  assert.equal(d.earshot_m.value, 90);
  assert.equal(d.earshot_m.source, "record");
  assert.equal(d.fade_min.ms, 7 * 60 * 1000);
});

test("a dial with no mark FALLS BACK and SAYS SO — a silent fallback is indistinguishable from a good read", () => {
  const d = sayDials([]);
  assert.equal(d.earshot_m.value, SAY_DIAL_SPEC.earshot_m[0]);
  assert.equal(d.earshot_m.read, false);
  assert.match(sayDialsDisclosure(d), /standing on built-in fallbacks/);
});

test("silence is the good case: every dial read from the record discloses nothing", () => {
  const rows = Object.keys(SAY_DIAL_SPEC).map((slot) => dialMark(slot, "3"));
  assert.equal(sayDialsDisclosure(sayDials(rows)), null);
});

test("a predicated mark under a DIFFERENT class is not a say dial", () => {
  const stray = { slug: "the-town/pace", data: { slot: "earshot_m", value: "9999", _parent_is_law: "the-town/walk" } };
  assert.equal(sayDials([stray]).earshot_m.read, false);
});

// ── the record's clock, not the ear's ───────────────────────────────────────

const v = (at, x, aboard = false) => ({ handle: "a", text: "x", at, x, y: 0, place: null, aboard });

test("the RECORD has no lull: a long silence inside a settlement is one thread, and the settlement splits it (POS-779)", () => {
  const hour = 60 * 60 * 1000;
  const voices = [v(0, 0), v(5 * hour, 0)];
  const same = conversationsOf(voices, { now: 6 * hour, earshotM: 60, boundaries: [-hour], fadeMs: 5 * 60 * 1000 });
  assert.equal(same.live.length + same.closed.length, 1, "one conversation across five hours of silence");
  assert.equal("close_minutes" in same, false);
  const split = conversationsOf(voices, { now: 6 * hour, earshotM: 60, boundaries: [-hour, 2 * hour], fadeMs: 5 * 60 * 1000 });
  assert.equal(split.live.length, 1, "the newest settlement's thread is live");
  assert.equal(split.closed.length, 1, "the earlier settlement's is closed");
  assert.equal(split.settlement_since, new Date(2 * hour).toISOString());
  const unknown = conversationsOf(voices, { now: 6 * hour, earshotM: 60, boundaries: [], fadeMs: 5 * 60 * 1000 });
  assert.equal(unknown.live.length, 1);
  assert.match(unknown.settlement_disclosed, /ONE settlement/);
});

test("boundaries given, the lull (fadeMs) is ignored; absent, the lull path is the sound class's own", () => {
  const voices = [v(0, 0), v(40 * 60 * 1000, 0)];
  assert.equal(clusterVoices(voices, { earshotM: 60, fadeMs: 30 * 60 * 1000, boundaries: [] }).length, 1);
  assert.equal(clusterVoices(voices, { earshotM: 60, fadeMs: 30 * 60 * 1000 }).length, 2);
});

test("two aboard voices are ONE room however far the water moved", () => {
  const far = [v(0, 0, true), v(1000, 100000, true)];
  assert.equal(clusterVoices(far, { earshotM: 60, boundaries: [] }).length, 1);
  const grounded = far.map((x) => ({ ...x, aboard: false }));
  assert.equal(clusterVoices(grounded, { earshotM: 60, boundaries: [] }).length, 2);
});

test("a cluster from a finished settlement never reopens", () => {
  const voices = [v(0, 0), v(2000, 0)];
  assert.equal(clusterVoices(voices, { earshotM: 60, boundaries: [1000] }).length, 2);
  assert.equal(clusterVoices(voices, { earshotM: 60, boundaries: [5000] }).length, 1);
});
