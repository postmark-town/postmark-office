// world2-say-hearing.test.mjs — the store's say read keeps the ear's window (POS-693).
//
// Everything said within earshot stays hearable until the next settlement
// (POS-226, office#242, w41). Every saved say also carries the sound class's
// `ttl_expires_at`, five minutes after it was spoken, and `/world2/say` used to
// answer through that stamp: cut over as it stood, hearing would have dropped
// back to five minutes. The door now asks the live ear's own reader
// (hearing-window.mjs), so the falsifier is a say at T heard at T+6h through
// `/world2/say`, and gone once the next settlement is published.
//   node --test test/world2-say-hearing.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://say-hearing-test/none";
});
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

const { world2Serve } = await import("../src/world2-serve.mjs");
const { createHearingWindow } = await import("../src/hearing-window.mjs");

const H = 3600_000;
const S1 = Date.parse("2026-10-19T06:01:41Z");      // the sweep the say is spoken after
const S2 = Date.parse("2026-10-19T18:00:52Z");      // the next one
const T = S1 + 2 * H;
const iso = (ms) => new Date(ms).toISOString();

// A crossing-saved say, stamped the way save-emissions.mjs stamps it: the sound
// class's hearing_ttl_min, five minutes.
const sayAct = (id, bornMs, actor, x = 0, y = 0) => ({
  id, at: new Date(bornMs), actor, action: "legacy:emission",
  payload: { at: iso(bornMs), type: "emission", id: `sound:${bornMs}:${actor}`, actor,
    payload: { class: "sound", x, y, text: `${actor} speaks`, spoken_by: actor, human: false, aboard: false, place: null,
      ttl_min: 5, radius_m: 60, class_version: 2, ttl_expires_at: iso(bornMs + 5 * 60_000) } },
});
const ACTS = [
  sayAct(1, S1 - H, "before-the-sweep"),
  sayAct(2, T, "little-bird"),
  sayAct(3, T + 30 * 60_000, "far-off", 500, 0),
];
const pool = { query: async (sql) => (/FROM acts/i.test(sql) ? { rows: ACTS } : { rows: [] }) };

// The live ear's reader over a world main whose sweeps are set by hand.
function reader() {
  const sweeps = [S1, S1 - 12 * H];
  const h = createHearingWindow({ repo: "unused",
    published: async () => sweeps[0], history: async () => [...sweeps], blessed: async () => null });
  return { h, publish: (ms) => sweeps.unshift(ms) };
}
const say = (h, atMs, q = "x=0&y=0") =>
  world2Serve("/world2/say", new URLSearchParams(`at=${iso(atMs)}&${q}`), { p: pool, hearingWindow: (at) => h.read(at) });
const heard = (r) => r.body.heard.map((e) => e.source);

test("FALSIFIER: a say at T is heard at T+6h through /world2/say, past its stamped five minutes", async () => {
  const { h } = reader();
  await h.refresh();
  const r = await say(h, T + 6 * H);
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 300));
  assert.deepEqual(heard(r), ["little-bird"], "heard six hours on; the say before the sweep is not, and the far one is out of earshot");
  assert.equal(r.body.hearable_since, iso(S1));
  assert.equal(r.body.hearing_window_disclosed, undefined);
});

test("FALSIFIER: at the next settlement it is gone", async () => {
  const { h, publish } = reader();
  await h.refresh();
  publish(S2);
  await h.refresh();
  const r = await say(h, S2 + 60_000);
  assert.deepEqual(heard(r), [], "the window opened again at the next sweep");
  assert.equal(r.body.hearable_since, iso(S2));
  assert.equal(r.body.total_in_the_air, 0);
});

test("an instant asked after the next sweep is published still opens at its own settlement", async () => {
  const { h, publish } = reader();
  publish(S2);
  await h.refresh();
  const r = await say(h, T + 6 * H);
  assert.deepEqual(heard(r), ["little-bird"]);
  assert.equal(r.body.hearable_since, iso(S1));
});

test("one window, every ear: the door's answer is the live ear's own reader, never a second copy", async () => {
  const { h } = reader();
  await h.refresh();
  const asked = [];
  const r = await world2Serve("/world2/say", new URLSearchParams(`at=${iso(T + H)}`),
    { p: pool, hearingWindow: (at) => { asked.push(at); return h.read(at); } });
  assert.deepEqual(asked, [T + H], "asked once, at the instant the read is for");
  assert.deepEqual(r.body.emissions.map((e) => e.source), ["little-bird", "far-off"]);
});

test("a window the reader cannot give is said, and nothing before the instant is cut", async () => {
  const r = await world2Serve("/world2/say", new URLSearchParams(`at=${iso(T + H)}`), { p: pool, hearingWindow: () => null });
  assert.equal(r.body.hearable_since, null);
  assert.match(r.body.hearing_window_disclosed, /could not be read/);
  assert.deepEqual(r.body.emissions.map((e) => e.source), ["before-the-sweep", "little-bird", "far-off"]);
});
