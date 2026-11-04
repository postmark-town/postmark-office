// pos-779-convo-pager.test.mjs — the settlement view, its generations, and the pages back through a thread
// (POS-779, unwired helpers: world2/tools/convo-pager.mjs, convo-memo.mjs).
//
// The first half is pure: voices are INVENTED, handed to `buildView` the way `readEpoch` hands them, so every
// case isolates one claim. The last tests read a throwaway store made by the tree's own harness, through the real
// `readEpoch`, to show the private-bridge, memo and work-fuse behaviour on the composed path.
//
//   node --test test/pos-779-convo-pager.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startStore } from "./helpers/embedded-store.mjs";
import { spokenInRoom } from "../src/world2-serve.mjs";
import { threadOf, clusterVoices } from "../world2/tools/conversations.mjs";
import { compareVoices, compareIds } from "../world2/tools/convo-read.mjs";
import {
  buildView, threadSummary, voiceOut, earlierPage, threadList, parseEarlierRequest, parseListRequest, loadEpochView,
  cursorOf, PAGE, viewBytes,
} from "../world2/tools/convo-pager.mjs";
import { createEpochMemo } from "../world2/tools/convo-memo.mjs";

const require = createRequire(import.meta.url);
const pg = require("pg");
const E0 = Date.parse("2026-05-01T06:00:00.000Z"), E1 = E0 + 12 * 3600_000;

let nextId = 1000n;
/** A voice record as readEpoch hands it over. `id` can be given to put ids past 2^53. */
const V = (at, x, y, over = {}) => ({ handle: over.handle ?? "wren", text: over.text ?? `t${at}`, at, x, y, place: "the quay", aboard: false,
  act_id: over.id ?? String(nextId++), era: "live", ...over });
const source = (voices, over = {}) => ({
  status: "ok", from: "store", key: over.key ?? "c".repeat(64), edges_version: over.edges ?? "e1", epoch: { since: E0, next: E1 }, earshotM: over.earshotM ?? 60,
  voices: [...voices].sort(compareVoices), eras: { live: voices.length, crystallized: 0 }, unplaced: [], non_sound_emissions: 0, anchors: [],
  source: { says: { rows: voices.length, bytes: voices.length * 100, strings: 0 }, emissions: { rows: 0, bytes: 0, strings: 0 } },
});
const idsOf = (list) => list.map((v) => v.act_id);

// ═════════════════════════════════════════════════════════════════════
// the view and its generations
// ═════════════════════════════════════════════════════════════════════

test("the view's threads are the connected components, in one settlement, with a bridge merging two circles", async () => {
  const circleA = [V(E0 + 1000, 0, 0), V(E0 + 2000, 30, 0)];
  const circleB = [V(E0 + 3000, 100, 0), V(E0 + 4000, 130, 0)];
  const apart = await buildView(source([...circleA, ...circleB]));
  assert.equal(apart.threads.length, 2);
  const bridge = V(E0 + 5000, 65, 0);
  const merged = await buildView(source([...circleA, ...circleB, bridge]));
  assert.equal(merged.threads.length, 1, "one late voice within earshot of both makes them one room");
  assert.equal(merged.threads[0].count, 5);
  // agrees with the vendored fold (the oracle), by members
  const oracle = clusterVoices([...circleA, ...circleB, bridge], { earshotM: 60, boundaries: [] });
  assert.deepEqual(oracle.map((c) => c.voices.length), [5]);
  // a client holding a member of circle A (thread_of) finds the merged component, with a different generation
  const before = apart.threads[apart.byAct.get(circleA[0].act_id)];
  const after = merged.threads[merged.byAct.get(circleA[0].act_id)];
  assert.notEqual(before.generation, after.generation);
});

test("a generation is not count-plus-first: same count, same first voice, one different member -> a different generation", async () => {
  const base = [V(E0 + 1000, 0, 0, { id: "50" }), V(E0 + 2000, 10, 0, { id: "51" }), V(E0 + 3000, 20, 0, { id: "52" })];
  const swapped = [base[0], base[1], V(E0 + 3000, 20, 0, { id: "53" })];
  const a = (await buildView(source(base))).threads[0], b = (await buildView(source(swapped))).threads[0];
  assert.deepEqual([a.count, a.first_act_id], [b.count, b.first_act_id]);
  assert.notEqual(a.generation, b.generation);
});

