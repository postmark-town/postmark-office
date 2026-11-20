// held-extent.test.mjs — POS-1155: a thing made into hands may declare its SIZE, and is set down at it.
//
// RULED (Darko, 2026-11-19 22:21 EST, CORE-124): "ohh. so we should make it so you can declare an extent when making things into
// someone's hands". The later 22:32 close ("I think it's fine if bigger things can fit in smaller things") built no holding-size rule:
// this is only the thing's eventual map footprint. leave-mark with `to:` and a slug/body takes an optional `extent { w, h }` in
// metres; it rides the made record, and a set-down files the draft (and asks the ground) at THAT size. Left off, today's 1×1.
// `at` and `points` are still refused: a held thing has no place.
//
// TWO TIERS. The pure tier (the form, the made record and its fold, the held overlay, the draft) runs anywhere. The door tier is the
// REAL leave-mark and world_hold doors with prod's flags on a real store over a throwaway world (as set-down-holder-put-back.test.mjs
// does): make → the hold record → the held read → set-down → the draft the store holds; and a put-back set down again.
//   node --test test/held-extent.test.mjs
//
// FALSIFIERS (run): restore the hard-coded 1×1 in the draft (setDownDraftOf) or in the ground check (setDownMade's extentOf), or drop
// `extent` from madeRecordOf, and the controls below go red: see the PR.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { tempDir } from "./helpers/temp-dir.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { markRecord } from "../src/mark-record.mjs";
import {
  namedFormRefusal, declaredExtentOf, declaredExtentRefusal, madeRecordOf, foldMade, setDownDraftOf, setDownExtentOf, SET_DOWN_EXTENT,
  MAKE_FACE, PUT_BACK_FACE, SET_DOWN_FACE,
} from "../src/named-making.mjs";
import { viewOf, heldMadeMarks, HELD_BY } from "../src/held.mjs";

const LB = "little-bird";

// ── the pure tier ───────────────────────────────────────────────────────────

