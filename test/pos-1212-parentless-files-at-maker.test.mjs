// pos-1212-parentless-files-at-maker.test.mjs — A MARK WITH NO PARENT FILES AT ITS MAKER'S ID, WHATEVER ITS KIND (POS-1212; POS-1209's upstream fix).
//
// THE RULING (Darko, 2026-11-24 07:59 EST): "A mark with no parent files at its own id, `<maker>/<slug>`, whatever its kind. The root fallback goes." The w48.5 hotfix
// (#1214) made a spark file at its id; this is the default it was a special case of. WRIGHT'S SMALL CALL (13:21Z): a declared parent we cannot find is a NAMED HOLD at write
// planning (it told us where it belongs, and filing it at its maker's id would be a guess); no refusal merely because a preview omitted its resolver; existing files never move.
//
// WHAT THIS RUNS, through the REAL write-down (`storeWriteDown` over a scratch world repo, and the plan beneath it), with invented names:
//   · FALSIFIER: an ordinary unsited, parentless, NON-spark mark files at `WORLD/marks/<maker>/<slug>/mark.md`, and its written record names its maker, carries no invented
//     parent, and is nowhere under `let-there-be-light/` (the old branch put it at the root, where the World reads it as a child of the root mark and the lint refuses it);
//   · THE CONTROL the brief names: an existing filing never moves (`kept_filing`): a root-filed predicate canon holds, amended by a parentless store row (the shape every
//     seeded law mark has: the World's files carry no authored `parent:`), is written back at the filing it already has, one file, and the write says which it kept;
//   · a declared parent that cannot be resolved is held BY NAME and nothing is written for it; a maker-less record is held by name; a parent in the same batch, or canon's,
//     still files its child under it; a record with no resolver at all (a preview's `dir`) is no bad parent;
//   · #1214's spark regression (test/store-writedown-spark-filing.test.mjs) stands as a control.
//   node --test test/pos-1212-parentless-files-at-maker.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { pathFor } from "../src/world-journal.mjs";
import { planStoreWriteDown, storeWriteDown } from "../src/store-writedown.mjs";
import { writeDownHousehold } from "../src/world-drain.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const scratch = tempDir("postmark-pos1212-");
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });

const SEED_ENV = { GIT_AUTHOR_NAME: "seed", GIT_AUTHOR_EMAIL: "seed@postmark.invalid", GIT_COMMITTER_NAME: "seed", GIT_COMMITTER_EMAIL: "seed@postmark.invalid",
  GIT_AUTHOR_DATE: "2026-08-01T00:00:00.000Z", GIT_COMMITTER_DATE: "2026-08-01T00:00:00.000Z" };
const AT_ISO = "2026-11-24T20:00:00.000Z";
const ROOT = "WORLD/marks/let-there-be-light";