test("a generation moves with a moved point, the edges version, the earshot and the eligibility version, and not with text; the same source gives the same one", async () => {
  const voices = [V(E0 + 1000, 0, 0, { id: "1" }), V(E0 + 2000, 40, 0, { id: "2" })];
  const gen = async (vs, o) => (await buildView(source(vs, o))).threads[0].generation;
  const g = await gen(voices);
  assert.equal(await gen(voices), g, "deterministic");
  assert.notEqual(await gen([voices[0], { ...voices[1], x: 41 }]), g, "an anchor that moved a voice");
  assert.notEqual(await gen(voices, { edges: "e2" }), g, "another sweep view");
  assert.notEqual(await gen(voices, { earshotM: 61 }), g, "another earshot");
  assert.equal(await gen([voices[0], { ...voices[1], text: "different words" }]), g, "words are not membership");
  assert.match(g, /^[0-9a-f]{32}$/);
});

test("the vendored threadOf is the summary's base; the pager adds act_id, epoch, thread_of, generation and earlier", async () => {
  const voices = Array.from({ length: 9 }, (_, i) => V(E0 + (i + 1) * 1000, i * 10, 0, { handle: i % 2 ? "ash" : "wren" }));
  const view = await buildView(source(voices));
  const t = view.threads[0];
  const sum = threadSummary(view, t, { live: true, voiceCap: 4 });
  const base = threadOf({ voices: [...voices].sort(compareVoices) }, { live: true, voiceCap: 4 });
  const { voices: sv, epoch, thread_of, generation, earlier, ...rest } = sum;
  const { voices: bv, ...baseRest } = base;
  assert.deepEqual(rest, baseRest, "every compatibility field is the vendored one");
  assert.deepEqual(sv.map(({ act_id, ...v }) => v), bv, "the shown voices are the vendored shape");
  assert.deepEqual(sv.map((v) => v.act_id), idsOf(voices.slice(-4)));
  assert.deepEqual(epoch, { since: E0, next: E1 });
  assert.equal(thread_of, voices[0].act_id);
  assert.equal(generation, t.generation);
  assert.equal(earlier, cursorOf(voices[5]), "the first SHOWN voice: earlier is strictly before it");
  assert.equal(threadSummary(view, t, { voiceCap: 9 }).earlier, null, "nothing earlier once the whole thread is shown");
  assert.deepEqual(voiceOut(voices.slice(-4)[0]), sv[0], "voiceOut is the shown-voice shape");
});

// ═════════════════════════════════════════════════════════════════════
// paging back: exact at every seam
// ═════════════════════════════════════════════════════════════════════

/** One 40-voice thread with runs of equal instants and ids that straddle 2^53. */
function tieFixture() {
  const voices = [];
  const base = 9007199254740990n;
  for (let i = 0; i < 40; i++) voices.push(V(E0 + 1000 + Math.floor(i / 4) * 500, (i % 5) * 3, 0, { id: String(base + BigInt(i)) }));
  return voices;
}

async function walk(view, summary, limit) {
  const seen = idsOf(summary.voices);
  let cursor = summary.earlier, steps = 0;
  const pages = [];
  while (cursor) {
    const req = parseEarlierRequest({ thread_of: summary.thread_of, before: cursor, generation: summary.generation, limit: String(limit), since: String(E0), next: String(E1) });
    assert.equal(req.ok, true, req.reason);
    const page = earlierPage(view, req.value);
    assert.equal(page.status, "ok");
    pages.push(page.voices.length);
    seen.unshift(...idsOf(page.voices));
    cursor = page.earlier;
    assert.ok(++steps < 200, "terminates");
  }
  return { seen, pages };
}

test("show-earlier is exact at page sizes 1, 2, 3, 5 and 7: every voice once, in (instant, id) order, to the thread's first voice", async () => {
  const voices = tieFixture();
  const view = await buildView(source(voices));
  assert.equal(view.threads.length, 1);
  const summary = threadSummary(view, view.threads[0], { voiceCap: 6 });
  const want = idsOf([...voices].sort(compareVoices));
  assert.deepEqual(want, idsOf(voices), "the fixture's ids are already in the total order");
  for (const limit of [1, 2, 3, 5, 7]) {
    const { seen, pages } = await walk(view, summary, limit);
    assert.deepEqual(seen, want, `limit ${limit}`);
    assert.equal(pages.every((n) => n <= limit), true);
    assert.equal(pages.slice(0, -1).every((n) => n === limit), true, "full pages until the last");
  }
  assert.equal(Number(voices[2].act_id) === Number(voices[3].act_id), true, "the fixture has ids a double cannot separate");
});

