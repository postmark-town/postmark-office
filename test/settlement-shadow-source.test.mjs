// settlement-shadow-source.test.mjs — THE REHEARSAL REHEARSES THE CROSSING THE BOX RUNS.
//
//   node --test --test-timeout=240000 test/settlement-shadow-source.test.mjs
//
// ── THE FINDING THIS HOLDS ──────────────────────────────────────────────────
//
// 2026-09-25 10:23Z the shadow said WOULD-REFUSE: `duplicate id "neth/warm-stone"`.
// The box crosses from the store, and the shadow still rehearsed the git path —
// town stakes and every git-era drawer on origin. S81 had published the store's
// copy at `WORLD/marks/neth/warm-stone/`; neth's drawer `draft/xf3s` still held
// the door's 09-11 copy at `WORLD/marks/let-there-be-light/warm-stone/`, with a
// different `at` and `extent`. The store crossing deletes those drawers from its
// clone before it writes (`store-writedown.mjs § clearGitSketchbooks`), so the
// refusal was true of a rollback crossing and false of the next one.
//
// ── WHAT RUNS FOR REAL, AND WHAT IS STUBBED ─────────────────────────────────
//
// Real: `deploy/settlement-shadow.sh`, `shadow-refs-reset.sh`,
// `src/store-writedown.mjs`, and a world checkout's OWN `settlement-sweep.mjs`
// and `mark-lint.mjs` — the lint is the instrument that said "duplicate id", so a
// stub world here could not express the finding (crossing-registry-real-sweep's
// lesson). Stubbed: the two store READS, `await-clearing.mjs` and
// `fold-input-cli.mjs`, because there is no Postgres in a test. A `node` wrapper
// on PATH answers those two with fixture JSON, logs their argv, and execs the
// real node for everything else.
//
// ── THE FALSIFIERS (Wright's, 2026-09-25) ───────────────────────────────────
//
//   (i)   a drawer copy that differs from canon at the same id no longer reds the
//         store rehearsal — and the SAME fixture under `git` still does (control)
//   (ii)  a real duplicate in canon still reds it, with the same sentence — the
//         sweep's own main-fold refusal, which it reaches before the lint, and
//         the same bytes from either source
//   (iii) the verdict names the source it rehearsed

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHADOW_SH = join(OFFICE, "deploy", "settlement-shadow.sh");

function findWorldCheckout() {
  const candidates = [
    process.env.POSTMARK_WORLD_CLONE,
    process.env.WORLD_CLONE,
    join(OFFICE, "world-clone"),
    join(OFFICE, "..", "postmark-world"),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(join(c, "tools", "settlement-sweep.mjs"))) return c;
  return null;
}
const WORLD = findWorldCheckout();
const has = (cmd) => { try { execFileSync("sh", ["-c", cmd], { stdio: "ignore" }); return true; } catch { return false; } };
const WHY_SKIP = !has("true") ? "no POSIX sh"
  : !WORLD ? "no world checkout found (set POSTMARK_WORLD_CLONE)" : false;

const scratch = mkdtempSync(join(tmpdir(), "postmark-shadow-source-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });

// The two copies of neth's stone as they stood on 2026-09-25, less `class: thing`:
// a fixture world declares no class roster, and the lint would refuse the class
// before it reached the id.
const CANON_STONE = "---\nkind: sited\nby: neth\ndate: 2026-09-24T22:09:49.580Z\nat: { x: 1304, y: 2093 }\n"
  + "extent: { w: 0.3, h: 0.2 }\n---\n\na fog-smoothed stone from the lower terrace, warm from a pocket, that never quite goes cold.\n";
const DRAWER_STONE = "---\nkind: sited\nby: neth\ndate: 2026-08-22T19:11:51.068Z\nat: { x: -1496, y: -2296 }\n"
  + "extent: { w: 1, h: 1 }\n---\n\na fog-smoothed stone from the lower terrace, warm from a pocket, that never quite goes cold.\n";
const CANON_PATH = "WORLD/marks/neth/warm-stone/mark.md";
const DRAWER_PATH = "WORLD/marks/let-there-be-light/warm-stone/mark.md";
const DUPLICATE = /duplicate id \\?"neth\/warm-stone\\?" — a leaf slug must be unique per author \(by\)/;
// neth's stake in the stone — escrow is what makes a git sweep publish a drawer.
const STAKES = [{ holder: "neth", mark: "neth/warm-stone", n: 1 }];
const DUPLICATE_DOTTED = /duplicate id .neth\/warm-stone. — a leaf slug must be unique per author \(by\)/;

let seq = 0;
const ENV = {
  GIT_AUTHOR_NAME: "seed", GIT_AUTHOR_EMAIL: "seed@postmark.invalid",
  GIT_COMMITTER_NAME: "seed", GIT_COMMITTER_EMAIL: "seed@postmark.invalid",
};
const g = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...ENV },
}).trim();
const put = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };

/**
 * The box on the morning of 2026-09-25, in a bottle: world main carrying the
 * store's copy of the stone, neth's drawer carrying the door's, a town, and the
 * two store reads answering window 210 with the stone in its docket.
 */
