// refusal-log.test.mjs — a refused act leaves a private trace (POS-1003).
//   node --import ./test/helpers/sparse-guard.mjs --test test/refusal-log.test.mjs
//
// RULED (Darko, 2026-11-13 15:0x EST, batch 2): "Private log, own refusals visible". When a door
// refuses a resident's act, it records who tried which act, on what, when, and the refusal's code
// and words. The record is kept privately for 90 days and never goes on the public record. A
// resident can read their own refusals through their household read, and nobody else's.
//
// THE DOORS AND THE STORE ARE THE REAL ONES. A real Postgres (test/helpers/embedded-store.mjs), the
// MCP door's own handleMcp, a spawned office for REST's `j`, and connections as `office_api` and
// `snapshot_reader` for the row policies. Every household, resident and word is invented.
//
//   1. the pure parts: which act, on what (never a body), which refusals are kept
//   2. the MCP door keeps a refused act, with its words; its control: a refused read and a done act keep none
//   3. the household reads its own refusals, and nobody else's (policy and read)
//   4. ninety days: an expired row is never read and is deleted; a row inside the window stays
//   5. REST's `j`: a refused write is kept, a refused read and an apex read are not
//   6. the store without 098 answers nothing about it and breaks no act

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";
import { removeTempDir, tempDir } from "./helpers/temp-dir.mjs";
import {
  actOf, targetOf, isKept, refusalInReply, actorHandle, noteRestRefusal, recordRefusal, refusalLogSettled,
  readOwnRefusals, __resetForTest, HELD_MAX, RETENTION_DAYS, TARGET_FIELDS, TARGET_VALUE_MAX, DEFECT_MAX,
} from "../src/refusal-log.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = tempDir("refusal-log-");
const KEY = "pos1003-refusal-log-test-key";

const ix = await indexStore(fixtureTown(), { db: "refusal_log" });
const store = ix.store;
const skip = store.skip ?? false;
let office = null;

const asOwner = async (sql, params = []) => {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
};
const asRole = async (role, setting, fn) => {
  const c = await store.connect(role);
  try {
    await c.query("BEGIN");
    if (setting != null) await c.query("SELECT set_config('app.household_keys', $1, true)", [setting]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) { try { await c.query("ROLLBACK"); } catch { /* gone */ } throw e; } finally { await c.end(); }
};
const rowsKept = () => asOwner("SELECT household, handle, door, act, target, code, defect, hint, at FROM refused_acts ORDER BY id");
const fresh = () => asOwner("TRUNCATE refused_acts");
const until = async (fn, what, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) assert.fail(`never happened: ${what}`);
    await new Promise((r) => setTimeout(r, 40));
  }
};

const SECRET = "the-heron-feather-order";            // an invented condition: it must be found in no row
const A = "hh:aa-house", B = "hh:bb-house";
const keyA = { household: "the-aa-house", handles: new Set(["a1", "a2"]) };
const keyA2 = { household: "the-aa-house", handles: new Set(["a2"]) };
const keyB = { household: "the-bb-house", handles: new Set(["b1"]) };
const nobody = { household: null, handles: new Set() };

if (!skip) {
  await asOwner("TRUNCATE households, household_pins CASCADE");
  await asOwner(`INSERT INTO households (slug, ord, name, residents, since, declared_by)
    VALUES ('aa-house', 0, 'The AA House', ARRAY['a1','a2'], '2026-10-01', 'a1'),
           ('bb-house', 1, 'The BB House', ARRAY['b1'], '2026-10-01', 'b1'),
           ('fixture-house', 2, 'The Fixture House', ARRAY['wright'], '2026-10-01', 'wright')`);
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = store.url("office_api");
}
const { handleMcp } = await import("../src/mcp.mjs");

after(async () => {
  const child = office?.child;
  if (child && child.exitCode === null) child.kill();
  await ix.stop();
  await removeTempDir(tmp, { children: [child] });
});

// ── 1 · the pure parts ───────────────────────────────────────────────────────

