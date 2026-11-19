// world-live-parcel.test.mjs — POS-686: an own-parcel amendment and a dependency-free withdrawal, laid over canon for every viewer.
//
//   node --test test/world-live-parcel.test.mjs
//
// The rules are pure and held on hand-built rows (with the standing walk's own `groundVerdict` as the premise of the welcomed case); the SQL that finds the
// owed edits, and the watch that says when to ask again, are run on a real store ("a round trip through a JS stub is not a round trip through Postgres");
// the readers it is wired into are in world-live-parcel-wiring.test.mjs. What would failure look like: a mark WELCOMED onto another household's parcel (the
// standing walk calls it `home`) served live; a market or constitution mark's author's words or removal served live (Darko: common-ground market marks stay
// settled); a stale canon body after the amendment; a withdrawn mark still served or still NAMED in the telling; a refused claim still showing; an overlay
// that changes any mark but the one edited; an act of somebody else's removing a mark; a later re-leave not cancelling a withdrawal; an edit that stops
// showing because it is old; a request that reads the store's whole history; an act that committed after a higher id was seen and is not seen next request.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  editsFrom, overlayMarks, patchServed, servedTelling, editedIds, liveEdits, liveMarks, liveParcelStats, liveScope, liveBypass, ownGroundIds, watchSql, owedSql,
} from "../src/world-live-parcel.mjs";
import { marksContain, groundVerdict } from "../world2/tools/standing.mjs";

const box = (x, y, w = 2, h = 2) => ({ at: { x, y }, extent: { w, h } });
const mk = (id, by, house, pos, over = {}) => ({ id, kind: "sited", by, declared_household: house, tier: "home", body: `${id} body`, ...pos, ...over });
const canon = () => [
  mk("wright/the-yard", "wright", "hh:starforge", box(50, 50, 100, 100), { kind: "parcel", body: "The yard." }),
  mk("wright/the-drafting-table", "wright", "hh:starforge", box(10, 10), { body: "A tilted sheet of working drawings." }),
  mk("wright/the-keystone", "wright", "hh:starforge", box(20, 20), { body: "A keystone." }),
  mk("wright/the-note", "wright", "hh:starforge", {}, { body: "A note on the table.", placementParent: "wright/the-drafting-table" }),
  mk("ada/the-plot", "ada", "hh:ada", box(300, 300, 100, 100), { kind: "parcel", body: "Ada's plot." }),
  mk("ada/a-lamp", "ada", "hh:ada", box(305, 305), { body: "A lamp." }),
  // bea's parcel, with ada's stall WELCOMED onto it: the standing walk says `home` for ada's stall, and it is not ada's parcel
  mk("bea/the-yard", "bea", "hh:bea", box(600, 600, 100, 100), { kind: "parcel", body: "Bea's yard.", consent: { "ada/ada-stall": "welcomed" } }),
  mk("ada/ada-stall", "ada", "hh:ada", box(605, 605), { body: "Ada's stall, welcomed onto bea's ground." }),
  mk("alden/the-alder-at-the-green-lamp", "alden", "hh:alden", box(900, 900), { tier: "market", body: "An alder." }),
  mk("the-town/the-town-centre", "the-town", "hh:the-town", box(1000, 1000), { tier: "constitution", body: "The Centre." }),
];
const OWN = (marks) => ownGroundIds(marks, marksContain);
const amend = (object, body, claim_status = "pending") => ({ object, action: "amend", act_id: 10, crossing: 320, claim_id: "c1", claim_status, body });
const withdraw = (object) => ({ object, action: "withdraw", act_id: 11, crossing: 320, claim_id: null, claim_status: null, body: null });
const edits = (rows, marks = canon()) => editsFrom(rows, marks, OWN(marks));

