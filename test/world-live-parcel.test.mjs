// world-live-parcel.test.mjs — POS-686: an own-parcel amendment and a dependency-free withdrawal, laid over canon for every viewer.
//
//   node --test test/world-live-parcel.test.mjs
//
// The rules are pure and held on hand-built rows; the one SQL that finds the owed edits is run on a real store, because "a round
// trip through a JS stub is not a round trip through Postgres". What would failure look like: a stale canon body served after the
// amendment; a withdrawn mark still in the read; a refused claim still showing; an overlay that changes any mark but the one edited
// (or its identity when nothing is owed, which is what keeps every identity-keyed cache hitting); an act of somebody else's
// removing a mark; a later re-leave of the author's not cancelling the withdrawal.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { editsFrom, overlayMarks, editedIds, liveEdits, liveMarks, liveParcelStats, markEditsSql, liveScope, liveBypass } from "../src/world-live-parcel.mjs";
import { stakesFor } from "../src/doorstep-stakes.mjs";

const canon = () => [
  { id: "wright/the-drafting-table", kind: "sited", by: "wright", body: "A tilted sheet of working drawings.", at: { x: 1, y: 1 } },
  { id: "wright/the-keystone", kind: "sited", by: "wright", body: "A keystone.", at: { x: 2, y: 2 } },
  { id: "ada/a-lamp", kind: "sited", by: "ada", body: "A lamp.", at: { x: 3, y: 3 } },
];
const amend = (object, body, claim_status = "pending") => ({ object, action: "amend", act_id: 10, crossing: 320, claim_id: "c1", claim_status, body });
const withdraw = (object) => ({ object, action: "withdraw", act_id: 11, crossing: 320, claim_id: null, claim_status: null, body: null });

test("1 · an amendment replaces the body of the one mark and nothing else", () => {
  const marks = canon();
  const e = editsFrom([amend("wright/the-drafting-table", "A new sheet.")], marks);
  assert.ok(e.key);
  const out = overlayMarks(marks, e);
  assert.equal(out.find((m) => m.id === "wright/the-drafting-table").body, "A new sheet.");
  assert.deepEqual(out.find((m) => m.id === "wright/the-drafting-table").at, { x: 1, y: 1 }, "geometry stays canon's");
  assert.strictEqual(out[1], marks[1], "an untouched mark is canon's own reference");
  assert.strictEqual(out[2], marks[2]);
  assert.equal(marks[0].body, "A tilted sheet of working drawings.", "canon itself is not edited");
});

test("2 · a withdrawal removes the mark from the read; canon's array is untouched", () => {
  const marks = canon();
  const out = overlayMarks(marks, editsFrom([withdraw("wright/the-keystone")], marks));
  assert.deepEqual(out.map((m) => m.id), ["wright/the-drafting-table", "ada/a-lamp"]);
  assert.equal(marks.length, 3);
});

test("3 · nothing owed is canon's own object (identity-keyed caches keep hitting)", () => {
  const marks = canon();
  for (const rows of [[], null, [amend("wright/the-drafting-table", marks[0].body)], [amend("nobody/not-in-canon", "x")], [amend("wright/the-keystone", "x", null)]]) {
    const e = editsFrom(rows, marks);
    assert.equal(e.key, "", JSON.stringify(rows));
    assert.strictEqual(overlayMarks(marks, e), marks);
  }
});

test("4 · the overlaid copy is built once per (canon, edit set): the same array for every reader", () => {
  const marks = canon();
  const e1 = editsFrom([amend("wright/the-drafting-table", "A new sheet.")], marks);
  const e2 = editsFrom([amend("wright/the-drafting-table", "A new sheet.")], marks);
  assert.strictEqual(overlayMarks(marks, e1), overlayMarks(marks, e2));
  const e3 = editsFrom([amend("wright/the-drafting-table", "A newer sheet.")], marks);
  assert.notStrictEqual(overlayMarks(marks, e3), overlayMarks(marks, e1), "a different edit is a different key, never the old body");
  assert.equal(overlayMarks(marks, e3)[0].body, "A newer sheet.");
});

