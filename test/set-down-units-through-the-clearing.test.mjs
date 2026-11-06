// set-down-units-through-the-clearing.test.mjs — WLD-138 F2: COUNTED UNITS ENTER A MADE HOLDER, AND
// SET DOWN FULL THEY PRINT INSIDE IT AT THE SETTLEMENT (Darko 2026-11-03, "Yes, at settlement").
//
//   node --test test/set-down-units-through-the-clearing.test.mjs
//
// The REAL doors, with prod's flags (the hold and mark lanes flipped, the guards on, the single log),
// on a real store (embedded-store.mjs), over a throwaway world: leave-mark makes a holder into hands
// and things into it (named slips, and counted units by leave-mark { kind, count, to }), world_hold
// sets it down, and the public withdraw door (`withdrawMarkViaOffice`) withdraws its draft. The one
// writer of the put-back is the withdrawal's own transaction (src/set-down-return.mjs § putBackGuard).
// Everything here is invented: sbx-cy, sbx-dee, a bag, slips, pocket comets.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { markRecord } from "../src/mark-record.mjs";

const WORLD = worldClone();
const store = await startStore({ db: "set_down_units_clearing" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);
const repo = mkdtempSync(join(tmpdir(), "wld138-f2-"));
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

const PARCEL = "sbx-mo/home";
let callHoldTool, resetLawSnapshot, withdrawMarkViaOffice, leaveMarkViaOffice, worldMarkById;
if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  const root = { id: "the-town/let-there-be-light", by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 } };
  // sbx-mo's own parcel, around where a resident the record places nowhere else stands (the Origin): a set-down there is free
  const parcel = { id: PARCEL, by: "sbx-mo", slug: "home", kind: "parcel", at: { x: 0, y: 0 }, extent: { w: 40, h: 40 } };
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  put("WORLD/marks/sbx-mo/home/mark.md", markRecord(parcel, "sbx-mo's invented home parcel."));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [root, parcel] }));
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