const record = (kind, by, body, extra = "") => `---\nkind: ${kind}\nby: ${by}\ndate: 2026-08-01\n${extra}---\n\n${body}\n`;
let seq = 0;
/** A world in a bottle: the root mark, and a root-filed predicate that canon already holds (the shape of 21 of the World's law marks). */
function makeWorld() {
  const repo = join(scratch, `world-${++seq}`);
  mkdirSync(repo, { recursive: true });
  const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...SEED_ENV } });
  put(`${ROOT}/mark.md`, record("sited", "the-town", "the world frame", "at: { x: 0, y: 0 }\nextent: { w: 4, h: 4 }\n"));
  put(`${ROOT}/the-road-home/mark.md`, record("naming", "neth", "the road home, as canon holds it"));
  g("init", "-q", "-b", "main"); g("config", "user.email", "seed@postmark.invalid"); g("config", "user.name", "seed"); g("add", "-A"); g("commit", "-qm", "canon");
  return { repo, git: (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
}
const foldInput = (marks) => ({ marks, stakes: [], as_of: { window: 331, world_sha: "0".repeat(40), town_sha: "1".repeat(40) } });
// the FOLD INPUT's shape (`slug` is the full identity, as the store hands it) and the PLAN's (normalizeMark's: `slug` is the leaf)
const mark = (id, kind, fileRec = {}, over = {}) => {
  const [by] = id.split("/");
  return { slug: id, id, by, household: by, kind, locked_window: 331, fileRec: { kind, by, date: "2026-11-24", ...fileRec }, body: `${id}, said`, ...over };
};
const planMark = (id, kind, fileRec = {}, over = {}) => {
  const [by, ...rest] = id.split("/");
  return { id, by, slug: rest.join("/"), household: by, kind, plannedPath: null, locked_window: 331, fileRec: { kind, by, date: "2026-11-24", ...fileRec }, bytes: null, ...over };
};
const pathsOf = (plan) => Object.fromEntries(plan.households.flatMap((h) => h.upserts.map((u) => [u.id, u.path])));

test("FALSIFIER: an ordinary unsited, parentless, non-spark mark files at its maker's id: its record names its maker, invents no parent, and is not under the root", () => {
  const w = makeWorld();
  const out = storeWriteDown({ repo: w.repo, input: foldInput([mark("quill/a-keepsake", "keepsake", { at: { x: 5, y: 5 }, extent: { w: 2, h: 2 } })]), at: Date.parse(AT_ISO) });
  assert.ok(out.households.length === 1, JSON.stringify(out).slice(0, 200));
  const files = w.git("ls-tree", "-r", "--name-only", "draft/quill", "--", "WORLD/marks").trim().split("\n").filter((f) => f.includes("a-keepsake"));
  assert.deepEqual(files, ["WORLD/marks/quill/a-keepsake/mark.md"], "the maker's id, and nowhere else");
  const written = w.git("show", "draft/quill:WORLD/marks/quill/a-keepsake/mark.md");
  assert.match(written, /^by: quill$/m, "the maker is kept");
  assert.doesNotMatch(written, /^parent(_id)?:/m, "and no parent was invented for it (the root is nobody's declared parent)");
  assert.ok(!files.some((f) => f.startsWith(ROOT)), "never the root fallback, where the World reads it as a child of the root mark");
});

test("the rule is the default, not a list of kinds: sited, parcel, spark and any other parentless kind file at <maker>/<slug>", () => {
  for (const kind of ["sited", "parcel", "spark", "keepsake", "thing", "predicated", "naming", "weathervane"]) {
    assert.equal(pathFor({ id: "quill/x", kind, by: "quill", slug: "x" }), "WORLD/marks/quill/x/mark.md", kind);
  }
  const plan = planStoreWriteDown([planMark("wright/halloween-the-bowls", "spark", { at: { x: 1, y: 1 }, extent: { w: 20, h: 20 } }, { at_frame: "world" }), planMark("quill/a-note-alone", "naming", {})]);
  assert.deepEqual(pathsOf(plan), { "wright/halloween-the-bowls": "WORLD/marks/wright/halloween-the-bowls/mark.md", "quill/a-note-alone": "WORLD/marks/quill/a-note-alone/mark.md" });
});

test("CONTROL: an existing filing never moves, at the plan (gate A for every kind) and at the write (kept_filing): a root-filed predicate canon holds, amended by a parentless store row", () => {
  const existing = `${ROOT}/the-road-home/mark.md`;
  // the store row of a seeded law mark: no authored parent_id (the World's files carry none), so with no knowledge of canon the plan says <maker>/<slug>
  assert.equal(pathsOf(planStoreWriteDown([planMark("neth/the-road-home", "naming", {})], { publishedPathOf: () => null }))["neth/the-road-home"], "WORLD/marks/neth/the-road-home/mark.md");
  // ... and once the planner is told where canon files it, the plan keeps that filing, for a predicate as for a sited mark
  assert.equal(pathsOf(planStoreWriteDown([planMark("neth/the-road-home", "naming", {})], { publishedPathOf: (id) => (id === "neth/the-road-home" ? existing : null) }))["neth/the-road-home"], existing);
  // the whole write, planner and all: one file, at the filing it already had
  const w = makeWorld();
  storeWriteDown({ repo: w.repo, input: foldInput([mark("neth/the-road-home", "naming", {})]), at: Date.parse(AT_ISO) });
  const files = w.git("ls-tree", "-r", "--name-only", "draft/neth", "--", "WORLD/marks").trim().split("\n").filter((f) => f.includes("the-road-home"));
  assert.deepEqual(files, [existing], "never a second copy at the maker's id");
  assert.match(w.git("show", `draft/neth:${existing}`), /the-road-home, said/, "the amend itself was written, not dropped");
});

test("the write-down's own backstop (world-drain.mjs § writeDownHousehold, kept_filing): a plan that says <maker>/<slug> for a mark whose file exists is overridden, and says so", () => {
  const w = makeWorld();
  const existing = `${ROOT}/the-road-home/mark.md`;
  const out = writeDownHousehold(w.repo, {
    household: "neth",
    upserts: [{ id: "neth/the-road-home", by: "neth", slug: "the-road-home", path: "WORLD/marks/neth/the-road-home/mark.md", fileRec: { kind: "naming", by: "neth", date: "2026-11-24" }, body: "amended" }],
    removals: [],
  }, { whenIso: AT_ISO, message: "pos-1212 backstop" });
  assert.deepEqual(out.touched.map((t) => [t.op, t.path, t.kept_filing, t.planned]), [["write", existing, existing, "WORLD/marks/neth/the-road-home/mark.md"]]);
  const files = w.git("ls-tree", "-r", "--name-only", "draft/neth", "--", "WORLD/marks").trim().split("\n").filter((f) => f.includes("the-road-home"));
  assert.deepEqual(files, [existing]);
});

test("a declared parent that cannot be resolved is HELD BY NAME at write planning: nothing is written for it, nowhere (not the root, not its maker's id)", () => {
  const w = makeWorld();
  const out = storeWriteDown({
    repo: w.repo,
    input: foldInput([mark("quill/call-it-nowhere", "naming", { parent_id: "quill/never-heard-of" }), mark("quill/a-sound-mark", "keepsake", {})]),
    at: Date.parse(AT_ISO),
  });
  const files = w.git("ls-tree", "-r", "--name-only", "draft/quill", "--", "WORLD/marks").trim().split("\n");
  assert.ok(!files.some((f) => f.includes("call-it-nowhere")), `held, not filed: ${files}`);
  assert.ok(files.includes("WORLD/marks/quill/a-sound-mark/mark.md"), "and the sound mark in the same crossing is not held by it");
  const held = JSON.stringify(out);
  assert.match(held, /parent-unresolved/);
  assert.match(held, /quill\/never-heard-of/, "the hold names the parent it could not find");
  const plan = planStoreWriteDown([planMark("quill/call-it-nowhere", "naming", { parent_id: "quill/never-heard-of" })], { publishedPathOf: () => null });
  assert.deepEqual(plan.held.map((h) => [h.id, h.crossing_output]), [["quill/call-it-nowhere", "parent-unresolved"]]);
});

test("a parent in the same batch, or canon's, still files its child under it (legitimate parented filing is unchanged)", () => {
  const plan = planStoreWriteDown([
    planMark("beta/garden", "parcel", { points: [[0, 0], [20, 0], [20, 20], [0, 20]] }, { at_frame: "world" }),
    planMark("beta/call-it-the-garden", "naming", { parent_id: "beta/garden" }),
    planMark("beta/the-colour", "predicated", { parent_id: "alpha/old-house" }),
  ], { publishedPathOf: (id) => (id === "alpha/old-house" ? `${ROOT}/the-town-centre/old-house/mark.md` : null) });
  const p = pathsOf(plan);
  assert.equal(p["beta/call-it-the-garden"], "WORLD/marks/beta/garden/call-it-the-garden/mark.md");
  assert.equal(p["beta/the-colour"], `${ROOT}/the-town-centre/old-house/the-colour/mark.md`);
});

test("a record with no maker is held by name, never filed at the root: no WORLD/marks/undefined, no silent loss", () => {
  assert.equal(pathFor({ slug: "orphan", kind: "keepsake" }), null);
  assert.equal(pathFor({ id: "", slug: "", kind: "keepsake" }), null);
  // an id with no maker in it and no `by`: nothing can say whose it is
  const plan = planStoreWriteDown([{ ...planMark("quill/placeholder", "keepsake", {}), id: "/orphan", slug: "orphan", by: null, household: "quill", fileRec: { kind: "keepsake", date: "2026-11-24" } }]);
  assert.deepEqual(plan.households.flatMap((h) => h.upserts), [], "nothing written");
  assert.deepEqual(plan.held.map((h) => h.crossing_output), ["no-maker"]);
});

test("a caller with NO resolver (a preview's dir) is no evidence of a bad parent: it gets the id path, and a resolver that finds the parent nests", () => {
  const rec = { id: "quill/the-colour", kind: "predicated", by: "quill", slug: "the-colour", parent_id: "quill/the-lamp" };
  assert.equal(pathFor(rec), "WORLD/marks/quill/the-colour/mark.md", "no resolver: never a refusal, never the root");
  assert.equal(pathFor(rec, { parentPathOf: () => "WORLD/marks/quill/the-lamp" }), "WORLD/marks/quill/the-lamp/the-colour/mark.md");
  assert.equal(pathFor(rec, { parentPathOf: () => null }), null, "a resolver that CANNOT find the declared parent: no filing (held by name by the planner)");
});
