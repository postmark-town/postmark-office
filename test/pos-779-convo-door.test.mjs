// pos-779-convo-door.test.mjs — `GET /world/conversations` read from the durable record (world2/tools/convo-door.mjs, POS-779).
//
// The door is exercised as the office wires it: the REAL `spokenInRoom` guard, a real Postgres made by the tree's own
// harness, the reader's published sweeps handed in as `settlements()` (the real reader is a `git log` over the world
// clone; test/pos-779-conversations-http.test.mjs covers that road end to end). Every row is INVENTED.
//
// What is pinned: the declared fields and no others; a thread read to its first real voice past what RAM could hold
// (the show-earlier walk); older history left ungrouped rather than grouped as the start of the record; no private row
// moving a public list, a generation, a budget or a bridge; one generic posture for a wrong anchor; the lean summary;
// a cut list reachable through its cursor exactly once; an unreadable epoch or moved edges as unavailable, never short.
//
//   node --test test/pos-779-convo-door.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startStore } from "./helpers/embedded-store.mjs";
import { spokenInRoom } from "../src/world2-serve.mjs";
import { createConversationsDoor, DOOR } from "../world2/tools/convo-door.mjs";
import { createEpochMemo } from "../world2/tools/convo-memo.mjs";

const require = createRequire(import.meta.url);
const pg = require("pg");

const H = 3600_000;
const E1 = Date.parse("2026-06-01T06:00:00.000Z"), E2 = E1 + 12 * H, E3 = E2 + 12 * H;
const NOW = E3 + 5 * H;
const iso = (ms) => new Date(ms).toISOString();

const stores = [];
async function world(name) {
  let s;
  try { s = await startStore({ db: name }); } catch (e) { return { skip: String(e.message ?? e).slice(0, 120) }; }
  if (s.skip) return { skip: s.skip };
  stores.push(s);
  const api = await s.connect("office_api");
  const owner = await s.connect("world2_owner");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 4 });
  pool.on("error", () => {});
  const insert = `INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
                  VALUES ($1::timestamptz, 0, $2, 'say', 'voice', $3::jsonb, 'world', $4, $5) RETURNING id::text`;
  const say = async (at, actor, x, y, payload = {}) =>
    (await api.query(insert, [iso(at), actor, JSON.stringify({ text: `${actor}@${at}`, place: "the quay", aboard: false, ...payload }), x, y])).rows[0].id;
  const manySays = (rows) => api.query(
    `INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
     SELECT (r->>'at')::timestamptz, 0, r->>'actor', 'say', 'voice', r->'payload', 'world', (r->>'x')::float, (r->>'y')::float
       FROM jsonb_array_elements($1::jsonb) AS r ORDER BY (r->>'at')::timestamptz`, [JSON.stringify(rows)]);
  return { s, api, owner, pool, say, manySays };
}
after(async () => { for (const s of stores) { await s.stop?.().catch(() => {}); } });

const doorOver = (w, over = {}) => createConversationsDoor({
  pool: w.pool, isPrivate: spokenInRoom, memo: createEpochMemo(),
  settlements: () => [E1, E2, E3],
  hearingWindow: (ms) => ({ since: [E3, E2, E1].find((e) => e <= ms) ?? null }),
  now: () => NOW,
  ...over,
});
const q = (o = {}) => new URLSearchParams(o);
const ids = (t) => t.voices.map((v) => v.act_id);

// one fixture shared by the shape, walk, history and anchor tests
let fx = null;
async function fixture() {
  if (fx) return fx;
  const w = await world("convo_door_main");
  if (w.skip) return (fx = w);
  const rows = [];
  const add = (at, actor, x, y) => rows.push({ at: iso(at), actor, x, y, payload: { text: `${actor} ${at}`, place: "the quay", aboard: false } });
  // older history, before the oldest edge this office has read: must never be grouped
  for (let i = 0; i < 5; i++) add(E1 - 2 * H + i * 60_000, `old${i}`, 0, 0);
  // epoch A [E1,E2): two places
  for (let i = 0; i < 3; i++) add(E1 + H + i * 60_000, `a${i}`, 0, 0);
  for (let i = 0; i < 2; i++) add(E1 + 2 * H + i * 60_000, `b${i}`, 1000, 0);
  // epoch B [E2,E3): one place, twenty voices
  for (let i = 0; i < 20; i++) add(E2 + H + i * 60_000, `c${i % 4}`, 0, 0);
  // epoch C (open): a place with 2,500 voices (more than RAM's 2,000), and two small ones
  for (let i = 0; i < 2500; i++) add(E3 + 60_000 + i * 1000, `q${i % 7}`, 5000, 5000);
  for (let i = 0; i < 4; i++) add(E3 + 2 * H + i * 60_000, `r${i}`, 2000, 0);
  for (let i = 0; i < 2; i++) add(E3 + 3 * H + i * 60_000, `s${i}`, -3000, 0);
  await w.manySays(rows);
  return (fx = w);
}

