// sited-take.test.mjs — fixed sited pieces stay fixed (POS-1143, from Rivet's read/executor mismatch on POS-1137).
//
// The reads skip a classless `sited` mark before any reach check (usable-verbs.mjs: `className == null` is no thing), but the take executor had no
// matching kind veto, so a take of one went through the real door. Darko, picker POS-1143/a: "No, fixed stays fixed". Wright: "the smallest change:
// the take executor refuses a classless `sited` mark (world-hold.mjs), with a test and its error text. No other kind changes."
//
// THE REAL DOOR (callHoldTool, the flat world_hold's own implementation, prod's flags: the hold lane flipped, the guards on) on a real store, over a
// throwaway world with a classless sited cabinet, a classed portable thing, a classed fixed thing (portable: false) and a classless sited piece out
// of reach. Every refusal asserts nothing was recorded.
//
//   S1  THE VETO: the take of a classless sited piece, in reach and past every other guard, answers the fixed-piece reason and writes no holding act
//   S2  NOT BY ANOTHER GUARD: the same actor takes a classed portable thing from the same spot, so reach, freeze and holder would have let the cabinet
//       through; and the veto is the answer, not the reach, when the piece is out of reach the reach still answers first
//   S3  NOTHING ELSE MOVED: a classed fixed thing keeps its own refusal word-for-word, a classed portable thing is taken, a drop and a give are untouched
//
// FLIP: remove the classless-sited veto in world-hold.mjs § holdAct → S1 goes red (the take lands: a `take` act is recorded and the cabinet is held).
//
//   node --import ./test/helpers/sparse-guard.mjs --import ./test/helpers/town-pins-env.mjs --test test/sited-take.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";
import { execFileSync } from "node:child_process";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { markRecord } from "../src/mark-record.mjs";

const WORLD = worldClone();
const store = await startStore({ db: "sited_take" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);
const repo = tempDir("pos1143-sited-take-");
const put = (p, content) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE", "WORLD_SINGLE_LOG", "WORLD_POOL", "TOWN_CLONE"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
let pool;

const CABINET = "sbx-ana/the-cabinet";       // classless sited, at the Origin where the resident stands: in reach
const STOOL = "sbx-ana/the-stool";           // a thing (class), portable by default, in reach
const WASHSTAND = "sbx-ana/the-washstand";   // a thing with portable: false (sovereign), in reach
const FAR = "sbx-ana/the-far-lamp";          // classless sited, out of reach
const SHA = "e".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const LAW = [
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("thing", { extends: "sited" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  prop("postmark-node", "makers", false, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"), prop("thing", "open", true, "sovereign", "holder"),
  prop("thing", "portable", true, "sovereign"),
];

let callHoldTool, resetLawSnapshot;
if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  const root = { id: "the-town/let-there-be-light", by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 } };
  // a resident the record places nowhere else stands at the Origin (world#265, POS-740): these three stand on it, the far lamp 424 m off
  const cabinet = { id: CABINET, by: "sbx-ana", slug: "the-cabinet", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 2, h: 2 } };
  const stool = { id: STOOL, by: "sbx-ana", slug: "the-stool", kind: "sited", class: "thing", at: { x: 0, y: 0 }, extent: { w: 1, h: 1 } };
  const washstand = { id: WASHSTAND, by: "sbx-ana", slug: "the-washstand", kind: "sited", class: "thing", portable: false, at: { x: 0, y: 0 }, extent: { w: 1, h: 1 } };
  const far = { id: FAR, by: "sbx-ana", slug: "the-far-lamp", kind: "sited", at: { x: 300, y: 300 }, extent: { w: 2, h: 2 } };
  const marks = [root, cabinet, stool, washstand, far];
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  for (const [m, body] of [[cabinet, "A cabinet, built where it stands."], [stool, "A stool, easily carried."], [washstand, "A washstand, fixed in place."], [far, "A lamp, far away."]])
    put(`WORLD/marks/sbx-ana/${m.slug}/mark.md`, markRecord(m, body));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks }));
  copyFileSync(join(WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD", "tools"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "synthetic canon"]);
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: store.url("office_api") });
  Object.assign(process.env, { TOWN_CLONE: join(repo, "no-town-clone"), WORLD_CLONE: repo, WORLD_SINGLE_LOG: "", WORLD_POOL: "0", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "hold", W2_GUARDS: "1" });
  (await import("../src/world2-pen.mjs")).__setPoolForTest(pool);
  const snap = await import("../src/law-snapshot.mjs");
  resetLawSnapshot = snap.resetLawSnapshot;
  await snap.reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === snap.LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : LAW }) });
  ({ callHoldTool } = await import("../src/world-hold.mjs"));
}
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  resetLawSnapshot?.();
  if (!skip) (await import("../src/world2-pen.mjs")).__setPoolForTest(null);
  if (pool) await pool.end(); await store.stop();
});
const KEY = { household: "sbx-cy", handles: new Set(["sbx-cy"]) };
const holdActs = async (thing) => {
  const c = await store.connect("world2_owner");
  try { return (await c.query("SELECT action FROM acts WHERE object = $1 AND class = 'holding' ORDER BY id", [thing])).rows.map((r) => r.action); } finally { await c.end(); }
};
const heldBy = async (id) => (await (await import("../src/world.mjs")).worldMarkById(id)).mark?.held_by ?? null;