test("the form: extent rides a NAMED make; at and points are still refused; a count of a kind has no size of its own", () => {
  const named = { to: LB, slug: "a", body: "b" };
  assert.equal(namedFormRefusal({ ...named, extent: { w: 0.3, h: 0.2 } }), null, "a thing's size is taken");
  assert.equal(namedFormRefusal(named), null, "and optional");
  assert.match(namedFormRefusal({ ...named, at: { x: 1, y: 1 } }).defect, /has no place: at is for a mark on the ground/);
  assert.match(namedFormRefusal({ ...named, points: [[0, 0], [1, 0], [1, 1]] }).defect, /has no place: points is for a mark on the ground/);
  assert.match(namedFormRefusal({ ...named, extent: { w: 1, h: 1 }, at: { x: 1, y: 1 } }).defect, /has no place: at is for a mark on the ground/, "a size does not excuse a place");
  assert.match(namedFormRefusal({ ...named, extent: { w: 1, h: 1 }, points: [] }).defect, /has no place: points is for a mark on the ground/);
  const batch = namedFormRefusal({ to: LB, kind: "candy", count: 3, extent: { w: 1, h: 1 } });
  assert.equal(batch.code, 422);
  assert.match(batch.defect, /one named thing's own size/);
  assert.match(namedFormRefusal({ to: LB, kind: "candy", extent: { w: 1, h: 1 } }).defect, /one named thing's own size/, "kind without count is the batch form too");
  assert.match(namedFormRefusal({ to: LB, count: 2, slug: "a", body: "b", extent: { w: 1, h: 1 } }).defect, /count makes that many alike/, "the mixed-form guard is not lost");
});

test("no invalid extent is silently defaulted: each side a finite number above 0, else a 422 that writes nothing", () => {
  assert.deepEqual(declaredExtentOf({ w: 0.3, h: 0.2 }), { w: 0.3, h: 0.2 });
  assert.deepEqual(declaredExtentOf({ w: 3, h: 3, z: 9 }), { w: 3, h: 3 }, "only w and h are kept");
  const bad = [{ w: 0, h: 1 }, { w: 1, h: 0 }, { w: -1, h: 2 }, { w: 2, h: -0.1 }, { w: 1 }, { h: 1 }, {}, { w: "1", h: "1" }, { w: NaN, h: 1 }, { w: Infinity, h: 1 },
    { w: null, h: 1 }, [1, 1], "1x1", 5, null, true];
  for (const extent of bad) {
    assert.equal(declaredExtentOf(extent), null, JSON.stringify(extent));
    const r = namedFormRefusal({ to: LB, slug: "a", body: "b", extent });
    assert.equal(r?.code, 422, `${JSON.stringify(extent)} is refused, not defaulted`);
    assert.match(r.defect, /extent is how big the thing is, in metres: \{ w, h \}, each a number above 0/);
    assert.match(r.hint, /Nothing was made/);
  }
  assert.equal(declaredExtentRefusal({ to: LB, slug: "a", body: "b" }), null, "no extent: nothing to judge");
});

test("the made record keeps the declared size; one made without it (and every record before POS-1155) has none", () => {
  const sized = madeRecordOf({ by: LB, slug: "pebble", kind: "thing", body: "A pebble.", extent: { w: 0.3, h: 0.2 } });
  assert.deepEqual(sized.extent, { w: 0.3, h: 0.2 });
  const plain = madeRecordOf({ by: LB, slug: "plain", kind: "thing", body: "A plain thing." });
  assert.equal("extent" in plain, false);
  assert.equal("extent" in madeRecordOf({ by: LB, slug: "bad", kind: "thing", body: "b", extent: { w: 0, h: 1 } }), false, "a malformed size is never stored");
  // the fold: a make keeps it, a put-back's whole copy keeps it, a set-down lets the record go
  const id = `${LB}/pebble`;
  const rows = [{ seq: 1, action: MAKE_FACE, object: id, payload: { thing: id, made: sized } }];
  assert.deepEqual(foldMade(rows).get(id).extent, { w: 0.3, h: 0.2 });
  const back = [...rows, { seq: 2, action: SET_DOWN_FACE, object: id, payload: { thing: id } }, { seq: 3, action: PUT_BACK_FACE, object: id, payload: { thing: id, made: sized } }];
  assert.deepEqual(foldMade(back).get(id).extent, { w: 0.3, h: 0.2 }, "put back, it is the same size");
});

test("held: the overlay lays the thing in hands with no place and no size (nothing reads a footprint off a held thing)", () => {
  const sized = madeRecordOf({ by: LB, slug: "pebble", kind: "thing", body: "A pebble.", extent: { w: 0.3, h: 0.2 } });
  const view = viewOf({ record: { attachments: [], made: new Map([[sized.id, sized]]) } });
  view.last.set(sized.id, { policy: "cascade", entity: LB });
  const [m] = heldMadeMarks(view, []);
  assert.equal(m[HELD_BY], LB);
  assert.equal("extent" in m, false, "no phantom footprint on a held read");
  assert.equal("at" in m, false);
  assert.deepEqual(view.made.get(sized.id).extent, { w: 0.3, h: 0.2 }, "the size stays in the made record, which is what a set-down reads");
});

test("set-down: the draft and the ground check read ONE size: the declared one, else 1×1", () => {
  const sized = madeRecordOf({ by: LB, slug: "pebble", kind: "thing", body: "A pebble.", extent: { w: 0.3, h: 0.2 } });
  const plain = madeRecordOf({ by: LB, slug: "plain", kind: "thing", body: "A plain thing." });
  const at = { x: 12, y: -3 };
  assert.deepEqual(setDownDraftOf(sized, { at, free: true }).extent, { w: 0.3, h: 0.2 });
  assert.deepEqual(setDownDraftOf(plain, { at, free: true }).extent, { w: 1, h: 1 }, "omitted: today's 1×1");
  assert.deepEqual(setDownExtentOf(sized), setDownDraftOf(sized, { at, free: false }).extent, "the size the ground is asked is the size the draft is written with");
  assert.deepEqual(setDownExtentOf(plain), { w: 1, h: 1 });
  assert.deepEqual(setDownExtentOf({ ...plain, extent: { w: -4, h: 2 } }), { w: 1, h: 1 }, "a stored size that is not one is the default, never a negative footprint");
  assert.deepEqual(setDownExtentOf(null), { w: 1, h: 1 });
  setDownExtentOf(plain).w = 9;
  assert.deepEqual(SET_DOWN_EXTENT, { w: 1, h: 1 }, "the default is not shared mutable state");
  const free = setDownDraftOf(sized, { at, free: true });
  assert.deepEqual(Object.keys(free).sort(), ["at", "body", "by", "extent", "kind", "slug", "stamps"], "the draft is the made mark and nothing else: id, household and date are the door's");
});

// ── the door tier ───────────────────────────────────────────────────────────

const WORLD = worldClone();
const store = await startStore({ db: "held_extent" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);
const repo = tempDir("pos1155-held-extent-");
const put = (p, content) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE", "WORLD_SINGLE_LOG", "WORLD_POOL", "TOWN_CLONE", "WORLD2_CANDLE"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
let pool;

const SHA = "e".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const LAW = [
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("thing", { extends: "sited" }),
  cls("consumable", { extends: "thing" }), cls("candy", { extends: "consumable" }), cls("pocket-comet", { extends: "candy" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  prop("postmark-node", "makers", false, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"), prop("thing", "open", true, "sovereign", "holder"),
];

let callHoldTool, resetLawSnapshot, withdrawMarkViaOffice, leaveMarkViaOffice, worldMarkById;
if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  const root = { id: "the-town/let-there-be-light", by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 } };
  // sbx-ext's own parcel, edge at x,y = -0.2: the standpoint (0,0) is 0.2 m inside it, so a 0.3×0.2 footprint stands wholly on it and a 1×1 does not
  const yard = { id: "sbx-ext/yard", by: "sbx-ext", slug: "yard", kind: "parcel", at: { x: 12.3, y: 12.3 }, extent: { w: 25, h: 25 }, date: "2026-01-01" };
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  put("WORLD/marks/sbx-ext/yard/mark.md", markRecord(yard, "A synthetic parcel."));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [root, yard] }));
  copyFileSync(join(WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD", "tools"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "synthetic canon"]);
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: store.url("office_api") });
  Object.assign(process.env, { TOWN_CLONE: join(repo, "no-town-clone"), WORLD_CLONE: repo, WORLD_SINGLE_LOG: "1", WORLD_POOL: "0", WORLD2_PG: "1",
    WORLD2_PG_URL: store.url("office_api"), W2_PEN: "hold,mark", W2_GUARDS: "1", WORLD2_CANDLE: "1" });
  (await import("../src/world2-pen.mjs")).__setPoolForTest(pool);
  const snap = await import("../src/law-snapshot.mjs");
  resetLawSnapshot = snap.resetLawSnapshot;
  await snap.reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === snap.LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : LAW }) });
  ({ callHoldTool } = await import("../src/world-hold.mjs"));
  ({ withdrawMarkViaOffice, leaveMarkViaOffice, worldMarkById } = await import("../src/world.mjs"));
}
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  resetLawSnapshot?.();
  if (!skip) (await import("../src/world2-pen.mjs")).__setPoolForTest(null);
  if (pool) await pool.end(); await store.stop();
});