test("the page: live is the newest settlement's threads, closed the earlier ones', newest first, with the declared fields and no others", async (t) => {
  const w = await fixture();
  if (w.skip) return t.skip(w.skip);
  const door = doorOver(w);
  const r = await door.handle(q());
  assert.equal(r.code, 200);
  const b = r.body;
  assert.deepEqual(Object.keys(b).sort(), ["close_minutes", "closed", "earshot_m", "fade_minutes", "hearable_since", "list", "live", "next_threads", "now"].sort());
  assert.equal(b.close_minutes, null);
  assert.equal(b.now, iso(NOW));
  assert.equal(b.hearable_since, iso(E3));
  assert.equal(b.earshot_m, 60);
  assert.equal(b.live.length, 3, "the 2,500-voice place and the two small ones");
  assert.deepEqual(b.live.map((x) => x.voice_count).sort((a, c) => a - c), [2, 4, 2500]);
  // newest first by latest voice
  const lat = b.live.map((x) => Date.parse(x.latest));
  assert.deepEqual(lat, [...lat].sort((a, c) => c - a));
  assert.deepEqual(b.closed.map((x) => x.voice_count), [20, 2, 3], "epoch B's thread, then epoch A's two, newest first");
  assert.ok(b.live.every((x) => x.live === true) && b.closed.every((x) => x.live === false));
  const big = b.live.find((x) => x.voice_count === 2500);
  assert.equal(big.voices.length, 80, "the established default voiceCap, not 200");
  assert.equal(big.epoch.since, E3); assert.equal(big.epoch.next, null);
  assert.match(big.thread_of, /^[1-9][0-9]*$/);
  assert.match(big.generation, /^[0-9a-f]{32}$/);
  assert.match(big.earlier, /^\d+:\d+$/);
  assert.ok(big.voices.every((v) => /^[1-9][0-9]*$/.test(v.act_id) && Number.isFinite(v.at_ms)));
  for (const k of ["settlement_since", "close_minutes_deprecated", "settlement_disclosed", "incomplete_legacy", "source", "js_private_dropped", "measured"]) {
    assert.equal(JSON.stringify(b).includes(`"${k}"`), false, `${k} is not a declared public field`);
  }
  assert.equal(b.list.history_from, iso(E1));
  assert.equal(b.list.complete, true);
  assert.deepEqual(b.next_threads, { live: null, closed: null });
});

test("SHOW EARLIER reaches the first real voice of a thread longer than RAM holds: every line once, in order, no seam lost", async (t) => {
  const w = await fixture();
  if (w.skip) return t.skip(w.skip);
  const door = doorOver(w);
  const page = (await door.handle(q())).body.live.find((x) => x.voice_count === 2500);
  const got = [...ids(page)];
  let cursor = page.earlier, pages = 0;
  while (cursor) {
    const r = await door.handle(q({ thread_of: page.thread_of, before: cursor, generation: page.generation, since: String(E3), next: "open", limit: "200" }));
    assert.equal(r.code, 200);
    assert.equal(r.body.thread_of, page.thread_of);
    assert.ok(r.body.voices.length <= 200 && r.body.voices.length > 0);
    got.unshift(...r.body.voices.map((v) => v.act_id));
    cursor = r.body.earlier; pages += 1;
    assert.ok(pages < 20, "the walk ends");
  }
  assert.equal(got.length, 2500);
  assert.equal(new Set(got).size, 2500, "no line twice");
  const { rows } = await w.api.query(`SELECT id::text FROM acts WHERE actor LIKE 'q%' AND at >= $1 ORDER BY at, id`, [iso(E3)]);
  assert.deepEqual(got, rows.map((r) => r.id), "exactly the thread's lines, oldest first");
  assert.equal(page.thread_of, rows[0].id, "the anchor is the first real voice");
});

