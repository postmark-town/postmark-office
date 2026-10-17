// wld-12-global-marks-read.test.mjs — WLD-12, town #3028 (Iris).
//
//   WORLD_CLONE=<a world checkout> node --test test/wld-12-global-marks-read.test.mjs
//
// `town { read: "marks" }` answered ONE resident's marks and bounced without a
// handle, so ranking the town's marks took one read per resident. The spec: with
// no handle, `args: { sort: "stamps" | "weight", limit, offset }` returns the
// town's PUBLISHED marks, town-wide, ranked, in one read.
//
// THE RANKING IS THE FOLD'S, NOT THIS FILE'S. Every mark in the published
// canon (WORLD/world-state.json) carries `stamps` (the direct stake on it) and
// `weight` (the effective weight, which adds breadth and what is nested inside).
// The fixture is made by the World's own `marks-fold.mjs` over synthetic stakes
// chosen so the two orders DIFFER; nothing here hardcodes a ranking.
//
// The door under test is the real town apex (`townApex`, with its own arg
// validator and schema from mcp.mjs) dispatching through the real `callTool` to
// the real `marksRead`. Published only: the docket and drafts readers are
// wired to THROW if anything asks them.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { worldClone } from "./fixture-paths.mjs";

const scratch = mkdtempSync(join(tmpdir(), "wld12-"));
const repo = join(scratch, "world");
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } });

const M = (id, by, x, extra = {}) => ({ id, by, household: by, kind: "sited", tier: "market", at: { x, y: 0 }, extent: { w: 4, h: 4 }, date: "2026-09-01T00:00:00Z", body: `the ${id}`, ...extra });
const MARKS = [
  M("amber/lamp", "amber", 10), M("amber/attic", "amber", 20),
  M("birch/tower", "birch", 30), M("cedar/well", "cedar", 40),
  M("dune/hut", "dune", 50), M("elm/shed", "elm", 60), M("fern/none", "fern", 70),
];
// direct stake `n`; `weight` above `n` is the breadth bonus the town's stake law adds
const STAKES = [
  { mark: "amber/lamp", n: 5, weight: 5, tick: 0 },
  { mark: "birch/tower", n: 1, weight: 40, tick: 0 },
  { mark: "cedar/well", n: 9, weight: 9, tick: 0 },
  { mark: "dune/hut", n: 3, weight: 12, tick: 0 },
  { mark: "elm/shed", n: 3, weight: 12, tick: 0 },     // ties dune/hut on both metrics
];

let callTool, townApex, marksRead, TOOLS, schemas, schemaRequired;
before(async () => {
  const FOLD = await import(pathToFileURL(join(worldClone(), "tools", "marks-fold.mjs")).href);
  const folded = FOLD.fold({ marks: MARKS, terrain: { features: [] }, stakes: STAKES, tick: 1, households: {} });
  assert.deepEqual(folded.errors, [], "the fixture folds clean");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "marks.json"), "");
  const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
  put("WORLD/world-state.json", JSON.stringify({ tick: 1, marks: folded.marks, parcels: [] }));
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main"); git("config", "user.email", "t@postmark.invalid"); git("config", "user.name", "wld12");
  git("add", "-A"); git("commit", "-qm", "canon");
  process.env.WORLD_CLONE = repo;
  ({ callTool, TOOLS } = await import("../src/mcp.mjs"));
  ({ townApex } = await import("../src/town-apex.mjs"));
  ({ marksRead } = await import("../src/town-marks.mjs"));
  schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
  schemaRequired = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.required ?? []]));
});

const KEY_AMBER = { household: "amber-house", handles: new Set(["amber"]), ghId: "1" };
const KEY_OTHER = { household: "other-house", handles: new Set(["fern"]), ghId: "2" };
/** the real door: townApex -> validateReadArgs -> callTool("read_marks") -> marksRead */
const door = (args, key = null) => townApex({ read: "marks", args }, key, {
  schemas, schemaRequired,
  call: (tool, fields) => callTool(tool, fields, { key }),
});
const ids = (r) => (r.published ?? []).map((m) => m.id);

test("fixture: the fold's own stamps and weight, and the two orders genuinely differ", async () => {
  const state = JSON.parse(execFileSync("git", ["-C", repo, "show", "HEAD:WORLD/world-state.json"], { encoding: "utf8" }));
  const by = Object.fromEntries(state.marks.map((m) => [m.id, [m.stamps, m.weight]]));
  assert.deepEqual(by["birch/tower"], [1, 40], "direct 1, effective 40");
  assert.deepEqual(by["cedar/well"], [9, 9]);
  assert.deepEqual(by["fern/none"], [0, 0], "an unstaked mark folds to zero, not absent");
});