test("which act: an apex's do: names it `<apex>:<do>`, a flat tool is its own name, and odd characters never pass", () => {
  assert.equal(actOf("world", { do: "give", args: {} }), "world:give");
  assert.equal(actOf("household", { do: "letter-note" }), "household:letter-note");
  assert.equal(actOf("world", { read: "orient" }), "world", "a call with no do: is the apex's own name, and the door only asks for acts");
  assert.equal(actOf("send_letter", { to: "x" }), "send_letter");
  assert.equal(actOf("world", { do: "a\nb<script>" }), "world:a?b?script?");
  assert.equal(actOf("x".repeat(200), {}).length, 80);
});

test("on what: the identifying fields only, cut; a body, a text, a note or an unlisted field is never copied", () => {
  const long = "z".repeat(500);
  const got = targetOf({ do: "give", text: SECRET, body: SECRET, note: SECRET, card: SECRET, bogus: SECRET, to: "a2", mark_id: long,
    args: { what: "sweets", handle: "a1", letter: "L1", on: SECRET, msg: SECRET, to: "overridden-by-the-top-level-one" } });
  assert.deepEqual(Object.keys(got).sort(), ["handle", "letter", "mark_id", "to", "what"]);
  assert.equal(got.to, "a2", "the top level wins over the envelope");
  assert.equal(got.mark_id.length, TARGET_VALUE_MAX);
  assert.ok(!JSON.stringify(got).includes(SECRET), "no unlisted field's value is written");
  assert.ok(!TARGET_FIELDS.some((f) => ["body", "text", "note", "card", "message", "msg", "on", "password", "key", "token"].includes(f)), "the list holds no field that carries what a resident wrote");
  assert.deepEqual(targetOf({ to: { nested: SECRET }, what: ["a"], id: null }), {}, "only a scalar is a target");
  assert.deepEqual(targetOf(null), {});
});

test("which refusals are kept: a 4xx, or a bounce with no code; not a 5xx fault, not the rate limit, not a status that is no refusal", () => {
  for (const c of [400, 403, 404, 409, 422, null, undefined]) assert.equal(isKept(c), true, String(c));
  for (const c of [429, 413, 500, 503, 200, 302, 99, 600, "409", 0]) assert.equal(isKept(c), false, String(c));
});

test("the refusal in a JSON-RPC answer: a tool's bounce, with its code and words cut; nothing else", () => {
  const reply = (body, isError = true) => ({ jsonrpc: "2.0", id: 1, result: { isError, content: [{ type: "text", text: JSON.stringify(body) }] } });
  assert.deepEqual(refusalInReply(reply({ error: "bounce", code: 403, defect: "no", hint: "because" })), { code: 403, defect: "no", hint: "because" });
  assert.equal(refusalInReply(reply({ error: "bounce", defect: "d" })).code, null, "a bounce that names no code keeps none");
  assert.equal(refusalInReply(reply({ error: "bounce", code: 403, defect: "d".repeat(900) })).defect.length, DEFECT_MAX);
  assert.equal(refusalInReply(reply({ error: "bounce", code: 403 }, false)), null, "a tool result that is not an error");
  assert.equal(refusalInReply(reply({ fine: true })), null);
  assert.equal(refusalInReply({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "unknown tool" } }), null, "a JSON-RPC error is no act's refusal");
  assert.equal(refusalInReply({ result: { isError: true, content: [{ type: "text", text: "not json" }] } }), null);
});

test("who tried: the handle the call names when the key holds it, else the key's only resident, else none", () => {
  assert.equal(actorHandle(keyA, { args: { handle: "a2" } }), "a2");
  assert.equal(actorHandle(keyA, { handle: "a1" }), "a1");
  assert.equal(actorHandle(keyA, { args: { handle: "b1" } }), null, "a handle the key does not hold is never named");
  assert.equal(actorHandle(keyA, {}), null, "two residents and none named");
  assert.equal(actorHandle(keyA2, {}), "a2");
  assert.equal(actorHandle(nobody, {}), null);
});

// ── 2 · the MCP door ─────────────────────────────────────────────────────────

