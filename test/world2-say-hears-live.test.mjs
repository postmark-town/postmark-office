// world2-say-hears-live.test.mjs — /world2/say hears the live say acts (POS-694).
//
// `/world2/say` read only the crossing-save's crystallized emission acts, the
// last of them written on 2026-08-27, so a say spoken since was silent there:
// 7,795 live `say` acts on prod (2026-10-19), none heard. The door now reads
// both eras, as /world2/conversations does, placing a live say by its witnessed
// line and hearing it at the say class's earshot for the say class's fade.
//
//   FALSIFIER  a live say at T is heard through /world2/say at T+1 min, at its
//              own place, and not by a point beyond the earshot
//   ERAS       a crystallized emission is still heard by its own stamps
//              and radius, beside the live say
//   UNPLACED   a live say whose anchor the store does not hold is left out and
//              counted, never placed at {0,0}
//
// The pool is dispatched on the SQL text, as world2-conversations-door.test.mjs's is.
//
// Run: node --test test/world2-say-hears-live.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://say-hears-live-test/none";
});
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

const { world2Serve, SAY_READ_SQL, SAY_LOOKBACK_MS } = await import("../src/world2-serve.mjs");
const { currentCrossing } = await import("../src/crossings.mjs");

const MARKS = [{ slug: "the-town/the-quay", status: "standing", geometry: { at: { x: 1390, y: 5665 }, extent: { w: 20, h: 20 } }, data: {} }];
const T = Date.parse("2026-10-19T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

const liveSay = (id, actor, anchor, atMs, text, dx = 0, dy = 0) => ({
  id, at: new Date(atMs), crossing: currentCrossing(atMs), actor, action: "say", at_anchor: anchor, at_dx: dx, at_dy: dy, payload: { text, place: null },
});
// The crossing-save's crystallized row, as live-reads.mjs § emissionOf reads it.
const emission = (id, actor, atMs, { x, y, ttlMin = 5, radiusM = 60, text }) => ({
  id, at: new Date(atMs), crossing: currentCrossing(atMs), actor, action: "legacy:emission",
  payload: { at: iso(atMs), payload: { class: "sound", x, y, text, spoken_by: actor, radius_m: radiusM, ttl_min: ttlMin,
    ttl_expires_at: iso(atMs + ttlMin * 60_000) } },
});

// The acts read answers as Postgres would: only SAY_READ_SQL's bounds ($2 crossing, $3 instant) are honoured,
// and an unbounded read (any other acts SQL) answers every voice act, so an unbounded door is seen. `asked`
// keeps what the door sent and what came back.
let asked = [];
const poolOf = (acts) => ({
  query: async (sql, params) => {
    if (/FROM acts/i.test(sql)) {
      const actions = params?.[0] ?? null;
      let rows = actions ? acts.filter((a) => actions.includes(a.action)) : acts;
      if (sql === SAY_READ_SQL) rows = rows.filter((a) => a.crossing >= params[1] && a.at.getTime() >= Date.parse(params[2]));
      asked.push({ sql, params, ids: rows.map((r) => r.id) });
      return { rows };
    }
    if (/FROM marks/i.test(sql)) return { rows: MARKS };
    return { rows: [] };
  },
});

const sayAt = (acts, atMs, near = null) => {
  const q = new URLSearchParams({ at: iso(atMs), ...(near ? { x: String(near.x), y: String(near.y) } : {}) });
  return world2Serve("/world2/say", q, { p: poolOf(acts) });
};

test("FALSIFIER: a live say at T is heard through /world2/say at T+1 min, where it was spoken", async () => {
  const acts = [liveSay(20001, "wright", "the-town/the-quay", T, "hello from the quay", 4, -3)];
  const r = await sayAt(acts, T + 60_000, { x: 1394, y: 5662 });
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 300));
  assert.equal(r.body.total_in_the_air, 1, "the live say is in the air a minute later");
  assert.equal(r.body.live_says, 1);
  assert.deepEqual(r.body.heard.map((h) => [h.props.text, h.x, h.y]), [["hello from the quay", 1394, 5662]]);
  assert.equal(r.body.heard[0].act_id, "20001");
  const far = await sayAt(acts, T + 60_000, { x: 1394 + 500, y: 5662 });
  assert.deepEqual(far.body.heard, [], "500 m off is beyond the say class's earshot");
  assert.ok(far.body.disclosed.some((d) => /^live sound:/.test(d)), "the disclosure no longer says there is no live sound");
});

test("ERAS: the crystallized emission is heard by its own stamps, beside the live say", async () => {
  const acts = [
    emission(10, "kinofire", T - 2 * 60_000, { x: 1390, y: 5660, ttlMin: 5, radiusM: 60, text: "from the crossing-save" }),
    liveSay(20001, "wright", "the-town/the-quay", T, "hello from the quay"),
  ];
  const r = await sayAt(acts, T + 60_000, { x: 1390, y: 5665 });
  assert.deepEqual(r.body.heard.map((h) => h.props.text).sort(), ["from the crossing-save", "hello from the quay"]);
  // How long each is heard is the hearing rule's (the row's TTL here; office#633's
  // settlement window on the train), held in world2-live-reads.test.mjs and
  // world2-say-hearing.test.mjs. What this holds is that the live say rides it too.
  const later = await sayAt(acts, T + 4 * 60_000, { x: 1390, y: 5665 });
  assert.ok(later.body.heard.some((h) => h.props.text === "hello from the quay"), "the live say is still heard four minutes on");
});

test("UNPLACED: a live say whose anchor the store does not hold is left out, counted, never placed at {0,0}", async () => {
  const acts = [liveSay(20002, "little-m-of-garrison", "vermillion/the-track-garage", T, "in a garage the store never held")];
  const r = await sayAt(acts, T + 60_000, { x: 0, y: 0 });
  assert.equal(r.code, 200);
  assert.equal(r.body.total_in_the_air, 0);
  assert.deepEqual(r.body.heard, []);
  assert.equal(r.body.unplaced_says.count, 1);
  assert.equal(r.body.unplaced_says.example.act_id, "20002");
});

test("BOUNDED: a say from two days ago is never read; the read is bounded in SQL at 13 hours", async () => {
  asked = [];
  const acts = [
    liveSay(19001, "kogane", "the-town/the-quay", T - 2 * 24 * 3600_000, "two days ago at the quay"),
    liveSay(20001, "wright", "the-town/the-quay", T, "hello from the quay"),
  ];
  const r = await sayAt(acts, T + 60_000, { x: 1390, y: 5665 });
  assert.equal(r.code, 200);
  const read = asked.find((a) => /FROM acts/i.test(a.sql));
  assert.equal(read.sql, SAY_READ_SQL, "the door reads voices through the one bounded statement");
  assert.equal(SAY_LOOKBACK_MS, 13 * 3600_000, "twelve hours to the next settlement, plus slack");
  assert.equal(read.params[2], iso(T + 60_000 - SAY_LOOKBACK_MS), "the instant's lower bound is the asked instant less 13 h");
  assert.equal(read.params[1], currentCrossing(T + 60_000 - SAY_LOOKBACK_MS) - 1, "the index range starts a crossing before the lookback's");
  assert.deepEqual(read.ids, [20001], "the two-day-old say was never read");
  assert.deepEqual(r.body.heard.map((h) => h.act_id), ["20001"]);
});