test("control: a cursor carrying only the instant loses voices at the ties; the fixture can tell", async () => {
  const voices = tieFixture();
  const sorted = [...voices].sort(compareVoices);
  // the naive pager: strictly before at_ms only
  const naive = (shown, limit) => {
    let seen = [...shown], first = seen[0].at;
    for (;;) {
      const page = sorted.filter((v) => v.at < first).slice(-limit);
      if (!page.length) return seen;
      seen = [...page, ...seen]; first = page[0].at;
    }
  };
  const got = naive(sorted.slice(-6), 3);
  assert.notDeepEqual(idsOf(got), idsOf(sorted), "the instant alone drops equal-instant voices at a seam");
  assert.ok(got.length < sorted.length);
});

test("an anchor names ANY member and resolves to its CURRENT component; a stale generation is told to re-anchor", async () => {
  const a = [V(E0 + 1000, 0, 0), V(E0 + 2000, 30, 0)], b = [V(E0 + 3000, 100, 0), V(E0 + 4000, 130, 0)];
  const apart = await buildView(source([...a, ...b]));
  const held = threadSummary(apart, apart.threads[apart.byAct.get(a[1].act_id)], { voiceCap: 1 }); // a client holds A's newest
  const bridge = V(E0 + 5000, 65, 0);
  const merged = await buildView(source([...a, ...b, bridge]));
  const req = parseEarlierRequest({ thread_of: a[1].act_id, before: held.earlier, generation: held.generation, since: String(E0), next: String(E1) }).value;
  const out = earlierPage(merged, req);
  assert.equal(out.status, "regenerated", "the thread it held has merged");
  assert.equal(out.thread.generation, merged.threads[0].generation);
  assert.equal(out.thread.voice_count, 5);
  assert.equal(out.thread.thread_of, a[0].act_id, "the merged thread's earliest voice");
  // and the same request against the same generation pages normally
  const fresh = earlierPage(apart, req);
  assert.equal(fresh.status, "ok");
  assert.deepEqual(idsOf(fresh.voices), [a[0].act_id]);
});

test("a wrong, absent or private anchor gets ONE answer: no flag says which", async () => {
  const mine = [V(E0 + 1000, 0, 0, { id: "7001" }), V(E0 + 2000, 10, 0, { id: "7002" })];
  const view = await buildView(source(mine));
  const ask = (thread_of) => earlierPage(view, { thread_of, before: { at_ms: E0 + 9000, act_id: "9" }, generation: "0".repeat(32), limit: 10 });
  const nonexistent = ask("999999"), privateVoiceId = ask("7003" /* a room voice the read never admitted */), otherEpoch = ask("12");
  assert.deepEqual(nonexistent, { status: "unavailable" });
  assert.deepEqual(privateVoiceId, nonexistent);
  assert.deepEqual(otherEpoch, nonexistent);
  assert.equal(Object.keys(nonexistent).length, 1);
});

test("a request is validated for type, length and range before anything is looked up", () => {
  const good = { thread_of: "123", before: `${E0}:456`, generation: "a".repeat(32), since: String(E0), next: "open", limit: "80" };
  assert.equal(parseEarlierRequest(good).ok, true);
  assert.equal(parseEarlierRequest(new URLSearchParams(good)).ok, true, "a URLSearchParams too");
  assert.deepEqual(parseEarlierRequest({ ...good, limit: undefined }).value.limit, PAGE.defaultLimit);
  const cases = [
    ["thread_of", "0"], ["thread_of", "1".repeat(40)], ["thread_of", "12a"], ["thread_of", "-5"], ["thread_of", ""], ["thread_of", "007"],
    ["before", "12"], ["before", `${E0}:0`], ["before", `${"9".repeat(17)}:5`], ["before", `${E0}:5:6`], ["before", "x".repeat(60)],
    ["generation", "A".repeat(32)], ["generation", "a".repeat(31)], ["generation", "g".repeat(32)],
    ["limit", "0"], ["limit", "201"], ["limit", "-1"], ["limit", "8.5"], ["limit", "1e2"], ["limit", "1000"],
    ["since", "-1"], ["since", "x"], ["next", "5"], ["next", "closed"], ["next", `${"9".repeat(17)}`],
  ];
  for (const [k, v] of cases) assert.equal(parseEarlierRequest({ ...good, [k]: v }).ok, false, `${k}=${JSON.stringify(v)}`);
  assert.equal(parseEarlierRequest({ ...good, limit: "200" }).value.limit, PAGE.maxLimit);
  assert.equal(parseEarlierRequest({ ...good, thread_of: undefined }).ok, false);
  assert.equal(parseEarlierRequest({}).ok, false);
  assert.equal(parseListRequest({ limit: "500" }).ok, false);
  assert.equal(parseListRequest({ next_threads: "nope" }).ok, false);
  assert.equal(parseListRequest({}).value.limit, PAGE.defaultListLimit);
});