async function mcpCall(name, args, key) {
  const raw = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } });
  const req = Object.assign(Readable.from([Buffer.from(raw)]), { method: "POST", headers: { "content-type": "application/json" } });
  let body = "";
  await new Promise((ok) => {
    const res = { headersSent: false, setHeader() {}, hasHeader() { return false; }, getHeader() { return undefined; },
      writeHead() { this.headersSent = true; return this; }, end(chunk) { if (chunk) body += chunk; ok(); } };
    handleMcp(req, res, { key, canWrite: true, asOf: "test" });
  });
  const rpc = JSON.parse(body);
  await refusalLogSettled();
  return { rpc, answer: rpc.result ? JSON.parse(rpc.result.content[0].text) : rpc, isError: rpc.result?.isError };
}

test("the MCP door keeps a refused act: who, which act, on what, the code and the words, and the answer is the one the caller always got", { skip }, async () => {
  await fresh(); __resetForTest();
  const r = await mcpCall("household", { do: "letter-note", args: { letter: "no-such-letter", state: "waiting", on: SECRET, handle: "a1" } }, keyA);
  assert.equal(r.isError, true, JSON.stringify(r.answer));
  assert.equal(r.answer.code, 403, `the act met a real refusal: ${JSON.stringify(r.answer)}`);
  const rows = await rowsKept();
  assert.equal(rows.length, 1, JSON.stringify(rows));
  const [row] = rows;
  assert.equal(row.household, A);
  assert.equal(row.handle, "a1");
  assert.equal(row.door, "mcp");
  assert.equal(row.act, "household:letter-note");
  assert.deepEqual(row.target, { letter: "no-such-letter", handle: "a1" });
  assert.equal(row.code, 403);
  assert.equal(row.defect, r.answer.defect, "the refusal's own words");
  assert.equal(row.hint, r.answer.hint);
  assert.ok(row.at instanceof Date && Math.abs(Date.now() - row.at.getTime()) < 60_000, "when");
  assert.ok(!JSON.stringify(rows).includes(SECRET), "the condition the resident wrote is in no column");
});

test("CONTROL, the writer is live and keeps only refused acts: a refused read, an unknown tool and a key with no household keep nothing", { skip }, async () => {
  await fresh(); __resetForTest();
  // a refused READ: household { read: "letter" } for a letter that is not there
  const read = await mcpCall("household", { read: "letter", args: { id: "no-such-letter" } }, keyA);
  assert.equal(read.isError, true, `the read was refused: ${JSON.stringify(read.answer)}`);
  const unknown = await mcpCall("not_a_tool", { do: "x" }, keyA);
  assert.ok(unknown.rpc.error, "an unknown tool is a JSON-RPC error");
  const nokey = await mcpCall("household", { do: "letter-note", args: { letter: "x", state: "no-reply" } }, nobody);
  assert.equal(nokey.isError, true, "an act by a key in no household is refused too");
  assert.deepEqual(await rowsKept(), [], "no row: not an act, no act's refusal, or nobody to read it back to");
  // and the same writer, one refused act later, keeps one: the empty table above was not a dead writer
  await mcpCall("household", { do: "letter-note", args: { letter: "no-such-letter", state: "no-reply" } }, keyB);
  assert.equal((await rowsKept()).length, 1);
});

// ── 2b · NEITHER HOOK EVER THROWS (the review of #1074, finding 1) ───────────

const ODD = JSON.parse('{"toString":1}');   // a caller's JSON that throws when it is stringified
const PLAIN = [["a hostile `do`", { do: ODD }], ["a hostile `handle`", { do: "letter-note", args: { letter: "no-such-letter", state: "no-reply", handle: ODD } }]];