test("history older than the oldest settlement read is NOT grouped, and the page says where grouping begins", async (t) => {
  const w = await fixture();
  if (w.skip) return t.skip(w.skip);
  const r = await doorOver(w).handle(q({ closed: "100" }));
  const all = [...r.body.live, ...r.body.closed];
  assert.ok(all.every((x) => Date.parse(x.started) >= E1), "no thread begins before the oldest edge");
  const old = (await w.api.query(`SELECT id::text FROM acts WHERE actor LIKE 'old%'`)).rows.map((x) => x.id);
  assert.equal(old.length, 5);
  assert.ok(all.every((x) => !ids(x).some((i) => old.includes(i)) && !old.includes(x.thread_of)));
  assert.equal(r.body.list.history_from, iso(E1));
});

test("no settlement known: unavailable, with one generic reason, never a page drawn as one epoch", async (t) => {
  const w = await fixture();
  if (w.skip) return t.skip(w.skip);
  const r = await doorOver(w, { settlements: () => [], hearingWindow: () => null }).handle(q());
  assert.equal(r.code, 503);
  assert.equal(r.body.error, "bounce");
  assert.match(r.body.hint, /settlements-unknown/);
  assert.equal(r.body.live, undefined);
});

test("a wrong, private, missing or other-settlement anchor is ONE posture; a changed generation regenerates instead of erroring", async (t) => {
  const w = await fixture();
  if (w.skip) return t.skip(w.skip);
  const door = doorOver(w);
  const big = (await door.handle(q())).body.live.find((x) => x.voice_count === 2500);
  const privateId = await w.say(E3 + H, "pq", 5000, 5000, { room: "cellar" });
  const otherEpoch = (await w.api.query(`SELECT id::text FROM acts WHERE actor = 'a0'`)).rows[0].id;
  const ask = (thread_of, over = {}) => door.handle(q({ thread_of, before: big.earlier, generation: big.generation, since: String(E3), next: "open", ...over }));
  const probes = [await ask(privateId), await ask("999999999999"), await ask(otherEpoch), await ask("1"), await ask(big.thread_of, { since: String(E1 + 1) })];
  for (const p of probes) { assert.equal(p.code, 404); assert.deepEqual(p.body, probes[0].body, "the same answer for every reason"); }
  const moved = await ask(big.thread_of, { generation: "f".repeat(32) });
  assert.equal(moved.code, 200);
  assert.equal(moved.body.regenerated, true);
  assert.equal(moved.body.thread.generation, big.generation, "the current generation, and the newest page of the thread");
  assert.equal(moved.body.thread.voices.length, 80);
});

test("the request is validated: bounded types, lengths and ranges, 422 with the field named", async (t) => {
  const w = await fixture();
  if (w.skip) return t.skip(w.skip);
  const door = doorOver(w);
  const big = (await door.handle(q())).body.live.find((x) => x.voice_count === 2500);
  const earlier = { thread_of: big.thread_of, before: big.earlier, generation: big.generation, since: String(E3), next: "open" };
  const bads = [
    [{ voices: "201" }, "voices"], [{ voices: "-1" }, "voices"], [{ voices: "x" }, "voices"], [{ closed: "0" }, "closed"], [{ closed: "101" }, "closed"],
    [{ limit: "0" }, "limit"], [{ limit: "101" }, "limit"], [{ next_threads: "garbage" }, "next_threads"],
    [{ ...earlier, limit: "201" }, "limit"], [{ ...earlier, before: "12:0" }, "before"], [{ ...earlier, generation: "zz" }, "generation"],
    [{ ...earlier, thread_of: "0" }, "thread_of"], [{ ...earlier, since: "abc" }, "since"], [{ ...earlier, next: "1" }, "next"],
  ];
  for (const [params, field] of bads) {
    const r = await door.handle(q(params));
    assert.equal(r.code, 422, JSON.stringify(params));
    assert.match(r.body.defect, new RegExp(field), JSON.stringify(params));
  }
  const ok = await door.handle(q({ ...earlier, limit: "200" }));
  assert.equal(ok.code, 200, "the maximum asked is allowed");
});

test("the LEAN summary (voices=0) carries the threads without their lines and without a cursor it could not honour", async (t) => {
  const w = await fixture();
  if (w.skip) return t.skip(w.skip);
  const r = await doorOver(w).handle(q({ voices: "0" }));
  assert.equal(r.code, 200);
  for (const th of [...r.body.live, ...r.body.closed]) {
    assert.deepEqual(th.voices, []);
    assert.equal("earlier" in th, false, "nothing was shown, so no earlier cursor is claimed");
    assert.ok(th.voice_count > 0 && th.thread_of && th.generation && th.epoch);
  }
  assert.deepEqual(r.body.live.map((x) => x.voice_count).sort((a, b) => a - b), [2, 4, 2500]);
});

