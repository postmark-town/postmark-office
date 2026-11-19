// world-live-parcel.test.mjs — POS-686: an own-parcel amendment and a dependency-free withdrawal, laid over canon for every viewer.
//
//   node --test test/world-live-parcel.test.mjs
//
// The rules are pure and held on hand-built rows; the SQL that finds the owed edits is run on a real store ("a round trip through a JS stub
// is not a round trip through Postgres"); the readers it is wired into are in world-live-parcel-wiring.test.mjs. What would failure look like:
// a market or constitution mark's author's words or removal served live (Darko: common-ground market marks stay settled); a stale canon
// body served after the amendment; a withdrawn mark still served; a refused claim still showing; an overlay that changes any mark but the
// one edited (or its identity when nothing is owed, which keeps every identity-keyed cache hitting); an act of somebody else's removing a
// mark; a later re-leave not cancelling a withdrawal; an edit that stops showing because it is old; a request that reads the store's
// whole history.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  editsFrom, overlayMarks, patchServed, editedIds, liveEdits, liveMarks, liveParcelStats, liveScope, liveBypass, ownParcel, watchSql, owedSql,
} from "../src/world-live-parcel.mjs";

const canon = () => [
  { id: "wright/the-drafting-table", kind: "sited", by: "wright", tier: "home", body: "A tilted sheet of working drawings.", at: { x: 1, y: 1 } },
  { id: "wright/the-keystone", kind: "sited", by: "wright", tier: "home", body: "A keystone.", at: { x: 2, y: 2 } },
  { id: "wright/the-yard", kind: "parcel", by: "wright", tier: "home", body: "The yard.", at: { x: 0, y: 0 } },
  { id: "alden/the-alder-at-the-green-lamp", kind: "sited", by: "alden", tier: "market", body: "An alder.", at: { x: 3, y: 3 } },
  { id: "the-town/the-town-centre", kind: "sited", by: "the-town", tier: "constitution", body: "The Centre.", at: { x: 4, y: 4 } },
  { id: "ada/a-lamp", kind: "sited", by: "ada", tier: "home", body: "A lamp.", at: { x: 5, y: 5 } },
];
const amend = (object, body, claim_status = "pending") => ({ object, action: "amend", act_id: 10, crossing: 320, claim_id: "c1", claim_status, body });
const withdraw = (object) => ({ object, action: "withdraw", act_id: 11, crossing: 320, claim_id: null, claim_status: null, body: null });

test("1 · an own-parcel amendment replaces the body of the one mark and nothing else", () => {
  const marks = canon();
  const e = editsFrom([amend("wright/the-drafting-table", "A new sheet.")], marks);
  assert.ok(e.key);
  const out = overlayMarks(marks, e);
  assert.equal(out[0].body, "A new sheet.");
  assert.deepEqual(out[0].at, { x: 1, y: 1 }, "geometry stays canon's");
  for (let i = 1; i < marks.length; i++) assert.strictEqual(out[i], marks[i], "an untouched mark is canon's own reference");
  assert.equal(marks[0].body, "A tilted sheet of working drawings.", "canon itself is not edited");
});

test("2 · an own-parcel withdrawal removes the mark from what is served; canon's array is untouched", () => {
  const marks = canon();
  const out = overlayMarks(marks, editsFrom([withdraw("wright/the-keystone")], marks));
  assert.ok(!out.some((m) => m.id === "wright/the-keystone"));
  assert.equal(marks.length, 6);
});

