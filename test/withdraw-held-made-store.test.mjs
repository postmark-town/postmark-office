// withdraw-held-made-store.test.mjs — POS-992 (postmark#4559), ON A REAL STORE: the public withdraw door
// withdraws a named thing its maker made and still holds (Darko 2026-11-11 09:21 EST, POS-992/a: "withdraw
// owns it"; Wright: "The holding ends the way an eaten thing's does; the make record stays; the id is never
// reused"; Wright 14:47Z: its own hold face, `withdraw`).
//
//   node --test test/withdraw-held-made-store.test.mjs
//
// The REAL doors, with prod's flags (the hold and mark lanes flipped, the guards on, the single log), on a real
// store (embedded-store.mjs), over a throwaway world, as test/set-down-holder-put-back.test.mjs runs them:
// leave-mark makes into hands, world_hold eats, and `withdrawMarkViaOffice` withdraws. Everything is invented:
// sbx-ka, sbx-lu, sbx-mo, sbx-dee, pebbles, a bag, a slip, pocket comets.

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
const store = await startStore({ db: "withdraw_held_made" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);
const repo = mkdtempSync(join(tmpdir(), "pos992-withdraw-held-"));
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
const owner = async (fn) => { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } };
const q = (sql, a = []) => owner(async (c) => (await c.query(sql, a)).rows);
/** The thing's own hold rows, oldest first (a counted unit's act is not one). */
const holdRows = (ids) => q("SELECT id::text, class, action, object, actor, payload FROM acts WHERE class = 'holding' AND object = ANY($1) AND action NOT LIKE 'units:%' ORDER BY acts.id", [ids]);
/** Every act naming it, of any class. */
const actsOf = (id) => q("SELECT class, action FROM acts WHERE object = $1 ORDER BY id", [id]);
/** Every table of the store, row by row: a refusal that writes nothing leaves this exactly as it was. */
const storeImage = () => owner(async (c) => {
  const { rows: tables } = await c.query("SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2");
  const out = {};
  for (const t of tables) out[`${t.schemaname}.${t.tablename}`] = (await c.query(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h, count(*)::int AS n FROM "${t.schemaname}"."${t.tablename}" x`)).rows[0];
  return out;
});
const make = (who, slug, extra = {}, to = who) => leaveMarkViaOffice(repo, { slug, body: `A ${slug}.`, to, ...extra }, keyOf(who));

test("#4559 · the reported case at the real door: a plain thing made in hand is no consumable, and withdraw no longer answers \"no mark\": one `withdraw` hold act ends the holding, it leaves the world, the make stays and the name stays taken", { skip }, async () => {
  const who = "sbx-ka", id = `${who}/pebble`;
  await make(who, "pebble");
  assert.equal((await worldMarkById(id)).mark?.held_by, who, "made in hand: held, live");
  // consume still refuses a plain thing, as it always has (#4559's first refusal is law, not the bug)
  await assert.rejects(callHoldTool("world_hold", { thing: id, act: "consume" }, keyOf(who)), (e) => /a thing is not a consumable/.test(e.defect ?? e.message));

  const w = await withdrawMarkViaOffice(repo, { mark: id }, keyOf(who));
  assert.deepEqual([w.id, w.withdrawn, w.made_in_hand], [id, true, true], JSON.stringify(w).slice(0, 400));
  assert.match(w.effect, /withdrawn by its maker/);

  const rows = await holdRows([id]);
  assert.deepEqual(rows.map((r) => [r.class, r.action]), [["holding", "make"], ["holding", "withdraw"]], "the make, then its maker's withdraw: never a consume");
  assert.deepEqual([rows[1].actor, rows[1].payload.holder, rows[1].payload.previous_holder, rows[1].payload.policy], [who, null, who, "detach"]);
  assert.deepEqual((await actsOf(id)).map((a) => a.class), ["holding", "holding"], "no mark-class withdrawal of a thing canon never held");
  assert.equal((await worldMarkById(id)).mark, null, "gone from the world");
  await assert.rejects(make(who, "pebble"), (e) => e.code === 409, "its name is never made again");
  // and what is never made in hand still gets the true 404
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: `${who}/never-was` }, keyOf(who)),
    (e) => e.code === 404 && /no mark/.test(e.defect) && e.hint.includes("a thing you made in hand and still hold"));
});

test("the attachment reads after a mixed record: a legacy attachment (class legacy), a mark's withdraw, a creature's withdraw and a hold-lane withdraw; the holder reads still answer, the legacy row is read, and the mark and creature withdrawals are not", { skip }, async () => {
  const who = "sbx-lu", held = `${who}/kept`, gone = `${who}/let-go`;
  await make(who, "kept");
  await make(who, "let-go");
  await withdrawMarkViaOffice(repo, { mark: gone }, keyOf(who));
  // a mark's withdrawal, a creature's ending and a seeded legacy attachment, written the way their own writers
  // write them (world.mjs § journalWithdraw, creature-endings.mjs, seed-import.mjs § LEGACY_CLASS)
  await q(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect) VALUES (now(), 300, $1, 'withdraw', $2, 'mark', $3::jsonb, 'the draft is gone')`,
    [who, `${who}/a-note`, JSON.stringify({ by: who, slug: "a-note", was_published: false })]);
  await q(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect) VALUES (now(), 300, 'the-town', 'withdraw', 'the-town/a-wisp', 'creature', $1::jsonb, 'a wisp ended')`, [JSON.stringify({ reason: "ended" })]);
  const legacyAt = "2026-06-20T00:00:00.000Z";
  await q(`INSERT INTO acts (at, crossing, actor, action, object, class, payload) VALUES ($1, 1, 'sbx-old', 'legacy:attachment', null, 'legacy', $2::jsonb)`,
    [legacyAt, JSON.stringify({ at: legacyAt, seq: 1, type: "attachment", actor: "sbx-old", payload: { policy: "cascade", target: "sbx-old/heirloom", declared_by: "sbx-old" } })]);

  const { pgAttachmentsFor } = await import("../world2/tools/guard-reads.mjs");
  const read = await owner((c) => pgAttachmentsFor(c, {}));   // strict: one unreadable row would throw
  const of = (t) => read.rows.filter((r) => r.target === t);
  assert.equal(of("sbx-old/heirloom").length, 1, "the legacy arm is read as it was");
  assert.equal(of("sbx-old/heirloom")[0].entity, "sbx-old");
  assert.deepEqual(of(gone).map((r) => r.policy), ["cascade", "detach"], "the hold-lane withdraw ends its holding");
  assert.equal(read.rows.some((r) => r.target == null || r.target === "the-town/a-wisp" || r.target === `${who}/a-note`), false, "no mark or creature withdrawal is read as a holding");
  assert.equal((await worldMarkById(held)).mark?.held_by, who, "the holder read still answers for what is held");
});

test("refused, writing nothing in any table: another house's key, an eaten thing (it stays eaten), and a made holder that still holds something (nothing stranded)", { skip }, async () => {
  const who = "sbx-mo";
  const pebble = `${who}/pebble`, comet = `${who}/comet`, bag = `${who}/bag`, slip = `${who}/bag-slip`;
  await make(who, "pebble");
  await make(who, "comet", { kind: "pocket-comet" });
  await callHoldTool("world_hold", { thing: comet, act: "consume" }, keyOf(who));
  await make(who, "bag", { holder: true });
  await make(who, "bag-slip", {}, bag);
  const image = await storeImage();

  await assert.rejects(withdrawMarkViaOffice(repo, { mark: pebble }, keyOf("sbx-dee")), (e) => e.code === 403 && /only the hand that left a mark may withdraw it/.test(e.defect));
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: comet }, keyOf(who)), (e) => e.code === 409 && /is gone: it was eaten or withdrawn/.test(e.defect));
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: bag }, keyOf(who)), (e) => e.code === 409 && e.defect === `${bag} still holds 1 whole thing`);
  assert.deepEqual(await storeImage(), image, "every refusal wrote nothing");
  assert.deepEqual((await holdRows([comet])).map((r) => r.action), ["make", "consume"], "the eat is still its last word");
  assert.equal((await worldMarkById(slip)).mark?.held_by, bag, "the slip is still inside the bag");
  assert.equal((await worldMarkById(bag)).mark?.held_by, who);
  assert.equal((await worldMarkById(pebble)).mark?.held_by, who);
});

// THE FIX (independent review of #1009 at 406e8929, finding 1): a give planned into a made holder before its
// withdrawal, reaching the chest's lock after it, landed in a holder no one holds, stranded for good. The under-lock
// liveness (chest-lock.mjs § lockedChestUse) now reads the holder's own newest hold row: deterministic here, no timing.
test("FIX · ended under the lock: after a made holder's withdraw, the real chest room guard refuses an add (409) and a real append through the pen writes nothing; a live made holder still accepts", { skip }, async () => {
  const who = "sbx-pa", bag = `${who}/bag`, box = `${who}/box`, slip = `${who}/slip`;
  await make(who, "bag", { holder: true });
  await make(who, "box", { holder: true });
  await make(who, "slip");
  assert.equal((await withdrawMarkViaOffice(repo, { mark: bag }, keyOf(who))).withdrawn, true, "empty, it is withdrawn");
  const { chestRoomGuard } = await import("../src/chest-lock.mjs");
  const g = await store.connect("office_api");
  try {
    await g.query("BEGIN");
    await assert.rejects(chestRoomGuard({ chest: bag, capacity: 30, adding: 1 })(g), (e) => e.code === 409 && e.defect === `${bag} was withdrawn` && /takes nothing more/.test(e.hint));
    await g.query("ROLLBACK");
    await g.query("BEGIN");
    await chestRoomGuard({ chest: box, capacity: 30, adding: 1 })(g);   // the live one: no refusal
    await g.query("ROLLBACK");
  } finally { await g.end(); }

  // the give a racing door would write, planned before the withdrawal, appended now under the guard it carries
  const { liveUnitDeps, thingHoldingEntry } = await import("../src/world-units.mjs");
  const deps = await liveUnitDeps();
  const giveInto = async (holder) => {
    const { attachments } = await deps.readRows();
    const { entry } = await thingHoldingEntry(deps, keyOf(who), who, attachments, { did: "give", thing: slip, holder, previous: who, madeBy: who });
    return deps.append(entry, { guard: chestRoomGuard({ chest: holder, capacity: 30, adding: 1 }) });
  };
  const image = await storeImage();
  await assert.rejects(giveInto(bag), (e) => e.code === 409 && e.defect === `${bag} was withdrawn`);
  assert.deepEqual(await storeImage(), image, "the refused append wrote nothing in any table");
  assert.equal((await worldMarkById(slip)).mark?.held_by, who, "the slip is still in hand, never stranded");
  await giveInto(box);
  assert.equal((await worldMarkById(slip)).mark?.held_by, box, "into a live made holder it lands");
});

test("withdrawn for good: a second withdraw is refused, a put-back finds nothing to revive, and an empty made holder withdraws", { skip }, async () => {
  const who = "sbx-no", id = `${who}/once`, box = `${who}/box`;
  await make(who, "once");
  await withdrawMarkViaOffice(repo, { mark: id }, keyOf(who));
  const image = await storeImage();
  await assert.rejects(withdrawMarkViaOffice(repo, { mark: id }, keyOf(who)), (e) => e.code === 409 && /stays gone/.test(e.defect));
  const { setDownHolderOf } = await import("../src/set-down-return.mjs");
  assert.equal(await owner((c) => setDownHolderOf(c, { mark: id, by: who })), null, "its newest hold row is the withdraw: no set-down to put back");
  assert.deepEqual(await storeImage(), image, "nothing written");

  await make(who, "box", { holder: true });
  const w = await withdrawMarkViaOffice(repo, { mark: box }, keyOf(who));
  assert.equal(w.withdrawn, true, "empty, it goes");
  assert.equal((await worldMarkById(box)).mark, null);
});
