// stance-list.test.mjs — ONE CALL, A LIST OF MARKS (POS-633, round 3).
//
// Darko, 2026-10-20 12:47 (the RULED comment on POS-633): `declare-stance-on`
// takes `on` as a single id (as today) or a list of explicit ids, at most about
// 100 per call. "Each mark gets its own act, exactly as a single call writes it
// (same provenance, same outcome path, same per-mark refusals), with one answer
// listing each id's result." Additive: the single-id form is unchanged.
//
// The four tests the ruling names, in its order:
//   a list of 3 writes 3 acts identical to 3 single calls;
//   a mixed list (one id not waiting on this house) answers per id without
//     failing the rest;
//   over the cap bounces by name;
//   a single string still works.
//
//   node --test test/stance-list.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";
import { CLASS_STANCE, STANCE_LIST_MAX, STANCE_TOOLS, declareStanceViaOffice, resetStanceGeometry } from "../src/world-stance.mjs";
import { STANCE_ON, clearStancePool, stancePoolFromJournal } from "./stance-pool-stub.mjs";
import { validateArgs } from "../src/validate-args.mjs";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-stance-list-"));
after(() => sweep(scratch));

// alpha holds a parcel from 08-01; beta, gamma and eta each lay a mark over it
// later (three waiting on alpha's word). delta's mark is far away: it waits on
// nobody's word, and is the mixed list's odd one out.
const repo = join(scratch, "world");
mkdirSync(repo, { recursive: true });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const MARKS = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 }, date: "2026-07-01", body: "the world frame" },
  { id: "alpha/alphas-parcel", by: "alpha", kind: "parcel", at: { x: 100, y: 100 }, extent: { w: 25, h: 25 }, date: "2026-08-01", body: "alpha's ground" },
  { id: "beta/on-alphas-edge", by: "beta", kind: "sited", at: { x: 112, y: 100 }, extent: { w: 4, h: 4 }, date: "2026-08-10", body: "beta's cairn" },
  { id: "gamma/well-inside", by: "gamma", kind: "sited", at: { x: 100, y: 100 }, extent: { w: 2, h: 2 }, date: "2026-08-12", body: "gamma's stone" },
  { id: "eta/in-the-corner", by: "eta", kind: "sited", at: { x: 90, y: 92 }, extent: { w: 2, h: 2 }, date: "2026-08-14", body: "eta's post" },
  { id: "delta/far-away", by: "delta", kind: "sited", at: { x: 9000, y: 9000 }, extent: { w: 4, h: 4 }, date: "2026-08-15", body: "nowhere near anybody" },
];
const THREE = ["beta/on-alphas-edge", "gamma/well-inside", "eta/in-the-corner"];

