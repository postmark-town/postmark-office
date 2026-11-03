// pos-779-convo-read.test.mjs — the durable read of one settlement's public voices (POS-779, unwired helpers).
//
// All data is INVENTED, in a throwaway database made by the tree's own harness (test/helpers/embedded-store.mjs).
// Nothing here reads a real record, a live endpoint, a key or a config. The module under test
// (world2/tools/convo-read.mjs) is not imported by any door yet; the JS eligibility guard it needs is the REAL
// `spokenInRoom`, imported from the door that owns it, never copied.
//
//   node --test test/pos-779-convo-read.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startStore } from "./helpers/embedded-store.mjs";
import { spokenInRoom } from "../src/world2-serve.mjs";
import { voiceOf } from "../world2/tools/conversations.mjs";
import {
  readEpoch, SQL, BUDGETS, ELIGIBILITY_VERSION, PUBLIC_VOICE_PREDICATE,
  exactVoiceOf, logicalMsOf, instantMs, compareIds, compareVoices, epochFor,
} from "../world2/tools/convo-read.mjs";
import { createEpochMemo } from "../world2/tools/convo-memo.mjs";
import { LANDED } from "../world2/tools/migrations-landed.mjs";

const require = createRequire(import.meta.url);
const pg = require("pg");

let s = null, skip = false, api = null, owner = null, pool = null;
const MS = 1000, H = 3600 * MS;
const T0 = Date.parse("2026-03-01T06:00:00.000Z"); // an invented settlement edge
const T1 = T0 + 12 * H;
const iso = (ms) => new Date(ms).toISOString();

before(async () => {
  try { s = await startStore({ db: "convo_read" }); } catch (e) { skip = String(e.message ?? e).slice(0, 120); return; }
  if (s.skip) { skip = s.skip; s = null; return; }
  api = await s.connect("office_api");
  owner = await s.connect("world2_owner");
  pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
  pool.on("error", () => {});
});
after(async () => {
  await pool?.end().catch(() => {});
  await api?.end().catch(() => {});
  await owner?.end().catch(() => {});
  await s?.stop?.();
});

/** A pool-shaped spy: records every statement of every client it hands out, and can run a hook after one. */
function spy(real, { after: hook = null, failOn = null } = {}) {
  const log = { connects: 0, queries: [] };
  return {
    log,
    async connect() {
      log.connects += 1;
      const c = await real.connect();
      return {
        on: (...a) => c.on(...a), removeListener: (...a) => c.removeListener(...a),
        release: (...a) => c.release(...a),
        async query(text, params) {
          log.queries.push(String(text).trim().slice(0, 140));
          if (failOn && failOn(text)) throw Object.assign(new Error("injected"), { code: failOn.code ?? "57014" });
          const out = await c.query(text, params);
          if (hook) await hook(text, out);
          return out;
        },
      };
    },
  };
}

const sayInsert = `INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
                   VALUES ($1::timestamptz, 0, $2, 'say', 'voice', $3::jsonb, $4, $5, $6) RETURNING id::text`;
async function say(at, actor, x, y, payload = { text: "hello" }, anchor = "world") {
  const { rows: [r] } = await api.query(sayInsert, [at, actor, JSON.stringify(payload), anchor, x, y]);
  return r.id;
}
const emissionRow = (innerOver = {}, outerAt = null) => ({ type: "emission", ...(outerAt ? { at: outerAt } : {}),
  payload: { class: "sound", x: 10, y: 10, text: "old", spoken_by: "ember", place: "the quay", aboard: false, ...innerOver } });
async function emission(rowAt, payload) {
  const { rows: [r] } = await api.query(
    `INSERT INTO acts (at, crossing, actor, action, class, payload) VALUES ($1::timestamptz, 0, 'ember', 'emission', 'voice', $2::jsonb) RETURNING id::text`,
    [rowAt, JSON.stringify(payload)]);
  return r.id;
}
const read = (over = {}, ...rest) => readEpoch(over.pool ?? pool, { epoch: { since: T0, next: T1 }, isPrivate: spokenInRoom, ...over }, ...rest);

// ═════════════════════════════════════════════════════════════════════
// pure: logical time, ids, edges
// ═════════════════════════════════════════════════════════════════════

test("a live say keeps its milliseconds; voiceOf floors them to the second (the defect this helper corrects)", () => {
  const row = { id: 7, at: new Date("2026-03-01T07:00:00.123Z"), actor: "wren", action: "say", at_anchor: "world", at_dx: 3, at_dy: 4, payload: { text: "hi" } };
  assert.equal(voiceOf(row, () => null).voice.at, Date.parse("2026-03-01T07:00:00.000Z"), "the vendored mapping reads a Date through its string form: 123 ms lost");
  assert.equal(exactVoiceOf(row, () => null).voice.at, Date.parse("2026-03-01T07:00:00.123Z"));
  assert.equal(exactVoiceOf(row, () => null).voice.act_id, "7");
  assert.equal(instantMs(row.at), logicalMsOf(row));
});

