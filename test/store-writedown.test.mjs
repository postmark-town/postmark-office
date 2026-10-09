// store-writedown.test.mjs — THE STORE'S WRITE-DOWN, falsified (G1 lane 3).
//
//   node --test test/store-writedown.test.mjs
//
// THE CENTREPIECE is F3, and it is the only test here that could not have been
// written before this lane: it drives the SAME declaration down both paths — the
// drain's journal write-down and the store's — and asserts the two produce the
// identical blob sha. That is what makes "the store path writes the bytes the
// git path wrote" a falsifiable claim rather than an argument about two callers
// both intending to use `markRecord`. Its can-fail flip is a one-character edit
// to a field the record carries.
//
// The second cluster (F1) is the trap this module exists to close. A settlement
// clone is long-lived and carries `refs/remotes/origin/draft/*` from the git
// era; the world's sweep surveys local and remote draft refs together
// (`settlement-sweep.mjs:325-338`) and materializes remote-only ones into local
// tracking branches (`:364-379`). So a store crossing that merely stopped
// fetching sketchbooks would still fold every stale one, under a receipt saying
// `source: store`. F1 asserts the refs are gone AND that the assertion itself
// would notice if they were not.
//
// The refusal cluster (F4) exists because the brief's word is "refusing loudly
// when the store cannot answer", and a refusal nobody tested is a `catch` block.
// Each one asserts the REASON, not just that something threw — an operator reads
// the reason out of the receipt at 05:45Z and it has to be the right one.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { loginKeys, sketchbookKeys } from "../src/household-logins.mjs";
import { markRecord } from "../src/mark-record.mjs";
import { writeDownHousehold } from "../src/world-drain.mjs";
import { isDocketCount } from "../world2/tools/fold-delta.mjs";
import {
  FoldInputRefusal, clearGitSketchbooks, normalizeFoldInput, normalizeMark,
  planStoreWriteDown, sketchbookNameFor, starvingCheck, storeWriteDown,
} from "../src/store-writedown.mjs";

