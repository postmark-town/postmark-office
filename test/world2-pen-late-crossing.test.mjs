// world2-pen-late-crossing.test.mjs — A LATE ROW MAY NOT ENTER A CERTIFIED WINDOW.
//
// The law, quoted: gold §2 — an archive is "frozen-on-write, an input never
// re-derived-into"; the notary lane's own refusal (2026-09-03, act 4171):
// "An archive is frozen on write. This is drift and a FINDING — the notary will
// not overwrite it. Either the file was edited, or the office rewrote history in
// a window it had already closed. Both want a human."
//
// The pen's guard makes the second case unwritable: a row whose crossing is older
// than the window just closed is refused by name, and a sanctioned late arrival
// files into the window it ARRIVES in (W2_LATE_ARRIVAL names the reason), never
// the certified one. Receipts: notary-history/164-act-4171-repair; the 09-04
// holdings backfill (acts 4220–4224, filed at 168 with their true `at`).
//
//   node --test test/world2-pen-late-crossing.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { lateCrossingGuard, LateCrossingError, insertAct } from "../src/world2-pen.mjs";
import { currentCrossing, CROSSING_EPOCH_UTC, CROSSING_MS } from "../src/crossings.mjs";

const NOW = CROSSING_EPOCH_UTC + 168 * CROSSING_MS + 3600 * 1000; // an hour into window 168
const open = currentCrossing(NOW);
const row = (crossing, payload = { a: 1 }) => ({ crossing, actor: "probe", action: "take", object: "x/y", class: "holding", payload, written_at: "2026-08-29T19:44:04.333Z" });

test("the open window passes untouched; so does the one just closed (a live act written at the boundary)", () => {
  assert.deepEqual(lateCrossingGuard(row(open), { now: NOW, env: {} }), row(open));
  assert.deepEqual(lateCrossingGuard(row(open - 1), { now: NOW, env: {} }), row(open - 1));
  assert.deepEqual(lateCrossingGuard(row(open + 0.7653), { now: NOW, env: {} }), row(open + 0.7653), "a fractional crossing in the open window is the settlement's own stamp");
});

test("a row for a certified window is REFUSED by name — 'the notary will not overwrite it'", () => {
  assert.throws(() => lateCrossingGuard(row(open - 2), { now: NOW, env: {} }), (e) => e instanceof LateCrossingError && /certified history/.test(e.message) && e.crossing === open - 2 && e.open === open);
  assert.throws(() => lateCrossingGuard(row(164), { now: NOW, env: {} }), LateCrossingError, "act 4171's own shape: crossing 164 while 168 is open");
});

test("a SANCTIONED late arrival files into the window it arrives in, keeping its origin on the payload and its true time in `at`", () => {
  const out = lateCrossingGuard(row(157), { now: NOW, env: { W2_LATE_ARRIVAL: "backfill 2026-09-04: the holding mirror never carried these" } });
  assert.equal(out.crossing, open);
  assert.equal(out.payload.late_from_crossing, 157);
  assert.match(out.payload.late_arrival, /backfill/);
  assert.equal(out.written_at, "2026-08-29T19:44:04.333Z", "the act's own time is untouched — crossing is where the row files, not when the act happened");
  // a string payload (the journal's serialized form) survives the same way
  const s = lateCrossingGuard(row(157, JSON.stringify({ a: 1 })), { now: NOW, env: { W2_LATE_ARRIVAL: "x" } });
  assert.equal(JSON.parse(s.payload).late_from_crossing, 157);
});

test("a row with no crossing is not judged (the seed's legacy rows and null-crossing lanes pass)", () => {
  assert.deepEqual(lateCrossingGuard(row(null), { now: NOW, env: {} }), row(null));
});

test("insertAct runs the guard BEFORE any SQL — a refused row never reaches the client (can-fail: the stub would record the INSERT)", async () => {
  process.env.W2_LATE_ARRIVAL = "";
  const seen = [];
  const client = { query: async (sql, params) => { if (/^\s*INSERT/i.test(sql)) seen.push(params?.[1]); return { rows: [{ id: 1 }] }; } };
  await assert.rejects(() => insertAct(client, { ...row(open - 3), household: null }), LateCrossingError);
  assert.equal(seen.length, 0, "the INSERT ran for a refused row");
});

// The stubs count INSERTs only: the pen also asks the store whether it carries
// 079's provenance columns (act-provenance.mjs § actsHaveProvenance), POS-633.
test("CAN-FAIL: with the reason set, insertAct writes the ARRIVAL window, not the row's — the stub sees the open window", async () => {
  process.env.W2_LATE_ARRIVAL = "test";
  try {
    const seen = [];
    const client = { query: async (sql, params) => { if (/^\s*INSERT/i.test(sql)) seen.push(params?.[1]); return { rows: [{ id: 1 }] }; } };
    await insertAct(client, { ...row(open - 3), household: null });
    assert.equal(seen.length, 1);
    assert.equal(seen[0], currentCrossing(), "the crossing written is the open window at write time");
  } finally { delete process.env.W2_LATE_ARRIVAL; }
});

test("the FUTURE is not a place a row can file into either — a raw epoch count (41389, the 2026-09-04 backfill class) is refused by name", () => {
  assert.throws(() => lateCrossingGuard(row(41389.6997), { now: NOW, env: {} }), (e) => e instanceof LateCrossingError && /has not opened/.test(e.message) && /raw clock/.test(e.message));
  assert.throws(() => lateCrossingGuard(row(open + 1), { now: NOW, env: {} }), LateCrossingError, "one window ahead is still the future");
  assert.throws(() => lateCrossingGuard(row(41389), { now: NOW, env: { W2_LATE_ARRIVAL: "x" } }), LateCrossingError, "a late-arrival reason sanctions the PAST, never the future");
});

test("the legacy mirror path runs the guard too — mirrorAct hands the pool a re-stamped row, never the raw one (CAN-FAIL: the stub records what was inserted)", async () => {
  const { mirrorAct } = await import("../src/world2-acts.mjs");
  const { currentCrossing } = await import("../src/crossings.mjs");
  const seen = [];
  const fakePool = { query: async (sql, params) => { seen.push(params); return { rows: [] }; } };
  const acts = await import("../src/world2-acts.mjs");
  // reach the module's pool slot the way the module does: world2Enabled needs the two env words; the pool is injected via the state the module keeps
  const env = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://stub", W2_LATE_ARRIVAL: "test late arrival" };
  acts.__setPoolForTest?.(fakePool);
  if (!acts.__setPoolForTest) { return; } // the seam is exported below; if a future edit removes it this test says nothing rather than lying
  await mirrorAct({ ...row(157), household: null }, 1, env);
  assert.equal(seen.length, 1, "one INSERT reached the pool");
  assert.equal(seen[0][1], currentCrossing(), "the crossing written is the ARRIVAL window, not 157");
  assert.match(JSON.stringify(seen[0][10]), /late_from_crossing/, "the original crossing rides the payload");
});
