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

test("LIMIT, measured · a full holder set down on the COMMONS with no stamp that lands is REFUSED by the clearing: it does not publish, its contents stay keyed to it, and its maker's withdrawal is refused BY NAME rather than answering 'withdrawn' over contents no door reaches (outside the ruled return, which is the withdrawal of a draft or pending claim)", { skip }, async () => {
  await seedClearing();
  const NO = keyOf("sbx-no");
  await owner((c) => c.query("INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ('sbx-no', 7, 'sbx-no', ARRAY['sbx-no'], '2026-08-01', 'sbx-no') ON CONFLICT DO NOTHING"));
  const { bag } = await fullBag("commons-bag", { who: "sbx-no", slips: 1, units: 3 });
  const sd = await setDown(bag, NO);
  assert.match(sd.stands_note, /but the stamp did not land: it publishes only with one behind it .*holding 1 whole thing and 3 units/, sd.stands_note);
  // the candle the set-down went forward on (301, opened by the last clearing), closed now so it can clear
  const [{ id: win }] = await q("SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  await owner((c) => c.query("UPDATE windows SET closes_at = date_trunc('second', now()) WHERE id = $1", [win]));
  const r = clear(win);
  assert.equal(r.code, 0, r.out);
  const status = (await q("SELECT status FROM claims WHERE slug = $1 ORDER BY submitted_at DESC LIMIT 1", [bag]))[0]?.status;
  assert.equal(status, "refused", r.out);
  assert.equal(await unitsIn(bag), 3, "the units are still the holder's, by its id");
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: bag }, NO), (e) => {
    assert.equal(e.code, 409, `${e.defect} — ${e.hint}`);
    assert.match(e.defect, /is a holder set down full, and it cannot be withdrawn now/);
    assert.match(e.hint, /\(it is refused now\)\. Nothing was withdrawn and nothing was recorded/);
    return true;
  });
  assert.deepEqual((await holdRows([bag])).map((x) => x.action), ["make", "set-down"], "no put-back: the ruled return is not this case");
});