test("3 · THE MARKET PROBE: an author's own market or constitution mark stays settled, however lawfully the act was filed; the own-parcel mark beside it goes live", () => {
  const marks = canon();
  const rows = [
    amend("alden/the-alder-at-the-green-lamp", "SYNTHETIC LIVE BODY"), withdraw("alden/the-alder-at-the-green-lamp"),
    amend("the-town/the-town-centre", "SYNTHETIC CENTRE BODY"), withdraw("the-town/the-town-centre"),
  ];
  assert.equal(editsFrom(rows, marks).key, "", "no edit at all on common ground");
  assert.strictEqual(overlayMarks(marks, editsFrom(rows, marks)), marks);
  const both = editsFrom([...rows, amend("wright/the-drafting-table", "A new sheet.")], marks);
  assert.deepEqual([...both.bodies.keys()], ["wright/the-drafting-table"], "the positive is the only edit");
  assert.equal(both.removed.size, 0);
  assert.equal(ownParcel(marks[0]), true); assert.equal(ownParcel(marks[3]), false); assert.equal(ownParcel(marks[4]), false);
});

test("4 · a parcel is ground: its words may be amended, it is never withdrawn live (a ground change)", () => {
  const marks = canon();
  const e = editsFrom([amend("wright/the-yard", "The yard, replanted."), withdraw("wright/the-yard")], marks);
  assert.equal(e.bodies.get("wright/the-yard"), "The yard, replanted.");
  assert.equal(e.removed.size, 0);
});

test("5 · nothing owed is canon's own object, whatever the rows say about marks canon does not hold (identity-keyed caches keep hitting)", () => {
  const marks = canon();
  for (const rows of [[], null, [amend("wright/the-drafting-table", marks[0].body)], [amend("nobody/not-in-canon", "x")], [amend("wright/the-keystone", "x", null)]]) {
    const e = editsFrom(rows, marks);
    assert.equal(e.key, "", JSON.stringify(rows));
    assert.strictEqual(overlayMarks(marks, e), marks);
  }
});

test("6 · the overlaid copy is built once per (canon, edit set); a different edit is a different key, never the old body", () => {
  const marks = canon();
  const a = editsFrom([amend("wright/the-drafting-table", "A new sheet.")], marks);
  const b = editsFrom([amend("wright/the-drafting-table", "A new sheet.")], marks);
  assert.strictEqual(overlayMarks(marks, a), overlayMarks(marks, b));
  const c = editsFrom([amend("wright/the-drafting-table", "A newer sheet.")], marks);
  assert.notStrictEqual(overlayMarks(marks, c), overlayMarks(marks, a));
  assert.equal(overlayMarks(marks, c)[0].body, "A newer sheet.");
});

test("7 · a claim the candle refused or the author retracted shows nothing; a locked one still does (canon has not carried it yet)", () => {
  const marks = canon();
  assert.equal(editsFrom([amend("wright/the-drafting-table", "x", null)], marks).key, "");
  assert.equal(overlayMarks(marks, editsFrom([amend("wright/the-drafting-table", "Locked.", "locked")], marks))[0].body, "Locked.");
});

test("8 · patchServed: the edited body wherever an answer carries it, a withdrawn mark gone from its lists, a withdrawn focus is no mark, untouched answers are the same object", () => {
  const marks = canon();
  const e = editsFrom([amend("wright/the-drafting-table", "A new sheet."), withdraw("wright/the-keystone")], marks);
  const answer = { id: "ada/a-lamp", body: "A lamp.", alongside: [{ id: "wright/the-drafting-table", body: "A tilted sheet of working drawings." }, { id: "wright/the-keystone", body: "A keystone." }, { id: "ada/other", body: "x" }], note: "kept" };
  const out = patchServed(answer, e, "ada/a-lamp");
  assert.deepEqual(out.alongside.map((m) => [m.id, m.body]), [["wright/the-drafting-table", "A new sheet."], ["ada/other", "x"]]);
  assert.equal(out.note, "kept"); assert.equal(answer.alongside.length, 3, "the engine's answer is not edited in place");
  assert.equal(patchServed({ id: "wright/the-keystone", body: "A keystone." }, e, "wright/the-keystone"), null);
  assert.equal(patchServed({ id: "wright/the-drafting-table", body: "old" }, e, "wright/the-drafting-table").body, "A new sheet.");
  const same = { id: "ada/a-lamp", body: "A lamp.", alongside: [{ id: "ada/other", body: "x" }] };
  assert.strictEqual(patchServed(same, e, "ada/a-lamp"), same);
  assert.strictEqual(patchServed(answer, { bodies: new Map(), removed: new Set(), key: "" }, "ada/a-lamp"), answer);
});

