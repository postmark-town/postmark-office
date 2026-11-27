// pos-1184-conversations-bound.test.mjs — the conversations record read is bounded to the room or circle asked (POS-1184).
//
// LAW (POS-1184, the sentinel's resident_5xx 2026-11-22): "conversationsFromRecord reads every voice act in the store on every call, with no
// crossing, time or room bound ... bound the read to what's asked: a `?room=` read to that room's own window ... a `?circle=` read to the say's
// room the same way". The say read beside it (SAY_READ_SQL) is bounded by `crossing >= $2 AND at >= $3`, which `acts_crossing_idx` serves.
//
//   FALSIFIER 1  a named room or circle reads only the window: the SQL carries the crossing and time bounds, and the pool sees no voice older
//                than the epoch the room sits in.
//   FALSIFIER 2  the answer for a room or circle inside the window is the same as when the pool hands back every voice in the store (the
//                unbounded read, which is what the door did before): the cut voices were never part of the answer.
//   FALSIFIER 3  a room carried across a settlement (CORE-97) still answers whole, by its id and by one of its circles, though its circle's
//                say sits in the later epoch.
//
// The pool is a fake that HONOURS the SQL's own bounds (crossing, instant, action, id), so a door that stopped sending them reads everything
// and the test says so. Invented speakers and places only.
//
//   node --test test/pos-1184-conversations-bound.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://pos-1184-test/none";
});
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

const { world2Serve, SAY_READ_SQL, SAY_AT_SQL } = await import("../src/world2-serve.mjs");
const { currentCrossing } = await import("../src/crossings.mjs");

const H = 3600_000, MIN = 60_000;
const S0 = Date.UTC(2026, 10, 19, 6, 0, 0);
const EDGES = [S0, S0 + 12 * H, S0 + 24 * H, S0 + 36 * H]; // four published settlements; S3 is the newest
const [, S1, S2, S3] = EDGES;
const NOW = S3 + 3 * H;

// five places, far apart, so rooms in one epoch never chain into each other
const PLACES = ["quay", "hill", "mill", "weir", "tower"];
const MARKS = PLACES.map((n, i) => ({ slug: `the-town/${n}`, status: "standing", geometry: { at: { x: 1000 + i * 5000, y: 1000 }, extent: { w: 20, h: 20 } }, data: {} }));

let nextId = 100;
const row = (place, handle, atMs, text, replyTo = null) => ({
  id: nextId++, at: new Date(atMs), crossing: currentCrossing(atMs), actor: handle, action: "say",
  at_anchor: `the-town/${place}`, at_dx: 0, at_dy: 0, payload: { text, ...(replyTo != null ? { reply_to: replyTo } : {}) },
});
const roomId = (r) => `t${r.at.getTime()}-${r.actor}`;

// epoch 0: room A (quay). epoch 1: room B (hill) and room D (mill), which starts at S2 - 30 min and is carried across S2 by a say 20 min after it.
// epoch 2: room C (weir), founded at S2 + 3 h. epoch 3: room E (tower), live now.
const A1 = row("quay", "ada-vale", S0 + 1 * H, "A one");
const A2 = row("quay", "bram-oke", S0 + 90 * MIN, "A two", A1.id);
const B1 = row("hill", "cora-finch", S1 + 2 * H, "B one");
const B2 = row("hill", "dov-ash", S1 + 150 * MIN, "B two", B1.id);
const D1 = row("mill", "eli-marsh", S2 - 30 * MIN, "D one");
const D2 = row("mill", "fen-rowe", S2 - 20 * MIN, "D two", D1.id);
const D3 = row("mill", "gwen-tarn", S2 + 20 * MIN, "D carried", D2.id);
const C1 = row("weir", "hal-pike", S2 + 3 * H, "C one");
const C2 = row("weir", "ivy-croft", S2 + 190 * MIN, "C two", C1.id);
const E1 = row("tower", "jun-lark", S3 + 1 * H, "E one");
const E2 = row("tower", "kit-moss", S3 + 80 * MIN, "E two", E1.id);
const ACTS = [A1, A2, B1, B2, D1, D2, D3, C1, C2, E1, E2];

/** A pool that honours the bounds the door sends. `mode: "ignore"` hands every voice back whatever the bounds say (the old, unbounded read). */
function poolOf({ mode = "honour" } = {}) {
  const seen = [];
  const p = {
    seen,
    query: async (sql, params = []) => {
      if (/FROM marks/i.test(sql)) return { rows: MARKS };
      if (sql === SAY_AT_SQL) {
        const r = ACTS.find((a) => a.id === params[0] && a.action === "say");
        return { rows: r ? [{ at: r.at }] : [] };
      }
      if (/FROM acts/i.test(sql) && /action = ANY/i.test(sql)) {
        const bounded = /crossing >= \$2/.test(sql) && /at >= \$3/.test(sql);
        const rows = ACTS.filter((a) => params[0].includes(a.action)
          && (mode === "ignore" || !bounded || (a.crossing >= params[1] && a.at.getTime() >= Date.parse(params[2]))))
          .sort((a, b) => a.at - b.at || a.id - b.id);
        seen.push({ sql, bounded, params, rows });
        return { rows };
      }
      return { rows: [] };
    },
  };
  return p;
}

const ask = (query, p) => world2Serve("/world2/conversations", new URLSearchParams(`at=${new Date(NOW).toISOString()}&${query}`),
  { p, settlements: () => EDGES, hearingWindow: () => ({ since: S3 }) });
// the whole-store counts are the one thing a window changes (they count what was read); the answer is everything else
const answerOf = (body) => { const { voices, eras, disclosed, ...rest } = body; return rest; };

