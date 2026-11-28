// pos-1216-spark-parent-refused.test.mjs — POS-1216: the common mark door (world.mjs § leaveMarkAct) refuses a Spark that names a structural
// parent, by name and with the reason, BEFORE anything is written.
//
// THE LAW (World LOGOS/classes.md, Spark): "Its place is the moment's: neither sited nor anchored" and "It is not `parent:`, which is the
// predicate's edge: a spark is never anchored." A caller-supplied `parent_id` on a spark used to ride on to the store and the write-down, where it
// nested, held, or was filed at the spark's own id (#1214): an illegal input accepted and then worked around. Wright 2026-11-27 05:26Z (Darko):
// "the office's door refuses a spark that names a parent, by name and with the reason, at the act, so an illegal parent never reaches the store or
// the write-down."
//
//   THE REFUSAL   a spark with a parent_id (one that RESOLVES to a real sited mark, one that names nothing, its own id), in a preview and a
//                 real leave, as an amend, and under either spelling of its class, is a 422 naming parent_id and why; nothing is written.
//   THE CONTROLS  a lawful parentless spark passes; its own link, `properties.parent` (stored as parent_spark), passes; an empty or null
//                 parent_id is no parent; another mark's legitimate parent_id (a predicated mark's) is untouched; the spark's other
//                 refusals keep their own words.
//
// FLIP: delete the `isSpark && parent_id` guard in world.mjs § leaveMarkAct and THE REFUSAL's tests go red.
//
// THE DOOR RUNS ON A PRIVATE CLONE of the pinned world (test/spark-names-event-door.test.mjs says why): the real leave executor fetches origin
// into the clone it is pointed at, and the suite's shared clone is pinned.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const store = await startStore({ db: "pos1216_door" });
const skip = store.skip ?? false;
const ROOT = join(import.meta.dirname, "..");
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));

const HOUSEHOLD = "pos1216-door";
const SHARED = saved.WORLD_CLONE || join(ROOT, "world-clone");
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const PRIVATE_DIR = mkdtempSync(join(tmpdir(), "pos1216-world-"));
const PRIVATE = join(PRIVATE_DIR, "world-clone");
execFileSync("git", ["clone", "-q", "--local", "--no-checkout", SHARED, PRIVATE]);
git(PRIVATE, "fetch", "-q", "--no-tags", "origin", "+refs/remotes/origin/main:refs/heads/main");
git(PRIVATE, "remote", "remove", "origin");
process.env.WORLD_CLONE = PRIVATE;
const { __setPoolForTest } = await import("../src/world2-pen.mjs");

let pool, owner;
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  __setPoolForTest(null); if (pool) await pool.end(); if (owner) await owner.end(); await store.stop();
  rmSync(PRIVATE_DIR, { recursive: true, force: true });
});

const SHA = "d".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property", key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const LAW = [prop("spark", "makers", true, "constitution"), cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("spark", { extends: "sited" }),
  ...["recounting", "experienced_at", "event", "rooms", "circle", "circle_path", "parent_spark"].map((n) => prop("spark", n, null, "sovereign"))];
const KEY = { household: HOUSEHOLD, handles: new Set([HOUSEHOLD]) };
const spark = (over = {}) => ({ slug: "pic", kind: "sited", class: "spark", at: { x: 5, y: 5 }, extent: { w: 120, h: 120 }, body: "a picture", preview: true,
  properties: { recounting: "r", experienced_at: "2026-11-14T20:00:00.000Z" }, ...over });

async function setup() {
  pool = new (await import("pg")).default.Pool({ connectionString: store.url("office_api") });
  owner = await store.connect("world2_owner");
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "hold", W2_GUARDS: "1", WORLD_CLONE: PRIVATE });
  __setPoolForTest(pool);
  const { reloadLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
  await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : LAW }) });
  await owner.query("INSERT INTO windows (id,opens_at,closes_at,status) VALUES (300,now()-interval '1 day',now()+interval '1 day','open') ON CONFLICT DO NOTHING");
}
const written = async () => (await owner.query(`SELECT (SELECT count(*) FROM acts) a, (SELECT count(*) FROM claims) c, (SELECT count(*) FROM marks) m`)).rows[0];
const refusedAsParent = (e) => e.code === 422 && /parent_id/.test(e.defect) && /spark/.test(e.defect) && /never anchored/.test(e.defect)
  && /neither sited nor anchored/.test(e.hint) && /properties: \{ parent:/.test(e.hint) && /Nothing was written/.test(e.hint);

test("THE REFUSAL · a spark that names a structural parent is refused by name and reason, in a preview and a real leave, whether or not the parent resolves, before anything is written", { skip }, async () => {
  await setup();
  const { leaveMarkViaOffice, canonForGuards } = await import("../src/world.mjs");
  const canon = canonForGuards();
  const real = canon?.marks?.find((m) => m.kind === "sited" && m.id && m.at && m.parent_id == null)?.id;
  assert.ok(real, "the pinned world has a sited mark a parent_id could resolve to");
  const before = await written();
  const parents = [real, "nobody/never-made-this", `${HOUSEHOLD}/pic`, "x"];
  for (const parent_id of parents) for (const preview of [true, false]) {
    await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, spark({ parent_id, preview }), KEY), refusedAsParent, `parent_id ${parent_id}, preview=${preview}`);
  }
  // as an amend, and under the class's own spelling (kind: "spark", which names the class)
  await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, spark({ parent_id: real, amend: true, preview: false }), KEY), refusedAsParent, "an amend");
  await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, spark({ parent_id: real, kind: "spark", class: undefined }), KEY), refusedAsParent, "kind: spark");
  assert.deepEqual(await written(), before, "no act, claim or mark row was written by any of these");
});