test("PRIMARY · no handle, sort: weight — the whole town's published marks, top-N by effective weight, in one read", async () => {
  const r = await door({ sort: "weight", limit: 4 });
  assert.ok(!r.error, JSON.stringify(r));
  assert.deepEqual(ids(r), ["birch/tower", "dune/hut", "elm/shed", "cedar/well"],
    "ranked by the fold's weight across residents (ties: id order), cut AFTER ranking");
  assert.equal(r.counts.published, 7, "the count is of the whole set, not the page");
  assert.equal(r.shown, 4);
  assert.equal(r.complete, false);
  assert.equal(r.next_offset, 4);
  assert.ok(r.published.every((m) => typeof m.by === "string"), "each row says whose mark it is");
});

test("sort: stamps ranks by DIRECT stake, which is a different order", async () => {
  const w = ids(await door({ sort: "weight" }));
  const s = ids(await door({ sort: "stamps" }));
  assert.deepEqual(s.slice(0, 5), ["cedar/well", "amber/lamp", "dune/hut", "elm/shed", "birch/tower"]);
  assert.notDeepEqual(s, w, "the two modes answer differently");
  assert.deepEqual(s.slice(-2).sort(), ["amber/attic", "fern/none"], "zero stamps rank last, by id");
});

test("rank THEN page: offset/limit walk the whole ranked set and rejoin it", async () => {
  const whole = ids(await door({ sort: "weight", limit: 200 }));
  assert.equal(whole.length, 7);
  const a = await door({ sort: "weight", limit: 3 });
  const b = await door({ sort: "weight", limit: 3, offset: a.next_offset });
  const c = await door({ sort: "weight", limit: 3, offset: b.next_offset });
  assert.deepEqual([...ids(a), ...ids(b), ...ids(c)], whole);
  assert.equal(c.complete, true);
  assert.equal(c.next_offset, undefined);
});

test("published only, and the answer does not depend on who is asking", async () => {
  const anon = await door({ sort: "weight", limit: 200 }, null);
  assert.equal(ids(anon).length, 7, "a real ranked answer, not a bounce");
  for (const k of [KEY_AMBER, KEY_OTHER]) assert.deepEqual(await door({ sort: "weight", limit: 200 }, k), anon);
  for (const k of ["docket", "drafts_mine", "drafts_withheld", "docket_unreadable"])
    assert.ok(!(k in anon), `the town-wide read carries no ${k}`);
  assert.ok(!JSON.stringify(anon).includes("draft") || !("drafts_mine" in anon));
});

test("the handle read is unchanged: default order is id order, and the three tenses are still there", async () => {
  const r = await door({ handle: "amber" }, KEY_AMBER);
  assert.deepEqual(ids(r), ["amber/attic", "amber/lamp"], "no sort: the id order it always answered in");
  assert.equal(r.of, "amber");
  assert.ok("docket" in r && "drafts_mine" in r);
  assert.ok(r.published.every((m) => !("by" in m)), "the per-resident row shape is as it was");
});

test("handle + sort ranks that resident's own marks", async () => {
  // a real control (review of #493): amber/attic sorts before amber/lamp by id, and
  // ranks after it (5 stamps against 0), so a sort that is dropped reads attic first
  const r = await door({ handle: "amber", sort: "stamps" }, KEY_AMBER);
  assert.deepEqual(ids(r), ["amber/lamp", "amber/attic"]);
  const flipped = await door({ handle: "amber", sort: "weight" }, KEY_AMBER);
  assert.deepEqual(ids(flipped), ["amber/lamp", "amber/attic"]);
});

test("validation is the door's: a bad sort bounces by name, and neither handle nor sort still asks whose", async () => {
  const bad = await door({ sort: "popularity" });
  assert.equal(bad.error, "bounce");
  assert.match(bad.defect, /argument "sort" must be one of: stamps, weight/);
  const none = await door({});
  assert.equal(none.code, 422);
  assert.match(none.defect, /whose marks/);
  const direct = await marksRead("", { repo, sort: "popularity" });
  assert.equal(direct.code, 422);
});

test("no per-resident fanout: the docket and drafts readers are never asked on the global read", async () => {
  const boom = async () => { throw new Error("fanned out to a per-resident reader"); };
  const r = await marksRead("", { repo, sort: "weight", docketFor: boom, draftsFor: boom, key: KEY_AMBER });
  assert.ok(!r.error, JSON.stringify(r));
  assert.equal(r.published.length, 7);
});