test("a call whose `do` or `handle` will not stringify is answered as it always was: the MCP door", { skip }, async () => {
  await fresh(); __resetForTest();
  const got = {};
  for (const [what, args] of PLAIN) {
    const r = await Promise.race([mcpCall("household", args, keyA), new Promise((ok) => setTimeout(() => ok({ none: true }), 6000))]);
    assert.equal(r.none, undefined, `${what}: an answer arrives`);
    assert.equal(r.isError, true, `${what}: ${JSON.stringify(r.answer)}`);
    got[what] = r.answer.code ?? null;
  }
  // the base's answer is the one with no hook in front of it: `callTool` for the act, the door's own validator for a `do` that is no string
  const { callTool } = await import("../src/mcp.mjs");
  const base = await callTool("household", PLAIN[1][1], { key: keyA });
  assert.equal(got["a hostile `handle`"], base.code, `the answer the act gives with no hook: ${JSON.stringify(base)}`);
  assert.equal(got["a hostile `do`"], null, "the validator's bounce names no code, as before");
  assert.deepEqual((await rowsKept()).map((r) => r.act).sort(), ["household", "household:letter-note"],
    "both refusals are kept, each under the name that is a name: a `do` that is no string leaves the apex's own name, and a `handle` that is no string is dropped");
});

// ── 2c · AT MOST INFLIGHT_MAX AT ONCE ────────────────────────────────────────

test("a burst keeps the first few and counts the rest: no more than INFLIGHT_MAX records are in flight", { skip }, async () => {
  await fresh(); __resetForTest();
  const { noteRefusal, refusalLogSkipped, INFLIGHT_MAX } = await import("../src/refusal-log.mjs");
  for (let i = 0; i < INFLIGHT_MAX + 5; i++) noteRefusal({ key: keyA, door: "mcp", act: `world:burst-${i}`, target: {}, code: 403, defect: "d", hint: null });
  assert.equal(refusalLogSkipped(), 5, "the five over the cap were counted, not queued");
  await refusalLogSettled();
  assert.equal((await rowsKept()).length, INFLIGHT_MAX, "and only the first INFLIGHT_MAX were written");
  noteRefusal({ key: keyA, door: "mcp", act: "world:after", target: {}, code: 403, defect: "d", hint: null });
  await refusalLogSettled();
  assert.equal((await rowsKept()).length, INFLIGHT_MAX + 1, "the cap frees as records settle");
});

// ── 3 · whose, and nobody else's ─────────────────────────────────────────────

test("a household reads its own refusals, newest first, and nobody else's; `handle:` narrows to one resident", { skip }, async () => {
  await fresh(); __resetForTest();
  await mcpCall("household", { do: "letter-note", args: { letter: "first-try", state: "no-reply", handle: "a1" } }, keyA);
  await new Promise((r) => setTimeout(r, 15));
  await mcpCall("household", { do: "letter-note", args: { letter: "second-try", state: "no-reply" } }, keyA2);
  await mcpCall("household", { do: "letter-note", args: { letter: "bs-try", state: "no-reply" } }, keyB);
  const mine = await readOwnRefusals(keyA);
  assert.equal(mine.household, A);
  assert.deepEqual(mine.refusals.map((x) => x.target.letter), ["second-try", "first-try"], "newest first, and B's try is not here");
  assert.equal(mine.count, 2);
  assert.equal(mine.kept_days, RETENTION_DAYS);
  assert.ok(!JSON.stringify(mine).includes("bs-try"));
  assert.deepEqual((await readOwnRefusals(keyB)).refusals.map((x) => x.target.letter), ["bs-try"]);
  assert.deepEqual((await readOwnRefusals(keyA, { handle: "a1" })).refusals.map((x) => x.target.letter), ["first-try"]);
  await assert.rejects(readOwnRefusals(keyA, { handle: "b1" }), (e) => e.code === 403, "another house's resident is not one of yours");
  await assert.rejects(readOwnRefusals(nobody), (e) => e.code === 403, "a key in no household reads nothing");
  // paging: limit and offset walk it, and `more` says there is more
  const page = await readOwnRefusals(keyA, { limit: 1 });
  assert.equal(page.count, 1); assert.equal(page.more, true); assert.equal(page.next_offset, 1);
  assert.match(page.more_note, /offset: 1/, "the walk-on sentence names the offset (paged-reads-one-grammar)");
  assert.equal((await readOwnRefusals(keyA, { limit: 2 })).more, undefined, "a page that holds them all says no more");
  assert.deepEqual((await readOwnRefusals(keyA, { limit: 1, offset: 1 })).refusals.map((x) => x.target.letter), ["first-try"]);
  // and the door reads it: household { read: "refusals" } answers the same rows
  const viaDoor = await mcpCall("household", { read: "refusals" }, keyA);
  assert.notEqual(viaDoor.isError, true, JSON.stringify(viaDoor.answer));
  assert.deepEqual(viaDoor.answer.refusals.map((x) => x.target.letter), ["second-try", "first-try"]);
  assert.equal((await rowsKept()).length, 3, "reading refusals does not make a refusal");
});