test("9 · editedIds names what moved", () => {
  const marks = canon();
  const e = editsFrom([amend("wright/the-drafting-table", "n"), withdraw("wright/the-keystone")], marks);
  assert.deepEqual([...editedIds(e)].sort(), ["wright/the-drafting-table", "wright/the-keystone"]);
});

// ── the snapshot, the watch and the rescan (the store's read, counted) ─────────────────────────────────────────────

/** A store answering the two statements the layer makes, counting them. */
function fakeStore({ watch = { mark_act: 5, window_top: 321, window_closed: 320, clearing: 0 }, rows = () => [] } = {}) {
  const s = { watches: 0, scans: 0, watch: { ...watch }, rows };
  s.query = async (sql, params) => {
    if (sql === watchSql) { s.watches += 1; return [s.watch]; }
    if (sql === owedSql) { s.scans += 1; s.lastIds = params[0]; return s.rows(); }
    throw new Error("unexpected statement");
  };
  return s;
}

test("10 · a request reads the watch once however many times the world is asked for; the owed set is rescanned only when the store's facts moved", async () => {
  const marks = canon();
  const st = fakeStore({ rows: () => [withdraw("wright/the-keystone")] });
  await liveScope(async () => { for (let i = 0; i < 44; i++) await liveEdits(marks, { query: st.query }); });
  assert.deepEqual([st.watches, st.scans], [1, 1], "44 asks: one watch, one scan");
  await liveScope(async () => { await liveEdits(marks, { query: st.query }); await liveEdits(marks, { query: st.query }); });
  assert.deepEqual([st.watches, st.scans], [2, 1], "another request: its own watch, the same owed set (the facts did not move)");
  st.watch.mark_act = 6;
  await liveScope(() => liveEdits(marks, { query: st.query }));
  assert.deepEqual([st.watches, st.scans], [3, 2], "a new mark act: one rescan");
  st.watch.window_closed = 321; st.watch.window_top = 322;
  await liveScope(() => liveEdits(marks, { query: st.query }));
  assert.equal(st.scans, 3, "a clearing (a window closed): one rescan");
  await liveScope(() => liveEdits(canon(), { query: st.query }));
  assert.equal(st.scans, 4, "another canon: one rescan");
});

test("11 · the candidates are canon's own-parcel marks only: common ground is never asked about", async () => {
  const marks = canon();
  const st = fakeStore();
  await liveEdits(marks, { query: st.query });
  assert.deepEqual(st.lastIds.sort(), ["ada/a-lamp", "wright/the-drafting-table", "wright/the-keystone", "wright/the-yard"]);
});

test("12 · a request that writes an edit reads the watch afresh; no scope reads every time; two requests never share a snapshot", async () => {
  const marks = canon();
  const st = fakeStore();
  await liveScope(async () => { await liveEdits(marks, { query: st.query }); await liveEdits(marks, { query: st.query }); liveBypass(); await liveEdits(marks, { query: st.query }); await liveEdits(marks, { query: st.query }); });
  assert.equal(st.watches, 3);
  st.watches = 0;
  await liveEdits(marks, { query: st.query }); await liveEdits(marks, { query: st.query });
  assert.equal(st.watches, 2);
  st.watches = 0;
  await Promise.all([liveScope(() => liveEdits(marks, { query: st.query })), liveScope(() => liveEdits(marks, { query: st.query }))]);
  assert.equal(st.watches, 2);
});

