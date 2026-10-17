// git-lane-dropped-unit.test.mjs — WLD-27 post-#501, R3 at the git writer
// (Wright, AUTHORITY 2026-10-13T07:52:24.868Z; Bevel's revised first review of
// #503): ON THE GIT LANE A SET-DOWN UNIT'S MARK IS REFUSED BY NAME — asked of the
// very record the writer would delete, before anything is deleted or committed.
//
//   node --test test/git-lane-dropped-unit.test.mjs
//
// The real door (`withdrawMarkViaOffice`, WORLD_SINGLE_LOG off, no store) and
// the real writer (src/leave-exec.mjs under its lock) over a throwaway world
// repo carrying the pinned world clone's own tools/ code (its marks-fold and
// loaders) and synthetic records written with the office's own `markRecord`.
// The household's sketchbook branch holds what canon does not. No remote, no
// push, no store. Credit: the private-branch case is Bevel's probe
// (test/bevel-git-drop-guard.test.mjs in the review scratch).

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { markRecord } from "../src/mark-record.mjs";

const WORLD = worldClone();
const skip = (!WORLD && NO_WORLD) || false;
const litter = [];
after(() => { for (const d of litter) { try { rmSync(d, { recursive: true, force: true }); } catch { /* litter */ } } });

const repo = mkdtempSync(join(tmpdir(), "wld27-git-drop-")); litter.push(repo);
const put = (p, content) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commit = (msg) => { git("add", "-A", "WORLD", "tools"); git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", msg); };

const HOUSE = "wld27-fixture", BRANCH = `draft/${HOUSE}`;
const root = { id: "the-town/let-there-be-light", by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 } };
const candy = (slug, x, extra = {}) => ({ id: `cy/${slug}`, by: "cy", slug, kind: "sited", class: "candy", label: "test-comets", dropped: "act:123", at: { x, y: 10 }, extent: { w: 1, h: 1 }, ...extra });
const PRIVATE = candy("private-set-down", 10);                         // only on the household branch
const CANON = candy("published-set-down", 30, { dropped: "act:124" }); // on main, in canon
const ORDINARY = { id: "cy/an-ordinary-draft", by: "cy", slug: "an-ordinary-draft", kind: "sited", at: { x: 50, y: 10 }, extent: { w: 1, h: 1 } };
const fileOf = (m) => `WORLD/marks/${m.by}/${m.slug}/mark.md`;

if (!skip) {
  // the world's own CODE, at the clone the suite pins — never its records
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  put(fileOf(CANON), markRecord(CANON, "A synthetic published set-down."));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [root, CANON] }));
  put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  commit("synthetic canon");
  git("switch", "-qc", BRANCH);
  put(fileOf(PRIVATE), markRecord(PRIVATE, "A synthetic set-down in the household sketchbook."));
  put(fileOf(ORDINARY), markRecord(ORDINARY, "An ordinary private draft."));
  commit("the household's sketchbook");
  git("switch", "-q", "main");
  Object.assign(process.env, { WORLD_CLONE: repo, WORLD_SINGLE_LOG: "", WORLD_POOL: "0", WORLD2_PG: "", TOWN_CLONE: join(repo, "no-town"), TOWN_PUSH: "", BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid" });
  delete process.env.WORLD2_PG_URL;
}

const KEY = { household: HOUSE, handles: new Set(["cy"]) };
const withdraw = async (m) => (await import("../src/world.mjs")).withdrawMarkViaOffice(repo, { mark: m.id }, KEY).then((x) => ({ x }), (e) => ({ e }));
const branchHead = () => git("rev-parse", BRANCH);
const onBranch = (m) => { try { git("cat-file", "-e", `${BRANCH}:${fileOf(m)}`); return true; } catch { return false; } };

for (const [what, m] of [["a PRIVATE git-only set-down (absent from canon) — credit Bevel's probe", PRIVATE], ["a set-down that stands in CANON", CANON]]) {
  test(`R3 git writer · ${what} is refused \`dropped-unit-withdraw-store-only\`; the branch and its file are untouched`, { skip }, async () => {
    const before = branchHead();
    assert.ok(onBranch(m), "the record is on the household branch");
    const { x, e } = await withdraw(m);
    assert.equal(x, undefined, `withdrawn instead: ${JSON.stringify(x)}`);
    assert.equal(e.code, 409, e.defect);
    assert.equal(e.reason, "dropped-unit-withdraw-store-only", "the writer's named reason reaches the door's caller");
    assert.match(e.defect, /withdrawn only on the store's path \(dropped-unit-withdraw-store-only\)/);
    assert.match(e.hint, /WORLD_SINGLE_LOG=1/);
    assert.equal(branchHead(), before, "no commit on the household branch");
    assert.ok(onBranch(m), "the record is still there");
    assert.equal(git("status", "--porcelain", "--", "WORLD"), "", "no file changed in the working tree");
  });
}

test("R3 git writer · an ORDINARY private draft on the same branch still withdraws on the git lane — this is the set-down refusal, not a shutdown of the lane", { skip }, async () => {
  const before = branchHead();
  const { x, e } = await withdraw(ORDINARY);
  assert.equal(e, undefined, `refused: ${e?.code} ${e?.defect}`);
  assert.deepEqual([x.withdrawn, x.was_published, x.branch, x.pushed], [true, false, BRANCH, false]);
  assert.notEqual(branchHead(), before, "the withdrawal committed on the branch");
  assert.equal(onBranch(ORDINARY), false, "its record left the sketchbook");
  assert.ok(onBranch(PRIVATE), "and the set-down beside it is untouched");
});