const WHO = "sbx-ext";
const KEY = { household: WHO, handles: new Set([WHO]) };
const owner = async (fn) => { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } };
const q = (sql, a = []) => owner(async (c) => (await c.query(sql, a)).rows);
const holdRows = (ids) => q("SELECT id::text, action, object, payload FROM acts WHERE class = 'holding' AND object = ANY($1) AND action NOT LIKE 'units:%' ORDER BY acts.id", [ids]);
const draftOf = async (id) => (await q("SELECT status, geometry FROM claims WHERE slug = $1 ORDER BY submitted_at DESC LIMIT 1", [id]))[0] ?? null;
const seedWindow = () => owner((c) => c.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (300, now() - interval '2 days', now() + interval '2 days', 'open') ON CONFLICT (id) DO NOTHING"));
const make = (slug, extra = {}) => leaveMarkViaOffice(repo, { slug, body: `A ${slug}.`, to: WHO, ...extra }, KEY);
const setDown = async (id) => {
  const r = await callHoldTool("world_hold", { thing: id, accept: true }, KEY, { verb: "drop" });
  assert.equal(r.did, "set-down", JSON.stringify(r).slice(0, 400));
  return r;
};
const sized = (g) => ({ w: g?.extent?.w, h: g?.extent?.h });

test("the round trip: 0.3×0.2 made into hands is set down at 0.3×0.2; one made without an extent is set down at 1×1", { skip }, async () => {
  await seedWindow();
  const small = await make("pebble", { extent: { w: 0.3, h: 0.2 } });
  assert.ok(!small?.error, JSON.stringify(small).slice(0, 300));
  const plain = await make("plain-rock");
  assert.ok(!plain?.error, JSON.stringify(plain).slice(0, 300));
  // the hold record keeps the make whole, size included; the plain one has no size key at all (as every record before this change)
  assert.deepEqual((await holdRows([`${WHO}/pebble`]))[0].payload.made.extent, { w: 0.3, h: 0.2 });
  assert.equal("extent" in (await holdRows([`${WHO}/plain-rock`]))[0].payload.made, false);
  // the held read: in hands, with no place and no footprint
  for (const id of [`${WHO}/pebble`, `${WHO}/plain-rock`]) {
    const m = (await worldMarkById(id)).mark;
    assert.equal(m?.held_by, WHO, `${id} is held`);
    assert.equal(m.at, undefined, "no phantom position");
    assert.equal(m.extent, undefined, "no phantom footprint");
  }
  await setDown(`${WHO}/pebble`);
  await setDown(`${WHO}/plain-rock`);
  assert.deepEqual(sized((await draftOf(`${WHO}/pebble`)).geometry), { w: 0.3, h: 0.2 }, "set down at the size it was made with");
  assert.deepEqual(sized((await draftOf(`${WHO}/plain-rock`)).geometry), { w: 1, h: 1 }, "no declared size: today's 1×1");
  assert.equal((await draftOf(`${WHO}/pebble`)).geometry.at.x, (await draftOf(`${WHO}/plain-rock`)).geometry.at.x, "both stood where the dropper stood");
});

test("put back and set down again: a full holder keeps its size (the put-back is the make's own record, whole)", { skip }, async () => {
  await seedWindow();
  await make("lantern", { holder: true, extent: { w: 2.5, h: 0.75 } });
  const id = `${WHO}/lantern`;
  await leaveMarkViaOffice(repo, { slug: "wick", body: "A wick.", to: id }, KEY); // a FULL holder is the one a withdrawal puts back (WLD-138 B)
  await setDown(id);
  assert.deepEqual(sized((await draftOf(id)).geometry), { w: 2.5, h: 0.75 });
  const w = await withdrawMarkViaOffice(repo, { mark: id }, KEY);
  assert.equal(w.withdrawn, true, JSON.stringify(w).slice(0, 300));
  assert.equal(w.put_back, 1, JSON.stringify(w).slice(0, 300));
  const rows = await holdRows([id]);
  assert.deepEqual(rows.map((r) => r.action), ["make", "set-down", "put-back"]);
  assert.deepEqual(rows[2].payload.made.extent, { w: 2.5, h: 0.75 }, "the put-back carries the size whole");
  assert.equal((await worldMarkById(id)).mark?.held_by, WHO);
  await setDown(id);
  assert.deepEqual(sized((await draftOf(id)).geometry), { w: 2.5, h: 0.75 }, "set down again at the same size");
});

test("at and points are still refused, a count of a kind takes no size, and a bad size is refused: nothing is made, nothing recorded", { skip }, async () => {
  await seedWindow();
  const before = (await q("SELECT count(*)::int AS n FROM acts"))[0].n;
  const refused = async (payload, rx) => {
    const r = await leaveMarkViaOffice(repo, { to: WHO, ...payload }, KEY).then((x) => ({ ok: x }), (e) => ({ e }));
    const e = r.e ?? r.ok?.error ?? null;
    assert.ok(e, `${JSON.stringify(payload)} must be refused, got ${JSON.stringify(r.ok)?.slice(0, 200)}`);
    assert.equal(e.code ?? r.ok?.code, 422, JSON.stringify(payload));
    assert.match(e.defect ?? e.message ?? "", rx, JSON.stringify(payload));
  };
  await refused({ slug: "r-at", body: "x", at: { x: 1, y: 1 } }, /has no place: at/);
  await refused({ slug: "r-pts", body: "x", points: [[0, 0], [1, 0], [1, 1]] }, /has no place: points/);
  await refused({ slug: "r-both", body: "x", extent: { w: 1, h: 1 }, at: { x: 1, y: 1 } }, /has no place: at/);
  await refused({ kind: "pocket-comet", count: 2, extent: { w: 1, h: 1 } }, /one named thing's own size/);
  for (const extent of [{ w: 0, h: 1 }, { w: -1, h: 1 }, { w: 1 }, { w: "1", h: "1" }, [1, 1]])
    await refused({ slug: "r-bad", body: "x", extent }, /extent is how big the thing is/);
  assert.equal((await q("SELECT count(*)::int AS n FROM acts"))[0].n, before, "no refusal wrote an act");
  assert.equal((await holdRows([`${WHO}/r-at`, `${WHO}/r-pts`, `${WHO}/r-both`, `${WHO}/r-bad`])).length, 0, "and no name was taken");
});

test("the ground is asked at the SAME size the draft is written with: a 0.3×0.2 thing set down at the edge of its maker's parcel is free; a plain 1×1 sticks out and asks a stamp", { skip }, async () => {
  await seedWindow();
  await make("chip", { extent: { w: 0.3, h: 0.2 } });
  await make("slab");
  const free = await callHoldTool("world_hold", { thing: `${WHO}/chip` }, KEY, { verb: "drop" });
  assert.equal(free.did, "set-down", `a 0.3×0.2 footprint is wholly on its maker's own ground: free, no terms (${JSON.stringify(free).slice(0, 300)})`);
  assert.equal(free.stake_bounce, undefined);
  assert.deepEqual(sized((await draftOf(`${WHO}/chip`)).geometry), { w: 0.3, h: 0.2 });
  const terms = await callHoldTool("world_hold", { thing: `${WHO}/slab` }, KEY, { verb: "drop" });
  assert.equal(terms.did, undefined, "the 1×1 reaches past the parcel's edge, so it is not free here: the answer is the terms, written nothing");
  assert.ok(terms.stake >= 1 || terms.terms, JSON.stringify(terms).slice(0, 300));
  assert.equal(await draftOf(`${WHO}/slab`), null, "terms recorded no draft");
});