test("a resident's own, and nobody else's: a key holding only a2 never reads a1's tries, words included; a try no resident was named for is read only by a key holding all the filing key's residents", { skip }, async () => {
  await fresh(); __resetForTest();
  await mcpCall("household", { do: "letter-note", args: { letter: "a1-try", state: "no-reply", handle: "a1" } }, keyA);
  await mcpCall("household", { do: "letter-note", args: { letter: "a2-try", state: "no-reply", handle: "a2" } }, keyA);
  await mcpCall("household", { do: "letter-note", args: { letter: "which-one-try", state: "no-reply" } }, keyA);   // keyA holds two and names none
  const kept = await rowsKept();
  assert.deepEqual(kept.map((r) => r.handle), ["a1", "a2", null]);
  const letters = async (key, o) => (await readOwnRefusals(key, o)).refusals.map((x) => x.target.letter).sort();
  assert.deepEqual(await letters(keyA), ["a1-try", "a2-try", "which-one-try"], "the key that holds both reads all three");
  assert.deepEqual(await letters(keyA2), ["a2-try"], "the key that holds only a2 reads only a2's");
  const key1 = { household: "the-aa-house", handles: new Set(["a1"]) };
  assert.deepEqual(await letters(key1), ["a1-try"]);
  assert.ok(!JSON.stringify(await readOwnRefusals(keyA2)).includes("a1-try"), "a1's try is in none of a2's answer");
  await assert.rejects(readOwnRefusals(keyA2, { handle: "a1" }), (e) => e.code === 403, "naming a resident the key does not hold reads nothing");
  await assert.rejects(readOwnRefusals({ household: "the-aa-house", handles: new Set() }), (e) => e.code === 403, "a key holding no resident reads nothing");
  // and through the door, as the key that holds a2
  const viaDoor = await mcpCall("household", { read: "refusals" }, keyA2);
  assert.deepEqual(viaDoor.answer.refusals.map((x) => x.target.letter), ["a2-try"]);
});

test("`held` is never cut: a try filed by a key holding 25 residents is read by a key holding all 25 and not by one holding the first 20; past HELD_MAX nothing is kept", { skip }, async () => {
  await fresh(); __resetForTest();
  const names = Array.from({ length: 25 }, (_, i) => `r${i + 1}`);
  await asOwner(`INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ('rr-house', 9, 'The RR House', $1::text[], '2026-10-01', 'r1')`, [names]);
  const key25 = { household: "the-rr-house", handles: new Set(names) };
  const key20 = { household: "the-rr-house", handles: new Set(names.slice(0, 20)) };
  const kept = await recordRefusal({ key: key25, door: "mcp", act: "world:k25", target: {}, handle: null, code: 403, defect: "d", hint: null });
  assert.deepEqual(kept, { recorded: true });
  assert.deepEqual((await rowsKept()).map((r) => r.act), ["world:k25"]);
  assert.equal((await asOwner("SELECT cardinality(held) AS n FROM refused_acts"))[0].n, 25, "every resident the key held is recorded");
  assert.deepEqual((await readOwnRefusals(key25)).refusals.map((x) => x.act), ["world:k25"], "the key that held all 25 reads it");
  assert.deepEqual((await readOwnRefusals(key20)).refusals, [], "the key holding only the first 20 does not: it may have been any of the other five's try");
  // a key past what a row records is not recorded at all, never cut
  const many = Array.from({ length: HELD_MAX + 1 }, (_, i) => `m${i}`);
  const over = await recordRefusal({ key: { household: "the-rr-house", handles: new Set(many) }, door: "mcp", act: "world:over", target: {}, code: 403, defect: "d", hint: null });
  assert.equal(over.recorded, false);
  assert.equal((await rowsKept()).length, 1, "nothing was written for the key past the bound");
});