test("no field of a cursor or a page carries a room, a handle or a right", async () => {
  const voices = tieFixture();
  const view = await buildView(source(voices));
  const s = threadSummary(view, view.threads[0], { voiceCap: 6 });
  assert.match(s.earlier, /^\d+:\d+$/, "two numbers");
  const page = earlierPage(view, parseEarlierRequest({ thread_of: s.thread_of, before: s.earlier, generation: s.generation, since: String(E0), next: String(E1) }).value);
  assert.equal(JSON.stringify(page).includes("room"), false);
  assert.deepEqual(Object.keys(page).sort(), ["earlier", "status", "voices"]);
});

// ═════════════════════════════════════════════════════════════════════
// the list: every summary reachable once
// ═════════════════════════════════════════════════════════════════════

test("the thread list pages by a keyset bound to the view: every thread once, in one total order, ties included", async () => {
  const voices = [];
  for (let i = 0; i < 130; i++) voices.push(V(E0 + 1000 + (i % 10) * 100, (i % 12) * 1000, Math.floor(i / 12) * 1000)); // 130 separate places, tied latest instants
  const view = await buildView(source(voices));
  assert.equal(view.threads.length, 130);
  for (const limit of [1, 7, 40, 100]) {
    const got = [];
    let after = null, guard = 0;
    for (;;) {
      const req = parseListRequest({ limit: String(limit), ...(after ? { next_threads: after } : {}) });
      assert.equal(req.ok, true);
      const page = threadList(view, req.value);
      assert.equal(page.status, "ok");
      got.push(...page.threads.map((t) => t.thread_of));
      assert.equal(page.list.epoch_threads, 130);
      after = page.next_threads;
      if (!after) break;
      assert.ok(++guard < 200);
    }
    assert.equal(got.length, 130, `limit ${limit}`);
    assert.equal(new Set(got).size, 130, "no duplicate");
    assert.deepEqual(got, view.order.map((i) => view.threads[i].first_act_id), "newest first, ties by first act id");
  }
  const first = threadList(view, parseListRequest({ limit: "40" }).value);
  assert.deepEqual([first.list.returned, first.list.complete], [40, false], "an incomplete list says so");
  assert.equal(threadList(view, parseListRequest({ limit: "100" }).value).list.complete, false);
  const whole = threadList(await buildView(source(voices.slice(0, 3))), parseListRequest({ limit: "40" }).value);
  assert.deepEqual([whole.list.complete, whole.next_threads], [true, null]);
});

test("a list cursor from another view is told to start again, never resumed over a different list", async () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => V(E0 + 1000 + i * 10, i * 1000, 0));
  const v1 = await buildView(source(mk(10), { key: "a".repeat(64) }));
  const v2 = await buildView(source([...mk(10), V(E0 + 9000, 50_000, 0)], { key: "b".repeat(64) }));
  const page = threadList(v1, parseListRequest({ limit: "4" }).value);
  const stale = threadList(v2, parseListRequest({ limit: "4", next_threads: page.next_threads }).value);
  assert.equal(stale.status, "regenerated");
});

// ═════════════════════════════════════════════════════════════════════
// the memo
// ═════════════════════════════════════════════════════════════════════