test("S1 · a classless sited piece in reach is not taken: the fixed-piece reason, a 409, and no holding act", { skip }, async () => {
  // the fixture reaches the pen without the veto: the cabinet is published, unheld, on the actor's own spot (S2 holds the same spot to a successful take)
  assert.deepEqual(await holdActs(CABINET), [], "no holding act before");
  await assert.rejects(callHoldTool("world_hold", { thing: CABINET }, KEY), (e) => {
    assert.equal(e.code, 409, `${e.defect} — ${e.hint}`);
    assert.equal(e.defect, `${CABINET} is a fixed piece, not a thing`, "the plain reason, naming the piece");
    assert.equal(e.hint, "a sited mark with no class is part of what its maker built, so it stays where it stands and stays theirs: it is not carried, given or set down. Nothing was recorded.");
    return true;
  });
  assert.deepEqual(await holdActs(CABINET), [], "no take, and no act of any kind, was recorded");
  assert.equal(await heldBy(CABINET), null, "it is exactly where it stood, held by nobody");
});

test("S2 · it is the veto that answers, not reach, freeze or a holder: the same actor takes a portable thing from the same spot, and the far lamp is refused by the reach first", { skip }, async () => {
  const r = await callHoldTool("world_hold", { thing: STOOL }, KEY);
  assert.equal(r.did, "take", JSON.stringify(r).slice(0, 300));
  assert.equal(await heldBy(STOOL), "sbx-cy", "the guards the cabinet passed let this thing through to the pen");
  assert.deepEqual(await holdActs(STOOL), ["take"]);
  // out of reach, the reach answers (it is asked before the kind): the veto is not what stops a piece nobody stands at
  await assert.rejects(callHoldTool("world_hold", { thing: FAR }, KEY), (e) => /you are not standing where sbx-ana\/the-far-lamp stands/.test(e.defect));
  assert.deepEqual(await holdActs(FAR), []);
});

test("S3 · nothing else moved: a classed fixed thing keeps its own refusal, and give and drop of a held thing are untouched", { skip }, async () => {
  await assert.rejects(callHoldTool("world_hold", { thing: WASHSTAND }, KEY), (e) => {
    assert.equal(e.code, 409);
    assert.equal(e.defect, `${WASHSTAND} is fixed where it stands`, "the classed thing's existing wording, byte for byte");
    assert.match(e.hint, /^its maker made it portable: false, so it is not carried;/);
    return true;
  });
  assert.deepEqual(await holdActs(WASHSTAND), []);
  // the stool the actor now holds is given on, and a give of an unheld classless piece is the existing give refusal, never the take veto
  const gave = await callHoldTool("world_hold", { thing: STOOL, to: "sbx-dee" }, KEY);
  assert.equal(gave.did, "give", JSON.stringify(gave).slice(0, 300));
  await assert.rejects(callHoldTool("world_hold", { thing: CABINET, to: "sbx-dee" }, KEY), (e) => !/is a fixed piece, not a thing/.test(e.defect), "a give is not a take: the veto is the take's");
  assert.deepEqual(await holdActs(CABINET), []);
});