test("an emission's logical instant is its own payload.at; with none, the row's at WITH its milliseconds", () => {
  const withAt = { id: 1, at: new Date("2026-03-01T20:00:00.900Z"), actor: "e", action: "emission", payload: emissionRow({}, "2026-03-01T07:15:00.456Z") };
  assert.equal(exactVoiceOf(withAt).voice.at, Date.parse("2026-03-01T07:15:00.456Z"));
  const without = { ...withAt, id: 2, payload: emissionRow({}) };
  assert.equal(exactVoiceOf(without).voice.at, Date.parse("2026-03-01T20:00:00.900Z"), "row.at, not floored");
});

test("ids order numerically as decimal strings, past 2^53, and equal milliseconds fall back to the id", () => {
  const big = ["9007199254740992", "9007199254740993", "9007199254740994"];
  assert.equal(Number(big[0]), Number(big[1]), "a double cannot tell the first two apart");
  assert.deepEqual([big[2], big[0], big[1]].sort(compareIds), big);
  assert.equal(compareIds("9", "10"), -1, "numeric, not lexical");
  const vs = [{ at: 5, act_id: "10" }, { at: 5, act_id: "9" }, { at: 4, act_id: "99" }];
  assert.deepEqual(vs.sort(compareVoices).map((v) => v.act_id), ["99", "9", "10"]);
});

test("an instant belongs to the epoch between its edges; outside what the edges say it is unknown, never all history", () => {
  assert.deepEqual(epochFor([T1, T0], T0 + 1), { since: T0, next: T1 });
  assert.deepEqual(epochFor([T0, T1], T1), { since: T1, next: null }, "a voice at an edge opens the new epoch");
  assert.deepEqual(epochFor([T0, T1], T0 - 1), { unavailable: "edges-unknown" });
  assert.deepEqual(epochFor([], T0), { unavailable: "edges-unknown" });
  assert.deepEqual(epochFor([NaN, T0], T0), { since: T0, next: null });
});

// ═════════════════════════════════════════════════════════════════════
// the migration, and the SQL port of the eligibility rule
// ═════════════════════════════════════════════════════════════════════

test("089 landed: the index and the function, and the manifest names them", async (t) => {
  if (skip) return t.skip(skip);
  const entry = LANDED["089_voice_time_index.sql"];
  assert.ok(entry?.probe, "migrations-landed.mjs has a probe for 089");
  const { rows: [r] } = await api.query(`SELECT (${entry.probe}) AS landed`);
  assert.equal(r.landed, true);
  const { rows: [f] } = await api.query("SELECT provolatile, proparallel FROM pg_proc WHERE proname = 'voice_payload_private'");
  assert.equal(f.provolatile, "i", "immutable");
  assert.equal(f.proparallel, "u", "parallel UNSAFE: it uses a subtransaction for a string payload");
});

// A seeded PRNG so a red sample reproduces.
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ROOMS = ['"x"', '""', '"0"', '"false"', "true", "false", "0", "0.0", "-0", "1", "-3.5", "1e308", "null", "{}", "[]", "[0]", '{"a":1}'];
const shapes = () => {
  const out = [];
  for (const r of ROOMS) {
    out.push(`{"room":${r}}`, `{"payload":{"room":${r}}}`, `{"room":${r},"payload":{"room":"inner"}}`, `{"room":null,"payload":{"room":${r}}}`);
    out.push(JSON.stringify(`{"room":${r}}`), JSON.stringify(`{"payload":{"room":${r}}}`)); // string-encoded
  }
  out.push("null", "5", "true", '"plain"', '"{not json"', '""', "[]", '[{"room":"x"}]', '{"payload":"room"}', '{"payload":{"payload":{"room":"x"}}}', '{"text":"hi"}', '"null"', '"5"', '"\\"x\\""');
  return out;
};
const fuzz = (n, seed) => {
  const rnd = mulberry32(seed), pick = (a) => a[Math.floor(rnd() * a.length)];
  const leaf = () => pick(ROOMS);
  const obj = () => {
    const parts = [];
    if (rnd() < 0.5) parts.push(`"room":${leaf()}`);
    if (rnd() < 0.5) parts.push(`"payload":{${rnd() < 0.8 ? `"room":${leaf()}` : ""}}`);
    if (rnd() < 0.3) parts.push('"text":"hi"');
    return `{${parts.join(",")}}`;
  };
  return Array.from({ length: n }, () => { const o = obj(); return rnd() < 0.3 ? JSON.stringify(o) : o; });
};

