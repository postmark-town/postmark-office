// set-down-holder-put-back.test.mjs — WLD-138 B: A FULL HOLDER SET DOWN AND WITHDRAWN BEFORE
// IT PUBLISHED COMES BACK WHOLE (Wright, AUTHORITY 2026-11-04T12:01:08.382Z and 16:00:21.585Z).
//
//   node --test test/set-down-holder-put-back.test.mjs
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
const store = await startStore({ db: "set_down_holder_put_back" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);
const repo = mkdtempSync(join(tmpdir(), "wld138-put-back-"));
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
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [root] }));
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

test("F1 · a full holder (2 named slips and 5 counted units) set down and withdrawn before it published comes back WHOLE: one put-back, the same id, record and contents, its draft gone", { skip }, async () => {
  await seedWindow();
  const { bag, slips } = await fullBag("whole-bag");
  const made = (await holdRows([bag])).find((r) => r.action === "make").payload.made;
  const sd = await setDown(bag);
  assert.match(sd.stands_note, /holding 2 whole things and 5 units: they stay inside it and publish with it/, "F3: the words name what it holds");
  assert.equal((await worldMarkById(bag)).mark, null, "pending: not on the world, not in hand");
  assert.ok(["draft", "pending"].includes(await claimOf(bag)), `its draft stands (${await claimOf(bag)})`);

  const w = await withdrawMarkViaOffice(repo, { mark: bag }, KEY);
  assert.equal(w.withdrawn, true, JSON.stringify(w).slice(0, 400));
  assert.equal(w.put_back, 1, JSON.stringify(w).slice(0, 400));
  assert.match(w.put_back_note, /came back to sbx-cy, whole, with 5 units and 2 whole things inside/);

  const rows = await holdRows([bag]);
  assert.deepEqual(rows.map((r) => r.action), ["make", "set-down", "put-back"], "one put-back, no second make");
  const pb = rows[2];
  assert.equal(pb.payload.holder, "sbx-cy", "back in the hands it was set down from");
  assert.equal(pb.payload.policy, "cascade");
  assert.deepEqual(pb.payload.made, made, "the make's own record, whole: the original id, words and fields");
  assert.equal(pb.nonce, `put-back:${rows[1].id}`, "once per set-down, by its nonce");
  assert.ok([null, "retracted"].includes(await claimOf(bag)), `the draft no longer stands: deleted, or retracted from the open candle (${await claimOf(bag)})`);

  const m = (await worldMarkById(bag)).mark;
  assert.equal(m?.held_by, "sbx-cy", "in hand again, on the world as a thing in hand");
  assert.equal(m?.body, made.body);
  for (const s of slips) assert.equal((await worldMarkById(s)).mark?.held_by, bag, `${s} is still inside it`);
  assert.equal(await unitsIn(bag), 5, "the 5 units are still inside it, none duplicated");
  assert.equal(await unitsIn("sbx-cy"), 0, "none loose in hand");
  // its name is still taken for good (G2): no second thing, no name taken
  await assert.rejects(leaveMarkViaOffice(repo, { slug: "whole-bag", body: "Again.", to: "sbx-cy" }, KEY), (e) => e.code === 409);
});

test("F1 · REPLAY and REPEAT: a second withdrawal writes nothing and says so; set down and withdrawn again, it comes back once more, by a new set-down's nonce, contents never doubled", { skip }, async () => {
  await seedWindow();
  const { bag, slips } = await fullBag("twice-bag", { who: "sbx-ed",  slips: 1, units: 3 });
  await setDown(bag, keyOf("sbx-ed"));
  await withdrawMarkViaOffice(repo, { mark: bag }, keyOf("sbx-ed"));
  const again = await withdrawMarkViaOffice(repo, { mark: bag }, keyOf("sbx-ed"));
  assert.equal(again.already, true, JSON.stringify(again).slice(0, 300));
  assert.equal(again.put_back, 0);
  assert.deepEqual((await holdRows([bag])).map((r) => r.action), ["make", "set-down", "put-back"], "nothing written by the replay");
  await setDown(bag, keyOf("sbx-ed"));
  const w2 = await withdrawMarkViaOffice(repo, { mark: bag }, keyOf("sbx-ed"));
  assert.equal(w2.put_back, 1, JSON.stringify(w2).slice(0, 300));
  const rows = await holdRows([bag]);
  assert.deepEqual(rows.map((r) => r.action), ["make", "set-down", "put-back", "set-down", "put-back"]);
  assert.notEqual(rows[2].nonce, rows[4].nonce, "each put-back is its own set-down's");
  assert.equal(rows[4].nonce, `put-back:${rows[3].id}`);
  assert.equal((await worldMarkById(bag)).mark?.held_by, "sbx-ed");
  assert.equal((await worldMarkById(slips[0])).mark?.held_by, bag);
  assert.equal(await unitsIn(bag), 3, "3 units, never 6");
});