test("13 · each house keeps its own authors' rows out of the one read; the edit set of a snapshot is built once per (owners, canon)", async () => {
  const marks = canon();
  const st = fakeStore({ rows: () => [withdraw("wright/the-keystone"), amend("ada/a-lamp", "B")] });
  const [all, w, a, n, w2] = await liveScope(async () => [
    await liveEdits(marks, { query: st.query }), await liveEdits(marks, { query: st.query, owners: ["wright"] }), await liveEdits(marks, { query: st.query, owners: ["ada"] }),
    await liveEdits(marks, { query: st.query, owners: ["little-bird"] }), await liveEdits(marks, { query: st.query, owners: ["wright"] })]);
  assert.equal(st.scans, 1);
  assert.deepEqual([...all.removed], ["wright/the-keystone"]); assert.equal(all.bodies.get("ada/a-lamp"), "B");
  assert.deepEqual([...w.removed], ["wright/the-keystone"]); assert.equal(w.bodies.size, 0);
  assert.equal(a.bodies.get("ada/a-lamp"), "B"); assert.equal(a.removed.size, 0);
  assert.equal(n.key, "");
  assert.strictEqual(w, w2, "built once per (owners, canon)");
});

test("14 · a store that cannot answer is no overlay, counted, never a failed read", async () => {
  const marks = canon();
  const before = liveParcelStats.failures;
  const e = await liveEdits(marks, { query: async () => { throw new Error("store down"); } });
  assert.equal(e.key, "");
  assert.equal(liveParcelStats.failures, before + 1);
  const { marks: served } = await liveMarks(marks, { query: async () => { throw new Error("store down"); } });
  assert.strictEqual(served, marks);
});

test("15 · no age policy and no history scan are written into the SQL", () => {
  for (const sql of [watchSql, owedSql]) assert.doesNotMatch(sql, /interval|now\(\)|settlements|window_id\s*-|crossing\s*>=/i, "no clock, no settlement row, no window bound");
  assert.match(owedSql, /unnest\(\$1::text\[\]\)/, "bounded by the candidates, not by history");
  assert.match(owedSql, /ORDER BY a\.id DESC LIMIT 1/);
});

// ── the SQL, on a real store ────────────────────────────────────────────────
import { startStore } from "./helpers/embedded-store.mjs";

let store = null;
before(async () => { store = await startStore({ db: "live_parcel_test" }); });
after(async () => { await store?.stop?.(); });

const owner = async (fn) => { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } };

async function seed({ acts = [], claims = [], windows = [[319, "closed"], [320, "closed"], [321, "open"]] }) {
  await owner(async (c) => {
    await c.query("TRUNCATE claims, windows, settlements, acts RESTART IDENTITY CASCADE");
    for (const [id, status] of windows) {
      await c.query(`INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, '2026-11-01T00:00:00Z'::timestamptz + ($1 - 319) * interval '12 hours', '2026-11-01T00:00:00Z'::timestamptz + ($1 - 318) * interval '12 hours', $2)`, [id, status]);
    }
    for (const a of acts) {
      await c.query(`INSERT INTO acts (at, crossing, actor, action, object, class) VALUES (now(), $1, $2, $3, $4, $5)`, [a.crossing ?? 321, a.actor, a.action, a.object, a.class ?? "mark"]);
    }
    for (const k of claims) {
      await c.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, stake, data, slug) VALUES ($1, 'sited', $2, 'hh:starforge', $3, $4, '{}', 0, '{}', $5)`, [k.window ?? 321, k.claimant ?? "wright", k.status ?? "pending", k.body, k.slug]);
    }
  });
}
const query = async (sql, params) => owner(async (c) => (await c.query(sql, params)).rows);
const ask = (marks, owners = null) => liveEdits(marks, { query: (s, p) => query(s, p), owners });

test("16 · the store: the owner's newest act decides; an amend carries the claim's body", async () => {
  await seed({
    acts: [{ actor: "wright", action: "leave-mark", object: "wright/the-drafting-table" }, { actor: "wright", action: "amend", object: "wright/the-drafting-table" }, { actor: "wright", action: "withdraw", object: "wright/the-keystone" }],
    claims: [{ slug: "wright/the-drafting-table", body: "A new sheet." }],
  });
  const e = await ask(canon());
  assert.equal(e.bodies.get("wright/the-drafting-table"), "A new sheet.");
  assert.deepEqual([...e.removed], ["wright/the-keystone"]);
});

test("17 · only the owner's own acts count: somebody else's withdraw removes nothing", async () => {
  await seed({ acts: [{ actor: "the-town", action: "withdraw", object: "wright/the-keystone" }, { actor: "ada", action: "withdraw", object: "wright/the-drafting-table" }] });
  assert.equal((await ask(canon())).key, "");
});

test("18 · a later re-leave by the author cancels the withdrawal (the crossing's own rule)", async () => {
  await seed({ acts: [{ actor: "wright", action: "withdraw", object: "wright/the-keystone" }, { actor: "wright", action: "leave-mark", object: "wright/the-keystone" }] });
  assert.equal((await ask(canon())).key, "");
});

test("19 · a refused or retracted claim stops showing; a pending one shows", async () => {
  const acts = [{ actor: "wright", action: "amend", object: "wright/the-drafting-table" }];
  for (const status of ["refused", "retracted"]) {
    await seed({ acts, claims: [{ slug: "wright/the-drafting-table", body: "x", status }] });
    assert.equal((await ask(canon())).key, "", status);
  }
  await seed({ acts, claims: [{ slug: "wright/the-drafting-table", body: "Pending body.", status: "pending" }] });
  assert.equal((await ask(canon())).bodies.get("wright/the-drafting-table"), "Pending body.");
});

test("20 · NO EXPIRY: an owed edit filed many crossings ago, with no settlement row at all, is still served until the store stops owing it", async () => {
  await seed({
    windows: [[100, "closed"], [101, "closed"], [321, "open"]],
    acts: [{ actor: "wright", action: "withdraw", object: "wright/the-keystone", crossing: 3 }, { actor: "wright", action: "amend", object: "wright/the-drafting-table", crossing: 5 }],
    claims: [{ slug: "wright/the-drafting-table", body: "An old pending amendment, stranded in a closed window.", window: 100 }],
  });
  const e = await ask(canon());
  assert.deepEqual([...e.removed], ["wright/the-keystone"], "a withdrawal owed since crossing 3");
  assert.equal(e.bodies.get("wright/the-drafting-table"), "An old pending amendment, stranded in a closed window.");
  // and it stops by the store's own facts: the author re-leaves, the claim is refused
  await owner((c) => c.query("INSERT INTO acts (at, crossing, actor, action, object, class) VALUES (now(), 321, 'wright', 'leave-mark', 'wright/the-keystone', 'mark')"));
  await owner((c) => c.query("UPDATE claims SET status = 'retracted' WHERE slug = 'wright/the-drafting-table'"));
  assert.equal((await ask(canon())).key, "");
});

test("21 · an act that is not a mark act is not read; the watch moves with a mark act and with a clearing, and with nothing else", async () => {
  await seed({ acts: [{ actor: "wright", action: "withdraw", object: "wright/the-keystone", class: "voice" }] });
  assert.equal((await ask(canon())).key, "");
  const w = async () => JSON.stringify((await query(watchSql, []))[0]);
  const w0 = await w();
  await owner((c) => c.query("INSERT INTO acts (at, crossing, actor, action, object, class) VALUES (now(), 321, 'ada', 'say', null, 'voice')"));
  assert.equal(await w(), w0, "a voice act is not a mark fact");
  await owner((c) => c.query("INSERT INTO acts (at, crossing, actor, action, object, class) VALUES (now(), 321, 'wright', 'withdraw', 'wright/the-keystone', 'mark')"));
  const w1 = await w();
  assert.notEqual(w1, w0, "a mark act moves it");
  await owner((c) => c.query("UPDATE windows SET status = 'closed' WHERE id = 321"));
  await owner((c) => c.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (322, '2026-11-01T00:00:00Z'::timestamptz + (322 - 319) * interval '12 hours', '2026-11-01T00:00:00Z'::timestamptz + (322 - 318) * interval '12 hours', 'open')"));
  assert.notEqual(await w(), w1, "a clearing moves it");
});