test("0 · THE GROUND FACT is the author's own household holding the parcel the mark stands on: a welcome onto another household's parcel is not it, though the standing walk says home", () => {
  const marks = canon();
  const stall = marks.find((m) => m.id === "ada/ada-stall"), beas = marks.find((m) => m.id === "bea/the-yard");
  assert.equal(groundVerdict(beas, stall, "hh:ada"), "home", "the premise: the real walk's verdict for the welcomed mark");
  assert.equal(groundVerdict({ ...beas, consent: {} }, stall, "hh:ada"), "market", "and without the welcome");
  const own = OWN(marks);
  assert.equal(own.has("ada/ada-stall"), false, "welcomed onto bea's parcel: settled");
  assert.deepEqual([...own].sort(), ["ada/a-lamp", "ada/the-plot", "bea/the-yard", "wright/the-drafting-table", "wright/the-keystone", "wright/the-note", "wright/the-yard"], "own ground: each house's parcel and what stands on it, a de-sited note following its parent");
  assert.equal(own.has("alden/the-alder-at-the-green-lamp"), false); assert.equal(own.has("the-town/the-town-centre"), false);
  // not the id prefix, not the tier, not the household of whoever the act names: a mark whose declared household is missing is never own
  assert.equal(ownGroundIds([{ ...marks[1], declared_household: undefined }, marks[0]], marksContain).size, 1, "only the parcel (itself unresolved: none), not the mark");
  assert.equal(ownGroundIds(marks, () => false).has("wright/the-drafting-table"), false, "no containment, no sited mark is own");
});

test("1 · an own-ground amendment replaces the body of the one mark and nothing else", () => {
  const marks = canon();
  const e = edits([amend("wright/the-drafting-table", "A new sheet.")], marks);
  assert.ok(e.key);
  const out = overlayMarks(marks, e);
  const i = marks.findIndex((m) => m.id === "wright/the-drafting-table");
  assert.equal(out[i].body, "A new sheet.");
  assert.deepEqual(out[i].at, { x: 10, y: 10 }, "geometry stays canon's");
  marks.forEach((m, j) => { if (j !== i) assert.strictEqual(out[j], m, "an untouched mark is canon's own reference"); });
  assert.equal(marks[i].body, "A tilted sheet of working drawings.", "canon itself is not edited");
});

test("2 · an own-ground withdrawal removes the mark from what is served; canon's array is untouched", () => {
  const marks = canon();
  const out = overlayMarks(marks, edits([withdraw("wright/the-keystone")], marks));
  assert.ok(!out.some((m) => m.id === "wright/the-keystone"));
  assert.equal(marks.length, 10);
});

test("3 · SCOPE: a market mark, a constitution mark and a mark WELCOMED onto another's parcel stay settled, however lawfully the act was filed; the own-ground mark beside them goes live", () => {
  const marks = canon();
  const settled = ["alden/the-alder-at-the-green-lamp", "the-town/the-town-centre", "ada/ada-stall"];
  const rows = settled.flatMap((id) => [amend(id, "SYNTHETIC LIVE BODY"), withdraw(id)]);
  assert.equal(edits(rows, marks).key, "", "no edit at all off the author's own parcel");
  assert.strictEqual(overlayMarks(marks, edits(rows, marks)), marks);
  const both = edits([...rows, amend("wright/the-drafting-table", "A new sheet.")], marks);
  assert.deepEqual([...both.bodies.keys()], ["wright/the-drafting-table"], "the positive is the only edit");
  assert.equal(both.removed.size, 0);
});

test("4 · a parcel is ground: its words may be amended, it is never withdrawn live (a ground change)", () => {
  const marks = canon();
  const e = edits([amend("wright/the-yard", "The yard, replanted."), withdraw("wright/the-yard")], marks);
  assert.equal(e.bodies.get("wright/the-yard"), "The yard, replanted.");
  assert.equal(e.removed.size, 0);
});

test("5 · nothing owed is canon's own object, whatever the rows say about marks canon does not hold", () => {
  const marks = canon();
  for (const rows of [[], null, [amend("wright/the-drafting-table", marks[1].body)], [amend("nobody/not-in-canon", "x")], [amend("wright/the-keystone", "x", null)]]) {
    const e = edits(rows, marks);
    assert.equal(e.key, "", JSON.stringify(rows));
    assert.strictEqual(overlayMarks(marks, e), marks);
  }
});

test("6 · the overlaid copy is built once per (canon, edit set); a different edit is a different key, never the old body", () => {
  const marks = canon();
  const a = edits([amend("wright/the-drafting-table", "A new sheet.")], marks);
  const b = edits([amend("wright/the-drafting-table", "A new sheet.")], marks);
  assert.strictEqual(overlayMarks(marks, a), overlayMarks(marks, b));
  const c = edits([amend("wright/the-drafting-table", "A newer sheet.")], marks);
  assert.notStrictEqual(overlayMarks(marks, c), overlayMarks(marks, a));
  assert.equal(overlayMarks(marks, c)[1].body, "A newer sheet.");
});