test("the SQL port against spokenInRoom: it never hides a row the JS guard would show", async (t) => {
  if (skip) return t.skip(skip);
  const texts = [...shapes(), ...fuzz(400, 779)];
  const verdicts = [];
  for (const text of texts) {
    const { rows: [r] } = await api.query("SELECT voice_payload_private($1::jsonb) AS p", [text]);
    verdicts.push({ text, sql: r.p, js: spokenInRoom({ payload: JSON.parse(text) }) });
  }
  assert.ok(texts.length >= 426 - 30, `${texts.length} payload shapes`);
  const overHides = verdicts.filter((v) => v.sql && !v.js);
  assert.deepEqual(overHides, [], "SQL private, JS public: a public voice the page would lose");
  const leaks = verdicts.filter((v) => !v.sql && v.js);
  assert.deepEqual(leaks.map((v) => v.text), [], "SQL public, JS private: none among these shapes (the JS guard is a second check, not the first)");
  const hidden = verdicts.filter((v) => v.sql).length;
  assert.ok(hidden > 100 && hidden < verdicts.length - 100, `both outcomes occur: ${hidden} hidden of ${verdicts.length}`);
  // the port must agree on the shapes the old naive ports got wrong
  for (const [text, want] of [
    ['{"room":false,"payload":{"room":"inner"}}', false], ['{"room":0,"payload":{"room":"inner"}}', false], ['{"room":"","payload":{"room":"inner"}}', false],
    ['{"room":null,"payload":{"room":"inner"}}', true], ['{"payload":{"room":"inner"}}', true],
    [JSON.stringify('{"room":"x"}'), true], [JSON.stringify("{not json"), false], ['{"room":{}}', true], ['{"room":[]}', true], ['{"room":"0"}', true],
  ]) {
    const { rows: [r] } = await api.query("SELECT voice_payload_private($1::jsonb) AS p", [text]);
    assert.equal(r.p, want, text);
    assert.equal(spokenInRoom({ payload: JSON.parse(text) }), want, `the JS guard agrees: ${text}`);
  }
});

test("the named exceptions: a number JS reads as 0, and a string JS parses that Postgres refuses, fall to the JS guard", async (t) => {
  if (skip) return t.skip(skip);
  // 1e-400 is nonzero as a numeric and 0 as a double: SQL must NOT hide it (it would be an over-hide).
  const tiny = '{"room":1e-400}';
  assert.equal(spokenInRoom({ payload: JSON.parse(tiny) }), false, "JS reads the literal as 0: public");
  assert.equal((await api.query("SELECT voice_payload_private($1::jsonb) AS p", [tiny])).rows[0].p, false);
  // the band between: JS reads 1e-310 as a nonzero subnormal (private) but SQL leaves it public; the JS guard drops it
  const band = '{"room":1e-310}';
  assert.equal(spokenInRoom({ payload: JSON.parse(band) }), true);
  assert.equal((await api.query("SELECT voice_payload_private($1::jsonb) AS p", [band])).rows[0].p, false, "erring toward public");
  const id = await say(iso(T0 + 5 * MS), "wren", 1, 1, JSON.parse(band));
  const out = await read({});
  assert.equal(out.status, "ok");
  assert.ok(!out.voices.some((v) => v.act_id === id), "the JS guard still drops it before it is a voice");
  assert.equal(out.js_private_dropped >= 1, true, "and the read says how many it dropped after SQL");
});

// ═════════════════════════════════════════════════════════════════════
// the index, and independence from older history
// ═════════════════════════════════════════════════════════════════════

const plan = async (text, params, { seqscan = "off" } = {}) => {
  const c = await s.connect("office_api");
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL enable_seqscan = ${seqscan}`);
    const { rows } = await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${text}`, params);
    await c.query("ROLLBACK");
    return rows[0]["QUERY PLAN"][0];
  } finally { await c.end(); }
};
const nodes = (p) => [p.Plan ?? p, ...(p.Plans ?? []).flatMap(nodes)];
const walk = (n) => [n, ...(n.Plans ?? []).flatMap(walk)];
const leafScans = (p) => walk(p.Plan).filter((n) => /Scan/.test(n["Node Type"]));