test("F1 · THE CARRY CAP: with the hands it came from full, the withdrawal is refused before anything is written, and the holder stays pending whole; with room, it comes back", { skip }, async () => {
  await seedWindow();
  const { bag, slips } = await fullBag("capped-bag", { who: "sbx-fi",  slips: 1, units: 2 });
  await setDown(bag, keyOf("sbx-fi"));
  const { holdingsOf } = await import("../src/world-hold.mjs");
  const { guardedAttachments } = await import("../src/world2-guards.mjs");
  const inHand = holdingsOf(await guardedAttachments(), "sbx-fi").length + await unitsIn("sbx-fi");
  for (let i = inHand; i < 24; i += 1) await leaveMarkViaOffice(repo, { slug: `capped-pebble-${i}`, body: "A pebble.", to: "sbx-fi" }, keyOf("sbx-fi"));
  const claim = await claimOf(bag);
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: bag }, keyOf("sbx-fi")), (e) => {
    assert.equal(e.code, 409, `${e.defect} — ${e.hint}`);
    assert.match(e.defect, /sbx-fi's hands are full \(24\/24\) — the holder this mark is would come back to them, whole/);
    assert.match(e.hint, /Nothing was withdrawn and nothing was recorded/);
    return true;
  });
  assert.deepEqual((await holdRows([bag])).map((r) => r.action), ["make", "set-down"], "no put-back");
  assert.equal(await claimOf(bag), claim, "its draft still stands, as it was");
  assert.equal((await worldMarkById(bag)).mark, null, "still pending: neither in hand nor stranded");
  assert.equal((await worldMarkById(slips[0])).mark?.held_by, bag, "its contents still inside it");
  const { callKinds } = await import("../src/world-kinds.mjs");
  const { liveUnitDeps } = await import("../src/world-units.mjs");
  await callKinds("consume", { thing: "sbx-fi/capped-pebble-23" }, keyOf("sbx-fi"), "sbx-fi", await liveUnitDeps()).catch(async () => {
    // a pebble is not a consumable: give one to a neighbour instead, freeing the slot
    await callHoldTool("world_hold", { thing: "sbx-fi/capped-pebble-23", to: "sbx-dee" }, keyOf("sbx-fi"));
  });
  const w = await withdrawMarkViaOffice(repo, { mark: bag }, keyOf("sbx-fi"));
  assert.equal(w.put_back, 1, JSON.stringify(w).slice(0, 300));
  assert.equal(await unitsIn(bag), 2);
});

test("F1 · ROLLBACK and ESCROW: a guard that refuses later in the same withdrawal (the escrow, read in the write) rolls the put-back back with it: nothing written, the draft and the contents as they were", { skip }, async () => {
  await seedWindow();
  const { bag, slips } = await fullBag("escrow-bag", { who: "sbx-gu",  slips: 1, units: 1 });
  await setDown(bag, keyOf("sbx-gu"));
  const claim = await claimOf(bag);
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: bag }, keyOf("sbx-gu"), { escrowOf: async () => 2 }), (e) => {
    assert.equal(e.code, 409, `${e.defect} — ${e.hint}`);
    assert.match(e.defect, /escrow/);
    return true;
  });
  assert.deepEqual((await holdRows([bag])).map((r) => r.action), ["make", "set-down"], "the put-back rolled back with the withdrawal");
  assert.equal(await claimOf(bag), claim);
  assert.equal((await worldMarkById(slips[0])).mark?.held_by, bag);
  assert.equal(await unitsIn(bag), 1);
});

test("F1 · OWNERSHIP and the GIT LANE: another house cannot withdraw it; a lane with no withdrawal transaction refuses by name; neither writes anything", { skip }, async () => {
  await seedWindow();
  const { bag } = await fullBag("owned-bag", { who: "sbx-ha",  slips: 1, units: 1 });
  await setDown(bag, keyOf("sbx-ha"));
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: bag }, DEE), (e) => e.code === 403 && /only the hand that left a mark may withdraw it/.test(e.defect));
  process.env.WORLD_SINGLE_LOG = "";
  try {
    await assert.rejects(withdrawMarkViaOffice(repo, { mark: bag }, keyOf("sbx-ha")), (e) => {
      assert.equal(e.code, 409, `${e.defect} — ${e.hint}`);
      assert.equal(e.reason, "set-down-holder-withdraw-store-only");
      assert.match(e.defect, /is a holder set down full, and it is withdrawn only on the store's path/);
      return true;
    });
  } finally { process.env.WORLD_SINGLE_LOG = "1"; }
  assert.deepEqual((await holdRows([bag])).map((r) => r.action), ["make", "set-down"]);
  assert.ok(["draft", "pending"].includes(await claimOf(bag)));
});