test("7 · a claim the candle refused or the author retracted shows nothing; a locked one still does (canon has not carried it yet)", () => {
  const marks = canon();
  assert.equal(edits([amend("wright/the-drafting-table", "x", null)], marks).key, "");
  assert.equal(overlayMarks(marks, edits([amend("wright/the-drafting-table", "Locked.", "locked")], marks))[1].body, "Locked.");
});

test("8 · patchServed: the edited body wherever an answer carries it, a withdrawn mark gone from its lists, a withdrawn focus is no mark, untouched answers are the same object", () => {
  const marks = canon();
  const e = edits([amend("wright/the-drafting-table", "A new sheet."), withdraw("wright/the-keystone")], marks);
  const answer = { id: "ada/a-lamp", body: "A lamp.", alongside: [{ id: "wright/the-drafting-table", body: "A tilted sheet of working drawings." }, { id: "wright/the-keystone", body: "A keystone." }, { id: "ada/other", body: "x" }], note: "kept" };
  const out = patchServed(answer, e, "ada/a-lamp");
  assert.deepEqual(out.alongside.map((m) => [m.id, m.body]), [["wright/the-drafting-table", "A new sheet."], ["ada/other", "x"]]);
  assert.equal(out.note, "kept"); assert.equal(answer.alongside.length, 3, "the engine's answer is not edited in place");
  assert.equal(patchServed({ id: "wright/the-keystone", body: "A keystone." }, e, "wright/the-keystone"), null);
  assert.equal(patchServed({ id: "wright/the-drafting-table", body: "old" }, e, "wright/the-drafting-table").body, "A new sheet.");
  const same = { id: "ada/a-lamp", body: "A lamp.", alongside: [{ id: "ada/other", body: "x" }] };
  assert.strictEqual(patchServed(same, e, "ada/a-lamp"), same);
});

test("8b · servedTelling: a withdrawn mark is not NAMED as here (band lines, the within chain), the names-never-quotes shape is kept, everything else is the engine's text", () => {
  const e = edits([withdraw("wright/the-keystone"), withdraw("wright/the-drafting-table")]);
  const telling = [
    "— You stand at (619.5, -2653.5), 37.5 m above the sea.",
    "You are within a mark by wright [wright/the-yard] · a mark by wright [wright/the-drafting-table].",
    "",
    "Underfoot:",
    "  · 4 m SSE — a mark by wright  [wright/the-ledger-shelf, ✦0]",
    "  · 5 m S — a mark by wright  [wright/the-keystone, ✦0]",
    "  · 7 m SSW — a mark by wright  [wright/the-guest-book, ✦7]",
    "A fair way off:",
    "  · 2000 m W — a mark by sol-of-garrison (+5 more of sol-of-garrison's — investigate)  [sol-of-garrison/the-protected-grove, ✦135]",
  ].join("\n");
  const out = servedTelling(telling, e);
  assert.doesNotMatch(out, /the-keystone|the-drafting-table/);
  assert.match(out, /You are within a mark by wright \[wright\/the-yard\]\./, "the chain keeps what is left and its full stop");
  assert.match(out, /the-ledger-shelf/); assert.match(out, /the-guest-book/); assert.match(out, /sol-of-garrison\/the-protected-grove/);
  assert.equal(out.split("\n").length, telling.split("\n").length - 1, "exactly the one band line goes");
  const first = servedTelling("You are within a mark by wright [wright/the-keystone] · a mark by wright [wright/the-note].", edits([withdraw("wright/the-keystone")]));
  assert.equal(first, "You are within a mark by wright [wright/the-note].", "the leading segment goes and the prefix moves on");
  assert.equal(servedTelling("You are within a mark by wright [wright/the-keystone].", edits([withdraw("wright/the-keystone")])), "");
  assert.strictEqual(servedTelling(telling, edits([])), telling, "nothing removed: the same string");
  assert.strictEqual(servedTelling("Underfoot:\n  · 1 m N — a mark by ada  [ada/a-lamp, ✦0]", e), "Underfoot:\n  · 1 m N — a mark by ada  [ada/a-lamp, ✦0]", "nothing named that is removed: the same string");
});

test("9 · editedIds names what moved", () => {
  const e = edits([amend("wright/the-drafting-table", "n"), withdraw("wright/the-keystone")]);
  assert.deepEqual([...editedIds(e)].sort(), ["wright/the-drafting-table", "wright/the-keystone"]);
});

// ── the snapshot, the watch and the rescan (the store's read, counted) ─────────────────────────────────────────────