test("a row no key could ever read is not kept: a signed-in visitor's refusal and a no-resident key's inside a house", { skip }, async () => {
  await fresh(); __resetForTest();
  const visitor = { household: null, ghId: 4242424, handles: new Set() };
  const noResident = { household: "the-aa-house", handles: new Set() };
  for (const [what, key] of [["a signed-in visitor", visitor], ["a key with no resident inside a house", noResident]]) {
    const r = await recordRefusal({ key, door: "mcp", act: "world:give", target: {}, code: 403, defect: "d", hint: null });
    assert.equal(r.recorded, false, what);
    assert.match(r.why, /holds no resident/, what);
  }
  assert.deepEqual(await rowsKept(), [], "no row under gh:<id> or the house");
  // CONTROL: the same call from a key that holds a resident is kept, so the empty table was not a dead writer
  assert.deepEqual(await recordRefusal({ key: keyA2, door: "mcp", act: "world:give", target: {}, code: 403, defect: "d", hint: null }), { recorded: true });
  assert.equal((await rowsKept()).length, 1);
  // and through the MCP door
  await mcpCall("household", { do: "letter-note", args: { letter: "x", state: "no-reply" } }, noResident);
  await mcpCall("household", { do: "letter-note", args: { letter: "x", state: "no-reply" } }, visitor);
  assert.equal((await rowsKept()).length, 1, "the door keeps neither");
});

test("the row policy: a household's rows are invisible to another's, to a transaction that declared none, and to the export role; office_api cannot edit or delete", { skip }, async () => {
  await fresh();
  await asOwner("INSERT INTO refused_acts (household, door, act, code, defect) VALUES ($1, 'mcp', 'world:give', 403, 'mine'), ($2, 'mcp', 'world:give', 403, 'theirs')", [A, B]);
  const seen = (setting) => asRole("office_api", setting, async (c) => (await c.query("SELECT defect FROM refused_acts ORDER BY defect")).rows.map((r) => r.defect));
  assert.deepEqual(await seen(A), ["mine"]);
  assert.deepEqual(await seen(B), ["theirs"]);
  assert.deepEqual(await seen(`${A},${B}`), ["mine", "theirs"], "a key's spelling set reads the rows it names");
  assert.deepEqual(await seen(null), [], "no household declared, no row");
  await assert.rejects(asRole("office_api", B, (c) => c.query("INSERT INTO refused_acts (household, door, act) VALUES ($1, 'mcp', 'x')", [A])), /row-level security/, "a household cannot write another's row");
  await assert.rejects(asRole("office_api", A, (c) => c.query("UPDATE refused_acts SET defect = 'edited'")), /permission denied/);
  await assert.rejects(asRole("office_api", A, (c) => c.query("DELETE FROM refused_acts")), /permission denied/);
  await assert.rejects(asRole("snapshot_reader", A, (c) => c.query("SELECT * FROM refused_acts")), /permission denied/, "no export reads it");
  assert.equal((await rowsKept()).length, 2);
});

// ── 4 · ninety days ──────────────────────────────────────────────────────────

test("ninety days: a row past it is never read and is deleted by the office, any household's; a row inside the window stays", { skip }, async () => {
  await fresh(); __resetForTest();
  await asOwner(`INSERT INTO refused_acts (household, handle, door, act, code, defect, at) VALUES
    ($1, 'a1', 'mcp', 'world:give', 403, 'a-89-days', now() - interval '89 days'),
    ($1, 'a1', 'mcp', 'world:give', 403, 'a-91-days', now() - interval '91 days'),
    ($2, 'b1', 'mcp', 'world:give', 403, 'b-120-days', now() - interval '120 days')`, [A, B]);
  assert.deepEqual((await readOwnRefusals(keyA)).refusals.map((x) => x.defect), ["a-89-days"], "the 91-day row is not read, though it is still in the table");
  assert.deepEqual((await readOwnRefusals(keyB)).refusals, [], "nor is B's");
  assert.equal((await rowsKept()).length, 3);
  // the office's next record prunes, for every household
  const kept = await recordRefusal({ key: keyA, door: "mcp", act: "world:give", target: {}, code: 403, defect: "today", hint: null });
  assert.deepEqual(kept, { recorded: true });
  assert.deepEqual((await rowsKept()).map((r) => r.defect).sort(), ["a-89-days", "today"], "both expired rows are gone; the 89-day one and today's stay");
});