test("the epoch read repeats the index predicate, uses acts_voice_at_idx, filters no row, and does not grow with older history", async (t) => {
  if (skip) return t.skip(skip);
  const base = Date.parse("2026-04-01T06:00:00.000Z");
  const params = [iso(base), iso(base + 12 * H), 1000];
  // an epoch of 800 voices and some non-voice noise
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
    SELECT $1::timestamptz + (g * 1000 || ' milliseconds')::interval, 0, 'v' || (g % 20), 'say', 'voice', '{"text":"t"}', 'world', (g % 100)::float, (g / 100)::float
      FROM generate_series(0, 799) g`, [iso(base)]);
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload) SELECT $1::timestamptz + (g * 1000 || ' milliseconds')::interval, 0, 'w', 'walk', 'move', '{}' FROM generate_series(0, 799) g`, [iso(base)]);
  await owner.query("ANALYZE acts");
  const before = await plan(SQL.saysRows(true), params);
  const scansBefore = leafScans(before);
  assert.ok(scansBefore.some((n) => n["Index Name"] === "acts_voice_at_idx"), JSON.stringify(scansBefore.map((n) => [n["Node Type"], n["Index Name"]])));
  assert.equal(scansBefore.reduce((a, n) => a + (n["Rows Removed by Filter"] ?? 0), 0), 0, "no row is read and thrown away");
  const touched = (p) => p.Plan["Shared Hit Blocks"] + p.Plan["Shared Read Blocks"];
  // 12,000 older voices over 20 earlier epochs, 12,000 filler rows and 4,000 private voices around the epoch
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
    SELECT $1::timestamptz - ((g + 1) * 30000 || ' milliseconds')::interval, 0, 'o' || (g % 30), 'say', 'voice', '{"text":"old"}', 'world', (g % 100)::float, (g / 100)::float
      FROM generate_series(0, 11999) g`, [iso(base)]);
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload) SELECT $1::timestamptz - ((g + 1) * 30000 || ' milliseconds')::interval, 0, 'w', 'walk', 'move', '{}' FROM generate_series(0, 11999) g`, [iso(base)]);
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
    SELECT $1::timestamptz + (g * 7 || ' seconds')::interval, 0, 'p', 'say', 'voice', '{"text":"secret","room":"cellar"}', 'world', 1, 1 FROM generate_series(0, 3999) g`, [iso(base)]);
  await owner.query("ANALYZE acts");
  const after = await plan(SQL.saysRows(true), params);
  const scansAfter = leafScans(after);
  assert.ok(scansAfter.some((n) => n["Index Name"] === "acts_voice_at_idx"));
  assert.equal(scansAfter.reduce((a, n) => a + (n["Rows Removed by Filter"] ?? 0), 0), 0, "private rows are not in the index: nothing is filtered away");
  assert.equal(scansAfter.reduce((a, n) => a + (n["Actual Rows"] ?? 0), 0) >= 800, true);
  assert.ok(touched(after) <= touched(before) + 6, `older history and private backlog did not add blocks: ${touched(before)} -> ${touched(after)}`);
  console.log(`[pos-779] epoch read plan (800 voices; then +12,000 older, +12,000 non-voice, +4,000 private): buffers ${touched(before)} -> ${touched(after)}, exec ${before["Execution Time"]} -> ${after["Execution Time"]} ms, rows removed by filter 0 (one run, this host, invented rows)`);
  // the aggregate is bounded by its LIMIT and reads no more than the epoch either
  const agg = await plan(SQL.saysAggregate(true), params);
  assert.ok(leafScans(agg).some((n) => n["Index Name"] === "acts_voice_at_idx") && !leafScans(agg).some((n) => n["Node Type"] === "Seq Scan"), "the aggregate also reads through the index, with no sequential scan");
  assert.ok(walk(agg.Plan).some((n) => n["Node Type"] === "Limit"), "the aggregate is bounded by a LIMIT node: it cannot count a whole history behind a short answer");
  assert.ok(agg.Plan["Shared Hit Blocks"] + agg.Plan["Shared Read Blocks"] <= touched(before) + 20, "and costs about what the epoch costs");
  // an epoch past its budget stops being read at the fuse: with a 6-row fuse over this 800-row epoch the scan produces 6 rows, not 800
  const fused = await plan(SQL.saysAggregate(true), [params[0], params[1], 6]);
  const lim = walk(fused.Plan).find((n) => n["Node Type"] === "Limit");
  assert.equal(lim["Actual Rows"], 6, "the LIMIT is the fuse");
  assert.ok(leafScans(fused).every((n) => (n["Actual Rows"] ?? 0) <= 7), `the scan underneath stopped early: ${leafScans(fused).map((n) => n["Actual Rows"])}`);
  // the control: the same range WITHOUT the predicate cannot use the partial index at all
  const control = await plan("SELECT id FROM acts WHERE action = 'say' AND at >= $1::timestamptz AND at < $2::timestamptz LIMIT $3", params);
  assert.ok(!leafScans(control).some((n) => n["Index Name"] === "acts_voice_at_idx"), "a query that does not repeat the predicate does not get the index");
  assert.ok(PUBLIC_VOICE_PREDICATE.includes("voice_payload_private(payload)"));
});

// ═════════════════════════════════════════════════════════════════════
// reading an epoch
// ═════════════════════════════════════════════════════════════════════

test("one snapshot: one client, REPEATABLE READ READ ONLY first, and a commit between the aggregate and the bodies is not seen", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = T0 + 400 * H, e1 = e0 + 12 * H;
  const ids = [await say(iso(e0 + 1 * MS), "a", 0, 0), await say(iso(e0 + 2 * MS), "b", 1, 1)];
  let late = null, fired = false;
  const sp = spy(pool, { after: async (text) => {
    if (!fired && /count\(\*\)::int AS n/.test(text) && /action = 'say'/.test(text)) {
      fired = true;
      late = await say(iso(e0 + 3 * MS), "c", 2, 2); // commits on ANOTHER connection after the aggregate ran
    }
  } });
  const out = await readEpoch(sp, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.equal(out.status, "ok");
  assert.equal(sp.log.connects, 1, "one pooled client, not two");
  assert.match(sp.log.queries[0], /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(sp.log.queries[1], /^SET LOCAL statement_timeout/);
  assert.equal(sp.log.queries.at(-1), "ROLLBACK");
  assert.ok(late, "the hook committed a voice mid-read");
  assert.deepEqual(out.voices.map((v) => v.act_id), ids, "the bodies are the aggregate's rows: the late commit is invisible to this snapshot");
  assert.equal(out.source.says.rows, 2);
  const next = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.deepEqual(next.voices.map((v) => v.act_id), [...ids, late], "the next snapshot sees it, in (instant, id) order");
  assert.notEqual(next.key, out.key, "and the fingerprint moved with it");
});

test("exact milliseconds and decimal ids past 2^53 survive the whole path, and equal instants order by id", async (t) => {
  if (skip) return t.skip(skip);
  await owner.query("SELECT setval(pg_get_serial_sequence('acts','id'), 9007199254740991)");
  const e0 = T0 + 500 * H, e1 = e0 + 12 * H;
  const a = await say(new Date(e0 + 100).toISOString(), "a", 0, 0);
  const b = await say(new Date(e0 + 100).toISOString(), "b", 0, 1);
  const c = await say(new Date(e0 + 100).toISOString(), "c", 0, 2);
  const d = await say(new Date(e0 + 99).toISOString(), "d", 0, 3);
  assert.deepEqual([a, b, c], ["9007199254740992", "9007199254740993", "9007199254740994"]);
  const out = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.deepEqual(out.voices.map((v) => v.act_id), [d, a, b, c]);
  assert.deepEqual(out.voices.map((v) => v.at), [e0 + 99, e0 + 100, e0 + 100, e0 + 100], "milliseconds kept");
  assert.equal(out.voices.every((v) => typeof v.act_id === "string"), true);
});

test("private speech changes nothing: not the voices, the counts, the bytes, the fingerprint, nor the budget", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = T0 + 600 * H, e1 = e0 + 12 * H;
  await say(iso(e0 + 1000), "a", 0, 0); await say(iso(e0 + 3000), "b", 50, 0);
  const clean = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, budgets: { maxRows: 5 } });
  assert.equal(clean.status, "ok");
  // a private voice midway (it would bridge the two circles), at the same millisecond as a public one, before, interleaved, after,
  // in every payload spelling, far more of them than maxRows
  const privateBodies = [{ text: "p", room: "cellar" }, { text: "p", payload: { room: "cellar" } }, JSON.stringify({ text: "p", room: "cellar" }), { text: "p", room: true }, { text: "p", room: ["a"] }];
  for (let i = 0; i < 40; i++) {
    const body = privateBodies[i % privateBodies.length];
    await api.query(sayInsert, [iso(e0 + (i % 2 ? 1000 : i * 111)), "pp", JSON.stringify(body), "world", 25, 0]);
  }
  await say(iso(e1 - 1), "pp", 25, 0, { text: "last", room: "attic" });
  const noisy = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, budgets: { maxRows: 5 } });
  assert.equal(noisy.status, "ok", "41 private voices spent none of a 5-row budget");
  assert.deepEqual(noisy.voices, clean.voices);
  assert.equal(noisy.key, clean.key, "the fingerprint is blind to private speech");
  assert.deepEqual(noisy.source, clean.source);
  assert.equal(noisy.js_private_dropped, 0, "the SQL predicate hid them all; the JS guard had nothing to catch");
});

test("a budget is a refusal, never a short answer: rows, bytes and string payloads are measured before bodies are read", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = T0 + 700 * H, e1 = e0 + 12 * H;
  for (let i = 0; i < 12; i++) await say(iso(e0 + i * 10), "w" + (i % 3), i, 0, { text: "x".repeat(40) });
  const bodiesRead = (sp) => sp.log.queries.some((q) => /^SELECT id, at, actor, action/.test(q));
  let sp = spy(pool);
  let out = await readEpoch(sp, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, budgets: { maxRows: 11 } });
  assert.deepEqual([out.status, out.reason, out.what, out.limit], ["unavailable", "over-budget", "rows", 11]);
  assert.equal(out.voices, undefined, "no partial list rides an over-budget answer");
  assert.equal(bodiesRead(sp), false, "no body was shipped");
  sp = spy(pool);
  out = await readEpoch(sp, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, budgets: { maxBytes: 100 } });
  assert.deepEqual([out.reason, out.what], ["over-budget", "bytes"]);
  assert.equal(bodiesRead(sp), false);
  assert.ok(out.measured > 100, `measured ${out.measured} stored bytes`);
  for (let i = 0; i < 3; i++) await api.query(sayInsert, [iso(e0 + 500 + i), "s", JSON.stringify(JSON.stringify({ text: "str", n: i })), "world", 1, 1]);
  out = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, budgets: { maxStringPayloadRows: 2 } });
  assert.deepEqual([out.reason, out.what], ["over-budget", "string-payload rows"]);
  out = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.equal(out.status, "ok", "inside the default budgets it reads");
});

test("a crystallized emission is placed by ITS instant, not the row's: in the epoch it was born in, not the one it was written in", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = T0 + 800 * H, e1 = e0 + 12 * H, e2 = e1 + 12 * H;
  const born = iso(e0 + 2 * H);                       // born inside epoch 0 ...
  const written = iso(e1 + 30 * 60 * 1000);           // ... written into acts half an hour after epoch 0 closed
  const id = await emission(written, emissionRow({}, born));
  const live = await say(iso(e0 + 3 * H), "a", 0, 0);
  const first = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.deepEqual(first.voices.map((v) => v.act_id), [id, live], "epoch 0 holds it");
  const second = await readEpoch(pool, { epoch: { since: e1, next: e2 }, isPrivate: spokenInRoom });
  assert.deepEqual(second.voices.map((v) => v.act_id), [], "epoch 1 is not handed a voice born in epoch 0");
  assert.equal(first.eras.crystallized, 1);
  // a non-sound emission is skipped (counted), an emission with no inner payload is a refusal by name
  await emission(iso(e0 + 4 * H), emissionRow({ class: "light" }, iso(e0 + 4 * H)));
  const skipped = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.equal(skipped.non_sound_emissions, 1);
});

test("a late-written voice with an old crossing is still in its epoch (no crossing pre-filter) and moves the fingerprint", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = T0 + 900 * H, e1 = e0 + 12 * H;
  await say(iso(e0 + 1 * H), "a", 0, 0);
  const before = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  const { rows: [r] } = await api.query(
    `INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy) VALUES ($1, 999999, 'late', 'say', 'voice', '{"text":"late"}', 'world', 5, 5) RETURNING id::text`, [iso(e0 + 2 * H)]);
  const after = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.equal(after.voices.some((v) => v.act_id === r.id), true);
  assert.notEqual(after.key, before.key);
});

test("the edges are fenced: a published-sweep version that moves during the read answers edges-moved, never a mixed answer", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = T0 + 1000 * H, e1 = e0 + 12 * H;
  await say(iso(e0 + 1000), "a", 0, 0);
  let calls = 0;
  const moving = readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, edgesOf: () => ({ version: calls++ === 0 ? "sweep-1" : "sweep-2" }) });
  const out = await moving;
  assert.deepEqual([out.status, out.reason, out.from, out.to], ["unavailable", "edges-moved", "sweep-1", "sweep-2"]);
  const steady = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, edgesOf: () => ({ version: "sweep-1" }) });
  assert.equal(steady.status, "ok");
  assert.equal(steady.edges_version, "sweep-1");
  const other = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, edgesOf: () => ({ version: "sweep-2" }) });
  assert.notEqual(other.key, steady.key, "the edges version is part of the fingerprint");
});

test("failures are honest: a statement timeout, an unreadable store and a bad epoch are 'unavailable' with a reason", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = T0 + 1100 * H, e1 = e0 + 12 * H;
  const timeout = spy(pool, { failOn: Object.assign((text) => /^\s*SELECT id, at, actor, action/.test(text), { code: "57014" }) });
  await say(iso(e0 + 1000), "a", 0, 0);
  const t1 = await readEpoch(timeout, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.deepEqual([t1.status, t1.reason, t1.limit_ms], ["unavailable", "timeout", BUDGETS.statementTimeoutMs]);
  const dead = { connect: async () => { throw Object.assign(new Error("down"), { code: "ECONNREFUSED" }); } };
  const t2 = await readEpoch(dead, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.deepEqual([t2.reason, t2.code], ["store-unreadable", "ECONNREFUSED"]);
  assert.equal((await readEpoch(pool, { epoch: { since: e1, next: e0 }, isPrivate: spokenInRoom })).reason, "bad-epoch");
  await assert.rejects(readEpoch(pool, { epoch: { since: e0, next: e1 } }), /eligibility guard/, "the JS guard is required, not optional");
});

test("only the anchors the says reference are read, and a moved anchor moves membership AND the fingerprint", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = T0 + 1200 * H, e1 = e0 + 12 * H;
  await owner.query("INSERT INTO windows (id, opens_at, closes_at) VALUES (9779, now(), now()) ON CONFLICT DO NOTHING");
  const mark = (slug, x, y) => owner.query(
    `INSERT INTO marks (id, slug, kind, owner, household, geometry, bbox, locked_window)
     VALUES (gen_random_uuid(), $1, 'sited', 'x', 'hh:x', $2::jsonb, box(point($3,$4), point($3,$4)), 9779)`, [slug, JSON.stringify({ at: { x, y } }), x, y]);
  await mark("lamp/the-lamp", 1000, 1000);
  await mark("lamp/another-mark", 5000, 5000);
  const id = await say(iso(e0 + 1000), "a", 10, 5, { text: "by the lamp" }, "lamp/the-lamp");
  const sp = spy(pool);
  const one = await readEpoch(sp, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.deepEqual([one.voices[0].x, one.voices[0].y], [1010, 1005]);
  assert.deepEqual(one.anchors, ["lamp/the-lamp"]);
  const anchorReads = sp.log.queries.filter((q) => /FROM marks WHERE slug = ANY/.test(q));
  assert.equal(anchorReads.length >= 1, true);
  await owner.query("UPDATE marks SET geometry = $1::jsonb WHERE slug = 'lamp/the-lamp'", [JSON.stringify({ at: { x: 2000, y: 2000 } })]);
  const two = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.deepEqual([two.voices[0].x, two.voices[0].y], [2010, 2005], "no new act, and the voice moved");
  assert.notEqual(two.key, one.key, "a count and a first voice would not have noticed");
  assert.equal(two.voices[0].act_id, id);
  // an anchor that is in no row: the say is UNPLACED and disclosed, never put at the origin
  await say(iso(e0 + 2000), "b", 1, 1, { text: "lost" }, "nowhere/at-all");
  const three = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.equal(three.unplaced.length, 1);
  assert.equal(three.voices.length, 1);
});

test("the say dials come from the store: earshot is read in the same snapshot and is part of the fingerprint", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = T0 + 1300 * H, e1 = e0 + 12 * H;
  await say(iso(e0 + 1000), "a", 0, 0);
  const fallback = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.deepEqual(fallback.dials.earshot_m, { value: 60, source: "fallback" });
  await owner.query("INSERT INTO windows (id, opens_at, closes_at) VALUES (9779, now(), now()) ON CONFLICT DO NOTHING");
  await owner.query(`INSERT INTO marks (id, slug, kind, owner, household, geometry, bbox, locked_window, data)
    VALUES (gen_random_uuid(), 'the-town/say/earshot', 'predicated', 'the-town', 'hh:town', '{}', box(point(0,0), point(0,0)), 9779, $1::jsonb)`,
    [JSON.stringify({ _parent_is_law: "the-town/say", slot: "earshot_m", value: 25 })]);
  const set = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.deepEqual(set.dials.earshot_m, { value: 25, source: "record" });
  assert.equal(set.earshotM, 25);
  assert.notEqual(set.key, fallback.key);
  await owner.query("DELETE FROM marks WHERE slug = 'the-town/say/earshot'");
});

// ═════════════════════════════════════════════════════════════════════
// the memo, over the read
// ═════════════════════════════════════════════════════════════════════

test("a memo hit needs the same fingerprint in THIS snapshot, and ships no body; every change of source, anchor, dial or edge is a miss", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = T0 + 1400 * H, e1 = e0 + 12 * H, epochId = `${e0}:${e1}`;
  await say(iso(e0 + 1000), "a", 0, 0);
  const memo = createEpochMemo();
  const opts = (extra = {}) => ({ epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom, memo, edgesOf: () => ({ version: "v1" }), ...extra });
  const first = await readEpoch(pool, opts());
  assert.equal(first.from, "store");
  memo.set(epochId, { key: first.key, bytes: 1000, anchors: first.anchors, value: { marker: "view-1" } });
  let sp = spy(pool);
  const hit = await readEpoch(sp, opts());
  assert.deepEqual([hit.status, hit.from, hit.value], ["ok", "memo", { marker: "view-1" }]);
  assert.equal(sp.log.queries.some((q) => /^SELECT id, at, actor, action/.test(q)), false, "a hit reads aggregates only");
  // a new voice, a changed edge version, an unreadable store: each is a miss or an unavailable, never the old view
  await say(iso(e0 + 2000), "b", 1, 1);
  assert.equal((await readEpoch(pool, opts())).from, "store");
  memo.set(epochId, { key: first.key, bytes: 1000, anchors: [], value: { marker: "stale" } });
  assert.equal((await readEpoch(pool, opts({ edgesOf: () => ({ version: "v2" }) }))).from, "store", "another edges version never serves");
  const dead = await readEpoch({ connect: async () => { throw new Error("down"); } }, opts());
  assert.equal(dead.status, "unavailable");
  assert.equal(dead.value, undefined, "a failed validation never serves the old view as current");
});

// ═════════════════════════════════════════════════════════════════════
// the reported size: a 32,000-voice settlement behind older history and a private backlog
// ═════════════════════════════════════════════════════════════════════

test("32,000 invented voices in one epoch read exactly, with 100,000 older voices and 20,000 private ones beside them", { timeout: 120_000 }, async (t) => {
  if (skip) return t.skip(skip);
  const e0 = T0 + 2000 * H, e1 = e0 + 12 * H;
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
    SELECT $1::timestamptz + (g * 1200 || ' milliseconds')::interval, 0, 'v' || (g % 90), 'say', 'voice', jsonb_build_object('text', 't' || g), 'world', (g % 56)::float, ((g / 56) % 56)::float
      FROM generate_series(0, 31999) g`, [iso(e0)]);
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
    SELECT $1::timestamptz - ((g + 1) * 7 || ' seconds')::interval, 0, 'o' || (g % 90), 'say', 'voice', '{"text":"old"}', 'world', (g % 300)::float, ((g / 300) % 300)::float FROM generate_series(0, 99999) g`, [iso(e0)]);
  await api.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy)
    SELECT $1::timestamptz + (g * 2000 || ' milliseconds')::interval, 0, 'pp', 'say', 'voice', '{"text":"s","room":"cellar"}', 'world', 28, 28 FROM generate_series(0, 19999) g`, [iso(e0)]);
  await owner.query("ANALYZE acts");
  const t0 = process.hrtime.bigint();
  const out = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(out.status, "ok");
  assert.equal(out.voices.length, 32_000);
  assert.equal(out.source.says.rows, 32_000, "the 20,000 private voices are not rows of the source");
  assert.equal(out.voices.every((v, i) => i === 0 || compareVoices(out.voices[i - 1], v) < 0), true, "in total order");
  console.log(`[pos-779] 32k epoch read: ${ms.toFixed(0)} ms wall (one run, this host, invented rows; not a production claim), stored bytes ${out.source.says.bytes}`);
});

// LAST in the file on purpose: acts are append-only, and an emission no era explains refuses EVERY epoch's read
// (emissions are read as a closed set), so nothing after this test could read.
test("an act no era explains is a refusal by name, not a conversation with a hole in it", async (t) => {
  if (skip) return t.skip(skip);
  const e0 = T0 + 3000 * H, e1 = e0 + 12 * H;
  await say(iso(e0 + 1000), "a", 0, 0);
  assert.equal((await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom })).status, "ok");
  await api.query("INSERT INTO acts (at, crossing, actor, action, class, payload) VALUES ($1, 0, 'e', 'emission', 'voice', '{\"type\":\"emission\"}')", [iso(e0 + 5 * H)]);
  const refused = await readEpoch(pool, { epoch: { since: e0, next: e1 }, isPrivate: spokenInRoom });
  assert.deepEqual([refused.status, refused.reason, refused.count], ["unavailable", "unreadable-acts", 1]);
  assert.match(refused.example, /emission with no inner payload/);
  assert.equal(refused.voices, undefined);
});