/** A store answering the two statements the layer makes, counting them. */
function fakeStore({ watch = { mark_acts: 5, mark_act: 5, window_top: 321, window_closed: 320, clearing: 0 }, rows = () => [] } = {}) {
  const s = { watches: 0, scans: 0, watch: { ...watch }, rows };
  s.query = async (sql, params) => {
    if (sql === watchSql) { s.watches += 1; return [s.watch]; }
    if (sql === owedSql) { s.scans += 1; s.lastIds = params[0]; return s.rows(); }
    throw new Error("unexpected statement");
  };
  return s;
}
const opts = (st, extra = {}) => ({ query: st.query, contains: marksContain, ...extra });

test("10 · a request reads the watch once however many times the world is asked for; the owed set is rescanned only when the store's facts moved", async () => {
  const marks = canon();
  const st = fakeStore({ rows: () => [withdraw("wright/the-keystone")] });
  await liveScope(async () => { for (let i = 0; i < 44; i++) await liveEdits(marks, opts(st)); });
  assert.deepEqual([st.watches, st.scans], [1, 1], "44 asks: one watch, one scan");
  await liveScope(async () => { await liveEdits(marks, opts(st)); await liveEdits(marks, opts(st)); });
  assert.deepEqual([st.watches, st.scans], [2, 1], "another request: its own watch, the same owed set (the facts did not move)");
  st.watch.mark_acts = 6; // a mark act committed, in whatever id order
  await liveScope(() => liveEdits(marks, opts(st)));
  assert.deepEqual([st.watches, st.scans], [3, 2], "a committed mark act: one rescan");
  st.watch.window_closed = 321; st.watch.window_top = 322;
  await liveScope(() => liveEdits(marks, opts(st)));
  assert.equal(st.scans, 3, "a clearing (a window closed): one rescan");
  await liveScope(() => liveEdits(canon(), opts(st)));
  assert.equal(st.scans, 4, "another canon: one rescan");
});

test("11 · the candidates are canon's own-ground marks only: common ground and a welcomed mark are never asked about", async () => {
  const st = fakeStore();
  await liveEdits(canon(), opts(st));
  assert.deepEqual(st.lastIds.sort(), ["ada/a-lamp", "ada/the-plot", "bea/the-yard", "wright/the-drafting-table", "wright/the-keystone", "wright/the-note", "wright/the-yard"]);
});

test("12 · a request that writes an edit reads the watch afresh; no scope reads every time; two requests never share a snapshot", async () => {
  const marks = canon();
  const st = fakeStore();
  await liveScope(async () => { await liveEdits(marks, opts(st)); await liveEdits(marks, opts(st)); liveBypass(); await liveEdits(marks, opts(st)); await liveEdits(marks, opts(st)); });
  assert.equal(st.watches, 3);
  st.watches = 0;
  await liveEdits(marks, opts(st)); await liveEdits(marks, opts(st));
  assert.equal(st.watches, 2);
  st.watches = 0;
  await Promise.all([liveScope(() => liveEdits(marks, opts(st))), liveScope(() => liveEdits(marks, opts(st)))]);
  assert.equal(st.watches, 2);
});

test("13 · each house keeps its own authors' rows out of the one read; the edit set of a snapshot is built once per (owners, canon)", async () => {
  const marks = canon();
  const st = fakeStore({ rows: () => [withdraw("wright/the-keystone"), amend("ada/a-lamp", "B")] });
  const [all, w, a, n, w2] = await liveScope(async () => [
    await liveEdits(marks, opts(st)), await liveEdits(marks, opts(st, { owners: ["wright"] })), await liveEdits(marks, opts(st, { owners: ["ada"] })),
    await liveEdits(marks, opts(st, { owners: ["little-bird"] })), await liveEdits(marks, opts(st, { owners: ["wright"] }))]);
  assert.equal(st.scans, 1);
  assert.deepEqual([...all.removed], ["wright/the-keystone"]); assert.equal(all.bodies.get("ada/a-lamp"), "B");
  assert.deepEqual([...w.removed], ["wright/the-keystone"]); assert.equal(w.bodies.size, 0);
  assert.equal(a.bodies.get("ada/a-lamp"), "B"); assert.equal(a.removed.size, 0);
  assert.equal(n.key, "");
  assert.strictEqual(w, w2, "built once per (owners, canon)");
});