test("an unreadable epoch is unavailable with ONE generic reason: no counts, no budgets, no short list", async (t) => {
  const w = await fixture();
  if (w.skip) return t.skip(w.skip);
  const r = await doorOver(w, { budgets: { maxRows: 5 } }).handle(q());
  assert.equal(r.code, 503);
  assert.match(r.body.hint, /too-large/);
  assert.equal(r.body.live, undefined);
  assert.doesNotMatch(JSON.stringify(r.body), /\b(2500|measured|limit|maxRows)\b/);
});

test("sweeps published under a read: once more on the new edges; if they keep moving, unavailable, never a mixed answer", async (t) => {
  const w = await fixture();
  if (w.skip) return t.skip(w.skip);
  // the sweeps are read at the start of the request and again after each epoch's snapshot: from the second read on an
  // extra sweep has been published. The first attempt's fence trips; the second starts on the new edges and settles.
  let calls = 0;
  const once = await doorOver(w, { settlements: () => { calls += 1; return calls >= 2 ? [E1, E2, E3, E3 + H * 4] : [E1, E2, E3]; } }).handle(q());
  assert.equal(once.code, 200, "the second attempt read stable edges");
  assert.equal(once.body.hearable_since, iso(E3 + 4 * H), "and answered on the new edge");
  let flip = false;
  const forever = await doorOver(w, { settlements: () => { flip = !flip; return flip ? [E1, E2, E3] : [E1, E2, E3, E3 + H]; } }).handle(q());
  assert.equal(forever.code, 503);
  assert.match(forever.body.hint, /settlement-moved/);
});