// ── 5 · REST's j ─────────────────────────────────────────────────────────────

test("noteRestRefusal: a refused write is kept by its method and path, an apex act by its name and target; a GET, an apex read and a 5xx are not", { skip }, async () => {
  await fresh(); __resetForTest();
  const bounce = { error: "bounce", defect: "a refusal", hint: "its hint" };
  noteRestRefusal({ method: "POST", tel: { key: keyA, path: "/letters" } }, 422, bounce);
  await refusalLogSettled();   // INFLIGHT_MAX is 1: one record at a time
  noteRestRefusal({ method: "POST", tel: { key: keyA, path: "/world/apex", call: {}, act: { name: "world", args: { do: "give", args: { to: "a2", text: SECRET } } } } }, 409, bounce);
  // controls: each of these must keep nothing
  noteRestRefusal({ method: "GET", tel: { key: keyA, path: "/world" } }, 404, bounce);
  noteRestRefusal({ method: "POST", tel: { key: keyA, path: "/world/apex", call: {} } }, 422, bounce);   // an apex read
  noteRestRefusal({ method: "POST", tel: { key: keyA, path: "/letters" } }, 500, bounce);
  noteRestRefusal({ method: "POST", tel: { key: keyA, path: "/letters" } }, 429, bounce);
  noteRestRefusal({ method: "POST", tel: { key: null, path: "/letters" } }, 401, bounce);
  noteRestRefusal({ method: "POST", tel: { key: keyA, path: "/letters" } }, 422, { fine: true });
  await refusalLogSettled();
  const rows = await rowsKept();
  assert.deepEqual(rows.map((r) => [r.door, r.act, r.code]), [["rest", "POST /letters", 422], ["rest", "world:give", 409]]);
  assert.deepEqual(rows[1].target, { to: "a2" });
  assert.ok(!JSON.stringify(rows).includes(SECRET));
});