test("the memo serves a value only for the exact key, keeps few entries and few bytes, and refuses what could not fit", () => {
  const m = createEpochMemo({ maxEntries: 3, maxBytes: 1000 });
  assert.equal(m.set("a", { key: "k1", bytes: 400, anchors: ["x"], value: 1 }), true);
  assert.deepEqual([m.lookup("a", "k1"), m.lookup("a", "k2"), m.lookup("b", "k1")], [1, null, null]);
  assert.deepEqual(m.peek("a"), { anchors: ["x"] });
  assert.equal(m.peek("zz"), null);
  m.set("b", { key: "kb", bytes: 400, value: 2 });
  m.lookup("a", "k1"); // a is now the most recently used
  m.set("c", { key: "kc", bytes: 400, value: 3 }); // 1200 bytes > 1000: the least recently used (b) goes
  assert.deepEqual([m.lookup("a", "k1"), m.lookup("b", "kb"), m.lookup("c", "kc")], [1, null, 3]);
  assert.equal(m.set("big", { key: "kz", bytes: 1001, value: 9 }), false, "an entry larger than the whole bound is not kept");
  assert.equal(m.stats().refused, 1);
  m.set("d", { key: "kd", bytes: 1, value: 4 }); m.set("e", { key: "ke", bytes: 1, value: 5 }); m.set("f", { key: "kf", bytes: 1, value: 6 });
  assert.ok(m.stats().entries <= 3 && m.stats().bytes <= 1000);
  m.set("a", { key: "k9", bytes: 5, value: 10 });
  assert.equal(m.lookup("a", "k1"), null, "a replaced entry's old key never serves");
  assert.throws(() => m.set("x", { bytes: 1, value: 1 }), /fingerprint/);
  assert.throws(() => createEpochMemo({ maxEntries: 0 }), RangeError);
});

// ═════════════════════════════════════════════════════════════════════
// composed on a real store
// ═════════════════════════════════════════════════════════════════════

let s = null, skip = false, api = null, pool = null;
before(async () => {
  try { s = await startStore({ db: "convo_pager" }); } catch (e) { skip = String(e.message ?? e).slice(0, 120); return; }
  if (s.skip) { skip = s.skip; s = null; return; }
  api = await s.connect("office_api");
  pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
  pool.on("error", () => {});
});
after(async () => { await pool?.end().catch(() => {}); await api?.end().catch(() => {}); await s?.stop?.(); });