function box({ canonDuplicate = false } = {}) {
  const root = join(scratch, `box-${++seq}`);
  const seed = join(root, "seed");
  const worldOrigin = join(root, "world.git");
  const worldClone = join(root, "world-clone");
  const townOrigin = join(root, "town.git");
  const townClone = join(root, "town-clone");
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });

  // ── the world: the checkout's own tools, the frame, and the published stone
  cpSync(join(WORLD, "tools"), join(seed, "tools"), {
    recursive: true, filter: (src) => !/\.test\.mjs$/.test(src),
  });
  put(seed, "WORLD/skeleton.json", `${JSON.stringify({ features: [], physics_registry: {} }, null, 2)}\n`);
  put(seed, "WORLD/marks/let-there-be-light/mark.md",
    "---\nkind: sited\nby: the-town\ntier: constitution\nat: { x: 0, y: 0 }\n"
    + "extent: { w: 320000, h: 320000 }\ndate: 2026-07-01\n---\n\nthe frame\n");
  put(seed, "WORLD/households.json",
    `${JSON.stringify({ town_sha: "a".repeat(40), households: { xf3s: "gh:1" }, logins: { xf3s: "gh:1" } }, null, 2)}\n`);
  // The suite step is not under test here; the world's own suite is the shadow's
  // later phase and would take minutes over a fixture it was not written for.
  put(seed, "package.json", JSON.stringify({ name: "world-fixture", type: "module", scripts: { test: "node -e 0" } }));
  put(seed, CANON_PATH, CANON_STONE);
  if (canonDuplicate) put(seed, DRAWER_PATH, DRAWER_STONE);
  g(seed, "init", "-q", "-b", "main");
  execFileSync(process.execPath, [join(seed, "tools", "marks-fold.mjs")], { cwd: seed, stdio: "ignore" });
  g(seed, "add", "-A");
  g(seed, "commit", "-q", "-m", "canon: S81");
  // neth's drawer, as the door left it on 09-11
  g(seed, "checkout", "-q", "-b", "draft/xf3s");
  if (!canonDuplicate) {
    put(seed, DRAWER_PATH, DRAWER_STONE);
    g(seed, "add", "-A");
    g(seed, "commit", "-q", "-m", "mark: neth/warm-stone — by neth (via world_leave_mark)");
  }
  g(seed, "checkout", "-q", "main");
  execFileSync("git", ["clone", "-q", "--bare", seed, worldOrigin]);
  execFileSync("git", ["clone", "-q", worldOrigin, worldClone]);
  const worldMain = g(worldOrigin, "rev-parse", "main");

  // ── the town: its sha, and for the git rehearsal a stake deriver with no stakes
  const townSeed = join(root, "town-seed");
  put(townSeed, "tools/world-stake.mjs", `process.stdout.write(${JSON.stringify(JSON.stringify(STAKES))});\n`);
  g(townSeed, "init", "-q", "-b", "main");
  g(townSeed, "add", "-A");
  g(townSeed, "commit", "-q", "-m", "town");
  execFileSync("git", ["clone", "-q", "--bare", townSeed, townOrigin]);
  execFileSync("git", ["clone", "-q", townOrigin, townClone]);
  const townSha = g(townOrigin, "rev-parse", "main");

  // ── the store's two answers
  const docket = { window: 210, cleared_at: "2026-09-25T05:45:40Z", town_sha: townSha, rehearsal: true };
  const foldInput = {
    marks: [{
      slug: "neth/warm-stone", kind: "sited", by: "neth", household: "xf3s",
      locked_window: 210, status: "standing", bytes: CANON_STONE,
    }],
    stakes: STAKES,
    entry: { module: "world2/tools/fold-delta.mjs", name: "foldDelta" },
    selection: {
      by: "docket", window: 210, entry: "fold-delta.mjs § foldDelta", docket_claims: 1,
      carried_absent: { checked: true, count: 0, slugs: [], skipped_no_household: [], canon_sha: worldMain },
      note: null,
    },
    as_of: { window: 210, town_sha: townSha, world_sha: worldMain },
    ingest: { storeSha: townSha, reason: "at-head", behind: 0 },
  };
  writeFileSync(join(root, "docket.json"), `${JSON.stringify(docket)}\n`);
  writeFileSync(join(root, "fold-input.json"), `${JSON.stringify(foldInput)}\n`);

  // ── `node`, with the two store reads answered from the fixture
  const realNode = execFileSync("sh", ["-c", "command -v node"], { encoding: "utf8" }).trim().split("\n")[0];
  writeFileSync(join(bin, "node"), [
    "#!/bin/sh",
    'case "$1" in',
    '  */await-clearing.mjs) echo "await-clearing $*" >> "$STORE_READS"; cat "$FIXTURE_DOCKET"; exit 0 ;;',
    '  */fold-input-cli.mjs) echo "fold-input-cli $*" >> "$STORE_READS"; cat "$FIXTURE_FOLD_INPUT"; exit 0 ;;',
    "esac",
    `exec "${realNode}" "$@"`,
    "",
  ].join("\n"));
  chmodSync(join(bin, "node"), 0o755);

  return { root, bin, worldClone, townClone, worldMain, townSha };
}