test("F1 · an EMPTY set-down holder withdraws exactly as before: no put-back, the draft goes, the thing with it (the ruling is a FULL holder's)", { skip }, async () => {
  await seedWindow();
  const bag = "sbx-io/empty-bag";
  await leaveMarkViaOffice(repo, { slug: "empty-bag", body: "A cloth bag.", holder: true, to: "sbx-io" }, keyOf("sbx-io"));
  await setDown(bag, keyOf("sbx-io"));
  const w = await withdrawMarkViaOffice(repo, { mark: bag }, keyOf("sbx-io"));
  assert.equal(w.withdrawn, true);
  assert.equal(w.put_back, undefined, JSON.stringify(w).slice(0, 300));
  assert.deepEqual((await holdRows([bag])).map((r) => r.action), ["make", "set-down"]);
  assert.equal((await worldMarkById(bag)).mark, null);
});

test("F1 · EVERY DOOR READS IT: put back, the holder is a holder in hand again: investigate says so, a thing made into it lands (its room is not 'withdrawn'), a slip taken out of it comes to hand", { skip }, async () => {
  await seedWindow();
  const { worldInvestigate } = await import("../src/world.mjs");
  const { bag, slips } = await fullBag("reader-bag", { who: "sbx-ju",  slips: 2, units: 2 });
  await setDown(bag, keyOf("sbx-ju"));
  await withdrawMarkViaOffice(repo, { mark: bag }, keyOf("sbx-ju"));
  const look = await worldInvestigate({ mark: bag }, keyOf("sbx-ju"));
  assert.equal(look.receipt?.made_in_hand, true, JSON.stringify(look).slice(0, 400));
  assert.match(look.receipt?.says ?? "", /held by sbx-ju/);
  const made = await leaveMarkViaOffice(repo, { slug: "reader-bag-slip-3", body: "Slip 3.", to: bag }, keyOf("sbx-ju"));
  assert.equal(made.did, "make", JSON.stringify(made).slice(0, 300));
  assert.equal((await worldMarkById("sbx-ju/reader-bag-slip-3")).mark?.held_by, bag);
  const took = await callHoldTool("world_hold", { thing: slips[0] }, keyOf("sbx-ju"), { verb: "take" });
  assert.equal((await worldMarkById(slips[0])).mark?.held_by, "sbx-ju", JSON.stringify(took).slice(0, 300));
  // and the effect told of it is what happened, not a hand-over
  const { holdEffectsFrom } = await import("../src/world-hold.mjs");
  const rows = (await q("SELECT class, action, object, actor, crossing, payload FROM acts WHERE object = $1 AND action = 'put-back'", [bag]));
  const told = holdEffectsFrom({ rows, handles: ["sbx-ju"], sinceCrossing: 0, nowCrossing: 1e9 });
  assert.match(told[0]?.summary ?? "", /came back to sbx-ju, whole, its draft withdrawn before it published/);
});

test("F1 · THE SET-DOWN'S OWN ROLLBACK on the store's path: the set-down act fails, the draft goes back out, and the holder stays in hand with all it holds; the retry lands", { skip }, async () => {
  await seedWindow();
  const pen = await import("../src/world2-pen.mjs");
  const { bag, slips, key, who } = await fullBag("rollback-bag", { who: "sbx-ka", slips: 1, units: 2 });
  const { readStrands } = await import("../src/set-down-strands.mjs");
  const strandsBefore = readStrands().strands.length;
  const refusing = {
    connect: async () => {
      const c = await pool.connect();
      return new Proxy(c, { get(t, k) {
        if (k === "query") return (text, params) => {
          const sql = String(text?.text ?? text), vals = params ?? text?.values ?? [];
          return /INSERT INTO acts/i.test(sql) && vals.includes("set-down") ? Promise.reject(new Error("the store refused the set-down (test)")) : t.query(text, params);
        };
        const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
      } });
    },
    query: (...a) => pool.query(...a),
  };
  pen.__setPoolForTest(refusing);
  try {
    await assert.rejects(callHoldTool("world_hold", { thing: bag, accept: true }, key, { verb: "drop" }), (e) => String(e?.cause?.message ?? e?.message ?? "").includes("refused the set-down (test)"));
  } finally { pen.__setPoolForTest(pool); }
  assert.equal((await worldMarkById(bag)).mark?.held_by, who, "still in hand");
  assert.equal((await worldMarkById(slips[0])).mark?.held_by, bag, "with its slip in it");
  assert.equal(await unitsIn(bag), 2);
  assert.ok(![ "draft", "pending" ].includes(await claimOf(bag)), `the draft went back out (${await claimOf(bag)})`);
  assert.equal(readStrands().strands.length, strandsBefore, "no strand recorded by this set-down");
  await setDown(bag, key);
  assert.deepEqual((await holdRows([bag])).map((r) => r.action), ["make", "set-down"]);
});