const iso = (ms) => new Date(ms).toISOString();
const say = async (at, actor, x, y, payload = { text: "hello" }) =>
  (await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy) VALUES ($1::timestamptz, 0, $2, 'say', 'voice', $3::jsonb, 'world', $4, $5) RETURNING id::text`,
    [at, actor, JSON.stringify(payload), x, y])).rows[0].id;

test("a private voice midway between two public circles does not bridge them: same threads, same generations, same list", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = E0 + 100 * 3600_000, e1 = e0 + 12 * 3600_000;
  await say(iso(e0 + 1000), "a", 0, 0); await say(iso(e0 + 2000), "b", 30, 0);
  await say(iso(e0 + 3000), "c", 100, 0); await say(iso(e0 + 4000), "d", 130, 0);
  const load = () => loadEpochView(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, memo: null });
  const clean = await load();
  assert.equal(clean.status, "ok");
  assert.equal(clean.view.threads.length, 2);
  // the private voice would chain both circles if it counted (it is within earshot of both)
  await say(iso(e0 + 2500), "p", 65, 0, { text: "psst", room: "cellar" });
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy) VALUES ($1, 0, 'p', 'say', 'voice', $2::jsonb, 'world', 65, 0)`, [iso(e0 + 3000), JSON.stringify(JSON.stringify({ text: "str", room: "cellar" }))]);
  const noisy = await load();
  assert.equal(noisy.view.threads.length, 2, "two threads, as before");
  assert.deepEqual(noisy.view.threads.map((x) => x.generation), clean.view.threads.map((x) => x.generation));
  assert.equal(noisy.view.key, clean.view.key);
  const list = (v) => threadList(v, parseListRequest({}).value).threads.map((x) => [x.thread_of, x.generation, x.voice_count]);
  assert.deepEqual(list(noisy.view), list(clean.view));
  // control: the same data with the room tag removed DOES bridge, so the fixture can tell
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy) VALUES ($1, 0, 'q', 'say', 'voice', '{"text":"open"}', 'world', 65, 0)`, [iso(e0 + 2600)]);
  const bridged = await load();
  assert.equal(bridged.view.threads.length, 1, "a PUBLIC voice at the same place merges them");
});

test("the memo skips the read of bodies and the component build while the fingerprint holds, and never serves across a change", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = E0 + 200 * 3600_000, e1 = e0 + 12 * 3600_000;
  for (let i = 0; i < 30; i++) await say(iso(e0 + 1000 + i * 100), "w" + (i % 5), i * 5, 0);
  const memo = createEpochMemo();
  const calls = [];
  const spyPool = { connect: async () => { const c = await pool.connect(); return { on: (...a) => c.on(...a), removeListener: (...a) => c.removeListener(...a), release: (...a) => c.release(...a),
    query: (q, p) => { calls.push(String(q).trim().slice(0, 40)); return c.query(q, p); } }; } };
  const load = () => loadEpochView(spyPool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, memo, edgesOf: () => ({ version: "v1" }) });
  const one = await load();
  assert.equal(one.from, "store");
  calls.length = 0;
  const two = await load();
  assert.equal(two.from, "memo");
  assert.strictEqual(two.view, one.view, "the same view object: no rebuild");
  assert.equal(calls.some((q) => /^(DECLARE convo_(says|emissions) NO SCROLL CURSOR FOR SELECT id, at, actor, action|FETCH FORWARD)/.test(q)), false, "no body read on a hit");
  await say(iso(e0 + 5000), "late", 1, 1);
  const three = await load();
  assert.equal(three.from, "store");
  assert.equal(three.view.voices.length, 31);
  assert.equal(memo.stats().entries, 1, "one epoch, replaced, not grown");
});

test("a work fuse on the component build answers 'unavailable', keeps nothing, and never serves a partial partition", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = E0 + 300 * 3600_000, e1 = e0 + 12 * 3600_000;
  for (let i = 0; i < 200; i++) await say(iso(e0 + 1000 + i), "w", (i % 20) * 70, Math.floor(i / 20) * 70);
  const memo = createEpochMemo();
  const out = await loadEpochView(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, memo, fuse: 5 });
  assert.deepEqual([out.status, out.reason, out.what], ["unavailable", "over-budget", "component work"]);
  assert.equal(out.view, undefined);
  assert.equal(memo.stats().entries, 0, "a failed build is not memoized");
  const fine = await loadEpochView(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, memo });
  assert.equal(fine.status, "ok");
});

test("32,000 voices in one dense circle: one thread, finite counted work, and the pages back through it reach the first voice", { timeout: 120_000 }, async (t) => {
  if (skip) return t.skip(skip);
  const e0 = E0 + 400 * 3600_000, e1 = e0 + 12 * 3600_000;
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
    SELECT $1::timestamptz + (g * 1200 || ' milliseconds')::interval, 0, 'v' || (g % 90), 'say', 'voice', jsonb_build_object('text', 't' || g), 'world', (g % 7)::float * 8, ((g / 7) % 7)::float * 8 FROM generate_series(0, 31999) g`, [iso(e0)]);
  const t0 = process.hrtime.bigint();
  const out = await loadEpochView(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, memo: null });
  const wall = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(out.status, "ok");
  assert.equal(out.view.threads.length, 1);
  assert.equal(out.view.threads[0].count, 32_000);
  assert.ok(out.view.stats.work < 32_000 * 40, `work ${out.view.stats.work} for 32,000 voices is linear, not all-pairs`);
  const summary = threadSummary(out.view, out.view.threads[0], { voiceCap: 80 });
  let cursor = summary.earlier, pages = 0, total = summary.voices.length;
  while (cursor) {
    const page = earlierPage(out.view, parseEarlierRequest({ thread_of: summary.thread_of, before: cursor, generation: summary.generation, limit: "200", since: String(e0), next: String(e1) }).value);
    total += page.voices.length; cursor = page.earlier; pages += 1;
  }
  assert.equal(total, 32_000);
  console.log(`[pos-779] 32k dense: load ${wall.toFixed(0)} ms wall (read + exact components + generations), component work ${out.view.stats.work}, longest sync slice ${out.view.stats.maxSliceMs.toFixed(1)} ms, ${pages} pages of 200 back to the first voice (one run, invented rows, this host)`);
});

// ═════════════════════════════════════════════════════════════════════
// the memo charges what the view RETAINS (POS-779 stage fix)
// ═════════════════════════════════════════════════════════════════════
//
// `viewBytes` is an ACCOUNTED ESTIMATE of the decoded material a built view keeps, not exact JS heap or RSS.
// Its floor, checked independently here: every retained string at two bytes per UTF-16 unit. The OLD charge was
// the source's STORED bytes plus 256 per voice; `oldCharge` below is that formula, kept to show it undercounts.