async function startOffice() {
  writeFileSync(join(tmp, "roles.db"), "");
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0",
    "--oauth-db", seedStaticKeys(join(tmp, "oauth.db"), `${KEY}=fixture-house:wright`), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, "voices.jsonl"),
      TOWN_PUSH: "", WORLD_APEX: "1", WORLD_STORE_DB: join(tmp, "no-world.db"), ...ix.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(`the office never listened: ${stderr.slice(-600)}`)), 30_000);
    child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) { clearTimeout(t); ok({ child, base: `http://127.0.0.1:${m[1]}`, stderr: () => stderr }); } });
    child.on("exit", (c) => no(new Error(`the office exited early (${c}): ${stderr.slice(-600)}`)));
  });
}
const send = (method, path, body) => fetch(`${office.base}${path}`, { method,
  headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

test("the real office's j keeps a refused write and its apex act, and not a refused read: one spawned office, three doors", { skip }, async () => {
  await fresh();
  office = await startOffice();
  // controls first: a refused GET and a refused apex READ keep nothing
  const get = await send("GET", "/no-such-route");
  assert.ok(get.status >= 400, `a refused GET: ${get.status}`);
  const readRefused = await send("POST", "/world/apex", { read: "no-such-read" });
  assert.ok(readRefused.status >= 400, `a refused apex read: ${readRefused.status} ${JSON.stringify(readRefused.body)}`);
  // the refused writes
  const apex = await send("POST", "/world/apex", { do: "no-such-act", not_a_field: 1, args: { to: "someone", text: SECRET } });
  assert.ok(apex.status >= 400 && apex.status < 500, `a refused apex act: ${apex.status} ${JSON.stringify(apex.body)}`);
  await until(async () => (await rowsKept()).length >= 1, "the first refusal kept (one record at a time)");
  const letter = await send("POST", "/letters", { not_a_field: 1 });
  assert.ok(letter.status >= 400 && letter.status < 500, `a refused letter: ${letter.status} ${JSON.stringify(letter.body)}`);
  const rows = await until(async () => { const r = await rowsKept(); return r.length >= 2 ? r : null; }, "two refused writes kept");
  await new Promise((r) => setTimeout(r, 400));   // a late third row would show here
  const after2 = await rowsKept();
  assert.equal(after2.length, 2, `only the two writes: ${JSON.stringify(after2.map((r) => r.act))}`);
  const byAct = Object.fromEntries(after2.map((r) => [r.act, r]));
  assert.deepEqual(Object.keys(byAct).sort(), ["POST /letters", "world:no-such-act"]);
  assert.equal(byAct["world:no-such-act"].household, "hh:fixture-house");
  assert.equal(byAct["world:no-such-act"].handle, "wright");
  assert.equal(byAct["world:no-such-act"].door, "rest");
  assert.equal(byAct["world:no-such-act"].code, apex.status);
  assert.deepEqual(byAct["world:no-such-act"].target, { to: "someone" });
  assert.equal(byAct["POST /letters"].code, letter.status);
  assert.ok(!JSON.stringify(after2).includes(SECRET));
  assert.equal(rows.length >= 2, true);
  // and the household reads them back through its own read, over REST
  const back = await send("POST", "/household", { read: "refusals" });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.deepEqual(back.body.refusals.map((x) => x.act).sort(), ["POST /letters", "world:no-such-act"]);
  // THE REST HOOK NEVER THROWS (the review of #1074): a `do` or `handle` that will not stringify is still answered, as the base answered it
  const hostile = async (body) => Promise.race([send("POST", "/household", body), new Promise((ok) => setTimeout(() => ok({ none: true }), 6000))]);
  const odd = await hostile(JSON.parse('{"do":{"toString":1}}'));
  assert.equal(odd.none, undefined, "a hostile `do`: an answer arrives");
  assert.equal(odd.status, 500, `the base's 500 bounce: ${JSON.stringify(odd.body)}`);
  const oddHandle = await hostile(JSON.parse('{"do":"letter-note","args":{"letter":"no-such-letter","state":"no-reply","handle":{"toString":1}}}'));
  assert.equal(oddHandle.none, undefined, "a hostile `handle`: an answer arrives");
  const { callTool } = await import("../src/mcp.mjs");
  const baseHandle = await callTool("household", { do: "letter-note", args: { letter: "no-such-letter", state: "no-reply", handle: JSON.parse('{"toString":1}') } }, { key: { household: "fixture-house", handles: new Set(["wright"]) } });
  assert.equal(oddHandle.status, baseHandle.code, `the act's own answer with no hook in front of it: ${JSON.stringify(baseHandle)}`);
  await refusalLogSettled();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await rowsKept()).length, 3, "the 500 kept nothing; the refused act with the hostile handle kept one row (the handle dropped, being no name)");
  office.child.kill();
});

// ── 6 · a store without 098 ──────────────────────────────────────────────────
// Last in the file, because it drops the table: the store's own answer for a missing relation, not a stub's.

test("a store that has not taken 098: the read says so and never answers none, the record says why it kept nothing, and the act is untouched", { skip }, async () => {
  __resetForTest();
  await asOwner("DROP FUNCTION refused_acts_prune()");
  await asOwner("DROP TABLE refused_acts");
  const read = await readOwnRefusals(keyA);
  assert.equal(read.refusals, null);
  assert.equal(read.count, null);
  assert.match(read.unavailable, /not kept on this office's record yet/);
  const kept = await recordRefusal({ key: keyA, door: "mcp", act: "world:give", target: {}, code: 403, defect: "d", hint: null });
  assert.equal(kept.recorded, false);
  assert.match(kept.why, /migration 098/);
  // the act's own answer is the refusal it always was
  const r = await mcpCall("household", { do: "letter-note", args: { letter: "no-such-letter", state: "no-reply" } }, keyA);
  assert.equal(r.answer.code, 403);
});