const keyOf = (h) => ({ household: h, handles: new Set([h]) });
const KEY = keyOf("sbx-cy");
const DEE = { household: "sbx-dee", handles: new Set(["sbx-dee"]) };
const owner = async (fn) => { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } };
const q = (sql, a = []) => owner(async (c) => (await c.query(sql, a)).rows);
/** The thing's own hold rows (a counted unit's act names its holder as `object` too, and is not one). */
const holdRows = (ids) => q("SELECT id::text, action, object, actor, nonce, payload FROM acts WHERE class = 'holding' AND object = ANY($1) AND action NOT LIKE 'units:%' ORDER BY acts.id", [ids]);
const claimOf = async (id) => (await q("SELECT status FROM claims WHERE slug = $1 ORDER BY submitted_at DESC LIMIT 1", [id]))[0]?.status ?? null;
const unitsIn = async (holder) => {
  const { foldUnits, totalOf, isUnitRow } = await import("../src/world-stacks.mjs");
  const rows = await q("SELECT id AS seq, class, action, object, payload FROM acts WHERE class = 'holding' AND action LIKE 'units:%' ORDER BY id");
  return totalOf(foldUnits(rows.map((r) => ({ ...r, seq: Number(r.seq) })).filter(isUnitRow)), holder);
};
const seedWindow = () => owner((c) => c.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (300, now() - interval '2 days', now() + interval '2 days', 'open') ON CONFLICT (id) DO NOTHING"));

/** A full bag in sbx-cy's hands: `slips` named things and `units` pocket comets inside, made at the real door. */
async function fullBag(slug, { slips = 2, units = 5, who = "sbx-cy" } = {}) {
  const key = keyOf(who);
  const bag = `${who}/${slug}`;
  await leaveMarkViaOffice(repo, { slug, body: "A cloth bag.", holder: true, to: who }, key);
  const ids = [];
  for (let i = 1; i <= slips; i += 1) {
    await leaveMarkViaOffice(repo, { slug: `${slug}-slip-${i}`, body: `Slip ${i}.`, to: bag }, key);
    ids.push(`${who}/${slug}-slip-${i}`);
  }
  if (units) await leaveMarkViaOffice(repo, { kind: "pocket-comet", count: units, to: bag }, key);
  return { bag, slips: ids, key, who };
}
const setDown = async (bag, key = KEY) => {
  const r = await callHoldTool("world_hold", { thing: bag, accept: true }, key, { verb: "drop" });
  assert.equal(r.did, "set-down", JSON.stringify(r).slice(0, 400));
  return r;
};


import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const JOB = join(dirname(fileURLToPath(import.meta.url)), "..", "world2", "tools", "clearing-job.mjs");
const clear = (win = 300) => {
  const r = spawnSync(process.execPath, [JOB, "--window", String(win)], { cwd: join(dirname(fileURLToPath(import.meta.url)), ".."), encoding: "utf8",
    env: { PATH: process.env.PATH, WORLD2_CLEARING_URL: store.url("clearing_job") } });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

const seedClearing = () => owner(async (c) => {
  if ((await c.query("SELECT 1 FROM windows WHERE id = 299")).rows.length) return; // once per store: the candle tiles time
  await c.query("INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES (299, date_trunc('second', now()) - interval '4 days', date_trunc('second', now()) - interval '2 days', 'closed', date_trunc('second', now()) - interval '2 days') ON CONFLICT (id) DO NOTHING");
  await c.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (300, date_trunc('second', now()) - interval '2 days', date_trunc('second', now()) - interval '1 minute', 'open') ON CONFLICT (id) DO NOTHING");
  await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now()) ON CONFLICT DO NOTHING", ["l".repeat(40), "t".repeat(40)]);
  await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
    VALUES ('c0000000-0000-4000-8000-000000000001', $1, 'parcel', 'sbx-mo', 'hh:sbx-mo', 'home.', $2, '((-20,-20),(20,20))'::box, 'standing', 299, '{}')
    ON CONFLICT DO NOTHING`, [PARCEL, JSON.stringify({ at: { x: 0, y: 0 }, extent: { w: 40, h: 40 } })]);
  for (const [i, h] of ["sbx-mo", "sbx-dee"].entries()) {
    await c.query("INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ($1, $2, $1, ARRAY[$1], '2026-08-01', $1) ON CONFLICT DO NOTHING", [h, i]);
    await c.query("INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ($1, $1, $2, '2026-08-01') ON CONFLICT DO NOTHING", [h, 900 + i]);
  }
});
const MO = keyOf("sbx-mo");

test("F2 · COUNTED UNITS IN A MADE HOLDER, set down at the real door and published by the real clearing: the same holder id holds them inside, a full 30 and a mixed 2 named + 28 counted; a reader takes one out; a second clearing doubles nothing", { skip }, async () => {
  await seedClearing();
  // the producer: the real leave-mark door makes counted units into a made holder in hand (the review's F2 probe, now a test)
  const full = await fullBag("full-bag", { who: "sbx-mo", slips: 0, units: 30 });
  const mixed = await fullBag("mixed-bag", { who: "sbx-mo", slips: 2, units: 28 });
  assert.equal(await unitsIn(full.bag), 30, "30 counted units are in the made holder");
  assert.equal(await unitsIn(mixed.bag), 28);
  await assert.rejects(leaveMarkViaOffice(repo, { kind: "pocket-comet", count: 1, to: full.bag }, MO), (e) => e.code === 409 && /room for 0/.test(e.defect), "full: its capacity is 30");
  for (const b of [full, mixed]) {
    const r = await setDown(b.bag, MO);
    assert.match(r.stands_note, /on its own ground, free: it publishes at the next settlement, holding/, r.stands_note);
  }
  assert.equal(await unitsIn(full.bag), 30, "pending: still inside, keyed to the same id");
  assert.equal(await unitsIn("sbx-mo"), 0, "nothing loose in hand");

  // the real clearing (world2/tools/clearing-job.mjs, the clearing_job pen) publishes both drafts
  const r1 = clear();
  assert.equal(r1.code, 0, r1.out);
  assert.match(r1.out, /"locked":2/, r1.out);
  const standing = await q("SELECT slug, geometry, data FROM marks WHERE status = 'standing' AND slug = ANY($1) ORDER BY slug", [[full.bag, mixed.bag]]);
  assert.deepEqual(standing.map((m) => [m.slug, m.data.holder, m.geometry?.extent]), [[full.bag, true, { w: 1, h: 1 }], [mixed.bag, true, { w: 1, h: 1 }]],
    "each holder stands where it was set down, under its own id");
  const actsBefore = (await q("SELECT count(*)::int AS n FROM acts"))[0].n;

  // the consumers: the one world and the hold door read the same holder, holding what it held
  assert.equal(await unitsIn(full.bag), 30, "the 30 are still the holder's, by its id, after publication");
  assert.equal(await unitsIn(mixed.bag), 28);
  for (const slip of mixed.slips) {
    const m = (await worldMarkById(slip)).mark;
    assert.equal(m?.held_by, mixed.bag, `${slip} is inside the published holder`);
    assert.equal(m?.at, undefined, `${slip} is not loose`);
  }
  assert.equal((await q("SELECT count(*)::int AS n FROM marks WHERE slug = ANY($1)", [mixed.slips]))[0].n, 0, "the named contents are never printed as marks of their own");
  // THE ONE SEAM: the World settlement carries the store's standing rows into canon (store-writedown → sweep → fold,
  // the World's own law), which this office test does not run. The clearing's own row for the bag is laid into the
  // throwaway canon as it stands (its id, geometry and data, nothing else), so the hold door reads the holder the
  // clearing published; what the door reads INSIDE it (the units, by the holder's id) is the store's, untouched.
  const [row] = await q("SELECT slug, kind, owner, geometry, data, body FROM marks WHERE slug = $1", [full.bag]);
  const { readFileSync } = await import("node:fs");
  const published = { id: row.slug, by: row.owner, slug: row.slug.split("/")[1], kind: row.kind, ...row.data, at: row.geometry.at, extent: row.geometry.extent };
  put(`WORLD/marks/${row.slug}/mark.md`, markRecord(published, row.body ?? "A cloth bag."));
  const ws = JSON.parse(readFileSync(join(repo, "WORLD", "world-state.json"), "utf8"));
  put("WORLD/world-state.json", JSON.stringify({ ...ws, marks: [...ws.marks, published] }));
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "the settlement carries the clearing's row (test seam)"]);
  const took = await callHoldTool("world_hold", { from: full.bag, kind: "pocket-comet", count: 2 }, MO);
  assert.equal(await unitsIn(full.bag), 28, JSON.stringify(took).slice(0, 300));
  assert.equal(await unitsIn("sbx-mo"), 2, "two taken out of the published holder into hand");

  // a second clearing of the same candle: nothing printed, nothing moved, no unit doubled
  const r2 = clear();
  assert.doesNotMatch(r2.out, /⚑ hold:/, r2.out);
  assert.equal((await q("SELECT count(*)::int AS n FROM marks WHERE status = 'standing' AND slug = ANY($1)", [[full.bag, mixed.bag]]))[0].n, 2);
  assert.equal(await unitsIn(full.bag), 28);
  assert.equal(await unitsIn(mixed.bag), 28);
  assert.ok((await q("SELECT count(*)::int AS n FROM acts"))[0].n >= actsBefore);
});

// ── A CLAIM THE CLEARING REFUSED (Wright, AUTHORITY 2026-11-04T21:57:51.368Z) ──────────────────────────
// "A refused full holder is never stranded. Its dropper gets it back, holder and contents together, by withdrawing
// it." HISTORY, kept: this file's LIMIT test measured the hole at 17662581 — refused at the clearing, its units
// keyed to it, and its withdrawal answered 409 "(it is refused now)". The same fixture now proves the return; the
// old answer is a flip's red (the guard without `refused`). MEASURED BEFORE BUILDING: refusal is final. No pen may
// move a `refused` row (007_private_drafts.sql § the transition guard), and the stake door cannot see a refused
// mark (404 below), so the withdrawal is the one way home and no stake can race it for the refused claim.

/** The open candle closed and cleared by the real clearing (a window must last a second: the candle tiles time). */
const clearOpen = async () => {
  await new Promise((r) => setTimeout(r, 1100));
  const [{ id: win }] = await q("SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  await owner((c) => c.query("UPDATE windows SET closes_at = date_trunc('second', now()) WHERE id = $1", [win]));
  const r = clear(win);
  assert.equal(r.code, 0, r.out);
  return r;
};
const house = (who, ord) => owner((c) => c.query("INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ($1, $2, $1, ARRAY[$1], '2026-08-01', $1) ON CONFLICT DO NOTHING", [who, ord]));
/** A full holder set down where its maker does not own the ground (sbx-mo's parcel, at the Origin), no stamp behind it. */
async function setDownUnbacked(who, ord, slug, { slips = 1, units = 3 } = {}) {
  await seedClearing();
  await house(who, ord);
  const b = await fullBag(slug, { who, slips, units });
  const sd = await setDown(b.bag, b.key);
  assert.match(sd.stands_note, /but the stamp did not land: it publishes only with one behind it/, sd.stands_note);
  return b;
}
/** ... and refused by the real clearing. */
async function refusedBag(who, ord, slug, opts) {
  const b = await setDownUnbacked(who, ord, slug, opts);
  const r = await clearOpen();
  assert.equal(await claimOf(b.bag), "refused", r.out);
  return b;
}
const claimRows = (bag) => q("SELECT status, refusal_check FROM claims WHERE slug = $1 ORDER BY submitted_at", [bag]);

test("REFUSED, then WITHDRAWN · a full holder (1 named slip, 3 counted units) the clearing refused comes back WHOLE to its maker's hands, once: the same id, record and contents, every take path reaches them; a second withdrawal is refused and writes nothing", { skip }, async () => {
  const { bag, slips, key } = await refusedBag("sbx-no", 7, "commons-bag", { slips: 1, units: 3 });
  assert.equal(await unitsIn(bag), 3, "refused: the units are still the holder's, by its id");
  const before = await claimRows(bag);
  const w = await withdrawMarkViaOffice(repo, { mark: bag }, key);
  assert.equal(w.put_back, 1, JSON.stringify(w).slice(0, 400));
  assert.match(w.put_back_note, /its claim refused at the clearing, so sbx-no\/commons-bag came back to sbx-no, whole, with 3 units and 1 whole thing inside/);
  const rows = await holdRows([bag]);
  assert.deepEqual(rows.map((r) => r.action), ["make", "set-down", "put-back"]);
  assert.equal(rows[2].nonce, `put-back:${rows[1].id}`);
  assert.deepEqual(rows[2].payload.made, rows[0].payload.made, "the make's own record, whole");
  assert.deepEqual(await claimRows(bag), before, "the refused claim is as the clearing left it: nothing on the clearing side writes");
  assert.equal((await worldMarkById(bag)).mark?.held_by, "sbx-no", "in its maker's hands again");
  assert.equal((await worldMarkById(slips[0])).mark?.held_by, bag, "the slip is still the bag's");
  assert.equal(await unitsIn(bag), 3, "the 3 units are still the bag's, never loose");
  assert.equal(await unitsIn("sbx-no"), 0);
  // every take path reaches what it holds
  await callHoldTool("world_hold", { from: bag, kind: "pocket-comet", count: 2 }, key);
  assert.equal(await unitsIn(bag), 1);
  assert.equal(await unitsIn("sbx-no"), 2, "counted units taken out of it into hand");
  await callHoldTool("world_hold", { thing: slips[0] }, key, { verb: "take" });
  assert.equal((await worldMarkById(slips[0])).mark?.held_by, "sbx-no", "the named slip taken out of it into hand");
  const made = await leaveMarkViaOffice(repo, { slug: "commons-bag-slip-2", body: "Slip 2.", to: bag }, key);
  assert.equal(made.did, "make", JSON.stringify(made).slice(0, 300));
  assert.equal((await worldMarkById("sbx-no/commons-bag-slip-2")).mark?.held_by, bag, "and a thing made into it lands: its room is not 'withdrawn'");
  // exactly once: a second withdrawal is refused (Wright 21:57), and writes nothing
  const actsBefore = (await q("SELECT count(*)::int AS n FROM acts"))[0].n;
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: bag }, key), (e) => e.code === 409 && /already came back whole \(act \d+\)/.test(e.defect)
    && /a second withdrawal is refused\. Nothing was withdrawn now and nothing was recorded/.test(e.hint));
  assert.equal((await q("SELECT count(*)::int AS n FROM acts"))[0].n, actsBefore, "the second withdrawal writes nothing");
  assert.deepEqual(await claimRows(bag), before, "nor touches the docket");
  assert.deepEqual((await holdRows([bag])).map((r) => r.action).filter((a) => a === "put-back"), ["put-back"]);
});

test("REFUSED · THE CONTROLS on a mixed holder (2 slips, 3 units): another house 403, a later guard rolls the put-back back, a lane with no transaction refuses by name, full hands 409 — each writes nothing and leaves the refused claim as it was; with room, it comes back once", { skip }, async () => {
  const who = "sbx-np", key = keyOf("sbx-np");
  const { bag, slips } = await refusedBag(who, 8, "mixed-commons-bag", { slips: 2, units: 3 });
  const before = await claimRows(bag);
  const unchanged = async (why) => {
    assert.deepEqual((await holdRows([bag])).map((r) => r.action), ["make", "set-down"], `${why}: no put-back`);
    assert.deepEqual(await claimRows(bag), before, `${why}: the claim as it was`);
    assert.equal((await worldMarkById(slips[1])).mark?.held_by, bag, `${why}: the contents inside`);
    assert.equal(await unitsIn(bag), 3, why);
  };
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: bag }, DEE), (e) => e.code === 403 && /only the hand that left a mark may withdraw it/.test(e.defect));
  await unchanged("another house");
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: bag }, key, { escrowOf: async () => 2 }), (e) => e.code === 409 && /escrow/.test(e.defect));
  await unchanged("the escrow guard, later in the same write");
  process.env.WORLD_SINGLE_LOG = "";
  try {
    await assert.rejects(withdrawMarkViaOffice(repo, { mark: bag }, key), (e) => e.code === 409 && e.reason === "set-down-holder-withdraw-store-only");
  } finally { process.env.WORLD_SINGLE_LOG = "1"; }
  await unchanged("the git lane");
  const { holdingsOf } = await import("../src/world-hold.mjs");
  const { guardedAttachments } = await import("../src/world2-guards.mjs");
  const inHand = holdingsOf(await guardedAttachments(), who).length + await unitsIn(who);
  for (let i = inHand; i < 24; i += 1) await leaveMarkViaOffice(repo, { slug: `np-pebble-${i}`, body: "A pebble.", to: who }, key);
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: bag }, key), (e) => {
    assert.equal(e.code, 409, `${e.defect} — ${e.hint}`);
    assert.match(e.defect, /sbx-np's hands are full \(24\/24\) — the holder this mark is would come back to them, whole/);
    return true;
  });
  await unchanged("full hands");
  await callHoldTool("world_hold", { thing: `${who}/np-pebble-23`, to: "sbx-dee" }, key);
  const w = await withdrawMarkViaOffice(repo, { mark: bag }, key);
  assert.equal(w.put_back, 1, JSON.stringify(w).slice(0, 300));
  for (const s of slips) assert.equal((await worldMarkById(s)).mark?.held_by, bag);
  assert.equal(await unitsIn(bag), 3);
  assert.equal((await worldMarkById(bag)).mark?.held_by, who);
});

test("REFUSED · STAKE and WITHDRAW at once on one refused claim, at the real doors: exactly one wins — the withdrawal; the stake door cannot see a refused mark, so it moves nothing and files nothing (refusal is final)", { skip }, async () => {
  const who = "sbx-nq", key = keyOf("sbx-nq");
  const { bag } = await refusedBag(who, 9, "raced-bag", { slips: 1, units: 2 });
  const { worldStakeViaOffice } = await import("../src/world-stake.mjs");
  const before = await claimRows(bag);
  const [stake, withdrawal] = await Promise.allSettled([worldStakeViaOffice({ mark: bag, stamps: 1 }, key), withdrawMarkViaOffice(repo, { mark: bag }, key)]);
  assert.equal(withdrawal.status, "fulfilled", String(withdrawal.reason?.defect ?? withdrawal.reason));
  assert.equal(withdrawal.value.put_back, 1);
  const s = stake.status === "fulfilled" ? stake.value : stake.reason;
  assert.equal(s.code, 404, JSON.stringify(s).slice(0, 300));
  assert.match(s.defect, /no mark "sbx-nq\/raced-bag" in the world you can see/);
  assert.deepEqual(await claimRows(bag), before, "nothing filed, nothing put forward: one refused row, as the clearing left it");
  assert.deepEqual((await holdRows([bag])).map((r) => r.action), ["make", "set-down", "put-back"], "one return");
  // and in the other order, the stake first: it still moves nothing, so the withdrawal it precedes is the only act
  const other = await refusedBag("sbx-nu", 13, "staked-first-bag", { slips: 1, units: 1 });
  const s2 = await worldStakeViaOffice({ mark: other.bag, stamps: 1 }, other.key);
  assert.equal(s2.code, 404, JSON.stringify(s2).slice(0, 300));
  assert.equal((await withdrawMarkViaOffice(repo, { mark: other.bag }, other.key)).put_back, 1);
});

test("HELD FOR REVIEW · not withdrawn while the review is open, and its maker's read says it waits; the review refuses it (the real review-rule tool), and then the withdrawal brings it back whole", { skip }, async () => {
  const who = "sbx-nr", key = keyOf("sbx-nr");
  const { bag, slips } = await setDownUnbacked(who, 10, "held-bag", { slips: 1, units: 2 });
  // THE ONE FIXTURE STEP, disclosed: the clearing holds only PARCEL claims that collide (clearing-job.mjs step 5),
  // and a set-down's claim is a thing's, so no door brings it to `held_review`. The state is written by the pen
  // that alone writes it (clearing_job), as step 5 would, with step 5's own words.
  const cj = await store.connect("clearing_job");
  try { await cj.query("UPDATE claims SET status = 'held_review', refusal_check = 'counterclaim: a fixture contest — a mind rules (census D2)', decided_at = now() WHERE slug = $1 AND status = 'pending'", [bag]); }
  finally { await cj.end(); }
  await clearOpen(); // the candle closes over it; a held claim is not the clearing's to move
  assert.equal(await claimOf(bag), "held_review");
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: bag }, key), (e) => {
    assert.equal(e.code, 409, `${e.defect} — ${e.hint}`);
    assert.match(e.defect, /is a holder set down full, and its claim is held for review/);
    assert.match(e.hint, /not stranded, only waiting.*It cannot be withdrawn while the review is open\. Nothing was withdrawn and nothing was recorded/);
    return true;
  });
  assert.deepEqual((await holdRows([bag])).map((r) => r.action), ["make", "set-down"]);
  const { worldInvestigate } = await import("../src/world.mjs");
  const held = await worldInvestigate({ mark: bag }, key);
  assert.equal(held.receipt?.status, "held_review", JSON.stringify(held.receipt).slice(0, 400));
  assert.match(held.receipt?.next ?? "", /not stranded, only waiting.*It cannot be withdrawn while the review is open/);
  assert.doesNotMatch(held.receipt?.next ?? "", /world_withdraw_mark/, "no forbidden withdrawal offered");
  // the outcome: the review refuses it, through the tool that writes rulings
  const [{ id }] = await q("SELECT id::text FROM claims WHERE slug = $1 AND status = 'held_review'", [bag]);
  const RULE = join(dirname(fileURLToPath(import.meta.url)), "..", "world2", "tools", "review-rule.mjs");
  const ruled = spawnSync(process.execPath, [RULE, "--claim", id, "--rule", "refuse", "--by", "sbx-reviewer", "--because", "an invented contest, refused for the test"],
    { cwd: join(dirname(fileURLToPath(import.meta.url)), ".."), encoding: "utf8", env: { PATH: process.env.PATH, WORLD2_CLEARING_URL: store.url("clearing_job"), WORLD2_OFFICE_URL: store.url("office_api") } });
  assert.equal(ruled.status, 0, `${ruled.stdout}\n${ruled.stderr}`);
  assert.equal(await claimOf(bag), "refused");
  const w = await withdrawMarkViaOffice(repo, { mark: bag }, key);
  assert.equal(w.put_back, 1, JSON.stringify(w).slice(0, 300));
  assert.equal((await worldMarkById(slips[0])).mark?.held_by, bag);
  assert.equal(await unitsIn(bag), 2);
  assert.equal((await worldMarkById(bag)).mark?.held_by, who);
});

test("F3 · THE HONEST READ of a refused full holder: its maker is told it was not set down, why, what it holds, and the one way that works — withdraw it; a stake is never offered, and another house's read adds nothing", { skip }, async () => {
  const who = "sbx-ns", key = keyOf("sbx-ns");
  const { bag } = await refusedBag(who, 11, "told-bag", { slips: 1, units: 3 });
  const { worldInvestigate } = await import("../src/world.mjs");
  const look = await worldInvestigate({ mark: bag }, key);
  assert.equal(look.receipt?.status, "refused", JSON.stringify(look.receipt).slice(0, 400));
  const next = look.receipt?.next ?? "";
  assert.match(next, /^it was not set down: the clearing refused its claim \(unbacked: a mark on ground that is not its maker's publishes only with a stamp behind it\)/);
  assert.match(next, /a refused claim does not go back on the docket, so staking it now puts nothing forward/);
  assert.match(next, /It still holds 3 units and 1 whole thing, inside it and keyed to it: withdraw it \(world_withdraw_mark \{ mark: "sbx-ns\/told-bag" \}\) and it comes back whole to sbx-ns's hands/);
  assert.match(look.receipt?.says ?? "", /refused at candle \d+ — unbacked.*withdraw it/);
  const theirs = await worldInvestigate({ mark: bag }, keyOf("sbx-dee")).catch((e) => ({ error: e }));
  assert.doesNotMatch(JSON.stringify(theirs?.receipt ?? {}), /world_withdraw_mark/, "only its maker's household is told how to take it back");
  // and the way it names works
  assert.equal((await withdrawMarkViaOffice(repo, { mark: bag }, key)).put_back, 1);
});

test("REFUSED · TWO WITHDRAWALS AT ONCE: exactly one return and one withdrawal deed; the other is refused (409) and writes nothing", { skip }, async () => {
  const who = "sbx-nt", key = keyOf("sbx-nt");
  const { bag } = await refusedBag(who, 12, "twice-at-once-bag", { slips: 1, units: 2 });
  const both = await Promise.allSettled([withdrawMarkViaOffice(repo, { mark: bag }, key), withdrawMarkViaOffice(repo, { mark: bag }, key)]);
  const won = both.filter((r) => r.status === "fulfilled" && r.value.put_back === 1);
  assert.equal(won.length, 1, JSON.stringify(both.map((r) => r.value ?? { code: r.reason?.code, defect: r.reason?.defect })).slice(0, 600));
  const lost = both.find((r) => r !== won[0]);
  assert.equal(lost.status, "rejected", JSON.stringify(lost.value ?? null).slice(0, 300));
  assert.ok(lost.reason?.code === 409 && /already came back whole/.test(lost.reason.defect), lost.reason?.defect);
  assert.deepEqual((await holdRows([bag])).map((r) => r.action), ["make", "set-down", "put-back"]);
  assert.equal((await q("SELECT count(*)::int AS n FROM acts WHERE class = 'mark' AND action = 'withdraw' AND object = $1", [bag]))[0].n, 1, "one withdrawal deed");
  assert.equal(await unitsIn(bag), 2);
});

test("REFUSED · THE SAME NAME LEFT AGAIN (measured): a fresh leave-mark of the slug files a NEW draft beside the refused claim, and the withdrawal then takes that draft off and brings the holder back once; after the return, the name is the thing's in hand", { skip }, async () => {
  const who = "sbx-nv", key = keyOf("sbx-nv");
  const { bag, slips } = await refusedBag(who, 14, "named-again-bag", { slips: 1, units: 2 });
  const again = await leaveMarkViaOffice(repo, { slug: "named-again-bag", body: "Again.", kind: "sited", at: { x: 500, y: 500 }, extent: { w: 1, h: 1 } }, key);
  assert.equal(again.put_forward, false, JSON.stringify(again).slice(0, 300));
  assert.deepEqual((await claimRows(bag)).map((c) => c.status), ["refused", "draft"], "a new draft: the refused claim itself is untouched");
  const w = await withdrawMarkViaOffice(repo, { mark: bag }, key);
  assert.equal(w.put_back, 1, JSON.stringify(w).slice(0, 300));
  assert.deepEqual((await claimRows(bag)).map((c) => c.status), ["refused"], "the new draft went with the withdrawal");
  assert.equal((await worldMarkById(bag)).mark?.held_by, who);
  assert.equal((await worldMarkById(slips[0])).mark?.held_by, bag);
  assert.equal(await unitsIn(bag), 2);
  const after = await leaveMarkViaOffice(repo, { slug: "named-again-bag", body: "Again.", kind: "sited", at: { x: 500, y: 500 }, extent: { w: 1, h: 1 } }, key)
    .then((r) => ({ ok: r }), (e) => ({ code: e.code, defect: e.defect }));
  assert.equal(after.code, 409, `after the return the name is the thing's in hand, so a fresh leave-mark of it is refused: ${JSON.stringify(after).slice(0, 300)}`);
  assert.match(after.defect, /is a thing made in hand, and its name is taken for good/);
  assert.deepEqual((await claimRows(bag)).map((c) => c.status), ["refused"]);
});