test("THE CONTROLS · a lawful parentless spark passes; its own properties.parent link passes; an empty parent_id is no parent; other marks' parents and the spark's other refusals are untouched", { skip }, async () => {
  const { leaveMarkViaOffice, canonForGuards } = await import("../src/world.mjs");
  const before = await written();
  assert.ok(await leaveMarkViaOffice(process.env.WORLD_CLONE, spark(), KEY), "a lawful parentless spark");
  assert.ok(await leaveMarkViaOffice(process.env.WORLD_CLONE, spark({ properties: { recounting: "r", experienced_at: "2026-11-14T20:00:00.000Z", parent: "somebody/their-spark" } }), KEY),
    "properties.parent is the spark's own lawful link (stored as parent_spark), not the structural parent");
  assert.ok(await leaveMarkViaOffice(process.env.WORLD_CLONE, spark({ parent_id: "" }), KEY), "an empty parent_id names nothing");
  assert.ok(await leaveMarkViaOffice(process.env.WORLD_CLONE, spark({ parent_id: null }), KEY), "a null parent_id names nothing");
  // the spark's OTHER refusals keep their own words (and the door does not mistake them for this one)
  await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, spark({ properties: { experienced_at: "2026-11-14T20:00:00.000Z" } }), KEY),
    (e) => e.code === 422 && !/parent_id/.test(e.defect), "a spark missing its recounting is refused for that");
  // another mark's legitimate parent_id: a detail laid on a sited mark is judged where it always was
  const real = canonForGuards()?.marks?.find((m) => m.kind === "sited" && m.id && m.at && m.parent_id == null && m.by !== HOUSEHOLD)?.id;
  const detail = { slug: "detail", kind: "predicated", parent_id: real, slot: "colour", value: "green", body: "a detail", preview: true };
  let outcome;
  try { outcome = { ok: await leaveMarkViaOffice(process.env.WORLD_CLONE, detail, KEY) }; } catch (e) { outcome = { e }; }
  assert.ok(outcome.ok || !/a spark carries no parent_id/.test(outcome.e?.defect ?? ""), `a predicated mark's parent_id is not the spark's refusal: ${outcome.e?.defect}`);
  assert.deepEqual(await written(), before, "the previews wrote nothing");
});

// ── THE UNREAD CLASS ANSWER (POS-1216, lead FIX at 361613cc) ─────────────────────────────────────────────────────────────────────────────
// `sparkByWorld` collapses an unread engine or class index into "not a spark", so the guard above skipped a class it could not read, `clean`
// kept the parent_id and nothing later stopped the append (the crossing's lint is after the store). The parent-admission question has THREE
// answers now (world.mjs § sparkClassAnswer): spark, CONFIRMED not a spark, NOT READ; a class-bearing leave that names a parent while the
// answer is NOT READ is a 503 before any mutation, never a guess. The World stays the authority: the engine's own selector, over the class
// index of the canon in hand.
//
// FLIP: make sparkClassAnswer answer `false` where it answers `null` (the old collapse), and the unread-class test and the unit's null rows go red.

const chainMarks = (...names) => names.map((n, i) => ({ id: `the-town/${n}`, kind: "class", class: n, by: "the-town", ...(i > 0 ? { extends: names[i - 1] } : {}) }));