function rehearse(b, source) {
  const shadowClone = join(b.root, `shadow-${source}`);
  const report = join(b.root, `shadow-${source}.json`);
  const reads = join(b.root, `reads-${source}.log`);
  const env = {
    ...process.env,
    PATH: `${b.bin}:${process.env.PATH}`,
    OFFICE_ROOT: OFFICE,
    TOWN_CLONE: b.townClone,
    WORLD_CLONE: b.worldClone,
    SHADOW_CLONE: shadowClone,
    SHADOW_REPORT: report,
    STORE_READS: reads,
    FIXTURE_DOCKET: join(b.root, "docket.json"),
    FIXTURE_FOLD_INPUT: join(b.root, "fold-input.json"),
  };
  if (source === null) delete env.SETTLEMENT_SOURCE; else env.SETTLEMENT_SOURCE = source;
  const res = spawnSync("sh", [SHADOW_SH], { encoding: "utf8", env });
  let verdict = null;
  try { verdict = JSON.parse(readFileSync(report, "utf8")); } catch { /* none written */ }
  let storeReads = [];
  try { storeReads = readFileSync(reads, "utf8").split("\n").filter(Boolean); } catch { /* none */ }
  return { res, verdict, storeReads, all: `${res.stdout}${res.stderr}` };
}

test("(i) control — the box's state under `git` refuses with the shadow's own sentence", { skip: WHY_SKIP }, () => {
  // The fixture must be able to express the finding, or (i) below asserts nothing.
  const r = rehearse(box(), "git");
  assert.equal(r.res.status, 1, `the git rehearsal folds neth's drawer and must refuse: ${r.all.slice(-800)}`);
  assert.equal(r.verdict?.status, "would-refuse");
  assert.match(r.verdict.detail, DUPLICATE_DOTTED,
    "the refusal the box printed at 10:23Z, reproduced — the drawer copy and canon's are two records with one id");
  assert.deepEqual(r.storeReads, [], "the git rehearsal reads no store");
});

test("(i) the same box under `store` would settle: the drawer is not the crossing's input", { skip: WHY_SKIP }, () => {
  const b = box();
  const r = rehearse(b, "store");
  assert.equal(r.res.status, 0, `the store rehearsal must settle: ${r.all.slice(-1200)}`);
  assert.equal(r.verdict?.status, "would-settle");
  assert.doesNotMatch(r.all, DUPLICATE, "and nothing on the way said duplicate");
  assert.match(r.all, /1 already in canon/,
    "the stone the docket re-offers is skipped as canon's own bytes, not written again");
  assert.match(r.all, /cleared 1 git-era drawer ref/, "and neth's drawer was cleared, as the crossing clears it");
  // The store reads were asked the crossing's questions, with the rehearsal's window.
  assert.equal(r.storeReads.length, 2, `two store reads: ${r.storeReads.join(" | ")}`);
  assert.match(r.storeReads[0], /await-clearing\.mjs --since \S+ --rehearse$/);
  assert.match(r.storeReads[1], new RegExp(`fold-input-cli\\.mjs --world-sha ${b.worldMain} --town-clone \\S+ --town-sha ${b.townSha} --window 210 --world-repo \\S+`));
});

test("(ii) a real duplicate IN CANON refuses the store rehearsal exactly as it refuses the git one", { skip: WHY_SKIP }, () => {
  // A duplicate already on main never reaches the lint: the sweep folds main
  // first and stops there, by name. The store path must not change that answer.
  const b = box({ canonDuplicate: true });
  const store = rehearse(b, "store");
  const git = rehearse(b, "git");
  assert.equal(store.res.status, 1, `two records with one id on main must refuse: ${store.all.slice(-800)}`);
  assert.equal(store.verdict?.status, "would-refuse");
  assert.match(store.verdict.detail, /main folds with 1 error\(s\).*neth\/warm-stone.*duplicate id/);
  assert.equal(git.verdict?.status, "would-refuse");
  assert.equal(store.verdict.detail, git.verdict.detail, "the same sentence from either source");
});

test("(iii) the verdict names the source it rehearsed, and the window under `store`", { skip: WHY_SKIP }, () => {
  const b = box();
  const store = rehearse(b, "store");
  assert.equal(store.verdict?.source, "store");
  assert.equal(store.verdict?.window, 210);
  assert.match(store.verdict.detail, /from store/);

  const git = rehearse(b, "git");
  assert.equal(git.verdict?.source, "git");
  assert.equal(git.verdict?.window, null, "no docket was read, so no window — null, not absent");

  const unset = rehearse(b, null);
  assert.equal(unset.verdict?.source, "git", "unset is git, as settlement-auto.sh reads it");
});

test("an unrecognised SETTLEMENT_SOURCE refuses rather than rehearsing a guess", { skip: WHY_SKIP }, () => {
  const r = rehearse(box(), "Store");
  assert.equal(r.res.status, 1);
  assert.match(r.all, /is not `store` or `git`/);
  assert.deepEqual(r.storeReads, []);
});