// `geometry.mjs` is the REAL arithmetic, transcribed (world-stance.test.mjs's
// own discipline: overlap is never answered by a second implementation).
put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
`);
put("WORLD/world-state.json", JSON.stringify({ tick: 0, marks: MARKS, parcels: [] }));
put("WORLD/skeleton.json", JSON.stringify({ features: [] }));
for (const m of MARKS) put(`WORLD/marks/let-there-be-light/${m.id.split("/")[1]}/mark.md`,
  `---\nkind: ${m.kind}\nby: ${m.by}\ndate: ${m.date}\n---\n\n${m.body}\n`);
git("init", "-q", "-b", "main");
git("config", "user.email", "t@postmark.invalid");
git("config", "user.name", "stance list falsifier");
git("add", "-A");
git("commit", "-qm", "canon");

const alpha = { household: "alpha", handles: new Set(["alpha"]) };

let dbPath, pen, n = 0;
const freshPen = () => { pen = installActsPen(); resetStanceGeometry(); };
beforeEach(() => {
  dbPath = join(scratch, `dyn-${++n}.db`);
  process.env.WORLD_DYNAMIC_DB = dbPath;
  process.env.WORLD_SINGLE_LOG = "1";
  Object.assign(process.env, STANCE_ON);
  stancePoolFromJournal(dbPath);
  process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
  process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
  // The fixtures declare at crossing 145, certified history by now: the pen's
  // late-crossing guard is answered by name (world-stance.test.mjs § the same).
  process.env.W2_LATE_ARRIVAL = "stance-list.test.mjs fixtures declare at crossing 145 on purpose";
  freshPen();
});
after(() => {
  delete process.env.WORLD_DYNAMIC_DB; delete process.env.WORLD_SINGLE_LOG;
  delete process.env.WORLD2_STANCE_URL; clearStancePool();
  delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL;
  delete process.env.W2_LATE_ARRIVAL;
  uninstallActsPen();
});

const stamp = async () => ({ at: { anchor: "alpha/alphas-parcel", dx: 1, dy: 2 }, witnesses: { source: "presence", list: [] } });
const speak = (args, key = alpha) => declareStanceViaOffice(repo, args, key, { dbPath, witnessStamp: stamp, crossing: 145 });
// The act as the record holds it, less what differs between any two writes of
// the same word: the id the sequence hands out and the instant it was written.
const acts = () => pen.rows().filter((r) => r.class === CLASS_STANCE)
  .map(({ id, at, ...rest }) => ({ ...rest, payload: typeof rest.payload === "string" ? JSON.parse(rest.payload) : rest.payload }));
const stripClock = (row) => JSON.parse(JSON.stringify(row, (k, v) => (/^(at|written_at|spoken_at)$/.test(k) && typeof v === "string" ? "<t>" : v)));

test("a list of 3 writes 3 acts identical to 3 single calls", async () => {
  for (const on of THREE) await speak({ on, stance: "welcomed" });
  const singles = acts().map(stripClock);
  assert.equal(singles.length, 3);

  freshPen();
  const listed = await speak({ on: THREE, stance: "welcomed" });
  const fromList = acts().map(stripClock);
  assert.deepEqual(fromList, singles, "the same three acts, column for column, in the list's order");

  assert.equal(listed.marks, 3);
  assert.equal(listed.landed, 3);
  assert.equal(listed.refused, 0);
  assert.equal(listed.stance, "welcomed", "what every landed answer shares is said once, at the top");
  assert.equal(listed.by, "alpha");
  assert.deepEqual(listed.results.map((r) => r.on), THREE, "one result per id, in the order given");
  for (const r of listed.results) {
    assert.equal(r.landed, true);
    assert.ok(r.seq, "each result carries its own act's id");
    assert.deepEqual(r.on_your_ground, ["alpha/alphas-parcel"]);
    assert.equal(r.stance, undefined, "and not the shared word a hundred times over");
  }
});

test("a mixed list (one id not waiting on this house) answers per id without failing the rest", async () => {
  const mixed = [THREE[0], "delta/far-away", "nobody/no-such-mark", THREE[1]];
  const r = await speak({ on: mixed, stance: "opposed" });
  assert.equal(r.marks, 4);
  assert.equal(r.landed, 2);
  assert.equal(r.refused, 2);
  const by = Object.fromEntries(r.results.map((x) => [x.on, x]));
  assert.equal(by[THREE[0]].landed, true);
  assert.equal(by[THREE[1]].landed, true, "the id after the refusals is still spoken");
  // The refusals are the single call's own, word for word.
  let single;
  try { await speak({ on: "delta/far-away", stance: "opposed" }); } catch (e) { single = e; }
  assert.equal(by["delta/far-away"].refused.code, 403);
  assert.equal(by["delta/far-away"].refused.defect, single.defect);
  assert.equal(by["delta/far-away"].refused.hint, single.hint);
  assert.equal(by["nobody/no-such-mark"].refused.code, 404);
  assert.match(by["nobody/no-such-mark"].refused.hint, /household \{ read: "stances" \}/);
  assert.deepEqual(acts().map((a) => a.object), [THREE[0], THREE[1]], "and only the two that landed were written");
});

test("over the cap bounces by name, and nothing is written", async () => {
  const many = Array.from({ length: STANCE_LIST_MAX + 1 }, (_, i) => `beta/mark-${i}`);
  await assert.rejects(() => speak({ on: many, stance: "welcomed" }), (e) => {
    assert.equal(e.code, 422);
    assert.match(e.defect, new RegExp(`on lists ${STANCE_LIST_MAX + 1} marks; a call speaks on at most ${STANCE_LIST_MAX}`));
    assert.match(e.hint, /nothing was written/);
    return true;
  });
  assert.equal(acts().length, 0);
  // And the list's other shapes are refused before anything is spoken.
  await assert.rejects(() => speak({ on: [], stance: "welcomed" }), (e) => e.code === 422 && /which marks\?/.test(e.defect));
  await assert.rejects(() => speak({ on: [THREE[0], 7], stance: "welcomed" }), (e) => e.code === 422 && /on\[1\] is not a mark id/.test(e.defect));
  await assert.rejects(() => speak({ on: [THREE[0], THREE[0]], stance: "welcomed" }), (e) => e.code === 422 && /twice/.test(e.defect));
  assert.equal(acts().length, 0, "a refused list writes nothing");
});

test("a single string still works, and answers exactly as it always did", async () => {
  const r = await speak({ on: THREE[0], stance: "neutral" });
  assert.equal(r.on, THREE[0]);
  assert.equal(r.stance, "neutral");
  assert.equal(r.results, undefined, "the single form has no list answer");
  assert.equal(acts().length, 1);
});

test("the act's schema takes either form, and the door's validator lets both through", () => {
  const tool = STANCE_TOOLS[0];
  assert.deepEqual(tool.inputSchema.properties.on.type, ["string", "array"]);
  assert.match(tool.inputSchema.properties.on.description, /or a list of up to 100 ids, each its own act/);
  assert.equal(STANCE_LIST_MAX, 100);
  assert.equal(validateArgs(tool, { on: THREE, stance: "welcomed" }), null);
  assert.equal(validateArgs(tool, { on: THREE[0], stance: "welcomed" }), null);
});

test("by: and over: narrow the inbox to one waiting group, and its ids go straight into a list stance", async () => {
  const { stanceShadow } = await import("../src/world-stance.mjs");
  const all = await stanceShadow(repo, alpha, { dbPath });
  assert.equal(all.stances_awaiting, 3);
  assert.equal(all.ids, undefined, "the bare read answers as it always did");
  const one = await stanceShadow(repo, alpha, { dbPath, by: "gamma", over: "alpha/alphas-parcel" });
  assert.equal(one.stances_awaiting, 1);
  assert.deepEqual(one.only, { by: "gamma", over: "alpha/alphas-parcel" });
  assert.deepEqual(one.ids, ["gamma/well-inside"]);
  const ground = await stanceShadow(repo, alpha, { dbPath, over: "alpha/alphas-parcel" });
  assert.deepEqual([...ground.ids].sort(), [...THREE].sort());
  const r = await speak({ on: ground.ids, stance: "welcomed" });
  assert.equal(r.landed, 3, "the read's ids are the list the door takes");
  assert.equal((await stanceShadow(repo, alpha, { dbPath, over: "alpha/alphas-parcel" })).stances_awaiting, 0, "and the group is answered");
  const none = await stanceShadow(repo, alpha, { dbPath, by: "nobody" });
  assert.equal(none.stances_awaiting, 0);
  assert.deepEqual(none.ids, []);
});