test("sparkClassAnswer: spark / confirmed not-spark / not read, from the World's own selector over the class data in hand (unit)", async () => {
  const { sparkClassAnswer } = await import("../src/world.mjs");
  const tree = chainMarks("postmark-node", "mark", "sited", "spark", "spark-album");
  assert.equal(await sparkClassAnswer("spark-album", tree), true, "a subclass of spark, its chain in hand");
  assert.equal(await sparkClassAnswer("spark", []), true, "spark answers for itself with no class data in hand");
  assert.equal(await sparkClassAnswer("spark-album", []), null, "EMPTY class data: the subclass's chain cannot answer, and its place alone would call it non-spark: not read");
  assert.equal(await sparkClassAnswer("spark-album", chainMarks("postmark-node", "mark", "sited")), null, "class data without this class's node: not read");
  assert.equal(await sparkClassAnswer("tile", chainMarks("postmark-node", "mark", "sited", "tile")), false, "a class whose node and chain are in hand and reach no spark: confirmed not a spark");
  assert.equal(await sparkClassAnswer("parcel", []), false, "one of the World's own standing words is confirmed with no class data");
  // an unread ENGINE: the loader answers nothing, throws, lacks the selector, or the selector throws
  assert.equal(await sparkClassAnswer("spark-album", tree, { world: async () => null }), null, "no engine");
  assert.equal(await sparkClassAnswer("spark-album", tree, { world: async () => { throw new Error("engine away"); } }), null, "the loader throws");
  assert.equal(await sparkClassAnswer("spark-album", tree, { world: async () => ({ mk: {} }) }), null, "an engine with no selector");
  assert.equal(await sparkClassAnswer("spark-album", tree, { world: async () => ({ mk: { isSparkIn() { throw new Error("bad index"); } } }) }), null, "the selector throws");
});

test("at the door: a parent-bearing leave of a class the roster knows but the canonical class data does not hold is a 503 before any mutation; once the answer is confirmed, a spark is the 422 and a non-spark is untouched", { skip }, async () => {
  const { reloadLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
  const { leaveMarkViaOffice, canonForGuards } = await import("../src/world.mjs");
  const canon = canonForGuards();
  const real = canon?.marks?.find((m) => m.kind === "sited" && m.id && m.at && m.parent_id == null)?.id;
  // a class the law's ROSTER declares (a spark's subclass) that the pinned canon has no node for, and one canon DOES hold that reaches no spark
  const heldNonSpark = canon.marks.find((m) => m.kind === "class" && m.class && !["spark", "postmark-node", "mark", "sited", "parcel", "bounty", "chest", "candy", "thing"].includes(m.class))?.class;
  assert.ok(heldNonSpark, "the pinned canon holds a non-spark class node");
  const law = [...LAW, cls("spark-album", { extends: "spark" }), cls(heldNonSpark, { extends: "sited" })];
  await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : law }) });
  const before = await written();
  const unread = (e) => e.code === 503 && /may carry a parent_id could not be checked/.test(e.defect) && /nothing was written/.test(e.hint) && !/is a spark|never anchored under/.test(e.defect);
  for (const parent_id of [real, "nobody/never-made-this"]) for (const preview of [true, false])
    await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, spark({ class: "spark-album", parent_id, preview }), KEY), unread, `parent_id ${parent_id}, preview=${preview}`);
  await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, spark({ class: "spark-album", parent_id: real, amend: true, preview: false }), KEY), unread, "an amend");
  assert.deepEqual(await written(), before, "the unavailable answer wrote nothing: no act, claim or mark row");
  // the unread answer is about a parent: parentless, empty and null parents are not held by it
  for (const parent_id of [undefined, "", null]) {
    let e; try { await leaveMarkViaOffice(process.env.WORLD_CLONE, spark({ class: "spark-album", parent_id }), KEY); } catch (x) { e = x; }
    assert.ok(!e || !/may carry a parent_id could not be checked/.test(e.defect), `parent_id ${JSON.stringify(parent_id)} is no parent: ${e?.defect}`);
  }
  // CONFIRMED not a spark: a class whose node the canon holds is judged where it always was, never by this guard
  let other; try { await leaveMarkViaOffice(process.env.WORLD_CLONE, { slug: "plain", kind: "sited", class: heldNonSpark, at: { x: 5, y: 5 }, extent: { w: 4, h: 4 }, body: "a thing", parent_id: real, preview: true }, KEY); } catch (x) { other = x; }
  assert.ok(!other || (!/may carry a parent_id could not be checked/.test(other.defect) && !/a spark carries no parent_id/.test(other.defect)), `a confirmed non-spark class is not held or refused as a spark: ${other?.defect}`);
  // RECOVERY: the class's own answer is known (spark answers for itself), and the same parent is the 422 at the act, before the journal
  await assert.rejects(leaveMarkViaOffice(process.env.WORLD_CLONE, spark({ parent_id: real }), KEY), refusedAsParent, "confirmed spark: the named 422");
  assert.deepEqual(await written(), before, "still nothing written");
});