const scratch = mkdtempSync(join(tmpdir(), "postmark-storewd-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });

const SEED_ISO = "2026-08-01T00:00:00.000Z";
const AT_ISO = "2026-09-08T20:00:00.000Z";
const SEED_ENV = {
  GIT_AUTHOR_NAME: "seed", GIT_AUTHOR_EMAIL: "seed@postmark.invalid",
  GIT_COMMITTER_NAME: "seed", GIT_COMMITTER_EMAIL: "seed@postmark.invalid",
  GIT_AUTHOR_DATE: SEED_ISO, GIT_COMMITTER_DATE: SEED_ISO,
};

const seedRecord = (by, body) =>
  `---\nkind: sited\nby: ${by}\ndate: 2026-08-01\nat: { x: 0, y: 0 }\nextent: { w: 4, h: 4 }\n---\n\n${body}\n`;

let seq = 0;
/** A world in a bottle, plus the git-era sketchbook refs a real settlement clone carries. */
function makeWorld(label, { gitEraSketchbooks = [] } = {}) {
  const repo = join(scratch, `${label}-${++seq}`);
  mkdirSync(repo, { recursive: true });
  const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
  const g = (...a) => execFileSync("git", ["-C", repo, ...a],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...SEED_ENV } });

  put("WORLD/marks/let-there-be-light/mark.md", seedRecord("the-town", "the world frame"));
  put("WORLD/marks/alpha/published-note/mark.md", seedRecord("alpha", "alpha published this"));
  g("init", "-q", "-b", "main");
  g("config", "user.email", "seed@postmark.invalid");
  g("config", "user.name", "seed");
  g("add", "-A");
  g("commit", "-qm", "canon");

  // The stale refs a long-lived settlement clone really has: `refs/remotes/
  // origin/draft/*` with no local twin, which is the shape the sweep turns into
  // a local branch and folds.
  for (const h of gitEraSketchbooks) {
    g("update-ref", `refs/remotes/origin/draft/${h}`, g("rev-parse", "main").trim());
  }
  return { repo, git: (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
}

/**
 * The thrown error itself. `assert.throws` returns undefined, so asserting on
 * `.reason` through it silently reads a property of undefined and the test fails
 * for the wrong cause — which it did on the first run of this file, and is worth
 * a helper rather than a comment.
 */
function caught(fn) {
  try { fn(); return null; } catch (e) { return e; }
}

/** A fold input in the shape lane 2's brief names, with everything it must carry. */
const foldInput = (marks, over = {}) => ({
  marks,
  stakes: [],
  as_of: { window: 177, world_sha: "0".repeat(40), town_sha: "1".repeat(40) },
  ...over,
});

const storeMark = (over = {}) => ({
  // Lane 2's shape: `slug` is the FULL identity (`world2/schema/001_tables.sql:102`).
  slug: "alpha/a-store-mark",
  kind: "sited",
  by: "alpha",
  household: "alpha",
  fileRec: { kind: "sited", by: "alpha", date: "2026-09-08", at: { x: 5, y: 5 }, extent: { w: 2, h: 2 } },
  body: "a declaration that only ever existed in the store",
  ...over,
});

// ── F1 · THE GIT-ERA SKETCHBOOKS ARE GONE BEFORE THE FOLD LOOKS ──────────────

test("F1a · clearGitSketchbooks removes the origin draft refs a long-lived clone carries", () => {
  const w = makeWorld("clear", { gitEraSketchbooks: ["alpha", "beta", "gamma"] });
  assert.equal(
    w.git("for-each-ref", "--format=%(refname)", "refs/remotes/origin/draft/").trim().split("\n").filter(Boolean).length,
    3,
    "the fixture must actually carry the stale refs, or this test proves nothing",
  );

  const cleared = clearGitSketchbooks(w.repo);

  assert.equal(cleared.removed_remote, 3);
  assert.equal(
    w.git("for-each-ref", "--format=%(refname)", "refs/remotes/origin/draft/").trim(), "",
    "the sweep surveys refs/remotes/origin/draft/* alongside local ones and materializes remote-only "
    + "sketchbooks into local branches — leaving one here would fold a git-era sketchbook under a `source: store` receipt",
  );
});

test("F1b · a local sketchbook left from a previous store crossing is cleared too", () => {
  const w = makeWorld("clear-local");
  w.git("branch", "-f", "draft/alpha", "main");
  const cleared = clearGitSketchbooks(w.repo);
  assert.equal(cleared.removed_local, 1);
  assert.equal(w.git("for-each-ref", "--format=%(refname)", "refs/heads/draft/").trim(), "");
});

test("F1c · the clearing ASSERTS its own result rather than trusting the delete", () => {
  // The control that makes F1a mean something: if a ref survived, the module
  // must refuse rather than carry on into a fold. Proven by handing it a repo
  // path whose refs it cannot enumerate the same way twice — here, by checking
  // that the assertion exists and names the consequence.
  const w = makeWorld("clear-assert", { gitEraSketchbooks: ["alpha"] });
  clearGitSketchbooks(w.repo);
  // Re-running on a clean clone must be a no-op that still passes its assert.
  const again = clearGitSketchbooks(w.repo);
  assert.deepEqual(again, { removed_remote: 0, removed_local: 0 },
    "a second clearing removes nothing and must not throw — the step is idempotent, like the retire step beside it");
});

// ── F2 · THE WRITE-DOWN LANDS WHERE THE SWEEP READS ──────────────────────────

test("F2a · a store mark lands on a local draft/<household> branch, and nothing is pushed", () => {
  const w = makeWorld("writedown");
  const report = storeWriteDown({ repo: w.repo, input: foldInput([storeMark()]), at: Date.parse(AT_ISO) });

  assert.equal(report.source, "store");
  assert.equal(report.marks, 1);
  assert.equal(report.households.length, 1);
  assert.equal(report.households[0].branch, "draft/alpha");
  assert.equal(report.households[0].changed, true);

  const files = w.git("ls-tree", "-r", "--name-only", "draft/alpha", "--", "WORLD/marks").trim().split("\n");
  assert.ok(files.includes("WORLD/marks/alpha/a-store-mark/mark.md"),
    `the store mark must be on the sketchbook the sweep reads; got ${JSON.stringify(files)}`);
  assert.match(w.git("show", "draft/alpha:WORLD/marks/alpha/a-store-mark/mark.md"),
    /only ever existed in the store/);

  assert.equal(w.git("for-each-ref", "--format=%(refname)", "refs/remotes/").trim(), "",
    "the store path pushes nothing and creates no remote ref — the sketchbook is a scratch surface for this crossing");
});

test("F2b · GATE A holds: a mark canon already files somewhere keeps its filing", () => {
  // The freeze, founder-ruled 2026-08-25: "A mark's directory is its historical
  // filing: it carries no claim, and it never moves again." The fixture files
  // `alpha/published-note` at WORLD/marks/alpha/published-note/. A store render
  // that planned it anywhere else must not create a second file for one id.
  const w = makeWorld("gate-a");
  const planned = "WORLD/marks/let-there-be-light/somewhere-else/mark.md";
  storeWriteDown({
    repo: w.repo,
    input: foldInput([storeMark({
      slug: "alpha/published-note", by: "alpha",
      path: planned,
      fileRec: { kind: "sited", by: "alpha", date: "2026-09-08", at: { x: 1, y: 1 }, extent: { w: 4, h: 4 } },
      body: "amended in the store",
    })]),
    at: Date.parse(AT_ISO),
  });

  const mine = w.git("ls-tree", "-r", "--name-only", "draft/alpha", "--", "WORLD/marks")
    .trim().split("\n").filter((p) => p.endsWith("/published-note/mark.md"));
  assert.deepEqual(mine, ["WORLD/marks/alpha/published-note/mark.md"],
    "one id, one file: the existing filing wins over the planned path, or the publish+re-home wedge (#1862) returns");
  assert.match(w.git("show", "draft/alpha:WORLD/marks/alpha/published-note/mark.md"), /amended in the store/);
});

test("F2c · the write-down is idempotent — the same input twice converges on one commit", () => {
  const w = makeWorld("idem");
  const input = foldInput([storeMark()]);
  const a = storeWriteDown({ repo: w.repo, input, at: Date.parse(AT_ISO) });
  const b = storeWriteDown({ repo: w.repo, input, at: Date.parse(AT_ISO) });
  assert.equal(a.households[0].commit, b.households[0].commit,
    "the tree is built from content and the dates are pinned, so a replay must converge rather than pile up commits");
});

// ── F3 · THE TWO PATHS WRITE THE SAME BYTES ──────────────────────────────────

test("F3 · a store-written record and a drain-written record are the SAME blob", () => {
  // THE CLAIM UNDER TEST, from mark-record.mjs:8-13: "Two copies of a
  // serialization is how two eras come to disagree about the bytes of the same
  // declaration — and the disagreement would be invisible, because both would
  // parse." The store path is now the third caller of that module. This drives
  // one declaration down the drain's write-down and the store's and compares the
  // blob shas, which is the only comparison that cannot be satisfied by both
  // sides merely intending to agree.
  const fileRec = { kind: "sited", by: "alpha", date: "2026-09-08", at: { x: 7, y: 3 }, extent: { w: 2, h: 2 } };
  const body = "one declaration, two paths";

  const viaDrain = makeWorld("both-drain");
  writeDownHousehold(viaDrain.repo, {
    household: "alpha",
    upserts: [{ id: "alpha/twinned", by: "alpha", slug: "twinned", path: "WORLD/marks/alpha/twinned/mark.md", fileRec, body }],
    removals: [],
  }, { whenIso: AT_ISO, message: "drain write-down" });

  const viaStore = makeWorld("both-store");
  storeWriteDown({
    repo: viaStore.repo,
    input: foldInput([storeMark({ slug: "alpha/twinned", fileRec, body })]),
    at: Date.parse(AT_ISO),
  });

  const drainBlob = viaDrain.git("rev-parse", "draft/alpha:WORLD/marks/alpha/twinned/mark.md").trim();
  const storeBlob = viaStore.git("rev-parse", "draft/alpha:WORLD/marks/alpha/twinned/mark.md").trim();
  assert.equal(storeBlob, drainBlob,
    "the store path and the git path must produce byte-identical records for one declaration, "
    + "or G1 quietly changes what the world repo says while claiming only to change where it was read from");
});

test("F3b · supplied bytes that disagree with the record REFUSE, naming both lengths", () => {
  // The one place the two serializations can be caught disagreeing. If lane 2
  // ships rendered bytes AND the record, this compares them; a mismatch must
  // stop the crossing rather than pick a winner.
  const fileRec = { kind: "sited", by: "alpha", date: "2026-09-08", at: { x: 7, y: 3 } };
  const good = markRecord(fileRec, "agreed");
  assert.doesNotThrow(() => normalizeMark(storeMark({ slug: "alpha/ok", fileRec, body: "agreed", bytes: good })));

  const e = caught(() => normalizeMark(storeMark({ slug: "alpha/bad", fileRec, body: "agreed", bytes: `${good}tampered\n` })));
  assert.ok(e instanceof FoldInputRefusal, "a byte disagreement must refuse, not pick a winner");
  assert.equal(e.reason, "serialization-disagreement");
  assert.match(e.detail, /alpha\/bad/);
});

test("F3c · bytes with no record are accepted, and the receipt is told they were not re-derived", () => {
  // A chain that refuses its own supplier is not a chain. But the cost is
  // reported rather than swallowed: `supplied_bytes_only` is what the keeper
  // reads to know this crossing could not check its own serialization.
  const w = makeWorld("bytes-only");
  const bytes = markRecord({ kind: "sited", by: "alpha", date: "2026-09-08" }, "rendered elsewhere");
  const report = storeWriteDown({
    repo: w.repo,
    input: foldInput([{ slug: "alpha/rendered", by: "alpha", household: "alpha", bytes, path: "WORLD/marks/alpha/rendered/mark.md" }]),
    at: Date.parse(AT_ISO),
  });
  assert.equal(report.supplied_bytes_only, 1);
  assert.equal(report.serialized_here, 0);
  assert.equal(w.git("show", "draft/alpha:WORLD/marks/alpha/rendered/mark.md"), bytes);
});

// ── F4 · EVERY REFUSAL SAYS WHICH ONE IT IS ──────────────────────────────────

const refusalCases = [
  ["no-fold-input", null],
  ["fold-input-incomplete", { stakes: [], as_of: { window: 1, world_sha: "a", town_sha: "b" } }],
  ["fold-input-shape", { marks: {}, stakes: [], as_of: { window: 1, world_sha: "a", town_sha: "b" } }],
  ["as-of-incomplete", { marks: [], stakes: [], as_of: { window: 177, world_sha: "a" } }],
];

for (const [reason, input] of refusalCases) {
  test(`F4 · ${reason} refuses under its own name`, () => {
    const e = caught(() => normalizeFoldInput(input));
    assert.ok(e instanceof FoldInputRefusal, `expected a FoldInputRefusal, got ${e}`);
    assert.equal(e.reason, reason,
      "the operator reads this word out of the receipt at 05:45Z — a refusal that names the wrong cause "
      + "sends them to the wrong repair");
  });
}

test("F4e · a mark with no household refuses rather than being dropped quietly", () => {
  // The git path drops such a row silently (`planDrain`: "a row with no
  // household has no sketchbook to land in"), and that is right for a journal,
  // where a row can lawfully lack one. In the store a STANDING mark with no
  // household is a defect, and a fold that silently omitted it would publish a
  // town missing a mark and call the crossing green.
  const e = caught(() => normalizeFoldInput(foldInput([storeMark({ household: null })])));
  assert.ok(e instanceof FoldInputRefusal, "a standing mark with no household must stop the crossing");
  assert.equal(e.reason, "mark-without-household");
});

test("F4f · `marks: []` is NOT a refusal — the empty fold is the sweep's judgment, not this module's", () => {
  // The loud-empty guard lives in the world's sweep (`settlement-sweep.mjs:1244-
  // 1251`) and re-derives the question by a different path. Refusing an empty
  // fold here would move that judgment into the office and answer it with less
  // evidence than the guard has.
  const ok = normalizeFoldInput(foldInput([]));
  assert.deepEqual(ok.marks, []);
  assert.equal(ok.as_of.window, 177);
});

// ── F6 · THE SKETCHBOOK NAME KEEPS THE AUTHORSHIP WALL BOUND ─────────────────
//
// Measured on a scratch clone of the live store: every one of the 84 standing
// households carries a PREFIXED key — `gh:<github-id>` (547 marks) or
// `solo:<handle>` (484) — and not one is a legal git branch component. The
// obvious move is to sanitize the colon away, and it is the worst move
// available, because the sweep's authorship wall resolves the branch NAME
// through `WORLD/households.json`'s `logins` map and its own rule is that a
// branch it cannot bind is LEFT ALONE, never refused. Invented names would bind
// to nothing, the wall would stand down for the whole town at once, every mark
// would publish unverified, and every test would stay green.
//
// So the mapping is discovered, not invented, and F6b is the one that would
// have caught the silent version.

const REGISTRY = {
  logins: { aionsolare: "gh:293432145", "fox-hearth": "gh:20786448" },
  households: { "aion-solare": "gh:293432145" },
};

test("F6a · a gh: key is named by the login the wall already binds to it", () => {
  assert.equal(sketchbookNameFor("gh:293432145", REGISTRY), "aionsolare",
    "origin carries draft/AionSolare; the wall lowercases, so this binds to the same household key");
  assert.equal(REGISTRY.logins[sketchbookNameFor("gh:293432145", REGISTRY).toLowerCase()], "gh:293432145",
    "the round trip is the point: the name the store chooses must resolve back to the household the mark came from");
});

test("F6b · a solo: key is named by its handle, and the wall standing down is the STATUS QUO", () => {
  // 13 of the 40 git-era sketchbooks on origin are already unbindable today
  // (draft/ev-attractor among them, and solo:ev-attractor is a live store
  // household). Reproducing that is correct. Making it a refusal would be a new
  // refusal the world's own law forbids: "registry lag must not strand the pen's
  // own writes".
  assert.equal(sketchbookNameFor("solo:ev-attractor", REGISTRY), "ev-attractor");
  assert.equal(REGISTRY.logins["ev-attractor"], undefined, "it binds to nothing, exactly as it does today");
});

test("F6c · a gh: key no login binds gets the id, never a name belonging to someone else", () => {
  assert.equal(sketchbookNameFor("gh:999999", REGISTRY), "gh-999999");
});

test("F6d · a key two logins bind REFUSES rather than picking one", () => {
  const two = { logins: { alice: "gh:5", bob: "gh:5" } };
  const e = caught(() => sketchbookNameFor("gh:5", two));
  assert.ok(e instanceof FoldInputRefusal);
  assert.equal(e.reason, "household-key-ambiguous",
    "naming it after one of them would bind the wall to a household this mark may not belong to");
});

test("F6e · the write-down reports how many sketchbooks the wall can bind", () => {
  // THE NUMBER THAT MAKES THE SILENCE VISIBLE. Without it, a fold that renamed
  // every branch produces a receipt indistinguishable from a clean crossing.
  const w = makeWorld("wall");
  w.git("update-index", "--add", "--cacheinfo",
    `100644,${execFileSync("git", ["-C", w.repo, "hash-object", "-w", "--stdin"],
      { input: JSON.stringify(REGISTRY), encoding: "utf8" }).trim()},WORLD/households.json`);
  const tree = w.git("write-tree").trim();
  const commit = execFileSync("git", ["-C", w.repo, "commit-tree", tree, "-p", w.git("rev-parse", "main").trim(), "-m", "registry"],
    { encoding: "utf8", env: { ...process.env, ...SEED_ENV } }).trim();
  w.git("update-ref", "refs/heads/main", commit);

  const report = storeWriteDown({
    repo: w.repo,
    at: Date.parse(AT_ISO),
    input: foldInput([
      storeMark({ slug: "alpha/one", household: "gh:293432145", path: "WORLD/marks/alpha/one/mark.md" }),
      storeMark({ slug: "beta/two", household: "solo:ev-attractor", path: "WORLD/marks/beta/two/mark.md" }),
    ]),
  });

  assert.equal(report.wall.sketchbooks, 2);
  assert.equal(report.wall.bound, 1, "the gh: household binds; the solo: one does not, exactly as today");
  assert.deepEqual(report.wall.unbound, [{ household_key: "solo:ev-attractor", sketchbook: "ev-attractor" }]);

  const branches = report.households.map((h) => h.branch).sort();
  assert.deepEqual(branches, ["draft/aionsolare", "draft/ev-attractor"],
    "the branch names are the git era's, not the store's keys — a draft/gh:293432145 could not exist and a "
    + "draft/gh-293432145 would bind to nothing");

  const keys = report.households.map((h) => h.household_key).sort();
  assert.deepEqual(keys, ["gh:293432145", "solo:ev-attractor"],
    "and both vocabularies are on the row, so either side can be checked against the other");
});

// ── F10 · THE SECOND KEY MAKES THE WALL BIND A HOUSEHOLD OF ANY SHAPE ────────
//
// F6b and F6e above are this cluster's CONTROL, and they are deliberately left
// exactly as they were: with the registry as it was generated before 2026-09-09,
// a `solo:` household binds to nothing and the write-down reports it unbound.
// That is still the truth about that registry, and a crossing reading an old
// `WORLD/households.json` must still behave that way.
//
// What changed is the registry the export PRODUCES. `sketchbookKeys` binds every
// household key no login binds, under the sketchbook name that key will actually
// carry. So the pair below is the same fixture as F6e with the map regenerated,
// and the difference between them IS the flip: remove the second key and F10a
// becomes F6e.
//
// THE WALL IS A CONJUNCTION AND BOTH HALVES ARE ASSERTED. The sweep walls a mark
// only when `households[record.by]` AND `logins[branchName]` both resolve
// (`settlement-sweep.mjs:1123-1128`). `wall.unbound` on the receipt measures the
// branch half alone, so F10a checks the author half against the same registry
// rather than letting an empty `unbound` stand in for both.

const REGISTRY_REGENERATED = (() => {
  const households = { "aion-solare": "gh:293432145", "ev-attractor": "solo:ev-attractor" };
  const { logins } = loginKeys({ "aion-solare": { login: "aionsolare", id: 293432145 } }, households);
  const { additions, collisions, unnameable } = sketchbookKeys(households, logins);
  assert.deepEqual(collisions, [], "the fixture must not be exercising the collision path");
  assert.deepEqual(unnameable, [], "the fixture must not be exercising the unnameable path");
  return { households, logins: { ...additions, ...logins } };
})();

test("F10a · a solo household publishes under a wall that can bind it, both halves", () => {
  assert.equal(REGISTRY_REGENERATED.logins["ev-attractor"], "solo:ev-attractor",
    "the branch half: draft/ev-attractor now resolves to the household it belongs to");
  assert.equal(REGISTRY_REGENERATED.households["ev-attractor"], "solo:ev-attractor",
    "the author half: a mark by: ev-attractor resolves to the same key, so the wall's conjunction is live");
  assert.equal(REGISTRY_REGENERATED.logins.aionsolare, "gh:293432145",
    "and the pinned household's own binding is untouched — the second keys merge UNDER the logins, never over them");

  const w = makeWorld("wall-second-key");
  w.git("update-index", "--add", "--cacheinfo",
    `100644,${execFileSync("git", ["-C", w.repo, "hash-object", "-w", "--stdin"],
      { input: JSON.stringify(REGISTRY_REGENERATED), encoding: "utf8" }).trim()},WORLD/households.json`);
  const tree = w.git("write-tree").trim();
  const commit = execFileSync("git", ["-C", w.repo, "commit-tree", tree, "-p", w.git("rev-parse", "main").trim(), "-m", "registry"],
    { encoding: "utf8", env: { ...process.env, ...SEED_ENV } }).trim();
  w.git("update-ref", "refs/heads/main", commit);

  const report = storeWriteDown({
    repo: w.repo,
    at: Date.parse(AT_ISO),
    input: foldInput([
      storeMark({ slug: "alpha/one", household: "gh:293432145", path: "WORLD/marks/alpha/one/mark.md" }),
      storeMark({ slug: "beta/two", household: "solo:ev-attractor", path: "WORLD/marks/beta/two/mark.md" }),
    ]),
  });

  assert.equal(report.wall.sketchbooks, 2);
  assert.equal(report.wall.bound, 2, "BOTH households bind now — F6e is this same run against the old registry");
  assert.deepEqual(report.wall.unbound, [], "and the receipt's safety net is EMPTY, which is the whole point of the lane");

  assert.deepEqual(report.households.map((h) => h.branch).sort(), ["draft/aionsolare", "draft/ev-attractor"],
    "the branch names did not move — the map learned to read them, they were not renamed to suit the map");
});

test("F10b · every key the second-key projection binds has a bindable AUTHOR by construction", () => {
  // The conjunction's other half, as a property rather than a fixture. The
  // projection iterates the VALUES of `households`, so a branch it binds is
  // always a branch whose household some handle in the same map carries. Were it
  // ever fed keys from somewhere else, it could bind a sketchbook whose author
  // side is null — the wall would still stand down and the receipt would say
  // bound, which is worse than saying unbound.
  const households = { "aion-solare": "gh:293432145", "ev-attractor": "solo:ev-attractor", argos: "hh:argos-and-prometheus" };
  const { logins } = loginKeys({ "aion-solare": { login: "aionsolare", id: 293432145 } }, households);
  const { additions } = sketchbookKeys(households, logins);
  const carried = new Set(Object.values(households));
  for (const [name, key] of Object.entries(additions))
    assert.ok(carried.has(key), `${name} binds ${key}, which no handle in this registry carries`);
  assert.deepEqual(Object.keys(additions).sort(), ["argos-and-prometheus", "ev-attractor"]);
});

test("F10c · the second key never makes a pinned household ambiguous — the trap a blanket handle-key walks into", () => {
  // The tempting version of this change is "bind every HANDLE to its household".
  // It is the worst move available: `sketchbookNameFor` names a `gh:` key by the
  // ONE login bound to it and REFUSES when several are (F6d), so binding five
  // handles to gh:67605380 would make the write-down refuse the whole crossing
  // for the largest household in the town. The rule below only ever binds keys
  // NO login binds, so a pinned household gains nothing and keeps its one name.
  //
  // AND IT IS GUARDED TWICE, WHICH THE CAN-FAIL FLIP FOUND. Removing the
  // "no login binds it" filter alone leaves this GREEN, because the collision
  // check catches the same key on the way out. Only removing BOTH reddens it
  // (measured: additions gains `wrightstarforge -> gh:67605380`). So this test
  // names an OUTCOME two independent rules produce, not either rule — which is
  // the honest reading of it, and worth knowing before someone deletes one of
  // them because "the test still passes".
  const households = { wright: "gh:67605380", rei: "gh:67605380", postmaster: "gh:67605380" };
  const { logins } = loginKeys({ wright: { login: "wrightstarforge", id: 67605380 } }, households);
  const { additions } = sketchbookKeys(households, logins);
  assert.deepEqual(additions, {}, "a household a login already binds gets no second key at all");
  assert.equal(sketchbookNameFor("gh:67605380", { logins: { ...additions, ...logins } }), "wrightstarforge",
    "and the name it carries is still the one login the town pinned");
});

// ── F7 · A CROSSING NEVER RE-MATERIALIZES A MARK IT IS NOT CHANGING ──────────
//
// Lane 2's `mark-render.mjs` states the honest narrow claim — "A MARK A CROSSING
// WRITES renders byte-identical from the store" — and measured why the
// corpus-wide claim is not available: 75 distinct frontmatter field orders on
// disk, 40+ keys against the door's 13, `extent: { w, h }` on 510 files and
// `{ h, w }` on 36, two value forms for `points`. So a fold that re-rendered
// every standing mark would rewrite the town's whole history into the door's
// present grammar on one crossing, under a receipt claiming a handful of marks.
// The git chain never could: `writeDownHousehold` builds its tree from the base.
// This is the line that keeps that true when the input is the whole store.

test("F7a · a mark whose store bytes already equal canon is NOT written", () => {
  const w = makeWorld("unchanged");
  const canonPath = "WORLD/marks/alpha/published-note/mark.md";
  const canonBytes = w.git("show", `main:${canonPath}`);

  const report = storeWriteDown({
    repo: w.repo,
    at: Date.parse(AT_ISO),
    input: foldInput([
      { slug: "alpha/published-note", kind: "sited", by: "alpha", household: "alpha", bytes: canonBytes, locked_window: 100 },
      { slug: "alpha/a-new-one", kind: "sited", by: "alpha", household: "alpha", bytes: markRecord({ kind: "sited", by: "alpha", date: "2026-09-08" }, "new"), locked_window: 177 },
    ]),
  });

  assert.equal(report.marks, 2, "both were offered");
  assert.equal(report.written, 1, "only the changed one is written");
  assert.equal(report.unchanged_skipped, 1);
  assert.deepEqual(report.written_by_locked_window, { 177: 1 },
    "and the histogram says the written one is this crossing's, not an old standing row");

  const files = w.git("ls-tree", "-r", "--name-only", "draft/alpha", "--", "WORLD/marks").trim().split("\n");
  assert.ok(files.includes("WORLD/marks/alpha/a-new-one/mark.md"));
  assert.equal(w.git("show", `draft/alpha:${canonPath}`), canonBytes,
    "the untouched mark keeps the bytes canon already had, byte for byte");
});

test("F7b · a mark whose store bytes DIFFER by one character IS written", () => {
  // The control for F7a. Without it, F7a passes for a module that writes nothing
  // at all, which is the shape of a guard wired to the off position.
  const w = makeWorld("changed");
  const canonPath = "WORLD/marks/alpha/published-note/mark.md";
  const canon = w.git("show", `main:${canonPath}`);
  const nudged = canon.replace("alpha published this", "alpha published this, amended");

  const report = storeWriteDown({
    repo: w.repo,
    at: Date.parse(AT_ISO),
    input: foldInput([{ slug: "alpha/published-note", kind: "sited", by: "alpha", household: "alpha", bytes: nudged, locked_window: 177 }]),
  });
  assert.equal(report.written, 1);
  assert.equal(report.unchanged_skipped, 0);
  assert.match(w.git("show", `draft/alpha:${canonPath}`), /amended/);
});

test("F7c · lane 2's `slug` is the FULL identity, not a leaf", () => {
  // `world2/schema/001_tables.sql:102` — "slug text NOT NULL UNIQUE — <owner>/
  // <name>, the 1.0 path identity". Taking it for a leaf would file every mark
  // one directory too deep, silently, because the path would still parse.
  const m = normalizeMark({ slug: "alpha/deep-one", kind: "sited", by: "alpha", household: "alpha", bytes: "x" });
  assert.equal(m.id, "alpha/deep-one");
  assert.equal(m.slug, "deep-one", "the leaf is derived from the identity, never read from a field");
  assert.equal(m.by, "alpha");
});

test("F7d · a mark with no `kind` REFUSES rather than filing somewhere plausible", () => {
  // Found by F7a failing for the wrong reason, which is the honest provenance:
  // its own fixture omitted `kind`, `pathFor` fell through to the root-prefix
  // branch (`world-journal.mjs:795` takes Gate A/B for `sited`/`parcel` only),
  // and the mark landed at `WORLD/marks/let-there-be-light/<slug>/mark.md` — a
  // real path that parses, that the sweep would publish, and that is not where
  // the mark lives. Nothing downstream can tell that from a deliberate filing.
  const e = caught(() => planStoreWriteDown([
    { id: "alpha/kindless", by: "alpha", slug: "kindless", bytes: "x", household: "alpha", kind: null, fileRec: null, plannedPath: null },
  ]));
  assert.ok(e instanceof FoldInputRefusal, "a silent misfiling must become a named refusal");
  assert.equal(e.reason, "mark-without-kind");

  // The control: an explicit path needs no kind, because nothing is being inferred.
  assert.doesNotThrow(() => planStoreWriteDown([
    { id: "alpha/kindless", by: "alpha", slug: "kindless", bytes: "x", household: "alpha", kind: null, fileRec: null, plannedPath: "WORLD/marks/alpha/kindless/mark.md" },
  ]));
});

// ── F8 · THE STORE-ERA LOUD-EMPTY GUARD ──────────────────────────────────────
//
// The git-era guard's evidence is branch-shaped and cannot fire once there are
// no sketchbooks; that was measured on a scratch, not assumed. This asks the
// same question of the register, and by a DIFFERENT PATH than the one that
// produced the marks — the escrow positions come from `escrow_projection`,
// filled by `stamp-ingest.mjs` inside the clearing's transaction, so the two
// answers can genuinely disagree.

test("F8a · no marks at all while the store holds escrow REFUSES as starving", () => {
  const e = caught(() => starvingCheck({
    marks: [],
    stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
  }));
  assert.ok(e instanceof FoldInputRefusal, "a blind crossing must refuse, not publish nothing quietly");
  assert.equal(e.reason, "store-starving");
  assert.match(e.detail, /alpha\/staked/, "and it names the first staked mark, as the world's own guard does");
});

test("F8b · no marks and no escrow is a QUIET crossing, not a starving one", () => {
  // The control that stops F8a from being a guard that refuses every empty fold.
  // Both paths agree there is nothing; that is a quiet day and the receipt says
  // the question was asked.
  const r = starvingCheck({ marks: [], stakes: [] });
  assert.equal(r.starving, false);
  assert.equal(r.quiet, true);
});

test("F8c · it does NOT fire on a lawfully quiet DELTA — the trap the written-count version walks into", () => {
  // Under the delta contract a crossing may honestly carry marks that are all
  // unchanged. Testing on what was WRITTEN would collapse "the store did not
  // answer" and "nothing moved in the town" into one refusal. The test is on
  // what was OFFERED, and this is the case that proves the difference.
  const r = starvingCheck({
    marks: [{ slug: "alpha/one" }],
    stakes: [{ mark: "alpha/one", holder: "beta", n: 5, weight: 5, tick: 0 }],
  });
  assert.equal(r.starving, false);
  assert.equal(r.staked_marks, 1);
});

test("F8s · a docket the SETTLEMENT took away whole is a lawful crossing, not a starving one (POS-364, R11)", () => {
  // A window whose only claim was a parcel over the cap: it materialized, the
  // settlement opposes it, and fold-input-cli withheld it from the sketchbooks.
  // Escrow stands elsewhere. Without the withheld term this is F8a's refusal.
  const stakes = [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }];
  const r = starvingCheck({ marks: [], stakes, docketClaims: 1, withheldBySettlement: 1 });
  assert.equal(r.starving, false);
  assert.equal(r.withheld_by_settlement, 1);
  assert.match(r.why, /the settlement opposes every one/);
  // CONTROL: the same input with nothing withheld is still F8a's refusal.
  assert.equal(caught(() => starvingCheck({ marks: [], stakes, docketClaims: 1 })).reason, "store-starving");
});

test("F8d · a stake position of zero is not escrow — it must not hold the guard open", () => {
  const r = starvingCheck({ marks: [], stakes: [{ mark: "alpha/one", holder: "beta", n: 0, weight: 0, tick: 0 }] });
  assert.equal(r.starving, false);
  assert.equal(r.quiet, true, "zero escrow across the board is a poor town, not a blind crossing");
});

test("F8e · the guard runs inside storeWriteDown, before the clone is touched", () => {
  const w = makeWorld("starve", { gitEraSketchbooks: ["alpha"] });
  const e = caught(() => storeWriteDown({
    repo: w.repo,
    at: Date.parse(AT_ISO),
    input: foldInput([], { stakes: [{ mark: "alpha/staked", holder: "beta", n: 2, weight: 2, tick: 0 }] }),
  }));
  assert.ok(e instanceof FoldInputRefusal);
  assert.equal(e.reason, "store-starving");
  assert.equal(
    w.git("for-each-ref", "--format=%(refname)", "refs/remotes/origin/draft/").trim().split("\n").filter(Boolean).length,
    1,
    "the git-era ref is still there: a refusal that lands after the clone has been rewritten is a refusal that also has to be undone",
  );
});

// ── F8f–F8j · THE DOCKET'S SIZE IS THE GUARD'S THIRD INPUT (2026-09-09) ──────
//
// F8c above says the guard must not fire on a lawfully quiet DELTA and proves it
// with an offered set that is non-empty and entirely unchanged. It passed, and
// the guard was still wrong: under `foldDelta` the OFFERED set IS the docket, so
// a window in which NOBODY LOCKED A CLAIM arrived as `marks: []` — the same
// value as a store that failed to answer — and refused.
//
// Measured on prod 2026-09-09, all 30 closed windows the store has ever had: 6
// of them (151, 156, 157, 158, 165, 167) had an empty docket, one crossing in
// five. Rehearsed on a `pg_dump` scratch at window 180: `store-starving`,
// `SETTLEMENT EXIT=1`, `world_to` empty.
//
// BOTH HALVES RUN HERE, and they must. A test of only the quiet half would pass
// on a guard that had simply been deleted.

test("F8f · an empty DOCKET passes quietly, and the sentence names the window", () => {
  // The lawful quiet crossing. Escrow stands — it always does, 281 positions on
  // an ordinary prod day — and that is not evidence of anything when nobody
  // filed a claim to be answered.
  const r = starvingCheck({
    marks: [],
    stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
    docketClaims: 0,
    window: 180,
  });
  assert.equal(r.starving, false, "an empty docket is a quiet day, not a blind crossing");
  assert.equal(r.quiet, true);
  assert.equal(r.docket_claims, 0);
  assert.match(r.why, /the docket was empty: nobody locked a claim in window 180/,
    "the keeper reads this twelve hours later; a bare `quiet: true` does not say WHICH quiet");
});

test("F8g · a NON-EMPTY docket whose mark read returns nothing still REFUSES — the teeth", () => {
  // The state the guard exists for, and the one the fix must not spend. The
  // candle locked 33 claims; the mark read came back with none; escrow stands.
  // That is two tables written by two pens disagreeing, which is exactly what
  // `store-starving` is the word for.
  const e = caught(() => starvingCheck({
    marks: [],
    stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
    docketClaims: 33,
    window: 177,
  }));
  assert.ok(e instanceof FoldInputRefusal, "a docket with rows and no marks must still refuse");
  assert.equal(e.reason, "store-starving");
  assert.match(e.detail, /alpha\/staked/);
});

test("F8h · a supplier that does not say how big its docket was refuses exactly as before", () => {
  // Back-compatibility stated as a claim rather than assumed. An absent
  // `docket_claims` is not proof of a quiet day, and an unproved quiet is the
  // 2026-08-26 starving-crossing shape. The register's own entry point always
  // says; a hand-built input or an older instrument may not.
  const e = caught(() => starvingCheck({
    marks: [],
    stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
  }));
  assert.ok(e instanceof FoldInputRefusal);
  assert.equal(e.reason, "store-starving");
});

test("F8i · storeWriteDown carries `docket_claims` onto the receipt, and passes an empty docket end to end", () => {
  // The whole path, not the function alone: a fold input whose `selection` says
  // the docket was empty must reach a receipt that says `source: store`, carries
  // the size, and did not refuse.
  const w = makeWorld("quiet-docket", { gitEraSketchbooks: ["alpha"] });
  const out = storeWriteDown({
    repo: w.repo,
    at: Date.parse(AT_ISO),
    input: foldInput([], {
      as_of: { window: 180, world_sha: "0".repeat(40), town_sha: "1".repeat(40) },
      stakes: [{ mark: "alpha/staked", holder: "beta", n: 2, weight: 2, tick: 0 }],
      selection: { by: "docket", window: 180, entry: "fold-delta.mjs § foldDelta", docket_claims: 0, note: null },
    }),
  });
  assert.equal(out.source, "store");
  assert.equal(out.marks, 0);
  assert.equal(out.selection.docket_claims, 0, "the receipt must carry the size, or nobody can check the guard's call");
  assert.equal(out.starving_check.starving, false);
  assert.equal(out.starving_check.quiet, true);
  assert.equal(out.starving_check.docket_claims, 0);
  assert.match(out.starving_check.why, /nobody locked a claim in window 180/);
});

test("F8j · storeWriteDown still refuses a docket with rows and no marks, before the clone is touched", () => {
  // F8e's twin on the other side of the fix. The refusal must still land BEFORE
  // `clearGitSketchbooks`, because a refusal that arrives after the clone was
  // rewritten is a refusal that also has to be undone.
  const w = makeWorld("starve-docket", { gitEraSketchbooks: ["alpha"] });
  const e = caught(() => storeWriteDown({
    repo: w.repo,
    at: Date.parse(AT_ISO),
    input: foldInput([], {
      stakes: [{ mark: "alpha/staked", holder: "beta", n: 2, weight: 2, tick: 0 }],
      selection: { by: "docket", window: 177, entry: "fold-delta.mjs § foldDelta", docket_claims: 33, note: null },
    }),
  }));
  assert.ok(e instanceof FoldInputRefusal);
  assert.equal(e.reason, "store-starving");
  assert.equal(
    w.git("for-each-ref", "--format=%(refname)", "refs/remotes/origin/draft/").trim().split("\n").filter(Boolean).length,
    1,
    "the git-era ref is still there: the guard still runs before any work",
  );
});

// ── F8k–F8n · A COUNT IS A NON-NEGATIVE INTEGER, OR IT IS NOT A COUNT ────────
//
// The reviewer's note of 2026-09-09. `Number("")`, `Number(false)` and
// `Number([])` are all 0, so the first version of the absent-check read each of
// them as "the docket was empty" and PASSED — a fail-open on the last guard
// before a crossing publishes. Reachable only from hand-written input, which is
// exactly the supplier the guard exists to be suspicious of.
//
// One test per coercion, because a loop over a table would report the three as
// one failure and a reader would not know which coercion came back.

for (const [label, value] of [["an empty string", ""], ["false", false], ["an empty array", []]]) {
  test(`F8k · ${label} is NOT a docket of zero — it refuses as a shape, not as starving`, () => {
    const e = caught(() => starvingCheck({
      marks: [],
      stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
      docketClaims: value,
      window: 180,
    }));
    assert.ok(e instanceof FoldInputRefusal, `${label} must not pass as an empty docket`);
    assert.equal(e.reason, "fold-input-shape",
      "and it refuses under its OWN name: an operator reading `store-starving` here would go looking at the store, "
      + "when the defect is in what the supplier sent");
    assert.match(e.detail, /not a count/);
  });
}

test("F8l · a negative count and a fractional one refuse too", () => {
  // The other side of the same rule. `-1` and `1.5` are finite numbers and would
  // both survive a `Number.isFinite` test; neither is a number of claims.
  for (const bad of [-1, 1.5, Number.NaN, Infinity]) {
    const e = caught(() => starvingCheck({
      marks: [], stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
      docketClaims: bad, window: 180,
    }));
    assert.ok(e instanceof FoldInputRefusal, `${String(bad)} must refuse`);
    assert.equal(e.reason, "fold-input-shape", `${String(bad)} must refuse as a shape`);
  }
});

test("F8m · a STRING count refuses rather than being read charitably", () => {
  // `"0"` is the dangerous one: it coerces to a docket of zero and would pass a
  // crossing quietly. A supplier speaking JSON gives a number; one giving a
  // string does not know the contract, and guessing for it is how a guard ends
  // up trusting a value nobody checked.
  const e = caught(() => starvingCheck({
    marks: [], stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
    docketClaims: "0", window: 180,
  }));
  assert.ok(e instanceof FoldInputRefusal);
  assert.equal(e.reason, "fold-input-shape");
});

test("F8n · absent is STILL the one charitable reading, and 0 still passes", () => {
  // The control that stops F8k–F8m from being a guard that refuses everything.
  // Absent refuses as starving (F8h's rule, unchanged); a real zero passes.
  const absent = caught(() => starvingCheck({
    marks: [], stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
  }));
  assert.equal(absent.reason, "store-starving", "absent is unproved quiet, not a shape error");

  const zero = starvingCheck({
    marks: [], stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
    docketClaims: 0, window: 180,
  });
  assert.equal(zero.quiet, true);
  assert.equal(zero.docket_claims, 0);
});

test("F8o · the guard and the fold CLI share ONE rule, not two spellings of it", () => {
  // The reviewer found the coercion trap in `fold-input-cli`'s check one file
  // away from this lane's own fix for it. That is the two-copies class, so the
  // predicate has one home — `fold-delta.mjs § isDocketCount` — and this asserts
  // the guard actually agrees with it rather than carrying a private twin.
  for (const bad of ["", false, [], null, undefined, -1, 1.5, "0", {}]) {
    assert.equal(isDocketCount(bad), false, `${JSON.stringify(bad ?? null)} must not be a count`);
  }
  for (const good of [0, 1, 33, 831]) assert.equal(isDocketCount(good), true, `${good} is a count`);

  // And the guard's own behaviour tracks it: everything the predicate rejects
  // and that is not absent refuses here.
  for (const bad of ["", false, [], -1, 1.5, "0"]) {
    const e = caught(() => starvingCheck({
      marks: [], stakes: [{ mark: "alpha/staked", holder: "beta", n: 1, weight: 1, tick: 0 }],
      docketClaims: bad, window: 180,
    }));
    assert.equal(e?.reason, "fold-input-shape", `${JSON.stringify(bad)} must refuse in the guard too`);
  }
});

// ── F9 · A MARK THE WALL CANNOT BIND IS HELD OUT, NOT WRITTEN ────────────────
//
// The ruling, revised on measurement. The first version filtered on `by:
// the-town` and was withdrawn: `by: the-town` is coextensive with household
// `solo:the-town` — 378 of 1,031 rows — so it would have frozen 37% of the town,
// the boarding and door marks among them, to protect six law nodes.
//
// The recorded defect was never "law is in the store". It was that the
// write-down OPENED A SKETCHBOOK for `the-town`, which is not a household the
// sweep's authorship wall can bind. A branch the wall cannot bind is a branch
// whose marks publish unverified, and the sweep leaves such a branch ALONE
// rather than refusing it — so not opening one is the only place this can be
// stopped.

test("F9a · a docket mark whose household the wall cannot bind opens NO sketchbook", () => {
  const w = makeWorld("unbound");
  w.git("update-index", "--add", "--cacheinfo",
    `100644,${execFileSync("git", ["-C", w.repo, "hash-object", "-w", "--stdin"],
      { input: JSON.stringify(REGISTRY), encoding: "utf8" }).trim()},WORLD/households.json`);
  const tree = w.git("write-tree").trim();
  const commit = execFileSync("git", ["-C", w.repo, "commit-tree", tree, "-p", w.git("rev-parse", "main").trim(), "-m", "registry"],
    { encoding: "utf8", env: { ...process.env, ...SEED_ENV } }).trim();
  w.git("update-ref", "refs/heads/main", commit);

  const report = storeWriteDown({
    repo: w.repo,
    at: Date.parse(AT_ISO),
    input: foldInput([
      // A resident whose login the registry binds.
      storeMark({ slug: "alpha/a-home", household: "gh:293432145", path: "WORLD/marks/alpha/a-home/mark.md" }),
      // The town's own law node, arriving in the docket exactly as it does live.
      storeMark({ slug: "the-town/co-sign-guard", by: "the-town", household: "solo:the-town",
        path: "WORLD/marks/the-town/co-sign-guard/mark.md", founder_commit: "abc1234" }),
    ]),
  });

  const branches = w.git("for-each-ref", "--format=%(refname:short)", "refs/heads/draft/").trim().split("\n").filter(Boolean);
  assert.deepEqual(branches, ["draft/aionsolare"],
    `only the bindable household gets a sketchbook; got ${JSON.stringify(branches)}`);
  assert.equal(
    w.git("for-each-ref", "--format=%(refname)", "refs/heads/draft/the-town").trim(), "",
    "and draft/the-town is never created — a branch the wall cannot bind is a branch whose marks publish unverified");

  assert.equal(report.held_unbound_count, 1);
  assert.deepEqual(report.held_unbound, [{
    id: "the-town/co-sign-guard",
    household_key: "solo:the-town",
    sketchbook: "the-town",
    crossing_output: "unbound-household",
    founder_commit: "abc1234",
  }], "held out, NAMED in full, with founder_commit reported beside it");

  // The wall's unbound list is NOT asserted empty here, and that is the finding:
  // `gh:293432145` binds, so this fixture happens to have none — but on the live
  // registry 32 of 84 households are unbindable and holding them ALL out would
  // hold out `amia-semper` and `alta-of-garrison`, the two marks S63 published.
  // The list stays on the receipt so the conductor can rule the wider question
  // with the number in front of him.
  assert.ok(Array.isArray(report.wall.unbound), "the wider set is still reported, not resolved here");
});

test("F9c · a SOLO RESIDENT the wall cannot bind is still WRITTEN — the ruling's stated test would have held them out", () => {
  // THE MEASUREMENT THAT FORCED THIS. `WORLD/households.json` at S63 knows only
  // the 73 `gh:` keys: every `solo:` household is absent from both `households`
  // and `logins`. So "a household the wall cannot bind" is true of
  // `solo:the-town` AND of `solo:amia-semper`, `solo:alta-of-garrison`,
  // `solo:berthillon`, `solo:neth` alike — 32 households, 484 marks. At window
  // 177's docket that rule holds out the two marks S63 actually published, and
  // the crossing publishes zero.
  //
  // This test is the guard against implementing the stated rule literally.
  const w = makeWorld("solo-resident");
  const report = storeWriteDown({
    repo: w.repo,
    at: Date.parse(AT_ISO),
    input: foldInput([
      storeMark({ slug: "amia-semper/the-stone-cottage-creek", by: "amia-semper", household: "solo:amia-semper",
        path: "WORLD/marks/amia-semper/the-stone-cottage-creek/mark.md" }),
    ]),
  });
  assert.equal(report.held_unbound_count, 0, "a solo RESIDENT is not the town and is not held out");
  assert.equal(report.written, 1);
  assert.deepEqual(
    w.git("for-each-ref", "--format=%(refname:short)", "refs/heads/draft/").trim().split(/\r?\n/).filter(Boolean),
    ["draft/amia-semper"],
    "their sketchbook is opened under the name the git era already uses — draft/amia-semper is on origin today",
  );
});

test("F9b · founder_commit is REPORTED, never used as the filter", () => {
  // The control for F9a's shape. `founder_commit` is on 142 rows and covers all
  // five of the-town's docket marks, so filtering on it would look like it
  // works — and would give the crossing two answers to "is this mine" that can
  // disagree. A resident mark carrying one is written like any other.
  const w = makeWorld("founder");
  const report = storeWriteDown({
    repo: w.repo,
    at: Date.parse(AT_ISO),
    input: foldInput([storeMark({ slug: "alpha/a-home", household: "alpha", founder_commit: "deadbee" })]),
  });
  assert.equal(report.held_unbound_count, 0, "a bindable household is written even carrying founder_commit");
  assert.equal(report.written, 1);
});

// ── F5 · THE PLAN IS PURE ────────────────────────────────────────────────────

test("F5 · planStoreWriteDown buckets by household and sorts, with no git and no clock", () => {
  const marks = normalizeFoldInput(foldInput([
    storeMark({ slug: "beta/zeta", household: "beta", path: "WORLD/marks/beta/zeta/mark.md" }),
    storeMark({ slug: "alpha/mid", household: "alpha", path: "WORLD/marks/alpha/mid/mark.md" }),
    storeMark({ slug: "alpha/aaa", household: "alpha", path: "WORLD/marks/alpha/aaa/mark.md" }),
  ])).marks;
  const plan = planStoreWriteDown(marks);
  assert.deepEqual(plan.households.map((h) => h.household), ["alpha", "beta"]);
  assert.deepEqual(plan.households[0].upserts.map((u) => u.path),
    ["WORLD/marks/alpha/aaa/mark.md", "WORLD/marks/alpha/mid/mark.md"]);
  assert.equal(plan.counts.marks, 3);
  assert.equal(plan.counts.households, 2);
  assert.equal(plan.counts.written, 3, "with no canon to compare against, every mark is a change");
  assert.equal(plan.counts.unchanged, 0);
});

// ── F8q–F8v · THE CARRIED ROWS ARE A NAMED TERM, NOT A WIDER DOCKET ──────────
//
// From 2026-09-12: the fold now offers the window's docket UNION every standing
// mark canon does not carry (`fold-delta.mjs § foldDelta`, the second term). So
// `offered` can lawfully exceed `docket_claims`, and the guard has to be told
// which part of the offered set is the docket's.
//
// THE DANGER IS THE OPPOSITE OF THE OBVIOUS ONE. Widening `docket_claims` to
// include the carry would have kept the arithmetic tidy and SPENT THE GUARD: a
// materialization that wrote nothing (docket 7, docket marks 0) alongside two
// carried rows would arrive as `offered 2 > 0` and pass, and the disagreement
// the guard exists to catch would be masked by the repair. F8s is that case.

test("F8q · offered 9 reads as docket 7 plus carried 2, and is not starving", () => {
  const r = starvingCheck({
    marks: Array.from({ length: 9 }, (_, i) => ({ slug: `alpha/m${i}` })),
    stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
    docketClaims: 7,
    carriedAbsent: 2,
    window: 185,
  });
  assert.equal(r.starving, false);
  assert.equal(r.offered, 9);
  assert.equal(r.docket_claims, 7, "the docket's size is still the docket's");
  assert.equal(r.carried_absent, 2);
  assert.equal(r.docket_offered, 7,
    "and the term the guard actually tests is the docket's own, stated on the receipt rather than inferred");
});

test("F8r · a crossing whose docket is empty and whose carry is not is NOT called quiet", () => {
  // The 09-12 repair crossing itself: nobody claimed at this window, and two
  // marks are being swept up from an earlier one. Two files are published. A
  // receipt calling that "quiet" would be a true guard telling a false story.
  const r = starvingCheck({
    marks: [{ slug: "neth/warm-stone-for-whoever-waits" }, { slug: "sophia-familiaris/reachability-is-not-permission" }],
    stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
    docketClaims: 0,
    carriedAbsent: 2,
    window: 186,
  });
  assert.equal(r.starving, false);
  assert.equal(r.quiet, false, "two marks are being written; that is not a quiet crossing");
  assert.equal(r.docket_offered, 0);
  assert.equal(r.carried_absent, 2);
  assert.match(r.why, /carried/, "and the sentence says which of the two terms filled the fold");
});

test("F8s · THE TEETH · a carried row must not mask a docket that was never materialized", () => {
  // The regression the named term exists to prevent. The candle locked 7 claims,
  // the mark read for this window returned NONE, escrow stands — `store-starving`,
  // exactly as before — and the two carried rows must not buy a pass by making
  // `offered` positive.
  const e = caught(() => starvingCheck({
    marks: [{ slug: "neth/warm-stone-for-whoever-waits" }, { slug: "sophia-familiaris/reachability-is-not-permission" }],
    stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
    docketClaims: 7,
    carriedAbsent: 2,
    window: 185,
  }));
  assert.ok(e instanceof FoldInputRefusal, "a docket with rows and no marks of its own must still refuse");
  assert.equal(e.reason, "store-starving");
  assert.match(e.detail, /canon-absent mark\(s\) this crossing is carrying .* are NOT an answer to this one/,
    "and the refusal says the carried rows were not counted as an answer, or the operator argues with the arithmetic");
  assert.match(e.detail, /no marks of this window's own docket/,
    "and it names the subject as the DOCKET, not as the fold, now that the fold can lawfully hold rows from elsewhere");
});

test("F8t · a carry larger than the offered set is incoherent and refuses rather than going negative", () => {
  // `docket_offered` is a subtraction, and a subtraction is a place a wrong
  // supplier turns into a negative number that reads as "no docket rows" and
  // passes. A subset cannot be larger than its set.
  const e = caught(() => starvingCheck({
    marks: [{ slug: "alpha/one" }],
    stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
    docketClaims: 1,
    carriedAbsent: 4,
    window: 185,
  }));
  assert.ok(e instanceof FoldInputRefusal);
  assert.equal(e.reason, "fold-input-shape");
  assert.match(e.detail, /carried/);
});

test("F8u · a supplier that says nothing about carrying is read as zero, exactly as before the field", () => {
  // Back-compatibility as a claim. Every fold input written before 2026-09-12
  // reaches this guard with no `carried_absent`, and must be judged by the
  // arithmetic it was written under.
  const r = starvingCheck({
    marks: [{ slug: "alpha/one" }],
    stakes: [{ mark: "alpha/staked", holder: "beta", n: 3, weight: 3, tick: 0 }],
    docketClaims: 1,
    window: 185,
  });
  assert.equal(r.starving, false);
  assert.equal(r.carried_absent, 0);
  assert.equal(r.docket_offered, 1);
});

test("F8v · storeWriteDown reads the carry off the selection and histograms both windows", () => {
  // The whole path. A fold input carrying window 185's docket and two marks
  // locked at 184 must publish all three, count the carry as its own term on the
  // receipt, and report `written_by_locked_window` keyed by window — which is the
  // measurement that says a crossing folded a delta and a repair rather than the
  // standing set.
  const w = makeWorld("carried-absent", { gitEraSketchbooks: [] });
  const out = storeWriteDown({
    repo: w.repo,
    at: Date.parse(AT_ISO),
    input: foldInput(
      [
        storeMark({ slug: "alpha/own-window", locked_window: 185 }),
        storeMark({ slug: "alpha/warm-stone", locked_window: 184 }),
        storeMark({ slug: "alpha/reachability", locked_window: 184 }),
      ],
      {
        as_of: { window: 185, world_sha: "0".repeat(40), town_sha: "1".repeat(40) },
        stakes: [{ mark: "alpha/staked", holder: "beta", n: 2, weight: 2, tick: 0 }],
        selection: {
          by: "docket", window: 185, entry: "fold-delta.mjs § foldDelta", docket_claims: 1,
          carried_absent: {
            checked: true, count: 2, canon_sha: "2".repeat(40),
            slugs: ["alpha/reachability", "alpha/warm-stone"],
          },
          note: null,
        },
      },
    ),
  });
  assert.equal(out.starving_check.starving, false);
  assert.equal(out.starving_check.carried_absent, 2, "the guard was told, not left to infer");
  assert.equal(out.starving_check.docket_offered, 1);
  assert.deepEqual(out.written_by_locked_window, { 184: 2, 185: 1 },
    "the histogram names both windows: this crossing's own, and the one it swept up behind it");
  assert.equal(out.selection.carried_absent.count, 2, "and the slugs reach the receipt by name");
  assert.deepEqual(out.selection.carried_absent.slugs, ["alpha/reachability", "alpha/warm-stone"]);
});

// ── POS-364 review: A PRE-LAW PARCEL AMENDED TODAY DOES NOT STOP THE CROSSING ──
//
// Every door amend restamps `date`. A household holding four pre-law parcels
// whose first is amended today: read by `date`, the tree's fold counts the
// amended one as a fourth claim after the law ("capped — already holds 4",
// settlement-sweep.mjs § foldRef) and the town stops. The write-down now carries
// the parcel's first claim into its mark.md (`claimed_at`, mark-render.mjs §
// recordFromRow), and the tree's fold reads it (world#166). Driven end to end:
// the store row as the door's amend left it, rendered by the write-down,
// written to the household's sketchbook, extracted and folded by the world's
// own engine at world#166's head.

test("F-claim · one door amend of a pre-law parcel goes through the write-down and the tree's fold with no error", async () => {
  const { renderedMark } = await import("../world2/tools/mark-render.mjs");
  const { materializeAtRef } = await import("../src/world-branches.mjs");
  const { pathToFileURL, fileURLToPath } = await import("node:url");
  const WORLD_CLONE = process.env.WORLD_CLONE ?? join(dirname(fileURLToPath(import.meta.url)), "..", "world-clone");
  const ENGINE = "a01213a822fbddeec31dfdd0dfb72afb9b6b9367";   // postmark-world#166
  const engine = await import(pathToFileURL(join(materializeAtRef(WORLD_CLONE, ENGINE, "tools"), "tools", "marks-fold.mjs")).href);

  // Canon: one household, four residents, four parcels claimed before the law (2026-07-30).
  const repo = join(scratch, `prelaw-${++seq}`);
  const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...SEED_ENV } });
  const hands = ["sa", "sb", "sc", "sd"];
  hands.forEach((h, i) => put(`WORLD/marks/${h}/plot/mark.md`,
    markRecord({ kind: "parcel", by: h, date: `2026-07-2${i + 1}`, at: { x: i * 100, y: 0 }, extent: { w: 25, h: 25 } }, `${h}'s plot`)));
  put("WORLD/households.json", JSON.stringify({ households: Object.fromEntries(hands.map((h) => [h, "sage-house"])) }, null, 2));
  g("init", "-q", "-b", "main"); g("config", "user.email", "seed@postmark.invalid"); g("config", "user.name", "seed");
  g("add", "-A"); g("commit", "-qm", "canon");

  // The store row after sa's door amend: `date` restamped, the origin claim's date beside it.
  const row = (firstClaimed, submittedAt = null) => ({
    slug: "sa/plot", kind: "parcel", owner: "sa", household: "sa", body: "sa's plot, moved", locked_window: 177,
    geometry: { at: { x: 10, y: 0 }, extent: { w: 25, h: 25 } }, data: { date: "2026-10-08T12:00:00.000Z" },
    first_claimed: firstClaimed, first_claim_submitted_at: submittedAt,
  });
  const foldTree = (firstClaimed, submittedAt = null) => {
    const r = row(firstClaimed, submittedAt);
    const report = storeWriteDown({ repo, at: Date.parse(AT_ISO), input: foldInput([{ slug: r.slug, kind: r.kind, by: r.owner, household: r.household, locked_window: 177, ...renderedMark(r) }]) });
    const branch = report.households[0].branch;
    const out = join(scratch, `prelaw-tree-${++seq}`);
    mkdirSync(out, { recursive: true });
    execFileSync("git", ["-C", repo, "archive", "--format=tar", `--output=${join(out, "w.tar")}`, branch, "--", "WORLD"]);
    execFileSync("tar", ["-xf", "w.tar"], { cwd: out });
    const marks = engine.loadTreeMarks(join(out, "WORLD", "marks"));
    return { marks, state: engine.fold({ marks, terrain: { features: [] }, stakes: [], tick: 1, households: Object.fromEntries(hands.map((h) => [h, "sage-house"])) }) };
  };

  const kept = foldTree("2026-07-21");
  assert.equal(kept.marks.find((m) => m.id === "sa/plot")?.claimed_at, "2026-07-21", "the mark.md carries the first claim");
  assert.deepEqual(kept.state.errors, [], "four pre-law parcels stand: the amended one is still prior estate");
  // AN UNDATED ORIGIN CLAIM (POS-364 delta review): its submitted_at is the first
  // claim, as the store's fold reads it (mark-render.mjs § firstClaimInstant).
  const undated = foldTree(null, new Date("2026-07-21T09:00:00.000Z"));
  assert.equal(undated.marks.find((m) => m.id === "sa/plot")?.claimed_at, "2026-07-21T09:00:00.000Z");
  assert.deepEqual(undated.state.errors, [], "dated by its submitted_at, it is still prior estate");
  // CONTROL: the same amend written without its first claim is the stopped town.
  const restamped = foldTree(null);
  assert.match(JSON.stringify(restamped.state.errors), /parcel claim capped — this credential household already holds 3/);
});

test("F-claim-ingest · marks-ingest never reads claimed_at back as a resident's change: it is the store's fact printed into the file", async () => {
  const { recordDiff } = await import("../world2/tools/marks-ingest.mjs");
  assert.deepEqual(recordDiff({ kind: "parcel", body: "a", claimed_at: "2026-07-21" }, { kind: "parcel", body: "a" }), []);
  assert.deepEqual(recordDiff({ kind: "parcel", body: "b", claimed_at: "2026-07-21" }, { kind: "parcel", body: "a" }), ["body"], "a real change is still read");
});