test("5 · a claim the candle refused or the author retracted shows nothing; a locked one still does (canon has not carried it yet)", () => {
  const marks = canon();
  assert.equal(editsFrom([amend("wright/the-drafting-table", "x", null)], marks).key, "", "no live claim row: no body to show");
  const locked = editsFrom([amend("wright/the-drafting-table", "Locked body.", "locked")], marks);
  assert.equal(overlayMarks(marks, locked)[0].body, "Locked body.");
});

test("6 · editedIds names what moved (a reader serving one house asks whether any of its own did)", () => {
  const marks = canon();
  const e = editsFrom([amend("wright/the-drafting-table", "n"), withdraw("wright/the-keystone")], marks);
  assert.deepEqual([...editedIds(e)].sort(), ["wright/the-drafting-table", "wright/the-keystone"]);
});

test("7 · a store that cannot answer is no overlay, counted, never a failed read", async () => {
  const marks = canon();
  const before = liveParcelStats.failures;
  const e = await liveEdits(marks, 1, { query: async () => { throw new Error("store down"); } });
  assert.equal(e.key, "");
  assert.equal(liveParcelStats.failures, before + 1);
  const { marks: served } = await liveMarks(marks, 1, { query: async () => { throw new Error("store down"); } });
  assert.strictEqual(served, marks);
});

// ── the SQL, on a real store ────────────────────────────────────────────────
import { startStore } from "./helpers/embedded-store.mjs";

let store = null;
before(async () => { store = await startStore({ db: "live_parcel_test" }); });
after(async () => { await store?.stop?.(); });

const owner = async (fn) => { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } };

async function seed({ acts = [], claims = [], settlement = null }) {
  await owner(async (c) => {
    await c.query("TRUNCATE claims, windows, settlements, acts RESTART IDENTITY CASCADE");
    for (const id of [319, 320, 321]) {
      await c.query(`INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, '2026-11-01T00:00:00Z'::timestamptz + ($1 - 319) * interval '12 hours', '2026-11-01T00:00:00Z'::timestamptz + ($1 - 318) * interval '12 hours', $2)`, [id, id === 321 ? "open" : "closed"]);
    }
    if (settlement) await c.query(`INSERT INTO settlements (number, tag_sha, published_at, window_id) VALUES ($1, $2, now(), $3)`, [settlement.number, "a".repeat(40), settlement.window]);
    for (const a of acts) {
      await c.query(`INSERT INTO acts (at, crossing, actor, action, object, class) VALUES (now(), $1, $2, $3, $4, $5)`, [a.crossing ?? 321, a.actor, a.action, a.object, a.class ?? "mark"]);
    }
    for (const k of claims) {
      await c.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, stake, data, slug) VALUES ($1, 'sited', $2, 'hh:starforge', $3, $4, '{}', 0, '{}', $5)`, [k.window ?? 321, k.claimant ?? "wright", k.status ?? "pending", k.body, k.slug]);
    }
  });
}
const ask = async (marks, settlement = 1, owners = null) => {
  const query = async (sql, params) => owner(async (c) => (await c.query(sql, params)).rows);
  return liveEdits(marks, settlement, { query, owners });
};

test("8 · the store: the owner's newest act decides; an amend carries the claim's body", async () => {
  const marks = canon();
  await seed({
    settlement: { number: 1, window: 320 },
    acts: [
      { actor: "wright", action: "leave-mark", object: "wright/the-drafting-table" },
      { actor: "wright", action: "amend", object: "wright/the-drafting-table" },
      { actor: "wright", action: "withdraw", object: "wright/the-keystone" },
    ],
    claims: [{ slug: "wright/the-drafting-table", body: "A new sheet." }],
  });
  const e = await ask(marks);
  assert.equal(e.bodies.get("wright/the-drafting-table"), "A new sheet.");
  assert.deepEqual([...e.removed], ["wright/the-keystone"]);
});

test("9 · only the owner's own acts count: somebody else's withdraw removes nothing", async () => {
  const marks = canon();
  await seed({ settlement: { number: 1, window: 320 }, acts: [{ actor: "the-town", action: "withdraw", object: "wright/the-keystone" }, { actor: "ada", action: "withdraw", object: "wright/the-drafting-table" }] });
  assert.equal((await ask(marks)).key, "");
});

test("10 · a later re-leave by the author cancels the withdrawal (the crossing's own rule)", async () => {
  const marks = canon();
  await seed({ settlement: { number: 1, window: 320 }, acts: [{ actor: "wright", action: "withdraw", object: "wright/the-keystone" }, { actor: "wright", action: "leave-mark", object: "wright/the-keystone" }] });
  assert.equal((await ask(marks)).key, "");
});

test("11 · a refused or retracted claim stops showing; a pending one shows", async () => {
  const marks = canon();
  const acts = [{ actor: "wright", action: "amend", object: "wright/the-drafting-table" }];
  await seed({ settlement: { number: 1, window: 320 }, acts, claims: [{ slug: "wright/the-drafting-table", body: "x", status: "refused" }] });
  assert.equal((await ask(marks)).key, "");
  await seed({ settlement: { number: 1, window: 320 }, acts, claims: [{ slug: "wright/the-drafting-table", body: "x", status: "retracted" }] });
  assert.equal((await ask(marks)).key, "");
  await seed({ settlement: { number: 1, window: 320 }, acts, claims: [{ slug: "wright/the-drafting-table", body: "Pending body.", status: "pending" }] });
  assert.equal((await ask(marks)).bodies.get("wright/the-drafting-table"), "Pending body.");
});

test("12 · an act older than the settlement's window less the bound is canon's by construction, and is not read", async () => {
  const marks = canon();
  await seed({
    settlement: { number: 1, window: 321 },
    acts: [{ actor: "wright", action: "withdraw", object: "wright/the-keystone", crossing: 318 }],
  });
  assert.equal((await ask(marks)).key, "", "crossing 318 < 321 - 2");
  await seed({
    settlement: { number: 1, window: 321 },
    acts: [{ actor: "wright", action: "withdraw", object: "wright/the-keystone", crossing: 319 }],
  });
  assert.deepEqual([...(await ask(marks)).removed], ["wright/the-keystone"]);
});

test("13 · an act that is not a mark act is not read", async () => {
  const marks = canon();
  await seed({ settlement: { number: 1, window: 320 }, acts: [{ actor: "wright", action: "withdraw", object: "wright/the-keystone", class: "voice" }] });
  assert.equal((await ask(marks)).key, "");
});

test("14 · asked for one house's owners, only its own authors' edits come back (an unrelated read finds nothing owed)", async () => {
  const marks = canon();
  await seed({ settlement: { number: 1, window: 320 }, acts: [{ actor: "wright", action: "withdraw", object: "wright/the-keystone" }, { actor: "ada", action: "amend", object: "ada/a-lamp" }], claims: [{ slug: "ada/a-lamp", claimant: "ada", body: "A brighter lamp." }] });
  assert.deepEqual([...(await ask(marks, 1, ["wright"])).removed], ["wright/the-keystone"]);
  assert.equal((await ask(marks, 1, ["wright"])).bodies.size, 0);
  assert.equal((await ask(marks, 1, ["little-bird"])).key, "", "nothing of an unrelated house's is owed");
  assert.equal((await ask(marks, 1, null)).bodies.get("ada/a-lamp"), "A brighter lamp.");
});

test("15 · the doorstep's stakes rows carry the house's own body now and drop a withdrawn mark; an unrelated house's rows are canon's", async () => {
  const marks = canon();
  const state = { marks };
  const readers = { world: async () => ({ state, ref: "refs/tags/settlement/S1" }), registry: async () => ({}), escrow: async () => ({ townSha: "x", byMark: new Map(), ingestedAt: null }), rule: async () => () => ({ unpublish: false }), pathAt: async () => () => null, allocationPage: false };
  const edits = editsFrom([amend("wright/the-drafting-table", "A new sheet."), withdraw("wright/the-keystone")], marks);
  const seen = [];
  const live = async (_s, _r, handles) => { seen.push([...handles]); return handles.includes("wright") ? edits : editsFrom([], marks); };
  const mine = await stakesFor(["wright"], { ...readers, liveEditsFor: live });
  assert.deepEqual(mine.rows.map((r) => [r.mark, r.body]), [["wright/the-drafting-table", "A new sheet."]]);
  const other = await stakesFor(["ada"], { ...readers, liveEditsFor: live });
  assert.deepEqual(other.rows.map((r) => [r.mark, r.body]), [["ada/a-lamp", "A lamp."]]);
  assert.deepEqual(seen, [["wright"], ["ada"]], "each read asks for its own handles only");
  assert.equal(marks[1].id, "wright/the-keystone", "canon's array is untouched");
});

test("16 · a request is one snapshot: the store is read once however many times the world is asked for; a request that writes reads afresh; no scope reads every time", async () => {
  const marks = canon();
  let reads = 0;
  const query = async () => { reads += 1; return [{ object: "wright/the-keystone", action: "withdraw", act_id: 5, crossing: 320, claim_id: null, claim_status: null, body: null }]; };
  const ask = () => liveEdits(marks, 1, { query });
  await liveScope(async () => { for (let i = 0; i < 44; i++) await ask(); });
  assert.equal(reads, 1, "44 asks in one request, one read");
  reads = 0;
  await liveScope(async () => { await ask(); await ask(); liveBypass(); await ask(); await ask(); });
  assert.equal(reads, 3, "two shared, then each ask after a write reads");
  reads = 0;
  await ask(); await ask();
  assert.equal(reads, 2, "outside a request scope nothing is shared");
  reads = 0;
  await Promise.all([liveScope(() => ask()), liveScope(() => ask())]);
  assert.equal(reads, 2, "two requests never share one snapshot");
});

test("17 · each house keeps its own authors' rows out of the one read a request makes", async () => {
  const marks = canon();
  const seen = [];
  const query = async () => { seen.push(1); return [withdraw("wright/the-keystone"), amend("ada/a-lamp", "B")]; };
  const [w, a, n] = await liveScope(async () => [await liveEdits(marks, 1, { query, owners: ["wright"] }), await liveEdits(marks, 1, { query, owners: ["ada"] }), await liveEdits(marks, 1, { query, owners: ["little-bird"] })]);
  assert.equal(seen.length, 1, "one read serves every house in the request");
  assert.deepEqual([...w.removed], ["wright/the-keystone"]); assert.equal(w.bodies.size, 0);
  assert.equal(a.bodies.get("ada/a-lamp"), "B"); assert.equal(a.removed.size, 0);
  assert.equal(n.key, "");
});

test("18 · the edit set of one snapshot is built once per (owners, canon marks): every ask in a request gets the same object", async () => {
  const marks = canon();
  const query = async () => [withdraw("wright/the-keystone")];
  const [a, b, c, d] = await liveScope(async () => [await liveEdits(marks, 1, { query }), await liveEdits(marks, 1, { query }), await liveEdits(marks, 1, { query, owners: ["wright"] }), await liveEdits(marks, 1, { query, owners: ["wright"] })]);
  assert.strictEqual(a, b);
  assert.strictEqual(c, d);
  const e = await liveScope(async () => liveEdits(canon(), 1, { query }));
  assert.notStrictEqual(e, a, "another canon is another edit set");
  assert.strictEqual(overlayMarks(marks, a), overlayMarks(marks, a), "and one overlaid array");
});