const oldCharge = (src) => (src.source?.says?.bytes ?? 0) + (src.source?.emissions?.bytes ?? 0) + 256 * (src.voices?.length ?? 0);
/** Independent floor: two bytes per UTF-16 unit of every string a voice retains (what the view cannot do without). */
const contentFloor = (view) => view.voices.reduce((n, v) => n + 2 * (String(v.text).length + String(v.handle).length + String(v.place ?? "").length + String(v.act_id).length), 0);
/** n voices of `len`-unit texts in tight places (many threads or few), with a stored size as small as a compressed row's. */
function bigSource(n, len, { ch = "q", spread = 40, tag = "" } = {}) {
  const vs = [];
  for (let i = 0; i < n; i++) vs.push(V(E0 + 1000 + i * 1000, (i % spread) * 500, Math.floor(i / spread) * 500, { text: ch.repeat(len), handle: `h${tag}${i % 7}` }));
  const src = source(vs);
  src.source.says.bytes = n * 30;       // what a compressed stored size looks like for repetitive text
  return src;
}

test("viewBytes covers the retained decoded content (ASCII, two-byte and astral text); the OLD charge does not", async () => {
  for (const [ch, len] of [["q", 4000], ["€", 3000], ["😀", 1500], ["x", 20]]) {
    const src = bigSource(300, len, { ch });
    const view = await buildView(src);
    const est = viewBytes(view), floor = contentFloor(view);
    assert.ok(est >= floor, `${ch}x${len}: estimate ${est} must be at least the content floor ${floor}`);
    if (len >= 1500) assert.ok(oldCharge(src) < floor, `${ch}x${len}: the old charge ${oldCharge(src)} undercounts the retained ${floor} (the defect)`);
  }
  assert.equal(viewBytes({ voices: [] }), Infinity, "a shape it cannot charge answers Infinity");
  assert.equal(viewBytes(null), Infinity);
  const empty = await buildView(source([]));
  assert.ok(viewBytes(empty) > 0 && Number.isFinite(viewBytes(empty)));
});

test("memo accounting over several epochs: near-boundary fit, LRU eviction, replacement, and a too-large view refused with no quota drift", async () => {
  const views = [];
  for (const [i, len] of [[0, 800], [1, 800], [2, 800], [3, 800]]) views.push(await buildView(bigSource(200, len, { tag: String(i) })));
  const est = views.map(viewBytes);
  const one = est[0];
  const memo = createEpochMemo({ maxEntries: 10, maxBytes: Math.floor(2.5 * one) });
  const put = (id, i) => memo.set(id, { key: `k${id}`, bytes: viewBytes(views[i]), anchors: [], value: views[i] });
  assert.equal(put("a", 0), true); assert.equal(put("b", 1), true);
  assert.equal(memo.stats().bytes, est[0] + est[1], "the memo's total is the sum of the charges, nothing else");
  assert.equal(put("c", 2), true, "a third overflows 2.5 views: admitted, and the least recently used goes");
  assert.deepEqual([memo.lookup("a", "ka") === null, memo.lookup("b", "kb") === views[1], memo.lookup("c", "kc") === views[2]], [true, true, true]);
  assert.equal(memo.stats().bytes, est[1] + est[2]);
  assert.equal(memo.stats().evicted, 1);
  memo.lookup("b", "kb"); // b most recent
  put("d", 3);
  assert.deepEqual([memo.lookup("c", "kc"), memo.lookup("b", "kb") === views[1], memo.lookup("d", "kd") === views[3]], [null, true, true], "c was the least recently used");
  assert.ok(memo.stats().bytes <= memo.stats().maxBytes);
  // replacement: a smaller view for the same epoch lowers the total, the old key no longer serves
  const small = await buildView(bigSource(20, 100));
  memo.set("b", { key: "kb2", bytes: viewBytes(small), value: small });
  assert.equal(memo.lookup("b", "kb"), null);
  assert.equal(memo.stats().bytes, viewBytes(small) + est[3]);
  // a view larger than the whole bound: refused, never truncated, not under another key, and the epoch's old entry is gone, not stale
  const huge = await buildView(bigSource(1500, 800, { tag: "H" }));
  assert.ok(viewBytes(huge) > memo.stats().maxBytes);
  assert.equal(memo.set("b", { key: "kh", bytes: viewBytes(huge), value: huge }), false);
  assert.deepEqual([memo.lookup("b", "kh"), memo.lookup("b", "kb2"), memo.stats().refused], [null, null, 1]);
  assert.equal(memo.stats().bytes, est[3], "no quota drift after a refusal");
  // an unaccountable charge is refused, never counted as 1 byte
  for (const bad of [Infinity, NaN, 0, -5, undefined, "x"]) assert.equal(memo.set("z", { key: "kz", bytes: bad, value: 1 }), false, `bytes ${String(bad)}`);
  assert.equal(memo.stats().bytes, est[3]);
  memo.clear();
  assert.equal(memo.stats().bytes, 0);
});