test("14 · a store that cannot answer is no overlay, counted, never a failed read; an engine with no containment makes nothing eligible", async () => {
  const marks = canon();
  const before = liveParcelStats.failures;
  const e = await liveEdits(marks, { query: async () => { throw new Error("store down"); }, contains: marksContain });
  assert.equal(e.key, "");
  assert.equal(liveParcelStats.failures, before + 1);
  const { marks: served } = await liveMarks(marks, { query: async () => { throw new Error("store down"); }, contains: marksContain });
  assert.strictEqual(served, marks);
  const st = fakeStore({ rows: () => [withdraw("wright/the-keystone")] });
  assert.equal((await liveEdits(canon(), { query: st.query, contains: () => false })).key, "", "nothing is own ground without a containment that says so");
});

test("15 · no age policy and no history scan are written into the SQL; the watch carries a commit-ordered count", () => {
  for (const sql of [watchSql, owedSql]) assert.doesNotMatch(sql, /interval|now\(\)|settlements|window_id\s*-|crossing\s*>=/i, "no clock, no settlement row, no window bound");
  assert.match(owedSql, /unnest\(\$1::text\[\]\)/, "bounded by the candidates, not by history");
  assert.match(owedSql, /ORDER BY a\.id DESC LIMIT 1/);
  assert.match(watchSql, /count\(\*\) FROM acts a WHERE a\.class = 'mark'/, "the number of committed mark acts, not only the newest id");
});

// ── the SQL and the watch, on a real store ──────────────────────────────────────────────────────────────────────────
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
const ask = (marks, owners = null) => liveEdits(marks, { query: (s, p) => query(s, p), contains: marksContain, owners });

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

test("22 · COMMIT VISIBILITY: a lower act id that commits AFTER a higher one was seen is seen on the next request, with no later act and no window tick (and the old max-id watch is shown to miss it)", async () => {
  await seed({});
  const marks = canon();
  const real = (s, p) => query(s, p);
  // the previous watch, for the contrast: the newest mark act id and the windows, nothing commit-ordered
  const legacyWatch = `SELECT COALESCE((SELECT max(a.id) FROM acts a WHERE a.class = 'mark'), 0) AS mark_act, COALESCE((SELECT max(w.id) FROM windows w), 0) AS window_top, COALESCE((SELECT max(w.id) FROM windows w WHERE w.status = 'closed'), 0) AS window_closed, (SELECT count(*) FROM windows w WHERE w.status = 'clearing')::int AS clearing`;
  const legacy = (s, p) => real(s === watchSql ? legacyWatch : s, p);
  const first = await store.connect("world2_owner"), second = await store.connect("world2_owner");
  try {
    await first.query("BEGIN");
    await first.query("INSERT INTO acts (at, crossing, actor, action, object, class) VALUES (now(), 321, 'wright', 'withdraw', 'wright/the-keystone', 'mark')"); // id n, not yet committed
    await second.query("INSERT INTO acts (at, crossing, actor, action, object, class) VALUES (now(), 321, 'ada', 'amend', 'ada/a-lamp', 'mark')");              // id n+1, committed
    await second.query("INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, stake, data, slug) VALUES (321, 'sited', 'ada', 'hh:ada', 'pending', 'Ada, brighter.', '{}', 0, '{}', 'ada/a-lamp')");
    const opts = { contains: marksContain };
    const seenHigh = await liveScope(() => liveEdits(marks, { ...opts, query: real }));
    const seenHighLegacy = await liveScope(() => liveEdits(marks, { ...opts, query: legacy }));
    assert.equal(seenHigh.bodies.get("ada/a-lamp"), "Ada, brighter.", "the higher id is visible");
    assert.equal(seenHigh.removed.size, 0, "the lower id has not committed");
    await first.query("COMMIT");                                  // the lower id commits now; no new act, no window tick
    const next = await liveScope(() => liveEdits(marks, { ...opts, query: real }));
    assert.deepEqual([...next.removed], ["wright/the-keystone"], "the next request sees the lower id");
    assert.equal(next.bodies.get("ada/a-lamp"), "Ada, brighter.");
    const nextLegacy = await liveScope(() => liveEdits(marks, { ...opts, query: legacy }));
    assert.equal(seenHighLegacy.removed.size, 0);
    assert.equal(nextLegacy.removed.size, 0, "THE DEFECT: the max-id watch had not moved, so the cached view still missed the committed lower id");
  } finally { await first.query("ROLLBACK").catch(() => {}); await first.end(); await second.end(); }
});