test("nothing about the private rooms moves a public list: a bridge, equal-time voices and a flood leave the page, the generations and the budget alone", async (t) => {
  const w = await world("convo_door_private");
  if (w.skip) return t.skip(w.skip);
  // two public circles 90 m apart (each within earshot of nothing in the other) with a private voice midway
  await w.say(E3 + H, "left", 0, 0); await w.say(E3 + H + 1000, "left2", 30, 0);
  await w.say(E3 + 2 * H, "right", 100, 0); await w.say(E3 + 2 * H + 1000, "right2", 130, 0);
  const door = doorOver(w, { budgets: { maxRows: 6 } }); // six public voices fit; a flood of private rows must not spend it
  const clean = (await door.handle(q())).body;
  assert.equal(clean.live.length, 2);
  await w.say(E3 + 3 * H, "mid", 60, 0, { room: "cellar" });
  await w.say(E3 + 2 * H, "tie", 45, 0, { room: "cellar" }); // the same instant as a public voice
  const rows = Array.from({ length: 400 }, (_, i) => ({ at: iso(E3 + 4 * H + i * 1000), actor: `fl${i}`, x: 45, y: 0, payload: { text: "psst", room: "cellar" } }));
  await w.manySays(rows);
  await w.api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy) VALUES ($1, 0, 'strmid', 'say', 'voice', $2::jsonb, 'world', 45, 0)`, [iso(E3 + 3 * H), JSON.stringify(JSON.stringify({ text: "str", room: "cellar" }))]);
  const noisy = (await doorOver(w, { budgets: { maxRows: 6 } }).handle(q())).body;
  assert.equal(noisy.live.length, 2, "the private voice did not bridge the circles");
  assert.deepEqual(noisy.live.map((x) => [x.thread_of, x.generation, x.voice_count]), clean.live.map((x) => [x.thread_of, x.generation, x.voice_count]));
  assert.deepEqual(noisy.list, clean.list);
  // the control that makes the fixture able to tell: the same midpoint voice made PUBLIC does bridge them
  await w.say(E3 + 3 * H, "pubmid", 60, 0);
  const bridged = (await doorOver(w).handle(q())).body;
  assert.equal(bridged.live.length, 1, "a public voice at the same place merges them");
  assert.notEqual(bridged.live[0].generation, clean.live[0].generation);
});

test("a late public bridge regroups the settlement; a held anchor finds its current thread, regenerated", async (t) => {
  const w = await world("convo_door_bridge");
  if (w.skip) return t.skip(w.skip);
  await w.say(E3 + H, "a", 0, 0); await w.say(E3 + H + 1000, "a2", 30, 0);
  await w.say(E3 + 2 * H, "b", 100, 0); await w.say(E3 + 2 * H + 1000, "b2", 130, 0);
  const door = doorOver(w);
  const before = (await door.handle(q())).body.live;
  assert.equal(before.length, 2);
  const held = before.find((x) => x.participants.includes("a"));
  await w.say(E3 + 3 * H, "bridge", 65, 0);
  const after = (await door.handle(q())).body.live;
  assert.equal(after.length, 1);
  const r = await door.handle(q({ thread_of: held.thread_of, before: `${E3 + 4 * H}:9`, generation: held.generation, since: String(E3), next: "open" }));
  assert.equal(r.code, 200);
  assert.equal(r.body.regenerated, true);
  assert.equal(r.body.thread.voice_count, 5, "the merged component");
  assert.notEqual(r.body.thread.generation, held.generation);
});

test("ids past 2^53 and equal milliseconds keep one total order across the show-earlier seam", async (t) => {
  const w = await world("convo_door_bigint");
  if (w.skip) return t.skip(w.skip);
  await w.owner.query("SELECT setval(pg_get_serial_sequence('acts','id'), 9007199254740990)");
  const same = E3 + H;
  const made = [];
  for (let i = 0; i < 6; i++) made.push(await w.say(same, `e${i}`, 0, 0)); // six voices in ONE millisecond
  for (let i = 0; i < 4; i++) made.push(await w.say(same + 1000 * (i + 1), `f${i}`, 0, 0));
  assert.ok(made.some((i) => BigInt(i) > 9007199254740992n), "premise: ids past 2^53");
  const door = doorOver(w);
  const th = (await door.handle(q({ voices: "3" }))).body.live[0];
  const walk = [...ids(th)];
  let cursor = th.earlier;
  while (cursor) {
    const r = await door.handle(q({ thread_of: th.thread_of, before: cursor, generation: th.generation, since: String(E3), next: "open", limit: "2" }));
    assert.equal(r.code, 200);
    walk.unshift(...r.body.voices.map((v) => v.act_id));
    cursor = r.body.earlier;
  }
  assert.deepEqual(walk, made, "all ten lines, each once, in (instant, id) order, across the equal-millisecond seam");
});

test("a cut list is reachable through its cursor, every thread once, across settlements", async (t) => {
  const w = await world("convo_door_paging");
  if (w.skip) return t.skip(w.skip);
  const rows = [];
  // 7 places in each of three settlements, far apart so each place is its own thread
  for (const [e, tag] of [[E1, "A"], [E2, "B"], [E3, "C"]]) {
    for (let p = 0; p < 7; p++) for (let i = 0; i < 3; i++) rows.push({ at: iso(e + H + p * 1000 + i * 100), actor: `${tag}${p}x${i}`, x: p * 1000, y: tag.charCodeAt(0) * 1000, payload: { text: `${tag}${p}`, place: "the quay", aboard: false } });
  }
  await w.manySays(rows);
  const door = doorOver(w);
  const first = (await door.handle(q({ limit: "3", closed: "4", voices: "1" }))).body;
  assert.equal(first.live.length, 3);
  assert.equal(first.closed.length, 4);
  assert.ok(first.next_threads.live && first.next_threads.closed);
  assert.equal(first.list.complete, false);
  assert.equal(first.list.closed.more, true);
  const seen = new Map();
  const note = (list, scope) => list.forEach((x) => { assert.equal(seen.has(x.thread_of), false, `thread ${x.thread_of} twice`); seen.set(x.thread_of, scope); });
  note(first.live, "live"); note(first.closed, "closed");
  for (const scope of ["live", "closed"]) {
    let cursor = first.next_threads[scope], hops = 0;
    while (cursor) {
      const r = (await door.handle(q({ next_threads: cursor, limit: "3", voices: "1" }))).body;
      assert.ok(!r.regenerated, JSON.stringify(r).slice(0, 200));
      note(r.threads, scope);
      cursor = r.next_threads; hops += 1;
      assert.ok(hops < 20);
    }
  }
  assert.equal(seen.size, 21, "all 21 threads, once each");
  assert.equal([...seen.values()].filter((s) => s === "live").length, 7);
  // a cursor from another view says so instead of skipping or repeating
  const stale = await door.handle(q({ next_threads: first.next_threads.live.replace(/:[0-9a-f]{16}$/, ":aaaaaaaaaaaaaaaa") }));
  assert.equal(stale.code, 200);
  assert.equal(stale.body.regenerated, true);
  assert.deepEqual(stale.body.threads, []);
});

test("a page never carries more lines than the response budget: a thread the budget leaves out is reachable by the cursor", async (t) => {
  const w = await world("convo_door_budget");
  if (w.skip) return t.skip(w.skip);
  const rows = [];
  // 40 places, 60 lines each = 2,400 lines at the default 80-line cap: over the 2,000-line page budget
  for (let p = 0; p < 40; p++) for (let i = 0; i < 60; i++) rows.push({ at: iso(E3 + H + p * 100_000 + i * 1000), actor: `p${p}n${i}`.replace(/^p/, "u"), x: p * 1000, y: 0, payload: { text: `u${p}`, place: "the quay", aboard: false } });
  await w.manySays(rows);
  const door = doorOver(w);
  const r = (await door.handle(q())).body;
  const lines = r.live.reduce((n, x) => n + x.voices.length, 0);
  assert.ok(lines <= DOOR.voiceBudget, `${lines} lines in a page`);
  assert.ok(r.live.length >= 1 && r.live.length < 40);
  assert.ok(r.next_threads.live, "the rest is behind the cursor");
  assert.equal(r.list.live.threads, 40, "the list still says how many threads the settlement has");
  assert.equal(r.list.complete, false);
});

// ── HIDDEN WORK, MEASURED AT THE CALLER ──────────────────────────────────────
// The rows the store hands back for one page, counted at the pool the door reads through, with older history and a private
// backlog scaled separately: the page of an epoch must cost the same however much sits outside it.

/** A pool-shaped wrapper that counts the rows every query returns. */
function countingPool(real) {
  const tally = { rows: 0, queries: 0, bodyRows: 0 };
  return {
    tally,
    async connect() {
      const c = await real.connect();
      return {
        on: (...a) => c.on(...a), removeListener: (...a) => c.removeListener(...a), release: (...a) => c.release(...a),
        async query(text, params) {
          const out = await c.query(text, params);
          tally.queries += 1; tally.rows += out.rowCount ?? 0;
          if (/^(DECLARE convo_(says|emissions) NO SCROLL CURSOR FOR SELECT id, at, actor, action|FETCH FORWARD)/.test(String(text).trim())) tally.bodyRows += out.rowCount ?? 0;
          return out;
        },
      };
    },
  };
}

test("rows read for a page do not grow with older history or a private backlog: each scaled alone, then together", async (t) => {
  const w = await world("convo_door_hidden");
  if (w.skip) return t.skip(w.skip);
  const page = async () => {
    const cp = countingPool(w.pool);
    const door = doorOver(w, { pool: cp });
    const r = await door.handle(q());
    assert.equal(r.code, 200);
    return { cp, body: r.body };
  };
  const rows = [];
  for (let i = 0; i < 300; i++) rows.push({ at: iso(E3 + H + i * 1000), actor: `u${i % 9}`, x: (i % 4) * 500, y: 0, payload: { text: `u${i}`, place: "the quay", aboard: false } });
  await w.manySays(rows);
  const base = await page();
  assert.equal(base.cp.tally.bodyRows, 300, "the epoch's voices, each once");
  const sig = (p) => JSON.stringify(p.body.live.map((x) => [x.thread_of, x.generation, x.voice_count]));

  // older history ten times the epoch, before every edge and between the older edges
  const old = [];
  for (let i = 0; i < 3000; i++) old.push({ at: iso(E1 - 5 * H + i * 1000), actor: `old${i % 11}`, x: (i % 5) * 500, y: 0, payload: { text: "old", place: "the quay", aboard: false } });
  await w.manySays(old);
  const aged = await page();
  assert.equal(aged.cp.tally.bodyRows, 300, "ten times the older history, the same rows read");
  assert.equal(sig(aged), sig(base));

  // a private backlog thirteen times the epoch, spread across it
  const priv = [];
  for (let i = 0; i < 4000; i++) priv.push({ at: iso(E3 + H + (i % 300) * 1000 + 1), actor: `pv${i % 13}`, x: (i % 4) * 500, y: 0, payload: { text: "psst", room: "cellar" } });
  await w.manySays(priv);
  const haunted = await page();
  assert.equal(haunted.cp.tally.bodyRows, 300, "a private backlog thirteen times the epoch reads no more bodies");
  assert.equal(sig(haunted), sig(base));
  assert.ok(haunted.cp.tally.rows <= base.cp.tally.rows + 4, `no hidden scan: ${haunted.cp.tally.rows} rows returned against ${base.cp.tally.rows}`);
});