test("on the composed path: a compressible view too big for the memo is served but not cached; one that fits is cached and reused", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = E0 + 500 * 3600_000, e1 = e0 + 12 * 3600_000;
  for (let i = 0; i < 6; i++) await say(iso(e0 + i * 1000), "w" + (i % 2), i * 500, 0, { text: "q".repeat(4000) }); // legacy/dial-raised, compressible
  const small = createEpochMemo({ maxEntries: 4, maxBytes: 20_000 });
  const a = await loadEpochView(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, memo: small });
  assert.equal(a.status, "ok");
  assert.equal(a.view.voices.length, 6, "the view is returned whole, never truncated for the memo");
  const need = viewBytes(a.view);
  assert.ok(need > 20_000, `premise: the honest charge ${need} exceeds the memo`);
  assert.ok(a.view.source.says.stored_bytes + 256 * 6 < 20_000, "premise: the OLD charge would have admitted it");
  assert.deepEqual([small.stats().entries, small.stats().refused, small.stats().bytes], [0, 1, 0], "refused, not cached, nothing leaked into the quota");
  const again = await loadEpochView(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, memo: small });
  assert.equal(again.from, "store", "nothing was cached, so the second read is a store read");
  const roomy = createEpochMemo({ maxEntries: 4, maxBytes: need * 2 });
  const b = await loadEpochView(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, memo: roomy });
  const c = await loadEpochView(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, memo: roomy });
  assert.deepEqual([b.from, c.from, c.view === b.view], ["store", "memo", true], "under budget: cached and reused");
  assert.equal(roomy.stats().bytes, need);
  assert.ok(roomy.stats().bytes >= contentFloor(b.view));
});

// ═════════════════════════════════════════════════════════════════════
// the generation walk after the components is sliced too (POS-779 integration)
// ═════════════════════════════════════════════════════════════════════
//
// Measured at the caller on a 32,000-voice epoch, the stretch AFTER the components (a digest line per member and the
// act-id index) held the event loop for 37-85 ms. It now walks a slice at a time. The control is structural and isolates
// that walk: on a call-driven clock, the yields of buildView MINUS the yields of the component builder alone on the same
// voices are the walk's.

test("buildView's walk after the components yields a slice at a time; the view is the unsliced one", async () => {
  const { componentsOf } = await import("../world2/tools/convo-components.mjs");
  const vs = Array.from({ length: 1500 }, (_, i) => V(E0 + i * 1000, (i % 40) * 10, 0)); // one dense thread, a few cells
  const src = source(vs);
  const clock = () => { let t = 0, yields = 0; return { now: () => (t += 1), yieldFn: async () => { yields += 1; }, yields: () => yields }; };
  const c0 = clock();
  await componentsOf(src.voices, { earshotM: src.earshotM, sliceMs: 2, now: c0.now, yieldFn: c0.yieldFn });
  const c1 = clock();
  const view = await buildView(src, { sliceMs: 2, now: c1.now, yieldFn: c1.yieldFn });
  const tail = c1.yields() - c0.yields();
  assert.ok(tail >= 1500 / 64 / 3 - 1 && tail > 3, `the walk over 1,500 members yielded ${tail} times beyond the components' ${c0.yields()}`);
  const plain = await buildView(src);
  assert.deepEqual(view.threads.map((t) => [t.generation, t.count, t.first_act_id]), plain.threads.map((t) => [t.generation, t.count, t.first_act_id]));
  assert.deepEqual([...view.byAct], [...plain.byAct]);
});