test("FALSIFIER 1, room: the read carries the crossing and time bounds, and the pool sees nothing older than the room's epoch", async () => {
  const p = poolOf();
  const r = await ask(`room=${roomId(C1)}`, p);
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 300));
  assert.equal(r.body.find.history, "complete");
  assert.equal(r.body.find.room.id, roomId(C1));
  assert.equal(p.seen.length, 1, "one voice read for a room founded in its epoch");
  assert.equal(p.seen[0].bounded, true, `the SQL carries both bounds: ${p.seen[0].sql}`);
  assert.equal(p.seen[0].sql, SAY_READ_SQL, "the same bounded read the say door uses, index and all");
  assert.equal(p.seen[0].params[2], new Date(S2).toISOString(), "from the edge of the epoch holding the room's start");
  assert.equal(p.seen[0].params[1], currentCrossing(S2) - 1);
  const oldest = Math.min(...p.seen[0].rows.map((x) => x.at.getTime()));
  assert.ok(oldest >= S2, `the pool saw no voice before the epoch: oldest ${new Date(oldest).toISOString()}`);
  assert.ok(p.seen[0].rows.length < ACTS.length, `${p.seen[0].rows.length} of ${ACTS.length} voices read`);
});

test("FALSIFIER 1, circle: the say is found by id, then the read is bounded the same way", async () => {
  const p = poolOf();
  const r = await ask(`circle=${B1.id}`, p);
  assert.equal(r.code, 200);
  assert.equal(r.body.find.history, "complete");
  assert.ok(p.seen.every((s) => s.bounded), "no read of the whole store");
  const oldest = Math.min(...p.seen.flatMap((s) => s.rows.map((x) => x.at.getTime())));
  assert.ok(oldest >= S1, "nothing before the epoch of the circle's say");
});

test("control: a read with none of room, circle or before stays whole (this hotfix does not change it), so the bound test can tell the two apart", async () => {
  const p = poolOf();
  const r = await ask("closed=50", p);
  assert.equal(r.code, 200);
  assert.equal(p.seen[0].bounded, false);
  assert.equal(p.seen[0].rows.length, ACTS.length);
});

test("FALSIFIER 2: every room and circle answers the same as when every voice in the store is handed back", async () => {
  const queries = [A1, B1, D1, C1, E1].map((x) => `room=${roomId(x)}`)
    .concat(ACTS.map((x) => `circle=${x.id}`), [`room=t${S2 + 1000}-nobody-here`, "circle=999999"]);
  for (const q of queries) {
    const bounded = await ask(q, poolOf());
    const whole = await ask(q, poolOf({ mode: "ignore" }));
    assert.equal(bounded.code, whole.code, q);
    // A and A's circles sit before the oldest published edge's neighbours but still inside the record's four edges: they answer either way.
    assert.deepEqual(answerOf(bounded.body), answerOf(whole.body), `${q}: the answer is the same with or without the voices outside the window`);
  }
});

test("FALSIFIER 2, control: the comparison can fail (a window that cut a voice of the room would move the answer)", async () => {
  const whole = await ask(`room=${roomId(D1)}`, poolOf({ mode: "ignore" }));
  const cut = await ask(`room=${roomId(D1)}`, { query: async (sql, params) => {
    const r = await poolOf({ mode: "ignore" }).query(sql, params);
    return /action = ANY/.test(sql) ? { rows: r.rows.filter((x) => x.id !== D3.id) } : r;
  } });
  assert.notDeepEqual(answerOf(cut.body), answerOf(whole.body), "dropping the carried say changes the room");
});

test("FALSIFIER 3, room: a room carried across a settlement answers complete, with its say after the edge", async () => {
  const p = poolOf();
  const r = await ask(`room=${roomId(D1)}`, p);
  assert.equal(r.code, 200);
  assert.equal(r.body.find.history, "complete");
  assert.equal(r.body.find.room.id, roomId(D1));
  assert.equal(r.body.find.room.voice_count, 3, "all three says, the third spoken after the edge");
  assert.equal(r.body.find.room.latest, new Date(D3.at).toISOString());
  assert.deepEqual(r.body.find.room.participants, ["eli-marsh", "fen-rowe", "gwen-tarn"]);
  const whole = await ask(`room=${roomId(D1)}`, poolOf({ mode: "ignore" }));
  assert.deepEqual(answerOf(r.body), answerOf(whole.body));
  assert.equal(p.seen[0].params[2], new Date(S1).toISOString(), "read from the epoch the room STARTED in, so its voice past the edge comes whole");
});

test("FALSIFIER 3, circle: a circle whose say sits in the epoch the room was carried INTO still finds the room's root, one epoch back", async () => {
  const p = poolOf();
  const r = await ask(`circle=${D3.id}`, p);
  assert.equal(r.code, 200);
  assert.equal(r.body.find.history, "complete");
  assert.equal(r.body.find.room.id, roomId(D1), "the room's id is its first say's, in the earlier epoch");
  assert.deepEqual(p.seen.map((s) => s.params[2]), [new Date(S2).toISOString(), new Date(S1).toISOString()], "it stepped back exactly one epoch, no further");
  assert.ok(p.seen.every((s) => s.bounded));
  const whole = await ask(`circle=${D3.id}`, poolOf({ mode: "ignore" }));
  assert.deepEqual(answerOf(r.body), answerOf(whole.body));
});

test("a circle in a room founded in its own epoch is one read, not two", async () => {
  const p = poolOf();
  await ask(`circle=${C2.id}`, p);
  assert.equal(p.seen.length, 1);
});
